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
use std::sync::Once;

mod watcher;
mod workspace;

static DAEMON_ENSURE: Once = Once::new();

/// Base Command for the CLI, with `MSW_VFS_CLIENT=viewer` set so the daemon
/// can tell viewer-originated calls apart from AI/terminal ones. Recording
/// gate (P-AI0-2+) will skip `viewer` calls by default.
fn cli_command() -> Command {
    let mut cmd = if let Some(cli) = resolve_cli() {
        let mut c = Command::new("node");
        c.arg(cli);
        c
    } else {
        Command::new("msw-vfs")
    };
    cmd.env("MSW_VFS_CLIENT", "viewer");
    cmd
}

/// Ensure the msw-vfs daemon is running. Called once per viewer session
/// before the first RPC that benefits from a shared cache. Best-effort:
/// failures are silent — callers fall back to local parsing per the
/// existing proxy-miss contract in cli.ts.
fn ensure_daemon() {
    DAEMON_ENSURE.call_once(|| {
        // Probe status.
        let status = cli_command().arg("status").output();
        let alive = matches!(status, Ok(o) if o.status.success());
        if alive {
            return;
        }
        // Launch detached daemon; it backgrounds itself and writes
        // ~/.msw-vfs/daemon.json before this call returns (up to ~3s).
        let _ = cli_command()
            .arg("daemon")
            .arg("--detach")
            .arg("--quiet")
            .output();
    });
}

#[derive(serde::Serialize)]
struct VfsError {
    message: String,
}

impl From<String> for VfsError {
    fn from(message: String) -> Self {
        Self { message }
    }
}

#[tauri::command]
fn scan_workspace(root: String) -> Result<workspace::WorkspaceManifest, VfsError> {
    workspace::scan(Path::new(&root)).map_err(|e| e.into())
}

#[derive(serde::Serialize)]
struct ConfigReadPayload {
    config: workspace::WorkspaceConfig,
    /// True when the returned config was loaded from .msw-viewer.json (vs
    /// defaults).
    from_file: bool,
}

#[tauri::command]
fn read_workspace_config(root: String) -> Result<ConfigReadPayload, VfsError> {
    let root_abs = PathBuf::from(&root)
        .canonicalize()
        .map_err(|e| format!("cannot resolve '{}': {}", root, e))?;
    let (config, from_file) = workspace::WorkspaceConfig::load_or_default(&root_abs);
    Ok(ConfigReadPayload { config, from_file })
}

#[tauri::command]
fn write_workspace_config(
    root: String,
    config: workspace::WorkspaceConfig,
) -> Result<(), VfsError> {
    let root_abs = PathBuf::from(&root)
        .canonicalize()
        .map_err(|e| format!("cannot resolve '{}': {}", root, e))?;
    config.save(&root_abs).map_err(|e| e.into())
}

#[tauri::command]
fn default_workspace_config() -> workspace::WorkspaceConfig {
    workspace::WorkspaceConfig::default_config()
}

#[tauri::command]
fn start_workspace_watch(
    root: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, watcher::WatcherState>,
) -> Result<(), VfsError> {
    let abs = PathBuf::from(&root)
        .canonicalize()
        .map_err(|e| format!("cannot resolve '{}': {}", root, e))?;
    state.watch(abs, app).map_err(|e| e.into())
}

#[tauri::command]
fn stop_workspace_watch(state: tauri::State<'_, watcher::WatcherState>) {
    state.stop();
}

#[derive(serde::Serialize)]
struct TextFilePayload {
    text: String,
    /// Actual size of the file on disk, in bytes, before truncation.
    size: u64,
    /// True when the file exceeded `max_bytes` and only the head was read.
    truncated: bool,
}

/// Reads a file as UTF-8 text, capped at `max_bytes` bytes. Lossy decode
/// keeps binary garbage from aborting the read — the viewer shows it
/// verbatim so the user can at least see what's there.
#[tauri::command]
fn read_text_file(
    path: String,
    max_bytes: Option<u64>,
) -> Result<TextFilePayload, VfsError> {
    use std::io::Read;
    let cap = max_bytes.unwrap_or(1_048_576); // 1 MiB default
    let p = Path::new(&path);
    let md = std::fs::metadata(p)
        .map_err(|e| format!("stat '{path}': {e}"))?;
    let size = md.len();
    let mut f = std::fs::File::open(p).map_err(|e| format!("open '{path}': {e}"))?;
    let read_len = size.min(cap) as usize;
    let mut buf = vec![0u8; read_len];
    f.read_exact(&mut buf)
        .map_err(|e| format!("read '{path}': {e}"))?;
    Ok(TextFilePayload {
        text: String::from_utf8_lossy(&buf).into_owned(),
        size,
        truncated: size > cap,
    })
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
    ensure_daemon();

    let output = cli_command()
        .arg(file)
        .args(args)
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

#[derive(serde::Serialize)]
struct DaemonMetaPayload {
    host: String,
    port: u16,
    version: String,
}

/// Read the daemon lockfile and return its host/port. Ensures the daemon
/// is up first (auto-spawns via `daemon --detach`). The frontend needs
/// this to open the /events SSE stream.
#[tauri::command]
fn vfs_daemon_meta() -> Result<DaemonMetaPayload, VfsError> {
    ensure_daemon();
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "cannot locate home directory".to_string())?;
    let path = Path::new(&home).join(".msw-vfs").join("daemon.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("read {}: {}", path.display(), e))?;
    #[derive(serde::Deserialize)]
    struct DaemonFile {
        host: String,
        port: u16,
        version: String,
    }
    let f: DaemonFile =
        serde_json::from_str(&text).map_err(|e| format!("parse daemon.json: {e}"))?;
    Ok(DaemonMetaPayload {
        host: f.host,
        port: f.port,
        version: f.version,
    })
}

#[tauri::command]
fn vfs_cli_version() -> Result<String, VfsError> {
    // --version short-circuits before any daemon interaction.
    let output = cli_command()
        .arg("--version")
        .output()
        .map_err(|e| format!("failed to spawn msw-vfs: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "msw-vfs --version exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
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

/// Layer 2 — child entities under a path. Skips component files and
/// _entity.json; returns only entity directories as descriptors.
#[tauri::command]
fn vfs_list_entities(
    path: String,
    subpath: Option<String>,
    recursive: Option<bool>,
) -> Result<serde_json::Value, VfsError> {
    let sub = subpath.unwrap_or_else(|| "/".into());
    let mut args: Vec<&str> = vec!["list-entities", &sub, "--json"];
    if recursive.unwrap_or(false) {
        args.push("-r");
    }
    let stdout = run_cli(&path, &args)?;
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("parse list-entities: {e}").into())
}

/// Layer 2 — bundle one entity: metadata + all components keyed by @type.
#[tauri::command]
fn vfs_read_entity(
    path: String,
    subpath: String,
    deep: Option<bool>,
) -> Result<serde_json::Value, VfsError> {
    let mut args: Vec<&str> = vec!["read-entity", &subpath];
    if deep.unwrap_or(false) {
        args.push("--deep");
    }
    let stdout = run_cli(&path, &args)?;
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("parse read-entity: {e}").into())
}

/// Layer 2 — edit a component value by (entity path, @type). Safer than
/// `vfs_edit` when the caller thinks in entity units.
#[tauri::command]
fn vfs_edit_component(
    path: String,
    entity_path: String,
    type_name: String,
    patch: std::collections::HashMap<String, serde_json::Value>,
) -> Result<serde_json::Value, VfsError> {
    if patch.is_empty() {
        return Err("patch is empty".to_string().into());
    }
    let mut args: Vec<String> = vec![
        "edit-component".into(),
        entity_path,
        type_name,
    ];
    for (k, v) in &patch {
        args.push("--set".into());
        args.push(format!("{}={}", k, serde_json::to_string(v).unwrap()));
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let stdout = run_cli(&path, &arg_refs)?;
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("parse edit-component: {e}\n--- stdout ---\n{stdout}").into())
}

/// .model — list Values[] as JSON.
#[tauri::command]
fn vfs_model_values(path: String) -> Result<serde_json::Value, VfsError> {
    let stdout = run_cli(&path, &["list", "--json"])?;
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("parse model values: {e}").into())
}

/// Layer 2 — edit entity metadata (enable / visible / name / …).
#[tauri::command]
fn vfs_edit_entity(
    path: String,
    entity_path: String,
    patch: std::collections::HashMap<String, serde_json::Value>,
) -> Result<serde_json::Value, VfsError> {
    if patch.is_empty() {
        return Err("patch is empty".to_string().into());
    }
    let mut args: Vec<String> = vec!["edit-entity".into(), entity_path];
    for (k, v) in &patch {
        args.push("--set".into());
        args.push(format!("{}={}", k, serde_json::to_string(v).unwrap()));
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let stdout = run_cli(&path, &arg_refs)?;
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("parse edit-entity: {e}\n--- stdout ---\n{stdout}").into())
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
        .manage(watcher::WatcherState::new())
        .invoke_handler(tauri::generate_handler![
            vfs_cli_version,
            vfs_daemon_meta,
            scan_workspace,
            read_workspace_config,
            write_workspace_config,
            default_workspace_config,
            start_workspace_watch,
            stop_workspace_watch,
            read_text_file,
            vfs_summary,
            vfs_tree,
            vfs_ls,
            vfs_read,
            vfs_edit,
            vfs_list_entities,
            vfs_read_entity,
            vfs_edit_component,
            vfs_edit_entity,
            vfs_model_values,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
