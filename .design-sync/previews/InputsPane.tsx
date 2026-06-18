import { InputsPane } from 'bballi-portfolio';
const config = { vertical: 'saas', cadence: 'weekly', channels: ['linkedin', 'email'], targetAudience: 'B2B founders' };
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <InputsPane config={config} onChange={() => {}} onGenerate={() => {}} busy={false} />
    </div>
  );
}
