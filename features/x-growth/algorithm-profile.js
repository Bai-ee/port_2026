import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const ACTIVE_PROFILE_ID = 'x-2026-05-15';

let _cached = null;

export function getAlgorithmProfile(id = ACTIVE_PROFILE_ID) {
  if (_cached && _cached.id === id) return _cached;
  _cached = require(`./algorithm-profiles/${id}.json`);
  return _cached;
}

export function getActiveProfileId() {
  return ACTIVE_PROFILE_ID;
}
