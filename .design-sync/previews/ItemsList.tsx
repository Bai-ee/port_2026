import { ItemsList } from 'bballi-portfolio';
const items = [
  { id: '1', type: 'text', title: 'Brand voice', content: 'Bold, minimal, premium.', createdAt: { seconds: 1700000000 } },
  { id: '2', type: 'url', title: 'Homepage', content: 'https://acmecorp.com', createdAt: { seconds: 1700000100 } },
  { id: '3', type: 'text', title: 'Target audience', content: 'B2B founders and operators scaling to Series A.', createdAt: { seconds: 1700000200 } },
];
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <ItemsList
        getIdToken={() => Promise.resolve('')}
        clientId="demo"
        items={items}
        loading={false}
        onDeleted={() => {}}
      />
    </div>
  );
}
