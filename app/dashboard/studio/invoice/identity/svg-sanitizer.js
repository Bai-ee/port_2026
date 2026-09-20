// Invoice Studio design-layer plan Q2, Lane B — SVG logo sanitizer (L10).
//
// Logo upload happens entirely client-side (public tool, no server call —
// see the design-layer plan's non-negotiable constraints), so this module
// has no npm dependency and does its DOM work with the browser's native
// DOMParser/XMLSerializer instead. This repo's `node --test` runner has no
// DOM (same constraint Q1's useInvoiceBridge hit — see that lane's test
// file header), so the file is split in two, per the handoff's own
// instruction:
//
//   (a) POLICY layer — pure string/allow-list functions with no DOM
//       dependency at all. Directly unit-testable with node --test; see
//       __tests__/svg-sanitizer.test.js.
//   (b) DRIVER — sanitizeSvgMarkup(), which parses/walks/checks a real DOM
//       via DOMParser. Verified by hand in a real browser (see this lane's
//       handoff report), not by an automated test.
//
// Contract (L10, strict — REJECT, not strip): an SVG that contains anything
// disallowed is rejected outright with a reason string. On success, the
// ORIGINAL accepted bytes are returned unchanged ("preserve accepted raw
// bytes" — the handoff's own wording) rather than a re-serialized/stripped
// copy, so there is never a silent "we removed the bad part and kept the
// rest" path that could look clean while still carrying something the
// operator didn't expect.
//
// Disallowed, unconditionally:
//   - Any element tag not on the ALLOWED_SVG_TAGS allow-list. This is what
//     blocks <script>, <foreignObject>, <iframe>, <embed>, <object>,
//     embedded HTML (<html>/<body>), and embedded MathML — an allow-list
//     rejects anything unrecognized by construction, rather than trying to
//     enumerate every dangerous tag name.
//   - Any `on*` event-handler attribute (onload, onclick, ...).
//   - Any `href` / `xlink:href` / `src` value that is not a `#fragment` or
//     an already-inline `data:` URI (blocks http(s)://, //host, relative
//     paths, javascript:, etc.).
//   - Any external `url(...)` reference inside a `style` attribute or a
//     `<style>` element's CSS text (same fragment/data: allow-list), and
//     any `@import` inside a `<style>` element (an @import is external by
//     construction in this context).

// ── (a) Policy layer — pure, no DOM ─────────────────────────────────────

// Conservative allow-list of standard, inert SVG presentation/structure
// elements. Lower-cased on both sides of every comparison — DOMParser keeps
// case for an XML document (unlike an HTML document, which upper-cases
// everything), so tag names like `linearGradient`/`clipPath`/`feGaussianBlur`
// must be compared case-insensitively rather than assumed already-lowercase.
export const ALLOWED_SVG_TAGS = new Set([
  'svg', 'g', 'a', 'defs', 'symbol', 'use', 'switch',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath',
  'clippath', 'mask', 'pattern', 'marker',
  'lineargradient', 'radialgradient', 'stop',
  'filter', 'fegaussianblur', 'feoffset', 'femerge', 'femergenode',
  'fecolormatrix', 'feblend', 'fecomposite', 'feflood', 'fetile',
  'feturbulence', 'fedisplacementmap', 'fedropshadow', 'femorphology',
  'feconvolvematrix', 'fediffuselighting', 'fespecularlighting',
  'fedistantlight', 'fepointlight', 'fespotlight', 'feimage',
  'image', 'style', 'title', 'desc',
]);

export function isAllowedSvgTag(tagName) {
  return ALLOWED_SVG_TAGS.has(String(tagName ?? '').toLowerCase());
}

export function isEventHandlerAttrName(name) {
  return /^on/i.test(String(name ?? ''));
}

const RESOURCE_ATTR_NAMES = new Set(['href', 'xlink:href', 'src']);
export function isResourceAttrName(name) {
  return RESOURCE_ATTR_NAMES.has(String(name ?? '').toLowerCase());
}

// A resource reference is safe only when it stays entirely inside the file
// (a same-document #fragment, e.g. a gradient/clip-path reference) or is
// already an inline data: URI — never a network fetch of any kind.
export function isSafeResourceUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return true; // empty/absent — nothing to fetch, not a violation
  if (trimmed.startsWith('#')) return true;
  if (/^data:/i.test(trimmed)) return true;
  return false;
}

// Pulls every `url(...)` reference out of a CSS string (a style attribute's
// value or a <style> element's text content).
export function extractCssUrls(cssText) {
  const text = String(cssText ?? '');
  const urls = [];
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let match = re.exec(text);
  while (match) {
    urls.push(match[2]);
    match = re.exec(text);
  }
  return urls;
}

export function cssHasUnsafeUrl(cssText) {
  return extractCssUrls(cssText).some((url) => !isSafeResourceUrl(url));
}

export function cssHasImport(cssText) {
  return /@import\b/i.test(String(cssText ?? ''));
}

// ── (b) DOM-walking driver ───────────────────────────────────────────────
// Browser-only. Returns { ok: true, svgText } (the untouched original text)
// on success, or { ok: false, reason } naming exactly what was rejected —
// LogoControl.jsx surfaces `reason` verbatim as the inline upload error.
export function sanitizeSvgMarkup(rawSvgText) {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return { ok: false, reason: 'SVG sanitization requires a browser environment.' };
  }
  const text = String(rawSvgText ?? '');
  if (!text.trim()) return { ok: false, reason: 'The file is empty.' };

  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch {
    return { ok: false, reason: 'Could not parse the file as XML/SVG.' };
  }
  if (doc.querySelector('parsererror')) {
    return { ok: false, reason: 'Malformed SVG (XML parse error).' };
  }
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return { ok: false, reason: 'File is not an SVG document.' };
  }

  const allElements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    if (!isAllowedSvgTag(tag)) {
      return { ok: false, reason: `Disallowed element: <${tag}>` };
    }
    for (const attr of Array.from(el.attributes || [])) {
      if (isEventHandlerAttrName(attr.name)) {
        return { ok: false, reason: `Disallowed event-handler attribute: ${attr.name}` };
      }
      if (isResourceAttrName(attr.name) && !isSafeResourceUrl(attr.value)) {
        return { ok: false, reason: `Disallowed external reference: ${attr.name}="${attr.value}"` };
      }
      if (attr.name.toLowerCase() === 'style' && cssHasUnsafeUrl(attr.value)) {
        return { ok: false, reason: 'Disallowed external CSS url() reference in a style attribute.' };
      }
    }
    if (tag === 'style') {
      const cssText = el.textContent || '';
      if (cssHasImport(cssText)) {
        return { ok: false, reason: 'Disallowed @import inside a <style> element.' };
      }
      if (cssHasUnsafeUrl(cssText)) {
        return { ok: false, reason: 'Disallowed external CSS url() reference inside a <style> element.' };
      }
    }
  }

  return { ok: true, svgText: text };
}

// Base64-encodes accepted SVG text into the same data: URL shape
// model.js's LOGO_DATA_URL_RE expects (`data:image/svg+xml;base64,...`).
// `unescape(encodeURIComponent(...))` is the standard browser idiom for
// getting a UTF-8 string into btoa(), which only accepts Latin1 bytes.
export function svgTextToDataUrl(svgText) {
  const text = String(svgText ?? '');
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(text)))}`;
  }
  // Non-browser fallback (e.g. a future server-side caller) — not exercised
  // by the public client path, which always has window.btoa.
  return `data:image/svg+xml;base64,${Buffer.from(text, 'utf8').toString('base64')}`;
}

export default sanitizeSvgMarkup;
