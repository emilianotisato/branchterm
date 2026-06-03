use std::os::unix::fs::MetadataExt;
use std::path::Path;

#[derive(Debug)]
pub enum BootError {
    NotBtrfs { proj_dev: u64, share_dev: u64 },
    Io(std::io::Error),
}

impl std::fmt::Display for BootError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BootError::NotBtrfs { proj_dev, share_dev } => write!(
                f,
                "branchterm requires both the project directory and ~/.local/share/ \
                 to be on the same Btrfs filesystem (needed for instant CoW branch copies).\n\
                 Project device: {proj_dev}, ~/.local/share device: {share_dev}\n\
                 Please run branchterm from a directory on your Btrfs partition."
            ),
            BootError::Io(e) => write!(f, "IO error during boot check: {e}"),
        }
    }
}

impl From<std::io::Error> for BootError {
    fn from(e: std::io::Error) -> Self {
        BootError::Io(e)
    }
}

/// Verifies project_path and ~/.local/share are on the same filesystem device.
/// Returns Err if they differ (non-Btrfs or separate mounts).
pub fn check_btrfs(project_path: &Path) -> Result<(), BootError> {
    let proj_dev = std::fs::metadata(project_path)?.dev();
    let share_dir = dirs::data_local_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("/"))
            .join(".local/share")
    });
    let share_dev = std::fs::metadata(&share_dir)?.dev();
    if proj_dev != share_dev {
        return Err(BootError::NotBtrfs { proj_dev, share_dev });
    }
    Ok(())
}

/// Converts an absolute path to a safe filesystem slug.
/// /home/user/my project → home_user_my_project
pub fn slugify(path: &Path) -> String {
    let s = path.to_string_lossy();
    let slug: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    // Collapse consecutive underscores and strip leading/trailing
    let mut result = String::new();
    let mut prev_underscore = true; // start true to strip leading underscores
    for c in slug.chars() {
        if c == '_' {
            if !prev_underscore {
                result.push('_');
                prev_underscore = true;
            }
        } else {
            result.push(c);
            prev_underscore = false;
        }
    }
    // Strip trailing underscore
    if result.ends_with('_') {
        result.pop();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn slugify_normal_path() {
        assert_eq!(
            slugify(&PathBuf::from("/home/user/projects/webapp")),
            "home_user_projects_webapp"
        );
    }

    #[test]
    fn slugify_spaces() {
        assert_eq!(
            slugify(&PathBuf::from("/home/user/my project")),
            "home_user_my_project"
        );
    }

    #[test]
    fn slugify_special_chars() {
        assert_eq!(
            slugify(&PathBuf::from("/home/user/my-app.v2")),
            "home_user_my_app_v2"
        );
    }

    #[test]
    fn slugify_no_leading_underscore() {
        let result = slugify(&PathBuf::from("/home"));
        assert!(!result.starts_with('_'));
    }

    #[test]
    fn slugify_no_trailing_underscore() {
        let result = slugify(&PathBuf::from("/home/user/"));
        assert!(!result.ends_with('_'));
    }

    #[test]
    fn slugify_no_consecutive_underscores() {
        let result = slugify(&PathBuf::from("/home/user//projects"));
        assert!(!result.contains("__"));
    }
}
