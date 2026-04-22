// WorldBuilder — compile a world.yaml declarative file into a directory of
// .map / .ui / .gamelogic assets. Ported from world_builder.py.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';

import { MapEntryParser } from '../entry/map';
import { UIEntryParser } from '../entry/ui';
import { deepMerge, isPlainObject } from '../entry/common';
import type { JsonDict } from '../types';

export interface BuildResult {
  maps: string[];
  ui: string[];
  gamelogic: string | null;
}

export class WorldBuilder {
  readonly yamlPath: string;
  readonly baseDir: string;
  private data: JsonDict;
  private overrides: JsonDict;

  constructor(yamlPath: string) {
    this.yamlPath = path.resolve(yamlPath);
    this.baseDir = path.dirname(this.yamlPath);
    this.overrides = {};
    const text = fs.readFileSync(yamlPath, 'utf8');
    const parsed = YAML.parse(text);
    if (!isPlainObject(parsed) || !('world' in parsed)) {
      throw new Error(
        `${yamlPath} is not a world.yaml (missing top-level 'world:' key)`,
      );
    }
    this.data = parsed;
  }

  /** Helm values.yaml-style overrides applied in order. */
  applyValues(valuesFiles: string[]): void {
    for (const vf of valuesFiles) {
      const text = fs.readFileSync(vf, 'utf8');
      const ov = YAML.parse(text);
      if (!isPlainObject(ov)) continue;
      if ('common' in ov) {
        const world = (this.data.world as JsonDict) ?? {};
        world.common = deepMerge(world.common ?? {}, ov.common);
        this.data.world = world;
      }
      for (const section of ['maps', 'ui']) {
        if (section in ov && isPlainObject(ov[section])) {
          const sect = (this.overrides[section] ??= {}) as JsonDict;
          for (const [key, val] of Object.entries(ov[section] as JsonDict)) {
            sect[key] = deepMerge(sect[key] ?? {}, val);
          }
        }
      }
    }
  }

  build(outputDir: string): BuildResult {
    const world = (this.data.world ?? {}) as JsonDict;
    const result: BuildResult = { maps: [], ui: [], gamelogic: null };

    const mapsOut = path.join(outputDir, 'map');
    const mapsList = Array.isArray(world.maps) ? world.maps : [];
    if (mapsList.length > 0) {
      fs.mkdirSync(mapsOut, { recursive: true });
      for (const item of mapsList) {
        const out = this.buildAsset(item, mapsOut, '.map', 'maps', MapEntryParser);
        if (out) result.maps.push(out);
      }
    }

    const uiOut = path.join(outputDir, 'ui');
    const uiList = Array.isArray(world.ui) ? world.ui : [];
    if (uiList.length > 0) {
      fs.mkdirSync(uiOut, { recursive: true });
      for (const item of uiList) {
        const out = this.buildAsset(item, uiOut, '.ui', 'ui', UIEntryParser);
        if (out) result.ui.push(out);
      }
    }

    const common = world.common as JsonDict | undefined;
    if (isPlainObject(common)) {
      const globalOut = path.join(outputDir, 'Global');
      fs.mkdirSync(globalOut, { recursive: true });

      for (const [key, srcRel] of Object.entries(common)) {
        if (key === 'entities') continue;
        if (typeof srcRel !== 'string') continue;
        const src = path.join(this.baseDir, srcRel);
        if (fs.existsSync(src)) {
          const dst = path.join(globalOut, path.basename(srcRel));
          fs.copyFileSync(src, dst);
        }
      }

      const glPath = path.join(globalOut, 'common.gamelogic');
      this.buildGamelogic(common, glPath);
      result.gamelogic = glPath;
    }

    return result;
  }

  private buildAsset<T extends MapEntryParser | UIEntryParser>(
    item: any,
    outDir: string,
    ext: string,
    section: string,
    VFSClass: new (fp?: string | null) => T,
  ): string | null {
    if (!isPlainObject(item) || !('$include' in item) || Object.keys(item).length !== 1) {
      return null;
    }
    const rel = item.$include;
    if (typeof rel !== 'string') return null;
    const src = path.join(this.baseDir, rel);
    if (!fs.existsSync(src)) {
      process.stderr.write(`Warning: $include not found: ${rel}\n`);
      return null;
    }
    const baseName = path.basename(rel, path.extname(rel));

    let data = YAML.parse(fs.readFileSync(src, 'utf8'));
    const srcBaseDir = path.dirname(path.resolve(src));

    const sectionOv = this.overrides[section] as JsonDict | undefined;
    const ov = sectionOv?.[baseName];
    if (ov) {
      data = expandIncludes(data, srcBaseDir);
      data = deepMerge(data, ov);
    }

    const vfs = new VFSClass(null);
    (vfs as any).yamlBaseDir = srcBaseDir;
    vfs.loadYaml(data);
    const outPath = path.join(outDir, baseName + ext);
    (vfs as any).mapPath = outPath;
    vfs.save();
    return outPath;
  }

  private buildGamelogic(common: JsonDict, outPath: string): void {
    const rootId = typeof common.id === 'string' ? common.id : randomUUID();
    const entities: any[] = [{
      id: rootId,
      path: '/common',
      componentNames: '',
      jsonString: {
        name: 'common',
        path: '/common',
        nameEditable: false,
        enable: true,
        visible: true,
        localize: false,
        displayOrder: 0,
        pathConstraints: '/',
        revision: 1,
        modelId: null,
        '@components': [],
        '@version': 1,
      },
    }];

    const commonEntities = Array.isArray(common.entities) ? common.entities : [];
    for (const ent of commonEntities) {
      if (!isPlainObject(ent)) continue;
      const eId = typeof ent.id === 'string' ? ent.id : randomUUID();
      const eName = typeof ent.name === 'string' ? ent.name : 'Entity';
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

      entities.push({
        id: eId,
        path: `/common/${eName}`,
        componentNames: compNames.join(','),
        jsonString: {
          name: eName,
          path: `/common/${eName}`,
          enable: ent.enable ?? true,
          visible: ent.visible ?? true,
          pathConstraints: '//',
          '@components': atComponents,
          '@version': 1,
        },
      });
    }

    const raw: JsonDict = {
      Id: '',
      GameId: '',
      EntryKey: `gamelogic://${randomUUID().replace(/-/g, '')}`,
      ContentType: 'x-mod/gamelogic',
      Content: '',
      Usage: 0,
      UsePublish: 1,
      UseService: 0,
      CoreVersion: '26.3.0.0',
      StudioVersion: '0.1.0.0',
      DynamicLoading: 0,
      ContentProto: {
        Use: 'Binary',
        Entities: entities,
      },
    };
    fs.writeFileSync(outPath, JSON.stringify(raw, null, 2), 'utf8');
  }
}

function expandIncludes(data: any, baseDir: string): any {
  if (!isPlainObject(data)) return data;
  const result: JsonDict = { ...data };
  const ents = result.entities;
  if (!Array.isArray(ents)) return result;
  const expanded: any[] = [];
  for (const ent of ents) {
    if (isPlainObject(ent) && '$include' in ent && Object.keys(ent).length === 1) {
      const rel = ent.$include;
      if (typeof rel === 'string') {
        let fpath: string | null = null;
        for (const sub of ['entities', 'data', 'resources', '']) {
          const p = sub ? path.join(baseDir, sub, rel) : path.join(baseDir, rel);
          if (fs.existsSync(p)) { fpath = p; break; }
        }
        if (fpath) {
          expanded.push(YAML.parse(fs.readFileSync(fpath, 'utf8')));
        } else {
          expanded.push(ent);
        }
      } else {
        expanded.push(ent);
      }
    } else {
      expanded.push(ent);
    }
  }
  result.entities = expanded;
  return result;
}
