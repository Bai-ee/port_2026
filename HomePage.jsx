import React, { useState, useRef, useLayoutEffect } from 'react';
import gsap from 'gsap';
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

const HomePage = () => {
  const [params, setParams] = useState({
    scale: 190,
    chaos: 1.55,
    flow: 0,
    particleCount: 25000,
    particleSize: 1,
    speedMult: 0.43,
    bloomThreshold: 1,
    bloomStrength: 0,
    bloomRadius: 1,
    hueOffset: 0.5,
    hueSpeed: 0.02,
    waveAmplitude: 0.5,
    saturation: 0.8,
    lightness: 0.55,
    torusMajorRadius: 0.7,
    torusTubeRadius: 2,
    torusSegments: 100,
    torusSegmentsDepth: 50,
    rotationX: -2.14159265358979,
    rotationY: -2.14159265358979,
    rotationZ: -3.14159265358979,
    tireSpinAxis: 'z',
    tireSpinSpeed: 0,
    animationSpeed: 3.4,
    opacity: 0.1,
  });

  const [canvasBackground, setCanvasBackground] = useState('#ffffff');
  const [textColor, setTextColor] = useState('#000000');
  const [activePageId, setActivePageId] = useState(null);
  const headerLogoRef = useRef(null);
  const heroSectionRef = useRef(null);
  const contentSectionRef = useRef(null);

  useLayoutEffect(() => {
    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    // Opacity-only intro — no transforms so ScrollTrigger pin positions are unaffected
    const headline = document.querySelector('#hero-panel-top-left');
    const canvas = heroSectionRef.current?.querySelector('canvas');
    const nav = document.querySelector('#site-nav');

    const panelHeadline  = document.querySelector('#panel-hero-headline');
    const panelCta       = document.querySelector('#panel-hero-cta');
    const panelGrid      = document.querySelector('#stacked-grid-row');
    const serviceItems   = gsap.utils.toArray('[data-service-item]');

    gsap.set([headline, canvas, nav], { autoAlpha: 0 });
    gsap.set([panelHeadline, panelCta, panelGrid, ...serviceItems], { autoAlpha: 0 });

    const tl = gsap.timeline({ delay: 0.2 });
    tl.to(headline,      { autoAlpha: 1, duration: 1.2, ease: 'power2.out' })
      .to(canvas,        { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, '<0.25')
      .to(nav,           { autoAlpha: 1, duration: 1.2, ease: 'power2.out' }, '<0.25')
      .to(panelHeadline, { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '0.5')
      .to(panelCta,      { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, '<0.15')
      .to(serviceItems,  { autoAlpha: 1, duration: 0.5, ease: 'power2.out', stagger: 0.1 }, '<0.15')
      .to(panelGrid,     { autoAlpha: 1, duration: 0.6, ease: 'power2.out', stagger: 0.06 }, '<0.15');

    return () => {
      tl.kill();
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
        <App params={params} backgroundColor={canvasBackground} />
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
