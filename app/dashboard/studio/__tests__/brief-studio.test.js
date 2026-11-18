// Brief Studio (?tool=brief): tool registration, admin-only gating, draft storage
// (per client, admin only), canvas bundling rules, rail wiring. Fakes only: no
// network, no Firestore, no dev server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STUDIO_TOOLS_META, resolveStudioTool } from '../studio-tools-meta.js';
import {
  BRIEF_DRAFT_KEY_PREFIX, briefDraftKey, draftAfterClientChange, draftFromSavedBrief, emptyBriefDraft, recordSavedSlug, normalizeBriefDraft, readBriefDraft, writeBriefDraft, clearBriefDraft,
} from '../brief/brief-draft-storage.js';
import { briefStudioHref, readBriefStudioParams } from '../../../../features/client-brief/studio-link.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFile(path.join(HERE, '..', rel), 'utf8');
const code = async (rel) => (await read(rel)).replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

test('tool registered: meta entry + resolveStudioTool + StudioPage switch + tab label', async () => {
  assert.ok(STUDIO_TOOLS_META.brief);
  assert.equal(resolveStudioTool('brief'), 'brief');
  assert.ok(STUDIO_TOOLS_META.brief.title && STUDIO_TOOLS_META.brief.description && STUDIO_TOOLS_META.brief.image && STUDIO_TOOLS_META.brief.imageAlt);
  assert.ok(!/rosita|ntr|bryan/i.test(JSON.stringify(STUDIO_TOOLS_META.brief)), 'generic copy only');
  const page = await read('StudioPage.jsx');
  assert.match(page, /\['brief', 'CLIENT BRIEF'\]/);
  assert.match(page, /tool === 'brief' \?/);
});

test('admin-only gating: tab only for admins; editor only mounts for admins; non-admin gets the Admin-only panel; no route redirect', async () => {
  const page = await read('StudioPage.jsx');
  assert.match(page, /\.\.\.\(isAdmin \? \[\['brief', 'CLIENT BRIEF'\]\] : \[\]\)/);
  assert.match(page, /tool === 'brief' \? \(\s*isAdmin \? \(\s*<BriefStudio[\s\S]*?\) : \(\s*<BriefAdminOnly/);
  // the editor is a separate dynamic chunk; the panel is a static import
  assert.match(page, /const BriefStudio = dynamic\(\(\) => import\('\.\/brief\/BriefStudio'\), \{ ssr: false \}\)/);
  assert.match(page, /^import BriefAdminOnly from '\.\/brief\/BriefAdminOnly';$/m);
  assert.ok(!/^import BriefStudio/m.test(page));
  // the route stays public: no auth redirect added
  const route = await read('page.jsx');
  assert.ok(!/redirect\(|router\.(push|replace)/.test(route));
  // defence in depth inside the editor
  const studio = await read('brief/BriefStudio.jsx');
  assert.match(studio, /if \(!isAdmin\) return null;/);
});

test('Admin-only panel: no fetch, no storage, no data (source) and renders the notice (SSR)', async () => {
  const src = await code('brief/BriefAdminOnly.jsx');
  assert.ok(!/fetch\(|authedFetch|localStorage|sessionStorage|import\(/.test(src));
  assert.ok(!/BriefStudio|useBriefDraft|BriefRail/.test(src));
  let swc = null;
  try { swc = require('next/dist/build/swc'); await swc.loadBindings(); } catch { swc = null; }
  if (!swc) return; // transform unavailable: the source checks above still pin the contract
  const out = await swc.transform(src, { filename: 'BriefAdminOnly.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } });
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const mod = { exports: {} };
  const stubRequire = (id) => (id === 'react' ? React : id === '../components/rail-ui' ? { GLASS: { sans: 'sans', ink: '#000', inkMute: '#888' } } : require(id));
  new Function('require', 'module', 'exports', out.code)(stubRequire, mod, mod.exports);
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { fetched += 1; throw new Error('no fetch allowed'); };
  try {
    const signedOut = renderToStaticMarkup(React.createElement(mod.exports.default, { signedIn: false }));
    const nonAdmin = renderToStaticMarkup(React.createElement(mod.exports.default, { signedIn: true }));
    assert.match(signedOut, /id="brief-studio-admin-only-panel"/);
    assert.match(signedOut, /Admin only/);
    assert.match(signedOut, /Sign in/);
    assert.match(nonAdmin, /does not have access/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0);
});

test('draft storage: per client key, admin-only hook, never trusts stored JSON', async () => {
  assert.equal(briefDraftKey(''), '');
  assert.equal(briefDraftKey('c1'), `${BRIEF_DRAFT_KEY_PREFIX}:c1`);
  assert.notEqual(briefDraftKey('c1'), briefDraftKey('c2'));
  const store = fakeStorage();
  const draft = { ...emptyBriefDraft(), title: 'T', text: '## A\nx', themeId: 'ledger', savedSlug: 'client-brief-20261118-0123456789abcdef', ogTitleLines: ['', 'B'] };
  assert.equal(writeBriefDraft(store, 'c1', draft), true);
  assert.equal(readBriefDraft(store, 'c2'), null, 'another client never sees it');
  assert.deepEqual(readBriefDraft(store, 'c1'), normalizeBriefDraft(draft));
  assert.deepEqual(readBriefDraft(store, 'c1').ogTitleLines, ['', 'B'], 'line positions are kept');
  assert.equal(writeBriefDraft(store, '', draft), false, 'no client = nothing stored');
  clearBriefDraft(store, 'c1');
  assert.equal(readBriefDraft(store, 'c1'), null);
  const forged = normalizeBriefDraft({ themeId: 'evil', savedSlug: '../../x', text: 5, publicToggle: 'no', ogLines: 'x' });
  assert.equal(forged.themeId, null);
  assert.equal(forged.savedSlug, '');
  assert.deepEqual(forged.ogLines, ['', '']);
  store.setItem(briefDraftKey('c3'), '{not json');
  assert.equal(readBriefDraft(store, 'c3'), null);
  const hook = await read('brief/useBriefDraft.js');
  assert.match(hook, /const activeClientId = isAdmin \? String\(clientId \|\| ''\) : '';/);
  assert.match(hook, /if \(!activeClientId \|\| loadedFor !== activeClientId\) return undefined;/);
});

test('saved brief -> draft restores markdown, title, theme, OG fields and the slug', () => {
  const d = draftFromSavedBrief({
    briefSlug: 'client-brief-20261118-0123456789abcdef', title: 'Weekly', sourceText: '## S\nx', theme: 'editorial', public: false,
    ogSubhead: 'Sub', hideOgSubhead: true, ogTitleLines: ['A', 'B', 'C'], ogLines: ['x'],
  });
  assert.equal(d.text, '## S\nx');
  assert.equal(d.themeId, 'editorial');
  assert.equal(d.publicToggle, false);
  assert.equal(d.savedSlug, 'client-brief-20261118-0123456789abcdef');
  assert.deepEqual(d.ogTitleLines, ['A', 'B', 'C']);
  assert.deepEqual(d.ogLines, ['x', '']);
  assert.equal(d.hideOgSubhead, true);
});

test('studio link: ?tool=brief&as=<client>[&brief=<slug>] round-trips', () => {
  assert.equal(briefStudioHref({ clientId: 'rosita 1' }), '/dashboard/studio?tool=brief&as=rosita+1');
  assert.equal(briefStudioHref({}), '/dashboard/studio?tool=brief');
  assert.deepEqual(readBriefStudioParams('?tool=brief&as=c1&brief=client-brief-20261118-0123456789abcdef'), { clientId: 'c1', briefSlug: 'client-brief-20261118-0123456789abcdef' });
  assert.deepEqual(readBriefStudioParams(''), { clientId: '', briefSlug: '' });
});

test('canvas bundling: renderer + parser only (no publish.js / node crypto), brand is an admin-gated dynamic import, read-only', async () => {
  const canvas = await code('brief/BriefCanvas.jsx');
  const imports = [...canvas.matchAll(/^import .*? from '([^']+)'/gm)].map((m) => m[1]);
  assert.ok(imports.includes('../../../../features/client-brief/render.js'));
  assert.ok(imports.includes('../../../../features/client-brief/parse.js'));
  assert.ok(!imports.some((p) => /publish|crypto|HoloPaper|holo|brand-marks|default-from|payment-qr/.test(p)), 'no static admin/node imports');
  assert.match(canvas, /if \(!isAdmin\) \{ setBrand\(null\)/);
  assert.match(canvas, /import\('\.\.\/\.\.\/\.\.\/\.\.\/features\/invoices\/brand-marks\.js'\)/);
  assert.ok(!/contentEditable|contenteditable|useInvoiceBridge|data-inv-field/.test(canvas));
  const render = await readFile(path.join(HERE, '../../../../features/client-brief/render.js'), 'utf8');
  assert.ok(!/publish\.js|from 'crypto'/.test(render));
});

test('rail: every call uses withImpersonation; publish + list disabled until a client is picked; answers checked against the picked client', async () => {
  const rail = await read('brief/rail/BriefRail.jsx');
  assert.match(rail, /withImpersonation\(path, clientId\)/);
  assert.match(rail, /if \(!authedFetch \|\| !clientId \|\| publishing\) return;/);
  assert.match(rail, /data\.clientId !== clientId/);
  const publishCard = await read('brief/rail/PublishCard.jsx');
  assert.match(publishCard, /Boolean\(clientId\)/);
  assert.match(publishCard, /api\('\/api\/dashboard\/custom-briefs\/og-preview'\)/);
  for (const file of ['brief/rail/BriefRail.jsx', 'brief/rail/PublishCard.jsx', 'brief/BriefStudio.jsx']) {
    const src = await read(file);
    for (const m of src.matchAll(/authedFetch\(\s*([^,)]+)/g)) {
      assert.ok(/api\(|'\/api\/admin\/clients'/.test(m[1]), `${file}: authedFetch(${m[1]}) must go through api()`);
    }
  }
  const studio = await read('brief/BriefStudio.jsx');
  assert.match(studio, /key=\{clientId \|\| 'no-client'\}/);
});

test('rail cards are built from the shared rail primitives and carry stable ids', async () => {
  for (const file of ['ClientCard', 'ContentCard', 'ThemeCard', 'PublishCard', 'SavedBriefsCard']) {
    const src = await read(`brief/rail/${file}.jsx`);
    assert.match(src, /from '\.\.\/\.\.\/components\/rail-ui'/);
    assert.match(src, /id="brief-rail-[a-z-]+-card"/);
  }
  const rail = await read('brief/rail/BriefRail.jsx');
  assert.match(rail, />Admin</);
  assert.match(await read('brief/rail/ThemeCard.jsx'), /BUILTIN_THEME_PRESETS/);
});

test('client switch never carries content across clients (A -> none -> B, A -> B); first pick keeps typed text', () => {
  const typed = { ...emptyBriefDraft(), title: 'A title', text: '## A\nsecret for A', themeId: 'ledger', ogSubhead: 'A sub', savedSlug: 'client-brief-20261118-0123456789abcdef' };
  const empty = emptyBriefDraft();
  // before any pick: text typed for the picker survives the first pick, slug never does
  const first = draftAfterClientChange({ current: typed, stored: null, hasClient: true, firstPick: true, isAdmin: true });
  assert.equal(first.text, typed.text);
  assert.equal(first.savedSlug, '');
  // A picked, then "Select a client…": reset
  assert.deepEqual(draftAfterClientChange({ current: typed, stored: null, hasClient: false, firstPick: false, isAdmin: true }), empty);
  // ...then B with nothing stored: still empty (A's text does not survive)
  assert.deepEqual(draftAfterClientChange({ current: empty, stored: null, hasClient: true, firstPick: false, isAdmin: true }), empty);
  // A -> B directly: empty, or B's own stored draft
  assert.deepEqual(draftAfterClientChange({ current: typed, stored: null, hasClient: true, firstPick: false, isAdmin: true }), empty);
  const bStored = { ...empty, text: 'B text', savedSlug: 'client-brief-20261118-aaaaaaaaaaaaaaaa' };
  assert.deepEqual(draftAfterClientChange({ current: typed, stored: bStored, hasClient: true, firstPick: false, isAdmin: true }), bStored);
  // non-admin: always empty
  assert.deepEqual(draftAfterClientChange({ current: typed, stored: null, hasClient: false, firstPick: true, isAdmin: false }), empty);
});

test('publish that resolves after a client switch is recorded against the client it was published for', () => {
  const store = fakeStorage();
  const slug = 'client-brief-20261118-0123456789abcdef';
  const submitted = { ...emptyBriefDraft(), text: '## A\nx', title: 'T' };
  assert.equal(recordSavedSlug(store, 'clientA', slug, submitted), true);
  const back = readBriefDraft(store, 'clientA');
  assert.equal(back.savedSlug, slug, 'returning to A updates instead of creating');
  assert.equal(back.text, '## A\nx');
  assert.equal(readBriefDraft(store, 'clientB'), null, 'nothing leaks to another client');
  // an existing stored draft keeps its own content, only the slug is set
  writeBriefDraft(store, 'clientC', { ...emptyBriefDraft(), text: 'newer' });
  recordSavedSlug(store, 'clientC', slug, submitted);
  assert.equal(readBriefDraft(store, 'clientC').text, 'newer');
  assert.equal(readBriefDraft(store, 'clientC').savedSlug, slug);
  assert.equal(recordSavedSlug(store, '', slug, submitted), false);
});
