// MapVFS tests — reading, Entity/Component CRUD, round-trip.
// Ported from test_map_vfs.py.

import { describe, test, expect } from 'vitest';

import { MapVFS } from '../src/vfs/map';
import { copyFixture, GAMES, type Game } from './helpers';

describe.each(GAMES)('MapVFS [%s]', (game: Game) => {
  const mapFile = () => copyFixture(game, 'map01.map');

  // ── Read ────────────────────────────────────

  test('load returns ok summary', () => {
    const vfs = new MapVFS(mapFile());
    const s = vfs.summary();
    expect(s.asset_type).toBe('map');
    expect(s.entry_key.startsWith('map://')).toBe(true);
    expect(s.entity_count).toBeGreaterThanOrEqual(1);
    expect('tile_map_mode' in s).toBe(true);
  });

  test('ls root has maps dir', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.ls('/');
    expect('items' in r).toBe(true);
    if ('items' in r) {
      const names = r.items.map((i) => i.name);
      expect(names).toContain('maps');
    }
  });

  test('validate clean on benchmark', () => {
    const vfs = new MapVFS(mapFile());
    const v = vfs.validate();
    expect(v.ok, `warnings: ${JSON.stringify(v.warnings)}`).toBe(true);
  });

  test('search finds MapComponent.json', () => {
    const vfs = new MapVFS(mapFile());
    const results = vfs.search('MapComponent.json');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  // ── Entity CRUD ─────────────────────────────

  test('add_entity assigns GUID and paths', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.addEntity('/maps/map01', 'TestAdded', {
      components: ['MOD.Core.TransformComponent'],
    });
    expect('ok' in r && r.ok).toBe(true);
    if ('ok' in r) {
      expect(String(r.id).length).toBe(36);
      expect(r.path).toBe('/maps/map01/TestAdded');
      expect(r.components_added).toBe(1);
    }
  });

  test('add_entity round-trip', () => {
    const file = mapFile();
    const vfs = new MapVFS(file);
    vfs.addEntity('/maps/map01', 'RoundTrip', {
      components: ['MOD.Core.TransformComponent'],
    });
    const before = vfs.summary().entity_count;
    vfs.save();

    const vfs2 = new MapVFS(file);
    expect(vfs2.summary().entity_count).toBe(before);
    const ls = vfs2.ls('/maps/map01');
    if ('items' in ls) {
      const dirs = ls.items.filter((i) => i.type === 'dir').map((i) => i.name);
      expect(dirs).toContain('RoundTrip');
    } else {
      throw new Error('expected ls to return items');
    }
  });

  test('add_component updates csv and creates file', () => {
    const vfs = new MapVFS(mapFile());
    vfs.addEntity('/maps/map01', 'Target', {
      components: ['MOD.Core.TransformComponent'],
    });
    const r = vfs.addComponent('/maps/map01/Target', 'MOD.Core.SpriteRendererComponent');
    expect('ok' in r && r.ok).toBe(true);
    const st = vfs.stat('/maps/map01/Target') as any;
    expect(st.metadata.componentNames.split(',')).toContain('MOD.Core.SpriteRendererComponent');
    const ls = vfs.ls('/maps/map01/Target') as any;
    const files = ls.items.filter((i: any) => i.type === 'file').map((i: any) => i.name);
    expect(files).toContain('SpriteRendererComponent.json');
  });

  test('remove_entity recurses', () => {
    const vfs = new MapVFS(mapFile());
    vfs.addEntity('/maps/map01', 'ParentEnt', { components: ['MOD.Core.TransformComponent'] });
    vfs.addEntity('/maps/map01/ParentEnt', 'ChildEnt', { components: ['MOD.Core.TransformComponent'] });
    const before = vfs.summary().entity_count;
    const r = vfs.removeEntity('/maps/map01/ParentEnt');
    expect('ok' in r && r.ok).toBe(true);
    if ('ok' in r) expect(r.removed).toBe(2);
    expect(vfs.summary().entity_count).toBe(before - 2);
  });

  test('rename_entity updates child paths', () => {
    const vfs = new MapVFS(mapFile());
    vfs.addEntity('/maps/map01', 'OldName', { components: ['MOD.Core.TransformComponent'] });
    vfs.addEntity('/maps/map01/OldName', 'Child', { components: ['MOD.Core.TransformComponent'] });
    const r = vfs.renameEntity('/maps/map01/OldName', 'NewName');
    expect('ok' in r && r.ok).toBe(true);
    const childStat = vfs.stat('/maps/map01/NewName/Child') as any;
    expect('error' in childStat).toBe(false);
    expect(childStat.metadata.id).toBeTruthy();
  });

  test('edit_entity blocks name field', () => {
    const vfs = new MapVFS(mapFile());
    vfs.addEntity('/maps/map01', 'E', { components: ['MOD.Core.TransformComponent'] });
    const r = vfs.editEntity('/maps/map01/E', { name: 'Renamed' });
    expect('error' in r).toBe(true);
  });

  test('edit_entity updates enable + revision', () => {
    const vfs = new MapVFS(mapFile());
    vfs.addEntity('/maps/map01', 'E', { components: ['MOD.Core.TransformComponent'] });
    const r = vfs.editEntity('/maps/map01/E', { enable: false, visible: false });
    expect('ok' in r && r.ok).toBe(true);
    if ('ok' in r) expect(Number(r.revision)).toBeGreaterThanOrEqual(2);
  });

  test('remove_component updates csv', () => {
    const vfs = new MapVFS(mapFile());
    vfs.addEntity('/maps/map01', 'E', {
      components: ['MOD.Core.TransformComponent', 'MOD.Core.SpriteRendererComponent'],
    });
    const r = vfs.removeComponent('/maps/map01/E', 'MOD.Core.SpriteRendererComponent');
    expect('ok' in r && r.ok).toBe(true);
    if ('ok' in r) expect((r.removed_files as string[]).length).toBe(1);
    const stat = vfs.stat('/maps/map01/E') as any;
    const cn = (stat.metadata.componentNames as string).split(',');
    expect(cn).not.toContain('MOD.Core.SpriteRendererComponent');
    expect(cn).toContain('MOD.Core.TransformComponent');
  });

  test('duplicate entity name rejected', () => {
    const vfs = new MapVFS(mapFile());
    vfs.addEntity('/maps/map01', 'OnlyOne', { components: ['MOD.Core.TransformComponent'] });
    const r = vfs.addEntity('/maps/map01', 'OnlyOne', { components: ['MOD.Core.TransformComponent'] });
    expect('error' in r).toBe(true);
  });

  test('component missing @type rejected', () => {
    const vfs = new MapVFS(mapFile());
    const r = vfs.addEntity('/maps/map01', 'BadEnt', {
      components: [{ NotType: true } as any],
    });
    expect('error' in r).toBe(true);
  });

  // ── Save validation ─────────────────────────

  test('save skips write on strict validation failure', () => {
    const file = mapFile();
    const vfs = new MapVFS(file) as any;
    // Break componentNames intentionally
    vfs.entities[0].componentNames = 'MOD.Core.NotExistingComponent';
    const os = require('node:os') as typeof import('node:os');
    const path = require('node:path') as typeof import('node:path');
    const fs = require('node:fs') as typeof import('node:fs');
    const out = path.join(os.tmpdir(), 'strict_out.map');
    try { fs.unlinkSync(out); } catch { /* ignore */ }
    const r = vfs.save(out, true, true);
    expect(r.ok).toBe(false);
    expect(r.warnings).toBeDefined();
    expect(fs.existsSync(out)).toBe(false);
  });
});
