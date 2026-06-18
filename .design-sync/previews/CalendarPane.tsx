import { CalendarPane } from 'bballi-portfolio';
const config = { vertical: 'saas', cadence: 'weekly', channels: ['linkedin', 'email'] };
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <CalendarPane config={config} plan={null} getIdToken={() => Promise.resolve('')} />
    </div>
  );
}
