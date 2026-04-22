import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, AlertCircle, FileJson, Box } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { vfsEdit, vfsRead } from "@/lib/vfs";
import type { TreeSelection } from "./TreePane";

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
          Select an entity or component on the left.
        </div>
      </div>
    );
  }

  // Entity nodes expose their metadata as <subpath>/_entity.json
  const readSub =
    selection.kind === "entity"
      ? joinSub(selection.subpath, "_entity.json")
      : selection.subpath;

  return (
    <InspectorFor
      assetPath={assetPath}
      selection={selection}
      readSub={readSub}
    />
  );
}

function InspectorFor({
  assetPath,
  selection,
  readSub,
}: {
  assetPath: string;
  selection: TreeSelection;
  readSub: string;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["read", assetPath, readSub],
    queryFn: () => vfsRead(assetPath, readSub),
    staleTime: 30_000,
  });

  const edit = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      vfsEdit(assetPath, readSub, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["read", assetPath, readSub],
      });
      await queryClient.invalidateQueries({
        queryKey: ["ls", assetPath],
      });
      refetch();
    },
  });

  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 bg-background/95 backdrop-blur border-b px-4 py-2 flex items-center gap-2">
        <KindIcon kind={selection.kind} />
        <div className="font-mono text-xs break-all flex-1 min-w-0">
          {selection.subpath}
        </div>
        <EditStatus mutation={edit} />
      </div>

      <div className="p-4">
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
        {data !== undefined && (
          <FieldList
            value={data}
            onSaveScalar={(key, v) => edit.mutate({ [key]: v })}
            editing={edit.isPending}
          />
        )}
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: TreeSelection["kind"] }) {
  if (kind === "component")
    return <FileJson className="h-4 w-4 text-primary shrink-0" />;
  if (kind === "entity") return <Box className="h-4 w-4 text-primary shrink-0" />;
  return <FileJson className="h-4 w-4 text-muted-foreground shrink-0" />;
}

function EditStatus({
  mutation,
}: {
  mutation: {
    isPending: boolean;
    isSuccess: boolean;
    isError: boolean;
    error: unknown;
  };
}) {
  if (mutation.isPending) {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        saving
      </span>
    );
  }
  if (mutation.isError) {
    return (
      <span
        className="text-xs text-destructive flex items-center gap-1"
        title={String((mutation.error as Error)?.message ?? "")}
      >
        <AlertCircle className="h-3 w-3" />
        error
      </span>
    );
  }
  if (mutation.isSuccess) {
    return (
      <span className="text-xs text-emerald-500 flex items-center gap-1">
        <Check className="h-3 w-3" />
        saved
      </span>
    );
  }
  return null;
}

/** Flat-ish field list: scalars get inline editors, objects/arrays collapse. */
function FieldList({
  value,
  onSaveScalar,
  editing,
}: {
  value: unknown;
  onSaveScalar: (key: string, v: unknown) => void;
  editing: boolean;
}) {
  if (!isPlainObject(value)) {
    return (
      <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <div className="divide-y rounded-md border">
      {entries.map(([k, v]) => (
        <Row
          key={k}
          name={k}
          value={v}
          editable={isScalar(v)}
          disabled={editing}
          onSave={(nv) => onSaveScalar(k, nv)}
        />
      ))}
    </div>
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

  // Reset when value from server changes (e.g. after save invalidates cache).
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

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return (
    !!x &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.getPrototypeOf(x) === Object.prototype
  );
}

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

function joinSub(dir: string, name: string) {
  if (dir === "/" || dir === "") return `/${name}`;
  return `${dir.replace(/\/$/, "")}/${name}`;
}
