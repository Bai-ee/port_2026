import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseListText, listToText, parseRows, emptyRow, toDraftValue, toPayloadValue,
  buildDraft, buildPayload, sectionProgress, progressFrom, isOverLimit, humanizeKey, rowKeyMeta,
} from '../value-utils.js';
import { BRAIN_FORM_SECTIONS, ALL_FIELDS, countFilled } from '../../../features/client-brain/form-schema.js';

test('parseListText trims, drops blanks, handles CRLF', () => {
  assert.deepEqual(parseListText('  a \r\n\n b\n   \nc'), ['a', 'b', 'c']);
  assert.deepEqual(parseListText(''), []);
  assert.deepEqual(parseListText(undefined), []);
});

test('listToText round-trips with parseListText', () => {
  assert.equal(listToText(['x', 'y']), 'x\ny');
  assert.deepEqual(parseListText(listToText(['x', 'y'])), ['x', 'y']);
});

test('rows: normalize to rowKeys, drop empty rows, keep partial rows', () => {
  const keys = ['quote', 'author'];
  assert.deepEqual(parseRows([{ quote: 'q', extra: 'zz' }, { quote: ' ', author: '' }, {}], keys), [{ quote: 'q', author: '' }]);
  assert.deepEqual(emptyRow(keys), { quote: '', author: '' });
  assert.deepEqual(parseRows(null, keys), []);
});

test('humanizeKey / rowKeyMeta', () => {
  assert.equal(humanizeKey('voicePillars'), 'Voice pillars');
  assert.deepEqual(rowKeyMeta({ key: 'a', label: 'Aaa' }), { key: 'a', label: 'Aaa' });
  assert.deepEqual(rowKeyMeta('caseStudy'), { key: 'caseStudy', label: 'Case study' });
});

test('draft/payload conversion per kind', () => {
  const list = { key: 'l', kind: 'list' };
  const rows = { key: 'r', kind: 'rows', rowKeys: ['a', 'b'] };
  const text = { key: 't', kind: 'text' };
  assert.equal(toDraftValue(list, ['a', 'b']), 'a\nb');
  assert.deepEqual(toPayloadValue(list, 'a\n\nb'), ['a', 'b']);
  assert.deepEqual(toDraftValue(rows, [{ a: 1 }]), [{ a: '1', b: '' }]);
  assert.deepEqual(toPayloadValue(rows, [{ a: '', b: '' }, { a: 'x', b: '' }]), [{ a: 'x', b: '' }]);
  assert.equal(toPayloadValue(text, '  hi  '), 'hi');
  assert.equal(toDraftValue(text, null), '');
});

test('progress is driven by countFilled over the built payload', () => {
  const empty = buildDraft(ALL_FIELDS, {});
  const p0 = progressFrom(countFilled(buildPayload(ALL_FIELDS, empty)));
  assert.equal(p0.filled, 0);
  assert.equal(p0.total, ALL_FIELDS.length);
  assert.equal(p0.pct, 0);
  assert.equal(p0.label, `0 of ${ALL_FIELDS.length} fields filled`);
  assert.ok(p0.requiredMissing.length > 0);

  const draft = buildDraft(ALL_FIELDS, { 'identity.name': 'Acme', 'identity.categoryToOwn': ['Plain'], 'content.voicePillars': [{ name: 'great' }] });
  const p1 = progressFrom(countFilled(buildPayload(ALL_FIELDS, draft)));
  assert.equal(p1.filled, 3);
  assert.equal(p1.pct, Math.round((3 / ALL_FIELDS.length) * 100));
});

test('whitespace-only values do not count as filled', () => {
  const draft = buildDraft(ALL_FIELDS, { 'identity.name': '   ', 'identity.categoryToOwn': ['  '], 'content.voicePillars': [{ name: ' ' }] });
  assert.equal(countFilled(buildPayload(ALL_FIELDS, draft)).filled, 0);
});

test('sectionProgress counts per section', () => {
  const draft = buildDraft(ALL_FIELDS, { 'identity.name': 'Acme', 'identity.positioning': 'x' });
  const identity = BRAIN_FORM_SECTIONS.find((s) => s.id === 'identity');
  assert.deepEqual(sectionProgress(identity, draft), { filled: 2, total: identity.fields.length });
});

test('progressFrom is safe on bad input; isOverLimit only for text kinds', () => {
  assert.equal(progressFrom(undefined).pct, 0);
  assert.equal(progressFrom({ filled: 9, total: 3 }).filled, 3);
  assert.equal(isOverLimit({ kind: 'text', maxLen: 3 }, 'abcd'), true);
  assert.equal(isOverLimit({ kind: 'list', maxLen: 3 }, 'abcd'), false);
});
