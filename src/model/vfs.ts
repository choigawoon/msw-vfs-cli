// ModelVFS — editor for MSW .model Values[] override table.
// Ported from model_core.py.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildValueType, extractTypeKey, type TypeKey } from './types';
import { inferType, encodeValue, decodeValue } from './codec';
import { isPlainObject } from '../vfs/common';
import type { JsonDict } from '../types';

export interface ModelInfo {
  path: string;
  entry_key: string;
  content_type: string;
  core_version: string;
  name: string;
  id: string;
  base_model_id: string;
  version: number;
  components: string[];
  properties_count: number;
  values_count: number;
  event_links_count: number;
  children_count: number;
}

export interface ModelListItem {
  name: string;
  target_type: string | null;
  type: string;
  type_key: string;
  value: any;
}

export interface ModelActionResult {
  ok: boolean;
  added?: string;
  updated?: string;
  removed?: string;
  type_key?: string;
  error?: string;
}

export interface ModelSaveResult {
  ok: boolean;
  path: string;
  warnings?: string[];
  error?: string;
}

export interface ModelValidateResult {
  ok: boolean;
  warnings: string[];
  values_count: number;
}

export class ModelVFS {
  readonly modelPath: string;
  readonly coreVersion: string;
  private raw: JsonDict;
  private json: JsonDict;
  private values: JsonDict[];
  private dirty: boolean;

  constructor(modelPath: string) {
    this.modelPath = path.resolve(modelPath);
    this.raw = JSON.parse(fs.readFileSync(this.modelPath, 'utf8'));

    const cp = (this.raw.ContentProto ?? {}) as JsonDict;
    if (cp.Use !== 'Json') {
      throw new Error(`ContentProto.Use must be 'Json', got ${JSON.stringify(cp.Use)}`);
    }

    if (!this.raw.ContentProto) this.raw.ContentProto = cp;
    if (!cp.Json) cp.Json = {};
    this.json = cp.Json as JsonDict;

    if (!Array.isArray(this.json.Values)) this.json.Values = [];
    this.values = this.json.Values as JsonDict[];

    this.coreVersion = String(this.raw.CoreVersion ?? '') || '1.23.0.0';
    this.dirty = false;
  }

  get name(): string { return String(this.json.Name ?? ''); }
  get baseModelId(): string { return String(this.json.BaseModelId ?? ''); }
  get modelId(): string { return String(this.json.Id ?? ''); }
  get version(): number { return Number(this.json.Version ?? 1); }
  get isDirty(): boolean { return this.dirty; }

  info(): ModelInfo {
    return {
      path: this.modelPath,
      entry_key: String(this.raw.EntryKey ?? ''),
      content_type: String(this.raw.ContentType ?? ''),
      core_version: this.coreVersion,
      name: this.name,
      id: this.modelId,
      base_model_id: this.baseModelId,
      version: this.version,
      components: Array.isArray(this.json.Components) ? [...(this.json.Components as string[])] : [],
      properties_count: Array.isArray(this.json.Properties) ? this.json.Properties.length : 0,
      values_count: this.values.length,
      event_links_count: Array.isArray(this.json.EventLinks) ? this.json.EventLinks.length : 0,
      children_count: Array.isArray(this.json.Children) ? this.json.Children.length : 0,
    };
  }

  listValues(): ModelListItem[] {
    return this.values.map((v) => {
      const vt = v.ValueType;
      const typeStr = isPlainObject(vt) && typeof vt.type === 'string' ? (vt.type as string) : '';
      return {
        name: String(v.Name ?? ''),
        target_type: v.TargetType ?? null,
        type: typeStr ? typeStr.split(',')[0].trim() : '',
        type_key: extractTypeKey(typeStr),
        value: decodeValue(v.Value),
      };
    });
  }

  get(name: string, targetType: string | null = null): any {
    for (const v of this.values) {
      if (v.Name === name && (v.TargetType ?? null) === targetType) {
        return decodeValue(v.Value);
      }
    }
    return null;
  }

  getRaw(name: string, targetType: string | null = null): JsonDict | null {
    for (const v of this.values) {
      if (v.Name === name && (v.TargetType ?? null) === targetType) return v;
    }
    return null;
  }

  set(
    name: string,
    value: any,
    targetType: string | null = null,
    typeKey: TypeKey | null = null,
  ): ModelActionResult {
    const tk: TypeKey = typeKey ?? inferType(value);
    const encoded = encodeValue(tk, value);
    const valueType = buildValueType(tk, this.coreVersion);

    for (const v of this.values) {
      if (v.Name === name && (v.TargetType ?? null) === targetType) {
        v.Value = encoded;
        v.ValueType = valueType;
        this.dirty = true;
        return { ok: true, updated: name, type_key: tk };
      }
    }

    this.values.push({
      TargetType: targetType,
      Name: name,
      ValueType: valueType,
      Value: encoded,
    });
    this.dirty = true;
    return { ok: true, added: name, type_key: tk };
  }

  remove(name: string, targetType: string | null = null): ModelActionResult {
    const before = this.values.length;
    const kept = this.values.filter(
      (v) => !(v.Name === name && (v.TargetType ?? null) === targetType),
    );
    if (kept.length < before) {
      // Mutate in place to keep the raw.ContentProto.Json.Values reference stable.
      this.values.length = 0;
      for (const v of kept) this.values.push(v);
      this.dirty = true;
      return { ok: true, removed: name };
    }
    return { ok: false, error: `value '${name}' not found` };
  }

  addComponent(typeName: string): ModelActionResult {
    if (!Array.isArray(this.json.Components)) this.json.Components = [];
    const comps = this.json.Components as string[];
    if (comps.includes(typeName)) {
      return { ok: false, error: `component '${typeName}' already in model` };
    }
    comps.push(typeName);
    this.dirty = true;
    return { ok: true, added: typeName };
  }

  removeComponent(typeName: string): ModelActionResult {
    if (!Array.isArray(this.json.Components)) this.json.Components = [];
    const comps = this.json.Components as string[];
    const idx = comps.indexOf(typeName);
    if (idx === -1) {
      return { ok: false, error: `component '${typeName}' not in model` };
    }
    comps.splice(idx, 1);
    this.dirty = true;
    return { ok: true, removed: typeName };
  }

  validate(): ModelValidateResult {
    const warnings: string[] = [];
    const namesSeen = new Set<string>();
    for (const v of this.values) {
      const name = String(v.Name ?? '');
      const tt = v.TargetType ?? null;
      const key = `${name}@${tt ?? ''}`;
      if (!name) warnings.push('Values entry missing Name');
      if (namesSeen.has(key)) {
        warnings.push(`duplicate Values entry: Name='${name}' TargetType=${JSON.stringify(tt)}`);
      }
      namesSeen.add(key);

      const vt = v.ValueType;
      if (!isPlainObject(vt)) {
        warnings.push(`Values['${name}'] ValueType not dict`);
        continue;
      }
      if (vt.$type !== 'MODNativeType') {
        warnings.push(
          `Values['${name}'] ValueType.$type must be 'MODNativeType', got ${JSON.stringify(vt.$type)}`,
        );
      }
      const t = typeof vt.type === 'string' ? (vt.type as string) : '';
      if (!t || !t.includes(',')) {
        warnings.push(`Values['${name}'] ValueType.type missing assembly qualified name`);
      }
    }
    return { ok: warnings.length === 0, warnings, values_count: this.values.length };
  }

  save(outputPath: string | null = null, runValidate: boolean = true, strict: boolean = false): ModelSaveResult {
    const target = outputPath ?? this.modelPath;
    const result: ModelSaveResult = { ok: true, path: target };
    if (runValidate) {
      const v = this.validate();
      if (v.warnings.length > 0) {
        result.warnings = v.warnings;
        if (strict) {
          result.ok = false;
          result.error = 'validation failed (strict=true)';
          return result;
        }
      }
    }
    const content = JSON.stringify(this.raw, null, 2);
    JSON.parse(content);
    fs.writeFileSync(target, content, 'utf8');
    this.dirty = false;
    return result;
  }
}
