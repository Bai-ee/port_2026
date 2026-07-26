import { PLATFORM_KEYS } from '../platforms.js';
import * as xAdapter from './x.js';
import * as instagramAdapter from './instagram.js';

const ADAPTERS = { x: xAdapter, instagram: instagramAdapter };

export function getAdapter(platform) {
  if (!PLATFORM_KEYS.includes(platform) || !ADAPTERS[platform]) {
    throw Object.assign(new Error(`Unknown social platform: ${platform}`), { status: 400 });
  }
  return ADAPTERS[platform];
}
