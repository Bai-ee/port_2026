// Dashboard tile/card configuration constants — the tiles list, upgrade
// overlay copy, mockup-studio presets, custom-detail card ids, and
// pricing modal options. Extracted from DashboardPage.jsx module scope
// (Phase 2 decomposition) — move-only, no behavior change.

// ── Free-tier module IDs ──────────────────────────────────────────────────────
// These tiles reflect what the free-tier intake actually produces.
// All others are rendered as PREVIEW / PRO TIER.
export const FREE_TIER_TILE_IDS = new Set([
  'creative-pipelines',
  'ai-research',
  'distribution-insight',
  'reddit-community',
]);
// Dev mock for the style-guide tile — used when extractor is not yet wired.
// Matches the shape returned by synthesizeStyleGuide() in normalize.js.
// Remove SG_MOCK fallback once visualIdentity.styleGuide is populated by the pipeline.
export const SG_MOCK = {
  summary: 'Playfair Display over Inter on warm cream with card-based framing',
  confidence: 'high',
  typography: {
    fontFamilies: [
      { family: 'Playfair Display', role: 'heading', source: 'google-fonts' },
      { family: 'Inter',            role: 'body',    source: 'google-fonts' },
    ],
    headingSystem: { fontFamily: 'Playfair Display', fontSize: '48px', fontWeight: '700', lineHeight: '1.1' },
    bodySystem:    { fontFamily: 'Inter',            fontSize: '16px', fontWeight: '400', lineHeight: '1.6' },
  },
  colors: {
    primary:   { hex: '#C3B99A', role: 'brand accent', shades: ['#F5F1EA','#E8E0D0','#C3B99A','#9E9178','#7A6E5C'] },
    secondary: { hex: '#4A7C7E', role: 'highlight',    shades: ['#D6E8E9','#A8CDD0','#4A7C7E','#326163','#1D3C3E'] },
    tertiary:  { hex: '#D4956A', role: 'warm accent',  shades: ['#FAE8DB','#ECC5A4','#D4956A','#B5724A','#8C5335'] },
    neutral:   { hex: '#FAF7F2', role: 'background',   shades: ['#FFFFFF','#FAF7F2','#F0EBE3','#E0D8CE','#C8BCAD'] },
    mode: 'light',
  },
  layout: {
    layoutType: 'flex', contentWidth: 'contained', maxWidth: '1200px',
    framing: 'card-based', grid: '12-column', borderRadius: '8px',
  },
  motion: {
    level: 'moderate', durations: ['200ms','400ms'],
    scrollPatterns: ['GSAP ScrollTrigger'], prefersReducedMotion: true,
  },
};
export function sanitizeStylePreviewLabel(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const cleaned = text
    .replace(/[_-]?[A-Za-z]+_[0-9a-f]{4,}\b/gi, (match) => {
      const cleaned = match.replace(/^[_-]+/, '').split('_')[0];
      return cleaned || '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (/^(arial|helvetica(?: neue)?|system-ui|ui-sans-serif|sans-serif|-apple-system|blinkmacsystemfont|segoe ui)$/i.test(cleaned)) {
    return 'System UI';
  }
  if (/^(times new roman|georgia|ui-serif|serif)$/i.test(cleaned)) {
    return 'System Serif';
  }
  return cleaned;
}
// Compute SVG cubic-bezier path: (0,h) → (w,0), SVG y-down so (1-y) flips.
// roundTrip=true appends the reversed bezier C so the dot travels forward then
// back along the identical curve — no jump at the end of the animation.
export function _sgEasingPath(easing, w, h, roundTrip = false) {
  const PRESETS = {
    // CSS named eases
    'ease':           [0.25, 0.1, 0.25, 1.0],
    'ease-in':        [0.42, 0, 1.0, 1.0],
    'ease-out':       [0, 0, 0.58, 1.0],
    'ease-in-out':    [0.42, 0, 0.58, 1.0],
    'linear':         [0, 0, 1, 1],
    // GSAP power eases (cubic-bezier approximations from easings.net)
    'none':           [0, 0, 1, 1],
    'power1':         [0.5, 1, 0.89, 1],
    'power1.in':      [0.11, 0, 0.5, 0],
    'power1.out':     [0.5, 1, 0.89, 1],
    'power1.inout':   [0.45, 0, 0.55, 1],
    'power2':         [0.33, 1, 0.68, 1],
    'power2.in':      [0.32, 0, 0.67, 0],
    'power2.out':     [0.33, 1, 0.68, 1],
    'power2.inout':   [0.65, 0, 0.35, 1],
    'power3':         [0.25, 1, 0.5, 1],
    'power3.in':      [0.5, 0, 0.75, 0],
    'power3.out':     [0.25, 1, 0.5, 1],
    'power3.inout':   [0.76, 0, 0.24, 1],
    'power4':         [0.22, 1, 0.36, 1],
    'power4.in':      [0.64, 0, 0.78, 0],
    'power4.out':     [0.22, 1, 0.36, 1],
    'power4.inout':   [0.83, 0, 0.17, 1],
    'expo.in':        [0.7, 0, 0.84, 0],
    'expo.out':       [0.16, 1, 0.3, 1],
    'expo.inout':     [0.87, 0, 0.13, 1],
    'sine.in':        [0.12, 0, 0.39, 0],
    'sine.out':       [0.61, 1, 0.88, 1],
    'sine.inout':     [0.37, 0, 0.63, 1],
    'circ.in':        [0.55, 0, 1, 0.45],
    'circ.out':       [0, 0.55, 0.45, 1],
    'circ.inout':     [0.85, 0, 0.15, 1],
  };
  const key = (easing || '').toLowerCase().trim().replace(/\.inout\b/, '.inout');
  let [x1, y1, x2, y2] = PRESETS[key] || PRESETS['ease-in-out'];
  const m = (easing || '').match(/cubic-bezier\(\s*([\d.]+),\s*([\d.-]+),\s*([\d.]+),\s*([\d.]+)\s*\)/);
  if (m) [x1, y1, x2, y2] = m.slice(1).map(Number);
  const c1x = x1 * w, c1y = (1 - y1) * h;
  const c2x = x2 * w, c2y = (1 - y2) * h;
  const fwd = `M 0,${h} C ${c1x},${c1y} ${c2x},${c2y} ${w},0`;
  if (!roundTrip) return fwd;
  // Reverse bezier: swap control points so the dot retraces the same curve back to start
  return `${fwd} C ${c2x},${c2y} ${c1x},${c1y} 0,${h}`;
}
// Extract cubic-bezier control points as a keySplines string for <animateMotion>.
export function _sgEasingSpline(easing) {
  const PRESETS = {
    // CSS named eases
    'ease':           [0.25, 0.1, 0.25, 1.0],
    'ease-in':        [0.42, 0, 1.0, 1.0],
    'ease-out':       [0, 0, 0.58, 1.0],
    'ease-in-out':    [0.42, 0, 0.58, 1.0],
    'linear':         [0, 0, 1, 1],
    // GSAP power eases (cubic-bezier approximations from easings.net)
    'none':           [0, 0, 1, 1],
    'power1':         [0.5, 1, 0.89, 1],
    'power1.in':      [0.11, 0, 0.5, 0],
    'power1.out':     [0.5, 1, 0.89, 1],
    'power1.inout':   [0.45, 0, 0.55, 1],
    'power2':         [0.33, 1, 0.68, 1],
    'power2.in':      [0.32, 0, 0.67, 0],
    'power2.out':     [0.33, 1, 0.68, 1],
    'power2.inout':   [0.65, 0, 0.35, 1],
    'power3':         [0.25, 1, 0.5, 1],
    'power3.in':      [0.5, 0, 0.75, 0],
    'power3.out':     [0.25, 1, 0.5, 1],
    'power3.inout':   [0.76, 0, 0.24, 1],
    'power4':         [0.22, 1, 0.36, 1],
    'power4.in':      [0.64, 0, 0.78, 0],
    'power4.out':     [0.22, 1, 0.36, 1],
    'power4.inout':   [0.83, 0, 0.17, 1],
    'expo.in':        [0.7, 0, 0.84, 0],
    'expo.out':       [0.16, 1, 0.3, 1],
    'expo.inout':     [0.87, 0, 0.13, 1],
    'sine.in':        [0.12, 0, 0.39, 0],
    'sine.out':       [0.61, 1, 0.88, 1],
    'sine.inout':     [0.37, 0, 0.63, 1],
    'circ.in':        [0.55, 0, 1, 0.45],
    'circ.out':       [0, 0.55, 0.45, 1],
    'circ.inout':     [0.85, 0, 0.15, 1],
  };
  const key = (easing || '').toLowerCase().trim().replace(/\.inout\b/, '.inout');
  let [x1, y1, x2, y2] = PRESETS[key] || PRESETS['ease-in-out'];
  const m = (easing || '').match(/cubic-bezier\(\s*([\d.]+),\s*([\d.-]+),\s*([\d.]+),\s*([\d.]+)\s*\)/);
  if (m) [x1, y1, x2, y2] = m.slice(1).map(Number);
  return `${x1} ${y1} ${x2} ${y2}`;
}
// Map an extracted easing value to a human-readable label.
// When tech is GSAP, convert CSS ease names to their GSAP power equivalent.
export function _sgGsapName(easing, isGsap) {
  const raw = (easing || '').trim();
  if (raw.length > 24) return 'cubic-bezier';
  if (!isGsap) return raw;
  const CSS_TO_GSAP = {
    'ease': 'power1.inOut', 'ease-in': 'power1.in',
    'ease-out': 'power1.out', 'ease-in-out': 'power1.inOut', 'linear': 'none',
  };
  return CSS_TO_GSAP[raw.toLowerCase()] || raw;
}
export const tiles = [
  {
    id: 'creative-pipelines',
    number: '01',
    label: 'CREATIVE PIPELINES',
    title: 'Content that sounds like you.',
    description: 'Acts like a content producer: drafts posts in your voice so you have a strong starting point to review.',
    status: 'LIVE',
    metric: 'BRAND READY',
    viz: 'segbars',
    category: 'systems',
  },
  {
    id: 'company-brain',
    number: '02',
    label: 'COMPANY BRAIN',
    title: 'Searchable, structured, stateful.',
    description: 'Acts like an organized company librarian: keeps your documents and notes easy to find and use.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'memory',
    category: 'systems',
  },
  {
    id: 'knowledge-assistant',
    number: '03',
    label: 'KNOWLEDGE ASSISTANT',
    title: 'Answers from your data.',
    description: 'Acts like an internal assistant: answers team questions using the material you have already provided.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'qa',
    category: 'systems',
  },
  {
    id: 'executive-support',
    number: '04',
    label: 'EXECUTIVE SUPPORT',
    title: 'Walk in already briefed.',
    description: 'Acts like an executive assistant: prepares meeting context so decisions start with the right facts.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'meetings',
    category: 'systems',
  },
  {
    id: 'daily-operations',
    number: '05',
    label: 'DAILY OPERATIONS',
    title: 'Core tasks run themselves.',
    description: 'Acts like an operations coordinator: sorts routine tasks, tracks work, and prepares simple updates.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'rings',
    category: 'systems',
  },
  {
    id: 'email-marketing',
    number: '06',
    label: 'EMAIL MARKETING',
    title: 'Campaigns that learn.',
    description: 'Acts like an email marketer: plans campaigns, prepares sends, and watches what should improve.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'spark',
    category: 'systems',
  },
  {
    id: 'ai-research',
    number: '07',
    label: 'AI RESEARCH',
    title: 'Weeks of insight in hours.',
    description: 'Acts like a research analyst: gathers customer, competitor, and market notes you can act on.',
    status: 'LIVE',
    metric: 'BRAND READY',
    viz: 'countdown',
    category: 'systems',
  },
  {
    id: 'compliance',
    number: '09',
    label: 'COMPLIANCE MONITORING',
    title: 'Nothing critical gets missed.',
    description: 'Acts like a compliance coordinator: watches important requirements and flags what needs review.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'deadlines',
    category: 'systems',
  },
  {
    id: 'distribution-insight',
    number: '10',
    label: 'DISTRIBUTION & INSIGHT',
    title: 'One loop for everything.',
    description: 'Acts like a distribution manager: connects publishing, search visibility, and reporting in one place.',
    status: 'LIVE',
    metric: 'BRAND READY',
    viz: 'table',
    category: 'systems',
  },
  {
    id: 'rapid-product',
    number: '11',
    label: 'RAPID PRODUCT DEV',
    title: 'Concept to launch, fast.',
    description: 'Acts like a product builder: turns a clear request into a useful tool, page, or workflow.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'pipeline',
    category: 'systems',
  },
  {
    id: 'self-improving',
    number: '12',
    label: 'SELF-IMPROVING',
    title: 'Every run smarter.',
    description: 'Acts like a process manager: learns from results and improves the next version of the work.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'delta',
    category: 'systems',
  },
  {
    id: 'reddit-community',
    number: '13',
    label: 'REDDIT & COMMUNITY',
    title: 'Conversations to be in.',
    description: 'Acts like a community manager: finds useful conversations and drafts replies for approval.',
    status: 'LIVE',
    metric: 'BRAND READY',
    viz: 'threads',
    category: 'systems',
  },
  {
    id: 'seo-content',
    number: '14',
    label: 'SEO CONTENT',
    title: 'Keywords to capture.',
    description: 'Acts like an SEO writer: finds search topics and prepares drafts aimed at those opportunities.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'keywords',
    category: 'systems',
  },
  // ── Reserved add-on cards (mirror commented add-ons in StackedSlidesSection.jsx) ──
  {
    id: 'multi-agent-pipeline',
    number: '15',
    label: 'MULTI-AGENT PIPELINE',
    title: 'Scout, Scribe, Guardian, Reporter.',
    description: 'Runs a daily team of specialist agents that find signals, write the brief, check quality, and report back.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'segbars',
    category: 'systems',
  },
  {
    id: 'hyperlocal-signals',
    number: '16',
    label: 'HYPERLOCAL SIGNALS',
    title: 'Live multi-source intelligence.',
    description: 'Collects local and social signals so the brief understands what is happening around the business.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'spark',
    category: 'systems',
  },
  {
    id: 'platform-content-gen',
    number: '17',
    label: 'PLATFORM CONTENT GEN',
    title: 'Platform-native drafts.',
    description: 'Prepares channel-specific drafts so each platform gets copy that fits how people use it.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'threads',
    category: 'systems',
  },
  {
    id: 'brand-safety-gate',
    number: '18',
    label: 'BRAND SAFETY GATE',
    title: 'Four-check quality gate.',
    description: 'Reviews content before it goes out, checking brand fit, accuracy, and risky wording.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'deadlines',
    category: 'systems',
  },
  {
    id: 'founder-daily-brief',
    number: '19',
    label: 'FOUNDER DAILY BRIEF',
    title: 'One brief, every morning.',
    description: 'Packages the day into a clear founder brief with the main action, signals, and approved drafts.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'meetings',
    category: 'systems',
  },
  {
    id: 'admin-dashboard-history',
    number: '20',
    label: 'ADMIN & BRIEF HISTORY',
    title: 'Every run, on the record.',
    description: 'Keeps a record of every brief and run so progress, decisions, and changes are easy to review.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'table',
    category: 'systems',
  },
  {
    id: 'image-generation',
    number: '21',
    label: 'IMAGE GENERATION',
    title: 'Post images on autopilot.',
    description: 'Creates post images with brand assets, layout controls, and a preview before publishing.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'rings',
    category: 'systems',
  },
  {
    id: 'knowledge-file-config',
    number: '22',
    label: 'KNOWLEDGE FILE CONFIG',
    title: 'Four files, new vertical.',
    description: 'Lets a new brand use the same system by adding its facts, voice rules, and working notes.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'memory',
    category: 'systems',
  },
];
// Upgrade-overlay descriptions — mirror AUTOMATION_CAPABILITIES body text in
// StackedSlidesSection.jsx (including commented reserved cards) so dashboard
// blocked tiles align with homepage add-ons.
export const UPGRADE_TILE_DESCRIPTIONS = {
  'creative-pipelines':      'Acts like a content producer: drafts posts in the brand voice so the team can review faster.',
  'company-brain':           'Acts like an organized company librarian: keeps documents, notes, and context ready for use.',
  'knowledge-assistant':     'Acts like an internal assistant: answers team questions from approved company material.',
  'executive-support':       'Acts like an executive assistant: prepares meeting notes, context, and follow-up drafts.',
  'daily-operations':        'Acts like an operations coordinator: sorts routine tasks and prepares daily updates.',
  'email-marketing':         'Acts like an email marketer: plans, writes, schedules, and improves campaigns.',
  'ai-research':             'Acts like a research analyst: gathers customer, competitor, and market notes.',
  'financial-tax':           'Acts like a finance assistant: organizes transactions and prepares clean reporting inputs.',
  'compliance':              'Acts like a compliance coordinator: watches deadlines, filings, and review items.',
  'distribution-insight':    'Acts like a distribution manager: connects publishing, search visibility, and reporting.',
  'rapid-product':           'Acts like a product builder: turns a clear request into a useful tool or workflow.',
  'self-improving':          'Acts like a process manager: uses feedback to improve the next run of work.',
  'reddit-community':        'Acts like a community manager: finds useful discussions and drafts replies for review.',
  'seo-content':             'Acts like an SEO writer: finds search opportunities and prepares content directions.',
  'multi-agent-pipeline':    'Runs a daily specialist team that finds signals, writes the brief, checks quality, and reports back.',
  'hyperlocal-signals':      'Collects local and social context so content can respond to what is happening now.',
  'platform-content-gen':    'Prepares platform-specific drafts so each channel gets copy that fits the format.',
  'brand-safety-gate':       'Reviews content before publishing, checking accuracy, brand fit, and risky wording.',
  'founder-daily-brief':     'Packages the day into one clear brief with priorities, signals, and approved drafts.',
  'admin-dashboard-history': 'Keeps every run and brief on record so progress and past decisions are easy to review.',
  'image-generation':        'Creates branded post images with logo, layout, and text controls before publishing.',
  'knowledge-file-config':   'Sets up a new brand by adding its facts, voice rules, and working notes.',
};
// Upgrade-overlay titles — must match AUTOMATION_CAPABILITIES in StackedSlidesSection.jsx
// so dashboard blocked tiles align with homepage add-ons.
export const UPGRADE_TILE_TITLES = {
  'creative-pipelines':      'Creative Pipelines',
  'company-brain':           'Source Library',
  'knowledge-assistant':     'Internal Knowledge Assistant',
  'executive-support':       'Executive Support Automation',
  'daily-operations':        'Daily Operations Engine',
  'email-marketing':         'Email Marketing Automation',
  'ai-research':             'AI-Powered Research',
  'financial-tax':           'Financial & Tax Processing',
  'compliance':              'Compliance Monitoring',
  'distribution-insight':    'Distribution & Insight Automation',
  'rapid-product':           'Rapid Product Development',
  'self-improving':          'Self-Improving Systems',
  'reddit-community':        'Reddit & Community',
  'seo-content':             'SEO Content',
  'multi-agent-pipeline':    'Multi-Agent Intelligence Pipeline',
  'hyperlocal-signals':      'Hyperlocal Signal Aggregation',
  'platform-content-gen':    'Platform-Specific Content Generation',
  'brand-safety-gate':       'Brand Safety & Quality Gate',
  'founder-daily-brief':     'Founder-Facing Daily Brief',
  'admin-dashboard-history': 'Admin Dashboard & Brief History',
  'image-generation':        'Image Generation & Asset Management',
  'knowledge-file-config':   'Knowledge-File Client Configuration',
};
export const memoryNodes = Array.from({ length: 96 }, (_, index) => {
  if ([6, 23, 41, 55, 78].includes(index)) return 'hot';
  if (index % 3 === 0 || index % 7 === 0) return 'on';
  return '';
});
export const WORK_NEEDED_LABEL = 'Work is Needed';
export const CONTACT_HUMAN_LABEL = 'Contact your human in the loop';
export const MOCKUP_STUDIO_VIEWPORTS = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'tablet', label: 'Tablet' },
];
export const MOCKUP_STUDIO_BACKDROPS = [
  { id: 'home', label: 'Hitloop' },
  { id: 'graphite', label: 'Graphite' },
  { id: 'studio', label: 'Studio' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'teal', label: 'Teal' },
];
export const MOCKUP_STUDIO_TEMPLATES = [
  { id: 'spiral-in', label: 'Spiral In' },
  { id: 'hero-push', label: 'Hero Push-In' },
  { id: 'orbit-reveal', label: 'Orbit Reveal' },
  { id: 'showcase-loop', label: 'Showcase Loop' },
  { id: 'close-pan', label: 'Corner Tour' },
  { id: 'slow-drift', label: 'Slow Drift' },
];
// Real-world environment presets — same set the full Studio offers. Drives the
// rendered background + reflections. airport-terminal/desk/loft are photo scenes;
// studio/sunset are gradients (see services/studio-render/recipe.mjs ALLOWED_ENV_PRESETS).
export const MOCKUP_STUDIO_ENVIRONMENTS = [
  { id: 'loft', label: 'Loft' },
  { id: 'airport-terminal', label: 'Airport' },
  { id: 'desk', label: 'Desk' },
  { id: 'studio', label: 'Studio' },
  { id: 'sunset', label: 'Sunset' },
];
// The Studio's rich 8-keyframe camera templates don't exist server-side; the
// render service only knows these 3 CAMERA_PRESETS (recipe.mjs). Map each modal
// template to the closest server preset so the chosen move is honored.
export const MOCKUP_STUDIO_CAMERA_PRESET_MAP = {
  'spiral-in': 'push-in-hold',
  'hero-push': 'push-in-hold',
  'orbit-reveal': 'orbit-reveal',
  'showcase-loop': 'orbit-reveal',
  'close-pan': 'push-rotate-flat',
  'slow-drift': 'push-rotate-flat',
};
// Output dimensions per device so a tablet/phone isn't squished into a wide
// landscape frame (the "skew"). Desktop stays 16:10; tablet portrait; mobile reel.
export const MOCKUP_STUDIO_OUTPUT_BY_DEVICE = {
  desktop: { width: 1920, height: 1200 },
  tablet: { width: 1200, height: 1600 },
  mobile: { width: 1080, height: 1920 },
};
export const CUSTOM_DETAIL_CARD_IDS = new Set([
  'multi-device-view',
  // Full Page Images — its DESKTOP/TABLET/MOBILE capture tabs are the whole
  // detail panel; suppress the generic REPORT/SOLUTIONS/PROBLEMS/DATA tabs
  // that were stacking below them.
  'cross-device-images',
  // Social Preview — a single visual DATA panel (share image + brand assets +
  // metadata) replaces the generic REPORT/SOLUTIONS/PROBLEMS/DATA tabs.
  'social-preview',
  'brief',
  'audit-summary',
  'survey-status',
  'submit-custom-brief',
  'marketing-brief',
  'marketing-brief-doc',
  'newsletter',
  'brand-system',
  'industry',
  'knowledge-base',
  'client-brain',
  'client-brief',
  'client-mockup',
  'mockup-studio',
  'video-remix',
  'ui-teaser',
  'media-library',
  'client-site',
  'copywriter',
  'social-media-posting',
  'x-profile',
  'strategy-builder',
  'email-digest',
  'creative-brief-composer',
  'create-client',
  'operating-cost',
  'local-weather',
  // Conversation Intake + Scout Config slice cards — single top panel only,
  // no generic REPORT/DATA container at the bottom.
  'conversation-intake',
  'brand-keywords',
  'scout-focus',
  'watchlist',
  'platform-search',
  'social-signals',
  'business-model',
  'strategy-30',
  'archive-publishing',
]);
// Cards whose list-row icon is a pencil (editable/config) vs an eye (view-only,
// generated results). Anything not listed here defaults to the eye (view) icon.
export const CARD_ACTION_EDIT = new Set([
  'brand-keywords', 'watchlist', 'scout-focus', 'platform-search', 'social-signals',
  'conversation-intake', 'local-weather', 'business-model',
  'knowledge-base', 'client-brain', 'email-digest', 'creative-brief-composer', 'industry', 'create-client',
  'social-media-posting', 'strategy-30', 'strategy-builder', 'mockup-studio',
  'video-remix', 'media-library',
]);
// Brief card → composition key in features/scout-intake/brief-sections.cjs.
// Clicking an unlocked brief row previews that named brief via
// /api/dashboard/brief-preview?brief=<key>. Brief names mirror the agent nav;
// the former Competitor Brief folded into Marketing Director.
export const BRIEF_TYPE_BY_CARD = {
  'marketing-brief': 'executive-daily',
  'onboarding-brief': 'onboarding',
  'brief-marketing': 'marketing-director',
  'brief-strategy': 'social-media-manager',
  'brief-performance': 'website-developer',
};
export const BRIEF_CARD_PREVIEW_TYPES = {
  'onboarding-brief': 'onboarding',
  'brief-marketing': 'marketing-director',
  'brief-strategy': 'social-media-manager',
  'brief-performance': 'website-developer',
};
// Which bucket(s) each brief card is visible in. The fleet preview fetch is gated
// on these so we don't fire 3-4 concurrent full brief renders (~30s each on a
// heavy client) for cards the user isn't even looking at — that contention was
// what made the Creative Brief card crawl on the default Deliverables bucket.
export const BRIEF_CARD_PREVIEW_BUCKETS = {
  'onboarding-brief': ['deliverables', 'brief'],
  'brief-marketing': ['brief'],
  'brief-strategy': ['brief'],
  'brief-performance': ['brief'],
};
// DELIVERABLES bucket — one uniform, length-matched blurb per card. On the
// deliverables face every card renders its entry here (data-aware dynamic/scribe
// copy is suppressed there), so the green-indicator grid reads at a single height.
// Cards keep their live, data-aware copy in their home buckets. Budget: ~18-20
// words / 2 lines, benefit-triplet voice. Single source of truth for this face.
export const DELIVERABLES_CARD_COPY = {
  'onboarding-brief':    'Establishes the starting point. Bryan reviews your site, brand, content, and share presence so the first conversation starts with context, not guesswork.',
  'mockup-studio':       'Turns your site into a short social-ready video, showing how your brand reads in motion and giving you content you can actually use.',
  'multi-device-view':   'Renders your site across desktop, tablet, and mobile so layout issues, hierarchy problems, and first-impression gaps show up fast.',
  'social-preview':      'Shows how your brand appears when shared, catches link preview issues, and helps your content travel cleaner across platforms.',
  'cross-device-images': 'Captures your pages across key screen sizes and packages them into a visual reference set for review, handoff, and creative direction.',
  'post-me':             'Builds a ready-to-share post from your brief and brand, shaped to sound human and make the strongest point clearly.',
};
export const buildUnavailableDescription = (subject) => `Insufficient source evidence to determine ${subject} reliably.`;
export const fmtBytes = (bytes) => {
  if (bytes == null) return '—';
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000)     return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
};
export const buildWorkNeededRows = (reason) => [
  { key: 'status', label: 'Status', value: WORK_NEEDED_LABEL },
  { key: 'next-step', label: 'Next Step', value: CONTACT_HUMAN_LABEL },
  ...(reason ? [{ key: 'reason', label: 'Reason', value: reason }] : []),
];
export const PRICING_MODAL_OPTIONS = [
  {
    id: 'onboarded',
    label: 'Onboarded',
    price: 'Current',
    summary: 'Existing free dashboard access for intake, brand intelligence, and baseline operating visibility.',
  },
  {
    id: 'growth',
    label: 'Growth',
    price: 'Placeholder',
    summary: 'Expanded automation, deeper research loops, and higher-touch publishing support. Final pricing content will be updated later.',
  },
  {
    id: 'operator',
    label: 'Operator',
    price: 'Placeholder',
    summary: 'Full-stack operating support across content, intelligence, and system workflows. Final pricing content will be updated later.',
  },
];
