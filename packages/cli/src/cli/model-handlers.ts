// .model handlers — flat Values[] override table (entity template).

import type { ModelEntryParser } from '../entry/model';
import { ALL_TYPE_KEYS, type TypeKey } from '../model/types';

import { die, peelBool, peelFlag } from './util';

export function cmdModelInfo(mv: ModelEntryParser): void {
  process.stdout.write(JSON.stringify(mv.info(), null, 2) + '\n');
}

/** Common-shape summary for tools (viewer) that expect every entry to
 *  answer `summary`. A model is a single-entity template, so entity_count=1
 *  and component_counts reflects the template's @components list. */
export function cmdModelSummary(mv: ModelEntryParser): void {
  const info = mv.info();
  const comps = info.components ?? [];
  const compCounts: Record<string, number> = {};
  for (const c of comps) compCounts[c] = (compCounts[c] ?? 0) + 1;
  const summary = {
    file: info.path,
    asset_type: 'model',
    entry_key: info.entry_key,
    core_version: info.core_version,
    entity_count: 1,
    component_counts: compCounts,
    scripts: [] as string[],
    model_id: info.id,
    base_model_id: info.base_model_id,
    name: info.name,
    values_count: info.values_count,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

export function cmdModelList(mv: ModelEntryParser, rest: string[] = []): void {
  const json = peelBool(rest, '--json');
  const items = mv.listValues();
  if (json) {
    process.stdout.write(JSON.stringify(items) + '\n');
    return;
  }
  for (const it of items) {
    const tt = it.target_type ? ` [TargetType=${it.target_type}]` : '';
    const typeShort = it.type_key || it.type;
    const valRepr =
      typeof it.value === 'object' && it.value !== null
        ? JSON.stringify(it.value)
        : String(it.value);
    process.stdout.write(
      `${it.name.padEnd(30)} ${typeShort.padEnd(12)} = ${valRepr}${tt}\n`,
    );
  }
  process.stderr.write(`--- ${items.length} values ---\n`);
}

export function cmdModelGet(mv: ModelEntryParser, rest: string[]): void {
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

export function cmdModelSet(mv: ModelEntryParser, rest: string[]): void {
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
  // Preserve Python's int/float distinction: raw "5.0" parses to integer
  // 5, so we re-read the raw string and coerce to 'single' when it had
  // a decimal point or exponent.
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

export function cmdModelRemove(mv: ModelEntryParser, rest: string[]): void {
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

export function cmdModelValidate(mv: ModelEntryParser): void {
  process.stdout.write(JSON.stringify(mv.validate(), null, 2) + '\n');
}
