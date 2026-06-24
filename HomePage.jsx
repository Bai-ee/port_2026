'use client';

import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import HeroHeadline from './HeroHeadline';
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

const SIMPLE_SCROLL_MEDIA_QUERY = '(max-width: 680px) and (pointer: coarse)';

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
  torusTubeRadius: 2,
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

  const [canvasBackground, setCanvasBackground] = useState('#ffffff');
  const [textColor, setTextColor] = useState('#000000');
  const [activePageId, setActivePageId] = useState(null);
  const headerLogoRef = useRef(null);
  const heroSectionRef = useRef(null);
  const canvasWrapperRef = useRef(null);
  const contentSectionRef = useRef(null);
  const paramsRef = useRef(HERO_PARAMS_START);
  const userParamsRef = useRef(HERO_PARAMS_START); // user's intentional settings (panel changes)
  const isScrollMorphActiveRef = useRef(false);
  const heroProgressRef = useRef(0); // current scroll progress, kept in sync with ScrollTrigger
  const snapCanvasRef = useRef(false); // signals canvas to reset smoothedParamsRef on next frame
  const scatterCanvasRef = useRef(false); // signals canvas to re-scatter particles (replay load-in formation)
  const heroMaxProgressRef = useRef(0); // deepest scroll reached this cycle — gates the return-to-top replay

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
    const useSimpleScrollViewport =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(SIMPLE_SCROLL_MEDIA_QUERY).matches;

    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    // Opacity-only intro — no transforms so ScrollTrigger pin positions are unaffected
    // canvasWrapperRef targets a stable div that is always in the DOM at mount time.
    // Querying 'canvas' directly fails when the dynamic @react-three/fiber component
    // hasn't mounted yet — the wrapper approach avoids that race.
    const headline     = document.querySelector('#hero-panel-top-left');
    const gradient     = document.querySelector('#hero-gradient-overlay');
    const canvasWrapper = canvasWrapperRef.current;
    const nav          = document.querySelector('#founders-top-strip');
    const panelHeadline = document.querySelector('#panel-hero-headline');
    const urlInputRow   = document.querySelector('#hero-url-input-row');
    const panelCta      = document.querySelector('#panel-hero-cta');
    const panelGrid     = document.querySelector('#stacked-grid-row');
    gsap.set([gradient, headline, canvasWrapper, nav].filter(Boolean), { autoAlpha: 0 });
    gsap.set([panelHeadline, urlInputRow, panelCta, panelGrid].filter(Boolean), { autoAlpha: 0 });

    const tl = gsap.timeline({ delay: 0.2 });
    tl.fromTo(
        gradient,
        { autoAlpha: 0, scale: 1.08 },
        { autoAlpha: 1, scale: 1, duration: 1.1, ease: 'power2.out' }
      )
      .to(canvasWrapper, { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, '<0.1')
      .to(nav,           { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, '<0.2')
      .to(headline,      { autoAlpha: 1, duration: 1.05, ease: 'power2.out' }, '0.32')
      .to(panelHeadline, { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '0.58')
      // URL input row + Meet CTA fade in together
      .to([urlInputRow, panelCta].filter(Boolean), { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '<0.15')
      .to(panelGrid,     { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '<0.15');

    // Replays the hero's entrance when the user returns to the top after scrolling
    // through it — fades the 3D element back onto the page. Opacity-only on the
    // canvas wrapper (transforms would shift ScrollTrigger pin positions); the
    // gradient may scale since it is a separate overlay.
    let entranceTween = null;
    const replayHeroEntrance = () => {
      if (entranceTween && entranceTween.isActive()) return;
      scatterCanvasRef.current = true; // re-scatter particles so they converge back into the loop
      entranceTween = gsap.timeline()
        .fromTo(gradient,      { autoAlpha: 0, scale: 1.06 }, { autoAlpha: 1, scale: 1, duration: 0.9, ease: 'power2.out' })
        .fromTo(canvasWrapper, { autoAlpha: 0 },              { autoAlpha: 1, duration: 1.0, ease: 'power2.out' }, '<0.1');
    };

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
        isScrollMorphActiveRef.current = true;
        heroProxy.progress = self.progress;
        heroProgressRef.current = self.progress;
        if (self.progress > heroMaxProgressRef.current) heroMaxProgressRef.current = self.progress;
        paramsRef.current = interpolateHeroParams(getScrollBase(userParamsRef.current), HERO_PARAMS_END, heroProxy.progress);
      },
      onLeaveBack: () => {
        heroProgressRef.current = 0;
        paramsRef.current = userParamsRef.current;
        snapCanvasRef.current = true; // flush smoothedParamsRef drift accumulated from repeated scroll cycles
        setParams(userParamsRef.current);
        // Only replay if the user actually scrolled through the hero (not a micro-scroll).
        if (heroMaxProgressRef.current > 0.5) replayHeroEntrance();
        heroMaxProgressRef.current = 0;
      },
      onToggle: (self) => {
        if (!self.isActive) {
          isScrollMorphActiveRef.current = false;
          setParams(paramsRef.current);
        }
      },
    });

    const syncHeroFromScroll = () => {
      requestAnimationFrame(() => {
        heroST.refresh();
        heroProxy.progress = heroST.progress;
        heroProgressRef.current = heroST.progress;
        paramsRef.current = interpolateHeroParams(getScrollBase(userParamsRef.current), HERO_PARAMS_END, heroProxy.progress);
        if (!isScrollMorphActiveRef.current) {
          setParams(userParamsRef.current);
        }
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
      entranceTween?.kill();
      heroST.kill();
      isScrollMorphActiveRef.current = false;
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
          <AppCanvas params={params} liveParamsRef={paramsRef} backgroundColor={canvasBackground} snapRef={snapCanvasRef} scatterRef={scatterCanvasRef} />
        </div>
        <HeroHeadline headerLogoRef={headerLogoRef} textColor={textColor} />
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
          AI design engineering and client intelligence platforms by Bryan Balli, Chicago
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
