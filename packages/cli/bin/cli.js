#!/usr/bin/env node
'use strict';

// msw-vfs — CLI for reading/editing MSW .map/.ui/.gamelogic/.model assets.
//
// Thin launcher with a fast-path:
//   1) If a daemon lockfile is present and the user didn't opt out, proxy
//      the call over HTTP without loading the full CLI. This keeps the
//      client-side cost to just Node startup.
//   2) On any failure (no lock, stale, timeout, meta commands), fall back
//      to requiring dist/cli.js and running the regular dispatcher.

const path = require('path');
const fs = require('fs');
const os = require('os');

const DAEMON_META_PATH = path.join(os.homedir(), '.msw-vfs', 'daemon.json');

// Commands that manipulate or operate in the caller's own process — never proxy.
// - daemon / stop / status: HTTP daemon lifecycle
// - serve: stdin/stdout pipe (needs its own stdin)
const LOCAL_ONLY_SUBCMDS = new Set(['daemon', 'serve', 'stop', 'status', 'session']);

// --version is served from package.json alone, without requiring the TS
// build output. This keeps the Tauri viewer's version probe working in dev
// before the first `npm run build`. --help is NOT short-circuited — the
// real help text lives in the built dist and we want tests/users to see it.
function tryServeMetaFromPkg(argv) {
  if (argv.length === 0) return false;
  const a0 = argv[0];
  if (a0 !== '--version' && a0 !== '-v') return false;
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  } catch (_) {
    return false;
  }
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

function fallbackToLocal() {
  try {
    const mod = require(path.join(__dirname, '..', 'dist', 'cli.js'));
    if (typeof mod.runCli === 'function') {
      mod.runCli();
    }
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && /dist[\\/]cli\.js/.test(err.message)) {
      process.stderr.write(
        'msw-vfs: compiled output not found. Run `npm run build` first.\n',
      );
      process.exit(2);
    }
    throw err;
  }
}

function shouldTryProxy(argv) {
  if (process.env.MSW_VFS_NO_DAEMON === '1') return false;
  if (argv.length === 0) return false;
  const a0 = argv[0];
  if (a0 === '--help' || a0 === '-h' || a0 === '--version' || a0 === '-v') return false;
  if (LOCAL_ONLY_SUBCMDS.has(a0)) return false;
  return true;
}

function readDaemonMeta() {
  try {
    const text = fs.readFileSync(DAEMON_META_PATH, 'utf8');
    const m = JSON.parse(text);
    if (typeof m.port === 'number' && typeof m.host === 'string' && typeof m.pid === 'number') {
      return m;
    }
  } catch (_) {
    // no lockfile or unreadable
  }
  return null;
}

function normalizeClient(v) {
  if (v === 'ai' || v === 'viewer' || v === 'cli') return v;
  return 'cli';
}

// Peel `--ai` or `--client <tag>` from argv (mutates). Returns the tag or
// null if no flag was present. Caller falls back to MSW_VFS_CLIENT env on
// null. Args form is preferred over env: explicit at the call site, scoped
// to one invocation, doesn't leak to grandchild processes.
function peelClient(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ai') {
      argv.splice(i, 1);
      return 'ai';
    }
    if (a === '--client' && i + 1 < argv.length) {
      const v = argv[i + 1];
      if (v === 'ai' || v === 'viewer' || v === 'cli') {
        argv.splice(i, 2);
        return v;
      }
    }
    if (a && a.startsWith('--client=')) {
      const v = a.slice('--client='.length);
      if (v === 'ai' || v === 'viewer' || v === 'cli') {
        argv.splice(i, 1);
        return v;
      }
    }
  }
  return null;
}

function tryProxy(argv, client) {
  const meta = readDaemonMeta();
  if (!meta) return false;

  const http = require('http');
  const tag = client ?? normalizeClient(process.env.MSW_VFS_CLIENT);
  const payload = JSON.stringify({ argv, client: tag });

  return new Promise((resolve) => {
    const req = http.request(
      {
        host: meta.host,
        port: meta.port,
        method: 'POST',
        path: '/rpc',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload).toString(),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(false);
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (
              typeof body.stdout === 'string' &&
              typeof body.stderr === 'string' &&
              typeof body.code === 'number'
            ) {
              if (body.stdout) process.stdout.write(body.stdout);
              if (body.stderr) process.stderr.write(body.stderr);
              process.exit(body.code);
              return;
            }
          } catch (_) {
            // fall through to fallback
          }
          resolve(false);
        });
        res.on('error', () => resolve(false));
      },
    );
    req.setTimeout(60 * 1000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.write(payload);
    req.end();
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const client = peelClient(argv);
  // Mirror peeled state into process.argv so the dist fallback (cli.ts)
  // sees the same cleaned argv and the same client tag — keeps both
  // entrypoints idempotent on the flag.
  process.argv = [process.argv[0], process.argv[1], ...argv];
  if (shouldTryProxy(argv)) {
    const ok = await tryProxy(argv, client);
    if (ok) return; // tryProxy called process.exit on success
  }
  // Try to serve version/help from package.json before requiring dist, so
  // the viewer's `--version` probe works even before the first build.
  tryServeMetaFromPkg(argv);
  fallbackToLocal();
}

main().catch((err) => {
  process.stderr.write(`msw-vfs: ${(err && err.stack) || err}\n`);
  process.exit(1);
});
