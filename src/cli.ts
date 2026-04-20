#!/usr/bin/env node
// msw-vfs CLI entry point.
//
// Dispatches by file extension (.map / .ui / .gamelogic / .model / world.yaml)
// to the appropriate VFS handler. Mirrors the output format of the legacy
// Python msw_vfs.py so existing skill prompts keep working unchanged.

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { EntitiesVFS, type ActionResult, type SaveResult } from './vfs/entities';
import { MapVFS } from './vfs/map';
import { UIVFS } from './vfs/ui';
import { GameLogicVFS } from './vfs/gamelogic';
import { ModelVFS } from './model/vfs';
import { ALL_TYPE_KEYS, type TypeKey } from './model/types';
import type { JsonDict } from './types';

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

Mutation commands (map/ui/gamelogic):
  edit <path> --set key=value [...] [-o out]
  add-entity <parent> <name> [-c Type ...] [--model-id ID]
                               [--disabled] [--invisible] [-o out]
  remove-entity <path> [-o out]
  edit-entity <path> --set key=value [...] [-o out]
  rename-entity <path> <new-name> [-o out]
  add-component <entity> <Type> [--properties JSON] [-o out]
  remove-component <entity> <Type> [-o out]
  validate

Model commands (.model):
  info                                    model metadata
  list                                    list Values[] entries
  get <name> [--target-type T]            look up one value
  set <name> <json-value>                 set (or add) a Value
        [--target-type T]
        [--type single|int32|int64|string|boolean|
                 vector2|vector3|color|quaternion|dataref]
        [-o out]
  remove <name> [--target-type T] [-o out]
  validate

Values after --set are parsed as JSON first; falling back to raw string.
Without -o, mutations overwrite the input file in place.

Not yet implemented: YAML import/export, build-world.
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

function peelList(args: string[], ...names: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; ) {
    if (names.includes(args[i]) && i + 1 < args.length) {
      out.push(args[i + 1]);
      args.splice(i, 2);
    } else {
      i += 1;
    }
  }
  return out;
}

function parseKv(pairs: string[]): JsonDict | { error: string } {
  const out: JsonDict = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) return { error: `invalid --set (need key=value): ${pair}` };
    const k = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1);
    let v: any;
    try {
      v = JSON.parse(raw);
    } catch {
      v = raw;
    }
    out[k] = v;
  }
  return out;
}

function parseJson(raw: string, label: string): any {
  try {
    return JSON.parse(raw);
  } catch (e: any) {
    die(`${label}: invalid JSON — ${e.message ?? String(e)}`);
  }
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

// ── Mutation handlers ───────────────────────────

function runMutation(vfs: EntitiesVFS, action: ActionResult, outputPath: string | null): void {
  if ('error' in action) {
    process.stdout.write(
      JSON.stringify({ action, save: { skipped: true } }, null, 2) + '\n',
    );
    process.exit(1);
  }
  const saveR: SaveResult = vfs.save(outputPath);
  process.stdout.write(JSON.stringify({ action, save: saveR }, null, 2) + '\n');
  if (!saveR.ok) process.exit(1);
}

function cmdEdit(vfs: EntitiesVFS, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const setKv = peelList(rest, '--set');
  const p = rest[0];
  if (!p) die('edit: path required');
  const parsed = parseKv(setKv);
  if ('error' in parsed) die(parsed.error);
  runMutation(vfs, vfs.edit(p, parsed as JsonDict), output);
}

function cmdAddEntity(vfs: EntitiesVFS, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const components = peelList(rest, '-c', '--component');
  const modelId = peelFlag(rest, '--model-id');
  const disabled = peelBool(rest, '--disabled');
  const invisible = peelBool(rest, '--invisible');
  const parentPath = rest[0];
  const name = rest[1];
  if (!parentPath || !name) die('add-entity: parent_path and name required');
  runMutation(
    vfs,
    vfs.addEntity(parentPath, name, {
      components,
      modelId,
      enable: !disabled,
      visible: !invisible,
    }),
    output,
  );
}

function cmdRemoveEntity(vfs: EntitiesVFS, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const p = rest[0];
  if (!p) die('remove-entity: path required');
  runMutation(vfs, vfs.removeEntity(p), output);
}

function cmdEditEntity(vfs: EntitiesVFS, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const setKv = peelList(rest, '--set');
  const p = rest[0];
  if (!p) die('edit-entity: path required');
  const parsed = parseKv(setKv);
  if ('error' in parsed) die(parsed.error);
  runMutation(vfs, vfs.editEntity(p, parsed as JsonDict), output);
}

function cmdRenameEntity(vfs: EntitiesVFS, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const p = rest[0];
  const newName = rest[1];
  if (!p || !newName) die('rename-entity: path and new_name required');
  runMutation(vfs, vfs.renameEntity(p, newName), output);
}

function cmdAddComponent(vfs: EntitiesVFS, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const propsJson = peelFlag(rest, '--properties');
  const entityPath = rest[0];
  const typeName = rest[1];
  if (!entityPath || !typeName) die('add-component: entity_path and type_name required');
  const props = propsJson ? parseJson(propsJson, '--properties') : undefined;
  runMutation(vfs, vfs.addComponent(entityPath, typeName, props), output);
}

function cmdRemoveComponent(vfs: EntitiesVFS, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const entityPath = rest[0];
  const typeName = rest[1];
  if (!entityPath || !typeName) die('remove-component: entity_path and type_name required');
  runMutation(vfs, vfs.removeComponent(entityPath, typeName), output);
}

function cmdValidate(vfs: EntitiesVFS, _rest: string[]): void {
  process.stdout.write(JSON.stringify(vfs.validate(), null, 2) + '\n');
}

// ── Model command handlers ──────────────────────

function cmdModelInfo(mv: ModelVFS): void {
  process.stdout.write(JSON.stringify(mv.info(), null, 2) + '\n');
}

function cmdModelList(mv: ModelVFS): void {
  const items = mv.listValues();
  for (const it of items) {
    const tt = it.target_type ? ` [TargetType=${it.target_type}]` : '';
    const typeShort = it.type_key || it.type;
    const valRepr = typeof it.value === 'object' && it.value !== null
      ? JSON.stringify(it.value)
      : String(it.value);
    process.stdout.write(
      `${it.name.padEnd(30)} ${typeShort.padEnd(12)} = ${valRepr}${tt}\n`,
    );
  }
  process.stderr.write(`--- ${items.length} values ---\n`);
}

function cmdModelGet(mv: ModelVFS, rest: string[]): void {
  const targetType = peelFlag(rest, '--target-type');
  const name = rest[0];
  if (!name) die('get: name required');
  const v = mv.get(name, targetType);
  if (v === null) {
    process.stderr.write(`'${name}' not found\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(v) + '\n');
}

function cmdModelSet(mv: ModelVFS, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const targetType = peelFlag(rest, '--target-type');
  const typeFlag = peelFlag(rest, '--type');
  if (typeFlag !== null && !ALL_TYPE_KEYS.includes(typeFlag as TypeKey)) {
    die(`--type must be one of: ${ALL_TYPE_KEYS.join('|')}`);
  }
  const name = rest[0];
  const raw = rest[1];
  if (!name || raw === undefined) die('set: name and value required');

  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  // Preserve Python's int/float distinction: if the raw string contains '.'
  // or 'e'/'E' (scientific), and user didn't override --type, force 'single'.
  let effectiveTypeKey: TypeKey | null = (typeFlag as TypeKey | null) ?? null;
  if (
    effectiveTypeKey === null &&
    typeof value === 'number' &&
    Number.isInteger(value) &&
    /[.eE]/.test(raw)
  ) {
    effectiveTypeKey = 'single';
  }

  const action = mv.set(name, value, targetType, effectiveTypeKey);
  const save = mv.save(output);
  process.stdout.write(JSON.stringify({ set: action, save }, null, 2) + '\n');
  if (!save.ok) process.exit(1);
}

function cmdModelRemove(mv: ModelVFS, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const targetType = peelFlag(rest, '--target-type');
  const name = rest[0];
  if (!name) die('remove: name required');
  const action = mv.remove(name, targetType);
  if (!action.ok) {
    process.stderr.write(JSON.stringify(action) + '\n');
    process.exit(1);
  }
  const save = mv.save(output);
  process.stdout.write(JSON.stringify({ remove: action, save }, null, 2) + '\n');
  if (!save.ok) process.exit(1);
}

function cmdModelValidate(mv: ModelVFS): void {
  process.stdout.write(JSON.stringify(mv.validate(), null, 2) + '\n');
}

function dispatchModel(file: string, cmd: string, rest: string[]): void {
  const mv = new ModelVFS(file);
  switch (cmd) {
    case 'info': cmdModelInfo(mv); break;
    case 'list': cmdModelList(mv); break;
    case 'get': cmdModelGet(mv, rest); break;
    case 'set': cmdModelSet(mv, rest); break;
    case 'remove': cmdModelRemove(mv, rest); break;
    case 'validate': cmdModelValidate(mv); break;
    default: die(`unknown model command: ${cmd}`);
  }
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
  edit: cmdEdit,
  'add-entity': cmdAddEntity,
  'remove-entity': cmdRemoveEntity,
  'edit-entity': cmdEditEntity,
  'rename-entity': cmdRenameEntity,
  'add-component': cmdAddComponent,
  'remove-component': cmdRemoveComponent,
  validate: cmdValidate,
};

const UNIMPLEMENTED_ENTITIES = new Set([
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
    const modelCmd = cmd === 'ls' ? 'list' : cmd;
    dispatchModel(file, modelCmd, args);
    return 0;
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
