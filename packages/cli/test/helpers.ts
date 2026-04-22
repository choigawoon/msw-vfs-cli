// Shared test helpers — parametrized fixtures across the three benchmark games.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const GAMES = ['defence', 'boss_rush', 'raising_legions'] as const;
export type Game = (typeof GAMES)[number];

const TEST_DIR = __dirname;
export const FIXTURES_DIR = path.join(TEST_DIR, 'fixtures');

/** Copy a fixture into a fresh tmp dir so mutations don't leak across tests. */
export function copyFixture(game: Game, filename: string): string {
  const src = path.join(FIXTURES_DIR, game, filename);
  if (!fs.existsSync(src)) {
    throw new Error(`fixture missing: ${src}`);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msw-vfs-test-'));
  const dst = path.join(tmpDir, `${game}_${filename}`);
  fs.copyFileSync(src, dst);
  return dst;
}

export function hasFixture(game: Game, filename: string): boolean {
  return fs.existsSync(path.join(FIXTURES_DIR, game, filename));
}
