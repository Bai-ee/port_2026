'use strict';

const { readResponseText, safeFetch } = require('../../../api/_lib/safe-fetch.cjs');

const TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 512 * 1024;

async function fetchProbe(url, opts = {}) {
  try {
    const res = await safeFetch(url, {
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BODY_BYTES,
      fetchOptions: opts,
    });
    const body = await readResponseText(res, MAX_BODY_BYTES).catch(() => '');
    const headers = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { ok: res.ok, status: res.status, headers, body, error: null };
  } catch (err) {
    return { ok: false, status: 0, headers: {}, body: '', error: err.message };
  }
}

module.exports = { fetchProbe };
