import React, { useLayoutEffect, useRef } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import gsap from 'gsap';
import { easeOutQuart, scrambleChurn, scrambleMask, scrambleTextTo } from './components/home/scrambleText';
// Hidden for now — hero card deck.
// import HeroDeliverableDeck from './components/home/HeroDeliverableDeck';

gsap.registerPlugin(ScrollTrigger);

const SIMPLE_SCROLL_MEDIA_QUERY = '(max-width: 680px) and (pointer: coarse)';

// Lines the subheadline cycles through. A single entry means the line only
// scrambles under the cursor and always resolves back to it.
const SUBHEADLINE_PHRASES = [
  'BRYAN BALLI',
];

// The subheadline is cursor-driven on fine-pointer devices: it churns while the
// pointer moves and resolves into the next phrase once the pointer holds still
// for IDLE_REVEAL_MS. It never advances on its own. Touch/coarse-pointer devices
// get no pointermove events, so with more than one phrase they fall back to a
// timed cycle (HOLD_MS between reveals); with one phrase they stay static.
// A click resets the rotation to the first phrase.
const HOLD_MS = 1600;        // coarse-pointer fallback: hold between phrases
const SCRAMBLE_MS = 100;     // time spent scrambling into the next phrase
const CHURN_IN_MS = 200;     // left-to-right sweep as the scramble starts
const IDLE_REVEAL_MS = 50;   // cursor stillness that triggers the reveal (≈3 frames)

// The last headline line can swap to shorter copy on narrow viewports (same
// 620px breakpoint as the phone type-scale override — keep the two in step).
// CONSULTANT is the longest line (10 chars); both type scales are capped so it
// fits the panel, so the narrow copy currently matches the wide copy.
const HEADLINE_NARROW_QUERY = '(max-width: 620px)';
const HEADLINE_LINES_WIDE = ['DIGITAL', 'MEDIA', 'CONSULTANT'];
const HEADLINE_LINES_NARROW = ['DIGITAL', 'MEDIA', 'CONSULTANT'];

const headlineLinesFor = (narrow) => (narrow ? HEADLINE_LINES_NARROW : HEADLINE_LINES_WIDE);

// Poster fit. The headline is sized so its widest line spans the panel
// (the 810px content column the hero input row sits in) and the block still
// clears the hero gap. Measured with
// canvas text metrics in the headline's own face, so the ratio holds for any
// copy and re-fits once the webfont lands. Phones (≤620px) keep their own
// clamp via the !important rule below.
const HEADLINE_FONT_STACK = "'Doto', 'Space Mono', monospace";
const HEADLINE_WEIGHT = 900;              // Doto 900 is loaded in app/layout.jsx
const HEADLINE_LINE_HEIGHT = 0.8;
const HEADLINE_TRACKING = -0.02;          // letterSpacing in em, mirrored in measurement
// Doto tops out at 900; a same-colour stroke thickens the dots past that.
// Mirrored in measurement (the stroke widens each line by its own width).
const HEADLINE_STROKE_EM = 0.03;
const HEADLINE_SUB_LINES_EM = 1.3;        // subheadline + its margin, in headline ems
// Same column as #hero-url-input-row (StackedSlidesSection) and the nav strip:
// max(10vw, centred 810px), so the headline's left edge lines up with the input.
const HEADLINE_COLUMN_PX = 810;
const HEADLINE_GUTTER_VW = 0.1;
const HEADLINE_MIN_PX = 20;
let headlineMeasureCtx = null;
const measureHeadlineUnitWidth = (lines) => {
  if (typeof document === 'undefined') return 0;
  if (!headlineMeasureCtx) headlineMeasureCtx = document.createElement('canvas').getContext('2d');
  const ctx = headlineMeasureCtx;
  if (!ctx) return 0;
  ctx.font = `${HEADLINE_WEIGHT} 100px ${HEADLINE_FONT_STACK}`;
  let widest = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width + line.length * HEADLINE_TRACKING * 100 + HEADLINE_STROKE_EM * 100;
    if (w > widest) widest = w;
  }
  return widest / 100; // width of the widest line per 1px of font size
};

// Blend: the hero text is painted white and composited with mix-blend-mode
// difference, so it inverts whatever sits behind it — near-black over the
// light page, shifting colour where it crosses the loop and gradient. Set
// HEADLINE_BLEND_MODE to null to fall back to the plain textColor prop.
// The blend sits on #hero-panel-top-left (not the lines) because applyLayout
// writes a filter on the inner content node, which would isolate child blends.
const HEADLINE_BLEND_MODE = 'difference';
const HEADLINE_BLEND_INK = '#ffffff';

const matchesNarrowHeadline = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(HEADLINE_NARROW_QUERY).matches;

// Hero text load sequence. This component owns the whole thing on ONE gsap
// timeline — panel reveal, headline scramble, then the subheadline — so the
// order can be retuned here without drifting against another clock. The
// HomePage intro timeline deliberately does not touch #hero-panel-top-left.
//
// Order: the scrambling headline is the first thing on screen (its panel fades
// up at t=0, ahead of HomePage's own 0.2s-delayed timeline) and it churns for
// the entire reveal, locking line by line. The subheadline overlaps the tail of
// that churn — it starts fading up from 0 and scrambling in shortly BEFORE the
// last headline line locks, so the two reads hand off instead of queueing.
const HERO_INTRO = {
  panelFadeS: 0.45,
  // Mirrors the scroll-out blur in applyLayout (10px at full progress, and none
  // on the simple-scroll viewport), played in reverse so the headline resolves
  // out of a blur as it scrambles.
  blurPx: 10,
  blurInS: 0.8,
  // Budget: HomePage's own timeline (delay 0.2) brings the ox.jsx canvas up at
  // t=0.1 over 1.2s, so the loop element is fully formed at ~1.5s absolute.
  // This component's timeline starts at t=0, and these values land the last
  // subheadline character at ~1.25s — headline and subheadline are both done
  // before the loop finishes forming. Retiming the canvas means retiming here.
  headlineScrambleS: 0.9,
  headlineLineStaggerS: 0.1,
  // Signed offset against the moment the last headline line locks.
  // Negative = the subheadline leads, starting that many seconds early.
  subheadLeadS: -0.35,
  subheadFadeS: 0.4,
  subheadScrambleS: 0.5,
};

const glass = {
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  background: 'linear-gradient(160deg, color-mix(in srgb, var(--t-surface) 18%, transparent) 0%, color-mix(in srgb, var(--t-surface) 7%, transparent) 100%) padding-box, linear-gradient(135deg, color-mix(in srgb, var(--t-surface) 55%, transparent) 0%, color-mix(in srgb, var(--t-surface) 8%, transparent) 40%, color-mix(in srgb, var(--t-surface) 35%, transparent) 100%) border-box',
  border: '1px solid transparent',
  boxShadow: '0 8px 40px rgba(0,0,0,0.08), inset 0 1px 0 color-mix(in srgb, var(--t-glass-highlight) 66.67%, transparent)',
  borderRadius: '1rem',
  padding: 'clamp(1rem, 2vw, 1.5rem)',
  position: 'fixed',
  zIndex: 100,
  pointerEvents: 'none',
  visibility: 'hidden',
};

const HeroHeadline = ({ headerLogoRef, textColor = 'var(--t-text)', cursorStageRef = null }) => {
  const topLeftRef = useRef(null);
  const headlineContentRef = useRef(null);
  const scrambleTextRef = useRef(null);

  // The last line's copy is owned imperatively, like every other string in this
  // component: React renders the wide word, the intro effect below types
  // whichever word the viewport actually calls for, and this listener swaps it
  // if the breakpoint is crossed afterwards. Deliberately NOT React state — a
  // state-driven swap changes the span's identity and remounts it, which leaves
  // the intro timeline animating a node that is no longer in the document.
  // No sync on mount: the intro owns the first write.
  useLayoutEffect(() => {
    const contentEl = headlineContentRef.current;
    if (!contentEl || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mq = window.matchMedia(HEADLINE_NARROW_QUERY);
    const sync = () => {
      const node = contentEl.querySelector('[data-hero-headline-accent]');
      if (!node) return;
      const copy = headlineLinesFor(mq.matches);
      node.textContent = copy[copy.length - 1];
    };
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Hero text load sequence + the subheadline's ongoing phrase cycle. Both live
  // in one effect because they share the same node and must not overlap: the
  // cycle only starts once the intro scramble has handed the subheadline over.
  // useLayoutEffect so the scramble masks are in place before first paint —
  // the real copy must never flash.
  useLayoutEffect(() => {
    const panelEl = topLeftRef.current;
    const contentEl = headlineContentRef.current;
    const subScrambleEl = scrambleTextRef.current;
    if (!panelEl || !contentEl || !subScrambleEl) return;
    const subEl = panelEl.querySelector('#hero-subheadline');
    if (!subEl) return;

    const lines = Array.from(contentEl.querySelectorAll('[data-hero-headline-line]'));
    // Read the breakpoint here rather than closing over render state, so the
    // intro types the same copy the markup is about to settle on regardless of
    // which effect resolves the media query first.
    const introLines = headlineLinesFor(matchesNarrowHeadline());
    const lineCopy = lines.map((node, i) => introLines[i] ?? node.textContent);

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      lines.forEach((node, i) => { node.textContent = lineCopy[i]; });
      subScrambleEl.textContent = SUBHEADLINE_PHRASES[0];
      gsap.set([panelEl, subEl], { autoAlpha: 1 });
      return;
    }

    // index = phrase currently resolved on screen. targetIndex = the phrase the
    // active churn/reveal is heading to; it only folds back into index when a
    // reveal actually completes, so a reveal interrupted by more cursor movement
    // resumes toward the same phrase instead of skipping one.
    let index = 0;
    let targetIndex = 0;
    let cycleCancel = null;   // in-flight reveal
    let churnCancel = null;   // pointer-driven churn
    let holdTimer = 0;        // coarse-pointer fallback cycle
    let idleTimer = 0;
    let pointerBound = false;

    const cursorDriven =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const stopChurn = () => {
      if (churnCancel) { churnCancel(); churnCancel = null; }
    };
    const stopReveal = () => {
      if (cycleCancel) { cycleCancel(); cycleCancel = null; }
    };

    const setStage = (phase) => {
      const stage = cursorStageRef?.current;
      if (!stage) return;
      stage.phase = phase;
      if (phase === 'reveal') {
        stage.revealAt = performance.now();
        stage.revealMs = SCRAMBLE_MS;
      }
    };

    const revealTarget = (onDone) => {
      stopChurn();
      setStage('reveal');
      cycleCancel = scrambleTextTo(subScrambleEl, SUBHEADLINE_PHRASES[targetIndex], {
        durationMs: SCRAMBLE_MS,
        preserveWhitespace: true,
        churnBeforeLock: true,
        ease: easeOutQuart,
        onComplete: () => {
          cycleCancel = null;
          index = targetIndex;
          setStage('idle');
          if (onDone) onDone();
        },
      });
    };

    // Cursor moved: hold the line in a churn keyed to the next phrase's shape
    // (so resolving causes no reflow) and restart the stillness countdown.
    const handlePointerMove = (event) => {
      stopReveal();
      const stage = cursorStageRef?.current;
      if (stage) {
        stage.x = event.clientX;
        stage.y = event.clientY;
        stage.seen = true;
        stage.phase = 'churn';
      }
      if (!churnCancel) {
        if (targetIndex === index) {
          targetIndex = (index + 1) % SUBHEADLINE_PHRASES.length;
        }
        churnCancel = scrambleChurn(subScrambleEl, SUBHEADLINE_PHRASES[targetIndex], {
          preserveWhitespace: true,
          staggerInMs: CHURN_IN_MS,
        });
      }
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => revealTarget(), IDLE_REVEAL_MS);
    };

    // Click anywhere: snap the rotation back to the top of the list. Runs the
    // same reveal as a normal lock (never a hard text swap) so the reset reads
    // as the readout being re-taken, and re-fires even when phrase 0 is already
    // on screen — the click should always produce that motion.
    const handlePointerDown = () => {
      stopChurn();
      stopReveal();
      clearTimeout(idleTimer);
      targetIndex = 0;
      revealTarget();
    };

    const advanceTimed = () => {
      targetIndex = (index + 1) % SUBHEADLINE_PHRASES.length;
      revealTarget(() => { holdTimer = window.setTimeout(advanceTimed, HOLD_MS); });
    };

    // Handed the subheadline once the intro scramble lands.
    const armCycle = () => {
      if (cursorDriven) {
        window.addEventListener('pointermove', handlePointerMove, { passive: true });
        window.addEventListener('pointerdown', handlePointerDown, { passive: true });
        pointerBound = true;
      } else if (SUBHEADLINE_PHRASES.length > 1) {
        holdTimer = window.setTimeout(advanceTimed, HOLD_MS);
      }
    };

    // Headline lines start empty and type themselves in (growIn below); the
    // spans carry a min-height so emptying them doesn't collapse the panel.
    lines.forEach((node) => { node.textContent = ''; });
    subScrambleEl.textContent = scrambleMask(SUBHEADLINE_PHRASES[0], { preserveWhitespace: true });
    gsap.set(subEl, { autoAlpha: 0 });

    const introCancels = [];
    // The last headline line locks at (stagger * lastIndex) + scrambleS.
    // subheadLeadS is negative, so the subheadline cue lands just ahead of it.
    // Clamped at 0 so a large lead can never schedule before the timeline start.
    const subheadCue = Math.max(
      0,
      (lines.length - 1) * HERO_INTRO.headlineLineStaggerS +
      HERO_INTRO.headlineScrambleS +
      HERO_INTRO.subheadLeadS,
    );

    const tl = gsap.timeline();
    // The intro tweens the panel; applyLayout below owns the inner content's
    // transform/opacity/filter on scroll, so the two never write the same node.
    tl.fromTo(
      panelEl,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: HERO_INTRO.panelFadeS, ease: 'power2.out' },
      0,
    );
    // The blur-in rides each LINE's cue rather than the panel as a whole, so
    // every line resolves out of the same blur on the same beat as its own
    // scramble. One blanket panel tween finished at 0.8s, before the later lines
    // had even started churning, so only the first line ever read as resolving.
    // Still skipped on the simple-scroll viewport, matching applyLayout's
    // scroll-out blur, which is likewise absent there.
    const blurIn = !window.matchMedia(SIMPLE_SCROLL_MEDIA_QUERY).matches;
    lines.forEach((node, i) => {
      const lineCue = i * HERO_INTRO.headlineLineStaggerS;
      if (blurIn) {
        tl.fromTo(
          node,
          { filter: `blur(${HERO_INTRO.blurPx}px)` },
          {
            filter: 'blur(0px)',
            duration: HERO_INTRO.blurInS,
            ease: 'power2.out',
            // Drop the property once it lands rather than parking a blur(0px):
            // that would leave every line its own containing block for nothing.
            onComplete: () => { node.style.filter = ''; },
          },
          lineCue,
        );
      }
      tl.call(() => {
        introCancels.push(scrambleTextTo(node, lineCopy[i], {
          durationMs: HERO_INTRO.headlineScrambleS * 1000,
          preserveWhitespace: true,
          growIn: true,
        }));
      }, null, lineCue);
    });
    tl.to(subEl, { autoAlpha: 1, duration: HERO_INTRO.subheadFadeS, ease: 'power2.out' }, subheadCue);
    tl.call(() => {
      introCancels.push(scrambleTextTo(subScrambleEl, SUBHEADLINE_PHRASES[0], {
        durationMs: HERO_INTRO.subheadScrambleS * 1000,
        preserveWhitespace: true,
        churnBeforeLock: true,
        // Hand off to the cursor-driven cycle (or its timed fallback).
        onComplete: armCycle,
      }));
    }, null, subheadCue);

    return () => {
      tl.kill();
      introCancels.forEach((cancel) => cancel && cancel());
      stopReveal();
      stopChurn();
      if (pointerBound) {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerdown', handlePointerDown);
      }
      if (cursorStageRef?.current) cursorStageRef.current.phase = 'idle';
      clearTimeout(holdTimer);
      clearTimeout(idleTimer);
      lines.forEach((node, i) => {
        node.textContent = lineCopy[i];
        node.style.filter = '';
      });
    };
  }, []);

  useLayoutEffect(() => {
    const el = topLeftRef.current;
    const contentEl = headlineContentRef.current;
    if (!el || !contentEl) return;
    const useSimpleScrollViewport =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(SIMPLE_SCROLL_MEDIA_QUERY).matches;

    let frame = 0;
    let trigger = null;
    const metrics = {
      centeredTop: 0,
      maxWidth: 0,
      gapHeight: 180,
      fontSize: 0,
    };

    const updateMetrics = () => {
      const nav = document.querySelector('#founders-top-strip');
      const contentAnchor =
        document.querySelector('#content-section') ??
        document.querySelector('#panel-hero-text-row');

      if (!nav || !contentAnchor) {
        return;
      }

      const viewportWidth = window.innerWidth;
      const scrollY = window.scrollY || 0;

      // Use document-relative positions so metrics don't shift mid-scroll
      const navHeight = nav.getBoundingClientRect().height ?? 64;
      const contentDocTop = contentAnchor.getBoundingClientRect().top + scrollY;
      const headlineHeight = contentEl.getBoundingClientRect().height || 0;
      const sideGutter = Math.max(viewportWidth * HEADLINE_GUTTER_VW, (viewportWidth - HEADLINE_COLUMN_PX) / 2);
      const maxWidth = Math.max(viewportWidth - (sideGutter * 2), 240);

      // These are fixed viewport coords for position:fixed
      const gapTop = navHeight;
      const gapHeight = Math.max(contentDocTop - navHeight, 180);
      const centeredTop = gapTop + Math.max((gapHeight - headlineHeight) / 2, 0);

      metrics.centeredTop = centeredTop;
      metrics.maxWidth = maxWidth;
      metrics.gapHeight = gapHeight;

      // Poster fit: fill the width, never overflow the gap.
      const lines = headlineLinesFor(matchesNarrowHeadline());
      const unit = measureHeadlineUnitWidth(lines);
      const byWidth = unit > 0 ? maxWidth / unit : Infinity;
      const byHeight = gapHeight / (lines.length * HEADLINE_LINE_HEIGHT + HEADLINE_SUB_LINES_EM);
      metrics.fontSize = Math.max(Math.floor(Math.min(byWidth, byHeight)), HEADLINE_MIN_PX);
    };

    const applyLayout = (progress = 0) => {
      const travelY = useSimpleScrollViewport ? -32 : -60;
      // Fade the hero text out twice as fast as the scroll — fully gone by half travel.
      const fadeOpacity = Math.max(0, 1 - progress * 2);

      el.style.position = useSimpleScrollViewport ? 'absolute' : 'fixed';
      el.style.top = `${metrics.centeredTop}px`;
      el.style.maxWidth = `${metrics.maxWidth}px`;
      el.style.setProperty('--hero-gap-height', `${metrics.gapHeight}px`);
      if (metrics.fontSize) el.style.setProperty('--hero-headline-size', `${metrics.fontSize}px`);

      // Hide subheadline when vertical space is too tight to avoid overlap with section 2
      const sub = el.querySelector('#hero-subheadline');
      if (sub) sub.style.display = metrics.gapHeight < 240 ? 'none' : '';

      if (useSimpleScrollViewport) {
        contentEl.style.transform = `translate3d(0, ${travelY * progress}px, 0)`;
        contentEl.style.opacity = `${fadeOpacity}`;
        contentEl.style.filter = 'blur(0px)';
      } else {
        contentEl.style.transform = `translate3d(0, ${travelY * progress}px, 0)`;
        contentEl.style.opacity = `${fadeOpacity}`;
        contentEl.style.filter = `blur(${10 * progress}px)`;
      }
    };

    const scheduleRefresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const progress = trigger ? trigger.progress : 0;
        updateMetrics();
        applyLayout(progress);
      });
    };

    gsap.set(contentEl, { autoAlpha: 1, y: 0, filter: 'blur(0px)' });

    trigger = ScrollTrigger.create({
      trigger: '#hero-section',
      start: 'top top',
      end: useSimpleScrollViewport ? '35% top' : 'center top',
      scrub: true,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        applyLayout(self.progress);
      },
      onRefresh: (self) => {
        updateMetrics();
        applyLayout(self.progress);
      },
    });

    scheduleRefresh();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleRefresh)
      : null;

    const nav = document.querySelector('#founders-top-strip');
    const contentAnchor =
      document.querySelector('#content-section') ??
      document.querySelector('#panel-hero-text-row');

    if (nav) {
      resizeObserver?.observe(nav);
    }

    if (contentAnchor) {
      resizeObserver?.observe(contentAnchor);
    }

    resizeObserver?.observe(contentEl);

    window.addEventListener('resize', scheduleRefresh);
    window.addEventListener('orientationchange', scheduleRefresh);
    document.addEventListener('visibilitychange', scheduleRefresh);
    window.addEventListener('pageshow', scheduleRefresh);
    window.addEventListener('focus', scheduleRefresh);
    // Re-fit once the Doto webfont is in: fallback metrics differ from the real face.
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    fonts?.ready?.then(scheduleRefresh);
    fonts?.addEventListener?.('loadingdone', scheduleRefresh);

    return () => {
      fonts?.removeEventListener?.('loadingdone', scheduleRefresh);
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleRefresh);
      window.removeEventListener('orientationchange', scheduleRefresh);
      document.removeEventListener('visibilitychange', scheduleRefresh);
      window.removeEventListener('pageshow', scheduleRefresh);
      window.removeEventListener('focus', scheduleRefresh);
      resizeObserver?.disconnect();
      trigger?.kill();
    };
  }, []);

  const ink = HEADLINE_BLEND_MODE ? HEADLINE_BLEND_INK : textColor;
  const edge = `max(${HEADLINE_GUTTER_VW * 100}vw, calc((100vw - ${HEADLINE_COLUMN_PX}px) / 2))`;

  return (
    <>
      <style>{`
        @media (max-width: 620px) {
          #hero-panel-top-left h1 {
            /* Preserve the Doto face's original proportions; reclaim room
               between lines rather than distorting the letterforms. */
            font-size: clamp(2.5rem, 13.5vw, 7.1rem) !important;
            line-height: 0.75 !important;
          }
          #hero-subheadline { font-size: clamp(1.25rem, 6vw, 1.75rem) !important; }
          #hero-subheadline-scramble { white-space: normal; word-break: break-word; }
        }
      `}</style>
      {/* Top-left — Headline */}
      <div
        id="hero-panel-top-left"
        ref={topLeftRef}
        style={{
          ...glass,
          '--hero-gap-height': '70vh',
          top: '50vh',
          left: edge,
          width: `calc(100vw - (${edge}) * 2)`,
          maxWidth: 'none',
          background: 'none',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          border: 'none',
          boxShadow: 'none',
          padding: 0,
          mixBlendMode: HEADLINE_BLEND_MODE || 'normal',
        }}
      >
        <div ref={headlineContentRef}>
          <h1 id="hero-headline-primary" style={{
            fontWeight: HEADLINE_WEIGHT,
            fontFamily: HEADLINE_FONT_STACK,
            letterSpacing: `${HEADLINE_TRACKING}em`,
            WebkitTextStroke: `${HEADLINE_STROKE_EM}em currentColor`,
            lineHeight: HEADLINE_LINE_HEIGHT,
            color: ink,
            margin: 0,
            textAlign: 'left',
            // Measured poster fit (set per frame on #hero-panel-top-left); the clamp is
            // only the pre-measure fallback.
            fontSize: 'var(--hero-headline-size, clamp(1.25rem, min(13vw, calc(var(--hero-gap-height) / 5)), 7.1rem))',
            textTransform: 'none',
          }}>
            {/* Rendered from the wide copy with index keys so a breakpoint swap
                rewrites text in place instead of replacing the node the intro
                timeline holds. The panel is visibility:hidden until the intro
                runs, so the wide word never paints on a phone. */}
            {HEADLINE_LINES_WIDE.map((line, i) => {
              const isAccent = i === HEADLINE_LINES_WIDE.length - 1;
              return (
                // minHeight holds the line box while the intro types the text in
                // from empty, so the panel's centred position never recomputes.
                <span
                  key={i}
                  data-hero-headline-line
                  {...(isAccent ? { 'data-hero-headline-accent': '' } : null)}
                  style={{
                    display: 'block',
                    minHeight: `${HEADLINE_LINE_HEIGHT}em`,
                  }}
                >
                  {line}
                </span>
              );
            })}
          </h1>
          <p id="hero-subheadline" style={{
            margin: '1rem 0 0',
            textAlign: 'left',
            // Same face/weight as the HELLO marquee (StackedSlidesSection) —
            // the thin Doto, without the headline's stroke.
            fontFamily: HEADLINE_FONT_STACK,
            fontSize: 'clamp(1.8rem, 5vw, 3.6rem)',
            letterSpacing: `${HEADLINE_TRACKING}em`,
            lineHeight: 1.5,
            color: ink,
            opacity: 0.85,
            fontWeight: 700,
            maxWidth: '42ch',
          }}>
            <span
              id="hero-subheadline-scramble"
              ref={scrambleTextRef}
              style={{
                display: 'inline-block',
                fontVariantLigatures: 'none',
                whiteSpace: 'pre',
              }}
            >
              BRYAN BALLI
            </span>
          </p>
        </div>
      </div>

      {/* Self-cycling deliverable card deck, right gutter of the hero. Hidden for now. */}
      {/* <HeroDeliverableDeck /> */}
    </>
  );
};

export default HeroHeadline;
