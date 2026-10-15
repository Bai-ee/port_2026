// Tiny shared helpers (no colour logic).

export function round(x, dp) {
  const f = Math.pow(10, dp);
  const r = Math.round(x * f) / f;
  return r === 0 ? 0 : r; // normalise -0
}

/** Wrap a hue to [0,360) then round; a value that rounds up to 360 becomes 0. Idempotent. */
export function wrapRound(h, dp) {
  const w = h >= 0 && h < 360 ? h : ((h % 360) + 360) % 360;
  const x = round(w, dp);
  return x >= 360 ? 0 : x;
}

export function clamp(x, min, max) {
  return x < min ? min : x > max ? max : x;
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function has(obj, key) {
  return isPlainObject(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** 32-bit FNV-1a of a string, returned as 8 lowercase hex chars. */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
