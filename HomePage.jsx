'use client';

import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
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
  const isScrollMorphActiveRef = useRef(false);

  // Keep #content-section.marginTop = -peekHeight so the capabilitySectionStyle
  // borderTop always lands exactly at the 100dvh fold on page load.
  useLayoutEffect(() => {
    const contentSection = contentSectionRef.current;
    if (!contentSection) return;

    const applyPeek = () => {
      const introBlock = document.querySelector('#panel-hero-intro-centering');
      if (!introBlock) return;
      const peekHeight = introBlock.getBoundingClientRect().height;
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

  useEffect(() => {
    if (isScrollMorphActiveRef.current) {
      return;
    }

    paramsRef.current = params;
  }, [params]);

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
    const panelCta      = document.querySelector('#panel-hero-cta');
    const panelGrid     = document.querySelector('#stacked-grid-row');
    const pills         = gsap.utils.toArray('#hero-panel-filter-pills .filter-chip');

    gsap.set([gradient, headline, canvasWrapper, nav].filter(Boolean), { autoAlpha: 0 });
    gsap.set([panelHeadline, panelCta, panelGrid].filter(Boolean), { autoAlpha: 0 });
    if (pills.length) gsap.set(pills, { autoAlpha: 0, y: 8 });

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
      .to(panelCta,      { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '<0.15')
      .to(panelGrid,     { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '<0.15')
      .to(pills,         { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out', stagger: 0.055 }, '<0.2');

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
        paramsRef.current = interpolateHeroParams(HERO_PARAMS_START, HERO_PARAMS_END, heroProxy.progress);
      },
      onLeaveBack: () => {
        paramsRef.current = HERO_PARAMS_START;
        setParams(HERO_PARAMS_START);
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
        paramsRef.current = interpolateHeroParams(HERO_PARAMS_START, HERO_PARAMS_END, heroProxy.progress);
        if (!isScrollMorphActiveRef.current) {
          setParams(paramsRef.current);
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
      heroST.kill();
      isScrollMorphActiveRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('load', handleLoad);
    };
  }, []);

  return (
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
        #panel-hero-cta,
        #hero-panel-filter-pills .filter-chip {
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
          <AppCanvas params={params} liveParamsRef={paramsRef} backgroundColor={canvasBackground} />
        </div>
        <HeroHeadline headerLogoRef={headerLogoRef} textColor={textColor} />
        {/* Keyword-rich subheading for crawlers — visually hidden but read by
            search engines and assistive tech as the first H2 under the brand H1. */}
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
          Bryan Balli is an AI design engineer and creative technologist based in Chicago. He builds AI-assisted client intelligence platforms, modular intake pipelines, and high-performance web experiences for founders, agencies, and growing teams — combining Next.js, Three.js, and GSAP with the Claude API and OpenAI to ship production-quality work with intelligent automation built in. Agency background spans Publicis, Epsilon, Conversant, and Alliance Data. Clients include TikTok, HBO Max, and TST. Starting engagement scope: $3,500. Typical project timeline: 2–6 weeks.
        </h2>
      </section>

      {/* Header/Nav */}
      <Header logoRef={headerLogoRef} onOpenPage={setActivePageId} />

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
  );
};

export default HomePage;
