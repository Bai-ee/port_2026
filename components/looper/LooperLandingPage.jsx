'use client';

// Standalone public /looper page. Same "hero mirror + page-local terminal +
// slim nav" recipe as components/recreate/RecreateLandingPage.jsx, but the
// URL input is a track-upload pill, and the terminal drives the REAL
// loopcore analysis engine (app/dashboard/studio/loop/loopcore-client.js)
// instead of the site-clone worker.
//
// State machine: 'hero' -> 'analyzing' -> 'studio'.
//   hero      — the homepage-hero mirror (three.js canvas + headline +
//               upload pill). Interactive.
//   analyzing — same hero DOM stays mounted underneath (so the canvas never
//               pops away mid-run); the terminal overlay sits on top and
//               drives the real detectGrid()/sliceTrack() round trip. On
//               success the page moves straight to 'studio'. On failure the
//               terminal shows an error and stays open — closing it (see
//               `handleTerminalClose`) is what returns the page to 'hero'.
//   studio    — the hero (and its three.js canvas) is unmounted entirely and
//               LooperStudio.jsx mounts in its place, booted with the file +
//               analysis + slice manifest.
//
// HARD RULE for this build: no existing file is modified anywhere in the
// repo. Every piece mirrored from the homepage hero (ox.jsx canvas params,
// HeroSchematicOverlay, the url-input-pill styling from StackedSlidesSection.jsx)
// is either imported directly (pure/self-contained modules) or copy-adapted
// into a new looper-local file — see the per-import notes below.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { FileUp } from 'lucide-react';
import Header from '../../Header';
import UpRightArrow from '../UpRightArrow';
import HeroSchematicOverlay from '../home/HeroSchematicOverlay';
import { createHeroCursorStage } from '../home/heroCursorStage';
import LooperHeroHeadline from './LooperHeroHeadline';
import LooperTerminalOverlay, { useLooperTerminal } from './LooperTerminal';
import LooperInfoModal from './LooperInfoModal';
import DiffusionControls from './DiffusionControls';
import { validateTrackFile, formatMb, formatBpm, buildResultLines, resolveSourcePath } from './looper-flow';
import {
  checkEngineHealth,
  detectGrid,
  isEngineOffline,
  sliceTrack,
} from '../../app/dashboard/studio/loop/loopcore-client';
// Contract-only import: a parallel build is landing components/looper/LooperStudio.jsx
// as `export default function LooperStudio({ isNarrow, railW, authedFetch, boot })`.
// Do NOT stub it here — see this task's report for compile status.
import LooperStudio from './LooperStudio';

// Real homepage Header — imported directly, not copy-adapted. It takes plain
// props/refs with no homepage-scroll dependency, and FAQPage.jsx already
// proves the standalone case (`<Header logoRef={logoRef} onOpenPage={null} />`
// mounted outside any scroll-stack page). Its own #founders-top-strip picks up
// colors.css globally (imported in app/layout.jsx), so no extra CSS import is
// needed here.

// Imported directly (not copy-adapted) — ox.jsx's default export takes plain
// props/refs with no homepage-DOM or scroll dependency (params, liveParamsRef,
// backgroundColor, silhouetteRef, scatterRef, viewResetRef — all optional),
// so mounting it here renders the exact same three.js loop as the homepage.
const AppCanvas = dynamic(() => import('../../ox.jsx'), { ssr: false });

// Verbatim copy of HomePage.jsx's HERO_PARAMS_START — the resting-state
// params the homepage hero renders at before any scroll. /looper never
// scrolls, so this is the ONLY params object this page needs (HomePage's
// HERO_PARAMS_END + scroll interpolation is scroll-only and doesn't apply).
const HERO_PARAMS_START = {
  scale: 200,
  chaos: 0,
  flow: 0.37,
  particleCount: 25000,
  particleSize: 0.2,
  speedMult: 0.44,
  bloomThreshold: 0.8,
  bloomStrength: 0,
  bloomRadius: 1,
  hueOffset: 0.36,
  hueSpeed: 0.02,
  waveAmplitude: 7,
  saturation: 0.75,
  lightness: 0.4,
  torusMajorRadius: 0.5,
  torusTubeRadius: 0.1,
  torusSegments: 100,
  torusSegmentsDepth: 50,
  rotationX: -2.14159265358979,
  rotationY: -2.14159265358979,
  rotationZ: -3.14159265358979,
  tireSpinAxis: 'z',
  tireSpinSpeed: 0,
  animationSpeed: 2.4,
  opacity: 0.23,
  // Lens-diffusion controls (DiffusionControls panel below mutates these
  // directly on `paramsRef.current` — must exist as real keys here so ox.jsx's
  // per-frame smoothing loop, which caches Object.keys(targetParams) once per
  // object identity, picks them up from the first frame).
  diffuseOriginX: -400,
  diffuseOriginY: -227,
  diffuseOriginZ: -400,
  diffuseStrength: 1,
  diffuseFalloff: 0.05,
};

const BARS_PER_LOOP = 4;

// Matches the actual rendered homepage hero: HomePage.jsx initializes
// textColor to '#000000' (HeroHeadline's OWN internal default of '#2a2420'
// is only a fallback for callers that don't pass one).
const TEXT_COLOR = '#000000';
const CANVAS_BACKGROUND = '#ffffff';

// Mirrors StudioPage.jsx's `#studio-page-shell` full-viewport treatment
// (GLASS.wash + GLASS.bg from app/dashboard/studio/components/rail-ui.jsx),
// copied as plain values instead of importing that dashboard-internal module
// just for a background gradient. NOTE: the as-built dashboard studio shell
// is actually a light cream wash, not dark — this matches what's really
// there rather than a literal "dark" background.
const STUDIO_SHELL_BACKGROUND = [
  'radial-gradient(700px 420px at 0% 4%, rgba(255,120,90,0.14) 0%, transparent 62%)',
  'radial-gradient(620px 380px at 100% 10%, rgba(176,90,255,0.14) 0%, transparent 62%)',
  'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
].join(', ');

// ── Analyzing focus mode ───────────────────────────────────────────────
// Once the terminal UI is up, every chrome element clears out so only the
// three.js object is left behind the overlay. The terminal's own backdrop
// (LooperTerminal.jsx `lt-overlay-in`) fades + blurs in at 300ms — half of
// this, i.e. "50% faster" — so the wash lands before the chrome is gone.
const ANALYZING_FADE_SELECTORS = [
  '#looper-hero-headline-panel',
  '#hero-schematic-overlay',
  '#founders-top-strip',
  '#looper-hero-bottom-bar',
];
const ANALYZING_FADE_OUT_S = 0.6;
const ANALYZING_FADE_IN_S = 0.45;

const NARROW_MEDIA_QUERY = '(max-width: 900px)';
const STUDIO_RAIL_W = 336;

export default function LooperLandingPage() {
  const { terminal, runWithTerminal, closeTerminal, minimizeTerminal, reopenTerminal } = useLooperTerminal();

  const [phase, setPhase] = useState('hero'); // 'hero' | 'analyzing' | 'studio'
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [boot, setBoot] = useState(null); // { file, analysis, sliceManifest }
  const [isNarrow, setIsNarrow] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false); // nav ⓘ -> about/terms modal

  const fileInputRef = useRef(null);
  const canvasWrapperRef = useRef(null);
  const headerLogoRef = useRef(null);
  const paramsRef = useRef(HERO_PARAMS_START);
  const silhouetteRef = useRef(null);
  const cursorStageRef = useRef(createHeroCursorStage());
  const heroProgressRef = useRef(0); // no scroll on this page — stays 0

  const terminalMinimized = Boolean(terminal && !terminal.open);

  // ── Body scroll lock — this page is hero-only, 100dvh, never scrolls ────
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, []);

  // ── Header logo → /looper. The shared Header component hardcodes its
  // brand link to "/" (it's the homepage nav); on this page the logo should
  // return to the looper's own landing state. Rewriting the href (rather
  // than intercepting clicks) keeps cmd/middle-click and long-press previews
  // honest. Header exposes no brand-href prop, so this stays page-local (its
  // one prop-level extension for this page is the `actions` slot below). ────
  useEffect(() => {
    const brand = document.getElementById('founders-brand');
    if (brand) {
      brand.setAttribute('href', '/looper');
      brand.setAttribute('aria-label', 'Back to the Looper');
    }
    // The nav's right-hand action is no longer the shared "Clients" CTA — it
    // is #looper-nav-info-btn, passed into Header's `actions` slot below, which
    // opens the about/terms modal (the Loop Studio link lives inside it).
    return undefined;
  }, [phase]);

  // ── Responsive rail collapse for the studio phase (mirrors StudioPage.jsx) ──
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(NARROW_MEDIA_QUERY);
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // ── Hero intro fade — condensed copy of HomePage.jsx's intro timeline ───
  // (gradient + canvas + nav + upload pill fade up together). Skipped once
  // the page has moved past 'hero'/'analyzing' — nothing to animate in.
  useLayoutEffect(() => {
    // 'analyzing' must NOT replay the intro — the focus-mode effect below
    // owns the chrome while the terminal is up. Returning to 'hero' (error
    // path) does replay it, which is what brings the nav/pill back.
    if (phase !== 'hero') return undefined;
    const gradient = document.querySelector('#looper-hero-gradient-overlay');
    const canvasWrapper = canvasWrapperRef.current;
    // The real Header component's own fixed strip — same id HomePage.jsx's
    // page-level intro timeline fades in via a 'navReveal' label.
    const nav = document.querySelector('#founders-top-strip');
    const uploadRow = document.querySelector('#looper-upload-pill-row');

    const targets = [gradient, canvasWrapper, nav, uploadRow].filter(Boolean);
    gsap.set(targets, { autoAlpha: 0 });

    const tl = gsap.timeline({ delay: 0.2 });
    tl.fromTo(
      gradient,
      { autoAlpha: 0, scale: 1.08 },
      { autoAlpha: 1, scale: 1, duration: 1.1, ease: 'power2.out' },
    )
      .to(canvasWrapper, { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, '<0.1')
      .addLabel('navReveal', '<0.2')
      .to(nav, { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, 'navReveal')
      .to([uploadRow].filter(Boolean), { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, 'navReveal');

    // Dev StrictMode / Suspense re-runs can kill a mid-flight timeline and
    // strand every target at the autoAlpha:0 set above (observed: fully
    // blank hero). The reveal is decorative — after the timeline's natural
    // runtime, force the end state if anything is still hidden.
    const failSafe = setTimeout(() => {
      targets.forEach((el) => {
        if (getComputedStyle(el).visibility === 'hidden') gsap.set(el, { autoAlpha: 1, scale: 1 });
      });
    }, 2600);

    return () => { clearTimeout(failSafe); tl.kill(); };
  }, [phase]);

  // ── Analyzing focus mode — see ANALYZING_FADE_SELECTORS above ──────────
  const prevPhaseRef = useRef(phase);
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (phase !== 'analyzing' && prevPhase !== 'analyzing') return undefined;
    if (phase === 'studio') return undefined;

    const els = ANALYZING_FADE_SELECTORS
      .map((sel) => document.querySelector(sel))
      .filter(Boolean);
    if (!els.length) return undefined;

    const analyzing = phase === 'analyzing';
    const tween = gsap.to(els, {
      autoAlpha: analyzing ? 0 : 1,
      duration: analyzing ? ANALYZING_FADE_OUT_S : ANALYZING_FADE_IN_S,
      ease: 'power2.out',
      overwrite: 'auto',
    });
    return () => tween.kill();
  }, [phase]);

  // ── Terminal close: only meaningful for the error path — a successful run
  // moves straight to 'studio' (see handleFile) before the terminal's own
  // 4s auto-close timer ever fires. ─────────────────────────────────────
  const handleTerminalClose = useCallback(() => {
    closeTerminal();
    setPhase((p) => (p === 'studio' ? p : 'hero'));
  }, [closeTerminal]);

  // ── Upload → analyze → slice ─────────────────────────────────────────
  const handleFile = useCallback(async (rawFile) => {
    if (!rawFile || phase !== 'hero') return;

    const validation = validateTrackFile(rawFile);
    if (!validation.ok) {
      setFileError(validation.reason);
      return;
    }

    setFileError('');
    setFile(rawFile);
    setPhase('analyzing');

    const mb = formatMb(rawFile.size);

    try {
      const result = await runWithTerminal({
        title: 'ANALYZING YOUR TRACK',
        brand: 'Looper',
        host: rawFile.name,
        stages: [
          { pfx: '[CHECK]', text: 'checking analysis engine…' },
          { pfx: '[UPLOAD]', text: `uploading ${rawFile.name} (${mb} MB)…` },
        ],
        task: async ({ advance, note }) => {
          const healthy = await checkEngineHealth();
          if (!healthy) {
            throw new Error('Analysis engine offline — try again later.');
          }

          advance('[UPLOAD]', `uploading ${rawFile.name} (${mb} MB)…`);
          advance('[ANALYZE]', 'analyzing — beat model working…');

          // Heartbeat: detectGrid() is one upload+analyze round trip that can
          // run for many seconds on a long track, so keep the terminal
          // visibly alive every ~4s while it's in flight.
          const heartbeat = setInterval(() => {
            note('analyzing — beat model working…');
          }, 4000);

          let analysis;
          try {
            analysis = await detectGrid(rawFile);
          } catch (err) {
            if (isEngineOffline(err)) {
              throw new Error('Analysis engine offline — try again later.');
            }
            throw err;
          } finally {
            clearInterval(heartbeat);
          }

          advance('[RESULT]', `bpm ${formatBpm(analysis.bpm_final)}`);
          buildResultLines(analysis).forEach((line) => note(line));

          advance('[SLICE]', `cutting ${BARS_PER_LOOP}-bar loops…`);
          const sourcePath = resolveSourcePath(analysis);
          if (!sourcePath) {
            throw new Error('Analysis finished but returned no source path to slice.');
          }

          let manifest;
          try {
            manifest = await sliceTrack(sourcePath, BARS_PER_LOOP);
          } catch (err) {
            if (isEngineOffline(err)) {
              throw new Error('Analysis engine offline — try again later.');
            }
            throw err;
          }

          const loopCount = Array.isArray(manifest?.loops) ? manifest.loops.length : 0;
          return {
            doneText: `${loopCount} loop${loopCount === 1 ? '' : 's'} cut ✓`,
            analysis,
            manifest,
          };
        },
      });

      // exportTarget 'sp16': the looper experience opens the studio on the
      // TORAIZ SP-16 pads panel (owner direction, 2026-08-29).
      setBoot({ file: rawFile, analysis: result.analysis, sliceManifest: result.manifest, exportTarget: 'sp16' });
      setPhase('studio');
    } catch (err) {
      setFileError(err?.message || 'Analysis failed.');
      // Stay on 'analyzing' — the terminal is showing the error and stays
      // open; handleTerminalClose returns the page to 'hero' once closed.
    }
  }, [phase, runWithTerminal]);

  const handleFileInputChange = useCallback((event) => {
    const picked = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file after an error
    if (picked) handleFile(picked);
  }, [handleFile]);

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    if (phase !== 'hero') return;
    setDragOver(true);
  }, [phase]);

  const handleDragLeave = useCallback((event) => {
    event.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    setDragOver(false);
    if (phase !== 'hero') return;
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) handleFile(dropped);
  }, [phase, handleFile]);

  const showHero = phase === 'hero' || phase === 'analyzing';

  return (
    <div
      id="looper-page-shell"
      style={shellStyle}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <style>{`
        /* ANALYZE button: no comet-border ring, no hover styling — flat CTA
           (owner direction, 2026-08-29). */
        #looper-upload-cta::before { display: none !important; animation: none !important; }
        #looper-upload-cta:hover { transform: none; filter: none; box-shadow: none; }
        @keyframes looperHeroGradientDrift {
          0% { transform: translate3d(0, 0, 0) scale(1); }
          100% { transform: translate3d(1.5%, -1.2%, 0) scale(1.04); }
        }
        /* Pre-hide before GSAP initializes, matching HomePage.jsx's own FOUC guard. */
        #looper-hero-canvas-wrapper,
        #founders-top-strip,
        #looper-hero-headline-panel,
        #looper-upload-pill-row {
          opacity: 0;
          visibility: hidden;
        }
        #looper-upload-cta,
        #looper-running-chip {
          transition: transform 220ms cubic-bezier(0.34,1.56,0.64,1), background 200ms ease, box-shadow 200ms ease, opacity 200ms ease;
        }
        #looper-upload-cta:hover:not(:disabled),
        #looper-running-chip:hover {
          transform: translateY(-1px);
        }
        #looper-upload-cta:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        #looper-nav-info-btn:hover {
          background: rgba(255,255,255,1);
          transform: translateY(-1px);
          box-shadow: 0px 5px 10px rgba(0,0,0,0.05), 0px 15px 30px rgba(0,0,0,0.05);
        }
        #looper-nav-info-btn:focus-visible {
          outline: 2px solid rgba(47,111,237,0.55);
          outline-offset: 2px;
        }
        #looper-file-input:focus-visible + #looper-upload-drop-target,
        #looper-upload-cta:focus-visible {
          outline: 2px solid rgba(47,111,237,0.55);
          outline-offset: 2px;
        }
        @media (max-width: 767px) {
          #looper-upload-pill-row { flex-direction: column; align-items: stretch; }
        }
        @media (max-width: 480px) {
          #looper-page-shell { padding: 0; }
        }
      `}</style>

      {showHero ? (
        <section
          id="looper-hero-shell"
          style={heroSectionStyle}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div id="looper-hero-gradient-overlay" style={heroGradientStyle} />
          <div id="looper-hero-canvas-wrapper" ref={canvasWrapperRef} style={{ position: 'absolute', inset: 0, opacity: 0 }}>
            <AppCanvas
              params={HERO_PARAMS_START}
              pointerInfluenceScale={2.5}
              enableDiffusion
              liveParamsRef={paramsRef}
              backgroundColor={CANVAS_BACKGROUND}
              silhouetteRef={silhouetteRef}
            />
          </div>
          <DiffusionControls paramsRef={paramsRef} />
          <HeroSchematicOverlay
            silhouetteRef={silhouetteRef}
            cursorStageRef={cursorStageRef}
            heroProgressRef={heroProgressRef}
            color={TEXT_COLOR}
          />

          {/* Real homepage Header — see the import-site comment for why this is a
              direct import rather than a page-local mirror. Its own
              #founders-top-strip is what the reveal timeline above fades in. */}
          <div id="looper-header-shell">
            <Header
              logoRef={headerLogoRef}
              onOpenPage={null}
              logoSrc="/img/circle_logo.png"
              actions={(
                <button
                  type="button"
                  id="looper-nav-info-btn"
                  onClick={() => setInfoOpen(true)}
                  aria-label="About the Looper — what it does, Loop Studio, terms"
                  aria-haspopup="dialog"
                  style={navInfoBtnStyle}
                >
                  <span aria-hidden="true">STUDIO</span>
                </button>
              )}
            />

            {terminalMinimized ? (
              <button
                type="button"
                id="looper-running-chip"
                onClick={reopenTerminal}
                style={chipStyle}
                aria-label="Reopen the analysis terminal"
              >
                <span
                  id="looper-running-chip-dot"
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '999px',
                    background: terminal.status === 'error' ? '#c0392b' : terminal.status === 'done' ? '#3f7d2e' : '#2f6fed',
                  }}
                />
                {terminal.status === 'running' ? 'Analyzing' : terminal.status === 'done' ? 'Done' : 'Failed'}
              </button>
            ) : null}
          </div>

          {/* Headline — owns its own fixed position (LooperHeroHeadline.jsx's
              panelStyle), left-aligned to the shared 810px column, same as the
              real homepage's #hero-panel-top-left. Owns its own reveal too, so
              it isn't part of this page's intro timeline above. */}
          <LooperHeroHeadline textColor={TEXT_COLOR} cursorStageRef={cursorStageRef} />

          {/* Upload pill — centered in the same shared column, anchored near
              the viewport bottom, mirroring the real homepage's
              #panel-hero-text-row / #hero-url-input-row (StackedSlidesSection.jsx). */}
          <div id="looper-hero-bottom-bar" style={heroBottomBarStyle}>
            <div
              id="looper-upload-pill-row"
              style={heroActionsRowStyle}
            >
              <div
                id="looper-upload-drop-target"
                data-drag-over={dragOver || undefined}
                role="button"
                tabIndex={0}
                aria-label="Drag and drop a track here, or click to browse"
                onClick={() => { if (phase === 'hero') fileInputRef.current?.click(); }}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && phase === 'hero') { e.preventDefault(); fileInputRef.current?.click(); } }}
                style={{
                  ...urlPillRowStyle,
                  ...(dragOver ? urlPillDragOverStyle : null),
                }}
              >
                <FileUp size={15} strokeWidth={1.5} style={{ flexShrink: 0, alignSelf: 'center', color: file ? 'rgba(42,36,32,0.6)' : 'rgba(42,36,32,0.4)' }} aria-hidden="true" />
                <span id="looper-upload-label-text" style={pillLabelStyle}>
                  {file
                    ? file.name
                    : (dragOver
                      ? 'DROP IT'
                      : <span id="looper-upload-label-hint" style={pillHintStyle}>WAV / AIFF / MP3, or click to browse</span>)}
                </span>
                <input
                  id="looper-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept=".wav,.aiff,.aif,.mp3,.m4a,.flac,audio/*"
                  onChange={handleFileInputChange}
                  disabled={phase !== 'hero'}
                  style={visuallyHiddenInputStyle}
                />
                <button
                  type="button"
                  id="looper-upload-cta"
                  className="cta-pill-btn"
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  disabled={phase !== 'hero'}
                  style={primaryCtaStyle}
                >
                  <span>ANALYZE</span>
                  <UpRightArrow style={ctaIconStyle} />
                </button>
              </div>
            </div>

            {fileError ? <p id="looper-upload-error" role="alert" style={errorTextStyle}>{fileError}</p> : null}
          </div>
        </section>
      ) : null}

      {phase === 'studio' && boot ? (
        <div id="looper-studio-shell" style={studioShellStyle}>
          <a
            href="/"
            id="looper-studio-back-link"
            aria-label="Back to homepage"
            style={studioBackLinkStyle}
          >
            <img src="/img/circle_logo.png" alt="HITLOOP" width={663} height={552} style={{ height: 'clamp(2rem, 4vw, 2.8rem)', width: 'auto', display: 'block', mixBlendMode: 'darken' }} />
          </a>
          <LooperStudio isNarrow={isNarrow} railW={STUDIO_RAIL_W} authedFetch={null} boot={boot} />
        </div>
      ) : null}

      <LooperInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />

      <LooperTerminalOverlay terminal={terminal} onClose={handleTerminalClose} onMinimize={minimizeTerminal} />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const shellStyle = {
  position: 'relative',
  width: '100%',
  height: '100dvh',
  overflow: 'hidden',
  boxSizing: 'border-box',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
};

const heroSectionStyle = {
  position: 'relative',
  width: '100%',
  height: '100dvh',
  overflow: 'hidden',
  background: 'transparent',
};

// Copy of HomePage.jsx's `heroGradientStyle` (root-level constant) — same
// radial/linear wash + drift animation, renamed keyframes to avoid a global
// name collision with the homepage's own <style> block.
const heroGradientStyle = {
  position: 'absolute',
  inset: 0,
  zIndex: 2,
  pointerEvents: 'none',
  opacity: 0,
  background: [
    'radial-gradient(72% 68% at 18% 22%, rgba(196, 124, 86, 0.22) 0%, rgba(196, 124, 86, 0) 62%)',
    'radial-gradient(82% 78% at 78% 70%, rgba(102, 184, 164, 0.18) 0%, rgba(102, 184, 164, 0) 66%)',
    'linear-gradient(135deg, rgba(214, 191, 123, 0.14) 0%, rgba(255, 255, 255, 0) 38%, rgba(171, 148, 218, 0.12) 100%)',
  ].join(', '),
  mixBlendMode: 'multiply',
  filter: 'blur(6px) saturate(1.04)',
  transformOrigin: '50% 50%',
  willChange: 'transform, opacity',
  animation: 'looperHeroGradientDrift 18s ease-in-out infinite alternate',
};

// Same shared-column left edge as #founders-top-strip-inner (colors.css) and
// HeroHeadline.jsx's own local `edge` const — NOT hardcoded, so the column
// stays centered/responsive at every viewport width. Reused below for both
// the running-chip's right edge and the upload-pill bottom bar's padding.
const HERO_COLUMN_EDGE = 'max(10vw, calc((100vw - 810px) / 2))';

// #looper-header-shell wraps the real Header (position:fixed, owns its own
// layout) plus this chip, so the chip is positioned independently — flush
// with the shared column's right edge, just under the 64px header strip.
const chipStyle = {
  position: 'fixed',
  top: 'calc(64px + 12px)',
  right: HERO_COLUMN_EDGE,
  zIndex: 190,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.5rem 0.9rem',
  borderRadius: '999px',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.6)',
  color: '#2a2420',
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  fontFamily: '"Space Mono", monospace',
  cursor: 'pointer',
};

// Nav ⓘ button — replaces the shared Header's "Clients" CTA on /looper via
// Header's `actions` slot. Circular version of the .founders-chat-cta--light
// pill (same glass + border radius), sized to the strip's 64px height.
const navInfoBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '2.1rem',
  padding: '0 0.85rem',
  border: '1px solid rgba(42,36,32,0.12)',
  borderRadius: '999px',
  background: 'rgba(255,255,255,0.85)',
  color: '#2a2420',
  fontFamily: '"Space Mono", monospace',
  fontSize: '0.68rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  lineHeight: 1,
  cursor: 'pointer',
  boxShadow: '0 1px 4px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
  transition: 'background 200ms ease, transform 200ms ease, box-shadow 200ms ease',
};

// Upload pill's fixed bottom bar — same shared 810px column (via
// HERO_COLUMN_EDGE), anchored near the viewport bottom. Approximates the real
// homepage's resting #hero-url-input-row position (measured ~60px above the
// viewport bottom at a 782px-tall viewport); /looper has no scroll/pin system
// to derive an exact figure from the way the homepage's stacked-slide layout
// does.
const heroBottomBarStyle = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 'clamp(1.75rem, 7.5vh, 4.5rem)',
  zIndex: 5,
  boxSizing: 'border-box',
  paddingLeft: HERO_COLUMN_EDGE,
  paddingRight: HERO_COLUMN_EDGE,
};

// Mirrors StackedSlidesSection.jsx's `#panel-hero-text-row` — fills the full
// width of the shared column (no separate max-width cap), same as the real
// homepage's #hero-url-input-row once #panel-hero-cta is taken out of flow.
const heroActionsRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  width: '100%',
};

// Mirrors StackedSlidesSection.jsx's `#hero-url-input-row` — same pill shape
// (icon + label + embedded submit button), input swapped for a file trigger.
// Dropzone pill — same homepage-pill geometry/column, but reads as a
// drag-and-drop target: dashed border, click-anywhere-to-browse, and a
// strong accent state while a file is dragged over the hero.
const urlPillRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flex: '1 1 auto',
  minWidth: 0,
  boxSizing: 'border-box',
  minHeight: '3.75rem',
  padding: '0.35rem 0.35rem 0.35rem 0.9rem',
  gap: '0.5rem',
  // Same glass treatment as the nav (Header.jsx #founders-top-strip):
  // rgba(245,241,223,0.55) + 24px backdrop blur.
  background: 'rgba(245, 241, 223, 0.55)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  border: '1.5px dashed rgba(42,36,32,0.28)',
  borderRadius: '999px',
  boxShadow: '0 1px 4px rgba(42,36,32,0.07)',
  lineHeight: 1,
  cursor: 'pointer',
  transition: 'background 200ms ease, border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease',
};

const urlPillDragOverStyle = {
  background: 'rgba(245, 241, 223, 0.85)',
  border: '1.5px dashed rgba(176,90,255,0.75)',
  boxShadow: '0 4px 18px rgba(176,90,255,0.22)',
  transform: 'scale(1.015)',
};

const pillHintStyle = {
  fontWeight: 400,
  letterSpacing: 0,
  textTransform: 'none',
  color: 'rgba(42,36,32,0.45)',
};

const pillLabelStyle = {
  flex: 1,
  minWidth: 0,
  alignSelf: 'center',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  lineHeight: 1.2,
  fontSize: '0.85rem',
  letterSpacing: '0.02em',
  color: 'rgba(42,36,32,0.75)',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  textAlign: 'left',
};

const visuallyHiddenInputStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};

// Literal copy of StackedSlidesSection.jsx's `ctaStyle`/`ctaIconStyle` —
// same button system as the rest of the site.
const primaryCtaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '0.75rem 0.75rem',
  lineHeight: 1,
  fontSize: 'clamp(0.8rem, 1.1vw, 0.875rem)',
  fontWeight: 700,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  color: '#ffffff',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  border: 'none',
  borderRadius: '999px',
  boxShadow: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  flexShrink: 0,
};

const ctaIconStyle = {
  fontSize: '0.95rem',
  opacity: 0.9,
  marginLeft: '0.1rem',
};

const errorTextStyle = {
  margin: '0.75rem 0 0',
  fontSize: '0.8rem',
  color: '#8b1e1e',
  fontFamily: '"Space Mono", monospace',
  lineHeight: 1.5,
};

// Full-viewport studio shell — same treatment as StudioPage.jsx's
// `#studio-page-shell` (see STUDIO_SHELL_BACKGROUND's note above).
const studioShellStyle = {
  position: 'fixed',
  inset: 0,
  background: STUDIO_SHELL_BACKGROUND,
  display: 'flex',
  flexDirection: 'column',
  zIndex: 50,
  overflowX: 'hidden',
  boxSizing: 'border-box',
};

const studioBackLinkStyle = {
  position: 'absolute',
  top: 18,
  left: 20,
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  textDecoration: 'none',
};
