import { PushPane } from 'bballi-portfolio';
const plan = {
  posts: [
    { day: 'Mon', topic: 'AI trends in B2B', platform: 'linkedin', hook: 'Why AI is reshaping how B2B companies build trust…' },
    { day: 'Wed', topic: 'Client case study', platform: 'email', hook: 'How we helped Acme Corp 3x their inbound in 90 days…' },
    { day: 'Fri', topic: 'Brand framework', platform: 'linkedin', hook: 'The 3-layer brand system every creative agency needs…' },
  ],
};
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <PushPane plan={plan} getIdToken={() => Promise.resolve('')} onPublished={() => {}} />
    </div>
  );
}
