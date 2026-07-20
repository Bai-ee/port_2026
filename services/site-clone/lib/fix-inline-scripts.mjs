// fix-inline-scripts.mjs — A5: the BeautifulSoup port's serialization gotcha,
// carried over defensively. A trailing `<script src="…">` tag can get
// absorbed as literal text inside the preceding inline script during
// re-serialization, which the browser then chokes on
// (`Uncaught SyntaxError: Unexpected identifier`). Truncate any inline
// script's text at the first embedded "<script" occurrence.

import { load } from 'cheerio';

export function fixInlineScripts({ pages }) {
  const fixed = pages.map((pg) => {
    const $ = load(pg.html);
    $('script:not([src])').each((_, el) => {
      const text = $(el).html();
      if (!text) return;
      const idx = text.indexOf('<script');
      if (idx > -1) $(el).html(text.slice(0, idx));
    });
    return { ...pg, html: $.html() };
  });
  return { pages: fixed };
}
