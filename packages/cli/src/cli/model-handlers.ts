// .model handlers — flat Values[] override table (entity template).

import type { ModelEntryParser } from '../entry/model';
import { ALL_TYPE_KEYS, type TypeKey } from '../model/types';

import { die, peelFlag } from './util';

export function cmdModelInfo(mv: ModelEntryParser): void {
  process.stdout.write(JSON.stringify(mv.info(), null, 2) + '\n');
}

export function cmdModelList(mv: ModelEntryParser): void {
  const items = mv.listValues();
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
