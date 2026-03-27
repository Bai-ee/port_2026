import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const HorizontalTextSection = () => {
  const sectionRef = useRef(null);
  const textRef = useRef(null);

  useLayoutEffect(() => {
    if (!sectionRef.current || !textRef.current) return;

    const section = sectionRef.current;
    const text = textRef.current;

    const ctx = gsap.context(() => {
      const getDistance = () => Math.max(0, text.scrollWidth);

      gsap.set(text, { x: 0 });

      gsap.to(text, {
        x: () => -getDistance(),
        ease: 'none',
        scrollTrigger: {
          id: 'horizontal-text-scroll',
          trigger: section,
          pin: text,
          pinSpacing: false,
          start: 'top top+=72',
          end: () => `+=${Math.max(getDistance() * 0.7, window.innerWidth * 0.6)}`,
          scrub: 1.15,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });
    }, section);

    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('resize', refresh);

    return () => {
      window.removeEventListener('resize', refresh);
      ctx.revert();
    };
  }, []);

  return (
    <section ref={sectionRef} style={sectionStyle}>
      <div ref={textRef} style={textStyle}>
        <span style={headingStyle}>
          Horizontal text can bridge the hero and the gallery without taking over the whole viewport.
        </span>
      </div>
    </section>
  );
};

const sectionStyle = {
  overflow: 'hidden',
  height: 'auto',
  minHeight: 'clamp(8rem, 18vw, 12rem)',
  marginTop: '-25vh',
  paddingBottom: 'clamp(14rem, 28vw, 24rem)',
  display: 'flex',
  alignItems: 'center',
  position: 'relative',
  zIndex: 12,
  pointerEvents: 'none',
};

const textStyle = {
  display: 'flex',
  width: 'max-content',
  whiteSpace: 'nowrap',
  paddingLeft: '100vw',
  paddingRight: '8vw',
  willChange: 'transform',
};

const headingStyle = {
  fontSize: 'clamp(1.8rem, 6vw, 4.8rem)',
  fontWeight: 700,
  lineHeight: 1.05,
  letterSpacing: '-0.05em',
  color: '#f5f1df',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export default HorizontalTextSection;
