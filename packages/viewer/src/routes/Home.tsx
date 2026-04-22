import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileText, Layers, Loader2, AlertTriangle } from "lucide-react";

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
import { vfsSummary, type MapSummary } from "@/lib/vfs";

type State =
  | { kind: "idle" }
  | { kind: "loading"; path: string }
  | { kind: "ok"; path: string; summary: MapSummary }
  | { kind: "err"; path: string; message: string };

export function Home() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [selection, setSelection] = useState<TreeSelection | null>(null);

  async function pickAndLoad() {
    const selected = await open({
      title: "Open MSW asset",
      multiple: false,
      filters: [
        { name: "MSW asset", extensions: ["map", "ui", "gamelogic", "model"] },
      ],
    });
    if (!selected || typeof selected !== "string") return;

    setSelection(null);
    setState({ kind: "loading", path: selected });
    try {
      const summary = await vfsSummary(selected);
      setState({ kind: "ok", path: selected, summary });
    } catch (e: unknown) {
      const message =
        typeof e === "object" && e && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e);
      setState({ kind: "err", path: selected, message });
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <Topbar
        onOpen={pickAndLoad}
        state={state}
      />

      {state.kind === "idle" && (
        <EmptyState onOpen={pickAndLoad} />
      )}

      {state.kind === "loading" && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Reading…
        </div>
      )}

      {state.kind === "err" && (
        <div className="flex-1 p-6">
          <Card className="max-w-3xl mx-auto border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Failed to read
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-2 break-all">
                {state.path}
              </p>
              <pre className="text-xs bg-muted rounded-md p-3 overflow-auto whitespace-pre-wrap">
                {state.message}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}

      {state.kind === "ok" && state.summary.asset_type === "model" && (
        <div className="flex-1 min-h-0 border-t">
          <ModelView assetPath={state.path} summary={state.summary} />
        </div>
      )}

      {state.kind === "ok" && state.summary.asset_type !== "model" && (
        <div className="flex-1 grid grid-cols-[320px_1fr] min-h-0 border-t">
          <aside className="border-r min-h-0">
            <TreePane
              assetPath={state.path}
              selected={selection}
              onSelect={setSelection}
            />
          </aside>
          <main className="min-h-0">
            <Inspector assetPath={state.path} selection={selection} />
          </main>
        </div>
      )}
    </div>
  );
}

function Topbar({
  onOpen,
  state,
}: {
  onOpen: () => void;
  state: State;
}) {
  const file = state.kind === "ok" ? basename(state.path) : null;
  const subtitle =
    state.kind === "ok"
      ? state.summary.asset_type === "model"
        ? `model · ${state.summary.values_count ?? 0} values`
        : `${state.summary.entity_count} entities`
      : null;
  return (
    <header className="flex items-center gap-3 px-4 py-2 border-b">
      <Layers className="h-5 w-5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">MSW VFS Viewer</div>
        {file && (
          <div className="text-xs text-muted-foreground truncate font-mono">
            {file} · {subtitle}
          </div>
        )}
      </div>
      <Button onClick={onOpen} size="sm">
        <FileText className="mr-2 h-3 w-3" />
        Open…
      </Button>
    </header>
  );
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <Layers className="h-12 w-12 text-primary/40" />
      <div className="text-center">
        <div className="text-lg font-semibold">MSW VFS Viewer</div>
        <div className="text-sm text-muted-foreground max-w-md">
          Open a <code>.map</code> / <code>.ui</code> / <code>.model</code> file
          to browse and edit entities.
        </div>
      </div>
      <Button onClick={onOpen} size="lg">
        <FileText className="mr-2 h-4 w-4" />
        Open file…
      </Button>
    </div>
  );
}

function basename(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}
