import { TextOverlay } from 'bballi-portfolio';

const palette = { dominant: '#0a0e27', secondary: '#1e3a8a', accent: '#60a5fa', highlight: '#818cf8', text: '#f1f5f9' };

export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <TextOverlay text="SIGNAL" setText={() => {}} colorPalette={palette} isLocked={false} />
    </div>
  );
}
