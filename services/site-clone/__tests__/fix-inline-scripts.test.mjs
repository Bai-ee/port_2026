import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixInlineScripts } from '../lib/fix-inline-scripts.mjs';

test('fixInlineScripts truncates an embedded trailing <script tag artifact', () => {
  const pages = [{
    path: '/',
    html: '<script>window.config = {a:1};</script src="https://cdn.shopify.com/theme.js"></script>',
  }];
  const { pages: out } = fixInlineScripts({ pages });
  assert.doesNotMatch(out[0].html, /theme\.js/);
  assert.match(out[0].html, /window\.config = \{a:1\};/);
});

test('fixInlineScripts leaves a clean inline script untouched', () => {
  const pages = [{ path: '/', html: '<script>console.log("fine");</script>' }];
  const { pages: out } = fixInlineScripts({ pages });
  assert.match(out[0].html, /console\.log\("fine"\);/);
});
