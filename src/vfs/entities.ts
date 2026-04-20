// EntitiesVFS — shared core for .map / .ui / .gamelogic assets.
//
// Ported from entities_core.py. Constructs an in-memory VFS tree from the flat
// ContentProto.Entities[] array and exposes navigation (ls/read/tree/stat/
// search/grep/summary) + compact helpers for LLM-context-friendly output.
//
// This file covers read-only operations (P1). Mutations (edit/save/CRUD) and
// YAML import/export land in follow-up commits.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { VFSNode, isPlainObject } from './common';
import {
  DEFAULT_STRIP,
  ENTITY_NOISE,
  COMPONENT_NOISE,
  UI_REDUNDANT,
  BUTTON_DEFAULT_IMAGES,
  LARGE_ARRAY_LIMIT,
  PREVIEW_NOISE,
  ENTITY_DEFAULTS,
} from './defaults';
import { fnmatchCase } from '../util/fnmatch';
import type { AssetType, JsonDict, RawEntity } from '../types';

// Preserve keys copied from entity.jsonString into VFSNode.metadata.
const META_COPY_KEYS = [
  'name', 'enable', 'visible', 'displayOrder',
  'pathConstraints', 'modelId', 'origin',
  'nameEditable', 'localize', 'revision',
];

export interface LsItem {
  name: string;
  type: 'dir' | 'file';
  components?: string[];
  children_count?: number;
  entity?: boolean;
}
export type LsResult = { error: string } | { type: 'file'; name: string } | { path: string; items: LsItem[] };

export type ReadResult =
  | { error: string }
  | { type: 'entity'; path: string; metadata: JsonDict }
  | { type: 'component'; path: string; content: any; metadata: JsonDict };

export type StatResult =
  | { error: string }
  | ({ name: string; type: 'dir' | 'file'; path: string } & JsonDict);

export type SearchResult = { path: string; type: 'dir' | 'file'; name: string };

export type GrepResult = { error: string } | { path: string; matches: GrepMatch[] }[];
export interface GrepMatch { key: string; value: any; }

export interface SummaryResult {
  file: string;
  asset_type: AssetType;
  entry_key: string;
  core_version: string;
  entity_count: number;
  component_counts: Record<string, number>;
  scripts: string[];
}

export class EntitiesVFS {
  protected mapPath: string | null;
  protected root: VFSNode;
  protected raw: JsonDict | null;
  protected top: JsonDict;
  protected entities: RawEntity[];
  protected dirty: boolean;
  protected yamlBaseDir: string | null;
  protected dataDir: string | null;
  protected dataFiles: Record<string, any>;

  constructor(filePath?: string | null) {
    this.mapPath = filePath ? path.resolve(filePath) : null;
    this.root = new VFSNode('/', 'dir');
    this.raw = null;
    this.top = {};
    this.entities = [];
    this.dirty = false;
    this.yamlBaseDir = null;
    this.dataDir = null;
    this.dataFiles = {};
    if (filePath) this.load();
  }

  protected load(): void {
    const text = fs.readFileSync(this.mapPath!, 'utf8');
    this.raw = JSON.parse(text);
    this.top = {};
    for (const [k, v] of Object.entries(this.raw!)) {
      if (k !== 'ContentProto') this.top[k] = v;
    }
    this.entities = (this.raw!.ContentProto?.Entities ?? []) as RawEntity[];
    this.entities.forEach((e, i) => this.mountEntity(e, i));
  }

  // ── Mount / Resolve ──────────────────────────────

  protected mountEntity(entity: RawEntity, index: number): void {
    const p = entity.path ?? '';
    const js = (entity.jsonString ?? {}) as JsonDict;

    const node = this.ensureDir(p);
    node.entityIndex = index;

    const meta: JsonDict = {
      id: entity.id ?? '',
      componentNames: entity.componentNames ?? '',
    };
    for (const key of META_COPY_KEYS) {
      if (key in js) meta[key] = js[key];
    }
    node.metadata = meta;

    node.children['_entity.json'] = new VFSNode('_entity.json', 'file', meta);

    const used = new Set<string>();
    const comps = (js['@components'] as JsonDict[] | undefined) ?? [];
    for (const comp of comps) {
      const compType = typeof comp['@type'] === 'string' ? (comp['@type'] as string) : 'Unknown';
      const short = EntitiesVFS.shortName(compType);
      let fname = `${short}.json`;
      if (used.has(fname)) {
        let i = 2;
        while (used.has(`${short}_${i}.json`)) i += 1;
        fname = `${short}_${i}.json`;
      }
      used.add(fname);
      node.children[fname] = new VFSNode(fname, 'file', comp, { full_type: compType });
    }
  }

  static shortName(compType: string): string {
    const parts = compType.split('.');
    return parts[parts.length - 1] ?? compType;
  }

  protected ensureDir(p: string): VFSNode {
    const parts = p.split('/').filter(Boolean);
    let node = this.root;
    for (const part of parts) {
      if (!(part in node.children)) {
        node.children[part] = new VFSNode(part, 'dir');
      }
      node = node.children[part];
    }
    return node;
  }

  protected resolve(p: string): VFSNode | null {
    if (!p || p === '/') return this.root;
    const parts = p.replace(/\/+$/, '').split('/').filter(Boolean);
    let node: VFSNode = this.root;
    for (const part of parts) {
      if (!(part in node.children)) return null;
      node = node.children[part];
    }
    return node;
  }

  // ── Navigation ───────────────────────────────────

  ls(p: string = '/', detail: boolean = false): LsResult {
    const node = this.resolve(p);
    if (!node) return { error: `'${p}' not found` };
    if (node.nodeType === 'file') return { type: 'file', name: node.name };
    const items: LsItem[] = [];
    for (const name of Object.keys(node.children).sort()) {
      const child = node.children[name];
      const item: LsItem = { name, type: child.nodeType };
      if (detail && child.nodeType === 'dir') {
        const comps: string[] = [];
        let childrenCount = 0;
        for (const [n, c] of Object.entries(child.children)) {
          if (c.nodeType === 'file' && n !== '_entity.json') comps.push(n);
          if (c.nodeType === 'dir') childrenCount += 1;
        }
        item.components = comps.sort();
        item.children_count = childrenCount;
        if (child.metadata.id) item.entity = true;
      }
      items.push(item);
    }
    return { path: p, items };
  }

  read(p: string, compact: boolean = false): ReadResult {
    const node = this.resolve(p);
    if (!node) return { error: `'${p}' not found` };
    if (node.nodeType === 'dir') {
      const meta = compact ? EntitiesVFS.compactEntity(node.metadata) : node.metadata;
      return { type: 'entity', path: p, metadata: meta };
    }
    const content = compact ? EntitiesVFS.compactComponent(node.content) : node.content;
    return { type: 'component', path: p, content, metadata: node.metadata };
  }

  stat(p: string): StatResult {
    const node = this.resolve(p);
    if (!node) return { error: `'${p}' not found` };
    const info: JsonDict = { name: node.name, type: node.nodeType, path: p };
    if (node.nodeType === 'dir') {
      info.is_entity = Boolean(node.metadata.id);
      info.metadata = node.metadata;
      const files: string[] = [];
      const subdirs: string[] = [];
      for (const [n, c] of Object.entries(node.children)) {
        if (c.nodeType === 'file') files.push(n);
        else subdirs.push(n);
      }
      info.files = files.sort();
      info.subdirs = subdirs.sort();
    } else {
      info.component_type = node.metadata.full_type ?? '';
    }
    return info as StatResult;
  }

  // ── Tree ─────────────────────────────────────────

  treeData(p: string = '/', maxDepth: number | null = null): any {
    const node = this.resolve(p);
    if (!node) return { error: `'${p}' not found` };
    return this.buildTree(node, p, 0, maxDepth);
  }

  private buildTree(node: VFSNode, p: string, depth: number, maxDepth: number | null): any {
    const result: JsonDict = { name: node.name, type: node.nodeType, path: p };
    if (node.nodeType === 'dir') {
      if (node.metadata.id) {
        result.entity = true;
        result.components = Object.entries(node.children)
          .filter(([n, c]) => c.nodeType === 'file' && n !== '_entity.json')
          .map(([n]) => n.replace(/\.json$/, ''))
          .sort();
      }
      if (maxDepth === null || depth < maxDepth) {
        const children: any[] = [];
        for (const name of Object.keys(node.children).sort()) {
          const child = node.children[name];
          const cp = `${p.replace(/\/+$/, '')}/${name}`;
          if (child.nodeType === 'dir') {
            children.push(this.buildTree(child, cp, depth + 1, maxDepth));
          } else {
            children.push({
              name,
              type: 'file',
              path: cp,
              component_type: child.metadata.full_type ?? '',
            });
          }
        }
        result.children = children;
      }
    }
    return result;
  }

  treeText(p: string = '/', maxDepth: number | null = null): string {
    const node = this.resolve(p);
    if (!node) return `Error: '${p}' not found`;
    const lines: string[] = [p];
    this.textTree(node, lines, '', 0, maxDepth);
    return lines.join('\n');
  }

  private textTree(
    node: VFSNode,
    lines: string[],
    prefix: string,
    depth: number,
    maxDepth: number | null,
  ): void {
    if (maxDepth !== null && depth >= maxDepth) return;
    const entries = Object.entries(node.children).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    entries.forEach(([name, child], i) => {
      const last = i === entries.length - 1;
      const conn = last ? '└── ' : '├── ';
      const ext = last ? '    ' : '│   ';
      if (child.nodeType === 'dir') {
        const cc = Object.entries(child.children).filter(
          ([n, c]) => c.nodeType === 'file' && n !== '_entity.json',
        ).length;
        const tag = child.metadata.id ? `  [${cc} comp]` : '';
        lines.push(`${prefix}${conn}${name}/${tag}`);
        this.textTree(child, lines, prefix + ext, depth + 1, maxDepth);
      } else {
        lines.push(`${prefix}${conn}${name}`);
      }
    });
  }

  // ── Search / Grep ────────────────────────────────

  search(pattern: string, startPath: string = '/'): SearchResult[] {
    const out: SearchResult[] = [];
    const start = this.resolve(startPath);
    if (start) this.searchWalk(start, pattern, startPath.replace(/\/+$/, ''), out);
    return out;
  }

  private searchWalk(node: VFSNode, pattern: string, current: string, out: SearchResult[]): void {
    for (const name of Object.keys(node.children).sort()) {
      const child = node.children[name];
      const cp = `${current}/${name}`;
      if (fnmatchCase(name, pattern)) {
        out.push({ path: cp, type: child.nodeType, name });
      }
      if (child.nodeType === 'dir') this.searchWalk(child, pattern, cp, out);
    }
  }

  grep(pattern: string, startPath: string = '/'): { error: string } | { path: string; matches: GrepMatch[] }[] {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (e: any) {
      return { error: `Invalid regex: ${e.message ?? String(e)}` };
    }
    const out: { path: string; matches: GrepMatch[] }[] = [];
    const start = this.resolve(startPath);
    if (start) this.grepWalk(start, regex, startPath.replace(/\/+$/, ''), out);
    return out;
  }

  private grepWalk(
    node: VFSNode,
    regex: RegExp,
    current: string,
    out: { path: string; matches: GrepMatch[] }[],
  ): void {
    for (const name of Object.keys(node.children).sort()) {
      const child = node.children[name];
      const cp = `${current}/${name}`;
      if (child.nodeType === 'file' && child.content) {
        const text = JSON.stringify(child.content);
        if (regex.test(text)) {
          const matches: GrepMatch[] = [];
          EntitiesVFS.grepObj(child.content, regex, '', matches, 20);
          out.push({ path: cp, matches });
        }
      }
      if (child.nodeType === 'dir') this.grepWalk(child, regex, cp, out);
    }
  }

  private static grepObj(obj: any, regex: RegExp, prefix: string, matches: GrepMatch[], limit: number): void {
    if (matches.length >= limit) return;
    if (isPlainObject(obj)) {
      for (const [k, v] of Object.entries(obj)) {
        const kp = prefix ? `${prefix}.${k}` : k;
        const tk = typeof v;
        if (regex.test(k)) {
          matches.push({ key: kp, value: v });
        } else if (tk === 'string' && regex.test(v as string)) {
          matches.push({ key: kp, value: v });
        } else if (tk === 'number' && regex.test(String(v))) {
          matches.push({ key: kp, value: v });
        } else if (Array.isArray(v) || isPlainObject(v)) {
          EntitiesVFS.grepObj(v, regex, kp, matches, limit);
        }
        if (matches.length >= limit) return;
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, i) => {
        if (matches.length < limit) EntitiesVFS.grepObj(item, regex, `${prefix}[${i}]`, matches, limit);
      });
    }
  }

  // ── Compact helpers (LLM context trimming) ───────

  static compactEntity(meta: JsonDict): JsonDict {
    const out: JsonDict = {};
    for (const [k, v] of Object.entries(meta)) {
      if (ENTITY_NOISE.has(k)) continue;
      if (k in ENTITY_DEFAULTS && v === ENTITY_DEFAULTS[k]) continue;
      if (v === null && k !== 'modelId') continue;
      if (isPlainObject(v) && Object.keys(v).length === 0) continue;
      out[k] = v;
    }
    return out;
  }

  static compactComponent(comp: any): any {
    if (!isPlainObject(comp)) return comp;
    const out: JsonDict = {};
    for (const [k, v] of Object.entries(comp)) {
      if (COMPONENT_NOISE.has(k) || UI_REDUNDANT.has(k)) continue;
      if (k === 'ImageRUIDs' && isPlainObject(v) && shallowEqual(v, BUTTON_DEFAULT_IMAGES)) continue;
      if (k in DEFAULT_STRIP) {
        const def = DEFAULT_STRIP[k];
        if (isPlainObject(def)) {
          if (vecApprox(v, def)) continue;
        } else if (v === def) {
          continue;
        }
      }
      if (Array.isArray(v)) {
        if (v.length === 0) continue;
        if (v.length > LARGE_ARRAY_LIMIT) {
          out[k] = {
            _count: v.length,
            _stats: EntitiesVFS.arrayStats(k, v),
            _preview: v.slice(0, 3).map((item) => EntitiesVFS.compactPreviewItem(item)),
          };
          continue;
        }
      }
      if (isPlainObject(v)) {
        if (Object.keys(v).length === 0) continue;
        if (k === 'FootholdsByLayer') {
          out[k] = EntitiesVFS.compactFootholdLayers(v as JsonDict);
          continue;
        }
        const inner = EntitiesVFS.compactComponent(v);
        if (isPlainObject(inner) && Object.keys(inner).length > 0) {
          out[k] = inner;
        } else if (!isPlainObject(inner)) {
          out[k] = inner;
        }
        continue;
      }
      out[k] = v;
    }
    return out;
  }

  private static compactFootholdLayers(layers: JsonDict): JsonDict {
    const out: JsonDict = {};
    for (const [layerId, footholds] of Object.entries(layers)) {
      if (!Array.isArray(footholds) || footholds.length === 0) continue;
      out[layerId] = {
        _count: footholds.length,
        _stats: EntitiesVFS.footholdStats(footholds),
        _preview: footholds.slice(0, 2).map((fh) => EntitiesVFS.compactPreviewItem(fh)),
      };
    }
    return out;
  }

  private static arrayStats(_key: string, items: any[]): JsonDict {
    if (!items.length || !isPlainObject(items[0])) return {};
    const first = items[0] as JsonDict;
    const hasPos = 'position' in first || 'StartPoint' in first;
    const hasTile = 'tileIndex' in first;
    if (hasPos && hasTile) return EntitiesVFS.tileStats(items);
    if ('StartPoint' in first && 'EndPoint' in first) return EntitiesVFS.footholdStats(items);
    return {};
  }

  private static tileStats(tiles: any[]): JsonDict {
    const xs: number[] = [];
    const ys: number[] = [];
    const indices = new Set<number>();
    let empty = 0;
    for (const t of tiles) {
      const pos = (t.position ?? {}) as JsonDict;
      xs.push(Number(pos.x ?? 0));
      ys.push(Number(pos.y ?? 0));
      const idx = Number(t.tileIndex ?? -1);
      if (idx < 0) empty += 1;
      else indices.add(idx);
    }
    return {
      bounds: { min: { x: Math.min(...xs), y: Math.min(...ys) },
                max: { x: Math.max(...xs), y: Math.max(...ys) } },
      unique_indices: indices.size,
      empty_cells: empty,
    };
  }

  private static footholdStats(footholds: any[]): JsonDict {
    const xs: number[] = [];
    const ys: number[] = [];
    const groups = new Set<any>();
    for (const fh of footholds) {
      for (const ptKey of ['StartPoint', 'EndPoint']) {
        const pt = (fh?.[ptKey] ?? {}) as JsonDict;
        xs.push(Number(pt.x ?? 0));
        ys.push(Number(pt.y ?? 0));
      }
      groups.add(fh?.groupID ?? 0);
    }
    return {
      bounds: {
        min: { x: round2(Math.min(...xs)), y: round2(Math.min(...ys)) },
        max: { x: round2(Math.max(...xs)), y: round2(Math.max(...ys)) },
      },
      groups: groups.size,
    };
  }

  private static compactPreviewItem(item: any): any {
    if (!isPlainObject(item)) return item;
    const out: JsonDict = {};
    for (const [k, v] of Object.entries(item)) {
      if (COMPONENT_NOISE.has(k) || PREVIEW_NOISE.has(k)) continue;
      if (k in DEFAULT_STRIP && v === DEFAULT_STRIP[k]) continue;
      const tv = typeof v;
      if (tv === 'string' || tv === 'number' || tv === 'boolean') {
        out[k] = v;
      } else if (
        isPlainObject(v) &&
        Object.keys(v).length <= 4 &&
        Object.values(v).every((vv) => typeof vv === 'number')
      ) {
        out[k] = v;
      }
    }
    return out;
  }

  // ── Summary ──────────────────────────────────────

  protected detectAssetType(): AssetType {
    const entryKey = String(this.top.EntryKey ?? '');
    const contentType = String(this.top.ContentType ?? '');
    if (contentType === 'x-mod/map' || entryKey.startsWith('map://')) return 'map';
    if (contentType === 'x-mod/ui' || entryKey.startsWith('ui://')) return 'ui';
    if (contentType === 'x-mod/gamelogic' || entryKey.startsWith('gamelogic://')) return 'gamelogic';
    return 'unknown';
  }

  summary(): SummaryResult {
    let entCount = 0;
    const compCounts: Record<string, number> = {};
    const scripts = new Set<string>();

    const walk = (node: VFSNode): void => {
      for (const name of Object.keys(node.children).sort()) {
        const child = node.children[name];
        if (child.nodeType !== 'dir') continue;
        if (child.metadata.id) {
          entCount += 1;
          for (const fn of Object.keys(child.children).sort()) {
            const fc = child.children[fn];
            if (fc.nodeType !== 'file' || fn === '_entity.json') continue;
            const cn = fn.replace(/\.json$/, '');
            compCounts[cn] = (compCounts[cn] ?? 0) + 1;
            const ft = String(fc.metadata.full_type ?? '');
            if (ft.startsWith('script.')) scripts.add(ft);
          }
        }
        walk(child);
      }
    };
    walk(this.root);

    return {
      file: this.mapPath ? path.basename(this.mapPath) : '',
      asset_type: this.detectAssetType(),
      entry_key: String(this.top.EntryKey ?? ''),
      core_version: String(this.top.CoreVersion ?? ''),
      entity_count: entCount,
      component_counts: compCounts,
      scripts: [...scripts].sort(),
    };
  }

  get isDirty(): boolean {
    return this.dirty;
  }
}

// ── Module-local helpers ──────────────────────────

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function vecApprox(a: any, b: any): boolean {
  if (!isPlainObject(a) || !isPlainObject(b)) return a === b;
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = (a as JsonDict)[k];
    const bv = (b as JsonDict)[k];
    if (typeof av !== 'number' || typeof bv !== 'number') return false;
    if (Math.abs(av - bv) >= 1e-6) return false;
  }
  return true;
}

function shallowEqual(a: JsonDict, b: JsonDict): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}
