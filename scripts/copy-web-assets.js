#!/usr/bin/env node
// Copy non-TS assets needed at runtime into dist/ after tsc emits.
// Called by the "build" npm script after `tsc` so the published package
// ships the web viewer template alongside the compiled JS.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const assets = [
  ['src/web/template.html', 'dist/web/template.html'],
];

for (const [rel, dest] of assets) {
  const srcPath = path.join(ROOT, rel);
  const dstPath = path.join(ROOT, dest);
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.copyFileSync(srcPath, dstPath);
  process.stdout.write(`copied ${rel} → ${dest}\n`);
}
