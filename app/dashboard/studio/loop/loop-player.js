// Loop Studio — Web Audio gapless playback wrapper.
//
// HARD RULE: looped audition MUST use AudioBufferSourceNode with
// `loop = true` + `loopStart`/`loopEnd` — the native `<audio loop>` element
// inserts tens of ms of silence at every wrap (its loop is driven by the
// HTMLMediaElement seeking back to 0, not a sample-accurate scheduler),
// which makes a perfectly-cut loop audibly stutter on every repeat. Never
// use `<audio>` (or an `<audio>`-backed MediaElementAudioSourceNode) for
// loop playback in this module.
//
// This module touches `window`/`AudioContext`, but importing it must never
// throw outside a browser (Node test runner, SSR): the shared AudioContext
// is constructed lazily, on the first call that actually needs to play
// something — never at module load, never inside createLoopPlayer() itself.

let sharedCtx = null;

function getAudioContext() {
  if (sharedCtx) return sharedCtx;
  const Ctor = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
    || (typeof AudioContext !== 'undefined' ? AudioContext : null);
  if (!Ctor) throw new Error('loop-player: AudioContext is not available in this environment');
  sharedCtx = new Ctor();
  return sharedCtx;
}

/**
 * Creates one gapless-loop / full-track audition player, backed by a
 * lazily-created shared AudioContext (browsers require a user-gesture-
 * adjacent call to construct/resume one — deferring construction to the
 * first `playLoop`/`playFrom` call keeps that gesture requirement intact).
 *
 * Returned instance:
 *   - `setBuffer(audioBuffer)` — stores the decoded AudioBuffer to play
 *     from; stops any current playback (a stale source must never keep
 *     playing against a buffer that's about to be replaced).
 *   - `playLoop({ startSample, endSample })` — stops current playback,
 *     starts a fresh AudioBufferSourceNode with `loop = true` and
 *     `loopStart`/`loopEnd` set from the sample range (converted to
 *     seconds via the buffer's own sampleRate), starting playback AT
 *     loopStart.
 *   - `playFrom(seconds)` — stops current playback, starts a fresh
 *     one-shot (`loop = false`) AudioBufferSourceNode from `seconds` into
 *     the full track; playback state clears itself when the source ends
 *     naturally (`source.onended`).
 *   - `playExternalBuffer(buffer, opts)` — plays an arbitrary decoded
 *     AudioBuffer that did not come through `setBuffer` (e.g. a repaired
 *     loop, or an engine audition render like "play x4"/"play all
 *     segments", fetched via `fetchEngineAudioBuffer`). Stops any current
 *     playback first, same as the other play* calls; uses the same
 *     AudioBufferSourceNode mechanism (never `<audio>`). Does NOT touch
 *     `buffer`/`setBuffer`'s stored track, so the next `playLoop`/`playFrom`
 *     still plays the original track untouched. `opts.loop` (default
 *     `true`, preserving the original gapless-loop behavior — e.g. "Play
 *     repair") set `false` plays the buffer once and self-clears on end
 *     (e.g. "Play xN" / "Play all segments", which are already
 *     pre-rendered to the requested length by the engine). `opts.startSeconds`
 *     (default 0) offsets the initial start position, used by `seek()`.
 *   - `seek(seconds)` — reposition playback within whatever is CURRENTLY
 *     playing, without changing mode/source buffer: restarts the active
 *     AudioBufferSourceNode at the new offset (Web Audio has no seek API of
 *     its own). In `'loop'`/looping-`'external'` mode the offset wraps
 *     into the active span with the same modulo pattern `getPlayhead()`
 *     uses. A no-op while nothing is playing.
 *   - `stop()` — stops + disconnects the current source; idempotent (safe
 *     to call with nothing playing). Handles the external source from
 *     `playExternalBuffer` exactly like the built-in ones (try/catch
 *     `.stop()`, disconnect, null out).
 *   - `getPlayhead()` — current position in SECONDS within whatever is
 *     playing, derived from `ctx.currentTime` bookkeeping (never polled
 *     from the source node, which exposes no position API of its own);
 *     `null` when nothing is playing. In `'loop'` mode (and a looping
 *     `'external'` buffer) the raw elapsed time is wrapped back into
 *     `[0, span)` with the standard modulo pattern
 *     (`((elapsed % span) + span) % span`) so the reported position always
 *     tracks which pass is currently sounding. A one-shot (non-looping)
 *     `'external'`/`'track'` buffer reports elapsed time clamped to its
 *     own duration.
 *   - `getDuration()` — duration in SECONDS of whatever is currently
 *     active (`loopEnd - loopStart` in `'loop'` mode, the external
 *     buffer's own `.duration` in `'external'` mode, the full track's
 *     `.duration` in `'track'` mode); `0` when nothing is playing.
 *   - `isPlaying()` — boolean; true while an external buffer plays too.
 *   - `mode()` — `'loop' | 'track' | 'external' | null`.
 */
// Master output gain. Every source node routes through this instead of
// straight to `ctx.destination`, so the transport's volume control is a single
// node rather than a per-source ramp — and the metronome can tap the same
// context/destination without fighting it for the output.
let masterGain = null;
let masterVolume = 1;

function getMasterGain(ctx) {
  if (!masterGain || masterGain.context !== ctx) {
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
  }
  masterGain.gain.value = masterVolume;
  return masterGain;
}

export function createLoopPlayer() {
  let buffer = null;
  let source = null;
  let mode = null; // 'loop' | 'track' | 'external' | null
  let startCtxTime = 0;
  let startOffset = 0;
  let loopStart = 0;
  let loopEnd = 0;
  let externalBuffer = null; // the AudioBuffer passed to playExternalBuffer, for getDuration()/seek()
  let externalLoop = true; // the `loop` flag the current/last playExternalBuffer call used

  // Stops/disconnects the current source node WITHOUT clearing `mode` or the
  // per-mode bookkeeping (loopStart/loopEnd/externalBuffer/...) — used by
  // seek() to restart a fresh source at a new offset while staying "in"
  // the same mode. The public stop() below wraps this and also clears mode.
  function teardownSource() {
    if (source) {
      try { source.onended = null; } catch (err) { /* noop */ }
      try { source.stop(); } catch (err) { /* already stopped */ }
      try { source.disconnect(); } catch (err) { /* already disconnected */ }
    }
    source = null;
  }

  function stop() {
    teardownSource();
    mode = null;
  }

  function setBuffer(nextBuffer) {
    stop();
    buffer = nextBuffer || null;
  }

  function ensureRunning(ctx) {
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
  }

  function playLoop({ startSample, endSample }) {
    if (!buffer) return;
    stop();
    const ctx = getAudioContext();
    ensureRunning(ctx);

    const sr = buffer.sampleRate;
    const ls = Math.max(0, Number(startSample) || 0) / sr;
    const le = Math.max(ls + (1 / sr), Number(endSample) / sr);

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.loopStart = ls;
    node.loopEnd = le;
    node.connect(getMasterGain(ctx));
    node.start(0, ls);

    source = node;
    mode = 'loop';
    startCtxTime = ctx.currentTime;
    startOffset = ls;
    loopStart = ls;
    loopEnd = le;
  }

  function playFrom(seconds) {
    if (!buffer) return;
    stop();
    const ctx = getAudioContext();
    ensureRunning(ctx);

    const offset = Math.max(0, Number(seconds) || 0);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = false;
    node.connect(getMasterGain(ctx));
    node.onended = () => {
      if (source === node) {
        source = null;
        mode = null;
      }
    };
    node.start(0, offset);

    source = node;
    mode = 'track';
    startCtxTime = ctx.currentTime;
    startOffset = offset;
  }

  /**
   * Play an arbitrary decoded AudioBuffer that isn't the buffer stored via
   * `setBuffer` — e.g. a repaired-loop preview (looped) or an engine
   * audition render like "play x4"/"play all segments" (one-shot, already
   * baked to the requested length). Stops any current playback first;
   * stopped by the same `stop()` as the built-in paths; `isPlaying()`
   * reports true while it plays. `opts.loop` (default `true`) selects
   * gapless looping (`AudioBufferSourceNode.loop`) vs. a one-shot play that
   * self-clears (`source`/`mode` reset to `null`) via `onended` when it
   * finishes, same as `playFrom`. `opts.startSeconds` (default 0) seeks
   * into the buffer before starting — used by `seek()`.
   */
  function playExternalBuffer(buffer_, { loop = true, startSeconds = 0 } = {}) {
    if (!buffer_) return;
    stop();
    const ctx = getAudioContext();
    ensureRunning(ctx);

    const offset = Math.max(0, Number(startSeconds) || 0);
    const node = ctx.createBufferSource();
    node.buffer = buffer_;
    node.loop = loop;
    node.connect(getMasterGain(ctx));
    if (!loop) {
      node.onended = () => {
        if (source === node) {
          source = null;
          mode = null;
        }
      };
    }
    node.start(0, offset);

    source = node;
    mode = 'external';
    externalBuffer = buffer_;
    externalLoop = loop;
    startCtxTime = ctx.currentTime;
    startOffset = offset;
    loopStart = 0;
    loopEnd = buffer_.duration || 0;
  }

  /**
   * Restart the currently-active source at a new offset (Web Audio has no
   * seek API — the only way to reposition is to stop and start a fresh
   * AudioBufferSourceNode). No-op while nothing is playing. `seconds` is
   * measured from the start of whatever's currently active (0..duration
   * for a one-shot track/external buffer; 0..span for a loop/looping
   * external buffer, wrapped the same way `getPlayhead()` reports it).
   */
  function seek(seconds) {
    if (!source || mode === null) return;
    const ctx = getAudioContext();
    ensureRunning(ctx);
    const target = Math.max(0, Number(seconds) || 0);

    if (mode === 'track') {
      teardownSource();
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.loop = false;
      node.connect(getMasterGain(ctx));
      node.onended = () => {
        if (source === node) { source = null; mode = null; }
      };
      node.start(0, Math.min(target, buffer ? buffer.duration : target));
      source = node;
      startCtxTime = ctx.currentTime;
      startOffset = target;
      return;
    }

    if (mode === 'loop') {
      const span = Math.max(1e-9, loopEnd - loopStart);
      const within = ((target % span) + span) % span;
      teardownSource();
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      node.loopStart = loopStart;
      node.loopEnd = loopEnd;
      node.connect(getMasterGain(ctx));
      node.start(0, loopStart + within);
      source = node;
      startCtxTime = ctx.currentTime;
      startOffset = loopStart + within;
      return;
    }

    if (mode === 'external') {
      const dur = Math.max(1e-9, externalBuffer ? (externalBuffer.duration || 0) : 0);
      const within = externalLoop ? (((target % dur) + dur) % dur) : Math.min(target, dur);
      teardownSource();
      const node = ctx.createBufferSource();
      node.buffer = externalBuffer;
      node.loop = externalLoop;
      node.connect(getMasterGain(ctx));
      if (!externalLoop) {
        node.onended = () => {
          if (source === node) { source = null; mode = null; }
        };
      }
      node.start(0, within);
      source = node;
      startCtxTime = ctx.currentTime;
      startOffset = within;
    }
  }

  function getPlayhead() {
    if (!source || mode === null) return null;
    const ctx = getAudioContext();
    const elapsed = ctx.currentTime - startCtxTime;

    if (mode === 'track') return Math.min(startOffset + elapsed, buffer ? buffer.duration : startOffset + elapsed);

    if (mode === 'external' && !externalLoop) {
      const dur = externalBuffer ? (externalBuffer.duration || 0) : startOffset + elapsed;
      return Math.min(startOffset + elapsed, dur);
    }

    const span = Math.max(1e-9, mode === 'external' ? (externalBuffer ? (externalBuffer.duration || 0) : 0) : loopEnd - loopStart);
    const wrapped = ((elapsed % span) + span) % span;
    return mode === 'external' ? wrapped : loopStart + wrapped;
  }

  function getDuration() {
    if (mode === 'track') return buffer ? buffer.duration : 0;
    if (mode === 'loop') return Math.max(0, loopEnd - loopStart);
    if (mode === 'external') return externalBuffer ? (externalBuffer.duration || 0) : 0;
    return 0;
  }

  function isPlaying() {
    return source !== null;
  }

  /** 0..1, applied immediately and remembered for later sources. */
  function setVolume(next) {
    const v = Math.min(1, Math.max(0, Number(next)));
    masterVolume = Number.isFinite(v) ? v : 1;
    if (masterGain) masterGain.gain.value = masterVolume;
    return masterVolume;
  }

  return {
    setBuffer,
    playLoop,
    playFrom,
    playExternalBuffer,
    seek,
    stop,
    getPlayhead,
    getDuration,
    isPlaying,
    mode: () => mode,
    setVolume,
    getVolume: () => masterVolume,
    // Shared context + the node the metronome sits alongside: clicks and
    // transport audio share one clock and one user-gesture unlock.
    getContext: () => getAudioContext(),
    getOutputNode: () => getMasterGain(getAudioContext()),
  };
}
