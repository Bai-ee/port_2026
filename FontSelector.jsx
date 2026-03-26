import React, { useState, useEffect } from 'react';

const FontSelector = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentFont, setCurrentFont] = useState('system-ui');
  const [fontSize, setFontSize] = useState('1rem');

  const fonts = [
    { name: 'System UI', value: 'system-ui, -apple-system, sans-serif', category: 'default' },

    // Elegant Serifs
    { name: 'Playfair Display', value: "'Playfair Display', serif", url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap' },
    { name: 'Cormorant Garamond', value: "'Cormorant Garamond', serif", url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;700&display=swap' },
    { name: 'Crimson Text', value: "'Crimson Text', serif", url: 'https://fonts.googleapis.com/css2?family=Crimson+Text:wght@400;700&display=swap' },
    { name: 'EB Garamond', value: "'EB Garamond', serif", url: 'https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&display=swap' },
    { name: 'Lora', value: "'Lora', serif", url: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;700&display=swap' },
    { name: 'Merriweather', value: "'Merriweather', serif", url: 'https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap' },
    { name: 'Libre Baskerville', value: "'Libre Baskerville', serif", url: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&display=swap' },
    { name: 'Bodoni Moda', value: "'Bodoni Moda', serif", url: 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@400;700&display=swap' },
    { name: 'Fraunces', value: "'Fraunces', serif", url: 'https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&display=swap' },

    // Modern Sans-Serifs
    { name: 'Montserrat', value: "'Montserrat', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap' },
    { name: 'Poppins', value: "'Poppins', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap' },
    { name: 'DM Sans', value: "'DM Sans', sans-serif", url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;700&display=swap' },
    { name: 'Inter', value: "'Inter', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap' },
    { name: 'Outfit', value: "'Outfit', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&display=swap' },
    { name: 'Syne', value: "'Syne', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;700&display=swap' },
    { name: 'Manrope', value: "'Manrope', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;700&display=swap' },
    { name: 'Plus Jakarta Sans', value: "'Plus Jakarta Sans', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700&display=swap' },
    { name: 'Raleway', value: "'Raleway', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Raleway:wght@400;700&display=swap' },
    { name: 'Urbanist', value: "'Urbanist', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Urbanist:wght@400;700&display=swap' },
    { name: 'Lexend', value: "'Lexend', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Lexend:wght@400;700&display=swap' },
    { name: 'Commissioner', value: "'Commissioner', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Commissioner:wght@400;700&display=swap' },
    { name: 'Mulish', value: "'Mulish', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Mulish:wght@400;700&display=swap' },
    { name: 'Quicksand', value: "'Quicksand', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Quicksand:wght@400;700&display=swap' },
    { name: 'Nunito', value: "'Nunito', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;700&display=swap' },

    // Geometric
    { name: 'Geometric Modern', value: "'Rubik', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;700&display=swap' },

    // Display/Bold
    { name: 'Abril Fatface', value: "'Abril Fatface', serif", url: 'https://fonts.googleapis.com/css2?family=Abril+Fatface&display=swap' },
    { name: 'Righteous', value: "'Righteous', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Righteous&display=swap' },
    { name: 'Bebas Neue', value: "'Bebas Neue', sans-serif", url: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap' },

    // Technical
    { name: 'Space Mono', value: "'Space Mono', monospace", url: 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap' },
    { name: 'Roboto Mono', value: "'Roboto Mono', monospace", url: 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap' },
  ];

  useEffect(() => {
    // Load selected font
    const selectedFont = fonts.find(f => f.value === currentFont);
    if (selectedFont && selectedFont.url) {
      const link = document.createElement('link');
      link.href = selectedFont.url;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }

    // Apply font to all elements with !important to override inline styles
    const style = document.createElement('style');
    style.innerHTML = `* { font-family: ${currentFont} !important; }`;
    style.id = 'font-selector-style';

    // Remove old style if it exists
    const oldStyle = document.getElementById('font-selector-style');
    if (oldStyle) oldStyle.remove();

    document.head.appendChild(style);
  }, [currentFont]);

  const selectedFont = fonts.find(f => f.value === currentFont);

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          bottom: '2rem',
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
      >
        Aa
      </button>

      {/* Font Selector Panel */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: '5rem',
            right: '2rem',
            zIndex: 999,
            backgroundColor: '#f5f1df',
            border: '1px solid rgba(42, 36, 32, 0.2)',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            width: '280px',
            maxHeight: '70vh',
            overflowY: 'auto',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.1)',
          }}
        >
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(42, 36, 32, 0.6)' }}>
              Font Family
            </p>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#2a2420', fontWeight: 600 }}>
              {selectedFont?.name}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {fonts.map((font) => (
              <button
                key={font.value}
                onClick={() => setCurrentFont(font.value)}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  border: currentFont === font.value ? '1px solid #2a2420' : '1px solid rgba(42, 36, 32, 0.2)',
                  backgroundColor: currentFont === font.value ? 'rgba(42, 36, 32, 0.1)' : 'transparent',
                  color: '#2a2420',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontFamily: font.value,
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = 'rgba(42, 36, 32, 0.08)';
                }}
                onMouseLeave={(e) => {
                  if (currentFont !== font.value) {
                    e.target.style.backgroundColor = 'transparent';
                  }
                }}
              >
                {font.name}
              </button>
            ))}
          </div>

          {/* Preview */}
          <div
            style={{
              padding: '1rem',
              backgroundColor: 'rgba(42, 36, 32, 0.05)',
              borderRadius: '0.5rem',
              borderTop: '1px solid rgba(42, 36, 32, 0.1)',
              marginTop: '1rem',
            }}
          >
            <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(42, 36, 32, 0.5)' }}>
              Preview
            </p>
            <p style={{ margin: 0, fontSize: '1.2rem', color: '#2a2420', fontFamily: currentFont, lineHeight: 1.4 }}>
              Design Partner For Ambitious Tech
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default FontSelector;
