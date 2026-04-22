import { useQuery } from "@tanstack/react-query";
import { Loader2, Package } from "lucide-react";

import { vfsModelValues, type ModelListItem, type MapSummary } from "@/lib/vfs";

/** Read-only view for .model files (entity templates).
 *  Shows model metadata + Values[] override table. Editing lands in a
 *  follow-up phase — for now the template view unblocks browsing. */
export function ModelView({
  assetPath,
  summary,
}: {
  assetPath: string;
  summary: MapSummary;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["model-values", assetPath],
    queryFn: () => vfsModelValues(assetPath),
    staleTime: 30_000,
  });

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <section className="border rounded-md overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b">
          <Package className="h-3 w-3 text-primary/70" />
          <span className="text-xs font-semibold">Model template</span>
          <span className="ml-auto text-[10px] text-muted-foreground font-mono truncate max-w-[60%]">
            {String(summary.model_id ?? "")}
          </span>
        </header>
        <div className="divide-y text-sm">
          <MetaRow label="name" value={String(summary.name ?? "")} />
          <MetaRow label="id" value={String(summary.model_id ?? "")} />
          <MetaRow
            label="base_model_id"
            value={String(summary.base_model_id ?? "")}
          />
          <MetaRow
            label="core_version"
            value={String(summary.core_version ?? "")}
          />
          <MetaRow
            label="values"
            value={String(summary.values_count ?? 0)}
          />
        </div>
      </section>

      <section className="border rounded-md overflow-hidden">
        <header className="flex items-center gap-2 px-3 py-1.5 bg-muted/40 border-b">
          <span className="text-xs font-semibold">Values</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {data ? `${data.length} entries` : ""}
          </span>
        </header>
        {isLoading && (
          <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}
        {error && (
          <pre className="p-3 text-xs text-destructive whitespace-pre-wrap">
            {(error as Error).message}
          </pre>
        )}
        {data && (
          <div className="divide-y">
            {data.map((v) => (
              <ValueRow key={`${v.target_type ?? ""}::${v.name}`} item={v} />
            ))}
            {data.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No overrides.
              </div>
            )}
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Editing model values is coming in a later phase. For now, use the CLI:{" "}
        <code className="font-mono">msw-vfs &lt;file.model&gt; set &lt;name&gt; &lt;value&gt;</code>.
      </p>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <div className="w-32 shrink-0 font-mono text-xs text-muted-foreground pt-0.5 truncate">
        {label}
      </div>
      <div className="flex-1 min-w-0 font-mono text-xs break-all">{value}</div>
    </div>
  );
}

function ValueRow({ item }: { item: ModelListItem }) {
  const typeLabel = item.type_key || item.type;
  const repr =
    typeof item.value === "object" && item.value !== null
      ? JSON.stringify(item.value)
      : String(item.value);
  return (
    <div className="flex items-start gap-3 px-3 py-1.5 text-sm">
      <div className="w-40 shrink-0 font-mono text-xs pt-1 truncate">
        {item.name}
      </div>
      <div className="w-24 shrink-0 text-[10px] text-muted-foreground font-mono pt-1.5">
        {typeLabel}
        {item.target_type ? ` · ${item.target_type}` : ""}
      </div>
      <div className="flex-1 min-w-0 font-mono text-xs pt-1 break-all">
        {repr}
      </div>
    </div>
  );
}
