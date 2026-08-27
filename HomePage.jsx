'use client';

import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import HeroHeadline from './HeroHeadline';
import HeroSchematicOverlay from './components/home/HeroSchematicOverlay';
import { createHeroCursorStage } from './components/home/heroCursorStage';
import Header from './Header';
import HorizontalTextSection from './HorizontalTextSection';
import HorizontalGallery from './HorizontalGallery';
import HoverRevealList from './HoverRevealList';
import StackedSlidesSection from './StackedSlidesSection';
// import FontSelector from './FontSelector';
// import LoopControls from './LoopControls';
import PortfolioModal from './PortfolioModal';
import HomepageAnalytics from './components/HomepageAnalytics';

const AppCanvas = dynamic(() => import('./ox.jsx'), { ssr: false });

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
};

// Original params — hero transitions into this as it scrolls out
const HERO_PARAMS_END = {
  scale: 190,
  chaos: 1.55,
  flow: 0,
  particleSize: 1,
  speedMult: 0.43,
  bloomThreshold: 1,
  hueOffset: 0.5,
  waveAmplitude: 0.5,
  saturation: 1,
  lightness: 0.55,
  torusMajorRadius: 0.7,
  // ⚠️ Must stay well below 2: the particle projection in ox.jsx divides by
  // (2 - torusTubeRadius·sin(v)). At 2 the denominator crosses 0 — particle
  // positions blow up toward infinity and scroll-linked scale becomes wildly
  // unstable (the "tube jumps from small to huge on fast scroll-up" bug).
  // 1.6 keeps the expanded chaotic-cloud look with bounded (~2.5×) amplification.
  torusTubeRadius: 1.6,
  animationSpeed: 3.4,
  opacity: 0.18,
};

// Builds the scroll animation start from user params:
// - Params that exist in HERO_PARAMS_END always start from HERO_PARAMS_START so the
//   scroll animation runs the same consistent range regardless of user settings
//   (prevents reversed-direction or oversized swings when user values are outside the range).
// - Params NOT in HERO_PARAMS_END (rotationX/Y/Z etc.) use the user's value so the
//   shape stays at whatever orientation the user set throughout the scroll.
const getScrollBase = (userParams) => {
  const base = { ...HERO_PARAMS_START };
  Object.keys(userParams).forEach((k) => {
    if (!(k in HERO_PARAMS_END)) base[k] = userParams[k];
  });
  return base;
};

const interpolateHeroParams = (start, end, progress) => {
  const next = { ...start };

  Object.keys(end).forEach((key) => {
    const startValue = start[key];
    const endValue = end[key];

    if (typeof startValue === 'number' && typeof endValue === 'number') {
      next[key] = startValue + (endValue - startValue) * progress;
      return;
    }

    next[key] = progress < 0.5 ? startValue : endValue;
  });

  return next;
};

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
  animation: 'heroGradientDrift 18s ease-in-out infinite alternate',
};

const HomePage = () => {
  const [params, setParams] = useState(HERO_PARAMS_START);

  // UI Teaser clean mode (?teaser=1): strips all copy/nav for promo video capture —
  // section backgrounds, the threejs canvas, and the header logo are all that remain.
  // visibility (not display) so layout heights and ScrollTrigger geometry are untouched.
  // Consumed by scripts/render-ui-teaser.mjs via the ui-teaser dashboard card.
  const [teaserCleanMode, setTeaserCleanMode] = useState(false);

  const [canvasBackground, setCanvasBackground] = useState('#ffffff');
  const [textColor, setTextColor] = useState('#000000');
  const [activePageId, setActivePageId] = useState(null);
  const headerLogoRef = useRef(null);
  const heroSectionRef = useRef(null);
  const canvasWrapperRef = useRef(null);
  const contentSectionRef = useRef(null);
  const paramsRef = useRef(HERO_PARAMS_START);
  const userParamsRef = useRef(HERO_PARAMS_START); // user's intentional settings (panel changes)
  const heroProgressRef = useRef(0); // current scroll progress, kept in sync with ScrollTrigger
  // Cursor-driven hero readout: ox.jsx writes the loop's screen-space outline
  // anchors into silhouetteRef, HeroHeadline writes the churn/reveal clock into
  // cursorStageRef, and HeroSchematicOverlay draws the lines between them. Refs,
  // not state — all three run per-frame and must never re-render this page.
  const silhouetteRef = useRef(null);
  const cursorStageRef = useRef(createHeroCursorStage());

  // Pre-paint so the copy never flashes into the recorded video.
  useLayoutEffect(() => {
    if (new URLSearchParams(window.location.search).has('teaser')) setTeaserCleanMode(true);
  }, []);

  // Keep #content-section.marginTop = -peekHeight so the capabilitySectionStyle
  // borderTop always lands exactly at the 100dvh fold on page load.
  useLayoutEffect(() => {
    const contentSection = contentSectionRef.current;
    if (!contentSection) return;

    const applyPeek = () => {
      const introBlock = document.querySelector('#panel-hero-intro-centering');
      if (!introBlock) return;
      const style = window.getComputedStyle(introBlock);
      const marginTop = parseFloat(style.marginTop) || 0;
      const marginBottom = parseFloat(style.marginBottom) || 0;
      const peekHeight = introBlock.getBoundingClientRect().height + marginTop + marginBottom;
      contentSection.style.marginTop = `-${peekHeight}px`;
    };

    applyPeek();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(applyPeek) : null;
    const introBlock = document.querySelector('#panel-hero-intro-centering');
    if (introBlock) ro?.observe(introBlock);
    window.addEventListener('resize', applyPeek);
    window.addEventListener('orientationchange', applyPeek);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', applyPeek);
      window.removeEventListener('orientationchange', applyPeek);
    };
  }, []);

  useLayoutEffect(() => {
    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    // Opacity-only intro — no transforms so ScrollTrigger pin positions are unaffected
    // canvasWrapperRef targets a stable div that is always in the DOM at mount time.
    // Querying 'canvas' directly fails when the dynamic @react-three/fiber component
    // hasn't mounted yet — the wrapper approach avoids that race.
    // #hero-panel-top-left is intentionally absent here — HeroHeadline owns its
    // reveal so the panel fade and the headline scramble share one clock, and
    // so the scrambling headline leads this timeline's 0.2s delay on screen.
    const gradient     = document.querySelector('#hero-gradient-overlay');
    const canvasWrapper = canvasWrapperRef.current;
    const nav          = document.querySelector('#founders-top-strip');
    const panelHeadline = document.querySelector('#panel-hero-headline');
    const urlInputRow   = document.querySelector('#hero-url-input-row');
    const panelCta      = document.querySelector('#panel-hero-cta');
    const panelGrid     = document.querySelector('#stacked-grid-row');
    // Desktop (≥900px) hides #panel-hero-cta until the hero pin reveals it.
    const isDesktopCtaExperiment =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(min-width: 900px)').matches;
    // The bottom peek's background band is this panel, not its children — gating
    // only the children left the band on screen from first paint, ahead of the
    // nav. Fade the panel itself rather than #content-section: the blur is a
    // backdrop-filter, and an ancestor at opacity < 1 isolates the backdrop root,
    // which kills the blur until opacity hits exactly 1 and then snaps it on.
    const peekPanel = document.querySelector('#stack-peek-panel');
    gsap.set([gradient, canvasWrapper, nav, peekPanel].filter(Boolean), { autoAlpha: 0 });
    gsap.set([panelHeadline, urlInputRow, panelCta, panelGrid].filter(Boolean), { autoAlpha: 0 });

    const tl = gsap.timeline({ delay: 0.2 });
    tl.fromTo(
        gradient,
        { autoAlpha: 0, scale: 1.08 },
        { autoAlpha: 1, scale: 1, duration: 1.1, ease: 'power2.out' }
      )
      .to(canvasWrapper, { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, '<0.1')
      // The nav and the bottom peek's website-url pill come in together, so both
      // are anchored to this label rather than to each other's positions.
      .addLabel('navReveal', '<0.2')
      .to(nav,           { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, 'navReveal')
      .to([peekPanel].filter(Boolean), { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, 'navReveal')
      .to(panelHeadline, { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '0.58')
      // URL input row fades in; panelCta ("Book a Call with Bryan") is
      // excluded — it's hidden by default at every width (see
      // #panel-hero-cta's CSS rule) and only appears via the scroll-triggered
      // pin in this file's other useLayoutEffect. Forcing it visible here
      // would pop it on load, overlapping the now-100%-width url input row.
      .to([urlInputRow].filter(Boolean), { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, 'navReveal')
      // Absolute, not '<0.15' — that relative position tracked the url row, which
      // no longer sits just before it.
      .to(panelGrid,     { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '0.88');

    // Scrub hero params directly from scroll progress to keep the transition
    // tied to the gesture instead of firing a one-shot time tween.
    const heroProxy = { progress: 0 };

    const heroST = ScrollTrigger.create({
      trigger: '#hero-section',
      start: 'top top',
      end: 'bottom top',
      scrub: true,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        heroProxy.progress = self.progress;
        heroProgressRef.current = self.progress;
        paramsRef.current = interpolateHeroParams(getScrollBase(userParamsRef.current), HERO_PARAMS_END, heroProxy.progress);
      },
      // Back above the hero start: point the live target at the user's params and
      // let the canvas's per-frame exponential smoothing carry the morph home.
      // Deliberately NO snap/setParams/replay here — a React params change resets
      // smoothedParamsRef inside ox.jsx (instant pop), and the old scatter+fade
      // "re-entrance replay" masked the pop with worse UX instead of fixing it.
      onLeaveBack: () => {
        heroProgressRef.current = 0;
        paramsRef.current = userParamsRef.current;
      },
    });

    // Re-sync the live param target after tab/window returns. Target-only on
    // purpose: no setParams here — a React params change resets smoothedParamsRef
    // in ox.jsx, flashing the tube whenever the window regains focus mid-page.
    const syncHeroFromScroll = () => {
      requestAnimationFrame(() => {
        heroST.refresh();
        heroProxy.progress = heroST.progress;
        heroProgressRef.current = heroST.progress;
        paramsRef.current = interpolateHeroParams(getScrollBase(userParamsRef.current), HERO_PARAMS_END, heroProxy.progress);
      });
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        syncHeroFromScroll();
      }
    };

    const handlePageShow = () => {
      syncHeroFromScroll();
    };

    const handleFocus = () => {
      syncHeroFromScroll();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);

    // Refresh all ScrollTriggers once the full page (images, fonts, etc.) has loaded.
    // Deferred by two rAFs so it doesn't fight the intro timeline.
    const handleLoad = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => ScrollTrigger.refresh());
      });
    };

    if (document.readyState === 'complete') {
      handleLoad();
    } else {
      window.addEventListener('load', handleLoad);
    }

    return () => {
      tl.kill();
      heroST.kill();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('load', handleLoad);
    };
  }, []);

  return (
    <>
    <HomepageAnalytics />
    {/* Header outside overflow-clip container so backdrop-filter composites against the viewport correctly */}
    <Header logoRef={headerLogoRef} onOpenPage={setActivePageId} logoSrc="/img/circle_logo.png" />
    <div style={{ position: 'relative', width: '100vw', minHeight: '100dvh', background: 'transparent', overflowX: 'clip' }}>
      <style>{`
        @keyframes heroGradientDrift {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          100% {
            transform: translate3d(1.5%, -1.2%, 0) scale(1.04);
          }
        }
        /* Hide intro-animated elements before GSAP initializes to prevent FOUC */
        #hero-canvas-wrapper,
        #founders-top-strip,
        #hero-panel-top-left,
        #panel-hero-headline,
        #hero-url-input-row,
        #panel-hero-cta {
          opacity: 0;
          visibility: hidden;
        }
      `}</style>
      {teaserCleanMode && (
        <style id="ui-teaser-clean-style">{`
          /* UI Teaser clean mode: copy + nav vanish, section backgrounds +
             threejs canvas + header logo remain. !important beats GSAP's
             inline autoAlpha so intro tweens can't fade the copy back in. */
          /* #panel-hero-cta listed on its own: the pin behavior reparents it to
             document.body, where the panel-children selector can't reach it. */
          #hero-panel-top-left,
          #founders-top-actions,
          #panel-hero-cta,
          #content-section [data-stack-panel] > *,
          #section-break-spacer > * {
            visibility: hidden !important;
            pointer-events: none !important;
          }
          /* Pin the logo hard-left: the strip's default gutter is
             max(10vw, centered-810px) which floats the brand ~29% in at 1920. */
          #founders-top-strip-inner {
            padding: 0 24px !important;
          }
        `}</style>
      )}
      {/* <FontSelector /> */}
      {/* <LoopControls params={params} onParamsChange={setParams} backgroundColor={canvasBackground} onBackgroundChange={setCanvasBackground} textColor={textColor} onTextColorChange={setTextColor} /> */}
      {/* Hero Section */}
      <section
        ref={heroSectionRef}
        id="hero-section"
        style={{
          position: 'relative',
          width: '100vw',
          height: '100dvh',
          overflow: 'hidden',
          background: 'transparent',
        }}
      >
        <div id="hero-gradient-overlay" style={heroGradientStyle} />
        <div id="hero-canvas-wrapper" ref={canvasWrapperRef} style={{ position: 'absolute', inset: 0, opacity: 0 }}>
          <AppCanvas params={params} liveParamsRef={paramsRef} backgroundColor={canvasBackground} silhouetteRef={silhouetteRef} />
        </div>
        <HeroSchematicOverlay
          silhouetteRef={silhouetteRef}
          cursorStageRef={cursorStageRef}
          heroProgressRef={heroProgressRef}
          color={textColor}
        />
        <HeroHeadline headerLogoRef={headerLogoRef} textColor={textColor} cursorStageRef={cursorStageRef} />
        {/* Section heading for screen readers and crawlers. Kept concise and
            honest (no keyword stuffing). Full credentials live in JSON-LD
            Person/Organization schema on this route. */}
        <h2
          style={{
            position: 'absolute',
            left: '-10000px',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            clipPath: 'inset(50%)',
            whiteSpace: 'nowrap',
            border: 0,
            padding: 0,
            margin: 0,
          }}
        >
          Design, websites, content systems, and AI workflows by Bryan Balli. For founders and small teams who need senior creative execution without hiring a full agency or another full-time role.
        </h2>
      </section>

      {/* Content Section */}
      <section
        ref={contentSectionRef}
        id="content-section"
        style={{
          position: 'relative',
          width: '100%',
          zIndex: 110,
          background: 'transparent',
          marginTop: 0,
          borderRadius: '1.5rem 1.5rem 0 0',
        }}
      >
        <StackedSlidesSection />
        {/* <HorizontalGallery /> */}
        {/* <HoverRevealList /> */}
        {/* <HorizontalTextSection /> */}
      </section>
      <PortfolioModal activePageId={activePageId} onClose={() => setActivePageId(null)} onOpenPage={setActivePageId} />
    </div>
    </>
  );
};

export default HomePage;
