import { MockupPromptEditorModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '500px' }}>
      <MockupPromptEditorModal
        open={true}
        prospect={{ id: 'demo', name: 'Acme Corp', generation: { mockupPrompt: 'Create a modern landing page for a creative agency specializing in AI-powered brand systems.' } }}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </div>
  );
}
