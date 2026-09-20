import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDraftPrompt, validateDraft, fallbackDraft, SHAPES, HARD_LIMITS } from '../draft.js';

const pkg = (over = {}) => ({
  id: 'p1', series: 'C3', pillar: 'was-there',
  title: 'Housepit, 1998',
  story: 'Booked him for three hundred dollars and he played four hours. The fire marshal turned up at two and we kept going anyway.',
  ...over,
});

test('refuses to draft from an empty or thin story', () => {
  // The refusal that keeps this from producing slop: a model handed no
  // material writes a caption that sounds like a post and says nothing.
  const empty = buildDraftPrompt({ pkg: pkg({ story: '' }), slot: { type: 'original-text' } });
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /story is empty or too thin/);

  const thin = buildDraftPrompt({ pkg: pkg({ story: 'good night' }), slot: { type: 'original-text' } });
  assert.equal(thin.ok, false);
});

test('refuses a series with no measured copy shape', () => {
  const r = buildDraftPrompt({ pkg: pkg({ series: 'C99' }), slot: { type: 'original-text' } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no measured copy shape/);
});

test('the prompt carries the story, the shape and the rules', () => {
  const r = buildDraftPrompt({ pkg: pkg(), slot: { type: 'original-text' }, voice: 'plain, lowercase', trigger: '27 years ago today' });
  assert.equal(r.ok, true);
  assert.match(r.prompt, /fire marshal/, 'the author material is in the prompt');
  assert.match(r.prompt, /27 years ago today/, 'the occasion is in the prompt');
  assert.match(r.prompt, /No hashtags/);
  assert.match(r.prompt, /assembling, not inventing/);
  assert.match(r.prompt, /plain, lowercase/);
});

test('validateDraft enforces the mechanical rules', () => {
  assert.equal(validateDraft('a clean short post', { series: 'C7' }).ok, true);

  const hash = validateDraft('great night #housemusic', { series: 'C3' });
  assert.ok(hash.violations.some((v) => /hashtag/.test(v)));

  const link = validateDraft('check it https://example.com now', { series: 'C3' });
  assert.ok(link.violations.some((v) => /inline link/.test(v)));

  const long = validateDraft('x'.repeat(HARD_LIMITS.maxChars + 1), { series: 'C7' });
  assert.ok(long.violations.some((v) => /over 280 chars/.test(v)));

  const bait = validateDraft('rt if you remember this', { series: 'C7' });
  assert.ok(bait.violations.some((v) => /engagement bait/.test(v)));
});

test('a trailing quote-tweet URL is exempt, a mid-text link is not', () => {
  // That trailing URL is how X composes a quote tweet — flagging it would
  // make every quote-react unpostable.
  const quote = validateDraft('unreal https://x.com/someone/status/12345', { series: 'C8', slotType: 'quote-react' });
  assert.equal(quote.ok, true, quote.violations.join(', '));

  const mid = validateDraft('see https://x.com/someone/status/12345 for this', { series: 'C8', slotType: 'quote-react' });
  assert.ok(mid.violations.some((v) => /inline link/.test(v)));
});

test('a quote caption over 90 chars is flagged as commentary', () => {
  const long = validateDraft('x'.repeat(95), { series: 'C8', slotType: 'quote-react' });
  assert.ok(long.violations.some((v) => /quote caption over 90/.test(v)));
});

test('every series has a measured shape inside the hard cap', () => {
  for (const [id, shape] of Object.entries(SHAPES)) {
    assert.ok(shape.structure, `${id} has a structure`);
    assert.ok(shape.maxChars <= HARD_LIMITS.maxChars, `${id} shape fits inside 280`);
  }
});

test('the fallback truncates the author rather than paraphrasing', () => {
  const out = fallbackDraft({ pkg: pkg() });
  assert.ok(out.startsWith('Booked him for three hundred dollars'));
  assert.ok(out.length <= SHAPES.C3.maxChars);
});
