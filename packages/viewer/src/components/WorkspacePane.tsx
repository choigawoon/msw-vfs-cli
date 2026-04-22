import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileSpreadsheet,
  Lock,
  Map as MapIcon,
  Layers,
  Boxes,
  ScrollText,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  fileKindFromName,
  type WorkspaceFileEntry,
  type WorkspaceManifest,
} from "@/lib/vfs";

const STORAGE_KEY = "msw-viewer.workspace.collapsed-groups";

type GroupKey = keyof WorkspaceManifest["groups"];

interface GroupDef {
  key: GroupKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  openable: boolean;
}

const GROUPS: GroupDef[] = [
  { key: "maps",      label: "map/",             icon: MapIcon,         openable: true  },
  { key: "uis",       label: "ui/",              icon: Layers,          openable: true  },
  { key: "gamelogic", label: "gamelogic",        icon: ScrollText,      openable: true  },
  { key: "models",    label: "models",           icon: Boxes,           openable: true  },
  { key: "scripts",   label: "scripts (.mlua)",  icon: FileCode,        openable: false },
  { key: "datasets",  label: "datasets (.csv)",  icon: FileSpreadsheet, openable: false },
];

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCollapsed(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage may be disabled; silently skip */
  }
}

export function WorkspacePane({
  manifest,
  selected,
  onSelect,
}: {
  manifest: WorkspaceManifest;
  selected: string | null;
  onSelect: (entry: WorkspaceFileEntry) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);

  function toggle(key: string) {
    const next = { ...collapsed, [key]: !collapsed[key] };
    setCollapsed(next);
    saveCollapsed(next);
  }

  return (
    <div className="flex flex-col h-full min-h-0 text-sm">
      <div className="px-3 py-2 border-b">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          workspace
        </div>
        <div
          className="font-mono text-xs truncate"
          title={manifest.root}
        >
          {basename(manifest.root)}
        </div>
        {manifest.status !== "valid" && (
          <div className="mt-1 text-[10px] text-amber-600">
            {manifest.status === "partial" && "partial project"}
            {manifest.status === "scriptsonly" && "scripts-only view"}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {GROUPS.map((g) => {
          const items = manifest.groups[g.key];
          if (items.length === 0) return null;
          const isCollapsed = collapsed[g.key] ?? false;
          return (
            <div key={g.key} className="py-0.5">
              <button
                onClick={() => toggle(g.key)}
                className="w-full flex items-center gap-1 px-2 py-1 hover:bg-muted/50 text-left"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <g.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium">{g.label}</span>
                <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                  {items.length}
                </span>
              </button>
              {!isCollapsed && (
                <ul>
                  {items.map((entry) => (
                    <WorkspaceFileRow
                      key={entry.abs_path}
                      entry={entry}
                      openable={g.openable}
                      active={selected === entry.abs_path}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceFileRow({
  entry,
  openable,
  active,
  onSelect,
}: {
  entry: WorkspaceFileEntry;
  openable: boolean;
  active: boolean;
  onSelect: (entry: WorkspaceFileEntry) => void;
}) {
  const disabled = !openable;
  const kind = fileKindFromName(entry.name);
  return (
    <li>
      <button
        onClick={() => !disabled && onSelect(entry)}
        disabled={disabled}
        title={
          disabled
            ? `${entry.rel_path} — ${kind === "script" ? ".mlua preview" : "dataset grid"} lands in a later release`
            : entry.rel_path
        }
        className={cn(
          "w-full flex items-center gap-1 pl-7 pr-2 py-0.5 text-left text-xs",
          active
            ? "bg-primary/10 text-primary"
            : "hover:bg-muted/50",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <File className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1 font-mono">{entry.name}</span>
        {entry.readonly && (
          <Lock
            className="h-3 w-3 shrink-0 text-muted-foreground"
            aria-label="read-only"
          />
        )}
      </button>
    </li>
  );
}

function basename(p: string) {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}
