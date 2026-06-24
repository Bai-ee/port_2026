'use strict';

const dns = require('dns').promises;
const net = require('net');

// Private/reserved IPv4 ranges — block these to prevent SSRF
const PRIVATE_IPV4_RANGES = [
  { start: ip4ToInt('0.0.0.0'),     end: ip4ToInt('0.255.255.255') },   // 0.0.0.0/8
  { start: ip4ToInt('10.0.0.0'),    end: ip4ToInt('10.255.255.255') },  // 10.0.0.0/8
  { start: ip4ToInt('100.64.0.0'),  end: ip4ToInt('100.127.255.255') }, // 100.64.0.0/10 (CGNAT)
  { start: ip4ToInt('127.0.0.0'),   end: ip4ToInt('127.255.255.255') }, // 127.0.0.0/8
  { start: ip4ToInt('169.254.0.0'), end: ip4ToInt('169.254.255.255') }, // 169.254.0.0/16 (link-local + metadata)
  { start: ip4ToInt('172.16.0.0'),  end: ip4ToInt('172.31.255.255') },  // 172.16.0.0/12
  { start: ip4ToInt('192.168.0.0'), end: ip4ToInt('192.168.255.255') }, // 192.168.0.0/16
  { start: ip4ToInt('198.18.0.0'),  end: ip4ToInt('198.19.255.255') },  // 198.18.0.0/15
  { start: ip4ToInt('255.255.255.255'), end: ip4ToInt('255.255.255.255') }, // broadcast
];

function ip4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function isPrivateIPv4(ip) {
  const n = ip4ToInt(ip);
  return PRIVATE_IPV4_RANGES.some(r => n >= r.start && n <= r.end);
}

// Block all non-global IPv6 addresses
function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  // loopback
  if (lower === '::1') return true;
  // unspecified
  if (lower === '::') return true;
  // link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  // unique local fc00::/7
  if (/^f[cd]/i.test(lower)) return true;
  // IPv4-mapped ::ffff:
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.replace('::ffff:', '');
    if (net.isIPv4(v4)) return isPrivateIPv4(v4);
  }
  return false;
}

/**
 * Validate that a URL is safe to fetch (not internal/private).
 * Throws an error with a safe message if rejected.
 */
async function validateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('SSRF_BLOCKED: invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`SSRF_BLOCKED: scheme "${parsed.protocol}" not allowed`);
  }

  const host = parsed.hostname.toLowerCase();

  // Block localhost by name
  if (host === 'localhost' || host === 'localhost.') {
    throw new Error('SSRF_BLOCKED: localhost not allowed');
  }

  // Block numeric IPv4 directly in hostname
  if (net.isIPv4(host) && isPrivateIPv4(host)) {
    throw new Error(`SSRF_BLOCKED: private IPv4 "${host}"`);
  }

  // Block numeric IPv6 directly in hostname
  const hostNoSquare = host.replace(/^\[|\]$/g, '');
  if (net.isIPv6(hostNoSquare) && isPrivateIPv6(hostNoSquare)) {
    throw new Error(`SSRF_BLOCKED: private IPv6 "${host}"`);
  }

  // DNS-resolve hostname and validate the resolved IPs
  try {
    const [v4results, v6results] = await Promise.allSettled([
      dns.resolve4(host),
      dns.resolve6(host),
    ]);

    const resolved = [
      ...(v4results.status === 'fulfilled' ? v4results.value : []),
      ...(v6results.status === 'fulfilled' ? v6results.value : []),
    ];

    if (resolved.length === 0) {
      throw new Error(`SSRF_BLOCKED: could not resolve "${host}"`);
    }

    for (const ip of resolved) {
      if (net.isIPv4(ip) && isPrivateIPv4(ip)) {
        throw new Error(`SSRF_BLOCKED: "${host}" resolves to private IPv4 "${ip}"`);
      }
      if (net.isIPv6(ip) && isPrivateIPv6(ip)) {
        throw new Error(`SSRF_BLOCKED: "${host}" resolves to private IPv6 "${ip}"`);
      }
    }
  } catch (err) {
    if (err.message.startsWith('SSRF_BLOCKED')) throw err;
    // DNS lookup failure — fail closed
    throw new Error(`SSRF_BLOCKED: DNS resolution failed for "${host}": ${err.message}`);
  }

  return parsed;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

async function readResponseText(response, maxBytes = DEFAULT_MAX_BYTES) {
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > maxBytes) {
    throw new Error(`SSRF_BLOCKED: response too large (${contentLength} bytes, max ${maxBytes})`);
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`SSRF_BLOCKED: response too large (max ${maxBytes} bytes)`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new Error(`SSRF_BLOCKED: response too large (max ${maxBytes} bytes)`);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function readResponseBuffer(response, maxBytes = DEFAULT_MAX_BYTES) {
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > maxBytes) {
    throw new Error(`SSRF_BLOCKED: response too large (${contentLength} bytes, max ${maxBytes})`);
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > maxBytes) {
      throw new Error(`SSRF_BLOCKED: response too large (max ${maxBytes} bytes)`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new Error(`SSRF_BLOCKED: response too large (max ${maxBytes} bytes)`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

/**
 * SSRF-safe fetch. Validates the URL (and each redirect target) before fetching.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]   - Default 15s
 * @param {number} [opts.maxBytes]    - Default 10 MB
 * @param {object} [opts.fetchOptions] - Passed to fetch()
 * @returns {Promise<Response>}
 */
async function safeFetch(url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, fetchOptions = {} } = {}) {
  await validateUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      redirect: 'manual', // handle redirects manually to validate each hop
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // Follow redirects with SSRF checks on each hop (max 5)
  let hops = 0;
  while (response.status >= 300 && response.status < 400 && hops < 5) {
    const location = response.headers.get('location');
    if (!location) break;

    // Resolve relative redirects
    const nextUrl = new URL(location, url).toString();
    await validateUrl(nextUrl);

    url = nextUrl;
    const hopController = new AbortController();
    const hopTimer = setTimeout(() => hopController.abort(), timeoutMs);
    try {
      response = await fetch(url, {
        ...fetchOptions,
        redirect: 'manual',
        signal: hopController.signal,
      });
    } finally {
      clearTimeout(hopTimer);
    }
    hops++;
  }

  // Fast-fail when the server declares an oversized body. Callers should use
  // readResponseText() to enforce the same cap for chunked/unknown-length bodies.
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > maxBytes) {
    throw new Error(`SSRF_BLOCKED: response too large (${contentLength} bytes, max ${maxBytes})`);
  }

  return response;
}

module.exports = { readResponseBuffer, readResponseText, safeFetch, validateUrl };
