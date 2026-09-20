// Invoice Studio design-layer plan Q2, Lane B — svg-sanitizer.js's POLICY
// layer (pure, no DOM). The DOM-walking driver (sanitizeSvgMarkup, which
// needs DOMParser) is NOT exercised here — this repo's node:test runner has
// no DOM (see draft-storage.test.js / useInvoiceBridge.test.js for the same
// constraint) — it is verified by hand in a real browser instead; see this
// lane's handoff report for that manual pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedSvgTag, isEventHandlerAttrName, isResourceAttrName, isSafeResourceUrl,
  extractCssUrls, cssHasUnsafeUrl, cssHasImport, ALLOWED_SVG_TAGS,
} from '../svg-sanitizer.js';

test('isAllowedSvgTag: common presentation elements allowed, case-insensitive', () => {
  assert.equal(isAllowedSvgTag('svg'), true);
  assert.equal(isAllowedSvgTag('path'), true);
  assert.equal(isAllowedSvgTag('G'), true);
  assert.equal(isAllowedSvgTag('linearGradient'), true);
  assert.equal(isAllowedSvgTag('clipPath'), true);
  assert.equal(isAllowedSvgTag('feGaussianBlur'), true);
});

test('isAllowedSvgTag: rejects script/active/foreign-content elements', () => {
  assert.equal(isAllowedSvgTag('script'), false);
  assert.equal(isAllowedSvgTag('foreignObject'), false);
  assert.equal(isAllowedSvgTag('iframe'), false);
  assert.equal(isAllowedSvgTag('embed'), false);
  assert.equal(isAllowedSvgTag('object'), false);
  assert.equal(isAllowedSvgTag('html'), false);
  assert.equal(isAllowedSvgTag('body'), false);
  assert.equal(isAllowedSvgTag('math'), false);
  assert.equal(isAllowedSvgTag('animate'), false); // not on the allow-list either
});

test('ALLOWED_SVG_TAGS never includes an active-content tag by accident', () => {
  for (const bad of ['script', 'foreignobject', 'iframe', 'embed', 'object', 'html', 'body', 'form', 'link', 'meta']) {
    assert.equal(ALLOWED_SVG_TAGS.has(bad), false, `${bad} must not be allow-listed`);
  }
});

test('isEventHandlerAttrName matches any on* attribute, case-insensitive', () => {
  assert.equal(isEventHandlerAttrName('onload'), true);
  assert.equal(isEventHandlerAttrName('onclick'), true);
  assert.equal(isEventHandlerAttrName('OnMouseOver'), true);
  assert.equal(isEventHandlerAttrName('fill'), false);
  assert.equal(isEventHandlerAttrName('opacity'), false);
});

test('isResourceAttrName matches href/xlink:href/src only', () => {
  assert.equal(isResourceAttrName('href'), true);
  assert.equal(isResourceAttrName('xlink:href'), true);
  assert.equal(isResourceAttrName('src'), true);
  assert.equal(isResourceAttrName('HREF'), true);
  assert.equal(isResourceAttrName('fill'), false);
});

test('isSafeResourceUrl: fragment and data: URIs are safe, everything else is not', () => {
  assert.equal(isSafeResourceUrl('#gradient-1'), true);
  assert.equal(isSafeResourceUrl('data:image/png;base64,aGVsbG8='), true);
  assert.equal(isSafeResourceUrl(''), true); // absent — nothing to fetch
  assert.equal(isSafeResourceUrl('https://evil.example/x.png'), false);
  assert.equal(isSafeResourceUrl('//evil.example/x.png'), false);
  assert.equal(isSafeResourceUrl('javascript:alert(1)'), false);
  assert.equal(isSafeResourceUrl('/relative/path.svg'), false);
});

test('extractCssUrls pulls every url(...) reference out of a CSS string', () => {
  const css = `.a { fill: url(#grad1); background: url("https://evil.example/x.png"); }`;
  assert.deepEqual(extractCssUrls(css), ['#grad1', 'https://evil.example/x.png']);
  assert.deepEqual(extractCssUrls(''), []);
});

test('cssHasUnsafeUrl: true only when an extracted url() is not fragment/data:', () => {
  assert.equal(cssHasUnsafeUrl('.a { fill: url(#grad1); }'), false);
  assert.equal(cssHasUnsafeUrl(`.a { background: url('data:image/png;base64,aGk='); }`), false);
  assert.equal(cssHasUnsafeUrl('.a { background: url(https://evil.example/x.png); }'), true);
  assert.equal(cssHasUnsafeUrl(''), false);
});

test('cssHasImport: true whenever an @import appears', () => {
  assert.equal(cssHasImport('@import url(https://evil.example/x.css);'), true);
  assert.equal(cssHasImport('.a { color: red; }'), false);
});
