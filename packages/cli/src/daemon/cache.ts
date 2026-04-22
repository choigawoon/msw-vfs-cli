// In-memory VFS instance cache, keyed by absolute path + mtime.
//
// Cache entries are reused across daemon requests so heavy JSON parsing
// (e.g. 1.7MB IntroMap.map) happens once per map, not per request.
// File mutation invalidates via mtime comparison; mutation commands also
// invalidate explicitly via invalidate() on save.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { MapVFS } from '../vfs/map';
import { UIVFS } from '../vfs/ui';
import { GameLogicVFS } from '../vfs/gamelogic';
import { ModelVFS } from '../model/vfs';
import type { EntitiesVFS } from '../vfs/entities';
import {
  setEntitiesFactory,
  setModelFactory,
  resetFactories,
} from '../factory';

interface Entry {
  vfs: EntitiesVFS | ModelVFS;
  mtimeMs: number;
  lastAccess: number;
  type: string;
}

const cache = new Map<string, Entry>();

function key(type: string, abs: string): string {
  return `${type}:${abs}`;
}

function instantiate(type: string, file: string): EntitiesVFS | ModelVFS {
  switch (type) {
    case 'map': return new MapVFS(file);
    case 'ui': return new UIVFS(file);
    case 'gamelogic': return new GameLogicVFS(file);
    case 'model': return new ModelVFS(file);
    default: throw new Error(`unsupported type for cache: ${type}`);
  }
}

function getOrLoad(type: string, file: string): EntitiesVFS | ModelVFS {
  const abs = path.resolve(file);
  const stat = fs.statSync(abs);
  const mtimeMs = stat.mtimeMs;
  const k = key(type, abs);
  const hit = cache.get(k);
  if (hit && hit.mtimeMs === mtimeMs) {
    hit.lastAccess = Date.now();
    return hit.vfs;
  }
  const vfs = instantiate(type, abs);
  cache.set(k, { vfs, mtimeMs, lastAccess: Date.now(), type });
  return vfs;
}

export function getEntitiesCached(type: string, file: string): EntitiesVFS {
  return getOrLoad(type, file) as EntitiesVFS;
}

export function getModelCached(file: string): ModelVFS {
  return getOrLoad('model', file) as ModelVFS;
}

export function invalidate(file: string): void {
  const abs = path.resolve(file);
  for (const k of [...cache.keys()]) {
    if (k.endsWith(`:${abs}`)) cache.delete(k);
  }
}

export function clearCache(): void {
  cache.clear();
}

export interface CacheStat {
  entries: number;
  totalBytesApprox: number;
  items: Array<{ key: string; mtimeMs: number; lastAccessAgoMs: number }>;
}

export function cacheStats(): CacheStat {
  const now = Date.now();
  const items = [...cache.entries()].map(([k, v]) => ({
    key: k,
    mtimeMs: v.mtimeMs,
    lastAccessAgoMs: now - v.lastAccess,
  }));
  return { entries: cache.size, totalBytesApprox: 0, items };
}

export function installCacheFactories(): void {
  setEntitiesFactory((type, file) => getEntitiesCached(type, file));
  setModelFactory((file) => getModelCached(file));
}

export function uninstallCacheFactories(): void {
  resetFactories();
}
