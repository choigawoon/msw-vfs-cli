// Session recorder for AI-originated CLI traffic.
//
// Appends a JSONL event stream to ~/.msw-vfs/sessions/s_<ts>_<id>.jsonl
// whenever a client=ai request hits /rpc. Viewer/cli clients are ignored —
// manual human browsing never produces a session file.
//
// Lifecycle (P-AI0-2 scope):
//   - Lazy start on first ai call (header line written)
//   - One event per /rpc call (cmd/args/status/durationMs/mutation flag)
//   - Close on daemon shutdown OR after 5min of no ai calls (footer line)
//
// Out of scope for this phase: file snapshots + before/after patches
// (P-AI0-6 adds them when replay needs them). Pause/resume and label
// management land in P-AI0-3 alongside the session subcommands.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomBytes } from 'node:crypto';

const AI_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min of no ai traffic → close

const MUTATION_CMDS = new Set([
  'edit',
  'edit-entity',
  'edit-component',
  'add-entity',
  'add-component',
  'remove-entity',
  'remove-component',
  'set',
  'remove',
  'build-world',
]);

export interface SessionHeader {
  kind: 'header';
  sessionId: string;
  cliVersion: string;
  startedAt: number;
  labels: Record<string, string>;
  /** Node version of the daemon host — useful when debugging replay drift. */
  nodeVersion: string;
  pid: number;
}

export interface SessionEvent {
  kind: 'event';
  id: string;
  ts: number;
  durationMs: number;
  client: 'ai';
  /** argv[0] after the `msw-vfs` prefix — the target file. May be a flag
   *  like --help / --version for meta calls; those are still recorded. */
  file: string | null;
  /** First non-file arg — what the CLI would dispatch on. */
  cmd: string | null;
  args: string[];
  status: 'ok' | 'error';
  exitCode: number;
  /** Whether the command is known to mutate on-disk state. Used by viewer
   *  to filter Activity panel to "edits only" by default. */
  mutation: boolean;
  stdoutBytes: number;
  stderrBytes: number;
}

export interface SessionFooter {
  kind: 'footer';
  endedAt: number;
  exit: 'shutdown' | 'idle-timeout' | 'manual-stop' | 'crash';
  eventCount: number;
}

export interface SessionStatus {
  active: boolean;
  sessionId: string | null;
  filePath: string | null;
  eventCount: number;
  startedAt: number | null;
  lastAiAt: number | null;
}

export interface RecorderDeps {
  cliVersion: string;
  now?: () => number;
  /** Override the session directory (tests use a tmp dir). */
  sessionDir?: string;
}

/**
 * Session recorder. One instance per daemon process.
 *
 * Not thread-safe because Node is single-threaded on the event loop path;
 * synchronous appendFileSync keeps ordering simple. If a future recorder
 * emits during high-fanout concurrent RPCs we'll swap to a write queue.
 */
export class SessionRecorder {
  private readonly cliVersion: string;
  private readonly now: () => number;
  private readonly sessionDir: string;

  private sessionId: string | null = null;
  private filePath: string | null = null;
  private startedAt: number | null = null;
  private eventCount = 0;
  private eventSeq = 0;
  private lastAiAt: number | null = null;
  private labels: Record<string, string> = {};
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(deps: RecorderDeps) {
    this.cliVersion = deps.cliVersion;
    this.now = deps.now ?? (() => Date.now());
    this.sessionDir = deps.sessionDir ?? path.join(os.homedir(), '.msw-vfs', 'sessions');
  }

  status(): SessionStatus {
    return {
      active: this.sessionId !== null,
      sessionId: this.sessionId,
      filePath: this.filePath,
      eventCount: this.eventCount,
      startedAt: this.startedAt,
      lastAiAt: this.lastAiAt,
    };
  }

  /** Record one event. Lazily opens a session on first ai call. */
  record(e: Omit<SessionEvent, 'kind' | 'id' | 'client'>): void {
    this.ensureSession();
    this.lastAiAt = this.now();
    const event: SessionEvent = {
      kind: 'event',
      id: `evt_${String(++this.eventSeq).padStart(6, '0')}`,
      client: 'ai',
      ...e,
    };
    this.appendLine(event);
    this.eventCount++;
    this.resetIdleTimer();
  }

  /** Close the current session. No-op if none open. */
  stop(reason: SessionFooter['exit']): void {
    if (!this.sessionId) return;
    const footer: SessionFooter = {
      kind: 'footer',
      endedAt: this.now(),
      exit: reason,
      eventCount: this.eventCount,
    };
    try {
      this.appendLine(footer);
    } catch {
      // best-effort — don't block daemon shutdown on a failed flush
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.sessionId = null;
    this.filePath = null;
    this.startedAt = null;
    this.eventCount = 0;
    this.eventSeq = 0;
    this.lastAiAt = null;
    this.labels = {};
  }

  /** For tests: force-open a session without waiting for an event. */
  openForTest(labels: Record<string, string> = {}): void {
    this.labels = { ...labels };
    this.ensureSession();
  }

  private ensureSession(): void {
    if (this.sessionId) return;
    const ts = this.now();
    const id = randomBytes(3).toString('hex');
    this.sessionId = `s_${formatTs(ts)}_${id}`;
    fs.mkdirSync(this.sessionDir, { recursive: true });
    this.filePath = path.join(this.sessionDir, `${this.sessionId}.jsonl`);
    this.startedAt = ts;
    const header: SessionHeader = {
      kind: 'header',
      sessionId: this.sessionId,
      cliVersion: this.cliVersion,
      startedAt: ts,
      labels: this.labels,
      nodeVersion: process.version,
      pid: process.pid,
    };
    this.appendLine(header);
    this.resetIdleTimer();
  }

  private appendLine(obj: unknown): void {
    if (!this.filePath) return;
    fs.appendFileSync(this.filePath, JSON.stringify(obj) + '\n', 'utf8');
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.stop('idle-timeout');
    }, AI_IDLE_TIMEOUT_MS);
    // Do not keep the process alive for the sake of this timer.
    this.idleTimer.unref();
  }
}

/** Classify a /rpc argv as a mutation or not. Shared so the daemon and
 *  later replay code agree. */
export function isMutationCmd(cmd: string | null): boolean {
  return cmd !== null && MUTATION_CMDS.has(cmd);
}

/** Extract file + cmd from a raw argv as passed to /rpc. Mirrors cli.ts
 *  runMain layout: `[--type T]? <file> <cmd> <args…>`. */
export function parseArgv(argv: string[]): {
  file: string | null;
  cmd: string | null;
  args: string[];
} {
  const a = argv.slice();
  if (a[0] === '--type' && a.length >= 2) a.splice(0, 2);
  if (a.length === 0) return { file: null, cmd: null, args: [] };
  if (a[0] === '--help' || a[0] === '-h' || a[0] === '--version' || a[0] === '-v') {
    return { file: null, cmd: a[0], args: a.slice(1) };
  }
  const file = a[0];
  const cmd = a[1] ?? 'ls';
  const args = a.slice(2);
  return { file, cmd, args };
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
