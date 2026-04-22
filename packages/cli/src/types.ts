// Shared types for MSW asset data.
//
// We mirror Python's loose dict-based model. Strict shapes only on the public
// API; internal asset data uses `any` so ports of dynamic logic stay readable.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export type JsonDict = Record<string, any>;

/** A component attached to an entity. */
export type Component = JsonDict & { '@type'?: string };

/** Raw entity as stored in ContentProto.Entities[]. */
export interface RawEntity {
  id?: string;
  path?: string;
  componentNames?: string;
  jsonString?: JsonDict;
  [k: string]: any;
}

export type AssetType = 'map' | 'ui' | 'gamelogic' | 'model' | 'world' | 'unknown';
