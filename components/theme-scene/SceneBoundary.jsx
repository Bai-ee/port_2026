'use client';

import React from 'react';
import SceneFallback from './SceneFallback';

// Error boundary around a WebGL scene mount (contract §9.3.7). Catches WebGL context creation
// failure, a failed dynamic import of the scene chunk, and render-time throws, and swaps in the
// themed static SceneFallback instead of leaving a blank page or crashing the route.
//
// Context *loss* after a successful start is handled inside ox.jsx (webglcontextlost listener), which
// renders the same SceneFallback without unmounting the canvas.
export default class SceneBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[theme-scene] scene failed, showing the static fallback:', (error && error.message) || error);
    }
  }

  render() {
    if (this.state.failed) {
      const { fallbackId = 'scene-fallback', fallbackPosition = 'absolute', fallbackZIndex = 0 } = this.props;
      return <SceneFallback id={fallbackId} reason="error" position={fallbackPosition} zIndex={fallbackZIndex} />;
    }
    return this.props.children;
  }
}
