use std::path::{Path, PathBuf};
use std::process::Command;

pub struct WorkspaceInfo {
    pub name: String,
    pub parent_branch: String,
    pub workspace_path: PathBuf,
}

fn workspaces_dir(slug: &str, branch_name: &str) -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".local/share"));
    data_dir
        .join("branchterm")
        .join("workspaces")
        .join(format!("{slug}_{branch_name}"))
}

pub fn current_git_branch(project_path: &Path) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", &project_path.to_string_lossy(), "branch", "--show-current"])
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "git branch --show-current failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn is_git_repo(path: &Path) -> bool {
    Command::new("git")
        .args(["-C", &path.to_string_lossy(), "rev-parse", "--git-dir"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn create_workspace(
    project_path: &Path,
    branch_name: &str,
    slug: &str,
) -> Result<WorkspaceInfo, String> {
    validate_branch_name(branch_name)?;

    if !is_git_repo(project_path) {
        return Err(format!(
            "Not a git repository: {}. Run `git init` in your project first.",
            project_path.display()
        ));
    }

    let parent_branch = current_git_branch(project_path)?;
    let workspace_path = workspaces_dir(slug, branch_name);

    if workspace_path.exists() {
        return Err(format!(
            "Workspace for branch '{}' already exists at {}",
            branch_name,
            workspace_path.display()
        ));
    }

    // Create parent dir
    let parent = workspace_path.parent().unwrap();
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create workspaces dir: {e}"))?;

    // Btrfs CoW copy
    let cp_output = Command::new("cp")
        .args([
            "-a",
            "--reflink=always",
            &project_path.to_string_lossy(),
            &workspace_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("Failed to run cp: {e}"))?;

    if !cp_output.status.success() {
        return Err(format!(
            "CoW copy failed (is project on Btrfs?): {}",
            String::from_utf8_lossy(&cp_output.stderr)
        ));
    }

    // Create branch inside workspace
    let git_output = Command::new("git")
        .args([
            "-C",
            &workspace_path.to_string_lossy(),
            "checkout",
            "-b",
            branch_name,
        ])
        .output()
        .map_err(|e| format!("Failed to run git checkout -b: {e}"))?;

    if !git_output.status.success() {
        // Clean up workspace dir on failure
        let _ = std::fs::remove_dir_all(&workspace_path);
        return Err(format!(
            "git checkout -b failed: {}",
            String::from_utf8_lossy(&git_output.stderr)
        ));
    }

    Ok(WorkspaceInfo {
        name: branch_name.to_string(),
        parent_branch,
        workspace_path,
    })
}

pub fn delete_workspace(workspace_path: &Path) -> Result<(), String> {
    if !workspace_path.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(workspace_path)
        .map_err(|e| format!("Failed to remove workspace at {}: {e}", workspace_path.display()))
}

fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    if name.contains(' ') || name.contains('\t') {
        return Err("Branch name cannot contain spaces".to_string());
    }
    if name.contains("..") || name.starts_with('-') || name.ends_with('/') || name.ends_with(".lock") {
        return Err(format!("Invalid git branch name: '{name}'"));
    }
    if name.chars().any(|c| matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\')) {
        return Err(format!("Branch name contains invalid character: '{name}'"));
    }
    Ok(())
}
