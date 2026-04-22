// EntityModel façade — confirms L2 delegation produces the same output
// as calling the parser directly.

import { describe, test, expect } from 'vitest';

import { makeEntityModel, makeEntities } from '../src/factory';
import type { EntryParser } from '../src/entry/parser';
import { copyFixture, GAMES, type Game } from './helpers';

describe.each(GAMES)('EntityModel façade [%s]', (game: Game) => {
  const mapFile = () => copyFixture(game, 'map01.map');

  test('readEntity matches parser.readEntity', () => {
    const file = mapFile();
    const model = makeEntityModel('map', file);
    const direct = makeEntities('map', file);

    const first = model.listEntities('/maps/map01');
    if ('error' in first) throw new Error(first.error);
    const target = first.entities[0].path;

    const viaModel = model.readEntity(target);
    const viaParser = direct.readEntity(target);
    expect(viaModel).toEqual(viaParser);
  });

  test('editComponent via façade mutates same state', () => {
    const file = mapFile();
    const model = makeEntityModel('map', file);

    const list = model.listEntities('/maps/map01', { recursive: true });
    if ('error' in list) throw new Error(list.error);
    const target = list.entities.find((e) => e.components.includes('TransformComponent'));
    if (!target) return;

    const r = model.editComponent(
      target.path,
      'MOD.Core.TransformComponent',
      { Enable: false },
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.ok).toBe(true);
    expect(model.isDirty).toBe(true);

    const bundle = model.readEntity(target.path);
    if ('error' in bundle) throw new Error(bundle.error);
    expect(bundle.components['MOD.Core.TransformComponent'].Enable).toBe(false);
  });

  test('save delegates through façade', () => {
    const file = mapFile();
    const model = makeEntityModel('map', file);
    const saved = model.save();
    expect(saved.ok).toBe(true);
  });
});

describe('EntryParser type contract', () => {
  test('EntrySaveResult / EntryValidateResult imports resolve', () => {
    // Compile-time guard: the interface re-exports match what existing
    // parsers emit. This test passes as long as the file type-checks.
    const dummy: EntryParser | null = null;
    expect(dummy).toBeNull();
  });
});
