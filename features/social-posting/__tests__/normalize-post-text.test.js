import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePostText } from '../twitter-service.js';

test('normalizePostText keeps paragraph breaks, emoji and @handles exactly as typed', () => {
  const typed = 'Black Traxx Vol III 🎧\n\nNarcotic by @rogersanchez\n\n#house';
  assert.equal(normalizePostText(typed), typed);
});

test('normalizePostText only trims line-trailing spaces, CRLF and 3+ newline runs', () => {
  assert.equal(normalizePostText('a  \r\nb\n\n\n\nc  '), 'a\nb\n\nc');
  assert.equal(normalizePostText('  lead\ttab\n'), 'lead\ttab');
  assert.equal(normalizePostText(null), '');
});
