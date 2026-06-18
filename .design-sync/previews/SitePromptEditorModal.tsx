import { SitePromptEditorModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '500px' }}>
      <SitePromptEditorModal
        open={true}
        prospect={{ id: 'demo', name: 'Acme Corp', generation: { sitePrompt: 'Professional services firm specializing in AI automation workflows and brand systems.' } }}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </div>
  );
}
