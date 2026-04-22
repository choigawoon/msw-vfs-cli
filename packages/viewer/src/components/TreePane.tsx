import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Box, FolderTree, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  vfsListEntities,
  type EntityDescriptor,
} from "@/lib/vfs";

export interface TreeSelection {
  entityPath: string;
  name: string;
}

export function TreePane({
  assetPath,
  selected,
  onSelect,
  highlightPath,
}: {
  assetPath: string;
  selected: TreeSelection | null;
  onSelect: (s: TreeSelection) => void;
  /** Briefly pulse this entity row — set when the Activity panel sees a
   *  matching rpc event. */
  highlightPath?: string | null;
}) {
  return (
    <div className="h-full overflow-auto text-sm">
      <div className="sticky top-0 bg-background/95 backdrop-blur border-b px-3 py-2 flex items-center gap-2">
        <FolderTree className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Entities
        </span>
      </div>
      <EntityLevel
        assetPath={assetPath}
        parentPath="/"
        depth={0}
        autoExpand
        selected={selected}
        onSelect={onSelect}
        highlightPath={highlightPath ?? null}
      />
    </div>
  );
}

function EntityLevel({
  assetPath,
  parentPath,
  depth,
  autoExpand,
  selected,
  onSelect,
  highlightPath,
}: {
  assetPath: string;
  parentPath: string;
  depth: number;
  autoExpand?: boolean;
  selected: TreeSelection | null;
  onSelect: (s: TreeSelection) => void;
  highlightPath: string | null;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["list-entities", assetPath, parentPath],
    queryFn: () => vfsListEntities(assetPath, parentPath, false),
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

  return (
    <div>
      {data.entities.map((e) => (
        <EntityNode
          key={e.path}
          assetPath={assetPath}
          entity={e}
          depth={depth}
          initiallyOpen={
            (autoExpand && depth === 0) ||
            (highlightPath !== null && highlightPath.startsWith(e.path + "/"))
          }
          selected={selected}
          onSelect={onSelect}
          highlightPath={highlightPath}
        />
      ))}
    </div>
  );
}

function EntityNode({
  assetPath,
  entity,
  depth,
  initiallyOpen,
  selected,
  onSelect,
  highlightPath,
}: {
  assetPath: string;
  entity: EntityDescriptor;
  depth: number;
  initiallyOpen?: boolean;
  selected: TreeSelection | null;
  onSelect: (s: TreeSelection) => void;
  highlightPath: string | null;
}) {
  const [open, setOpen] = useState(!!initiallyOpen);
  const isSelected = selected?.entityPath === entity.path;
  const hasChildren = entity.children_count > 0;
  const isHighlighted = highlightPath === entity.path;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex items-center gap-1 py-0.5 pr-3 cursor-pointer rounded-sm hover:bg-accent/60 select-none",
          isSelected && "bg-accent text-accent-foreground",
          isHighlighted &&
            "ring-2 ring-primary bg-primary/10 animate-[pulse_1s_ease-in-out_2]",
        )}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() =>
          onSelect({ entityPath: entity.path, name: entity.name })
        }
        onDoubleClick={() => hasChildren && setOpen((o) => !o)}
      >
        <button
          type="button"
          className={cn(
            "flex items-center justify-center w-4 h-4 text-muted-foreground hover:text-foreground",
            !hasChildren && "opacity-0 pointer-events-none",
          )}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-label={open ? "collapse" : "expand"}
          tabIndex={-1}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 transition-transform",
              open && "rotate-90",
            )}
          />
        </button>
        <Box className="h-3 w-3 text-primary/70 shrink-0" />
        <span className="font-mono truncate">{entity.name}</span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
          {entity.components.length > 0 && `${entity.components.length}c`}
          {entity.components.length > 0 && hasChildren && " "}
          {hasChildren && `${entity.children_count}e`}
        </span>
      </div>
      {open && hasChildren && (
        <EntityLevel
          assetPath={assetPath}
          parentPath={entity.path}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          highlightPath={highlightPath}
        />
      )}
    </div>
  );
}
