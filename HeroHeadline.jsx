import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

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

  useLayoutEffect(() => {
    const el = topLeftRef.current;
    if (!el) return;

    const ctx = gsap.context(() => {
      gsap.set(el, { autoAlpha: 1, filter: 'blur(0px)' });

      gsap.to(el, {
        y: -60,
        opacity: 0,
        filter: 'blur(10px)',
        ease: 'none',
        scrollTrigger: {
          trigger: '#hero-section',
          start: 'top top',
          end: 'center top',
          scrub: true,
        },
      });
    });

    return () => ctx.revert();
  }, []);

  const edge = 'max(10vw, calc((100vw - 810px) / 2))';
  const topEdge = 'clamp(10rem, 19vh, 22rem)';
  const botEdge = 'clamp(1.5rem, 3vh, 2.5rem)';

  return (
    <>
      {/* Top-left — Headline */}
      <div
        id="hero-panel-top-left"
        ref={topLeftRef}
        style={{ ...glass, top: topEdge, left: edge, width: 'max(55vw, 240px)', maxWidth: 'max(55vw, 240px)', background: 'none', backdropFilter: 'none', WebkitBackdropFilter: 'none', border: 'none', boxShadow: 'none', padding: 0 }}
      >
        <h1 style={{
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          letterSpacing: '-0.02em',
          lineHeight: 1.05,
          color: textColor,
          margin: 0,
          fontSize: 'clamp(1.9rem, 9.3vw, 4.4rem)',
          textTransform: 'none',
        }}>
          Creative Technologist<br />& Digital Media<br />Consultant
        </h1>
      </div>



    </>
  );
};

export default HeroHeadline;
