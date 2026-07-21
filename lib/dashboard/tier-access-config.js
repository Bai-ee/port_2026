// Tier/access-control config — onboarding steps + card ids, non-admin
// unlocked cards/steps, CAP_STEPS bucket navigation, and brief-cooldown
// constants. Extracted from DashboardPage.jsx module scope (Phase 2
// decomposition) — move-only, no behavior change.

import onboardingConfig from '../../onboarding/questions.config.cjs';
import {
  BriefcaseBusiness,
  CalendarDays,
  ChartColumnIncreasing,
  ClipboardList,
  Database,
  Ear,
  Eye,
  Images,
  LaptopMinimalCheck,
  MessageSquareMore,
  Search,
  Send,
  Settings2,
  Speech,
  Workflow,
} from 'lucide-react';

// Entry-flow survey surfaces every question step (excludes the summary, which
// is added in Phase 4). Ordered by the `order` field in questions.config.cjs.
export const ONBOARDING_ENTRY_STEPS = onboardingConfig.QUESTION_STEPS;
export const ONBOARDING_CARD_IDS = new Set([
  'audit-summary',
  'multi-device-view',
  'social-preview',
  'business-model',
  'seo-performance',
  'agent-readiness',
  'industry',
  'visibility-snapshot',
  'style-guide',
  'design-evaluation',
  'priority-signal',
  'brand-system',
  'visual-dna',
  'knowledge-base',
  'strategy-builder',
  'creative-builder',
  'social-media-posting',
  'marketing-brief',
  'survey-status',
  // Per-client leadgen flow cards.
  'client-brief',
  'client-mockup',
  'client-site',
]);
// Non-admin accounts: every tile is locked unless its card id is listed here.
// Daily Briefs bucket is open except the pre-run preview ('brief') and the
// Executive Brief ('marketing-brief'); named brief rows keep their own tier locks.
// UI Teaser render variations — cycled per run by the ui-teaser card, seeded
// jitter inside scripts/render-ui-teaser.mjs makes every render unique.
export const UI_TEASER_VARIATIONS = ['hero-hold', 'scroll-up', 'dive-loop'];
export const NON_ADMIN_UNLOCKED_CARD_IDS = new Set([
  'past-briefs',
  'submit-custom-brief',
  'brief-marketing',
  'brief-strategy',
  'brief-performance',
  // Knowledge Officer lead cards — browsable/runnable without admin.
  'audit-summary',
  'multi-device-view',
  // DELIVERABLES bucket — the launch deliverable cards, open to new subscribers.
  'onboarding-brief',
  'social-preview',
  'mockup-studio',
  // Holo Paper — same studio surface as mockup-studio, cloth mode.
  'holo-cloth',
  'style-guide',
  'cross-device-images',
  'post-me',
]);
// Asset cards that open the full-screen overlay (#brief-fullscreen-overlay) for
// EVERYONE — admin and client alike. They're single finished creatives with no
// admin controls worth a tabbed modal. Video Promo (mockup-studio) is NOT here:
// non-admins get the overlay via the generic deliverableAsset path, but admins
// keep the richer tile-detail modal (Open Studio, past renders, auto-run).
export const OVERLAY_FOR_ALL_CARD_IDS = new Set([
  'multi-device-view',
  'post-me',
  // Full Page Images — open the full-screen asset viewer (brief-fullscreen shell)
  // for admins too, with size-nav pills + vertical scroll, instead of the tabbed
  // tile-detail modal. The tabbed render stays as a forceModal fallback.
  'cross-device-images',
]);
// Launch onboarding gate: non-admins get only DELIVERABLES. Every other nav
// bucket (incl. Daily Stand Up) is VISIBLE but disabled with a lock. Within
// DELIVERABLES the cards tab (idx 0) is open. Admins bypass all of it.
export const NON_ADMIN_LOCKED_NAV_KEYS = new Set(['brief', 'knowledge', 'growth', 'content', 'social', 'website', 'automation', 'services', 'leadgen']);
export const NON_ADMIN_UNLOCKED_STEPS = { deliverables: new Set([0]) };
export function isCapStepLocked(bucket, idx, isAdmin) {
  if (isAdmin) return false;
  const allowed = NON_ADMIN_UNLOCKED_STEPS[bucket];
  return allowed ? !allowed.has(idx) : false;
}
// Launch: the run terminal shows ONLY the build/render terminal — no Founder
// Q&A chat. Hides the survey column and forces the terminal-only modal layout
// for every card run (deliverables + website signup intake). Flip to false to
// bring the chat back.
export const HIDE_INTAKE_CHAT = true;
// Per-bucket workflow steps. Each step's `id` is the first card in its group;
// the segmented control above the grid lets users jump to that anchor.
export const CAP_STEPS = {
  brief: [
    { id: 'marketing-brief', label: 'MOST RECENT BRIEF', Icon: ChartColumnIncreasing },
    { id: 'onboarding-brief', label: 'RUN BRIEFS', Icon: ClipboardList },
    { id: 'past-briefs', label: 'PAST BRIEFS', Icon: CalendarDays },
  ],
  growth: [
    { id: 'signals', label: "WHAT'S GOING ON IN THE MARKET", Icon: Eye },
    { id: 'brand-keywords', label: 'WHO ARE WE LISTENING TO', Icon: Ear },
    // Anchor must be the FIRST card of the strategy group in the growth sort
    // order — group membership walks the sorted list and switches columns at
    // each anchor. Day-of Post (priority-signal) leads, so it anchors the column.
    { id: 'priority-signal', label: "WHAT'S OUR STRATEGY", Icon: Speech },
  ],
  knowledge: [
    { id: 'knowledge-overview', label: 'OVERVIEW', Icon: Eye },
    { id: 'survey-status', label: 'ONBOARD YOUR COMPANY', Icon: ClipboardList },
    { id: 'audit-summary', label: 'AUDIT YOUR KNOWLEDGE', Icon: Database },
  ],
  // DELIVERABLES bucket — the launch deliverable package. One tab grouping the
  // Creative Brief, Multi-Device Mockup, Social Preview, and Studio cards.
  deliverables: [
    { id: 'onboarding-brief', label: 'DELIVERABLES', Icon: Images },
  ],
  content: [
    { id: 'visual-dna', label: 'INTAKE YOUR REFERENCES', Icon: Images },
    { id: 'brand-voice', label: 'CREATIVE DIRECTOR', Icon: Settings2 },
    { id: 'client-brief', label: 'DESIGNER', Icon: Send },
  ],
  website: [
    { id: 'seo-performance', label: 'AUDIT YOUR EXISTING SITE', Icon: Search },
    { id: 'client-mockup', label: 'SHIP YOUR NEW SITE', Icon: LaptopMinimalCheck },
  ],
  social: [
    { id: 'platform-coverage', label: 'REVIEW YOUR CREATIVE', Icon: Images },
    { id: 'social-media-posting', label: 'SCHEDULE YOUR POSTS', Icon: CalendarDays },
  ],
  services: [
    { id: 'contact', label: 'BOOK A CONSULT', Icon: MessageSquareMore },
    { id: 'run-my-marketing', label: 'START A RETAINER', Icon: BriefcaseBusiness },
    { id: 'build-a-page', label: 'ORDER PROJECT WORK', Icon: Workflow },
  ],
};
// Per-bucket accent color — mirrors the nav item icon colors so step-tab icons
// read as part of the same system.
export const CAP_BUCKET_COLOR = {
  brief: '#2a2420',
  deliverables: '#14b8a6',
  knowledge: '#3b82f6',
  growth: '#10b981',
  content: '#14b8a6',
  social: '#6366f1',
  website: '#0ea5e9',
  automation: '#6366f1',
  services: '#ec4899',
  leadgen: '#ff3b30',
  admin: '#a855f7',
};
// Per-tier wait between brief runs, in seconds. Arbitrary placeholder until
// tier limits are wired to real plan data.
export const TIER_BRIEF_COOLDOWN_SECONDS = 300;
// Free accounts get one brief per month — the cooldown chip counts down
// 30 days from the last brief run instead of the short paid-tier wait.
export const FREE_TIER_BRIEF_COOLDOWN_SECONDS = 30 * 24 * 60 * 60;
// Compact unit display for the cooldown chip: '29d', '7h', '12m', '45s'.
export function formatBriefCooldown(seconds) {
  if (seconds >= 86400) return { value: Math.ceil(seconds / 86400), unit: 'd' };
  if (seconds >= 3600) return { value: Math.ceil(seconds / 3600), unit: 'h' };
  if (seconds >= 60) return { value: Math.ceil(seconds / 60), unit: 'm' };
  return { value: seconds, unit: 's' };
}
