use serde::{Deserialize, Serialize};
use tauri::State;
use std::time::SystemTime;

use crate::commands_store::{self, FreqCommand};
use crate::context::AppContext;
use crate::pty::{self, PtyMap};
use crate::state::{self, AppState, BranchEntry};
use crate::workspace;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub parent_branch: String,
    pub workspace_path: String,
    pub startup_command: Option<String>,
    pub created_at: String,
}

impl From<&BranchEntry> for BranchInfo {
    fn from(e: &BranchEntry) -> Self {
        BranchInfo {
            name: e.name.clone(),
            parent_branch: e.parent_branch.clone(),
            workspace_path: e.workspace_path.clone(),
            startup_command: e.startup_command.clone(),
            created_at: e.created_at.clone(),
        }
    }
}

#[tauri::command]
pub async fn get_state(ctx: State<'_, AppContext>) -> Result<AppState, String> {
    Ok(ctx.state.lock().unwrap().clone())
}

#[tauri::command]
pub async fn new_branch(name: String, ctx: State<'_, AppContext>) -> Result<BranchInfo, String> {
    let info = workspace::create_workspace(&ctx.project_path, &name, &ctx.slug)?;

    let created_at = iso8601_now();
    let entry = BranchEntry {
        name: name.clone(),
        parent_branch: info.parent_branch.clone(),
        workspace_path: info.workspace_path.to_string_lossy().to_string(),
        startup_command: None,
        created_at,
    };

    let branch_info = BranchInfo::from(&entry);

    {
        let mut s = ctx.state.lock().unwrap();
        s.branches.push(entry);
        state::save_state(&ctx.slug, &s)?;
    }

    Ok(branch_info)
}

#[tauri::command]
pub async fn set_startup_command(
    branch: String,
    cmd: String,
    ctx: State<'_, AppContext>,
) -> Result<(), String> {
    let mut s = ctx.state.lock().unwrap();
    let entry = s.branches.iter_mut().find(|b| b.name == branch)
        .ok_or_else(|| format!("Branch '{branch}' not found"))?;
    entry.startup_command = if cmd.is_empty() { None } else { Some(cmd) };
    state::save_state(&ctx.slug, &s)
}

#[tauri::command]
pub async fn delete_branch_state(
    branch: String,
    ctx: State<'_, AppContext>,
    pty_map: State<'_, PtyMap>,
) -> Result<String, String> {
    let workspace_path = {
        let s = ctx.state.lock().unwrap();
        s.branches
            .iter()
            .find(|b| b.name == branch)
            .map(|b| b.workspace_path.clone())
            .ok_or_else(|| format!("Branch '{branch}' not found in state"))?
    };

    pty::kill_pty(&branch, &pty_map);
    workspace::delete_workspace(std::path::Path::new(&workspace_path))?;

    {
        let mut s = ctx.state.lock().unwrap();
        s.branches.retain(|b| b.name != branch);
        state::save_state(&ctx.slug, &s)?;
    }

    Ok(workspace_path)
}

#[tauri::command]
pub async fn spawn_main_pty(
    app_handle: tauri::AppHandle,
    ctx: State<'_, AppContext>,
    pty_map: State<'_, PtyMap>,
) -> Result<(), String> {
    pty::spawn_pty(
        "__main__".to_string(),
        &ctx.project_path,
        None,
        app_handle,
        &pty_map,
    )
}

#[tauri::command]
pub async fn spawn_pty(
    branch: String,
    app_handle: tauri::AppHandle,
    ctx: State<'_, AppContext>,
    pty_map: State<'_, PtyMap>,
) -> Result<(), String> {
    let (workspace_path, startup_command) = {
        let s = ctx.state.lock().unwrap();
        let entry = s
            .branches
            .iter()
            .find(|b| b.name == branch)
            .ok_or_else(|| format!("Branch '{branch}' not found"))?;
        (entry.workspace_path.clone(), entry.startup_command.clone())
    };

    pty::spawn_pty(
        branch,
        std::path::Path::new(&workspace_path),
        startup_command,
        app_handle,
        &pty_map,
    )
}

#[tauri::command]
pub async fn pty_input(
    branch: String,
    data: String,
    pty_map: State<'_, PtyMap>,
) -> Result<(), String> {
    pty::write_input(&branch, &data, &pty_map)
}

#[tauri::command]
pub async fn pty_resize(
    branch: String,
    cols: u16,
    rows: u16,
    pty_map: State<'_, PtyMap>,
) -> Result<(), String> {
    pty::resize_pty(&branch, cols, rows, &pty_map)
}

#[tauri::command]
pub async fn get_commands() -> Result<Vec<FreqCommand>, String> {
    commands_store::load()
}

#[tauri::command]
pub async fn save_command(label: String, cmd: String) -> Result<FreqCommand, String> {
    commands_store::add(label, cmd)
}

#[tauri::command]
pub async fn delete_command(id: String) -> Result<(), String> {
    commands_store::remove(&id)
}

fn iso8601_now() -> String {
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Format as basic ISO 8601: YYYY-MM-DDTHH:MM:SSZ
    let s = secs;
    let sec = s % 60;
    let min = (s / 60) % 60;
    let hour = (s / 3600) % 24;
    let days = s / 86400;
    // Days since epoch to date (simple, good enough for a timestamp)
    let (y, m, d) = days_to_date(days);
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
}

fn days_to_date(days: u64) -> (u64, u64, u64) {
    let mut y = 1970u64;
    let mut remaining = days;
    loop {
        let leap = is_leap(y);
        let days_in_year = if leap { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let months = [31u64, if is_leap(y) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 1u64;
    for days_in_month in months {
        if remaining < days_in_month {
            break;
        }
        remaining -= days_in_month;
        m += 1;
    }
    (y, m, remaining + 1)
}

fn is_leap(y: u64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}
