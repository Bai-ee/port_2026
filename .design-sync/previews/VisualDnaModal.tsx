import { VisualDnaModal } from 'bballi-portfolio';
const prospect = { id: 'p1', businessName: 'Acme Corp', websiteUrl: 'acmecorp.com' };
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '600px' }}>
      <VisualDnaModal open={true} onClose={() => {}} onSaved={() => {}} getIdToken={() => Promise.resolve('')} prospect={prospect} />
    </div>
  );
}
