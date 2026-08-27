import React, { useLayoutEffect, useRef } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import gsap from 'gsap';
import { easeOutQuart, scrambleChurn, scrambleMask, scrambleTextTo } from './components/home/scrambleText';
// Hidden for now — hero card deck.
// import HeroDeliverableDeck from './components/home/HeroDeliverableDeck';

gsap.registerPlugin(ScrollTrigger);

const SIMPLE_SCROLL_MEDIA_QUERY = '(max-width: 680px) and (pointer: coarse)';

// Lines the subheadline cycles through. Add/remove freely — any length works.
const SUBHEADLINE_PHRASES = [
  'BRYAN BALLI',
  'Brand Identity & Design',
  'Websites & Landing Pages',
  'Social Media & Content',
  'Video & Motion',
  'SEO & Content Strategy',
  'Email & Newsletter Systems',
  'Daily Briefs',
  'AI Automation & Workflows',
  'Blockchain Products & Payments',
  'Browser Based Gaming',
];

// The subheadline is cursor-driven on fine-pointer devices: it churns while the
// pointer moves and resolves into the next phrase once the pointer holds still
// for IDLE_REVEAL_MS. It never advances on its own. Touch/coarse-pointer devices
// get no pointermove events, so they fall back to the original timed cycle
// (HOLD_MS between reveals) instead of freezing on the first phrase.
// A click resets the rotation to the first phrase, so the name is always one
// deliberate action away no matter how far the cursor has walked the list.
const HOLD_MS = 1600;        // coarse-pointer fallback: hold between phrases
const SCRAMBLE_MS = 340;     // time spent scrambling into the next phrase
const IDLE_REVEAL_MS = 220;  // cursor stillness that triggers the reveal

const HEADLINE_LINES = ['HUMAN', 'IN THE', 'LOOP'];

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
  background: 'linear-gradient(160deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.07) 100%) padding-box, linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.35) 100%) border-box',
  border: '1px solid transparent',
  boxShadow: '0 8px 40px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.3)',
  borderRadius: '1rem',
  padding: 'clamp(1rem, 2vw, 1.5rem)',
  position: 'fixed',
  zIndex: 100,
  pointerEvents: 'none',
  visibility: 'hidden',
};

const HeroHeadline = ({ headerLogoRef, textColor = '#2a2420', cursorStageRef = null }) => {
  const topLeftRef = useRef(null);
  const headlineContentRef = useRef(null);
  const scrambleTextRef = useRef(null);

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
    const lineCopy = lines.map((node, i) => HEADLINE_LINES[i] ?? node.textContent);

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
      } else {
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
    if (!window.matchMedia(SIMPLE_SCROLL_MEDIA_QUERY).matches) {
      tl.fromTo(
        panelEl,
        { filter: `blur(${HERO_INTRO.blurPx}px)` },
        { filter: 'blur(0px)', duration: HERO_INTRO.blurInS, ease: 'power2.out' },
        0,
      );
    }
    lines.forEach((node, i) => {
      tl.call(() => {
        introCancels.push(scrambleTextTo(node, lineCopy[i], {
          durationMs: HERO_INTRO.headlineScrambleS * 1000,
          preserveWhitespace: true,
          growIn: true,
        }));
      }, null, i * HERO_INTRO.headlineLineStaggerS);
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
      lines.forEach((node, i) => { node.textContent = lineCopy[i]; });
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
      const sideGutter = Math.max(viewportWidth * 0.1, (viewportWidth - 810) / 2);
      const maxWidth = Math.max(Math.min(viewportWidth - (sideGutter * 2), 672), 240);

      // These are fixed viewport coords for position:fixed
      const gapTop = navHeight;
      const gapHeight = Math.max(contentDocTop - navHeight, 180);
      const centeredTop = gapTop + Math.max((gapHeight - headlineHeight) / 2, 0);

      metrics.centeredTop = centeredTop;
      metrics.maxWidth = maxWidth;
      metrics.gapHeight = gapHeight;
    };

    const applyLayout = (progress = 0) => {
      const travelY = useSimpleScrollViewport ? -32 : -60;
      // Fade the hero text out twice as fast as the scroll — fully gone by half travel.
      const fadeOpacity = Math.max(0, 1 - progress * 2);

      el.style.position = useSimpleScrollViewport ? 'absolute' : 'fixed';
      el.style.top = `${metrics.centeredTop}px`;
      el.style.maxWidth = `${metrics.maxWidth}px`;
      el.style.setProperty('--hero-gap-height', `${metrics.gapHeight}px`);

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

    return () => {
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

  const edge = 'max(10vw, calc((100vw - 810px) / 2))';

  return (
    <>
      <style>{`
        @media (max-width: 620px) {
          #hero-panel-top-left h1 {
            /* Preserve the Doto face's original proportions; reclaim room
               between lines rather than distorting the letterforms. */
            font-size: clamp(3.5rem, 22vw, 7.83rem) !important;
            line-height: 0.75 !important;
          }
          #hero-subheadline { font-size: clamp(1rem, 4vw, 1.25rem) !important; }
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
          width: 'min(82vw, 42rem)',
          maxWidth: '42rem',
          background: 'none',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          border: 'none',
          boxShadow: 'none',
          padding: 0,
        }}
      >
        <div ref={headlineContentRef}>
          <h1 style={{
            fontWeight: 700,
            fontFamily: "'Doto', 'Space Mono', monospace",
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            color: textColor,
            margin: 0,
            fontSize: 'clamp(1.25rem, min(13vw, calc(var(--hero-gap-height) / 5)), 7.83rem)',
            textTransform: 'none',
          }}>
            {HEADLINE_LINES.map((line) => (
              // minHeight holds the line box while the intro types the text in
              // from empty, so the panel's centred position never recomputes.
              <span key={line} data-hero-headline-line style={{ display: 'block', minHeight: '1.05em' }}>{line}</span>
            ))}
          </h1>
          <p id="hero-subheadline" style={{
            margin: '1rem 0 0',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontSize: 'clamp(1.4rem, 3.5vw, 2.45rem)',
            lineHeight: 1.5,
            color: textColor,
            opacity: 0.85,
            fontWeight: 300,
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
              Creative Systems for Modern Businesses
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
