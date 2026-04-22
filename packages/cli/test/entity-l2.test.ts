// Layer 2 — entity-oriented API tests.
// readEntity / listEntities / findEntities / grepEntities / editComponent.

import { describe, test, expect } from 'vitest';

import { MapVFS } from '../src/vfs/map';
import { copyFixture, GAMES, type Game } from './helpers';

describe.each(GAMES)('EntitiesVFS L2 [%s]', (game: Game) => {
  const mapFile = () => copyFixture(game, 'map01.map');

  // ── readEntity ───────────────────────────────

  test('readEntity bundles metadata + components', () => {
    const vfs = new MapVFS(mapFile());
    const list = vfs.listEntities('/maps/map01');
    if ('error' in list) throw new Error(list.error);
    expect(list.entities.length).toBeGreaterThan(0);

    const first = list.entities[0];
    const r = vfs.readEntity(first.path);
    if ('error' in r) throw new Error(r.error);
    expect(r.path).toBe(first.path);
    expect(r.name).toBe(first.name);
    expect(typeof r.metadata).toBe('object');
    expect(r.metadata.id).toBeTruthy();
    expect(Object.keys(r.components).length).toBe(first.components.length);
    for (const type of Object.keys(r.components)) {
      expect(type).toMatch(/\./);
    }
  });

  test('readEntity errors on non-entity path', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.readEntity('/nope');
    expect('error' in r).toBe(true);
  });

  test('readEntity errors on root (not an entity)', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.readEntity('/');
    expect('error' in r).toBe(true);
  });

  test('readEntity --deep includes child entity bundles', () => {
    const vfs = new MapVFS(mapFile());
    const list = vfs.listEntities('/maps/map01', { recursive: false });
    if ('error' in list) throw new Error(list.error);
    const withKids = list.entities.find((e) => e.children_count > 0);
    if (!withKids) return; // fixture-dependent
    const r = vfs.readEntity(withKids.path, { deep: true });
    if ('error' in r) throw new Error(r.error);
    expect(Array.isArray(r.children)).toBe(true);
    expect((r.children ?? []).length).toBe(withKids.children_count);
    for (const c of r.children ?? []) {
      expect(typeof c.components).toBe('object');
    }
  });

  // ── listEntities ─────────────────────────────

  test('listEntities excludes component files', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.listEntities('/maps/map01');
    if ('error' in r) throw new Error(r.error);
    for (const e of r.entities) {
      expect(e.components.every((c) => !c.endsWith('.json'))).toBe(true);
    }
  });

  test('listEntities recursive >= flat count', () => {
    const vfs = new MapVFS(mapFile());
    const flat = vfs.listEntities('/maps/map01');
    const deep = vfs.listEntities('/maps/map01', { recursive: true });
    if ('error' in flat || 'error' in deep) throw new Error('listEntities failed');
    expect(deep.entities.length).toBeGreaterThanOrEqual(flat.entities.length);
  });

  // ── findEntities ─────────────────────────────

  test('findEntities by name matches existing entity', () => {
    const vfs = new MapVFS(mapFile());
    const list = vfs.listEntities('/maps/map01', { recursive: true });
    if ('error' in list) throw new Error(list.error);
    const target = list.entities[0];
    const r = vfs.findEntities(escapeRe(target.name), { by: 'name' });
    if (!Array.isArray(r)) throw new Error(r.error);
    expect(r.some((e) => e.path === target.path)).toBe(true);
  });

  test('findEntities by component matches known component type', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.findEntities('TransformComponent', { by: 'component' });
    if (!Array.isArray(r)) throw new Error(r.error);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].matched).toMatch(/TransformComponent/);
  });

  test('findEntities invalid regex errors', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.findEntities('[unclosed');
    expect(Array.isArray(r)).toBe(false);
  });

  // ── grepEntities ─────────────────────────────

  test('grepEntities groups matches by entity', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.grepEntities('Enable');
    if (!Array.isArray(r)) throw new Error(r.error);
    expect(r.length).toBeGreaterThan(0);
    for (const ent of r) {
      expect(ent.entity.startsWith('/')).toBe(true);
      for (const hit of ent.hits) {
        expect(hit.component).not.toMatch(/\.json$/);
        expect(hit.matches.length).toBeGreaterThan(0);
      }
    }
  });

  // ── editComponent ────────────────────────────

  test('editComponent patches by (entity, @type)', () => {
    const vfs = new MapVFS(mapFile());
    const list = vfs.listEntities('/maps/map01', { recursive: true });
    if ('error' in list) throw new Error(list.error);
    const target = list.entities.find((e) =>
      e.components.some((c) => c === 'TransformComponent'),
    );
    if (!target) return;
    const r = vfs.editComponent(
      target.path,
      'MOD.Core.TransformComponent',
      { Enable: false },
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.ok).toBe(true);

    const bundle = vfs.readEntity(target.path);
    if ('error' in bundle) throw new Error(bundle.error);
    expect(bundle.components['MOD.Core.TransformComponent'].Enable).toBe(false);
  });

  test('editComponent errors on unknown type', () => {
    const vfs = new MapVFS(mapFile());
    const list = vfs.listEntities('/maps/map01', { recursive: true });
    if ('error' in list) throw new Error(list.error);
    const target = list.entities[0];
    const r = vfs.editComponent(
      target.path,
      'MOD.Core.DoesNotExistComponent',
      { Enable: false },
    );
    expect('error' in r).toBe(true);
  });

  test('editComponent errors on non-entity path', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.editComponent(
      '/does/not/exist',
      'MOD.Core.TransformComponent',
      { Enable: false },
    );
    expect('error' in r).toBe(true);
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
