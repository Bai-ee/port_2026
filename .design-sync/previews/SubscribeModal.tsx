import { SubscribeModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '700px' }}>
      <SubscribeModal
        open={true}
        onClose={() => {}}
        defaultEmail="demo@example.com"
      />
    </div>
  );
}
