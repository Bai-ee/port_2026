import { BriefEditorModal } from 'bballi-portfolio';
const prospect = { id: 'p1', businessName: 'Acme Corp', websiteUrl: 'acmecorp.com', brief: 'Great brand. Needs a modern website refresh and AI-driven content strategy.' };
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '600px' }}>
      <BriefEditorModal open={true} onClose={() => {}} onSaved={() => {}} prospect={prospect} />
    </div>
  );
}
