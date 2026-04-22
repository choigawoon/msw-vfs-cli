import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, CircleDot, Pencil, Search, X } from "lucide-react";
import { vfsDaemonMeta } from "@/lib/vfs";
import { Button } from "@/components/ui/button";

/**
 * Live stream of daemon /rpc + session lifecycle events. Subscribes to the
 * SSE endpoint once the panel is first opened; keeps the connection for
 * the lifetime of the window.
 *
 * Events are color-coded by client source (ai/viewer/cli). Default filter
 * hides non-mutation noise; toggle surface the rest.
 */

type Client = "ai" | "viewer" | "cli";

type RpcEvent = {
  kind: "rpc";
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
  recorded?: { sessionId: string; eventId: string };
};

type SessionStartEvent = {
  kind: "session-start";
  sessionId: string;
  startedAt: number;
  labels: Record<string, string>;
};

type SessionStopEvent = {
  kind: "session-stop";
  sessionId: string;
  endedAt: number;
  exit: "shutdown" | "idle-timeout" | "manual-stop" | "crash";
  eventCount: number;
};

type HelloEvent = {
  kind: "hello";
  session: {
    active: boolean;
    sessionId: string | null;
    eventCount: number;
  };
};

type BroadcastEvent = RpcEvent | SessionStartEvent | SessionStopEvent | HelloEvent;

type StreamEntry = {
  seq: number;
  event: BroadcastEvent;
};

const MAX_ENTRIES = 500;

/** Commands whose first positional argument is an entity path, not a
 *  component file path. Matters when resolving a row click to a tree
 *  selection. */
const ENTITY_FIRST_ARG_CMDS = new Set([
  "read-entity",
  "edit-entity",
  "edit-component",
  "add-entity",
  "add-component",
  "remove-entity",
  "remove-component",
  "list-entities",
  "grep-entities",
  "find-entities",
]);

/** Extract (file, entityPath?) from an rpc event for the "jump to target"
 *  interaction. Returns null if the event has no resolvable target. */
export function parseEventTarget(
  e: RpcEvent,
): { file: string; entityPath?: string } | null {
  if (!e.file) return null;
  if (!e.cmd) return { file: e.file };
  if (ENTITY_FIRST_ARG_CMDS.has(e.cmd)) {
    const first = e.args.find((a) => a.startsWith("/"));
    if (first) return { file: e.file, entityPath: first };
  }
  return { file: e.file };
}

type ConnState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "err"; message: string };

export function ActivityPanel({
  onClose,
  onNavigate,
  onRpc,
}: {
  onClose: () => void;
  /** Called when the user clicks a row that has a resolvable target. */
  onNavigate?: (target: { file: string; entityPath?: string }) => void;
  /** Called for every rpc event. Home listens to auto-reload on AI
   *  mutations of the currently open file. */
  onRpc?: (event: RpcEvent) => void;
}) {
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [conn, setConn] = useState<ConnState>({ kind: "idle" });
  const [showMutationOnly, setShowMutationOnly] = useState(false);
  const [hiddenClients, setHiddenClients] = useState<Set<Client>>(
    () => new Set(),
  );
  const [session, setSession] = useState<{
    active: boolean;
    sessionId: string | null;
    eventCount: number;
  }>({ active: false, sessionId: null, eventCount: 0 });

  const seqRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [autoscroll, setAutoscroll] = useState(true);

  // Keep listener refs so the SSE subscription stays stable across
  // parent re-renders that replace the callbacks.
  const onRpcRef = useRef(onRpc);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onRpcRef.current = onRpc;
    onNavigateRef.current = onNavigate;
  }, [onRpc, onNavigate]);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    async function connect() {
      setConn({ kind: "connecting" });
      try {
        const meta = await vfsDaemonMeta();
        if (cancelled) return;
        const url = `http://${meta.host}:${meta.port}/events`;
        const es = new EventSource(url);
        source = es;
        es.onopen = () => {
          if (!cancelled) setConn({ kind: "open" });
        };
        es.onerror = () => {
          if (!cancelled) setConn({ kind: "err", message: "connection lost" });
        };
        es.onmessage = (m) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(m.data) as BroadcastEvent;
            if (data.kind === "hello") {
              setSession({
                active: data.session.active,
                sessionId: data.session.sessionId,
                eventCount: data.session.eventCount,
              });
              return;
            }
            if (data.kind === "session-start") {
              setSession({
                active: true,
                sessionId: data.sessionId,
                eventCount: 0,
              });
            } else if (data.kind === "session-stop") {
              setSession((s) =>
                s.sessionId === data.sessionId
                  ? { active: false, sessionId: null, eventCount: 0 }
                  : s,
              );
            } else if (data.kind === "rpc") {
              if (data.client === "ai") {
                setSession((s) =>
                  s.active ? { ...s, eventCount: s.eventCount + 1 } : s,
                );
              }
              try { onRpcRef.current?.(data); } catch { /* listener errors are ignored */ }
            }
            setEntries((prev) => {
              const next = prev.concat({ seq: ++seqRef.current, event: data });
              if (next.length > MAX_ENTRIES) {
                return next.slice(next.length - MAX_ENTRIES);
              }
              return next;
            });
          } catch {
            /* malformed frame — drop */
          }
        };
      } catch (e: any) {
        if (!cancelled) setConn({ kind: "err", message: errMsg(e) });
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (source) source.close();
    };
  }, []);

  useEffect(() => {
    if (!autoscroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries, autoscroll]);

  const filtered = useMemo(() => {
    return entries.filter(({ event }) => {
      if (event.kind !== "rpc") return true;
      if (showMutationOnly && !event.mutation) return false;
      if (hiddenClients.has(event.client)) return false;
      return true;
    });
  }, [entries, showMutationOnly, hiddenClients]);

  function toggleClient(c: Client) {
    setHiddenClients((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[480px] max-h-[70vh] rounded-lg border bg-card shadow-xl flex flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Activity className="h-4 w-4 text-primary" />
        <div className="text-sm font-semibold">Activity</div>
        <RecordingBadge conn={conn} session={session} />
        <button
          onClick={onClose}
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex items-center gap-1 border-b px-3 py-1.5 text-[11px]">
        <FilterChip
          label="ai"
          color="bg-blue-500"
          active={!hiddenClients.has("ai")}
          onClick={() => toggleClient("ai")}
        />
        <FilterChip
          label="viewer"
          color="bg-slate-400"
          active={!hiddenClients.has("viewer")}
          onClick={() => toggleClient("viewer")}
        />
        <FilterChip
          label="cli"
          color="bg-amber-500"
          active={!hiddenClients.has("cli")}
          onClick={() => toggleClient("cli")}
        />
        <button
          onClick={() => setShowMutationOnly((v) => !v)}
          className={`ml-2 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
            showMutationOnly
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <Pencil className="h-3 w-3" />
          mutation only
        </button>
        <button
          onClick={() => setEntries([])}
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          clear
        </button>
        <label className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.target.checked)}
            className="h-3 w-3"
          />
          autoscroll
        </label>
      </div>

      <div
        ref={listRef}
        className="flex-1 min-h-[160px] overflow-auto font-mono text-[11px]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (!atBottom && autoscroll) setAutoscroll(false);
        }}
      >
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-xs">
            {conn.kind === "open" ? (
              <>
                <Search className="mx-auto mb-1 h-4 w-4" />
                Listening — no matching events yet.
              </>
            ) : conn.kind === "err" ? (
              <>Could not connect: {conn.message}</>
            ) : (
              <>Connecting…</>
            )}
          </div>
        ) : (
          filtered.map((e) => (
            <EventRow
              key={e.seq}
              entry={e}
              onNavigate={(t) => onNavigateRef.current?.(t)}
            />
          ))
        )}
      </div>

      {session.active && (
        <footer className="border-t px-3 py-1.5 text-[11px] text-muted-foreground font-mono truncate">
          session · {session.sessionId} · {session.eventCount} events
        </footer>
      )}
    </div>
  );
}

function EventRow({
  entry,
  onNavigate,
}: {
  entry: StreamEntry;
  onNavigate: (t: { file: string; entityPath?: string }) => void;
}) {
  const ts = new Date(entry.event.kind === "rpc" ? entry.event.ts : Date.now());
  const timeStr = ts.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  if (entry.event.kind === "session-start") {
    return (
      <div className="px-3 py-1 border-b bg-blue-500/5 text-blue-800 dark:text-blue-300">
        <CircleDot className="inline h-3 w-3 mr-1" />
        session started · {entry.event.sessionId}
      </div>
    );
  }
  if (entry.event.kind === "session-stop") {
    return (
      <div className="px-3 py-1 border-b bg-slate-500/5 text-slate-700 dark:text-slate-400">
        session stopped ({entry.event.exit}) · {entry.event.eventCount} events
      </div>
    );
  }
  if (entry.event.kind === "hello") {
    return null;
  }

  const e = entry.event;
  const fileName = e.file ? e.file.split(/[/\\]/).pop() : null;
  const statusColor =
    e.status === "error" ? "text-destructive" : "text-foreground";
  const target = parseEventTarget(e);
  const clickable = target !== null;
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onNavigate(target!) : undefined}
      onKeyDown={
        clickable
          ? (ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onNavigate(target!);
              }
            }
          : undefined
      }
      className={`px-3 py-1 border-b flex gap-2 items-baseline ${
        clickable ? "hover:bg-accent/40 cursor-pointer" : "hover:bg-accent/20"
      }`}
      title={
        clickable
          ? target!.entityPath
            ? `Jump to ${target!.entityPath}`
            : `Open ${fileName}`
          : undefined
      }
    >
      <span className="text-muted-foreground tabular-nums">{timeStr}</span>
      <ClientBadge client={e.client} />
      {e.mutation && (
        <span
          className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1 text-[10px]"
          title="mutation command"
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
        <span className="text-destructive text-[10px]">✗ {e.exitCode}</span>
      )}
    </div>
  );
}

function ClientBadge({ client }: { client: Client }) {
  const color =
    client === "ai"
      ? "bg-blue-500 text-white"
      : client === "viewer"
        ? "bg-slate-400 text-white"
        : "bg-amber-500 text-white";
  return (
    <span className={`rounded px-1 text-[10px] uppercase ${color}`}>
      {client}
    </span>
  );
}

function FilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
        active
          ? "border-border text-foreground"
          : "border-border text-muted-foreground line-through opacity-60"
      }`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </button>
  );
}

function RecordingBadge({
  conn,
  session,
}: {
  conn: ConnState;
  session: { active: boolean };
}) {
  if (conn.kind === "err") {
    return (
      <span className="text-[10px] text-destructive font-mono">offline</span>
    );
  }
  if (conn.kind !== "open") {
    return (
      <span className="text-[10px] text-muted-foreground font-mono">…</span>
    );
  }
  if (session.active) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-destructive">
        <span className="inline-block h-2 w-2 rounded-full bg-destructive animate-pulse" />
        rec
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground">
      <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />
      idle
    </span>
  );
}

export function ActivityToggle({
  open,
  onToggle,
  hasUnread,
}: {
  open: boolean;
  onToggle: () => void;
  hasUnread: boolean;
}) {
  if (open) return null;
  return (
    <Button
      onClick={onToggle}
      size="sm"
      variant="outline"
      className="fixed bottom-4 right-4 z-30 shadow-md"
      title="Show live CLI activity"
    >
      <Activity className="mr-1.5 h-3.5 w-3.5" />
      Activity
      {hasUnread && (
        <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
      )}
    </Button>
  );
}

function errMsg(e: unknown): string {
  if (typeof e === "object" && e && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}
