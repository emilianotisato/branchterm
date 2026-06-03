use std::path::PathBuf;
use std::sync::Mutex;
use crate::state::AppState;

pub struct AppContext {
    pub project_path: PathBuf,
    pub slug: String,
    pub state: Mutex<AppState>,
}

impl AppContext {
    pub fn new(project_path: PathBuf, slug: String, state: AppState) -> Self {
        AppContext {
            project_path,
            slug,
            state: Mutex::new(state),
        }
    }
}
