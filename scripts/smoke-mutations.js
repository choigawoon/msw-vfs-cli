#!/usr/bin/env node
// Round-trip smoke test for EntitiesVFS mutation operations.
//
// Copies each benchmark .map to a tmp file, runs a sequence of mutations,
// saves, reloads, and checks the resulting structure. Runs in-process — no
// subprocess — so any exception fails the script hard.

/* eslint-disable no-console */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MapVFS } = require('../dist/vfs/map.js');

const BENCH_MAPS = [
  'D:/ai-agent-tf/benchmark-games/1.Defence/map/map01.map',
  'D:/ai-agent-tf/benchmark-games/2.SimpleBossRush/map/map01.map',
  'D:/ai-agent-tf/benchmark-games/3.RaisingLegions/map/map01.map',
];

function run() {
  let pass = 0;
  let fail = 0;
  for (const src of BENCH_MAPS) {
    if (!fs.existsSync(src)) {
      console.log(`SKIP  ${src}  (not found)`);
      continue;
    }
    try {
      roundTrip(src);
      console.log(`PASS  ${src}`);
      pass += 1;
    } catch (e) {
      console.log(`FAIL  ${src}`);
      console.log('      ' + (e.stack || e.message));
      fail += 1;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assert: ${msg}`);
}
function assertEq(a, b, label) {
  if (a !== b) throw new Error(`assertEq ${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

function roundTrip(srcPath) {
  const tmp = path.join(os.tmpdir(), `msw-vfs-test-${Date.now()}-${path.basename(srcPath)}`);
  fs.copyFileSync(srcPath, tmp);
  try {
    // 1. Load + save without mutations — validate should pass.
    {
      const v = new MapVFS(tmp);
      const vr = v.validate();
      assert(vr.ok, `initial validate: ${JSON.stringify(vr.warnings)}`);
      const sr = v.save();
      assert(sr.ok, `initial save: ${JSON.stringify(sr)}`);
      const v2 = new MapVFS(tmp);
      assertEq(v2.summary().entity_count, v.summary().entity_count, 'entity_count after idempotent save');
    }

    // 2. addEntity round-trip
    {
      const v = new MapVFS(tmp);
      const before = v.summary().entity_count;
      // Find the root map entity path dynamically — first dir with an id under /maps.
      const mapsPath = findMapRoot(v);
      const r = v.addEntity(mapsPath, 'TestEnemy', {
        components: ['MOD.Core.TransformComponent', 'MOD.Core.SpriteRendererComponent'],
      });
      assert(r.ok, `addEntity: ${JSON.stringify(r)}`);
      assertEq(r.components_added, 2, 'components_added');
      assertEq(v.save().ok, true, 'save after addEntity');

      const v2 = new MapVFS(tmp);
      assertEq(v2.summary().entity_count, before + 1, 'entity_count after addEntity');
      const ls = v2.ls(mapsPath);
      assert(ls.items.some(it => it.name === 'TestEnemy'), 'TestEnemy appears in ls');
      const vr = v2.validate();
      assert(vr.ok, `validate after addEntity: ${JSON.stringify(vr.warnings)}`);
    }

    // 3. editEntity round-trip
    {
      const v = new MapVFS(tmp);
      const mapsPath = findMapRoot(v);
      const testPath = `${mapsPath}/TestEnemy`;
      const r = v.editEntity(testPath, { enable: false });
      assert(r.ok, `editEntity: ${JSON.stringify(r)}`);
      v.save();

      const v2 = new MapVFS(tmp);
      const st = v2.stat(testPath);
      assertEq(st.metadata.enable, false, 'enable updated');
    }

    // 4. renameEntity round-trip
    {
      const v = new MapVFS(tmp);
      const mapsPath = findMapRoot(v);
      const r = v.renameEntity(`${mapsPath}/TestEnemy`, 'TestEnemy2');
      assert(r.ok, `renameEntity: ${JSON.stringify(r)}`);
      v.save();

      const v2 = new MapVFS(tmp);
      const ls = v2.ls(mapsPath);
      assert(ls.items.some(it => it.name === 'TestEnemy2'), 'TestEnemy2 present after rename');
      assert(!ls.items.some(it => it.name === 'TestEnemy'), 'TestEnemy gone after rename');
    }

    // 5. addComponent + edit + removeComponent round-trip
    {
      const v = new MapVFS(tmp);
      const mapsPath = findMapRoot(v);
      const testPath = `${mapsPath}/TestEnemy2`;
      const r1 = v.addComponent(testPath, 'MOD.Core.FootholdComponent');
      assert(r1.ok, `addComponent: ${JSON.stringify(r1)}`);
      const r2 = v.edit(`${testPath}/FootholdComponent.json`, { FootholdDrag: 0.5 });
      assert(r2.ok, `edit component: ${JSON.stringify(r2)}`);
      v.save();

      const v2 = new MapVFS(tmp);
      const rd = v2.read(`${testPath}/FootholdComponent.json`, false);
      assertEq(rd.content.FootholdDrag, 0.5, 'FootholdDrag after edit');

      const r3 = v2.removeComponent(testPath, 'MOD.Core.FootholdComponent');
      assert(r3.ok, `removeComponent: ${JSON.stringify(r3)}`);
      v2.save();

      const v3 = new MapVFS(tmp);
      const ls = v3.ls(testPath);
      assert(!ls.items.some(it => it.name === 'FootholdComponent.json'), 'FootholdComponent.json gone');
    }

    // 6. removeEntity round-trip
    {
      const v = new MapVFS(tmp);
      const mapsPath = findMapRoot(v);
      const before = v.summary().entity_count;
      const r = v.removeEntity(`${mapsPath}/TestEnemy2`);
      assert(r.ok, `removeEntity: ${JSON.stringify(r)}`);
      assertEq(r.removed, 1, 'removed count');
      v.save();

      const v2 = new MapVFS(tmp);
      assertEq(v2.summary().entity_count, before - 1, 'entity_count after removeEntity');
      const ls = v2.ls(mapsPath);
      assert(!ls.items.some(it => it.name === 'TestEnemy2'), 'TestEnemy2 gone after removeEntity');
      assert(v2.validate().ok, 'validate after removeEntity');
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

// Find the first dir with an id under /maps — benchmarks use /maps/{name} shape.
function findMapRoot(vfs) {
  const maps = vfs.ls('/maps');
  if (maps.error) throw new Error('no /maps root');
  for (const it of maps.items) {
    if (it.type === 'dir') return `/maps/${it.name}`;
  }
  throw new Error('no child under /maps');
}

run();
