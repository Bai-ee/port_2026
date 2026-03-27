import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

const items = [
  {
    index: '01',
    image: 'https://picsum.photos/seed/balli-workflow/600/700',
    title: 'AI Workflows Designed Around Human Judgment',
    category: 'Systems Design',
  },
  {
    index: '02',
    image: 'https://picsum.photos/seed/balli-interactive/600/700',
    title: 'Interactive Builds Shipped at Campaign Speed',
    category: 'Interactive',
  },
  {
    index: '03',
    image: 'https://picsum.photos/seed/balli-motion/600/700',
    title: 'Motion Interfaces That Hold Attention',
    category: 'Motion Design',
  },
  {
    index: '04',
    image: 'https://picsum.photos/seed/balli-data/600/700',
    title: 'Data Stories That Explain Themselves',
    category: 'Visualization',
  },
  {
    index: '05',
    image: 'https://picsum.photos/seed/balli-strategy/600/700',
    title: 'Strategy That Survives Contact with Reality',
    category: 'Consulting',
  },
];

const HoverRevealList = () => {
  const sectionRef = useRef(null);

  useLayoutEffect(() => {
    if (!sectionRef.current) return;

    const section = sectionRef.current;
    const containers = Array.from(section.querySelectorAll('[data-hover-item]'));
    const cleanups = [];

    containers.forEach((container) => {
      const image = container.querySelector('[data-hover-image]');
      if (!image) return;

      gsap.set(image, { xPercent: -50, yPercent: -50, autoAlpha: 0 });

      let firstEnter = false;
      const setX = gsap.quickTo(image, 'x', { duration: 0.4, ease: 'power3' });
      const setY = gsap.quickTo(image, 'y', { duration: 0.4, ease: 'power3' });

      const align = (event) => {
        if (firstEnter) {
          setX(event.clientX, event.clientX);
          setY(event.clientY, event.clientY);
          firstEnter = false;
          return;
        }

        setX(event.clientX);
        setY(event.clientY);
      };

      const startFollow = () => document.addEventListener('mousemove', align);
      const stopFollow = () => document.removeEventListener('mousemove', align);

      const fade = gsap.to(image, {
        autoAlpha: 1,
        ease: 'none',
        paused: true,
        duration: 0.12,
        onReverseComplete: stopFollow,
      });

      const onEnter = (event) => {
        firstEnter = true;
        fade.play();
        startFollow();
        align(event);
      };

      const onLeave = () => {
        fade.reverse();
      };

      container.addEventListener('mouseenter', onEnter);
      container.addEventListener('mouseleave', onLeave);

      cleanups.push(() => {
        container.removeEventListener('mouseenter', onEnter);
        container.removeEventListener('mouseleave', onLeave);
        stopFollow();
        fade.kill();
      });
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  return (
    <section ref={sectionRef} style={sectionStyle}>
      <ul role="list" style={listStyle}>
        {items.map((item) => (
          <li key={item.title} data-hover-item style={itemStyle}>
            <img data-hover-image src={item.image} alt="" style={imageStyle} />
            <span style={indexStyle}>{item.index}</span>
            <div style={textWrapStyle}>
              <h3 style={titleStyle}>{item.title}</h3>
            </div>
            <span style={categoryStyle}>{item.category}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

const sectionStyle = {
  position: 'relative',
  minHeight: '100dvh',
  marginTop: 0,
  padding: '0 0 10rem',
  boxSizing: 'border-box',
};

const listStyle = {
  listStyle: 'none',
  width: '100%',
  margin: 0,
  padding: 0,
};

const itemStyle = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: '3rem 1fr auto',
  alignItems: 'center',
  gap: '0 clamp(1rem, 2.5vw, 2.5rem)',
  width: '100%',
  padding: 'clamp(1.4rem, 2.5vw, 2rem) clamp(1.5rem, 4vw, 3rem)',
  borderBottom: '1px solid rgba(245, 241, 223, 0.12)',
  boxSizing: 'border-box',
  cursor: 'default',
};

const imageStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: 'clamp(200px, 22vw, 320px)',
  height: 'clamp(240px, 26vw, 380px)',
  objectFit: 'cover',
  zIndex: 30,
  opacity: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  borderRadius: '1rem',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
};

const indexStyle = {
  fontSize: '0.68rem',
  fontWeight: 500,
  letterSpacing: '0.06em',
  color: 'rgba(245, 241, 223, 0.28)',
  fontVariantNumeric: 'tabular-nums',
  alignSelf: 'center',
};

const textWrapStyle = {
  minWidth: 0,
};

const titleStyle = {
  margin: 0,
  color: '#f5f1df',
  fontSize: 'clamp(1.2rem, 2vw, 2.2rem)',
  lineHeight: 1.05,
  fontWeight: 700,
  letterSpacing: '-0.04em',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const categoryStyle = {
  fontSize: '0.72rem',
  fontWeight: 500,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'rgba(245, 241, 223, 0.35)',
  whiteSpace: 'nowrap',
  alignSelf: 'center',
};

export default HoverRevealList;
