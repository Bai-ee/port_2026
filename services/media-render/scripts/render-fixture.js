/**
 * Manual fixture render: produces an MP4 from the committed fixtures so you can
 * eyeball the output. Not part of the test suite.
 *
 *   node scripts/render-fixture.js
 *   open __tests__/fixtures/client-acme/media/generated/fixture-demo.mp4
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRemix, LocalMediaStore } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, '..', '__tests__', 'fixtures', 'client-acme', 'media');

const store = new LocalMediaStore({ clientId: 'acme', rootDir: clientRoot });

const recipe = {
  durationSeconds: 30,
  output: { width: 720, height: 720, fps: 30, format: 'mp4' },
  sourceFolders: ['skyline', 'neighborhood', 'stills'],
  filter: { key: 'look_hard_bw_street_doc', intensity: 0.8 },
  arweaveAudioUrl: 'store:audio/track.m4a',
};

console.log('Rendering fixture remix...');
const result = await renderRemix({
  clientId: 'acme',
  recipe,
  store,
  outputPath: 'fixture-demo.mp4',
});
console.log(JSON.stringify(result, null, 2));
