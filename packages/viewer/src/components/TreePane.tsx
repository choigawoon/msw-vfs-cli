import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText, FolderTree, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { vfsLs, type LsItem } from "@/lib/vfs";

export interface TreeSelection {
  subpath: string;
  kind: "entity" | "component" | "file";
  components?: string[];
}

export function TreePane({
  assetPath,
  selected,
  onSelect,
}: {
  assetPath: string;
  selected: TreeSelection | null;
  onSelect: (s: TreeSelection) => void;
}) {
  return (
    <div className="h-full overflow-auto text-sm">
      <div className="sticky top-0 bg-background/95 backdrop-blur border-b px-3 py-2 flex items-center gap-2">
        <FolderTree className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Tree
        </span>
      </div>
      <TreeLevel
        assetPath={assetPath}
        dirPath="/"
        depth={0}
        autoExpand
        selected={selected}
        onSelect={onSelect}
      />
    </div>
  );
}

function TreeLevel({
  assetPath,
  dirPath,
  depth,
  autoExpand,
  selected,
  onSelect,
}: {
  assetPath: string;
  dirPath: string;
  depth: number;
  autoExpand?: boolean;
  selected: TreeSelection | null;
  onSelect: (s: TreeSelection) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ls", assetPath, dirPath],
    queryFn: () => vfsLs(assetPath, dirPath),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div
        className="flex items-center gap-2 text-muted-foreground py-1"
        style={{ paddingLeft: 12 + depth * 14 }}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-xs">loading…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="text-destructive text-xs py-1"
        style={{ paddingLeft: 12 + depth * 14 }}
      >
        {(error as Error).message}
      </div>
    );
  }
  if (!data) return null;

  // Split: directories (entities) first, then files (components).
  const dirs = data.filter((i) => i.type === "dir");
  const files = data.filter((i) => i.type === "file");

  return (
    <div>
      {dirs.map((item) => (
        <EntityNode
          key={item.name}
          assetPath={assetPath}
          parent={dirPath}
          item={item}
          depth={depth}
          initiallyOpen={autoExpand && depth === 0}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
      {files.map((item) => (
        <FileNode
          key={item.name}
          assetPath={assetPath}
          parent={dirPath}
          item={item}
          depth={depth}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function joinPath(parent: string, name: string) {
  if (parent === "/" || parent === "") return `/${name}`;
  return `${parent.replace(/\/$/, "")}/${name}`;
}

function EntityNode({
  assetPath,
  parent,
  item,
  depth,
  initiallyOpen,
  selected,
  onSelect,
}: {
  assetPath: string;
  parent: string;
  item: LsItem;
  depth: number;
  initiallyOpen?: boolean;
  selected: TreeSelection | null;
  onSelect: (s: TreeSelection) => void;
}) {
  const full = joinPath(parent, item.name);
  const [open, setOpen] = useState(!!initiallyOpen);
  const compCount = item.components?.length ?? 0;
  const childCount = item.children_count ?? 0;
  const isSelected = selected?.subpath === full && selected.kind === "entity";

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex items-center gap-1 py-0.5 pr-3 cursor-pointer rounded-sm hover:bg-accent/60 select-none",
          isSelected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() =>
          onSelect({
            subpath: full,
            kind: "entity",
            components: item.components,
          })
        }
        onDoubleClick={() => setOpen((o) => !o)}
      >
        <button
          type="button"
          className="flex items-center justify-center w-4 h-4 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-label={open ? "collapse" : "expand"}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              open && "rotate-90",
            )}
          />
        </button>
        <span className="font-mono truncate">{item.name}</span>
        {(compCount > 0 || childCount > 0) && (
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
            {compCount > 0 && `${compCount}c`}
            {compCount > 0 && childCount > 0 && " "}
            {childCount > 0 && `${childCount}e`}
          </span>
        )}
      </div>
      {open && (
        <TreeLevel
          assetPath={assetPath}
          dirPath={full}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function FileNode({
  assetPath: _assetPath,
  parent,
  item,
  depth,
  selected,
  onSelect,
}: {
  assetPath: string;
  parent: string;
  item: LsItem;
  depth: number;
  selected: TreeSelection | null;
  onSelect: (s: TreeSelection) => void;
}) {
  const full = joinPath(parent, item.name);
  const isEntityMeta = item.name === "_entity.json";
  const kind = isEntityMeta ? "file" : "component";
  const isSelected = selected?.subpath === full;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "flex items-center gap-1 py-0.5 pr-3 cursor-pointer rounded-sm hover:bg-accent/60 select-none",
        isSelected && "bg-accent text-accent-foreground",
      )}
      style={{ paddingLeft: 12 + depth * 14 + 16 }}
      onClick={() => onSelect({ subpath: full, kind })}
    >
      <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="font-mono truncate text-muted-foreground">
        {item.name}
      </span>
    </div>
  );
}
