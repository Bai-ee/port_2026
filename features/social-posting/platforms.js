// platforms.js — the single registry every social-publishing surface reads
// from. Adding a platform is a new entry here + an adapter file — never a
// hardcoded 'x' literal outside the X adapter itself.

// `live` gates publishing through the generic adapter contract (digest
// auto-publish, post-now); `connectable` gates the per-client Connect /
// Disconnect UI; `crossPost` lets a calendar post tick this network as an
// extra target (./cross-post.js), which publishes through the platform's own
// adapter call even while `live` is false. Instagram is crossPost-only: its
// adapter does not speak the generic {clientId, text, media} contract yet.
export const SOCIAL_PLATFORMS = [
  { key: 'x', label: 'X', live: true, connectable: true, handlePrefix: '@' },
  { key: 'instagram', label: 'Instagram', live: false, connectable: true, crossPost: true, handlePrefix: '@' },
];

export const PLATFORM_KEYS = SOCIAL_PLATFORMS.map((p) => p.key);
export const LIVE_PLATFORM_KEYS = SOCIAL_PLATFORMS.filter((p) => p.live).map((p) => p.key);
export const CONNECTABLE_PLATFORM_KEYS = SOCIAL_PLATFORMS.filter((p) => p.connectable).map((p) => p.key);

export function isLivePlatform(key) {
  return LIVE_PLATFORM_KEYS.includes(key);
}

export function getPlatformDef(key) {
  return SOCIAL_PLATFORMS.find((p) => p.key === key) || null;
}
