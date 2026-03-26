import React, { useState } from 'react';

const LoopControls = ({ params, onParamsChange, backgroundColor, onBackgroundChange, textColor, onTextColorChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const config = { params, backgroundColor, textColor };
    navigator.clipboard.writeText(JSON.stringify(config, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSliderChange = (key, value) => {
    onParamsChange({
      ...params,
      [key]: parseFloat(value),
    });
  };

  const paramDefinitions = [
    // Scene
    { key: 'opacity', label: 'Tube Opacity', min: 0, max: 1, step: 0.01, category: 'Scene' },

    // Colors
    { key: 'hueOffset', label: 'Hue Offset', min: 0, max: 1, step: 0.01, category: 'Color' },
    { key: 'saturation', label: 'Saturation', min: 0, max: 1, step: 0.05, category: 'Color' },
    { key: 'lightness', label: 'Lightness', min: 0, max: 1, step: 0.05, category: 'Color' },
    { key: 'hueSpeed', label: 'Hue Speed', min: 0, max: 0.1, step: 0.001, category: 'Color' },

    // Shape & Movement
    { key: 'scale', label: 'Scale', min: 1, max: 200, step: 1, category: 'Shape' },
    { key: 'chaos', label: 'Chaos', min: 0, max: 3, step: 0.01, category: 'Shape' },
    { key: 'flow', label: 'Flow', min: 0, max: 2, step: 0.01, category: 'Shape' },
    { key: 'waveAmplitude', label: 'Wave Amplitude', min: 0, max: 10, step: 0.1, category: 'Shape' },

    // Particles
    { key: 'particleSize', label: 'Particle Size', min: 0.05, max: 1, step: 0.05, category: 'Particles' },
    { key: 'speedMult', label: 'Speed', min: 0, max: 0.5, step: 0.01, category: 'Particles' },

    // Bloom
    { key: 'bloomThreshold', label: 'Bloom Threshold', min: 0, max: 1, step: 0.05, category: 'Bloom' },
    { key: 'bloomStrength', label: 'Bloom Strength', min: 0, max: 3, step: 0.1, category: 'Bloom' },
    { key: 'bloomRadius', label: 'Bloom Radius', min: 0, max: 1, step: 0.05, category: 'Bloom' },

    // Geometry
    { key: 'torusMajorRadius', label: 'Torus Major Radius', min: 0.5, max: 5, step: 0.1, category: 'Geometry' },
    { key: 'torusTubeRadius', label: 'Torus Tube Radius', min: 0.1, max: 2, step: 0.05, category: 'Geometry' },

    // Rotation
    { key: 'rotationX', label: 'Rotation X', min: -Math.PI, max: Math.PI, step: 0.1, category: 'Rotation' },
    { key: 'rotationY', label: 'Rotation Y', min: -Math.PI, max: Math.PI, step: 0.1, category: 'Rotation' },
    { key: 'rotationZ', label: 'Rotation Z', min: -Math.PI, max: Math.PI, step: 0.1, category: 'Rotation' },
    { key: 'tireSpinSpeed', label: 'Spin Speed', min: 0, max: 5, step: 0.1, category: 'Rotation' },

    // Animation
    { key: 'animationSpeed', label: 'Animation Speed', min: 0.1, max: 10, step: 0.1, category: 'Animation' },
  ];

  const categories = [...new Set(paramDefinitions.map(p => p.category))];
  const paramsByCategory = categories.reduce((acc, cat) => {
    acc[cat] = paramDefinitions.filter(p => p.category === cat);
    return acc;
  }, {});

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          bottom: '6rem',
          right: '2rem',
          zIndex: 1000,
          width: '50px',
          height: '50px',
          borderRadius: '50%',
          backgroundColor: '#f5f1df',
          color: '#2a2420',
          border: '1px solid rgba(42, 36, 32, 0.3)',
          cursor: 'pointer',
          fontSize: '0.75rem',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.3s ease',
          transform: isOpen ? 'scale(1.1)' : 'scale(1)',
        }}
        title="Loop Parameters"
      >
        ⚙️
      </button>

      {/* Controls Panel */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: '5.5rem',
            right: '2rem',
            zIndex: 999,
            backgroundColor: '#f5f1df',
            border: '1px solid rgba(42, 36, 32, 0.2)',
            borderRadius: '0.75rem',
            padding: '1rem',
            width: '320px',
            maxHeight: '60vh',
            overflowY: 'auto',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.1)',
          }}
        >
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#2a2420', fontWeight: 700 }}>
            Loop Parameters
          </h3>

          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid rgba(42, 36, 32, 0.1)' }}>
            <h4 style={{ margin: '0 0 0.8rem 0', fontSize: '0.7rem', fontWeight: 700, color: 'rgba(42, 36, 32, 0.6)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Scene
            </h4>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'rgba(42, 36, 32, 0.7)' }}>Background</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="color"
                  value={backgroundColor || '#000000'}
                  onChange={(e) => onBackgroundChange(e.target.value)}
                  style={{ width: '32px', height: '24px', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: 0 }}
                />
                <span style={{ fontSize: '0.7rem', color: 'rgba(42, 36, 32, 0.5)', fontFamily: 'monospace' }}>
                  {backgroundColor || '#000000'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'rgba(42, 36, 32, 0.7)' }}>Text</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="color"
                  value={textColor || '#2a2420'}
                  onChange={(e) => onTextColorChange(e.target.value)}
                  style={{ width: '32px', height: '24px', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: 0 }}
                />
                <span style={{ fontSize: '0.7rem', color: 'rgba(42, 36, 32, 0.5)', fontFamily: 'monospace' }}>
                  {textColor || '#2a2420'}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {categories.map((category) => (
              <div key={category}>
                <h4 style={{ margin: '0 0 0.8rem 0', fontSize: '0.7rem', fontWeight: 700, color: 'rgba(42, 36, 32, 0.6)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {category}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {paramsByCategory[category].map((param) => (
                    <div key={param.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.7rem', fontWeight: 600, color: 'rgba(42, 36, 32, 0.7)' }}>
                          {param.label}
                        </label>
                        <span style={{ fontSize: '0.7rem', color: 'rgba(42, 36, 32, 0.5)', fontFamily: 'monospace' }}>
                          {(params[param.key] ?? 0).toFixed(3)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        value={params[param.key] ?? 0}
                        onChange={(e) => handleSliderChange(param.key, e.target.value)}
                        style={{
                          width: '100%',
                          height: '4px',
                          borderRadius: '2px',
                          backgroundColor: 'rgba(42, 36, 32, 0.2)',
                          outline: 'none',
                          cursor: 'pointer',
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(42, 36, 32, 0.1)' }}>
            <button
              onClick={handleCopy}
              style={{
                width: '100%',
                padding: '0.5rem',
                background: copied ? 'rgba(42, 36, 32, 0.15)' : 'rgba(42, 36, 32, 0.07)',
                border: '1px solid rgba(42, 36, 32, 0.2)',
                borderRadius: '0.4rem',
                cursor: 'pointer',
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#2a2420',
                letterSpacing: '0.05em',
                transition: 'background 0.2s',
              }}
            >
              {copied ? 'Copied!' : 'Copy Config to Clipboard'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default LoopControls;
