import test from 'node:test';
import assert from 'node:assert/strict';

import { checkLiveReady, CLIENT_POST_FORMATS } from '../post-format.js';

const DISCOGS = 'bai-ees-discogs-TP37NQG0';
const UE = 'undergroundexistence-0CsKkpaq';
const codes = (r) => r.issues.map((i) => i.code);
const media = { mediaUrl: 'https://example.com/v.mp4' };

test('Discogs: the established live format passes, with or without a memory line', () => {
  const facts = 'Craig S. Loftis\nDon\'t Want To Be Right\nD.J. International Records\nDJ 938 · 1990\n#baieesdiscogs';
  assert.deepEqual(checkLiveReady({ content: facts, ...media }, { clientId: DISCOGS }), { ready: true, issues: [] });
  const memory = 'Some good things happenning in \'05\n\nDirty Kicks\nGet Your Kicks\nGallery\nGMG 010 · 2005\n#baieesdiscogs';
  assert.equal(checkLiveReady({ content: memory, ...media }, { clientId: DISCOGS }).ready, true);
});

test('Discogs: the old builder shape fails on every rule it breaks', () => {
  const old = 'Mike "Hitman" Wilson – Another Sleepless Night\nDJ International · DJ 123 · 1990\n\n[add your memory]';
  const r = checkLiveReady({ content: old }, { clientId: DISCOGS });
  assert.equal(r.ready, false);
  for (const c of ['placeholder', 'en-dash', 'hashtag', 'record-fields', 'no-media']) assert.ok(codes(r).includes(c), c);
});

test('Discogs: missing year or label is incomplete; birthday sentences skip the field layout but need the hashtag', () => {
  const noYear = 'Kojak\nHold Me\nPro-Zak Trax\n19805\n#baieesdiscogs';
  assert.deepEqual(codes(checkLiveReady({ content: noYear, ...media }, { clientId: DISCOGS })), ['record-fields']);
  const bday = { content: 'Happy birthday Ice Cube. Lethal Injection is on my shelf.', source: 'artist-birthday' };
  assert.deepEqual(codes(checkLiveReady(bday, { clientId: DISCOGS })), ['hashtag']);
  assert.equal(checkLiveReady({ ...bday, content: `${bday.content}\n#baieesdiscogs` }, { clientId: DISCOGS }).ready, true);
});

test('UE mix: per-line artist / title / circa with the hashtag passes; the dashed placeholder shape fails', () => {
  assert.equal(checkLiveReady({ content: 'BAI-EE\nLoft Livin\'\nCirca \'05\n#mixtapesfromchicago', ...media }, { clientId: UE }).ready, true);
  const r = checkLiveReady({ content: 'BAI-EE – Live at Housepitality w/ Johnny Fiasco\n\n[add your memory]', ...media }, { clientId: UE });
  assert.deepEqual(codes(r).sort(), ['en-dash', 'hashtag', 'mix-fields', 'placeholder'].sort());
  assert.deepEqual(codes(checkLiveReady({ content: 'ACIDMAN\n#mixtapesfromchicago', ...media }, { clientId: UE })), ['mix-fields']);
});

test('formats exist for both clients', () => { assert.ok(CLIENT_POST_FORMATS[DISCOGS] && CLIENT_POST_FORMATS[UE]); });

test('generic rules apply to any client: em dash, truncation, links, length, empty', () => {
  assert.deepEqual(codes(checkLiveReady({ content: 'a — b' }, { clientId: 'other' })), ['em-dash']);
  assert.deepEqual(codes(checkLiveReady({ content: 'Internet Archive hosts community collect…' }, {})), ['truncated']);
  assert.deepEqual(codes(checkLiveReady({ content: 'see https://x.com/a' }, {})), ['link-in-body']);
  assert.deepEqual(codes(checkLiveReady({ content: 'x'.repeat(281) }, {})), ['too-long']);
  assert.deepEqual(codes(checkLiveReady({ content: '  ' }, {})), ['empty']);
  assert.equal(checkLiveReady({ content: 'trailing dots are voice...' }, {}).ready, true);
});

import { postTextForPackage, formatRuleText, cleanLine } from '../post-format.js';
import { canonicalRemixCopy } from '../remix-copy.js';
import { buildSystemPrompt } from '../../x-strategy/agent/prompt.js';
import { draftTextFor, needsOwnerStory } from '../../x-content-inventory/calendar-batch.js';

const discogsPkg = (extra = {}) => ({
  clientId: DISCOGS, title: 'Kojak – Hold Me', eraYear: 1998, source: { kind: 'discogs', externalId: '2718456' },
  discogsSummary: { artists: ['Kojak'], title: 'Hold Me', labels: ['Pro-Zak Trax'], catalogNumbers: ['19805'], year: 1998 }, ...extra,
});
const mixPkg = (extra = {}) => ({ clientId: UE, title: 'BAI-EE – Loft Livin\'', eraYear: 2005, source: { kind: 'rendered-video' }, story: '[add your memory]', ...extra });

test('postTextForPackage: Discogs record from discogsSummary is complete and live-ready', () => {
  const t = postTextForPackage(discogsPkg());
  assert.equal(t, 'Kojak\nHold Me\nPro-Zak Trax\n19805 · 1998\n#baieesdiscogs');
  assert.equal(checkLiveReady({ content: t, mediaUrl: 'v' }, { clientId: DISCOGS }).ready, true);
  // The owner's memory goes on top; dashes in it are cleaned.
  assert.equal(postTextForPackage(discogsPkg({ humanEdits: { story: 'Found it in Leeds — 1999' } })), 'Found it in Leeds, 1999\n\nKojak\nHold Me\nPro-Zak Trax\n19805 · 1998\n#baieesdiscogs');
});

test('postTextForPackage: no discogsSummary -> never invents label/catno; the check flags it', () => {
  const t = postTextForPackage(discogsPkg({ discogsSummary: null }));
  assert.equal(t, 'Kojak\nHold Me\n1998\n#baieesdiscogs');
  assert.deepEqual(codes(checkLiveReady({ content: t, mediaUrl: 'v' }, { clientId: DISCOGS })), ['record-fields']);
});

test('postTextForPackage: falls back to the ingest record block; strips Discogs (2) suffixes', () => {
  const t = postTextForPackage(discogsPkg({ discogsSummary: null, record: { artists: ['Kojak (2)'], title: 'Hold Me', label: 'Pro-Zak Trax (3)', catno: '19805', year: 1998 } }));
  assert.equal(t, 'Kojak\nHold Me\nPro-Zak Trax\n19805 · 1998\n#baieesdiscogs');
});

test('postTextForPackage: UE mix video; other clients / kinds -> null (generic text kept)', () => {
  assert.equal(postTextForPackage(mixPkg()), 'BAI-EE\nLoft Livin\'\nCirca \'05\n#mixtapesfromchicago');
  assert.equal(postTextForPackage(mixPkg({ eraYear: null })), 'BAI-EE\nLoft Livin\'\n#mixtapesfromchicago');
  assert.equal(postTextForPackage({ ...mixPkg(), clientId: 'someone-else' }), null);
  assert.equal(postTextForPackage({ ...discogsPkg(), source: { kind: 'rendered-video' }, facets: {} }), null);
});

test('draftTextFor / needsOwnerStory: formatted packages are ready, others keep the placeholder flow', () => {
  assert.equal(draftTextFor(discogsPkg()), postTextForPackage(discogsPkg()));
  assert.equal(needsOwnerStory(discogsPkg()), false);
  const generic = { clientId: 'other', id: 'x1', title: 'Some event' };
  assert.ok(draftTextFor(generic).includes('[add your memory]'));
  assert.equal(needsOwnerStory(generic), true);
});

test('canonicalRemixCopy: UE gets the mix format; others keep artist / mix lines', () => {
  assert.equal(canonicalRemixCopy({ artist: 'BAI-EE', mix: 'The Gusto' }, { clientId: UE }), 'BAI-EE\nThe Gusto\n#mixtapesfromchicago');
  assert.equal(canonicalRemixCopy({ artist: 'BAI-EE', mix: 'The Gusto' }), 'BAI-EE\nThe Gusto');
  assert.equal(canonicalRemixCopy({}, { clientId: UE }), 'Video Remix');
});

test('chat agent: the client format rule rides in the prompt, change only on a specific ask; none for other clients', () => {
  const rule = formatRuleText(DISCOGS);
  assert.ok(rule.includes('#baieesdiscogs') && rule.includes('ONLY when the owner specifically asks'));
  assert.ok(buildSystemPrompt({ postFormat: rule }).includes('POST FORMAT (hard, this client)'));
  assert.equal(buildSystemPrompt({}).includes('POST FORMAT'), false);
  assert.equal(formatRuleText('other'), '');
  assert.equal(cleanLine(' A – B '), 'A, B');
});

import { rewritePostText, memoryFromContent } from '../post-format.js';

test('memoryFromContent: legacy builder, current shape, none', () => {
  assert.equal(memoryFromContent('A – B\nLabel · CAT · 1999\n\nFound it in Leeds.'), 'Found it in Leeds.');
  assert.equal(memoryFromContent('A – B\n\n[add your memory]'), '');
  assert.equal(memoryFromContent('Some good things in \'05\n\nDirty Kicks\nGet Your Kicks\nGallery\nGMG 010 · 2005'), 'Some good things in \'05');
  assert.equal(memoryFromContent('Kojak\nHold Me\nPro-Zak Trax\n19805 · 1998'), '');
});

test('rewritePostText: Discogs placeholder draft rebuilt from the package; owner-complete lines kept + hashtag', () => {
  const pkg = discogsPkg();
  assert.deepEqual(rewritePostText({ content: 'Kojak – Hold Me\n\n[add your memory]', mediaUrl: 'v' }, pkg, DISCOGS), { content: 'Kojak\nHold Me\nPro-Zak Trax\n19805 · 1998\n#baieesdiscogs' });
  assert.deepEqual(rewritePostText({ content: 'Kojak – Hold Me\nPro-Zak Trax · 19805 · 1998\n\nMy story', mediaUrl: 'v' }, pkg, DISCOGS), { content: 'My story\n\nKojak\nHold Me\nPro-Zak Trax\n19805 · 1998\n#baieesdiscogs' });
  assert.deepEqual(rewritePostText({ content: 'Washerman, James Johnston\nSplit Slam EP\nDeep Down Slam\nDDSR001 · 2013', mediaUrl: 'v' }, pkg, DISCOGS), { content: 'Washerman, James Johnston\nSplit Slam EP\nDeep Down Slam\nDDSR001 · 2013\n#baieesdiscogs' });
  assert.deepEqual(rewritePostText({ content: 'Happy birthday Ice Cube. Lethal Injection is on my shelf.', source: 'artist-birthday' }, null, DISCOGS), { content: 'Happy birthday Ice Cube. Lethal Injection is on my shelf.\n#baieesdiscogs' });
});

test('rewritePostText: UE video lines get the hashtag; fill mix rebuilt; takes and other clients skipped; idempotent', () => {
  assert.deepEqual(rewritePostText({ content: 'BAI-EE\nThe Gusto', mediaUrl: 'v', source: 'daily-video:x:2026-11-11' }, null, UE), { content: 'BAI-EE\nThe Gusto\n#mixtapesfromchicago' });
  assert.deepEqual(rewritePostText({ content: 'BAI-EE – Loft Livin\'\n\n[add your memory]', mediaUrl: 'v' }, mixPkg(), UE), { content: 'BAI-EE\nLoft Livin\'\nCirca \'05\n#mixtapesfromchicago' });
  assert.deepEqual(rewritePostText({ content: 'Archive thing\n\nWhere it shows up in my work: [add your take]' }, null, UE), { skip: 'quote-or-narrative' });
  assert.deepEqual(rewritePostText({ content: 'x' }, null, 'other'), { skip: 'no-format' });
  const once = rewritePostText({ content: 'BAI-EE\nThe Gusto', mediaUrl: 'v' }, null, UE).content;
  assert.equal(rewritePostText({ content: once, mediaUrl: 'v' }, null, UE).content, once);
});
