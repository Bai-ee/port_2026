import { LeadgenModulePanel } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <LeadgenModulePanel
        getIdToken={() => Promise.resolve('')}
        bootstrap={{
    dashboardState: {
      marketCategory: { value: 'Creative Agency', source: 'user' },
      snapshot: { brandOverview: { industry: 'Creative Services', tagline: 'AI-powered creative platform' } },
      strategyBuilder: {},
    },
  }}
        onOpenCard={() => {}}
        onRunModule={() => {}}
      />
    </div>
  );
}
