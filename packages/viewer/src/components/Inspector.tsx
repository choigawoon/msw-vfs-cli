import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Loader2,
  AlertCircle,
  FileJson,
  Box,
  ChevronDown,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  vfsReadEntity,
  vfsEditEntity,
  vfsEditComponent,
  type EntityBundle,
} from "@/lib/vfs";
import type { TreeSelection } from "./TreePane";

// Fields the CLI accepts on edit-entity.
const ENTITY_META_EDITABLE = new Set([
  "enable",
  "visible",
  "name",
  "displayOrder",
  "modelId",
  "nameEditable",
  "localize",
]);

export function Inspector({
  assetPath,
  selection,
}: {
  assetPath: string;
  selection: TreeSelection | null;
}) {
  if (!selection) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 p-8">
        <Box className="h-10 w-10 opacity-30" />
        <div className="text-sm">
          Select an entity on the left.
        </div>
      </div>
    );
  }
  return <InspectorFor assetPath={assetPath} selection={selection} />;
}

function InspectorFor({
  assetPath,
  selection,
}: {
  assetPath: string;
  selection: TreeSelection;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["read-entity", assetPath, selection.entityPath],
    queryFn: () => vfsReadEntity(assetPath, selection.entityPath, false),
    staleTime: 30_000,
  });

  const entityMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      vfsEditEntity(assetPath, selection.entityPath, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["read-entity", assetPath, selection.entityPath],
      });
      await queryClient.invalidateQueries({ queryKey: ["list-entities", assetPath] });
      refetch();
    },
  });

  const componentMut = useMutation({
    mutationFn: (v: { type: string; patch: Record<string, unknown> }) =>
      vfsEditComponent(assetPath, selection.entityPath, v.type, v.patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["read-entity", assetPath, selection.entityPath],
      });
      refetch();
    },
  });

  const saving = entityMut.isPending || componentMut.isPending;
  const lastError =
    (entityMut.isError && entityMut.error) ||
    (componentMut.isError && componentMut.error) ||
    null;
  const lastSuccess =
    entityMut.isSuccess || componentMut.isSuccess;

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 bg-background/95 backdrop-blur border-b px-4 py-2 flex items-center gap-2">
        <Box className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{selection.name}</div>
          <div className="font-mono text-[10px] text-muted-foreground truncate">
            {selection.entityPath}
          </div>
        </div>
        <MutationStatus
          saving={saving}
          error={lastError as Error | null}
          success={lastSuccess}
        />
      </div>

      <div className="p-4 space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}
        {error && (
          <pre className="text-xs text-destructive whitespace-pre-wrap">
            {(error as Error).message}
          </pre>
        )}
        {data && (
          <>
            <MetadataCard
              bundle={data}
              disabled={saving}
              onSave={(key, v) => entityMut.mutate({ [key]: v })}
            />
            {Object.entries(data.components).map(([type, comp]) => (
              <ComponentCard
                key={type}
                type={type}
                content={comp as Record<string, unknown>}
                disabled={saving}
                onSave={(key, v) =>
                  componentMut.mutate({ type, patch: { [key]: v } })
                }
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function MutationStatus({
  saving,
  error,
  success,
}: {
  saving: boolean;
  error: Error | null;
  success: boolean;
}) {
  if (saving) {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        saving
      </span>
    );
  }
  if (error) {
    return (
      <span
        className="text-xs text-destructive flex items-center gap-1"
        title={error.message}
      >
        <AlertCircle className="h-3 w-3" />
        error
      </span>
    );
  }
  if (success) {
    return (
      <span className="text-xs text-emerald-500 flex items-center gap-1">
        <Check className="h-3 w-3" />
        saved
      </span>
    );
  }
  return null;
}

function MetadataCard({
  bundle,
  disabled,
  onSave,
}: {
  bundle: EntityBundle;
  disabled: boolean;
  onSave: (key: string, v: unknown) => void;
}) {
  const meta = bundle.metadata;
  return (
    <section className="border rounded-md overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b">
        <Box className="h-3 w-3 text-primary/70" />
        <span className="text-xs font-semibold">Entity</span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
          {String(meta.id ?? "")}
        </span>
      </header>
      <div className="divide-y">
        {Object.entries(meta).map(([k, v]) => {
          const editable = ENTITY_META_EDITABLE.has(k) && isScalar(v);
          return (
            <Row
              key={k}
              name={k}
              value={v}
              editable={editable}
              disabled={disabled}
              onSave={(nv) => onSave(k, nv)}
            />
          );
        })}
      </div>
    </section>
  );
}

function ComponentCard({
  type,
  content,
  disabled,
  onSave,
}: {
  type: string;
  content: Record<string, unknown>;
  disabled: boolean;
  onSave: (key: string, v: unknown) => void;
}) {
  const [open, setOpen] = useState(true);
  const shortType = type.split(".").pop() ?? type;
  const entries = Object.entries(content).filter(([k]) => k !== "@type");

  return (
    <section className="border rounded-md overflow-hidden">
      <header
        role="button"
        tabIndex={0}
        className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b cursor-pointer select-none hover:bg-muted/60"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            !open && "-rotate-90",
          )}
        />
        <FileJson className="h-3 w-3 text-primary/70" />
        <span className="text-xs font-semibold">{shortType}</span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono truncate max-w-[50%]">
          {type}
        </span>
      </header>
      {open && (
        <div className="divide-y">
          {entries.map(([k, v]) => (
            <Row
              key={k}
              name={k}
              value={v}
              editable={isScalar(v)}
              disabled={disabled}
              onSave={(nv) => onSave(k, nv)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Row({
  name,
  value,
  editable,
  disabled,
  onSave,
}: {
  name: string;
  value: unknown;
  editable: boolean;
  disabled?: boolean;
  onSave: (v: unknown) => void;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2 text-sm">
      <div className="w-40 shrink-0 font-mono text-xs text-muted-foreground pt-1.5 truncate">
        {name}
      </div>
      <div className="flex-1 min-w-0">
        {editable ? (
          <ScalarEditor value={value} onSave={onSave} disabled={disabled} />
        ) : (
          <pre className="text-xs font-mono bg-muted/40 rounded p-2 overflow-auto max-h-40">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function ScalarEditor({
  value,
  onSave,
  disabled,
}: {
  value: unknown;
  onSave: (v: unknown) => void;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState<string>(() => toEditString(value));
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (!focus) setLocal(toEditString(value));
  }, [value, focus]);

  if (typeof value === "boolean") {
    return (
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary cursor-pointer"
          checked={!!value}
          disabled={disabled}
          onChange={(e) => onSave(e.target.checked)}
        />
        <span className="text-xs text-muted-foreground font-mono">
          {String(!!value)}
        </span>
      </label>
    );
  }

  const commit = () => {
    if (local === toEditString(value)) return;
    const parsed = parseEditString(local, typeof value);
    onSave(parsed);
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setLocal(toEditString(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          "font-mono text-xs",
          typeof value === "number" && "tabular-nums",
        )}
      />
      <span className="text-[10px] text-muted-foreground">
        {typeof value === "number" ? "num" : value === null ? "null" : "str"}
      </span>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────

function isScalar(x: unknown): boolean {
  return (
    x === null ||
    typeof x === "string" ||
    typeof x === "number" ||
    typeof x === "boolean"
  );
}

function toEditString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  return String(v);
}

function parseEditString(s: string, originalType: string): unknown {
  if (originalType === "number") {
    const n = Number(s);
    return Number.isNaN(n) ? s : n;
  }
  if (s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  return s;
}
