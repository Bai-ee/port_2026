import { MarketCategoryPanel } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <MarketCategoryPanel
        getIdToken={() => Promise.resolve('')}
        onSaved={() => {}}
        bootstrap={{
    dashboardState: {
      marketCategory: { value: 'Creative Agency', source: 'user' },
      snapshot: { brandOverview: { industry: 'Creative Services', tagline: 'AI-powered creative platform' } },
      strategyBuilder: {},
    },
  }}
      />
    </div>
  );
}
