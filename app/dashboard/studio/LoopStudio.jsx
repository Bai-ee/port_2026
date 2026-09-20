'use client';

// LOOP STUDIO — browser-only audio loop slicer, built to full feature parity
// with the edittrax slice_track workbench (see docs/plans, the port-spec
// inventory this branch was built against), expressed inside the existing
// Studio chrome (RailCard/GLASS rail + dark stage + under-stage waveform
// strip). Drop/browse a track (or pick a known engine track), decode it
// with the Web Audio API at its SOURCE sample rate, and slice it into
// bar-aligned loops via a pure origin formula (BPM + bars-per-loop + meter +
// a nudgeable sample offset — see ./loop/loop-engine.js). This LOCAL grid is
// the primary, always-available, engine-independent source of truth — the
// tool stays fully usable offline/manual. The optional loopcore Python
// engine (./loop/loopcore-client.js, services/loopcore/) layers BPM/downbeat
// detection, bar-accurate re-encoding, and loopability verification/repair
// on top, entirely additively: every engine feature degrades invisibly
// (hidden or disabled with an "engine offline" note) when it isn't running.
//
// Also carries the TORAIZ SP-16 hardware-sampler export path (drag a loop
// onto one of 16 pads, quantized live pad triggering, then a `.scn` SCENE —
// one clean scene with its samples bundled, importable into any project on
// the unit via Scene Manager; writer in ./loop/sp16-scn-writer.js) — a
// separate, independently-shipped feature; this file's Export card toggles
// between the plain WAV path and the SP-16 path (`exportTarget`).
//
// HARD RULE: every audition play/stop in this file goes through the shared
// ./loop/loop-player.js Web Audio player (gapless AudioBufferSourceNode
// looping/one-shot). This component NEVER renders an <audio> element — not
// even a hidden one. The waveform strip below is wavesurfer.js, but it is
// wired with a synthetic (non-DOM) `media` shim — see `createSilentMedia()`
// — specifically so wavesurfer's own <audio> element is never created; ALL
// audible playback (including SP-16 pad triggers) is driven by
// loop-player.js, and wavesurfer is used purely as the visual
// waveform/regions renderer + cursor.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Music, SlidersHorizontal, Download, Play, Square, Wrench, ListChecks, Activity, Grid3x3, Bug, X,
  Repeat, Repeat1, Rewind, ChevronUp, AlertTriangle, Cloud,
  FileAudio2, MonitorPlay, ArrowUpRight, Volume2, VolumeX, Timer,
} from 'lucide-react';
import gsap from 'gsap';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/plugins/regions';
import { GLASS, ui, RailCard, Slider } from './components/rail-ui';
import CloudTemplateSection from './components/CloudTemplateSection';
import {
  samplesPerBar, clampBpm, computeLoops, formatSeconds, nextPhraseWaitMs,
} from './loop/loop-engine';
import { encodeWavPcm16, buildStoreZip, resampleChannelData } from './loop/wav-encode';
import { createLoopPlayer } from './loop/loop-player';
import { createMetronome } from './loop/metronome';
import { parseAudioFileMeta } from './loop/audio-file-meta';
import EdittraxPlayerPanel from './loop/edittrax/EdittraxPlayerPanel';
import { buildEdittraxZipBytes } from './loop/edittrax/build-player-zip';
import { readLivePartLoops } from './loop/edittrax/edittrax-embed';
import { sanitizePlayerProjectBase } from './loop/edittrax/edittrax-export';
import {
  PIPELINE_STEPS, computeStage, computeStepState, stageReadoutText,
} from './loop/stage-machine';
import {
  ZOOM_MIN, clampZoom, stepZoomButton, stepZoomWheel,
  VERDICT_FILL, VERDICT_INK, loopVerdict,
  phaseCandidateColor, pickLabelStride,
  formatTransportTime, buildPhaseOptions,
  okLine, errorLine, staleLine, STATUS_TONE_COLOR,
} from './loop/workbench-view';
import {
  SP16_PAD_COLORS, EMPTY_PAD, padSurface, padBorder, padColor,
} from './loop/sp16-pad-colors';
import {
  detectGrid, isEngineOffline, updateGrid, sliceTrack, verifyLoops, repairLoop,
  fetchEngineAudioBuffer, fetchEngineAudioBytes,
  listEngineTracks, analyzeExisting, checkEngineHealth,
} from './loop/loopcore-client';
import {
  buildScnBytes, fetchScnSceneTemplate, isScnWriterSupported,
} from './loop/sp16-scn-writer';
import { captureLoopSessionRecipe } from './loop/loop-session';

const ACCENT = '#ec4899';
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 600;
const SP16_MAX_SECONDS = 64;
const SP16_TARGET_SAMPLE_RATE = 44100;
// Switching loops mid-playback waits for the next phrase boundary rather than
// cutting: a new loop starts on the downbeat of the next 4-bar count, so an
// audition never lands off-grid. (SP-16 pads quantize to the BEAT — they are a
// performance surface; this is a listening surface.)
const LOOP_QUANTIZE_BARS = 4;
// Loop LENGTH options: the musical short lengths (2, 4, 8 bars), then whole
// 4-bar phrases beyond that. Anything else divides the grid into lengths that
// don't line up with a phrase, which is what the count slider is for.
export function loopLengthSteps(totalBars) {
  const cap = Number.isFinite(totalBars) && totalBars > 0 ? Math.floor(totalBars) : 0;
  const steps = [2, 4, 8].filter((b) => b <= cap);
  for (let b = 12; b <= cap; b += 4) steps.push(b);
  return steps.length ? steps : [Math.max(1, cap)];
}
// Icon-only controls need an accessible name, but Chrome surfaces `aria-label`
// as a hover tooltip — and tooltips are off across this tool. Naming them with
// visually-hidden TEXT (or pointing at a visible caption) gives the same
// accessible name with nothing to hover.
const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
// Loop tile states, read at a glance across a grid of them: green = sounding
// now, muted pink = waiting for the next downbeat, orange = the one you were
// just on. Each carries its own border, fill and ring so the state survives
// both a quick scan and a colorblind one (they differ in value, not just hue).
const LOOP_TILE_STATES = {
  playing: { border: '#16a34a', fill: 'rgba(22,163,74,0.10)', ring: 'rgba(22,163,74,0.22)', ink: '#15803d' },
  queued: { border: 'rgba(236,72,153,0.5)', fill: 'rgba(236,72,153,0.07)', ring: 'rgba(236,72,153,0.16)', ink: '#9d174d' },
  last: { border: '#ea580c', fill: 'rgba(234,88,12,0.08)', ring: 'rgba(234,88,12,0.16)', ink: '#c2410c' },
};
// Timeline geometry — copied from the mockup tool's under-canvas block so the
// transport sits at the SAME y in every tool, in every state. TL_PAD is its
// 14px track inset; the track is its 32px pill (34 with the border); the row
// carries its 16px marginTop. Nothing here may grow with content: the moment
// this block changes height the stage above it resizes and the play controls
// move, which is the inconsistency this geometry exists to prevent. That is
// why the waveform is drawn SHORT and inside the pill, and why the bar ruler
// is a full-height wash behind it rather than a row of its own.
const TL_PAD = 14;
const TIMELINE_TRACK_H = 32;
const TIMELINE_ROW_MT = 16;
const WAVEFORM_H = 24;
const SP16_ACCEPTED_SAMPLE_RATES = [44100];
// Export card subtitle per target ('wav' | 'sp16' | 'edittrax').
const EXPORT_TARGET_SUBTITLE = {
  wav: 'PCM WAV',
  sp16: 'SP-16 SCENE',
  edittrax: 'EDITTRAX PLAYER',
};
const LOSSLESS_EXTS = ['wav', 'aiff', 'aif'];
const REPAIR_STRATEGIES = [
  { value: 'none', label: 'NONE (grid cut only)' },
  { value: 'equal_power_crossfade', label: 'EQUAL POWER CROSSFADE' },
  { value: 'zero_cross_snap', label: 'ZERO CROSS SNAP' },
  { value: 'microfade', label: 'MICROFADE (masks, not fixes)' },
  { value: 'silence_trim', label: 'SILENCE TRIM' },
];

// ── Settings autosave (per-browser localStorage) — same idiom ClothStudio.jsx
// uses for SETTINGS_KEY: a lazy, try/caught, module-level loader read ONCE
// into a useState initializer at mount, never touched again except by the
// debounced save effect further down. Persists the Grid/Readout/Loops-
// inspector/Export dials PLUS which source track was loaded last (a KNOWN
// ENGINE TRACKS path, or a local file's NAME only) — audio bytes are NEVER
// persisted; a local-file session restores as a "re-drop this file" prompt.
const LOOP_SETTINGS_KEY = 'loop-studio-defaults-v1';
const loadSavedDefaults = () => {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(LOOP_SETTINGS_KEY) || '{}') || {}; } catch { return {}; }
};

// ── Motion helpers (GSAP) — the ONLY 5 things that animate in this file, per
// the port spec: shell reveal stagger (once), tile stagger-in on new report,
// BPM count-up, flash pulse on updated readouts, pipeline marching-block
// busy indicator. All <=260ms, transform/opacity only; reduced-motion or a
// hidden tab collapses every one of them to an instant gsap.set().
function motionSafe() {
  if (typeof window === 'undefined') return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    return true;
  }
}

function flashPulse(el) {
  if (!el) return;
  if (!motionSafe()) return;
  gsap.killTweensOf(el);
  gsap.fromTo(el, { backgroundColor: 'rgba(236,72,153,0.28)' }, { backgroundColor: 'rgba(236,72,153,0)', duration: 0.26, ease: 'power2.out' });
}

// Same download-a-Blob idiom ClothStudio.jsx already uses (downloadBlob,
// ~L2222) — a bare <a download> click + a delayed revoke, no appendChild.
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

function sanitizeBase(name) {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'track';
}

function formatBpmForFilename(bpm) {
  const s = bpm.toFixed(2);
  return s.replace(/0+$/, '').replace(/\.$/, '') || s;
}

function sp16ProjectSafeName(name) {
  return sanitizeBase(String(name || '').replace(/\.[^.]+$/, '')).slice(0, 40) || 'Hitloop';
}

// Per-channel Float32Array views straight off the AudioBuffer — the shape
// encodeWavPcm16 (wav-encode.js) and wavesurfer's precomputed-peaks `load()`
// both expect for their channel-data param.
function channelArrays(buffer) {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
}

// Copies [startSample, endSample) out of a decoded AudioBuffer into a brand
// new one-loop-long AudioBuffer, for a fully-offline one-shot "Play slice"
// preview when no usable engine-exported file exists yet. `bufferCtor` is
// any BaseAudioContext (AudioContext/OfflineAudioContext both expose
// `createBuffer`) — reuses the component's lazily-created decode context
// rather than spinning up a new one per click.
function sliceBufferRange(source, startSample, endSample, bufferCtor) {
  const length = Math.max(1, Math.round(endSample) - Math.round(startSample));
  const out = bufferCtor.createBuffer(source.numberOfChannels, length, source.sampleRate);
  for (let ch = 0; ch < source.numberOfChannels; ch += 1) {
    const data = source.getChannelData(ch).subarray(Math.max(0, Math.round(startSample)), Math.round(endSample));
    out.copyToChannel(data, ch);
  }
  return out;
}

// ── Synthetic wavesurfer "media" — see the HARD RULE at the top of this
// file. Passing this as WaveSurfer.create()'s `media` option makes
// wavesurfer treat it as external media (Player's `isExternalMedia = true`),
// which skips BOTH creating its own <audio> element AND ever appending one
// to the DOM (wavesurfer.js's own constructor: `media ? undefined :
// this.getMediaElement()` is what it hands to the renderer to append — see
// node_modules/wavesurfer.js/dist/wavesurfer.js). We always load waveforms
// via precomputed peaks + duration (`ws.load('', channelArrays, duration)`),
// which — per wavesurfer's own loadAudio() — never touches `.src` and never
// fetches/decodes anything itself, so this shim's `src`/`play`/`pause` are
// never exercised for real; they exist purely so Player's constructor and
// event wiring don't throw. Extends the real (non-DOM) EventTarget so
// Player's `media.addEventListener(...)` calls work exactly like they would
// against a real element, including firing 'timeupdate' when we manually
// move `currentTime` (used to drive the visual playhead cursor from
// loop-player.js's own transport, never from wavesurfer's playback).
function createSilentMedia(initialDuration = 0) {
  const target = new EventTarget();
  let currentTime = 0;
  let duration = initialDuration;
  let volume = 1;
  let muted = false;
  let playbackRate = 1;
  return {
    paused: true,
    ended: false,
    seeking: false,
    src: '',
    currentSrc: '',
    get currentTime() { return currentTime; },
    set currentTime(v) { currentTime = v; target.dispatchEvent(new Event('timeupdate')); },
    get duration() { return duration; },
    set duration(v) { duration = v; target.dispatchEvent(new Event('durationchange')); },
    get volume() { return volume; },
    set volume(v) { volume = v; target.dispatchEvent(new Event('volumechange')); },
    get muted() { return muted; },
    set muted(v) { muted = v; target.dispatchEvent(new Event('volumechange')); },
    get playbackRate() { return playbackRate; },
    set playbackRate(v) { playbackRate = v; target.dispatchEvent(new Event('ratechange')); },
    canPlayType: () => '',
    play() { this.paused = false; target.dispatchEvent(new Event('play')); return Promise.resolve(); },
    pause() { this.paused = true; target.dispatchEvent(new Event('pause')); },
    removeAttribute() {},
    load() {},
    addEventListener: (...args) => target.addEventListener(...args),
    removeEventListener: (...args) => target.removeEventListener(...args),
  };
}

// ── Overlay toggle defaults ─────────────────────────────────────────────
// Every marker starts OFF: the waveform floats on the studio surface and is
// read first as a waveform. Markers are opt-in analysis, not default chrome.
// (This deliberately departs from the port spec's default table, which had
// downbeats/boundaries/click-risk on.)
// Every marker starts OFF: the waveform floats on the studio surface and is
// read first as a waveform. Markers are opt-in analysis, not default chrome.
// (Deliberately departs from the port spec's default table, which had
// downbeats/boundaries/click-risk on.)
const DEFAULT_OVERLAYS = {
  beats: false,
  downbeats: false,
  phaseCandidates: false,
  boundaries: false,
  transientRisk: false,
  clickRisk: false,
};
const OVERLAY_LABELS = {
  beats: 'BEATS',
  downbeats: 'DOWNBEATS',
  phaseCandidates: 'PHASE CANDIDATES',
  boundaries: 'BOUNDARIES',
  transientRisk: 'TRANSIENT RISK',
  clickRisk: 'CLICK RISK',
};

export default function LoopStudio({ isNarrow, railW, authedFetch = null }) {
  // Settings autosave (Feature 1) — read ONCE at mount, see loadSavedDefaults
  // above; every field below seeds its initial state from this same object.
  const [saved] = useState(loadSavedDefaults);

  // ── Source track state ──────────────────────────────────────────────
  const [audioBuffer, setAudioBuffer] = useState(null); // decoded AudioBuffer | null
  const [trackMeta, setTrackMeta] = useState(null); // { name, base, duration, sampleRate, channels, lossy }
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // ── Status text ───────────────────────────────────────────────────────
  // No longer has a pill of its own in the strip (an ANALYZING indicator took
  // that slot); this text feeds the Diagnostics card, and the tone still
  // drives its color there.
  // {text, tone}. tone drives color; text carries the workbench's own
  // [OK]/[ERROR]/[STALE] prefixes (via okLine/errorLine/staleLine) for
  // anything that came from an action, or plain text for passive states.
  const [statusMsg, setStatusMsg] = useState('');
  const [statusTone, setStatusTone] = useState('idle');
  const setStatus = useCallback((text, tone) => { setStatusMsg(text); setStatusTone(tone); }, []);

  // ── Local grid state (always-available, engine-independent) ──────────
  // Seeded from the saved settings (Feature 1) — a fresh mount with no
  // track loaded shows the LAST session's grid, ready for whenever a track
  // (auto-selected or re-dropped) next loads. A track load always re-
  // derives bpm/offsetSamples/phaseOverride from a fresh engine analysis
  // when the engine is online (see applyDecodedTrack/runDetection below),
  // same as loading any known track today — barsPerLoop/meter are the only
  // fields a track load itself never resets.
  const [bpm, setBpm] = useState(() => clampBpm(saved.bpm));
  const [bpmDraft, setBpmDraft] = useState(() => String(clampBpm(saved.bpm)));
  const [barsPerLoop, setBarsPerLoop] = useState(() => {
    const n = Math.round(Number(saved.barsPerLoop));
    return Number.isFinite(n) && n >= 1 ? Math.min(64, n) : 4;
  });
  const [offsetSamples, setOffsetSamples] = useState(() => {
    const n = Math.round(Number(saved.offsetSamples));
    return Number.isFinite(n) ? n : 0;
  });
  const [meter, setMeter] = useState(() => ([3, 4, 5, 6].includes(Number(saved.meter)) ? Number(saved.meter) : 4));
  const [phaseOverride, setPhaseOverride] = useState(null); // null = auto; else an int phase, from the Grid card's phase-candidate select — never seeded from saved settings, always resolved fresh from the next detection

  // ── Engine reachability + known-track catalog ─────────────────────────
  const [engineHealth, setEngineHealth] = useState('unknown'); // 'unknown'|'up'|'down'
  const [engineTracks, setEngineTracks] = useState([]);
  const markEngineUp = useCallback(() => setEngineHealth('up'), []);
  const markEngineDown = useCallback(() => setEngineHealth('down'), []);

  // ── Engine detection state (loopcore /api/analyze, upload or known-track) ──
  // { state: 'idle'|'running'|'done'|'offline'|'error', analysis?, contested?, message? }
  const [detection, setDetection] = useState({ state: 'idle' });
  const lastFileRef = useRef(null); // the last loaded File, for RE-DETECT on an uploaded track
  const lastEngineTrackPathRef = useRef(null); // the last-loaded KNOWN engine track's path, for RE-DETECT
  const detectionRunRef = useRef(0); // guards a late result against a newer track

  // ── Pipeline stage machine (./loop/stage-machine.js) ───────────────────
  const [engineSliceManifest, setEngineSliceManifest] = useState(null); // last /api/slice manifest
  const [verification, setVerification] = useState({ state: 'idle' }); // last /api/verify report
  const [busyStep, setBusyStep] = useState(null); // 'analyze'|'slice'|'verify'|'grid'|null — drives the Pipeline card + Grid card

  // ── Repair state ────────────────────────────────────────────────────
  const [repairStrategy, setRepairStrategy] = useState(() => (
    REPAIR_STRATEGIES.some((s) => s.value === saved.repairStrategy) ? saved.repairStrategy : 'equal_power_crossfade' // OUR default (spec explicitly keeps this, not the workbench's microfade)
  ));
  const [repairRun, setRepairRun] = useState({ state: 'idle', result: null, message: null });
  const [repairAuditionMode, setRepairAuditionMode] = useState(null); // 'repaired'|'original'|null
  // Lazily-created, REUSED AudioContext for decoding engine-hosted audio
  // (repair renders, play-xN/play-all auditions, known-track fetches) before
  // handing the AudioBuffer to player.playExternalBuffer — actual playback
  // always goes through the shared loop-player.js instance per this file's
  // HARD RULE (no bare <audio>, no second player).
  const decodeCtxRef = useRef(null);
  const getDecodeCtx = useCallback(() => {
    if (!decodeCtxRef.current) decodeCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return decodeCtxRef.current;
  }, []);

  // ── Selection / transport state ─────────────────────────────────────
  const [selectedLoopIndex, setSelectedLoopIndex] = useState(0);
  const [playingLoopIndex, setPlayingLoopIndex] = useState(null); // which loop tile/clip is the audible source right now (any mode)
  const [transportActive, setTransportActive] = useState(false); // is loop-player.js playing ANYTHING right now
  const [transportLabel, setTransportLabel] = useState('');
  const [, setTransportTick] = useState(0); // forces a re-render each rAF frame for the time readout/seek bar
  const [repeatCount, setRepeatCount] = useState(() => { // "Play xN" / Loops-card audition repeat count, 1-16 advisory (not clamped, per port-spec note 3)
    const n = Math.round(Number(saved.repeatCount));
    return Number.isFinite(n) && n >= 1 ? n : 4;
  });

  // ── Waveform view state ─────────────────────────────────────────────
  const [zoomFactor, setZoomFactor] = useState(() => clampZoom(saved.zoomFactor ?? ZOOM_MIN)); // 1 = fit
  const [overlays, setOverlays] = useState(() => {
    const savedOverlays = (saved.overlays && typeof saved.overlays === 'object') ? saved.overlays : {};
    const out = { ...DEFAULT_OVERLAYS };
    // Only a real saved boolean overrides a default — a first visit (no saved
    // overlays) must keep the spec defaults, not collapse everything to false.
    Object.keys(DEFAULT_OVERLAYS).forEach((key) => {
      if (typeof savedOverlays[key] === 'boolean') out[key] = savedOverlays[key];
    });
    return out;
  });
  const [wsReady, setWsReady] = useState(false);
  const [stripWidth, setStripWidth] = useState(0);
  const [regionDim, setRegionDim] = useState({ leadingPx: 0, trailingPx: 0 });
  const [stripScroll, setStripScroll] = useState(0);

  // ── SP-16 export/pad state (TORAIZ SP-16 hardware-sampler bridge) ─────
  const [exportTarget, setExportTarget] = useState('wav'); // 'wav' | 'sp16' | 'edittrax'
  const [sp16ProjectName, setSp16ProjectName] = useState('');
  const [sp16Pads, setSp16Pads] = useState(() => Array.from({ length: 16 }, () => null)); // loop index | null
  const [volume, setVolume] = useState(1); // master output, 0..1
  const [clickOn, setClickOn] = useState(false); // metronome at the established BPM
  const [queuedLoopIndex, setQueuedLoopIndex] = useState(null); // waiting for the next 4-bar downbeat
  const [lastPlayedLoopIndex, setLastPlayedLoopIndex] = useState(null); // the one before the current
  const [slidersOpen, setSlidersOpen] = useState(false);
  const [markersOpen, setMarkersOpen] = useState(false);
  const [sp16PlayingPad, setSp16PlayingPad] = useState(null);
  const [sp16QueuedPad, setSp16QueuedPad] = useState(null);
  const sp16PadTimerRef = useRef(null);
  const sp16ClockStartRef = useRef(null);

  // ── EDITTRAX export/player state (EditTrax web-player bridge) ─────────
  // An ORDERED PART SEQUENCE of loop indices (the same loop may appear more
  // than once) — not a pad grid. Held here, not in the panel, so the export
  // can read the assignment (and the frame's live repeat counts) directly.
  const [edittraxSlots, setEdittraxSlots] = useState([]);
  const edittraxFrameRef = useRef(null);

  // ── Rail card open state ────────────────────────────────────────────
  // Every rail card starts collapsed — the rail loads as a legible list of what
  // the tool can do, and the user opens the one they want.
  const [sourceOpen, setSourceOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [readoutOpen, setReadoutOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [loopsOpen, setLoopsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [savesOpen, setSavesOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  // ── DOM refs ─────────────────────────────────────────────────────────
  const fileInputRef = useRef(null);
  const channelDataRef = useRef(null); // per-channel Float32Array[] for the loaded track
  const wsContainerRef = useRef(null);
  const wsRef = useRef(null);
  const regionsRef = useRef(null);
  const rulerCanvasRef = useRef(null);
  const dragStateRef = useRef(null); // { startX, lastX, moved } while dragging the waveform at fit zoom
  const fitPxPerSecRef = useRef(1);
  const railInnerRef = useRef(null);
  const shellRevealedRef = useRef(false);
  const stageGridRef = useRef(null);
  const playingLoopRef = useRef(null); // mirrors playingLoopIndex for callbacks that must not re-bind
  const loopClockStartRef = useRef(null); // performance.now() of the phrase grid's origin
  const loopQueueTimerRef = useRef(null);
  const bpmHeroTweenRef = useRef(null);
  const prevHeroBpmRef = useRef(null);
  const gridStatusLineRef = useRef(null);
  const repairResultRef = useRef(null);
  const rulerRafRef = useRef(null);

  // Gapless Web-Audio-only player — one instance for the life of this
  // component. NEVER an <audio> element; see the HARD RULE up top.
  const [player] = useState(() => createLoopPlayer());
  useEffect(() => { playingLoopRef.current = playingLoopIndex; }, [playingLoopIndex]);
  useEffect(() => () => { player.stop(); }, [player]);
  useEffect(() => () => {
    if (loopQueueTimerRef.current) window.clearTimeout(loopQueueTimerRef.current);
  }, []);

  // Click track — shares the player's AudioContext and master gain, so it
  // rides the same volume control and the same user-gesture unlock.
  const [metronome] = useState(() => createMetronome({
    getContext: () => player.getContext(),
    getOutputNode: () => player.getOutputNode(),
  }));
  useEffect(() => () => { metronome.stop(); }, [metronome]);

  // Master volume — applied on change and re-applied for later sources.
  useEffect(() => { player.setVolume(volume); }, [player, volume]);

  // The click follows the ESTABLISHED grid: flipping it on, or changing BPM or
  // meter while it runs, re-origins it on the next beat rather than drifting.
  useEffect(() => {
    // The click is a play-along, not a standalone metronome: it runs only
    // while a clip is actually playing AND the toggle is on, at the
    // established BPM. Stopping the transport stops the click with it.
    if (!clickOn || !transportActive) { metronome.stop(); return undefined; }
    metronome.start({ bpm, meter, volume: 0.35 * volume });
    return () => metronome.stop();
  }, [clickOn, transportActive, bpm, meter, metronome, volume]);
  useEffect(() => () => {
    if (sp16PadTimerRef.current) window.clearTimeout(sp16PadTimerRef.current);
  }, []);

  // ── Loop slicing (pure, live-recomputed on every grid change) ───────
  // When the engine has sliced and its manifest still describes the CURRENT
  // grid params, its boundaries are authoritative — the engine bounds the
  // grid by the detected musical region (region_end can drop a trailing
  // loop the naive local walk would emit), and verify verdicts key off the
  // engine's loop indices. Any grid change diverges the params and falls
  // back to the live local walk (with the usual downstream invalidation).
  const loopsResult = useMemo(() => {
    if (!audioBuffer) return { loops: [], warnings: [] };
    const m = engineSliceManifest;
    const manifestMatchesGrid = !!m && Array.isArray(m.loops)
      && Math.abs((m.bpm ?? -1) - bpm) < 0.005
      && (m.bars_per_loop ?? -1) === barsPerLoop
      && (m.meter ?? 4) === meter
      && (m.offset_samples ?? -1) === offsetSamples;
    if (manifestMatchesGrid) {
      return {
        loops: m.loops.map((l) => ({
          index: l.index,
          startSample: l.start_sample,
          endSample: l.end_sample,
          durationSamples: l.duration_samples,
          durationSeconds: l.duration_seconds,
        })),
        warnings: m.warnings || [],
      };
    }
    return computeLoops({
      totalSamples: audioBuffer.length,
      sampleRate: audioBuffer.sampleRate,
      bpm, meter, barsPerLoop, offsetSamples,
    });
  }, [audioBuffer, bpm, meter, barsPerLoop, offsetSamples, engineSliceManifest]);
  const loops = loopsResult.loops || [];
  const warnings = loopsResult.warnings || [];
  const noCompleteLoops = !!audioBuffer && loops.length === 0;

  // -- Engine verdicts merged onto the local grid, BY INDEX -------------
  // Same origin formula on both sides means loop k here IS engine loop k --
  // but only as long as the grids haven't diverged since the last verify.
  const verdictGridMismatch = verification.state === 'done'
    && !!verification.report
    && verification.report.loops.length !== loops.length;
  const verdictByIndex = useMemo(() => {
    if (verification.state !== 'done' || !verification.report || verdictGridMismatch) return null;
    const map = new Map();
    verification.report.loops.forEach((v) => map.set(v.index, v));
    return map;
  }, [verification, verdictGridMismatch]);

  // -- Engine-sliced loop files, BY INDEX -- transport/export prefer these
  // (true source PCM, written by the same engine that ran verify) over a
  // browser re-encode, but only while they still describe the CURRENT grid.
  const engineLoopsUsable = !verdictGridMismatch
    && !!engineSliceManifest
    && engineSliceManifest.loops.length === loops.length;
  const engineLoopByIndex = useMemo(() => {
    if (!engineLoopsUsable) return null;
    const map = new Map();
    engineSliceManifest.loops.forEach((l) => map.set(l.index, l));
    return map;
  }, [engineLoopsUsable, engineSliceManifest]);

  const stage = useMemo(() => computeStage({
    hasAudio: !!audioBuffer,
    detectionDone: detection.state === 'done',
    sliceDone: !!engineSliceManifest,
    verifyDone: verification.state === 'done' && !!verification.report,
  }), [audioBuffer, detection.state, engineSliceManifest, verification]);

  const oneLoopSamples = useMemo(() => {
    if (!audioBuffer) return 0;
    return samplesPerBar({ sampleRate: audioBuffer.sampleRate, bpm, meter }) * barsPerLoop;
  }, [audioBuffer, bpm, meter, barsPerLoop]);

  const clampOffset = useCallback((value) => {
    if (!audioBuffer) return 0;
    return Math.min(audioBuffer.length, Math.max(-oneLoopSamples, value));
  }, [audioBuffer, oneLoopSamples]);

  const selectedLoop = loops.find((l) => l.index === selectedLoopIndex) || null;
  const selectedVerdict = verdictByIndex ? verdictByIndex.get(selectedLoopIndex) : null;

  // Keep the selection valid as the grid reshapes the loop list.
  useEffect(() => {
    if (loops.length && !loops.some((l) => l.index === selectedLoopIndex)) {
      setSelectedLoopIndex(loops[0].index);
    }
  }, [loops, selectedLoopIndex]);

  // ── invalidateDownstream: a LOCAL grid edit invalidates any prior engine
  // slice/verify -- the badges/exports would be lying about a grid that no
  // longer exists. Skips the very first render (nothing to invalidate yet)
  // and any run before a track is loaded.
  const gridEffectPrimed = useRef(false);
  useEffect(() => {
    if (!gridEffectPrimed.current) { gridEffectPrimed.current = true; return; }
    if (!audioBuffer) return;
    if (verification.state !== 'idle' || engineSliceManifest !== null) {
      setStatus(staleLine('grid changed — re-slice and re-verify'), 'stale');
    }
    setVerification({ state: 'idle' });
    setEngineSliceManifest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm, barsPerLoop, offsetSamples, meter]);

  // A brand-new track silently clears any stale verify/slice data from the
  // PREVIOUS track (no [STALE] message -- loadFile/loadKnownTrack already
  // set their own status).
  useEffect(() => {
    setVerification({ state: 'idle' });
    setEngineSliceManifest(null);
  }, [audioBuffer]);

  // Repair audition is scoped to ONE selected loop's verify result -- clear it
  // whenever the selection moves or a fresh verify report comes in. If a
  // repaired-buffer audition (player.mode() === 'external') was playing for
  // the loop being left behind, stop it too; a normal loop/track audition is
  // left alone (selecting a tile never stops playback).
  useEffect(() => {
    setRepairRun({ state: 'idle', result: null, message: null });
    setRepairAuditionMode(null);
    if (player.mode() === 'external') player.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLoopIndex, verification, player]);

  // ── Engine health probe (mount) + known-track catalog refresh ───────
  useEffect(() => {
    let cancelled = false;
    checkEngineHealth().then((up) => { if (!cancelled) setEngineHealth(up ? 'up' : 'down'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (engineHealth !== 'up') return undefined;
    let cancelled = false;
    listEngineTracks().then((tracks) => { if (!cancelled) setEngineTracks(tracks); }).catch(() => {});
    return () => { cancelled = true; };
  }, [engineHealth]);

  // ── Engine grid detection (Pipeline step 01 · Analyze) ────────────────
  // sourceDesc: { kind: 'upload', file } | { kind: 'known', path }.
  // Uploads (or re-analyzes a known engine track) and applies its detected
  // BPM + downbeat offset to the LOCAL grid. offset_samples/sample_rate
  // arrive in the SOURCE file's rate; the browser decodes lossless sources
  // at that SAME rate (audio-file-meta.js), so this conversion is a no-op
  // for WAV/AIFF and only actually rescales for a lossy fallback decode.
  const runDetection = useCallback(async (sourceDesc, decoded) => {
    const runId = ++detectionRunRef.current;
    setBusyStep('analyze');
    setDetection({ state: 'running' });
    setStatus('Detecting BPM + downbeat grid (engine)…', 'busy');
    try {
      const analysis = sourceDesc.kind === 'upload'
        ? await detectGrid(sourceDesc.file)
        : await analyzeExisting(sourceDesc.path);
      if (detectionRunRef.current !== runId) return;
      markEngineUp();
      const detected = clampBpm(analysis.bpm_final);
      const offsetSec = (analysis.offset_samples || 0) / (analysis.sample_rate || decoded.sampleRate);
      setBpm(detected);
      setBpmDraft(detected.toFixed(2));
      setOffsetSamples(Math.round(offsetSec * decoded.sampleRate));
      setPhaseOverride(null);
      setSelectedLoopIndex(0);
      setDetection({ state: 'done', analysis, contested: !!analysis.bpm_contested });
      const dedupedNote = analysis.uploaded?.deduped ? ' (deduped — reused an existing upload)' : '';
      setStatus(okLine(`analysis complete — ${detected.toFixed(2)} bpm${analysis.bpm_contested ? ' (contested)' : ''}${dedupedNote} — slice next`), 'ok');
    } catch (err) {
      if (detectionRunRef.current !== runId) return;
      if (isEngineOffline(err)) {
        setDetection({ state: 'offline' });
        markEngineDown();
        setStatus('Engine offline — manual BPM/grid only. Start it: services/loopcore/run.sh', 'idle');
      } else {
        setDetection({ state: 'error', message: String(err?.message || err) });
        setStatus(errorLine(`analysis failed — ${String(err?.message || err)}`), 'error');
      }
    } finally {
      if (detectionRunRef.current === runId) setBusyStep(null);
    }
  }, [markEngineDown, markEngineUp, setStatus]);

  // ── Decode + apply a track (shared by file-drop/browse and known-track load) ──
  const decodeArrayBufferAtSourceRate = useCallback(async (arrayBuffer, ext) => {
    // A regular (real-time) AudioContext decodes into ITS OWN sample rate
    // (the device output rate) -- an unwanted resample for a lossless
    // source, smearing energy across what should be a hard sample edge
    // (including a loop boundary). Parse the container header and, when
    // it's a WAV/AIFF we recognize, decode through an OfflineAudioContext
    // constructed AT that source rate instead. Lossy formats fall through
    // to a normal device-rate decode via the shared decode AudioContext.
    const meta = parseAudioFileMeta(arrayBuffer);
    let decoded = null;
    if (meta && meta.sampleRate > 0) {
      try {
        const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (OfflineCtor) {
          const offlineCtx = new OfflineCtor(Math.max(1, meta.channels || 1), 1, meta.sampleRate);
          decoded = await offlineCtx.decodeAudioData(arrayBuffer.slice(0));
        }
      } catch (err) {
        decoded = null; // fall through to the device-rate decode below
      }
    }
    if (!decoded) {
      decoded = await getDecodeCtx().decodeAudioData(arrayBuffer.slice(0));
    }
    const lossy = !LOSSLESS_EXTS.includes(ext);
    return { decoded, lossy };
  }, [getDecodeCtx]);

  const applyDecodedTrack = useCallback((decoded, { name, lossy }) => {
    channelDataRef.current = channelArrays(decoded);
    player.setBuffer(decoded);
    setAudioBuffer(decoded);
    setTrackMeta({
      name,
      base: sanitizeBase(name.replace(/\.[^./]+$/, '')),
      duration: decoded.duration,
      sampleRate: decoded.sampleRate,
      channels: decoded.numberOfChannels,
      lossy,
    });
    setSp16ProjectName(sanitizeBase(name.replace(/\.[^./]+$/, '')));
    setSp16Pads(Array.from({ length: 16 }, () => null));
    setEdittraxSlots([]);
    setSp16PlayingPad(null);
    setSp16QueuedPad(null);
    sp16ClockStartRef.current = null;
    setOffsetSamples(0);
    setPhaseOverride(null);
    setSelectedLoopIndex(0);
    setPlayingLoopIndex(null);
    setTransportActive(false);
    setTransportLabel('');
    setZoomFactor(ZOOM_MIN);
    setWsReady(false);
    setDetection({ state: 'idle' });
  }, [player]);

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus(errorLine(`file rejected — ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds the 100MB cap`), 'error');
      return;
    }
    setBusy(true);
    setStatus('Decoding audio…', 'busy');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const { decoded, lossy } = await decodeArrayBufferAtSourceRate(arrayBuffer, ext);
      if (decoded.duration > MAX_DURATION_SECONDS) {
        setStatus(errorLine(`file rejected — ${formatSeconds(decoded.duration)} exceeds the 10 minute cap`), 'error');
        return;
      }
      applyDecodedTrack(decoded, { name: file.name, lossy });
      lastFileRef.current = file;
      lastEngineTrackPathRef.current = null;
      runDetection({ kind: 'upload', file }, decoded); // deliberately not awaited - UI stays live
    } catch (err) {
      setStatus(errorLine('file rejected — could not decode audio'), 'error');
    } finally {
      setBusy(false);
    }
  }, [applyDecodedTrack, decodeArrayBufferAtSourceRate, runDetection, setStatus]);

  const loadKnownTrack = useCallback(async (path) => {
    if (!path) return;
    setBusy(true);
    setStatus(`Loading ${path}…`, 'busy');
    try {
      const bytes = await fetchEngineAudioBytes(path);
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const ext = (path.split('.').pop() || '').toLowerCase();
      const { decoded, lossy } = await decodeArrayBufferAtSourceRate(arrayBuffer, ext);
      if (decoded.duration > MAX_DURATION_SECONDS) {
        setStatus(errorLine(`file rejected — ${formatSeconds(decoded.duration)} exceeds the 10 minute cap`), 'error');
        return;
      }
      const name = path.split('/').pop() || path;
      applyDecodedTrack(decoded, { name, lossy });
      lastFileRef.current = null;
      lastEngineTrackPathRef.current = path;
      markEngineUp();
      runDetection({ kind: 'known', path }, decoded); // deliberately not awaited
    } catch (err) {
      if (isEngineOffline(err)) markEngineDown();
      setStatus(errorLine(`could not load ${path} — ${String(err?.message || err)}`), 'error');
    } finally {
      setBusy(false);
    }
  }, [applyDecodedTrack, decodeArrayBufferAtSourceRate, markEngineDown, markEngineUp, runDetection, setStatus]);

  // ── Settings autosave (Feature 1, localStorage, per-browser) ───────────
  // Debounced (~400ms) so a dragged slider/nudge button doesn't hammer
  // localStorage on every intermediate value — same idiom ClothStudio.jsx's
  // own SETTINGS_KEY effect uses (250ms there; this file uses the handoff's
  // explicit ~400ms). `lastFileRef`/`lastEngineTrackPathRef` are read
  // directly (not mirrored into extra state) — loadFile/loadKnownTrack
  // always set them synchronously in the same tick as their
  // applyDecodedTrack() call, so by the time this effect's `audioBuffer`
  // dependency fires, whichever ref is set already reflects the CURRENT
  // track. Audio bytes are never persisted — only the engine track's path
  // or the local file's NAME.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const sourceKind = lastEngineTrackPathRef.current ? 'known' : (lastFileRef.current ? 'upload' : null);
        window.localStorage.setItem(LOOP_SETTINGS_KEY, JSON.stringify({
          bpm, barsPerLoop, offsetSamples, meter, overlays, zoomFactor, repairStrategy, repeatCount,
          lastSourceKind: sourceKind,
          lastEngineTrackPath: lastEngineTrackPathRef.current || null,
          lastLocalFileName: lastFileRef.current ? lastFileRef.current.name : null,
        }));
      } catch { /* non-critical */ }
    }, 400);
    return () => clearTimeout(id);
  }, [bpm, barsPerLoop, offsetSamples, meter, overlays, zoomFactor, repairStrategy, repeatCount, audioBuffer]);

  // ── Settings restore-on-mount (Feature 1) — runs exactly once, the first
  // time the mount health probe (above) resolves out of 'unknown'. A saved
  // KNOWN ENGINE TRACK only auto-selects once the engine is confirmed
  // online (through the SAME loadKnownTrack() the dropdown itself calls, so
  // it re-runs the real analyze flow rather than faking a load); offline
  // leaves the empty-drop state with a status note instead. A saved LOCAL
  // FILE session can never auto-restore (bytes aren't persisted), so it
  // just prompts the user to re-drop it by name.
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current || engineHealth === 'unknown') return;
    restoreAttemptedRef.current = true;
    if (saved.lastSourceKind === 'known' && saved.lastEngineTrackPath) {
      if (engineHealth === 'up') {
        loadKnownTrack(saved.lastEngineTrackPath);
      } else {
        setStatus(`Engine offline — could not restore last session's track "${saved.lastEngineTrackPath}". Start it: services/loopcore/run.sh`, 'idle');
      }
    } else if (saved.lastSourceKind === 'upload' && saved.lastLocalFileName) {
      setStatus(`re-drop "${saved.lastLocalFileName}" to restore your last session`, 'idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineHealth]);

  const onFileInputChange = useCallback((e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) loadFile(file);
  }, [loadFile]);

  // Whole stage shell accepts drop at all times — including to replace an
  // already-loaded track.
  const onStageDragOver = useCallback((e) => { e.preventDefault(); setDragOver(true); }, []);
  const onStageDragLeave = useCallback(() => setDragOver(false), []);
  const onStageDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const canReDetect = !!audioBuffer && (!!lastFileRef.current || !!lastEngineTrackPathRef.current) && detection.state !== 'running';
  const runReDetect = useCallback(() => {
    if (!canReDetect || !audioBuffer) return;
    const desc = lastEngineTrackPathRef.current
      ? { kind: 'known', path: lastEngineTrackPathRef.current }
      : { kind: 'upload', file: lastFileRef.current };
    runDetection(desc, audioBuffer);
  }, [audioBuffer, canReDetect, runDetection]);

  // ── Grid: local BPM override commit + phase/offset controls ──────────
  const commitBpm = useCallback((raw) => {
    const parsed = Number(raw);
    const next = clampBpm(Number.isFinite(parsed) ? parsed : bpm);
    setBpm(next);
    setBpmDraft(String(next));
  }, [bpm]);

  const canUseDetectedBpm = detection.state === 'done'
    && Math.abs(bpm - detection.analysis.bpm_final) > 0.001;
  const useDetectedBpm = useCallback(() => {
    if (detection.state !== 'done') return;
    const detected = clampBpm(detection.analysis.bpm_final);
    setBpm(detected);
    setBpmDraft(detected.toFixed(2));
  }, [detection]);

  const nudgeOffset = useCallback((ms) => {
    if (!audioBuffer) return;
    const deltaSamples = Math.round((ms / 1000) * audioBuffer.sampleRate);
    setOffsetSamples((prev) => clampOffset(prev + deltaSamples));
  }, [audioBuffer, clampOffset]);

  // Shared by the Grid card's "Apply Grid" AND the Pipeline "Slice" step
  // (which pushes the grid before slicing — see stage-machine.js's module
  // docstring for why this deliberately differs from the workbench).
  const pushGridToEngine = useCallback(async () => {
    const srcRate = detection.analysis.sample_rate ?? audioBuffer.sampleRate;
    const detectedBpm = detection.analysis.bpm_final;
    const bpmOverride = Math.abs(bpm - detectedBpm) > 0.001 ? bpm : null;
    const offsetNudgeSamples = Math.round((offsetSamples / audioBuffer.sampleRate) * srcRate)
      - (detection.analysis.offset_samples ?? 0);
    const updated = await updateGrid({
      phaseOverride, offsetNudgeSamples, bpmOverride, barsPerLoop,
    });
    setDetection((prev) => (prev.state === 'done' ? { ...prev, analysis: updated, contested: !!updated.bpm_contested } : prev));
    const newOffsetSec = (updated.offset_samples || 0) / (updated.sample_rate || audioBuffer.sampleRate);
    setOffsetSamples(Math.round(newOffsetSec * audioBuffer.sampleRate));
    if (bpmOverride == null) {
      const d = clampBpm(updated.bpm_final);
      setBpm(d);
      setBpmDraft(d.toFixed(2));
    }
    return updated;
  }, [audioBuffer, bpm, barsPerLoop, detection, offsetSamples, phaseOverride]);

  const applyGridStep = useCallback(async () => {
    if (!audioBuffer || detection.state !== 'done' || !detection.analysis || busyStep) return;
    setBusyStep('grid');
    setStatus('Applying grid (engine)…', 'busy');
    try {
      await pushGridToEngine();
      markEngineUp();
      setEngineSliceManifest(null);
      setVerification({ state: 'idle' });
      setStatus(staleLine('grid moved — re-slice and re-verify'), 'stale');
    } catch (err) {
      if (isEngineOffline(err)) {
        markEngineDown();
        setStatus('Engine offline — grid apply unavailable.', 'idle');
      } else {
        setStatus(errorLine(`apply grid failed — ${String(err?.message || err)}`), 'error');
      }
    } finally {
      setBusyStep(null);
    }
  }, [audioBuffer, busyStep, detection, markEngineDown, markEngineUp, pushGridToEngine, setStatus]);

  // ── Pipeline · 02 Slice — push grid, then engine-slice ────────────────
  const runSliceStep = useCallback(async () => {
    if (!audioBuffer || detection.state !== 'done' || !detection.analysis || busyStep) return;
    if (noCompleteLoops) {
      setStatus(errorLine(`${barsPerLoop} bars per loop is longer than this track`), 'error');
      return;
    }
    setBusyStep('slice');
    setStatus('Pushing grid + slicing (engine)…', 'busy');
    try {
      const updated = await pushGridToEngine();
      const manifest = await sliceTrack(updated.source_path, barsPerLoop);
      setEngineSliceManifest(manifest && Array.isArray(manifest.loops) ? manifest : null);
      setVerification({ state: 'idle' });
      markEngineUp();
      setStatus(okLine('loops written — verify next'), 'ok');
    } catch (err) {
      setEngineSliceManifest(null);
      if (isEngineOffline(err)) {
        markEngineDown();
        setStatus('Engine offline — slice unavailable.', 'idle');
      } else {
        setStatus(errorLine(`slice failed — ${String(err?.message || err)}`), 'error');
      }
    } finally {
      setBusyStep(null);
    }
  }, [audioBuffer, barsPerLoop, busyStep, detection, markEngineDown, markEngineUp, noCompleteLoops, pushGridToEngine, setStatus]);

  // ── Pipeline · 03 Verify — also reused (deliberately) by "Play xN" ────
  const runVerifyStep = useCallback(async ({ selectLoop = 0, repeatCountOverride } = {}) => {
    if (!engineSliceManifest || busyStep) return null;
    setBusyStep('verify');
    setStatus('Verifying loops (engine)…', 'busy');
    try {
      const report = await verifyLoops(selectLoop, repeatCountOverride ?? repeatCount);
      setVerification({ state: 'done', report });
      markEngineUp();
      const s = report.summary || {};
      setStatus(okLine(`${s.total ?? 0} loops — ${s.pass ?? 0} pass ${s.warn ?? 0} warn ${s.fail ?? 0} fail`), s.fail ? 'error' : (s.warn ? 'stale' : 'ok'));
      return report;
    } catch (err) {
      if (isEngineOffline(err)) {
        setVerification({ state: 'offline' });
        markEngineDown();
        setStatus('Engine offline — verify unavailable.', 'idle');
      } else {
        setVerification({ state: 'error', message: String(err?.message || err) });
        setStatus(errorLine(`verify failed — ${String(err?.message || err)}`), 'error');
      }
      return null;
    } finally {
      setBusyStep(null);
    }
  }, [busyStep, engineSliceManifest, markEngineDown, markEngineUp, repeatCount, setStatus]);

  // ── Pipeline · 04 Export — client-side only, no backend call ──────────
  const exportReportStep = useCallback(() => {
    if (!verification.report) return;
    downloadBlob(new Blob([JSON.stringify(verification.report, null, 2)], { type: 'application/json' }), 'verification_report.json');
    setStatus(okLine('verification_report.json saved'), 'ok');
  }, [setStatus, verification.report]);

  const pipelineStepHandlers = {
    analyze: runReDetect,
    slice: runSliceStep,
    verify: () => runVerifyStep({ selectLoop: 0 }),
    export: exportReportStep,
  };

  // ── Repair ──────────────────────────────────────────────────────────
  const renderRepair = useCallback(async () => {
    if (!selectedLoop) return;
    if (repairStrategy === 'none') {
      // Client-side baseline — the exact grid cut, no engine call.
      const base = selectedVerdict || {};
      setRepairRun({
        state: 'done',
        result: {
          strategy: 'none',
          requested_strategy: 'none',
          note: 'exact grid cut, no repair applied',
          before: {
            end_to_start_jump_zscore: base.end_to_start_jump_zscore ?? null,
            end_to_start_raw_jump: base.end_to_start_raw_jump ?? null,
            chroma_start_end_similarity: base.chroma_start_end_similarity ?? null,
          },
          after: {
            end_to_start_jump_zscore: base.end_to_start_jump_zscore ?? null,
            end_to_start_raw_jump: base.end_to_start_raw_jump ?? null,
            chroma_start_end_similarity: base.chroma_start_end_similarity ?? null,
          },
          improved: false,
          isNone: true,
        },
        message: null,
      });
      return;
    }
    setRepairRun({ state: 'running', result: null, message: null });
    try {
      const result = await repairLoop(selectedLoopIndex, repairStrategy);
      setRepairRun({ state: 'done', result, message: null });
      markEngineUp();
    } catch (err) {
      if (isEngineOffline(err)) {
        setRepairRun({ state: 'offline', result: null, message: null });
        markEngineDown();
      } else {
        setRepairRun({ state: 'error', result: null, message: String(err?.message || err) });
      }
    }
  }, [markEngineDown, markEngineUp, repairStrategy, selectedLoop, selectedLoopIndex, selectedVerdict]);

  useEffect(() => {
    if (repairRun.state === 'done') flashPulse(repairResultRef.current);
  }, [repairRun]);

  // ── Transport primitives ───────────────────────────────────────────
  const parkCursorAt = useCallback((seconds) => {
    if (wsRef.current && wsReady && Number.isFinite(seconds)) {
      try { wsRef.current.setTime(Math.max(0, seconds)); } catch (err) { /* noop */ }
    }
  }, [wsReady]);

  // Every new playback source clears any SP-16 pad highlight by default
  // (the pad grid and the rest of transport share the SAME underlying
  // player — only one thing is ever "the" active source). SP-16's own
  // startSp16PadNow passes clearSp16:false since it sets the pad state
  // itself immediately after.
  const beginTransport = useCallback((label, { clearSp16 = true } = {}) => {
    setTransportActive(true);
    setTransportLabel(label);
    if (clearSp16) { setSp16PlayingPad(null); setSp16QueuedPad(null); }
  }, []);

  const handleStop = useCallback(() => {
    if (sp16PadTimerRef.current) {
      window.clearTimeout(sp16PadTimerRef.current);
      sp16PadTimerRef.current = null;
    }
    if (loopQueueTimerRef.current) {
      window.clearTimeout(loopQueueTimerRef.current);
      loopQueueTimerRef.current = null;
    }
    loopClockStartRef.current = null;
    if (playingLoopRef.current != null) setLastPlayedLoopIndex(playingLoopRef.current);
    player.stop();
    setTransportActive(false);
    setPlayingLoopIndex(null);
    setQueuedLoopIndex(null);
    setRepairAuditionMode(null);
    setTransportLabel('');
    setSp16PlayingPad(null);
    setSp16QueuedPad(null);
  }, [player]);

  // Click a stage tile OR a waveform clip region: select + gapless audition
  // of the SOURCE region from the local decoded buffer (always available,
  // offline-safe, sample-identical to the engine's own cut).
  const startLoopNow = useCallback((loop) => {
    const previous = playingLoopRef.current;
    if (previous != null && previous !== loop.index) setLastPlayedLoopIndex(previous);
    player.playLoop({ startSample: loop.startSample, endSample: loop.endSample });
    if (loopClockStartRef.current == null) loopClockStartRef.current = performance.now();
    setSelectedLoopIndex(loop.index);
    setPlayingLoopIndex(loop.index);
    setQueuedLoopIndex(null);
    setRepairAuditionMode(null);
    beginTransport(`LOOP ${String(loop.index + 1).padStart(2, '0')}`);
  }, [beginTransport, player]);

  const toggleLoopPlay = useCallback((loop) => {
    // Already playing this one -> stop. Already QUEUED this one -> cancel the
    // queue and keep what's playing; a second click should undo the request,
    // not stack another.
    if (playingLoopIndex === loop.index && player.mode() === 'loop') {
      handleStop();
      return;
    }
    if (queuedLoopIndex === loop.index) {
      if (loopQueueTimerRef.current) {
        window.clearTimeout(loopQueueTimerRef.current);
        loopQueueTimerRef.current = null;
      }
      setQueuedLoopIndex(null);
      return;
    }
    if (loopQueueTimerRef.current) {
      window.clearTimeout(loopQueueTimerRef.current);
      loopQueueTimerRef.current = null;
    }

    // Nothing playing -> start immediately and open the phrase grid here.
    const playing = playingLoopIndex != null && player.mode() === 'loop';
    if (!playing || loopClockStartRef.current == null) {
      loopClockStartRef.current = performance.now();
      startLoopNow(loop);
      return;
    }

    // Otherwise wait for the downbeat of the next 4-bar count.
    const wait = nextPhraseWaitMs({
      nowMs: performance.now(),
      clockStartMs: loopClockStartRef.current,
      bpm,
      meter,
      bars: LOOP_QUANTIZE_BARS,
    });
    if (wait <= 0) { startLoopNow(loop); return; }
    setSelectedLoopIndex(loop.index);
    setQueuedLoopIndex(loop.index);
    loopQueueTimerRef.current = window.setTimeout(() => {
      loopQueueTimerRef.current = null;
      startLoopNow(loop);
    }, wait);
  }, [bpm, handleStop, meter, player, playingLoopIndex, queuedLoopIndex, startLoopNow]);

  // Transport dock — "Play slice" (one-shot).
  const transportPlaySlice = useCallback(async () => {
    if (!selectedLoop || !audioBuffer) return;
    const engineLoop = engineLoopByIndex ? engineLoopByIndex.get(selectedLoop.index) : null;
    try {
      let buf;
      if (engineLoop && engineLoop.path) {
        buf = await fetchEngineAudioBuffer(engineLoop.path, getDecodeCtx());
        markEngineUp();
      } else {
        buf = sliceBufferRange(audioBuffer, selectedLoop.startSample, selectedLoop.endSample, getDecodeCtx());
      }
      player.playExternalBuffer(buf, { loop: false });
      parkCursorAt(selectedLoop.startSample / audioBuffer.sampleRate);
      setPlayingLoopIndex(selectedLoop.index);
      beginTransport('PLAY SLICE');
    } catch (err) {
      if (isEngineOffline(err)) markEngineDown();
    }
  }, [audioBuffer, beginTransport, engineLoopByIndex, getDecodeCtx, markEngineDown, markEngineUp, parkCursorAt, player, selectedLoop]);

  // Transport dock — "Loop" (prefer the engine's exported/verified file,
  // gapless; fall back to the local source region, same as tile-click).
  const transportLoop = useCallback(async () => {
    if (!selectedLoop || !audioBuffer) return;
    const engineLoop = engineLoopByIndex ? engineLoopByIndex.get(selectedLoop.index) : null;
    if (engineLoop && engineLoop.path && verification.state === 'done') {
      try {
        const buf = await fetchEngineAudioBuffer(engineLoop.path, getDecodeCtx());
        player.playExternalBuffer(buf, { loop: true });
        parkCursorAt(selectedLoop.startSample / audioBuffer.sampleRate);
        markEngineUp();
      } catch (err) {
        if (isEngineOffline(err)) markEngineDown();
        player.playLoop({ startSample: selectedLoop.startSample, endSample: selectedLoop.endSample });
      }
    } else {
      player.playLoop({ startSample: selectedLoop.startSample, endSample: selectedLoop.endSample });
    }
    setPlayingLoopIndex(selectedLoop.index);
    setRepairAuditionMode(null);
    beginTransport('LOOP (EXPORTED)');
  }, [audioBuffer, beginTransport, engineLoopByIndex, getDecodeCtx, markEngineDown, markEngineUp, parkCursorAt, player, selectedLoop, verification.state]);

  // Transport dock — "From source" (always the local source region, even
  // when an engine/repair render is available — useful for A/B).
  const transportFromSource = useCallback(() => {
    if (!selectedLoop) return;
    player.playLoop({ startSample: selectedLoop.startSample, endSample: selectedLoop.endSample });
    setPlayingLoopIndex(selectedLoop.index);
    setRepairAuditionMode(null);
    beginTransport('FROM SOURCE');
  }, [beginTransport, player, selectedLoop]);

  // Transport dock — "Play xN": re-verifies select_loop=selected with the
  // current repeat count (OVERWRITING state.report — deliberate, mirrors
  // the workbench per the port spec's porting note 4), then plays the
  // engine's pre-rendered repeat audition once through.
  const transportPlayRepeat = useCallback(async () => {
    if (!selectedLoop || !engineSliceManifest) return;
    const report = await runVerifyStep({ selectLoop: selectedLoop.index, repeatCountOverride: repeatCount });
    if (!report) return;
    const path = report.audition_loop_repeat || report.audition_loop_x4;
    if (!path) return;
    try {
      const buf = await fetchEngineAudioBuffer(path, getDecodeCtx());
      player.playExternalBuffer(buf, { loop: false });
      parkCursorAt(selectedLoop.startSample / (audioBuffer?.sampleRate || 1));
      markEngineUp();
      beginTransport(`PLAY x${repeatCount}`);
    } catch (err) {
      if (isEngineOffline(err)) markEngineDown();
    }
  }, [audioBuffer, beginTransport, engineSliceManifest, getDecodeCtx, markEngineDown, markEngineUp, parkCursorAt, player, repeatCount, runVerifyStep, selectedLoop]);

  // Transport dock — "Play all" (uses the EXISTING report, no re-verify).
  const transportPlayAll = useCallback(async () => {
    const path = verification.report?.audition_all_segments;
    if (!path) return;
    try {
      const buf = await fetchEngineAudioBuffer(path, getDecodeCtx());
      player.playExternalBuffer(buf, { loop: false });
      if (selectedLoop && audioBuffer) parkCursorAt(selectedLoop.startSample / audioBuffer.sampleRate);
      markEngineUp();
      beginTransport('PLAY ALL');
    } catch (err) {
      if (isEngineOffline(err)) markEngineDown();
    }
  }, [audioBuffer, beginTransport, getDecodeCtx, markEngineDown, markEngineUp, parkCursorAt, player, selectedLoop, verification.report]);

  // Transport dock / Repair card — "Play repair" (gapless).
  const playRepaired = useCallback(async () => {
    if (!repairRun.result) return;
    try {
      if (repairRun.result.isNone && selectedLoop) {
        player.playLoop({ startSample: selectedLoop.startSample, endSample: selectedLoop.endSample });
      } else if (repairRun.result.audio_url) {
        const buf = await fetchEngineAudioBuffer(repairRun.result.audio_url, getDecodeCtx());
        player.playExternalBuffer(buf, { loop: true });
        if (selectedLoop && audioBuffer) parkCursorAt(selectedLoop.startSample / audioBuffer.sampleRate);
        markEngineUp();
      } else {
        return;
      }
      setPlayingLoopIndex(null);
      setRepairAuditionMode('repaired');
      beginTransport('PLAY REPAIR');
    } catch (err) {
      if (isEngineOffline(err)) markEngineDown();
      setRepairRun((prev) => ({ ...prev, message: `Playback failed — ${String(err?.message || err)}` }));
    }
  }, [audioBuffer, beginTransport, getDecodeCtx, markEngineDown, markEngineUp, parkCursorAt, player, repairRun.result, selectedLoop]);

  const handlePlayOriginalForRepair = useCallback(() => {
    if (!selectedLoop) return;
    const wasPlayingThis = playingLoopIndex === selectedLoop.index && player.mode() === 'loop';
    toggleLoopPlay(selectedLoop);
    setRepairAuditionMode(wasPlayingThis ? null : 'original');
  }, [player, playingLoopIndex, selectedLoop, toggleLoopPlay]);

  // ── SP-16 pad transport (TORAIZ SP-16 export/live-trigger bridge) ────
  const startSp16PadNow = useCallback((padIndex) => {
    const loopIndex = sp16Pads[padIndex];
    const loop = loops.find((l) => l.index === loopIndex);
    if (!loop) return;
    player.playLoop({ startSample: loop.startSample, endSample: loop.endSample });
    sp16ClockStartRef.current = performance.now();
    setSelectedLoopIndex(loop.index);
    setPlayingLoopIndex(loop.index);
    setRepairAuditionMode(null);
    beginTransport(`SP16 PAD ${String(padIndex + 1).padStart(2, '0')}`, { clearSp16: false });
    setSp16PlayingPad(padIndex);
    setSp16QueuedPad(null);
  }, [beginTransport, loops, player, sp16Pads]);

  const triggerSp16Pad = useCallback((padIndex) => {
    if (!audioBuffer) return;
    if (sp16Pads[padIndex] == null) return;
    if (sp16PlayingPad === padIndex) {
      handleStop();
      return;
    }
    if (sp16PadTimerRef.current) {
      window.clearTimeout(sp16PadTimerRef.current);
      sp16PadTimerRef.current = null;
    }
    if (sp16PlayingPad == null || !sp16ClockStartRef.current) {
      startSp16PadNow(padIndex);
      return;
    }
    const beatMs = 60000 / bpm;
    const elapsed = performance.now() - sp16ClockStartRef.current;
    const wait = Math.max(0, beatMs - (elapsed % beatMs));
    setSp16QueuedPad(padIndex);
    sp16PadTimerRef.current = window.setTimeout(() => {
      sp16PadTimerRef.current = null;
      startSp16PadNow(padIndex);
    }, wait);
  }, [audioBuffer, bpm, handleStop, sp16Pads, sp16PlayingPad, startSp16PadNow]);

  const onLoopDragStart = useCallback((e, loop) => {
    e.dataTransfer.setData('text/x-hitloop-loop-index', String(loop.index));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const assignSp16Pad = useCallback((padIndex, loopIndex) => {
    if (!loops.some((l) => l.index === loopIndex)) return;
    setSp16Pads((prev) => prev.map((value, i) => (i === padIndex ? loopIndex : value)));
  }, [loops]);

  const clearSp16Pad = useCallback((padIndex) => {
    setSp16Pads((prev) => prev.map((value, i) => (i === padIndex ? null : value)));
    if (sp16PlayingPad === padIndex) handleStop();
    if (sp16QueuedPad === padIndex) setSp16QueuedPad(null);
  }, [handleStop, sp16PlayingPad, sp16QueuedPad]);

  const onSp16PadDrop = useCallback((e, padIndex) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/x-hitloop-loop-index');
    const loopIndex = Number(raw);
    if (Number.isInteger(loopIndex)) assignSp16Pad(padIndex, loopIndex);
  }, [assignSp16Pad]);

  // ── rAF transport loop — drives the time readout/seek bar, and (mode
  // 'loop' only) the wavesurfer cursor; an 'external' buffer parks the
  // cursor ONCE at play-start (done at each call site above) rather than
  // tracking continuously — see the port spec's zoom-panel bullet.
  useEffect(() => {
    if (!transportActive) return undefined;
    let raf = null;
    const tick = () => {
      if (!player.isPlaying()) {
        setTransportActive(false);
        setPlayingLoopIndex(null);
        setTransportLabel('');
        setSp16PlayingPad(null);
        setSp16QueuedPad(null);
        return;
      }
      if (player.mode() === 'loop' && audioBuffer) {
        const ph = player.getPlayhead();
        if (ph != null) parkCursorAt(ph);
      }
      setTransportTick((t) => (t + 1) % 1000000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [audioBuffer, parkCursorAt, player, transportActive]);

  const transportDuration = transportActive ? player.getDuration() : 0;
  const transportPosition = transportActive ? (player.getPlayhead() ?? 0) : 0;
  const transportPositionLocal = transportActive && player.mode() === 'loop'
    ? Math.max(0, transportPosition - (selectedLoop ? selectedLoop.startSample / (audioBuffer?.sampleRate || 1) : 0))
    : transportPosition;

  const seekFraction = useCallback((fraction) => {
    if (!transportActive) return;
    const dur = player.getDuration();
    if (!dur) return;
    const clamped = Math.min(1, Math.max(0, fraction));
    if (player.mode() === 'loop') {
      const base = selectedLoop ? selectedLoop.startSample / (audioBuffer?.sampleRate || 1) : 0;
      player.seek(base + clamped * dur);
    } else {
      player.seek(clamped * dur);
    }
  }, [audioBuffer, player, selectedLoop, transportActive]);

  const playheadDragRef = useRef(false);

  const seekToClientX = useCallback((clientX) => {
    const mount = wsContainerRef.current;
    if (!mount || !transportActive) return;
    const rect = mount.getBoundingClientRect();
    const pxPerSec = Math.max(1, fitPxPerSecRef.current * zoomFactor);
    const sec = (clientX - rect.left + stripScroll) / pxPerSec;
    player.seek(Math.max(0, sec));
  }, [player, stripScroll, transportActive, zoomFactor]);

  const onPlayheadPointerDown = useCallback((e) => {
    if (!transportActive) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    playheadDragRef.current = true;
  }, [transportActive]);

  const onPlayheadPointerMove = useCallback((e) => {
    if (!playheadDragRef.current) return;
    seekToClientX(e.clientX);
  }, [seekToClientX]);

  const onPlayheadPointerUp = useCallback((e) => {
    if (!playheadDragRef.current) return;
    playheadDragRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);

  const onSeekBarKeyDown = useCallback((e) => {
    if (!transportActive) return;
    const dur = player.getDuration() || 1;
    const cur = transportPositionLocal;
    if (e.key === 'ArrowLeft') { e.preventDefault(); seekFraction((cur - dur * 0.02) / dur); }
    if (e.key === 'ArrowRight') { e.preventDefault(); seekFraction((cur + dur * 0.02) / dur); }
  }, [player, seekFraction, transportActive, transportPositionLocal]);

  // ── Export (WAV downloads) ─────────────────────────────────────────
  const trackBase = trackMeta?.base || 'loop-studio-track';
  const bpmLabel = formatBpmForFilename(bpm);
  const buildChannelData = useCallback(() => channelArrays(audioBuffer), [audioBuffer]);
  const loopFilename = useCallback((loop) => (
    `${trackBase}-loop${String(loop.index + 1).padStart(2, '0')}-${bpmLabel}bpm-${barsPerLoop}bar.wav`
  ), [trackBase, bpmLabel, barsPerLoop]);

  const downloadLoop = useCallback(async (loop) => {
    if (!audioBuffer) return;
    const engineLoop = engineLoopByIndex ? engineLoopByIndex.get(loop.index) : null;
    if (engineLoop && engineLoop.path) {
      try {
        const bytes = await fetchEngineAudioBytes(engineLoop.path);
        downloadBlob(new Blob([bytes], { type: 'audio/wav' }), loopFilename(loop));
        return;
      } catch (err) { /* fall through to the local re-encode below */ }
    }
    const wavBytes = encodeWavPcm16({
      channelData: buildChannelData(),
      sampleRate: audioBuffer.sampleRate,
      startSample: loop.startSample,
      endSample: loop.endSample,
    });
    downloadBlob(new Blob([wavBytes], { type: 'audio/wav' }), loopFilename(loop));
  }, [audioBuffer, buildChannelData, loopFilename, engineLoopByIndex]);

  const downloadAllZip = useCallback(async () => {
    if (!audioBuffer || !loops.length) return;
    let entries = null;
    if (engineLoopsUsable) {
      try {
        entries = await Promise.all(loops.map(async (loop) => {
          const engineLoop = engineLoopByIndex.get(loop.index);
          const bytes = await fetchEngineAudioBytes(engineLoop.path);
          return { name: loopFilename(loop), data: bytes };
        }));
      } catch (err) {
        entries = null;
      }
    }
    if (!entries) {
      const channelData = buildChannelData();
      entries = loops.map((loop) => ({
        name: loopFilename(loop),
        data: encodeWavPcm16({
          channelData, sampleRate: audioBuffer.sampleRate, startSample: loop.startSample, endSample: loop.endSample,
        }),
      }));
    }
    const zipBytes = buildStoreZip(entries);
    downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), `${trackBase}-loops-${bpmLabel}bpm-${barsPerLoop}bar.zip`);
  }, [audioBuffer, loops, buildChannelData, loopFilename, trackBase, bpmLabel, barsPerLoop, engineLoopsUsable, engineLoopByIndex]);

  // ── SP-16 export (TORAIZ SP-16 hardware-sampler project + resampled zip) ──
  const assignedPadNumbersByLoop = useMemo(() => {
    const map = new Map();
    sp16Pads.forEach((loopIndex, padIndex) => {
      if (loopIndex == null) return;
      const list = map.get(loopIndex) || [];
      list.push(padIndex + 1);
      map.set(loopIndex, list);
    });
    return map;
  }, [sp16Pads]);

  const assignedPads = useMemo(() => sp16Pads
    .map((loopIndex, padIndex) => ({ padIndex, loop: loops.find((l) => l.index === loopIndex) || null }))
    .filter((p) => p.loop), [sp16Pads, loops]);

  const sp16ProjectBase = sp16ProjectSafeName(sp16ProjectName || trackBase);
  const sp16SampleRate = SP16_ACCEPTED_SAMPLE_RATES.includes(Math.round(audioBuffer?.sampleRate || 0))
    ? Math.round(audioBuffer.sampleRate)
    : SP16_TARGET_SAMPLE_RATE;
  const sp16HasTooLongAssignedLoop = assignedPads.some(({ loop }) => loop.durationSeconds > SP16_MAX_SECONDS);

  // ── Stage layout ────────────────────────────────────────────────────────
  // The only layout decision JS makes here is WHICH panels exist. How they sit
  // (side by side vs stacked, and how big the pad square is) is pure CSS
  // container queries in `#loop-stage-styles` below — deliberately not a
  // ResizeObserver, because observers and rAF are frozen in a background tab
  // and the stage would then paint at whatever size it last measured.
  const showSp16Panel = exportTarget === 'sp16';
  const showEdittraxPanel = exportTarget === 'edittrax';

  // Switching export target hands the stage to a different workspace; stop the
  // studio transport first so this file's player and the EDITTRAX panel's
  // embedded Tone.js player can never sound over each other.
  const selectExportTarget = useCallback((target) => {
    if (target === exportTarget) return;
    handleStop();
    setExportTarget(target);
  }, [exportTarget, handleStop]);

  const sp16SampleFilename = useCallback((padIndex, loop) => (
    `${sp16ProjectSafeName(trackBase)}-pad${String(padIndex + 1).padStart(2, '0')}-loop${String(loop.index + 1).padStart(2, '0')}.wav`
  ), [trackBase]);

  // ⚠️ SUPERSEDED by the `.scn` scene export below — kept, unreachable, only
  // as the rollback path until the SP-16 hardware acceptance test on `.scn`
  // passes; `docs/plans/SP16-SCN-EXPORT-HANDOFF.md` Gate 3 deletes it (with
  // `app/api/dashboard/sp16-project/route.js` and the repo-root demo `.prj`).
  // Nothing in the UI calls `downloadSp16Zip` any more.
  const buildSp16WavEntry = useCallback(({ padIndex, loop }) => {
    const sourceRate = audioBuffer.sampleRate;
    const sourceChannels = buildChannelData();
    const channelData = resampleChannelData(sourceChannels, sourceRate, sp16SampleRate, loop.startSample, loop.endSample);
    const wavBytes = encodeWavPcm16({
      channelData,
      sampleRate: sp16SampleRate,
      startSample: 0,
      endSample: channelData[0]?.length || 0,
    });
    const filename = sp16SampleFilename(padIndex, loop);
    return {
      filename,
      internalPath: `$Int0/%Smp/Hitloop/${sp16ProjectBase}/${filename}`,
      zipPath: `TORAIZ/Samples/Hitloop/${sp16ProjectBase}/${filename}`,
      data: wavBytes,
      lengthSamples: channelData[0]?.length || 0,
    };
  }, [audioBuffer, buildChannelData, sp16ProjectBase, sp16SampleFilename, sp16SampleRate]);

  const downloadSp16Zip = useCallback(async () => {
    if (!audioBuffer || !assignedPads.length || sp16HasTooLongAssignedLoop) return;
    setStatus('Building SP-16 project…', 'busy');
    try {
      const sampleEntries = assignedPads.map(buildSp16WavEntry);
      const res = await fetch('/api/dashboard/sp16-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: sp16ProjectBase,
          bpm,
          assignments: sampleEntries.map((entry, i) => ({
            padIndex: assignedPads[i].padIndex,
            samplePath: entry.internalPath,
            lengthSamples: entry.lengthSamples,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `SP-16 project failed (${res.status})`);
      }
      const projectBytes = new Uint8Array(await res.arrayBuffer());
      const zipBytes = buildStoreZip([
        { name: `TORAIZ/SP-16 Projects/${sp16ProjectBase}.prj`, data: projectBytes },
        ...sampleEntries.map((entry) => ({ name: entry.zipPath, data: entry.data })),
      ]);
      downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), `${sp16ProjectBase}-sp16-project.zip`);
      setStatus(okLine(`${sp16ProjectBase}-sp16-project.zip saved`), 'ok');
    } catch (err) {
      setStatus(errorLine(`SP-16 export failed — ${String(err?.message || err)}`), 'error');
    }
  }, [assignedPads, audioBuffer, bpm, buildSp16WavEntry, setStatus, sp16HasTooLongAssignedLoop, sp16ProjectBase]);

  // ── SP-16 SCENE export (.scn — the shipped path) ──────────────────────
  // The writer itself (TLV patching, uid.spid, .dat sidecars, zip) is the
  // pure, node-tested ./loop/sp16-scn-writer.js. Everything here is the
  // browser glue it can't own: audio bytes, the fetched template, download.
  const sp16TemplateRef = useRef(null);

  // The SAME bytes the WAV export downloads: engine-repaired PCM whenever the
  // engine's slices still describe the current grid, else a re-cut of the
  // decoded buffer. (The retired `.prj` path always re-cut raw, so every
  // repair — crossfade, zero-cross snap, microfade, silence trim — was
  // missing from the samples that actually reached the hardware.)
  const sp16LoopBytes = useCallback(async (loop) => {
    const engineLoop = engineLoopByIndex ? engineLoopByIndex.get(loop.index) : null;
    if (engineLoop && engineLoop.path) {
      try {
        return await fetchEngineAudioBytes(engineLoop.path);
      } catch (err) { /* fall through to the local re-encode below */ }
    }
    return encodeWavPcm16({
      channelData: buildChannelData(),
      sampleRate: audioBuffer.sampleRate,
      startSample: loop.startSample,
      endSample: loop.endSample,
    });
  }, [audioBuffer, buildChannelData, engineLoopByIndex]);

  // The SP-16 wants 44.1k. When the bytes are anything else, resample by
  // DECODING them through an OfflineAudioContext built AT 44.1k — the
  // browser's own filtered resampler — never `resampleChannelData`, whose
  // unfiltered linear interpolation aliases audibly on hats at the common
  // 48k → 44.1k step every lossy source lands on.
  const conformSp16Wav = useCallback(async (bytes) => {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const meta = parseAudioFileMeta(arrayBuffer);
    if (meta && meta.sampleRate === SP16_TARGET_SAMPLE_RATE && meta.bitsPerSample === 16 && meta.frameCount > 0) {
      return { wavBytes: bytes, frames: meta.frameCount };
    }
    const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtor) throw new Error('this browser cannot resample to 44.1 kHz');
    const ctx = new OfflineCtor(Math.max(1, meta?.channels || 2), 1, SP16_TARGET_SAMPLE_RATE);
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    return {
      wavBytes: encodeWavPcm16({ channelData: channelArrays(decoded), sampleRate: SP16_TARGET_SAMPLE_RATE }),
      frames: decoded.length,
    };
  }, []);

  const downloadSp16Scene = useCallback(async () => {
    if (!audioBuffer || !assignedPads.length || sp16HasTooLongAssignedLoop) return;
    if (!isScnWriterSupported()) {
      setStatus(errorLine('SP-16 export needs CompressionStream — use Chrome, Edge or Opera.'), 'error');
      return;
    }
    setStatus('Building SP-16 scene…', 'busy');
    try {
      if (!sp16TemplateRef.current) sp16TemplateRef.current = await fetchScnSceneTemplate();
      // Pads are prepared one at a time on purpose: conforming runs a real
      // decode, and 16 OfflineAudioContexts at once is how a tab stalls.
      const pads = [];
      for (const { padIndex, loop } of assignedPads) {
        // eslint-disable-next-line no-await-in-loop
        const { wavBytes, frames } = await conformSp16Wav(await sp16LoopBytes(loop));
        pads.push({
          padIndex,
          filename: sp16SampleFilename(padIndex, loop),
          wavBytes,
          frames,
          bpm,
          colourIndex: padIndex, // pad NUMBER keys the color, on screen and on the unit
        });
      }
      const built = await buildScnBytes({
        templateBytes: sp16TemplateRef.current,
        sceneName: sp16ProjectBase,
        projectBpm: bpm,
        barsPerLoop,
        pads,
      });
      downloadBlob(new Blob([built.bytes], { type: 'application/octet-stream' }), built.filename);
      // A blank template carries no patterns. Anything else means the export
      // ships the template scene's recorded sequence too — say so rather than
      // let it surprise the user on the unit.
      const patternNote = built.patternCount
        ? ` (template carries ${built.patternCount} pattern block${built.patternCount === 1 ? '' : 's'})`
        : '';
      setStatus(okLine(`${built.filename} saved — copy to PIONEER DJ SAMPLER/Scenes, import via Scene Manager${patternNote}`), 'ok');
    } catch (err) {
      setStatus(errorLine(`SP-16 export failed — ${String(err?.message || err)}`), 'error');
    }
  }, [
    assignedPads, audioBuffer, barsPerLoop, bpm, conformSp16Wav, setStatus,
    sp16HasTooLongAssignedLoop, sp16LoopBytes, sp16ProjectBase, sp16SampleFilename,
  ]);

  // ── EDITTRAX export (separate path from SP-16 above — zero shared code,
  // per the plan's hard rule). Follows the WAV export's audio-bytes policy
  // (engine-repaired first, local re-encode fallback — seamlessness matters
  // most for a looping player), NOT the SP-16 path. Live loop-repeat counts
  // come from the mounted player iframe (readLivePartLoops); a stale/absent
  // read (wrong length, or the frame hasn't booted) falls back to all-1s. ──
  const downloadEdittraxZip = useCallback(async () => {
    if (!audioBuffer || !edittraxSlots.length) return;
    setStatus('Building EditTrax player…', 'busy');
    try {
      const liveCounts = readLivePartLoops(edittraxFrameRef.current);
      const counts = (liveCounts && liveCounts.length === edittraxSlots.length)
        ? liveCounts
        : edittraxSlots.map(() => 1);

      const channelData = buildChannelData();
      const audioBytesBySlot = await Promise.all(edittraxSlots.map(async (loopIndex) => {
        const loop = loops.find((l) => l.index === loopIndex);
        if (!loop) return null;
        const engineLoop = engineLoopByIndex ? engineLoopByIndex.get(loopIndex) : null;
        if (engineLoop && engineLoop.path) {
          try {
            return await fetchEngineAudioBytes(engineLoop.path);
          } catch (err) { /* fall through to the local re-encode below */ }
        }
        return encodeWavPcm16({
          channelData, sampleRate: audioBuffer.sampleRate, startSample: loop.startSample, endSample: loop.endSample,
        });
      }));
      if (audioBytesBySlot.some((bytes) => !bytes)) {
        throw new Error('missing audio for one or more assigned parts');
      }

      const projectBase = sanitizePlayerProjectBase(trackBase);
      const { zipBytes, filename } = await buildEdittraxZipBytes({
        projectBase,
        bpm,
        barsPerLoop,
        slots: edittraxSlots,
        counts,
        audioBytesBySlot,
      });
      downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), filename);
      setStatus(okLine(`${filename} saved`), 'ok');
    } catch (err) {
      setStatus(errorLine(`EditTrax export failed — ${String(err?.message || err)}`), 'error');
    }
  }, [audioBuffer, edittraxSlots, loops, engineLoopByIndex, buildChannelData, bpm, barsPerLoop, trackBase, setStatus]);

  // ═══════════════════════════════════════════════════════════════════
  // ── Wavesurfer + RegionsPlugin lifecycle ──────────────────────────
  // ═══════════════════════════════════════════════════════════════════

  // Mount ONCE — see the HARD RULE + createSilentMedia() docs up top for
  // why `media` is a synthetic (non-<audio>) shim.
  useEffect(() => {
    const container = wsContainerRef.current;
    if (!container) return undefined;
    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container,
      height: WAVEFORM_H,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      cursorColor: ACCENT,
      cursorWidth: 0, // the playhead line + ball are ours (see #loop-studio-playhead)
      waveColor: 'rgba(26,26,26,0.45)',
      progressColor: 'rgba(26,26,26,0.45)',
      interact: false,
      dragToSeek: false,
      autoScroll: false,
      autoCenter: false,
      hideScrollbar: false,
      fillParent: true,
      minPxPerSec: 1,
      normalize: false,
      media: createSilentMedia(0),
      plugins: [regions],
    });
    wsRef.current = ws;
    regionsRef.current = regions;
    return () => {
      try { ws.destroy(); } catch (err) { /* noop */ }
      wsRef.current = null;
      regionsRef.current = null;
    };
  }, []);

  // Resize tracking for the mount container (drives fit-zoom recompute).
  useEffect(() => {
    const el = wsContainerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setStripWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load precomputed peaks whenever a new track is decoded — no network
  // fetch, no real decode inside wavesurfer (see createSilentMedia() docs).
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !audioBuffer || !channelDataRef.current) return undefined;
    let cancelled = false;
    setWsReady(false);
    ws.load('', channelDataRef.current, audioBuffer.duration).then(() => {
      if (cancelled) return;
      setWsReady(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [audioBuffer]);

  // Zoom: reapply on zoomFactor/track/container-resize change (spec: resize
  // reapplies the current zoom). autoScroll is OFF at fit (factor 1), ON
  // once zoomed — per the OWNER RULE overriding the workbench's own
  // always-true autoScroll.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !wsReady || !audioBuffer || !stripWidth) return;
    const fit = stripWidth / Math.max(0.001, audioBuffer.duration);
    fitPxPerSecRef.current = fit;
    try {
      ws.zoom(Math.max(1, fit * zoomFactor));
      ws.setOptions({ autoScroll: zoomFactor > ZOOM_MIN + 1e-9 });
    } catch (err) { /* noop — audio not decoded yet */ }
  }, [audioBuffer, stripWidth, wsReady, zoomFactor]);

  const onZoomButton = useCallback((direction) => setZoomFactor((z) => stepZoomButton(z, direction)), []);
  const onWaveformWheel = useCallback((e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoomFactor((z) => stepZoomWheel(z, e.deltaY));
  }, []);

  // ── Fit-zoom drag = offset nudge; zoomed >1 lets the browser's native
  // scroll/drag on the (now-scrollable) wavesurfer wrapper pan instead —
  // the OWNER RULE from the port spec. Attached to the mount div itself
  // (interact:false means wavesurfer never eats these as its own seek).
  const onWaveformPointerDown = useCallback((e) => {
    if (!audioBuffer || zoomFactor > ZOOM_MIN + 1e-9) return;
    if (e.target.closest && e.target.closest('[data-loop-clip="1"]')) return; // let region-clicked own this
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    dragStateRef.current = { startX: e.clientX, lastX: e.clientX, moved: false };
  }, [audioBuffer, zoomFactor]);

  const onWaveformPointerMove = useCallback((e) => {
    const drag = dragStateRef.current;
    if (!drag || !audioBuffer) return;
    const dxTotal = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dxTotal) >= 4) {
      drag.moved = true;
      if (playingLoopIndex !== null) { player.stop(); setPlayingLoopIndex(null); setTransportActive(false); }
    }
    if (drag.moved) {
      const dxStep = e.clientX - drag.lastX;
      const widthPx = wsContainerRef.current?.getBoundingClientRect().width || stripWidth || 1;
      const deltaSamples = Math.round((dxStep * audioBuffer.length) / widthPx);
      setOffsetSamples((prev) => clampOffset(prev + deltaSamples));
    }
    drag.lastX = e.clientX;
  }, [audioBuffer, clampOffset, player, playingLoopIndex, stripWidth]);

  const onWaveformPointerUp = useCallback(() => { dragStateRef.current = null; }, []);

  // ── Region rebuild: boundary/loop clips (interactive — click = select +
  // audition) + the five decorative marker overlays (beats/downbeats/
  // phase-candidates/transient-risk/click-risk), all gated by their toggle.
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !wsReady || !audioBuffer) return undefined;
    regions.clearRegions();

    // Boundaries (loop clips) — ALWAYS added for click hit-testing; styled
    // transparent (no fill/header) when the toggle is off, per this port's
    // interpretation of "boundaries" as a visual (not functional) toggle.
    loops.forEach((loop) => {
      const v = verdictByIndex ? verdictByIndex.get(loop.index) : null;
      const verdict = loopVerdict({ complete: true, reportVerdict: v?.verdict });
      const isSelected = loop.index === selectedLoopIndex;
      const isPlaying = loop.index === playingLoopIndex;
      let content;
      if (overlays.boundaries) {
        content = document.createElement('div');
        content.textContent = `LOOP ${String(loop.index + 1).padStart(2, '0')}${v ? ` · ${v.verdict.toUpperCase()}` : ''}`;
        content.style.cssText = 'position:absolute;top:0;left:0;right:0;font:700 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;letter-spacing:.06em;color:#fff;background:rgba(0,0,0,0.5);padding:1px 4px;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      }
      const region = regions.addRegion({
        id: `loop-clip-${loop.index}`,
        start: loop.startSample / audioBuffer.sampleRate,
        end: loop.endSample / audioBuffer.sampleRate,
        color: overlays.boundaries ? VERDICT_FILL[verdict] : 'transparent',
        drag: false,
        resize: false,
        content,
      });
      if (region.element) {
        region.element.dataset.loopClip = '1';
        region.element.style.boxSizing = 'border-box';
        region.element.style.borderTop = overlays.boundaries ? `2px solid ${VERDICT_INK[verdict]}` : 'none';
        const shadows = [];
        if (isSelected) shadows.push(`inset 0 0 0 2px ${ACCENT}`);
        if (isPlaying) shadows.push('inset 0 0 10px rgba(236,72,153,0.55)');
        region.element.style.boxShadow = shadows.join(', ');
      }
    });

    const addMarker = (id, time, widthMs, color) => {
      if (!Number.isFinite(time)) return;
      regions.addRegion({
        id, start: Math.max(0, time), end: Math.max(0, time) + widthMs / 1000, color, drag: false, resize: false,
      });
    };

    const analysis = detection.state === 'done' ? detection.analysis : null;

    if (overlays.beats && analysis?.beats_seconds) {
      analysis.beats_seconds.forEach((t, i) => addMarker(`beat-${i}`, t, 10, 'rgba(184,188,175,0.35)'));
    }
    if (overlays.downbeats && analysis?.downbeat_times_seconds) {
      analysis.downbeat_times_seconds.forEach((t, i) => addMarker(`downbeat-${i}`, t, 20, 'rgba(230,233,224,0.85)'));
    }
    if (overlays.phaseCandidates && analysis?.beats_seconds && analysis?.downbeat_phase_candidates) {
      const winningPhase = analysis.downbeat_selected_phase;
      analysis.downbeat_phase_candidates.forEach((c) => {
        if (c.phase === winningPhase) return; // non-winning candidates only
        const color = phaseCandidateColor(c.phase);
        for (let i = c.phase; i >= 0 && i < analysis.beats_seconds.length; i += (meter || 4)) {
          addMarker(`phase-${c.phase}-${i}`, analysis.beats_seconds[i], 15, color);
        }
      });
    }
    if (overlays.transientRisk && verdictByIndex) {
      loops.forEach((loop) => {
        const v = verdictByIndex.get(loop.index);
        if (!v) return;
        if (Number.isFinite(v.start_transient_risk_ms) && v.start_transient_risk_ms < 50) {
          addMarker(`transient-start-${loop.index}`, loop.startSample / audioBuffer.sampleRate, 10, 'rgba(230,190,60,0.9)');
        }
        if (Number.isFinite(v.end_transient_risk_ms) && v.end_transient_risk_ms < 50) {
          addMarker(`transient-end-${loop.index}`, loop.endSample / audioBuffer.sampleRate, 10, 'rgba(230,190,60,0.9)');
        }
      });
    }
    if (overlays.clickRisk && verdictByIndex) {
      loops.forEach((loop) => {
        const v = verdictByIndex.get(loop.index);
        if (v && v.verdict === 'fail') {
          addMarker(`click-risk-${loop.index}`, loop.endSample / audioBuffer.sampleRate, 15, 'rgba(252,0,35,0.95)');
        }
      });
    }

    // Decorative markers must never intercept clicks meant for the
    // boundary clip beneath them.
    regions.getRegions().forEach((r) => {
      if (!r.id.startsWith('loop-clip-') && r.element) r.element.style.pointerEvents = 'none';
    });

    const unsub = regions.on('region-clicked', (region, e) => {
      e.stopPropagation();
      if (!region.id.startsWith('loop-clip-')) return;
      const idx = Number(region.id.slice('loop-clip-'.length));
      const loop = loops.find((l) => l.index === idx);
      if (loop) toggleLoopPlay(loop);
    });

    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loops, verdictByIndex, overlays, selectedLoopIndex, playingLoopIndex, audioBuffer, wsReady, detection, meter]);

  // ── Musical-region dimming overlay + bar ruler — both driven by the same
  // rAF-debounced redraw, subscribed to wavesurfer's scroll/zoom/redraw
  // events (virtualized: only the visible window is computed/drawn).
  const scheduleStripRedraw = useCallback(() => {
    if (rulerRafRef.current) return;
    rulerRafRef.current = requestAnimationFrame(() => {
      rulerRafRef.current = null;
      const ws = wsRef.current;
      const canvas = rulerCanvasRef.current;
      if (!ws || !audioBuffer || !wsReady) return;
      const minPxPerSec = Math.max(1, fitPxPerSecRef.current * zoomFactor);
      const scrollPx = (() => { try { return ws.getScroll(); } catch { return 0; } })();
      const width = stripWidth || 1;

      // Region dimming.
      const analysis = detection.state === 'done' ? detection.analysis : null;
      const regionStart = analysis?.region_start_seconds;
      const regionEnd = analysis?.region_end_seconds;
      let leadingPx = 0;
      let trailingPx = 0;
      if (Number.isFinite(regionStart)) {
        leadingPx = Math.max(0, Math.min(width, regionStart * minPxPerSec - scrollPx));
      }
      if (Number.isFinite(regionEnd)) {
        trailingPx = Math.max(0, Math.min(width, (scrollPx + width) - regionEnd * minPxPerSec));
      }
      setRegionDim({ leadingPx, trailingPx });
      setStripScroll(scrollPx);

      // Bar ruler.
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const cssH = TIMELINE_TRACK_H;
        const pxW = Math.max(1, Math.round(width * dpr));
        const pxH = Math.max(1, Math.round(cssH * dpr));
        if (canvas.width !== pxW || canvas.height !== pxH) { canvas.width = pxW; canvas.height = pxH; }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, width, cssH);
          const spb = samplesPerBar({ sampleRate: audioBuffer.sampleRate, bpm, meter });
          const barSeconds = spb / audioBuffer.sampleRate;
          if (barSeconds > 0) {
            const pxPerBar = barSeconds * minPxPerSec;
            const stride = pickLabelStride(pxPerBar);
            const visibleStartSec = scrollPx / minPxPerSec;
            const visibleEndSec = (scrollPx + width) / minPxPerSec;
            const originSec = offsetSamples / audioBuffer.sampleRate;
            const firstBar = Math.floor((visibleStartSec - originSec) / barSeconds) - 1;
            const lastBar = Math.ceil((visibleEndSec - originSec) / barSeconds) + 1;
            // Ticks sit BEHIND the waveform now, so they wash out rather than
            // compete; only the labelled bars carry a readable number.
            ctx.strokeStyle = 'rgba(26,26,26,0.14)';
            ctx.fillStyle = 'rgba(26,26,26,0.4)';
            ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
            ctx.lineWidth = 1;
            for (let bar = Math.max(0, firstBar); bar <= lastBar; bar += 1) {
              const sec = originSec + bar * barSeconds;
              const x = Math.round(sec * minPxPerSec - scrollPx) + 0.5;
              if (x < -4 || x > width + 4) continue;
              const isLabel = bar % stride === 0;
              ctx.beginPath();
              ctx.moveTo(x, isLabel ? 0 : 8);
              ctx.lineTo(x, isLabel ? cssH : cssH - 8);
              ctx.stroke();
              if (isLabel) ctx.fillText(String(bar + 1), x + 3, 9);
            }
          }
        }
      }
    });
  }, [audioBuffer, bpm, detection, meter, offsetSamples, stripWidth, wsReady, zoomFactor]);

  useEffect(() => { scheduleStripRedraw(); }, [scheduleStripRedraw]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return undefined;
    const onScroll = () => scheduleStripRedraw();
    const onZoomEvt = () => scheduleStripRedraw();
    const onRedraw = () => scheduleStripRedraw();
    const offScroll = ws.on('scroll', onScroll);
    const offZoom = ws.on('zoom', onZoomEvt);
    const offRedraw = ws.on('redraw', onRedraw);
    return () => { offScroll(); offZoom(); offRedraw(); };
  }, [scheduleStripRedraw]);

  useEffect(() => () => { if (rulerRafRef.current) cancelAnimationFrame(rulerRafRef.current); }, []);

  // ═══════════════════════════════════════════════════════════════════
  // ── GSAP motion (the ONLY 5 things that animate) ──────────────────
  // ═══════════════════════════════════════════════════════════════════

  // 1. Shell reveal stagger — once, on first mount of the rail cards.
  useEffect(() => {
    if (shellRevealedRef.current || !railInnerRef.current) return;
    shellRevealedRef.current = true;
    const cards = railInnerRef.current.querySelectorAll(':scope > .studio-rail-card');
    if (!cards.length) return;
    if (!motionSafe()) { gsap.set(cards, { opacity: 1, y: 0 }); return; }
    gsap.fromTo(cards, { opacity: 0, y: 10 }, {
      opacity: 1, y: 0, duration: 0.26, ease: 'power2.out', stagger: 0.04,
    });
  }, []);

  // 2. Tile stagger-in on a NEW verify report.
  useEffect(() => {
    if (verification.state !== 'done' || !verification.report) return;
    const grid = stageGridRef.current;
    if (!grid) return;
    const tiles = grid.querySelectorAll(':scope > div[id^="loop-tile-"]');
    if (!tiles.length) return;
    if (!motionSafe()) { gsap.set(tiles, { opacity: 1, scale: 1 }); return; }
    gsap.fromTo(tiles, { opacity: 0, scale: 0.96 }, {
      opacity: 1, scale: 1, duration: 0.22, ease: 'power2.out', stagger: 0.02,
    });
  }, [verification.report]);

  // 3. BPM hero count-up — ONLY on a genuinely new bpm_final.
  const [bpmHeroDisplay, setBpmHeroDisplay] = useState('0.0');
  useEffect(() => {
    if (detection.state !== 'done' || !detection.analysis) return;
    const target = Number(detection.analysis.bpm_final) || 0;
    const isNew = prevHeroBpmRef.current === null || Math.abs(prevHeroBpmRef.current - target) > 0.005;
    if (!isNew) { setBpmHeroDisplay(target.toFixed(1)); return; }
    const from = { v: prevHeroBpmRef.current ?? target };
    prevHeroBpmRef.current = target;
    if (!motionSafe()) { setBpmHeroDisplay(target.toFixed(1)); return; }
    if (bpmHeroTweenRef.current) bpmHeroTweenRef.current.kill();
    bpmHeroTweenRef.current = gsap.to(from, {
      v: target, duration: 0.5, ease: 'power3.out', onUpdate: () => setBpmHeroDisplay(from.v.toFixed(1)),
    });
    flashPulse(gridStatusLineRef.current);
  }, [detection]);

  // 5. Pipeline marching-block busy indicator lives inline (PipelineBusyBlocks below).

  // ── Status row derived text ────────────────────────────────────────
  const displayStatus = statusMsg || (warnings.length ? warnings.join(' · ') : (audioBuffer ? `${loops.length} loops · ${barsPerLoop} bars · ${bpm.toFixed(2)} BPM` : ''));
  const offsetMs = audioBuffer ? (offsetSamples / audioBuffer.sampleRate) * 1000 : 0;
  const analysis = detection.state === 'done' ? detection.analysis : null;

  // ── Export quick pick + the strip's EXPORT action ──────────────────
  // Same shape as the mockup tool's DESKTOP/MOBILE/TABLET cluster: the target
  // is picked from tiles on the left of the transport row, and the single
  // gradient CTA on the right runs whichever export that target means. The
  // Export rail card keeps every per-target detail (project name, report,
  // counts) — this is the quick path, not a replacement for it.
  const exportTargets = [
    { key: 'wav', label: 'WAV', icon: <FileAudio2 size={18} strokeWidth={2} />, title: 'Plain PCM WAV loops' },
    { key: 'sp16', label: 'SP-16', icon: <Grid3x3 size={18} strokeWidth={2} />, title: 'Toraiz SP-16 project + pad samples' },
    { key: 'edittrax', label: 'EDITTRAX', icon: <MonitorPlay size={18} strokeWidth={2} />, title: 'Self-contained EditTrax player' },
  ];

  // Fresh upload -> the local grid is still the 120bpm default, so anything
  // sliced from it is very likely off-beat. Loops stay INACTIVE until the
  // analyzer lands a real BPM/downbeat, then flip active.
  // Loop count is the INVERSE of bars-per-loop: the track holds a fixed
  // number of bars, so asking for N loops is asking for totalBars/N bars each.
  // Only integer bars-per-loop divides the grid cleanly, so a requested count
  // snaps to the nearest achievable one — the readout shows what was actually
  // produced, never the request.
  const gridTotalBars = (() => {
    if (!audioBuffer) return 0;
    const spb = samplesPerBar({ sampleRate: audioBuffer.sampleRate, bpm, meter });
    if (!(spb > 0)) return 0;
    return Math.max(0, Math.floor((audioBuffer.length - Math.max(0, offsetSamples)) / spb));
  })();
  const maxLoopCount = Math.max(1, gridTotalBars);

  const lengthSteps = useMemo(() => loopLengthSteps(gridTotalBars), [gridTotalBars]);
  const lengthStepIndex = (() => {
    let best = 0;
    for (let i = 0; i < lengthSteps.length; i += 1) {
      if (Math.abs(lengthSteps[i] - barsPerLoop) < Math.abs(lengthSteps[best] - barsPerLoop)) best = i;
    }
    return best;
  })();

  const setLoopLengthByStep = useCallback((stepIndex) => {
    const i = Math.min(lengthSteps.length - 1, Math.max(0, Math.round(Number(stepIndex) || 0)));
    const bars = lengthSteps[i];
    if (Number.isFinite(bars) && bars >= 1) setBarsPerLoop(bars);
  }, [lengthSteps]);

  const setLoopCount = useCallback((requested) => {
    if (!gridTotalBars) return;
    const target = Math.min(maxLoopCount, Math.max(1, Math.round(Number(requested) || 1)));
    // `round(totalBars / target)` alone snaps badly — with 15 bars, asking for
    // 2 loops rounds to 8 bars each and yields ONE loop. Test the divisor on
    // either side and keep whichever actually lands closest to the request
    // (ties go to the larger count, i.e. the smaller loops).
    const ideal = gridTotalBars / target;
    const candidates = [...new Set([Math.floor(ideal), Math.ceil(ideal)])]
      .map((b) => Math.min(gridTotalBars, Math.max(1, b)));
    let best = candidates[0];
    let bestMiss = Infinity;
    for (const bars of candidates) {
      const achieved = Math.floor(gridTotalBars / bars);
      const miss = Math.abs(achieved - target);
      if (miss < bestMiss || (miss === bestMiss && achieved > Math.floor(gridTotalBars / best))) {
        best = bars;
        bestMiss = miss;
      }
    }
    setBarsPerLoop(best);
  }, [gridTotalBars, maxLoopCount]);

  const analyzing = detection.state === 'running';
  const loopsArmed = detection.state === 'done';

  const activeOverlayCount = Object.values(overlays).filter(Boolean).length;

  const exportAction = (() => {
    if (exportTarget === 'sp16') {
      return {
        label: 'Export',
        onClick: downloadSp16Scene,
        disabled: !assignedPads.length || sp16HasTooLongAssignedLoop,
        title: sp16HasTooLongAssignedLoop
          ? `An assigned loop is over ${SP16_MAX_SECONDS}s — shorten the grid or clear that pad.`
          : assignedPads.length ? 'Export the SP-16 scene (.scn)' : 'Drop a loop on a pad first',
      };
    }
    if (exportTarget === 'edittrax') {
      return {
        label: 'Export',
        onClick: downloadEdittraxZip,
        disabled: !edittraxSlots.length,
        title: edittraxSlots.length ? 'Build the EditTrax player (.zip)' : 'Add a loop to the player first',
      };
    }
    return {
      label: 'Export',
      onClick: downloadAllZip,
      disabled: !loops.length,
      title: loops.length ? 'Download every loop as WAV (.zip)' : 'Slice the track first',
    };
  })();

  // ── Timeline transport bank ────────────────────────────────────────
  // Same shape the mockup/HOLO PAPER strips build their circle rows from:
  // one row of {icon, label, active, disabled, onClick}. Every audition verb
  // the tool has is a transport here, so the dock reads as one bank instead
  // of seven competing text pills.
  const transportButtons = [
    {
      key: 'slice', id: 'loop-transport-play-slice', label: 'Play', title: 'Play the selected slice once',
      icon: <Play size={17} fill="currentColor" />,
      active: transportLabel === 'PLAY SLICE', disabled: !selectedLoop, onClick: transportPlaySlice,
    },
    {
      key: 'loop', id: 'loop-transport-loop', label: 'Loop', title: 'Loop the selected slice (exported bytes)',
      icon: <Repeat size={16} strokeWidth={2.5} />,
      active: transportLabel === 'LOOP (EXPORTED)', disabled: !selectedLoop, onClick: transportLoop,
    },
    {
      key: 'source', id: 'loop-transport-from-source', label: 'Source', title: 'Play the selection straight from the source track',
      icon: <Rewind size={16} strokeWidth={2.5} />,
      active: transportLabel === 'FROM SOURCE', disabled: !selectedLoop, onClick: transportFromSource,
    },
    {
      key: 'click', id: 'loop-transport-click', label: 'Click',
      title: 'Metronome at the established BPM',
      icon: <Timer size={16} strokeWidth={2.5} />,
      active: clickOn, disabled: !(bpm > 0), onClick: () => setClickOn((v) => !v),
    },
    {
      key: 'stop', id: 'loop-transport-stop', label: 'Stop', title: 'Stop playback',
      icon: <Square size={15} fill="currentColor" />,
      active: false, disabled: !transportActive, onClick: handleStop,
    },
  ];

  // Playhead ball position, in the waveform's own pixel space — the same
  // `sec * pxPerSec - scroll` math the bar ruler draws with, so the ball and
  // wavesurfer's cursor line stay locked together at every zoom level. Null
  // (not rendered) when nothing is playing or the head is off-screen.
  const playheadPx = (() => {
    if (!audioBuffer || !stripWidth) return 0; // empty track: parked at the start, like the other tools
    const parked = transportActive
      ? transportPosition
      : (() => { try { return wsRef.current?.getCurrentTime?.() ?? 0; } catch { return 0; } })();
    const px = parked * Math.max(1, fitPxPerSecRef.current * zoomFactor) - stripScroll;
    return px >= -1 && px <= stripWidth + 1 ? px : null;
  })();

  // ── Cloud sessions ("Saves", Feature 2) ────────────────────────────────
  // Reuses the existing Cloud Template Persistence infrastructure exactly
  // the way ClothStudio.jsx's own Scene/Element/Look/Render cloud cards do
  // (CloudTemplateSection + api/_lib/studio-templates.cjs kind='loop') — see
  // ./loop/loop-session.js for the recipe shape + server-side sanitizer.
  // captureLoopSession is CloudTemplateSection's `onCaptureRecipe` (a zero-
  // arg function reading current state via closure); applyLoopSession is
  // its `onLoadRecipe` (called with the recipe object only — CloudTemplate
  // Section never hands back the cloud entry's NAME, only its recipe, so
  // the status line below uses the recipe's own `sourceName` for "{name}").
  const captureLoopSession = useCallback(() => captureLoopSessionRecipe({
    enginePath: lastEngineTrackPathRef.current || null,
    sourceName: trackMeta?.name || null,
    bpm,
    barsPerLoop,
    offsetSamples,
    meter,
    phaseOverride,
    overlays,
    zoomFactor,
    repairStrategy,
    repeatCount,
    verdictSummary: verification.state === 'done' ? (verification.report?.summary || null) : null,
  }), [trackMeta, bpm, barsPerLoop, offsetSamples, meter, phaseOverride, overlays, zoomFactor, repairStrategy, repeatCount, verification]);

  const applyLoopSession = useCallback((recipe) => {
    if (!recipe || typeof recipe !== 'object') return;
    const label = recipe.sourceName || 'session';
    const nextBpm = clampBpm(recipe.bpm);
    setBpm(nextBpm);
    setBpmDraft(nextBpm.toFixed(2));
    if (Number.isFinite(recipe.barsPerLoop)) setBarsPerLoop(Math.round(recipe.barsPerLoop));
    if (Number.isFinite(recipe.offsetSamples)) setOffsetSamples(Math.round(recipe.offsetSamples));
    if (Number.isFinite(recipe.meter)) setMeter(Math.round(recipe.meter));
    setPhaseOverride(Number.isFinite(recipe.phaseOverride) ? Math.round(recipe.phaseOverride) : null);
    setOverlays({ ...DEFAULT_OVERLAYS, ...(recipe.overlays && typeof recipe.overlays === 'object' ? recipe.overlays : {}) });
    setZoomFactor(clampZoom(recipe.zoomFactor ?? ZOOM_MIN));
    if (REPAIR_STRATEGIES.some((s) => s.value === recipe.repairStrategy)) setRepairStrategy(recipe.repairStrategy);
    if (Number.isFinite(recipe.repeatCount)) setRepeatCount(Math.max(1, Math.round(recipe.repeatCount)));

    if (recipe.enginePath && engineHealth === 'up') {
      loadKnownTrack(recipe.enginePath);
      setStatus(okLine(`session "${label}" loaded — reloading ${recipe.enginePath}…`), 'ok');
    } else if (recipe.enginePath) {
      setStatus(`session "${label}" loaded — grid restored; engine offline, could not reload "${recipe.enginePath}"`, 'idle');
    } else {
      setStatus(okLine(`session "${label}" loaded — grid restored${recipe.sourceName ? ` (re-drop "${recipe.sourceName}" to restore the track)` : ''}`), 'ok');
    }
  }, [engineHealth, loadKnownTrack, setStatus]);

  return (
    <>
      <input
        id="loop-studio-file-input"
        ref={fileInputRef}
        type="file"
        accept=".wav,.aiff,.aif,.mp3,.m4a,.flac,.ogg,audio/*"
        style={{ display: 'none' }}
        onChange={onFileInputChange}
      />

      {/* ── Board — the stage + waveform strip fill the area left of the rail. ── */}
      <div
        id="loop-studio-board"
        style={{
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...(isNarrow
            ? { position: 'relative', width: '100%', height: '70vh', flex: 'none' }
            : { position: 'absolute', left: 0, top: 0, bottom: 0, right: railW }),
        }}
      >
        {/* ── Stage — the Studio surface itself, no black slab. The two
            workspaces are sibling panels sitting ON that surface: GENERATED
            LOOPS as a light glass card in the same language as the rail cards,
            and the SP-16 as its own dark hardware chassis (the only dark object
            left, because the unit is dark and its pads have to read as lit).
            Side by side above STAGE_STACK_WIDTH, one internally-scrolling
            stack below it. ── */}
        {/* Stage layout — container queries, not JS measurement. `loopstage`
            is the stage area itself, so the columns collapse off the space the
            board actually has (a small desktop runs out of room next to the
            336px rail long before any viewport breakpoint fires), and the pad
            square is `100cqmin` of its own shell so it can never outgrow it. */}
        <style id="loop-stage-styles">{`
          #loop-studio-stage-area { container-type: inline-size; container-name: loopstage; }
          /* The strip is a SIBLING of the stage area, not a descendant, so it
             needs its own container to size off the board rather than the
             viewport (the 336px rail is not the strip's to spend). */
          #loop-studio-waveform-strip { container-type: inline-size; container-name: loopstrip; }
          #loop-studio-workspace {
            display: grid; gap: 16px; grid-template-columns: minmax(0,1fr);
            min-width: 0; min-height: 0; box-sizing: border-box;
          }
          #loop-studio-workspace[data-sp16="true"] {
            grid-template-columns: minmax(0,1fr) minmax(300px,0.72fr);
            grid-template-rows: minmax(0,1fr);
          }
          /* EDITTRAX carries a full web player, not a pad square — it takes the
             larger share of the stage and the loops list becomes the sidebar. */
          #loop-studio-workspace[data-edittrax="true"] {
            grid-template-columns: minmax(0,0.62fr) minmax(360px,1fr);
            grid-template-rows: minmax(0,1fr);
          }
          #loop-studio-empty-drop { grid-column: 1 / -1; min-height: 0; }
          .loop-stage-panel {
            min-width: 0; min-height: 0; box-sizing: border-box;
            display: flex; flex-direction: column;
          }
          #loop-studio-stage-grid {
            flex: 1; min-height: 0; overflow-y: auto; box-sizing: border-box;
            display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
            gap: 10px; align-content: start; grid-auto-rows: min-content; padding-right: 2px;
          }
          .loop-stage-tile { padding: 12px; min-height: 104px; gap: 8px; }
          .loop-tile-btn { width: 28px; height: 28px; }

          /* WAV mode: no SP-16 panel, so the loops own the whole stage and a
             library of them would otherwise be a wall of oversized cards. They
             clamp down and pack denser; the SP-16 column keeps the roomier
             tile because it is also a drag handle. */
          #loop-studio-workspace[data-sp16="false"] #loop-studio-stage-grid {
            grid-template-columns: repeat(auto-fill, minmax(clamp(104px, 12vw, 132px), 1fr));
            gap: 8px;
          }
          #loop-studio-workspace[data-sp16="false"] .loop-stage-tile { padding: 9px; min-height: 0; gap: 5px; }
          #loop-studio-workspace[data-sp16="false"] .loop-tile-btn { width: 24px; height: 24px; }
          #loop-studio-sp16-pad-shell {
            flex: 1; min-height: 0; container-type: size; container-name: sp16pads;
            display: flex; align-items: center; justify-content: center;
          }
          #loop-studio-sp16-pads { width: 100cqmin; height: 100cqmin; }

          /* Stacked: phones and small desktops both. One column, the workspace
             itself is the scroller, and each panel keeps its own inner scroll. */
          @container loopstage (max-width: 900px) {
            #loop-studio-workspace,
            #loop-studio-workspace[data-sp16="true"],
            #loop-studio-workspace[data-edittrax="true"] {
              grid-template-columns: minmax(0,1fr); grid-template-rows: none;
              grid-auto-rows: min-content; align-content: start;
              overflow-y: auto; overflow-x: hidden;
            }
            #loop-studio-empty-drop { min-height: 260px; }
            .loop-stage-panel { flex-shrink: 0; }
            #loop-studio-stage-grid { flex: none; max-height: 330px; }
            #loop-studio-edittrax-panel { flex: none; }
            #loop-studio-sp16-pad-shell { flex: none; container-type: inline-size; }
            #loop-studio-sp16-pads { width: min(100cqw, 460px); height: min(100cqw, 460px); }
          }

          /* Same wrap behaviour as the mockup tool's under-canvas row: the
             transport bank stays centred and the side zones fold under it. */
          /* Below the stack width the row folds into two lines: the export
             quick pick keeps VOLUME and MARKERS company on the top line (they
             are small and belong with the setup controls), and the circle bank
             plus zoom/export get the full width underneath. */
          /* The break span is inert on a wide row and becomes a full-width
             zero-height flex item at the fold, so line 1 (setup: targets,
             volume, markers) and line 2 (transport + export) are a decision,
             not a consequence of how wide the controls happen to be. */
          .loop-row-break { display: none; }
          /* The collapsed Mix menu only exists below the narrow breakpoint. */
          .loop-strip-dock { display: flex; flex-direction: column; }
          #loop-studio-sliders-dock { display: none; }
          @container loopstrip (max-width: 720px) {
            .loop-strip-dock { display: none; }
            #loop-studio-sliders-dock { display: flex; order: 2; }
          }
          @container loopstrip (max-width: 900px) {
            #loop-studio-transport-row { flex-wrap: wrap; justify-content: center; row-gap: 12px; }
            #loop-studio-export-quickpick { flex: 0 0 auto; order: 1; }
            #loop-studio-volume-dock { order: 2; }
            #loop-studio-loopcount-dock { order: 3; }
            #loop-studio-looplength-dock { order: 4; }
            .loop-row-break { display: block; order: 5; flex: 0 0 100%; height: 0; }
            #loop-studio-transport-dock { order: 6; flex: 0 1 auto; }
            #loop-studio-analyzing-dock { order: 7; }
            #loop-studio-actions { order: 8; flex: 0 1 auto; }
          }
          @container loopstrip (max-width: 560px) { .loop-timeline-ctrl-label { display: none; } }

          @keyframes loop-analyzing-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.45; transform: scale(0.82); }
          }
          .loop-analyzing-dot { animation: loop-analyzing-pulse 1.1s ease-in-out infinite; }
          .loop-tile-queued { animation: loop-analyzing-pulse 1.1s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) { .loop-analyzing-dot, .loop-tile-queued { animation: none; } }

          .loop-sp16-pad { transition: transform 140ms cubic-bezier(0.23,1,0.32,1), box-shadow 200ms ease-out; }
          .loop-sp16-pad:active { transform: scale(0.96); }
          .loop-stage-tile { transition: border-color 180ms ease-out, box-shadow 180ms ease-out; }
          @media (prefers-reduced-motion: reduce) {
            .loop-sp16-pad, .loop-stage-tile { transition: none; }
            .loop-sp16-pad:active { transform: none; }
          }
        `}</style>
        <div
          id="loop-studio-stage-area"
          onDragOver={onStageDragOver}
          onDragLeave={onStageDragLeave}
          onDrop={onStageDrop}
          style={{
            flex: 1, minHeight: 0, display: 'flex',
            padding: isNarrow ? '68px 12px 12px' : '74px 24px 24px',
          }}
        >
          <div
            id="loop-studio-workspace"
            data-sp16={showSp16Panel ? 'true' : 'false'}
            data-edittrax={showEdittraxPanel ? 'true' : 'false'}
            style={{ flex: 1 }}
          >
            {!audioBuffer ? (
              <div
                id="loop-studio-empty-drop"
                style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center',
                  borderRadius: 16, boxSizing: 'border-box',
                  border: '2px dashed ' + (dragOver ? ACCENT : 'rgba(176,176,182,0.6)'),
                  background: dragOver ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)',
                  backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                  transition: 'border-color 0.2s ease, background 0.2s ease',
                }}
              >
                <span style={{ ...ui.label, color: GLASS.inkSoft, fontSize: 13 }}>DROP A TRACK — WAV / AIFF</span>
                <span style={{ ...ui.label, color: GLASS.inkMute, fontSize: 9, textTransform: 'none', letterSpacing: '0.02em' }}>
                  mp3 decodes too, flagged lossy · ≤100MB · ≤10min
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ ...ui.btn(), opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }}
                >
                  BROWSE
                </button>
              </div>
            ) : (
              <>
                {/* ── Generated loops — light glass panel on the studio surface. ── */}
                <section
                  id="loop-studio-loops-panel"
                  className="loop-stage-panel"
                  style={{
                    gap: 10, borderRadius: 16, padding: 14,
                    background: 'rgba(255,255,255,0.35)',
                    backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid rgba(176,176,182,0.6)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)',
                  }}
                >
                  <div id="loop-studio-loops-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...ui.label, whiteSpace: 'nowrap' }}>GENERATED LOOPS</span>
                    <span aria-hidden="true" style={{ flex: 1, height: 1, background: GLASS.hair }} />
                    <span style={{ ...ui.label, color: GLASS.inkSoft }}>{loops.length}</span>
                  </div>
                  <div
                    id="loop-studio-stage-grid"
                    ref={stageGridRef}
                  >
                    {loops.map((loop) => {
                      const isPlaying = playingLoopIndex === loop.index;
                      const isQueued = queuedLoopIndex === loop.index;
                      const isLastPlayed = !isPlaying && !isQueued && lastPlayedLoopIndex === loop.index;
                      const isSelected = selectedLoopIndex === loop.index;
                      const tileState = isPlaying ? LOOP_TILE_STATES.playing
                        : isQueued ? LOOP_TILE_STATES.queued
                          : isLastPlayed ? LOOP_TILE_STATES.last
                            : null;
                      const v = verdictByIndex ? verdictByIndex.get(loop.index) : null;
                      const verdict = loopVerdict({ complete: true, reportVerdict: v?.verdict });
                      const isPlaceholder = !v; // sliced/local-only, not yet verified — still shows a verdict per the port spec's "tiles show after slice with verdict unknown"
                      const showVerdict = !!v || !showSp16Panel; // the placeholder pill is the WAV path's contract; the SP-16 path stays quiet until a real verdict exists
                      const padNumbers = showSp16Panel ? (assignedPadNumbersByLoop.get(loop.index) || []) : [];
                      const tooLong = showSp16Panel && loop.durationSeconds > SP16_MAX_SECONDS;
                      const padTint = padNumbers.length ? padColor(padNumbers[0]).base : null;
                      return (
                        <div
                          key={loop.index}
                          id={`loop-tile-${loop.index}`}
                          className="loop-stage-tile"
                          draggable={loopsArmed}
                          aria-disabled={!loopsArmed}
                          onDragStart={(e) => onLoopDragStart(e, loop)}
                          onClick={() => setSelectedLoopIndex(loop.index)}
                          style={{
                            background: tileState ? tileState.fill : '#fff',
                            // tooLong stays amber and outranks everything — it is a
                            // blocker, not a playback state.
                            border: '1px solid ' + (tooLong ? '#f59e0b'
                              : tileState ? tileState.border
                                : isSelected ? GLASS.ink : padTint || GLASS.hair),
                            boxShadow: tileState
                              ? `0 0 0 3px ${tileState.ring}, 0 2px 10px rgba(0,0,0,0.08)`
                              : isSelected ? '0 2px 10px rgba(0,0,0,0.10)' : '0 1px 2px rgba(0,0,0,0.04)',
                            borderRadius: 12,
                            cursor: loopsArmed ? 'grab' : 'default',
                            opacity: loopsArmed ? 1 : 0.45,
                            pointerEvents: loopsArmed ? 'auto' : 'none',
                            display: 'flex', flexDirection: 'column',
                          }}
                        >
                          <span style={{
                            fontFamily: GLASS.mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                            color: tileState ? tileState.ink : GLASS.ink,
                          }}>
                            LOOP {String(loop.index + 1).padStart(2, '0')}
                          </span>
                          {showVerdict ? (
                            <span
                              style={{
                                alignSelf: 'flex-start', fontFamily: GLASS.mono, fontSize: 9, fontWeight: 700,
                                letterSpacing: '0.06em', textTransform: 'uppercase',
                                color: isPlaceholder ? GLASS.inkMute : '#fff',
                                background: isPlaceholder ? 'rgba(0,0,0,0.04)' : (VERDICT_INK[verdict] || 'rgba(0,0,0,0.2)'),
                                border: isPlaceholder ? '1px dashed ' + GLASS.hair : '1px solid transparent',
                                borderRadius: 999, padding: '2px 7px',
                              }}
                            >
                              {verdict}{v ? ` · z ${v.end_to_start_jump_zscore.toFixed(2)}` : ''}
                            </span>
                          ) : null}
                          <span style={{ ...ui.label, color: tooLong ? '#b45309' : GLASS.inkMute }}>
                            {barsPerLoop} BAR · {formatSeconds(loop.durationSeconds)}{tooLong ? ' · TOO LONG' : ''}
                          </span>
                          {tileState ? (
                            <span
                              className={isQueued ? 'loop-tile-queued' : undefined}
                              style={{
                                ...ui.label, alignSelf: 'flex-start', color: '#fff',
                                background: isQueued ? 'rgba(236,72,153,0.75)' : tileState.border,
                                borderRadius: 999, padding: '2px 7px',
                              }}
                            >
                              {isPlaying ? 'PLAYING' : isQueued ? 'QUEUED' : 'LAST'}
                            </span>
                          ) : null}
                          {padNumbers.length ? (
                            <div id={`loop-tile-${loop.index}-pad-chips`} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {padNumbers.map((n) => (
                                <span
                                  key={n}
                                  style={{
                                    ...ui.label, letterSpacing: '0.04em', borderRadius: 999, padding: '3px 7px',
                                    color: padColor(n).ink, background: padColor(n).base,
                                  }}
                                >
                                  PAD {String(n).padStart(2, '0')}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
                            <button
                              type="button"
                              className="loop-tile-btn"
                              onClick={(e) => { e.stopPropagation(); toggleLoopPlay(loop); }}
                              style={{
                                borderRadius: '50%',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid ' + (isPlaying ? LOOP_TILE_STATES.playing.border : GLASS.hair),
                                background: isPlaying ? LOOP_TILE_STATES.playing.border : '#fff',
                                color: isPlaying ? '#fff' : GLASS.ink, cursor: 'pointer',
                              }}
                            >
                              {isPlaying ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                              <span style={SR_ONLY}>{isPlaying ? 'Stop' : 'Play'} loop {loop.index + 1}</span>
                            </button>
                            <button
                              type="button"
                              className="loop-tile-btn"
                              onClick={(e) => { e.stopPropagation(); downloadLoop(loop); }}
                              style={{
                                borderRadius: '50%',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid ' + GLASS.hair, background: '#fff',
                                color: GLASS.ink, cursor: 'pointer',
                              }}
                            >
                              <Download size={12} />
                              <span style={SR_ONLY}>Download loop {loop.index + 1} as WAV</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* ── The SP-16 unit — its own dark chassis panel. Pads light in
                    the hardware's own per-pad colors (./loop/sp16-pad-colors.js)
                    the moment a loop lands on them. ── */}
                {showSp16Panel ? (
                  <section
                    id="loop-studio-sp16-panel"
                    className="loop-stage-panel"
                    style={{
                      gap: 12, borderRadius: 16, padding: 14,
                      background: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.035) 0 1px, rgba(0,0,0,0) 1px 3px), linear-gradient(180deg,#2b2d34 0%,#191a1f 52%,#0f1013 100%)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      boxShadow: '0 18px 44px rgba(20,20,30,0.24), inset 0 1px 0 rgba(255,255,255,0.10)',
                    }}
                  >
                    <div id="loop-studio-sp16-panel-header" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontFamily: GLASS.sans, color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>TORAIZ SP-16</span>
                      <span style={{ ...ui.label, color: 'rgba(255,255,255,0.5)' }}>{assignedPads.length}/16 ASSIGNED</span>
                    </div>
                    <div id="loop-studio-sp16-pad-shell">
                      <div
                        id="loop-studio-sp16-pads"
                        style={{
                          display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))',
                          gridTemplateRows: 'repeat(4, minmax(0,1fr))', gap: 8,
                        }}
                      >
                        {sp16Pads.map((loopIndex, padIndex) => {
                          const loop = loops.find((l) => l.index === loopIndex);
                          const padNumber = padIndex + 1;
                          const tone = padColor(padNumber);
                          const active = sp16PlayingPad === padIndex;
                          const queued = sp16QueuedPad === padIndex;
                          const tooLong = loop && loop.durationSeconds > SP16_MAX_SECONDS;
                          return (
                            <button
                              key={padIndex}
                              type="button"
                              className="loop-sp16-pad"
                              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                              onDrop={(e) => onSp16PadDrop(e, padIndex)}
                              onClick={() => triggerSp16Pad(padIndex)}
                              style={{
                                position: 'relative', minWidth: 0, minHeight: 0, borderRadius: 8,
                                border: '1px solid ' + (tooLong ? '#f59e0b' : queued ? ACCENT : loop ? padBorder(padNumber, active) : 'rgba(255,255,255,0.16)'),
                                background: loop
                                  ? padSurface(padNumber, { active })
                                  : `linear-gradient(180deg,${EMPTY_PAD.base},${EMPTY_PAD.edge})`,
                                color: loop ? tone.ink : EMPTY_PAD.ink,
                                cursor: loop ? 'pointer' : 'copy',
                                boxShadow: active
                                  ? `inset 0 1px 0 rgba(255,255,255,0.5), 0 0 0 2px rgba(255,255,255,0.55), 0 0 26px ${tone.base}88`
                                  : loop
                                    ? 'inset 0 1px 0 rgba(255,255,255,0.35), 0 2px 6px rgba(0,0,0,0.32)'
                                    : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                                padding: 8, display: 'flex', flexDirection: 'column',
                                alignItems: 'flex-start', justifyContent: 'space-between',
                                textAlign: 'left', overflow: 'hidden',
                              }}
                            >
                              <span style={{
                                fontFamily: GLASS.mono, fontSize: 11, fontWeight: 800,
                                color: loop ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.5)',
                              }}>
                                {String(padNumber).padStart(2, '0')}
                              </span>
                              <span style={{
                                fontFamily: GLASS.sans, fontSize: 12, fontWeight: 700, lineHeight: 1.1,
                                color: loop ? tone.ink : 'rgba(255,255,255,0.32)',
                              }}>
                                {loop ? `LOOP ${String(loop.index + 1).padStart(2, '0')}` : 'EMPTY'}
                              </span>
                              {loop ? (
                                <span style={{
                                  ...ui.label, letterSpacing: 0,
                                  color: tooLong ? '#7c2d12' : 'rgba(0,0,0,0.55)',
                                }}>
                                  {tooLong ? 'TOO LONG' : queued ? 'QUEUED' : active ? 'PLAYING' : 'READY'}
                                </span>
                              ) : null}
                              {loop ? (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => { e.stopPropagation(); clearSp16Pad(padIndex); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); clearSp16Pad(padIndex); } }}
                                  style={{
                                    position: 'absolute', top: 6, right: 6, width: 20, height: 20,
                                    borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'rgba(0,0,0,0.28)', color: '#fff', cursor: 'pointer',
                                  }}
                                >
                                  <X size={12} />
                                  <span style={SR_ONLY}>Clear pad {padNumber}</span>
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                ) : null}

                {/* ── EDITTRAX — the live player, built from the loops the user
                    drops onto its part slots. Its own module; shares nothing
                    with the SP-16 path above. ── */}
                {showEdittraxPanel ? (
                  <EdittraxPlayerPanel
                    slots={edittraxSlots}
                    onSlotsChange={setEdittraxSlots}
                    frameRef={edittraxFrameRef}
                    loops={loops}
                    bpm={bpm}
                    barsPerLoop={barsPerLoop}
                    audioBuffer={audioBuffer}
                    engineLoopByIndex={engineLoopByIndex}
                    trackBase={trackBase}
                    setStatus={setStatus}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* ── Under-stage timeline — the same grammar as the mockup tool's
            under-canvas controls and HOLO PAPER's timeline strip: markers left,
            a bank of 46px circle transports dead centre with mono captions,
            zoom right, and below it one track shell holding the waveform, the
            bar ruler and an ACCENT playhead with a draggable ball. The
            waveform is short and lives INSIDE that shell rather than being a
            tall canvas of its own — the track is the shared object across all
            three tools; only what's drawn inside it differs. ── */}
        <div
          id="loop-studio-waveform-strip"
          style={{
            display: 'flex', flexDirection: 'column', gap: 10,
            padding: isNarrow ? '0 12px 14px' : '0 24px 14px', flexShrink: 0,
          }}
        >
          <div id="loop-studio-transport-row" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div id="loop-studio-export-quickpick" style={{ display: 'flex', flex: '0 0 auto', gap: 10, alignItems: 'flex-start' }}>
              {exportTargets.map((t) => {
                const active = exportTarget === t.key;
                return (
                  <div key={t.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                    <button
                      id={`loop-export-target-${t.key}`}
                      type="button"
                      aria-pressed={active}
                      onClick={() => selectExportTarget(t.key)}
                      style={{
                        width: 46, height: 46, borderRadius: 14,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid ' + (active ? 'transparent' : GLASS.hair),
                        background: active
                          ? 'linear-gradient(#fff,#fff) padding-box, ' + GLASS.accent + ' border-box'
                          : 'rgba(255,255,255,0.6)',
                        color: active ? GLASS.ink : GLASS.inkMute,
                        boxShadow: '0 1px 4px rgba(42,36,32,0.1)',
                        cursor: 'pointer',
                        transition: 'background 0.18s ease, color 0.18s ease',
                      }}
                    >
                      {t.icon}
                    </button>
                    <span className="loop-timeline-ctrl-label" style={{ ...ui.label, fontSize: 8, color: active ? GLASS.ink : GLASS.inkMute }}>
                      {t.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div id="loop-studio-transport-dock" style={{ display: 'flex', gap: 14 }}>
              {transportButtons.map((b) => (
                <div key={b.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <button
                    id={b.id}
                    type="button"
                    disabled={b.disabled}
                    onClick={b.onClick}
                    style={{
                      width: 46, height: 46, borderRadius: '50%',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      border: '1px solid ' + (b.active ? 'transparent' : GLASS.hair),
                      background: b.active
                        ? 'linear-gradient(#fff,#fff) padding-box, ' + GLASS.accent + ' border-box'
                        : 'rgba(255,255,255,0.6)',
                      color: GLASS.ink,
                      boxShadow: '0 1px 4px rgba(42,36,32,0.1)',
                      cursor: b.disabled ? 'default' : 'pointer',
                      opacity: b.disabled ? 0.4 : 1,
                      transition: 'background 0.18s ease, color 0.18s ease',
                    }}
                  >
                    {b.icon}
                  </button>
                  <span className="loop-timeline-ctrl-label" style={{ ...ui.label, fontSize: 8, color: b.active ? GLASS.ink : GLASS.inkMute }}>
                    {b.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Volume + Loops sit beside the play controls on a wide row; below
                the stack breakpoint they re-order UP next to the export quick
                pick (see #loop-stage-styles), which is why they are row children
                rather than members of the circle bank. */}
            {/* Sliders — volume, loop count, loop length. Rendered from one
                component so the collapsed menu below the narrow breakpoint is
                the same control, not a second implementation. */}
            <div id="loop-studio-volume-dock" className="loop-strip-dock" style={{ position: 'relative', flexShrink: 0, alignItems: 'center', gap: 5 }}>
              <div
                style={{
                  boxSizing: 'border-box',
                  height: 46, display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '0 14px', borderRadius: 23,
                  border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.6)',
                  boxShadow: '0 1px 4px rgba(42,36,32,0.1)',
                }}
              >
                <button
                  id="loop-studio-volume-mute"
                  type="button"
                  onClick={() => setVolume((v) => (v === 0 ? 1 : 0))}
                  style={{
                    border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                    color: volume === 0 ? GLASS.inkMute : GLASS.ink,
                    display: 'inline-flex', alignItems: 'center',
                  }}
                >
                  {volume === 0 ? <VolumeX size={16} strokeWidth={2.5} /> : <Volume2 size={16} strokeWidth={2.5} />}
                  <span style={SR_ONLY}>{volume === 0 ? 'Unmute' : 'Mute'}</span>
                </button>
                <input
                  id="loop-studio-volume-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(volume * 100)}
                  aria-labelledby="loop-studio-volume-caption"
                  onChange={(e) => setVolume(Math.min(1, Math.max(0, Number(e.target.value) / 100)))}
                  style={{ width: 78, height: 20, margin: 0, accentColor: ACCENT, cursor: 'pointer' }}
                />
              </div>
              <span id="loop-studio-volume-caption" className="loop-timeline-ctrl-label" style={{ ...ui.label, fontSize: 8 }}>VOLUME</span>
            </div>

            <StripSlider
              id="loop-studio-loopcount-dock"
              caption="LOOPS"
              captionId="loop-studio-loopcount-caption"
              min={1}
              max={maxLoopCount}
              value={Math.min(maxLoopCount, Math.max(1, loops.length || 1))}
              disabled={!audioBuffer || !gridTotalBars}
              onChange={setLoopCount}
              readout={loops.length}
            />

            <StripSlider
              id="loop-studio-looplength-dock"
              caption="BARS"
              captionId="loop-studio-looplength-caption"
              min={0}
              max={Math.max(0, lengthSteps.length - 1)}
              value={lengthStepIndex}
              disabled={!audioBuffer || !gridTotalBars || lengthSteps.length < 2}
              onChange={setLoopLengthByStep}
              readout={barsPerLoop}
            />

            {/* BPM — the established tempo, editable here as well as in the
                Grid card; both commit through the same clamp. */}
            <div id="loop-studio-bpm-dock" className="loop-strip-dock" style={{ flexShrink: 0, alignItems: 'center', gap: 5 }}>
              <div
                style={{
                  boxSizing: 'border-box',
                  height: 46, display: 'inline-flex', alignItems: 'center',
                  padding: '0 10px', borderRadius: 23,
                  border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.6)',
                  boxShadow: '0 1px 4px rgba(42,36,32,0.1)',
                  opacity: audioBuffer ? 1 : 0.4,
                }}
              >
                <input
                  id="loop-studio-bpm-input"
                  type="number" min={30} max={300} step={0.01}
                  value={bpmDraft}
                  disabled={!audioBuffer}
                  aria-labelledby="loop-studio-bpm-caption"
                  onChange={(e) => setBpmDraft(e.target.value)}
                  onBlur={(e) => commitBpm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { commitBpm(e.currentTarget.value); e.currentTarget.blur(); } }}
                  style={{
                    width: 62, height: 30, borderRadius: 15, border: '1px solid ' + GLASS.hair,
                    background: '#fff', color: GLASS.ink, fontFamily: GLASS.mono, fontSize: 13,
                    textAlign: 'center', padding: '0 4px',
                  }}
                />
              </div>
              <span id="loop-studio-bpm-caption" className="loop-timeline-ctrl-label" style={{ ...ui.label, fontSize: 8 }}>BPM</span>
            </div>


            {/* Below the narrow breakpoint the three sliders + BPM collapse into
                this one menu (CSS decides which of the two is displayed). */}
            <div id="loop-studio-sliders-dock" style={{ position: 'relative', flexShrink: 0, flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <button
                id="loop-studio-sliders-chip"
                type="button"
                aria-expanded={slidersOpen}
                onClick={() => setSlidersOpen((v) => !v)}
                style={{
                  boxSizing: 'border-box',
                  height: 46, display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '0 14px', borderRadius: 23,
                  border: '1px solid ' + (slidersOpen ? GLASS.ink : GLASS.hair),
                  background: slidersOpen ? GLASS.ink : 'rgba(255,255,255,0.6)',
                  color: slidersOpen ? '#fff' : GLASS.ink,
                  boxShadow: slidersOpen ? 'none' : '0 1px 4px rgba(42,36,32,0.1)',
                  fontFamily: GLASS.sans, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <SlidersHorizontal size={16} strokeWidth={2.5} />
                Mix
                <ChevronUp
                  size={13}
                  style={{ transform: slidersOpen ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s ease' }}
                />
              </button>

              {slidersOpen ? (
                <div
                  id="loop-studio-sliders-panel"
                  style={{
                    position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                    bottom: 'calc(100% + 8px)', zIndex: 20, width: 268,
                    borderRadius: 14, padding: 12,
                    background: 'rgba(255,255,255,0.92)',
                    backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid ' + GLASS.hair,
                    boxShadow: '0 18px 44px rgba(20,20,30,0.18)',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}
                >
                  <StripSlider
                    layout="stacked"
                    caption="VOLUME"
                    captionId="loop-studio-volume-caption-stacked"
                    min={0}
                    max={100}
                    value={Math.round(volume * 100)}
                    onChange={(v) => setVolume(Math.min(1, Math.max(0, Number(v) / 100)))}
                    readout={Math.round(volume * 100)}
                  />
                  <StripSlider
                    layout="stacked"
                    caption="LOOPS"
                    captionId="loop-studio-loopcount-caption-stacked"
                    min={1}
                    max={maxLoopCount}
                    value={Math.min(maxLoopCount, Math.max(1, loops.length || 1))}
                    disabled={!audioBuffer || !gridTotalBars}
                    onChange={setLoopCount}
                    readout={loops.length}
                  />
                  <StripSlider
                    layout="stacked"
                    caption="BARS"
                    captionId="loop-studio-looplength-caption-stacked"
                    min={0}
                    max={Math.max(0, lengthSteps.length - 1)}
                    value={lengthStepIndex}
                    disabled={!audioBuffer || !gridTotalBars || lengthSteps.length < 2}
                    onChange={setLoopLengthByStep}
                    readout={barsPerLoop}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span id="loop-studio-bpm-caption-stacked" style={{ ...ui.label, fontSize: 8, width: 52, flexShrink: 0 }}>BPM</span>
                    <input
                      type="number" min={30} max={300} step={0.01}
                      value={bpmDraft}
                      disabled={!audioBuffer}
                      aria-labelledby="loop-studio-bpm-caption-stacked"
                      onChange={(e) => setBpmDraft(e.target.value)}
                      onBlur={(e) => commitBpm(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { commitBpm(e.currentTarget.value); e.currentTarget.blur(); } }}
                      style={{
                        flex: 1, height: 32, borderRadius: 16, border: '1px solid ' + GLASS.hair,
                        background: '#fff', color: GLASS.ink, fontFamily: GLASS.mono, fontSize: 13,
                        textAlign: 'center', padding: '0 8px',
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <span aria-hidden="true" className="loop-row-break" />

            <div id="loop-studio-actions" style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
              {/* Analysis indicator — replaces the old always-on status pill.
                  It only exists while the analyzer is running, because that is
                  the only window where the tool is doing something the user has
                  to wait on; warnings and history live in the Diagnostics card.
                  Loops stay inactive until this clears. */}
              {analyzing ? (
                <div id="loop-studio-analyzing-dock" style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div
                    id="loop-studio-analyzing-indicator"
                    role="status"
                    aria-live="polite"
                    style={{
                      boxSizing: 'border-box', // see the volume pill: content-box would add 2px
                      height: 46, display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '0 14px', borderRadius: 23,
                      border: '1px solid transparent',
                      background: 'linear-gradient(#fff,#fff) padding-box, ' + GLASS.accent + ' border-box',
                      boxShadow: '0 1px 4px rgba(42,36,32,0.1)',
                      fontFamily: GLASS.sans, fontSize: 12, fontWeight: 600, color: GLASS.ink,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span className="loop-analyzing-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: ACCENT }} />
                    Analyzing
                  </div>
                  <span className="loop-timeline-ctrl-label" style={{ ...ui.label, fontSize: 8, color: GLASS.ink }}>BPM · GRID</span>
                </div>
              ) : null}

              {/* Export rides with the transport: on a wide row it sits at the
                  far right, and when the row folds it lands on the circles' line
                  beside STOP rather than orphaned on a third line. */}
              {/* Same column shape as every other strip control (46px control +
                  5px gap + an 8px mono caption): the row centres these columns,
                  so a bare button would sit a caption's height lower than the
                  transport circles and sliders next to it. The caption slot is
                  a hidden spacer — Export needs no label of its own, but it
                  needs the row's rhythm, and sharing .loop-timeline-ctrl-label
                  keeps it collapsing with the real captions under 560px. */}
              <div
                id="loop-studio-export-dock"
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0, marginLeft: 6 }}
              >
                <button
                  id="loop-studio-export-cta"
                  className="cta-pill-btn"
                  type="button"
                  disabled={exportAction.disabled}
                  onClick={exportAction.onClick}
                  style={{
                    ...ui.cta, height: 46,
                    background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), ' + GLASS.accent,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    opacity: exportAction.disabled ? 0.4 : 1,
                    cursor: exportAction.disabled ? 'default' : 'pointer',
                  }}
                >
                  {exportAction.label}
                  <ArrowUpRight size={14} strokeWidth={2.5} />
                </button>
                <span
                  aria-hidden="true"
                  className="loop-timeline-ctrl-label"
                  style={{ ...ui.label, fontSize: 8, visibility: 'hidden' }}
                >
                  EXPORT
                </span>
              </div>
            </div>
          </div>

          <div id="loop-studio-timeline-row" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: TIMELINE_ROW_MT }}>
            <div
              id="loop-studio-timeline-track"
              style={{
                flex: 1, position: 'relative', height: TIMELINE_TRACK_H, borderRadius: 999,
                background: 'rgba(255,255,255,0.7)', border: '1px solid ' + GLASS.hair,
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
                touchAction: 'none', userSelect: 'none',
              }}
            >
              <canvas
                id="loop-studio-waveform-ruler"
                ref={rulerCanvasRef}
                style={{
                  position: 'absolute', left: TL_PAD, top: 0, width: `calc(100% - ${TL_PAD * 2}px)`,
                  height: TIMELINE_TRACK_H, display: audioBuffer ? 'block' : 'none', pointerEvents: 'none',
                }}
              />

              <div
                id="loop-studio-waveform-mount"
                ref={wsContainerRef}
                onWheel={onWaveformWheel}
                onPointerDown={onWaveformPointerDown}
                onPointerMove={onWaveformPointerMove}
                onPointerUp={onWaveformPointerUp}
                style={{
                  position: 'absolute', left: TL_PAD, top: (TIMELINE_TRACK_H - WAVEFORM_H) / 2,
                  width: `calc(100% - ${TL_PAD * 2}px)`, height: WAVEFORM_H,
                  background: 'transparent', border: 'none',
                  cursor: audioBuffer && zoomFactor <= ZOOM_MIN + 1e-9 ? 'grab' : 'default',
                  touchAction: 'none', overflow: 'hidden',
                }}
              >
                {regionDim.leadingPx > 0 ? (
                  <div id="loop-studio-region-dim-leading" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: regionDim.leadingPx, background: 'rgba(253,250,242,0.7)', pointerEvents: 'none', zIndex: 2 }} />
                ) : null}
                {regionDim.trailingPx > 0 ? (
                  <div id="loop-studio-region-dim-trailing" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: regionDim.trailingPx, background: 'rgba(253,250,242,0.7)', pointerEvents: 'none', zIndex: 2 }} />
                ) : null}
              </div>

              {/* Playhead — the wavesurfer cursor draws the line inside the
                  waveform; this is the grabbable ball that rides on top of it,
                  same 13px/ACCENT/white-ring treatment as the other tools. */}
              {playheadPx != null ? (
                <div id="loop-studio-playhead" style={{ position: 'absolute', left: TL_PAD + playheadPx, top: 0, bottom: 0, zIndex: 5 }}>
                  <span style={{
                    position: 'absolute', top: -3, bottom: -3, left: 0, width: 3, marginLeft: -1.5,
                    background: ACCENT, borderRadius: 999,
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.85)', pointerEvents: 'none',
                  }}
                  />
                  <div
                    id="loop-studio-playhead-handle"
                    role="slider"
                    tabIndex={0}
                    aria-labelledby="loop-studio-playhead-label"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={transportDuration ? Math.round((transportPositionLocal / transportDuration) * 100) : 0}
                    onPointerDown={onPlayheadPointerDown}
                    onPointerMove={onPlayheadPointerMove}
                    onPointerUp={onPlayheadPointerUp}
                    onKeyDown={onSeekBarKeyDown}
                    style={{
                      position: 'absolute', top: -11, left: 0, marginLeft: -11,
                      width: 22, height: 22, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: transportActive ? 'grab' : 'default', touchAction: 'none', outline: 'none',
                    }}
                  >
                    <span style={{
                      width: 13, height: 13, borderRadius: '50%', background: ACCENT,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 2px #fff', pointerEvents: 'none',
                    }}
                    />
                    <span id="loop-studio-playhead-label" style={SR_ONLY}>Playback position</span>
                  </div>
                </div>
              ) : null}
            </div>

            <div id="loop-studio-markers-dock" style={{ position: 'relative', flexShrink: 0 }}>
              <button
                id="loop-studio-markers-chip"
                type="button"
                aria-expanded={markersOpen}
                onClick={() => setMarkersOpen((v) => !v)}
                style={{
                  boxSizing: 'border-box',
                  height: 32, display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '0 11px', borderRadius: 999,
                  border: '1px solid ' + (markersOpen ? GLASS.ink : GLASS.hair),
                  background: markersOpen ? GLASS.ink : 'rgba(255,255,255,0.7)',
                  color: markersOpen ? '#fff' : GLASS.ink,
                  fontFamily: GLASS.sans, fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease',
                }}
              >
                Markers
                {activeOverlayCount ? (
                  <span style={{
                    ...ui.label, fontSize: 8, borderRadius: 999, padding: '2px 6px',
                    color: markersOpen ? GLASS.ink : '#fff', background: markersOpen ? '#fff' : GLASS.ink,
                  }}>
                    {activeOverlayCount}
                  </span>
                ) : null}
                <ChevronUp
                  size={13}
                  style={{ flexShrink: 0, transform: markersOpen ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s ease' }}
                />
              </button>

              {markersOpen ? (
                <div
                  id="loop-studio-markers-panel"
                  style={{
                    position: 'absolute', right: 0, bottom: 'calc(100% + 8px)', zIndex: 20,
                    width: 260, borderRadius: 14, padding: 12, textAlign: 'left',
                    background: 'rgba(255,255,255,0.92)',
                    backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid ' + GLASS.hair,
                    boxShadow: '0 18px 44px rgba(20,20,30,0.18)',
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ ...ui.label, whiteSpace: 'nowrap' }}>MARKERS</span>
                    <span aria-hidden="true" style={{ flex: 1, height: 1, background: GLASS.hair }} />
                  </div>
                  <div id="loop-studio-overlay-toggles" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.keys(DEFAULT_OVERLAYS).map((key) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={!!overlays[key]}
                        onClick={() => setOverlays((prev) => ({ ...prev, [key]: !prev[key] }))}
                        style={{
                          ...ui.btn(!!overlays[key]), height: 26, fontSize: 8, padding: '0 10px',
                          fontFamily: GLASS.mono, letterSpacing: '0.12em',
                        }}
                      >
                        {OVERLAY_LABELS[key]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div id="loop-studio-zoom-controls" style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: 6 }}>
              <button type="button" disabled={!audioBuffer} onClick={() => onZoomButton(-1)} style={{ ...ui.btn(), height: 32, width: 32, padding: 0, fontSize: 13, opacity: audioBuffer ? 1 : 0.4 }}>−</button>
              <button type="button" disabled={!audioBuffer} onClick={() => onZoomButton(1)} style={{ ...ui.btn(), height: 32, width: 32, padding: 0, fontSize: 13, opacity: audioBuffer ? 1 : 0.4 }}>+</button>
            </div>


            <span
              id="loop-transport-time-readout"
              style={{
                flexShrink: 0, height: 32, display: 'inline-flex', alignItems: 'center',
                padding: '0 10px', borderRadius: 10, border: '1px solid ' + GLASS.hair,
                background: 'rgba(255,255,255,0.7)', fontFamily: GLASS.mono, fontSize: 12,
                color: transportActive ? GLASS.ink : GLASS.inkMute, whiteSpace: 'nowrap',
              }}
            >
              {formatTransportTime(transportPositionLocal)} / {formatTransportTime(transportDuration)}
            </span>
          </div>
        </div>

      </div>

      {/* ── Right rail — Loop Studio control cards. ── */}
      <div
        id="loop-studio-rail"
        data-tooltip-disabled="true"
        style={{
          boxSizing: 'border-box', maxWidth: '100%',
          display: 'flex', flexDirection: 'column', overflow: 'visible', background: 'transparent',
          ...(isNarrow
            ? { position: 'relative', width: '100%', flex: 1, minHeight: 0, padding: 12, overflowY: 'auto' }
            : { position: 'absolute', top: 0, right: 0, bottom: 0, width: railW, padding: 14, zIndex: 10, overflowY: 'auto' }),
        }}
      >
        <style id="loop-rail-card-styles">{`
          #loop-studio-rail, #loop-studio-rail * { box-sizing: border-box; }
          .studio-rail-card {
            position: relative; border-radius: 1rem; overflow: hidden;
            background: rgba(255, 255, 255, 0.35);
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            box-shadow: 0px 0px 0px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22);
            transition: background 0.32s cubic-bezier(0.16,1,0.3,1), box-shadow 0.32s cubic-bezier(0.16,1,0.3,1);
          }
          @media (prefers-reduced-motion: reduce) { .studio-rail-card { transition: none; } }
          .studio-rail-card::before {
            content: ''; position: absolute; inset: 0; border-radius: 1rem; padding: 1px;
            background: rgba(176,176,182,0.6);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor; mask-composite: exclude;
            pointer-events: none; opacity: 0.85; transition: opacity 0.45s ease; z-index: 0;
          }
          .studio-rail-card-content { position: relative; z-index: 1; }
          .studio-rail-card-btn { position: relative; z-index: 1; }
        `}
        </style>

        <div id="loop-studio-rail-inner" ref={railInnerRef} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>

          {/* ── Source ── */}
          <RailCard
            id="loop-source-panel" icon={<Music size={18} color="#22d3ee" />} title="Source" subtitle="TRACK IN"
            color="#22d3ee" open={sourceOpen} onToggle={() => setSourceOpen((v) => !v)}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              style={{ ...ui.btn(), width: '100%', opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer' }}
            >
              LOAD TRACK
            </button>
            {engineHealth === 'up' && engineTracks.length ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={ui.label}>KNOWN ENGINE TRACKS</span>
                <select
                  id="loop-source-known-tracks-select"
                  defaultValue=""
                  disabled={busy}
                  onChange={(e) => { if (e.target.value) loadKnownTrack(e.target.value); e.target.value = ''; }}
                  style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
                >
                  <option value="" disabled>Select a track…</option>
                  {engineTracks.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            ) : null}
            {trackMeta ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: GLASS.mono, fontSize: 11, color: GLASS.ink, wordBreak: 'break-all' }}>{trackMeta.name}</span>
                  <span style={ui.label}>{formatSeconds(trackMeta.duration)} · {trackMeta.sampleRate} Hz · {trackMeta.channels}ch</span>
                </div>
                {trackMeta.lossy ? (
                  <div style={{ ...ui.label, color: '#b45309', textTransform: 'none', fontSize: 10 }}>
                    LOSSY SOURCE — encoder padding may break seams. Prefer WAV/AIFF.
                  </div>
                ) : null}
                {analysis?.uploaded?.deduped ? (
                  <div style={{ ...ui.label, color: GLASS.inkMute, textTransform: 'none', fontSize: 10 }}>
                    DEDUPED — reused an existing upload on the engine.
                  </div>
                ) : null}
              </>
            ) : null}
          </RailCard>

          {/* ── Pipeline ── */}
          <RailCard
            id="loop-pipeline-panel" icon={<ListChecks size={18} color="#34d399" />} title="Pipeline" subtitle={stageReadoutText(stage)}
            badge={(
              <span
                id="loop-studio-rail-health-dot"
                style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: engineHealth === 'up' ? '#15803d' : engineHealth === 'down' ? '#b91c1c' : '#9a9a9a',
                }}
              />
            )}
            color="#34d399" open={pipelineOpen} onToggle={() => setPipelineOpen((v) => !v)}
          >
            <div id="loop-pipeline-steps-row" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {PIPELINE_STEPS.map((step, i) => {
                const { state: stepState, disabled } = computeStepState({
                  stepId: step.id, stepIndex: i, stage, busyStep, noCompleteLoops,
                });
                const isBusy = stepState === 'busy';
                const isDone = stepState === 'done';
                const tone = isDone ? '#15803d' : (stepState === 'blocked' ? GLASS.inkMute : GLASS.ink);
                return (
                  <button
                    key={step.id}
                    id={`loop-pipeline-step-${step.id}`}
                    type="button"
                    disabled={disabled && !isBusy}
                    onClick={() => pipelineStepHandlers[step.id]?.()}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      height: 34, padding: '0 10px', borderRadius: 8,
                      border: '1px solid ' + (isBusy ? ACCENT : GLASS.hair),
                      background: isDone ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.6)',
                      color: tone, cursor: disabled && !isBusy ? 'default' : 'pointer', opacity: disabled && !isBusy ? 0.5 : 1,
                    }}
                  >
                    <span style={{ fontFamily: GLASS.sans, fontSize: 11, fontWeight: 700 }}>
                      0{i + 1} · {step.name.toUpperCase()}
                    </span>
                    {isBusy ? <PipelineBusyBlocks /> : (
                      <span style={{ ...ui.label, fontSize: 9 }}>{isDone ? 'DONE' : stepState === 'blocked' ? 'BLOCKED' : 'READY'}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {noCompleteLoops ? (
              <span style={{ ...ui.label, textTransform: 'none', color: '#b91c1c' }}>
                {barsPerLoop} bars per loop is longer than this track — reduce bars per loop to slice.
              </span>
            ) : null}
          </RailCard>

          {/* ── Readout (BPM hero) ── */}
          <RailCard
            id="loop-readout-panel" icon={<Activity size={18} color="#fb7185" />} title="Readout" subtitle="BPM · GRID"
            color="#fb7185" open={readoutOpen} onToggle={() => setReadoutOpen((v) => !v)}
          >
            {analysis ? (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span id="loop-readout-bpm-value" style={{ fontFamily: GLASS.mono, fontSize: 30, fontWeight: 700, color: GLASS.ink, lineHeight: 1 }}>
                    {bpmHeroDisplay}
                  </span>
                  <span style={ui.label}>BPM</span>
                  {analysis.bpm_contested ? (
                    <span id="loop-readout-contested-badge" style={{ ...ui.label, color: '#b45309', background: 'rgba(180,83,9,0.12)', borderRadius: 999, padding: '2px 7px' }}>
                      CONTESTED
                    </span>
                  ) : null}
                </div>
                <span id="loop-readout-classification" style={{ ...ui.label, textTransform: 'none', fontSize: 11, color: GLASS.inkSoft }}>
                  {analysis.classification || '—'}
                </span>
                <span id="loop-readout-downbeat-source" style={{ ...ui.label, textTransform: 'none', fontSize: 10 }}>
                  {analysis.downbeat_source || 'unknown source'}
                  {analysis.downbeat_phase_agreement === false ? ' · phase ranking disagrees' : ''}
                </span>
                <span id="loop-readout-analyzer-crosscheck" style={{ ...ui.label, textTransform: 'none', fontSize: 10 }}>
                  librosa {Number(analysis.analyzers?.librosa?.bpm ?? 0).toFixed(2)} · essentia {Number(analysis.analyzers?.essentia?.bpm ?? 0).toFixed(2)}
                </span>
                <span
                  id="loop-readout-grid-status"
                  ref={gridStatusLineRef}
                  style={{ ...ui.label, textTransform: 'none', fontSize: 10, borderRadius: 6, padding: '2px 4px' }}
                >
                  offset {analysis.offset_samples ?? 0} · phase {analysis.downbeat_selected_phase ?? '?'} · {(analysis.downbeat_times_seconds || []).length} downbeats
                </span>
                {Number.isFinite(analysis.region_start_seconds) || Number.isFinite(analysis.region_end_seconds) ? (
                  <span id="loop-readout-region-line" style={{ ...ui.label, textTransform: 'none', fontSize: 10 }}>
                    region {Number(analysis.region_start_seconds ?? 0).toFixed(2)}s – {Number(analysis.region_end_seconds ?? trackMeta?.duration ?? 0).toFixed(2)}s
                    {analysis.region_adjusted_offset ? ' · origin shifted into region' : ''}
                  </span>
                ) : null}
              </>
            ) : (
              <span style={{ ...ui.label, textTransform: 'none' }}>
                {detection.state === 'running' ? 'Detecting…' : detection.state === 'offline' ? 'Engine offline — load a track to try again.' : 'Load a track to see BPM/downbeat detection.'}
              </span>
            )}
          </RailCard>

          {/* ── Grid ── */}
          <RailCard
            id="loop-grid-panel" icon={<SlidersHorizontal size={18} color="#a78bfa" />} title="Grid" subtitle="BPM · BARS · OFFSET"
            color="#a78bfa" open={gridOpen} onToggle={() => setGridOpen((v) => !v)}
          >
            {detection.state !== 'idle' ? (
              <div id="loop-grid-detection-readout" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {detection.state === 'running' ? (
                  <span style={{ ...ui.label, textTransform: 'none' }}>Detecting BPM + downbeat (engine)…</span>
                ) : detection.state === 'done' ? (
                  <span style={{ ...ui.label, textTransform: 'none', color: detection.contested ? '#b45309' : '#15803d' }}>
                    DETECTED {detection.analysis.bpm_final.toFixed(2)} BPM
                    {detection.contested ? ' · CONTESTED' : ' · analyzers agree'}
                  </span>
                ) : detection.state === 'offline' ? (
                  <span style={{ ...ui.label, textTransform: 'none', color: GLASS.inkMute }}>
                    Engine offline — manual BPM. Start it: services/loopcore/run.sh
                  </span>
                ) : (
                  <span style={{ ...ui.label, textTransform: 'none', color: '#b91c1c' }}>
                    Detection failed — {detection.message}
                  </span>
                )}
                {detection.state === 'done' && detection.analysis.warnings?.length ? (
                  <span style={{ ...ui.label, textTransform: 'none', fontSize: 9, color: '#b45309' }}>
                    {detection.analysis.warnings[0]}
                  </span>
                ) : null}
                {detection.state !== 'running' ? (
                  <button
                    type="button"
                    disabled={!canReDetect}
                    onClick={runReDetect}
                    style={{ ...ui.btn(), height: 26, fontSize: 10, opacity: canReDetect ? 1 : 0.4 }}
                  >
                    RE-DETECT
                  </button>
                ) : null}
              </div>
            ) : null}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>BPM{detection.state === 'done' ? ' (OVERRIDE)' : ''}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number" min={30} max={300} step={0.01}
                  value={bpmDraft}
                  onChange={(e) => setBpmDraft(e.target.value)}
                  onBlur={(e) => commitBpm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { commitBpm(e.currentTarget.value); e.currentTarget.blur(); } }}
                  style={{
                    flex: 1, height: 32, borderRadius: 8, border: '1px solid ' + GLASS.hair,
                    background: '#fff', color: GLASS.ink, fontFamily: GLASS.mono, fontSize: 13, padding: '0 8px',
                  }}
                />
                {detection.state === 'done' ? (
                  <button
                    type="button"
                    disabled={!canUseDetectedBpm}
                    onClick={useDetectedBpm}
                    style={{
                      ...ui.btn(), height: 32, fontSize: 9, padding: '0 8px',
                      opacity: canUseDetectedBpm ? 1 : 0.4, cursor: canUseDetectedBpm ? 'pointer' : 'default',
                    }}
                  >
                    USE DETECTED
                  </button>
                ) : null}
              </div>
            </label>

            {detection.state === 'done' && (detection.analysis.downbeat_phase_candidates?.length > 0) ? (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={ui.label}>PHASE</span>
                <select
                  id="loop-grid-phase-select"
                  value={phaseOverride == null ? '' : String(phaseOverride)}
                  onChange={(e) => setPhaseOverride(e.target.value === '' ? null : Number(e.target.value))}
                  style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
                >
                  {buildPhaseOptions({
                    downbeatSource: detection.analysis.downbeat_source,
                    selectedPhase: detection.analysis.downbeat_selected_phase,
                    candidates: detection.analysis.downbeat_phase_candidates,
                  }).map((opt) => (
                    <option key={opt.value == null ? 'auto' : opt.value} value={opt.value == null ? '' : opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>BARS PER LOOP</span>
              <div style={{ display: 'flex', gap: 5 }}>
                {[1, 2, 4, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    style={{ ...ui.btn(barsPerLoop === n), height: 30, flex: 1, fontSize: 11, padding: '0 6px' }}
                    onClick={() => setBarsPerLoop(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </label>

            <div id="loop-grid-loop-count-slider">
              <Slider
                label="LOOP COUNT"
                min={1}
                max={maxLoopCount}
                step={1}
                value={Math.min(maxLoopCount, Math.max(1, loops.length || 1))}
                disabled={!audioBuffer || !gridTotalBars}
                onChange={setLoopCount}
                fmt={() => `${loops.length} × ${barsPerLoop} BAR`}
              />
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>
                OFFSET<span style={{ color: GLASS.ink }}>{offsetMs.toFixed(1)} ms</span>
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {[-10, -1, 1, 10].map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    style={{ ...ui.btn(), height: 26, fontSize: 10, flex: 1, padding: '0 2px' }}
                    onClick={() => nudgeOffset(ms)}
                  >
                    {ms > 0 ? `+${ms}` : ms}
                  </button>
                ))}
                <button
                  type="button"
                  style={{ ...ui.btn(), height: 26, fontSize: 10, flex: 1, padding: '0 2px' }}
                  onClick={() => setOffsetSamples(0)}
                >
                  RESET
                </button>
              </div>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>METER</span>
              <select
                value={meter}
                onChange={(e) => setMeter(Number(e.target.value))}
                style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
              >
                {[3, 4, 5, 6].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>

            <button
              id="loop-grid-apply-button"
              type="button"
              disabled={detection.state !== 'done' || !!busyStep}
              onClick={applyGridStep}
              style={{ ...ui.btn(), width: '100%', opacity: detection.state === 'done' && !busyStep ? 1 : 0.4 }}
            >
              {busyStep === 'grid' ? 'APPLYING…' : 'APPLY GRID'}
            </button>
            <span style={{ ...ui.label, textTransform: 'none', fontSize: 9 }}>re-slice and re-verify after any change</span>
          </RailCard>

          {/* ── Loops (inspector) ── */}
          <RailCard
            id="loop-loops-panel" icon={<Grid3x3 size={18} color="#60a5fa" />} title="Loops" subtitle="INSPECTOR"
            color="#60a5fa" open={loopsOpen} onToggle={() => setLoopsOpen((v) => !v)}
          >
            {!selectedLoop ? (
              <span style={{ ...ui.label, textTransform: 'none' }}>Load a track to inspect loops.</span>
            ) : (
              <>
                <span style={{ ...ui.label, textTransform: 'none', color: GLASS.ink, fontWeight: 700 }}>
                  LOOP {String(selectedLoop.index + 1).padStart(2, '0')}
                </span>
                {selectedVerdict ? (
                  <>
                    <dl id="loop-loops-inspector-metrics" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 8px', fontSize: 10, fontFamily: GLASS.mono }}>
                      <dt style={{ color: GLASS.inkMute }}>Verdict</dt>
                      <dd style={{ margin: 0, color: VERDICT_INK[selectedVerdict.verdict] || GLASS.ink, fontWeight: 700 }}>{selectedVerdict.verdict.toUpperCase()}</dd>
                      <dt style={{ color: GLASS.inkMute }}>Duration</dt>
                      <dd style={{ margin: 0 }}>{selectedVerdict.duration_seconds?.toFixed(3)}s</dd>
                      <dt style={{ color: GLASS.inkMute }}>Drift vs expected</dt>
                      <dd style={{ margin: 0 }}>
                        {Number.isFinite(selectedVerdict.expected_duration_seconds)
                          ? `${((selectedVerdict.duration_seconds ?? 0) - selectedVerdict.expected_duration_seconds) >= 0 ? '+' : ''}${((selectedVerdict.duration_seconds ?? 0) - selectedVerdict.expected_duration_seconds).toFixed(4)}s`
                          : '—'}
                      </dd>
                      <dt style={{ color: GLASS.inkMute }}>End-start jump z</dt>
                      <dd style={{ margin: 0 }}>{selectedVerdict.end_to_start_jump_zscore?.toFixed(2)}</dd>
                      <dt style={{ color: GLASS.inkMute }}>Raw jump</dt>
                      <dd style={{ margin: 0 }}>{selectedVerdict.end_to_start_raw_jump?.toFixed(4)}</dd>
                      <dt style={{ color: GLASS.inkMute }}>Nearest transient</dt>
                      <dd style={{ margin: 0 }}>
                        {Number.isFinite(selectedVerdict.nearest_transient_to_wrap_ms) ? `${selectedVerdict.nearest_transient_to_wrap_ms.toFixed(1)}ms` : '—'}
                        {selectedVerdict.transient_metric_source ? ` (${selectedVerdict.transient_metric_source === 'source_context' ? 'source' : 'isolated'})` : ''}
                      </dd>
                      <dt style={{ color: GLASS.inkMute }}>Transient risk start/end</dt>
                      <dd style={{ margin: 0 }}>
                        {Number.isFinite(selectedVerdict.start_transient_risk_ms) ? selectedVerdict.start_transient_risk_ms.toFixed(1) : '—'} / {Number.isFinite(selectedVerdict.end_transient_risk_ms) ? selectedVerdict.end_transient_risk_ms.toFixed(1) : '—'}ms
                      </dd>
                      <dt style={{ color: GLASS.inkMute }}>Chroma similarity</dt>
                      <dd style={{ margin: 0 }}>{Number.isFinite(selectedVerdict.chroma_start_end_similarity) ? selectedVerdict.chroma_start_end_similarity.toFixed(3) : '—'}</dd>
                      <dt style={{ color: GLASS.inkMute }}>Dead space start/end</dt>
                      <dd style={{ margin: 0 }}>
                        {selectedVerdict.dead_space_risk ? `${selectedVerdict.dead_space_risk.start_ratio.toFixed(3)} / ${selectedVerdict.dead_space_risk.end_ratio.toFixed(3)}` : '—'}
                      </dd>
                      <dt style={{ color: GLASS.inkMute }}>Adjacency prev/next</dt>
                      <dd style={{ margin: 0 }}>
                        {Number.isFinite(selectedVerdict.prev_adjacency_continuity) ? selectedVerdict.prev_adjacency_continuity.toFixed(4) : '—'} / {Number.isFinite(selectedVerdict.next_adjacency_continuity) ? selectedVerdict.next_adjacency_continuity.toFixed(4) : '—'}
                      </dd>
                      <dt style={{ color: GLASS.inkMute }}>Recommended repair</dt>
                      <dd style={{ margin: 0 }}>{selectedVerdict.recommended_repair || '—'}</dd>
                    </dl>
                    {selectedVerdict.verdict_reasons?.length ? (
                      <ul id="loop-loops-inspector-reasons" style={{ margin: 0, paddingLeft: 14, fontSize: 10, color: GLASS.inkSoft }}>
                        {selectedVerdict.verdict_reasons.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <span style={{ ...ui.label, textTransform: 'none' }}>Run Verify (Pipeline) to see full metrics.</span>
                )}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>AUDITION REPEAT COUNT</span>
                  <input
                    id="loop-loops-repeat-count-input"
                    type="number" min={1} max={16} value={repeatCount}
                    onChange={(e) => setRepeatCount(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                    style={{ height: 30, borderRadius: 8, border: '1px solid ' + GLASS.hair, background: '#fff', fontFamily: GLASS.mono, fontSize: 12, padding: '0 8px' }}
                  />
                </label>
              </>
            )}
          </RailCard>

          {/* ── Repair ── */}
          <RailCard
            id="loop-repair-panel" icon={<Wrench size={18} color="#fb923c" />} title="Repair" subtitle="AUDITION"
            color="#fb923c" open={repairOpen} onToggle={() => setRepairOpen((v) => !v)}
          >
            {!selectedLoop ? (
              <span style={{ ...ui.label, textTransform: 'none' }}>Load a track first.</span>
            ) : (
              <>
                {selectedVerdict ? (
                  <span style={{ ...ui.label, textTransform: 'none', color: VERDICT_INK[selectedVerdict.verdict] }}>
                    LOOP {String(selectedLoopIndex + 1).padStart(2, '0')} — {selectedVerdict.verdict.toUpperCase()} · jump z {selectedVerdict.end_to_start_jump_zscore.toFixed(2)}
                  </span>
                ) : (
                  <span style={{ ...ui.label, textTransform: 'none' }}>
                    Not yet verified — repair still works against the local grid cut.
                  </span>
                )}
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>STRATEGY</span>
                  <select
                    value={repairStrategy}
                    onChange={(e) => setRepairStrategy(e.target.value)}
                    style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
                  >
                    {REPAIR_STRATEGIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={repairRun.state === 'running'}
                  onClick={renderRepair}
                  style={{ ...ui.btn(), width: '100%', opacity: repairRun.state === 'running' ? 0.5 : 1 }}
                >
                  {repairRun.state === 'running' ? 'RENDERING…' : 'RENDER REPAIR'}
                </button>
                {repairRun.state === 'offline' ? (
                  <span style={{ ...ui.label, textTransform: 'none', color: GLASS.inkMute }}>Engine offline — repair unavailable.</span>
                ) : null}
                {repairRun.state === 'error' ? (
                  <span style={{ ...ui.label, textTransform: 'none', color: '#b91c1c' }}>Repair failed — {repairRun.message}</span>
                ) : null}
                {repairRun.state === 'done' && repairRun.result ? (
                  <div ref={repairResultRef} style={{ display: 'flex', flexDirection: 'column', gap: 4, borderRadius: 8 }}>
                    <span style={{ ...ui.label, textTransform: 'none' }}>
                      strategy {repairRun.result.strategy}
                      {repairRun.result.requested_strategy && repairRun.result.requested_strategy !== repairRun.result.strategy ? ` (requested ${repairRun.result.requested_strategy})` : ''}
                    </span>
                    {repairRun.result.output ? <span style={{ ...ui.label, textTransform: 'none', fontSize: 9 }}>{repairRun.result.output.split('/').pop()}</span> : null}
                    {repairRun.result.note ? <span style={{ ...ui.label, textTransform: 'none', fontSize: 9 }}>{repairRun.result.note}</span> : null}
                    <span style={{ ...ui.label, textTransform: 'none' }}>
                      jump z {Number(repairRun.result.before?.end_to_start_jump_zscore ?? 0).toFixed(2)} → {Number(repairRun.result.after?.end_to_start_jump_zscore ?? 0).toFixed(2)}
                      {' '}(Δ {(Number(repairRun.result.after?.end_to_start_jump_zscore ?? 0) - Number(repairRun.result.before?.end_to_start_jump_zscore ?? 0)).toFixed(2)})
                    </span>
                    <span style={{ ...ui.label, textTransform: 'none' }}>
                      raw jump {Number(repairRun.result.before?.end_to_start_raw_jump ?? 0).toFixed(4)} → {Number(repairRun.result.after?.end_to_start_raw_jump ?? 0).toFixed(4)}
                    </span>
                    <span style={{ ...ui.label, textTransform: 'none' }}>
                      chroma sim {Number(repairRun.result.before?.chroma_start_end_similarity ?? 0).toFixed(3)} → {Number(repairRun.result.after?.chroma_start_end_similarity ?? 0).toFixed(3)}
                    </span>
                    <span style={{ ...ui.label, textTransform: 'none', color: repairRun.result.improved ? '#15803d' : '#b45309', fontWeight: 700 }}>
                      IMPROVED {repairRun.result.improved ? 'YES' : 'NO'}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={playRepaired}
                        style={{ ...ui.btn(repairAuditionMode === 'repaired'), flex: 1, fontSize: 10, height: 30 }}
                      >
                        PLAY REPAIRED (LOOPED)
                      </button>
                      <button
                        type="button"
                        onClick={handlePlayOriginalForRepair}
                        style={{ ...ui.btn(repairAuditionMode === 'original'), flex: 1, fontSize: 10, height: 30 }}
                      >
                        PLAY ORIGINAL (LOOPED)
                      </button>
                    </div>
                    {repairRun.message ? (
                      <span style={{ ...ui.label, textTransform: 'none', color: '#b91c1c' }}>{repairRun.message}</span>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </RailCard>

          {/* ── Export ── */}
          <RailCard
            id="loop-export-panel" icon={<Download size={18} color="#f472b6" />} title="Export" subtitle={EXPORT_TARGET_SUBTITLE[exportTarget]}
            color="#f472b6" open={exportOpen} onToggle={() => setExportOpen((v) => !v)}
          >
            <div id="loop-export-target-row" style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => selectExportTarget('wav')}
                style={{ ...ui.btn(exportTarget === 'wav'), height: 30, flex: 1, fontSize: 10, padding: '0 6px' }}
              >
                WAV
              </button>
              <button
                type="button"
                onClick={() => selectExportTarget('sp16')}
                style={{ ...ui.btn(exportTarget === 'sp16'), height: 30, flex: 1, fontSize: 10, padding: '0 6px' }}
              >
                SP-16
              </button>
              <button
                type="button"
                onClick={() => selectExportTarget('edittrax')}
                style={{ ...ui.btn(exportTarget === 'edittrax'), height: 30, flex: 1, fontSize: 10, padding: '0 6px' }}
              >
                EDITTRAX
              </button>
            </div>

            <button
              type="button"
              disabled={exportTarget !== 'wav' || !loops.length}
              onClick={downloadAllZip}
              style={{ ...ui.cta, width: '100%', opacity: exportTarget === 'wav' && loops.length ? 1 : 0.4, cursor: exportTarget === 'wav' && loops.length ? 'pointer' : 'default' }}
            >
              DOWNLOAD ALL (.ZIP)
            </button>
            <span style={ui.label}>16-BIT PCM · SOURCE SAMPLE RATE · {loops.length} LOOPS</span>

            {exportTarget === 'sp16' ? (
              <div id="loop-sp16-export-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ height: 1, background: GLASS.hair, margin: '4px 0' }} />
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={ui.label}>SP-16 SCENE NAME</span>
                  <input
                    type="text"
                    value={sp16ProjectName}
                    onChange={(e) => setSp16ProjectName(e.target.value)}
                    placeholder={trackBase}
                    style={{
                      height: 32, borderRadius: 8, border: '1px solid ' + GLASS.hair,
                      background: '#fff', color: GLASS.ink, fontFamily: GLASS.sans, fontSize: 12, padding: '0 8px',
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={!assignedPads.length || sp16HasTooLongAssignedLoop}
                  onClick={downloadSp16Scene}
                  style={{
                    ...ui.cta, width: '100%',
                    opacity: assignedPads.length && !sp16HasTooLongAssignedLoop ? 1 : 0.4,
                    cursor: assignedPads.length && !sp16HasTooLongAssignedLoop ? 'pointer' : 'default',
                  }}
                >
                  EXPORT SCENE (.SCN)
                </button>
                <span style={{ ...ui.label, textTransform: 'none', letterSpacing: '0.02em' }}>
                  {assignedPads.length}/16 pads · {SP16_TARGET_SAMPLE_RATE} Hz · 16-bit PCM · Loop ON · MT stretch @ {bpmLabel} BPM
                </span>
                <span style={{ ...ui.label, textTransform: 'none', letterSpacing: '0.02em' }}>
                  Copy the .scn into PIONEER DJ SAMPLER/Scenes on the USB drive, then load it from Scene Manager.
                </span>
                {sp16HasTooLongAssignedLoop ? (
                  <span style={{ ...ui.label, textTransform: 'none', color: '#b45309' }}>
                    Assigned loop over {SP16_MAX_SECONDS}s -- remove it or shorten the grid.
                  </span>
                ) : null}
              </div>
            ) : null}

            {exportTarget === 'edittrax' ? (
              <div id="loop-edittrax-export-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ height: 1, background: GLASS.hair, margin: '4px 0' }} />
                <button
                  type="button"
                  disabled={!edittraxSlots.length}
                  onClick={downloadEdittraxZip}
                  style={{
                    ...ui.cta, width: '100%',
                    opacity: edittraxSlots.length ? 1 : 0.4,
                    cursor: edittraxSlots.length ? 'pointer' : 'default',
                  }}
                >
                  BUILD EDITTRAX PLAYER (.ZIP)
                </button>
                <span style={{ ...ui.label, textTransform: 'none', letterSpacing: '0.02em' }}>
                  {edittraxSlots.length} PARTS · {bpm} BPM · {barsPerLoop} BARS/LOOP · SELF-CONTAINED PLAYER
                </span>
              </div>
            ) : null}

            <div style={{ height: 1, background: GLASS.hair, margin: '4px 0' }} />

            <button
              type="button"
              disabled={!verification.report}
              onClick={exportReportStep}
              style={{ ...ui.btn(), width: '100%', opacity: verification.report ? 1 : 0.4 }}
            >
              EXPORT VERIFICATION REPORT (.JSON)
            </button>
            {engineHealth === 'down' ? (
              <span style={{ ...ui.label, textTransform: 'none', color: GLASS.inkMute }}>
                Engine offline — verify/export unavailable. Start it: services/loopcore/run.sh
              </span>
            ) : null}
          </RailCard>

          {/* ── Saves (cloud sessions, logged-in users only) ── */}
          {authedFetch ? (
            <RailCard
              id="loop-saves-panel" icon={<Cloud size={18} color="#0ea5e9" />} title="Saves" subtitle="CLOUD SESSIONS"
              color="#0ea5e9" open={savesOpen} onToggle={() => setSavesOpen((v) => !v)}
            >
              <CloudTemplateSection
                kind="loop" authedFetch={authedFetch} isAdmin={false}
                onCaptureRecipe={captureLoopSession} onLoadRecipe={applyLoopSession}
              />
            </RailCard>
          ) : null}

          {/* ── Diagnostics (collapsed by default) ── */}
          <RailCard
            id="loop-diagnostics-panel" icon={<Bug size={18} color="#94a3b8" />} title="Diagnostics" subtitle="WARNINGS · RAW"
            color="#94a3b8" open={diagnosticsOpen} onToggle={() => setDiagnosticsOpen((v) => !v)}
            badge={(analysis?.warnings?.length) ? (
              <span style={{ ...ui.label, background: 'rgba(180,83,9,0.15)', color: '#b45309', borderRadius: 999, padding: '1px 6px', fontSize: 9 }}>
                {analysis.warnings.length}
              </span>
            ) : null}
          >
            {displayStatus ? (
              <div id="loop-diagnostics-status-line" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={ui.label}>LAST STATUS</span>
                <span style={{
                  fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.4,
                  color: STATUS_TONE_COLOR[statusTone] || GLASS.inkSoft,
                }}>
                  {displayStatus}
                </span>
                <div style={{ height: 1, background: GLASS.hair, margin: '4px 0' }} />
              </div>
            ) : null}
            {analysis?.warnings?.length ? (
              <ul id="loop-diagnostics-warnings" style={{ margin: 0, paddingLeft: 14, fontSize: 10, color: '#b45309' }}>
                {analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            ) : (
              <span style={{ ...ui.label, textTransform: 'none' }}>No analyzer warnings.</span>
            )}
            {verification.report?.loops?.length ? (
              <div id="loop-diagnostics-per-loop" style={{ display: 'flex', flexDirection: 'column', gap: 2, fontFamily: GLASS.mono, fontSize: 9, color: GLASS.inkSoft }}>
                {verification.report.loops.map((l) => (
                  <span key={l.index}>
                    loop {l.index}: {l.verdict} (jump z={l.end_to_start_jump_zscore?.toFixed(2)}, nearest transient={Number.isFinite(l.nearest_transient_to_wrap_ms) ? `${l.nearest_transient_to_wrap_ms.toFixed(1)}ms` : 'n/a'}, chroma sim={Number.isFinite(l.chroma_start_end_similarity) ? l.chroma_start_end_similarity.toFixed(2) : 'n/a'}) — {(l.verdict_reasons || []).join(', ') || 'no issues'}
                  </span>
                ))}
              </div>
            ) : null}
            {analysis?.analyzer_comparison ? (
              <details>
                <summary style={{ ...ui.label, cursor: 'pointer' }}>RAW analyzer_comparison</summary>
                <pre id="loop-diagnostics-raw-json" style={{ fontSize: 9, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: '4px 0 0' }}>
                  {JSON.stringify(analysis.analyzer_comparison, null, 2)}
                </pre>
              </details>
            ) : null}
            <button
              id="loop-diagnostics-export-button"
              type="button"
              disabled={!verification.report}
              onClick={exportReportStep}
              style={{ ...ui.btn(), width: '100%', opacity: verification.report ? 1 : 0.4 }}
            >
              EXPORT REPORT
            </button>
          </RailCard>

        </div>
      </div>
    </>
  );
}

// Pipeline card's marching-block busy indicator — the ONE loading indicator
// in this file (per the port spec's motion rules), 0.12s stagger loop.
// A strip slider: `row` is the pill that sits in the transport row, `stacked`
// is the same control laid out for the collapsed menu. One component so the
// two layouts can never drift apart.
function StripSlider({
  id, caption, captionId, value, min, max, step = 1, disabled, onChange, readout, layout = 'row',
}) {
  const stacked = layout === 'stacked';
  return (
    <div
      id={id}
      className={stacked ? undefined : 'loop-strip-dock'}
      style={stacked
        ? { display: 'flex', alignItems: 'center', gap: 10, width: '100%' }
        : { flexShrink: 0, alignItems: 'center', gap: 5 }}
    >
      {stacked ? (
        <span id={captionId} style={{ ...ui.label, fontSize: 8, width: 52, flexShrink: 0 }}>{caption}</span>
      ) : null}
      <div
        style={{
          boxSizing: 'border-box',
          height: stacked ? 32 : 46, display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: stacked ? '0 10px' : '0 14px', borderRadius: stacked ? 16 : 23,
          border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.6)',
          boxShadow: stacked ? 'none' : '0 1px 4px rgba(42,36,32,0.1)',
          opacity: disabled ? 0.4 : 1,
          flex: stacked ? 1 : undefined,
        }}
      >
        <span style={{ fontFamily: GLASS.mono, fontSize: 12, fontWeight: 700, color: GLASS.ink, minWidth: 18, textAlign: 'right' }}>
          {readout}
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-labelledby={captionId}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: stacked ? '100%' : 78, height: 20, margin: 0, accentColor: ACCENT, cursor: 'pointer' }}
        />
      </div>
      {stacked ? null : (
        <span id={captionId} className="loop-timeline-ctrl-label" style={{ ...ui.label, fontSize: 8 }}>{caption}</span>
      )}
    </div>
  );
}

function PipelineBusyBlocks() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const blocks = el.querySelectorAll('span');
    if (!motionSafe()) { gsap.set(blocks, { opacity: 1 }); return undefined; }
    const tl = gsap.timeline({ repeat: -1 });
    tl.to(blocks, { opacity: 1, duration: 0.12, stagger: 0.12, ease: 'none' })
      .to(blocks, { opacity: 0.25, duration: 0.12, stagger: 0.12, ease: 'none' }, '-=0.12');
    return () => tl.kill();
  }, []);
  return (
    <span ref={ref} style={{ display: 'inline-flex', gap: 3 }}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{ width: 4, height: 4, borderRadius: 1, background: '#15803d', opacity: 0.25, display: 'inline-block' }} />
      ))}
    </span>
  );
}
