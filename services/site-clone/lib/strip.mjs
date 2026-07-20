// strip.mjs — A4: decompose <script>/<link> tags matching the platform
// killlist (analytics/wallet/phone-home identifiers — narrow substrings, so
// this never touches the mirrored theme bundle itself), plus prune any tag
// referencing an asset that failed to download or came back empty. That
// second rule generalizes the runbook's one-off "0-byte theme gsap.js" fix
// instead of hardcoding that filename.

import { load } from 'cheerio';

/**
 * @param {object} args
 * @param {Array<{path:string, file:string, html:string}>} args.pages
 * @param {object} args.profile
 * @param {Array<{localPath:string, bytes:number}>} args.assets
 */
export function stripScripts({ pages, profile, assets }) {
  const killlist = profile.commerceKilllist || [];
  const failedLocalPaths = new Set((assets || []).filter((a) => !a.bytes).map((a) => a.localPath));

  const stripped = pages.map((pg) => {
    const $ = load(pg.html);

    $('script').each((_, el) => {
      const src = $(el).attr('src') || '';
      const text = $(el).html() || '';
      if (killlist.some((k) => src.includes(k) || text.includes(k))) {
        $(el).remove();
        return;
      }
      if (src && failedLocalPaths.has(src)) $(el).remove();
    });

    $('link').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href && failedLocalPaths.has(href)) $(el).remove();
    });

    return { ...pg, html: $.html() };
  });

  return { pages: stripped };
}
