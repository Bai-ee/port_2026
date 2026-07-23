#!/usr/bin/env node
// Copies the Draco/KTX2(Basis) decoder binaries three.js already ships
// under node_modules into public/vendor/ so the Studio GLB loader
// (app/dashboard/studio/elements/glb-loader.js) can self-host them instead
// of pulling from an external CDN. Not a new dependency — `three` is
// already a direct dependency; this just re-copies files it ships whenever
// node_modules is reinstalled or the `three` version changes. Re-run this
// after any `npm install`/`three` upgrade.

import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const FILES = [
  ['node_modules/three/examples/jsm/libs/draco/draco_decoder.js', 'public/vendor/draco/draco_decoder.js'],
  ['node_modules/three/examples/jsm/libs/draco/draco_decoder.wasm', 'public/vendor/draco/draco_decoder.wasm'],
  ['node_modules/three/examples/jsm/libs/draco/draco_wasm_wrapper.js', 'public/vendor/draco/draco_wasm_wrapper.js'],
  ['node_modules/three/examples/jsm/libs/basis/basis_transcoder.js', 'public/vendor/basis/basis_transcoder.js'],
  ['node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm', 'public/vendor/basis/basis_transcoder.wasm'],
];

for (const [from, to] of FILES) {
  const src = path.join(root, from);
  const dest = path.join(root, to);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`copied ${from} -> ${to}`);
}
