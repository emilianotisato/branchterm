use std::path::PathBuf;

mod boot;
mod commands;
mod commands_store;
mod context;
mod merge;
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
    let pty_map_for_window_close = pty_map.clone();
    let pty_map_for_exit = pty_map.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ctx)
        .manage(pty_map)
        .setup(|_app| Ok(()))
        .on_window_event(move |_window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                pty::kill_all_pty(&pty_map_for_window_close);
            }
        })
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
            commands::read_scratchpad,
            commands::write_scratchpad,
            commands::get_project_branches,
            commands::merge_branch,
            commands::get_current_branch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            pty::kill_all_pty(&pty_map_for_exit);
        }
    });
}
