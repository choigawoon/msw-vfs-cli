// Thin HTTP client for the msw-vfs daemon.
//
// Invoked by cli.ts before dispatching locally: if a daemon is running
// on the recorded port and responds to /ping in time, read-only and
// mutation commands are proxied to it. On any failure (no lock, refused,
// timeout) the caller falls back to local parsing.

import * as http from 'node:http';

import { readLock, removeLock, isProcessAlive, type DaemonMeta } from './lockfile';

const PING_TIMEOUT_MS = 400;
const RPC_TIMEOUT_MS = 60 * 1000;

export interface RpcResult {
  stdout: string;
  stderr: string;
  code: number;
}

function request(
  meta: DaemonMeta,
  method: 'GET' | 'POST',
  path: string,
  body: any,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: meta.host,
        port: meta.port,
        method,
        path,
        headers: payload
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload).toString(),
            }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`daemon request timeout (${timeoutMs}ms)`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function pingDaemon(): Promise<DaemonMeta | null> {
  const meta = readLock();
  if (!meta) return null;
  if (!isProcessAlive(meta.pid)) {
    removeLock();
    return null;
  }
  try {
    const res = await request(meta, 'GET', '/ping', undefined, PING_TIMEOUT_MS);
    if (res.status === 200) return meta;
  } catch {
    // fall through
  }
  return null;
}

export async function proxyRpc(
  argv: string[],
  client?: 'ai' | 'viewer' | 'cli',
): Promise<RpcResult | null> {
  const meta = await pingDaemon();
  if (!meta) return null;
  try {
    const res = await request(
      meta,
      'POST',
      '/rpc',
      { argv, client: client ?? 'cli' },
      RPC_TIMEOUT_MS,
    );
    if (res.status !== 200) return null;
    const parsed = JSON.parse(res.body) as RpcResult;
    if (
      typeof parsed.stdout !== 'string' ||
      typeof parsed.stderr !== 'string' ||
      typeof parsed.code !== 'number'
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function requestShutdown(): Promise<boolean> {
  const meta = readLock();
  if (!meta) return false;
  try {
    const res = await request(meta, 'POST', '/shutdown', { token: meta.token }, 2000);
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function getStatus(): Promise<{ alive: boolean; meta: DaemonMeta | null; ping?: any }> {
  const meta = readLock();
  if (!meta) return { alive: false, meta: null };
  if (!isProcessAlive(meta.pid)) {
    removeLock();
    return { alive: false, meta: null };
  }
  try {
    const res = await request(meta, 'GET', '/ping', undefined, PING_TIMEOUT_MS);
    if (res.status !== 200) return { alive: false, meta };
    return { alive: true, meta, ping: JSON.parse(res.body) };
  } catch {
    return { alive: false, meta };
  }
}
