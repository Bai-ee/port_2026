// finalize.mjs — A3: rewrite internal <a href> to local filenames, neutralize
// commerce hrefs/forms/buttons (href="#" + data-localized marker), leave
// external links untouched.

import { load } from 'cheerio';

/** '/' -> 'index.html'; '/pages/menu-2' -> 'pages-menu-2.html'; unknown internal -> handled by caller. */
export function pathToFilename(p) {
  if (!p || p === '/') return 'index.html';
  const trimmed = p.replace(/^\/+|\/+$/g, '');
  const stripped = trimmed.replace(/\.[a-z0-9]+$/i, '');
  const slug = stripped.replace(/\//g, '-').replace(/[^a-z0-9-_]/gi, '-');
  return `${slug || 'page'}.html`;
}

/**
 * @param {object} args
 * @param {Array<{path:string, html:string}>} args.pages
 * @param {string} args.origin
 * @param {object} args.profile
 * @returns {{ pages: Array<{path:string, file:string, html:string}>, pathToLocal: Map<string,string> }}
 */
export function finalizeLinks({ pages, origin, profile }) {
  const pathToLocal = new Map(pages.map((pg) => [pg.path, pathToFilename(pg.path)]));
  const commercePatterns = profile.commerceHrefPatterns || [];
  const isCommercePath = (p) => commercePatterns.some((pat) => p.includes(pat));

  const finalized = pages.map((pg) => {
    const $ = load(pg.html);
    const pageUrl = origin + pg.path;

    $('a[href]').each((_, el) => {
      const raw = $(el).attr('href');
      if (!raw || raw.startsWith('#')) return;
      let abs;
      try { abs = new URL(raw, pageUrl); } catch { return; }
      if (abs.origin !== origin) return; // external — left intact

      if (isCommercePath(abs.pathname)) {
        $(el).attr('href', '#');
        $(el).attr('data-localized', 'true');
        return;
      }
      $(el).attr('href', pathToLocal.get(abs.pathname) || 'index.html');
    });

    $('form').each((_, el) => {
      const action = $(el).attr('action') || '';
      let actionPath = action;
      try { actionPath = new URL(action, pageUrl).pathname; } catch { /* relative/empty action */ }
      if (!isCommercePath(actionPath)) return;
      $(el).attr('action', '#');
      $(el).attr('onsubmit', 'return false');
      $(el).find('button[type="submit"], button:not([type]), input[type="submit"]').each((__, btn) => {
        $(btn).attr('type', 'button');
        $(btn).attr('onclick', 'return false');
      });
    });

    // Shopify's literal add-to-cart button name — harmless no-op on other platforms.
    $('button[name="add"]').each((_, el) => {
      $(el).attr('type', 'button');
      $(el).attr('onclick', 'return false');
    });

    return { ...pg, file: pathToLocal.get(pg.path), html: $.html() };
  });

  return { pages: finalized, pathToLocal };
}
