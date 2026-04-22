// Workspace scanner — P3.5a-1 (minimal, no watcher, no settings).
//
// Given a folder the user picked, decide whether it's an MSW project root
// and enumerate the asset files the viewer can open, grouped by role.
//
// Root detection rules:
//   valid        — Environment/NativeScripts/ OR Environment/config exists
//   partial      — no Environment marker, but at least one of map/ ui/ Global/
//   scripts-only — no MSW markers at all, but the picked path looks like a
//                  scripts drop (last component matches MyDesk or scripts)
//   invalid      — none of the above; command returns an error
//
// Extension whitelists per folder (hardcoded for P3.5a-1; settings UI +
// .msw-viewer.json override lands in P3.5a-4):
//
//   map/             → .map                        (shallow)
//   ui/              → .ui                         (shallow)
//   Global/          → .gamelogic .model           (shallow)
//   RootDesk/MyDesk/ → .mlua .model .csv           (recursive)
//
// Files found outside these roots are ignored to keep the sidebar signal
// high. Users with unusual layouts get partial-root warnings.

use std::path::Path;

use serde::Serialize;
use walkdir::WalkDir;

const HARD_CAP_ENTRIES_PER_GROUP: usize = 5000;

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceStatus {
    Valid,
    Partial,
    ScriptsOnly,
    Invalid,
}

#[derive(Serialize)]
pub struct FileEntry {
    pub abs_path: String,
    pub rel_path: String,
    pub name: String,
    pub size: u64,
    pub readonly: bool,
    pub in_global: bool,
    pub in_mydesk: bool,
}

#[derive(Serialize, Default)]
pub struct Groups {
    pub maps: Vec<FileEntry>,
    pub uis: Vec<FileEntry>,
    pub gamelogic: Vec<FileEntry>,
    pub models: Vec<FileEntry>,
    pub scripts: Vec<FileEntry>,
    pub datasets: Vec<FileEntry>,
}

#[derive(Serialize)]
pub struct WorkspaceManifest {
    pub root: String,
    pub status: WorkspaceStatus,
    pub warnings: Vec<String>,
    pub groups: Groups,
}

pub fn scan(root: &Path) -> Result<WorkspaceManifest, String> {
    let root_abs = root
        .canonicalize()
        .map_err(|e| format!("cannot resolve '{}': {}", root.display(), e))?;
    if !root_abs.is_dir() {
        return Err(format!("'{}' is not a directory", root_abs.display()));
    }

    let status = classify_root(&root_abs);
    let mut warnings = Vec::new();
    let mut groups = Groups::default();

    match status {
        WorkspaceStatus::Invalid => {
            return Err(format!(
                "'{}' doesn't look like an MSW project (no Environment/, map/, ui/, Global/, or scripts folder). Pick a folder that contains Environment/NativeScripts/ or map/ui/Global/ at its root.",
                root_abs.display()
            ));
        }
        WorkspaceStatus::Partial => {
            warnings.push(
                "Environment/ not found — this may be a partial MSW project. mlua-lsp features may not work.".into(),
            );
        }
        WorkspaceStatus::ScriptsOnly => {
            warnings.push(
                "Scripts-only view — no map/ui/Global/ at this root. Open a full project root for the complete sidebar.".into(),
            );
        }
        WorkspaceStatus::Valid => {}
    }

    // Shallow scans first (asset containers).
    collect_shallow(&root_abs, "map", &[".map"], &mut groups.maps, &mut warnings);
    collect_shallow(&root_abs, "ui", &[".ui"], &mut groups.uis, &mut warnings);
    collect_shallow(
        &root_abs,
        "Global",
        &[".gamelogic"],
        &mut groups.gamelogic,
        &mut warnings,
    );
    collect_shallow(
        &root_abs,
        "Global",
        &[".model"],
        &mut groups.models,
        &mut warnings,
    );

    // RootDesk/MyDesk is where creators nest freely — recursive.
    let mydesk = root_abs.join("RootDesk").join("MyDesk");
    if mydesk.is_dir() {
        collect_recursive(
            &root_abs,
            &mydesk,
            &[".model"],
            &mut groups.models,
            &mut warnings,
        );
        collect_recursive(
            &root_abs,
            &mydesk,
            &[".mlua"],
            &mut groups.scripts,
            &mut warnings,
        );
        collect_recursive(
            &root_abs,
            &mydesk,
            &[".csv"],
            &mut groups.datasets,
            &mut warnings,
        );
    } else if matches!(status, WorkspaceStatus::ScriptsOnly) {
        // Scripts-only: the picked folder *is* the scripts root.
        collect_recursive(
            &root_abs,
            &root_abs,
            &[".model"],
            &mut groups.models,
            &mut warnings,
        );
        collect_recursive(
            &root_abs,
            &root_abs,
            &[".mlua"],
            &mut groups.scripts,
            &mut warnings,
        );
        collect_recursive(
            &root_abs,
            &root_abs,
            &[".csv"],
            &mut groups.datasets,
            &mut warnings,
        );
    }

    // Sort every group by rel_path for a stable UI.
    for g in [
        &mut groups.maps,
        &mut groups.uis,
        &mut groups.gamelogic,
        &mut groups.models,
        &mut groups.scripts,
        &mut groups.datasets,
    ] {
        g.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    }

    Ok(WorkspaceManifest {
        root: root_abs.to_string_lossy().into_owned(),
        status,
        warnings,
        groups,
    })
}

fn classify_root(root: &Path) -> WorkspaceStatus {
    let has_env_ns = root.join("Environment").join("NativeScripts").is_dir();
    let has_env_config = root.join("Environment").join("config").exists();
    if has_env_ns || has_env_config {
        return WorkspaceStatus::Valid;
    }
    let has_map = root.join("map").is_dir();
    let has_ui = root.join("ui").is_dir();
    let has_global = root.join("Global").is_dir();
    if has_map || has_ui || has_global {
        return WorkspaceStatus::Partial;
    }
    // Scripts-only heuristic: the user picked a folder whose name suggests it
    // holds scripts, and it contains at least one .mlua or .model anywhere.
    let last = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let looks_like_scripts = last == "mydesk" || last == "scripts" || last.contains("script");
    if looks_like_scripts && has_any_ext(root, &[".mlua", ".model"], 20) {
        return WorkspaceStatus::ScriptsOnly;
    }
    WorkspaceStatus::Invalid
}

fn has_any_ext(root: &Path, exts: &[&str], max_probe: usize) -> bool {
    let mut seen = 0usize;
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        if ext_matches(entry.path(), exts) {
            return true;
        }
        seen += 1;
        if seen >= max_probe {
            return false;
        }
    }
    false
}

fn ext_matches(path: &Path, exts: &[&str]) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(s) => s.to_ascii_lowercase(),
        None => return false,
    };
    exts.iter().any(|e| name.ends_with(&e.to_ascii_lowercase()))
}

fn should_skip_name(name: &str) -> bool {
    // MSW meta files, backups, VCS, dependencies.
    name == ".codeblock"
        || name == ".directory"
        || name.ends_with(".bak")
        || name.ends_with(".tmp")
        || name == ".git"
        || name == "node_modules"
}

fn entry_from_path(root: &Path, path: &Path, readonly: bool) -> Option<FileEntry> {
    let md = std::fs::metadata(path).ok()?;
    let rel = path.strip_prefix(root).ok()?;
    let rel_s = rel.to_string_lossy().replace('\\', "/");
    let name = path.file_name()?.to_string_lossy().into_owned();
    let in_global = rel_s.starts_with("Global/") || rel_s == "Global" || rel_s.starts_with("Global\\");
    let in_mydesk = rel_s.starts_with("RootDesk/MyDesk/")
        || rel_s.starts_with("RootDesk\\MyDesk\\");
    Some(FileEntry {
        abs_path: path.to_string_lossy().into_owned(),
        rel_path: rel_s,
        name,
        size: md.len(),
        readonly,
        in_global,
        in_mydesk,
    })
}

/// Files that live directly under `<root>/<sub>` with a matching extension.
fn collect_shallow(
    root: &Path,
    sub: &str,
    exts: &[&str],
    out: &mut Vec<FileEntry>,
    warnings: &mut Vec<String>,
) {
    let dir = root.join(sub);
    if !dir.is_dir() {
        return;
    }
    let read_dir = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) => {
            warnings.push(format!("scan '{}' failed: {}", sub, e));
            return;
        }
    };
    for entry in read_dir.flatten() {
        if !entry.path().is_file() {
            continue;
        }
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();
        if should_skip_name(&name_str) {
            continue;
        }
        if !ext_matches(&entry.path(), exts) {
            continue;
        }
        let readonly = sub == "Global" && !is_writable_global(&name_str);
        if let Some(fe) = entry_from_path(root, &entry.path(), readonly) {
            if out.len() >= HARD_CAP_ENTRIES_PER_GROUP {
                warnings.push(format!(
                    "{}: entry cap ({}) reached, truncating",
                    sub, HARD_CAP_ENTRIES_PER_GROUP
                ));
                return;
            }
            out.push(fe);
        }
    }
}

/// Walk `dir` recursively under `root`, collecting files by extension.
fn collect_recursive(
    root: &Path,
    dir: &Path,
    exts: &[&str],
    out: &mut Vec<FileEntry>,
    warnings: &mut Vec<String>,
) {
    for entry in WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            !should_skip_name(&n)
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        if !ext_matches(entry.path(), exts) {
            continue;
        }
        // .mlua / .csv / sub-tree .model are editable by the user; Global
        // readonly rule only applies to files directly under Global/.
        if let Some(fe) = entry_from_path(root, entry.path(), /*readonly*/ false) {
            if out.len() >= HARD_CAP_ENTRIES_PER_GROUP {
                warnings.push(format!(
                    "{}: entry cap ({}) reached, truncating",
                    dir.display(),
                    HARD_CAP_ENTRIES_PER_GROUP
                ));
                return;
            }
            out.push(fe);
        }
    }
}

/// Files under Global/ that MSW permits creators to modify. Everything else
/// in Global/ is treated as readonly in the viewer (CLI still allows writes,
/// but the viewer warns).
fn is_writable_global(name: &str) -> bool {
    matches!(
        name,
        "common.gamelogic"
            | "DefaultPlayer.model"
            | "WorldConfig.model"
            | "CollisionGroupSet.model"
            | "KeyBindingsConfig.model"
            | "DefaultPlayerBundle.playerbundle"
    )
}
