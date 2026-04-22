import { FileCode, Info } from "lucide-react";

/**
 * Read-only `.mlua` preview — plain monospace with line numbers. The viewer
 * intentionally skips syntax highlighting and editing; MSW creators use the
 * mlua-lsp skill (or their own editor) for that. This pane exists so the
 * workspace sidebar can reveal the shape of the code without a separate app.
 */
export function ScriptPreview({
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
  const name = basename(path);
  const lines = text.split("\n");
  const lineNumWidth = String(lines.length).length;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
        <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs truncate">{name}</div>
          <div className="text-[10px] text-muted-foreground">
            {formatBytes(size)} · read-only preview
          </div>
        </div>
      </div>
      <div className="px-4 py-1.5 border-b bg-amber-500/5 text-[11px] text-amber-800 dark:text-amber-200 flex items-center gap-2">
        <Info className="h-3 w-3 shrink-0" />
        <span>
          편집은 IDE 또는 <code className="font-mono">mlua-lsp</code> 스킬에서.
          뷰어는 구조 확인용 미리보기만 제공.
        </span>
      </div>
      {truncated && (
        <div className="px-4 py-1 border-b bg-amber-500/10 text-[11px] text-amber-900 dark:text-amber-200">
          큰 파일 — 선두 1 MiB 만 표시됨
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto font-mono text-xs">
        <table className="min-w-full">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="align-top">
                <td
                  className="select-none text-right text-muted-foreground/60 px-3 py-0 tabular-nums border-r"
                  style={{ width: `${lineNumWidth + 2}ch` }}
                >
                  {i + 1}
                </td>
                <td className="px-3 py-0 whitespace-pre">{line || " "}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
