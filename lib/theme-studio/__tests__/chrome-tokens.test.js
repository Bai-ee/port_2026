import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio } from '../../theme/index.js';
import { STUDIO_CHROME_TOKENS, STUDIO_CHROME_PAIRS } from '../chrome-tokens.js';

test('contract 11.3 tokens exist with the specified values', () => {
  const expected = {
    '--ts-bg': '#ffffff', '--ts-fg': '#1a1a1a', '--ts-muted': '#5a5a5a', '--ts-line': '#c8c8c8',
    '--ts-accent': '#0b5cd5', '--ts-on-accent': '#ffffff', '--ts-danger': '#b00020', '--ts-ok': '#17692e', '--ts-focus': '#0b5cd5',
  };
  for (const [k, v] of Object.entries(expected)) assert.equal(STUDIO_CHROME_TOKENS[k], v, k);
});

test('every chrome text pair meets 4.5:1 and every non-text pair 3:1', () => {
  for (const [fg, bg, min, why] of STUDIO_CHROME_PAIRS) {
    const r = contrastRatio(STUDIO_CHROME_TOKENS[fg], STUDIO_CHROME_TOKENS[bg]);
    assert.ok(r >= min, `${why}: ${fg} on ${bg} is ${r.toFixed(2)}, needs ${min}`);
  }
});

test('contract text tokens are all at least 4.5:1 on --ts-bg', () => {
  for (const k of ['--ts-fg', '--ts-muted', '--ts-accent', '--ts-danger', '--ts-ok']) {
    assert.ok(contrastRatio(STUDIO_CHROME_TOKENS[k], STUDIO_CHROME_TOKENS['--ts-bg']) >= 4.5, k);
  }
  assert.ok(contrastRatio(STUDIO_CHROME_TOKENS['--ts-on-accent'], STUDIO_CHROME_TOKENS['--ts-accent']) >= 4.5);
  assert.ok(contrastRatio(STUDIO_CHROME_TOKENS['--ts-focus'], STUDIO_CHROME_TOKENS['--ts-bg']) >= 3);
});
