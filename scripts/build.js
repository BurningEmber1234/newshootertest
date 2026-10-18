#!/usr/bin/env node
/**
 * "Builds" the game by copying the static files into dist/.
 *
 * The project has no bundler or dependencies; this simply produces a
 * deployable folder (e.g. for GitHub Pages, Netlify, or any static host).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// Everything the game needs at runtime. Add new asset folders here.
const ENTRIES = ['index.html', 'styles.css', 'game.js', 'map-data.js', 'weapon-data.js', 'network.js', 'assets', 'favicon.ico'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let copied = 0;
for (const entry of ENTRIES) {
  const from = path.join(ROOT, entry);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(OUT, entry), { recursive: true });
  copied++;
  console.log(`  copied ${entry}`);
}

if (!copied) {
  console.error('Nothing to build — expected index.html, styles.css, and game.js.');
  process.exit(1);
}

console.log(`\nBuild complete → ${path.relative(ROOT, OUT)}/`);
