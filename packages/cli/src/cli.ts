#!/usr/bin/env node
// msw-vfs CLI entry point.
//
// Thin dispatcher. All command handlers live in src/cli/ — split by layer:
//   - cli/vfs-handlers.ts      Layer 1 (ls/read/tree/grep/…) + summary/validate/export-yaml
//   - cli/entity-handlers.ts   Layer 2 (read-entity/list-entities/edit-component/…)
//   - cli/model-handlers.ts    .model file commands
//
// Dispatches by file extension (.map / .ui / .gamelogic / .model /
// world.yaml). Output format mirrors the legacy Python msw_vfs.py so
// existing skill prompts keep working unchanged.

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';

import { EntitiesEntryParser } from './entry/entities';
import { MapEntryParser } from './entry/map';
import { UIEntryParser } from './entry/ui';
import { GameLogicEntryParser } from './entry/gamelogic';
import { WorldBuilder } from './world/builder';
import { makeEntities, makeModel } from './factory';

import {
  cmdLs,
  cmdRead,
  cmdTree,
  cmdGlob,
  cmdGrep,
  cmdStat,
  cmdSummary,
  cmdValidate,
  cmdEdit,
  cmdExportYaml,
} from './cli/vfs-handlers';
import {
  cmdReadEntity,
  cmdListEntities,
  cmdFindEntities,
  cmdGrepEntities,
  cmdAddEntity,
  cmdRemoveEntity,
  cmdEditEntity,
  cmdRenameEntity,
  cmdAddComponent,
  cmdRemoveComponent,
  cmdEditComponent,
} from './cli/entity-handlers';
import {
  cmdModelInfo,
  cmdModelList,
  cmdModelGet,
  cmdModelSet,
  cmdModelRemove,
  cmdModelValidate,
  cmdModelSummary,
} from './cli/model-handlers';
import { die, peelFlag, peelList } from './cli/util';

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

// ── Dispatchers ─────────────────────────────────

type Handler = (vfs: EntitiesEntryParser, rest: string[]) => void;

const ENTITIES_HANDLERS: Record<string, Handler> = {
  // Layer 1 — VFS / file-level
  ls: cmdLs,
  read: cmdRead,
  tree: cmdTree,
  glob: cmdGlob,
  grep: cmdGrep,
  stat: cmdStat,
  summary: cmdSummary,
  validate: cmdValidate,
  edit: cmdEdit,
  'export-yaml': cmdExportYaml,
  // Layer 2 — entity-oriented
  'read-entity': cmdReadEntity,
  'list-entities': cmdListEntities,
  'find-entities': cmdFindEntities,
  'grep-entities': cmdGrepEntities,
  'edit-entity': cmdEditEntity,
  'edit-component': cmdEditComponent,
  'add-entity': cmdAddEntity,
  'remove-entity': cmdRemoveEntity,
  'rename-entity': cmdRenameEntity,
  'add-component': cmdAddComponent,
  'remove-component': cmdRemoveComponent,
};

function dispatchEntities(type: string, file: string, cmd: string, rest: string[]): void {
  if (cmd === 'import-yaml') {
    importYaml(type, file, rest);
    return;
  }
  const handler = ENTITIES_HANDLERS[cmd];
  if (!handler) die(`unknown command for ${type}: ${cmd}. Run msw-vfs --help.`);
  const vfs = makeEntitiesVfs(type, file);
  handler(vfs, rest);
}

function dispatchModel(file: string, cmd: string, rest: string[]): void {
  const mv = makeModel(file);
  switch (cmd) {
    case 'info': cmdModelInfo(mv); break;
    case 'list': cmdModelList(mv, rest); break;
    case 'get': cmdModelGet(mv, rest); break;
    case 'set': cmdModelSet(mv, rest); break;
    case 'remove': cmdModelRemove(mv, rest); break;
    case 'validate': cmdModelValidate(mv); break;
    case 'summary': cmdModelSummary(mv); break;
    default: die(`unknown model command: ${cmd}`);
  }
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

/** Synchronous main. Exported for daemon use. */
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

  // Proxy to daemon if available. Controlled by env var; skipped for
  // help/version.
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
