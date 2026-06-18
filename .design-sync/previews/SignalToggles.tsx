import { SignalToggles } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <SignalToggles signals={{ useNews: true, useTrends: false, useCompetitor: true }} onChange={() => {}} />
    </div>
  );
}
