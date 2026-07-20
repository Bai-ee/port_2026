// http.mjs — SSRF-safe outbound fetch for the clone engine. Reuses the main
// app's safe-fetch guard (api/_lib/safe-fetch.cjs) for every page/asset fetch,
// not just the job-creation URL check — discovered asset/page URLs are
// effectively attacker-influenced (derived from third-party page content).

import safeFetchLib from '../../../api/_lib/safe-fetch.cjs';

const { safeFetch, readResponseBuffer, readResponseText, validateUrl } = safeFetchLib;

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export async function fetchPageHtml(url, { maxBytes = 10 * 1024 * 1024 } = {}) {
  const res = await safeFetch(url, {
    maxBytes,
    fetchOptions: { headers: { 'User-Agent': DESKTOP_UA, Accept: 'text/html,application/xhtml+xml,*/*' } },
  });
  const html = await readResponseText(res, maxBytes);
  return { html, status: res.status };
}

export async function fetchAsset(url, { maxBytes = 25 * 1024 * 1024 } = {}) {
  const res = await safeFetch(url, {
    maxBytes,
    fetchOptions: { headers: { 'User-Agent': DESKTOP_UA } },
  });
  const buffer = await readResponseBuffer(res, maxBytes);
  return { buffer, status: res.status, contentType: res.headers.get('content-type') || '' };
}

export { validateUrl, DESKTOP_UA };
