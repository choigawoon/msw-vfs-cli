// Layer 1 — VFS / file-level handlers.
//
// Path-based exploration (ls / read / tree / glob / grep / stat),
// entry-level operations (summary / validate), and low-level edit.
// Works on any EntitiesEntryParser (map / ui / gamelogic).

import type { EntitiesEntryParser, GrepMatch } from '../entry/entities';
import type { JsonDict } from '../types';
import YAML from 'yaml';

import {
  die,
  peelBool,
  peelFlag,
  peelList,
  parseKv,
  expectInt,
  runMutation,
} from './util';

// 5-char flag column for entity dirs in `ls -l`, Unix-perms style:
//   D  disabled  (enable=false)
//   I  invisible (visible=false)
//   M  has modelId (instance of a .model template)
//   S  has at least one script.* component
//   C  has child entities
// Missing flags render as '-'. Passthrough dirs (e.g. /maps) and files
// render blank so the eye goes straight to named entities.
function formatFlags(item: {
  entity?: boolean;
  enable?: boolean;
  visible?: boolean;
  has_model_id?: boolean;
  has_script?: boolean;
  children_count?: number;
}): string {
  if (!item.entity) return '     ';
  return (
    (item.enable === false ? 'D' : '-') +
    (item.visible === false ? 'I' : '-') +
    (item.has_model_id ? 'M' : '-') +
    (item.has_script ? 'S' : '-') +
    ((item.children_count ?? 0) > 0 ? 'C' : '-')
  );
}

export function cmdLs(vfs: EntitiesEntryParser, rest: string[]): void {
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
        const flags = formatFlags(item);
        process.stdout.write(`${flags}  ${name.padEnd(38)} [${info}]\n`);
      } else if (long) {
        // Passthrough dir (e.g. /maps, /ui): keep column alignment.
        process.stdout.write(`${formatFlags(item)}  ${name}\n`);
      } else {
        process.stdout.write(`${name}\n`);
      }
    } else {
      if (long) {
        process.stdout.write(`${formatFlags(item)}  ${item.name}\n`);
      } else {
        process.stdout.write(`${item.name}\n`);
      }
    }
  }
}

export function cmdRead(vfs: EntitiesEntryParser, rest: string[]): void {
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

export function cmdTree(vfs: EntitiesEntryParser, rest: string[]): void {
  const depth = expectInt(peelFlag(rest, '-d', '--depth'), null, '--depth');
  const p = rest[0] ?? '/';
  const text = vfs.treeText(p, depth);
  if (text.startsWith('Error:')) die(text);
  process.stdout.write(text + '\n');
}

export function cmdGlob(vfs: EntitiesEntryParser, rest: string[]): void {
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

export function cmdGrep(vfs: EntitiesEntryParser, rest: string[]): void {
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
  const arr = results as { path: string; matches: GrepMatch[] }[];
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

export function cmdStat(vfs: EntitiesEntryParser, rest: string[]): void {
  const p = rest[0];
  if (!p) die('stat: path required');
  const r = vfs.stat(p);
  if (r && typeof r === 'object' && 'error' in r) die((r as any).error);
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
}

export function cmdSummary(vfs: EntitiesEntryParser, _rest: string[]): void {
  process.stdout.write(JSON.stringify(vfs.summary(), null, 2) + '\n');
}

export function cmdValidate(vfs: EntitiesEntryParser, _rest: string[]): void {
  process.stdout.write(JSON.stringify(vfs.validate(), null, 2) + '\n');
}

export function cmdEdit(vfs: EntitiesEntryParser, rest: string[]): void {
  const output = peelFlag(rest, '-o', '--output');
  const setKv = peelList(rest, '--set');
  const p = rest[0];
  if (!p) die('edit: path required');
  const parsed = parseKv(setKv);
  if ('error' in parsed) die(parsed.error);
  runMutation(vfs, vfs.edit(p, parsed as JsonDict), output);
}

export function cmdExportYaml(vfs: EntitiesEntryParser, rest: string[]): void {
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
