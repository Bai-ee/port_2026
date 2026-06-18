// Local test harness: render one video from a recipe using your installed Chrome
// (real GPU). Verifies the service core end-to-end without the cloud.
//
// Run:
//   node render-cli.mjs recipe.json            # render a recipe file
//   node render-cli.mjs                         # render the built-in sample
//   node render-cli.mjs --url https://x.com     # quick one-off (preset default)

import { readFileSync, writeFileSync } from 'node:fs';
import { renderVideo } from './render.mjs';

const SAMPLE = {
  url: 'https://hitloop.agency',
  output: { seconds: 8, fps: 30, width: 1920, height: 1200, siteSpeed: 1 },
  device: { viewport: 'desktop', backdrop: 'home', loop: true },
  capture: { warmupMs: 400 },
  scroll: { target: { selector: '#reel-player-shell' }, startAt: 0.25, arriveAt: 0.85, align: 'center' },
  preset: 'push-rotate-flat',
};

let recipe = SAMPLE;
const arg = process.argv[2];
if (arg === '--url') {
  recipe = { ...SAMPLE, url: process.argv[3] || SAMPLE.url, scroll: null };
} else if (arg) {
  recipe = JSON.parse(readFileSync(arg, 'utf8'));
}

const { buffer, info } = await renderVideo(recipe);
writeFileSync('service-render.mp4', buffer);
console.log(`✓ service-render.mp4 — ${(buffer.length / 1024 / 1024).toFixed(2)}MB`, info);
