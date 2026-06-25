'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveVoiceProfile,
  projectBrainToVoiceProfile,
  hasVoiceContent,
  normalizeFormattingRules,
  normalizeVoicePillars,
  normalizeContentPillars,
} = require('../voice-resolver');

/* ---- pure projector: shape guarantees Scribe/Guardian hard-access ---- */

test('projection always emits the arrays/objects Scribe consumes', () => {
  const p = projectBrainToVoiceProfile({ version: 2, voice: {}, content: {} }, 'acme');
  assert.ok(Array.isArray(p.voice_pillars));
  assert.ok(Array.isArray(p.avoid));
  assert.ok(Array.isArray(p.few_shot_examples));
  assert.ok(p.formatting_rules && typeof p.formatting_rules === 'object');
  assert.equal(typeof p.scribe_instructions, 'string');
  assert.equal(p.client, 'acme');
});

test('projection maps brain fields to brand-voice.json shape', () => {
  const brain = {
    version: 3,
    positioning: { oneLiner: 'Trusted local dog walking.' },
    voice: {
      toneSummary: 'Warm. Local. Credible. It earns trust through specifics.',
      pillars: [{ name: 'Neighborhood Fluency', description: 'Speak local', do: 'Name the block', dont: 'Sound national' }],
      avoidPatterns: ['white-glove language'],
      bannedWords: ['platform'],
      formattingRules: { short: '1-3 sentences', threadOpener: 'Sharp local observation' },
      scribeInstructions: 'Sound like a trusted local operator.',
      instagramFormatting: { captionLength: 'Under 150 words', ctaStyle: 'Soft' },
      dailyBriefVoice: { role: 'Local advisor', sectionsTone: { weatherImpact: 'Lead with the op takeaway' } },
    },
    content: {
      pillars: [{ type: 'trust_signal', description: 'Why the leash feels safe', pattern: 'Proof first' }],
      postExamples: [{ type: 'trust_signal', label: 'Consistency', post: 'Familiar walker. Clear updates.' }],
    },
  };
  const p = projectBrainToVoiceProfile(brain, 'not-the-rug');
  assert.equal(p.one_liner, 'Trusted local dog walking.');
  assert.equal(p.core_tone, 'Warm.'); // first sentence
  assert.equal(p.scribe_instructions, 'Sound like a trusted local operator.');
  assert.equal(p.voice_pillars[0].do, 'Name the block');
  assert.deepEqual(p.avoid, ['white-glove language', 'platform']); // patterns + banned words merged
  assert.equal(p.formatting_rules.short_posts, '1-3 sentences'); // camel->snake
  assert.equal(p.formatting_rules.thread_opener, 'Sharp local observation');
  assert.equal(p.content_pillars[0].type, 'trust_signal');
  assert.equal(p.few_shot_examples[0].post, 'Familiar walker. Clear updates.');
  assert.equal(p.instagram_formatting.caption_length, 'Under 150 words');
  assert.equal(p.daily_brief_voice.sections_tone.weather_impact, 'Lead with the op takeaway');
});

/* ---- normalizers: legacy/sparse brain coercion ---- */

test('normalizeFormattingRules coerces legacy array and string', () => {
  assert.deepEqual(normalizeFormattingRules(['a', 'b']), { short_posts: 'a b' });
  assert.deepEqual(normalizeFormattingRules('keep it tight'), { short_posts: 'keep it tight' });
  assert.deepEqual(normalizeFormattingRules({}), {});
});

test('normalizeVoicePillars coerces string pillars to objects', () => {
  const out = normalizeVoicePillars(['Be specific']);
  assert.equal(out[0].description, 'Be specific');
  assert.equal(out[0].name, '');
});

test('normalizeContentPillars coerces strings and drops empties', () => {
  const out = normalizeContentPillars(['Trust', { description: 'Local', type: 't' }, '']);
  assert.equal(out.length, 2);
  assert.equal(out[1].type, 't');
});

test('derived scribe_instructions when brain has none', () => {
  const p = projectBrainToVoiceProfile({
    voice: { toneSummary: 'Calm authority.', pillars: [{ do: 'Lead with the useful point' }] },
  }, 'x');
  assert.ok(p.scribe_instructions.includes('Calm authority'));
  assert.ok(p.scribe_instructions.includes('Lead with the useful point'));
});

/* ---- hasVoiceContent gate ---- */

test('hasVoiceContent false for blank brain, true with tone', () => {
  assert.equal(hasVoiceContent({ voice: {} }), false);
  assert.equal(hasVoiceContent({ voice: { toneSummary: 'Warm.' } }), true);
  assert.equal(hasVoiceContent({ voice: { pillars: [{ do: 'x' }] } }), true);
  assert.equal(hasVoiceContent(null), false);
});

/* ---- resolver: brain-first, file-fallback, approval precedence ---- */

const fileVoice = { client: 'not-the-rug', source: 'file', voice_pillars: [], avoid: [], few_shot_examples: [], formatting_rules: {} };
// Stub loadBrandVoice via the injected reader path: resolver uses loadBrandVoice
// for fallback, so we test brain paths with an injected readBrain and rely on
// the real (missing-file -> null) fallback for the negative cases.

test('resolver returns file fallback when no brain', async () => {
  const out = await resolveVoiceProfile('does-not-exist', { readBrain: async () => null });
  // No on-disk file for this fake client -> loadBrandVoice returns null.
  assert.equal(out, null);
});

test('resolver ignores unapproved brain (approval precedence)', async () => {
  const draft = { status: 'draft', version: 1, voice: { toneSummary: 'Draft tone.' } };
  const out = await resolveVoiceProfile('fake-client', { readBrain: async () => draft });
  assert.equal(out, null); // falls back to (missing) file
});

test('resolver projects an approved brain with voice content', async () => {
  const brain = { status: 'approved', version: 5, voice: { toneSummary: 'Approved tone.' } };
  const out = await resolveVoiceProfile('fake-client', { readBrain: async () => brain });
  assert.equal(out.tone_description, 'Approved tone.');
  assert.equal(out.source, 'client_brain:v5');
});

test('resolver falls back when approved brain has no voice content', async () => {
  const brain = { status: 'approved', version: 5, voice: {} };
  const out = await resolveVoiceProfile('fake-client', { readBrain: async () => brain });
  assert.equal(out, null); // blank approved brain must not regress -> file
});

test('resolver never throws on read failure', async () => {
  const out = await resolveVoiceProfile('fake-client', { readBrain: async () => { throw new Error('firestore down'); } });
  assert.equal(out, null);
});
