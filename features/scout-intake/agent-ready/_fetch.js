'use strict';

const TIMEOUT_MS = 5000;

async function fetchProbe(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow', ...opts });
    clearTimeout(timer);
    const body = await res.text().catch(() => '');
    const headers = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { ok: res.ok, status: res.status, headers, body, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, headers: {}, body: '', error: err.message };
  }
}

module.exports = { fetchProbe };
