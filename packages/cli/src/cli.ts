#!/usr/bin/env node
// msw-vfs CLI entry point.
//
// Dispatches by file extension (.map / .ui / .gamelogic / .model / world.yaml)
// to the appropriate VFS handler. Mirrors the output format of the legacy
// Python msw_vfs.py so existing skill prompts keep working unchanged.

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { EntitiesEntryParser, type ActionResult, type SaveResult } from './entry/entities';
import { MapEntryParser } from './entry/map';
import { UIEntryParser } from './entry/ui';
import { GameLogicEntryParser } from './entry/gamelogic';
import { ModelEntryParser } from './entry/model';
import { ALL_TYPE_KEYS, type TypeKey } from './model/types';
import { WorldBuilder } from './world/builder';
import { makeEntities, makeModel } from './factory';
import YAML from 'yaml';
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

Primary — entity-oriented (map/ui/gamelogic):
  read-entity <path> [--deep] [--compact]
                                   bundle one entity: metadata + all components
  list-entities [path] [-r|--recursive] [--json]
                                   child entities only (no component files)
  find-entities <pattern> [--by name|component|modelId] [--path START]
                                   search entities (case-insensitive regex)
  grep-entities <pattern> [path] [--head-limit N]
                                   grep, grouped by owning entity
  edit-entity <path> --set key=value [...] [-o out]
                                   edit entity metadata (enable/visible/name/…)
  edit-component <entity> <Type> --set key=value [...] [-o out]
                                   edit component by entity + @type
  add-entity <parent> <name> [-c Type ...] [--model-id ID]
                               [--disabled] [--invisible] [-o out]
  remove-entity <path> [-o out]
  rename-entity <path> <new-name> [-o out]
  add-component <entity> <Type> [--properties JSON] [-o out]
  remove-component <entity> <Type> [-o out]

Advanced — VFS / file-level (map/ui/gamelogic):
  ls [path] [-l] [--json]              list directory
  read <path> [--raw] [--json] [--offset N] [--limit N]
  tree [path] [-d N | --depth N]
  glob <pattern> [path] [--max-results N]
  grep <pattern> [path] [--head-limit N] [--output-mode content|files_with_matches|count]
  stat <path>
  edit <path> --set key=value [...] [-o out]
  summary
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

YAML / World:
  <file.map> export-yaml [-o out.yaml] [--data-dir DIR]
  <file.yaml> import-yaml [-o out.map]
  --type world <world.yaml> build-world -o <dir> [-f values.yaml ...]

Persistent modes (avoid Node startup cost × N calls):
  msw-vfs daemon [--port N] [--host H] [--idle-ms N] [--detach] [--quiet]
                                   HTTP daemon for cross-process shared cache.
                                   When alive, regular commands auto-proxy.
  msw-vfs serve                    stdin/stdout pipe: reads newline-JSON
                                   requests {"argv":[...]}, writes
                                   {"stdout","stderr","code"} responses.
                                   Prints 'ready' to stderr when up.
                                   One Node process amortizes N queries.
  msw-vfs stop                     Stop the HTTP daemon.
  msw-vfs status                   Show daemon status.

Set MSW_VFS_NO_DAEMON=1 to force local parsing (bypass auto-proxy).

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
      const data = YAML.parse(text);
      if (data && typeof data === 'object') {
        if ('world' in data) return 'world';
        const meta = (data as any).meta;
        const ct = meta && typeof meta === 'object' ? meta.ContentType : '';
        if (ct === 'x-mod/map') return 'map';
        if (ct === 'x-mod/ui') return 'ui';
        if (ct === 'x-mod/gamelogic') return 'gamelogic';
        // Fallback: top-level asset_type key from exportYaml output
        const at = (data as any).asset_type;
        if (at === 'map' || at === 'ui' || at === 'gamelogic') return at;
      }
    } catch {
      // fall through
    }
    return 'unknown';
  }
  return 'unknown';
}

function makeEntitiesVfs(type: string, file: string): EntitiesEntryParser {
  if (type !== 'map' && type !== 'ui' && type !== 'gamelogic') {
    die(`unsupported type for entities commands: ${type}`);
  }
  return makeEntities(type, file);
}

// ── Command handlers ─────────────────────────────

function cmdLs(vfs: EntitiesEntryParser, rest: string[]): void {
  const long = peelBool(rest, '-l', '--long');
  const json = peelBool(rest, '--json');
  const p = rest[0] ?? '/';
  const r = vfs.ls(p, long);
  if ('error' in r) die(r.error);
  if (!('items' in r)) return;
  if (json) {
    process.stdout.write(JSON.stringify(r.items) + '\n');
    return;
  }
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

function cmdRead(vfs: EntitiesEntryParser, rest: string[]): void {
  const raw = peelBool(rest, '--raw');
  const json = peelBool(rest, '--json');
  const offset = expectInt(peelFlag(rest, '--offset'), 0, '--offset')!;
  const limit = expectInt(peelFlag(rest, '--limit'), 2000, '--limit')!;
  const p = rest[0];
  if (!p) die('read: path required');
  const r = vfs.read(p, !raw);
  if ('error' in r) die(r.error);
  const data = 'content' in r ? r.content : r.metadata;
  if (json) {
    process.stdout.write(JSON.stringify(data) + '\n');
    return;
  }
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

function cmdTree(vfs: EntitiesEntryParser, rest: string[]): void {
  const depth = expectInt(peelFlag(rest, '-d', '--depth'), null, '--depth');
  const p = rest[0] ?? '/';
  const text = vfs.treeText(p, depth);
  if (text.startsWith('Error:')) die(text);
  process.stdout.write(text + '\n');
}

function cmdGlob(vfs: EntitiesEntryParser, rest: string[]): void {
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

function cmdGrep(vfs: EntitiesEntryParser, rest: string[]): void {
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

function cmdStat(vfs: EntitiesEntryParser, rest: string[]): void {
  const p = rest[0];
  if (!p) die('stat: path required');
  const r = vfs.stat(p);
  if (r && typeof r === 'object' && 'error' in r) die((r as any).error);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
}

function cmdSummary(vfs: EntitiesEntryParser, _rest: string[]): void {
  process.stdout.write(JSON.stringify(vfs.summary(), null, 2) + '\n');
}

// ── Mutation handlers ───────────────────────────

function runMutation(vfs: EntitiesEntryParser, action: ActionResult, outputPath: string | null): void {
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

function cmdEdit(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const setKv = peelList(rest, '--set');
  const p = rest[0];
  if (!p) die('edit: path required');
  const parsed = parseKv(setKv);
  if ('error' in parsed) die(parsed.error);
  runMutation(vfs, vfs.edit(p, parsed as JsonDict), output);
}

function cmdAddEntity(vfs: EntitiesEntryParser, rest: string[]): void {
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

function cmdRemoveEntity(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const p = rest[0];
  if (!p) die('remove-entity: path required');
  runMutation(vfs, vfs.removeEntity(p), output);
}

function cmdEditEntity(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const setKv = peelList(rest, '--set');
  const p = rest[0];
  if (!p) die('edit-entity: path required');
  const parsed = parseKv(setKv);
  if ('error' in parsed) die(parsed.error);
  runMutation(vfs, vfs.editEntity(p, parsed as JsonDict), output);
}

function cmdRenameEntity(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const p = rest[0];
  const newName = rest[1];
  if (!p || !newName) die('rename-entity: path and new_name required');
  runMutation(vfs, vfs.renameEntity(p, newName), output);
}

function cmdAddComponent(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const propsJson = peelFlag(rest, '--properties');
  const entityPath = rest[0];
  const typeName = rest[1];
  if (!entityPath || !typeName) die('add-component: entity_path and type_name required');
  const props = propsJson ? parseJson(propsJson, '--properties') : undefined;
  runMutation(vfs, vfs.addComponent(entityPath, typeName, props), output);
}

function cmdRemoveComponent(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const entityPath = rest[0];
  const typeName = rest[1];
  if (!entityPath || !typeName) die('remove-component: entity_path and type_name required');
  runMutation(vfs, vfs.removeComponent(entityPath, typeName), output);
}

function cmdValidate(vfs: EntitiesEntryParser, _rest: string[]): void {
  process.stdout.write(JSON.stringify(vfs.validate(), null, 2) + '\n');
}

// ── Layer 2 — Entity-oriented handlers ───────────

function cmdReadEntity(vfs: EntitiesEntryParser, rest: string[]): void {
  const deep = peelBool(rest, '--deep');
  const compact = peelBool(rest, '--compact');
  const p = rest[0];
  if (!p) die('read-entity: path required');
  const r = vfs.readEntity(p, { deep, compact });
  if ('error' in r) die(r.error);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
}

function cmdListEntities(vfs: EntitiesEntryParser, rest: string[]): void {
  const recursive = peelBool(rest, '-r', '--recursive');
  const json = peelBool(rest, '--json');
  const p = rest[0] ?? '/';
  const r = vfs.listEntities(p, { recursive });
  if ('error' in r) die(r.error);
  if (json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return;
  }
  for (const e of r.entities) {
    const tag = `[${e.components.length}c${e.children_count > 0 ? `, ${e.children_count}e` : ''}]`;
    const model = e.modelId ? ` <${e.modelId}>` : '';
    process.stdout.write(`${e.path.padEnd(44)} ${tag.padEnd(10)} ${e.name}${model}\n`);
  }
  process.stderr.write(`--- ${r.entities.length} entities ---\n`);
}

function cmdFindEntities(vfs: EntitiesEntryParser, rest: string[]): void {
  const by = (peelFlag(rest, '--by') ?? 'name') as 'name' | 'component' | 'modelId';
  if (!['name', 'component', 'modelId'].includes(by)) {
    die(`--by must be name|component|modelId`);
  }
  const startPath = peelFlag(rest, '--path') ?? undefined;
  const pattern = rest[0];
  if (!pattern) die('find-entities: pattern required');
  const r = vfs.findEntities(pattern, { by, startPath });
  if (!Array.isArray(r)) die(r.error);
  for (const e of r) {
    const model = e.modelId ? ` <${e.modelId}>` : '';
    process.stdout.write(`${e.path.padEnd(44)} [${by}=${e.matched}] ${e.name}${model}\n`);
  }
  process.stderr.write(`--- ${r.length} entities ---\n`);
}

function cmdGrepEntities(vfs: EntitiesEntryParser, rest: string[]): void {
  const headLimit = expectInt(peelFlag(rest, '--head-limit'), 50, '--head-limit')!;
  const pattern = rest[0];
  if (!pattern) die('grep-entities: pattern required');
  const p = rest[1] ?? '/';
  const r = vfs.grepEntities(pattern, p);
  if (!Array.isArray(r)) die(r.error);
  let printed = 0;
  outer: for (const ent of r) {
    process.stdout.write(`${ent.entity} (${ent.name})\n`);
    for (const hit of ent.hits) {
      for (const m of hit.matches) {
        if (printed >= headLimit) {
          process.stdout.write(`... (more matches, raise --head-limit)\n`);
          break outer;
        }
        let val: any = m.value;
        if (val !== null && (typeof val === 'object' || Array.isArray(val))) {
          val = JSON.stringify(val);
        }
        process.stdout.write(`  ${hit.component}:${m.key}: ${val}\n`);
        printed += 1;
      }
    }
  }
  process.stderr.write(`--- ${r.length} entities, ${printed} matches shown ---\n`);
}

function cmdEditComponent(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const setKv = peelList(rest, '--set');
  const entityPath = rest[0];
  const typeName = rest[1];
  if (!entityPath || !typeName) die('edit-component: entity_path and type required');
  const parsed = parseKv(setKv);
  if ('error' in parsed) die(parsed.error);
  runMutation(vfs, vfs.editComponent(entityPath, typeName, parsed as JsonDict), output);
}

function cmdExportYaml(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const dataDir = peelFlag(rest, '--data-dir');
  const data = vfs.exportYaml(dataDir);
  const text = YAML.stringify(data);
  if (output) {
    const fs = require('node:fs') as typeof import('node:fs');
    fs.writeFileSync(output, text, 'utf8');
    process.stdout.write(JSON.stringify({ ok: true, path: output }) + '\n');
  } else {
    process.stdout.write(text);
  }
}

// ── Model command handlers ──────────────────────

function cmdModelInfo(mv: ModelEntryParser): void {
  process.stdout.write(JSON.stringify(mv.info(), null, 2) + '\n');
}

function cmdModelList(mv: ModelEntryParser): void {
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

function cmdModelGet(mv: ModelEntryParser, rest: string[]): void {
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

function cmdModelSet(mv: ModelEntryParser, rest: string[]): void {
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

function cmdModelRemove(mv: ModelEntryParser, rest: string[]): void {
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

function cmdModelValidate(mv: ModelEntryParser): void {
  process.stdout.write(JSON.stringify(mv.validate(), null, 2) + '\n');
}

function dispatchModel(file: string, cmd: string, rest: string[]): void {
  const mv = makeModel(file);
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

type Handler = (vfs: EntitiesEntryParser, rest: string[]) => void;

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
  'export-yaml': cmdExportYaml,
  // Layer 2 — entity-oriented
  'read-entity': cmdReadEntity,
  'list-entities': cmdListEntities,
  'find-entities': cmdFindEntities,
  'grep-entities': cmdGrepEntities,
  'edit-component': cmdEditComponent,
};

const UNIMPLEMENTED_ENTITIES = new Set<string>();

function dispatchEntities(type: string, file: string, cmd: string, rest: string[]): void {
  if (UNIMPLEMENTED_ENTITIES.has(cmd)) {
    die(`'${cmd}' is not yet implemented in this build.`, 70);
  }
  if (cmd === 'import-yaml') {
    importYaml(type, file, rest);
    return;
  }
  const handler = ENTITIES_HANDLERS[cmd];
  if (!handler) die(`unknown command for ${type}: ${cmd}. Run msw-vfs --help.`);
  const vfs = makeEntitiesVfs(type, file);
  handler(vfs, rest);
}

function importYaml(type: string, yamlFile: string, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const vfs: EntitiesEntryParser =
    type === 'map' ? MapEntryParser.fromYamlFile(yamlFile) :
    type === 'ui' ? UIEntryParser.fromYamlFile(yamlFile) :
    type === 'gamelogic' ? GameLogicEntryParser.fromYamlFile(yamlFile) :
    die(`import-yaml: unsupported type ${type}`);
  const saveR = vfs.save(output);
  process.stdout.write(JSON.stringify({ import: { ok: true }, save: saveR }, null, 2) + '\n');
  if (!saveR.ok) process.exit(1);
}

function cmdBuildWorld(file: string, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const values = peelList(rest, '-f', '--values');
  if (!output) die('build-world: -o/--output required');
  const wb = new WorldBuilder(file);
  if (values.length > 0) wb.applyValues(values);
  const result = wb.build(output);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

// Commands that are not proxyable — they must run in the caller's process
// because they manage or depend on per-process state (daemon lifecycle,
// stdin interaction).
const NON_PROXYABLE_DAEMON_CMDS = new Set(['daemon', 'serve', 'stop', 'status']);

/** Synchronous main for use when proxy is skipped. Exported for daemon use. */
export function runMain(argv: string[]): number {
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
    if (cmd !== 'build-world') die(`world type only supports 'build-world', got '${cmd}'`);
    cmdBuildWorld(file, args);
    return 0;
  }

  dispatchEntities(type, file, cmd, args);
  return 0;
}

async function mainAsync(argv: string[]): Promise<number> {
  const args = argv.slice(2);

  // Daemon meta subcommands — never proxied.
  if (args.length > 0 && NON_PROXYABLE_DAEMON_CMDS.has(args[0])) {
    const { runDaemonSubcommand } = await import('./daemon');
    return runDaemonSubcommand(args[0], args.slice(1), PKG_VERSION);
  }

  // Proxy to daemon if available. Controlled by env var; also skipped for
  // help/version and web commands.
  const noDaemon = process.env.MSW_VFS_NO_DAEMON === '1';
  if (!noDaemon && args.length > 0 && !isMetaOrLocalOnly(args)) {
    const { proxyRpc } = await import('./daemon/client');
    const r = await proxyRpc(argv.slice(2));
    if (r) {
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      return r.code;
    }
    // fall through to local on proxy miss
  }

  return runMain(argv);
}

function isMetaOrLocalOnly(args: string[]): boolean {
  const a0 = args[0];
  if (a0 === '--help' || a0 === '-h' || a0 === '--version' || a0 === '-v') return true;
  return false;
}

/** Invoked by bin/cli.js. Kept as a named export so importing cli.ts from
 *  the daemon does not trigger command-line dispatch. */
export function runCli(): void {
  mainAsync(process.argv).then(
    (code) => process.exit(code),
    (err: any) => {
      process.stderr.write(`msw-vfs: ${err?.stack ?? err}\n`);
      process.exit(1);
    },
  );
}

// Back-compat: if executed directly (e.g. `node dist/cli.js ...`), auto-run.
// When loaded via bin/cli.js, bin explicitly calls runCli().
if (require.main === module) {
  runCli();
}
