import { QuickRunModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '500px' }}>
      <QuickRunModal open={true} onClose={() => {}} onResult={() => {}} getIdToken={() => Promise.resolve('')} />
    </div>
  );
}
