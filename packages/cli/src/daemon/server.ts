// HTTP daemon that keeps VFS instances in memory across requests.
//
// Protocol (single endpoint):
//   POST /rpc { argv: string[] } -> { stdout, stderr, code }
//   GET  /ping                   -> { ok, version, startedAt, cache: {entries} }
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
import { SessionRecorder, parseArgv, isMutationCmd } from './recorder';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

export interface ServeOptions {
  host?: string;
  port?: number;
  idleMs?: number;
  version: string;
  /** Dispatcher invoked per /rpc call; receives full argv as passed after `msw-vfs`. */
  dispatch: (argv: string[]) => number;
}

export function startDaemon(opts: ServeOptions): Promise<DaemonMeta> {
  const host = opts.host ?? '127.0.0.1';
  const idleMs = opts.idleMs ?? IDLE_TIMEOUT_MS;
  const token = randomBytes(16).toString('hex');
  const startedAt = Date.now();

  installCacheFactories();

  const recorder = new SessionRecorder({ cliVersion: opts.version });

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
    }).catch((e) => {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: String(e?.stack ?? e) }));
    });
  });
  serverRef = server;

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
  },
): Promise<void> {
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

    // Record only ai-originated traffic; viewer/cli bypass the session
    // file so manual browsing doesn't pollute replay artifacts.
    if (client === 'ai') {
      const { file, cmd, args } = parseArgv(payload.argv!);
      state.recorder.record({
        ts: t0,
        durationMs,
        file,
        cmd,
        args,
        status: result.code === 0 ? 'ok' : 'error',
        exitCode: result.code,
        mutation: isMutationCmd(cmd),
        stdoutBytes: Buffer.byteLength(result.stdout, 'utf8'),
        stderrBytes: Buffer.byteLength(result.stderr, 'utf8'),
      });
    }
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

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
