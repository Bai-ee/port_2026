// Seeded randomization helpers — one global scene seed with deterministic
// derived sub-seeds per element/group, per docs/plans/ORIGINAL-STUDIO-
// CINEMATIC-SETS-4K-PLAN.md "Seeded randomization system". Never uses
// Math.random() for anything that gets serialized/reproduced.

// mulberry32 — same tiny seeded PRNG already used elsewhere in this repo
// (scripts/render-ui-teaser.mjs, api/_lib/studio-recipe-variations.cjs) so the
// "seed reproduces the exact result" guarantee is a proven pattern here.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// djb2 string hash → uint32. Turns (sceneSeed, elementId, group, ...) into a
// derived numeric seed so different elements/groups never draw from the same
// PRNG stream even when the base seed is identical.
export function deriveSeed(baseSeed, ...parts) {
  const str = `${baseSeed}:${parts.join(':')}`;
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

export function randomInRange(rand, range) {
  const [min, max] = range;
  return min + rand() * (max - min);
}

export function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

// Round to a slider's step so randomized values land on the same grid the
// UI's manual controls do (avoids ugly float noise like 0.4133333x).
export function snapToStep(value, step) {
  if (!step) return value;
  const snapped = Math.round(value / step) * step;
  return Number(snapped.toFixed(6));
}
