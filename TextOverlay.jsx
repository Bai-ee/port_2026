import React, { useState } from 'react';

const TextOverlay = ({ text, setText, colorPalette, isLocked }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showTextControls, setShowTextControls] = useState(false);
  const [fontSize, setFontSize] = useState(72);
  const [textAlign, setTextAlign] = useState('center');
  const [textPosition, setTextPosition] = useState('center'); // center, top, bottom
  const [opacity, setOpacity] = useState(1);
  const [addShadow, setAddShadow] = useState(true);
  const [subheadText, setSubheadText] = useState('Human Controlled AI Systems');
  const [subheadFontSize, setSubheadFontSize] = useState(24);

  // Calculate brightness of dominant color to determine text color
  const getRGB = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16),
    ] : [0, 0, 0];
  };

  const getLuminance = (hex) => {
    const [r, g, b] = getRGB(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };

  const isLightBackground = getLuminance(colorPalette.dominant) > 0.5;
  const textColor = isLightBackground ? '#000000' : '#ffffff';
  const accentColor = colorPalette.accent;

  const getPositionStyle = () => {
    const base = {
      position: 'fixed',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 999,
      fontFamily: '"Segoe UI", "Helvetica Neue", sans-serif',
      fontWeight: '700',
      letterSpacing: '-0.02em',
      color: textColor,
      opacity: opacity,
      maxWidth: '90vw',
      textAlign: textAlign,
      cursor: isEditing ? 'text' : 'pointer',
      outline: isEditing ? `2px dashed ${accentColor}` : 'none',
      padding: isEditing ? '12px' : '0',
      borderRadius: isEditing ? '4px' : '0',
      background: isEditing ? 'rgba(0, 0, 0, 0.3)' : 'transparent',
      transition: 'all 0.3s ease',
    };

    if (textPosition === 'top') {
      base.top = '80px';
    } else if (textPosition === 'bottom') {
      base.top = 'auto';
      base.bottom = '80px';
    } else {
      base.top = '50%';
      base.transform = 'translate(-50%, -50%)';
    }

    return base;
  };

  const shadowStyle = addShadow
    ? {
        textShadow: `
          0 2px 4px rgba(0, 0, 0, 0.3),
          0 4px 8px rgba(0, 0, 0, 0.2),
          0 8px 16px rgba(0, 0, 0, 0.15),
          0 0 20px ${accentColor}40
        `,
      }
    : {};

  const controlsStyle = {
    position: 'fixed',
    top: '20px',
    left: '20px',
    background: 'rgba(15, 23, 42, 0.95)',
    border: `2px solid ${colorPalette.accent}`,
    borderRadius: '8px',
    padding: '12px',
    zIndex: 1001,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#fff',
    maxWidth: '280px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
  };

  const controlTitleStyle = {
    fontSize: '12px',
    fontWeight: 'bold',
    color: colorPalette.accent,
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  const controlGroupStyle = {
    marginBottom: '8px',
    fontSize: '11px',
  };

  const labelStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
    color: '#d1d5db',
  };

  const inputStyle = {
    width: '100%',
    padding: '4px 6px',
    background: '#1f2937',
    border: `1px solid ${colorPalette.secondary}`,
    borderRadius: '3px',
    color: colorPalette.accent,
    fontSize: '11px',
    opacity: isLocked ? 0.5 : 1,
    cursor: isLocked ? 'not-allowed' : 'text',
  };

  const buttonGroupStyle = {
    display: 'flex',
    gap: '4px',
    marginTop: '8px',
  };

  const buttonStyle = (active) => ({
    flex: 1,
    padding: '4px 8px',
    background: active ? colorPalette.accent : colorPalette.secondary,
    border: `1px solid ${colorPalette.accent}`,
    borderRadius: '3px',
    color: active ? '#000' : '#fff',
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: 'bold',
    opacity: isLocked ? 0.5 : 1,
  });

  const toggleStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px',
    background: '#1f2937',
    borderRadius: '3px',
    cursor: isLocked ? 'not-allowed' : 'pointer',
    opacity: isLocked ? 0.5 : 1,
  };

  return (
    <>
      {/* Text Display - Main Headline */}
      <div
        style={{
          ...getPositionStyle(),
          zIndex: 999,
          cursor: isLocked ? 'default' : 'pointer',
        }}
        onClick={() => !isLocked && setIsEditing(true)}
        title={isLocked ? 'Locked - Cannot edit' : 'Click to edit'}
      >
        <h1
          style={{
            fontSize: `${fontSize}px`,
            margin: 0,
            padding: 0,
            lineHeight: 1.1,
            color: textColor,
            opacity: opacity,
            ...shadowStyle,
          }}
        >
          {text}
        </h1>
        {/* Subheading */}
        <p
          style={{
            fontSize: `${subheadFontSize}px`,
            margin: '12px 0 0 0',
            padding: 0,
            lineHeight: 1.2,
            color: colorPalette.accent,
            opacity: opacity * 0.9,
            fontWeight: '400',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            ...shadowStyle,
          }}
        >
          {subheadText}
        </p>
      </div>

      {/* Text Controls - Always visible in compact form */}
      <div style={controlsStyle}>
        <div style={controlTitleStyle}>📝 Headline</div>

        {/* Quick toggle button */}
        <button
          onClick={() => setShowTextControls(!showTextControls)}
          style={{
            width: '100%',
            padding: '6px',
            background: colorPalette.secondary,
            border: `1px solid ${colorPalette.accent}`,
            borderRadius: '3px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 'bold',
            marginBottom: '8px',
          }}
        >
          {showTextControls ? '▼' : '▶'} Options
        </button>

        {showTextControls && (
          <>
            {/* Text Input */}
            <div style={controlGroupStyle}>
              <input
                type="text"
                value={text}
                onChange={(e) => !isLocked && setText(e.target.value)}
                disabled={isLocked}
                maxLength={60}
                style={inputStyle}
                placeholder="Enter headline text..."
              />
              <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
                {text.length}/60
              </div>
            </div>

            {/* Font Size */}
            <div style={controlGroupStyle}>
              <div style={labelStyle}>
                <span>Font Size</span>
                <span style={{ color: colorPalette.accent }}>{fontSize}px</span>
              </div>
              <input
                type="range"
                min="24"
                max="120"
                step="2"
                value={fontSize}
                onChange={(e) => !isLocked && setFontSize(parseInt(e.target.value))}
                disabled={isLocked}
                style={{
                  width: '100%',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  opacity: isLocked ? 0.5 : 1,
                }}
              />
            </div>

            {/* Subheading Text */}
            <div style={controlGroupStyle}>
              <div style={{ ...labelStyle, marginBottom: '4px', fontSize: '10px' }}>Subheading</div>
              <input
                type="text"
                value={subheadText}
                onChange={(e) => !isLocked && setSubheadText(e.target.value)}
                disabled={isLocked}
                maxLength={80}
                style={inputStyle}
                placeholder="Enter subheading text..."
              />
              <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>
                {subheadText.length}/80
              </div>
            </div>

            {/* Subheading Font Size */}
            <div style={controlGroupStyle}>
              <div style={labelStyle}>
                <span>Subheading Size</span>
                <span style={{ color: colorPalette.accent }}>{subheadFontSize}px</span>
              </div>
              <input
                type="range"
                min="12"
                max="48"
                step="1"
                value={subheadFontSize}
                onChange={(e) => !isLocked && setSubheadFontSize(parseInt(e.target.value))}
                disabled={isLocked}
                style={{
                  width: '100%',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  opacity: isLocked ? 0.5 : 1,
                }}
              />
            </div>

            {/* Text Alignment */}
            <div style={controlGroupStyle}>
              <div style={{ ...labelStyle, marginBottom: '6px' }}>Alignment</div>
              <div style={buttonGroupStyle}>
                {['left', 'center', 'right'].map((align) => (
                  <button
                    key={align}
                    onClick={() => !isLocked && setTextAlign(align)}
                    disabled={isLocked}
                    style={buttonStyle(textAlign === align)}
                  >
                    {align === 'left' ? '⬅' : align === 'right' ? '➡' : '⬆⬇'}
                  </button>
                ))}
              </div>
            </div>

            {/* Text Position */}
            <div style={controlGroupStyle}>
              <div style={{ ...labelStyle, marginBottom: '6px' }}>Position</div>
              <div style={buttonGroupStyle}>
                {['top', 'center', 'bottom'].map((pos) => (
                  <button
                    key={pos}
                    onClick={() => !isLocked && setTextPosition(pos)}
                    disabled={isLocked}
                    style={buttonStyle(textPosition === pos)}
                  >
                    {pos === 'top' ? '⬆' : pos === 'bottom' ? '⬇' : '•'}
                  </button>
                ))}
              </div>
            </div>

            {/* Opacity */}
            <div style={controlGroupStyle}>
              <div style={labelStyle}>
                <span>Opacity</span>
                <span style={{ color: colorPalette.accent }}>{Math.round(opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(e) => !isLocked && setOpacity(parseFloat(e.target.value))}
                disabled={isLocked}
                style={{
                  width: '100%',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  opacity: isLocked ? 0.5 : 1,
                }}
              />
            </div>

            {/* Shadow Toggle */}
            <div
              onClick={() => !isLocked && setAddShadow(!addShadow)}
              style={{
                ...toggleStyle,
                opacity: isLocked ? 0.5 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={addShadow}
                onChange={(e) => !isLocked && setAddShadow(e.target.checked)}
                disabled={isLocked}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: '11px' }}>Add Glow</span>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default TextOverlay;
