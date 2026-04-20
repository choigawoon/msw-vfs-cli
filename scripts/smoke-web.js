#!/usr/bin/env node
// Launch the web server in-process against a real benchmark .map and verify
// every endpoint returns sane data, then shut down.

/* eslint-disable no-console */

const http = require('node:http');

const { MapVFS } = require('../dist/vfs/map.js');
const { startServer } = require('../dist/web/server.js');

const MAP = 'D:/ai-agent-tf/benchmark-games/2.SimpleBossRush/map/map01.map';

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

async function run() {
  const vfs = new MapVFS(MAP);
  const server = startServer(vfs, { port: 0 }); // random free port
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
  }
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  console.log(`listening on ${port}`);

  let pass = 0, fail = 0;
  const check = (label, cond, detail = '') => {
    if (cond) { console.log(`  PASS  ${label}`); pass += 1; }
    else { console.log(`  FAIL  ${label}  ${detail}`); fail += 1; }
  };

  try {
    const root = await get(port, '/');
    check('GET / returns HTML', root.status === 200 && /<!DOCTYPE html>/.test(root.body));

    const summary = JSON.parse((await get(port, '/api/summary')).body);
    check('summary.entity_count > 0', summary.entity_count > 0, `got ${summary.entity_count}`);
    check('summary.entities array exists', Array.isArray(summary.entities), `got ${typeof summary.entities}`);
    check('summary.tile_map_mode set', summary.tile_map_mode === 'RectTile', `got ${summary.tile_map_mode}`);

    const tree = JSON.parse((await get(port, '/api/tree?max_depth=2')).body);
    check('tree has children', Array.isArray(tree.children) && tree.children.length > 0);

    const ls = JSON.parse((await get(port, '/api/ls?path=/maps/map01&detail=true')).body);
    check('ls returns items', Array.isArray(ls.items) && ls.items.length > 0, `got ${ls.items?.length}`);

    const stat = JSON.parse((await get(port, '/api/stat?path=/maps/map01/BossRushManager')).body);
    check('stat is_entity=true', stat.is_entity === true);

    const read = JSON.parse((await get(port, '/api/read?path=/maps/map01/BG/TransformComponent.json&compact=true')).body);
    check('read returns component', read.type === 'component' && read.content !== undefined);

    const search = JSON.parse((await get(port, '/api/search?pattern=*Component.json')).body);
    check('search finds components', Array.isArray(search) && search.length > 0, `got ${search.length}`);

    const grep = JSON.parse((await get(port, '/api/grep?pattern=BossRush')).body);
    check('grep finds matches', Array.isArray(grep) && grep.length > 0, `got ${grep.length}`);

    const fourOhFour = await get(port, '/api/nope');
    check('unknown endpoint → 404', fourOhFour.status === 404);
  } finally {
    server.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
