use std::path::PathBuf;

mod boot;
mod commands;
mod context;
mod state;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(project_path: PathBuf) {
    if let Err(e) = boot::check_btrfs(&project_path) {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }

    let slug = boot::slugify(&project_path);

    let app_state = match state::load_state(&slug, &project_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Error loading state: {e}");
            std::process::exit(1);
        }
    };

    let ctx = context::AppContext::new(project_path, slug, app_state);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ctx)
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::new_branch,
            commands::set_startup_command,
            commands::delete_branch_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
