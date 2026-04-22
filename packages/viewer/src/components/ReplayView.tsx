import { useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Film,
  Pencil,
  X,
} from "lucide-react";
import { readTextFile } from "@/lib/vfs";
import { Button } from "@/components/ui/button";

/**
 * Offline replay of a recorded session (`.jsonl` file written by the
 * daemon SessionRecorder). Shows header metadata, a scrubbable timeline,
 * and per-event detail — built so teammates can open a session file
 * without needing the original workspace.
 *
 * Out of scope for this iteration:
 *   - Virtual file state reconstruction (requires snapshot + patch
 *     support in the recorder — P-AI0-6.next).
 *   - Play/pause/speed — MVP is scrubbing only; once the visual cue is
 *     good, advancing on a timer is a trivial addition.
 */

type Client = "ai" | "viewer" | "cli";

interface SessionEvent {
  kind: "event";
  id: string;
  ts: number;
  durationMs: number;
  client: Client;
  file: string | null;
  cmd: string | null;
  args: string[];
  status: "ok" | "error";
  exitCode: number;
  mutation: boolean;
  stdoutBytes: number;
  stderrBytes: number;
}

interface SessionHeader {
  kind: "header";
  sessionId: string;
  cliVersion: string;
  startedAt: number;
  labels: Record<string, string>;
  nodeVersion: string;
  pid: number;
}

interface SessionFooter {
  kind: "footer";
  endedAt: number;
  exit: "shutdown" | "idle-timeout" | "manual-stop" | "crash";
  eventCount: number;
}

interface ParsedSession {
  header: SessionHeader;
  events: SessionEvent[];
  footer: SessionFooter | null;
  filePath: string;
}

type LoadState =
  | { kind: "loading"; path: string }
  | { kind: "ok"; session: ParsedSession }
  | { kind: "err"; message: string; path: string };

export function ReplayView({
  filePath,
  onClose,
}: {
  filePath: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading", path: filePath });
  const [cursor, setCursor] = useState(0);
  const [showMutationOnly, setShowMutationOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading", path: filePath });
    readTextFile(filePath, 16 * 1024 * 1024)
      .then((payload) => {
        if (cancelled) return;
        try {
          const session = parseSession(payload.text, filePath);
          setState({ kind: "ok", session });
          setCursor(session.events.length > 0 ? session.events.length - 1 : 0);
        } catch (e: any) {
          setState({
            kind: "err",
            message: `parse failed: ${e?.message ?? e}`,
            path: filePath,
          });
        }
      })
      .catch((e: any) => {
        if (cancelled) return;
        setState({ kind: "err", message: errMsg(e), path: filePath });
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (state.kind === "loading") {
    return (
      <ReplayShell onClose={onClose}>
        <div className="p-6 text-sm text-muted-foreground">Loading session…</div>
      </ReplayShell>
    );
  }
  if (state.kind === "err") {
    return (
      <ReplayShell onClose={onClose}>
        <div className="p-6">
          <div className="text-destructive text-sm font-semibold mb-2">
            Failed to open session
          </div>
          <div className="text-xs font-mono break-all mb-1">{state.path}</div>
          <div className="text-xs text-muted-foreground">{state.message}</div>
        </div>
      </ReplayShell>
    );
  }

  const { session } = state;
  const events = session.events;
  const filtered = showMutationOnly ? events.filter((e) => e.mutation) : events;
  const cursorClamped = Math.min(cursor, Math.max(0, filtered.length - 1));
  const selected = filtered[cursorClamped] ?? null;

  return (
    <ReplayShell onClose={onClose}>
      <SessionHeaderBar session={session} />
      <div className="border-b px-4 py-2 flex items-center gap-3 text-xs">
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => setCursor((c) => Math.max(0, c - 1))}
          disabled={cursorClamped === 0}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <input
          type="range"
          min={0}
          max={Math.max(0, filtered.length - 1)}
          value={cursorClamped}
          onChange={(e) => setCursor(parseInt(e.target.value, 10))}
          className="flex-1"
          disabled={filtered.length === 0}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() =>
            setCursor((c) => Math.min(filtered.length - 1, c + 1))
          }
          disabled={cursorClamped >= filtered.length - 1}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <span className="tabular-nums text-muted-foreground whitespace-nowrap">
          {filtered.length === 0 ? "—" : `${cursorClamped + 1} / ${filtered.length}`}
        </span>
        <label className="inline-flex items-center gap-1 ml-2 text-muted-foreground">
          <input
            type="checkbox"
            checked={showMutationOnly}
            onChange={(e) => {
              setShowMutationOnly(e.target.checked);
              setCursor(0);
            }}
          />
          mutation only
        </label>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_320px]">
        <div className="overflow-auto font-mono text-[11px] border-r">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-xs">
              No events{showMutationOnly ? " (try disabling 'mutation only')" : ""}.
            </div>
          ) : (
            filtered.map((e, i) => (
              <EventRow
                key={e.id}
                e={e}
                active={i === cursorClamped}
                startTs={session.header.startedAt}
                onClick={() => setCursor(i)}
              />
            ))
          )}
        </div>
        <aside className="overflow-auto text-xs p-3">
          {selected ? (
            <EventDetail event={selected} startTs={session.header.startedAt} />
          ) : (
            <div className="text-muted-foreground">Pick an event.</div>
          )}
        </aside>
      </div>
    </ReplayShell>
  );
}

function ReplayShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-2">
        <Film className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">Session Replay</div>
        <div className="text-[10px] text-muted-foreground font-mono ml-2">
          read-only · file system untouched
        </div>
        <button
          onClick={onClose}
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Close replay"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {children}
    </div>
  );
}

function SessionHeaderBar({ session }: { session: ParsedSession }) {
  const h = session.header;
  const f = session.footer;
  const duration = f ? f.endedAt - h.startedAt : null;
  const labelPairs = Object.entries(h.labels);
  return (
    <div className="border-b px-4 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="font-mono font-semibold">{h.sessionId}</div>
      <div className="text-muted-foreground">
        CLI {h.cliVersion} · Node {h.nodeVersion} · pid {h.pid}
      </div>
      <div className="text-muted-foreground">
        {new Date(h.startedAt).toLocaleString()}
      </div>
      {duration !== null && (
        <div className="text-muted-foreground inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(duration)}
        </div>
      )}
      <div className="text-muted-foreground">
        {session.events.length} events
      </div>
      {f && (
        <div className="text-muted-foreground">exit: {f.exit}</div>
      )}
      {labelPairs.length > 0 && (
        <div className="inline-flex gap-1 flex-wrap">
          {labelPairs.map(([k, v]) => (
            <span
              key={k}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono"
            >
              {k}={v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({
  e,
  active,
  startTs,
  onClick,
}: {
  e: SessionEvent;
  active: boolean;
  startTs: number;
  onClick: () => void;
}) {
  const offset = e.ts - startTs;
  const fileName = e.file ? e.file.split(/[/\\]/).pop() : null;
  const statusColor =
    e.status === "error" ? "text-destructive" : "text-foreground";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onClick();
        }
      }}
      className={`px-3 py-1 border-b flex gap-2 items-baseline cursor-pointer hover:bg-accent/40 ${
        active ? "bg-primary/10 ring-1 ring-primary" : ""
      }`}
    >
      <span className="text-muted-foreground tabular-nums w-14 shrink-0">
        +{formatOffset(offset)}
      </span>
      {e.mutation && (
        <span
          className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1 text-[10px]"
          title="mutation"
        >
          <Pencil className="h-2.5 w-2.5" />
          edit
        </span>
      )}
      <span className={`font-semibold ${statusColor}`}>{e.cmd ?? "—"}</span>
      {fileName && (
        <span className="text-muted-foreground truncate" title={e.file ?? ""}>
          {fileName}
        </span>
      )}
      {e.args.length > 0 && (
        <span className="text-muted-foreground truncate">
          {e.args.join(" ")}
        </span>
      )}
      <span className="ml-auto tabular-nums text-muted-foreground">
        {e.durationMs}ms
      </span>
      {e.status === "error" && (
        <span className="text-destructive">✗ {e.exitCode}</span>
      )}
    </div>
  );
}

function EventDetail({
  event,
  startTs,
}: {
  event: SessionEvent;
  startTs: number;
}) {
  const offset = event.ts - startTs;
  return (
    <div className="space-y-2">
      <div className="font-mono font-semibold text-sm">{event.id}</div>
      <KV k="cmd" v={event.cmd ?? "—"} />
      <KV
        k="status"
        v={
          <span
            className={event.status === "error" ? "text-destructive" : ""}
          >
            {event.status} ({event.exitCode})
          </span>
        }
      />
      <KV
        k="when"
        v={`+${formatOffset(offset)} · ${new Date(event.ts).toLocaleTimeString()}`}
      />
      <KV k="duration" v={`${event.durationMs}ms`} />
      <KV k="mutation" v={String(event.mutation)} />
      {event.file && <KV k="file" v={<code className="break-all">{event.file}</code>} />}
      {event.args.length > 0 && (
        <div>
          <div className="text-muted-foreground uppercase text-[10px] tracking-wide mb-0.5">
            args
          </div>
          <pre className="bg-muted rounded px-2 py-1 font-mono text-[10px] whitespace-pre-wrap break-all">
            {event.args.map((a, i) => (
              <span key={i}>
                {i > 0 && " "}
                {a.includes(" ") ? JSON.stringify(a) : a}
              </span>
            ))}
          </pre>
        </div>
      )}
      <KV
        k="output"
        v={`${event.stdoutBytes}B stdout · ${event.stderrBytes}B stderr`}
      />
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-baseline">
      <div className="text-muted-foreground uppercase text-[10px] tracking-wide w-20 shrink-0">
        {k}
      </div>
      <div className="flex-1 font-mono text-[11px] min-w-0">{v}</div>
    </div>
  );
}

function parseSession(text: string, filePath: string): ParsedSession {
  const lines = text.split("\n").filter(Boolean);
  let header: SessionHeader | null = null;
  let footer: SessionFooter | null = null;
  const events: SessionEvent[] = [];
  for (const line of lines) {
    const obj = JSON.parse(line);
    if (obj.kind === "header") header = obj;
    else if (obj.kind === "footer") footer = obj;
    else if (obj.kind === "event") events.push(obj);
    // Unknown kinds (snapshot in future versions) are ignored so old
    // viewers stay forward-compatible.
  }
  if (!header) {
    throw new Error("session file has no header line");
  }
  return { header, events, footer, filePath };
}

function formatOffset(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${mins}m${rem.toFixed(0).padStart(2, "0")}s`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  const rs = s - mins * 60;
  return `${mins}m ${rs}s`;
}

function errMsg(e: unknown): string {
  if (typeof e === "object" && e && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/** Placeholder retained for future API — keeps ArrowRight import alive
 *  while we wire the Open-in-Workspace action in a follow-up. */
void ArrowRight;
