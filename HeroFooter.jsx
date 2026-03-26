import React, { useState } from 'react';

const HeroFooter = ({ colorPalette, isLocked }) => {
  const [headline, setHeadline] = useState('IN THE LOOP');
  const [subtext, setSubtext] = useState('Experience human-controlled AI systems with cutting-edge visualization.');
  const [ctaText, setCTAText] = useState('EXPLORE NOW');
  const [showEditing, setShowEditing] = useState(false);

  const containerStyle = {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: colorPalette.dominant,
    borderTop: `2px solid ${colorPalette.accent}`,
    zIndex: 50,
    padding: '60px 40px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const innerStyle = {
    maxWidth: '1400px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '60px',
    alignItems: 'center',
  };

  const leftColumnStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  };

  const rightColumnStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  };

  const headlineStyle = {
    fontSize: 'clamp(28px, 6vw, 56px)',
    fontWeight: '900',
    lineHeight: '1.1',
    color: '#fff',
    margin: 0,
    cursor: isLocked ? 'default' : 'pointer',
    transition: 'color 0.3s',
    outline: showEditing ? `2px dashed ${colorPalette.accent}` : 'none',
    padding: showEditing ? '8px' : '0',
    borderRadius: showEditing ? '4px' : '0',
    backgroundColor: showEditing ? `${colorPalette.secondary}44` : 'transparent',
  };

  const subtextStyle = {
    fontSize: 'clamp(14px, 2vw, 18px)',
    lineHeight: '1.6',
    color: '#d1d5db',
    margin: 0,
    cursor: isLocked ? 'default' : 'pointer',
    transition: 'color 0.3s',
    outline: showEditing ? `2px dashed ${colorPalette.accent}` : 'none',
    padding: showEditing ? '8px' : '0',
    borderRadius: showEditing ? '4px' : '0',
    backgroundColor: showEditing ? `${colorPalette.secondary}44` : 'transparent',
  };

  const buttonStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px 28px',
    background: colorPalette.accent,
    color: '#000',
    border: `2px solid ${colorPalette.accent}`,
    borderRadius: '4px',
    fontSize: '13px',
    fontWeight: '700',
    letterSpacing: '0.5px',
    cursor: 'pointer',
    transition: 'all 0.3s',
    width: 'fit-content',
    opacity: isLocked ? 0.6 : 1,
    pointerEvents: isLocked ? 'none' : 'auto',
  };

  const buttonHoverStyle = {
    ...buttonStyle,
    background: 'transparent',
    color: colorPalette.accent,
  };

  const [hoveredButton, setHoveredButton] = React.useState(false);

  const editControlsStyle = {
    position: 'fixed',
    bottom: '20px',
    left: '20px',
    background: `rgba(15, 23, 42, 0.95)`,
    border: `2px solid ${colorPalette.accent}`,
    borderRadius: '8px',
    padding: '12px',
    zIndex: 1001,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#fff',
    fontSize: '11px',
    maxWidth: '260px',
    display: showEditing ? 'block' : 'none',
  };

  const editInputStyle = {
    width: '100%',
    padding: '6px 8px',
    background: colorPalette.secondary,
    border: `1px solid ${colorPalette.accent}`,
    borderRadius: '3px',
    color: colorPalette.accent,
    fontSize: '11px',
    marginBottom: '6px',
    fontFamily: 'system-ui',
  };

  return (
    <>
      {/* Main Footer */}
      <div style={containerStyle}>
        <div style={{
          ...innerStyle,
          '@media (max-width: 768px)': {
            gridTemplateColumns: '1fr',
            gap: '40px',
            padding: '40px 20px',
          }
        }}>
          {/* Left Column - Headline */}
          <div style={leftColumnStyle}>
            <h2
              style={headlineStyle}
              onClick={() => !isLocked && setShowEditing(!showEditing)}
              title={isLocked ? 'Locked' : 'Click to edit'}
            >
              {headline}
            </h2>
          </div>

          {/* Right Column - Subtext & CTA */}
          <div style={rightColumnStyle}>
            <p
              style={subtextStyle}
              onClick={() => !isLocked && setShowEditing(!showEditing)}
              title={isLocked ? 'Locked' : 'Click to edit'}
            >
              {subtext}
            </p>
            <div>
              <button
                style={hoveredButton ? buttonHoverStyle : buttonStyle}
                onMouseEnter={() => setHoveredButton(true)}
                onMouseLeave={() => setHoveredButton(false)}
                onClick={() => {
                  // CTA handler - could navigate somewhere
                  console.log('CTA clicked');
                }}
              >
                <span>↳</span>
                {ctaText}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Controls */}
      <div style={editControlsStyle}>
        <div style={{ fontWeight: 'bold', color: colorPalette.accent, marginBottom: '8px' }}>
          ✏️ Edit Footer
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '10px' }}>Headline:</label>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            disabled={isLocked}
            style={editInputStyle}
            maxLength="80"
          />
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '10px' }}>Description:</label>
          <textarea
            value={subtext}
            onChange={(e) => setSubtext(e.target.value)}
            disabled={isLocked}
            style={{ ...editInputStyle, minHeight: '60px', resize: 'vertical' }}
            maxLength="200"
          />
        </div>
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '10px' }}>Button Text:</label>
          <input
            type="text"
            value={ctaText}
            onChange={(e) => setCTAText(e.target.value)}
            disabled={isLocked}
            style={editInputStyle}
            maxLength="30"
          />
        </div>
        <button
          onClick={() => setShowEditing(false)}
          style={{
            width: '100%',
            padding: '6px',
            background: colorPalette.accent,
            border: 'none',
            borderRadius: '3px',
            color: '#000',
            fontWeight: 'bold',
            fontSize: '10px',
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>

      {/* Toggle Edit Button */}
      <button
        onClick={() => setShowEditing(!showEditing)}
        disabled={isLocked}
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '20px',
          padding: '8px 12px',
          background: showEditing ? colorPalette.accent : colorPalette.secondary,
          color: showEditing ? '#000' : '#fff',
          border: `1px solid ${colorPalette.accent}`,
          borderRadius: '4px',
          cursor: isLocked ? 'not-allowed' : 'pointer',
          fontSize: '11px',
          fontWeight: 'bold',
          zIndex: 1000,
          opacity: isLocked ? 0.5 : 1,
          display: 'block',
        }}
      >
        {showEditing ? '✓ Editing' : '✏️ Edit Footer'}
      </button>

      {/* Mobile Responsive Styles */}
      <style>{`
        @media (max-width: 768px) {
          ${containerStyle.selector || ''} {
            padding: 40px 20px !important;
          }
        }
      `}</style>
    </>
  );
};

export default HeroFooter;
