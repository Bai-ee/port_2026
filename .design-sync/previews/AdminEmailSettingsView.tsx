import { AdminEmailSettingsView } from 'bballi-portfolio';
const clients = [
  { id: 'c1', name: 'Acme Corp', websiteUrl: 'acmecorp.com' },
];
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <AdminEmailSettingsView clients={clients} selectedClientId="c1" onSelectClient={() => {}} />
    </div>
  );
}
