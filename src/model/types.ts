// C# assembly-qualified type name table for MSW .model ValueType fields.
//
// Ported from model_types.py. The Newtonsoft.Json TypeNameHandling-based MSW
// Creator deserializer requires exact assembly fullnames here. If this table
// drifts, Maker silently drops Values[] entries or falls back to defaults.

export const MSCORLIB =
  'mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089';

export function modCoreAsm(coreVersion: string): string {
  return `MOD.Core, Version=${coreVersion}, Culture=neutral, PublicKeyToken=null`;
}

export type TypeKey =
  | 'single' | 'int32' | 'int64' | 'string' | 'boolean'
  | 'vector2' | 'vector3' | 'color' | 'quaternion' | 'dataref';

export const ALL_TYPE_KEYS: TypeKey[] = [
  'single', 'int32', 'int64', 'string', 'boolean',
  'vector2', 'vector3', 'color', 'quaternion', 'dataref',
];

interface TypeHandler {
  canonical: string;
  asm: (coreVersion: string) => string;
}

export const TYPE_HANDLERS: Record<TypeKey, TypeHandler> = {
  single:     { canonical: 'System.Single',          asm: () => MSCORLIB },
  int32:      { canonical: 'System.Int32',           asm: () => MSCORLIB },
  int64:      { canonical: 'System.Int64',           asm: () => MSCORLIB },
  string:     { canonical: 'System.String',          asm: () => MSCORLIB },
  boolean:    { canonical: 'System.Boolean',         asm: () => MSCORLIB },
  vector2:    { canonical: 'MOD.Core.MODVector2',    asm: modCoreAsm },
  vector3:    { canonical: 'MOD.Core.MODVector3',    asm: modCoreAsm },
  color:      { canonical: 'MOD.Core.MODColor',      asm: modCoreAsm },
  quaternion: { canonical: 'MOD.Core.MODQuaternion', asm: modCoreAsm },
  dataref:    { canonical: 'MOD.Core.MODDataRef',    asm: modCoreAsm },
};

// Short-form $type for values. MSW/Newtonsoft accepts these without assembly
// version — we keep them on the value object, not on ValueType.type.
export const VALUE_TYPE_SHORT: Partial<Record<TypeKey, string>> = {
  vector2:    'MOD.Core.MODVector2, MOD.Core',
  vector3:    'MOD.Core.MODVector3, MOD.Core',
  color:      'MOD.Core.MODColor, MOD.Core',
  quaternion: 'MOD.Core.MODQuaternion, MOD.Core',
  dataref:    'MOD.Core.MODDataRef, MOD.Core',
};

export interface ValueType {
  $type: 'MODNativeType';
  type: string;
}

export function buildValueType(typeKey: TypeKey, coreVersion: string): ValueType {
  const h = TYPE_HANDLERS[typeKey];
  if (!h) throw new Error(`unsupported type_key: ${typeKey}`);
  return { $type: 'MODNativeType', type: `${h.canonical}, ${h.asm(coreVersion)}` };
}

export function extractTypeKey(valueTypeStr: string | undefined | null): string {
  if (!valueTypeStr) return '';
  const canonical = valueTypeStr.split(',')[0].trim();
  for (const [k, h] of Object.entries(TYPE_HANDLERS)) {
    if (h.canonical === canonical) return k;
  }
  return canonical;
}
