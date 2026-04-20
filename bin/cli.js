#!/usr/bin/env node
'use strict';

// msw-vfs — CLI for reading/editing MSW .map/.ui/.gamelogic/.model assets.
//
// Thin launcher. The real entry point is dist/cli.js (compiled from src/cli.ts).

const path = require('path');

try {
  require(path.join(__dirname, '..', 'dist', 'cli.js'));
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND' && /dist[\\/]cli\.js/.test(err.message)) {
    process.stderr.write(
      'msw-vfs: compiled output not found. Run `npm run build` first.\n',
    );
    process.exit(2);
  }
  throw err;
}
