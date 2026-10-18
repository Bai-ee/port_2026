import React, { useLayoutEffect, useRef, useState } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import gsap from 'gsap';
import { scrambleMask, scrambleTextTo } from './components/home/scrambleText';
import UpRightArrow from './components/UpRightArrow';
import { DEFAULT_HERO_TYPE, HERO_MAX_LINES, fontStackFor, getHeroType, subscribeHeroType } from './lib/hero-type/store';
// Hidden for now — hero card deck.
// import HeroDeliverableDeck from './components/home/HeroDeliverableDeck';

gsap.registerPlugin(ScrollTrigger);

const SIMPLE_SCROLL_MEDIA_QUERY = '(max-width: 680px) and (pointer: coarse)';

// Headline lines, subheadline phrases and the type styling all come from
// lib/hero-type/store.js (defaults + the dev-only Type panel's live draft).
// subPhrases are the lines the subheadline cycles through; a single entry means
// the line only scrambles under the cursor and always resolves back to it.

// The small line rests on the first sub phrase (HUMAN IN THE LOOP) and swaps to a "LET'S CONNECT ↗" CTA the
// same way the header LOGIN button does (Header.jsx): the scramble sweeps left to right through a symbols-only
// pool, each cell shows pink while scrambled and the line's ink once locked, then the arrow fades into the last
// cell; going back sweeps right to left. It swaps on hover/focus and while the page is scrolled down past
// SCROLL_SWAP_PX. Clicking opens the homepage Onboarding modal (website or email).
const CTA_LABEL = "LET'S CONNECT ";        // trailing space = the gap cell before the arrow
const CTA_ARROW_CELL = CTA_LABEL.length;   // the arrow sits over this cell
const CTA_SCRAMBLE_POOL = '!<>-\\/[]{}=+*^?#';
const CTA_MASK_COLOR = 'var(--t-accent)';
const SWAP_MS = 640;          // the header's 420ms, stretched for a line ~2.5x as long
const SCROLL_SWAP_PX = 24;    // scrolled further than this = CTA
const OPEN_ONBOARD_EVENT = 'openOnboardModal'; // StackedSlidesSection opens #cmo-modal-overlay on it
const isSettledGlyph = (ch) => !ch || /[A-Za-z0-9'\s]/.test(ch); // the pool holds no letters


// Poster fit. The headline is sized so its widest line spans the panel
// (the 810px content column the hero input row sits in) and the block still
// clears the hero gap. Measured with
// canvas text metrics in the headline's own face, so the ratio holds for any
// copy and re-fits once the webfont lands. Phones (≤620px) keep their own
// clamp via the !important rule below.
// Font, weight, tracking (em) and stroke (em) come from the hero type settings
// and are mirrored in measurement (the stroke widens each line by its own width).
// Doto tops out at 900; a same-colour stroke thickens the dots past that.
const HEADLINE_SUB_LINES_EM = 1.3;        // subheadline + its margin, in headline ems
// Same column as #hero-url-input-row (StackedSlidesSection) and the nav strip:
// max(10vw, centred 810px), so the headline's left edge lines up with the input.
const HEADLINE_COLUMN_PX = 810;
const HEADLINE_GUTTER_VW = 0.1;
const HEADLINE_MIN_PX = 20;
// The small line's bottom edge sits this far above the content panel (#content-section) at every width; when it
// wraps to more lines it grows upward, so its baseline position never moves. 75px = the desktop spot.
const SUB_ANCHOR_GAP_PX = 75;
let headlineMeasureCtx = null;
const measureHeadlineUnitWidth = (lines, type) => {
  if (typeof document === 'undefined') return 0;
  if (!headlineMeasureCtx) headlineMeasureCtx = document.createElement('canvas').getContext('2d');
  const ctx = headlineMeasureCtx;
  if (!ctx) return 0;
  ctx.font = `${type.headlineWeight} 100px ${fontStackFor(type.headlineFont)}`;
  let widest = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width + line.length * type.headlineTrackingEm * 100 + type.headlineStrokeEm * 100;
    if (w > widest) widest = w;
  }
  return widest / 100; // width of the widest line per 1px of font size
};

// Blend: by default the hero text is painted white and composited with
// mix-blend-mode difference, so it inverts whatever sits behind it — near-black
// over the light page, shifting colour where it crosses the loop and gradient.
// Both are type settings (headlineBlend / headlineInk; 'page' = textColor prop).
// The blend sits on #hero-panel-top-left (not the lines) because applyLayout
// writes a filter on the inner content node, which would isolate child blends.
const resolveInk = (value, textColor) => (value === 'page' ? textColor : value);

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
  const ctaArrowRef = useRef(null);
  // Render starts from the defaults (matches the server markup); the first layout
  // effect swaps in the dev draft before anything paints. Styles re-render from
  // state; text is written imperatively (see the intro effect) like everywhere else.
  const [type, setType] = useState(DEFAULT_HERO_TYPE);
  const typeRef = useRef(DEFAULT_HERO_TYPE);
  const refitRef = useRef(null);

  useLayoutEffect(() => {
    typeRef.current = getHeroType();
    setType(typeRef.current);
    return subscribeHeroType((next) => {
      typeRef.current = next;
      setType(next);
      refitRef.current?.();
    });
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

    // All HERO_MAX_LINES slots; the ones past the current copy are hidden.
    const slots = Array.from(contentEl.querySelectorAll('[data-hero-headline-line]'));
    const introLines = typeRef.current.headlineLines;
    slots.forEach((node, i) => { node.style.display = i < introLines.length ? 'block' : 'none'; });
    const lines = slots.slice(0, introLines.length);
    const lineCopy = lines.map((_, i) => introLines[i]);
    const phrases = () => typeRef.current.subPhrases;
    const phraseAt = (i) => phrases()[i % phrases().length];

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      lines.forEach((node, i) => { node.textContent = lineCopy[i]; });
      subScrambleEl.textContent = phraseAt(0);
      gsap.set([panelEl, subEl], { autoAlpha: 1 });
      return subscribeHeroType((next) => {
        slots.forEach((node, i) => {
          node.textContent = next.headlineLines[i] ?? '';
          node.style.display = i < next.headlineLines.length ? 'block' : 'none';
        });
        subScrambleEl.textContent = next.subPhrases[0];
      });
    }

    // The line is a row of one-character cells (Doto is monospaced, so a cell never changes width), which lets
    // each character carry its own colour during the CTA sweep.
    const arrowEl = ctaArrowRef.current;
    const cells = [];
    const ensureCells = (n) => {
      if (!cells.length) subScrambleEl.textContent = '';
      while (cells.length < n) {
        const cell = document.createElement('span');
        cell.style.whiteSpace = 'pre';
        cells.push(cell);
        subScrambleEl.appendChild(cell);
      }
    };
    const readCells = (list) => list.map((cell) => cell.textContent || ' ').join('');
    // Writer for the intro scramble and Type panel edits; scrambled glyphs get the same pink as the CTA sweep.
    const plainLine = {
      get textContent() { return readCells(cells).replace(/ +$/, ''); },
      set textContent(value) {
        ensureCells(Math.max(value.length, CTA_ARROW_CELL + 1));
        cells.forEach((cell, c) => {
          const ch = value[c] ?? '';
          cell.textContent = ch;
          cell.style.color = isSettledGlyph(ch) ? '' : CTA_MASK_COLOR;
        });
      },
    };

    let swapCancel = null;
    const stopSwap = () => { if (swapCancel) { swapCancel(); swapCancel = null; } };
    // scrambleTextTo only reads/writes textContent and always locks left to right, so this stand-in spreads each
    // frame across the cells (reversed for a right-to-left sweep). No churnBeforeLock: cells ahead of the wave
    // hold their glyph, so the sweep reads as a wave.
    const sweepTo = (target, { rightToLeft = false, onDone } = {}) => {
      stopSwap();
      ensureCells(Math.max(target.length, CTA_ARROW_CELL + 1));
      const order = rightToLeft ? [...cells].reverse() : cells;
      const goal = target.padEnd(cells.length);
      const view = {
        get textContent() { return readCells(order); },
        set textContent(value) {
          order.forEach((cell, c) => {
            const ch = value[c] ?? '';
            cell.textContent = ch;
            cell.style.color = isSettledGlyph(ch) ? '' : CTA_MASK_COLOR;
          });
        },
      };
      swapCancel = scrambleTextTo(view, rightToLeft ? [...goal].reverse().join('') : goal, {
        durationMs: SWAP_MS,
        charPool: CTA_SCRAMBLE_POOL,
        onComplete: () => { swapCancel = null; if (onDone) onDone(); },
      });
    };

    const placeArrow = () => {
      const cell = cells[CTA_ARROW_CELL];
      if (!arrowEl || !cell) return;
      arrowEl.style.left = `${cell.getBoundingClientRect().left - subEl.getBoundingClientRect().left}px`;
    };

    const setStage = (phase) => {
      const stage = cursorStageRef?.current;
      if (!stage) return;
      stage.phase = phase;
      if (phase === 'reveal') {
        stage.revealAt = performance.now();
        stage.revealMs = SWAP_MS;
      }
    };

    let armed = false;        // the intro scramble has handed the line over
    let ctaShown = false;     // the state the line is sweeping (or has swept) to
    let hovered = false;
    let focused = false;
    let scrolled = window.scrollY > SCROLL_SWAP_PX;
    const sync = () => {
      if (!armed) return;
      const next = hovered || focused || scrolled;
      if (next === ctaShown) return;
      ctaShown = next;
      setStage('reveal');
      if (next) {
        sweepTo(CTA_LABEL, { onDone: () => { placeArrow(); if (arrowEl) arrowEl.style.opacity = '1'; setStage('idle'); } });
      } else {
        if (arrowEl) arrowEl.style.opacity = '0';
        sweepTo(phraseAt(0), { rightToLeft: true, onDone: () => setStage('idle') });
      }
    };

    const handleEnter = () => { hovered = true; sync(); };
    const handleLeave = () => { hovered = false; sync(); };
    const handleFocus = () => { focused = true; sync(); };
    const handleBlur = () => { focused = false; sync(); };
    const handleScroll = () => { scrolled = window.scrollY > SCROLL_SWAP_PX; sync(); };

    subEl.addEventListener('pointerenter', handleEnter);
    subEl.addEventListener('pointerleave', handleLeave);
    subEl.addEventListener('focus', handleFocus);
    subEl.addEventListener('blur', handleBlur);
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Handed the subheadline once the intro scramble lands; catch up if the page loaded scrolled or hovered.
    const armCycle = () => {
      armed = true;
      sync();
    };

    // Headline lines start empty and type themselves in (growIn below); the
    // spans carry a min-height so emptying them doesn't collapse the panel.
    lines.forEach((node) => { node.textContent = ''; });
    plainLine.textContent = scrambleMask(phraseAt(0), { preserveWhitespace: true });
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
      introCancels.push(scrambleTextTo(plainLine, phraseAt(0), {
        durationMs: HERO_INTRO.subheadScrambleS * 1000,
        preserveWhitespace: true,
        churnBeforeLock: true,
        // Hand off to the hover/scroll CTA swap.
        onComplete: armCycle,
      }));
    }, null, subheadCue);

    // Type panel edits (dev): rewrite the headline slots in place and restart the
    // subheadline cycle from its first phrase.
    const unsubscribeType = subscribeHeroType((next) => {
      slots.forEach((node, i) => {
        node.textContent = next.headlineLines[i] ?? '';
        node.style.display = i < next.headlineLines.length ? 'block' : 'none';
        node.style.filter = '';
      });
      stopSwap();
      ctaShown = false;
      if (arrowEl) arrowEl.style.opacity = '0';
      plainLine.textContent = next.subPhrases[0];
    });

    return () => {
      unsubscribeType();
      tl.kill();
      introCancels.forEach((cancel) => cancel && cancel());
      stopSwap();
      subEl.removeEventListener('pointerenter', handleEnter);
      subEl.removeEventListener('pointerleave', handleLeave);
      subEl.removeEventListener('focus', handleFocus);
      subEl.removeEventListener('blur', handleBlur);
      window.removeEventListener('scroll', handleScroll);
      if (cursorStageRef?.current) cursorStageRef.current.phase = 'idle';
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
      // Anchor the small line (the only visible text) above the content panel rather than centring the block.
      const sub = el.querySelector('#hero-subheadline');
      const subBottomInPanel = sub ? sub.offsetTop + sub.offsetHeight : headlineHeight;
      const centeredTop = Math.max(gapTop, contentDocTop - SUB_ANCHOR_GAP_PX - subBottomInPanel);

      metrics.centeredTop = centeredTop;
      metrics.maxWidth = maxWidth;
      metrics.gapHeight = gapHeight;

      // Poster fit: fill the width, never overflow the gap.
      const type = typeRef.current;
      const lines = type.headlineLines;
      const unit = measureHeadlineUnitWidth(lines, type);
      const byWidth = unit > 0 ? maxWidth / unit : Infinity;
      const byHeight = gapHeight / (lines.length * type.headlineLineHeight + HEADLINE_SUB_LINES_EM);
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
    refitRef.current = scheduleRefresh;

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
      refitRef.current = null;
    };
  }, []);

  const ink = resolveInk(type.headlineInk, textColor);
  const accentInk = type.accentInk ? resolveInk(type.accentInk, textColor) : undefined;
  const headlineSlots = Array.from({ length: HERO_MAX_LINES }, (_, i) => DEFAULT_HERO_TYPE.headlineLines[i] ?? '');
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
          // Normal while the headline is hidden: the small line matches the header label exactly (a difference
          // blend would turn its pink scramble green).
          mixBlendMode: 'normal',
        }}
      >
        <div ref={headlineContentRef}>
          {/* Headline hidden: the small line alone reads HUMAN IN THE LOOP and is anchored above the content panel
              (SUB_ANCHOR_GAP_PX). Kept mounted because the intro timeline holds its line slots. */}
          <h1 id="hero-headline-primary" aria-hidden="true" style={{
            display: 'none',
            fontWeight: type.headlineWeight,
            fontFamily: fontStackFor(type.headlineFont),
            letterSpacing: `${type.headlineTrackingEm}em`,
            WebkitTextStroke: `${type.headlineStrokeEm}em currentColor`,
            lineHeight: type.headlineLineHeight,
            color: ink,
            margin: 0,
            textAlign: 'left',
            // Measured poster fit (set per frame on #hero-panel-top-left); the clamp is
            // only the pre-measure fallback.
            fontSize: 'var(--hero-headline-size, clamp(1.25rem, min(13vw, calc(var(--hero-gap-height) / 5)), 7.1rem))',
            textTransform: 'none',
          }}>
            {/* HERO_MAX_LINES fixed slots with index keys, rendered from the default
                copy and never re-rendered with new text: the intro effect owns the
                text (and which slots show) imperatively, so a Type panel edit
                rewrites a slot in place instead of replacing the node the intro
                timeline holds. The panel is visibility:hidden until the intro runs. */}
            {headlineSlots.map((line, i) => (
              // minHeight holds the line box while the intro types the text in
              // from empty, so the panel's centred position never recomputes.
              <span
                key={i}
                data-hero-headline-line
                style={{
                  display: i < DEFAULT_HERO_TYPE.headlineLines.length ? 'block' : 'none',
                  minHeight: `${type.headlineLineHeight}em`,
                  color: i === type.headlineLines.length - 1 ? accentInk : undefined,
                }}
              >
                {line}
              </span>
            ))}
          </h1>
          <p
            id="hero-subheadline"
            role="button"
            tabIndex={0}
            aria-label="Let's connect: enter your website or email"
            onClick={() => window.dispatchEvent(new Event(OPEN_ONBOARD_EVENT))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.dispatchEvent(new Event(OPEN_ONBOARD_EVENT)); }
            }}
            style={{
            position: 'relative',
            margin: 0,
            // The panel is pointer-events:none; the line itself takes hover and clicks.
            pointerEvents: 'auto',
            cursor: 'pointer',
            textAlign: 'left',
            // Defaults match the HELLO marquee (StackedSlidesSection) — the thin
            // Doto, without the headline's stroke.
            fontFamily: fontStackFor(type.subFont),
            fontSize: `calc(clamp(1.8rem, 5vw, 3.6rem) * ${type.subScale})`,
            letterSpacing: `${type.subTrackingEm}em`,
            lineHeight: 1.5,
            // Same ink as the header CLIENTS / LOGIN label (white in dark mode); the scramble glyphs use its pink.
            color: 'var(--t-text)',
            opacity: 1,
            fontWeight: type.subWeight,
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
              HUMAN IN THE LOOP
            </span>
            {/* Placed over the CTA's arrow cell by the swap (left is set per reveal), so it never shifts the text. */}
            <span
              ref={ctaArrowRef}
              id="hero-subheadline-cta-arrow"
              aria-hidden="true"
              style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', lineHeight: 0, opacity: 0, transition: 'opacity 160ms ease-out', pointerEvents: 'none' }}
            >
              <UpRightArrow size="0.8em" />
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
