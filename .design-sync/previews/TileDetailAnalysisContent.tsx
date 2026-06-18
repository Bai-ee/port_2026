import { TileDetailAnalysisContent } from 'bballi-portfolio';
const client = { id: 'c1', name: 'Acme Corp', websiteUrl: 'acmecorp.com' };
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <TileDetailAnalysisContent
        modalTab="overview"
        activeTileModal="seo"
        client={client}
        styleGuideData={null}
        analyzerOutputs={{}}
        dashboardState={{}}
        siteMeta={null}
        seoAudit={null}
        getIdToken={() => Promise.resolve('')}
        onClose={() => {}}
      />
    </div>
  );
}
