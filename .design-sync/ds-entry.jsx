// Design system entry — explicit re-exports of portfolio components.
// Excludes: Next.js app-router pages, THREE.js swarm canvases, Firebase
// internal config, and Next.js-only context utilities.

// === Homepage / Marketing ===
export { default as Header } from '../Header.jsx';
export { default as HeroHeadline } from '../HeroHeadline.jsx';
export { default as HeroFooter } from '../HeroFooter.jsx';
export { default as SiteFooter } from '../SiteFooter.jsx';
export { default as HorizontalGallery } from '../HorizontalGallery.jsx';
export { default as HorizontalTextSection } from '../HorizontalTextSection.jsx';
export { default as HoverRevealList } from '../HoverRevealList.jsx';
export { default as StackedSlidesSection } from '../StackedSlidesSection.jsx';
export { default as TextOverlay } from '../TextOverlay.jsx';
export { default as InnerPageShell } from '../InnerPageShell.jsx';
export { default as InternalPageBackground } from '../InternalPageBackground.jsx';
export { default as ReelPlayer } from '../ReelPlayer.jsx';
export { default as ColorPalette } from '../ColorPalette.jsx';
export { default as FontSelector } from '../FontSelector.jsx';
export { default as ControlPanel } from '../ControlPanel.jsx';
export { default as PortfolioModal } from '../PortfolioModal.jsx';
export { default as LoopControls } from '../LoopControls.jsx';

// === Dashboard ===
export { AdminEmailDigestView, AdminEmailSettingsView, AdminCreateClientView } from '../components/AdminEmailModals.jsx';
export { default as BrandSystemBuildModal } from '../components/dashboard/BrandSystemBuildModal.jsx';
export { default as BrandSystemChat } from '../components/dashboard/BrandSystemChat.jsx';
export { default as DashboardLoadingOverlay } from '../components/dashboard/DashboardLoadingOverlay.jsx';
export { default as KnowledgeBaseCard } from '../components/dashboard/KnowledgeBaseCard.jsx';
export { default as LeadGenDashboard } from '../components/dashboard/LeadGenDashboard.jsx';
export { default as MarketCategoryPanel } from '../components/dashboard/MarketCategoryPanel.jsx';
export { default as ModuleCardControls } from '../components/dashboard/ModuleCardControls.jsx';
export { default as SocialPostingPanel } from '../components/dashboard/SocialPostingPanel.jsx';
export { default as StrategyBuilderCard } from '../components/dashboard/StrategyBuilderCard.jsx';
export { default as TileDetailAnalysisContent } from '../components/dashboard/TileDetailAnalysisContent.jsx';

// === Knowledge Base (Dashboard) ===
export { default as AddItemPanel } from '../components/dashboard/knowledge-base/AddItemPanel.jsx';
export { default as ItemsList } from '../components/dashboard/knowledge-base/ItemsList.jsx';

// === Lead Gen Modals (Dashboard) ===
export { default as BriefEditorModal } from '../components/dashboard/leadgen/BriefEditorModal.jsx';
export { default as CampaignBuilderModal } from '../components/dashboard/leadgen/CampaignBuilderModal.jsx';
export { default as LeadgenModulePanel } from '../components/dashboard/leadgen/LeadgenModulePanel.jsx';
export { default as MockupPromptEditorModal } from '../components/dashboard/leadgen/MockupPromptEditorModal.jsx';
export { default as QuickRunModal } from '../components/dashboard/leadgen/QuickRunModal.jsx';
export { default as SendPreviewModal } from '../components/dashboard/leadgen/SendPreviewModal.jsx';
export { default as SettingsModal } from '../components/dashboard/leadgen/SettingsModal.jsx';
export { default as SitePromptEditorModal } from '../components/dashboard/leadgen/SitePromptEditorModal.jsx';
export { default as VisualDnaModal } from '../components/dashboard/leadgen/VisualDnaModal.jsx';

// === Strategy Builder (Dashboard) ===
export { default as CalendarPane } from '../components/dashboard/strategy-builder/CalendarPane.jsx';
export { default as InputsPane } from '../components/dashboard/strategy-builder/InputsPane.jsx';
export { default as PacingStrip } from '../components/dashboard/strategy-builder/PacingStrip.jsx';
export { default as PushPane } from '../components/dashboard/strategy-builder/PushPane.jsx';
export { default as SignalToggles } from '../components/dashboard/strategy-builder/SignalToggles.jsx';

// === Other Components ===
export { default as GlassTooltipLayer } from '../components/GlassTooltipLayer.jsx';
export { default as SubscribeModal } from '../components/payments/SubscribeModal.jsx';

// === Animated Icons ===
export { ArrowBigRightDashIcon } from '../components/ui/arrow-big-right-dash.jsx';
export { BookTextIcon } from '../components/ui/book-text.jsx';
export { BotIcon } from '../components/ui/bot.jsx';
export { BrainIcon } from '../components/ui/brain.jsx';
export { ChartNoAxesColumnIncreasingIcon } from '../components/ui/chart-no-axes-column-increasing.jsx';
export { FolderKanbanIcon } from '../components/ui/folder-kanban.jsx';
export { LaptopMinimalCheckIcon } from '../components/ui/laptop-minimal-check.jsx';
export { MessageSquareMoreIcon } from '../components/ui/message-square-more.jsx';
export { SearchIcon } from '../components/ui/search.jsx';
export { SettingsIcon } from '../components/ui/settings.jsx';
export { ShieldCheckIcon } from '../components/ui/shield-check.jsx';
export { WorkflowIcon } from '../components/ui/workflow.jsx';
