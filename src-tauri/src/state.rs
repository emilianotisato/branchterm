use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchEntry {
    pub name: String,
    pub parent_branch: String,
    pub workspace_path: String,
    #[serde(default)]
    pub startup_command: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub project_path: String,
    pub branches: Vec<BranchEntry>,
}

impl AppState {
    pub fn empty(project_path: &Path) -> Self {
        AppState {
            project_path: project_path.to_string_lossy().to_string(),
            branches: vec![],
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
    serde_json::from_str(&content)
        .map_err(|e| format!("Corrupt state.json ({}): {e}", path.display()))
}

pub fn save_state(slug: &str, state: &AppState) -> Result<(), String> {
    let path = state_path(slug);
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create state dir: {e}"))?;

    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize state: {e}"))?;

    // Atomic write: write to tmp then rename
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
            branches: vec![BranchEntry {
                name: "feature-x".to_string(),
                parent_branch: "main".to_string(),
                workspace_path: "/tmp/workspace".to_string(),
                startup_command: Some("claude".to_string()),
                created_at: "2026-06-03T10:00:00Z".to_string(),
            }],
        };
        let json = serde_json::to_string(&state).unwrap();
        let parsed: AppState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.branches.len(), 1);
        assert_eq!(parsed.branches[0].name, "feature-x");
        assert_eq!(
            parsed.branches[0].startup_command,
            Some("claude".to_string())
        );
    }

    #[test]
    fn empty_state_has_no_branches() {
        let state = AppState::empty(&PathBuf::from("/home/user/proj"));
        assert_eq!(state.branches.len(), 0);
        assert_eq!(state.project_path, "/home/user/proj");
    }

    #[test]
    fn corrupt_json_returns_error() {
        // Just verify the error path would produce a readable message
        let result: Result<AppState, _> = serde_json::from_str("not json");
        assert!(result.is_err());
    }
}
