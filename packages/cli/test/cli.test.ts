// CLI dispatcher tests — type detection + subprocess invocation.
// Ported from test_msw_vfs_cli.py (legacy Python script tests dropped).

import { describe, test, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { copyFixture, GAMES, hasFixture, type Game } from './helpers';

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'cli.js');
const DIST_CLI = path.join(ROOT, 'dist', 'cli.js');

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      code: e.status ?? 1,
    };
  }
}

beforeAll(() => {
  if (!fs.existsSync(DIST_CLI)) {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
  }
});

describe('type detection by extension', () => {
  // Detect via a no-op command (summary on non-existent file → error, but type
  // detection happens first). Instead we use --help round-trip with the file.
  // Simpler: verify by running `<file>.map summary` on a real fixture.
  test.each(GAMES)('map fixture [%s]', (game: Game) => {
    const f = copyFixture(game, 'map01.map');
    const r = runCli([f, 'summary']);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.asset_type).toBe('map');
  });

  test.each(GAMES)('model fixture [%s]', (game: Game) => {
    const f = copyFixture(game, 'DefaultPlayer.model');
    const r = runCli([f, 'info']);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.content_type).toBe('x-mod/model');
  });

  test.each(GAMES)('ui fixture [%s]', (game: Game) => {
    const f = copyFixture(game, 'DefaultGroup.ui');
    const r = runCli([f, 'summary']);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.asset_type).toBe('ui');
  });

  test.each(GAMES)('gamelogic fixture [%s]', (game: Game) => {
    if (!hasFixture(game, 'common.gamelogic')) return;
    const f = copyFixture(game, 'common.gamelogic');
    const r = runCli([f, 'summary']);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.asset_type).toBe('gamelogic');
  });
});

describe('CLI add-entity + validate flow', () => {
  test.each(GAMES)('[%s]', (game: Game) => {
    const f = copyFixture(game, 'map01.map');
    const add = runCli([f, 'add-entity', '/maps/map01', 'CliAdded', '-c', 'MOD.Core.TransformComponent']);
    expect(add.code).toBe(0);
    const addData = JSON.parse(add.stdout);
    expect(addData.action.ok).toBe(true);
    expect(addData.save.ok).toBe(true);

    const val = runCli([f, 'validate']);
    expect(val.code).toBe(0);
    const valData = JSON.parse(val.stdout);
    expect(valData.ok).toBe(true);
  });
});

describe('.model rejects tree-shaped commands', () => {
  test.each(GAMES)('ls / read / tree on .model redirect [%s]', (game: Game) => {
    if (!hasFixture(game, 'DefaultPlayer.model')) return;
    const f = copyFixture(game, 'DefaultPlayer.model');
    // Previously `ls` was silently aliased to `list`. Now it errors with a
    // redirect so callers don't carry a tree mental model over to .model.
    const ls = runCli([f, 'ls']);
    expect(ls.code).not.toBe(0);
    expect(ls.stderr).toMatch(/not a \.model command/);
    expect(ls.stderr).toMatch(/list/); // mentions the .model-native equivalent

    const tree = runCli([f, 'tree']);
    expect(tree.code).not.toBe(0);
    expect(tree.stderr).toMatch(/not a \.model command/);

    // .model-native commands still work.
    const info = runCli([f, 'info']);
    expect(info.code).toBe(0);
    const list = runCli([f, 'list', '--json']);
    expect(list.code).toBe(0);
    expect(Array.isArray(JSON.parse(list.stdout))).toBe(true);
  });
});

describe('--help / --version', () => {
  test('--version prints semver', () => {
    const r = runCli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('--help mentions key commands', () => {
    const r = runCli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('summary');
    expect(r.stdout).toContain('add-entity');
    expect(r.stdout).toContain('build-world');
  });
});
