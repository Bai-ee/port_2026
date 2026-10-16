import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import markdownForm from '../form-markdown.cjs';
import markdownLib from '../markdown.cjs';
import { BRAIN_FORM_SECTIONS, ALL_FIELDS, countFilled } from '../form-schema.js';

const { markdownToForm, formToMarkdown, FormValidationError } = markdownForm;
const { compileClientBrainMarkdown } = markdownLib;

// The standard's own example document: frontmatter block + Required Sections block.
const standard = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md'),
  'utf8',
);
const mdBlocks = [...standard.matchAll(/```md\n([\s\S]*?)```/g)].map((m) => m[1]);
const EXAMPLE = `${mdBlocks[0].trim()}\n\n${mdBlocks[1].trim()}\n`;

const norm = (s) => s.replace(/\s+$/g, '');

function sampleValue(fld) {
  if (fld.kind === 'text') return `Sample ${fld.key}`;
  if (fld.kind === 'textarea') return `Line one of ${fld.key}\nLine two`;
  if (fld.kind === 'list') return fld.keepCommas ? ['Alpha, with a comma', 'Beta'] : ['alpha', 'beta two'];
  if (fld.rowFormat === 'keyed') return [{ key: fld.allowedRowKeys[0], value: 'a value' }, { key: fld.allowedRowKeys[1], value: 'another value' }];
  return [
    Object.fromEntries(fld.rowKeys.map((k) => [k, `${k} one`])),
    Object.fromEntries(fld.rowKeys.map((k, i) => [k, i === 0 ? `${k} two` : ''])),
  ];
}

test('schema covers the seven sections in standard order with unique keys', () => {
  assert.deepEqual(BRAIN_FORM_SECTIONS.map((s) => s.title), [
    'Identity Intelligence', 'Market Intelligence', 'Discovery Intelligence', 'Authority Intelligence',
    'Content Intelligence', 'Opportunity Intelligence', 'Strategy Document',
  ]);
  assert.equal(new Set(ALL_FIELDS.map((f) => f.key)).size, ALL_FIELDS.length);
  for (const f of ALL_FIELDS) {
    assert.ok(f.guidance.why && f.guidance.how && f.guidance.example && f.guidance.usedBy.length, f.key);
    assert.doesNotMatch(JSON.stringify(f.guidance), /—/, `${f.key} guidance has an em-dash`);
  }
});

test('every heading in the standard example is covered by a schema field', () => {
  const { fields } = markdownToForm(EXAMPLE);
  const headings = [...EXAMPLE.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
  const known = new Set(ALL_FIELDS.flatMap((f) => [f.heading, ...f.aliases]));
  for (const h of headings) assert.ok(known.has(h), `unmapped heading: ${h}`);
  assert.deepEqual(fields['identity.name'], 'Bryan Balli');
  assert.deepEqual(fields['identity.categoryToOwn'], ['Creative Systems Architecture', 'Design Engineering']);
  assert.equal(fields['content.examplePosts'].length, 2);
  assert.equal(fields['content.examplePosts'][0].type, 'observation');
  assert.equal(fields['content.examplePosts'][1].post.startsWith('the bottleneck'), true);
  assert.equal(fields['content.voicePillars'][0].name, 'Plainspoken');
  assert.deepEqual(fields['content.formattingRules'].map((r) => r.key), ['short', 'medium', 'caps', 'emojis']);
});

test('unchanged form round-trips the standard example verbatim', () => {
  const { fields } = markdownToForm(EXAMPLE);
  const out = formToMarkdown(fields, { preserved: EXAMPLE });
  assert.equal(norm(out), norm(EXAMPLE));
  assert.deepEqual(markdownToForm(out).fields, fields);
});

test('editing one field rewrites only that field', () => {
  const { fields } = markdownToForm(EXAMPLE);
  const next = { ...fields, 'market.competitors': ['Acme', 'Globex'], 'identity.mission': 'Make it simple.' };
  const out = formToMarkdown(next, { preserved: EXAMPLE });
  const back = markdownToForm(out).fields;
  assert.deepEqual(back['market.competitors'], ['Acme', 'Globex']);
  assert.equal(back['identity.mission'], 'Make it simple.');
  assert.deepEqual({ ...back, 'market.competitors': 0, 'identity.mission': 0 }, { ...fields, 'market.competitors': 0, 'identity.mission': 0 });
  assert.ok(out.includes('### Voice Pillars\n- name: Plainspoken'));
  // new optional field lands right after Positioning's schema neighbour, inside Identity
  assert.ok(out.indexOf('### Mission') < out.indexOf('## Market Intelligence'));
});

test('empty optional heading is removed, empty required heading is kept', () => {
  const { fields } = markdownToForm(EXAMPLE);
  const out = formToMarkdown({ ...fields, 'content.preferredWords': [], 'identity.offers': [] }, { preserved: EXAMPLE });
  assert.ok(!out.includes('### Preferred Words'));
  assert.ok(out.includes('### Offers'));
  assert.deepEqual(markdownToForm(out).fields['identity.offers'], []);
});

test('unknown sections, unknown fields and prose survive verbatim', () => {
  const doc = `${EXAMPLE}
## Decision Drivers

### Own Creative Systems Architecture

Own:
- Creative Systems Architecture

## Internal Notes

Keep this paragraph.

### Secret Sauce
- not in the schema
`;
  const withUnknownField = doc.replace('### Offers', '### Pricing Notes\nCall us\n\n### Offers');
  const { fields } = markdownToForm(withUnknownField);
  const out = formToMarkdown({ ...fields, 'identity.name': 'Renamed' }, { preserved: withUnknownField });
  assert.ok(out.includes('## Decision Drivers\n\n### Own Creative Systems Architecture\n\nOwn:\n- Creative Systems Architecture'));
  assert.ok(out.includes('## Internal Notes\n\nKeep this paragraph.\n\n### Secret Sauce\n- not in the schema'));
  assert.ok(out.includes('### Pricing Notes\nCall us'));
  assert.equal(markdownToForm(out).fields['identity.name'], 'Renamed');
});

test('aliases are read and written back under the existing heading', () => {
  const doc = `---\nstatus: draft\n---\n\n## Discovery Intelligence\n\n### Platforms\n- web\n- x\n`;
  const { fields } = markdownToForm(doc);
  assert.deepEqual(fields['discovery.primaryPlatforms'], ['web', 'x']);
  const out = formToMarkdown({ ...fields, 'discovery.primaryPlatforms': ['web', 'reddit'] }, { preserved: doc });
  assert.ok(out.includes('### Platforms\n- web\n- reddit'));
  assert.ok(!out.includes('### Primary Platforms\n- web\n- reddit'));
});

test('a build with no original is deterministic, valid, and lossless for every field', () => {
  const fields = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, sampleValue(f)]));
  const a = formToMarkdown(fields, { frontmatter: { clientId: 'c1', clientName: 'Harbor Row Coffee' } });
  const b = formToMarkdown(fields, { frontmatter: { clientId: 'c1', clientName: 'Harbor Row Coffee' } });
  assert.equal(a, b);
  assert.match(a, /^---\nschemaVersion: hitloop\.client-brain\.v1\nclientId: c1\nclientName: Harbor Row Coffee\nstatus: draft\n---\n/);
  const back = markdownToForm(a).fields;
  for (const f of ALL_FIELDS) assert.deepEqual(back[f.key], fields[f.key], f.key);
  // second pass is a fixed point
  assert.equal(formToMarkdown(back, { preserved: a }), a);
});

test('a build from nothing emits required headings and omits empty optional ones', () => {
  const out = formToMarkdown({}, { frontmatter: { clientId: 'c1' } });
  for (const f of ALL_FIELDS.filter((x) => x.required)) assert.ok(out.includes(`### ${f.heading}\n`), f.heading);
  assert.ok(!out.includes('## Strategy Document'));
  assert.ok(!out.includes('### Mission'));
  const { filled, requiredMissing } = countFilled(markdownToForm(out).fields);
  assert.equal(filled, 0);
  assert.equal(requiredMissing.length, ALL_FIELDS.filter((x) => x.required).length);
});

test('frontmatter option updates preserved frontmatter, status otherwise untouched', () => {
  const { fields } = markdownToForm(EXAMPLE);
  const kept = formToMarkdown(fields, { preserved: EXAMPLE });
  assert.match(kept, /status: approved/);
  const set = formToMarkdown(fields, { preserved: EXAMPLE, frontmatter: { status: 'draft' } });
  assert.match(set, /status: draft/);
});

test('existing compiler recognises the headings the form writes', () => {
  const fields = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, sampleValue(f)]));
  fields['content.voicePillars'] = [{ name: 'Plainspoken', description: 'plain words', do: '"We roast Tuesdays"', dont: '"We are thrilled"' }];
  fields['content.examplePosts'] = [{ type: 'observation', label: 'hook', post: 'the strategy is the sequencing: not the deck' }];
  fields['content.formattingRules'] = [{ key: 'short', value: '1-2 lines' }, { key: 'emojis', value: 'none' }];
  fields['discovery.searchQueries'] = [{ label: 'BRAND', query: '"Harbor Row" OR "Harbor Row Coffee"', goal: 'mentions' }];
  const md = formToMarkdown(fields, { frontmatter: { clientId: 'c1', clientName: 'Harbor Row' } });
  const c = compileClientBrainMarkdown(md, { clientId: 'c1' });
  assert.equal(c.voice.pillars[0].name, 'Plainspoken');
  assert.equal(c.voice.pillars[0].dont, 'We are thrilled');
  assert.equal(c.content.postExamples[0].post, 'the strategy is the sequencing: not the deck');
  assert.equal(c.voice.formattingRules.short, '1-2 lines');
  assert.equal(c.voice.formattingRules.emojis, 'none');
  assert.equal(c.discovery.searchQueries[0].query, '"Harbor Row" OR "Harbor Row Coffee"');
  assert.equal(c.positioning.differentiators[0], 'Alpha, with a comma');
  assert.equal(c.identity.primaryUrl, 'Sample identity.primaryUrl');
  assert.equal(c.identity.mission.startsWith('Line one of identity.mission'), true);
  assert.equal(c.identity.name, 'Sample identity.name');
  assert.equal(c.proof.metrics[0], 'Alpha, with a comma');
  assert.deepEqual(c.voice.preferredWords, ['alpha', 'beta two']);
  assert.equal(c.positioning.channelOneLiners.x, 'Sample identity.xOneLiner');
});

test('invalid input is rejected with a 400-style error', () => {
  const bad = (fields) => assert.throws(() => formToMarkdown(fields, {}), (e) => e instanceof FormValidationError && e.status === 400);
  bad({ 'nope.nothing': 'x' });
  bad({ 'identity.name': ['not a string'] });
  bad({ 'identity.offers': 'not an array' });
  bad({ 'content.voicePillars': [{ name: 'x', bogus: 'y' }] });
  bad({ 'content.voicePillars': ['row'] });
  bad({ 'content.formattingRules': [{ key: 'wobble', value: 'x' }] });
  bad({ 'content.formattingRules': [{ key: 'short', value: '' }] });
  bad({ 'strategy.thesis': 'fine\n## Injected section' });
  bad({ 'identity.name': 'x'.repeat(500) });
  bad({ 'discovery.searchQueries': Array.from({ length: 9 }, (_, i) => ({ query: `q${i}` })) });
});

test('over-long values already in the document do not block an unchanged save', () => {
  const longName = 'y'.repeat(200);
  const doc = `---\nstatus: draft\n---\n\n## Identity Intelligence\n\n### Name\n${longName}\n`;
  const { fields } = markdownToForm(doc);
  assert.doesNotThrow(() => formToMarkdown(fields, { preserved: doc }));
});

test('contentTracks rows with lists round-trip losslessly through the Brain Builder form', () => {
  const lists = '1299069903333285888=Design craft; 1275110927726239748=AI builders';
  const track = { label: 'Design', share: '50', topics: 'a; b', benchmarks: 'h1; h2', lists };
  const a = formToMarkdown({ 'content.contentTracks': [track] }, { frontmatter: { clientId: 'c1', clientName: 'Harbor Row Coffee' } });
  assert.ok(a.includes(`- label: Design | share: 50 | topics: a; b | benchmarks: h1; h2 | lists: ${lists}`));
  const back = markdownToForm(a).fields;
  assert.deepEqual(back['content.contentTracks'], [track]);
  assert.equal(formToMarkdown(back, { preserved: a }), a);
});
