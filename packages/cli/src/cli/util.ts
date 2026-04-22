// Shared argv parsing + mutation plumbing used by every handler module.

import type { EntitiesEntryParser, ActionResult, SaveResult } from '../entry/entities';
import type { JsonDict } from '../types';

export function die(msg: string, code = 1): never {
  process.stderr.write(`msw-vfs: ${msg}\n`);
  process.exit(code);
}

export function peelFlag(args: string[], ...names: string[]): string | null {
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

export function peelBool(args: string[], ...names: string[]): boolean {
  for (const name of names) {
    const idx = args.indexOf(name);
    if (idx !== -1) {
      args.splice(idx, 1);
      return true;
    }
  }
  return false;
}

export function peelList(args: string[], ...names: string[]): string[] {
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

export function parseKv(pairs: string[]): JsonDict | { error: string } {
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

export function parseJson(raw: string, label: string): any {
  try {
    return JSON.parse(raw);
  } catch (e: any) {
    die(`${label}: invalid JSON — ${e.message ?? String(e)}`);
  }
}

export function expectInt(
  val: string | null,
  fallback: number | null,
  name: string,
): number | null {
  if (val === null) return fallback;
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) die(`${name} must be an integer`);
  return n;
}

export function runMutation(
  vfs: EntitiesEntryParser,
  action: ActionResult,
  outputPath: string | null,
): void {
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
