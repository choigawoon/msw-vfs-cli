// Shared VFS infrastructure: node type + Helm-style deep merge.
//
// Ported from vfs_common.py. VFSNode is the unit of the in-memory virtual
// filesystem that maps an entity tree to directories and components to files.

import type { JsonDict } from '../types';

export type NodeType = 'dir' | 'file';

export class VFSNode {
  name: string;
  nodeType: NodeType;
  /** JSON content for files; null for directories. */
  content: any;
  metadata: JsonDict;
  children: Record<string, VFSNode>;
  /** Index into the flat Entities[] array; null if this dir is not a backed entity. */
  entityIndex: number | null;

  constructor(
    name: string,
    nodeType: NodeType = 'dir',
    content: any = null,
    metadata: JsonDict | null = null,
  ) {
    this.name = name;
    this.nodeType = nodeType;
    this.content = content;
    this.metadata = metadata ?? {};
    this.children = {};
    this.entityIndex = null;
  }
}

export function isPlainObject(x: unknown): x is JsonDict {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Deep-merge `overlay` onto `base` (overlay wins).
 *  Special case: when key is 'entities' and both sides are arrays, merge by 'name' field. */
export function deepMerge(base: any, overlay: any): any {
  if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay;
  const result: JsonDict = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (k === 'entities' && Array.isArray(v) && Array.isArray(result[k])) {
      result[k] = mergeEntityList(result[k], v);
    } else if (k in result && isPlainObject(result[k]) && isPlainObject(v)) {
      result[k] = deepMerge(result[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function mergeEntityList(base: any[], overlay: any[]): any[] {
  const result: any[] = base.map((e) => (isPlainObject(e) ? { ...e } : e));
  const nameToIdx = new Map<string, number>();
  result.forEach((e, i) => {
    if (isPlainObject(e) && typeof e.name === 'string') {
      nameToIdx.set(e.name, i);
    }
  });
  for (const ov of overlay) {
    if (!isPlainObject(ov)) {
      result.push(ov);
      continue;
    }
    const name = (ov as JsonDict).name;
    if (typeof name === 'string' && nameToIdx.has(name)) {
      result[nameToIdx.get(name)!] = deepMerge(result[nameToIdx.get(name)!], ov);
    } else {
      result.push(ov);
    }
  }
  return result;
}
