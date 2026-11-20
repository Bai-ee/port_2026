// Copies the CQ-HowTo catalog + campaign from the hitloop-video hub into features/brief-video/howto-catalog/ (the
// copy the Creative Brief author and catalogCheck read). Run after the hub regenerates them (scripts/howto-catalog.mjs there):
//   node scripts/sync-howto-catalog.mjs [--from <hubRoot>]      (default: ../hitloop-video, sibling of this repo)
// Also writes art.json: the art/posters/* files in the hub's clients/critters-quest/public (the end-art allowlist).
// catalog/campaign/art are plain JSON (no header); requestToSpec.mjs and cursorTiming.mjs are copied with a one-line VENDORED header. Prints the new catalogHash; commit the changed JSON and update the scene list in
// docs/source-of-truth/CQ-CREATIVE-BRIEF-TEMPLATE.md if panels changed (a test fails when they drift).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const fromIdx = argv.indexOf('--from');
const hub = path.resolve(fromIdx >= 0 ? argv[fromIdx + 1] : path.join(ROOT, '..', 'hitloop-video'));
const cq = path.join(hub, 'clients', 'critters-quest');
const from = path.join(cq, 'howto');
const to = path.join(ROOT, 'features', 'brief-video', 'howto-catalog');

for (const name of ['catalog.json', 'campaign.json']) {
  const src = path.join(from, name);
  const parsed = JSON.parse(fs.readFileSync(src, 'utf8')); // refuses to copy invalid JSON
  fs.writeFileSync(path.join(to, name), `${JSON.stringify(parsed, null, 2)}\n`);
  console.log(`synced ${name}`);
}
// The brief writer's library (scenes, lessons, treatments, rules) lives next to the calendar docs in the hub; served by the video-brief context MCP tool.
{
  const lib = JSON.parse(fs.readFileSync(path.join(cq, 'docs', 'calendar', 'cq-library.json'), 'utf8'));
  fs.writeFileSync(path.join(to, 'cq-library.json'), `${JSON.stringify(lib, null, 2)}\n`);
  console.log('synced cq-library.json');
}
// The hub's pure request -> spec check (plain ESM, imports ./cursorTiming.mjs): the author runs it so a request that passes here renders.
for (const name of ['requestToSpec.mjs', 'cursorTiming.mjs']) {
  const body = fs.readFileSync(path.join(from, name), 'utf8');
  fs.writeFileSync(path.join(to, name), `// VENDORED from the hitloop-video hub (clients/critters-quest/howto/${name}) by scripts/sync-howto-catalog.mjs. Do not edit here.\n${body}`);
  console.log(`synced ${name}`);
}
const posters = fs.readdirSync(path.join(cq, 'public', 'art', 'posters')).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort().map((f) => `art/posters/${f}`);
fs.writeFileSync(path.join(to, 'art.json'), `${JSON.stringify({ art: posters }, null, 2)}\n`);
console.log(`synced art.json (${posters.length})`);
const { catalogHash, loadHowtoCatalog } = await import('../features/brief-video/howto-catalog/index.js');
const { catalog, campaign } = loadHowtoCatalog();
console.log(`catalogHash ${catalogHash(catalog, campaign)}`);
