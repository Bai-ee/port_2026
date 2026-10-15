'use client';

import dynamic from 'next/dynamic';
import SceneBoundary from './components/theme-scene/SceneBoundary';

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

// Theme tokens (baseline light values are identical to the former literals):
//   --t-scene-wash       rgba(245, 241, 223, 0.08)
//   --t-glass-highlight  rgba(255, 255, 255, 0.45)
//   --t-surface @ 60%    rgba(255, 255, 255, 0.6) in light
const washStyle = {
  position: 'absolute',
  inset: 0,
  background: 'var(--t-scene-wash)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  boxShadow: 'inset 0 0 0 1px var(--t-glass-highlight), inset 0 1px 0 color-mix(in srgb, var(--t-surface) 60%, transparent)',
};

// `sceneMode` follows the active theme ('theme') by default. Pages pinned to a palette (X8, e.g.
// /recreate) pass 'light' | 'dark'; 'off' ignores the theme entirely.
export default function InternalPageBackground({ onReady = null, sceneMode = 'theme' }) {
  return (
    <div id="internal-page-bg" aria-hidden="true" style={wrapperStyle}>
      <div id="internal-page-bg-scene-frame" style={sceneFrameStyle}>
        <SceneBoundary fallbackId="internal-page-bg-scene-fallback">
          <BackgroundScene params={BACKGROUND_PARAMS} backgroundColor={null} onReady={onReady} sceneMode={sceneMode} />
        </SceneBoundary>
      </div>
      <div id="internal-page-bg-wash" style={washStyle} />
    </div>
  );
}
