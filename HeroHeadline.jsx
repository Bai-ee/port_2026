import React, { useLayoutEffect, useRef } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import gsap from 'gsap';

gsap.registerPlugin(ScrollTrigger);

const SIMPLE_SCROLL_MEDIA_QUERY = '(max-width: 680px) and (pointer: coarse)';

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

const HeroHeadline = ({ headerLogoRef, textColor = '#2a2420' }) => {
  const topLeftRef = useRef(null);
  const headlineContentRef = useRef(null);

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
      const nav = document.querySelector('#site-nav');
      const contentAnchor =
        document.querySelector('#panel-hero-text-row') ??
        document.querySelector('#content-section');

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

      el.style.position = useSimpleScrollViewport ? 'absolute' : 'fixed';
      el.style.top = `${metrics.centeredTop}px`;
      el.style.maxWidth = `${metrics.maxWidth}px`;
      el.style.setProperty('--hero-gap-height', `${metrics.gapHeight}px`);

      if (useSimpleScrollViewport) {
        contentEl.style.transform = `translate3d(0, ${travelY * progress}px, 0)`;
        contentEl.style.opacity = `${1 - progress}`;
        contentEl.style.filter = 'blur(0px)';
      } else {
        contentEl.style.transform = `translate3d(0, ${travelY * progress}px, 0)`;
        contentEl.style.opacity = `${1 - progress}`;
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

    gsap.set(el, { autoAlpha: 1 });
    gsap.set(contentEl, { autoAlpha: 1, y: 0, filter: 'blur(0px)' });

    trigger = ScrollTrigger.create({
      trigger: '#hero-section',
      start: 'top top',
      end: useSimpleScrollViewport ? '35% top' : 'center top',
      scrub: useSimpleScrollViewport ? 0.18 : 0.2,
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

    const nav = document.querySelector('#site-nav');
    const contentAnchor =
      document.querySelector('#panel-hero-text-row') ??
      document.querySelector('#content-section');

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
            fontSize: 'clamp(3.37rem, min(16.53vw, calc(var(--hero-gap-height) / 2.33)), 7.83rem)',
            textTransform: 'none',
          }}>
            YOUR<br />HUMAN<br />IN THE<br />LOOP
          </h1>
        </div>
      </div>



    </>
  );
};

export default HeroHeadline;
