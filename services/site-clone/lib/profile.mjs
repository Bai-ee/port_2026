// profile.mjs — platform profile loading, detection, and asset-host matching.

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.join(__dirname, '..', 'profiles');
const PROFILE_NAMES = ['shopify', 'squarespace', 'wix', 'generic'];

let _cache = null;

export async function loadProfiles() {
  if (_cache) return _cache;
  const profiles = {};
  for (const name of PROFILE_NAMES) {
    const raw = await readFile(path.join(PROFILES_DIR, `${name}.json`), 'utf8');
    profiles[name] = JSON.parse(raw);
  }
  _cache = profiles;
  return profiles;
}

/** Detect platform from homepage HTML text. Falls back to 'generic'. */
export function detectPlatform(html, profiles) {
  for (const [name, profile] of Object.entries(profiles)) {
    if (name === 'generic') continue;
    if ((profile.detect || []).some((marker) => html.includes(marker))) {
      return profile;
    }
  }
  return profiles.generic;
}

/** Resolve a profile's assetHosts (with "{origin}" placeholder) against a base URL. */
export function resolveAssetHosts(assetHosts, originHost) {
  return assetHosts.map((h) => (h === '{origin}' ? originHost : h));
}

/** True if `host` matches an allowlist entry — exact match, or a trailing "*" prefix match. */
export function hostAllowed(host, resolvedHosts) {
  const h = String(host || '').toLowerCase();
  return resolvedHosts.some((entry) => {
    const e = String(entry).toLowerCase();
    if (e.endsWith('*')) return h.startsWith(e.slice(0, -1));
    return h === e;
  });
}
