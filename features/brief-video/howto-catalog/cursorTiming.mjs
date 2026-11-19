// VENDORED from the hitloop-video hub (clients/critters-quest/howto/cursorTiming.mjs) by scripts/sync-howto-catalog.mjs. Do not edit here.
// CQ-HowTo "cursor" skeleton (template v3.3): ONE source for how a step's clicks are scheduled inside its fixed window
// and how short a window may be. Plain ESM, no dependencies: plan.ts (renders) and requestToSpec.mjs (validation,
// `step-too-short:<n>`) both import it, so a request that validates can never overrun at render time.
// Frames at 30 fps. Times are step-local (0 = the step window's first frame).

export const CURSOR_FPS = 30;
export const CURSOR_TIMING = {
  glide: 12, // cursor flight to a target
  settle: 4, // rest on the target before the press
  gap: 6, // air between one action's result and the next glide
  firstPress: 24, // earliest first press: the caption lands first, then the hand
  hold: 10, // result stays up after the last action (+ cursor hide 14 inside the scene)
  laterGap: 12, // after the last result, before the cut to the later view
  laterMin: 24, // the LATER view stays at least this long
  endMin: 45, // end art, minimum (1.5 s)
  establishMin: 30,
};

const T = CURSOR_TIMING;

const place = (actions, { length, later, local0, packed }) => {
  const n = actions.length;
  const firstIdeal = packed ? 0 : Math.max(T.firstPress, Math.round(length * (later ? 0.2 : 0.25)));
  const lastIdeal = Math.round(length * (later ? 0.35 : 0.6));
  let prevDone = -Infinity;
  return actions.map((a, k) => {
    const processing = a.processing ?? 0;
    const ideal = packed ? 0 : n === 1 ? firstIdeal : Math.round(firstIdeal + ((Math.max(firstIdeal, lastIdeal - processing) - firstIdeal) * k) / (n - 1));
    const notBefore = Math.max(0, (a.notBefore ?? 0) - local0);
    const pressAt = Math.max(ideal, notBefore, prevDone + T.glide + T.settle + T.gap, T.firstPress);
    prevDone = pressAt + processing;
    return { pressAt, doneAt: pressAt + processing };
  });
};

/**
 * actions: [{ processing?, notBefore?, exit? }]. Presses are spread inside the window (first ~25 %, last ~60 %; for a
 * `later` step earlier), never earlier than `firstPress`, each after the previous result + glide. If that spread would
 * leave no room for the hold (or the LATER view), the packed schedule is used instead (never overruns a valid window).
 * `local0`: scene-clock frame of this window's frame 0 (a panel's `notBefore` is on the scene clock).
 */
export const scheduleActions = (actions, { length = 0, later = false, local0 = 0 } = {}) => {
  const spread = place(actions, { length, later, local0, packed: false });
  const tail = later ? T.laterGap + T.laterMin : T.hold;
  const lastDone = spread.length ? spread[spread.length - 1].doneAt : 0;
  return lastDone + tail <= length ? spread : place(actions, { length, later, local0, packed: true });
};

/** Smallest window (frames) a step can have: its clicks packed as early as allowed, plus the hold / the LATER view. */
export const minStepFrames = (actions, { later = false, panelMin = 0, local0 = 0 } = {}) => {
  const packed = scheduleActions(actions, { length: 0, later, local0 });
  const lastDone = packed.length ? packed[packed.length - 1].doneAt : 0;
  return Math.max(panelMin, later ? lastDone + T.laterGap + T.laterMin : lastDone + T.hold);
};

/** Frame (step-local) where the later view cuts in: right after the last result. */
export const laterCutAt = (schedule) => (schedule.length ? schedule[schedule.length - 1].doneAt : 0) + T.laterGap;
