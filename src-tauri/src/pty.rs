use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

pub struct PtyHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    child_pid: Option<u32>,
    /// Gating flag: set to true just before the first startup command is
    /// written. Prevents the initial shell prompt's PROMPT_COMMAND firing
    /// (exit code 0) from transitioning state before the command runs.
    pub command_started: Arc<AtomicBool>,
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
        #[cfg(unix)]
        kill_unix_session(self.child_pid);

        let _ = self.child.lock().unwrap().kill();
    }
}

#[cfg(unix)]
fn kill_unix_session(child_pid: Option<u32>) {
    const SIGTERM: i32 = 15;
    const SIGKILL: i32 = 9;

    let Some(child_pid) = child_pid else {
        return;
    };
    let Some(session_id) = unix_session_id(child_pid as i32) else {
        return;
    };

    signal_unix_session(session_id, SIGTERM);
    std::thread::sleep(std::time::Duration::from_millis(150));
    signal_unix_session(session_id, SIGKILL);
}

#[cfg(unix)]
fn unix_session_id(pid: i32) -> Option<i32> {
    unsafe extern "C" {
        fn getsid(pid: i32) -> i32;
    }

    let sid = unsafe { getsid(pid) };
    (sid > 0).then_some(sid)
}

#[cfg(unix)]
fn signal_unix_session(session_id: i32, signal: i32) {
    unsafe extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }

    for pid in pids_in_unix_session(session_id) {
        let _ = unsafe { kill(pid, signal) };
    }
}

#[cfg(unix)]
fn pids_in_unix_session(session_id: i32) -> Vec<i32> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let pid = entry.file_name().to_string_lossy().parse::<i32>().ok()?;
            let stat = std::fs::read_to_string(entry.path().join("stat")).ok()?;
            (session_id_from_stat(&stat) == Some(session_id)).then_some(pid)
        })
        .collect()
}

#[cfg(unix)]
fn session_id_from_stat(stat: &str) -> Option<i32> {
    let after_comm = stat.rsplit_once(") ")?.1;
    after_comm.split_whitespace().nth(3)?.parse().ok()
}

pub type PtyMap = Arc<Mutex<HashMap<String, PtyHandle>>>;

pub fn new_pty_map() -> PtyMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn pty_event_name(tab_id: &str) -> String {
    format!("pty-output-{}", tab_id.replace([' ', '/'], "_"))
}

/// Open the command_started gate for a running PTY. Call this before injecting
/// any command so PROMPT_COMMAND exit-code events are allowed through.
pub fn set_command_started(tab_id: &str, pty_map: &PtyMap) {
    let map = pty_map.lock().unwrap();
    if let Some(handle) = map.get(tab_id) {
        handle.command_started.store(true, Ordering::Relaxed);
    }
}

// OSC sequence parser — detects `branchterm;ec=N` exit-code sequences
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
        OscParser {
            state: OscState::Normal,
        }
    }

    fn feed(&mut self, byte: u8) -> Option<Vec<u8>> {
        let prev = std::mem::replace(&mut self.state, OscState::Normal);
        match prev {
            OscState::Normal => {
                if byte == 0x1b {
                    self.state = OscState::Esc;
                }
                None
            }
            OscState::Esc => {
                self.state = if byte == b']' {
                    OscState::OscOpen
                } else {
                    OscState::Normal
                };
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
                if byte == b'\\' {
                    Some(buf)
                } else {
                    None
                }
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

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {e}"))?;
    let child_pid = child.process_id();

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
    let command_started = Arc::new(AtomicBool::new(false));
    let command_started_reader = Arc::clone(&command_started);
    let command_started_injector = Arc::clone(&command_started);

    {
        let mut map = pty_map.lock().unwrap();
        map.insert(
            tab_id.clone(),
            PtyHandle {
                writer,
                master: pair.master,
                child: child_arc,
                child_pid,
                command_started,
            },
        );
    }

    let (exit_tx, exit_rx) = std::sync::mpsc::channel::<()>();
    let app_handle_w = app_handle.clone();
    let app_handle_i = app_handle.clone();
    let tab_id_w = tab_id.clone();

    // Watcher thread: emits pty-exit-{tabId} when shell process exits
    std::thread::spawn(move || {
        let _ = exit_rx.recv();
        let mut c = child_for_watcher.lock().unwrap();
        let ok = c.wait().ok().map(|s| s.success()).unwrap_or(false);
        let _ = app_handle_w.emit(&format!("pty-exit-{}", tab_id_w), ok);
    });

    // Reader thread: stream output + parse branchterm;ec=N for exit code detection
    let event_name = pty_event_name(&tab_id);
    let exit_code_event = format!("pty-exit-code-{}", tab_id);
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
                                if let Some(rest) = text.strip_prefix("branchterm;ec=") {
                                    // Only emit after a command has been started.
                                    // Guards against the initial shell prompt's exit code (0)
                                    // transitioning the state before the startup command runs.
                                    if command_started_reader.load(Ordering::Relaxed) {
                                        let code: i32 = rest.parse().unwrap_or(0);
                                        let _ = app_handle.emit(&exit_code_event, code);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Injection thread: PROMPT_COMMAND hook (fires after every command),
    // then startup command if autostart=true
    let pty_map_clone = Arc::clone(pty_map);
    let tab_clone = tab_id.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(800));

        // Inject PROMPT_COMMAND after .bashrc has run (overrides any starship/custom setup).
        // Uses `; clear` to wipe the visible injection line from the terminal.
        // branchterm;ec=$? fires after EVERY command for ongoing state tracking.
        let hook = if shell_name == "zsh" {
            "precmd() { local c=$?; printf \"\\033]branchterm;ec=$c\\007\"; }; clear\n".to_string()
        } else {
            "PROMPT_COMMAND='__bt_e=$?; printf \"\\033]branchterm;ec=$__bt_e\\007\"'; clear\n"
                .to_string()
        };

        {
            let mut map = pty_map_clone.lock().unwrap();
            if let Some(handle) = map.get_mut(&tab_clone) {
                let _ = handle.write_input(hook.as_bytes());
            }
        }

        // Wait for hook to register + clear to complete
        std::thread::sleep(std::time::Duration::from_millis(400));

        if autostart {
            if let Some(cmd_str) = startup_command {
                if !cmd_str.is_empty() {
                    // Open the gate BEFORE writing so the exit code event gets through
                    command_started_injector.store(true, Ordering::Relaxed);
                    let _ = app_handle_i; // may be used in future
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
    let handle = {
        let mut map = pty_map.lock().unwrap();
        map.remove(tab_id)
    };

    if let Some(mut handle) = handle {
        handle.kill();
    }
}

pub fn kill_all_pty(pty_map: &PtyMap) {
    let handles = {
        let mut map = pty_map.lock().unwrap();
        std::mem::take(&mut *map)
    };

    for (_, mut handle) in handles {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn parses_session_id_from_proc_stat() {
        let stat = "1234 (bash) S 1000 1234 5678 34816 1234 4194304 1 2 3 4 0 0 0 0 20 0 1 0 12345";

        assert_eq!(session_id_from_stat(stat), Some(5678));
    }

    #[cfg(unix)]
    #[test]
    fn parses_session_id_when_command_has_spaces() {
        let stat = "1234 (npm run watch) S 1000 1234 5678 34816 1234 4194304 1 2 3 4 0 0 0 0";

        assert_eq!(session_id_from_stat(stat), Some(5678));
    }

    #[cfg(unix)]
    #[test]
    fn kill_unix_session_terminates_descendants() {
        use std::process::Command;
        use std::thread;
        use std::time::{Duration, Instant};

        let mut child = Command::new("setsid")
            .args(["sh", "-c", "sleep 30 & sleep 30"])
            .spawn()
            .expect("spawn test session");

        thread::sleep(Duration::from_millis(100));
        let session_id = unix_session_id(child.id() as i32).expect("test session id");
        assert!(
            live_pids_in_session(session_id).len() >= 2,
            "test session should contain the shell and at least one child"
        );

        kill_unix_session(Some(child.id()));
        let _ = child.wait();

        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let remaining = live_pids_in_session(session_id);
            if remaining.is_empty() {
                break;
            }
            if Instant::now() >= deadline {
                panic!("session still has live processes after cleanup: {remaining:?}");
            }
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(unix)]
    fn live_pids_in_session(session_id: i32) -> Vec<i32> {
        pids_in_unix_session(session_id)
            .into_iter()
            .filter(|pid| !is_zombie(*pid))
            .collect()
    }

    #[cfg(unix)]
    fn is_zombie(pid: i32) -> bool {
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            return false;
        };
        stat.rsplit_once(") ")
            .and_then(|(_, after_comm)| after_comm.split_whitespace().next())
            == Some("Z")
    }
}
