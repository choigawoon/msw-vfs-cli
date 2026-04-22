import { useEffect, useState } from "react";
import { Plus, Save, Trash2, X, RotateCcw, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  defaultWorkspaceConfig,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  type ConfigFolder,
  type GroupRole,
  type WorkspaceConfig,
} from "@/lib/vfs";

const ROLES: GroupRole[] = [
  "maps",
  "uis",
  "gamelogic",
  "models",
  "scripts",
  "datasets",
];

/**
 * Edit the per-folder extension whitelist for the current workspace. Saves
 * as `.msw-viewer.json` at the workspace root; remove it to fall back to
 * defaults. The viewer re-scans after save.
 *
 * P3.5a-4: a form UI over the typed `WorkspaceConfig`. No JSON editor — the
 * domain is small enough (7 default rows) that a form is easier to reason
 * about than schema validation.
 */
export function SettingsDialog({
  root,
  onClose,
  onSaved,
}: {
  root: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [fromFile, setFromFile] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    readWorkspaceConfig(root)
      .then((r) => {
        setConfig(r.config);
        setFromFile(r.from_file);
      })
      .catch((e: unknown) => setErr(errMessage(e)));
  }, [root]);

  async function save() {
    if (!config) return;
    setSaving(true);
    setErr(null);
    try {
      await writeWorkspaceConfig(root, config);
      onSaved();
      onClose();
    } catch (e: unknown) {
      setErr(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefaults() {
    try {
      const d = await defaultWorkspaceConfig();
      setConfig(d);
    } catch (e: unknown) {
      setErr(errMessage(e));
    }
  }

  function update(i: number, patch: Partial<ConfigFolder>) {
    if (!config) return;
    const folders = config.folders.map((f, idx) =>
      idx === i ? { ...f, ...patch } : f,
    );
    setConfig({ ...config, folders });
  }

  function remove(i: number) {
    if (!config) return;
    setConfig({
      ...config,
      folders: config.folders.filter((_, idx) => idx !== i),
    });
  }

  function add() {
    if (!config) return;
    setConfig({
      ...config,
      folders: [
        ...config.folders,
        { path: "", extensions: [".ext"], recursive: false, role: "scripts" },
      ],
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card rounded-lg shadow-xl border max-w-3xl w-full max-h-[85vh] flex flex-col">
        <div className="px-5 py-3 border-b flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">Workspace settings</div>
            <div className="text-xs text-muted-foreground truncate font-mono">
              {root}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-2 border-b bg-muted/30 flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          {fromFile
            ? "Loaded from .msw-viewer.json at the workspace root. Save overwrites it."
            : "No .msw-viewer.json yet — editing these will create one on Save. Clear it from disk to fall back to defaults."}
        </div>

        {err && (
          <div className="px-5 py-2 border-b bg-destructive/10 text-xs text-destructive">
            {err}
          </div>
        )}

        {config === null ? (
          <div className="flex-1 p-6 text-sm text-muted-foreground">
            Loading…
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <div className="text-xs font-medium text-muted-foreground mb-2 grid grid-cols-[1fr_1fr_90px_120px_36px] gap-2 px-2">
              <div>folder (relative)</div>
              <div>extensions (comma-separated)</div>
              <div>recursive</div>
              <div>group</div>
              <div />
            </div>
            <ul className="space-y-1.5">
              {config.folders.map((f, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[1fr_1fr_90px_120px_36px] gap-2 items-center"
                >
                  <Input
                    value={f.path}
                    placeholder="ui"
                    onChange={(e) => update(i, { path: e.target.value })}
                    className="h-8 font-mono text-xs"
                  />
                  <Input
                    value={f.extensions.join(", ")}
                    placeholder=".ui, .mlua"
                    onChange={(e) =>
                      update(i, {
                        extensions: parseExtList(e.target.value),
                      })
                    }
                    className="h-8 font-mono text-xs"
                  />
                  <label className="flex items-center gap-1.5 text-xs px-2">
                    <input
                      type="checkbox"
                      checked={f.recursive}
                      onChange={(e) =>
                        update(i, { recursive: e.target.checked })
                      }
                    />
                    <span>recursive</span>
                  </label>
                  <select
                    value={f.role}
                    onChange={(e) =>
                      update(i, { role: e.target.value as GroupRole })
                    }
                    className="h-8 bg-background border rounded-md px-2 text-xs"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => remove(i)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Remove folder"
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={add}>
                <Plus className="h-3 w-3 mr-1.5" />
                Add folder
              </Button>
              <Button size="sm" variant="ghost" onClick={resetToDefaults}>
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Reset to defaults
              </Button>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t flex items-center gap-2">
          <div className="text-xs text-muted-foreground flex-1 min-w-0">
            Viewer will re-scan the workspace after saving.
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !config}>
            <Save className="h-3 w-3 mr-1.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function parseExtList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (x.startsWith(".") ? x : "." + x));
}

function errMessage(e: unknown): string {
  if (typeof e === "object" && e && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
