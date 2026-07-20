import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripScripts } from '../lib/strip.mjs';

const PROFILE = { commerceKilllist: ['trekkie', 'monorail'] };

test('stripScripts removes scripts whose src matches the killlist', () => {
  const pages = [{ path: '/', html: '<script src="assets/cdn.shopify.com/trekkie.js"></script><script src="assets/cdn.shopify.com/theme.js"></script>' }];
  const { pages: out } = stripScripts({ pages, profile: PROFILE, assets: [] });
  assert.doesNotMatch(out[0].html, /trekkie/);
  assert.match(out[0].html, /theme\.js/, 'non-killlist theme script survives');
});

test('stripScripts removes scripts whose inline body matches the killlist', () => {
  const pages = [{ path: '/', html: '<script>window.monorail.track();</script><script>console.log("keep me");</script>' }];
  const { pages: out } = stripScripts({ pages, profile: PROFILE, assets: [] });
  assert.doesNotMatch(out[0].html, /monorail/);
  assert.match(out[0].html, /keep me/);
});

test('stripScripts prunes tags referencing an asset that failed to download', () => {
  const pages = [{ path: '/', html: '<link href="assets/x.com/gsap.min.css"><script src="assets/x.com/gsap.js"></script>' }];
  const assets = [
    { localPath: 'assets/x.com/gsap.min.css', bytes: 0 },
    { localPath: 'assets/x.com/gsap.js', bytes: 0 },
  ];
  const { pages: out } = stripScripts({ pages, profile: PROFILE, assets });
  assert.doesNotMatch(out[0].html, /gsap/);
});
