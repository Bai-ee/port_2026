import { AddItemPanel } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <AddItemPanel
        getIdToken={() => Promise.resolve('')}
        clientId="demo"
        onAdded={() => {}}
      />
    </div>
  );
}
