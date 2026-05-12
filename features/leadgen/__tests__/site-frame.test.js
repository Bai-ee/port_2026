import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSiteFrame,
  normalizeGeneratedBody,
  validateFramedHtml,
  validateGeneratedBody,
} from '../site-frame.js';

test('normalizeGeneratedBody extracts legacy full HTML body and style', () => {
  const raw = `<!DOCTYPE html>
<html>
<head><title>Old</title><script src="https://cdn.tailwindcss.com"></script></head>
<body>
  <style>.hero { min-height: 100vh; }</style>
  <main>
    <section data-gsap="fadeUp"><h1 data-animate>Acme</h1></section>
    <script src="gsap-kit.js" defer></script>
  </main>
</body>
</html>`;

  const normalized = normalizeGeneratedBody(raw);

  assert.match(normalized.bodyHtml, /<main\b/);
  assert.match(normalized.bodyHtml, /data-gsap="fadeUp"/);
  assert.doesNotMatch(normalized.bodyHtml, /<html|<head|<body|cdn\.tailwindcss|gsap-kit\.js/i);
  assert.match(normalized.styleHtml, /min-height/);
  assert.ok(normalized.warnings.includes('Extracted body from full HTML output'));
});

test('buildSiteFrame creates deterministic shell with managed scripts and metadata', () => {
  const { html } = buildSiteFrame({
    bodyHtml: '<main id="main"><section data-gsap="fadeUp"><h1 data-animate>Acme Plumbing</h1></section></main>',
    contentJson: {
      copy: {
        businessName: 'Acme Plumbing',
        heroSubheadline: 'Emergency plumbing in Chicago.',
        contactInfo: {
          phone: '312-555-0100',
          address: '123 Main St, Chicago, IL',
        },
        serviceNames: ['Drain cleaning', 'Water heater repair'],
      },
      url: 'https://acme.example',
    },
  });

  assert.equal(validateFramedHtml(html).length, 0);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /cdn\.tailwindcss\.com/);
  assert.match(html, /gsap-kit\.js/);
  assert.ok(html.indexOf('tailwind.config') < html.indexOf('cdn.tailwindcss.com'));
});

test('validateGeneratedBody rejects document tags before wrapping', () => {
  const issues = validateGeneratedBody('<html><body><section></section></body></html>');
  assert.ok(issues.includes('Generated body contains html/head/body tags'));
  assert.ok(issues.includes('Missing <main>'));
});
