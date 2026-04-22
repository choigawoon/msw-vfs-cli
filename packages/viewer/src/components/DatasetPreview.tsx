import { useMemo } from "react";
import { FileSpreadsheet, Info } from "lucide-react";

import { parseCsv } from "@/lib/csv";

const MAX_ROWS_RENDERED = 2000;

/**
 * Read-only CSV grid. Assumes the first row is a header — matches how MSW
 * DataSet CSVs are authored. For P3.5a-3 we only render (no edit); editing
 * is handled by the `msw-csv-edit` skill.
 */
export function DatasetPreview({
  path,
  text,
  size,
  truncated,
}: {
  path: string;
  text: string;
  size: number;
  truncated: boolean;
}) {
  const { rows, columnCount } = useMemo(() => {
    const parsed = parseCsv(text);
    const cc = parsed.reduce((max, r) => Math.max(max, r.length), 0);
    return { rows: parsed, columnCount: cc };
  }, [text]);

  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const visible = body.slice(0, MAX_ROWS_RENDERED);
  const hidden = body.length - visible.length;
  const name = basename(path);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs truncate">{name}</div>
          <div className="text-[10px] text-muted-foreground">
            {body.length} rows · {columnCount} cols · {formatBytes(size)} ·
            read-only
          </div>
        </div>
      </div>
      <div className="px-4 py-1.5 border-b bg-amber-500/5 text-[11px] text-amber-800 dark:text-amber-200 flex items-center gap-2">
        <Info className="h-3 w-3 shrink-0" />
        <span>
          편집은 <code className="font-mono">msw-csv-edit</code> 스킬에서.
          뷰어는 CSV 그리드 미리보기만 제공 (첫 행은 헤더로 간주).
        </span>
      </div>
      {truncated && (
        <div className="px-4 py-1 border-b bg-amber-500/10 text-[11px] text-amber-900 dark:text-amber-200">
          큰 파일 — 선두 1 MiB 만 로드됨
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="text-xs font-mono min-w-full border-collapse">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
            <tr>
              <th className="px-2 py-1 text-right text-muted-foreground border-r border-b w-12">
                #
              </th>
              {header.map((h, i) => (
                <th
                  key={i}
                  className="px-2 py-1 text-left border-r border-b font-semibold"
                >
                  {h || <span className="text-muted-foreground">col{i}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, ri) => (
              <tr key={ri} className="even:bg-muted/20">
                <td className="px-2 py-0.5 text-right text-muted-foreground/70 border-r tabular-nums">
                  {ri + 1}
                </td>
                {Array.from({ length: columnCount }).map((_, ci) => (
                  <td
                    key={ci}
                    className="px-2 py-0.5 border-r whitespace-nowrap"
                  >
                    {row[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {hidden > 0 && (
          <div className="px-4 py-2 text-xs text-muted-foreground">
            … {hidden} more rows not rendered (grid capped at{" "}
            {MAX_ROWS_RENDERED}).
          </div>
        )}
      </div>
    </div>
  );
}

function basename(p: string) {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}
