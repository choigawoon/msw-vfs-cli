import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  FileText,
  FolderOpen,
  Layers,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
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
import { WorkspacePane } from "@/components/WorkspacePane";
import {
  REQUIRED_CLI_VERSION,
  isCliVersionCompatible,
  scanWorkspace,
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
  | { kind: "ok"; path: string; summary: MapSummary }
  | { kind: "err"; path: string; message: string };

type WorkspaceState =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "ok"; manifest: WorkspaceManifest }
  | { kind: "err"; message: string };

const SIDEBAR_COLLAPSED_KEY = "msw-viewer.sidebar.collapsed";

export function Home() {
  const [file, setFile] = useState<FileState>({ kind: "none" });
  const [workspace, setWorkspace] = useState<WorkspaceState>({ kind: "none" });
  const [selection, setSelection] = useState<TreeSelection | null>(null);
  const [cli, setCli] = useState<CliVersion>({ kind: "checking" });
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      // P3.5 default: collapsed, per the spec.
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== "false";
    } catch {
      return true;
    }
  });

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
    } catch (e: unknown) {
      setWorkspace({ kind: "err", message: errMessage(e) });
    }
  }

  async function loadFile(path: string) {
    setSelection(null);
    setFile({ kind: "loading", path });
    try {
      const summary = await vfsSummary(path);
      setFile({ kind: "ok", path, summary });
    } catch (e: unknown) {
      setFile({ kind: "err", path, message: errMessage(e) });
    }
  }

  async function onSelectWorkspaceFile(entry: WorkspaceFileEntry) {
    if (file.kind === "ok" && file.path === entry.abs_path) return;
    await loadFile(entry.abs_path);
  }

  const hasWorkspace = workspace.kind === "ok";

  return (
    <div className="flex flex-col h-screen">
      <Topbar
        onOpenFile={pickFile}
        onOpenWorkspace={pickWorkspace}
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
              selected={file.kind === "ok" ? file.path : null}
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
          />
        </div>
      </div>
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
}: {
  file: FileState;
  selection: TreeSelection | null;
  onSelect: (s: TreeSelection | null) => void;
  onPickFile: () => void;
  onPickWorkspace: () => void;
  hasWorkspace: boolean;
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
  // file.kind === "ok"
  if (file.summary.asset_type === "model") {
    return (
      <div className="flex-1 min-h-0 border-t">
        <ModelView assetPath={file.path} summary={file.summary} />
      </div>
    );
  }
  return (
    <div className="flex-1 grid grid-cols-[320px_1fr] min-h-0 border-t">
      <aside className="border-r min-h-0">
        <TreePane
          assetPath={file.path}
          selected={selection}
          onSelect={onSelect}
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
  onToggleSidebar,
  sidebarCollapsed,
  file,
  cli,
}: {
  onOpenFile: () => void;
  onOpenWorkspace: () => void;
  onToggleSidebar: (() => void) | null;
  sidebarCollapsed: boolean;
  file: FileState;
  cli: CliVersion;
}) {
  const fileName = file.kind === "ok" ? basename(file.path) : null;
  const subtitle =
    file.kind === "ok"
      ? file.summary.asset_type === "model"
        ? `model · ${file.summary.values_count ?? 0} values`
        : `${file.summary.entity_count} entities`
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
