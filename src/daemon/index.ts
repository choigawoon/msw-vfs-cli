// CLI entry points for daemon management: serve / stop / status.
//
// These are NEVER proxied — they manipulate the daemon itself.

import { startDaemon } from './server';
import { requestShutdown, getStatus } from './client';
import { removeLock, readLock, isProcessAlive } from './lockfile';
import { installInterceptors } from './capture';
import { runServePipe } from './serve';
import { runMain } from '../cli';

function peelFlag(args: string[], ...names: string[]): string | null {
  for (const name of names) {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) {
      const val = args[idx + 1];
      args.splice(idx, 2);
      return val;
    }
  }
  return null;
}

function peelBool(args: string[], ...names: string[]): boolean {
  for (const name of names) {
    const idx = args.indexOf(name);
    if (idx !== -1) {
      args.splice(idx, 1);
      return true;
    }
  }
  return false;
}

export async function runDaemonSubcommand(
  subcmd: string,
  args: string[],
  version: string,
): Promise<number> {
  if (subcmd === 'daemon') {
    return cmdDaemon(args, version);
  }
  if (subcmd === 'serve') {
    return runServePipe({ dispatch: (argv) => runMain(argv) });
  }
  if (subcmd === 'stop') {
    return cmdStop();
  }
  if (subcmd === 'status') {
    return cmdStatus();
  }
  process.stderr.write(`msw-vfs: unknown daemon subcommand '${subcmd}'\n`);
  return 1;
}

async function cmdDaemon(args: string[], version: string): Promise<number> {
  const portStr = peelFlag(args, '--port', '-p');
  const host = peelFlag(args, '--host') ?? '127.0.0.1';
  const idleStr = peelFlag(args, '--idle-ms');
  const detach = peelBool(args, '--detach', '-d');
  const quiet = peelBool(args, '--quiet', '-q');

  // If already running, short-circuit.
  const existing = readLock();
  if (existing && isProcessAlive(existing.pid)) {
    if (!quiet) {
      process.stdout.write(
        `msw-vfs daemon already running (pid ${existing.pid}, port ${existing.port})\n`,
      );
    }
    return 0;
  } else if (existing) {
    removeLock();
  }

  if (detach) {
    // Respawn self with --detach removed, fully decoupled so the parent exits.
    const { spawn } = await import('node:child_process');
    const nodeArgs = [...process.execArgv];
    const script = process.argv[1];
    const childArgs = [
      ...nodeArgs,
      script,
      'daemon',
      ...(portStr ? ['--port', portStr] : []),
      ...(host ? ['--host', host] : []),
      ...(idleStr ? ['--idle-ms', idleStr] : []),
      '--quiet',
    ];
    const child = spawn(process.execPath, childArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    // Give the child a moment to write its lockfile.
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const meta = readLock();
      if (meta && isProcessAlive(meta.pid)) {
        if (!quiet) {
          process.stdout.write(
            `msw-vfs daemon started (pid ${meta.pid}, port ${meta.port})\n`,
          );
        }
        return 0;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    process.stderr.write('msw-vfs daemon: failed to start (no lockfile after 3s)\n');
    return 1;
  }

  installInterceptors();
  const port = portStr ? parseInt(portStr, 10) : 0;
  const idleMs = idleStr ? parseInt(idleStr, 10) : undefined;
  try {
    const meta = await startDaemon({
      host,
      port,
      idleMs,
      version,
      dispatch: (argv) => runMain(argv),
    });
    if (!quiet) {
      process.stdout.write(
        `msw-vfs daemon listening on http://${meta.host}:${meta.port} (pid ${meta.pid})\n`,
      );
    }
    // Keep the process alive; startDaemon returns after listen.
    // The HTTP server keeps the event loop running until idle-timeout or stop.
    return await new Promise<number>((resolve) => {
      process.on('SIGINT', () => {
        removeLock();
        resolve(0);
      });
      process.on('SIGTERM', () => {
        removeLock();
        resolve(0);
      });
    });
  } catch (e: any) {
    process.stderr.write(`msw-vfs serve failed: ${e?.stack ?? e}\n`);
    return 1;
  }
}

async function cmdStop(): Promise<number> {
  const ok = await requestShutdown();
  if (ok) {
    process.stdout.write('msw-vfs daemon: stop requested\n');
    return 0;
  }
  // Fall back to direct signal.
  const meta = readLock();
  if (meta && isProcessAlive(meta.pid)) {
    try {
      process.kill(meta.pid, 'SIGTERM');
      removeLock();
      process.stdout.write(`msw-vfs daemon: sent SIGTERM to pid ${meta.pid}\n`);
      return 0;
    } catch (e: any) {
      process.stderr.write(`msw-vfs stop failed: ${e?.message ?? e}\n`);
      return 1;
    }
  }
  process.stdout.write('msw-vfs daemon: not running\n');
  return 0;
}

async function cmdStatus(): Promise<number> {
  const s = await getStatus();
  if (!s.alive) {
    process.stdout.write('msw-vfs daemon: not running\n');
    return 1;
  }
  process.stdout.write(JSON.stringify({ alive: true, meta: s.meta, ping: s.ping }, null, 2) + '\n');
  return 0;
}
