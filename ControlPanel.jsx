import React from 'react';

const ControlPanel = ({ params, onParamChange, colorPalette, isLocked }) => {
  const [expandedSection, setExpandedSection] = React.useState('animation');

  const masterSpeedControls = [
    { key: 'animationSpeed', label: 'MASTER SPEED (All Motion)', min: 0.001, max: 5, step: 0.001 },
  ];

  const animationControls = [
    { key: 'flow', label: 'Flow / Rotation Speed', min: 0, max: 3, step: 0.01 },
    { key: 'chaos', label: 'Chaos / Wave Amplitude', min: 0, max: 2, step: 0.05 },
    { key: 'scale', label: 'Scale / Expansion', min: 25, max: 200, step: 5 },
    { key: 'waveAmplitude', label: 'Wave Amplitude Multiplier', min: 0.5, max: 10, step: 0.5 },
  ];

  const shapeControls = [
    { key: 'torusMajorRadius', label: 'Torus Ring Size', min: 0.5, max: 5, step: 0.1 },
    { key: 'torusTubeRadius', label: 'Tire Thickness', min: 0.05, max: 0.8, step: 0.05 },
  ];

  const rotationControls = [
    { key: 'rotationX', label: 'Static Tilt X', min: -Math.PI, max: Math.PI, step: 0.05 },
    { key: 'rotationY', label: 'Static Tilt Y', min: -Math.PI, max: Math.PI, step: 0.05 },
    { key: 'rotationZ', label: 'Static Tilt Z', min: -Math.PI, max: Math.PI, step: 0.05 },
  ];

  const tireSpinControls = [
    { key: 'tireSpinSpeed', label: '🛞 TIRE ROTATION SPEED (Independent)', min: 0, max: 5, step: 0.01 },
  ];

  const colorControls = [
    { key: 'hueSpeed', label: 'Color Shift Speed', min: 0, max: 0.1, step: 0.01 },
    { key: 'saturation', label: 'Color Saturation', min: 0, max: 1, step: 0.05 },
    { key: 'lightness', label: 'Color Lightness', min: 0, max: 1, step: 0.05 },
  ];

  const effectControls = [
    { key: 'bloomThreshold', label: 'Bloom Threshold', min: 0, max: 1, step: 0.1 },
    { key: 'bloomStrength', label: 'Bloom Strength', min: 0, max: 3, step: 0.1 },
    { key: 'bloomRadius', label: 'Bloom Radius', min: 0, max: 1, step: 0.05 },
    { key: 'particleSize', label: 'Particle Size', min: 0.1, max: 1, step: 0.05 },
  ];

  const containerStyle = {
    position: 'fixed',
    bottom: '20px',
    left: '20px',
    width: '320px',
    maxHeight: '600px',
    overflowY: 'auto',
    background: `rgba(${parseInt(colorPalette.dominant.slice(1, 3), 16)}, ${parseInt(colorPalette.dominant.slice(3, 5), 16)}, ${parseInt(colorPalette.dominant.slice(5, 7), 16)}, 0.95)`,
    border: `2px solid ${colorPalette.accent}`,
    borderRadius: '8px',
    padding: '16px',
    zIndex: 1000,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: `0 8px 32px rgba(0, 0, 0, 0.3)`,
    color: '#fff',
  };

  const titleStyle = {
    fontSize: '14px',
    fontWeight: 'bold',
    marginBottom: '12px',
    color: colorPalette.accent,
    textTransform: 'uppercase',
    letterSpacing: '1px',
  };

  const controlGroupStyle = {
    marginBottom: '12px',
  };

  const labelStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '12px',
    marginBottom: '6px',
    color: '#e5e7eb',
  };

  const sliderStyle = {
    width: '100%',
    height: '4px',
    borderRadius: '2px',
    background: `linear-gradient(to right, ${colorPalette.secondary}, ${colorPalette.accent})`,
    outline: 'none',
    cursor: isLocked ? 'not-allowed' : 'pointer',
    opacity: isLocked ? 0.5 : 1,
  };

  const valueStyle = {
    fontSize: '11px',
    color: colorPalette.accent,
    fontWeight: 'bold',
  };

  const ControlSection = ({ title, icon, controls, section }) => (
    <div>
      <button
        onClick={() => setExpandedSection(expandedSection === section ? null : section)}
        style={{
          width: '100%',
          padding: '8px',
          background: expandedSection === section ? colorPalette.accent : colorPalette.secondary,
          color: expandedSection === section ? '#000' : '#fff',
          border: `1px solid ${colorPalette.accent}`,
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: '8px',
          fontWeight: 'bold',
          fontSize: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{icon} {title}</span>
        <span>{expandedSection === section ? '▼' : '▶'}</span>
      </button>
      {expandedSection === section && (
        <div style={{ marginBottom: '12px' }}>
          {controls.map(control => (
            <div key={control.key} style={controlGroupStyle}>
              <div style={labelStyle}>
                <span>{control.label}</span>
                <span style={valueStyle}>{params[control.key]?.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={params[control.key]}
                onChange={(e) => onParamChange(control.key, parseFloat(e.target.value))}
                disabled={isLocked}
                style={sliderStyle}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>⚙️ Visualization Controls</div>

      {/* MASTER SPEED CONTROL - Always visible and prominent */}
      <div style={{
        background: `linear-gradient(135deg, ${colorPalette.accent}22, ${colorPalette.secondary}44)`,
        border: `3px solid ${colorPalette.accent}`,
        borderRadius: '6px',
        padding: '12px',
        marginBottom: '12px',
        boxShadow: `0 0 20px ${colorPalette.accent}33`
      }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 'bold',
          color: colorPalette.accent,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '1px'
        }}>
          ⚡ Master Speed Controller
        </div>
        {masterSpeedControls.map(control => (
          <div key={control.key} style={controlGroupStyle}>
            <div style={labelStyle}>
              <span>{control.label}</span>
              <span style={valueStyle}>{params[control.key]?.toFixed(3)}</span>
            </div>
            <input
              type="range"
              min={control.min}
              max={control.max}
              step={control.step}
              value={params[control.key]}
              onChange={(e) => onParamChange(control.key, parseFloat(e.target.value))}
              disabled={isLocked}
              style={{
                ...sliderStyle,
                background: `linear-gradient(to right, ${colorPalette.secondary}, ${colorPalette.accent})`
              }}
            />
            <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '6px', lineHeight: '1.4' }}>
              {params.animationSpeed < 0.01 ? '🐢 Crawl (nearly frozen)' :
               params.animationSpeed < 0.1 ? '🐢 Very slow' :
               params.animationSpeed < 0.5 ? '🐢 Slow' :
               params.animationSpeed < 1 ? '🔄 Half speed' :
               params.animationSpeed === 1 ? '▶️ Normal (1.0)' :
               params.animationSpeed < 2 ? '⚡ Fast' :
               params.animationSpeed < 3 ? '⚡ Very fast' :
               '🚀 Ultra speed'}
            </div>
          </div>
        ))}
      </div>

      <ControlSection title="Animation" icon="🎬" controls={animationControls} section="animation" />
      <ControlSection title="Shape" icon="🍩" controls={shapeControls} section="shape" />
      <ControlSection title="Rotation" icon="🔄" controls={rotationControls} section="rotation" />

      {/* Tire Spin Section */}
      <button
        onClick={() => setExpandedSection(expandedSection === 'tirespin' ? null : 'tirespin')}
        style={{
          width: '100%',
          padding: '8px',
          background: expandedSection === 'tirespin' ? colorPalette.accent : colorPalette.secondary,
          color: expandedSection === 'tirespin' ? '#000' : '#fff',
          border: `1px solid ${colorPalette.accent}`,
          borderRadius: '4px',
          cursor: 'pointer',
          marginBottom: '8px',
          fontWeight: 'bold',
          fontSize: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>🛞 Tire Spin</span>
        <span>{expandedSection === 'tirespin' ? '▼' : '▶'}</span>
      </button>
      {expandedSection === 'tirespin' && (
        <div style={{ marginBottom: '12px' }}>
          {/* Spin Speed - PROMINENT PRIMARY CONTROL */}
          {tireSpinControls.map(control => (
            <div key={control.key} style={{
              ...controlGroupStyle,
              background: `${colorPalette.secondary}44`,
              border: `2px solid ${colorPalette.accent}`,
              borderRadius: '4px',
              padding: '8px',
              marginBottom: '8px'
            }}>
              <div style={labelStyle}>
                <span style={{ color: colorPalette.accent, fontWeight: 'bold' }}>{control.label}</span>
                <span style={valueStyle}>{params[control.key]?.toFixed(3)}</span>
              </div>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={params[control.key]}
                onChange={(e) => onParamChange(control.key, parseFloat(e.target.value))}
                disabled={isLocked}
                style={{
                  ...sliderStyle,
                  background: `linear-gradient(to right, ${colorPalette.secondary}, ${colorPalette.accent})`
                }}
              />
              <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '6px', lineHeight: '1.4' }}>
                {params.tireSpinSpeed === 0 ? '⏸️ Static (frozen)' :
                 params.tireSpinSpeed < 0.01 ? '🐢 Crawl (imperceptible)' :
                 params.tireSpinSpeed < 0.1 ? '🐢 Very slow' :
                 params.tireSpinSpeed < 0.5 ? '🐢 Slow' :
                 params.tireSpinSpeed < 1 ? '🏃 Moderate' :
                 params.tireSpinSpeed < 2 ? '⚡ Fast' :
                 params.tireSpinSpeed < 3.5 ? '⚡ Very fast' :
                 '🚀 Ultra speed'}
              </div>
            </div>
          ))}

          {/* Spin Axis Selection */}
          <div style={controlGroupStyle}>
            <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#9ca3af', marginBottom: '6px' }}>Spin Axis</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
              {['x', 'y', 'z'].map(axis => (
                <button
                  key={axis}
                  onClick={() => !isLocked && onParamChange('tireSpinAxis', axis)}
                  disabled={isLocked}
                  style={{
                    padding: '6px',
                    background: params.tireSpinAxis === axis ? colorPalette.accent : colorPalette.secondary,
                    color: params.tireSpinAxis === axis ? '#000' : '#fff',
                    border: `1px solid ${colorPalette.accent}`,
                    borderRadius: '3px',
                    cursor: isLocked ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold',
                    fontSize: '11px',
                    opacity: isLocked ? 0.5 : 1,
                  }}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '9px', color: '#6b7280', marginTop: '6px', lineHeight: '1.4' }}>
              {params.tireSpinAxis === 'x' && 'Spinning around X axis (side roll)'}
              {params.tireSpinAxis === 'y' && 'Spinning around Y axis (tire roll) ⭐ Recommended'}
              {params.tireSpinAxis === 'z' && 'Spinning around Z axis (forward roll)'}
            </div>
          </div>
        </div>
      )}

      <ControlSection title="Colors" icon="🎨" controls={colorControls} section="colors" />
      <ControlSection title="Effects" icon="✨" controls={effectControls} section="effects" />
    </div>
  );
};

export default ControlPanel;
