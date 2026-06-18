import { HeroFooter } from 'bballi-portfolio';

const palette = { dominant: '#0a0a0f', secondary: '#111827', accent: '#8b5cf6', highlight: '#ec4899', text: '#f1f5f9' };

export function Default() {
  return (
    <div style={{ background: '#0a0a0f', minHeight: '300px', position: 'relative', overflow: 'hidden' }}>
      <HeroFooter colorPalette={palette} isLocked={false} />
    </div>
  );
}
