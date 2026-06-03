// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let project_path = if args.len() > 1 {
        args[1].clone()
    } else {
        ".".to_string()
    };

    let project_path = std::fs::canonicalize(&project_path)
        .unwrap_or_else(|_| std::path::PathBuf::from(&project_path));

    branchterm_lib::run(project_path);
}
