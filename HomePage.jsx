import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import App from './ox.jsx';
import HeroHeadline from './HeroHeadline';
import Header from './Header';
import HorizontalTextSection from './HorizontalTextSection';
import HorizontalGallery from './HorizontalGallery';
import HoverRevealList from './HoverRevealList';
import StackedSlidesSection from './StackedSlidesSection';
// import FontSelector from './FontSelector';
// import LoopControls from './LoopControls';
import PortfolioModal from './PortfolioModal';

const MOBILE_SCROLL_MEDIA_QUERY = '(max-width: 767px), (pointer: coarse)';

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
  saturation: 0.8,
  lightness: 0.55,
  torusMajorRadius: 0.7,
  torusTubeRadius: 2,
  animationSpeed: 3.4,
  opacity: 0.1,
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

const HomePage = () => {
  const [params, setParams] = useState(HERO_PARAMS_START);

  const [canvasBackground, setCanvasBackground] = useState('#ffffff');
  const [textColor, setTextColor] = useState('#000000');
  const [activePageId, setActivePageId] = useState(null);
  const headerLogoRef = useRef(null);
  const heroSectionRef = useRef(null);
  const contentSectionRef = useRef(null);
  const paramsRef = useRef(HERO_PARAMS_START);
  const isScrollMorphActiveRef = useRef(false);

  useEffect(() => {
    if (isScrollMorphActiveRef.current) {
      return;
    }

    paramsRef.current = params;
  }, [params]);

  useLayoutEffect(() => {
    const isTouchScrollDevice =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(MOBILE_SCROLL_MEDIA_QUERY).matches;

    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    // Opacity-only intro — no transforms so ScrollTrigger pin positions are unaffected
    const headline = document.querySelector('#hero-panel-top-left');
    const canvas = heroSectionRef.current?.querySelector('canvas');
    const nav = document.querySelector('#site-nav');
    const contentSection = contentSectionRef.current;

    const panelHeadline  = document.querySelector('#panel-hero-headline');
    const panelCta       = document.querySelector('#panel-hero-cta');
    const panelGrid      = document.querySelector('#stacked-grid-row');
    const pills          = gsap.utils.toArray('#hero-panel-filter-pills .filter-chip');

    gsap.set([headline, canvas, nav], { autoAlpha: 0 });
    gsap.set([panelHeadline, panelCta, panelGrid], { autoAlpha: 0 });
    gsap.set(pills, { autoAlpha: 0, y: 8 });

    const tl = gsap.timeline({ delay: 0.2 });
    tl.to(headline,      { autoAlpha: 1, duration: 1.2, ease: 'power2.out' })
      .to(canvas,        { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, '<0.25')
      .to(nav,           { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, '<0.25')
      .to(panelHeadline, { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '0.5')
      .to(panelCta,      { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '<0.15')
      .to(panelGrid,     { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '<0.15')
      .to(pills,         { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out', stagger: 0.055 }, '<0.2');

    // Smooth the initial hero-to-content handoff without hijacking native scroll.
    // The content section eases upward while the fixed hero layer subtly lifts/fades,
    // so the first interaction feels like one continuous page movement.
    if (contentSection) {
      const initialContentLift = isTouchScrollDevice ? 46 : 64;
      const heroTravel = isTouchScrollDevice ? -30 : -42;

      gsap.set(contentSection, { y: initialContentLift, force3D: true, willChange: 'transform' });
      gsap.set([headline, canvas, nav], { force3D: true, willChange: 'transform, opacity' });

      gsap.timeline({
        scrollTrigger: {
          trigger: '#hero-section',
          start: 'top top',
          end: isTouchScrollDevice ? '35% top' : '42% top',
          scrub: isTouchScrollDevice ? 0.55 : 0.75,
          invalidateOnRefresh: true,
        },
      })
        .to(contentSection, { y: 0, ease: 'none' }, 0)
        .to(
          [headline, canvas, nav],
          {
            y: heroTravel,
            opacity: (_index, target) => (target === nav ? 0.92 : 0.72),
            ease: 'none',
          },
          0
        );
    }

    // Scrub hero params directly from scroll progress to keep the transition
    // tied to the gesture instead of firing a one-shot time tween.
    const heroProxy = { progress: 0 };

    const heroST = ScrollTrigger.create({
      trigger: '#hero-section',
      start: 'top top',
      end: 'bottom top',
      scrub: isTouchScrollDevice ? true : 0.45,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        isScrollMorphActiveRef.current = true;
        heroProxy.progress = self.progress;
        paramsRef.current = interpolateHeroParams(HERO_PARAMS_START, HERO_PARAMS_END, heroProxy.progress);
      },
      onLeaveBack: () => {
        paramsRef.current = HERO_PARAMS_START;
      },
      onScrubComplete: () => {
        isScrollMorphActiveRef.current = false;
        setParams(paramsRef.current);
      },
    });

    return () => {
      tl.kill();
      heroST.kill();
      isScrollMorphActiveRef.current = false;
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', minHeight: '100dvh', background: 'transparent', overflowX: 'hidden' }}>
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
        <App params={params} liveParamsRef={paramsRef} backgroundColor={canvasBackground} />
        <HeroHeadline headerLogoRef={headerLogoRef} textColor={textColor} />
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
          zIndex: 10,
          background: 'transparent',
          marginTop: 'clamp(-24rem, calc(-13rem - 3vw - 8vh), -18rem)',
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
