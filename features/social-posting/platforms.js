// platforms.js — the single registry every social-publishing surface reads
// from. Adding a platform is a new entry here + an adapter file — never a
// hardcoded 'x' literal outside the X adapter itself.

export const SOCIAL_PLATFORMS = [
  { key: 'x', label: 'X', live: true, handlePrefix: '@' },
  { key: 'instagram', label: 'Instagram', live: false, handlePrefix: '@' },
];

export const PLATFORM_KEYS = SOCIAL_PLATFORMS.map((p) => p.key);
export const LIVE_PLATFORM_KEYS = SOCIAL_PLATFORMS.filter((p) => p.live).map((p) => p.key);

export function isLivePlatform(key) {
  return LIVE_PLATFORM_KEYS.includes(key);
}

export function getPlatformDef(key) {
  return SOCIAL_PLATFORMS.find((p) => p.key === key) || null;
}
