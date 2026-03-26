import React, { useState, useRef, useLayoutEffect } from 'react';
import gsap from 'gsap';
import App from './ox.jsx';
import HeroHeadline from './HeroHeadline';
import Header from './Header';
import HorizontalTextSection from './HorizontalTextSection';
import HorizontalGallery from './HorizontalGallery';
import HoverRevealList from './HoverRevealList';
import StackedSlidesSection from './StackedSlidesSection';
import FontSelector from './FontSelector';
import LoopControls from './LoopControls';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

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
    opacity: 1,
  });

  const [canvasBackground, setCanvasBackground] = useState('#cac2a5');
  const [textColor, setTextColor] = useState('#000000');
  const headerLogoRef = useRef(null);
  const heroSectionRef = useRef(null);
  const contentSectionRef = useRef(null);

  useLayoutEffect(() => {
    window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    // Refresh ScrollTrigger after a delay to ensure DOM is ready
    const timer = setTimeout(() => {
      ScrollTrigger.refresh();
    }, 100);

    return () => clearTimeout(timer);
  }, []);


  return (
    <div style={{ position: 'relative', width: '100vw', minHeight: '100vh', background: 'transparent', overflowX: 'hidden' }}>
      <FontSelector />
      <LoopControls params={params} onParamsChange={setParams} backgroundColor={canvasBackground} onBackgroundChange={setCanvasBackground} textColor={textColor} onTextColorChange={setTextColor} />
      {/* Hero Section */}
      <section
        ref={heroSectionRef}
        id="hero-section"
        style={{
          position: 'relative',
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          background: 'transparent',
        }}
      >
        <App params={params} backgroundColor={canvasBackground} />
        <HeroHeadline headerLogoRef={headerLogoRef} textColor={textColor} />
      </section>

      {/* Header/Nav */}
      <Header logoRef={headerLogoRef} />

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
        <HorizontalGallery />
        <HoverRevealList />
        <HorizontalTextSection />
      </section>
    </div>
  );
};

export default HomePage;
