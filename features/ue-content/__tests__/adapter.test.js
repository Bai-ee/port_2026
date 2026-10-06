import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mixToPackage, mapArtists, buildVideoIndex, parseYear, parseDuration, extractTxid,
  playabilityIssue, findReviewExcerpt, PLACEHOLDER_STORY,
} from '../adapter.js';
import { validatePackage } from '../../x-content-inventory/schema.js';
import { RIGHTS_STATES } from '../../x-content-inventory/schema.js';

const TX = (c) => c.repeat(43);
const url = (tx) => `https://example.arweave.net/${tx}`;
const bai = { artistName: 'BAI-EE', artistFilename: 'baiee.html', artistGenre: 'house', mixes: [] };
const other = { artistName: 'ACIDMAN', artistFilename: 'acidman.html', mixes: [] };
const mix = (title, tx, extra = {}) => ({ mixTitle: title, mixArweaveURL: url(tx), mixDateYear: "'09", mixDuration: '60:00', ...extra });
const ctx = { videoIndex: buildVideoIndex(['ACIDMAN_video_1.mp4', 'BAI-EE_30s.mp4', 'BAI-EE_30s 2.mp4', 'random_30s.mp4', '17853334101205707.mp4']) };

test('mapping: id, series, engine, title, source, entities', () => {
  const p = mixToPackage(mix('Stargazers', TX('a')), other, ctx);
  assert.match(p.id, /^ue-[0-9a-f]{12}$/);
  assert.equal(p.id, mixToPackage(mix('Other title', TX('a')), other, ctx).id); // stable from txid
  assert.equal(p.series, 'C4');
  assert.equal(p.engine, 'ue');
  assert.equal(p.pillar, 'made-this');
  assert.equal(p.title, 'ACIDMAN – Stargazers (2009)');
  assert.deepEqual(p.source, { kind: 'ue', externalId: TX('a'), url: 'https://undergroundexistence.info/acidman.html' });
  assert.deepEqual(p.entities, ['ACIDMAN', 'Underground Existence']);
  assert.equal(p.eraYear, 2009);
  assert.equal(p.priority, 'evergreen');
  assert.equal(p.status, 'idea');
  assert.equal(p.lastPostedAt, null);
  assert.ok(validatePackage(p).ok, validatePackage(p).errors.join());
});

test('video vs still follows the artist video index', () => {
  const v = mixToPackage(mix('x', TX('a')), other, ctx);
  assert.equal(v.format, 'video'); assert.equal(v.mediaState, 'video');
  assert.deepEqual(v.assetRefs, ['undergroundEx/ACIDMAN_video_1.mp4']);
  const s = mixToPackage(mix('x', TX('b')), { ...other, artistName: 'NOBODY' }, ctx);
  assert.equal(s.format, 'still'); assert.equal(s.mediaState, 'still');
  assert.equal(ctx.videoIndex.RANDOM, undefined);
});

test('rights: Bai-ee owned, everyone else blocked', () => {
  const o = mixToPackage(mix('x', TX('a')), bai, ctx);
  assert.equal(o.rights, 'owned');
  const t = mixToPackage(mix('x', TX('b')), other, ctx);
  assert.equal(t.rights, 'never-public');
  assert.ok(RIGHTS_STATES.includes(t.rights));
  assert.equal(t.approval.state, 'needed');
  assert.ok(t.tags.includes('rights:third-party-unconfirmed'));
  assert.match(t.variants.x.rightsNote, /never-public/);
});

test('story is the placeholder; suggestion is factual metadata', () => {
  const p = mixToPackage(mix('Stargazers', TX('a')), other, ctx);
  assert.equal(p.story, PLACEHOLDER_STORY);
  assert.match(p.variants.x.suggestedStory, /^Underground Existence archive: ACIDMAN, "Stargazers" \(2009\)\./);
  assert.match(p.variants.x.suggestedStory, /[Ll]isted at 60:00/);
});

test('review excerpt is attributed and only used on artist+title match', () => {
  const reviews = [{ artist: 'Cesar Ramirez', title: 'Let Yourself Go', author: 'Cesar Ramirez',
    review: 'Write 100 words about\n"Let Yourself Go"\nThis is a Disco mix I did back in 2001. It is great fun.' }];
  const cesar = { artistName: 'CESAR RAMIREZ', artistFilename: 'cesarramirez.html', mixes: [] };
  const hit = mixToPackage(mix('Let Yourself Go', TX('c')), cesar, { ...ctx, reviews });
  assert.match(hit.variants.x.suggestedStory, /Cesar Ramirez wrote: "This is a Disco mix I did back in 2001\."/);
  const miss = mixToPackage(mix('Other', TX('c')), cesar, { ...ctx, reviews });
  assert.doesNotMatch(miss.variants.x.suggestedStory, /wrote:/);
  assert.equal(findReviewExcerpt([], 'a', 'b'), null);
});

test('defect exclusion: truncated, empty/0:00, missing, known defects', () => {
  assert.match(playabilityIssue({ mixArweaveURL: 'https://arweave.net/neH-PrcWXd71JCZayTX', mixDuration: '60' }, bai), /truncated/);
  assert.match(playabilityIssue(mix('x', TX('a'), { mixDuration: '0:00' }), bai), /0:00/);
  assert.match(playabilityIssue(mix('x', TX('a'), { mixDuration: '' }), bai), /duration/);
  assert.match(playabilityIssue({ mixDuration: '60:00' }, bai), /missing txid/);
  assert.match(playabilityIssue({ mixTitle: 'x', mixArweaveURL: url('5lOnZSh458XC-wk1xTkLimE-L-g0vnKejInB834VAEA'), mixDuration: '60:00' }, { artistName: 'Chicago Skyway' }), /known defect/);
  assert.equal(playabilityIssue(mix('x', TX('a')), bai), null);
});

test('mapArtists: dedupes cross-listed audio and reports reasons', () => {
  const a = { ...other, mixes: [mix('one', TX('a')), mix('zero', TX('b'), { mixDuration: '0:00' })] };
  const b = { artistName: 'VIVA ACID', artistFilename: 'v.html', mixes: [mix('mirror', TX('a'))] };
  const { packages, skipped } = mapArtists([a, b], ctx);
  assert.equal(packages.length, 1);
  assert.equal(skipped.length, 2);
  assert.ok(skipped.some((s) => /duplicate audio/.test(s.reason)));
  assert.ok(skipped.some((s) => /0:00/.test(s.reason)));
});

test('parsers', () => {
  assert.equal(parseYear("'09"), 2009); assert.equal(parseYear("'01'"), 2001); assert.equal(parseYear('6/24'), 2024);
  assert.equal(parseYear('7/18/25'), 2025); assert.equal(parseYear('2024h'), 2024); assert.equal(parseYear("Circe '95"), 1995);
  assert.equal(parseYear('Circa 2009'), 2009); assert.equal(parseYear('20??'), null); assert.equal(parseYear('??'), null);
  assert.equal(parseDuration('0:00'), null); assert.equal(parseDuration('60'), 60); assert.ok(parseDuration('72:00') > 0);
  assert.equal(extractTxid(`https://x.arweave.net/${TX('q')}`), TX('q'));
});

test('title cleanup drops trailing "??" and tags it; year unknown -> null', () => {
  const p = mixToPackage(mix('Live @ UE.info ??', TX('d'), { mixDateYear: '20??' }), other, ctx);
  assert.equal(p.title, 'ACIDMAN – Live @ UE.info');
  assert.equal(p.eraYear, null);
  assert.ok(p.tags.includes('title-cleaned') && p.tags.includes('year-unknown'));
});

test('build stories: valid C5/ue/owned packages with placeholder story', () => {
  const stories = JSON.parse(readFileSync(new URL('../build-stories.json', import.meta.url), 'utf8'));
  assert.ok(stories.length >= 5 && stories.length <= 6);
  for (const s of stories) {
    assert.equal(s.series, 'C5'); assert.equal(s.engine, 'ue'); assert.equal(s.rights, 'owned');
    assert.equal(s.story, PLACEHOLDER_STORY);
    assert.ok(s.variants.x.suggestedStory.length > 40);
    assert.ok(validatePackage(s).ok, validatePackage(s).errors.join());
  }
  assert.equal(new Set(stories.map((s) => s.id)).size, stories.length);
});

test('no wallet/key material in any output', () => {
  const stories = JSON.parse(readFileSync(new URL('../build-stories.json', import.meta.url), 'utf8'));
  const { packages } = mapArtists([{ ...bai, mixes: [mix('m', TX('a'))] }, { ...other, mixes: [mix('n', TX('b'))] }], ctx);
  for (const p of [...packages, ...stories]) {
    const externalId = p.source?.externalId;
    const text = JSON.stringify({ ...p, source: { ...p.source, externalId: undefined } });
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{43}/, `43-char key-like string in ${p.id}`);
    assert.doesNotMatch(text, /jwk|private|mnemonic|seed phrase|wallet|arweave\.net|ARWEAVE_/i);
    if (externalId) assert.match(externalId, /^[A-Za-z0-9_-]+$/);
  }
});
