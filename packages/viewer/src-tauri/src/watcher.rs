// Workspace filesystem watcher — P3.5a-2.
//
// Wraps notify-debouncer-full so the React side gets a single
// `workspace:changed` event per burst of fs activity (300ms debounce).
// Only one workspace can be watched at a time — opening a new workspace
// stops the previous watch.
//
// Payload is a minimal change list: the frontend re-invokes
// `scan_workspace` on receipt rather than trying to patch the manifest
// in place. Scans are fast and idempotent; simpler beats clever.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const DEBOUNCE_MS: u64 = 300;
pub const EVENT_NAME: &str = "workspace:changed";

pub struct WatcherHandle {
    // Root is accessed via WatcherState::watching() for diagnostics; kept
    // alive here so the debouncer thread sees a stable path.
    #[allow(dead_code)]
    pub root: PathBuf,
    // Keep the debouncer alive for the duration of the watch.
    _debouncer: Debouncer<RecommendedWatcher, FileIdMap>,
}

#[derive(Default)]
pub struct WatcherState {
    inner: Mutex<Option<WatcherHandle>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stop(&self) {
        let mut guard = self.inner.lock().unwrap();
        *guard = None; // Drop → debouncer thread exits.
    }

    #[allow(dead_code)]
    pub fn watching(&self) -> Option<PathBuf> {
        self.inner.lock().unwrap().as_ref().map(|h| h.root.clone())
    }

    /// Swap in a new watcher rooted at `root`. Previous watch (if any) is
    /// dropped first so its thread exits before the new one starts.
    pub fn watch(&self, root: PathBuf, app: AppHandle) -> Result<(), String> {
        // Drop any existing watcher before creating the new one.
        {
            let mut guard = self.inner.lock().unwrap();
            *guard = None;
        }

        let root_for_thread = root.clone();
        let app_for_thread = app.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(DEBOUNCE_MS),
            None,
            move |res: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| match res {
                Ok(events) => handle_events(&app_for_thread, &root_for_thread, events),
                Err(errs) => {
                    for e in errs {
                        eprintln!("workspace watcher error: {e}");
                    }
                }
            },
        )
        .map_err(|e| format!("failed to create watcher: {e}"))?;

        debouncer
            .watcher()
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| format!("failed to watch '{}': {e}", root.display()))?;

        let mut guard = self.inner.lock().unwrap();
        *guard = Some(WatcherHandle {
            root,
            _debouncer: debouncer,
        });
        Ok(())
    }
}

#[derive(Serialize, Clone)]
pub struct ChangePayload {
    pub root: String,
    pub paths: Vec<String>,
}

fn handle_events(app: &AppHandle, root: &PathBuf, events: Vec<DebouncedEvent>) {
    let mut paths = std::collections::BTreeSet::new();
    for ev in events {
        for p in ev.event.paths {
            if skip_path(&p) {
                continue;
            }
            paths.insert(p.to_string_lossy().into_owned());
        }
    }
    if paths.is_empty() {
        return;
    }
    let payload = ChangePayload {
        root: root.to_string_lossy().into_owned(),
        paths: paths.into_iter().collect(),
    };
    let _ = app.emit(EVENT_NAME, payload);
}

/// Filter obvious noise before debouncing propagates to the UI — the same
/// skip list scan uses, plus IDE swap files.
fn skip_path(p: &std::path::Path) -> bool {
    let name = match p.file_name().and_then(|n| n.to_str()) {
        Some(s) => s,
        None => return true,
    };
    if name == ".codeblock" || name == ".directory" {
        return true;
    }
    if name.ends_with(".bak") || name.ends_with(".tmp") || name.ends_with('~') {
        return true;
    }
    // Editors like VSCode/Vim write temp files while saving.
    if name.starts_with('.') && (name.ends_with(".swp") || name.ends_with(".swo")) {
        return true;
    }
    // Ignore events inside .git / node_modules entirely.
    for part in p.components() {
        let s = part.as_os_str().to_string_lossy();
        if s == ".git" || s == "node_modules" {
            return true;
        }
    }
    false
}
