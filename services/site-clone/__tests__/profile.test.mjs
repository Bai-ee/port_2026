import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfiles, detectPlatform, resolveAssetHosts, hostAllowed } from '../lib/profile.mjs';

test('loadProfiles loads all four platform profiles', async () => {
  const profiles = await loadProfiles();
  assert.deepEqual(Object.keys(profiles).sort(), ['generic', 'shopify', 'squarespace', 'wix']);
  assert.equal(profiles.shopify.renderMode, 'static');
  assert.equal(profiles.generic.renderMode, 'rendered');
});

test('detectPlatform matches Shopify markers', async () => {
  const profiles = await loadProfiles();
  const html = '<script>window.Shopify.theme = {"name":"Crave"};</script><link href="https://cdn.shopify.com/x.css">';
  const detected = detectPlatform(html, profiles);
  assert.equal(detected.platform, 'shopify');
});

test('detectPlatform falls back to generic when nothing matches', async () => {
  const profiles = await loadProfiles();
  const detected = detectPlatform('<html><body>plain site</body></html>', profiles);
  assert.equal(detected.platform, 'generic');
});

test('resolveAssetHosts substitutes the {origin} placeholder', () => {
  const resolved = resolveAssetHosts(['{origin}', 'cdn.shopify.com', 'fonts.g*'], 'rositas.com');
  assert.deepEqual(resolved, ['rositas.com', 'cdn.shopify.com', 'fonts.g*']);
});

test('hostAllowed matches exact hosts and trailing-wildcard prefixes', () => {
  const hosts = ['rositas.com', 'fonts.g*'];
  assert.equal(hostAllowed('rositas.com', hosts), true);
  assert.equal(hostAllowed('ROSITAS.COM', hosts), true, 'case-insensitive');
  assert.equal(hostAllowed('fonts.gstatic.com', hosts), true, 'wildcard prefix match');
  assert.equal(hostAllowed('evil.com', hosts), false);
});
