// Loop Studio — click track ("timer sound") at the track's established BPM.
//
// Runs on the SAME AudioContext as loop-player.js (passed in, never created
// here) so the click shares one clock and one user-gesture unlock with the
// transport, and routes into the player's master gain so the volume control
// governs both.
//
// Scheduling is the standard lookahead pattern, not setInterval-per-click:
// a 25ms timer walks the beat grid and schedules every click that falls inside
// the next 120ms directly on the audio clock. setInterval jitter therefore
// never reaches the sound — the timer only decides WHEN TO SCHEDULE, never
// when to play. `beatsInWindow` below is the whole decision, kept pure so the
// grid can be tested without an AudioContext.

export const LOOKAHEAD_MS = 25;
export const SCHEDULE_WINDOW = 0.12; // seconds of audio scheduled ahead
export const CLICK_DECAY = 0.05; // seconds; the click's amplitude tail
export const ACCENT_HZ = 1600; // beat 1 of the bar
export const BEAT_HZ = 1000; // every other beat

/** Seconds per beat for a BPM. Returns 0 for a BPM that can't make a grid. */
export function secondsPerBeat(bpm) {
  const n = Number(bpm);
  return Number.isFinite(n) && n > 0 ? 60 / n : 0;
}

/**
 * Every beat that starts within [from, from + window) of a grid running at
 * `spb` seconds from `origin`, as {time, beat} — `beat` counting up from 0 at
 * the origin, so `beat % meter === 0` is a downbeat and takes the accent.
 * Pure: no context, no clock, no side effects.
 */
export function beatsInWindow({ origin, spb, from, window: win, meter = 4 }) {
  if (!(spb > 0) || !(win > 0)) return [];
  const out = [];
  const firstBeat = Math.max(0, Math.ceil((from - origin) / spb));
  const limit = origin + (firstBeat * spb) + win;
  for (let beat = firstBeat; ; beat += 1) {
    const time = origin + beat * spb;
    if (time >= from + win) break;
    if (time >= from) out.push({ time, beat, accent: meter > 0 && beat % meter === 0 });
    if (time > limit + win) break; // guard: never spin on a degenerate grid
  }
  return out;
}

/**
 * A click track bound to one AudioContext.
 *
 * `getContext`/`getOutputNode` are the loop player's own accessors, so the
 * metronome never opens a second context.
 */
export function createMetronome({ getContext, getOutputNode }) {
  let timer = null;
  let origin = 0;
  let spb = 0;
  let meter = 4;
  let gain = 0.35;

  function scheduleClick(ctx, destination, time, accent) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.value = accent ? ACCENT_HZ : BEAT_HZ;
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_DECAY);
    osc.connect(env);
    env.connect(destination);
    osc.start(time);
    osc.stop(time + CLICK_DECAY);
  }

  function tick() {
    const ctx = getContext();
    if (!ctx || !(spb > 0)) return;
    const destination = getOutputNode() || ctx.destination;
    const beats = beatsInWindow({
      origin, spb, from: ctx.currentTime, window: SCHEDULE_WINDOW, meter,
    });
    for (const b of beats) scheduleClick(ctx, destination, b.time, b.accent);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  /** Starts (or re-grids) the click. Re-calling with a new BPM re-origins it. */
  function start({ bpm, meter: nextMeter = 4, volume } = {}) {
    const ctx = getContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
    const nextSpb = secondsPerBeat(bpm);
    if (!(nextSpb > 0)) return false;
    stop();
    spb = nextSpb;
    meter = Number.isFinite(nextMeter) && nextMeter > 0 ? Math.round(nextMeter) : 4;
    if (Number.isFinite(volume)) gain = Math.min(1, Math.max(0, volume));
    origin = ctx.currentTime + 0.06; // a beat lands just after the first tick
    tick();
    timer = setInterval(tick, LOOKAHEAD_MS);
    return true;
  }

  return {
    start,
    stop,
    isRunning: () => timer !== null,
    setVolume: (v) => { gain = Math.min(1, Math.max(0, Number(v) || 0)); },
  };
}
