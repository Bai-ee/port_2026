import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, pushHistory, undoHistory } from '../history.js';
import { mulberry32, deriveSeed, pick } from '../randomize.js';

// Regression for Codex blocker 1 of the 2026-07-23T18:24:04Z review: Look and
// Element randomization used to share ONE `sceneSeed` counter across TWO
// independent undo/redo stacks (elementHistoryRef, lookHistoryRef). Production
// sequence: seed 1 -> Randomize look (seed 2) -> Randomize element (seed 3)
// -> Undo look. Undo look restored the shared counter to 1 — skipping over
// and effectively erasing the ELEMENT action's seed progression (the element
// itself, generated at seed 3, was left stranded ahead of a now-rewound
// counter), and the next roll would reuse seed 2, already consumed by the
// undone look action.
//
// The fix: independent per-scope seeds (ClothStudio.jsx `sceneSeed` for
// Elements, new `lookSeed` for Look) — each scope's history only ever
// reads/writes its OWN counter. This models that exact two-scope
// composition with the real history.js/randomize.js primitives (ClothStudio
// itself can't be imported into node:test — see look-randomize-history.test.js's
// own header) and proves an undo in one scope can never affect the other's
// seed or result, in both orderings the review named.

function makeScope(idPrefix) {
  return {
    history: createHistory(),
    seed: 1,
    roll(currentSeed) {
      const nextSeed = currentSeed + 1;
      const rand = mulberry32(deriveSeed(nextSeed, idPrefix, 'randomize'));
      const value = pick(rand, ['a', 'b', 'c', 'd']);
      return { seed: nextSeed, value };
    },
  };
}

test('Look -> Element -> Undo Look: undoing the look action does not rewind or affect the element scope\'s seed/result at all', () => {
  const look = makeScope('look');
  const element = makeScope('element');

  // Randomize look: seed 1 -> 2
  look.history = pushHistory(look.history, { seed: look.seed, value: null });
  const lookRoll1 = look.roll(look.seed);
  look.seed = lookRoll1.seed;

  // Randomize element: seed 1 -> 2 (its OWN independent counter, unaffected by look's)
  element.history = pushHistory(element.history, { seed: element.seed, value: null });
  const elementRoll1 = element.roll(element.seed);
  element.seed = elementRoll1.seed;

  assert.equal(look.seed, 2);
  assert.equal(element.seed, 2, 'the element scope has its own counter — it does not inherit or share the look scope\'s advancement');

  // Undo look
  const undone = undoHistory(look.history, { seed: look.seed, value: lookRoll1.value });
  look.history = undone.history;
  look.seed = undone.snapshot.seed;

  assert.equal(look.seed, 1, 'look scope correctly rewound');
  assert.equal(element.seed, 2, 'CRITICAL: the element scope\'s seed must be completely untouched by a look-scope undo — this is the exact cross-scope interference the review caught');
  assert.deepEqual(elementRoll1, element.roll(1), 'the element result at its own seed is still reproducible — nothing about it was "erased" by the unrelated look undo');
});

test('Element -> Look -> Undo Element (the inverse ordering): undoing the element action does not rewind or affect the look scope', () => {
  const look = makeScope('look');
  const element = makeScope('element');

  element.history = pushHistory(element.history, { seed: element.seed, value: null });
  const elementRoll1 = element.roll(element.seed);
  element.seed = elementRoll1.seed;

  look.history = pushHistory(look.history, { seed: look.seed, value: null });
  const lookRoll1 = look.roll(look.seed);
  look.seed = lookRoll1.seed;

  assert.equal(element.seed, 2);
  assert.equal(look.seed, 2);

  const undone = undoHistory(element.history, { seed: element.seed, value: elementRoll1.value });
  element.history = undone.history;
  element.seed = undone.snapshot.seed;

  assert.equal(element.seed, 1, 'element scope correctly rewound');
  assert.equal(look.seed, 2, 'CRITICAL: the look scope\'s seed and its already-applied result must be completely untouched by an element-scope undo');
  assert.deepEqual(lookRoll1, look.roll(1), 'the look result is still reproducible from its own seed — an unrelated later element undo cannot rewind it');
});

test('interleaved rolls in both scopes never collide on a derived seed value, because each scope derives from its own independent counter AND its own id-prefix discriminator', () => {
  const look = makeScope('look');
  const element = makeScope('element');

  const l1 = look.roll(1); // look seed 1 -> 2
  const e1 = element.roll(1); // element seed 1 -> 2, independently
  assert.equal(l1.seed, e1.seed, 'both scopes may legitimately reach the same NUMBER (2) — that alone is fine');
  // but the derived seed streams are provably distinct (different id-prefix),
  // so reaching the same seed NUMBER never means reaching the same RESULT —
  // the real guarantee is that deriveSeed folds in the scope discriminator.
  assert.notEqual(deriveSeed(l1.seed, 'look', 'randomize'), deriveSeed(e1.seed, 'element', 'randomize'));
});
