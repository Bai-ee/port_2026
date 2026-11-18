import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFirestoreSafe } from './firestore-safe.js';
import { parseClientBrief, parseInline, CLIENT_BRIEF_MAX_CHARS, ClientBriefParseError } from '../parse.js';

const plain = (tokens) => tokens.map((t) => t.v).join('');

test('headings of every style start sections; first lone H1 is the title', () => {
  const m = parseClientBrief('# Daily Update\n\n## Wins\nText one.\n\n### Risks\nText two.\n\n**Next steps**\nText three.\n\n**Watch list**:\nText four.');
  assert.equal(m.title, 'Daily Update');
  assert.deepEqual(m.sections.map((s) => s.heading), ['Wins', 'Risks', 'Next steps', 'Watch list']);
});

test('explicit title option wins; default title applies', () => {
  assert.equal(parseClientBrief('# Heading\nbody', { title: 'Custom' }).title, 'Custom');
  assert.equal(parseClientBrief('## A\nbody').title, 'Client Brief');
});

test('bold-label and plain Label: value lines group into one stats block', () => {
  const m = parseClientBrief('## Numbers\n**Revenue (USD)**: $1,200\n**Orders:** 14\nVisits: 300\n\nSome paragraph after.');
  const [stats, para] = m.sections[0].blocks;
  assert.equal(stats.type, 'stats');
  assert.deepEqual(stats.rows.map((r) => r.label), ['Revenue (USD)', 'Orders', 'Visits']);
  assert.equal(plain(stats.rows[0].value), '$1,200');
  assert.equal(para.type, 'para');
});

test('stats stay one block across a blank line, split by other blocks', () => {
  const m = parseClientBrief('## S\nA: 1\n\nB: 2\n\n- bullet\n\nC: 3');
  assert.deepEqual(m.sections[0].blocks.map((b) => b.type), ['stats', 'list', 'stats']);
  assert.equal(m.sections[0].blocks[0].rows.length, 2);
});

test('bullets of every marker become one list; numbered and unicode too', () => {
  const m = parseClientBrief('## L\n- one\n* two\n• three\n1. four\n2) five');
  const [bullets, numbered] = m.sections[0].blocks;
  assert.equal(bullets.type, 'list');
  assert.equal(bullets.ordered, false);
  assert.deepEqual(bullets.items.map((i) => plain(i.tokens)), ['one', 'two', 'three']);
  assert.equal(numbered.ordered, true);
  assert.deepEqual(numbered.items.map((i) => plain(i.tokens)), ['four', 'five']);
});

test('model is Firestore-safe (no array directly inside an array) with intro + bullets + numbered list', () => {
  const m = parseClientBrief('Intro one.\n\nIntro two.\n\n## A\n- b1\n- b2\n\n1. n1\n2. n2\nK: v\n\n| x | y |\n|---|---|\n| 1 | 2 |');
  assert.equal(m.intro.length, 2);
  assert.ok(Array.isArray(m.intro[0].tokens));
  assertFirestoreSafe(m);
  assert.throws(() => assertFirestoreSafe({ a: [[1]] }), /nested array/);
});

test('URLs and times are not mistaken for labels', () => {
  const m = parseClientBrief('## X\nhttps://example.com/path is live.\nMeet at 10:30 tomorrow.');
  assert.equal(m.sections[0].blocks.length, 1);
  assert.equal(m.sections[0].blocks[0].type, 'para');
});

test('inline markup: bold, em, code, safe links; javascript: rejected', () => {
  const t = parseInline('**b** *e* `c` [ok](https://a.com/x) [bad](javascript:alert(1)) [data](data:text/html,x) see https://b.com/y.');
  assert.deepEqual(t.filter((x) => x.t !== 'text').map((x) => x.t), ['b', 'em', 'code', 'link', 'link']);
  const links = t.filter((x) => x.t === 'link');
  assert.equal(links[0].href, 'https://a.com/x');
  assert.equal(links[1].href, 'https://b.com/y');
  const joined = plain(t);
  assert.ok(joined.includes('bad') && joined.includes('data'));
  assert.ok(!JSON.stringify(t).includes('javascript:'));
  assert.ok(!JSON.stringify(t).includes('data:text'));
});

test('fenced code and HITLOOP COMMAND blocks are stripped, even unclosed', () => {
  const m = parseClientBrief('## A\nkeep me\n\nHITLOOP COMMAND\n```\nrm -rf secret\n```\n\n```js\nconsole.log(1)\n```\nafter\n\n```\nunclosed internal');
  const text = JSON.stringify(m);
  assert.ok(!/secret|console|unclosed|HITLOOP COMMAND/.test(text), text);
  assert.ok(text.includes('keep me') && text.includes('after'));
});

test('text before the first heading becomes intro; mixed preface becomes a section', () => {
  const a = parseClientBrief('Hello there.\n\nSecond line.\n\n## Wins\n- x');
  assert.equal(a.intro.length, 2);
  const b = parseClientBrief('- early bullet\n\n## Wins\n- x');
  assert.equal(b.intro.length, 0);
  assert.equal(b.sections[0].heading, '');
  assert.equal(b.sections.length, 2);
});

test('rules separate blocks and are not rendered; tables flatten to list rows', () => {
  const m = parseClientBrief('## T\nline a\n---\nline b\n\n| Metric | Value |\n|---|---|\n| Sales | 5 |');
  const types = m.sections[0].blocks.map((b) => b.type);
  assert.deepEqual(types, ['para', 'para', 'list']);
  assert.deepEqual(m.sections[0].blocks[2].items.map((i) => plain(i.tokens)), ['Metric · Value', 'Sales · 5']);
});

test('empty, whitespace-only, non-string, code-only and oversize input rejected', () => {
  for (const bad of ['', '   \n  ', null, undefined, 5, '```\nonly code\n```']) {
    assert.throws(() => parseClientBrief(bad), ClientBriefParseError);
  }
  assert.throws(() => parseClientBrief('x'.repeat(CLIENT_BRIEF_MAX_CHARS + 1)), (e) => e.code === 'too_long');
  assert.doesNotThrow(() => parseClientBrief('x'.repeat(CLIENT_BRIEF_MAX_CHARS)));
});

test('deterministic: same input, same model', () => {
  const src = '# T\n## A\nK: v\n- x';
  assert.deepEqual(parseClientBrief(src, { clientName: 'C', asOf: '2026-11-18' }), parseClientBrief(src, { clientName: 'C', asOf: '2026-11-18' }));
});

const NTR_SAMPLE = `# NTR Daily Update

Good morning. Here is where things stand for **Wednesday, Nov 18**.

---

## Snapshot
**Revenue (yesterday)**: $1,284.50 (+6% vs last Wed)
**Orders**: 47
**Website visits**: 912
Top item: Al pastor taco plate

## What worked
- Instagram reel on Monday drove **2x** the usual saves
- Email "Taco Tuesday" opened at 41%
- Google review count is now 212 ([view](https://maps.google.com/?q=ntr))

## Needs attention
**Slow Thursday lunches**
We are under target by about 18% between 11am and 1pm.

Suggested moves:
1. Post a lunch-special story Wednesday evening
2. Test a $9 combo
3. Ask regulars for a quick review

## Next steps
- Approve the weekend promo draft
- Send updated menu photos

\`\`\`
HITLOOP COMMAND
set-flag internal=true
\`\`\`
`;

test('realistic NTR daily update parses into the expected structure', () => {
  const m = parseClientBrief(NTR_SAMPLE, { clientName: 'NTR', asOf: '2026-11-18' });
  assert.equal(m.title, 'NTR Daily Update');
  assert.equal(m.intro.length, 1);
  assert.deepEqual(m.sections.map((s) => s.heading), ['Snapshot', 'What worked', 'Needs attention', 'Slow Thursday lunches', 'Suggested moves', 'Next steps']);
  const snapshot = m.sections[0].blocks[0];
  assert.equal(snapshot.type, 'stats');
  assert.equal(snapshot.rows.length, 4);
  assert.equal(snapshot.rows[3].label, 'Top item');
  const worked = m.sections[1].blocks[0];
  assert.equal(worked.items.length, 3);
  assert.ok(worked.items[2].tokens.some((t) => t.t === 'link' && t.href.startsWith('https://maps.google.com')));
  assert.equal(m.sections[4].blocks[0].items.length, 3);
  assert.ok(!JSON.stringify(m).includes('set-flag'));
});
