import { GlassTooltipLayer } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '40px 60px' }}>
      <GlassTooltipLayer>
        <span style={{ color: '#fff', fontSize: '16px' }}>Hover to see tooltip</span>
      </GlassTooltipLayer>
    </div>
  );
}
