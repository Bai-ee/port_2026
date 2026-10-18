// Pure logic for the Calendar Stage post carousel (infinite prev/next over one day's posts). No DOM, no React.

export const SWIPE_MIN_PX = 48; // horizontal travel needed for one touch step
export const SWIPE_AXIS_RATIO = 1.5; // |dx| must beat |dy| by this factor (vertical scroll stays vertical)
export const WHEEL_STEP_PX = 60; // accumulated horizontal wheel delta needed for one step
export const WHEEL_QUIET_MS = 180; // no wheel events for this long re-arms the gesture (trackpad inertia keeps firing)

// Wrap any integer into [0, n).
export function wrapIndex(i, n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return ((Math.trunc(i) % n) + n) % n;
}

// Which post of a set of day groups [{date, rows:[{id}]}] is the carousel's list? Prefer the group for `date`
// when it holds the post, otherwise the first group that does. Returns an array of ids ([] when not found).
export function pickDayPostIds(groups, date, postId) {
  if (!Array.isArray(groups) || !postId) return [];
  const idsOf = (g) => (Array.isArray(g?.rows) ? g.rows.map((r) => r && r.id).filter(Boolean).map(String) : []);
  const has = (g) => idsOf(g).includes(String(postId));
  const hit = groups.find((g) => g && g.date === date && has(g)) || groups.find(has);
  return hit ? idsOf(hit) : [];
}

// Next/previous id with wrap-around. dir: +1 | -1. null when there is nothing to move to.
export function stepTarget(ids, currentId, dir) {
  if (!Array.isArray(ids) || ids.length < 2 || (dir !== 1 && dir !== -1)) return null;
  const at = ids.indexOf(String(currentId));
  if (at < 0) return null;
  return ids[wrapIndex(at + dir, ids.length)];
}

// "3 / 7" (1-based); '' when the post is not in the list.
export function positionLabel(ids, currentId) {
  if (!Array.isArray(ids) || !ids.length) return '';
  const at = ids.indexOf(String(currentId));
  return at < 0 ? '' : `${at + 1} / ${ids.length}`;
}

// Touch: finger moved (dx, dy) -> +1 (next) / -1 (prev) / 0. Swiping left shows the next post.
export function swipeStep(dx, dy) {
  const ax = Math.abs(dx);
  if (ax < SWIPE_MIN_PX || ax < Math.abs(dy) * SWIPE_AXIS_RATIO) return 0;
  return dx < 0 ? 1 : -1;
}

export function initialWheelState() {
  return { lastTime: -Infinity, accum: 0, locked: false };
}

// Trackpad two-finger horizontal swipe. One physical gesture = one step: after a step the state stays locked until
// WHEEL_QUIET_MS passes with no wheel events (inertia tails keep the lock alive). Returns { step, state, consumed }.
// consumed = a horizontal gesture the carousel owns (caller should preventDefault to stop browser back-swipe).
export function wheelStep(state, e, now) {
  const dx = Number(e?.deltaX) || 0;
  const dy = Number(e?.deltaY) || 0;
  let s = state || initialWheelState();
  if (Math.abs(dx) <= Math.abs(dy) || dx === 0) return { step: 0, state: s, consumed: false };
  if (now - s.lastTime > WHEEL_QUIET_MS) s = { lastTime: now, accum: 0, locked: false };
  else s = { ...s, lastTime: now };
  if (s.locked) return { step: 0, state: s, consumed: true };
  const accum = Math.sign(s.accum) !== 0 && Math.sign(s.accum) !== Math.sign(dx) ? dx : s.accum + dx;
  if (Math.abs(accum) >= WHEEL_STEP_PX) {
    return { step: accum > 0 ? 1 : -1, state: { ...s, accum: 0, locked: true }, consumed: true };
  }
  return { step: 0, state: { ...s, accum }, consumed: true };
}

// Is the keyboard target somewhere arrow keys belong to the control itself (typing, sliders, selects)?
export function isTypingTarget(t) {
  if (!t) return false;
  const tag = String(t.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT') return true;
  if (t.isContentEditable) return true;
  const role = typeof t.getAttribute === 'function' ? t.getAttribute('role') : null;
  return role === 'textbox' || role === 'slider' || role === 'combobox' || role === 'listbox' || role === 'radio';
}

// Keyboard: ArrowRight -> +1, ArrowLeft -> -1, otherwise 0 (also 0 while typing, with modifiers or when handled).
export function keyStep(e) {
  if (!e || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return 0;
  if (isTypingTarget(e.target)) return 0;
  if (e.key === 'ArrowRight') return 1;
  if (e.key === 'ArrowLeft') return -1;
  return 0;
}
