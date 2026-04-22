// Prevent the console window from appearing on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    msw_vfs_viewer_lib::run();
}
