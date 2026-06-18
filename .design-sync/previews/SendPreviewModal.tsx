import { SendPreviewModal } from 'bballi-portfolio';
const prospect = { id: 'p1', businessName: 'Acme Corp', email: 'hello@acme.com' };
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '400px' }}>
      <SendPreviewModal
        open={true}
        onClose={() => {}}
        getIdToken={() => Promise.resolve('')}
        prospect={prospect}
        previewUrl="https://acmecorp.com"
      />
    </div>
  );
}
