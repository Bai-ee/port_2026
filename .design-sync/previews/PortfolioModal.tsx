import { PortfolioModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '700px' }}>
      <PortfolioModal
        activePageId="value"
        onClose={() => {}}
        onOpenPage={() => {}}
      />
    </div>
  );
}
