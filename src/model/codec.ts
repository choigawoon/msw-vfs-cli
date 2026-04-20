// Python ↔ MSW Value field encoding/decoding.
//
// Ported from model_codec.py. Main gotcha vs. Python: JavaScript has no
// int/float distinction, so callers who care about integer-valued floats
// should pass `typeKey` explicitly instead of relying on `inferType`.

import { VALUE_TYPE_SHORT, type TypeKey } from './types';
import { isPlainObject } from '../vfs/common';

const INT32_MAX = 2147483647;

/** Infer a TypeKey from a JavaScript value. Numbers without a fractional part
 *  are treated as integers (int32/int64); others as `single`. Pass `typeKey`
 *  explicitly when this heuristic is wrong. */
export function inferType(value: unknown): TypeKey {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return Math.abs(value) > INT32_MAX ? 'int64' : 'int32';
    }
    return 'single';
  }
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) {
    const n = value.length;
    if (n === 2) return 'vector2';
    if (n === 3) return 'vector3';
    if (n === 4) return 'color';
  }
  if (isPlainObject(value)) {
    if ('DataId' in value) return 'dataref';
    const dt = (value as any)['$type'];
    if (typeof dt === 'string') {
      if (dt.includes('MODVector2')) return 'vector2';
      if (dt.includes('MODVector3')) return 'vector3';
      if (dt.includes('MODQuaternion')) return 'quaternion';
      if (dt.includes('MODColor')) return 'color';
      if (dt.includes('MODDataRef')) return 'dataref';
    }
    const keys = new Set(Object.keys(value));
    if (keys.has('x') && keys.has('y') && keys.has('z') && keys.has('w')) return 'quaternion';
    if (keys.has('x') && keys.has('y') && keys.has('z')) return 'vector3';
    if (keys.has('x') && keys.has('y')) return 'vector2';
    if (keys.has('r') && keys.has('g') && keys.has('b') && keys.has('a')) return 'color';
  }
  throw new Error(
    `cannot infer ValueType from ${typeof value}: ${JSON.stringify(value)}. ` +
    `Specify type_key explicitly.`,
  );
}

function num(v: any, fallback = 0): number {
  return typeof v === 'number' ? v : Number(v ?? fallback);
}

function unpackXy(v: any): [number, number] {
  if (isPlainObject(v)) return [num(v.x), num(v.y)];
  return [num(v[0]), num(v[1])];
}
function unpackXyz(v: any): [number, number, number] {
  if (isPlainObject(v)) return [num(v.x), num(v.y), num(v.z)];
  return [num(v[0]), num(v[1]), num(v[2])];
}
function unpackXyzw(v: any): [number, number, number, number] {
  if (isPlainObject(v)) return [num(v.x), num(v.y), num(v.z), num(v.w)];
  return [num(v[0]), num(v[1]), num(v[2]), num(v[3])];
}
function unpackRgba(v: any): [number, number, number, number] {
  if (isPlainObject(v)) {
    return [num(v.r, 0), num(v.g, 0), num(v.b, 0), num(v.a ?? 1, 1)];
  }
  return [num(v[0]), num(v[1]), num(v[2]), num(v[3])];
}

export function encodeValue(typeKey: TypeKey, value: any): any {
  switch (typeKey) {
    case 'single': return Number(value);
    case 'int32':
    case 'int64': return Math.trunc(Number(value));
    case 'string': return value === null || value === undefined ? '' : String(value);
    case 'boolean': return Boolean(value);
    case 'vector2': {
      const [x, y] = unpackXy(value);
      return { $type: VALUE_TYPE_SHORT.vector2, x, y };
    }
    case 'vector3': {
      const [x, y, z] = unpackXyz(value);
      return { $type: VALUE_TYPE_SHORT.vector3, x, y, z };
    }
    case 'quaternion': {
      const [x, y, z, w] = unpackXyzw(value);
      return { $type: VALUE_TYPE_SHORT.quaternion, x, y, z, w };
    }
    case 'color': {
      const [r, g, b, a] = unpackRgba(value);
      return { $type: VALUE_TYPE_SHORT.color, r, g, b, a };
    }
    case 'dataref': {
      const dataId = isPlainObject(value)
        ? String(value.DataId ?? '')
        : String(value);
      return { $type: VALUE_TYPE_SHORT.dataref, DataId: dataId };
    }
    default:
      throw new Error(`unknown type_key: ${typeKey}`);
  }
}

/** Decode a Value JSON back to a compact display form (tuple for vectors, etc.). */
export function decodeValue(value: any): any {
  if (isPlainObject(value) && typeof value['$type'] === 'string') {
    const t = value['$type'] as string;
    if (t.includes('MODVector2')) return [num(value.x), num(value.y)];
    if (t.includes('MODVector3')) return [num(value.x), num(value.y), num(value.z)];
    if (t.includes('MODQuaternion')) return [num(value.x), num(value.y), num(value.z), num(value.w)];
    if (t.includes('MODColor')) return [num(value.r), num(value.g), num(value.b), num(value.a)];
    if (t.includes('MODDataRef')) return { DataId: String(value.DataId ?? '') };
  }
  return value;
}
