#!/usr/bin/env node
// msw-vfs CLI entry point.
//
// Dispatches by file extension (.map / .ui / .gamelogic / .model / world.yaml)
// to the appropriate VFS handler. Mirrors the output format of the legacy
// Python msw_vfs.py so existing skill prompts keep working unchanged.

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { EntitiesVFS } from './vfs/entities';
import { MapVFS } from './vfs/map';
import { UIVFS } from './vfs/ui';
import { GameLogicVFS } from './vfs/gamelogic';

const PKG_VERSION = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
    );
    return pkg.version as string;
  } catch {
    return 'unknown';
  }
})();

const EXT_TO_TYPE: Record<string, string> = {
  '.map': 'map',
  '.ui': 'ui',
  '.gamelogic': 'gamelogic',
  '.model': 'model',
};

const USAGE = `msw-vfs ${PKG_VERSION}

Usage:
  msw-vfs <file> <command> [args...]
  msw-vfs --type <map|ui|gamelogic|model|world> <file> <command> [args...]
  msw-vfs --help | --version

Type is auto-detected from file extension.

Read commands (map/ui/gamelogic):
  ls [path] [-l]                       list directory
  read <path> [--raw] [--offset N] [--limit N]
  tree [path] [-d N | --depth N]
  glob <pattern> [path] [--max-results N]
  grep <pattern> [path] [--head-limit N] [--output-mode content|files_with_matches|count]
  stat <path>
  summary

Mutation / YAML / model: not yet implemented in this build.
Track progress: https://github.com/choigawoon/msw-vfs-cli
`;

function die(msg: string, code = 1): never {
  process.stderr.write(`msw-vfs: ${msg}\n`);
  process.exit(code);
}

// ── argv helpers ────────────────────────────────

function peelFlag(args: string[], ...names: string[]): string | null {
  for (const name of names) {
    const idx = args.indexOf(name);
    if (idx !== -1) {
      if (idx + 1 >= args.length) die(`${name} requires a value`);
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

function expectInt(val: string | null, fallback: number | null, name: string): number | null {
  if (val === null) return fallback;
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) die(`${name} must be an integer`);
  return n;
}

// ── Type detection ──────────────────────────────

function detectType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext in EXT_TO_TYPE) return EXT_TO_TYPE[ext];
  if (ext === '.yaml' || ext === '.yml') {
    try {
      const text = readFileSync(filePath, 'utf8');
      // Best-effort JSON first (yaml support lands with P3).
      const data = JSON.parse(text);
      if (data && typeof data === 'object') {
        if ('world' in data) return 'world';
        const ct = (data.meta && (data.meta as any).ContentType) || '';
        if (ct === 'x-mod/map') return 'map';
        if (ct === 'x-mod/ui') return 'ui';
        if (ct === 'x-mod/gamelogic') return 'gamelogic';
      }
    } catch {
      // yaml parsing not available in this phase — fall through.
    }
    return 'unknown';
  }
  return 'unknown';
}

function makeEntitiesVfs(type: string, file: string): EntitiesVFS {
  switch (type) {
    case 'map': return new MapVFS(file);
    case 'ui': return new UIVFS(file);
    case 'gamelogic': return new GameLogicVFS(file);
    default: die(`unsupported type for entities commands: ${type}`);
  }
}

// ── Command handlers ─────────────────────────────

function cmdLs(vfs: EntitiesVFS, rest: string[]): void {
  const long = peelBool(rest, '-l', '--long');
  const p = rest[0] ?? '/';
  const r = vfs.ls(p, long);
  if ('error' in r) die(r.error);
  if ('items' in r) {
    for (const item of r.items) {
      if (item.type === 'dir') {
        const name = item.name + '/';
        if (long && item.entity) {
          const cc = item.components?.length ?? 0;
          const nc = item.children_count ?? 0;
          let info = `${cc} comp`;
          if (nc > 0) info += `, ${nc} child`;
          process.stdout.write(`${name.padEnd(44)} [${info}]\n`);
        } else {
          process.stdout.write(`${name}\n`);
        }
      } else {
        process.stdout.write(`${item.name}\n`);
      }
    }
  }
}

function cmdRead(vfs: EntitiesVFS, rest: string[]): void {
  const raw = peelBool(rest, '--raw');
  const offset = expectInt(peelFlag(rest, '--offset'), 0, '--offset')!;
  const limit = expectInt(peelFlag(rest, '--limit'), 2000, '--limit')!;
  const p = rest[0];
  if (!p) die('read: path required');
  const r = vfs.read(p, !raw);
  if ('error' in r) die(r.error);
  const data = 'content' in r ? r.content : r.metadata;
  const text = JSON.stringify(data, null, 2);
  const lines = text.split('\n');
  const selected = lines.slice(offset, offset + limit);
  selected.forEach((line, i) => {
    process.stdout.write(`${offset + i + 1}\t${line}\n`);
  });
  if (offset + limit < lines.length) {
    process.stdout.write(
      `... (${lines.length - offset - limit} more lines, use --offset ${offset + limit} to continue)\n`,
    );
  }
}

function cmdTree(vfs: EntitiesVFS, rest: string[]): void {
  const depth = expectInt(peelFlag(rest, '-d', '--depth'), null, '--depth');
  const p = rest[0] ?? '/';
  const text = vfs.treeText(p, depth);
  if (text.startsWith('Error:')) die(text);
  process.stdout.write(text + '\n');
}

function cmdGlob(vfs: EntitiesVFS, rest: string[]): void {
  const maxResults = expectInt(peelFlag(rest, '--max-results'), 100, '--max-results')!;
  const pattern = rest[0];
  if (!pattern) die('glob: pattern required');
  const p = rest[1] ?? '/';
  const results = vfs.search(pattern, p);
  for (let i = 0; i < results.length; i += 1) {
    if (i >= maxResults) {
      process.stdout.write(`... (${results.length - maxResults} more results)\n`);
      break;
    }
    const suffix = results[i].type === 'dir' ? '/' : '';
    process.stdout.write(results[i].path + suffix + '\n');
  }
}

function cmdGrep(vfs: EntitiesVFS, rest: string[]): void {
  const headLimit = expectInt(peelFlag(rest, '--head-limit'), 50, '--head-limit')!;
  const mode = peelFlag(rest, '--output-mode') ?? 'content';
  if (!['content', 'files_with_matches', 'count'].includes(mode)) {
    die(`--output-mode must be content|files_with_matches|count`);
  }
  const pattern = rest[0];
  if (!pattern) die('grep: pattern required');
  const p = rest[1] ?? '/';
  const results = vfs.grep(pattern, p);
  if (!Array.isArray(results) && 'error' in results) die(results.error);
  const arr = results as { path: string; matches: { key: string; value: any }[] }[];
  if (mode === 'count') {
    const total = arr.reduce((s, r) => s + r.matches.length, 0);
    process.stdout.write(`${total} matches in ${arr.length} files\n`);
  } else if (mode === 'files_with_matches') {
    for (let i = 0; i < arr.length; i += 1) {
      if (i >= headLimit) {
        process.stdout.write(`... (${arr.length - headLimit} more files)\n`);
        break;
      }
      process.stdout.write(arr[i].path + '\n');
    }
  } else {
    let printed = 0;
    outer: for (const r of arr) {
      for (const m of r.matches) {
        if (printed >= headLimit) {
          const remaining = arr.reduce((s, rr) => s + rr.matches.length, 0) - printed;
          process.stdout.write(`... (${remaining} more matches)\n`);
          break outer;
        }
        let val: any = m.value;
        if (val !== null && (typeof val === 'object' || Array.isArray(val))) {
          val = JSON.stringify(val);
        }
        process.stdout.write(`${r.path}:${m.key}: ${val}\n`);
        printed += 1;
      }
    }
  }
}

function cmdStat(vfs: EntitiesVFS, rest: string[]): void {
  const p = rest[0];
  if (!p) die('stat: path required');
  const r = vfs.stat(p);
  if (r && typeof r === 'object' && 'error' in r) die((r as any).error);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
}

function cmdSummary(vfs: EntitiesVFS, _rest: string[]): void {
  process.stdout.write(JSON.stringify(vfs.summary(), null, 2) + '\n');
}

// ── Dispatcher ──────────────────────────────────

type Handler = (vfs: EntitiesVFS, rest: string[]) => void;

const ENTITIES_HANDLERS: Record<string, Handler> = {
  ls: cmdLs,
  read: cmdRead,
  tree: cmdTree,
  glob: cmdGlob,
  grep: cmdGrep,
  stat: cmdStat,
  summary: cmdSummary,
};

const UNIMPLEMENTED_ENTITIES = new Set([
  'edit', 'add-entity', 'remove-entity', 'edit-entity', 'rename-entity',
  'add-component', 'remove-component', 'validate',
  'export-yaml', 'import-yaml',
]);

function dispatchEntities(type: string, file: string, cmd: string, rest: string[]): void {
  if (UNIMPLEMENTED_ENTITIES.has(cmd)) {
    die(`'${cmd}' is not yet implemented in this build (P2/P3). Use the Python msw_vfs.py for now.`, 70);
  }
  const handler = ENTITIES_HANDLERS[cmd];
  if (!handler) die(`unknown command for ${type}: ${cmd}. Run msw-vfs --help.`);
  const vfs = makeEntitiesVfs(type, file);
  handler(vfs, rest);
}

function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args[0] === '--version' || args[0] === '-v') {
    process.stdout.write(`${PKG_VERSION}\n`);
    return 0;
  }

  let explicitType: string | null = null;
  if (args[0] === '--type') {
    explicitType = args[1] ?? null;
    if (!explicitType) die('--type requires a value');
    args.splice(0, 2);
  }

  const file = args.shift();
  const cmd = args.shift() ?? 'ls';
  if (!file) die('missing file argument. Run msw-vfs --help.');

  const type = explicitType ?? detectType(file);
  if (type === 'unknown') {
    die(`cannot detect asset type for '${file}'. Pass --type explicitly.`);
  }

  if (type === 'model') {
    die(`model commands are not yet implemented in this build (P3). Use the Python model_vfs.py for now.`, 70);
  }
  if (type === 'world') {
    die(`world commands are not yet implemented in this build (P3). Use the Python msw_vfs.py for now.`, 70);
  }

  dispatchEntities(type, file, cmd, args);
  return 0;
}

try {
  process.exit(main(process.argv));
} catch (err: any) {
  process.stderr.write(`msw-vfs: ${err?.stack ?? err}\n`);
  process.exit(1);
}
