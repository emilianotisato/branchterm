use std::path::Path;
use std::process::Command;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MergeOutcome {
    WorkspaceDirty,
    NothingToMerge,
    ParentDrift { current_branch: String },
    Conflict { git_output: String },
    Success { commits_merged: usize, main_was_dirty: bool },
}

pub fn run_merge(
    project_path: &Path,
    workspace_path: &Path,
    branch_name: &str,
    target_branch: &str,
    checkout_first: bool,
    ignore_drift: bool,
) -> Result<MergeOutcome, String> {
    // 1. Workspace dirty check — uncommitted changes won't be in the merge
    if is_dirty(workspace_path)? {
        return Ok(MergeOutcome::WorkspaceDirty);
    }

    // 2. Fetch workspace commits into FETCH_HEAD (read-only, no working tree change)
    let fetch = Command::new("git")
        .args([
            "-C", &project_path.to_string_lossy(),
            "fetch", &workspace_path.to_string_lossy(), branch_name,
        ])
        .output()
        .map_err(|e| format!("git fetch failed: {e}"))?;

    if !fetch.status.success() {
        return Err(format!(
            "git fetch failed: {}",
            String::from_utf8_lossy(&fetch.stderr)
        ));
    }

    // 3. Nothing to merge check
    let rev_count = Command::new("git")
        .args(["-C", &project_path.to_string_lossy(), "rev-list", "FETCH_HEAD", "^HEAD", "--count"])
        .output()
        .map_err(|e| format!("git rev-list failed: {e}"))?;

    let count: usize = String::from_utf8_lossy(&rev_count.stdout)
        .trim()
        .parse()
        .unwrap_or(0);

    if count == 0 {
        return Ok(MergeOutcome::NothingToMerge);
    }

    // 4. Drift check
    if !ignore_drift {
        let current = current_branch(project_path)?;
        if current != target_branch {
            if checkout_first {
                let co = Command::new("git")
                    .args(["-C", &project_path.to_string_lossy(), "checkout", target_branch])
                    .output()
                    .map_err(|e| format!("git checkout failed: {e}"))?;
                if !co.status.success() {
                    return Err(format!(
                        "git checkout {} failed: {}",
                        target_branch,
                        String::from_utf8_lossy(&co.stderr)
                    ));
                }
            } else {
                return Ok(MergeOutcome::ParentDrift { current_branch: current });
            }
        }
    }

    // 5. Main dirty check (warn-only — record but proceed)
    let main_was_dirty = is_dirty(project_path)?;

    // 6. Merge
    let merge = Command::new("git")
        .args(["-C", &project_path.to_string_lossy(), "merge", "FETCH_HEAD", "--no-edit"])
        .output()
        .map_err(|e| format!("git merge failed: {e}"))?;

    if !merge.status.success() {
        let git_output = format!(
            "{}{}",
            String::from_utf8_lossy(&merge.stdout),
            String::from_utf8_lossy(&merge.stderr)
        );
        return Ok(MergeOutcome::Conflict { git_output });
    }

    // Count commits merged
    let log = Command::new("git")
        .args(["-C", &project_path.to_string_lossy(), "log", "--oneline", "ORIG_HEAD..HEAD"])
        .output()
        .map_err(|e| format!("git log failed: {e}"))?;

    let commits_merged = String::from_utf8_lossy(&log.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .count();

    Ok(MergeOutcome::Success { commits_merged, main_was_dirty })
}

pub fn get_branches(project_path: &Path) -> Result<Vec<String>, String> {
    let out = Command::new("git")
        .args(["-C", &project_path.to_string_lossy(), "branch"])
        .output()
        .map_err(|e| format!("git branch failed: {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "git branch failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let branches = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim_start_matches("* ").trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(branches)
}

fn is_dirty(path: &Path) -> Result<bool, String> {
    let out = Command::new("git")
        .args(["-C", &path.to_string_lossy(), "status", "--porcelain"])
        .output()
        .map_err(|e| format!("git status failed: {e}"))?;
    Ok(!out.stdout.is_empty())
}

pub fn current_branch(path: &Path) -> Result<String, String> {
    let out = Command::new("git")
        .args(["-C", &path.to_string_lossy(), "branch", "--show-current"])
        .output()
        .map_err(|e| format!("git branch --show-current failed: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
