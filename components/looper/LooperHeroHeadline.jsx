'use client';

// Copy-adapted from HeroHeadline.jsx (root) for the standalone, non-scrolling
// /looper page.
//
// KEPT verbatim in spirit: the character-scramble load-in sequence (panel
// fade + per-line blur-in + scramble type-in, one gsap timeline) and the
// cursor-driven subheadline cycle (churns while the pointer moves, resolves
// once the pointer holds still; coarse-pointer devices fall back to a timed
// cycle). Both are self-contained — they only touch this component's own
// DOM nodes plus the shared `cursorStageRef` clock (components/home/heroCursorStage.js),
// so they port over unchanged.
//
// DROPPED entirely: HeroHeadline's second effect, which recomputes a
// `position: fixed` top offset every SCROLL FRAME from `#founders-top-strip` /
// `#content-section` geometry via a ScrollTrigger pinned to `#hero-section`
// (`applyLayout`/`updateMetrics`). /looper never scrolls, so none of that
// per-frame recomputation applies here.
//
// KEPT (2026-08-29 hero-geometry pass): the same RESTING fixed-position values
// HeroHeadline.jsx declares before its ScrollTrigger ever runs — left-aligned
// to the shared 810px content column via the same `max(10vw, calc((100vw -
// 810px) / 2))` formula used by the real homepage nav (`#founders-top-strip-inner`
// in colors.css) and by HeroHeadline.jsx's own local `edge` const, at the same
// `width: min(82vw, 42rem)`. See `panelStyle` below.
//
// Also dropped: the wide/narrow headline-word swap (HEADLINE_LINES_WIDE vs
// _NARROW) — that existed only because "PORTFOLIO" overran the panel on
// phones. This page's headline words are already short.

import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { easeOutQuart, scrambleMask, scrambleTextTo } from '../home/scrambleText';

const HEADLINE_LINES = ['EDIT', 'TRAX', 'LOOPER'];


// Same cursor-driven cadence as the homepage hero.
const HOLD_MS = 1600;        // coarse-pointer fallback: hold between phrases
const SCRAMBLE_MS = 340;     // time spent scrambling into the next phrase

// Static subheadline (owner direction, 2026-08-29) — no phrase cycling.
// A single entry keeps the intro scramble-in; armCycle() below skips the
// timed cycle whenever there's nothing to cycle to.
const SUBHEADLINE_PHRASES = [
  'DROP YOUR TRACK GET LOOPS',
];

const HEADLINE_ACCENT_STYLE = {
  width: 'fit-content',
  backgroundImage: 'linear-gradient(90deg, #bda7b4 0%, #a09fc0 50%, #8294b6 100%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  color: 'transparent',
};

const HERO_INTRO = {
  panelFadeS: 0.45,
  blurPx: 10,
  blurInS: 0.8,
  headlineScrambleS: 0.9,
  headlineLineStaggerS: 0.1,
  subheadLeadS: -0.35,
  subheadFadeS: 0.4,
  subheadScrambleS: 0.5,
};

// Same shared-column left edge as #founders-top-strip-inner (colors.css) and
// HeroHeadline.jsx's own local `edge` const — NOT hardcoded, so the column
// stays centered/responsive at every viewport width.
const HERO_COLUMN_EDGE = 'max(10vw, calc((100vw - 810px) / 2))';

const panelStyle = {
  position: 'fixed',
  zIndex: 5,
  // Approximates HeroHeadline.jsx's live-measured resting top (nav height
  // 64px + a small gap ≈ the measured y=128 at a 782px-tall viewport, floored
  // so it never sits under the fixed header on very short viewports).
  top: 'max(calc(64px + 12px), 16dvh)',
  left: HERO_COLUMN_EDGE,
  width: 'min(82vw, 42rem)',
  maxWidth: '42rem',
  boxSizing: 'border-box',
  textAlign: 'left',
  // Same role as HeroHeadline.jsx's --hero-gap-height (there fed by live
  // scroll metrics; here static): the vertical room actually available to
  // the headline block — viewport minus the panel's own top offset (16dvh)
  // minus the upload-pill zone at the bottom (~10rem incl. its clearance).
  '--hero-gap-height': 'calc(84dvh - 10rem)',
};

// Same formula family as HeroHeadline.jsx's headline
// (`clamp(1.25rem, min(13vw, gap/5), 7.83rem)`), with the fill factors
// turned up per owner direction — /looper's three short words can run much
// larger than the homepage's before they threaten the column width. The
// height term (gap/3.6, three 1.05-line-height lines + subheadline ≈ 95% of
// the gap) is what actually clamps short viewports; 16vw clamps narrow ones.
const headlineStyle = {
  margin: 0,
  fontWeight: 700,
  fontFamily: "'Doto', 'Space Mono', monospace",
  letterSpacing: '-0.02em',
  lineHeight: 1.05,
  // gap/3.8: three 1.05-line-height lines (3.15em) + the subheadline block
  // (~0.55 gap-relative) must fit the gap — /3.8 lands the whole stack just
  // inside it at every tested viewport height.
  fontSize: 'clamp(1.25rem, min(16vw, calc(var(--hero-gap-height) / 3.8)), 10.5rem)',
  textTransform: 'none',
};

// Verbatim from HeroHeadline.jsx's #hero-subheadline sizing.
const subheadStyle = {
  margin: '1rem 0 0',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: 'clamp(1.4rem, 3.5vw, 2.45rem)',
  lineHeight: 1.5,
  opacity: 0.85,
  fontWeight: 300,
  maxWidth: '42ch',
};

const scrambleSpanStyle = {
  display: 'inline-block',
  fontVariantLigatures: 'none',
  whiteSpace: 'pre',
};

const LooperHeroHeadline = ({ textColor = '#000000', cursorStageRef = null }) => {
  const panelRef = useRef(null);
  const headlineContentRef = useRef(null);
  const scrambleTextRef = useRef(null);

  useLayoutEffect(() => {
    const panelEl = panelRef.current;
    const contentEl = headlineContentRef.current;
    const subScrambleEl = scrambleTextRef.current;
    if (!panelEl || !contentEl || !subScrambleEl) return undefined;
    const subEl = panelEl.querySelector('#looper-hero-subheadline');
    if (!subEl) return undefined;

    const lines = Array.from(contentEl.querySelectorAll('[data-hero-headline-line]'));
    // Source of truth is the constant, NOT the DOM — a StrictMode re-run of
    // this effect reads the PREVIOUS run's half-scrambled textContent ("}",
    // "#") and would then "restore" garbage as the final headline.
    const lineCopy = lines.map((node, i) => HEADLINE_LINES[i] ?? node.textContent);

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      lines.forEach((node, i) => { node.textContent = lineCopy[i]; });
      subScrambleEl.textContent = SUBHEADLINE_PHRASES[0];
      gsap.set([panelEl, subEl], { autoAlpha: 1 });
      return undefined;
    }

    // index = phrase currently resolved on screen. targetIndex = the phrase the
    // active churn/reveal is heading to; it only folds back into index when a
    // reveal actually completes, so a reveal interrupted by more cursor movement
    // resumes toward the same phrase instead of skipping one.
    // MOUSE INTERACTION REMOVED (owner direction, 2026-08-29): the homepage's
    // cursor-driven churn/reveal cycle and the cursor-stage canvas effect are
    // gone from /looper. The subheadline cycles on a plain timer for every
    // device, and the shared cursorStageRef (still passed to
    // HeroSchematicOverlay, which needs it mounted) is never written — it
    // stays 'idle' forever, so no pointer-reactive visuals ever engage.
    let index = 0;
    let targetIndex = 0;
    let cycleCancel = null;   // in-flight reveal
    let holdTimer = 0;        // timed phrase cycle

    const stopReveal = () => {
      if (cycleCancel) { cycleCancel(); cycleCancel = null; }
    };

    const revealTarget = (onDone) => {
      cycleCancel = scrambleTextTo(subScrambleEl, SUBHEADLINE_PHRASES[targetIndex], {
        durationMs: SCRAMBLE_MS,
        preserveWhitespace: true,
        churnBeforeLock: true,
        ease: easeOutQuart,
        onComplete: () => {
          cycleCancel = null;
          index = targetIndex;
          if (onDone) onDone();
        },
      });
    };

    const advanceTimed = () => {
      targetIndex = (index + 1) % SUBHEADLINE_PHRASES.length;
      revealTarget(() => { holdTimer = window.setTimeout(advanceTimed, HOLD_MS); });
    };

    let cycleArmed = false;
    const armCycle = () => {
      if (cycleArmed || SUBHEADLINE_PHRASES.length < 2) return;
      cycleArmed = true;
      holdTimer = window.setTimeout(advanceTimed, HOLD_MS);
    };

    lines.forEach((node) => { node.textContent = ''; });
    subScrambleEl.textContent = scrambleMask(SUBHEADLINE_PHRASES[0], { preserveWhitespace: true });
    gsap.set(subEl, { autoAlpha: 0 });
    gsap.set(panelEl, { autoAlpha: 0 });

    const introCancels = [];
    const subheadCue = Math.max(
      0,
      (lines.length - 1) * HERO_INTRO.headlineLineStaggerS +
      HERO_INTRO.headlineScrambleS +
      HERO_INTRO.subheadLeadS,
    );

    const tl = gsap.timeline();
    tl.fromTo(
      panelEl,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: HERO_INTRO.panelFadeS, ease: 'power2.out' },
      0,
    );
    lines.forEach((node, i) => {
      const lineCue = i * HERO_INTRO.headlineLineStaggerS;
      tl.fromTo(
        node,
        { filter: `blur(${HERO_INTRO.blurPx}px)` },
        {
          filter: 'blur(0px)',
          duration: HERO_INTRO.blurInS,
          ease: 'power2.out',
          onComplete: () => { node.style.filter = ''; },
        },
        lineCue,
      );
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
        onComplete: armCycle,
      }));
    }, null, subheadCue);

    // Dev StrictMode/Suspense re-runs can kill the intro timeline mid-flight,
    // stranding the panel hidden with EMPTY headline text (observed: fully
    // blank hero). After the intro's natural runtime, force the end state.
    // Settle detector — StrictMode/Suspense re-runs can leave a duplicate
    // effect instance's cancelled scramble as STATIC garbage ("{", "#") in a
    // line while this instance's own scramble never lands. A one-shot timer
    // proved insufficient (garbage can arrive after it fires), so instead:
    // every 1.5s, any line whose text is wrong AND unchanged since the last
    // check (i.e. not mid-animation) is snapped to its final copy. Stops
    // once everything is correct or after ~12s.
    let prevSnapshot = null;
    let settleTicks = 0;
    const settleGuard = window.setInterval(() => {
      settleTicks += 1;
      gsap.set([panelEl, subEl], { autoAlpha: 1 });
      const snapshot = lines.map((n) => n.textContent).concat(subScrambleEl.textContent);
      let allGood = true;
      lines.forEach((node, i) => {
        if (node.textContent === lineCopy[i]) {
          // Text landed but a killed blur-in tween can strand its filter.
          if (node.style.filter) node.style.filter = '';
          return;
        }
        allGood = false;
        if (prevSnapshot && prevSnapshot[i] === node.textContent) {
          node.style.filter = '';
          node.textContent = lineCopy[i];
        }
      });
      const subOk = SUBHEADLINE_PHRASES.includes(subScrambleEl.textContent);
      if (!subOk) {
        allGood = false;
        if (prevSnapshot && prevSnapshot[lines.length] === subScrambleEl.textContent) {
          subScrambleEl.textContent = SUBHEADLINE_PHRASES[0];
        }
      }
      prevSnapshot = snapshot;
      if (allGood || settleTicks >= 8) {
        window.clearInterval(settleGuard);
        // The timed phrase cycle normally arms via the intro scramble's
        // onComplete — which a killed timeline never fires. Arm it here so
        // the subheadline still cycles after a forced settle (no-op if the
        // intro completed normally).
        armCycle();
      }
    }, 1500);

    return () => {
      window.clearInterval(settleGuard);
      tl.kill();
      introCancels.forEach((cancel) => cancel && cancel());
      stopReveal();
      if (cursorStageRef?.current) cursorStageRef.current.phase = 'idle';
      clearTimeout(holdTimer);
      lines.forEach((node, i) => {
        node.textContent = lineCopy[i];
        node.style.filter = '';
      });
    };
  }, [cursorStageRef]);

  return (
    <div id="looper-hero-headline-panel" ref={panelRef} style={panelStyle}>
      {/* Mirrors HeroHeadline.jsx's own ≤620px block: preserve the Doto
          face's proportions and reclaim room between lines rather than
          distorting letterforms; subheadline wraps instead of clipping. */}
      <style>{`
        @media (max-width: 620px) {
          #looper-hero-headline-primary {
            font-size: clamp(3.5rem, 22vw, 7.83rem) !important;
            line-height: 0.75 !important;
          }
          #looper-hero-subheadline { font-size: clamp(1rem, 4vw, 1.25rem) !important; }
          #looper-hero-subheadline-scramble { white-space: normal; word-break: break-word; }
        }
      `}</style>
      <div ref={headlineContentRef}>
        <h1 id="looper-hero-headline-primary" style={{ ...headlineStyle, color: textColor }}>
          {HEADLINE_LINES.map((line, i) => {
            const isAccent = i === HEADLINE_LINES.length - 1;
            return (
              <span
                key={line}
                data-hero-headline-line
                {...(isAccent ? { 'data-hero-headline-accent': '' } : null)}
                style={{
                  display: 'block',
                  minHeight: '1.05em',
                  ...(isAccent ? HEADLINE_ACCENT_STYLE : null),
                }}
              >
                {line}
              </span>
            );
          })}
        </h1>
        <p id="looper-hero-subheadline" style={{ ...subheadStyle, color: textColor }}>
          <span id="looper-hero-subheadline-scramble" ref={scrambleTextRef} style={scrambleSpanStyle}>
            DROP YOUR TRACK GET LOOPS
          </span>
        </p>
      </div>
    </div>
  );
};

export default LooperHeroHeadline;
