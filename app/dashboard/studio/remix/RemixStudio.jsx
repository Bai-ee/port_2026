'use client';

// VIDEO REMIX (?tool=remix) — the EditVideos / Underground Existence remix
// engine expressed as a Studio tool.
//
// Ported from the former standalone route `app/dashboard/video-remix-studio/
// page.jsx` (now a redirect here). The render path is unchanged and is the same
// one the dashboard `video-remix` card uses: a recipe POSTs to
// /api/dashboard/media?action=create-video-remix, which queues a `media_jobs`
// row and hands it to api/_lib/editvideos-bridge.cjs → the EditVideos
// arweave-video-generator worker. Nothing is rendered in the browser and no
// FFmpeg runs in Next — this surface is a recipe builder plus a job poller.
// See docs/source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md.
//
// UI is the Video Studio UX Kit (docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md):
// shared GLASS/ui/RailCard/Slider from ../components/rail-ui, the standard
// `.studio-rail-card` state CSS, useRailReveal entrance, the board/rail
// geometry every sibling tool uses (isNarrow + railW, containerType:size
// artboard, 54vh square mobile cap), the kit's timeline gesture model
// (playhead ball is the ONLY scrub handle), and the render console/toast
// anatomy copied from ../StudioPage.jsx.
//
// The Studio shell is public, so this mounts for signed-out visitors too: the
// whole surface stays readable and only data loading + render are gated on a
// user (the shell's `authedFetch` throws its own sign-in message, which lands
// in the toast).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BadgeCheck, Clapperboard, Film, FolderOpen, Image as ImageIcon, Layers3,
  Music2, Palette, Play, Plus, RefreshCw, RotateCcw, Save, Scissors, Square,
  Type, Upload, WandSparkles,
} from 'lucide-react';
import { GLASS, ui, RailCard, Slider } from '../components/rail-ui';
import { useRailReveal } from '../components/useRailReveal';
import UpRightArrow from '../../../../components/UpRightArrow';
import { STANDARD_REMIX_DEFAULTS, buildRemixRecipe } from '../../../../lib/dashboard/video-remix';

// DISPLAY ONLY — the artboard ratio, the timeline's second markers, the output
// chip. The real output is locked server-side by validateRemixRecipe (720/30/30)
// and set by buildRemixRecipe; editing this changes what the editor SHOWS, not
// what renders.
const OUTPUT = { width: 720, height: 720, fps: 30, format: 'mp4', durationSeconds: 30 };

// Timeline inset — the playhead/marker mapping uses the same pad as the render
// so a drag stays aligned to what the track draws.
const TL_PAD = 14;
const tlLeft = (t) => `calc(${TL_PAD}px + ${t} * (100% - ${TL_PAD * 2}px))`;

// Terminal faces. The rail's GLASS.mono is the Studio's LABEL face (a system
// sans by design) — the render console needs a REAL monospace and the Doto
// marquee, matching ../StudioPage.jsx's console verbatim.
const TERM_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const DOTO = '"Doto", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// The editor opens on the house baseline — STANDARD_REMIX_DEFAULTS in
// lib/dashboard/video-remix.js, the same object the Video Remix card uses and
// the documented lockstep copy of the daily-email production recipe
// (DAILY_EMAIL_VIDEO_PRODUCTION in app/api/worker/pre-digest-video/route.js):
// hard B&W street doc @0.8, no overlay, UE barcode white on top, mixtapes white
// square on the end card, random artist mix. Change it THERE, not here.
const defaultDraft = { ...STANDARD_REMIX_DEFAULTS };

// AuthPage reads `?redirect=` and router.replace()s there once the session
// resolves, so this lands the user back on this tool rather than /dashboard.
const SIGN_IN_HREF = `/login?redirect=${encodeURIComponent('/dashboard/studio?tool=remix')}`;

// The daily email renders from exactly one strict source folder, defaulting to
// DEFAULT_DAILY_VIDEO_SOURCE_FOLDERS (['skyline']) in that same worker route.
// One folder is also what makes a render vary run to run: /api/dashboard/media
// only auto-builds the shuffled, anti-repeat `videoOrder` for a single-folder
// recipe with no explicit order — pick several folders and clip choice falls
// back to the worker's effectively deterministic pick.
const DAILY_EMAIL_SOURCE_FOLDER = 'skyline';

// The draft fields that actually reach the recipe — what "still the baseline"
// is measured against. `selectedFolders` is checked separately (it is per-client
// data, not a constant) and `count` never reaches buildRemixRecipe.
const BASELINE_KEYS = [
  'artist', 'mixTitle', 'useTrax', 'videoFilter', 'filterIntensity',
  'enableOverlay', 'overlayEffect', 'topLogo', 'endLogo', 'useArtistImage', 'endTextOverlay',
];

function pickDefaultFolders(available) {
  if (!available.length) return [];
  return [available.includes(DAILY_EMAIL_SOURCE_FOLDER) ? DAILY_EMAIL_SOURCE_FOLDER : available[0]];
}

const defaultKeyframes = [
  { id: 'k-open', t: 0.0, label: 'Open', type: 'clip', transition: 'cut', sourceFolder: null, text: '' },
  { id: 'k-pulse', t: 0.34, label: 'Overlay', type: 'overlay', transition: 'blend', sourceFolder: null, text: '' },
  { id: 'k-text', t: 0.66, label: 'Text', type: 'text', transition: 'wipe', sourceFolder: null, text: 'TEXT DROP' },
  { id: 'k-end', t: 1.0, label: 'End', type: 'end', transition: 'fade', sourceFolder: null, text: '' },
];

const KEY_TYPES = [
  { value: 'clip', label: 'Clip', Icon: Film },
  { value: 'overlay', label: 'Overlay', Icon: Layers3 },
  { value: 'text', label: 'Text', Icon: Type },
  { value: 'end', label: 'End', Icon: Clapperboard },
];

const TRANSITIONS = ['cut', 'blend', 'wipe', 'flash', 'fade'];

// Compact selection pill — the rail's standard set control (same shape Paint's
// ORNAMENT/LAYOUT rows use).
const pill = (active) => ({ ...ui.btn(active), height: 30, padding: '0 10px', fontSize: 10, gap: 6 });
// Full-width list row.
const row = (active) => ({ ...ui.btn(active), width: '100%', justifyContent: 'flex-start', gap: 8, padding: '0 14px' });
// Text input — the rail has no shared field token; built from GLASS tokens.
const field = {
  height: 36, width: '100%', background: 'rgba(255,255,255,0.7)',
  border: '1px solid ' + GLASS.hair, borderRadius: 10, color: GLASS.ink,
  fontFamily: GLASS.sans, fontSize: 13, padding: '0 12px',
};

// Prefer the bucket's own label; otherwise humanize the key
// (`look_hard_bw_street_doc` → `hard bw street doc`).
function formatFilterLabel(key, fallback) {
  if (fallback) return String(fallback).replace(/^Look\s+/i, '');
  if (!key) return 'Random look';
  return String(key).replace(/^look_/, '').replace(/_/g, ' ');
}

export default function RemixStudio({ isNarrow = false, railW = 336, authedFetch = null, user = null }) {
  const [draft, setDraft] = useState(defaultDraft);
  const [folders, setFolders] = useState([]);
  const [options, setOptions] = useState({ filters: [], overlays: [], artists: [], logos: [] });
  const [captures, setCaptures] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  // Non-null when the EditVideos bucket could not be reached. Surfaced in the
  // rail: the bridge's own helpers swallow errors and return [], which made a
  // dead credential look exactly like an empty bucket.
  const [bridgeError, setBridgeError] = useState(null);
  const [rendering, setRendering] = useState(false);
  const [renderConsoleOpen, setRenderConsoleOpen] = useState(false);
  const [renderPhase, setRenderPhase] = useState('running');
  const [renderLog, setRenderLog] = useState([]);
  const [toast, setToast] = useState(null);
  const [renderVideoUrl, setRenderVideoUrl] = useState(null);
  const [keyframes, setKeyframes] = useState(defaultKeyframes);
  const [selectedKeyId, setSelectedKeyId] = useState('k-open');
  const [scrubVal, setScrubVal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [localMedia, setLocalMedia] = useState([]);

  const [openCards, setOpenCards] = useState({
    source: true, storyboard: true, audio: true, look: true,
    overlay: false, brand: false, captures: false,
  });
  const toggleCard = useCallback((key) => setOpenCards((prev) => ({ ...prev, [key]: !prev[key] })), []);

  const railInnerRef = useRailReveal();
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const lastTapRef = useRef({ time: 0, u: 0, keyId: null });
  const fileInputRef = useRef(null);
  const playTimerRef = useRef(null);
  const renderLogRef = useRef(null);
  const localMediaRef = useRef([]);
  const keyframesRef = useRef(defaultKeyframes);

  useEffect(() => { keyframesRef.current = keyframes; }, [keyframes]);
  useEffect(() => { localMediaRef.current = localMedia; }, [localMedia]);

  // Unmount cleanup — stop the playback timer and release every object URL the
  // local preview media created.
  useEffect(() => () => {
    if (playTimerRef.current) window.clearInterval(playTimerRef.current);
    localMediaRef.current.forEach((item) => URL.revokeObjectURL(item.url));
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), toast.type === 'error' ? 8000 : 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (renderLogRef.current) renderLogRef.current.scrollTop = renderLogRef.current.scrollHeight;
  }, [renderLog]);

  // Signed-out path — the public catalog route. The Studio is a public surface,
  // so the editor loads the REAL EditVideos folders/looks/logos and the default
  // folder's clips without a login; only rendering needs an account. Reports
  // bridge failure explicitly instead of degrading to empty lists.
  const loadPublicData = useCallback(async () => {
    setLoadingData(true);
    try {
      const res = await fetch('/api/public/studio-remix-catalog', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setFolders(Array.isArray(data.folders) ? data.folders : []);
      setOptions({
        filters: data?.options?.filters || [],
        overlays: data?.options?.overlays || [],
        artists: data?.options?.artists || [],
        logos: data?.options?.logos || [],
      });
      setBridgeError(data.bridgeOk ? null : (data.error || 'EditVideos bucket unreachable.'));
      if (data.defaultFolder) {
        setDraft((prev) => (prev.selectedFolders.length ? prev : { ...prev, selectedFolders: [data.defaultFolder] }));
      }
    } catch (err) {
      setBridgeError(err?.message || 'Could not reach the EditVideos bucket.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!user || !authedFetch) return;
    setLoadingData(true);
    try {
      const [optRes, folderRes, jobsRes, bootstrapRes] = await Promise.all([
        authedFetch('/api/dashboard/media?action=options'),
        authedFetch('/api/dashboard/media?action=folders'),
        authedFetch('/api/dashboard/media?action=jobs&type=video-remix'),
        authedFetch('/api/dashboard/bootstrap'),
      ]);
      const [optData, folderData, jobsData, bootstrapData] = await Promise.all([
        optRes.json().catch(() => ({})),
        folderRes.json().catch(() => ({})),
        jobsRes.json().catch(() => ({})),
        bootstrapRes.json().catch(() => ({})),
      ]);
      const nextFolders = Array.isArray(folderData.folders) ? folderData.folders : [];
      setFolders(nextFolders);
      setOptions({
        filters: Array.isArray(optData?.options?.filters) ? optData.options.filters : [],
        overlays: Array.isArray(optData?.options?.overlays) ? optData.options.overlays : [],
        artists: Array.isArray(optData?.options?.artists) ? optData.options.artists : [],
        logos: Array.isArray(optData?.options?.logos) ? optData.options.logos : [],
      });
      setJobs(Array.isArray(jobsData.jobs) ? jobsData.jobs : []);
      const mediaCaptures = Array.isArray(bootstrapData?.dashboardState?.mediaCaptures) ? bootstrapData.dashboardState.mediaCaptures : [];
      setCaptures(mediaCaptures.filter((item) => item?.type === 'video_remix').reverse());
      setDraft((prev) => {
        if (prev.selectedFolders.length || !nextFolders.length) return prev;
        return { ...prev, selectedFolders: pickDefaultFolders(nextFolders) };
      });
    } catch (err) {
      setToast({ type: 'error', text: err?.message || 'Could not load remix options.' });
    } finally {
      setLoadingData(false);
    }
  }, [user, authedFetch]);

  // Signed in → the client-scoped workspace (adds captures + jobs).
  // Signed out → the public catalog. Either way the editor opens on real data.
  useEffect(() => {
    if (user && authedFetch) loadData();
    else loadPublicData();
  }, [user, authedFetch, loadData, loadPublicData]);

  const artistList = options.artists || [];
  const selectedArtist = artistList.find((item) => item.name === draft.artist) || null;
  const mixes = selectedArtist && Array.isArray(selectedArtist.mixes) ? selectedArtist.mixes : [];
  const overlayList = (options.overlays || []).filter((item) => item.value !== '');
  const logoList = options.logos || [];
  // The bucket can hold more logos than the card shows, and the baseline's own
  // two (ue_barcode_white / mixtapes_white_square) are not guaranteed to land in
  // the first slice — pin whatever is selected so the default always reads as on.
  const logoChoices = (selected) => {
    const rest = logoList.filter((logo) => logo !== selected);
    return (selected ? [selected, ...rest] : rest).slice(0, 10);
  };
  const latestCapture = captures[0] || null;
  const selectedKey = keyframes.find((item) => item.id === selectedKeyId) || null;

  const previewMedia = localMedia.find((item) => item.id === selectedKey?.mediaId) || localMedia[0] || null;
  const previewTitle = latestCapture?.downloadUrl
    ? 'Rendered remix'
    : previewMedia ? previewMedia.name : (selectedKey?.sourceFolder || 'Video Remix');
  const activeTimelineLabel = selectedKey
    ? `${Math.round(selectedKey.t * OUTPUT.durationSeconds)}s · ${selectedKey.type || 'clip'} · ${selectedKey.transition || 'cut'}`
    : 'Timeline';
  const canRender = Boolean(user && draft.selectedFolders.length && !rendering);

  const overlayOn = Boolean(draft.enableOverlay && draft.overlayEffect);
  // Exactly one folder is the condition /api/dashboard/media checks before it
  // auto-builds the shuffled anti-repeat clip order — the thing that makes two
  // renders of the same recipe different videos.
  const randomizedClips = draft.selectedFolders.length === 1;
  // Is this still the daily-email baseline? Compares only the fields that reach
  // the recipe, so opening a rail card or retiming the storyboard never flips it.
  const matchesDailyBaseline = randomizedClips && BASELINE_KEYS.every(
    (key) => draft[key] === STANDARD_REMIX_DEFAULTS[key],
  );

  const resetToDailyBaseline = useCallback(() => {
    setDraft((prev) => ({
      ...STANDARD_REMIX_DEFAULTS,
      selectedFolders: pickDefaultFolders(folders.length ? folders : prev.selectedFolders),
    }));
    setToast({ type: 'success', text: 'Recipe reset to the daily-email baseline.' });
  }, [folders]);

  const updateDraft = useCallback((key, value) => setDraft((prev) => ({ ...prev, [key]: value })), []);

  const updateSelectedKey = useCallback((patch) => {
    setKeyframes((prev) => prev.map((item) => (item.id === selectedKeyId ? { ...item, ...patch } : item)));
  }, [selectedKeyId]);

  const toggleFolder = useCallback((folder) => {
    setDraft((prev) => {
      const has = prev.selectedFolders.includes(folder);
      return {
        ...prev,
        selectedFolders: has ? prev.selectedFolders.filter((item) => item !== folder) : [...prev.selectedFolders, folder],
      };
    });
  }, []);

  // ── Timeline ───────────────────────────────────────────────────────────────
  // Gesture model is the kit's (StudioPage.jsx): the playhead ball is the ONLY
  // scrub handle; on the track, drag a marker to retime, double-tap empty track
  // to add, double-tap or long-press a marker to remove, single tap selects.

  const trackUFromEvent = useCallback((event) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left - TL_PAD) / Math.max(1, rect.width - TL_PAD * 2)));
  }, []);

  const snapU = useCallback((u) => {
    let best = u;
    let bestD = 0.022;
    for (const key of keyframesRef.current) {
      const d = Math.abs(key.t - u);
      if (d < bestD) { bestD = d; best = key.t; }
    }
    return best;
  }, []);

  const deleteKey = useCallback((keyId) => {
    setKeyframes((prev) => {
      if (prev.length <= 2) {
        setToast({ type: 'error', text: 'Keep at least two keyframes in the remix timeline.' });
        return prev;
      }
      const next = prev.filter((item) => item.id !== keyId);
      setSelectedKeyId((cur) => (cur === keyId ? (next[0]?.id || null) : cur));
      return next;
    });
  }, []);

  const addKeyAt = useCallback((u) => {
    const id = `k-${Date.now()}`;
    setKeyframes((prev) => {
      let t = u;
      while (prev.some((key) => Math.abs(key.t - t) < 0.01)) t = Math.min(1, t + 0.03);
      return [...prev, {
        id, t, label: 'Media', type: 'clip', transition: 'blend',
        mediaId: localMediaRef.current[0]?.id || null,
        sourceFolder: draft.selectedFolders[0] || null, text: '',
      }];
    });
    setSelectedKeyId(id);
  }, [draft.selectedFolders]);

  const onTrackPointerDown = useCallback((event) => {
    if (playing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const keyId = event.target.dataset?.keyId || null;
    const drag = { keyId, downU: trackUFromEvent(event), moved: false, longFired: false, timer: null };
    if (keyId) {
      setSelectedKeyId(keyId);
      drag.timer = setTimeout(() => {
        if (dragRef.current && !dragRef.current.moved) { dragRef.current.longFired = true; deleteKey(keyId); }
      }, 450); // long-press delete
    }
    dragRef.current = drag;
  }, [playing, trackUFromEvent, deleteKey]);

  const onTrackPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const u = trackUFromEvent(event);
    if (!drag.moved && Math.abs(u - drag.downU) > 0.01) {
      drag.moved = true;
      if (drag.timer) { clearTimeout(drag.timer); drag.timer = null; }
    }
    if (drag.moved && drag.keyId && !drag.longFired) {
      setKeyframes((prev) => prev.map((item) => (item.id === drag.keyId ? { ...item, t: u } : item)));
    }
  }, [trackUFromEvent]);

  const onTrackPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.timer) clearTimeout(drag.timer);
    if (drag.longFired || drag.moved) return;
    const now = Date.now();
    const last = lastTapRef.current;
    const isDouble = (now - last.time) < 320 && Math.abs(drag.downU - last.u) < 0.05 && last.keyId === drag.keyId;
    if (isDouble) {
      lastTapRef.current = { time: 0, u: 0, keyId: null };
      if (drag.keyId) deleteKey(drag.keyId); else addKeyAt(drag.downU);
      return;
    }
    lastTapRef.current = { time: now, u: drag.downU, keyId: drag.keyId };
  }, [deleteKey, addKeyAt]);

  const onPlayheadPointerDown = useCallback((event) => {
    if (playing) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { scrub: true };
  }, [playing]);

  const onPlayheadPointerMove = useCallback((event) => {
    if (!dragRef.current?.scrub) return;
    setScrubVal(snapU(trackUFromEvent(event)));
  }, [snapU, trackUFromEvent]);

  const onPlayheadPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const onMediaFiles = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const next = files.map((file) => ({
      id: `local-${Date.now()}-${file.name}`,
      name: file.name,
      type: file.type || '',
      url: URL.createObjectURL(file),
    }));
    setLocalMedia((prev) => [...next, ...prev].slice(0, 12));
    setKeyframes((prev) => prev.map((item) => (item.id === selectedKeyId
      ? { ...item, mediaId: next[0].id, type: next[0].type.startsWith('image/') ? 'image' : 'clip' }
      : item)));
    event.target.value = '';
  }, [selectedKeyId]);

  const playTimeline = useCallback(() => {
    if (playing) return;
    setPlaying(true);
    if (playTimerRef.current) window.clearInterval(playTimerRef.current);
    playTimerRef.current = window.setInterval(() => {
      setScrubVal((prev) => (prev + 0.012 >= 1 ? 0 : prev + 0.012));
    }, 120);
  }, [playing]);

  const stopTimeline = useCallback(() => {
    if (playTimerRef.current) window.clearInterval(playTimerRef.current);
    playTimerRef.current = null;
    setPlaying(false);
  }, []);

  const resetTimeline = useCallback(() => { stopTimeline(); setScrubVal(0); }, [stopTimeline]);

  // ── Render ─────────────────────────────────────────────────────────────────
  // ONE recipe builder for the whole app — the same buildRemixRecipe the Video
  // Remix card and the daily-email baseline go through, so the editor cannot
  // drift into its own dialect of the schema.
  //
  // NOTE: the storyboard above is a local preview/planning surface. The
  // EditVideos recipe has no keyframe field, so keyframes deliberately do NOT
  // leave the browser and are not part of this payload.
  const buildRecipe = useCallback(
    () => buildRemixRecipe(draft, draft.selectedFolders),
    [draft],
  );

  const pushLog = useCallback((prefix, text, type = 'active', cursor = true) => {
    setRenderLog((prev) => {
      const settled = prev.map((line) => (line.cursor ? { ...line, cursor: false, type: line.type === 'error' ? 'error' : 'ok' } : line));
      return [...settled, { prefix, text, type, cursor }];
    });
  }, []);

  const finishRender = useCallback((ok, message) => {
    setRenderPhase(ok ? 'done' : 'failed');
    setRenderLog((prev) => {
      const settled = prev.map((line) => (line.cursor ? { ...line, cursor: false, type: ok ? 'ok' : 'error' } : line));
      return [...settled, { prefix: ok ? 'DONE' : 'ERROR', text: message, type: ok ? 'ok' : 'error', cursor: false }];
    });
    setToast({ type: ok ? 'success' : 'error', text: message });
  }, []);

  const renderRemix = useCallback(async () => {
    if (!user) { setToast({ type: 'error', text: 'Sign in to render — remixes are saved to your client workspace.' }); return; }
    if (!canRender) { setToast({ type: 'error', text: 'Select at least one source folder before rendering.' }); return; }
    setRendering(true);
    setRenderPhase('running');
    setRenderVideoUrl(null);
    setRenderConsoleOpen(true);
    setRenderLog([
      { prefix: '$', text: 'video remix', type: 'dim', cursor: false },
      { prefix: '->', text: `${draft.selectedFolders.length} source folders, ${draft.videoFilter === 'random' ? 'random look' : draft.videoFilter}`, type: 'dim', cursor: false },
      { prefix: '', text: '------------------------------------------', type: 'dim', cursor: false },
    ]);
    try {
      pushLog('QUEUE', 'Creating Hitloop media job...');
      const res = await authedFetch('/api/dashboard/media?action=create-video-remix', {
        method: 'POST',
        body: JSON.stringify(buildRecipe()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const jobId = data.jobId;
      pushLog('EDIT', data.editJobId ? `Queued EditVideos job ${data.editJobId}.` : 'Queued locally; bridge will reconcile when configured.');
      pushLog('RENDER', 'Waiting for external render worker...');
      let completed = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        const jobRes = await authedFetch(`/api/dashboard/media?action=job&jobId=${encodeURIComponent(jobId)}`);
        const jobData = await jobRes.json().catch(() => ({}));
        if (!jobRes.ok) throw new Error(jobData?.error || `Job poll failed (${jobRes.status})`);
        const job = jobData.job;
        if (job?.status === 'done' && job.output?.downloadUrl) { completed = job.output; break; }
        if (job?.status === 'failed') throw new Error(job.error || 'Video remix failed.');
      }
      if (!completed) {
        finishRender(false, 'Render is still queued; it will appear in Captures when the worker finishes.');
        return;
      }
      setRenderVideoUrl(completed.downloadUrl);
      setCaptures((prev) => [completed, ...prev.filter((item) => item.jobId !== completed.jobId)]);
      finishRender(true, 'Video remix ready and saved to assets.');
    } catch (err) {
      finishRender(false, err?.message || 'Video remix failed.');
    } finally {
      setRendering(false);
      loadData();
    }
  }, [user, canRender, draft.selectedFolders, draft.videoFilter, authedFetch, buildRecipe, pushLog, finishRender, loadData]);

  // Square output → the kit's 54vh narrow-viewport artboard cap.
  const mobileAreaH = '54vh';
  const artPadF = isNarrow ? 88 : 86;

  return (
    <>
      <input ref={fileInputRef} type="file" accept="video/*,image/*" multiple style={{ display: 'none' }} onChange={onMediaFiles} />

      {/* ── Board — 720x720 preview artboard + under-canvas transport/timeline. ── */}
      <div
        id="remix-studio-board"
        style={{
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...(isNarrow
            ? { position: 'relative', width: '100%', flex: 'none' }
            : { position: 'absolute', left: 0, top: 0, bottom: 0, right: railW }),
        }}
      >
        <div
          id="remix-studio-artboard-area"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            containerType: 'size', overflow: 'visible', paddingTop: 74, boxSizing: 'border-box',
            ...(isNarrow ? { height: mobileAreaH, flex: 'none' } : { flex: 1, minHeight: 0 }),
          }}
        >
          <div
            id="remix-studio-artboard"
            style={{
              width: `min(${artPadF}cqw, calc(${artPadF}cqh * ${OUTPUT.width} / ${OUTPUT.height}))`,
              aspectRatio: `${OUTPUT.width} / ${OUTPUT.height}`,
              position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#0b0b0f',
              border: '1px solid rgba(255,255,255,0.6)',
              boxShadow: '0 18px 60px rgba(20,20,30,0.22), 0 2px 10px rgba(0,0,0,0.10)',
            }}
          >
            {latestCapture?.downloadUrl ? (
              <video key={latestCapture.downloadUrl} src={latestCapture.downloadUrl} muted playsInline controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }} />
            ) : previewMedia ? (
              previewMedia.type.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewMedia.url} alt={previewMedia.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <video key={previewMedia.url} src={previewMedia.url} muted playsInline controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }} />
              )
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 20% 20%, rgba(0,173,181,0.34), transparent 32%), radial-gradient(circle at 82% 14%, rgba(139,92,246,0.34), transparent 32%), linear-gradient(135deg,#15151c,#282832)' }}>
                <div style={{ textAlign: 'center', display: 'grid', gap: 12, color: '#fff' }}>
                  <Clapperboard size={46} style={{ margin: '0 auto', opacity: 0.9 }} />
                  <span style={{ fontFamily: DOTO, fontSize: 'clamp(2.2rem, 8cqw, 5.4rem)', lineHeight: 0.86, fontWeight: 700 }}>REMIX</span>
                </div>
              </div>
            )}

            {/* Output chip — desktop only, per the kit. */}
            <div style={{
              position: 'absolute', top: 10, left: 10, zIndex: 6, pointerEvents: 'none',
              ...ui.label, color: '#fff', background: 'rgba(0,0,0,0.5)',
              padding: '4px 10px', borderRadius: 999, backdropFilter: 'blur(6px)',
              display: isNarrow ? 'none' : 'block',
            }}>Output · {OUTPUT.width}×{OUTPUT.height} {OUTPUT.format.toUpperCase()}</div>

            {/* Artboard corner utilities — load local preview media / refresh options. */}
            <div style={{ position: 'absolute', right: 10, top: 10, zIndex: 6, display: 'flex', gap: 8 }}>
              <button type="button" title="Load local preview media" aria-label="Load local preview media" onClick={() => fileInputRef.current?.click()} style={{ width: 32, height: 32, borderRadius: '50%', border: 0, background: 'rgba(0,0,0,0.52)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Upload size={15} /></button>
              <button type="button" title="Refresh options" aria-label="Refresh options" onClick={loadData} style={{ width: 32, height: 32, borderRadius: '50%', border: 0, background: 'rgba(0,0,0,0.52)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><RefreshCw size={15} /></button>
            </div>

            <div style={{ position: 'absolute', left: 14, right: 14, top: 52, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, pointerEvents: 'none' }}>
              <span style={{ ...ui.label, color: '#fff', background: 'rgba(0,0,0,0.35)', borderRadius: 999, padding: '5px 9px', backdropFilter: 'blur(6px)' }}>{activeTimelineLabel}</span>
              {selectedKey?.sourceFolder ? <span style={{ ...ui.label, color: '#fff', background: 'rgba(0,0,0,0.35)', borderRadius: 999, padding: '5px 9px', backdropFilter: 'blur(6px)' }}>{selectedKey.sourceFolder}</span> : null}
            </div>

            {selectedKey?.type === 'text' && (selectedKey.text || draft.endTextOverlay) ? (
              <div style={{ position: 'absolute', left: '8%', right: '8%', top: '42%', transform: 'translateY(-50%)', zIndex: 5, textAlign: 'center', color: '#fff', fontFamily: DOTO, fontSize: 'clamp(2rem, 7cqw, 4.6rem)', lineHeight: 0.9, textShadow: '0 3px 24px rgba(0,0,0,0.65)', pointerEvents: 'none', overflowWrap: 'anywhere' }}>
                {selectedKey.text || draft.endTextOverlay}
              </div>
            ) : null}

            <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: '#fff', pointerEvents: 'none' }}>
              <span style={{ fontFamily: GLASS.sans, fontSize: 13, fontWeight: 600, textShadow: '0 1px 8px rgba(0,0,0,0.55)' }}>{previewTitle}</span>
              <span style={{ ...ui.label, color: '#fff', background: 'rgba(0,0,0,0.38)', borderRadius: 999, padding: '4px 8px' }}>{draft.selectedFolders.length} folder{draft.selectedFolders.length === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>

        {/* Under-canvas controls: element group (left) · transport (centre) ·
            save + render (right). Equal-flex sides keep transport centred. */}
        <div
          id="remix-studio-undercanvas"
          style={{
            display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
            padding: isNarrow ? '10px 12px 16px' : '14px 24px 22px',
          }}
        >
          <div
            id="remix-undercanvas-row"
            style={{
              display: isNarrow ? 'flex' : 'grid',
              ...(isNarrow
                ? { flexDirection: 'column', gap: 8 }
                : { gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 14 }),
            }}
          >
            <div id="remix-undercanvas-element-group" data-tooltip-disabled="true" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...(isNarrow ? { justifyContent: 'center' } : {}) }}>
              <button type="button" onClick={() => fileInputRef.current?.click()} style={{ ...ui.btn(false), gap: 6 }}><Plus size={14} strokeWidth={2.5} />Media</button>
              <button type="button" disabled={!selectedKey} onClick={() => updateSelectedKey({ type: 'text', label: 'Text' })} style={{ ...ui.btn(selectedKey?.type === 'text'), gap: 6, opacity: selectedKey ? 1 : 0.4 }}><Type size={14} strokeWidth={2.5} />Text</button>
              <button type="button" disabled={!selectedKey} onClick={() => updateSelectedKey({ type: 'overlay', label: 'Overlay' })} style={{ ...ui.btn(selectedKey?.type === 'overlay'), gap: 6, opacity: selectedKey ? 1 : 0.4 }}><Layers3 size={14} strokeWidth={2.5} />Overlay</button>
            </div>

            <div id="remix-undercanvas-transport" data-tooltip-disabled="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <button type="button" title="Play" onClick={playTimeline} style={{ ...ui.btn(playing), gap: 6 }}><Play size={15} fill="currentColor" />Play</button>
              <button type="button" title="Stop" disabled={!playing} onClick={stopTimeline} style={{ ...ui.btn(false), gap: 6, opacity: playing ? 1 : 0.4 }}><Square size={13} fill="currentColor" />Stop</button>
              <button type="button" title="Reset" onClick={resetTimeline} style={{ ...ui.btn(false), gap: 6 }}><RotateCcw size={14} strokeWidth={2.5} />Reset</button>
            </div>

            <div id="remix-undercanvas-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: isNarrow ? 'center' : 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setToast({ type: 'success', text: 'Storyboard kept for this session.' })} style={{ ...ui.btn(false), gap: 6, ...(isNarrow ? { width: 46, padding: 0, flexShrink: 0 } : {}) }}><Save size={14} strokeWidth={2.5} />{!isNarrow && 'Save'}</button>
              <button
                type="button"
                id="remix-render-btn"
                className="cta-pill-btn"
                onClick={renderRemix}
                disabled={!canRender}
                style={{ ...ui.cta, gap: 8, opacity: canRender ? 1 : 0.5, cursor: canRender ? 'pointer' : 'default', ...(isNarrow ? { flex: 1, minWidth: 0 } : {}) }}
              >
                {rendering ? 'Rendering…' : 'Render'}<UpRightArrow size={15} />
              </button>
            </div>
          </div>

          {/* Timeline — track + playhead ball + keyframe diamonds, then the
              fixed output duration (the worker owns it; read-only). */}
          <div id="remix-timeline-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              id="remix-timeline-track"
              ref={trackRef}
              onPointerDown={onTrackPointerDown}
              onPointerMove={onTrackPointerMove}
              onPointerUp={onTrackPointerUp}
              style={{ flex: 1, position: 'relative', height: 32, borderRadius: 999, background: 'rgba(255,255,255,0.7)', border: '1px solid ' + GLASS.hair, cursor: playing ? 'default' : 'pointer', touchAction: 'none', userSelect: 'none', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)' }}
            >
              <div style={{ position: 'absolute', left: TL_PAD, top: 0, bottom: 0, width: `calc(${scrubVal} * (100% - ${TL_PAD * 2}px))`, background: 'rgba(236,72,153,0.14)', borderRadius: 999, pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', left: tlLeft(scrubVal), top: -3, bottom: -3, width: 3, marginLeft: -1.5, background: '#ec4899', borderRadius: 999, boxShadow: '0 0 0 1px rgba(255,255,255,0.85)', pointerEvents: 'none', zIndex: 4 }}>
                <div
                  onPointerDown={onPlayheadPointerDown}
                  onPointerMove={onPlayheadPointerMove}
                  onPointerUp={onPlayheadPointerUp}
                  title="Drag to scrub — snaps to keyframes"
                  style={{
                    position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                    width: 22, height: 22, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: playing ? 'none' : 'auto', touchAction: 'none', cursor: 'grab', zIndex: 5,
                  }}
                >
                  <div style={{ width: 13, height: 13, borderRadius: '50%', background: '#ec4899', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 2px #fff', pointerEvents: 'none' }} />
                </div>
              </div>
              {keyframes.map((key) => (
                <div
                  key={key.id}
                  data-key-id={key.id}
                  title={`${(key.t * OUTPUT.durationSeconds).toFixed(1)}s — drag to retime, double-click to remove`}
                  style={{
                    position: 'absolute', left: tlLeft(key.t), top: '50%',
                    width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5, transform: 'rotate(45deg)',
                    background: selectedKeyId === key.id ? GLASS.ink : '#fff',
                    border: '1px solid ' + (selectedKeyId === key.id ? '#fff' : GLASS.inkMute),
                    borderRadius: 2, boxShadow: '0 1px 2px rgba(0,0,0,0.15)', cursor: 'grab',
                  }}
                />
              ))}
            </div>
            <div id="remix-duration-field" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <span style={{ width: 54, height: 32, display: 'grid', placeItems: 'center', borderRadius: 10, border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.7)', color: GLASS.ink, fontFamily: GLASS.mono, fontSize: 13 }}>{OUTPUT.durationSeconds}</span>
              <span style={{ ...ui.label, color: GLASS.inkMute }}>S</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right rail — remix recipe cards. ── */}
      <div
        id="remix-studio-rail"
        data-tooltip-disabled="true"
        style={{
          boxSizing: 'border-box', maxWidth: '100%',
          display: 'flex', flexDirection: 'column', overflow: 'visible', background: 'transparent',
          ...(isNarrow
            ? { position: 'relative', width: '100%', flex: 1, minHeight: 0, padding: 12, overflowY: 'auto' }
            : { position: 'absolute', top: 0, right: 0, bottom: 0, width: railW, padding: 14, zIndex: 10, overflowY: 'auto' }),
        }}
      >
        {/* Rail-card states — StudioPage renders its copy only in mockup mode,
            so each tool carries its own (same as Paint/Cloth/Loop). */}
        <style id="remix-rail-card-styles">{`
          #remix-studio-rail, #remix-studio-rail * { box-sizing: border-box; }
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
        `}</style>

        <div id="remix-studio-rail-inner" ref={railInnerRef} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>

          <RailCard
            id="remix-sources-card" icon={<FolderOpen size={18} strokeWidth={2} />} title="Sources"
            subtitle={matchesDailyBaseline ? 'Daily-email baseline' : `${draft.selectedFolders.length} folders selected`} color="#8b5cf6"
            open={openCards.source} onToggle={() => toggleCard('source')}
            badge={matchesDailyBaseline ? <span style={{ ...ui.label, color: '#fff', background: '#10b981', padding: '2px 8px', borderRadius: 999, fontSize: 9 }}>EMAIL</span> : null}
          >
            {/* The folder list is REAL whether or not anyone is signed in — the
                public catalog route serves it. Only rendering needs an account. */}
            {bridgeError ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 12, lineHeight: 1.5, color: '#9f1f17' }}>
                EditVideos bucket unreachable — {bridgeError}. Folders, looks and logos can&apos;t load until that connection is restored.
              </span>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {folders.map((folder) => (
                <button key={folder} type="button" onClick={() => toggleFolder(folder)} style={pill(draft.selectedFolders.includes(folder))}>
                  <Film size={12} strokeWidth={2.5} />{folder}
                </button>
              ))}
              {!folders.length && !bridgeError && !loadingData
                ? <span style={{ fontFamily: GLASS.sans, fontSize: 12, color: GLASS.inkMute }}>No source folders in the bucket.</span>
                : null}
            </div>
            {/* Honest about what multi-folder costs: the server only shuffles
                clips for a single-folder recipe, so more folders = the worker's
                own repetitive pick, not a richer video. */}
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: randomizedClips ? GLASS.inkMute : '#9f1f17' }}>
              {randomizedClips
                ? 'One folder — clips are shuffled with anti-repeat against your recent renders, so every render is a different cut.'
                : `${draft.selectedFolders.length || 'No'} folders selected. Clip shuffling only runs on a single folder; pick one to get a fresh cut each render.`}
            </span>
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{ ...ui.btn(false), gap: 6 }}><Upload size={14} strokeWidth={2.5} />Load local preview media</button>
            {localMedia.length ? <span style={ui.label}>{localMedia.length} local preview assets loaded</span> : null}
            {/* Browsing and previewing are open; queueing a render writes a job
                to a client workspace, so that alone needs an account. */}
            {!user ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
                Browsing as a guest. <a href={SIGN_IN_HREF} style={{ color: GLASS.ink, fontWeight: 600 }}>Sign in</a> to render — everything else here works signed out.
              </span>
            ) : null}
            {!matchesDailyBaseline ? (
              <button type="button" onClick={resetToDailyBaseline} style={{ ...ui.btn(false), gap: 6 }}><RotateCcw size={14} strokeWidth={2.5} />Reset to daily-email recipe</button>
            ) : null}
          </RailCard>

          <RailCard
            id="remix-storyboard-card" icon={<Scissors size={18} strokeWidth={2} />} title="Storyboard"
            subtitle={activeTimelineLabel} color="#ec4899"
            open={openCards.storyboard} onToggle={() => toggleCard('storyboard')}
            badge={<span style={{ ...ui.label, color: '#fff', background: GLASS.ink, padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>{keyframes.length}</span>}
          >
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>Local planning surface — the EditVideos recipe has no keyframe field, so these stay in the browser.</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {keyframes.map((key) => {
                const active = key.id === selectedKeyId;
                return (
                  <button key={key.id} type="button" onClick={() => setSelectedKeyId(key.id)} style={{ ...row(active), justifyContent: 'space-between' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ ...ui.label, color: active ? 'rgba(255,255,255,0.72)' : GLASS.inkMute }}>{Math.round(key.t * OUTPUT.durationSeconds)}s</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key.label || key.type || 'Keyframe'}</span>
                    </span>
                    <span style={{ ...ui.label, color: active ? 'rgba(255,255,255,0.72)' : GLASS.inkMute }}>{key.transition || 'cut'}</span>
                  </button>
                );
              })}
            </div>

            <span style={{ ...ui.label, marginTop: 6 }}>KEY TYPE</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {KEY_TYPES.map(({ value, label, Icon }) => (
                <button key={value} type="button" disabled={!selectedKey} onClick={() => updateSelectedKey({ type: value, label })} style={{ ...pill(selectedKey?.type === value), opacity: selectedKey ? 1 : 0.4 }}>
                  <Icon size={12} strokeWidth={2.5} />{label}
                </button>
              ))}
            </div>

            <span style={{ ...ui.label, marginTop: 6 }}>TRANSITION</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {TRANSITIONS.map((transition) => (
                <button key={transition} type="button" disabled={!selectedKey} onClick={() => updateSelectedKey({ transition })} style={{ ...pill(selectedKey?.transition === transition), opacity: selectedKey ? 1 : 0.4, textTransform: 'capitalize' }}>
                  {transition}
                </button>
              ))}
            </div>

            <span style={{ ...ui.label, marginTop: 6 }}>SOURCE AT KEY</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {(draft.selectedFolders.length ? draft.selectedFolders : folders.slice(0, 6)).map((folder) => (
                <button key={`key-${folder}`} type="button" disabled={!selectedKey} onClick={() => updateSelectedKey({ sourceFolder: selectedKey?.sourceFolder === folder ? null : folder })} style={{ ...pill(selectedKey?.sourceFolder === folder), opacity: selectedKey ? 1 : 0.4 }}>
                  <Film size={12} strokeWidth={2.5} />{folder}
                </button>
              ))}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={ui.label}>TEXT AT KEY</span>
              <input
                style={field}
                maxLength={80}
                disabled={!selectedKey}
                value={selectedKey?.text || ''}
                placeholder="Text overlay at this point"
                onChange={(event) => updateSelectedKey({ text: event.target.value, type: event.target.value ? 'text' : selectedKey?.type })}
              />
            </label>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => addKeyAt(Math.min(1, scrubVal + 0.08))} style={{ ...ui.btn(false), flex: 1, gap: 6 }}><Plus size={14} strokeWidth={2.5} />Add key</button>
              <button type="button" disabled={!selectedKey} onClick={() => selectedKey && deleteKey(selectedKey.id)} style={{ ...ui.btn(false), flex: 1, color: '#9f1f17', opacity: selectedKey ? 1 : 0.4 }}>Delete key</button>
            </div>
          </RailCard>

          <RailCard
            id="remix-audio-card" icon={<Music2 size={18} strokeWidth={2} />} title="Audio"
            subtitle={draft.useTrax ? 'Tracks mode' : draft.artist === 'random' ? 'Random artist mix' : draft.artist}
            color="#14b8a6" open={openCards.audio} onToggle={() => toggleCard('audio')}
          >
            <span style={ui.label}>SOURCE</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              <button type="button" onClick={() => updateDraft('useTrax', false)} style={pill(!draft.useTrax)}><Music2 size={12} strokeWidth={2.5} />Artist mix</button>
              <button type="button" onClick={() => updateDraft('useTrax', true)} style={pill(draft.useTrax)}><Scissors size={12} strokeWidth={2.5} />Tracks</button>
            </div>

            <span style={{ ...ui.label, marginTop: 6 }}>ARTIST</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              <button type="button" onClick={() => setDraft((prev) => ({ ...prev, artist: 'random', mixTitle: '' }))} style={pill(draft.artist === 'random')}><WandSparkles size={12} strokeWidth={2.5} />Random</button>
              {artistList.slice(0, 9).map((artist) => (
                <button key={artist.name} type="button" onClick={() => setDraft((prev) => ({ ...prev, artist: artist.name, mixTitle: '' }))} style={pill(draft.artist === artist.name)}>
                  <BadgeCheck size={12} strokeWidth={2.5} />{artist.name}
                </button>
              ))}
            </div>

            {!draft.useTrax && draft.artist !== 'random' ? (
              <>
                <span style={{ ...ui.label, marginTop: 6 }}>MIX</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button type="button" onClick={() => updateDraft('mixTitle', '')} style={row(!draft.mixTitle)}>Random mix</button>
                  {mixes.slice(0, 8).map((mix) => (
                    <button key={mix} type="button" onClick={() => updateDraft('mixTitle', mix)} style={row(draft.mixTitle === mix)}>{mix}</button>
                  ))}
                </div>
              </>
            ) : null}
          </RailCard>

          <RailCard
            id="remix-look-card" icon={<Palette size={18} strokeWidth={2} />} title="Look"
            subtitle={draft.videoFilter === 'random'
              ? 'Random look'
              : formatFilterLabel(draft.videoFilter, (options.filters || []).find((f) => f.key === draft.videoFilter)?.label)}
            color="#f59e0b" open={openCards.look} onToggle={() => toggleCard('look')}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              <button type="button" onClick={() => updateDraft('videoFilter', 'random')} style={pill(draft.videoFilter === 'random')}><WandSparkles size={12} strokeWidth={2.5} />Random</button>
              {(options.filters || []).map((filter) => (
                <button key={filter.key} type="button" onClick={() => updateDraft('videoFilter', filter.key)} style={pill(draft.videoFilter === filter.key)}>
                  {formatFilterLabel(filter.key, filter.label)}
                </button>
              ))}
            </div>
            <Slider
              label="Intensity"
              min={0} max={1} step={0.05}
              value={draft.filterIntensity}
              onChange={(value) => updateDraft('filterIntensity', value)}
              fmt={(value) => `${Math.round(value * 100)}%`}
            />
          </RailCard>

          <RailCard
            id="remix-overlays-card" icon={<Layers3 size={18} strokeWidth={2} />} title="Overlays"
            subtitle={overlayOn ? draft.overlayEffect : 'None'} color="#6366f1"
            open={openCards.overlay} onToggle={() => toggleCard('overlay')}
          >
            {/* `enableOverlay` is the gate buildRemixRecipe reads; the effect
                alone is not enough, so both move together here. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              <button type="button" onClick={() => setDraft((prev) => ({ ...prev, enableOverlay: false, overlayEffect: '' }))} style={pill(!overlayOn)}><Layers3 size={12} strokeWidth={2.5} />None</button>
              {overlayList.map((overlay) => (
                <button key={overlay.value} type="button" onClick={() => setDraft((prev) => ({ ...prev, enableOverlay: true, overlayEffect: overlay.value }))} style={pill(overlayOn && draft.overlayEffect === overlay.value)}>
                  {overlay.label}
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={ui.label}>END CARD TEXT</span>
              <input
                style={field}
                maxLength={80}
                value={draft.endTextOverlay}
                disabled={Boolean(draft.endLogo)}
                placeholder={draft.endLogo ? 'Disabled while an end logo is set' : 'End-card caption'}
                onChange={(event) => updateDraft('endTextOverlay', event.target.value)}
              />
            </label>
          </RailCard>

          <RailCard
            id="remix-brand-card" icon={<ImageIcon size={18} strokeWidth={2} />} title="Brand"
            subtitle={draft.topLogo || draft.endLogo || draft.useArtistImage ? 'Brand assets set' : 'No logos'}
            color="#0ea5e9" open={openCards.brand} onToggle={() => toggleCard('brand')}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              <button type="button" onClick={() => updateDraft('useArtistImage', !draft.useArtistImage)} style={pill(draft.useArtistImage)}><ImageIcon size={12} strokeWidth={2.5} />Artist image</button>
              <button type="button" onClick={() => setDraft((prev) => ({ ...prev, topLogo: '', endLogo: '' }))} style={pill(!draft.topLogo && !draft.endLogo)}>No logos</button>
            </div>
            {logoList.length ? (
              <>
                <span style={{ ...ui.label, marginTop: 6 }}>TOP LOGO</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {logoChoices(draft.topLogo).map((logo) => (
                    <button key={`top-${logo}`} type="button" onClick={() => updateDraft('topLogo', draft.topLogo === logo ? '' : logo)} style={pill(draft.topLogo === logo)}>{logo}</button>
                  ))}
                </div>
                <span style={{ ...ui.label, marginTop: 6 }}>END LOGO</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {logoChoices(draft.endLogo).map((logo) => (
                    <button
                      key={`end-${logo}`}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, endLogo: prev.endLogo === logo ? '' : logo, endTextOverlay: prev.endLogo === logo ? prev.endTextOverlay : '' }))}
                      style={pill(draft.endLogo === logo)}
                    >{logo}</button>
                  ))}
                </div>
              </>
            ) : <span style={{ fontFamily: GLASS.sans, fontSize: 12, color: GLASS.inkMute }}>No logos available from the EditVideos bucket.</span>}
          </RailCard>

          <RailCard
            id="remix-captures-card" icon={<Clapperboard size={18} strokeWidth={2} />} title="Captures"
            subtitle={`${captures.length} remixes`} color="#10b981"
            open={openCards.captures} onToggle={() => toggleCard('captures')}
            badge={captures.length ? <span style={{ ...ui.label, color: '#fff', background: GLASS.ink, padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>{captures.length}</span> : null}
          >
            {captures.slice(0, 8).map((capture) => (
              <div key={capture.jobId || capture.downloadUrl} style={{ border: '1px solid ' + GLASS.hair, borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.5)' }}>
                <video src={capture.downloadUrl} controls muted playsInline preload="metadata" style={{ width: '100%', display: 'block', maxHeight: 150, objectFit: 'cover', background: '#000' }} />
                <div style={{ padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ ...ui.label, color: GLASS.inkSoft }}>Video remix</span>
                  <a href={capture.downloadUrl} target="_blank" rel="noreferrer" style={{ ...ui.btn(false), height: 28, padding: '0 12px', fontSize: 10, textDecoration: 'none' }}>Open</a>
                </div>
              </div>
            ))}
            {!captures.length ? <span style={{ fontFamily: GLASS.sans, fontSize: 12, color: GLASS.inkMute }}>No remixes rendered yet.</span> : null}
            {jobs.length ? <span style={ui.label}>Recent jobs: {jobs.slice(0, 3).map((job) => job.status).join(', ')}</span> : null}
          </RailCard>
        </div>
      </div>

      {/* ── Render console — the kit's terminal overlay. Closeable and
          non-blocking: the poll keeps running after dismissal. ── */}
      {renderConsoleOpen ? (
        <div
          id="remix-render-console"
          role="dialog"
          aria-modal="false"
          aria-label="Video remix render progress"
          onClick={(event) => { if (event.target === event.currentTarget) setRenderConsoleOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'clamp(1rem, 5vw, 2rem)', boxSizing: 'border-box',
            background: 'rgba(10,10,16,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          <style>{`
            @keyframes srt-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
            @keyframes srt-blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
            #remix-render-console .srt-line { display: grid; grid-template-columns: 4.2rem 1fr; gap: 0.5em; font-family: ${TERM_MONO}; font-size: 0.68rem; line-height: 1.65; align-items: baseline; color: var(--term-fg); }
            #remix-render-console .srt-pfx { text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; font-size: 0.64rem; letter-spacing: 0.02em; }
            #remix-render-console .srt-msg { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
            #remix-render-console .srt-active .srt-pfx { color: var(--term-active-pfx); }
            #remix-render-console .srt-active .srt-msg { color: var(--term-active-msg); font-weight: 700; }
            #remix-render-console .srt-ok .srt-pfx { color: var(--term-ok-pfx); }
            #remix-render-console .srt-ok .srt-msg { color: var(--term-ok-msg); }
            #remix-render-console .srt-error .srt-pfx { color: var(--term-error-pfx); }
            #remix-render-console .srt-error .srt-msg { color: var(--term-error-msg); }
            #remix-render-console .srt-dim .srt-pfx, #remix-render-console .srt-dim .srt-msg { color: var(--term-dim); }
            #remix-render-console .srt-caret { display: inline-block; width: 0.45em; height: 0.95em; background: var(--term-caret); vertical-align: text-bottom; margin-left: 2px; animation: srt-blink 1s step-start infinite; }
          `}</style>
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              position: 'relative', width: '100%', maxWidth: '40rem',
              padding: 'clamp(1.1rem, 4vw, 1.6rem)', borderRadius: 10, boxSizing: 'border-box',
              background: '#ffffff',
              boxShadow: '0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1), 0px 20px 40px rgba(0,0,0,0.15)',
              border: '1px solid rgba(255,255,255,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', justifyContent: 'space-between' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/img/circle_logo.png" alt="" aria-hidden="true" style={{ width: '2.75rem', height: '2.75rem', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.35)', display: 'block' }} />
              <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: TERM_MONO }}>Video Remix</span>
              <button
                type="button"
                id="remix-render-console-close"
                onClick={() => setRenderConsoleOpen(false)}
                aria-label="Close render console"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: TERM_MONO, fontSize: '0.8rem', color: 'rgba(42,36,32,0.55)', letterSpacing: '0.06em' }}
              >[ ✕ ]</button>
            </div>

            <div style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', animation: 'srt-marquee 18s linear infinite', willChange: 'transform' }}>
                {['a', 'b'].map((key) => (
                  <span key={key} aria-hidden={key === 'b' ? 'true' : undefined} style={{ margin: 0, flexShrink: 0, whiteSpace: 'nowrap', color: '#2a2420', fontSize: 'clamp(2rem, 8.5vw, 7rem)', lineHeight: 1, letterSpacing: '-0.04em', fontFamily: DOTO, fontWeight: 700 }}>{'RENDERING VIDEO REMIX · '.repeat(2)}</span>
                ))}
              </div>
            </div>

            <div style={{ background: 'var(--term-bg)', border: '1px solid var(--term-border)', borderTop: '1px solid var(--term-border-top)', borderRadius: 10, overflow: 'hidden', boxShadow: 'var(--term-shadow)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--term-titlebar-border)', background: 'var(--term-titlebar-bg)' }}>
                <span style={{ width: '0.52rem', height: '0.52rem', borderRadius: 999, background: 'rgba(255,95,86,0.65)' }} />
                <span style={{ width: '0.52rem', height: '0.52rem', borderRadius: 999, background: 'rgba(255,189,46,0.65)' }} />
                <span style={{ width: '0.52rem', height: '0.52rem', borderRadius: 999, background: 'rgba(39,201,63,0.65)' }} />
                <span style={{ flex: 1, textAlign: 'center', fontFamily: TERM_MONO, fontSize: '0.62rem', letterSpacing: '0.08em', color: 'var(--term-title-fg)' }}>remix.process</span>
              </div>
              <div ref={renderLogRef} style={{ padding: '0.7rem 0.85rem 0.8rem', height: '11rem', maxHeight: '40vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                {renderLog.map((line, index) => (
                  <div key={`${line.prefix}-${index}`} className={`srt-line srt-${line.type}`}>
                    <span className="srt-pfx">{line.prefix}</span>
                    <span className="srt-msg">{line.text}{line.cursor ? <span className="srt-caret" /> : null}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontFamily: TERM_MONO, fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.32)', marginTop: '0.9rem', borderTop: '1px solid rgba(212,196,171,0.4)', paddingTop: '0.7rem' }}>
              <span>{`${draft.selectedFolders.length} folder${draft.selectedFolders.length === 1 ? '' : 's'} · ${draft.videoFilter === 'random' ? 'random look' : String(draft.videoFilter || '').replace(/^look_/, '').replace(/_/g, ' ')} · `}{renderPhase === 'failed' ? 'Render failed' : renderPhase === 'done' ? 'Render complete' : 'External worker'}</span>
              {renderPhase === 'done' && renderVideoUrl
                ? <a href={renderVideoUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', textDecoration: 'underline', color: '#2a2420', fontSize: '0.72rem', textTransform: 'none', letterSpacing: 0 }}>Open video <UpRightArrow style={{ marginLeft: '0.15rem', opacity: 0.82 }} /></a>
                : <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: '0.02em' }}>Metadata queue only — no FFmpeg in Next.</span>}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Toast — the kit's render-outcome toast. ── */}
      {toast ? (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          style={{
            position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, maxWidth: '24rem',
            display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.75rem 1rem', borderRadius: 10,
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            boxShadow: '0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.12)',
            fontFamily: GLASS.mono, fontSize: '0.72rem', lineHeight: 1.4, letterSpacing: '0.02em',
            background: toast.type === 'error' ? 'rgba(255,250,248,0.92)' : 'rgba(248,255,250,0.94)',
            border: '1px solid ' + (toast.type === 'error' ? 'rgba(215,25,33,0.32)' : 'rgba(33,150,83,0.32)'),
            color: toast.type === 'error' ? 'rgba(150,22,28,0.92)' : 'rgba(22,110,60,0.95)',
          }}
        >
          <span style={{ flexShrink: 0, marginTop: '0.35rem', width: '0.5rem', height: '0.5rem', borderRadius: 999, background: toast.type === 'error' ? '#d71921' : '#2f9e44' }} />
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" style={{ flexShrink: 0, marginLeft: '0.25rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', color: 'inherit', opacity: 0.6 }}>✕</button>
        </div>
      ) : null}

      {loadingData ? (
        <div style={{ position: 'fixed', left: 18, bottom: 18, zIndex: 40, ...ui.label, color: GLASS.ink, background: 'rgba(255,255,255,0.78)', border: '1px solid ' + GLASS.hair, borderRadius: 999, padding: '7px 10px' }}>Loading remix options…</div>
      ) : null}
    </>
  );
}
