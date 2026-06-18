// Author rich HTML previews for all 60 components in ds-bundle/.
// Run after package-build.mjs; run package-capture.mjs after this.
import { writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '../../ds-bundle');
const REL  = '../../../';  // from components/<group>/<Name>/ to bundle root

function html({ group, name, bg = '#111', pad = 0, extraCss = '', props = '{}', minH = '' }) {
  const bodyStyle = [
    'margin:0',
    `padding:${pad}px`,
    `background:${bg}`,
    minH ? `min-height:${minH}` : '',
  ].filter(Boolean).join(';');
  return `<!-- @dsCard group="${group}" -->
<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="${REL}styles.css">
  <link rel="stylesheet" href="${REL}_ds_bundle.css">
  <style>body{${bodyStyle}}${extraCss}</style>
</head><body>
  <div id="root"></div>
  <template id="ds-fallback">
    <div data-ds-fallback="" style="border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px;max-width:520px;font-family:system-ui">
      <div data-ds-eyebrow="" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#9ca3af"></div>
      <div style="font-size:20px;font-weight:600;color:#111827;margin-top:6px">${name}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:14px;line-height:1.5">Preview not yet authored. The component is fully importable — its API is in <code>${name}.d.ts</code> and usage in <code>${name}.prompt.md</code>.</div>
    </div>
  </template>
  <script src="${REL}_vendor/react.js"></script>
  <script src="${REL}_vendor/react-dom.js"></script>
  <script src="${REL}_ds_bundle.js"></script>
  <script>
    var h=React.createElement,C=window.BballiPortfolio.${name};
    var r=document.getElementById('root');
    function dsFallback(){
      r.innerHTML=document.getElementById('ds-fallback').innerHTML;
      var c=document.childNodes[0],m=c&&c.nodeType===8?/group="([^"]*)"/.exec(c.nodeValue):null;
      var e=r.querySelector('[data-ds-eyebrow]');if(e&&m)e.textContent=m[1];
    }
    try{ReactDOM.createRoot(r).render(h(C,${props}));}catch(e){dsFallback();}
    setTimeout(function(){
      var t=(r.textContent||'').trim();
      if(!r.childElementCount&&!t)return dsFallback();
      if(t==="${name}"||r.getBoundingClientRect().height<2)dsFallback();
    },400);
  </script>
</body></html>`;
}

const noop = 'function(){}';
const noopPromise = 'function(){return Promise.resolve("");}';
const mockBootstrap = JSON.stringify({
  dashboardState: {
    marketCategory: { value: 'Creative Agency', source: 'user' },
    snapshot: { brandOverview: { industry: 'Creative Services', tagline: 'AI-powered creative platform' } },
    strategyBuilder: {},
  },
});

// component name → config
const COMPONENTS = {
  // ── Homepage / Marketing ─────────────────────────────────────────────────
  Header: {
    group: 'general', bg: '#0a0a0f',
    props: `{logoSrc:'/img/sig.png',onOpenPage:${noop}}`,
  },
  HeroHeadline: {
    group: 'general', bg: '#050510', minH: '600px',
  },
  HeroFooter: {
    group: 'general', bg: '#0a0a0f',
  },
  SiteFooter: {
    group: 'general', bg: '#0a0a0f',
  },
  HorizontalGallery: {
    group: 'general', bg: '#050510', minH: '500px',
  },
  HorizontalTextSection: {
    group: 'general', bg: '#0a0a0f',
  },
  HoverRevealList: {
    group: 'general', bg: '#0a0a0f',
  },
  StackedSlidesSection: {
    group: 'general', bg: '#050510',
  },
  TextOverlay: {
    group: 'general', bg: '#0a0a0f',
  },
  InnerPageShell: {
    group: 'general', bg: '#0a0a0f', minH: '400px',
  },
  InternalPageBackground: {
    group: 'general', bg: '#050510', minH: '400px',
  },
  ReelPlayer: {
    group: 'general', bg: '#0a0a0f', pad: 24,
  },
  ColorPalette: {
    group: 'general', bg: '#fff', pad: 24,
  },
  FontSelector: {
    group: 'general', bg: '#0a0a0f', pad: 24,
  },
  ControlPanel: {
    group: 'general', bg: '#0a0a0f', pad: 24,
  },
  PortfolioModal: {
    group: 'general', bg: '#fff',
  },
  LoopControls: {
    group: 'general', bg: '#0a0a0f', pad: 24,
  },
  GlassTooltipLayer: {
    group: 'general', bg: '#0a0a0f', pad: 24,
    props: `{children:React.createElement('span',{style:{color:'#fff',padding:'40px 60px',display:'block'}},'Hover target')}`,
  },

  // ── Admin ─────────────────────────────────────────────────────────────────
  AdminEmailDigestView: {
    group: 'general', bg: '#0a0a0f', pad: 24,
    props: `{clients:[{id:'c1',name:'Acme Corp',websiteUrl:'acmecorp.com'}],selectedClientId:'c1',onSelectClient:${noop}}`,
  },
  AdminEmailSettingsView: {
    group: 'general', bg: '#0a0a0f', pad: 24,
    props: `{clients:[{id:'c1',name:'Acme Corp',websiteUrl:'acmecorp.com'}],selectedClientId:'c1',onSelectClient:${noop}}`,
  },
  AdminCreateClientView: {
    group: 'general', bg: '#0a0a0f', pad: 24,
    props: `{onCreated:${noop},getIdToken:${noopPromise}}`,
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  SubscribeModal: {
    group: 'payments', bg: '#fff',
    props: `{isOpen:true,onClose:${noop}}`,
  },

  // ── Dashboard (main) ──────────────────────────────────────────────────────
  LeadGenDashboard: {
    group: 'dashboard', bg: '#0a0a0f',
    props: `{getIdToken:${noopPromise},bootstrap:${mockBootstrap}}`,
  },
  KnowledgeBaseCard: {
    group: 'dashboard', bg: '#0a0a0f', pad: 24,
    props: `{getIdToken:${noopPromise},bootstrap:${mockBootstrap}}`,
  },
  MarketCategoryPanel: {
    group: 'dashboard', bg: '#0a0a0f', pad: 24,
    props: `{getIdToken:${noopPromise},onSaved:${noop},bootstrap:${mockBootstrap}}`,
  },
  ModuleCardControls: {
    group: 'dashboard', bg: '#0a0a0f', pad: 24,
    props: `{cardId:'leadgen',moduleState:'succeeded',moduleConfig:{enabled:true},loading:false,toggleLoading:false,onRun:${noop},onToggle:${noop},tech:['Claude AI','Anthropic']}`,
  },
  SocialPostingPanel: {
    group: 'dashboard', bg: '#0a0a0f', pad: 24,
    props: `{getIdToken:${noopPromise},bootstrap:${mockBootstrap}}`,
  },
  StrategyBuilderCard: {
    group: 'dashboard', bg: '#0a0a0f', pad: 24,
    props: `{getIdToken:${noopPromise},onOpenCard:${noop},onOpenSocialPosting:${noop},bootstrap:${mockBootstrap}}`,
  },
  BrandSystemBuildModal: {
    group: 'dashboard', bg: '#0a0a0f',
    props: `{open:true,onClose:${noop},getIdToken:${noopPromise},clientId:'demo',clientName:'Acme Corp',onDone:${noop}}`,
  },
  BrandSystemChat: {
    group: 'dashboard', bg: '#0a0a0f', pad: 24,
    props: `{getIdToken:${noopPromise},clientId:'demo',clientName:'Acme Corp',bootstrap:${mockBootstrap}}`,
  },
  DashboardLoadingOverlay: {
    group: 'dashboard', bg: '#0a0a0f',
    props: `{show:true,message:'Loading your dashboard…'}`,
  },
  TileDetailAnalysisContent: {
    group: 'dashboard', bg: '#0a0a0f', pad: 24,
    props: `{modalTab:'overview',activeTileModal:'seo',client:{id:'c1',name:'Acme Corp',websiteUrl:'acmecorp.com'},styleGuideData:null,analyzerOutputs:{},dashboardState:{},siteMeta:null,seoAudit:null,getIdToken:${noopPromise},onClose:${noop}}`,
  },

  // ── Knowledge Base ────────────────────────────────────────────────────────
  AddItemPanel: {
    group: 'knowledge-base', bg: '#0a0a0f', pad: 24,
    props: `{getIdToken:${noopPromise},clientId:'demo',onAdded:${noop}}`,
  },
  ItemsList: {
    group: 'knowledge-base', bg: '#0a0a0f', pad: 24,
    props: `{getIdToken:${noopPromise},clientId:'demo',items:[{id:'1',type:'text',title:'Brand voice',content:'Bold, minimal, premium.',createdAt:{seconds:1700000000}},{id:'2',type:'url',title:'Homepage',content:'https://acmecorp.com',createdAt:{seconds:1700000100}}],loading:false,onDeleted:${noop}}`,
  },

  // ── Lead Gen Modals ───────────────────────────────────────────────────────
  BriefEditorModal: {
    group: 'leadgen', bg: '#0a0a0f',
    props: `{open:true,onClose:${noop},onSaved:${noop},prospect:{id:'p1',businessName:'Acme Corp',websiteUrl:'acmecorp.com',brief:'Great brand. Needs website refresh.'}}`,
  },
  CampaignBuilderModal: {
    group: 'leadgen', bg: '#0a0a0f',
    props: `{open:true,onClose:${noop},onSaved:${noop},getIdToken:${noopPromise}}`,
  },
  LeadgenModulePanel: {
    group: 'leadgen', bg: '#0a0a0f', pad: 24,
    props: `{getIdToken:${noopPromise},bootstrap:${mockBootstrap},onOpenCard:${noop},onRunModule:${noop}}`,
  },
  MockupPromptEditorModal: {
    group: 'leadgen', bg: '#0a0a0f',
    props: `{open:true,onClose:${noop},onSaved:${noop},getIdToken:${noopPromise},clientId:'demo',initialPrompt:'Create a modern landing page for a creative agency.'}`,
  },
  QuickRunModal: {
    group: 'leadgen', bg: '#0a0a0f',
    props: `{open:true,onClose:${noop},onResult:${noop},getIdToken:${noopPromise}}`,
  },
  SendPreviewModal: {
    group: 'leadgen', bg: '#0a0a0f',
    props: `{open:true,onClose:${noop},getIdToken:${noopPromise},prospect:{id:'p1',businessName:'Acme Corp',email:'hello@acme.com'},previewUrl:'https://acmecorp.com'}`,
  },
  SettingsModal: {
    group: 'leadgen', bg: '#0a0a0f',
    props: `{open:true,onClose:${noop},getIdToken:${noopPromise},bootstrap:${mockBootstrap},onSaved:${noop}}`,
  },
  SitePromptEditorModal: {
    group: 'leadgen', bg: '#0a0a0f',
    props: `{open:true,onClose:${noop},onSaved:${noop},getIdToken:${noopPromise},clientId:'demo',initialPrompt:'Professional services firm specializing in AI automation workflows.'}`,
  },
  VisualDnaModal: {
    group: 'leadgen', bg: '#0a0a0f',
    props: `{open:true,onClose:${noop},onSaved:${noop},getIdToken:${noopPromise},prospect:{id:'p1',businessName:'Acme Corp',websiteUrl:'acmecorp.com'}}`,
  },

  // ── Strategy Builder ──────────────────────────────────────────────────────
  CalendarPane: {
    group: 'strategy-builder', bg: '#0a0a0f', pad: 24,
    props: `{config:{vertical:'saas',cadence:'weekly',channels:['linkedin','email']},plan:null,getIdToken:${noopPromise}}`,
  },
  InputsPane: {
    group: 'strategy-builder', bg: '#0a0a0f', pad: 24,
    props: `{config:{vertical:'saas',cadence:'weekly',channels:['linkedin','email'],targetAudience:'B2B founders'},onChange:${noop},onGenerate:${noop},busy:false}`,
  },
  PacingStrip: {
    group: 'strategy-builder', bg: '#0a0a0f', pad: 24,
    props: `{cadence:'weekly',weeks:4,postsPerWeek:3}`,
  },
  PushPane: {
    group: 'strategy-builder', bg: '#0a0a0f', pad: 24,
    props: `{plan:{posts:[{day:'Mon',topic:'AI trends',platform:'linkedin',hook:'Why AI is changing B2B...'},{day:'Wed',topic:'Case study',platform:'email',hook:'How we helped Acme...'}]},getIdToken:${noopPromise},onPublished:${noop}}`,
  },
  SignalToggles: {
    group: 'strategy-builder', bg: '#0a0a0f', pad: 24,
    props: `{signals:{useNews:true,useTrends:false,useCompetitor:true},onChange:${noop}}`,
  },

  // ── Icons (white bg, centered) ────────────────────────────────────────────
  ArrowBigRightDashIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  BookTextIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  BotIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  BrainIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  ChartNoAxesColumnIncreasingIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  FolderKanbanIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  LaptopMinimalCheckIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  MessageSquareMoreIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  SearchIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  SettingsIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  ShieldCheckIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
  WorkflowIcon: {
    group: 'general', bg: '#fff', pad: 40,
    extraCss: '#root{display:flex;justify-content:center;align-items:center;}',
    props: `{size:64}`,
  },
};

let written = 0;
for (const [name, cfg] of Object.entries(COMPONENTS)) {
  const outPath = join(ROOT, 'components', cfg.group, name, `${name}.html`);
  writeFileSync(outPath, html({ name, ...cfg }));
  written++;
}
console.log(`authored ${written} preview HTML files in ds-bundle/`);
