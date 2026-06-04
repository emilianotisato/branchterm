use std::path::PathBuf;

mod boot;
mod commands;
mod commands_store;
mod context;
mod pty;
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
    let pty_map = pty::new_pty_map();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ctx)
        .manage(pty_map)
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::new_branch,
            commands::delete_branch_state,
            commands::spawn_tab,
            commands::new_tab,
            commands::close_tab,
            commands::pty_input,
            commands::pty_resize,
            commands::run_tab_command,
            commands::get_commands,
            commands::save_command,
            commands::delete_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
