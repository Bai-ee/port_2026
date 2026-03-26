import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

const items = [
  {
    image: 'https://assets.codepen.io/16327/portrait-image-8.jpg',
    title: 'restart reverse scrub pin markers overwrite modifiers',
  },
  {
    image: 'https://assets.codepen.io/16327/portrait-image-3.jpg',
    title: 'toggleActions start end once refresh from to',
  },
  {
    image: 'https://assets.codepen.io/16327/portrait-image-1.jpg',
    title: 'ScrollSmoother Flip Draggable SplitText InertiaPlugin',
  },
  {
    image: 'https://assets.codepen.io/16327/portrait-image-14.jpg',
    title: 'onComplete onUpdate quickSetter quickTo utils.toArray',
  },
  {
    image: 'https://assets.codepen.io/16327/portrait-image-6.jpg',
    title: 'Power2 Power3 Power4 Back Elastic Bounce Expo Sine',
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
            <div style={textWrapStyle}>
              <h3 style={titleStyle}>{item.title}</h3>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

const sectionStyle = {
  position: 'relative',
  minHeight: '100vh',
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
  display: 'block',
  width: '100%',
  padding: '2rem clamp(1.5rem, 4vw, 3rem)',
  borderBottom: '1px solid rgba(245, 241, 223, 0.18)',
  boxSizing: 'border-box',
};

const imageStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: 'clamp(220px, 24vw, 360px)',
  height: 'clamp(220px, 24vw, 360px)',
  objectFit: 'cover',
  zIndex: 30,
  opacity: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  borderRadius: '1.25rem',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.42)',
};

const textWrapStyle = {
  maxWidth: '72rem',
};

const titleStyle = {
  margin: 0,
  color: '#f5f1df',
  fontSize: 'clamp(1.3rem, 2.2vw, 2.4rem)',
  lineHeight: 1.05,
  fontWeight: 700,
  letterSpacing: '-0.04em',
  fontFamily: "'Aldrich', system-ui, -apple-system, sans-serif",
};

export default HoverRevealList;
