import React, { useState } from 'react';

const ColorPalette = ({ colorPalette, onColorChange, isLocked, canvasBackground, onCanvasBackgroundChange }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Pre-defined palettes following 30/60/10 rule
  const presetPalettes = [
    {
      name: 'Deep Ocean',
      dominant: '#0a0e27',
      secondary: '#1e3a8a',
      accent: '#60a5fa',
    },
    {
      name: 'Midnight Gold',
      dominant: '#111827',
      secondary: '#1f2937',
      accent: '#fbbf24',
    },
    {
      name: 'Dark Aurora',
      dominant: '#0f172a',
      secondary: '#1e293b',
      accent: '#10b981',
    },
    {
      name: 'Cyberpunk',
      dominant: '#0d0221',
      secondary: '#290035',
      accent: '#ff006e',
    },
    {
      name: 'Sunset',
      dominant: '#1a1410',
      secondary: '#42275a',
      accent: '#f59e0b',
    },
    {
      name: 'Forest',
      dominant: '#0f2f1f',
      secondary: '#1a4d3e',
      accent: '#34d399',
    },
    // Warm Yellow Palette (from design system)
    {
      name: 'Warm Cream',
      dominant: '#443a1d',
      secondary: '#817757',
      accent: '#f9ecca',
    },
    {
      name: 'Wheat Gold',
      dominant: '#2c2100',
      secondary: '#403100',
      accent: '#f0e4c1',
    },
    {
      name: 'Sand Light',
      dominant: '#1a1410',
      secondary: '#443a1d',
      accent: '#fffae3',
    },
    {
      name: 'Honey Warm',
      dominant: '#292109',
      secondary: '#443a1d',
      accent: '#dbcfad',
    },
  ];

  const containerStyle = {
    position: 'fixed',
    top: '150px',
    right: '20px',
    width: '280px',
    background: `rgba(15, 23, 42, 0.95)`,
    border: `2px solid ${colorPalette.accent}`,
    borderRadius: '8px',
    padding: '16px',
    zIndex: 1000,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: `0 8px 32px rgba(0, 0, 0, 0.5)`,
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

  const subtitleStyle = {
    fontSize: '11px',
    color: '#9ca3af',
    marginBottom: '12px',
    fontStyle: 'italic',
  };

  const paletteGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px',
    marginBottom: '16px',
  };

  const presetStyle = {
    padding: '8px',
    borderRadius: '4px',
    background: '#1f2937',
    border: '2px solid transparent',
    cursor: isLocked ? 'not-allowed' : 'pointer',
    transition: 'all 0.2s',
    opacity: isLocked ? 0.5 : 1,
  };

  const presetNameStyle = {
    fontSize: '11px',
    fontWeight: 'bold',
    marginBottom: '6px',
    color: '#e5e7eb',
  };

  const colorSwatchesStyle = {
    display: 'flex',
    gap: '4px',
  };

  const swatchStyle = (color) => ({
    flex: 1,
    height: '20px',
    background: color,
    borderRadius: '2px',
    border: '1px solid rgba(255,255,255,0.2)',
  });

  const colorInputGroupStyle = {
    marginBottom: '12px',
  };

  const colorLabelStyle = {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#9ca3af',
    marginBottom: '4px',
    textTransform: 'uppercase',
  };

  const colorInputStyle = {
    width: '100%',
    height: '32px',
    border: `2px solid ${colorPalette.accent}`,
    borderRadius: '4px',
    cursor: isLocked ? 'not-allowed' : 'pointer',
    opacity: isLocked ? 0.5 : 1,
  };

  const infoBoxStyle = {
    background: 'rgba(15, 23, 42, 0.7)',
    border: `1px solid ${colorPalette.secondary}`,
    borderRadius: '4px',
    padding: '8px',
    marginBottom: '12px',
    fontSize: '11px',
    color: '#d1d5db',
    lineHeight: '1.5',
  };

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>🎨 Color System</div>
      <div style={subtitleStyle}>30/60/10 Color Theory</div>

      {/* Info Box */}
      <div style={infoBoxStyle}>
        <strong>30/60/10 Rule:</strong> 30% dominant (background), 60% secondary (content), 10% accent (highlights)
      </div>

      {/* Dynamic Background Color Control */}
      <div style={{
        background: `linear-gradient(135deg, ${colorPalette.dominant}44, ${colorPalette.accent}22)`,
        border: `3px solid ${colorPalette.accent}`,
        borderRadius: '6px',
        padding: '12px',
        marginBottom: '12px',
        boxShadow: `0 0 15px ${colorPalette.accent}33`
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 'bold',
          color: colorPalette.accent,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          🎨 Background Color
        </div>
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          <input
            type="color"
            value={colorPalette.dominant}
            onChange={(e) => !isLocked && onColorChange({ ...colorPalette, dominant: e.target.value })}
            disabled={isLocked}
            style={{
              width: '60px',
              height: '50px',
              border: `2px solid ${colorPalette.accent}`,
              borderRadius: '4px',
              cursor: isLocked ? 'not-allowed' : 'pointer',
              opacity: isLocked ? 0.5 : 1,
            }}
            title="Click to change background color"
          />
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: '11px',
              color: '#9ca3af',
              marginBottom: '4px'
            }}>Hex: {colorPalette.dominant}</div>
            <div style={{
              fontSize: '10px',
              color: '#6b7280',
              lineHeight: '1.4'
            }}>
              Try different colors to see how the hero section looks with different backgrounds
            </div>
          </div>
        </div>
      </div>

      {/* Canvas Background Control */}
      <div style={{
        background: `linear-gradient(135deg, ${canvasBackground}44, ${colorPalette.accent}22)`,
        border: `3px solid ${colorPalette.accent}`,
        borderRadius: '6px',
        padding: '12px',
        marginBottom: '12px',
        boxShadow: `0 0 15px ${colorPalette.accent}33`
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 'bold',
          color: colorPalette.accent,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          🎬 Canvas Background
        </div>
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center'
        }}>
          <input
            type="color"
            value={canvasBackground}
            onChange={(e) => onCanvasBackgroundChange(e.target.value)}
            disabled={isLocked}
            style={{
              width: '60px',
              height: '50px',
              border: `2px solid ${colorPalette.accent}`,
              borderRadius: '4px',
              cursor: isLocked ? 'not-allowed' : 'pointer',
              opacity: isLocked ? 0.5 : 1,
            }}
            title="Click to change canvas background"
          />
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: '11px',
              color: '#9ca3af',
              marginBottom: '4px'
            }}>Hex: {canvasBackground}</div>
            <div style={{
              fontSize: '10px',
              color: '#6b7280',
              lineHeight: '1.4'
            }}>
              3D scene background (independent from footer)
            </div>
          </div>
        </div>
      </div>

      {/* Quick Background Presets */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{
          fontSize: '10px',
          fontWeight: 'bold',
          color: '#9ca3af',
          marginBottom: '6px',
          textTransform: 'uppercase'
        }}>
          Quick Backgrounds
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '6px'
        }}>
          {[
            { color: '#000000', label: 'Black' },
            { color: '#0f172a', label: 'Navy' },
            { color: '#1e1b4b', label: 'Purple' },
            { color: '#1a1410', label: 'Brown' },
            { color: '#0d1117', label: 'Dark' },
            { color: '#0f2f1f', label: 'Forest' },
            { color: '#1a0033', label: 'Deep' },
            { color: '#111827', label: 'Gray' },
          ].map(bg => (
            <button
              key={bg.color}
              onClick={() => !isLocked && onColorChange({ ...colorPalette, dominant: bg.color })}
              disabled={isLocked}
              title={bg.label}
              style={{
                width: '100%',
                height: '36px',
                background: bg.color,
                border: colorPalette.dominant === bg.color ? `3px solid ${colorPalette.accent}` : '1px solid #374151',
                borderRadius: '4px',
                cursor: isLocked ? 'not-allowed' : 'pointer',
                opacity: isLocked ? 0.5 : 1,
                transition: 'all 0.2s',
              }}
            />
          ))}
        </div>
      </div>

      {/* Preset Palettes */}
      <div style={paletteGridStyle}>
        {presetPalettes.map((palette) => (
          <div
            key={palette.name}
            style={{
              ...presetStyle,
              borderColor:
                colorPalette.dominant === palette.dominant ? colorPalette.accent : 'transparent',
            }}
            onClick={() => !isLocked && onColorChange(palette)}
          >
            <div style={presetNameStyle}>{palette.name}</div>
            <div style={colorSwatchesStyle}>
              <div style={{ ...swatchStyle(palette.dominant), flex: 0.3 }} title="30%" />
              <div style={{ ...swatchStyle(palette.secondary), flex: 0.6 }} title="60%" />
              <div style={{ ...swatchStyle(palette.accent), flex: 0.1 }} title="10%" />
            </div>
          </div>
        ))}
      </div>

      {/* Advanced Color Controls */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        style={{
          width: '100%',
          padding: '8px',
          background: colorPalette.secondary,
          border: `1px solid ${colorPalette.accent}`,
          borderRadius: '4px',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 'bold',
          marginBottom: '12px',
        }}
      >
        {showAdvanced ? '▼' : '▶'} Custom Colors
      </button>

      {showAdvanced && (
        <>
          <div style={colorInputGroupStyle}>
            <div style={colorLabelStyle}>Dominant (30%)</div>
            <input
              type="color"
              value={colorPalette.dominant}
              onChange={(e) => !isLocked && onColorChange({ ...colorPalette, dominant: e.target.value })}
              disabled={isLocked}
              style={colorInputStyle}
            />
          </div>

          <div style={colorInputGroupStyle}>
            <div style={colorLabelStyle}>Secondary (60%)</div>
            <input
              type="color"
              value={colorPalette.secondary}
              onChange={(e) => !isLocked && onColorChange({ ...colorPalette, secondary: e.target.value })}
              disabled={isLocked}
              style={colorInputStyle}
            />
          </div>

          <div style={colorInputGroupStyle}>
            <div style={colorLabelStyle}>Accent (10%)</div>
            <input
              type="color"
              value={colorPalette.accent}
              onChange={(e) => !isLocked && onColorChange({ ...colorPalette, accent: e.target.value })}
              disabled={isLocked}
              style={colorInputStyle}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default ColorPalette;
