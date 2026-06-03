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
    child: Box<dyn portable_pty::Child + Send + Sync>,
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
        let _ = self.child.kill();
    }
}

pub type PtyMap = Arc<Mutex<HashMap<String, PtyHandle>>>;

pub fn new_pty_map() -> PtyMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn pty_event_name(branch_name: &str) -> String {
    format!("pty-output-{}", branch_name.replace([' ', '/'], "_"))
}

pub fn spawn_pty(
    branch_name: String,
    workspace_path: &Path,
    startup_command: Option<String>,
    app_handle: AppHandle,
    pty_map: &PtyMap,
) -> Result<(), String> {
    // Don't double-spawn
    if pty_map.lock().unwrap().contains_key(&branch_name) {
        return Ok(());
    }

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

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

    // Drop slave after spawning — child owns its end now
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    {
        let mut map = pty_map.lock().unwrap();
        map.insert(
            branch_name.clone(),
            PtyHandle {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    // Stream PTY output → Tauri events (base64-encoded)
    let event_name = pty_event_name(&branch_name);
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let encoded = STANDARD.encode(&buf[..n]);
                    let _ = app_handle.emit(&event_name, encoded);
                }
            }
        }
    });

    // Inject startup command after shell prompt appears
    if let Some(cmd_str) = startup_command {
        if !cmd_str.is_empty() {
            let pty_map_clone = Arc::clone(pty_map);
            let branch_clone = branch_name.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(800));
                let mut map = pty_map_clone.lock().unwrap();
                if let Some(handle) = map.get_mut(&branch_clone) {
                    let _ = handle.write_input(format!("{cmd_str}\n").as_bytes());
                }
            });
        }
    }

    Ok(())
}

pub fn kill_pty(branch_name: &str, pty_map: &PtyMap) {
    let mut map = pty_map.lock().unwrap();
    if let Some(mut handle) = map.remove(branch_name) {
        handle.kill();
    }
}

pub fn write_input(branch_name: &str, data: &str, pty_map: &PtyMap) -> Result<(), String> {
    let mut map = pty_map.lock().unwrap();
    let handle = map
        .get_mut(branch_name)
        .ok_or_else(|| format!("No PTY for branch '{branch_name}'"))?;
    handle.write_input(data.as_bytes())
}

pub fn resize_pty(branch_name: &str, cols: u16, rows: u16, pty_map: &PtyMap) -> Result<(), String> {
    let map = pty_map.lock().unwrap();
    let handle = map
        .get(branch_name)
        .ok_or_else(|| format!("No PTY for branch '{branch_name}'"))?;
    handle.resize(cols, rows)
}
