import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const MOBILE_SCROLL_MEDIA_QUERY = '(max-width: 767px), (pointer: coarse)';

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
    const isTouchScrollDevice =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(MOBILE_SCROLL_MEDIA_QUERY).matches;

    let frame = 0;
    let isScheduled = false;

    const updateLayout = () => {
      const nav = document.querySelector('#site-nav');
      const contentAnchor =
        document.querySelector('#panel-hero-text-row') ??
        document.querySelector('#content-section');
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const navBottom = nav?.getBoundingClientRect().bottom ?? 64;
      const contentTop = contentAnchor?.getBoundingClientRect().top ?? viewportHeight;
      const gapTop = Math.max(0, navBottom);
      const gapBottom = Math.max(gapTop + 1, contentTop);
      const gapHeight = Math.max(gapBottom - gapTop, 180);
      const headlineHeight = contentEl.getBoundingClientRect().height || 0;
      const centeredTop = gapTop + Math.max((gapHeight - headlineHeight) / 2, 0);
      const sideGutter = Math.max(viewportWidth * 0.1, (viewportWidth - 810) / 2);
      const maxWidth = Math.max(Math.min(viewportWidth - (sideGutter * 2), 672), 240);
      el.style.top = `${centeredTop}px`;
      el.style.maxWidth = `${maxWidth}px`;
      el.style.setProperty('--hero-gap-height', `${gapHeight}px`);
    };

    const scheduleLayoutUpdate = () => {
      if (isScheduled) return;
      isScheduled = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        isScheduled = false;
        updateLayout();
      });
    };

    const ctx = gsap.context(() => {
      gsap.set(el, { autoAlpha: 1 });
      gsap.set(contentEl, { autoAlpha: 1, y: 0, filter: 'blur(0px)' });

      gsap.to(contentEl, {
        y: isTouchScrollDevice ? -24 : -60,
        opacity: 0,
        ease: 'none',
        ...(isTouchScrollDevice ? {} : { filter: 'blur(10px)' }),
        scrollTrigger: {
          trigger: '#hero-section',
          start: 'top top',
          end: isTouchScrollDevice ? '28% top' : 'center top',
          scrub: isTouchScrollDevice ? true : 0.2,
          invalidateOnRefresh: true,
          onUpdate: updateLayout,
          onRefresh: updateLayout,
        },
      });
    });

    scheduleLayoutUpdate();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleLayoutUpdate)
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

    window.addEventListener('resize', scheduleLayoutUpdate);
    window.addEventListener('orientationchange', scheduleLayoutUpdate);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleLayoutUpdate);
      window.removeEventListener('orientationchange', scheduleLayoutUpdate);
      resizeObserver?.disconnect();
      ctx.revert();
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
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            color: textColor,
            margin: 0,
            fontSize: 'clamp(2.53rem, min(12.4vw, calc(var(--hero-gap-height) / 3.11)), 5.87rem)',
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
