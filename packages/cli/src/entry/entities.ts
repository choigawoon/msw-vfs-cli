// EntitiesEntryParser — shared core for .map / .ui / .gamelogic assets.
//
// Ported from entities_core.py. Constructs an in-memory VFS tree from the flat
// ContentProto.Entities[] array and exposes navigation (ls/read/tree/stat/
// search/grep/summary) + compact helpers for LLM-context-friendly output.
//
// This file covers read-only operations (P1). Mutations (edit/save/CRUD) and
// YAML import/export land in follow-up commits.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';

import { VFSNode, isPlainObject } from './common';
import type { EntryParser } from './parser';
import { resolvePreset, buildPresetSkeleton } from '../presets/native';
import {
  DEFAULT_STRIP,
  ENTITY_NOISE,
  COMPONENT_NOISE,
  UI_REDUNDANT,
  BUTTON_DEFAULT_IMAGES,
  LARGE_ARRAY_LIMIT,
  PREVIEW_NOISE,
  ENTITY_DEFAULTS,
  ENTITY_META_FIELDS,
  HEAVY_ENTITY_THRESHOLD,
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
  // Populated only in detail mode (`ls` called with detail=true). The CLI
  // uses these to render a Unix-style flag column; programmatic callers
  // get them as structured booleans.
  components?: string[];
  children_count?: number;
  entity?: boolean;       // dir has an entity id (not a passthrough like /maps)
  enable?: boolean;       // entity enable flag (default true)
  visible?: boolean;      // entity visible flag (default true)
  has_model_id?: boolean; // entity is an instance of a .model template
  has_script?: boolean;   // has at least one script.* component
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

export class EntitiesEntryParser implements EntryParser {
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

  /** Absolute path of the loaded asset, or null for YAML-sourced parsers. */
  get filePath(): string | null {
    return this.mapPath;
  }

  /** EntryParser discriminator — `map` / `ui` / `gamelogic`. */
  get type(): AssetType {
    return this.detectAssetType();
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
      const short = EntitiesEntryParser.shortName(compType);
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
        let hasScript = false;
        for (const [n, c] of Object.entries(child.children)) {
          if (c.nodeType === 'file' && n !== '_entity.json') {
            comps.push(n);
            const ft = String(c.metadata?.full_type ?? '');
            if (ft.startsWith('script.')) hasScript = true;
          }
          if (c.nodeType === 'dir') childrenCount += 1;
        }
        item.components = comps.sort();
        item.children_count = childrenCount;
        if (child.metadata.id) {
          item.entity = true;
          // enable/visible default to true when absent — surface the effective
          // value so the caller doesn't have to re-apply defaults.
          item.enable = child.metadata.enable !== false;
          item.visible = child.metadata.visible !== false;
          item.has_model_id = Boolean(child.metadata.modelId);
          item.has_script = hasScript;
        }
      }
      items.push(item);
    }
    return { path: p, items };
  }

  read(p: string, compact: boolean = false): ReadResult {
    const node = this.resolve(p);
    if (!node) return { error: `'${p}' not found` };
    if (node.nodeType === 'dir') {
      const meta = compact ? EntitiesEntryParser.compactEntity(node.metadata) : node.metadata;
      return { type: 'entity', path: p, metadata: meta };
    }
    const content = compact ? EntitiesEntryParser.compactComponent(node.content) : node.content;
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
          EntitiesEntryParser.grepObj(child.content, regex, '', matches, 20);
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
          EntitiesEntryParser.grepObj(v, regex, kp, matches, limit);
        }
        if (matches.length >= limit) return;
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, i) => {
        if (matches.length < limit) EntitiesEntryParser.grepObj(item, regex, `${prefix}[${i}]`, matches, limit);
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
            _stats: EntitiesEntryParser.arrayStats(k, v),
            _preview: v.slice(0, 3).map((item) => EntitiesEntryParser.compactPreviewItem(item)),
          };
          continue;
        }
      }
      if (isPlainObject(v)) {
        if (Object.keys(v).length === 0) continue;
        if (k === 'FootholdsByLayer') {
          out[k] = EntitiesEntryParser.compactFootholdLayers(v as JsonDict);
          continue;
        }
        const inner = EntitiesEntryParser.compactComponent(v);
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
        _stats: EntitiesEntryParser.footholdStats(footholds),
        _preview: footholds.slice(0, 2).map((fh) => EntitiesEntryParser.compactPreviewItem(fh)),
      };
    }
    return out;
  }

  private static arrayStats(_key: string, items: any[]): JsonDict {
    if (!items.length || !isPlainObject(items[0])) return {};
    const first = items[0] as JsonDict;
    const hasPos = 'position' in first || 'StartPoint' in first;
    const hasTile = 'tileIndex' in first;
    if (hasPos && hasTile) return EntitiesEntryParser.tileStats(items);
    if ('StartPoint' in first && 'EndPoint' in first) return EntitiesEntryParser.footholdStats(items);
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

  /** First level of backed entities under the root's shallowest entity ancestor.
   *  For `/maps/map01/*` or `/ui/DefaultGroup/*` layouts, returns the direct
   *  entity children of the single map/ui root. Used by the web viewer summary. */
  listTopLevelEntities(): Array<{ path: string; name: string; components: string[] }> {
    const findRoot = (node: VFSNode, p: string): [VFSNode, string] | null => {
      for (const name of Object.keys(node.children).sort()) {
        const c = node.children[name];
        if (c.nodeType !== 'dir') continue;
        const cp = p === '/' ? `/${name}` : `${p.replace(/\/+$/, '')}/${name}`;
        if (c.metadata.id) return [c, cp];
        const nested = findRoot(c, cp);
        if (nested) return nested;
      }
      return null;
    };
    const root = findRoot(this.root, '/');
    if (!root) return [];
    const [rootNode, rootPath] = root;
    const out: Array<{ path: string; name: string; components: string[] }> = [];
    for (const name of Object.keys(rootNode.children).sort()) {
      const c = rootNode.children[name];
      if (c.nodeType !== 'dir' || !c.metadata.id) continue;
      const cp = `${rootPath.replace(/\/+$/, '')}/${name}`;
      const comps: string[] = [];
      for (const [fn, fnode] of Object.entries(c.children)) {
        if (fnode.nodeType === 'file' && fn !== '_entity.json') {
          comps.push(fn.replace(/\.json$/, ''));
        }
      }
      out.push({ path: cp, name: String(c.metadata.name ?? name), components: comps });
    }
    return out;
  }

  // ── Layer 2 — Entity-oriented reads ─────────────
  //
  // Higher-level API that treats an entity as the unit: one entity =
  // metadata + all components bundled. Layer 1 (ls/read/grep) still works
  // on paths; Layer 2 expresses the same data in GameObject-like shape.

  /** Bundle one entity: metadata + all components keyed by full @type.
   *  With `deep: true`, recursively includes child entities. */
  readEntity(
    p: string,
    opts: { deep?: boolean; compact?: boolean } = {},
  ): { error: string } | {
    path: string;
    name: string;
    metadata: JsonDict;
    components: Record<string, any>;
    children?: any[];
  } {
    const node = this.resolve(p);
    if (!node) return { error: `'${p}' not found` };
    if (node.nodeType !== 'dir') return { error: `'${p}' is not a directory` };
    if (!node.metadata.id) return { error: `'${p}' is not an entity` };

    const components: Record<string, any> = {};
    const children: any[] = [];
    const base = p.replace(/\/+$/, '') || '/';
    for (const name of Object.keys(node.children).sort()) {
      const child = node.children[name];
      if (child.nodeType === 'file') {
        if (name === '_entity.json') continue;
        const type = String(child.metadata.full_type ?? name.replace(/\.json$/, ''));
        components[type] = opts.compact
          ? EntitiesEntryParser.compactComponent(child.content)
          : child.content;
      } else if (child.nodeType === 'dir' && child.metadata.id) {
        const cp = base === '/' ? `/${name}` : `${base}/${name}`;
        if (opts.deep) {
          const sub = this.readEntity(cp, opts);
          if (!('error' in sub)) children.push(sub);
        } else {
          children.push({
            path: cp,
            name: String(child.metadata.name ?? name),
          });
        }
      }
    }

    const meta = opts.compact
      ? EntitiesEntryParser.compactEntity(node.metadata)
      : node.metadata;
    const out: any = {
      path: p,
      name: String(node.metadata.name ?? node.name),
      metadata: meta,
      components,
    };
    if (children.length > 0) out.children = children;
    return out;
  }

  /** Child entities under `p`. Transparently descends through pass-through
   *  directories (dirs with no entity `id`, e.g. `/maps/`) so the caller
   *  sees the first real entity layer regardless of where those entities
   *  are nested in the underlying VFS. Component files and `_entity.json`
   *  are never returned. */
  listEntities(
    p: string = '/',
    opts: { recursive?: boolean } = {},
  ): { error: string } | {
    path: string;
    entities: Array<{
      path: string;
      name: string;
      components: string[];
      children_count: number;
      modelId?: string;
    }>;
  } {
    const node = this.resolve(p);
    if (!node) return { error: `'${p}' not found` };
    if (node.nodeType !== 'dir') return { error: `'${p}' is not a directory` };

    const out: Array<{
      path: string;
      name: string;
      components: string[];
      children_count: number;
      modelId?: string;
    }> = [];
    const base = (p.replace(/\/+$/, '') || '');

    /** Count child entities visible through the same pass-through transparency
     *  — mirrors what this call would return if invoked on `n`'s path. */
    const countChildEntities = (n: VFSNode): number => {
      let c = 0;
      for (const child of Object.values(n.children)) {
        if (child.nodeType !== 'dir') continue;
        if (child.metadata.id) c += 1;
        else c += countChildEntities(child);
      }
      return c;
    };

    const collect = (n: VFSNode, pp: string): void => {
      for (const name of Object.keys(n.children).sort()) {
        const child = n.children[name];
        if (child.nodeType !== 'dir') continue;
        const cp = pp === '' ? `/${name}` : `${pp}/${name}`;
        if (child.metadata.id) {
          const comps: string[] = [];
          for (const [fn, fnode] of Object.entries(child.children)) {
            if (fnode.nodeType === 'file' && fn !== '_entity.json') {
              comps.push(fn.replace(/\.json$/, ''));
            }
          }
          const item: any = {
            path: cp,
            name: String(child.metadata.name ?? name),
            components: comps.sort(),
            children_count: countChildEntities(child),
          };
          if (child.metadata.modelId) item.modelId = String(child.metadata.modelId);
          out.push(item);
          if (opts.recursive) collect(child, cp);
        } else {
          // Pass-through (non-entity dir, e.g. /maps/ or /maps/map01/):
          // walk transparently so callers see the real entity layer.
          collect(child, cp);
        }
      }
    };
    collect(node, base);
    return { path: p, entities: out };
  }

  /** Find entities whose name / component type / modelId matches `pattern`
   *  (case-insensitive regex). */
  findEntities(
    pattern: string,
    opts: { by?: 'name' | 'component' | 'modelId'; startPath?: string } = {},
  ): { error: string } | Array<{
    path: string;
    name: string;
    matched: string;
    modelId?: string;
  }> {
    const by = opts.by ?? 'name';
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch (e: any) {
      return { error: `Invalid regex: ${e.message ?? String(e)}` };
    }
    const startPath = opts.startPath ?? '/';
    const start = this.resolve(startPath);
    if (!start) return { error: `'${startPath}' not found` };

    const out: Array<{ path: string; name: string; matched: string; modelId?: string }> = [];
    const base = startPath.replace(/\/+$/, '');

    const walk = (n: VFSNode, pp: string): void => {
      for (const name of Object.keys(n.children).sort()) {
        const child = n.children[name];
        if (child.nodeType !== 'dir') continue;
        const cp = pp === '' ? `/${name}` : `${pp}/${name}`;
        if (child.metadata.id) {
          const entName = String(child.metadata.name ?? name);
          const modelId = child.metadata.modelId ? String(child.metadata.modelId) : undefined;
          let matched: string | null = null;
          if (by === 'name' && regex.test(entName)) matched = entName;
          else if (by === 'modelId' && modelId && regex.test(modelId)) matched = modelId;
          else if (by === 'component') {
            for (const [fn, fnode] of Object.entries(child.children)) {
              if (fnode.nodeType === 'file' && fn !== '_entity.json') {
                const ft = String(fnode.metadata.full_type ?? fn);
                if (regex.test(ft)) {
                  matched = ft;
                  break;
                }
              }
            }
          }
          if (matched !== null) {
            const item: any = { path: cp, name: entName, matched };
            if (modelId) item.modelId = modelId;
            out.push(item);
          }
        }
        walk(child, cp);
      }
    };
    walk(start, base);
    return out;
  }

  /** grep, but results grouped by owning entity. */
  grepEntities(
    pattern: string,
    startPath: string = '/',
  ): { error: string } | Array<{
    entity: string;
    name: string;
    hits: Array<{ component: string; path: string; matches: GrepMatch[] }>;
  }> {
    const raw = this.grep(pattern, startPath);
    if (!Array.isArray(raw)) return raw;

    const byEntity = new Map<string, Array<{ component: string; path: string; matches: GrepMatch[] }>>();
    for (const r of raw) {
      const parentPath = r.path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
      const parent = this.resolve(parentPath);
      if (!parent || !parent.metadata.id) continue;
      const compName = r.path.split('/').pop() ?? '';
      if (compName === '_entity.json') continue;
      const list = byEntity.get(parentPath) ?? [];
      list.push({
        component: compName.replace(/\.json$/, ''),
        path: r.path,
        matches: r.matches,
      });
      byEntity.set(parentPath, list);
    }

    const out: Array<{
      entity: string;
      name: string;
      hits: Array<{ component: string; path: string; matches: GrepMatch[] }>;
    }> = [];
    for (const [ent, hits] of byEntity) {
      const node = this.resolve(ent);
      const name = node
        ? String(node.metadata.name ?? ent.split('/').pop() ?? '')
        : '';
      out.push({ entity: ent, name, hits });
    }
    return out;
  }

  // ── Mutation / Save ──────────────────────────────

  edit(p: string, updates: JsonDict): ActionResult {
    const node = this.resolve(p);
    if (!node) return { error: `'${p}' not found` };
    if (node.nodeType !== 'file') return { error: `'${p}' is a directory` };
    if (node.name === '_entity.json') {
      return { error: '_entity.json is read-only. Use editEntity()' };
    }

    for (const [k, v] of Object.entries(updates)) (node.content as JsonDict)[k] = v;

    // Mirror the update on the flat Entities[] @components entry. This is
    // usually the same object reference, but Python does it defensively so we
    // match that behaviour.
    const parentPath = p.replace(/\/+$/, '').split('/').slice(0, -1).join('/');
    const parent = this.resolve(parentPath);
    if (parent && parent.entityIndex !== null) {
      const entity = this.entities[parent.entityIndex];
      const ft = node.metadata.full_type;
      const comps = ((entity.jsonString as JsonDict | undefined)?.['@components'] as JsonDict[] | undefined) ?? [];
      for (const comp of comps) {
        if (comp?.['@type'] === ft) {
          for (const [k, v] of Object.entries(updates)) comp[k] = v;
          break;
        }
      }
    }

    this.dirty = true;
    return { ok: true, path: p, updated: Object.keys(updates) };
  }

  save(outputPath: string | null = null, runValidate: boolean = true, strict: boolean = false): SaveResult {
    const target = outputPath ?? this.mapPath;
    if (!target) return { ok: false, path: '', error: 'no target path' };
    const result: SaveResult = { ok: true, path: target };
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
    JSON.parse(content); // sanity: catches circular refs / NaN / Infinity
    fs.writeFileSync(target, content, 'utf8');
    this.dirty = false;
    return result;
  }

  // ── Entity / Component CRUD ──────────────────────

  addEntity(
    parentPath: string,
    name: string,
    opts: {
      components?: (string | JsonDict)[];
      modelId?: string | null;
      enable?: boolean;
      visible?: boolean;
      nameEditable?: boolean;
      localize?: boolean;
      /** Native preset name/id (e.g., "UISprite"). When set, the entity's
       *  modelId, origin, and components[] are seeded from the bundled
       *  .model file. Mutually exclusive with `components` and `modelId`. */
      preset?: string | null;
      /** Pre-built origin object. When provided alongside components[], sets
       *  origin directly without going through the preset resolver. Used by
       *  spawn-model to inject user .model skeletons. */
      origin?: JsonDict | null;
    } = {},
  ): ActionResult {
    const parent = this.resolve(parentPath);
    if (!parent) return { error: `parent '${parentPath}' not found` };
    if (parent.nodeType !== 'dir') return { error: `'${parentPath}' is not a directory` };
    if (name in parent.children) {
      return { error: `'${name}' already exists under '${parentPath}'` };
    }

    const pp = parentPath.replace(/\/+$/, '');
    const fullPath = pp ? `${pp}/${name}` : `/${name}`;
    const pathConstraints = '/'.repeat((fullPath.match(/\//g) ?? []).length);

    let presetModelId: string | null = null;
    let presetOrigin: JsonDict | null = null;
    const atComponents: JsonDict[] = [];
    const compNames: string[] = [];

    if (opts.preset) {
      if (opts.components && opts.components.length > 0) {
        return { error: `--preset and --component are mutually exclusive; use --preset then 'add-component' for extras` };
      }
      if (opts.modelId) {
        return { error: `--preset and --model-id are mutually exclusive` };
      }
      const preset = resolvePreset(opts.preset);
      if (!preset) {
        return { error: `unknown preset '${opts.preset}' — run 'msw-vfs presets list' to see bundled presets` };
      }
      const skeleton = buildPresetSkeleton(preset);
      presetModelId = skeleton.modelId;
      presetOrigin = skeleton.origin;
      for (const c of skeleton.components) {
        atComponents.push(c);
        compNames.push(String(c['@type']));
      }
    } else {
      for (const comp of opts.components ?? []) {
        if (typeof comp === 'string') {
          atComponents.push({ '@type': comp, Enable: true });
          compNames.push(comp);
        } else if (isPlainObject(comp)) {
          const typed = comp['@type'];
          if (typeof typed !== 'string' || !typed) {
            return { error: "component missing '@type'" };
          }
          const c: JsonDict = { ...comp };
          if (!('Enable' in c)) c.Enable = true;
          atComponents.push(c);
          compNames.push(typed);
        } else {
          return { error: 'invalid component entry' };
        }
      }
    }

    const entityId = randomUUID();
    const js: JsonDict = {
      name,
      path: fullPath,
      nameEditable: opts.nameEditable ?? true,
      enable: opts.enable ?? true,
      visible: opts.visible ?? true,
      localize: opts.localize ?? false,
      displayOrder: 0,
      pathConstraints,
      revision: 1,
      modelId: presetModelId ?? opts.modelId ?? null,
      '@components': atComponents,
      '@version': 1,
    };
    if (presetOrigin) js.origin = presetOrigin;
    else if (opts.origin) js.origin = opts.origin;
    const entityRaw: RawEntity = {
      id: entityId,
      path: fullPath,
      componentNames: compNames.join(','),
      jsonString: js,
    };
    const idx = this.entities.length;
    this.entities.push(entityRaw);
    this.syncEntitiesToRaw();
    this.mountEntity(entityRaw, idx);

    this.dirty = true;
    return {
      ok: true,
      path: fullPath,
      id: entityId,
      components_added: atComponents.length,
    };
  }

  removeEntity(p: string): ActionResult {
    const node = this.resolve(p);
    if (!node || node === this.root) return { error: `cannot remove '${p}'` };
    if (node.nodeType !== 'dir') return { error: `'${p}' is not an entity (dir)` };
    if (node.entityIndex === null) {
      return { error: `'${p}' has no backing entity record` };
    }

    const pathsToRemove: string[] = [];
    const collect = (n: VFSNode, pp: string): void => {
      if (n.metadata.id) pathsToRemove.push(pp);
      for (const [cname, c] of Object.entries(n.children)) {
        if (c.nodeType === 'dir') {
          const cp = pp === '/' ? `/${cname}` : `${pp.replace(/\/+$/, '')}/${cname}`;
          collect(c, cp);
        }
      }
    };
    collect(node, p);

    const pathsSet = new Set(pathsToRemove);
    const kept = this.entities.filter((e) => !pathsSet.has(e.path ?? ''));
    const removed = this.entities.length - kept.length;
    this.entities = kept;
    this.syncEntitiesToRaw();

    const parentPath = p.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
    const parent = this.resolve(parentPath);
    const childName = p.replace(/\/+$/, '').split('/').pop() ?? '';
    if (parent && childName in parent.children) delete parent.children[childName];

    this.reindexEntities();
    this.dirty = true;
    return { ok: true, removed, paths: pathsToRemove };
  }

  protected reindexEntities(): void {
    const pathToIdx = new Map<string, number>();
    this.entities.forEach((e, i) => pathToIdx.set(e.path ?? '', i));
    const walk = (n: VFSNode, pp: string): void => {
      for (const [cname, c] of Object.entries(n.children)) {
        if (c.nodeType === 'dir') {
          const cp = pp === '/' ? `/${cname}` : `${pp.replace(/\/+$/, '')}/${cname}`;
          c.entityIndex = pathToIdx.get(cp) ?? null;
          walk(c, cp);
        }
      }
    };
    walk(this.root, '/');
  }

  protected syncEntitiesToRaw(): void {
    if (!this.raw) return;
    if (!this.raw.ContentProto) this.raw.ContentProto = {};
    (this.raw.ContentProto as JsonDict).Entities = this.entities;
  }

  editEntity(p: string, updates: JsonDict): ActionResult {
    const node = this.resolve(p);
    if (!node || node.nodeType !== 'dir') {
      return { error: `'${p}' not found or not an entity` };
    }
    if (node.entityIndex === null) {
      return { error: `'${p}' has no backing entity record` };
    }

    const keys = Object.keys(updates);
    const bad = keys.filter((k) => !ENTITY_META_FIELDS.has(k));
    if (bad.length) {
      return { error: `fields not editable via editEntity: ${JSON.stringify(bad.sort())}` };
    }
    if ('name' in updates) {
      return { error: "use renameEntity() to change 'name'" };
    }

    const entity = this.entities[node.entityIndex];
    const js = (entity.jsonString ?? {}) as JsonDict;
    for (const [k, v] of Object.entries(updates)) {
      js[k] = v;
      node.metadata[k] = v;
    }
    const newRev = Number(js.revision ?? 1) + 1;
    js.revision = newRev;
    node.metadata.revision = newRev;

    const entFile = node.children['_entity.json'];
    if (entFile) entFile.content = node.metadata;

    this.dirty = true;
    return { ok: true, path: p, updated: keys, revision: newRev };
  }

  renameEntity(p: string, newName: string): ActionResult {
    const node = this.resolve(p);
    if (!node || node.nodeType !== 'dir' || node.entityIndex === null) {
      return { error: `'${p}' is not an entity` };
    }
    const parentPath = p.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
    const parent = this.resolve(parentPath);
    const oldName = p.replace(/\/+$/, '').split('/').pop() ?? '';
    if (!parent || !(oldName in parent.children)) {
      return { error: `parent of '${p}' not found` };
    }
    if (newName in parent.children) {
      return { error: `'${newName}' already exists under '${parentPath}'` };
    }

    const newPath = parentPath === '/' ? `/${newName}` : `${parentPath.replace(/\/+$/, '')}/${newName}`;

    const walkAndUpdate = (n: VFSNode, oldP: string, newP: string): void => {
      if (n.entityIndex !== null) {
        const ent = this.entities[n.entityIndex];
        ent.path = newP;
        const ejs = (ent.jsonString ?? {}) as JsonDict;
        ejs.path = newP;
        ejs.revision = Number(ejs.revision ?? 1) + 1;
      }
      for (const [cname, c] of Object.entries(n.children)) {
        if (c.nodeType === 'dir') {
          walkAndUpdate(
            c,
            `${oldP.replace(/\/+$/, '')}/${cname}`,
            `${newP.replace(/\/+$/, '')}/${cname}`,
          );
        }
      }
    };

    const entity = this.entities[node.entityIndex];
    (entity.jsonString as JsonDict).name = newName;
    node.name = newName;
    node.metadata.name = newName;

    walkAndUpdate(node, p, newPath);

    delete parent.children[oldName];
    parent.children[newName] = node;

    this.reindexEntities();
    this.dirty = true;
    return { ok: true, old_path: p, new_path: newPath };
  }

  addComponent(entityPath: string, typeName: string, properties?: JsonDict): ActionResult {
    const node = this.resolve(entityPath);
    if (!node || node.nodeType !== 'dir' || node.entityIndex === null) {
      return { error: `'${entityPath}' is not an entity` };
    }
    if (!typeName || typeof typeName !== 'string') {
      return { error: 'typeName must be a non-empty string' };
    }

    const entity = this.entities[node.entityIndex];
    const js = (entity.jsonString ?? {}) as JsonDict;
    const existing = (js['@components'] as JsonDict[] | undefined) ?? [];
    for (const c of existing) {
      if (c?.['@type'] === typeName) {
        return { error: `component '${typeName}' already exists on '${entityPath}'` };
      }
    }

    const comp: JsonDict = { '@type': typeName, Enable: true };
    if (properties) {
      for (const [k, v] of Object.entries(properties)) comp[k] = v;
    }
    if (!Array.isArray(js['@components'])) js['@components'] = [];
    (js['@components'] as JsonDict[]).push(comp);

    const cn = entity.componentNames ?? '';
    const names = cn ? cn.split(',').filter(Boolean) : [];
    names.push(typeName);
    entity.componentNames = names.join(',');
    node.metadata.componentNames = entity.componentNames;

    const short = EntitiesEntryParser.shortName(typeName);
    let fname = `${short}.json`;
    if (fname in node.children) {
      let i = 2;
      while (`${short}_${i}.json` in node.children) i += 1;
      fname = `${short}_${i}.json`;
    }
    node.children[fname] = new VFSNode(fname, 'file', comp, { full_type: typeName });

    js.revision = Number(js.revision ?? 1) + 1;
    this.dirty = true;
    return {
      ok: true,
      entity: entityPath,
      component: typeName,
      file: `${entityPath.replace(/\/+$/, '')}/${fname}`,
    };
  }

  removeComponent(entityPath: string, typeName: string): ActionResult {
    const node = this.resolve(entityPath);
    if (!node || node.nodeType !== 'dir' || node.entityIndex === null) {
      return { error: `'${entityPath}' is not an entity` };
    }
    const entity = this.entities[node.entityIndex];
    const js = (entity.jsonString ?? {}) as JsonDict;
    const comps = (js['@components'] as JsonDict[] | undefined) ?? [];
    const kept = comps.filter((c) => c?.['@type'] !== typeName);
    if (kept.length === comps.length) {
      return { error: `component '${typeName}' not found on '${entityPath}'` };
    }
    js['@components'] = kept;

    const names = kept.map((c) => (typeof c?.['@type'] === 'string' ? c['@type'] : '')).filter(Boolean);
    entity.componentNames = names.join(',');
    node.metadata.componentNames = entity.componentNames;

    const toRemove: string[] = [];
    for (const [fname, fnode] of Object.entries(node.children)) {
      if (fnode.nodeType === 'file' && fnode.metadata.full_type === typeName) {
        toRemove.push(fname);
      }
    }
    for (const fname of toRemove) delete node.children[fname];

    js.revision = Number(js.revision ?? 1) + 1;
    this.dirty = true;
    return {
      ok: true,
      entity: entityPath,
      component: typeName,
      removed_files: toRemove,
    };
  }

  /** Edit a component by (entity path, component @type) rather than by
   *  component file path. Errors when the entity carries 0 or >1 matching
   *  components — in the latter case the caller must disambiguate with
   *  the Layer 1 `edit <path>` form. */
  editComponent(
    entityPath: string,
    typeName: string,
    updates: JsonDict,
  ): ActionResult {
    const node = this.resolve(entityPath);
    if (!node || node.nodeType !== 'dir' || !node.metadata.id) {
      return { error: `'${entityPath}' is not an entity` };
    }
    const matches: string[] = [];
    for (const [fn, fnode] of Object.entries(node.children)) {
      if (
        fnode.nodeType === 'file' &&
        fn !== '_entity.json' &&
        fnode.metadata.full_type === typeName
      ) {
        matches.push(fn);
      }
    }
    if (matches.length === 0) {
      return { error: `component '${typeName}' not on entity '${entityPath}'` };
    }
    if (matches.length > 1) {
      return {
        error: `multiple '${typeName}' components on '${entityPath}'; disambiguate with edit <path>: ${matches.join(', ')}`,
      };
    }
    const base = entityPath.replace(/\/+$/, '') || '';
    const filePath = base === '' ? `/${matches[0]}` : `${base}/${matches[0]}`;
    return this.edit(filePath, updates);
  }

  // ── Validation ────────────────────────────────────

  validate(): ValidateResult {
    const warnings: string[] = [];
    const idsSeen = new Map<string, string>();
    const pathsSeen = new Set<string>();
    for (const e of this.entities) {
      const eid = e.id ?? '';
      const p = e.path ?? '';
      if (!eid) warnings.push(`empty id at path '${p}'`);
      if (!p) warnings.push(`empty path for id '${eid}'`);
      if (eid && idsSeen.has(eid)) {
        warnings.push(`duplicate id '${eid}': '${p}' and '${idsSeen.get(eid)}'`);
      } else if (eid) {
        idsSeen.set(eid, p);
      }
      if (p && pathsSeen.has(p)) {
        warnings.push(`duplicate path '${p}'`);
      } else if (p) {
        pathsSeen.add(p);
      }

      const cn = e.componentNames ?? '';
      const expected = cn ? cn.split(',').filter(Boolean) : [];
      const js = (e.jsonString ?? {}) as JsonDict;
      const comps = (js['@components'] as JsonDict[] | undefined) ?? [];
      const actual = comps.map((c) => (typeof c?.['@type'] === 'string' ? c['@type'] : ''));
      const same = expected.length === actual.length && expected.every((v, i) => v === actual[i]);
      if (!same) {
        warnings.push(
          `componentNames mismatch at '${p}': csv=${JSON.stringify(expected)}, @components=${JSON.stringify(actual)}`,
        );
      }

      comps.forEach((c, i) => {
        if (!c?.['@type']) warnings.push(`@components[${i}] missing '@type' at '${p}'`);
      });

      const jsPath = js.path;
      if (jsPath && jsPath !== p) {
        warnings.push(`path mismatch at '${p}': jsonString.path='${jsPath}'`);
      }
    }
    return { ok: warnings.length === 0, warnings, entity_count: this.entities.length };
  }

  // ── YAML import ──────────────────────────────────

  /** Populate this VFS from a YAML export (output of {@link exportYaml}). */
  loadYaml(data: JsonDict): void {
    const meta = (data.meta ?? {}) as JsonDict;
    this.top = { ...meta };
    this.entities = [];

    const flatten = (entityList: any[] | null | undefined): void => {
      for (const rawEnt of entityList ?? []) {
        let ent: any = rawEnt;
        if (isPlainObject(ent) && '$include' in ent && Object.keys(ent).length === 1) {
          ent = this.resolveInclude(ent['$include']);
          if (!isPlainObject(ent) || '$include' in ent) continue;
        }

        const eId = typeof ent.id === 'string' && ent.id ? ent.id : randomUUID();
        const p = typeof ent.path === 'string' ? ent.path : '';
        const components = isPlainObject(ent.components) ? ent.components : {};

        const atComponents: JsonDict[] = [];
        const compNames: string[] = [];
        for (const compData of Object.values(components)) {
          if (!isPlainObject(compData)) continue;
          const fullType = typeof compData._type === 'string' ? compData._type : '';
          const compDict: JsonDict = { '@type': fullType };
          for (const [k, v] of Object.entries(compData)) {
            if (k === '_type') continue;
            compDict[k] = v;
          }
          atComponents.push(compDict);
          compNames.push(fullType);
        }

        const js: JsonDict = {
          name: ent.name ?? (p ? p.split('/').pop() : ''),
          path: p,
          enable: ent.enable ?? true,
          visible: ent.visible ?? true,
          '@components': atComponents,
          '@version': 1,
        };
        if (ent.modelId) js.modelId = ent.modelId;
        if (ent.origin) js.origin = ent.origin;

        const entityRaw: RawEntity = {
          id: eId,
          path: p,
          componentNames: compNames.join(','),
          jsonString: js,
        };
        const idx = this.entities.length;
        this.entities.push(entityRaw);
        this.mountEntity(entityRaw, idx);

        flatten(ent.children);
      }
    };
    flatten(Array.isArray(data.entities) ? data.entities : []);

    this.raw = { ...this.top };
    this.raw.ContentProto = { Use: 'Binary', Entities: this.entities };
    this.dirty = true;
  }

  private resolveInclude(relPath: any): any {
    if (typeof relPath !== 'string') return { $include: relPath };
    if (!this.yamlBaseDir) return { $include: relPath };
    const candidates: string[] = [];
    for (const sub of ['entities', 'data', 'resources']) {
      candidates.push(path.join(this.yamlBaseDir, sub, relPath));
    }
    candidates.push(path.join(this.yamlBaseDir, relPath));
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        const text = fs.readFileSync(c, 'utf8');
        return YAML.parse(text);
      }
    }
    return { $include: relPath, _error: 'file not found' };
  }

  /** Factory: build a subclass instance from a YAML file. Sets mapPath to the
   *  matching `.map`/`.ui`/`.gamelogic` extension based on meta.ContentType. */
  static fromYamlFile<T extends EntitiesEntryParser>(
    this: new (fp?: string | null) => T,
    yamlPath: string,
  ): T {
    const text = fs.readFileSync(yamlPath, 'utf8');
    const data = YAML.parse(text);
    if (isPlainObject(data) && 'world' in data) {
      throw new Error(
        "world.yaml detected. Use 'build-world' CLI command instead of import-yaml.",
      );
    }
    const ct = (isPlainObject(data) && isPlainObject((data as JsonDict).meta))
      ? ((data as JsonDict).meta as JsonDict).ContentType
      : '';
    const extMap: Record<string, string> = {
      'x-mod/map': '.map',
      'x-mod/ui': '.ui',
      'x-mod/gamelogic': '.gamelogic',
    };
    const ext = (typeof ct === 'string' && extMap[ct]) || '.map';
    const base = yamlPath.replace(/\.[^.]+$/, '');

    const vfs = new this(null);
    (vfs as any).mapPath = base + ext;
    (vfs as any).yamlBaseDir = path.dirname(path.resolve(yamlPath));
    vfs.loadYaml(data);
    return vfs;
  }

  // ── YAML export ──────────────────────────────────

  exportYaml(dataDir: string | null = null): JsonDict {
    this.dataDir = dataDir;
    this.dataFiles = {};
    if (dataDir) fs.mkdirSync(dataDir, { recursive: true });

    const s = this.summary();
    const result: JsonDict = {
      asset_type: s.asset_type,
      entry_key: s.entry_key,
      meta: Object.fromEntries(
        Object.entries(this.top).filter(([k]) => k !== 'ContentProto'),
      ),
      entities: this.exportChildren(this.root, '/'),
    };

    if (dataDir) {
      for (const [relPath, entityData] of Object.entries(this.dataFiles)) {
        const fpath = path.join(dataDir, relPath);
        fs.mkdirSync(path.dirname(fpath), { recursive: true });
        fs.writeFileSync(fpath, YAML.stringify(entityData), 'utf8');
      }
    }

    this.dataDir = null;
    this.dataFiles = {};
    return result;
  }

  private isHeavyEntity(node: VFSNode): boolean {
    let total = 0;
    for (const [fname, fnode] of Object.entries(node.children)) {
      if (fnode.nodeType !== 'file' || fname === '_entity.json') continue;
      if (!isPlainObject(fnode.content)) continue;
      for (const v of Object.values(fnode.content)) {
        if (Array.isArray(v)) total += v.length;
        else if (isPlainObject(v)) {
          for (const vv of Object.values(v)) {
            if (Array.isArray(vv)) total += vv.length;
          }
        }
      }
    }
    return total > HEAVY_ENTITY_THRESHOLD;
  }

  private exportChildren(node: VFSNode, parentPath: string): any[] {
    const children: any[] = [];
    for (const name of Object.keys(node.children).sort()) {
      const child = node.children[name];
      if (child.nodeType !== 'dir') continue;
      const cp = `${parentPath.replace(/\/+$/, '')}/${name}`;
      if (!child.metadata.id) {
        children.push(...this.exportChildren(child, cp));
        continue;
      }
      const entityDict = this.exportEntity(child, cp);
      if (this.dataDir && this.isHeavyEntity(child)) {
        const entityName = String(child.metadata.name ?? name);
        const rel = `${entityName}.yaml`;
        this.dataFiles[rel] = entityDict;
        children.push({ $include: rel });
      } else {
        children.push(entityDict);
      }
    }
    return children;
  }

  private exportEntity(node: VFSNode, p: string): JsonDict {
    const meta = node.metadata;
    const entityName = meta.name ?? node.name;
    const entity: JsonDict = { name: entityName, path: p };
    if (meta.id) entity.id = meta.id;
    if (meta.modelId) entity.modelId = meta.modelId;
    if (meta.origin) entity.origin = meta.origin;
    if (meta.enable === false) entity.enable = false;
    if (meta.visible === false) entity.visible = false;

    const components: JsonDict = {};
    for (const fname of Object.keys(node.children).sort()) {
      const fnode = node.children[fname];
      if (fnode.nodeType !== 'file' || fname === '_entity.json') continue;
      const compName = fname.replace(/\.json$/, '');
      const fullType = String(fnode.metadata.full_type ?? '');
      const compData = this.exportComponent(fnode.content);
      components[compName] = { _type: fullType, ...(isPlainObject(compData) ? compData : {}) };
    }
    if (Object.keys(components).length > 0) entity.components = components;

    const sub = this.exportChildren(node, p);
    if (sub.length > 0) entity.children = sub;

    return entity;
  }

  private exportComponent(content: any): JsonDict | any {
    if (!isPlainObject(content)) return content;
    const out: JsonDict = {};
    for (const [k, v] of Object.entries(content)) {
      if (k === '@type') continue;
      if (k in DEFAULT_STRIP) {
        const def = DEFAULT_STRIP[k];
        if (isPlainObject(def)) {
          if (vecApprox(v, def)) continue;
        } else if (v === def) {
          continue;
        }
      }
      if (isPlainObject(v) && Object.keys(v).length === 0) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }
    return out;
  }
}

export type ActionResult = { error: string } | ({ ok: true } & JsonDict);
export interface SaveResult {
  ok: boolean;
  path: string;
  warnings?: string[];
  error?: string;
}
export interface ValidateResult {
  ok: boolean;
  warnings: string[];
  entity_count: number;
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
