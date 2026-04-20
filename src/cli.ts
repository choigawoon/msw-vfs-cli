#!/usr/bin/env node
// msw-vfs CLI entry point.
//
// Dispatches by file extension (.map / .ui / .gamelogic / .model / world.yaml)
// to the appropriate VFS handler. Mirrors the Python msw_vfs.py dispatcher.

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

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

const USAGE = `msw-vfs ${PKG_VERSION}

Usage:
  msw-vfs <file> <command> [args...]
  msw-vfs --type <map|ui|gamelogic|model|world> <file> <command> [args...]
  msw-vfs --help
  msw-vfs --version

Type is auto-detected from file extension:
  .map       → map
  .ui        → ui
  .gamelogic → gamelogic
  .model     → model
  .yaml/.yml → world (if 'world' key present) or via meta.ContentType

Commands (entities: map/ui/gamelogic):
  ls [path]                         list directory
  read <path>                       read file (compact JSON)
  tree [path] [-d N]                print tree
  glob <pattern> [path]             glob search
  grep <pattern> [path]             grep search
  stat <path>                       file stat
  summary                           summary info
  edit <path> --set key=value ...   edit component properties
  add-entity <parent> <name> -c T   add entity
  remove-entity <path>              remove entity
  edit-entity <path> --set k=v      edit entity metadata
  rename-entity <path> <new-name>   rename entity
  add-component <entity> <Type>     add component
  remove-component <entity> <Type>  remove component
  validate                          validate asset
  export-yaml                       export to YAML
  import-yaml                       import from YAML

Commands (world):
  build-world -o <dir> [-f vals]    build world from yaml

Commands (model):
  info                              show model info
  list                              list values
  get <name>                        get value
  set <name> <json-value>           set value
  remove <name>                     remove value
  validate                          validate model

NOTE: Port in progress. Only a subset of commands is implemented today.
`;

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

  process.stderr.write(
    'msw-vfs: CLI dispatcher not yet implemented. Run `msw-vfs --help` for usage.\n',
  );
  return 64;
}

process.exit(main(process.argv));
