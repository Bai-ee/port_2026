import React, { useRef, useEffect } from 'react';
import { HoloSwarm } from './HoloSwarm';

const REF_WIDTH = 480;
const DEFAULTS = { focus: 0.96, scale: 4.93, morphSpeed: 1.65 };

const responsiveScale = (baseScale, containerW) =>
  baseScale * Math.min(1, containerW / REF_WIDTH);

const HoloSwarmWindow = ({ style }) => {
  const mountRef      = useRef(null);
  const swarmRef      = useRef(null);
  const containerWRef = useRef(REF_WIDTH);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const swarm = new HoloSwarm(container, 20000);
    const initW = container.clientWidth || REF_WIDTH;
    containerWRef.current = initW;
    swarm.updateParams({ ...DEFAULTS, scale: responsiveScale(DEFAULTS.scale, initW) });
    swarm.setBackground('#000000', 0);
    swarmRef.current = swarm;

    Object.assign(swarm.renderer.domElement.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
    });

    swarm.setSize(initW, container.clientHeight || 200);

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width <= 0 || height <= 0) return;
      containerWRef.current = width;
      swarm.setSize(Math.round(width), Math.round(height));
      swarm.updateParams({ scale: responsiveScale(DEFAULTS.scale, width) });
    });

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => { entry.isIntersecting ? swarm.start() : swarm.pause(); },
      { threshold: 0, rootMargin: '100px 0px' }
    );

    const onVisibility = () => { document.hidden ? swarm.pause() : swarm.start(); };

    resizeObserver.observe(container);
    intersectionObserver.observe(container);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      swarm.dispose();
      swarmRef.current = null;
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{ ...style, position: 'relative', overflow: 'hidden' }}
    />
  );
};

export default HoloSwarmWindow;
