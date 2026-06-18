import { AdminCreateClientView } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <AdminCreateClientView onCreated={() => {}} getIdToken={() => Promise.resolve('')} />
    </div>
  );
}
