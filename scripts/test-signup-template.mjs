// One-shot test for the new-signup video template.
//   node --env-file=.env.local scripts/test-signup-template.mjs [url]
// Reads the saved template from Firestore (config/signupVideoRecipe) via the same
// resolver the signup worker uses, renders it through the GPU service, and writes
// the WebM next to this script. Does NOT write to Firestore/Storage or any client.

import { createRequire } from 'module';
import { writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const { getSignupVideoRecipe } = require('../api/_lib/signup-video-recipe.cjs');

const url = process.argv[2] || 'https://hitloop.agency';
const renderUrl = String(process.env.STUDIO_RENDER_URL || '').replace(/\/+$/, '');
const secret = String(process.env.STUDIO_RENDER_SECRET || '');

if (!renderUrl || !secret) {
  console.error('Missing STUDIO_RENDER_URL / STUDIO_RENDER_SECRET in env.');
  process.exit(1);
}

const recipe = await getSignupVideoRecipe(url);
console.log('Resolved signup template recipe:');
console.log(JSON.stringify(recipe, null, 2));
console.log(`\nRendering through ${renderUrl}/render … (cold start can take ~60s)`);

const t0 = Date.now();
const res = await fetch(`${renderUrl}/render`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-render-secret': secret },
  body: JSON.stringify(recipe),
});

if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.error(`Render failed: HTTP ${res.status} — ${text.slice(0, 400)}`);
  process.exit(1);
}

const buf = Buffer.from(await res.arrayBuffer());
const ext = (res.headers.get('content-type') || '').includes('webm') ? 'webm' : 'mp4';
const out = new URL(`./test-signup-template.${ext}`, import.meta.url).pathname;
writeFileSync(out, buf);
console.log(`\n✓ Rendered ${(buf.length / 1e6).toFixed(1)}MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  Saved: ${out}`);
console.log(`  Render info: ${res.headers.get('x-render-info') || '(none)'}`);
