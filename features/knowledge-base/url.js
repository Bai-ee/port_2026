import * as cheerio from 'cheerio';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const { validateUrl: _ssrfValidate } = _require('../../api/_lib/safe-fetch.cjs');

const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_CHARS = 1_500_000;

export function normalizeKnowledgeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    const err = new Error('Enter a valid URL.');
    err.status = 400;
    throw err;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const err = new Error('Only http and https URLs are supported.');
    err.status = 400;
    throw err;
  }

  parsed.hash = '';
  return parsed.toString();
}

export async function fetchUrlHtml(url) {
  const normalizedUrl = normalizeKnowledgeUrl(url);

  // SSRF guard: reject private/internal URLs
  try {
    await _ssrfValidate(normalizedUrl);
  } catch (ssrfErr) {
    const err = new Error('URL not allowed.');
    err.status = 400;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'BballiPortfolioKnowledgeBase/1.0',
      },
    });

    if (!res.ok) {
      const err = new Error(`URL fetch failed with HTTP ${res.status}.`);
      err.status = 400;
      throw err;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      const err = new Error('URL did not return an HTML page.');
      err.status = 400;
      throw err;
    }

    const html = await res.text();
    return { url: normalizedUrl, html: html.slice(0, MAX_HTML_CHARS) };
  } catch (err) {
    if (err.name === 'AbortError') {
      const abortErr = new Error('URL fetch timed out.');
      abortErr.status = 408;
      throw abortErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function extractReadableText(html, url) {
  const $ = cheerio.load(String(html || ''));
  const title = ($('meta[property="og:title"]').attr('content') || $('title').first().text() || '').trim();
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();

  $('script, style, noscript, svg, canvas, iframe, form, input, button, nav, footer, header, aside').remove();
  $('[aria-hidden="true"], [hidden]').remove();

  const candidates = ['main', 'article', '[role="main"]', '.content', '#content', 'body'];
  let bestText = '';

  for (const selector of candidates) {
    $(selector).each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length > bestText.length) bestText = text;
    });
    if (bestText.length > 1200 && selector !== 'body') break;
  }

  const lines = [title, description, bestText]
    .filter(Boolean)
    .join('\n\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const text = [...new Set(lines)].join('\n\n');
  if (text.length < 120) {
    const err = new Error('Could not extract enough readable text from this URL.');
    err.status = 400;
    throw err;
  }

  return {
    title: title || new URL(url).hostname.replace(/^www\./, ''),
    text,
  };
}

export async function fetchUrlText(url) {
  const fetched = await fetchUrlHtml(url);
  const extracted = extractReadableText(fetched.html, fetched.url);
  return { url: fetched.url, ...extracted };
}
