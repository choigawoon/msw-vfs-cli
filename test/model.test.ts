// ModelVFS tests — Values[] I/O, type inference, assembly fullname correctness.
// Ported from test_model_vfs.py.

import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';

import { ModelVFS } from '../src/model/vfs';
import { MSCORLIB, buildValueType } from '../src/model/types';
import { inferType } from '../src/model/codec';
import { copyFixture, GAMES, type Game } from './helpers';

describe.each(GAMES)('ModelVFS [%s]', (game: Game) => {
  const modelFile = () => copyFixture(game, 'DefaultPlayer.model');

  // ── Read ────────────────────────────────────

  test('info fields', () => {
    const mv = new ModelVFS(modelFile());
    const info = mv.info();
    expect(info.content_type).toBe('x-mod/model');
    expect(info.entry_key.startsWith('model://')).toBe(true);
    expect(info.values_count).toBeGreaterThanOrEqual(1);
    expect(info.core_version).toBeTruthy();
  });

  test('speed value is numeric', () => {
    const mv = new ModelVFS(modelFile());
    const speed = mv.get('speed');
    if (speed !== null) {
      expect(typeof speed).toBe('number');
    }
  });

  test('validate clean', () => {
    const mv = new ModelVFS(modelFile());
    const v = mv.validate();
    expect(v.ok, `warnings: ${JSON.stringify(v.warnings)}`).toBe(true);
  });

  // ── Write ───────────────────────────────────

  test('set scalar round-trip', () => {
    const file = modelFile();
    const mv = new ModelVFS(file);
    mv.set('testScalar', 3.14);
    mv.save();
    const mv2 = new ModelVFS(file);
    expect(mv2.get('testScalar')).toBe(3.14);
  });

  test('set vector2 auto-inferred', () => {
    const file = modelFile();
    const mv = new ModelVFS(file);
    mv.set('testVec', [0.5, 0.7]);
    mv.save();
    const mv2 = new ModelVFS(file);
    expect(mv2.get('testVec')).toEqual([0.5, 0.7]);
  });

  test('set dataref auto-inferred', () => {
    const file = modelFile();
    const mv = new ModelVFS(file);
    mv.set('testRef', { DataId: 'deadbeef' });
    mv.save();
    const mv2 = new ModelVFS(file);
    expect(mv2.get('testRef')).toEqual({ DataId: 'deadbeef' });
  });

  test('set with target_type scoped', () => {
    const file = modelFile();
    const mv = new ModelVFS(file);
    mv.set('Speed', 5.0, 'MOD.Core.MovementComponent', 'single');
    mv.save();
    const mv2 = new ModelVFS(file);
    expect(mv2.get('Speed', 'MOD.Core.MovementComponent')).toBe(5.0);
    const all = mv2.listValues();
    const pairs = all.map((v) => [v.name, v.target_type]);
    expect(pairs).toContainEqual(['Speed', 'MOD.Core.MovementComponent']);
  });

  test('remove value', () => {
    const file = modelFile();
    const mv = new ModelVFS(file);
    mv.set('disposable', 9.9);
    mv.save();
    const mv2 = new ModelVFS(file);
    expect(mv2.get('disposable')).toBe(9.9);
    mv2.remove('disposable');
    mv2.save();
    const mv3 = new ModelVFS(file);
    expect(mv3.get('disposable')).toBeNull();
  });

  test('saved file contains correct assembly fullname', () => {
    const file = modelFile();
    const mv = new ModelVFS(file);
    mv.set('assemblyTest', [1.0, 2.0]);
    mv.save();
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('MOD.Core.MODVector2');
    expect(content).toContain('PublicKeyToken=null');
  });
});

// ── Type inference (parameterized) ────────────

describe('inferType', () => {
  test.each<[any, string]>([
    [1.5, 'single'],
    [42, 'int32'],
    [Math.pow(2, 40), 'int64'],
    ['hello', 'string'],
    [true, 'boolean'],
    [[0.1, 0.2], 'vector2'],
    [[0.1, 0.2, 0.3], 'vector3'],
    [{ x: 1.0, y: 2.0 }, 'vector2'],
    [{ x: 1, y: 2, z: 3, w: 4 }, 'quaternion'],
    [{ r: 1, g: 0, b: 0, a: 1 }, 'color'],
    [{ DataId: 'abc' }, 'dataref'],
  ])('inferType(%p) → %s', (value, expected) => {
    expect(inferType(value)).toBe(expected);
  });
});

// ── Assembly fullname correctness ─────────────

describe('buildValueType', () => {
  test('single uses mscorlib', () => {
    const vt = buildValueType('single', '26.3.0.0');
    expect(vt.$type).toBe('MODNativeType');
    expect(vt.type).toContain('System.Single');
    expect(vt.type).toContain(MSCORLIB);
  });

  test('vector2 uses MOD.Core with version', () => {
    const vt = buildValueType('vector2', '26.3.0.0');
    expect(vt.type).toContain('MOD.Core.MODVector2');
    expect(vt.type).toContain('MOD.Core, Version=26.3.0.0');
    expect(vt.type).toContain('PublicKeyToken=null');
  });
});
