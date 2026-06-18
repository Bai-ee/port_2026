import { BrandSystemChat } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px', minHeight: '400px' }}>
      <BrandSystemChat
        getIdToken={() => Promise.resolve('')}
        clientId="demo"
        clientName="Acme Corp"
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
