// MSW VFS Viewer — Tauri entry point.
//
// Commands wired here will be exposed to the React side via
// invoke("<command>", { ... }). VFS integration lands in a follow-up commit.

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
