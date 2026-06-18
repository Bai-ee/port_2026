import { CampaignBuilderModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '600px' }}>
      <CampaignBuilderModal open={true} onClose={() => {}} onSaved={() => {}} getIdToken={() => Promise.resolve('')} />
    </div>
  );
}
