import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  FileText,
  FolderOpen,
  Layers,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings as SettingsIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TreePane, type TreeSelection } from "@/components/TreePane";
import { Inspector } from "@/components/Inspector";
import { ModelView } from "@/components/ModelView";
import { ScriptPreview } from "@/components/ScriptPreview";
import { DatasetPreview } from "@/components/DatasetPreview";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ActivityPanel, ActivityToggle } from "@/components/ActivityPanel";
import { WorkspacePane } from "@/components/WorkspacePane";
import {
  REQUIRED_CLI_VERSION,
  fileKindFromName,
  isCliVersionCompatible,
  onWorkspaceChanged,
  readTextFile,
  scanWorkspace,
  startWorkspaceWatch,
  stopWorkspaceWatch,
  vfsCliVersion,
  vfsSummary,
  type MapSummary,
  type WorkspaceFileEntry,
  type WorkspaceManifest,
} from "@/lib/vfs";

type CliVersion =
  | { kind: "checking" }
  | { kind: "ok"; version: string }
  | { kind: "mismatch"; version: string }
  | { kind: "err"; message: string };

type FileState =
  | { kind: "none" }
  | { kind: "loading"; path: string }
  | { kind: "asset"; path: string; summary: MapSummary }
  | {
      kind: "text";
      path: string;
      role: "script" | "dataset";
      text: string;
      size: number;
      truncated: boolean;
    }
  | { kind: "err"; path: string; message: string };

type WorkspaceState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ok"; manifest: WorkspaceManifest }
  | { kind: "err"; message: string };

const SIDEBAR_COLLAPSED_KEY = "msw-viewer.sidebar.collapsed";
const ACTIVITY_OPEN_KEY = "msw-viewer.activity.open";

export function Home() {
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [workspace, setWorkspace] = useState<WorkspaceState>({ kind: "none" });
  const [selection, setSelection] = useState<TreeSelection | null>(null);
  const [cli, setCli] = useState<CliVersion>({ kind: "checking" });
  const [externallyChanged, setExternallyChanged] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      // P3.5 default: collapsed, per the spec.
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [activityOpen, setActivityOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ACTIVITY_OPEN_KEY) === "true";
    } catch {
      return false;
    }
  });
  // Entity path that just got touched by an AI rpc event — pulses in the
  // tree for ~2s. Multiple rapid hits re-key the highlight so the
  // animation restarts.
  const [highlight, setHighlight] = useState<
    { path: string; key: number } | null
  >(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVITY_OPEN_KEY, String(activityOpen));
    } catch {
      /* ignore */
    }
  }, [activityOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;
    vfsCliVersion()
      .then((version) => {
        if (cancelled) return;
        setCli(
          isCliVersionCompatible(version)
            ? { kind: "ok", version }
            : { kind: "mismatch", version },
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCli({ kind: "err", message: errMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // File path the watcher should compare against. Using a ref keeps the
  // subscription stable across file switches without re-subscribing.
  const openFilePathRef = useRef<string | null>(null);
  useEffect(() => {
    openFilePathRef.current = fileIsOpen(file) ? file.path : null;
  }, [file]);

  // Subscribe once. The handler checks the current workspace root + open
  // file via refs so it doesn't need to re-subscribe on every state change.
  const workspaceRootRef = useRef<string | null>(null);
  useEffect(() => {
    workspaceRootRef.current =
      workspace.kind === "ok" ? workspace.manifest.root : null;
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    onWorkspaceChanged((payload) => {
      if (cancelled) return;
      const root = workspaceRootRef.current;
      if (!root || payload.root !== root) return;
      // Re-scan to refresh the sidebar. Errors are logged but non-fatal —
      // the previous manifest stays on screen.
      scanWorkspace(root)
        .then((manifest) => {
          if (cancelled) return;
          setWorkspace({ kind: "ok", manifest });
        })
        .catch((e) => console.warn("workspace re-scan failed:", e));

      // If the currently open file is in the change set, surface a toast.
      const open = openFilePathRef.current;
      if (open && payload.paths.includes(open)) {
        setExternallyChanged(true);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Stop the Rust watcher when the window unloads.
  useEffect(() => {
    return () => {
      stopWorkspaceWatch().catch(() => {
        /* ignore on unmount */
      });
    };
  }, []);

  async function pickFile() {
    const selected = await open({
      title: "Open MSW asset",
      multiple: false,
      filters: [
        { name: "MSW asset", extensions: ["map", "ui", "gamelogic", "model"] },
      ],
    });
    if (!selected || typeof selected !== "string") return;
    await loadFile(selected);
  }

  async function pickWorkspace() {
    const selected = await open({
      title: "Open MSW project folder",
      directory: true,
      multiple: false,
    });
    if (!selected || typeof selected !== "string") return;
    setWorkspace({ kind: "loading" });
    setFile({ kind: "none" });
    setSelection(null);
    try {
      const manifest = await scanWorkspace(selected);
      setWorkspace({ kind: "ok", manifest });
      // Auto-expand sidebar when a workspace opens.
      setSidebarCollapsed(false);
      // Start watcher on the resolved root (manifest.root is canonical).
      try {
        await startWorkspaceWatch(manifest.root);
      } catch (e) {
        // Watcher failure is non-fatal — user can still use manual refresh.
        console.warn("workspace watcher failed to start:", e);
      }
    } catch (e: unknown) {
      setWorkspace({ kind: "err", message: errMessage(e) });
    }
  }

  async function loadFile(path: string, opts?: { keepSelection?: boolean }) {
    if (!opts?.keepSelection) setSelection(null);
    setExternallyChanged(false);
    setFile({ kind: "loading", path });
    const fileKind = fileKindFromName(path);
    try {
      if (fileKind === "script" || fileKind === "dataset") {
        const payload = await readTextFile(path);
        setFile({
          kind: "text",
          path,
          role: fileKind,
          text: payload.text,
          size: payload.size,
          truncated: payload.truncated,
        });
        return;
      }
      // Asset types: .map / .ui / .gamelogic / .model — route via CLI summary.
      const summary = await vfsSummary(path);
      setFile({ kind: "asset", path, summary });
    } catch (e: unknown) {
      setFile({ kind: "err", path, message: errMessage(e) });
    }
  }

  /** Activity panel row click: jump to the file (and optionally select an
   *  entity inside it). If the file is already open, just adjust selection. */
  async function navigateToTarget(target: { file: string; entityPath?: string }) {
    const alreadyOpen = fileIsOpen(file) && file.path === target.file;
    if (!alreadyOpen) {
      await loadFile(target.file, { keepSelection: true });
    }
    if (target.entityPath) {
      const name = target.entityPath.split("/").filter(Boolean).pop() ?? target.entityPath;
      setSelection({ entityPath: target.entityPath, name });
    }
  }

  /** React to every broadcast rpc event from the Activity stream.
   *  - AI events targeting the currently open file → pulse the matched
   *    entity in the tree (visual "AI is touching this" cue).
   *  - AI *mutations* on the currently open file also auto-reload (no
   *    external-change toast — the user already saw it stream by). */
  function onActivityRpc(event: {
    client: "ai" | "viewer" | "cli";
    file: string | null;
    args: string[];
    cmd: string | null;
    mutation: boolean;
    status: "ok" | "error";
  }) {
    if (event.client !== "ai" || event.status !== "ok") return;
    if (!fileIsOpen(file) || !event.file || file.path !== event.file) return;

    // Pulse the targeted entity if the command carried one.
    const entityPath = event.args.find((a) => a.startsWith("/"));
    if (entityPath) {
      setHighlight({ path: entityPath, key: Date.now() });
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlight(null), 2000);
    }

    if (event.mutation) {
      loadFile(file.path, { keepSelection: true });
      setExternallyChanged(false);
    }
  }

  async function reloadOpenFile() {
    if (fileIsOpen(file)) {
      await loadFile(file.path);
    }
  }

  async function reScanWorkspaceAfterSettings() {
    if (workspace.kind !== "ok") return;
    try {
      const manifest = await scanWorkspace(workspace.manifest.root);
      setWorkspace({ kind: "ok", manifest });
    } catch (e) {
      console.warn("post-save re-scan failed:", e);
    }
  }

  async function onSelectWorkspaceFile(entry: WorkspaceFileEntry) {
    if (fileIsOpen(file) && file.path === entry.abs_path) return;
    await loadFile(entry.abs_path);
  }

  const hasWorkspace = workspace.kind === "ok";

  return (
    <div className="flex flex-col h-screen">
      <Topbar
        onOpenFile={pickFile}
        onOpenWorkspace={pickWorkspace}
        onOpenSettings={hasWorkspace ? () => setSettingsOpen(true) : null}
        onToggleSidebar={
          hasWorkspace ? () => setSidebarCollapsed((c) => !c) : null
        }
        sidebarCollapsed={sidebarCollapsed}
        file={file}
        cli={cli}
      />

      {cli.kind === "mismatch" && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/40 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          CLI version <code className="font-mono">{cli.version}</code> may be
          incompatible — viewer expects{" "}
          <code className="font-mono">^{REQUIRED_CLI_VERSION}</code>. Some
          features (read-entity, edit-component) may fail.
        </div>
      )}
      {cli.kind === "err" && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/40 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Could not resolve msw-vfs CLI: {cli.message}
        </div>
      )}
      {workspace.kind === "ok" &&
        workspace.manifest.warnings.map((w) => (
          <div
            key={w}
            className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/40 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {w}
          </div>
        ))}
      {workspace.kind === "err" && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/40 text-xs text-destructive flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {workspace.message}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {hasWorkspace && !sidebarCollapsed && (
          <aside className="w-[240px] shrink-0 border-r min-h-0">
            <WorkspacePane
              manifest={(workspace as { kind: "ok"; manifest: WorkspaceManifest }).manifest}
              selected={fileIsOpen(file) ? file.path : null}
              onSelect={onSelectWorkspaceFile}
            />
          </aside>
        )}

        <div className="flex-1 min-h-0 flex flex-col">
          <FileArea
            file={file}
            selection={selection}
            onSelect={setSelection}
            onPickFile={pickFile}
            onPickWorkspace={pickWorkspace}
            hasWorkspace={hasWorkspace}
            highlightPath={highlight?.path ?? null}
            highlightKey={highlight?.key ?? 0}
          />
        </div>
      </div>

      {externallyChanged && fileIsOpen(file) && (
        <ReloadToast
          path={file.path}
          onReload={async () => {
            await reloadOpenFile();
          }}
          onDismiss={() => setExternallyChanged(false)}
        />
      )}

      {settingsOpen && workspace.kind === "ok" && (
        <SettingsDialog
          root={workspace.manifest.root}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            reScanWorkspaceAfterSettings();
          }}
        />
      )}

      <ActivityToggle
        open={activityOpen}
        onToggle={() => setActivityOpen(true)}
        hasUnread={false}
      />
      {activityOpen && (
        <ActivityPanel
          onClose={() => setActivityOpen(false)}
          onNavigate={navigateToTarget}
          onRpc={onActivityRpc}
        />
      )}
    </div>
  );
}

function ReloadToast({
  path,
  onReload,
  onDismiss,
}: {
  path: string;
  onReload: () => void;
  onDismiss: () => void;
}) {
  const name = path.split(/[/\\]/).pop() ?? path;
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-card shadow-lg p-3 flex items-start gap-3">
      <RefreshCw className="h-4 w-4 mt-0.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-medium">외부에서 수정됨</div>
        <div className="text-xs text-muted-foreground truncate font-mono mt-0.5">
          {name}
        </div>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={onReload}>
            Reload
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FileArea({
  file,
  selection,
  onSelect,
  onPickFile,
  onPickWorkspace,
  hasWorkspace,
  highlightPath,
  highlightKey,
}: {
  file: FileState;
  selection: TreeSelection | null;
  onSelect: (s: TreeSelection | null) => void;
  onPickFile: () => void;
  onPickWorkspace: () => void;
  hasWorkspace: boolean;
  highlightPath: string | null;
  highlightKey: number;
}) {
  if (file.kind === "none") {
    return hasWorkspace ? (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Pick a file from the sidebar to open.
      </div>
    ) : (
      <EmptyState onOpenFile={onPickFile} onOpenWorkspace={onPickWorkspace} />
    );
  }
  if (file.kind === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Reading…
      </div>
    );
  }
  if (file.kind === "err") {
    return (
      <div className="flex-1 p-6 min-h-0 overflow-auto">
        <Card className="max-w-3xl mx-auto border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Failed to read
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2 break-all">
              {file.path}
            </p>
            <pre className="text-xs bg-muted rounded-md p-3 overflow-auto whitespace-pre-wrap">
              {file.message}
            </pre>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (file.kind === "text") {
    return (
      <div className="flex-1 min-h-0 border-t">
        {file.role === "script" ? (
          <ScriptPreview
            path={file.path}
            text={file.text}
            size={file.size}
            truncated={file.truncated}
          />
        ) : (
          <DatasetPreview
            path={file.path}
            text={file.text}
            size={file.size}
            truncated={file.truncated}
          />
        )}
      </div>
    );
  }
  // file.kind === "asset"
  if (file.summary.asset_type === "model") {
    return (
      <div className="flex-1 min-h-0 border-t">
        <ModelView assetPath={file.path} summary={file.summary} />
      </div>
    );
  }
  void highlightKey; // retained only to force parent re-render on new pulse
  return (
    <div className="flex-1 grid grid-cols-[320px_1fr] min-h-0 border-t">
      <aside className="border-r min-h-0">
        <TreePane
          assetPath={file.path}
          selected={selection}
          onSelect={onSelect}
          highlightPath={highlightPath}
        />
      </aside>
      <main className="min-h-0">
        <Inspector assetPath={file.path} selection={selection} />
      </main>
    </div>
  );
}

function Topbar({
  onOpenFile,
  onOpenWorkspace,
  onOpenSettings,
  onToggleSidebar,
  sidebarCollapsed,
  file,
  cli,
}: {
  onOpenFile: () => void;
  onOpenWorkspace: () => void;
  onOpenSettings: (() => void) | null;
  onToggleSidebar: (() => void) | null;
  sidebarCollapsed: boolean;
  file: FileState;
  cli: CliVersion;
}) {
  const fileName = fileIsOpen(file) ? basename(file.path) : null;
  const subtitle =
    file.kind === "asset"
      ? file.summary.asset_type === "model"
        ? `model · ${file.summary.values_count ?? 0} values`
        : `${file.summary.entity_count} entities`
      : file.kind === "text"
        ? file.role === "script"
          ? "mlua · preview"
          : "csv · preview"
        : null;
  return (
    <header className="flex items-center gap-3 px-4 py-2 border-b">
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="text-muted-foreground hover:text-foreground"
          title={sidebarCollapsed ? "Expand workspace" : "Collapse workspace"}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      )}
      <Layers className="h-5 w-5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">MSW VFS Viewer</div>
        {fileName && (
          <div className="text-xs text-muted-foreground truncate font-mono">
            {fileName} · {subtitle}
          </div>
        )}
      </div>
      <div
        className="text-[10px] font-mono text-muted-foreground tabular-nums"
        title={`viewer requires @choigawoon/msw-vfs-cli ^${REQUIRED_CLI_VERSION}`}
      >
        {cli.kind === "ok" && <>cli {cli.version}</>}
        {cli.kind === "mismatch" && (
          <span className="text-amber-600">cli {cli.version} ⚠</span>
        )}
        {cli.kind === "checking" && <>cli …</>}
        {cli.kind === "err" && <span className="text-destructive">cli ✕</span>}
      </div>
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="text-muted-foreground hover:text-foreground"
          title="Workspace settings"
          aria-label="Workspace settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      )}
      <Button onClick={onOpenWorkspace} size="sm" variant="outline">
        <FolderOpen className="mr-2 h-3 w-3" />
        Open Workspace…
      </Button>
      <Button onClick={onOpenFile} size="sm">
        <FileText className="mr-2 h-3 w-3" />
        Open File…
      </Button>
    </header>
  );
}

function EmptyState({
  onOpenFile,
  onOpenWorkspace,
}: {
  onOpenFile: () => void;
  onOpenWorkspace: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <Layers className="h-12 w-12 text-primary/40" />
      <div className="text-center">
        <div className="text-lg font-semibold">MSW VFS Viewer</div>
        <div className="text-sm text-muted-foreground max-w-md">
          Open a <code>.map</code> / <code>.ui</code> / <code>.gamelogic</code>{" "}
          / <code>.model</code> file, or point the viewer at an MSW project
          folder to browse the whole tree.
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={onOpenWorkspace} size="lg" variant="outline">
          <FolderOpen className="mr-2 h-4 w-4" />
          Open workspace…
        </Button>
        <Button onClick={onOpenFile} size="lg">
          <FileText className="mr-2 h-4 w-4" />
          Open file…
        </Button>
      </div>
    </div>
  );
}

function fileIsOpen(
  f: FileState,
): f is
  | Extract<FileState, { kind: "asset" }>
  | Extract<FileState, { kind: "text" }> {
  return f.kind === "asset" || f.kind === "text";
}

function errMessage(e: unknown): string {
  if (typeof e === "object" && e && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

function basename(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}
