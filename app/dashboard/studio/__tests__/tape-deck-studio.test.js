// Tape Deck (?tool=tapes): registration, public (no auth) wiring, read-only
// route + client, stable DOM ids. Source checks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_TOOLS_META, resolveStudioTool } from '../studio-tools-meta.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../../../..');
const read = (rel) => readFile(path.join(HERE, '..', rel), 'utf8');
const code = async (rel) => (await read(rel)).replace(/^\s*\/\/.*$/gm, '');

test('registered: meta entry, resolveStudioTool, tab, dynamic import, ternary branch, OG image', async () => {
  const meta = STUDIO_TOOLS_META.tapes;
  assert.ok(meta && meta.title === 'Tape Deck' && meta.description && meta.imageAlt);
  assert.equal(meta.image, '/img/og/studio-tapes.jpg');
  assert.equal(resolveStudioTool('tapes'), 'tapes');
  const page = await read('StudioPage.jsx');
  assert.match(page, /\['tapes', 'TAPE DECK'\]/);
  assert.match(page, /const TapeDeckStudio = dynamic\(\(\) => import\('\.\/tapes\/TapeDeckStudio'\), \{ ssr: false \}\)/);
  assert.match(page, /tool === 'tapes' \? \(\s*<TapeDeckStudio isNarrow=\{isNarrow\} railW=\{RAIL_W\} \/>/);
  const jpg = await readFile(path.join(ROOT, 'public/img/og/studio-tapes.jpg'));
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
});

test('public: the tab is not admin-gated and the tool takes no auth props', async () => {
  const page = await read('StudioPage.jsx');
  assert.ok(!/isAdmin \? \[\[\s*'tapes'/.test(page));
  assert.ok(!/<TapeDeckStudio[^>]*(isAdmin|authedFetch|user=)/.test(page));
});

test('client is read-only: one GET to the public endpoint, no auth, no writes', async () => {
  const src = await code('tapes/TapeDeckStudio.jsx');
  const fetches = [...src.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(fetches, ["'/api/public/tape-deck'"]);
  assert.ok(!/authedFetch|method:\s*'(POST|PUT|PATCH|DELETE)'|localStorage|sessionStorage|firebase/i.test(src));
});

test('stable DOM ids from the spec exist', async () => {
  const src = (await code('tapes/TapeDeckStudio.jsx')) + (await code('tapes/Cassette.jsx'));
  for (const id of ['tape-deck-shell', 'tape-deck-a', 'tape-deck-b', 'tape-deck-transport', 'tape-deck-history-panel', 'tape-deck-empty-state']) {
    assert.ok(src.includes(id), id);
  }
});

test('audio elements: preload none, inactive deck muted via the element, no continuous drift seeking', async () => {
  const src = await code('tapes/TapeDeckStudio.jsx');
  assert.match(src, /preload="none"/);
  assert.match(src, /\.muted = /);
  const tick = src.slice(src.indexOf('const tick'), src.indexOf('rafRef.current = requestAnimationFrame(tick);\n  }, [pauseAll'));
  assert.ok(!/currentTime\s*=(?!=)/.test(tick.replace(/a\.currentTime = 0/, '')), 'the frame loop only reads time (besides the end-of-clip rewind)');
});

test('route: public, read-only, cached, no error leakage', async () => {
  const route = await readFile(path.join(ROOT, 'app/api/public/tape-deck/route.js'), 'utf8');
  assert.match(route, /export const runtime = 'nodejs'/);
  assert.match(route, /export const dynamic = 'force-dynamic'/);
  assert.match(route, /public, s-maxage=300, stale-while-revalidate=600/);
  assert.match(route, /\.where\('status', '==', 'published'\)/);
  assert.ok(!/\.(set|update|delete|add)\(/.test(route));
  assert.match(route, /console\.error\('\[tape-deck\]', err\?\.code \|\| err\?\.name/);
  assert.ok(!/err\.message|error\.message|stack/.test(route));
  assert.ok(/export async function GET/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)/.test(route));
});
