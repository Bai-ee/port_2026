import { ControlPanel } from 'bballi-portfolio';

const palette = { dominant: '#0a0e27', secondary: '#1e3a8a', accent: '#60a5fa', highlight: '#818cf8', text: '#f1f5f9' };
const params = { animationSpeed: 1, particleCount: 1400, particleSize: 0.22, chaos: 0.5, flow: 0.3, bloomStrength: 0.5, bloomRadius: 0.8, hueOffset: 0.3, hueSpeed: 0.02, saturation: 0.8 };

export function Default() {
  return (
    <div style={{ background: '#111827', padding: '24px' }}>
      <ControlPanel params={params} onParamChange={() => {}} colorPalette={palette} isLocked={false} />
    </div>
  );
}
