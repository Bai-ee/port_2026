import { BrandSystemBuildModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.6)', minHeight: '600px' }}>
      <BrandSystemBuildModal
        open={true}
        onClose={() => {}}
        getIdToken={() => Promise.resolve('')}
        clientId="demo"
        clientName="Acme Corp"
        onDone={() => {}}
      />
    </div>
  );
}
