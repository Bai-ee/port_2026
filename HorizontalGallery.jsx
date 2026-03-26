import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createSharedParticleGalleryRenderer } from './sharedParticleGalleryRenderer';

gsap.registerPlugin(ScrollTrigger);

const galleryItems = [
  { title: 'Signal', year: '2024' },
  { title: 'Surface', year: '2023' },
  { title: 'Vector', year: '2023' },
  { title: 'Lattice', year: '2022' },
  { title: 'Pulse', year: '2022' },
  { title: 'Frame', year: '2021' },
  { title: 'Orbit', year: '2021' },
  { title: 'Field', year: '2020' },
];

const galleryParticleParams = {
  scale: 24,
  particleCount: 1400,
  particleSize: 0.22,
  speedMult: 0.16,
  hueSpeed: 0.035,
  waveAmplitude: 1.3,
  saturation: 0.82,
  lightness: 0.7,
};

const HorizontalGallery = () => {
  const sectionRef = useRef(null);
  const stageRef = useRef(null);
  const trackRef = useRef(null);
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);

  useLayoutEffect(() => {
    if (!sectionRef.current || !stageRef.current || !trackRef.current || !viewportRef.current || !canvasRef.current) {
      return;
    }

    const section = sectionRef.current;
    const stage = stageRef.current;
    const track = trackRef.current;
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;

    const ctx = gsap.context(() => {}, section);
    const media = gsap.matchMedia();

    const createGalleryScrollTrigger = (isMobile) => {
      const getDistance = () => Math.max(0, track.scrollWidth - window.innerWidth);
      const getTravelDistance = () => {
        const baseDistance = Math.max(getDistance(), window.innerWidth * (isMobile ? 0.65 : 0.85));
        return Math.max(window.innerHeight * 0.8, baseDistance);
      };

      gsap.set(track, { x: 0 });

      const moveTween = gsap.to(track, {
        x: () => -getDistance(),
        ease: 'power2.out',
        duration: 1,
        paused: true,
      });

      const scrollTrigger = ScrollTrigger.create({
        trigger: stage,
        pin: true,
        start: () => `top-=${window.innerHeight * 0.28} top`,
        end: (self) => self.start + getTravelDistance(),
        scrub: isMobile ? 3.5 : 4.2,
        invalidateOnRefresh: true,
        anticipatePin: 1.2,
        refreshPriority: 1,
        onRefresh: () => {
          gsap.set(track, { x: 0 });
          moveTween.progress(0);
        },
        onUpdate: (self) => {
          const moveProgress = (self.scroll() - self.start) / getTravelDistance();
          const eased = gsap.utils.clamp(0, 1, moveProgress);
          moveTween.progress(eased);
        },
      });

      return () => {
        scrollTrigger.kill();
        moveTween.kill();
        gsap.set(track, { x: 0 });
      };
    };

    media.add('(max-width: 767px)', () => createGalleryScrollTrigger(true));
    media.add('(min-width: 768px)', () => createGalleryScrollTrigger(false));

    const particleRenderer = createSharedParticleGalleryRenderer({
      canvas,
      container: viewport,
      getWindows: () => Array.from(track.querySelectorAll('[data-particle-window]')),
      params: galleryParticleParams,
    });

    const refresh = () => ScrollTrigger.refresh();
    let frameId = 0;
    let isLoopActive = false;
    let isVisible = false;

    const renderFrame = (time) => {
      if (!isLoopActive) {
        return;
      }

      particleRenderer.render(time * 0.001);
      frameId = window.requestAnimationFrame(renderFrame);
    };

    const stopRenderLoop = () => {
      isLoopActive = false;

      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };

    const startRenderLoop = () => {
      if (isLoopActive || !isVisible || document.hidden) {
        return;
      }

      isLoopActive = true;
      frameId = window.requestAnimationFrame(renderFrame);
    };

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;

        if (isVisible) {
          startRenderLoop();
          return;
        }

        stopRenderLoop();
      },
      {
        root: null,
        threshold: 0,
        rootMargin: '200px 0px',
      }
    );

    const handleDocumentVisibility = () => {
      if (document.hidden) {
        stopRenderLoop();
        return;
      }

      startRenderLoop();
    };

    requestAnimationFrame(refresh);
    window.addEventListener('resize', refresh);
    document.addEventListener('visibilitychange', handleDocumentVisibility);
    visibilityObserver.observe(stage);

    return () => {
      stopRenderLoop();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', handleDocumentVisibility);
      window.removeEventListener('resize', refresh);
      particleRenderer.dispose();
      media.revert();
      ctx.revert();
    };
  }, []);

  return (
    <div ref={sectionRef} style={sectionStyle}>
      <div style={topSpacerStyle} />

      <section ref={stageRef} style={stageStyle}>
        <div ref={viewportRef} style={viewportStyle}>
          <canvas ref={canvasRef} style={canvasStyle} />
          <div ref={trackRef} style={trackStyle}>
            {galleryItems.map((item) => (
              <figure key={item.title} style={cardStyle}>
                <div
                  data-particle-window
                  data-radius="28"
                  aria-hidden="true"
                  style={imageFrameStyle}
                >
                  <div style={imageGlowStyle} />
                  <div style={imageEdgeStyle} />
                </div>
                <figcaption style={captionStyle}>
                  <span style={titleStyle}>{item.title}</span>
                  <span style={yearStyle}>{item.year}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

const sectionStyle = {
  position: 'relative',
  width: '100%',
  marginTop: 'clamp(-12rem, -16vw, -6rem)',
  zIndex: 9,
  paddingTop: 'clamp(18rem, 30vw, 28rem)',
  paddingBottom: 'clamp(0rem, 100vw - 768px, 18rem)',
};

const topSpacerStyle = {
  height: '0',
};

const stageStyle = {
  position: 'relative',
  height: 'clamp(28rem, 42vw, 36rem)',
};

const viewportStyle = {
  position: 'relative',
  height: 'clamp(28rem, 42vw, 36rem)',
  display: 'flex',
  alignItems: 'center',
  overflowX: 'hidden',
  overflowY: 'visible',
};

const canvasStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: 2,
  filter: 'brightness(1.18) contrast(1.12) saturate(1.1)',
};

const trackStyle = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  flexWrap: 'nowrap',
  gap: 'clamp(1rem, 2vw, 2rem)',
  padding: '0 8vw',
  width: 'max-content',
  willChange: 'transform',
};

const cardStyle = {
  flex: '0 0 clamp(18rem, 28vw, 26rem)',
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
  position: 'relative',
};

const imageFrameStyle = {
  position: 'relative',
  width: '100%',
  aspectRatio: '4 / 5',
  borderRadius: '1.75rem',
  overflow: 'hidden',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.38)',
  background: '#000000',
};

const imageGlowStyle = {
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  background:
    'linear-gradient(165deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.015) 34%, rgba(0, 0, 0, 0.18) 100%)',
  mixBlendMode: 'screen',
  opacity: 0.32,
  pointerEvents: 'none',
};

const imageEdgeStyle = {
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  boxShadow: 'inset 0 0 0 1px rgba(245, 241, 223, 0.12), inset 0 -32px 64px rgba(0, 0, 0, 0.25)',
  pointerEvents: 'none',
};

const captionStyle = {
  position: 'relative',
  zIndex: 3,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '1rem',
  color: '#f5f1df',
  padding: '0 0.15rem',
};

const titleStyle = {
  fontSize: 'clamp(1rem, 1.6vw, 1.45rem)',
  fontWeight: 700,
  letterSpacing: '-0.03em',
};

const yearStyle = {
  fontSize: '0.78rem',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'rgba(245, 241, 223, 0.66)',
};

export default HorizontalGallery;
