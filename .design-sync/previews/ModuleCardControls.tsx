import { ModuleCardControls } from 'bballi-portfolio';
export function Succeeded() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <ModuleCardControls
        cardId="leadgen"
        moduleState="succeeded"
        moduleConfig={{ enabled: true }}
        loading={false}
        toggleLoading={false}
        onRun={() => {}}
        onToggle={() => {}}
        tech={['Claude AI', 'Anthropic']}
      />
    </div>
  );
}
export function Running() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <ModuleCardControls
        cardId="social"
        moduleState="running"
        moduleConfig={{ enabled: true }}
        loading={true}
        toggleLoading={false}
        onRun={() => {}}
        onToggle={() => {}}
        tech={['Claude AI']}
      />
    </div>
  );
}
export function Idle() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <ModuleCardControls
        cardId="kb"
        moduleState="idle"
        moduleConfig={{ enabled: false }}
        loading={false}
        toggleLoading={false}
        onRun={() => {}}
        onToggle={() => {}}
        tech={[]}
      />
    </div>
  );
}
