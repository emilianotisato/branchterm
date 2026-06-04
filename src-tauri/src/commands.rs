use serde::{Deserialize, Serialize};
use tauri::State;
use std::time::SystemTime;

use crate::commands_store::{self, FreqCommand};
use crate::context::AppContext;
use crate::merge::{self, MergeOutcome};
use crate::pty::{self, PtyMap};
use crate::state::{self, AppState, BranchEntry, TabEntry};
use crate::workspace;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub parent_branch: String,
    pub workspace_path: String,
    pub created_at: String,
    pub tabs: Vec<TabEntry>,
}

impl From<&BranchEntry> for BranchInfo {
    fn from(e: &BranchEntry) -> Self {
        BranchInfo {
            name: e.name.clone(),
            parent_branch: e.parent_branch.clone(),
            workspace_path: e.workspace_path.clone(),
            created_at: e.created_at.clone(),
            tabs: e.tabs.clone(),
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

    let default_tab = TabEntry {
        id: state::new_tab_id(),
        title: "Shell".to_string(),
        startup_command: None,
        autostart: true,
    };

    let entry = BranchEntry {
        name: name.clone(),
        parent_branch: info.parent_branch.clone(),
        workspace_path: info.workspace_path.to_string_lossy().to_string(),
        created_at: iso8601_now(),
        tabs: vec![default_tab],
    };

    let branch_info = BranchInfo::from(&entry);

    {
        let mut s = ctx.state.lock().unwrap();
        s.branches.push(entry);
        state::save_state(&ctx.slug, &s)?;
    }

    Ok(branch_info)
}

/// Spawn a PTY for an existing tab (used on boot to reinitialize persisted tabs).
#[tauri::command]
pub async fn spawn_tab(
    branch: String,
    tab_id: String,
    app_handle: tauri::AppHandle,
    ctx: State<'_, AppContext>,
    pty_map: State<'_, PtyMap>,
) -> Result<(), String> {
    let (workspace_path, startup_command, autostart) = {
        let s = ctx.state.lock().unwrap();
        if branch == "__main__" {
            let tab = s
                .main_tabs
                .iter()
                .find(|t| t.id == tab_id)
                .ok_or_else(|| format!("Tab '{tab_id}' not found in main"))?;
            (ctx.project_path.clone(), tab.startup_command.clone(), tab.autostart)
        } else {
            let entry = s
                .branches
                .iter()
                .find(|b| b.name == branch)
                .ok_or_else(|| format!("Branch '{branch}' not found"))?;
            let tab = entry
                .tabs
                .iter()
                .find(|t| t.id == tab_id)
                .ok_or_else(|| format!("Tab '{tab_id}' not found in '{branch}'"))?;
            (
                std::path::PathBuf::from(&entry.workspace_path),
                tab.startup_command.clone(),
                tab.autostart,
            )
        }
    };

    pty::spawn_pty(tab_id, &workspace_path, startup_command, autostart, app_handle, &pty_map)
}

/// Create a new tab for a branch (or __main__), spawn its PTY, return the tab entry.
#[tauri::command]
pub async fn new_tab(
    branch: String,
    command: Option<String>,
    title: Option<String>,
    autostart: Option<bool>,
    app_handle: tauri::AppHandle,
    ctx: State<'_, AppContext>,
    pty_map: State<'_, PtyMap>,
) -> Result<TabEntry, String> {
    let autostart = autostart.unwrap_or(true);
    let tab_title = title.unwrap_or_else(|| {
        command
            .as_deref()
            .map(|c| if c.is_empty() { "Shell" } else { c })
            .unwrap_or("Shell")
            .to_string()
    });

    let tab = TabEntry {
        id: state::new_tab_id(),
        title: tab_title,
        startup_command: command.clone(),
        autostart,
    };

    let workspace_path = {
        let mut s = ctx.state.lock().unwrap();
        if branch == "__main__" {
            s.main_tabs.push(tab.clone());
            state::save_state(&ctx.slug, &s)?;
            ctx.project_path.clone()
        } else {
            let entry = s
                .branches
                .iter_mut()
                .find(|b| b.name == branch)
                .ok_or_else(|| format!("Branch '{branch}' not found"))?;
            entry.tabs.push(tab.clone());
            let path = std::path::PathBuf::from(&entry.workspace_path);
            state::save_state(&ctx.slug, &s)?;
            path
        }
    };

    pty::spawn_pty(
        tab.id.clone(),
        &workspace_path,
        tab.startup_command.clone(),
        tab.autostart,
        app_handle,
        &pty_map,
    )?;

    Ok(tab)
}

/// Close a tab: kill its PTY, remove from state. Errors if it's the last tab.
#[tauri::command]
pub async fn close_tab(
    branch: String,
    tab_id: String,
    ctx: State<'_, AppContext>,
    pty_map: State<'_, PtyMap>,
) -> Result<(), String> {
    {
        let mut s = ctx.state.lock().unwrap();

        let tab_count = if branch == "__main__" {
            s.main_tabs.len()
        } else {
            s.branches
                .iter()
                .find(|b| b.name == branch)
                .map(|b| b.tabs.len())
                .ok_or_else(|| format!("Branch '{branch}' not found"))?
        };

        if tab_count <= 1 {
            return Err("Cannot close the last terminal tab".to_string());
        }

        if branch == "__main__" {
            s.main_tabs.retain(|t| t.id != tab_id);
        } else if let Some(entry) = s.branches.iter_mut().find(|b| b.name == branch) {
            entry.tabs.retain(|t| t.id != tab_id);
        }

        state::save_state(&ctx.slug, &s)?;
    }

    pty::kill_pty(&tab_id, &pty_map);
    Ok(())
}

#[tauri::command]
pub async fn delete_branch_state(
    branch: String,
    ctx: State<'_, AppContext>,
    pty_map: State<'_, PtyMap>,
) -> Result<String, String> {
    let (workspace_path, tab_ids) = {
        let s = ctx.state.lock().unwrap();
        let entry = s
            .branches
            .iter()
            .find(|b| b.name == branch)
            .ok_or_else(|| format!("Branch '{branch}' not found in state"))?;
        let ids: Vec<String> = entry.tabs.iter().map(|t| t.id.clone()).collect();
        (entry.workspace_path.clone(), ids)
    };

    for tab_id in &tab_ids {
        pty::kill_pty(tab_id, &pty_map);
    }

    workspace::delete_workspace(std::path::Path::new(&workspace_path))?;

    {
        let mut s = ctx.state.lock().unwrap();
        s.branches.retain(|b| b.name != branch);
        state::save_state(&ctx.slug, &s)?;
    }

    Ok(workspace_path)
}

#[tauri::command]
pub async fn pty_input(
    tab_id: String,
    data: String,
    pty_map: State<'_, PtyMap>,
) -> Result<(), String> {
    pty::write_input(&tab_id, &data, &pty_map)
}

#[tauri::command]
pub async fn pty_resize(
    tab_id: String,
    cols: u16,
    rows: u16,
    pty_map: State<'_, PtyMap>,
) -> Result<(), String> {
    pty::resize_pty(&tab_id, cols, rows, &pty_map)
}

/// Inject a tab's startup_command into its running PTY (manual "run" trigger).
#[tauri::command]
pub async fn run_tab_command(
    tab_id: String,
    ctx: State<'_, AppContext>,
    pty_map: State<'_, PtyMap>,
) -> Result<(), String> {
    let cmd = {
        let s = ctx.state.lock().unwrap();
        s.main_tabs
            .iter()
            .chain(s.branches.iter().flat_map(|b| b.tabs.iter()))
            .find(|t| t.id == tab_id)
            .and_then(|t| t.startup_command.clone())
            .ok_or_else(|| format!("No startup command for tab '{tab_id}'"))?
    };
    // Open the gate before writing so PROMPT_COMMAND exit-code events get through
    pty::set_command_started(&tab_id, &pty_map);
    pty::write_input(&tab_id, &format!("{cmd}\n"), &pty_map)
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

#[tauri::command]
pub async fn get_project_branches(ctx: State<'_, AppContext>) -> Result<Vec<String>, String> {
    merge::get_branches(&ctx.project_path)
}

#[tauri::command]
pub async fn merge_branch(
    branch: String,
    target_branch: String,
    checkout_first: bool,
    ignore_drift: bool,
    ctx: State<'_, AppContext>,
) -> Result<MergeOutcome, String> {
    let workspace_path = {
        let s = ctx.state.lock().unwrap();
        let entry = s
            .branches
            .iter()
            .find(|b| b.name == branch)
            .ok_or_else(|| format!("Branch '{branch}' not found"))?;
        std::path::PathBuf::from(&entry.workspace_path)
    };

    merge::run_merge(
        &ctx.project_path,
        &workspace_path,
        &branch,
        &target_branch,
        checkout_first,
        ignore_drift,
    )
}

fn scratchpad_path(slug: &str) -> std::path::PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".local/share"));
    data_dir
        .join("branchterm")
        .join("scratchpads")
        .join(format!("{slug}.md"))
}

#[tauri::command]
pub async fn read_scratchpad(ctx: State<'_, AppContext>) -> Result<String, String> {
    let path = scratchpad_path(&ctx.slug);
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read scratchpad: {e}"))
}

#[tauri::command]
pub async fn write_scratchpad(content: String, ctx: State<'_, AppContext>) -> Result<(), String> {
    let path = scratchpad_path(&ctx.slug);
    std::fs::create_dir_all(path.parent().unwrap())
        .map_err(|e| format!("Failed to create scratchpad dir: {e}"))?;
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write scratchpad: {e}"))
}

fn iso8601_now() -> String {
    let s = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let sec = s % 60;
    let min = (s / 60) % 60;
    let hour = (s / 3600) % 24;
    let days = s / 86400;
    let (y, m, d) = days_to_date(days);
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
}

fn days_to_date(days: u64) -> (u64, u64, u64) {
    let mut y = 1970u64;
    let mut remaining = days;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let months = [
        31u64,
        if is_leap(y) { 29 } else { 28 },
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ];
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
