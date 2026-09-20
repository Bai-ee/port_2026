import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildEmbedSrcdoc, readLivePartLoops,
} from '../edittrax/edittrax-embed.js';

// The real, uncommitted-but-present player template — same fixture Phase 2
// integration will point at. Reading it from disk (rather than a hand-rolled
// snippet) means a template edit that breaks the transform fails this suite
// immediately instead of surfacing later inside the studio panel.
const INDEX_HTML_PATH = fileURLToPath(new URL('../../../../../edittrax_player/index.html', import.meta.url));
const REAL_INDEX_HTML = readFileSync(INDEX_HTML_PATH, 'utf8');

const BASE_HREF = '/edittrax-player/';
const FAKE_CONFIG_SCRIPT = 'const bpm = 128;\nconst parts = [{ file: "audio/seg.1.wav", length: 4, loop: 2 }];';

// ── buildEmbedSrcdoc — against the real template ────────────────────────────

test('buildEmbedSrcdoc: injects <base href> immediately after the opening <head> tag', () => {
  const out = buildEmbedSrcdoc({
    indexHtml: REAL_INDEX_HTML,
    baseHref: BASE_HREF,
    trackConfigScript: FAKE_CONFIG_SCRIPT,
  });
  const headIndex = out.search(/<head(\s[^>]*)?>/i);
  assert.ok(headIndex >= 0, 'output still has a <head> tag');
  const headTagMatch = out.slice(headIndex).match(/<head(\s[^>]*)?>/i);
  const afterHead = out.slice(headIndex + headTagMatch[0].length);
  assert.match(afterHead, new RegExp(`^\\s*<base href="${BASE_HREF.replace(/\//g, '\\/')}">`));
});

test('buildEmbedSrcdoc: replaces <script src="track.js"></script> with an inline config script', () => {
  const out = buildEmbedSrcdoc({
    indexHtml: REAL_INDEX_HTML,
    baseHref: BASE_HREF,
    trackConfigScript: FAKE_CONFIG_SCRIPT,
  });
  assert.ok(!/<script\b[^>]*\bsrc\s*=\s*["']track\.js["']/i.test(out), 'original track.js script tag is gone');
  assert.ok(out.includes(FAKE_CONFIG_SCRIPT), 'generated config script text is present in the output');
  // The inline script must actually be a <script> element (not just text
  // sitting in the document), so the engine's later scripts still see it as
  // executed globals.
  assert.match(out, new RegExp(`<script>\\s*${FAKE_CONFIG_SCRIPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<\\/script>`));
});

test('buildEmbedSrcdoc: the other engine script tags survive untouched', () => {
  const out = buildEmbedSrcdoc({
    indexHtml: REAL_INDEX_HTML,
    baseHref: BASE_HREF,
    trackConfigScript: FAKE_CONFIG_SCRIPT,
  });
  for (const src of ['Tone.js', 'scroll_unlock.js', 'script_unlocked.js']) {
    assert.ok(
      new RegExp(`<script[^>]*src\\s*=\\s*["']${src}["']`, 'i').test(out),
      `${src} script tag still present`,
    );
  }
});

test('buildEmbedSrcdoc: script order is preserved — config script sits before scroll_unlock.js and script_unlocked.js', () => {
  const out = buildEmbedSrcdoc({
    indexHtml: REAL_INDEX_HTML,
    baseHref: BASE_HREF,
    trackConfigScript: FAKE_CONFIG_SCRIPT,
  });
  const configIndex = out.indexOf(FAKE_CONFIG_SCRIPT);
  const scrollUnlockIndex = out.indexOf('scroll_unlock.js');
  const scriptUnlockedIndex = out.indexOf('script_unlocked.js');
  assert.ok(configIndex >= 0 && scrollUnlockIndex >= 0 && scriptUnlockedIndex >= 0);
  assert.ok(configIndex < scrollUnlockIndex, 'config script comes before scroll_unlock.js');
  assert.ok(scrollUnlockIndex < scriptUnlockedIndex, 'scroll_unlock.js comes before script_unlocked.js');
});

// ── buildEmbedSrcdoc — tolerant of whitespace/quote variants ───────────────

test('buildEmbedSrcdoc: tolerates single-quoted / spaced track.js script tag variants', () => {
  const html = "<html><head></head><body><script src='track.js' ></script></body></html>";
  const out = buildEmbedSrcdoc({ indexHtml: html, baseHref: BASE_HREF, trackConfigScript: FAKE_CONFIG_SCRIPT });
  assert.ok(!out.includes("src='track.js'"));
  assert.ok(out.includes(FAKE_CONFIG_SCRIPT));
});

test('buildEmbedSrcdoc: tolerates a <head> tag carrying attributes', () => {
  const html = '<html><head class="x" data-y="1"><title>t</title></head><body><script src="track.js"></script></body></html>';
  const out = buildEmbedSrcdoc({ indexHtml: html, baseHref: BASE_HREF, trackConfigScript: FAKE_CONFIG_SCRIPT });
  assert.match(out, /<head class="x" data-y="1">\s*<base href="\/edittrax-player\/">/);
});

// ── buildEmbedSrcdoc — failure modes ────────────────────────────────────────

test('buildEmbedSrcdoc: throws a descriptive error when indexHtml has no track.js script tag', () => {
  const html = '<html><head></head><body>no player scripts here</body></html>';
  assert.throws(
    () => buildEmbedSrcdoc({ indexHtml: html, baseHref: BASE_HREF, trackConfigScript: FAKE_CONFIG_SCRIPT }),
    /track\.js/i,
  );
});

test('buildEmbedSrcdoc: throws a descriptive error when indexHtml has no <head> tag', () => {
  const html = '<html><body><script src="track.js"></script></body></html>';
  assert.throws(
    () => buildEmbedSrcdoc({ indexHtml: html, baseHref: BASE_HREF, trackConfigScript: FAKE_CONFIG_SCRIPT }),
    /<head>/i,
  );
});

// ── readLivePartLoops ────────────────────────────────────────────────────────

test('readLivePartLoops: reads loop counts off a stubbed same-origin iframe', () => {
  const iframeEl = { contentWindow: { parts: [{ loop: 2 }, { loop: 0 }] } };
  assert.deepEqual(readLivePartLoops(iframeEl), [2, 0]);
});

test('readLivePartLoops: returns null when contentWindow is missing', () => {
  assert.equal(readLivePartLoops({}), null);
  assert.equal(readLivePartLoops(null), null);
  assert.equal(readLivePartLoops(undefined), null);
});

test('readLivePartLoops: returns null when reading contentWindow throws (cross-origin)', () => {
  const iframeEl = {
    get contentWindow() {
      throw new Error('cross-origin frame access denied');
    },
  };
  assert.equal(readLivePartLoops(iframeEl), null);
});

test('readLivePartLoops: returns null for empty parts', () => {
  const iframeEl = { contentWindow: { parts: [] } };
  assert.equal(readLivePartLoops(iframeEl), null);
});

test('readLivePartLoops: returns null when parts is missing entirely', () => {
  const iframeEl = { contentWindow: {} };
  assert.equal(readLivePartLoops(iframeEl), null);
});

test('readLivePartLoops: returns null when a part\'s loop value is not numeric-able', () => {
  const iframeEl = { contentWindow: { parts: [{ loop: 2 }, { loop: 'not-a-number' }] } };
  assert.equal(readLivePartLoops(iframeEl), null);
});
