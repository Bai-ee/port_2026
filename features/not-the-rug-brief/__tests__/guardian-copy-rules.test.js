'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildVoiceRulesBlock } = require('../guardian');

const base = {
  voice_pillars: [{ name: 'Calm', do: 'State it plainly.' }],
  avoid: ['hype'],
};

test('Guardian voice block is unchanged when no punctuation/links rules exist', () => {
  const block = buildVoiceRulesBlock({ ...base, formatting_rules: { short_posts: '1 line', caps_usage: 'never' } });
  assert.equal(block, 'VOICE PILLARS:\n- Calm: State it plainly.\n\nAVOID:\n- hype');
});

test('Guardian voice block adds COPY RULES only for present keys', () => {
  const block = buildVoiceRulesBlock({ ...base, formatting_rules: { links: 'only when the post needs a concrete source' } });
  assert.match(block, /\n\nCOPY RULES:\n- links: only when the post needs a concrete source$/);
  assert.doesNotMatch(block, /punctuation/);
});
