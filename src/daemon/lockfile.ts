// Daemon metadata lock file.
//
// Written by `msw-vfs serve`, consulted by every other CLI invocation to
// decide whether to proxy to the daemon or parse locally. Stored at
// ~/.msw-vfs/daemon.json. No locking; daemon rewrites on startup, clears on
// shutdown, and clients gracefully fall back to local if the daemon is stale.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface DaemonMeta {
  pid: number;
  port: number;
  host: string;
  version: string;
  startedAt: number;
  nodeVersion: string;
  token: string;
}

export function lockDir(): string {
  return path.join(os.homedir(), '.msw-vfs');
}

export function lockPath(): string {
  return path.join(lockDir(), 'daemon.json');
}

export function readLock(): DaemonMeta | null {
  try {
    const text = fs.readFileSync(lockPath(), 'utf8');
    const meta = JSON.parse(text) as DaemonMeta;
    if (
      typeof meta.port !== 'number' ||
      typeof meta.pid !== 'number' ||
      typeof meta.token !== 'string'
    ) {
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

export function writeLock(meta: DaemonMeta): void {
  fs.mkdirSync(lockDir(), { recursive: true });
  fs.writeFileSync(lockPath(), JSON.stringify(meta, null, 2), 'utf8');
}

export function removeLock(): void {
  try {
    fs.unlinkSync(lockPath());
  } catch {
    // already gone
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM';
  }
}
