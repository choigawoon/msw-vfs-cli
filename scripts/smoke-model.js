#!/usr/bin/env node
// Round-trip smoke test for ModelVFS.
//
// Copies a .model file to tmp, runs set/get/remove/add-component against it,
// reloads, and checks state is preserved.

/* eslint-disable no-console */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ModelVFS } = require('../dist/model/vfs.js');

const BENCH_MODELS = [
  'D:/ai-agent-tf/benchmark-games/1.Defence/Global/DefaultPlayer.model',
  'D:/ai-agent-tf/benchmark-games/2.SimpleBossRush/Global/DefaultPlayer.model',
  'D:/ai-agent-tf/benchmark-games/3.RaisingLegions/Global/DefaultPlayer.model',
];

function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
function assertEq(a, b, label) {
  const ok = typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 1e-9
    : JSON.stringify(a) === JSON.stringify(b);
  if (!ok) throw new Error(`assertEq ${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

function roundTrip(srcPath) {
  const tmp = path.join(os.tmpdir(), `msw-vfs-model-${Date.now()}-${path.basename(srcPath)}`);
  fs.copyFileSync(srcPath, tmp);
  try {
    // 1. Idempotent save
    {
      const m = new ModelVFS(tmp);
      const vr = m.validate();
      assert(vr.ok, `initial validate: ${JSON.stringify(vr.warnings)}`);
      m.save();
      const m2 = new ModelVFS(tmp);
      assertEq(m2.info().values_count, m.info().values_count, 'values_count idempotent');
    }

    // 2. set single (update existing speed if present, else add)
    {
      const m = new ModelVFS(tmp);
      const r = m.set('speed', 7.25);
      assert(r.ok, `set single: ${JSON.stringify(r)}`);
      assertEq(r.type_key, 'single', 'type_key inferred');
      m.save();
      const m2 = new ModelVFS(tmp);
      assertEq(m2.get('speed'), 7.25, 'speed after save/reload');
    }

    // 3. set vector2
    {
      const m = new ModelVFS(tmp);
      const r = m.set('cliTestPos', [3.5, 4.5]);
      assert(r.ok, `set vector2: ${JSON.stringify(r)}`);
      assertEq(r.type_key, 'vector2', 'vector2 type_key');
      m.save();
      const m2 = new ModelVFS(tmp);
      assertEq(m2.get('cliTestPos'), [3.5, 4.5], 'cliTestPos after reload');
    }

    // 4. set boolean
    {
      const m = new ModelVFS(tmp);
      m.set('cliTestFlag', true);
      m.save();
      const m2 = new ModelVFS(tmp);
      assertEq(m2.get('cliTestFlag'), true, 'cliTestFlag after reload');
    }

    // 5. set dataref (explicit)
    {
      const m = new ModelVFS(tmp);
      m.set('cliTestRef', { DataId: 'some-ruid' }, null, 'dataref');
      m.save();
      const m2 = new ModelVFS(tmp);
      assertEq(m2.get('cliTestRef'), { DataId: 'some-ruid' }, 'cliTestRef after reload');
    }

    // 6. addComponent / removeComponent
    {
      const m = new ModelVFS(tmp);
      const addR = m.addComponent('MOD.Core.TestComponent');
      assert(addR.ok, `addComponent: ${JSON.stringify(addR)}`);
      m.save();
      const m2 = new ModelVFS(tmp);
      assert(m2.info().components.includes('MOD.Core.TestComponent'), 'component added');
      const rmR = m2.removeComponent('MOD.Core.TestComponent');
      assert(rmR.ok, `removeComponent: ${JSON.stringify(rmR)}`);
      m2.save();
      const m3 = new ModelVFS(tmp);
      assert(!m3.info().components.includes('MOD.Core.TestComponent'), 'component removed');
    }

    // 7. remove (the three we added)
    {
      const m = new ModelVFS(tmp);
      const beforeCount = m.info().values_count;
      m.remove('cliTestPos');
      m.remove('cliTestFlag');
      m.remove('cliTestRef');
      m.save();
      const m2 = new ModelVFS(tmp);
      assertEq(m2.info().values_count, beforeCount - 3, 'values_count after remove');
      assert(m2.get('cliTestPos') === null, 'cliTestPos gone');
      assert(m2.validate().ok, 'validate clean after remove');
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

function run() {
  let pass = 0, fail = 0;
  for (const src of BENCH_MODELS) {
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

run();
