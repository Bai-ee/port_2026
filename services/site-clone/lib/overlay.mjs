// overlay.mjs — exact-mirror CMS overlay (Phase 5 v2). Instead of rebuilding a
// frontend, the mirrored HTML itself becomes the template: every editable text
// node and image is replaced with a {{slot:…}} token and recorded as a slot
// (key, kind, original value). Payload stores the slot values; the CMS render
// route re-injects them into the template at request time. The theme — CSS,
// scripts, layout, fonts — ships byte-identical, so the editable site looks
// EXACTLY like the mirror.
//
// Also rewrites, at tokenize time (deterministic, not per-request):
//   - root-relative asset refs:  assets/…  ->  /assets/…   (pages are served
//     from clean routes like /menu-2, so relative refs would 404)
//   - internal page links:  pages-menu-2.html  ->  /menu-2,  index.html -> /
//
// Slot rules: an element becomes a text slot only when it has NO child
// elements (pure text leaf) — anything with inline markup stays untouched
// rather than risk breaking the theme. Every <img src> becomes an image slot;
// its srcset gets a paired {{slotset:…}} so an admin-uploaded replacement can
// disable the original responsive set.

import { load } from 'cheerio';
import path from 'path';
import { readdir, readFile } from 'fs/promises';

const TEXT_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'span', 'a', 'button',
  'figcaption', 'blockquote', 'dt', 'dd', 'th', 'td', 'summary', 'label', 'title',
]);
const MAX_SLOTS_PER_PAGE = 600;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function pageSlug(file) {
  const base = path.basename(file, '.html');
  if (base === 'index') return 'home';
  return base.replace(/^pages-/, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
}

function rewriteAssetRefs($, fileToSlug) {
  const fixPath = (v) => {
    if (!v) return v;
    if (v.startsWith('assets/')) return `/${v}`;
    const base = v.split('#')[0].split('?')[0];
    if (fileToSlug.has(base)) {
      const slug = fileToSlug.get(base);
      return slug === 'home' ? '/' : `/${slug}`;
    }
    return v;
  };
  $('[src], [href], [poster]').each((_, el) => {
    for (const attr of ['src', 'href', 'poster']) {
      const v = $(el).attr(attr);
      if (v != null) $(el).attr(attr, fixPath(v));
    }
  });
  $('[srcset]').each((_, el) => {
    const v = $(el).attr('srcset');
    if (!v) return;
    $(el).attr('srcset', v.split(',').map((part) => {
      const [url, ...desc] = part.trim().split(/\s+/);
      return [url.startsWith('assets/') ? `/${url}` : url, ...desc].join(' ');
    }).join(', '));
  });
  // Inline style url(assets/…) — both style attributes and <style> blocks.
  const fixCss = (css) => css.replace(/url\(\s*(['"]?)assets\//g, 'url($1/assets/');
  $('[style]').each((_, el) => { $(el).attr('style', fixCss($(el).attr('style'))); });
  $('style').each((_, el) => {
    const css = $(el).html();
    if (css && css.includes('assets/')) $(el).html(fixCss(css));
  });
}

function tokenizePage({ html, slug, fileToSlug }) {
  const $ = load(html);
  rewriteAssetRefs($, fileToSlug);

  const slots = [];
  const addSlot = (kind, value, label, extra = {}) => {
    const key = `${slug}-${slots.length}`;
    slots.push({ key, kind, value, label, ...extra });
    return key;
  };

  // Style hook: the element's style attribute becomes a per-slot token so the
  // CMS can inject visual overrides (hide, size, fit, font, color) without
  // touching the theme. The original inline style is preserved as baseStyle
  // and re-emitted first at render time.
  const addStyleHook = ($el, key, slot) => {
    slot.baseStyle = $el.attr('style') || '';
    $el.attr('style', `{{slotstyle:${key}}}`);
  };

  // Text slots — pure-text leaf elements only.
  $('body *, head > title').each((_, el) => {
    if (slots.length >= MAX_SLOTS_PER_PAGE) return false;
    const tag = (el.tagName || el.name || '').toLowerCase();
    if (!TEXT_TAGS.has(tag)) return;
    const $el = $(el);
    if ($el.children().length) return;
    if ($el.closest('script, style, noscript').length) return;
    const text = clean($el.text());
    if (!text || text.length < 2 || text.includes('{{')) return;
    const key = addSlot('text', text, `${tag}: ${text.slice(0, 60)}`);
    $el.text(`{{slot:${key}}}`);
    if (tag !== 'title') addStyleHook($el, key, slots[slots.length - 1]);
  });

  // Image slots — every local <img>, src + paired srcset token.
  $('img').each((_, el) => {
    if (slots.length >= MAX_SLOTS_PER_PAGE) return false;
    const $el = $(el);
    const src = $el.attr('src') || '';
    if (!src.startsWith('/assets/')) return;
    const name = path.basename(src.split('?')[0]);
    const srcset = $el.attr('srcset') || '';
    const key = addSlot('image', src, `image: ${name}`, srcset ? { srcset } : {});
    $el.attr('src', `{{slot:${key}}}`);
    if (srcset) $el.attr('srcset', `{{slotset:${key}}}`);
    addStyleHook($el, key, slots[slots.length - 1]);
  });

  const title = clean($('h1').first().text().replace(/{{slot:[^}]+}}/g, '')) // h1 may hold multiple tokens — strip ALL
    || slots.find((s) => s.label.startsWith('h1:'))?.value
    || slots.find((s) => s.label.startsWith('title:'))?.value
    || slug;

  return { slug, title, slots, html: $.html() };
}

/**
 * Tokenize every mirrored page into an exact-theme template + slot list.
 *
 * @param {object} args
 * @param {string} args.siteDir
 * @param {(line:string)=>void} [args.log]
 * @returns {Promise<Array<{slug, title, file, sourceFile, slots, html}>>}
 */
export async function tokenizeSite({ siteDir, log = () => {} }) {
  const entries = await readdir(siteDir);
  const htmlFiles = entries.filter((f) => f.endsWith('.html')).sort((a, b) =>
    a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b));
  if (!htmlFiles.length) throw new Error(`No .html pages found in ${siteDir}`);
  const fileToSlug = new Map(htmlFiles.map((f) => [f, pageSlug(f)]));

  const pages = [];
  for (const file of htmlFiles) {
    const html = await readFile(path.join(siteDir, file), 'utf8');
    const tokenized = tokenizePage({ html, slug: fileToSlug.get(file), fileToSlug });
    pages.push({ ...tokenized, file, sourceFile: file });
    log(`overlay: ${file} -> /${tokenized.slug === 'home' ? '' : tokenized.slug} (${tokenized.slots.length} editable slots)`);
  }
  return pages;
}
