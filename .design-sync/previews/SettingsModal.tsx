import { SettingsModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '600px' }}>
      <SettingsModal open={true} onClose={() => {}} getIdToken={() => Promise.resolve('')} bootstrap={{
    dashboardState: {
      marketCategory: { value: 'Creative Agency', source: 'user' },
      snapshot: { brandOverview: { industry: 'Creative Services', tagline: 'AI-powered creative platform' } },
      strategyBuilder: {},
    },
  }} onSaved={() => {}} />
    </div>
  );
}
