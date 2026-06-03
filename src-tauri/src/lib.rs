use std::path::PathBuf;

mod boot;
mod state;

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(std::sync::Mutex::new(app_state))
        .setup(move |_app| Ok(()))
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
