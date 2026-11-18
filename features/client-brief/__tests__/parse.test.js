import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFirestoreSafe } from './firestore-safe.js';
import { parseClientBrief, parseInline, inlineToPlain, CLIENT_BRIEF_MAX_CHARS, ClientBriefParseError } from '../parse.js';

const plain = inlineToPlain;
const types = (m) => m.blocks.map((b) => b.type);

test('every block type comes out in SOURCE ORDER, nothing grouped or reordered', () => {
  const src = [
    '# Title', '', 'Para one.', '', '> quoted', '', '- a', '- b', '', '---', '',
    '1. x', '2. y', '', '| h1 | h2 |', '|---|---|', '| c1 | c2 |', '', '```js', 'const a = 1;', '```', '', '## Last', 'Revenue: $1,284',
  ].join('\n');
  const m = parseClientBrief(src);
  assert.deepEqual(types(m), ['heading', 'paragraph', 'blockquote', 'list', 'hr', 'list', 'table', 'code', 'heading', 'paragraph']);
  assert.equal(m.blocks[0].level, 1);
  assert.equal(m.blocks[8].level, 2);
  // "Label: value" is just a paragraph now (no stats grouping)
  assert.equal(plain(m.blocks[9].tokens), 'Revenue: $1,284');
});

test('all heading levels; the first H1 is the title but STAYS in the body', () => {
  const m = parseClientBrief('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six');
  assert.deepEqual(m.blocks.map((b) => b.level), [1, 2, 3, 4, 5, 6]);
  assert.equal(m.title, 'One');
  assert.equal(parseClientBrief('# One\nx', { title: 'Custom' }).title, 'Custom');
  assert.equal(parseClientBrief('plain text').title, 'Client Brief');
});

test('ordered list keeps its start number; unordered markers; one nested level, deeper flattens', () => {
  const m = parseClientBrief('3. three\n4. four\n\n- a\n  - b\n    - c\n* d\n+ e');
  const [ol, ul] = m.blocks;
  assert.equal(ol.ordered, true);
  assert.equal(ol.start, 3);
  assert.equal(ul.ordered, false);
  assert.deepEqual(ul.items.map((i) => plain(i.tokens)), ['a', 'd', 'e']);
  assert.deepEqual(ul.items[0].sub.items.map((i) => plain(i.tokens)), ['b', 'c']);
  assert.equal(ul.items[0].sub.items[0].sub, undefined);
});

test('GFM table: header, alignment, rows padded to header width, escaped pipes', () => {
  const m = parseClientBrief('| Name | Qty | Note |\n|:--|--:|:-:|\n| a | 1 |\n| b \\| c | 2 | x | extra |');
  const t = m.blocks[0];
  assert.equal(t.type, 'table');
  assert.deepEqual(t.align, ['left', 'right', 'center']);
  assert.deepEqual(t.header.cells.map((c) => plain(c.tokens)), ['Name', 'Qty', 'Note']);
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0].cells.map((c) => plain(c.tokens)), ['a', '1', '']);
  assert.equal(plain(t.rows[1].cells[0].tokens), 'b | c');
  assert.equal(t.rows[1].cells.length, 4); // extra cells are kept, never dropped
});

test('thematic breaks: ---, ***, ___ (also never a setext heading)', () => {
  const m = parseClientBrief('text\n---\n\n***\n\n___');
  assert.deepEqual(types(m), ['paragraph', 'hr', 'hr', 'hr']);
});

test('fenced code is KEPT (backtick and tilde, language kept)', () => {
  const m = parseClientBrief('```bash\nnpm run x\n  indented\n```\n\n~~~\nplain\n~~~');
  assert.deepEqual(types(m), ['code', 'code']);
  assert.equal(m.blocks[0].lang, 'bash');
  assert.equal(m.blocks[0].text, 'npm run x\n  indented');
  assert.equal(m.blocks[1].text, 'plain');
});

test('HITLOOP COMMAND fenced blocks (info string or first line) and their caption are stripped', () => {
  const a = parseClientBrief('Keep me.\n\nHITLOOP COMMAND\n```\nrun this\n```\n\nAfter.');
  assert.deepEqual(a.blocks.map((b) => plain(b.tokens)), ['Keep me.', 'After.']);
  const b = parseClientBrief('Keep.\n\n```HITLOOP COMMAND\nrun\n```');
  assert.deepEqual(types(b), ['paragraph']);
  const c = parseClientBrief('Keep.\n\n```\nHITLOOP COMMAND: do\nrun\n```'.replace('COMMAND: do', 'COMMAND'));
  assert.deepEqual(types(c), ['paragraph']);
  assert.throws(() => parseClientBrief('```\nHITLOOP COMMAND\nx\n```'), { code: 'empty' });
});

test('inline: bold, italic, bold-italic, code, links, nesting', () => {
  const t = parseInline('a **b** *c* ***d*** `e` [f](https://x.com/p) **g [h](https://y.com)**');
  assert.deepEqual(t.map((x) => x.t), ['text', 'b', 'text', 'em', 'text', 'bem', 'text', 'code', 'text', 'link', 'text', 'b']);
  assert.equal(t[9].href, 'https://x.com/p');
  assert.equal(t[11].c.find((x) => x.t === 'link').href, 'https://y.com/');
  assert.equal(parseInline('mail [me](mailto:a@b.co)')[1].href, 'mailto:a@b.co');
  assert.equal(parseInline('see https://x.com/a.')[1].href, 'https://x.com/a');
});

test('line breaks inside a paragraph are kept as br tokens', () => {
  const m = parseClientBrief('line one\nline two  \nline three');
  assert.deepEqual(m.blocks[0].tokens.filter((t) => t.t === 'br').length, 2);
});

test('raw HTML and unsafe links are never interpreted: html stays text, javascript: link is text only', () => {
  const m = parseClientBrief('<script>alert(1)</script> <b>x</b> [bad](javascript:alert(1)) [d](data:text/html,x) ![i](https://x.com/a.png)');
  const tokens = m.blocks[0].tokens;
  assert.ok(tokens.every((t) => t.t !== 'link' || /^https?:/.test(t.href)));
  assert.ok(plain(tokens).includes('<script>alert(1)</script>'));
  assert.ok(!tokens.some((t) => t.href && /javascript|data:/i.test(t.href)));
  assert.equal(plain(tokens).includes('javascript:'), false);
});

test('model is Firestore-safe (no arrays directly in arrays, no undefined)', () => {
  const src = '# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n1. x\n   - y\n\n> q\n\n```\nc\n```';
  assertFirestoreSafe(parseClientBrief(src, { clientName: 'Co', asOf: '2026-11-18' }), 'model');
});

test('empty / oversized text is rejected with a coded error', () => {
  assert.throws(() => parseClientBrief('   '), (e) => e instanceof ClientBriefParseError && e.code === 'empty');
  assert.throws(() => parseClientBrief(null), { code: 'empty' });
  assert.throws(() => parseClientBrief('x'.repeat(CLIENT_BRIEF_MAX_CHARS + 1)), { code: 'too_long' });
  assert.equal(parseClientBrief('x'.repeat(CLIENT_BRIEF_MAX_CHARS)).blocks.length, 1);
});

test('table rows wider than the header keep every cell (no content loss)', () => {
  const m = parseClientBrief('| A | B |\n|---|---|\n| 1 | 2 | 3 |');
  const table = m.blocks.find((b) => b.type === 'table');
  assert.equal(table.rows[0].cells.length, 3);
});
