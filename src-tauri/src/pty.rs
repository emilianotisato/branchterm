use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

pub struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

impl PtyHandle {
    pub fn write_input(&mut self, data: &[u8]) -> Result<(), String> {
        self.writer
            .write_all(data)
            .map_err(|e| format!("PTY write failed: {e}"))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("PTY resize failed: {e}"))
    }

    pub fn kill(&mut self) {
        let _ = self.child.lock().unwrap().kill();
    }
}

pub type PtyMap = Arc<Mutex<HashMap<String, PtyHandle>>>;

pub fn new_pty_map() -> PtyMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn pty_event_name(tab_id: &str) -> String {
    format!("pty-output-{}", tab_id.replace([' ', '/'], "_"))
}

// Minimal OSC sequence parser — detects OSC 133;A (shell returned to prompt)
enum OscState {
    Normal,
    Esc,
    OscOpen,
    Collecting(Vec<u8>),
    EscInOsc(Vec<u8>),
}

struct OscParser {
    state: OscState,
}

impl OscParser {
    fn new() -> Self {
        OscParser { state: OscState::Normal }
    }

    fn feed(&mut self, byte: u8) -> Option<Vec<u8>> {
        let prev = std::mem::replace(&mut self.state, OscState::Normal);
        match prev {
            OscState::Normal => {
                if byte == 0x1b { self.state = OscState::Esc; }
                None
            }
            OscState::Esc => {
                self.state = if byte == b']' { OscState::OscOpen } else { OscState::Normal };
                None
            }
            OscState::OscOpen => {
                self.state = OscState::Collecting(vec![byte]);
                None
            }
            OscState::Collecting(mut buf) => {
                if byte == 0x07 {
                    Some(buf)
                } else if byte == 0x1b {
                    self.state = OscState::EscInOsc(buf);
                    None
                } else {
                    buf.push(byte);
                    self.state = OscState::Collecting(buf);
                    None
                }
            }
            OscState::EscInOsc(buf) => {
                if byte == b'\\' { Some(buf) } else { None }
            }
        }
    }
}

pub fn spawn_pty(
    tab_id: String,
    workspace_path: &Path,
    startup_command: Option<String>,
    autostart: bool,
    app_handle: AppHandle,
    pty_map: &PtyMap,
) -> Result<(), String> {
    if pty_map.lock().unwrap().contains_key(&tab_id) {
        return Ok(());
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

    // Compute shell name before spawn so we can set env vars AND use in injection thread
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("bash")
        .to_string();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(workspace_path);
    cmd.env("TERM", "xterm-256color");

    // For bash (and others with PROMPT_COMMAND support): set via env var before launch.
    // This is completely invisible — no text injected into the PTY.
    // For zsh: env var doesn't work; we inject via PTY in the thread below (with `clear`).
    if shell_name != "zsh" {
        cmd.env("PROMPT_COMMAND", "printf '\\033]133;A\\007'");
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;

    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let child_arc = Arc::new(Mutex::new(child));
    let child_for_watcher = Arc::clone(&child_arc);

    {
        let mut map = pty_map.lock().unwrap();
        map.insert(
            tab_id.clone(),
            PtyHandle { writer, master: pair.master, child: child_arc },
        );
    }

    let (exit_tx, exit_rx) = std::sync::mpsc::channel::<()>();

    // Watcher thread: signals pty-exit-{tabId} with exit status when process ends
    let app_handle_w = app_handle.clone();
    let tab_id_w = tab_id.clone();
    std::thread::spawn(move || {
        let _ = exit_rx.recv();
        let mut c = child_for_watcher.lock().unwrap();
        let ok = c.wait().ok().map(|s| s.success()).unwrap_or(false);
        let _ = app_handle_w.emit(&format!("pty-exit-{}", tab_id_w), ok);
    });

    // Reader thread: stream output + parse OSC 133;A for shell prompt signal
    let event_name = pty_event_name(&tab_id);
    let shell_event = format!("pty-shell-{}", tab_id);
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        let mut osc = OscParser::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => {
                    let _ = exit_tx.send(());
                    break;
                }
                Ok(n) => {
                    let encoded = STANDARD.encode(&buf[..n]);
                    let _ = app_handle.emit(&event_name, encoded);

                    for &byte in &buf[..n] {
                        if let Some(data) = osc.feed(byte) {
                            if let Ok(text) = std::str::from_utf8(&data) {
                                if text.starts_with("133;A") {
                                    let _ = app_handle.emit(&shell_event, "prompt");
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Startup injection thread: for zsh inject hook (invisible for bash via env var above),
    // then inject startup_command if autostart=true
    let pty_map_clone = Arc::clone(pty_map);
    let tab_clone = tab_id.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(800));

        // Zsh: inject precmd hook + clear to wipe the visible command from terminal
        if shell_name == "zsh" {
            {
                let mut map = pty_map_clone.lock().unwrap();
                if let Some(handle) = map.get_mut(&tab_clone) {
                    let _ = handle.write_input(
                        "precmd() { printf '\\033]133;A\\007'; }; clear\n".as_bytes(),
                    );
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }

        // Inject startup command if autostart is enabled
        if autostart {
            if let Some(cmd_str) = startup_command {
                if !cmd_str.is_empty() {
                    let mut map = pty_map_clone.lock().unwrap();
                    if let Some(handle) = map.get_mut(&tab_clone) {
                        let _ = handle.write_input(format!("{cmd_str}\n").as_bytes());
                    }
                }
            }
        }
    });

    Ok(())
}

pub fn kill_pty(tab_id: &str, pty_map: &PtyMap) {
    let mut map = pty_map.lock().unwrap();
    if let Some(mut handle) = map.remove(tab_id) {
        handle.kill();
    }
}

pub fn write_input(tab_id: &str, data: &str, pty_map: &PtyMap) -> Result<(), String> {
    let mut map = pty_map.lock().unwrap();
    let handle = map
        .get_mut(tab_id)
        .ok_or_else(|| format!("No PTY for tab '{tab_id}'"))?;
    handle.write_input(data.as_bytes())
}

pub fn resize_pty(tab_id: &str, cols: u16, rows: u16, pty_map: &PtyMap) -> Result<(), String> {
    let map = pty_map.lock().unwrap();
    let handle = map
        .get(tab_id)
        .ok_or_else(|| format!("No PTY for tab '{tab_id}'"))?;
    handle.resize(cols, rows)
}
