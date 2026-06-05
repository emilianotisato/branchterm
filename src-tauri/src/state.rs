use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

static TAB_COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn new_tab_id() -> String {
    let ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let n = TAB_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{ms}{n:04}")
}

fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabEntry {
    pub id: String,
    pub title: String,
    pub startup_command: Option<String>,
    #[serde(default = "default_true")]
    pub autostart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchEntry {
    pub name: String,
    pub parent_branch: String,
    pub workspace_path: String,
    pub created_at: String,
    #[serde(default)]
    pub tabs: Vec<TabEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneState {
    pub id: String,
    pub active_tab_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanedViewState {
    pub id: String,
    pub panes: Vec<PaneState>,
    pub focused_pane_id: Option<String>,
    pub layout: Option<HashMap<String, f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ActiveViewState {
    Single { tab_id: Option<String> },
    Paned { view_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub project_path: String,
    pub branches: Vec<BranchEntry>,
    #[serde(default)]
    pub main_tabs: Vec<TabEntry>,
    #[serde(default)]
    pub paned_views: Vec<PanedViewState>,
    #[serde(default)]
    pub active_view: Option<ActiveViewState>,
}

// Used only for loading old-format JSON (has startupCommand per branch, no tabs)
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawBranchEntry {
    name: String,
    parent_branch: String,
    workspace_path: String,
    #[serde(default)]
    startup_command: Option<String>,
    created_at: String,
    #[serde(default)]
    tabs: Vec<TabEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAppState {
    project_path: String,
    branches: Vec<RawBranchEntry>,
    #[serde(default)]
    main_tabs: Vec<TabEntry>,
    #[serde(default)]
    paned_views: Vec<PanedViewState>,
    #[serde(default)]
    active_view: Option<ActiveViewState>,
}

fn default_shell_tab() -> TabEntry {
    TabEntry {
        id: new_tab_id(),
        title: "Shell".to_string(),
        startup_command: None,
        autostart: true,
    }
}

fn migrate(raw: RawAppState) -> AppState {
    let main_tabs = if raw.main_tabs.is_empty() {
        vec![default_shell_tab()]
    } else {
        raw.main_tabs
    };

    let branches = raw
        .branches
        .into_iter()
        .map(|b| {
            let tabs = if b.tabs.is_empty() {
                if let Some(cmd) = b.startup_command {
                    vec![TabEntry {
                        id: new_tab_id(),
                        title: cmd.clone(),
                        startup_command: Some(cmd),
                        autostart: true,
                    }]
                } else {
                    vec![default_shell_tab()]
                }
            } else {
                b.tabs
            };
            BranchEntry {
                name: b.name,
                parent_branch: b.parent_branch,
                workspace_path: b.workspace_path,
                created_at: b.created_at,
                tabs,
            }
        })
        .collect();

    AppState {
        project_path: raw.project_path,
        branches,
        main_tabs,
        paned_views: raw.paned_views,
        active_view: raw.active_view,
    }
}

impl AppState {
    pub fn empty(project_path: &Path) -> Self {
        AppState {
            project_path: project_path.to_string_lossy().to_string(),
            branches: vec![],
            main_tabs: vec![default_shell_tab()],
            paned_views: vec![],
            active_view: None,
        }
    }
}

fn state_path(slug: &str) -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".config"));
    config_dir
        .join("branchterm")
        .join("states")
        .join(format!("{slug}.json"))
}

pub fn load_state(slug: &str, project_path: &Path) -> Result<AppState, String> {
    let path = state_path(slug);

    if !path.exists() {
        let dir = path.parent().unwrap();
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create state dir: {e}"))?;
        let state = AppState::empty(project_path);
        save_state(slug, &state)?;
        return Ok(state);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read state file: {e}"))?;

    let raw: RawAppState = serde_json::from_str(&content)
        .map_err(|e| format!("Corrupt state.json ({}): {e}", path.display()))?;

    Ok(migrate(raw))
}

pub fn save_state(slug: &str, state: &AppState) -> Result<(), String> {
    let path = state_path(slug);
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create state dir: {e}"))?;

    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize state: {e}"))?;

    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &content)
        .map_err(|e| format!("Failed to write tmp state file: {e}"))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename state file: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn round_trip_state() {
        let state = AppState {
            project_path: "/home/user/test".to_string(),
            main_tabs: vec![TabEntry {
                id: "t1".to_string(),
                title: "Shell".to_string(),
                startup_command: None,
                autostart: true,
            }],
            branches: vec![BranchEntry {
                name: "feature-x".to_string(),
                parent_branch: "main".to_string(),
                workspace_path: "/tmp/workspace".to_string(),
                created_at: "2026-06-03T10:00:00Z".to_string(),
                tabs: vec![TabEntry {
                    id: "t2".to_string(),
                    title: "claude".to_string(),
                    startup_command: Some("claude".to_string()),
                    autostart: false,
                }],
            }],
            paned_views: vec![],
            active_view: None,
        };
        let json = serde_json::to_string(&state).unwrap();
        let parsed: AppState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.branches.len(), 1);
        assert_eq!(parsed.branches[0].name, "feature-x");
        assert_eq!(parsed.branches[0].tabs.len(), 1);
        assert_eq!(
            parsed.branches[0].tabs[0].startup_command,
            Some("claude".to_string())
        );
        assert_eq!(parsed.main_tabs.len(), 1);
    }

    #[test]
    fn empty_state_has_one_main_shell_tab() {
        let state = AppState::empty(&PathBuf::from("/home/user/proj"));
        assert_eq!(state.branches.len(), 0);
        assert_eq!(state.main_tabs.len(), 1);
        assert_eq!(state.main_tabs[0].title, "Shell");
        assert!(state.main_tabs[0].startup_command.is_none());
    }

    #[test]
    fn migration_old_format_startup_command() {
        let old_json = r#"{
            "projectPath": "/home/user/proj",
            "branches": [{
                "name": "feat",
                "parentBranch": "main",
                "workspacePath": "/tmp/feat",
                "startupCommand": "claude",
                "createdAt": "2026-06-03T10:00:00Z"
            }]
        }"#;
        let raw: RawAppState = serde_json::from_str(old_json).unwrap();
        let state = migrate(raw);
        assert_eq!(state.branches[0].tabs.len(), 1);
        assert_eq!(
            state.branches[0].tabs[0].startup_command,
            Some("claude".to_string())
        );
        assert_eq!(state.branches[0].tabs[0].title, "claude");
        assert_eq!(state.main_tabs.len(), 1); // default shell tab added
    }

    #[test]
    fn migration_old_format_no_startup_command() {
        let old_json = r#"{
            "projectPath": "/home/user/proj",
            "branches": [{
                "name": "feat",
                "parentBranch": "main",
                "workspacePath": "/tmp/feat",
                "createdAt": "2026-06-03T10:00:00Z"
            }]
        }"#;
        let raw: RawAppState = serde_json::from_str(old_json).unwrap();
        let state = migrate(raw);
        assert_eq!(state.branches[0].tabs[0].title, "Shell");
        assert!(state.branches[0].tabs[0].startup_command.is_none());
    }

    #[test]
    fn load_preserves_pane_layout() {
        let json = r#"{
            "projectPath": "/home/user/proj",
            "branches": [],
            "mainTabs": [{
                "id": "t1",
                "title": "Shell",
                "autostart": true
            }],
            "panedViews": [{
                "id": "view-1",
                "panes": [
                    {"id": "p1", "activeTabId": "t1"},
                    {"id": "p2", "activeTabId": "t2"}
                ],
                "focusedPaneId": "p2",
                "layout": {"p1": 40, "p2": 60}
            }],
            "activeView": {"type": "paned", "viewId": "view-1"}
        }"#;
        let raw: RawAppState = serde_json::from_str(json).unwrap();
        let state = migrate(raw);
        assert_eq!(state.paned_views.len(), 1);
        assert_eq!(state.paned_views[0].panes.len(), 2);
        assert_eq!(state.paned_views[0].focused_pane_id.as_deref(), Some("p2"));
        assert!(matches!(
            state.active_view,
            Some(ActiveViewState::Paned { view_id }) if view_id == "view-1"
        ));
    }

    #[test]
    fn corrupt_json_returns_error() {
        let result: Result<RawAppState, _> = serde_json::from_str("not json");
        assert!(result.is_err());
    }
}
