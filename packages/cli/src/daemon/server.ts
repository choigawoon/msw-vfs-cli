// HTTP daemon that keeps VFS instances in memory across requests.
//
// Protocol:
//   POST /rpc { argv, client? }  -> { stdout, stderr, code }
//   GET  /ping                   -> { ok, version, startedAt, cache, session }
//   GET  /events                 -> text/event-stream (live rpc + session
//                                    lifecycle events; all clients, viewer
//                                    filters by source badge)
//   GET  /session                -> current session status
//   POST /session/stop           -> close active session
//   POST /shutdown { token }     -> { ok }
//   GET  /cache                  -> cacheStats()
//
// The argv handed to /rpc is whatever comes after `msw-vfs` in the CLI.
// The daemon runs it through the same dispatcher the CLI would, with
// stdout/stderr/exit intercepted per-request via AsyncLocalStorage.

import * as http from 'node:http';
import { randomBytes } from 'node:crypto';

import { runCaptured } from './capture';
import { installCacheFactories, cacheStats, clearCache, invalidate } from './cache';
import {
  writeLock,
  removeLock,
  type DaemonMeta,
} from './lockfile';
import {
  SessionRecorder,
  parseArgv,
  isMutationCmd,
  type SessionEvent,
  type LifecycleEvent,
} from './recorder';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

export interface ServeOptions {
  host?: string;
  port?: number;
  idleMs?: number;
  version: string;
  /** Dispatcher invoked per /rpc call; receives full argv as passed after `msw-vfs`. */
  dispatch: (argv: string[]) => number;
}

/** A live SSE subscriber. Server keeps a list and writes every broadcast
 *  frame to each; dead sockets are pruned on next write. */
interface SseSubscriber {
  id: string;
  res: http.ServerResponse;
}

/** Broadcast envelope. kind distinguishes command traffic from session
 *  lifecycle so viewer can style them differently. */
type BroadcastEvent =
  | {
      kind: 'rpc';
      ts: number;
      durationMs: number;
      client: 'ai' | 'viewer' | 'cli';
      file: string | null;
      cmd: string | null;
      args: string[];
      status: 'ok' | 'error';
      exitCode: number;
      mutation: boolean;
      stdoutBytes: number;
      stderrBytes: number;
      /** Set when the event was persisted into the current session. */
      recorded?: { sessionId: string; eventId: string };
    }
  | LifecycleEvent;

export function startDaemon(opts: ServeOptions): Promise<DaemonMeta> {
  const host = opts.host ?? '127.0.0.1';
  const idleMs = opts.idleMs ?? IDLE_TIMEOUT_MS;
  const token = randomBytes(16).toString('hex');
  const startedAt = Date.now();

  installCacheFactories();

  // SSE subscribers. One list for the whole daemon; all events broadcast
  // to every listener — viewer filters client-side.
  const subscribers: SseSubscriber[] = [];
  const broadcast = (evt: BroadcastEvent) => {
    const frame = `data: ${JSON.stringify(evt)}\n\n`;
    for (let i = subscribers.length - 1; i >= 0; i--) {
      try {
        subscribers[i].res.write(frame);
      } catch {
        subscribers.splice(i, 1);
      }
    }
  };

  // Recorder emits through broadcast too, so viewer sees ai events with
  // their session id + event id (enables "open in Replay" later).
  let lastSessionEventByTs = new Map<number, SessionEvent>();
  const recorder = new SessionRecorder({
    cliVersion: opts.version,
    onEvent: (e) => {
      lastSessionEventByTs.set(e.ts, e);
    },
    onLifecycle: (e) => broadcast(e),
  });

  let lastActivity = Date.now();
  let serverRef: http.Server;
  const server = http.createServer((req, res) => {
    lastActivity = Date.now();
    handleRequest(req, res, {
      token,
      startedAt,
      version: opts.version,
      dispatch: opts.dispatch,
      server: serverRef,
      recorder,
      subscribers,
      broadcast,
      pendingSessionEvents: lastSessionEventByTs,
    }).catch((e) => {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: String(e?.stack ?? e) }));
    });
  });
  serverRef = server;

  // Keep-alive ping so SSE connections don't get GC'd by proxies; harmless
  // comment line per spec.
  const sseKeepAlive = setInterval(() => {
    for (let i = subscribers.length - 1; i >= 0; i--) {
      try {
        subscribers[i].res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        subscribers.splice(i, 1);
      }
    }
  }, 30 * 1000);
  sseKeepAlive.unref();

  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > idleMs) {
      process.stderr.write('msw-vfs daemon: idle timeout, shutting down.\n');
      recorder.stop('idle-timeout');
      shutdown(server);
    }
  }, 60 * 1000);
  idleTimer.unref();

  // Flush session on abnormal exit paths.
  const flushOnExit = (reason: 'shutdown' | 'crash') => () => recorder.stop(reason);
  process.once('SIGINT', flushOnExit('shutdown'));
  process.once('SIGTERM', flushOnExit('shutdown'));
  process.once('uncaughtException', flushOnExit('crash'));

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('failed to bind'));
        return;
      }
      const meta: DaemonMeta = {
        pid: process.pid,
        port: addr.port,
        host,
        version: opts.version,
        startedAt,
        nodeVersion: process.version,
        token,
      };
      writeLock(meta);
      resolve(meta);
    });
  });
}

function shutdown(server: http.Server): void {
  removeLock();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: {
    token: string;
    startedAt: number;
    version: string;
    dispatch: (argv: string[]) => number;
    server: http.Server;
    recorder: SessionRecorder;
    subscribers: SseSubscriber[];
    broadcast: (e: BroadcastEvent) => void;
    pendingSessionEvents: Map<number, SessionEvent>;
  },
): Promise<void> {
  // /events upgrades the response to SSE; every other endpoint is JSON.
  if (req.method === 'GET' && req.url === '/events') {
    handleSse(req, res, state);
    return;
  }

  res.setHeader('content-type', 'application/json');

  if (req.method === 'GET' && req.url === '/ping') {
    res.end(JSON.stringify({
      ok: true,
      version: state.version,
      startedAt: state.startedAt,
      pid: process.pid,
      cache: { entries: cacheStats().entries },
      session: state.recorder.status(),
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/session') {
    res.end(JSON.stringify(state.recorder.status()));
    return;
  }

  if (req.method === 'POST' && req.url === '/session/stop') {
    state.recorder.stop('manual-stop');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && req.url === '/cache') {
    res.end(JSON.stringify(cacheStats()));
    return;
  }

  if (req.method === 'POST' && req.url === '/rpc') {
    const body = await readBody(req);
    let payload: { argv?: string[]; invalidate?: string[]; client?: string };
    try {
      payload = JSON.parse(body || '{}');
    } catch (e: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: `invalid JSON body: ${e.message}` }));
      return;
    }
    if (!Array.isArray(payload.argv)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'argv must be an array' }));
      return;
    }
    if (Array.isArray(payload.invalidate)) {
      for (const f of payload.invalidate) invalidate(f);
    }
    const client = normalizeClient(payload.client);
    const t0 = Date.now();
    const result = runCaptured(() => {
      state.dispatch(['node', 'msw-vfs', ...payload.argv!]);
    });
    const durationMs = Date.now() - t0;

    const { file, cmd, args } = parseArgv(payload.argv!);
    const mutation = isMutationCmd(cmd);
    const stdoutBytes = Buffer.byteLength(result.stdout, 'utf8');
    const stderrBytes = Buffer.byteLength(result.stderr, 'utf8');
    const status: 'ok' | 'error' = result.code === 0 ? 'ok' : 'error';

    // Record only ai-originated traffic; viewer/cli bypass the session
    // file so manual browsing doesn't pollute replay artifacts.
    let recorded: { sessionId: string; eventId: string } | undefined;
    if (client === 'ai') {
      state.recorder.record({
        ts: t0,
        durationMs,
        file,
        cmd,
        args,
        status,
        exitCode: result.code,
        mutation,
        stdoutBytes,
        stderrBytes,
      });
      const rec = state.pendingSessionEvents.get(t0);
      if (rec) {
        state.pendingSessionEvents.delete(t0);
        const sid = state.recorder.status().sessionId;
        if (sid) recorded = { sessionId: sid, eventId: rec.id };
      }
    }
    // Broadcast every /rpc to SSE subscribers — viewer shows all clients
    // with a source badge; filtering happens in the UI.
    state.broadcast({
      kind: 'rpc',
      ts: t0,
      durationMs,
      client,
      file,
      cmd,
      args,
      status,
      exitCode: result.code,
      mutation,
      stdoutBytes,
      stderrBytes,
      recorded,
    });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'POST' && req.url === '/shutdown') {
    const body = await readBody(req);
    let payload: { token?: string };
    try { payload = JSON.parse(body || '{}'); } catch { payload = {}; }
    if (payload.token !== state.token) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'bad token' }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
    state.recorder.stop('manual-stop');
    setTimeout(() => shutdown(state.server), 100).unref();
    return;
  }

  if (req.method === 'POST' && req.url === '/cache/clear') {
    clearCache();
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
}

function normalizeClient(v: unknown): 'ai' | 'viewer' | 'cli' {
  if (v === 'ai' || v === 'viewer' || v === 'cli') return v;
  return 'cli';
}

function handleSse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  state: {
    recorder: SessionRecorder;
    subscribers: SseSubscriber[];
    broadcast: (e: BroadcastEvent) => void;
  },
): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  // Disable response compression / proxy buffering.
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();

  // Hello frame so clients know the connection is live. Includes current
  // session state so a fresh subscriber can render without waiting for
  // the next /rpc call.
  res.write(
    `: hello\n` +
      `data: ${JSON.stringify({ kind: 'hello', session: state.recorder.status() })}\n\n`,
  );

  const sub: SseSubscriber = { id: randomBytes(4).toString('hex'), res };
  state.subscribers.push(sub);

  const cleanup = () => {
    const idx = state.subscribers.indexOf(sub);
    if (idx !== -1) state.subscribers.splice(idx, 1);
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
