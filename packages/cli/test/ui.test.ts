// UIEntryParser tests — .ui-specific summary + round-trip.
// Ported from test_ui_vfs.py.

import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { UIEntryParser } from '../src/entry/ui';
import { copyFixture, FIXTURES_DIR, GAMES, hasFixture, type Game } from './helpers';

describe.each(GAMES)('UIEntryParser [%s]', (game: Game) => {
  const uiFile = () => copyFixture(game, 'DefaultGroup.ui');

  test('summary has UI-specific fields', () => {
    const vfs = new UIEntryParser(uiFile());
    const s = vfs.summary();
    expect(s.asset_type).toBe('ui');
    expect(s.entry_key.startsWith('ui://')).toBe(true);
    expect('ui_group_type' in s).toBe(true);
    expect('buttons' in s).toBe(true);
    expect('texts' in s).toBe(true);
    expect('sprites' in s).toBe(true);
    expect(s.ui_group_type).toBe('Default');
  });

  test('validate clean on benchmark', () => {
    const vfs = new UIEntryParser(uiFile());
    const v = vfs.validate();
    expect(v.ok, `warnings: ${JSON.stringify(v.warnings)}`).toBe(true);
  });

  test('round-trip add button parent', () => {
    const file = uiFile();
    const vfs = new UIEntryParser(file);
    const groups = vfs.search('UIGroupComponent.json');
    expect(groups.length).toBeGreaterThan(0);
    const groupFile = groups[0].path;
    const groupDir = groupFile.split('/').slice(0, -1).join('/');

    const beforeBtn = vfs.summary().buttons;
    vfs.addEntity(groupDir, 'AddedBtn', {
      components: ['MOD.Core.ButtonComponent', 'MOD.Core.UITransformComponent'],
    });
    vfs.save();

    const vfs2 = new UIEntryParser(file);
    expect(vfs2.summary().buttons).toBe(beforeBtn + 1);
    const stat = vfs2.stat(`${groupDir}/AddedBtn`);
    expect('error' in stat).toBe(false);
  });
});

describe('UIEntryParser all types (raising_legions)', () => {
  test('loads all 4 UI variants', () => {
    const names = ['DefaultGroup.ui', 'FormationGroup.ui', 'UpgradeGroup.ui', 'ToastGroup.ui'];
    for (const name of names) {
      if (!hasFixture('raising_legions', name)) continue;
      const src = path.join(FIXTURES_DIR, 'raising_legions', name);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msw-vfs-ui-'));
      const dst = path.join(tmpDir, name);
      fs.copyFileSync(src, dst);

      const vfs = new UIEntryParser(dst);
      const s = vfs.summary();
      expect(s.asset_type).toBe('ui');
      expect('ui_group_type' in s).toBe(true);
      expect(s.entity_count).toBeGreaterThanOrEqual(1);
    }
  });
});
