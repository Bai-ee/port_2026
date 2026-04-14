'use client';

import dynamic from 'next/dynamic';

const BackgroundScene = dynamic(() => import('./ox.jsx'), { ssr: false });

const BACKGROUND_PARAMS = {
  scale: 194,
  chaos: 1.08,
  flow: 0.26,
  particleCount: 18000,
  particleSize: 0.74,
  speedMult: 0.32,
  bloomThreshold: 1,
  bloomStrength: 0,
  bloomRadius: 0.8,
  hueOffset: 0.44,
  hueSpeed: 0.016,
  waveAmplitude: 4.2,
  saturation: 0.9,
  lightness: 0.52,
  torusMajorRadius: 0.62,
  torusTubeRadius: 1.36,
  torusSegments: 100,
  torusSegmentsDepth: 50,
  rotationX: -2.14159265358979,
  rotationY: -2.14159265358979,
  rotationZ: -3.14159265358979,
  tireSpinAxis: 'z',
  tireSpinSpeed: 0.05,
  animationSpeed: 1.8,
  opacity: 0.16,
};

const wrapperStyle = {
  position: 'fixed',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
  zIndex: 0,
};

const sceneFrameStyle = {
  position: 'absolute',
  inset: 0,
  opacity: 1,
  transform: 'scale(1.01)',
  transformOrigin: '50% 50%',
};

const washStyle = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(245, 241, 223, 0.08)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.6)',
};

export default function InternalPageBackground({ onReady = null }) {
  return (
    <div id="internal-page-bg" aria-hidden="true" style={wrapperStyle}>
      <div style={sceneFrameStyle}>
        <BackgroundScene params={BACKGROUND_PARAMS} backgroundColor={null} onReady={onReady} />
      </div>
      <div style={washStyle} />
    </div>
  );
}
