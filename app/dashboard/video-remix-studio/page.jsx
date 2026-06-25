'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Clapperboard,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers3,
  Music2,
  Palette,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Square,
  Type,
  Upload,
  WandSparkles,
} from 'lucide-react';
import { useAuth } from '../../../AuthContext';
import UpRightArrow from '../../../components/UpRightArrow';
import GlassTooltipLayer from '../../../components/GlassTooltipLayer';

const GLASS = {
  surface: {
    background: 'rgba(255,255,255,0.72)',
    border: '1px solid #E4E4E4',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
  },
  bg: 'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
  wash: 'radial-gradient(700px 420px at 0% 4%, rgba(255,120,90,0.14) 0%, transparent 62%), radial-gradient(620px 380px at 100% 10%, rgba(176,90,255,0.14) 0%, transparent 62%)',
  accent: 'linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  ink: '#1a1a1a',
  inkSoft: '#444',
  inkMute: '#8a8a8a',
  hair: '#E4E4E4',
  sans: '"Space Grotesk", system-ui, -apple-system, sans-serif',
  mono: '"Space Mono", ui-monospace, monospace',
  display: '"Doto", "Space Mono", ui-monospace, monospace',
};

const OUTPUT = { width: 720, height: 720, fps: 30, format: 'mp4', durationSeconds: 30 };
const TL_PAD = 14;
const tlLeft = (t) => `calc(${TL_PAD}px + ${t} * (100% - ${TL_PAD * 2}px))`;

const defaultDraft = {
  selectedFolders: [],
  audioMode: 'mix',
  artist: 'random',
  mixTitle: '',
  videoFilter: 'random',
  filterIntensity: 0.8,
  overlayEffect: '',
  topLogo: '',
  endLogo: '',
  useArtistImage: false,
  endTextOverlay: '',
};

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

const TRANSITIONS = [
  { value: 'cut', label: 'Cut' },
  { value: 'blend', label: 'Blend' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'flash', label: 'Flash' },
  { value: 'fade', label: 'Fade' },
];

const control = {
  label: {
    fontSize: 9,
    fontFamily: GLASS.mono,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: GLASS.inkMute,
    fontWeight: 700,
  },
  btn(active = false) {
    return {
      height: 40,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      background: active ? GLASS.ink : 'rgba(255,255,255,0.72)',
      color: active ? '#fff' : GLASS.ink,
      border: '1px solid ' + (active ? GLASS.ink : GLASS.hair),
      borderRadius: 999,
      padding: '0 14px',
      fontSize: 12,
      fontFamily: GLASS.sans,
      fontWeight: 700,
      letterSpacing: '0.01em',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      boxShadow: active ? 'none' : '0 1px 4px rgba(42,36,32,0.08)',
    };
  },
  cta: {
    height: 40,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), ' + GLASS.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 999,
    padding: '0 18px',
    fontSize: 13,
    fontFamily: GLASS.sans,
    fontWeight: 700,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  },
  field: {
    height: 40,
    width: '100%',
    background: 'rgba(255,255,255,0.85)',
    border: '1px solid ' + GLASS.hair,
    borderRadius: 10,
    color: GLASS.ink,
    fontFamily: GLASS.sans,
    fontSize: 13,
    padding: '0 12px',
  },
};

function signedAssetUrl(name) {
  if (!name) return '';
  if (/^https?:\/\//i.test(name)) return name;
  return `logos/${name}`;
}

function formatFilterLabel(key, fallback = 'Random look') {
  return String(fallback || key || 'Random look').replace(/^Look\s+/i, '');
}

function RailCard({ icon, title, subtitle, color, open, onToggle, badge, children }) {
  return (
    <div className={'remix-rail-card' + (open ? ' remix-rail-card--active' : '')}>
      <button type="button" className="remix-rail-card-btn" aria-expanded={open} onClick={onToggle}>
        <span className="remix-rail-card-copy">
          <span className="remix-rail-card-title">{title}</span>
          <span className="remix-rail-card-subtitle">{subtitle}</span>
        </span>
        {badge}
        <span className="remix-rail-card-icon" style={{ color }}>{icon}</span>
      </button>
      <div className="remix-rail-card-body" style={{ maxHeight: open ? 2400 : 0 }}>
        <div className="remix-rail-card-inner">{children}</div>
      </div>
    </div>
  );
}

export default function VideoRemixStudioPage() {
  const authState = useAuth();
  const router = useRouter();
  const isDev = process.env.NODE_ENV === 'development';
  const [smokeMode, setSmokeMode] = useState(false);
  const smokeUser = useMemo(() => ({
    uid: 'video-remix-smoke-user',
    email: 'video-remix-smoke@local.test',
    getIdToken: async () => 'video-remix-smoke-token',
  }), []);
  const user = smokeMode ? smokeUser : authState.user;
  const loading = smokeMode ? false : authState.loading;

  const [draft, setDraft] = useState(defaultDraft);
  const [folders, setFolders] = useState([]);
  const [options, setOptions] = useState({ filters: [], overlays: [], artists: [], logos: [] });
  const [captures, setCaptures] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderConsoleOpen, setRenderConsoleOpen] = useState(false);
  const [renderPhase, setRenderPhase] = useState('running');
  const [renderLog, setRenderLog] = useState([]);
  const [renderToast, setRenderToast] = useState(null);
  const [renderVideoUrl, setRenderVideoUrl] = useState(null);
  const [keyframes, setKeyframes] = useState(defaultKeyframes);
  const [selectedKeyId, setSelectedKeyId] = useState('k-open');
  const [scrubVal, setScrubVal] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [localMedia, setLocalMedia] = useState([]);
  const [draggingKeyId, setDraggingKeyId] = useState(null);

  const [sourceOpen, setSourceOpen] = useState(true);
  const [storyboardOpen, setStoryboardOpen] = useState(true);
  const [audioOpen, setAudioOpen] = useState(true);
  const [lookOpen, setLookOpen] = useState(true);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [capturesOpen, setCapturesOpen] = useState(false);

  const trackRef = useRef(null);
  const fileInputRef = useRef(null);
  const playTimerRef = useRef(null);
  const lastTapRef = useRef({ at: 0, u: 0 });
  const renderLogRef = useRef(null);
  const localMediaRef = useRef([]);

  useEffect(() => {
    if (!isDev || typeof window === 'undefined') return;
    setSmokeMode(new URLSearchParams(window.location.search).get('smoke') === '1');
  }, [isDev]);

  useEffect(() => {
    if (!loading && !user) router.replace('/login?redirect=/dashboard/video-remix-studio');
  }, [loading, user, router]);

  const authedFetch = useCallback(async (path, init = {}) => {
    const token = await user.getIdToken();
    return fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
      cache: 'no-store',
    });
  }, [user]);

  const loadData = useCallback(async () => {
    if (!user) return;
    if (smokeMode) {
      setFolders(['skyline', 'neighborhood', 'stills', 'warehouse', 'night_drive']);
      setOptions({
        filters: [
          { key: 'look_hard_bw_street_doc', label: 'Hard B&W Street Doc' },
          { key: 'look_gritty_neon_club', label: 'Gritty Neon Club' },
          { key: 'look_faded_90s_tape', label: 'Faded 90s Tape' },
          { key: 'look_neon_nightclub', label: 'Neon Nightclub' },
        ],
        overlays: [
          { value: 'analog_film', label: 'Analog Film' },
          { value: 'noise', label: 'Noise' },
          { value: 'retro_dust', label: 'Retro Dust' },
          { value: 'random', label: 'Random' },
        ],
        artists: [
          { name: 'BAI-EE', mixes: ['Warehouse Signal', 'Late Night Loop'] },
          { name: 'Underground Existence', mixes: ['Serial Mix', 'Concrete Room'] },
        ],
        logos: ['serial_logo.png', 'hitloop-mark.png'],
      });
      setDraft((prev) => prev.selectedFolders.length ? prev : { ...prev, selectedFolders: ['skyline', 'neighborhood', 'stills'] });
      return;
    }
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
        return { ...prev, selectedFolders: nextFolders.slice(0, Math.min(3, nextFolders.length)) };
      });
    } catch (err) {
      setRenderToast({ type: 'error', text: err?.message || 'Could not load remix studio data.' });
    } finally {
      setLoadingData(false);
    }
  }, [user, authedFetch, smokeMode]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => { localMediaRef.current = localMedia; }, [localMedia]);

  useEffect(() => () => {
    playTimerRef.current && window.clearInterval(playTimerRef.current);
    localMediaRef.current.forEach((item) => URL.revokeObjectURL(item.url));
  }, []);

  useEffect(() => {
    if (!renderToast) return undefined;
    const timer = window.setTimeout(() => setRenderToast(null), renderToast.type === 'error' ? 8000 : 6000);
    return () => window.clearTimeout(timer);
  }, [renderToast]);

  useEffect(() => {
    if (renderLogRef.current) renderLogRef.current.scrollTop = renderLogRef.current.scrollHeight;
  }, [renderLog]);

  const artistList = options.artists || [];
  const selectedArtist = artistList.find((item) => item.name === draft.artist) || null;
  const mixes = selectedArtist && Array.isArray(selectedArtist.mixes) ? selectedArtist.mixes : [];
  const filterList = options.filters || [];
  const overlayList = (options.overlays || []).filter((item) => item.value !== '');
  const logoList = options.logos || [];
  const latestCapture = captures[0] || null;
  const selectedKey = keyframes.find((item) => item.id === selectedKeyId) || keyframes[0];

  const previewMedia = localMedia.find((item) => item.id === selectedKey?.mediaId) || localMedia[0] || null;
  const previewTitle = latestCapture?.downloadUrl ? 'Rendered Remix' : previewMedia ? previewMedia.name : (selectedKey?.sourceFolder || 'Video Remix');
  const activeTimelineLabel = selectedKey
    ? `${Math.round(selectedKey.t * OUTPUT.durationSeconds)}s / ${selectedKey.type || 'clip'} / ${selectedKey.transition || 'cut'}`
    : 'Timeline';
  const canRender = Boolean(user && draft.selectedFolders.length && !rendering);

  const updateDraft = useCallback((key, value) => setDraft((prev) => ({ ...prev, [key]: value })), []);

  const updateSelectedKey = useCallback((patch) => {
    setKeyframes((prev) => prev.map((item) => (item.id === selectedKeyId ? { ...item, ...patch } : item)));
  }, [selectedKeyId]);

  const deleteSelectedKey = useCallback(() => {
    setKeyframes((prev) => {
      if (prev.length <= 2) {
        setRenderToast({ type: 'error', text: 'Keep at least two keyframes in the remix timeline.' });
        return prev;
      }
      const next = prev.filter((item) => item.id !== selectedKeyId);
      if (!next.some((item) => item.id === selectedKeyId)) setSelectedKeyId(next[0]?.id || null);
      return next;
    });
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

  const trackUFromEvent = useCallback((event) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left - TL_PAD) / Math.max(1, rect.width - TL_PAD * 2)));
  }, []);

  const addKeyframe = useCallback((u) => {
    const id = `k-${Date.now()}`;
    setKeyframes((prev) => {
      let t = u;
      while (prev.some((key) => Math.abs(key.t - t) < 0.02)) t = Math.min(1, t + 0.04);
      return [...prev, {
        id,
        t,
        label: 'Media',
        type: 'clip',
        transition: 'blend',
        mediaId: localMedia[0]?.id || null,
        sourceFolder: draft.selectedFolders[0] || null,
        text: '',
      }].sort((a, b) => a.t - b.t);
    });
    setSelectedKeyId(id);
    setScrubVal(u);
  }, [draft.selectedFolders, localMedia]);

  const onTrackPointerDown = useCallback((event) => {
    if (playing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const keyId = event.target.dataset?.keyId || null;
    const u = trackUFromEvent(event);
    if (keyId) {
      setDraggingKeyId(keyId);
      setSelectedKeyId(keyId);
      setScrubVal(u);
    }
  }, [playing, trackUFromEvent]);

  const onTrackPointerMove = useCallback((event) => {
    if (!draggingKeyId || playing) return;
    const u = trackUFromEvent(event);
    setKeyframes((prev) => prev.map((item) => (item.id === draggingKeyId ? { ...item, t: u } : item)).sort((a, b) => a.t - b.t));
    setScrubVal(u);
  }, [draggingKeyId, playing, trackUFromEvent]);

  const onTrackPointerUp = useCallback((event) => {
    const keyId = draggingKeyId;
    setDraggingKeyId(null);
    if (keyId) return;
    const u = trackUFromEvent(event);
    const now = Date.now();
    const last = lastTapRef.current;
    const isDouble = now - last.at < 320 && Math.abs(last.u - u) < 0.05;
    lastTapRef.current = { at: now, u };
    if (isDouble) {
      addKeyframe(u);
      fileInputRef.current?.click();
    } else {
      setScrubVal(u);
    }
  }, [draggingKeyId, trackUFromEvent, addKeyframe]);

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
    setKeyframes((prev) => prev.map((item) => (item.id === selectedKeyId ? { ...item, mediaId: next[0].id, type: next[0].type.startsWith('image/') ? 'image' : 'clip' } : item)));
    event.target.value = '';
  }, [selectedKeyId]);

  const playTimeline = useCallback(() => {
    if (playing) return;
    setPlaying(true);
    playTimerRef.current && window.clearInterval(playTimerRef.current);
    playTimerRef.current = window.setInterval(() => {
      setScrubVal((prev) => {
        const next = prev + 0.012;
        if (next >= 1) return 0;
        return next;
      });
    }, 120);
  }, [playing]);

  const stopTimeline = useCallback(() => {
    playTimerRef.current && window.clearInterval(playTimerRef.current);
    playTimerRef.current = null;
    setPlaying(false);
  }, []);

  const resetTimeline = useCallback(() => {
    stopTimeline();
    setScrubVal(0);
  }, [stopTimeline]);

  const buildRecipe = useCallback(() => ({
    sourceFolders: draft.selectedFolders,
    output: OUTPUT,
    artist: draft.artist === 'random' ? null : draft.artist,
    mixTitle: draft.audioMode === 'mix' ? (draft.mixTitle || null) : null,
    useTrax: draft.audioMode === 'tracks',
    filter: draft.videoFilter && draft.videoFilter !== 'random'
      ? { key: draft.videoFilter, intensity: draft.filterIntensity }
      : { intensity: draft.filterIntensity },
    overlay: draft.overlayEffect ? { enabled: true, effect: draft.overlayEffect } : { enabled: false },
    logos: { top: draft.topLogo || null, end: draft.endLogo || null },
    useArtistImage: draft.useArtistImage,
    endCard: draft.endTextOverlay ? { text: draft.endTextOverlay } : null,
  }), [draft]);

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
    setRenderToast({ type: ok ? 'success' : 'error', text: message });
  }, []);

  const renderRemix = useCallback(async () => {
    if (!canRender) {
      setRenderToast({ type: 'error', text: 'Select at least one source folder before rendering.' });
      return;
    }
    setRendering(true);
    setRenderPhase('running');
    setRenderVideoUrl(null);
    setRenderConsoleOpen(true);
    setRenderLog([
      { prefix: '$', text: 'video remix studio', type: 'dim', cursor: false },
      { prefix: '->', text: `${draft.selectedFolders.length} source folders, ${draft.videoFilter === 'random' ? 'random look' : draft.videoFilter}`, type: 'dim', cursor: false },
      { prefix: '', text: '------------------------------------------', type: 'dim', cursor: false },
    ]);
    if (smokeMode) {
      pushLog('QUEUE', 'Smoke job created.');
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      pushLog('EDIT', 'Recipe mapped to EditVideos schema.');
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      pushLog('RENDER', 'Visual render path verified.');
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      finishRender(true, 'Smoke render complete.');
      setRendering(false);
      return;
    }
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
        if (job?.status === 'done' && job.output?.downloadUrl) {
          completed = job.output;
          break;
        }
        if (job?.status === 'failed') throw new Error(job.error || 'Video remix failed.');
      }
      if (!completed) {
        finishRender(false, 'Render is still queued; it will appear in saved assets when the worker finishes.');
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
  }, [authedFetch, buildRecipe, canRender, draft.selectedFolders.length, draft.videoFilter, finishRender, loadData, pushLog, smokeMode]);

  if (loading) return null;

  if (!user) {
    return (
      <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: GLASS.bg, color: GLASS.ink, fontFamily: GLASS.sans }}>
        <section style={{ width: 'min(100%, 420px)', display: 'grid', gap: 16, textAlign: 'center', ...GLASS.surface, borderRadius: 12, padding: 24 }}>
          <span style={control.label}>Video Remix Studio</span>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, letterSpacing: 0 }}>Sign in to open Studio</h1>
          <p style={{ margin: 0, color: GLASS.inkSoft, fontSize: 14, lineHeight: 1.55 }}>Video renders are attached to your client workspace.</p>
          <a href="/login?redirect=/dashboard/video-remix-studio" style={{ ...control.cta, textDecoration: 'none', margin: '0 auto' }}>Sign in</a>
        </section>
      </main>
    );
  }

  return (
    <div id="video-remix-studio-shell" style={{ position: 'fixed', inset: 0, background: GLASS.wash + ', ' + GLASS.bg, color: GLASS.ink, fontFamily: GLASS.sans, display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 50 }}>
      <GlassTooltipLayer />
      <input ref={fileInputRef} type="file" accept="video/*,image/*" multiple style={{ display: 'none' }} onChange={onMediaFiles} />

      <a href="/dashboard" aria-label="Back to dashboard" style={{ position: 'absolute', top: 18, left: 20, zIndex: 20, display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
        <img src="/img/circle_logo.png" alt="Bryan Balli logo" width={663} height={552} style={{ height: 'clamp(2rem, 4vw, 2.8rem)', width: 'auto', display: 'block', mixBlendMode: 'darken' }} />
      </a>

      <div id="remix-main-row" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
        <main id="remix-board" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', padding: '72px 18px 14px', gap: 12 }}>
          <section id="remix-artboard-area" style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div id="remix-artboard" style={{ width: 'min(74vh, 74vw)', maxWidth: 720, aspectRatio: '1 / 1', position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#0b0b0f', border: '1px solid rgba(255,255,255,0.6)', boxShadow: '0 18px 60px rgba(20,20,30,0.22), 0 2px 10px rgba(0,0,0,0.10)' }}>
              {latestCapture?.downloadUrl ? (
                <video key={latestCapture.downloadUrl} src={latestCapture.downloadUrl} muted playsInline controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }} />
              ) : previewMedia ? (
                previewMedia.type.startsWith('image/') ? (
                  <img src={previewMedia.url} alt={previewMedia.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <video key={previewMedia.url} src={previewMedia.url} muted playsInline controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }} />
                )
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 20% 20%, rgba(0,173,181,0.34), transparent 32%), radial-gradient(circle at 82% 14%, rgba(139,92,246,0.34), transparent 32%), linear-gradient(135deg,#15151c,#282832)' }}>
                  <div style={{ textAlign: 'center', display: 'grid', gap: 12, color: '#fff' }}>
                    <Clapperboard size={46} style={{ margin: '0 auto', opacity: 0.9 }} />
                    <h1 style={{ margin: 0, fontFamily: GLASS.display, fontSize: 'clamp(2.2rem, 8vw, 5.8rem)', lineHeight: 0.86, letterSpacing: 0 }}>REMIX</h1>
                  </div>
                </div>
              )}

              <div style={{ position: 'absolute', top: 10, left: 10, ...control.label, color: '#fff', background: 'rgba(0,0,0,0.52)', padding: '5px 10px', borderRadius: 999, backdropFilter: 'blur(6px)' }}>Output 720x720 MP4</div>
              <div style={{ position: 'absolute', right: 10, top: 10, display: 'flex', gap: 8 }}>
                <button type="button" title="Load local media" onClick={() => fileInputRef.current?.click()} style={{ width: 32, height: 32, borderRadius: '50%', border: 0, background: 'rgba(0,0,0,0.52)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Upload size={15} /></button>
                <button type="button" title="Refresh options" onClick={loadData} style={{ width: 32, height: 32, borderRadius: '50%', border: 0, background: 'rgba(0,0,0,0.52)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><RefreshCw size={15} /></button>
              </div>
              <div style={{ position: 'absolute', left: 14, right: 14, bottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: '#fff', pointerEvents: 'none' }}>
                <span style={{ fontFamily: GLASS.sans, fontSize: 13, fontWeight: 700, textShadow: '0 1px 8px rgba(0,0,0,0.55)' }}>{previewTitle}</span>
                <span style={{ ...control.label, color: '#fff', background: 'rgba(0,0,0,0.38)', borderRadius: 999, padding: '4px 8px' }}>{draft.selectedFolders.length} folders</span>
              </div>
              <div style={{ position: 'absolute', left: 14, right: 14, top: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, pointerEvents: 'none' }}>
                <span style={{ ...control.label, color: '#fff', background: 'rgba(0,0,0,0.35)', borderRadius: 999, padding: '5px 9px', backdropFilter: 'blur(6px)' }}>{activeTimelineLabel}</span>
                {selectedKey?.sourceFolder ? <span style={{ ...control.label, color: '#fff', background: 'rgba(0,0,0,0.35)', borderRadius: 999, padding: '5px 9px', backdropFilter: 'blur(6px)' }}>{selectedKey.sourceFolder}</span> : null}
              </div>
              {selectedKey?.type === 'text' && (selectedKey.text || draft.endTextOverlay) ? (
                <div style={{ position: 'absolute', left: '8%', right: '8%', top: '42%', transform: 'translateY(-50%)', textAlign: 'center', color: '#fff', fontFamily: GLASS.display, fontSize: 'clamp(2rem, 7vw, 4.8rem)', lineHeight: 0.9, textShadow: '0 3px 24px rgba(0,0,0,0.65)', pointerEvents: 'none', overflowWrap: 'anywhere' }}>
                  {selectedKey.text || draft.endTextOverlay}
                </div>
              ) : null}
            </div>
          </section>

          <section id="remix-under-canvas-controls" style={{ display: 'grid', gap: 12, padding: '0 8px 2px' }}>
            <div className="remix-undercanvas-row">
              <div className="remix-left-controls" data-tooltip-disabled="true">
                <button type="button" style={control.btn(false)} onClick={() => fileInputRef.current?.click()}><Plus size={15} /> Media</button>
                <button type="button" style={control.btn(Boolean(selectedKey?.type === 'text'))} onClick={() => updateSelectedKey({ type: 'text', label: 'Text' })}><Type size={15} /> Text</button>
                <button type="button" style={control.btn(Boolean(selectedKey?.type === 'overlay'))} onClick={() => updateSelectedKey({ type: 'overlay', label: 'Overlay' })}><Layers3 size={15} /> Overlay</button>
              </div>

              <div className="remix-transport" data-tooltip-disabled="true">
                <button type="button" title="Play" disabled={!keyframes.length} onClick={playTimeline} style={control.btn(playing)}><Play size={16} fill="currentColor" /> Play</button>
                <button type="button" title="Stop" disabled={!playing} onClick={stopTimeline} style={{ ...control.btn(false), opacity: playing ? 1 : 0.45 }}><Square size={14} fill="currentColor" /> Stop</button>
                <button type="button" title="Reset" onClick={resetTimeline} style={control.btn(false)}><RotateCcw size={15} /> Reset</button>
              </div>

              <div className="remix-actions">
                <button type="button" style={control.btn(false)} onClick={() => setRenderToast({ type: 'success', text: 'Storyboard saved locally for this session.' })}><Save size={15} /> Save</button>
                <button type="button" className="cta-pill-btn" style={{ ...control.cta, opacity: canRender ? 1 : 0.5 }} disabled={!canRender} onClick={renderRemix}>Render <UpRightArrow size={15} /></button>
              </div>
            </div>

            <div id="remix-timeline-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 72px', gap: 10, alignItems: 'center' }}>
              <div ref={trackRef} onPointerDown={onTrackPointerDown} onPointerMove={onTrackPointerMove} onPointerUp={onTrackPointerUp} style={{ position: 'relative', height: 34, borderRadius: 999, background: 'rgba(255,255,255,0.72)', border: '1px solid ' + GLASS.hair, boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)', touchAction: 'none', userSelect: 'none', cursor: playing ? 'default' : 'pointer' }}>
                <div style={{ position: 'absolute', left: TL_PAD, top: 0, bottom: 0, width: `calc(${scrubVal} * (100% - ${TL_PAD * 2}px))`, background: 'rgba(236,72,153,0.14)', borderRadius: 999, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', left: tlLeft(scrubVal), top: -3, bottom: -3, width: 3, marginLeft: -1.5, background: '#ec4899', borderRadius: 999, boxShadow: '0 0 0 1px rgba(255,255,255,0.85)', pointerEvents: 'none', zIndex: 4 }}>
                  <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>
                    <div style={{ width: 13, height: 13, borderRadius: '50%', background: '#ec4899', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 2px #fff' }} />
                  </div>
                </div>
                {keyframes.map((key) => (
                  <div key={key.id} data-key-id={key.id} title={`${key.label} - drag to retime`} style={{ position: 'absolute', left: tlLeft(key.t), top: '50%', width: 12, height: 12, marginLeft: -6, marginTop: -6, transform: 'rotate(45deg)', background: selectedKeyId === key.id ? GLASS.ink : '#fff', border: '1px solid ' + (selectedKeyId === key.id ? '#fff' : GLASS.inkMute), borderRadius: 3, boxShadow: '0 1px 2px rgba(0,0,0,0.15)', cursor: 'grab', zIndex: 5 }} />
                ))}
              </div>
              <div style={{ ...control.label, height: 34, display: 'grid', placeItems: 'center', borderRadius: 10, background: 'rgba(255,255,255,0.72)', border: '1px solid ' + GLASS.hair }}>{Math.round(scrubVal * 30)}S / 30S</div>
            </div>
          </section>
        </main>

        <aside id="remix-rail" data-tooltip-disabled="true" style={{ minWidth: 0, padding: '14px 14px 14px 0', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <style>{`
            #video-remix-studio-shell, #video-remix-studio-shell * { box-sizing: border-box; }
            .remix-rail-card { position: relative; border-radius: 1rem; overflow: hidden; background: rgba(255,255,255,0.35); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: 0 0 0 rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22); transform: scale(1) translateY(0); transition: background .55s cubic-bezier(.16,1,.3,1), box-shadow .55s cubic-bezier(.16,1,.3,1), transform .22s cubic-bezier(.16,1,.3,1); }
            .remix-rail-card::before { content:''; position:absolute; inset:0; border-radius:1rem; padding:1px; background:rgba(176,176,182,.6); -webkit-mask:linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite:xor; mask-composite:exclude; pointer-events:none; opacity:.85; z-index:0; }
            .remix-rail-card:hover, .remix-rail-card--active { background:rgba(255,255,255,1); box-shadow:0 6px 14px rgba(0,0,0,.06),0 18px 36px rgba(0,0,0,.06),0 28px 56px rgba(0,0,0,.09),inset 0 1px 0 rgba(255,255,255,.55); transform:scale(1.02) translateY(-2px); }
            .remix-rail-card:hover::before, .remix-rail-card--active::before { background:linear-gradient(180deg,hsl(185,100%,45%) 0%,hsl(262,100%,55%) 52%,hsl(314,100%,50%) 100%); opacity:1; }
            .remix-rail-card-btn { position:relative; z-index:1; width:100%; display:flex; align-items:center; gap:12px; padding:14px 16px; background:none; border:0; cursor:pointer; text-align:left; }
            .remix-rail-card-copy { display:flex; flex-direction:column; gap:3px; flex:1; min-width:0; }
            .remix-rail-card-title { font-family:${GLASS.sans}; font-size:15px; font-weight:500; color:${GLASS.ink}; line-height:1.15; }
            .remix-rail-card-subtitle { font-family:${GLASS.mono}; font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:${GLASS.inkMute}; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .remix-rail-card-icon { flex-shrink:0; display:flex; transition:transform .35s cubic-bezier(.34,1.56,.64,1); }
            .remix-rail-card:hover .remix-rail-card-icon { transform:scale(1.12); }
            .remix-rail-card-body { overflow:hidden; transition:max-height .35s cubic-bezier(.4,0,.2,1); }
            .remix-rail-card-inner { position:relative; z-index:1; padding:2px 16px 16px; display:flex; flex-direction:column; gap:9px; }
            .remix-rail-stack { margin:auto 0; display:flex; flex-direction:column; gap:10px; width:100%; }
            .remix-grid-2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
            .remix-tile { min-height:44px; border:1px solid ${GLASS.hair}; border-radius:10px; background:rgba(255,255,255,.68); color:${GLASS.ink}; display:flex; align-items:center; gap:8px; padding:8px 10px; font-family:${GLASS.sans}; font-size:12px; font-weight:700; cursor:pointer; text-align:left; min-width:0; }
            .remix-tile.is-on { background:${GLASS.ink}; color:#fff; border-color:${GLASS.ink}; }
            .remix-tile span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
            .remix-key-row { width:100%; min-height:38px; border:1px solid ${GLASS.hair}; border-radius:10px; background:rgba(255,255,255,.68); color:${GLASS.ink}; display:grid; grid-template-columns:3rem minmax(0,1fr) auto; align-items:center; gap:8px; padding:7px 9px; font-family:${GLASS.sans}; cursor:pointer; text-align:left; }
            .remix-key-row.is-on { background:${GLASS.ink}; color:#fff; border-color:${GLASS.ink}; }
            .remix-key-time { font-family:${GLASS.mono}; font-size:10px; letter-spacing:.06em; text-transform:uppercase; opacity:.72; }
            .remix-key-title { display:block; font-size:12px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .remix-key-meta { display:block; margin-top:2px; font-family:${GLASS.mono}; font-size:9px; letter-spacing:.04em; text-transform:uppercase; opacity:.65; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .remix-undercanvas-row { display:grid; grid-template-columns:1fr auto 1fr; align-items:start; gap:14px; }
            .remix-left-controls, .remix-transport, .remix-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
            .remix-transport { justify-content:center; }
            .remix-actions { justify-content:flex-end; }
            .srt-line { display:grid; grid-template-columns:4.2rem 1fr; gap:.5em; font-family:${GLASS.mono}; font-size:.68rem; line-height:1.65; align-items:baseline; }
            .srt-pfx { text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; font-size:.64rem; letter-spacing:.02em; }
            .srt-msg { min-width:0; white-space:normal; overflow-wrap:anywhere; }
            .srt-active .srt-pfx { color:#61afef; } .srt-active .srt-msg { color:#eaf0fa; font-weight:700; }
            .srt-ok .srt-pfx { color:#98c379; } .srt-ok .srt-msg { color:#c8e1b4; }
            .srt-error .srt-pfx { color:#e06c75; } .srt-error .srt-msg { color:#f1a6ac; }
            .srt-dim .srt-pfx, .srt-dim .srt-msg { color:#6b7280; }
            .srt-caret { display:inline-block; width:.45em; height:.95em; background:#61afef; vertical-align:text-bottom; margin-left:2px; animation:srt-blink 1s step-start infinite; }
            @keyframes srt-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
            @keyframes srt-blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
            @media (max-width: 920px) {
              #remix-main-row { grid-template-columns:1fr !important; overflow-y:auto; }
              #remix-board { min-height:760px; padding-right:18px !important; }
              #remix-rail { padding:0 14px 14px !important; overflow:visible !important; }
              .remix-undercanvas-row { grid-template-columns:1fr; }
              .remix-left-controls, .remix-transport, .remix-actions { justify-content:center; }
            }
          `}</style>
          <div className="remix-rail-stack">
            <RailCard icon={<FolderOpen size={18} />} title="Sources" subtitle={`${draft.selectedFolders.length} folders selected`} color="#8b5cf6" open={sourceOpen} onToggle={() => setSourceOpen((v) => !v)}>
              <div className="remix-grid-2">
                {(folders.length ? folders : ['skyline', 'neighborhood', 'stills']).map((folder) => {
                  const active = draft.selectedFolders.includes(folder);
                  return <button key={folder} type="button" className={'remix-tile' + (active ? ' is-on' : '')} onClick={() => toggleFolder(folder)}><Film size={14} /><span>{folder}</span></button>;
                })}
              </div>
              <button type="button" style={control.btn(false)} onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Load local preview media</button>
              {localMedia.length ? <span style={control.label}>{localMedia.length} local preview assets loaded</span> : null}
            </RailCard>

            <RailCard icon={<Scissors size={18} />} title="Storyboard" subtitle={activeTimelineLabel} color="#ec4899" open={storyboardOpen} onToggle={() => setStoryboardOpen((v) => !v)} badge={<span style={{ ...control.label, color: '#fff', background: GLASS.ink, padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>{keyframes.length}</span>}>
              <div style={{ display: 'grid', gap: 6 }}>
                {keyframes.map((key) => {
                  const active = key.id === selectedKeyId;
                  return (
                    <button
                      key={key.id}
                      type="button"
                      className={'remix-key-row' + (active ? ' is-on' : '')}
                      onClick={() => { setSelectedKeyId(key.id); setScrubVal(key.t); }}
                    >
                      <span className="remix-key-time">{Math.round(key.t * OUTPUT.durationSeconds)}s</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="remix-key-title">{key.label || key.type || 'Keyframe'}</span>
                        <span className="remix-key-meta">{key.type || 'clip'} / {key.transition || 'cut'}{key.sourceFolder ? ` / ${key.sourceFolder}` : ''}</span>
                      </span>
                      <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, transform: 'rotate(45deg)', background: active ? '#fff' : GLASS.ink, opacity: active ? 1 : 0.45 }} />
                    </button>
                  );
                })}
              </div>

              <span style={control.label}>Selected key type</span>
              <div className="remix-grid-2">
                {KEY_TYPES.map(({ value, label, Icon }) => (
                  <button key={value} type="button" className={'remix-tile' + (selectedKey?.type === value ? ' is-on' : '')} onClick={() => updateSelectedKey({ type: value, label })}>
                    <Icon size={14} /><span>{label}</span>
                  </button>
                ))}
              </div>

              <span style={control.label}>Transition</span>
              <div className="remix-grid-2">
                {TRANSITIONS.map((transition) => (
                  <button key={transition.value} type="button" className={'remix-tile' + (selectedKey?.transition === transition.value ? ' is-on' : '')} onClick={() => updateSelectedKey({ transition: transition.value })}>
                    <Scissors size={14} /><span>{transition.label}</span>
                  </button>
                ))}
              </div>

              <span style={control.label}>Source at keyframe</span>
              <div className="remix-grid-2">
                {(draft.selectedFolders.length ? draft.selectedFolders : folders.slice(0, 6)).map((folder) => (
                  <button key={`key-${folder}`} type="button" className={'remix-tile' + (selectedKey?.sourceFolder === folder ? ' is-on' : '')} onClick={() => updateSelectedKey({ sourceFolder: selectedKey?.sourceFolder === folder ? null : folder })}>
                    <Film size={14} /><span>{folder}</span>
                  </button>
                ))}
              </div>

              <label style={{ display: 'grid', gap: 5 }}>
                <span style={control.label}>Dynamic text at keyframe</span>
                <input
                  style={control.field}
                  maxLength={80}
                  value={selectedKey?.text || ''}
                  placeholder="Text overlay at this point"
                  onChange={(event) => updateSelectedKey({ text: event.target.value, type: event.target.value ? 'text' : selectedKey?.type })}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button type="button" style={control.btn(false)} onClick={() => addKeyframe(Math.min(1, scrubVal + 0.08))}><Plus size={14} /> Add key</button>
                <button type="button" style={{ ...control.btn(false), color: '#9f1f17' }} onClick={deleteSelectedKey}>Delete key</button>
              </div>
            </RailCard>

            <RailCard icon={<Music2 size={18} />} title="Audio" subtitle={draft.audioMode === 'tracks' ? 'Tracks mode' : draft.artist === 'random' ? 'Random artist mix' : draft.artist} color="#14b8a6" open={audioOpen} onToggle={() => setAudioOpen((v) => !v)}>
              <div className="remix-grid-2">
                <button type="button" className={'remix-tile' + (draft.audioMode === 'mix' ? ' is-on' : '')} onClick={() => updateDraft('audioMode', 'mix')}><Music2 size={14} /><span>Artist mix</span></button>
                <button type="button" className={'remix-tile' + (draft.audioMode === 'tracks' ? ' is-on' : '')} onClick={() => updateDraft('audioMode', 'tracks')}><Scissors size={14} /><span>Tracks</span></button>
              </div>
              <div className="remix-grid-2">
                <button type="button" className={'remix-tile' + (draft.artist === 'random' ? ' is-on' : '')} onClick={() => setDraft((prev) => ({ ...prev, artist: 'random', mixTitle: '' }))}><WandSparkles size={14} /><span>Random</span></button>
                {artistList.slice(0, 9).map((artist) => (
                  <button key={artist.name} type="button" className={'remix-tile' + (draft.artist === artist.name ? ' is-on' : '')} onClick={() => setDraft((prev) => ({ ...prev, artist: artist.name, mixTitle: '' }))}><BadgeCheck size={14} /><span>{artist.name}</span></button>
                ))}
              </div>
              {draft.audioMode === 'mix' && draft.artist !== 'random' ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  <span style={control.label}>Mix</span>
                  {(mixes.length ? mixes : ['Random mix']).slice(0, 8).map((mix) => (
                    <button key={mix} type="button" className={'remix-tile' + (draft.mixTitle === mix ? ' is-on' : '')} onClick={() => updateDraft('mixTitle', mix === 'Random mix' ? '' : mix)}><span>{mix}</span></button>
                  ))}
                </div>
              ) : null}
            </RailCard>

            <RailCard icon={<Palette size={18} />} title="Look" subtitle={draft.videoFilter === 'random' ? 'Random look' : draft.videoFilter} color="#f59e0b" open={lookOpen} onToggle={() => setLookOpen((v) => !v)}>
              <div className="remix-grid-2">
                <button type="button" className={'remix-tile' + (draft.videoFilter === 'random' ? ' is-on' : '')} onClick={() => updateDraft('videoFilter', 'random')}><WandSparkles size={14} /><span>Random</span></button>
                {filterList.map((filter) => (
                  <button key={filter.key} type="button" className={'remix-tile' + (draft.videoFilter === filter.key ? ' is-on' : '')} onClick={() => updateDraft('videoFilter', filter.key)}><Palette size={14} /><span>{formatFilterLabel(filter.key, filter.label)}</span></button>
                ))}
              </div>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ ...control.label, display: 'flex', justifyContent: 'space-between' }}>Intensity <span>{Math.round(draft.filterIntensity * 100)}%</span></span>
                <input type="range" min="0" max="1" step="0.05" value={draft.filterIntensity} onChange={(event) => updateDraft('filterIntensity', Number(event.target.value))} style={{ width: '100%', accentColor: GLASS.ink }} />
              </label>
            </RailCard>

            <RailCard icon={<Layers3 size={18} />} title="Overlays" subtitle={draft.overlayEffect || 'None'} color="#6366f1" open={overlayOpen} onToggle={() => setOverlayOpen((v) => !v)}>
              <div className="remix-grid-2">
                <button type="button" className={'remix-tile' + (!draft.overlayEffect ? ' is-on' : '')} onClick={() => updateDraft('overlayEffect', '')}><Layers3 size={14} /><span>None</span></button>
                {overlayList.map((overlay) => (
                  <button key={overlay.value} type="button" className={'remix-tile' + (draft.overlayEffect === overlay.value ? ' is-on' : '')} onClick={() => updateDraft('overlayEffect', overlay.value)}><Layers3 size={14} /><span>{overlay.label}</span></button>
                ))}
              </div>
              <label style={{ display: 'grid', gap: 5 }}>
                <span style={control.label}>Dynamic end text</span>
                <input style={control.field} maxLength={80} value={draft.endTextOverlay} disabled={Boolean(draft.endLogo)} placeholder={draft.endLogo ? 'Disabled while end logo is set' : 'End-card caption'} onChange={(event) => updateDraft('endTextOverlay', event.target.value)} />
              </label>
            </RailCard>

            <RailCard icon={<ImageIcon size={18} />} title="Brand" subtitle={draft.topLogo || draft.endLogo || draft.useArtistImage ? 'Brand assets set' : 'No logos'} color="#0ea5e9" open={brandOpen} onToggle={() => setBrandOpen((v) => !v)}>
              <div className="remix-grid-2">
                <button type="button" className={'remix-tile' + (draft.useArtistImage ? ' is-on' : '')} onClick={() => updateDraft('useArtistImage', !draft.useArtistImage)}><ImageIcon size={14} /><span>Artist image</span></button>
                <button type="button" className={'remix-tile' + (!draft.topLogo && !draft.endLogo ? ' is-on' : '')} onClick={() => setDraft((prev) => ({ ...prev, topLogo: '', endLogo: '' }))}><ImageIcon size={14} /><span>No logos</span></button>
              </div>
              {logoList.length ? (
                <>
                  <span style={control.label}>Top logo</span>
                  <div className="remix-grid-2">
                    {logoList.slice(0, 10).map((logo) => (
                      <button key={`top-${logo}`} type="button" className={'remix-tile' + (draft.topLogo === logo ? ' is-on' : '')} title={signedAssetUrl(logo)} onClick={() => updateDraft('topLogo', draft.topLogo === logo ? '' : logo)}><ImageIcon size={14} /><span>{logo}</span></button>
                    ))}
                  </div>
                  <span style={control.label}>End logo</span>
                  <div className="remix-grid-2">
                    {logoList.slice(0, 10).map((logo) => (
                      <button key={`end-${logo}`} type="button" className={'remix-tile' + (draft.endLogo === logo ? ' is-on' : '')} title={signedAssetUrl(logo)} onClick={() => setDraft((prev) => ({ ...prev, endLogo: prev.endLogo === logo ? '' : logo, endTextOverlay: prev.endLogo === logo ? prev.endTextOverlay : '' }))}><ImageIcon size={14} /><span>{logo}</span></button>
                    ))}
                  </div>
                </>
              ) : <span style={{ fontFamily: GLASS.sans, fontSize: 12, color: GLASS.inkMute }}>No logos available from the EditVideos bucket.</span>}
            </RailCard>

            <RailCard icon={<Clapperboard size={18} />} title="Captures" subtitle={`${captures.length} remixes`} color="#10b981" open={capturesOpen} onToggle={() => setCapturesOpen((v) => !v)} badge={captures.length ? <span style={{ ...control.label, color: '#fff', background: GLASS.ink, padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>{captures.length}</span> : null}>
              {captures.slice(0, 8).map((capture) => (
                <div key={capture.jobId || capture.downloadUrl} style={{ border: '1px solid ' + GLASS.hair, borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.5)' }}>
                  <video src={capture.downloadUrl} controls muted playsInline preload="metadata" style={{ width: '100%', display: 'block', maxHeight: 150, objectFit: 'cover', background: '#000' }} />
                  <div style={{ padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ ...control.label, color: GLASS.inkSoft }}>Video Remix</span>
                    <a href={capture.downloadUrl} target="_blank" rel="noreferrer" style={{ ...control.btn(false), height: 28, padding: '0 12px', fontSize: 10, textDecoration: 'none' }}>Open</a>
                  </div>
                </div>
              ))}
              {!captures.length ? <span style={{ fontFamily: GLASS.sans, fontSize: 12, color: GLASS.inkMute }}>No remixes rendered yet.</span> : null}
              {jobs.length ? <span style={control.label}>Recent jobs: {jobs.slice(0, 3).map((job) => job.status).join(', ')}</span> : null}
            </RailCard>
          </div>
        </aside>
      </div>

      {renderConsoleOpen ? (
        <div role="dialog" aria-modal="false" aria-label="Video remix render progress" onClick={(event) => { if (event.target === event.currentTarget) setRenderConsoleOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(1rem, 5vw, 2rem)', background: 'rgba(10,10,16,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}>
          <div onClick={(event) => event.stopPropagation()} style={{ position: 'relative', width: '100%', maxWidth: '40rem', padding: 'clamp(1.1rem, 4vw, 1.6rem)', borderRadius: 10, boxSizing: 'border-box', background: '#ffffff', boxShadow: '0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1), 0px 20px 40px rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', justifyContent: 'space-between' }}>
              <img src="/img/circle_logo.png" alt="" aria-hidden="true" style={{ width: '2.75rem', height: '2.75rem', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.35)', display: 'block' }} />
              <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: GLASS.mono }}>Video Remix</span>
              <button type="button" onClick={() => setRenderConsoleOpen(false)} aria-label="Close render console" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: GLASS.mono, fontSize: '0.8rem', color: 'rgba(42,36,32,0.55)', letterSpacing: '0.06em' }}>[ x ]</button>
            </div>
            <div style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', animation: 'srt-marquee 18s linear infinite', willChange: 'transform' }}>
                {['a', 'b'].map((key) => <span key={key} aria-hidden={key === 'b' ? 'true' : undefined} style={{ margin: 0, flexShrink: 0, whiteSpace: 'nowrap', color: '#2a2420', fontSize: 'clamp(2rem, 8.5vw, 7rem)', lineHeight: 1, letterSpacing: '-0.04em', fontFamily: GLASS.display, fontWeight: 700 }}>{'RENDERING VIDEO REMIX . '.repeat(2)}</span>)}
              </div>
            </div>
            <div style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderTop: '1px solid rgba(255,255,255,0.18)', borderRadius: 10, overflow: 'hidden', boxShadow: '0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 0.75rem', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ width: '0.52rem', height: '0.52rem', borderRadius: 999, background: 'rgba(255,95,86,0.65)' }} />
                <span style={{ width: '0.52rem', height: '0.52rem', borderRadius: 999, background: 'rgba(255,189,46,0.65)' }} />
                <span style={{ width: '0.52rem', height: '0.52rem', borderRadius: 999, background: 'rgba(39,201,63,0.65)' }} />
                <span style={{ flex: 1, textAlign: 'center', fontFamily: GLASS.mono, fontSize: '0.62rem', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)' }}>remix.process</span>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontFamily: GLASS.mono, fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.32)', marginTop: '0.9rem', borderTop: '1px solid rgba(212,196,171,0.4)', paddingTop: '0.7rem' }}>
              <span>{renderPhase === 'failed' ? 'Render failed' : renderPhase === 'done' ? 'Render complete' : 'External worker'}</span>
              {renderPhase === 'done' && renderVideoUrl ? <a href={renderVideoUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 'auto', textDecoration: 'underline', color: '#2a2420', fontFamily: GLASS.mono, fontSize: '0.72rem', textTransform: 'none', letterSpacing: 0 }}>Open Video <UpRightArrow style={{ marginLeft: '0.15rem', opacity: 0.82 }} /></a> : <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: '0.02em' }}>Safe metadata queue, no FFmpeg in Next.</span>}
            </div>
          </div>
        </div>
      ) : null}

      {renderToast ? (
        <div role={renderToast.type === 'error' ? 'alert' : 'status'} aria-live={renderToast.type === 'error' ? 'assertive' : 'polite'} style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999, maxWidth: '24rem', display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.75rem 1rem', borderRadius: 10, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.12)', fontFamily: GLASS.mono, fontSize: '0.72rem', lineHeight: 1.4, letterSpacing: '0.02em', background: renderToast.type === 'error' ? 'rgba(255,250,248,0.92)' : 'rgba(248,255,250,0.94)', border: '1px solid ' + (renderToast.type === 'error' ? 'rgba(215,25,33,0.32)' : 'rgba(33,150,83,0.32)'), color: renderToast.type === 'error' ? 'rgba(150,22,28,0.92)' : 'rgba(22,110,60,0.95)' }}>
          <span style={{ flexShrink: 0, marginTop: '0.35rem', width: '0.5rem', height: '0.5rem', borderRadius: 999, background: renderToast.type === 'error' ? '#d71921' : '#2f9e44' }} />
          <span>{renderToast.text}</span>
          <button type="button" onClick={() => setRenderToast(null)} aria-label="Dismiss" style={{ flexShrink: 0, marginLeft: '0.25rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.7rem', color: 'inherit', opacity: 0.6 }}>x</button>
        </div>
      ) : null}

      {loadingData ? <div style={{ position: 'fixed', left: 18, bottom: 18, ...control.label, color: GLASS.ink, background: 'rgba(255,255,255,0.78)', border: '1px solid ' + GLASS.hair, borderRadius: 999, padding: '7px 10px' }}>Loading remix options...</div> : null}
    </div>
  );
}
