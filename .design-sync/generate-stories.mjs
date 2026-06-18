// Generates .design-sync/previews/<Name>.tsx for all 60 components.
// Run once; edit individual files afterward to refine.
// After running, rebuild: node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules ./node_modules --entry .design-sync/ds-entry.jsx --out ./ds-bundle
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DIR = '.design-sync/previews';
mkdirSync(DIR, { recursive: true });

const noop = '() => {}';
const noopP = '() => Promise.resolve("")';
const bootstrap = `{
    dashboardState: {
      marketCategory: { value: 'Creative Agency', source: 'user' },
      snapshot: { brandOverview: { industry: 'Creative Services', tagline: 'AI-powered creative platform' } },
      strategyBuilder: {},
    },
  }`;

const dark = { bg: '#0a0a0f', h: '400px' };
const hero = { bg: '#050510', h: '600px' };

function write(name, src) {
  writeFileSync(join(DIR, `${name}.tsx`), src.trim() + '\n');
}

// ── Homepage / Marketing ──────────────────────────────────────────────────────

write('Header', `
import { Header } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', minHeight: '80px' }}>
      <Header logoSrc="/img/sig.png" onOpenPage={() => {}} />
    </div>
  );
}
`);

write('HeroHeadline', `
import { HeroHeadline } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#050510', minHeight: '600px', overflow: 'hidden' }}>
      <HeroHeadline />
    </div>
  );
}
`);

write('HeroFooter', `
import { HeroFooter } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f' }}>
      <HeroFooter />
    </div>
  );
}
`);

write('SiteFooter', `
import { SiteFooter } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f' }}>
      <SiteFooter />
    </div>
  );
}
`);

write('HorizontalGallery', `
import { HorizontalGallery } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#050510', minHeight: '500px', overflow: 'hidden' }}>
      <HorizontalGallery />
    </div>
  );
}
`);

write('HorizontalTextSection', `
import { HorizontalTextSection } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f' }}>
      <HorizontalTextSection />
    </div>
  );
}
`);

write('HoverRevealList', `
import { HoverRevealList } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f' }}>
      <HoverRevealList />
    </div>
  );
}
`);

write('StackedSlidesSection', `
import { StackedSlidesSection } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#050510', minHeight: '500px', overflow: 'hidden' }}>
      <StackedSlidesSection />
    </div>
  );
}
`);

write('TextOverlay', `
import { TextOverlay } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', minHeight: '300px' }}>
      <TextOverlay />
    </div>
  );
}
`);

write('InnerPageShell', `
import { InnerPageShell } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', minHeight: '400px' }}>
      <InnerPageShell />
    </div>
  );
}
`);

write('InternalPageBackground', `
import { InternalPageBackground } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#050510', minHeight: '400px', position: 'relative' }}>
      <InternalPageBackground />
    </div>
  );
}
`);

write('ReelPlayer', `
import { ReelPlayer } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <ReelPlayer />
    </div>
  );
}
`);

write('ColorPalette', `
import { ColorPalette } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#fff', padding: '24px' }}>
      <ColorPalette />
    </div>
  );
}
`);

write('FontSelector', `
import { FontSelector } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <FontSelector />
    </div>
  );
}
`);

write('ControlPanel', `
import { ControlPanel } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <ControlPanel />
    </div>
  );
}
`);

write('PortfolioModal', `
import { PortfolioModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#fff', minHeight: '600px' }}>
      <PortfolioModal />
    </div>
  );
}
`);

write('LoopControls', `
import { LoopControls } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <LoopControls />
    </div>
  );
}
`);

write('GlassTooltipLayer', `
import { GlassTooltipLayer } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '40px 60px' }}>
      <GlassTooltipLayer>
        <span style={{ color: '#fff', fontSize: '16px' }}>Hover to see tooltip</span>
      </GlassTooltipLayer>
    </div>
  );
}
`);

// ── Admin ─────────────────────────────────────────────────────────────────────

write('AdminEmailDigestView', `
import { AdminEmailDigestView } from 'bballi-portfolio';
const clients = [
  { id: 'c1', name: 'Acme Corp', websiteUrl: 'acmecorp.com' },
  { id: 'c2', name: 'Studio Nine', websiteUrl: 'studionine.co' },
];
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <AdminEmailDigestView clients={clients} selectedClientId="c1" onSelectClient={() => {}} />
    </div>
  );
}
`);

write('AdminEmailSettingsView', `
import { AdminEmailSettingsView } from 'bballi-portfolio';
const clients = [
  { id: 'c1', name: 'Acme Corp', websiteUrl: 'acmecorp.com' },
];
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <AdminEmailSettingsView clients={clients} selectedClientId="c1" onSelectClient={() => {}} />
    </div>
  );
}
`);

write('AdminCreateClientView', `
import { AdminCreateClientView } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <AdminCreateClientView onCreated={() => {}} getIdToken={() => Promise.resolve('')} />
    </div>
  );
}
`);

// ── Payments ──────────────────────────────────────────────────────────────────

write('SubscribeModal', `
import { SubscribeModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '600px' }}>
      <SubscribeModal isOpen={true} onClose={() => {}} />
    </div>
  );
}
`);

// ── Dashboard ─────────────────────────────────────────────────────────────────

write('LeadGenDashboard', `
import { LeadGenDashboard } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', minHeight: '600px' }}>
      <LeadGenDashboard
        getIdToken={() => Promise.resolve('')}
        bootstrap={${bootstrap}}
      />
    </div>
  );
}
`);

write('KnowledgeBaseCard', `
import { KnowledgeBaseCard } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <KnowledgeBaseCard
        getIdToken={() => Promise.resolve('')}
        bootstrap={${bootstrap}}
      />
    </div>
  );
}
`);

write('MarketCategoryPanel', `
import { MarketCategoryPanel } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <MarketCategoryPanel
        getIdToken={() => Promise.resolve('')}
        onSaved={() => {}}
        bootstrap={${bootstrap}}
      />
    </div>
  );
}
`);

write('ModuleCardControls', `
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
`);

write('SocialPostingPanel', `
import { SocialPostingPanel } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <SocialPostingPanel
        getIdToken={() => Promise.resolve('')}
        bootstrap={${bootstrap}}
      />
    </div>
  );
}
`);

write('StrategyBuilderCard', `
import { StrategyBuilderCard } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <StrategyBuilderCard
        getIdToken={() => Promise.resolve('')}
        onOpenCard={() => {}}
        onOpenSocialPosting={() => {}}
        bootstrap={${bootstrap}}
      />
    </div>
  );
}
`);

write('BrandSystemBuildModal', `
import { BrandSystemBuildModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.6)', minHeight: '600px' }}>
      <BrandSystemBuildModal
        open={true}
        onClose={() => {}}
        getIdToken={() => Promise.resolve('')}
        clientId="demo"
        clientName="Acme Corp"
        onDone={() => {}}
      />
    </div>
  );
}
`);

write('BrandSystemChat', `
import { BrandSystemChat } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px', minHeight: '400px' }}>
      <BrandSystemChat
        getIdToken={() => Promise.resolve('')}
        clientId="demo"
        clientName="Acme Corp"
        bootstrap={${bootstrap}}
      />
    </div>
  );
}
`);

write('DashboardLoadingOverlay', `
import { DashboardLoadingOverlay } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', minHeight: '300px', position: 'relative' }}>
      <DashboardLoadingOverlay show={true} message="Loading your dashboard…" />
    </div>
  );
}
`);

write('TileDetailAnalysisContent', `
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
`);

// ── Knowledge Base ─────────────────────────────────────────────────────────────

write('AddItemPanel', `
import { AddItemPanel } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <AddItemPanel
        getIdToken={() => Promise.resolve('')}
        clientId="demo"
        onAdded={() => {}}
      />
    </div>
  );
}
`);

write('ItemsList', `
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
`);

// ── Lead Gen Modals ────────────────────────────────────────────────────────────

write('BriefEditorModal', `
import { BriefEditorModal } from 'bballi-portfolio';
const prospect = { id: 'p1', businessName: 'Acme Corp', websiteUrl: 'acmecorp.com', brief: 'Great brand. Needs a modern website refresh and AI-driven content strategy.' };
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '600px' }}>
      <BriefEditorModal open={true} onClose={() => {}} onSaved={() => {}} prospect={prospect} />
    </div>
  );
}
`);

write('CampaignBuilderModal', `
import { CampaignBuilderModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '600px' }}>
      <CampaignBuilderModal open={true} onClose={() => {}} onSaved={() => {}} getIdToken={() => Promise.resolve('')} />
    </div>
  );
}
`);

write('LeadgenModulePanel', `
import { LeadgenModulePanel } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <LeadgenModulePanel
        getIdToken={() => Promise.resolve('')}
        bootstrap={${bootstrap}}
        onOpenCard={() => {}}
        onRunModule={() => {}}
      />
    </div>
  );
}
`);

write('MockupPromptEditorModal', `
import { MockupPromptEditorModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '500px' }}>
      <MockupPromptEditorModal
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
        getIdToken={() => Promise.resolve('')}
        clientId="demo"
        initialPrompt="Create a modern landing page for a creative agency specializing in AI-powered brand systems."
      />
    </div>
  );
}
`);

write('QuickRunModal', `
import { QuickRunModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '500px' }}>
      <QuickRunModal open={true} onClose={() => {}} onResult={() => {}} getIdToken={() => Promise.resolve('')} />
    </div>
  );
}
`);

write('SendPreviewModal', `
import { SendPreviewModal } from 'bballi-portfolio';
const prospect = { id: 'p1', businessName: 'Acme Corp', email: 'hello@acme.com' };
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '400px' }}>
      <SendPreviewModal
        open={true}
        onClose={() => {}}
        getIdToken={() => Promise.resolve('')}
        prospect={prospect}
        previewUrl="https://acmecorp.com"
      />
    </div>
  );
}
`);

write('SettingsModal', `
import { SettingsModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '600px' }}>
      <SettingsModal open={true} onClose={() => {}} getIdToken={() => Promise.resolve('')} bootstrap={${bootstrap}} onSaved={() => {}} />
    </div>
  );
}
`);

write('SitePromptEditorModal', `
import { SitePromptEditorModal } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '400px' }}>
      <SitePromptEditorModal
        open={true}
        onClose={() => {}}
        onSaved={() => {}}
        getIdToken={() => Promise.resolve('')}
        clientId="demo"
        initialPrompt="Professional services firm specializing in AI automation workflows and brand systems."
      />
    </div>
  );
}
`);

write('VisualDnaModal', `
import { VisualDnaModal } from 'bballi-portfolio';
const prospect = { id: 'p1', businessName: 'Acme Corp', websiteUrl: 'acmecorp.com' };
export function Default() {
  return (
    <div style={{ background: 'rgba(0,0,0,0.5)', minHeight: '600px' }}>
      <VisualDnaModal open={true} onClose={() => {}} onSaved={() => {}} getIdToken={() => Promise.resolve('')} prospect={prospect} />
    </div>
  );
}
`);

// ── Strategy Builder ───────────────────────────────────────────────────────────

write('CalendarPane', `
import { CalendarPane } from 'bballi-portfolio';
const config = { vertical: 'saas', cadence: 'weekly', channels: ['linkedin', 'email'] };
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <CalendarPane config={config} plan={null} getIdToken={() => Promise.resolve('')} />
    </div>
  );
}
`);

write('InputsPane', `
import { InputsPane } from 'bballi-portfolio';
const config = { vertical: 'saas', cadence: 'weekly', channels: ['linkedin', 'email'], targetAudience: 'B2B founders' };
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <InputsPane config={config} onChange={() => {}} onGenerate={() => {}} busy={false} />
    </div>
  );
}
`);

write('PacingStrip', `
import { PacingStrip } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <PacingStrip cadence="weekly" weeks={4} postsPerWeek={3} />
    </div>
  );
}
`);

write('PushPane', `
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
`);

write('SignalToggles', `
import { SignalToggles } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', padding: '24px' }}>
      <SignalToggles signals={{ useNews: true, useTrends: false, useCompetitor: true }} onChange={() => {}} />
    </div>
  );
}
`);

// ── Icons ──────────────────────────────────────────────────────────────────────

const icons = [
  'ArrowBigRightDashIcon', 'BookTextIcon', 'BotIcon', 'BrainIcon',
  'ChartNoAxesColumnIncreasingIcon', 'FolderKanbanIcon', 'LaptopMinimalCheckIcon',
  'MessageSquareMoreIcon', 'SearchIcon', 'SettingsIcon', 'ShieldCheckIcon', 'WorkflowIcon',
];

for (const name of icons) {
  write(name, `
import { ${name} } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', background: '#fff' }}>
      <${name} size={64} />
    </div>
  );
}
`);
}

console.log(`Generated ${Object.keys({Header:1,HeroHeadline:1,HeroFooter:1,SiteFooter:1,HorizontalGallery:1,HorizontalTextSection:1,HoverRevealList:1,StackedSlidesSection:1,TextOverlay:1,InnerPageShell:1,InternalPageBackground:1,ReelPlayer:1,ColorPalette:1,FontSelector:1,ControlPanel:1,PortfolioModal:1,LoopControls:1,GlassTooltipLayer:1,AdminEmailDigestView:1,AdminEmailSettingsView:1,AdminCreateClientView:1,SubscribeModal:1,LeadGenDashboard:1,KnowledgeBaseCard:1,MarketCategoryPanel:1,ModuleCardControls:1,SocialPostingPanel:1,StrategyBuilderCard:1,BrandSystemBuildModal:1,BrandSystemChat:1,DashboardLoadingOverlay:1,TileDetailAnalysisContent:1,AddItemPanel:1,ItemsList:1,BriefEditorModal:1,CampaignBuilderModal:1,LeadgenModulePanel:1,MockupPromptEditorModal:1,QuickRunModal:1,SendPreviewModal:1,SettingsModal:1,SitePromptEditorModal:1,VisualDnaModal:1,CalendarPane:1,InputsPane:1,PacingStrip:1,PushPane:1,SignalToggles:1,...icons.reduce((a,n)=>({...a,[n]:1}),{})}).length} TSX story files in ${DIR}/`);
