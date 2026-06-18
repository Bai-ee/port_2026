import { AdminEmailDigestView } from 'bballi-portfolio';
const clients = [
  { id: 'c1', name: 'Acme Corp', websiteUrl: 'acmecorp.com' },
  { id: 'c2', name: 'Studio Nine', websiteUrl: 'studionine.co' },
];
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <AdminEmailDigestView clients={clients} selectedClientId="c1" onSelectClient={() => {}} />
    </div>
  );
}
