import { PacingStrip } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <PacingStrip cadence="weekly" weeks={4} postsPerWeek={3} />
    </div>
  );
}
