// playwrightFetch.js — Dual-fetch via playwright for JS-dependency scoring.
//
// playwright is an optionalDependency. The dynamic import lives inside the
// function body so the module always loads cleanly when playwright is absent.
//
// Public API:
//   dualFetch({ url, signal }) → { score, jsDepWords, wordsOff, wordsOn, fallback }
//   Throws Error('playwright-unavailable') when playwright is not installed.

export async function dualFetch({ url, signal }) {
  let chromium;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    throw new Error('playwright-unavailable');
  }

  const browser = await chromium.launch({ headless: true });

  try {
    // JS-off fetch
    const ctxOff = await browser.newContext({ javaScriptEnabled: false });
    const pageOff = await ctxOff.newPage();
    await pageOff.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
    const textOff = await pageOff.innerText('body').catch(() => '');
    await ctxOff.close();

    // JS-on fetch
    const ctxOn = await browser.newContext({ javaScriptEnabled: true });
    const pageOn = await ctxOn.newPage();
    await pageOn.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
    const textOn = await pageOn.innerText('body').catch(() => '');
    await ctxOn.close();

    const wordsOff   = textOff.trim().split(/\s+/).filter(Boolean).length;
    const wordsOn    = textOn.trim().split(/\s+/).filter(Boolean).length;
    const jsDepWords = Math.max(0, wordsOn - wordsOff);

    let score;
    if      (jsDepWords < 50)  score = 100; // mostly SSR
    else if (jsDepWords < 200) score = 70;  // hybrid
    else if (jsDepWords < 500) score = 40;  // heavy hydration
    else                        score = 10;  // SPA

    return { score, jsDepWords, wordsOff, wordsOn, fallback: false };
  } finally {
    await browser.close();
  }
}
