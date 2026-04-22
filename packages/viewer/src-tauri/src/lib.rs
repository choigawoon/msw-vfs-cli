// MSW VFS Viewer — Tauri entry point.
//
// Bridges the React UI to the @choigawoon/msw-vfs-cli Node package by
// spawning `node <cli.js> <file> <subcmd>` and parsing its stdout.
// CLI location resolution order:
//   1. MSW_VFS_CLI env var (absolute path to bin/cli.js)
//   2. Dev fallback: CARGO_MANIFEST_DIR/../../cli/bin/cli.js
//   3. Bare `msw-vfs` on PATH (expects `npm link` or a global install)
//
// Production packaging will replace (2)/(3) with a Tauri sidecar.

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(serde::Serialize)]
struct VfsError {
    message: String,
}

impl From<String> for VfsError {
    fn from(message: String) -> Self {
        Self { message }
    }
}

fn resolve_cli() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MSW_VFS_CLI") {
        let buf = PathBuf::from(p);
        if buf.exists() {
            return Some(buf);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("cli")
        .join("bin")
        .join("cli.js");
    if dev.exists() {
        return Some(dev);
    }
    None
}

fn run_cli(file: &str, args: &[&str]) -> Result<String, String> {
    // Bypass the daemon so each call is self-contained.
    let env = [("MSW_VFS_NO_DAEMON", "1")];

    let mut cmd = if let Some(cli) = resolve_cli() {
        let mut c = Command::new("node");
        c.arg(cli);
        c
    } else {
        Command::new("msw-vfs")
    };

    let output = cmd
        .arg(file)
        .args(args)
        .envs(env.iter().cloned())
        .output()
        .map_err(|e| format!("failed to spawn msw-vfs: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "msw-vfs exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn vfs_summary(path: String) -> Result<serde_json::Value, VfsError> {
    let stdout = run_cli(&path, &["summary"])?;
    serde_json::from_str(&stdout).map_err(|e| format!("parse error: {e}").into())
}

#[tauri::command]
fn vfs_tree(path: String, depth: Option<i32>) -> Result<String, VfsError> {
    let d = depth.map(|n| n.to_string());
    let mut args: Vec<&str> = vec!["tree"];
    if let Some(ref s) = d {
        args.push("-d");
        args.push(s);
    }
    Ok(run_cli(&path, &args)?)
}

#[tauri::command]
fn vfs_ls(
    path: String,
    subpath: Option<String>,
) -> Result<serde_json::Value, VfsError> {
    let sub = subpath.unwrap_or_else(|| "/".into());
    let stdout = run_cli(&path, &["ls", &sub, "-l", "--json"])?;
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("parse ls items: {e}").into())
}

#[tauri::command]
fn vfs_read(path: String, subpath: String) -> Result<serde_json::Value, VfsError> {
    let stdout = run_cli(&path, &["read", &subpath, "--raw", "--json"])?;
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("parse read content: {e}").into())
}

/// Patch values inside an asset file.
///   - If `subpath` ends with `_entity.json`, uses `edit-entity <entityDir>`
///     so entity-level fields (enable, visible, name, displayOrder, …) land
///     correctly.
///   - Otherwise uses `edit <subpath>` (component/arbitrary path).
/// Each (key, value) pair becomes one `--set key=<json-value>` arg.
#[tauri::command]
fn vfs_edit(
    path: String,
    subpath: String,
    patch: std::collections::HashMap<String, serde_json::Value>,
) -> Result<serde_json::Value, VfsError> {
    if patch.is_empty() {
        return Err("patch is empty".to_string().into());
    }

    // Path mapping for entity metadata writes.
    let (cmd, target) = if subpath.ends_with("_entity.json") {
        let entity_dir = subpath
            .trim_end_matches("_entity.json")
            .trim_end_matches('/');
        ("edit-entity", entity_dir.to_string())
    } else {
        ("edit", subpath.clone())
    };

    let mut args: Vec<String> = vec![cmd.to_string(), target];
    for (k, v) in &patch {
        args.push("--set".into());
        args.push(format!("{}={}", k, serde_json::to_string(v).unwrap()));
    }

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let stdout = run_cli(&path, &arg_refs)?;
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("parse edit result: {e}\n--- stdout ---\n{stdout}").into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            vfs_summary,
            vfs_tree,
            vfs_ls,
            vfs_read,
            vfs_edit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
