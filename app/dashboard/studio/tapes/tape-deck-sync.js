// Pure helpers for the Tape Deck (?tool=tapes): A/B switch planning, clock and
// label formatting, deep links. No DOM, no audio, no network.

export const DRIFT_RESYNC_S = 0.03;
export const DECK_IDS = ['A', 'B'];

/** Seconds -> "m:ss". Bad input -> "0:00". */
export function formatClock(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Clamp a scrub/seek time into [0, length]. */
export function clampTime(t, length) {
  const max = Number.isFinite(length) && length > 0 ? length : 0;
  if (!Number.isFinite(t) || t < 0) return 0;
  return Math.min(t, max);
}

/**
 * What to do when the listener switches decks.
 * `parallel` = both elements are playing (inactive muted); otherwise (iOS
 * fallback, or paused) the target is simply seeked and, if playing, started.
 * Returns { seek, unmuteTarget, muteSource, pauseSource, playTarget }.
 */
export function planSwitch({ from, to, fromTime, toTime, playing, parallel }) {
  if (from === to) return { noop: true, seek: null, unmuteTarget: false, muteSource: false, pauseSource: false, playTarget: false };
  const drift = Math.abs((toTime || 0) - (fromTime || 0));
  const seek = parallel && playing && drift <= DRIFT_RESYNC_S ? null : (fromTime || 0);
  return {
    noop: false,
    seek,
    unmuteTarget: true,
    muteSource: true,
    pauseSource: !parallel,
    playTarget: Boolean(playing) && !parallel,
  };
}

/** Which deck a key press selects: 1/a -> A, 2/b -> B, anything else null. */
export function deckForKey(key) {
  const k = String(key || '').toLowerCase();
  if (k === '1' || k === 'a') return 'A';
  if (k === '2' || k === 'b') return 'B';
  return null;
}

/** `#<reviewId>` -> id (letters, digits, dash, underscore only), else ''. */
export function readDeepLink(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  return /^[A-Za-z0-9_-]{1,120}$/.test(raw) ? raw : '';
}

export const deepLinkHash = (id) => (id ? `#${id}` : '');

/** Truncate a title for the cassette label. */
export function labelTitle(title, max = 26) {
  const t = String(title || '').trim() || 'Untitled tape';
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Whole minutes cut from the tape (rounded), or null when unknown. */
export function minutesRemoved(record) {
  const s = record?.cuts?.removedS;
  return Number.isFinite(s) ? Math.round(s / 60) : null;
}

/** Short diagnostic chips for one record. */
export function diagChips(diag) {
  const d = diag || {};
  const chips = [];
  if (Number.isFinite(d.balanceDb) && Math.abs(d.balanceDb) >= 0.5) chips.push(`L/R ${d.balanceDb > 0 ? '+' : '−'}${Math.abs(d.balanceDb).toFixed(1)} dB`);
  if (Array.isArray(d.humHz) && d.humHz.length) chips.push(`hum ${d.humHz.map((h) => Math.round(h)).join('/')} Hz`);
  if (Number.isFinite(d.rolloffHz)) chips.push(`rolloff ${(d.rolloffHz / 1000).toFixed(1)} kHz`);
  if (Number.isFinite(d.lufs)) chips.push(`${d.lufs.toFixed(1).replace('-', '−')} LUFS`);
  return chips;
}

/** Display date for a record, "18 Nov 2026", or '' when missing. */
export function formatPublished(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || !Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Reel pack radii (supply shrinks, take-up grows) for progress 0..1. */
export function packRadii(progress, min = 21, max = 45) {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return { supply: max - (max - min) * p, takeUp: min + (max - min) * p };
}
