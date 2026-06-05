'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { flushSync } from 'react-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);
import Link from 'next/link';
import {
  ArrowRightLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Database,
  House,
  ChartColumnIncreasing,
  LaptopMinimalCheck,
  Lock,
  MessageSquareMore,
  Pencil,
  Search,
  Send,
  Settings2,
  Workflow,
  Globe,
  Images,
  Radar,
  X as XIcon,
} from 'lucide-react';
import { BrainIcon } from './components/ui/brain';
import { useAuth } from './AuthContext';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from './firebase';
import { internalPageGlassCardStyle } from './pageSurfaceSystem';
import InternalPageBackground from './InternalPageBackground';
import onboardingConfig from './onboarding/questions.config.cjs';
import { resolveAnalyzerSource, buildCardDescription, buildModuleStateDescription } from './features/scout-intake/card-description-builder.mjs';
import { deriveFindings } from './features/scout-intake/derived-findings.mjs';
import ModuleCardControls from './components/dashboard/ModuleCardControls';
import { AdminEmailDigestView, AdminEmailSettingsView, AdminCreateClientView } from './components/AdminEmailModals';

const LeadGenDashboard = dynamic(() => import('./components/dashboard/LeadGenDashboard'), {
  loading: () => null,
  ssr: false,
});

const OnboardingChatModal = dynamic(() => import('./onboarding/OnboardingChatModal'), {
  loading: () => null,
});

const TileDetailAnalysisContent = dynamic(() => import('./components/dashboard/TileDetailAnalysisContent'), {
  loading: () => null,
});

const BrandSystemChat = dynamic(() => import('./components/dashboard/BrandSystemChat'), {
  loading: () => null,
  ssr: false,
});

const BrandSystemBuildModal = dynamic(() => import('./components/dashboard/BrandSystemBuildModal'), {
  loading: () => null,
  ssr: false,
});

const SocialPostingPanel = dynamic(() => import('./components/dashboard/SocialPostingPanel'), {
  loading: () => null,
  ssr: false,
});

const StrategyBuilderCard = dynamic(() => import('./components/dashboard/StrategyBuilderCard'), {
  loading: () => null,
  ssr: false,
});

const KnowledgeBaseCard = dynamic(() => import('./components/dashboard/KnowledgeBaseCard'), {
  loading: () => null,
  ssr: false,
});

const MarketCategoryPanel = dynamic(() => import('./components/dashboard/MarketCategoryPanel'), {
  loading: () => null,
  ssr: false,
});

const LeadgenModulePanel = dynamic(() => import('./components/dashboard/leadgen/LeadgenModulePanel'), {
  loading: () => null,
  ssr: false,
});

const VisualDnaModal = dynamic(() => import('./components/dashboard/leadgen/VisualDnaModal'), {
  loading: () => null,
  ssr: false,
});

// Entry-flow survey surfaces every question step (excludes the summary, which
// is added in Phase 4). Ordered by the `order` field in questions.config.cjs.
const ONBOARDING_ENTRY_STEPS = onboardingConfig.QUESTION_STEPS;
const IMPERSONATE_STORAGE_KEY = 'dashboard.impersonateClientId';

const ONBOARDING_CARD_IDS = new Set([
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
const PENDING_DASHBOARD_SIGNUP_KEY = 'pending-dashboard-signup';
const DASHBOARD_BOOTSTRAP_TIMEOUT_MS = 20_000;
const DASHBOARD_BOOTSTRAP_CACHE_PREFIX = 'dashboard-bootstrap-cache-v1';
const MARKETING_BRIEF_SOURCE_PLATFORMS = [
  { key: 'web', label: 'Web / News', status: 'ready', description: 'General web search, news, launches, blogs, and indexed coverage.' },
  { key: 'x', label: 'X / Twitter', status: 'ready', description: 'KOL commentary, reply windows, and fast-moving social narratives.' },
  { key: 'reddit', label: 'Reddit', status: 'ready', description: 'Community threads, recommendation requests, pain points, and buyer language.' },
  { key: 'instagram', label: 'Instagram', status: 'ready', description: 'Creator and brand content surfaced through available social search/context.' },
  { key: 'youtube', label: 'YouTube', status: 'available', description: 'Video commentary and creator discussions when social search is configured.' },
  { key: 'tiktok', label: 'TikTok', status: 'available', description: 'Short-form trend signals when social search is configured.' },
  { key: 'hackernews', label: 'Hacker News', status: 'available', description: 'Tech/startup discussion for relevant clients.' },
];
const DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS = ['web', 'x', 'reddit', 'hackernews', 'instagram'];

function classifyMarketingBriefPlatform(url, explicitPlatform) {
  if (explicitPlatform) {
    const p = String(explicitPlatform).toLowerCase();
    if (p === 'twitter') return 'x';
    if (['web', 'x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews'].includes(p)) return p;
  }
  const u = String(url || '').toLowerCase();
  if (u.includes('twitter.com') || u.includes('x.com/')) return 'x';
  if (u.includes('reddit.com')) return 'reddit';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('news.ycombinator.com')) return 'hackernews';
  return 'web';
}

function deriveMarketingBriefPerPlatformResults(agentData, selectedPlatforms) {
  const platforms = Array.isArray(selectedPlatforms) && selectedPlatforms.length
    ? selectedPlatforms
    : DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS;
  const buckets = Object.fromEntries(platforms.map((k) => [k, []]));
  const push = (key, item) => { if (buckets[key]) buckets[key].push(item); };

  if (agentData && typeof agentData === 'object') {
    (agentData.kolActivity || []).forEach((row) => {
      if (!row) return;
      push(classifyMarketingBriefPlatform(row.url, row.platform), {
        title: row.name || row.content || 'KOL signal',
        summary: row.content || '',
        url: row.url || null,
        kind: 'KOL',
      });
    });
    (agentData.brandMentions || []).forEach((row) => {
      if (!row) return;
      push(classifyMarketingBriefPlatform(row.url, row.source), {
        title: row.author || row.source || 'Mention',
        summary: row.content || '',
        url: row.url || null,
        kind: 'Mention',
      });
    });
    (agentData.competitorIntel || []).forEach((row) => {
      if (!row) return;
      push(classifyMarketingBriefPlatform(row.url, null), {
        title: row.competitor || 'Competitor move',
        summary: row.finding || '',
        url: row.url || null,
        kind: 'Competitor',
      });
    });
    (agentData.viralOpportunities?.opportunities || []).forEach((row) => {
      if (!row) return;
      push(classifyMarketingBriefPlatform(row.url, null), {
        title: row.injectionAngle || row.conversation || 'Viral window',
        summary: row.conversation || row.suggestedReply || '',
        url: row.url || null,
        kind: 'Viral',
      });
    });
    (agentData.categoryTrends || []).forEach((row) => {
      if (!row) return;
      push('web', {
        title: row.trend || 'Category trend',
        summary: row.detail || '',
        url: null,
        kind: 'Trend',
      });
    });
  }

  const out = {};
  platforms.forEach((k) => {
    out[k] = { count: buckets[k].length, items: buckets[k].slice(0, 5) };
  });
  return out;
}

function buildDefaultMarketingBriefConfig(client, dashboardState) {
  const companyName = client?.companyName || dashboardState?.clientName || 'the brand';
  const websiteUrl = client?.websiteUrl || '';
  let hostname = '';
  try { hostname = websiteUrl ? new URL(websiteUrl).hostname.replace(/^www\./, '') : ''; } catch { hostname = ''; }
  const brandQuery = [`"${companyName}"`, hostname ? `"${hostname}"` : null, hostname ? `site:${hostname}` : null]
    .filter(Boolean)
    .join(' OR ');
  return {
    sourceFocus: `Find timely market signals, founder-relevant news, KOL commentary, and social conversations ${companyName} can credibly participate in. Prioritize X/Twitter-ready angles.`,
    scoutInstructions: [
      'Prioritize live community momentum, current news, sentiment shifts, and moments where the brand can credibly enter the conversation.',
      'Treat KOL posts, X/Twitter discussions, Reddit threads, launch announcements, and comparison conversations as high-value signals.',
      'Separate [LIVE] signals from [BACKGROUND] context.',
      'The final brief should help a founder decide what to say today, where to say it, and why now.',
    ].join('\n'),
    freshnessDays: 1,
    sourcePlatforms: DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS,
    kols: '',
    competitors: '',
    agentDataTemplate: `{
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","url":"<post permalink — not profile or homepage>"}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","url":"<post permalink — not profile or homepage>"}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"...","url":"<post or article permalink, optional>"}],
  "kolActivity": [{"name":"...","platform":"x","content":"...","followers":"...","sentiment":"...","url":"<post permalink — the specific tweet/comment, not the profile>","profileUrl":"<author profile URL, optional>"}],
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"..."}],
  "viralOpportunities": {
    "found": true,
    "opportunities": [{"conversation":"...","url":"<permalink of the specific conversation/thread to engage with>","injectionAngle":"...","authenticity":"high|medium|low","windowHours":0,"suggestedReply":"..."}],
    "searchedFor": ["trigger 1","trigger 2"]
  }
}`,
    searches: [
      { label: 'BRAND', query: brandQuery || `"${companyName}"`, goal: 'Find direct brand mentions, web coverage, and conversation hooks.' },
      { label: 'COMPETITORS', query: `${companyName} competitors OR alternatives OR launches`, goal: 'Find competitor launches, sentiment shifts, and adjacent attention pockets.' },
      { label: 'CATEGORY', query: `${companyName} industry news OR market trends`, goal: 'Capture broader category movement and external narratives the brand can react to.' },
      { label: 'KOLS + SOCIAL', query: `${companyName} Twitter OR X OR influencers OR KOLs`, goal: 'Find creator commentary, viral posts, and reply windows.' },
      { label: 'VIRAL WINDOWS', query: `best ${companyName} alternatives OR problems OR recommendations`, goal: 'Find conversations where the brand can contribute credibly.' },
    ],
    scribeTone: `Tone: sharp, timely, founder-ready, specific to ${companyName}.\nPrioritize concrete market signals, KOL windows, and X/Twitter-ready angles. Never use generic hype language, forced urgency, or empty superlatives.`,
    scribeHardConstraints: [
      'Every piece connects to Scout\'s priority action',
      'Zero live signal = create signal, not react to it',
      'Never fabricate competitor activity',
      'Never make claims Scout did not surface',
      'Prioritize X/Twitter-ready hooks and credible reply windows',
      'Make the Content Angle useful to a founder deciding what to say today',
      'Each output complete and ready to copy-paste',
    ].join('\n'),
    guardianReviewerContext: `${companyName} — review for factual accuracy against the brand's known positioning and for brand-voice match. Flag forced hype, unsupported claims, or off-tone phrasing.`,
    guardianRestrictedPatterns: '',
  };
}

function joinConfigList(value) {
  return Array.isArray(value) ? value.join('\n') : String(value || '');
}

function formatEstimateMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '0';
}

function formatEstimateLineItems(items) {
  const rows = Array.isArray(items) ? items : [];
  return rows
    .map((item) => [
      item?.label || '',
      item?.description || '',
      formatEstimateMoney(item?.unitPrice ?? item?.price),
      formatEstimateMoney(item?.quantity || 1),
    ].join(' | '))
    .join('\n');
}

function parseEstimateLineItems(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line, index) => {
      const [label, description, unitPrice, quantity] = line.split('|').map((part) => part.trim());
      if (!label) return null;
      return {
        id: `line-${index + 1}`,
        label,
        description: description || '',
        unitPrice: Number(unitPrice || 0),
        quantity: Number(quantity || 1) || 1,
      };
    })
    .filter(Boolean);
}

function formatEstimateAddOns(items) {
  const rows = Array.isArray(items) ? items : [];
  return rows
    .map((item) => [
      item?.label || '',
      item?.description || '',
      formatEstimateMoney(item?.price ?? item?.unitPrice),
    ].join(' | '))
    .join('\n');
}

function parseEstimateAddOns(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line, index) => {
      const [label, description, price] = line.split('|').map((part) => part.trim());
      if (!label) return null;
      return {
        id: `addon-${index + 1}`,
        label,
        description: description || '',
        price: Number(price || 0),
      };
    })
    .filter(Boolean);
}

function buildDefaultEstimateBriefDraft(client) {
  const companyName = client?.companyName || client?.businessName || client?.name || 'Client';
  return {
    offerSummary: `Website redesign and launch support for ${companyName}.`,
    pricingModel: 'line_items',
    currency: 'USD',
    lineItemsText: [
      'Website redesign | Client-facing homepage redesign based on the generated preview, responsive layout, conversion structure, and launch-ready handoff. | 4500 | 1',
      'Launch QA and handoff | Final review, mobile checks, metadata review, and implementation notes for launch. | 750 | 1',
    ].join('\n'),
    timeline: '2-4 weeks after approval',
    scopeText: [
      'Homepage redesign based on the generated preview direction.',
      'Responsive implementation guidance for desktop, tablet, and mobile.',
      'Conversion-focused page structure, primary CTA treatment, and handoff notes.',
    ].join('\n'),
    exclusionsText: [
      'Third-party platform fees, paid media, and hosting subscriptions are not included unless listed as line items.',
      'New brand identity, logo design, or custom photography are separate unless explicitly included.',
    ].join('\n'),
    termsText: [
      'Estimate is valid for 14 days.',
      'Final production scope may adjust if new requirements are added after approval.',
    ].join('\n'),
    paymentScheduleText: [
      '50% due to begin work.',
      '50% due before final handoff or launch.',
    ].join('\n'),
    optionalAddOnsText: [
      'Monthly maintenance | Small content updates, uptime checks, and light technical support. | 650',
      'SEO content support | Monthly content and AI-search visibility improvements. | 1200',
    ].join('\n'),
    estimateTone: 'clear, direct, premium, client-facing',
    sendMessageInstructions: 'Write a concise email that references the preview URL and next step.',
  };
}

function hydrateEstimateBriefDraft(config, client) {
  const fallback = buildDefaultEstimateBriefDraft(client);
  const next = config || {};
  return {
    ...fallback,
    ...next,
    lineItemsText: Array.isArray(next.lineItems) ? formatEstimateLineItems(next.lineItems) : (next.lineItemsText || fallback.lineItemsText),
    scopeText: Array.isArray(next.scope) ? next.scope.join('\n') : (next.scopeText || fallback.scopeText),
    exclusionsText: Array.isArray(next.exclusions) ? next.exclusions.join('\n') : (next.exclusionsText || fallback.exclusionsText),
    termsText: Array.isArray(next.terms) ? next.terms.join('\n') : (next.termsText || fallback.termsText),
    paymentScheduleText: Array.isArray(next.paymentSchedule) ? next.paymentSchedule.join('\n') : (next.paymentScheduleText || fallback.paymentScheduleText),
    optionalAddOnsText: Array.isArray(next.optionalAddOns) ? formatEstimateAddOns(next.optionalAddOns) : (next.optionalAddOnsText || fallback.optionalAddOnsText),
  };
}

function buildEstimateBriefConfigPayload(draft) {
  return {
    enabled: true,
    offerSummary: draft.offerSummary || '',
    pricingModel: draft.pricingModel || 'line_items',
    currency: draft.currency || 'USD',
    lineItems: parseEstimateLineItems(draft.lineItemsText),
    timeline: draft.timeline || '',
    scope: String(draft.scopeText || '').split(/\n+/).map((item) => item.trim()).filter(Boolean),
    exclusions: String(draft.exclusionsText || '').split(/\n+/).map((item) => item.trim()).filter(Boolean),
    terms: String(draft.termsText || '').split(/\n+/).map((item) => item.trim()).filter(Boolean),
    paymentSchedule: String(draft.paymentScheduleText || '').split(/\n+/).map((item) => item.trim()).filter(Boolean),
    optionalAddOns: parseEstimateAddOns(draft.optionalAddOnsText),
    estimateTone: draft.estimateTone || '',
    sendMessageInstructions: draft.sendMessageInstructions || '',
  };
}

function cloneJson(value) {
  try { return JSON.parse(JSON.stringify(value || null)); } catch { return value || null; }
}

function buildBrandSnapshotDraft(styleGuide) {
  const sg = cloneJson(styleGuide) || {};
  return {
    brandMark: {
      logoUrl: sg.assets?.logoUrl || '',
      alt: sg.assets?.logoAlt || 'Brand mark',
    },
    colors: {
      primary: {
        hex: sg.colors?.primary?.hex || '',
        role: sg.colors?.primary?.role || 'Primary brand color',
      },
      secondary: {
        hex: sg.colors?.secondary?.hex || '',
        role: sg.colors?.secondary?.role || 'Secondary / support color',
      },
      tertiary: {
        hex: sg.colors?.tertiary?.hex || '',
        role: sg.colors?.tertiary?.role || 'Accent color',
      },
      neutral: {
        hex: sg.colors?.neutral?.hex || '',
        role: sg.colors?.neutral?.role || 'Background / neutral color',
      },
    },
    typography: {
      headingSystem: {
        fontFamily: sg.typography?.headingSystem?.fontFamily || '',
        fontWeight: sg.typography?.headingSystem?.fontWeight || '',
        fontSize: sg.typography?.headingSystem?.fontSize || '',
      },
      bodySystem: {
        fontFamily: sg.typography?.bodySystem?.fontFamily || '',
        fontWeight: sg.typography?.bodySystem?.fontWeight || '',
        fontSize: sg.typography?.bodySystem?.fontSize || '',
      },
    },
    gradient: {
      from: sg.gradient?.from || sg.colors?.primary?.hex || '',
      to: sg.gradient?.to || sg.colors?.secondary?.hex || sg.colors?.neutral?.hex || '',
      angle: sg.gradient?.angle || '135deg',
    },
    summary: sg.summary || '',
  };
}

function draftToStyleGuide(draft, fallbackStyleGuide = null) {
  const fallback = cloneJson(fallbackStyleGuide) || {};
  return {
    ...fallback,
    confidence: 'manual',
    source: 'brand-snapshot-data-tab',
    updatedByUser: true,
    summary: draft?.summary || fallback.summary || '',
    assets: {
      ...(fallback.assets || {}),
      logoUrl: draft?.brandMark?.logoUrl || '',
      logoAlt: draft?.brandMark?.alt || 'Brand mark',
    },
    colors: {
      ...(fallback.colors || {}),
      primary:   { ...(fallback.colors?.primary || {}),   ...(draft?.colors?.primary || {}) },
      secondary: { ...(fallback.colors?.secondary || {}), ...(draft?.colors?.secondary || {}) },
      tertiary:  { ...(fallback.colors?.tertiary || {}),  ...(draft?.colors?.tertiary || {}) },
      neutral:   { ...(fallback.colors?.neutral || {}),   ...(draft?.colors?.neutral || {}) },
    },
    typography: {
      ...(fallback.typography || {}),
      headingSystem: { ...(fallback.typography?.headingSystem || {}), ...(draft?.typography?.headingSystem || {}) },
      bodySystem:    { ...(fallback.typography?.bodySystem || {}),    ...(draft?.typography?.bodySystem || {}) },
    },
    gradient: {
      ...(fallback.gradient || {}),
      ...(draft?.gradient || {}),
    },
  };
}

function colorInputValue(value, fallback = '#000000') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.slice(1).split('').map((ch) => `${ch}${ch}`).join('')}`;
  }
  return fallback;
}
import {
  trackDashboardCreated,
  trackPipelineRerun,
  trackPipelineCancelled,
  trackTileOpened,
  trackThemeChanged,
  trackTierModalOpened,
  trackSignOut,
} from '@/lib/analytics';

// ── Free-tier module IDs ──────────────────────────────────────────────────────
// These tiles reflect what the free-tier intake actually produces.
// All others are rendered as PREVIEW / PRO TIER.
const FREE_TIER_TILE_IDS = new Set([
  'creative-pipelines',
  'ai-research',
  'distribution-insight',
  'reddit-community',
]);

// Dev mock for the style-guide tile — used when extractor is not yet wired.
// Matches the shape returned by synthesizeStyleGuide() in normalize.js.
// Remove SG_MOCK fallback once visualIdentity.styleGuide is populated by the pipeline.
const SG_MOCK = {
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

function sanitizeStylePreviewLabel(value) {
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
function _sgEasingPath(easing, w, h, roundTrip = false) {
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
function _sgEasingSpline(easing) {
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
function _sgGsapName(easing, isGsap) {
  const raw = (easing || '').trim();
  if (raw.length > 24) return 'cubic-bezier';
  if (!isGsap) return raw;
  const CSS_TO_GSAP = {
    'ease': 'power1.inOut', 'ease-in': 'power1.in',
    'ease-out': 'power1.out', 'ease-in-out': 'power1.inOut', 'linear': 'none',
  };
  return CSS_TO_GSAP[raw.toLowerCase()] || raw;
}

const tiles = [
  {
    id: 'creative-pipelines',
    number: '01',
    label: 'CREATIVE PIPELINES',
    title: 'Content that sounds like you.',
    description: 'Posts drafted in real time, aligned to your brand voice and audience.',
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
    description: 'Your entire knowledge stack indexed, organized, and instantly queryable.',
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
    description: 'Team asks a question; system pulls the answer directly from your own docs.',
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
    description: 'Every meeting pre-briefed with full context loaded before you sit down.',
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
    description: 'Triage, task tracking, and reports — runs every day without oversight.',
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
    description: 'Campaigns built, scheduled, and optimized across regions from one system.',
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
    description: 'Consumer insights, competitive analysis, and market validation — in hours.',
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
    description: 'Deadlines, filings, and rules — monitored daily so nothing slips through.',
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
    description: 'Publishing, SEO fixes, and rankings — unified into one continuous system.',
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
    description: 'Tools and integrations scoped, built, and shipped from a single request.',
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
    description: 'Tracks outcomes and refines execution rules automatically from feedback.',
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
    description: 'Finds relevant threads and drafts contextual replies — queued for review.',
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
    description: 'Surfaces content gaps and delivers drafts aligned to your keyword targets.',
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
    description: 'Four-agent pipeline running daily — Scout, Scribe, Guardian, and Reporter.',
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
    description: 'X, Instagram, Reddit, reviews, and weather — normalized and synthesized.',
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
    description: 'Instagram, X, Facebook, Discord — formatted and voiced for each channel.',
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
    description: 'Restricted terms, competitor mentions, factual accuracy, voice scoring.',
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
    description: 'Priority action, signals, and QA-approved drafts — delivered on schedule.',
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
    description: 'Real-time dashboard and complete archive of every brief and run on record.',
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
    description: 'Canvas generator with logo placement, text controls, and a live preview.',
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
    description: 'Swap JSON knowledge files to onboard a brand — no code changes.',
    status: 'PREVIEW',
    metric: 'CUSTOMIZATION',
    viz: 'memory',
    category: 'systems',
  },
];

// Upgrade-overlay descriptions — mirror AUTOMATION_CAPABILITIES body text in
// StackedSlidesSection.jsx (including commented reserved cards) so dashboard
// blocked tiles align with homepage add-ons.
const UPGRADE_TILE_DESCRIPTIONS = {
  'creative-pipelines':      "Automates content creation in real time, aligning every post with your brand's voice while driving consistent engagement.",
  'company-brain':           'Centralizes your entire operating stack into a structured, searchable system that powers faster decisions and smarter execution.',
  'knowledge-assistant':     'Instantly answers team questions by pulling from your documents, conversations, and data—eliminating bottlenecks and repetitive work.',
  'executive-support':       'Prepares meetings, surfaces insights, and drafts communications so you walk into every decision fully informed.',
  'daily-operations':        'Runs core business tasks automatically—email triage, task tracking, reporting, and team updates—without manual oversight.',
  'email-marketing':         'Builds, schedules, and optimizes campaigns across regions while learning and improving from feedback over time.',
  'ai-research':             'Generates deep consumer insights, competitive analysis, and market validation in hours instead of weeks.',
  'financial-tax':           'Organizes transactions, corrects discrepancies, and produces reporting-ready outputs aligned with accounting workflows.',
  'compliance':              'Continuously checks deadlines, filings, and regulatory requirements to ensure nothing critical is missed.',
  'distribution-insight':    'Unifies social publishing, SEO fixes, search visibility, and performance reporting into one continuous system that surfaces what to ship, where to publish, and what to improve next.',
  'rapid-product':           'Builds and deploys functional tools, integrations, and experiences from concept to launch in a fraction of the time.',
  'self-improving':          'Continuously refines workflows, tools, and outputs based on feedback, increasing performance over time.',
  'reddit-community':        'Finds relevant threads and drafts reply ideas and post concepts for review before publishing.',
  'seo-content':             'Surfaces keyword opportunities and drafts landing pages, blog outlines, and content directions for approval.',
  'multi-agent-pipeline':    'A four-stage agent architecture — Scout, Scribe, Guardian, Reporter — runs automatically each day, taking raw market data from five sources and producing a founder-ready content brief with zero manual input.',
  'hyperlocal-signals':      'Scout pulls live data from X/Twitter, Instagram, Reddit, customer reviews, and weather APIs, normalizes them into a unified intelligence format, and trims context to ~5K tokens before synthesis — optimized to under $0.10 per full run.',
  'platform-content-gen':    "Scribe reads the day's brief and produces ready-to-publish drafts for Instagram, X/Twitter, Facebook, and Discord — each formatted to platform conventions and constrained by brand voice rules defined in client knowledge files.",
  'brand-safety-gate':       'Guardian runs four sequential validation checks on every piece of generated content: restricted term scanning, competitor mention detection, factual accuracy, and brand voice scoring — outputting a readiness verdict and 0–100 quality score before anything moves forward.',
  'founder-daily-brief':     "Reporter transforms the day's intelligence, content drafts, and QA results into a formatted HTML briefing — with operational context, review insights, Reddit signals, competitor activity, and content opportunities — delivered to the admin dashboard on schedule.",
  'admin-dashboard-history': 'A real-time web dashboard surfaces the latest pipeline run: priority action, weather impact, content angle, Guardian verdict, and cost per run. A full archive of past runs lets the team compare briefs, track signal trends, and trigger fresh runs on demand.',
  'image-generation':        'A canvas-based generator handles post image production — with configurable presets, logo placement controls, and live preview. Completed renders upload to Firebase Storage and attach automatically to the current brief run.',
  'knowledge-file-config':   'The entire system adapts to a new client by swapping four JSON files: brand voice rules, intelligence config, business facts, and a restricted-terms glossary. No code changes required to onboard a new brand or vertical.',
};

// Upgrade-overlay titles — must match AUTOMATION_CAPABILITIES in StackedSlidesSection.jsx
// so dashboard blocked tiles align with homepage add-ons.
const UPGRADE_TILE_TITLES = {
  'creative-pipelines':      'Creative Pipelines',
  'company-brain':           'Company Brain',
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

const memoryNodes = Array.from({ length: 96 }, (_, index) => {
  if ([6, 23, 41, 55, 78].includes(index)) return 'hot';
  if (index % 3 === 0 || index % 7 === 0) return 'on';
  return '';
});

const WORK_NEEDED_LABEL = 'Work is Needed';
const CONTACT_HUMAN_LABEL = 'Contact your human in the loop';
const CUSTOM_DETAIL_CARD_IDS = new Set([
  'multi-device-view',
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
  'client-brief',
  'client-mockup',
  'client-site',
  'social-media-posting',
  'strategy-builder',
  'email-digest',
  'email-settings',
  'create-client',
]);

const buildUnavailableDescription = (subject) => `Insufficient source evidence to determine ${subject} reliably.`;

const fmtBytes = (bytes) => {
  if (bytes == null) return '—';
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000)     return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
};

const buildWorkNeededRows = (reason) => [
  { key: 'status', label: 'Status', value: WORK_NEEDED_LABEL },
  { key: 'next-step', label: 'Next Step', value: CONTACT_HUMAN_LABEL },
  ...(reason ? [{ key: 'reason', label: 'Reason', value: reason }] : []),
];

const PRICING_MODAL_OPTIONS = [
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

function readImpersonateClientId() {
  if (typeof window === 'undefined') return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('as');
    if (fromUrl) {
      window.sessionStorage.setItem(IMPERSONATE_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return window.sessionStorage.getItem(IMPERSONATE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function writeImpersonateClientId(clientId) {
  if (typeof window === 'undefined') return;
  try {
    if (clientId) window.sessionStorage.setItem(IMPERSONATE_STORAGE_KEY, clientId);
    else window.sessionStorage.removeItem(IMPERSONATE_STORAGE_KEY);
  } catch {}
}

function withImpersonation(path, clientId) {
  if (!clientId) return path;
  const [base, hash = ''] = String(path).split('#');
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}as=${encodeURIComponent(clientId)}${hash ? `#${hash}` : ''}`;
}

function briefSlugify(value, fallback = 'custom-brief') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return slug || fallback;
}

function escapeHtmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function titlePdfFileName(value, fallback = 'Custom Brief') {
  const base = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  const safeBase = base || fallback;
  return `${safeBase.slice(0, 120)}.pdf`;
}

function withDownloadParam(url) {
  const value = String(url || '');
  if (!value) return '';
  return `${value}${value.includes('?') ? '&' : '?'}download=1`;
}

function buildCustomBriefStarterHtml(client) {
  const clientName = escapeHtmlText(client?.companyName || client?.name || client?.dashboardTitle || 'Client Name');
  const prepared = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${clientName} Custom Brief</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Doto:wght@900&family=Space+Grotesk:wght@300;400;600&family=Space+Mono&display=swap" rel="stylesheet">
  <style>
    :root { --ink:#0a0a0a; --soft:#5a5346; --line:rgba(212,196,171,.65); --card:rgba(255,255,255,.45); }
    * { box-sizing: border-box; }
    body { margin:0; color:var(--ink); font-family:'Space Grotesk',sans-serif; background:radial-gradient(700px 420px at 0% 4%, rgba(255,120,90,.22) 0%, transparent 65%),radial-gradient(620px 380px at 100% 18%, rgba(176,90,255,.18) 0%, transparent 65%),linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%); }
    .cover { min-height:100vh; padding:40px; display:flex; flex-direction:column; justify-content:space-between; }
    .top { display:flex; justify-content:space-between; gap:24px; font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.12em; text-transform:uppercase; }
    h1 { font-family:'Doto',monospace; font-size:clamp(56px,14vw,180px); line-height:.82; margin:0; text-transform:uppercase; }
    .sub { max-width:760px; font-size:clamp(20px,3vw,36px); line-height:1.1; color:var(--soft); }
    section { padding:80px 40px; }
    .card { border:1px solid var(--line); background:var(--card); border-radius:18px; padding:28px; max-width:1000px; }
    .label { font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:var(--soft); }
    h2 { font-size:clamp(32px,7vw,86px); line-height:.9; margin:16px 0; font-family:'Doto',monospace; text-transform:uppercase; }
  </style>
</head>
<body>
  <main>
    <div class="cover">
      <div class="top"><span>Bryan Balli</span><span>Prepared ${prepared}</span></div>
      <h1>${clientName}</h1>
      <p class="sub">Custom project brief. Replace this text with the recommendation, estimate, and next steps.</p>
    </div>
    <section>
      <div class="card">
        <div class="label">Recommendation</div>
        <h2>Project Direction</h2>
        <p>Paste the final brief content here. Keep the language clear, direct, and easy to act on.</p>
      </div>
    </section>
  </main>
</body>
</html>`;
}

function getBootstrapCacheKey(user, impersonateId = null) {
  const uid = user?.uid || user?.email || 'anonymous';
  return `${DASHBOARD_BOOTSTRAP_CACHE_PREFIX}:${uid}:${impersonateId || 'self'}`;
}

function readCachedDashboardBootstrap(user, impersonateId = null) {
  if (typeof window === 'undefined' || !user) return null;
  try {
    const raw = window.sessionStorage.getItem(getBootstrapCacheKey(user, impersonateId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedDashboardBootstrap(user, impersonateId = null, data = null) {
  if (typeof window === 'undefined' || !user || !data) return;
  try {
    window.sessionStorage.setItem(getBootstrapCacheKey(user, impersonateId), JSON.stringify(data));
  } catch {}
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

async function fetchDashboardBootstrap(user, impersonateId = null) {
  const token = await withTimeout(
    user.getIdToken(),
    DASHBOARD_BOOTSTRAP_TIMEOUT_MS,
    'Dashboard auth token request timed out.'
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DASHBOARD_BOOTSTRAP_TIMEOUT_MS);

  try {
    const response = await fetch(withImpersonation('/api/dashboard/bootstrap', impersonateId), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status !== 401 && response.status !== 403) {
        const cached = readCachedDashboardBootstrap(user, impersonateId);
        if (cached) {
          return {
            ...cached,
            _bootstrapWarning: data?.error || 'Live dashboard data is unavailable; showing the last loaded dashboard state.',
          };
        }
      }
      throw new Error(data?.error || 'Could not load dashboard data.');
    }
    writeCachedDashboardBootstrap(user, impersonateId, data);
    return data;
  } catch (err) {
    const cached = readCachedDashboardBootstrap(user, impersonateId);
    if (cached) {
      const timedOut = err?.name === 'AbortError';
      return {
        ...cached,
        _bootstrapWarning: timedOut
          ? 'Live dashboard data timed out; showing the last loaded dashboard state.'
          : 'Live dashboard data is unavailable; showing the last loaded dashboard state.',
      };
    }
    if (err?.name === 'AbortError') {
      throw new Error('Dashboard data request timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function appendCacheBust(url, key) {
  if (!url) return null;
  if (!key) return url;
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}v=${encodeURIComponent(String(key))}`;
}

function readPendingDashboardSignup() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_DASHBOARD_SIGNUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingDashboardSignup() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PENDING_DASHBOARD_SIGNUP_KEY);
}

// ── Modal step builder ───────────────────────────────────────────────────────
// Converts run state + progress into human-readable build steps for the modal.
// Step states: 'done' | 'active' | 'pending' | 'waiting' | 'sub' | 'pending-sub' | 'error'

function buildModalSteps(run, dashboardState, latestRunStatus, client) {
  const progress = run?.progress || {};
  const stage = progress?.stage;
  const stageOrder = ['fetch', 'analyze', 'synthesize', 'compose', 'normalize'];
  const idx = stageOrder.indexOf(stage);

  const host = client?.normalizedHost
    || (run?.sourceUrl
      ? (() => { try { return new URL(run.sourceUrl).hostname.replace(/^www\./, ''); } catch { return run.sourceUrl; } })()
      : null)
    || '—';

  const pageCount = progress?.pagesFetched;
  const pages = Array.isArray(progress?.pages) ? progress.pages : [];

  if (latestRunStatus === 'failed') {
    return [
      { state: 'error', text: dashboardState?.errorState?.message || 'Setup encountered an issue.' },
    ];
  }

  if (latestRunStatus === 'queued') {
    return [
      { state: 'waiting', text: `Starting up for ${host}` },
      { state: 'pending', text: 'Fetch pages' },
      { state: 'pending', text: 'Extract site content' },
      { state: 'pending', text: 'Analyze brand & voice' },
      { state: 'pending', text: 'Render device mockup' },
      { state: 'pending', text: 'Build content strategy' },
      { state: 'pending', text: 'Write dashboard modules' },
    ];
  }

  // Running — worker claimed but no stage written yet
  if (idx < 0) {
    return [
      { state: 'waiting', text: 'Starting pipeline...' },
      { state: 'pending', text: 'Fetch pages' },
      { state: 'pending', text: 'Extract site content' },
      { state: 'pending', text: 'Analyze brand & voice' },
      { state: 'pending', text: 'Render device mockup' },
      { state: 'pending', text: 'Write dashboard modules' },
    ];
  }

  const steps = [];

  // fetch (idx 0)
  steps.push({
    state: idx > 0 ? 'done' : 'active',
    text: idx > 0 ? `Connected — ${host}` : `Connecting to ${host}...`,
  });

  // analyze (idx 1) — pages fetched + evidence
  if (idx >= 1) {
    steps.push({
      state: 'done',
      text: pageCount ? `${pageCount} page${pageCount !== 1 ? 's' : ''} discovered` : 'Pages discovered',
    });
    for (const p of pages.slice(0, 4)) {
      const label = (p.title || p.headline || '').slice(0, 52);
      if (label) steps.push({ state: 'sub', text: `"${label}"`, indent: true });
    }
    if (idx === 1) {
      steps.push({ state: 'active', text: 'Extracting headlines & content...' });
      steps.push({ state: 'pending', text: 'Analyze brand & voice' });
      steps.push({ state: 'pending', text: 'Render device mockup' });
      steps.push({ state: 'pending', text: 'Write dashboard modules' });
    }
  }

  if (idx > 1) {
    steps.push({ state: 'done', text: 'Site content extracted' });
  }

  // synthesize (idx 2)
  if (idx >= 2) {
    if (idx === 2) {
      steps.push({ state: 'active', text: 'Analyzing brand & voice...' });
      steps.push({ state: 'pending-sub', text: 'Mapping tone & positioning', indent: true });
      steps.push({ state: 'pending-sub', text: 'Generating content angles', indent: true });
      steps.push({ state: 'pending-sub', text: 'Identifying brand signals', indent: true });
      steps.push({ state: 'pending', text: 'Render device mockup' });
      steps.push({ state: 'pending', text: 'Write dashboard modules' });
    } else {
      steps.push({ state: 'done', text: 'Brand analysis complete' });
    }
  }

  // compose (idx 3)
  if (idx >= 3) {
    if (idx === 3) {
      steps.push({ state: 'active', text: 'Rendering device mockup...' });
      steps.push({ state: 'pending-sub', text: 'Downloading desktop, tablet, and mobile captures', indent: true });
      steps.push({ state: 'pending-sub', text: 'Compositing into clay template', indent: true });
      steps.push({ state: 'pending', text: 'Write dashboard modules' });
    } else {
      steps.push({ state: 'done', text: 'Device mockup rendered' });
    }
  }

  // normalize (idx 4)
  if (idx >= 4) {
    steps.push({ state: 'active', text: 'Writing dashboard modules...' });
  }

  return steps;
}

// ── Module terminal stages ────────────────────────────────────────────────────
const MODULE_TERMINAL_STAGES = {
  'multi-device-view': [
    { tag: 'FETCH',   label: 'Connect to website' },
    { tag: 'SCREEN',  label: 'Capture homepage screenshots' },
    { tag: 'SCREEN',  label: 'Generate desktop / tablet / mobile views' },
    { tag: 'MOCK',    label: 'Build device mockup' },
    { tag: 'WRITE',   label: 'Write layout module' },
  ],
  'social-preview': [
    { tag: 'FETCH',   label: 'Fetch homepage' },
    { tag: 'META',    label: 'Extract social metadata' },
    { tag: 'WRITE',   label: 'Write preview module' },
  ],
  'seo-performance': [
    { tag: 'PSI',     label: 'Run PageSpeed Insights' },
    { tag: 'AI',      label: 'Run AI SEO audit' },
    { tag: 'WRITE',   label: 'Write SEO module' },
  ],
  'brand-system': [
    { tag: 'SCAN',    label: 'Read pipeline data' },
    { tag: 'CHAT',    label: 'Resolve gap questions' },
    { tag: 'VISION',  label: 'Run Claude vision on uploads' },
    { tag: 'BUILD',   label: 'Assemble Brand Guide JSON' },
    { tag: 'WRITE',   label: 'Generate output templates' },
  ],
};

function _detectQueuedModule(dashboardState) {
  const modules = dashboardState?.modules;
  if (!modules) return null;
  for (const [cardId, state] of Object.entries(modules)) {
    if (state?.status === 'queued' || state?.status === 'running') return cardId;
  }
  return null;
}

function _isModularOnlyRun(dashboardState) {
  // Modular-only runs have no legacy synthesis data
  return Boolean(dashboardState?.modules) && !dashboardState?.snapshot && !dashboardState?.strategy && !dashboardState?.scribe;
}

function buildModuleTerminalLog(moduleId, dashboardState, latestRunStatus, run, client, countdown) {
  const lines = [];
  const add = (type, prefix, text, cursor = false) => lines.push({ type, prefix, text, cursor });
  const host = _termHost(run, client);
  const runId = run?.id ? `${run.id.slice(0, 8)}…` : '—';
  const stages = MODULE_TERMINAL_STAGES[moduleId] || [];

  add('system', '$', `module/${moduleId || 'init'} — run ${runId}`);
  add('dim', '', '─'.repeat(46));
  add('info', 'site', host);
  add('dim', '', '─'.repeat(46));

  if (latestRunStatus === 'failed') {
    const msg = dashboardState?.errorState?.message || 'Module run encountered an error.';
    add('error', '[ERR]', msg);
    add('error', '✗', 'module run failed');
    add('dim', '', 'retry below to re-run this module');
    return lines;
  }

  if (latestRunStatus === 'queued') {
    add('ok', '✓', 'module run registered');
    add('info', 'queue', `target: ${host}`);
    add('dim', '', '─'.repeat(46));
    add('info', 'sys', 'locating available worker…');
    add('active', '▶', `queuing ${moduleId}…`, true);
    for (const s of stages) {
      add('dim', '·', `[${s.tag}]  ${s.label}`);
    }
    return lines;
  }

  if (latestRunStatus === 'succeeded') {
    const modules = dashboardState?.modules || {};
    add('ok', '✓', 'worker claimed job');
    for (const [cardId, state] of Object.entries(modules)) {
      if (state?.status !== 'succeeded') continue;
      const cardStages = MODULE_TERMINAL_STAGES[cardId] || [];
      for (const s of cardStages) {
        add('ok', '✓', s.label);
      }
      add('ok', '✓', `${cardId} — complete`);
      add('dim', '', '─'.repeat(46));
    }
    add('ok', '✓', 'module complete');
    return lines;
  }

  // Running — show active state
  add('ok', '✓', 'worker claimed job');
  if (stages.length > 0) {
    add('active', `[${stages[0].tag}]`, `${stages[0].label}…`, true);
    for (const s of stages.slice(1)) {
      add('dim', '·', `[${s.tag}]  ${s.label}`);
    }
  } else {
    add('active', '[RUN]', `${moduleId} in progress…`, true);
  }
  return lines;
}

// ── Intake build terminal log ─────────────────────────────────────────────────
// Produces IDE-style terminal log lines for the intake build modal.
// Each line: { type, prefix, text, cursor? }
// Types: system | dim | info | fetch | ok | ai | build | error | active | countdown

function _termHost(run, client) {
  return client?.normalizedHost
    || (run?.sourceUrl ? (() => { try { return new URL(run.sourceUrl).hostname.replace(/^www\./, ''); } catch { return run.sourceUrl; } })() : null)
    || '—';
}

function _termPath(url) {
  try { return new URL(url).pathname || '/'; } catch { return url || '/'; }
}

function buildTerminalLog(run, dashboardState, latestRunStatus, client, countdown) {
  // Delegate to module-specific terminal for modular-only clients
  if (_isModularOnlyRun(dashboardState)) {
    const moduleId = _detectQueuedModule(dashboardState) ||
      Object.keys(dashboardState?.modules || {}).find((id) => dashboardState.modules[id]?.status === 'succeeded') ||
      null;
    return buildModuleTerminalLog(moduleId, dashboardState, latestRunStatus, run, client, countdown);
  }

  const lines = [];
  const add = (type, prefix, text, cursor = false) => lines.push({ type, prefix, text, cursor });

  const progress = run?.progress || {};
  const stage = progress?.stage;
  const stageOrder = ['fetch', 'analyze', 'synthesize', 'compose', 'normalize'];
  const idx = stageOrder.indexOf(stage);
  const host = _termHost(run, client);
  const runId = run?.id ? `${run.id.slice(0, 8)}…` : '—';
  const trigger = run?.trigger || 'provision';
  const pages = Array.isArray(progress?.pages) ? progress.pages : [];
  const pageCount = progress?.pagesFetched || pages.length || 0;

  // ── Header ──
  add('system', '$', `founders/intake — run ${runId}`);
  add('dim', '', '─'.repeat(46));
  add('info', 'site', host);
  add('info', 'trigger', trigger);
  add('dim', '', '─'.repeat(46));

  // ── Failed ──
  if (latestRunStatus === 'failed') {
    const msg = dashboardState?.errorState?.message || 'unknown pipeline error';
    add('error', '[ERR]', msg);
    add('error', '✗', 'build failed');
    add('dim', '', 'update the website url below to retry');
    return lines;
  }

  // ── Queued ──
  if (latestRunStatus === 'queued') {
    add('ok', '✓', 'intake request received');
    add('ok', '✓', `run ${runId} registered`);
    add('info', 'queue', `target: ${host}`);
    add('dim', '', '─'.repeat(46));
    add('info', 'sys', 'locating available worker…');
    add('active', '▶', 'waiting for worker to start…', true);
    add('dim', '', '');
    add('dim', '·', '[FETCH]  crawl site pages');
    add('dim', '·', '[AI]     analyze content & brand');
    add('dim', '·', '[MOCK]   render clay device mockup');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // ── Succeeded ──
  if (latestRunStatus === 'succeeded') {
    add('ok', '✓', 'worker claimed job');
    add('ok', '✓', 'headless chromium initialized');
    add('fetch', '[FETCH]', `connected to ${host}`);
    const pl = pageCount ? `${pageCount} page${pageCount !== 1 ? 's' : ''}` : 'pages';
    add('ok', '✓', `${pl} crawled successfully`);
    for (const p of pages.slice(0, 6)) {
      const path = _termPath(p.url);
      const title = (p.title || p.headline || '').slice(0, 48);
      add('fetch', '  →', title ? `${path}  "${title}"` : path);
    }
    add('ok', '✓', 'site content extracted');
    add('ok', '✓', 'desktop / tablet / mobile screenshots captured');
    add('ai', '[AI]', 'gpt-4o: reading headlines & copy blocks');
    add('ai', '[AI]', 'gpt-4o: analyzing brand voice & tone');
    add('ai', '[AI]', 'gpt-4o: mapping content strategy');
    add('ai', '[AI]', 'gpt-4o: identifying distribution angles');
    add('ok', '✓', 'brand intelligence synthesized');
    add('mock', '[MOCK]', 'rendered intake device mockup');
    add('build', '[BUILD]', 'writing modules to firestore');
    add('build', '  →', 'creative-pipelines');
    add('build', '  →', 'ai-research');
    add('build', '  →', 'distribution-insight');
    add('build', '  →', 'reddit-community');
    add('ok', '✓', 'all modules written');
    add('ok', '✓', 'dashboard data ready');
    add('dim', '', '─'.repeat(46));
    if (countdown > 0) {
      add('countdown', '▶', `launching dashboard in ${countdown}…`);
    } else {
      add('countdown', '▶', 'launching…');
    }
    return lines;
  }

  // ── Running ──
  add('ok', '✓', 'worker claimed job');
  add('ok', '✓', 'headless chromium initialized');

  if (idx < 0) {
    add('active', '[→]', `connecting to ${host}…`, true);
    add('dim', '·', '[FETCH]  crawl site pages');
    add('dim', '·', '[AI]     analyze content & brand');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // fetch — show pages as they arrive
  add('fetch', '[FETCH]', `connected to ${host}`);
  if (idx === 0) {
    // Show pages already fetched (incremental progress from onPageFetched emits)
    for (const p of pages.slice(0, 6)) {
      const label = (p.title || p.headline || p.type || '').slice(0, 52);
      add('fetch', '  →', label ? `${p.type}  "${label}"` : p.type);
    }
    const stillFetching = pageCount === 0 || pages.length === 0;
    add('active', '[→]', stillFetching ? 'crawling pages — discovering content…' : `${pageCount} page${pageCount !== 1 ? 's' : ''} — scanning for more…`, true);
    add('active', '[SCREEN]', 'capturing desktop / tablet / mobile screens…', true);
    add('dim', '·', '[AI]     analyze content & brand');
    add('dim', '·', '[MOCK]   render clay device mockup');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // analyze+
  const pl = pageCount ? `${pageCount} page${pageCount !== 1 ? 's' : ''}` : 'pages';
  add('ok', '✓', `${pl} discovered`);
  for (const p of pages.slice(0, 6)) {
    const path = _termPath(p.url);
    const title = (p.title || p.headline || '').slice(0, 48);
    add('fetch', '  →', title ? `${path}  "${title}"` : path);
  }

  if (idx === 1) {
    add('ai', '[AI]', 'gpt-4o: reading page content…');
    add('active', '[AI]', 'extracting headlines & brand signals…', true);
    add('active', '[SCREEN]', 'capturing desktop / tablet / mobile screens…', true);
    add('dim', '·', '[AI]     analyze brand & voice');
    add('dim', '·', '[MOCK]   render clay device mockup');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // synthesize+
  add('ok', '✓', 'site content extracted');
  add('ok', '✓', 'desktop / tablet / mobile screenshots captured');
  add('ai', '[AI]', 'gpt-4o: analyzing brand voice & tone');
  add('ai', '[AI]', 'gpt-4o: mapping content strategy');
  add('ai', '[AI]', 'gpt-4o: identifying distribution angles');

  if (idx === 2) {
    add('active', '[AI]', 'synthesizing brand intelligence…', true);
    add('dim', '·', '[MOCK]   render clay device mockup');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // compose+
  add('ok', '✓', 'brand analysis complete');
  add('ok', '✓', 'content strategy ready');
  if (idx === 3) {
    add('active', '[MOCK]', 'rendering clay device mockup…', true);
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // normalize
  add('ok', '✓', 'device mockup rendered');
  add('build', '[BUILD]', 'writing module: creative-pipelines');
  add('build', '[BUILD]', 'writing module: ai-research');
  add('build', '[BUILD]', 'writing module: distribution-insight');
  add('build', '[BUILD]', 'writing module: reddit-community');
  add('active', '[BUILD]', 'finalizing dashboard data…', true);

  return lines;
}

// ── Terminal line builder ─────────────────────────────────────────────────────
// Converts run state + progress fields into displayable terminal log lines.

function buildTerminalLines(run, dashboardState, latestRunStatus, client) {
  const siteUrl = run?.sourceUrl
    ? (() => { try { return new URL(run.sourceUrl).hostname.replace(/^www\./, ''); } catch { return run.sourceUrl; } })()
    : client?.normalizedHost || '...';

  const progress = run?.progress || null;

  if (!run) {
    return [
      { tag: 'SYSTEM', text: 'Waiting for intake run to start...', type: 'dim' },
    ];
  }

  if (latestRunStatus === 'queued') {
    return [
      { tag: 'QUEUE', text: `Intake queued for ${siteUrl}`, type: 'label' },
      { tag: 'QUEUE', text: `Run ID: ${String(run.id || '').slice(-10)}`, type: 'dim' },
      { tag: 'QUEUE', text: 'Waiting for worker to claim run...', type: 'dim', active: true },
    ];
  }

  if (latestRunStatus === 'running') {
    const stage = progress?.stage;
    const stageOrder = ['fetch', 'analyze', 'synthesize', 'compose', 'normalize'];
    const currentIdx = stageOrder.indexOf(stage);

    const lines = [
      { tag: 'START', text: `Intake started · ${siteUrl}`, type: 'label' },
    ];

    // fetch: show crawl line — active while fetching, ok once past
    if (currentIdx >= 0) {
      lines.push({
        tag: 'FETCH',
        text: `Crawling ${siteUrl}...`,
        type: currentIdx === 0 ? 'active' : 'ok',
        active: currentIdx === 0,
      });
      if (currentIdx === 0) {
        lines.push({ tag: 'SCREEN', text: 'Capturing desktop, tablet, and mobile screenshots...', type: 'active', active: true });
      }
    }

    // analyze: show page count + compact evidence + active analyze line
    if (currentIdx >= 1) {
      const count = progress.pagesFetched;
      const types = Array.isArray(progress.pagesDiscovered) ? progress.pagesDiscovered.join(' · ') : '';
      lines.push({
        tag: 'FETCH',
        text: `${count} page${count !== 1 ? 's' : ''} fetched${types ? ` · ${types}` : ''}`,
        type: 'ok',
      });

      // Compact page evidence — title + primary heading per page
      if (Array.isArray(progress.pages)) {
        for (const page of progress.pages.slice(0, 4)) {
          const titleText = (page.title || '').slice(0, 70);
          if (titleText) {
            lines.push({ tag: page.type.toUpperCase().slice(0, 7), text: `"${titleText}"`, type: 'dim' });
          }
          const headlineText = (page.headline || '').slice(0, 70);
          if (headlineText) {
            lines.push({ tag: '', text: `→ ${headlineText}`, type: 'dim' });
          }
        }
      }

      // FIX Issue 1: always show an active line during analyze stage
      if (currentIdx === 1) {
        lines.push({ tag: 'ANALYZE', text: 'Extracting site structure...', type: 'active', active: true });
      }

      // Screenshot runs concurrently with fetch+analyze; show as active background task
      if (currentIdx <= 1) {
        lines.push({ tag: 'SCREEN', text: 'Capturing desktop, tablet, and mobile screenshots...', type: 'active', active: true });
      }
    }

    // synthesize
    if (currentIdx >= 2) {
      // Screenshot completes before synthesize — show as done
      lines.push({ tag: 'SCREEN', text: 'Desktop, tablet, and mobile screenshots captured', type: 'ok' });
      lines.push({
        tag: 'SYNTH',
        text: 'Building brand intelligence...',
        type: currentIdx === 2 ? 'active' : 'ok',
        active: currentIdx === 2,
      });
    }

    // compose
    if (currentIdx >= 3) {
      lines.push({
        tag: 'MOCK',
        text: 'Rendering clay device mockup...',
        type: currentIdx === 3 ? 'active' : 'ok',
        active: currentIdx === 3,
      });
    }

    // normalize
    if (currentIdx >= 4) {
      lines.push({ tag: 'WRITE', text: 'Writing dashboard modules...', type: 'active', active: true });
    }

    // Fallback: worker claimed but no stage written yet
    if (currentIdx < 0) {
      lines.push({ tag: 'PROC', text: progress?.progressLabel || 'Processing...', type: 'active', active: true });
    }

    return lines;
  }

  if (latestRunStatus === 'succeeded') {
    const prog = run?.progress || {};
    const cost = run?.providerUsage?.estimatedCostUsd;
    const count = prog.pagesFetched || (dashboardState?.snapshot ? 3 : null);
    const types = Array.isArray(prog.pagesDiscovered) ? prog.pagesDiscovered.join(' · ') : 'homepage';

    const lines = [
      { tag: 'DONE', text: `Intake complete · ${siteUrl}`, type: 'label' },
      { tag: 'FETCH', text: `${count ? `${count} pages · ` : ''}${types}`, type: 'ok' },
    ];

    // Show first page evidence from stored progress
    if (Array.isArray(prog.pages) && prog.pages.length > 0) {
      const hp = prog.pages.find((p) => p.type === 'homepage') || prog.pages[0];
      if (hp?.headline) {
        lines.push({ tag: hp.type.toUpperCase().slice(0, 7), text: `→ "${hp.headline.slice(0, 70)}"`, type: 'dim' });
      }
    }

    lines.push(
      { tag: 'SCREEN', text: 'Desktop, tablet, and mobile screenshots captured', type: 'ok' },
      { tag: 'SYNTH', text: 'Brand intelligence built', type: 'ok' },
      { tag: 'MOCK', text: 'Clay device mockup rendered', type: 'ok' },
      { tag: 'WRITE', text: '5 dashboard modules populated', type: 'ok' },
      { tag: 'OK', text: `Run complete${cost ? ` · $${cost}` : ''}`, type: 'success' },
    );

    return lines;
  }

  if (latestRunStatus === 'cancelled') {
    return [
      { tag: 'CANCEL', text: `Run cancelled · ${siteUrl}`, type: 'label' },
      { tag: 'INFO', text: 'Enter a new website URL below and rerun to restart intake.', type: 'dim' },
    ];
  }

  if (latestRunStatus === 'failed') {
    const errorMsg = dashboardState?.errorState?.message || 'Setup encountered an issue.';
    const lines = [
      { tag: 'ERROR', text: `Intake failed · ${siteUrl}`, type: 'label' },
      { tag: 'ERROR', text: errorMsg, type: 'error' },
    ];
    if (dashboardState?.errorState?.retryPending) {
      lines.push({ tag: 'INFO', text: 'Retry is pending — this will run automatically.', type: 'dim' });
    }
    return lines;
  }

  return [{ tag: 'SYSTEM', text: 'No recent intake runs.', type: 'dim' }];
}

/**
 * Scripted terminal lines for the SEO rerun + narrator flow.
 * Stages advance based on elapsed time from when Re-run was clicked.
 * @param {'start'|'fetch'|'audit'|'narrator'|'write'} stage
 * @param {string} [websiteUrl]
 */

// ── Component ─────────────────────────────────────────────────────────────────

const DashboardPage = () => {
  const { user, userProfile, signOutUser, isAdmin } = useAuth();
  const [theme, setTheme] = useState('light');
  const [countdownHours, setCountdownHours] = useState(14);
  const [showTierModal, setShowTierModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState(null);
  const [showClientEditModal, setShowClientEditModal] = useState(false);
  const [clientNameInput, setClientNameInput] = useState('');
  const [clientEditLoading, setClientEditLoading] = useState(false);
  const [clientEditError, setClientEditError] = useState(null);
  const [activeTileModal, setActiveTileModal] = useState(null);
  const [briefFullScreen, setBriefFullScreen] = useState(false);
  const [auditFullScreen, setAuditFullScreen] = useState(false);
  const [modalTab, setModalTab] = useState('solutions');
  const [brandSystemBuildOpen, setBrandSystemBuildOpen] = useState(false);
  const [visualDnaProspect, setVisualDnaProspect] = useState(null);
  const [visualDnaOpening, setVisualDnaOpening] = useState(false);
  // Stays true after first open so the modal stays mounted (chat history preserved).
  const [hasBrandSystemMounted, setHasBrandSystemMounted] = useState(false);
  const [impersonateId, setImpersonateId] = useState(() => readImpersonateClientId());
  const [clientSwitcherOpen, setClientSwitcherOpen] = useState(false);
  const [adminClientOptions, setAdminClientOptions] = useState([]);

  const apiPath = useCallback((path) => withImpersonation(path, impersonateId), [impersonateId]);
  // Stable token getter for BrandSystemChat — re-binding when `user` changes only.
  const brandSystemGetIdToken = useCallback(() => {
    if (!user) return Promise.reject(new Error('No authenticated user.'));
    return user.getIdToken();
  }, [user, impersonateId]);

  useEffect(() => {
    if (!user || !isAdmin) {
      setAdminClientOptions([]);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch('/api/admin/clients', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Could not load clients.');
        if (cancelled) return;
        const clients = Array.isArray(data?.clients) ? data.clients : [];
        setAdminClientOptions(clients.map((item) => ({
          clientId: item.clientId,
          name: item.companyName || item.dashboardTitle || item.clientId,
          websiteUrl: item.websiteUrl || item.normalizedHost || null,
          source: item.source || null,
        })).filter((item) => item.clientId));
      } catch {
        if (!cancelled) setAdminClientOptions([]);
      }
    })();

    return () => { cancelled = true; };
  }, [user, isAdmin]);

  // Per-client leadgen flow (Prepare Brief / Generate Mockup / Generate Site).
  // Opened by clicking client-* cards in the Data Visualization bucket. Reuses
  // the existing /api/leadgen/* routes against a synthetic prospect doc seeded
  // by /api/leadgen/seed-client-prospect.
  const [clientFlowState, setClientFlowState] = useState(null);
  // null | { open, placeId, moduleId, moduleLabel, endpoint }
  const [clientFlowSeeding, setClientFlowSeeding] = useState(false);
  const [clientFlowError, setClientFlowError] = useState(null);
  // Live synthetic per-client prospect — listener attached after `client` is
  // derived from bootstrap, below.
  const [clientProspect, setClientProspect] = useState(null);
  const [bootstrap, setBootstrap] = useState({ userProfile: null, client: null, dashboardState: null, recentRuns: [], intelligence: null, moduleConfig: null, moduleState: null });

  // Market Category RUN — on-tile agent classify (mirrors the in-modal button).
  const [marketCategoryRunLoading, setMarketCategoryRunLoading] = useState(false);
  const openMarketCategoryCard = useCallback(() => {
    setActiveTileModal({
      title: 'Market Category',
      description: 'Set the category the client operates in.',
      cardId: 'industry',
      isCapabilityCard: true,
      vizType: null,
    });
  }, []);
  const runMarketCategoryAnalyze = useCallback(async () => {
    setMarketCategoryRunLoading(true);
    try {
      const token = await brandSystemGetIdToken();
      const res = await fetch(apiPath('/api/dashboard/market-category/analyze'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.enough && data.marketCategory) {
        setBootstrap((prev) => ({
          ...prev,
          dashboardState: {
            ...(prev?.dashboardState || {}),
            marketCategory: data.marketCategory,
          },
        }));
      } else {
        // Not enough data (or error) — open the card so the user can pick manually.
        openMarketCategoryCard();
      }
    } catch {
      openMarketCategoryCard();
    } finally {
      setMarketCategoryRunLoading(false);
    }
  }, [brandSystemGetIdToken, openMarketCategoryCard, apiPath]);
  const client = bootstrap.client;

  const openLeadgenFlow = useCallback(async (step) => {
    if (!user) return;
    setClientFlowError(null);
    setClientFlowSeeding(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(apiPath('/api/leadgen/seed-client-prospect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setClientFlowState({
        open: true,
        placeId:     data.placeId,
        moduleId:    step.moduleId,
        moduleLabel: step.moduleLabel,
        endpoint:    step.endpoint,
      });
    } catch (err) {
      console.error('[openLeadgenFlow] seed failed:', err);
      setClientFlowError(err?.message || 'Failed to open leadgen flow.');
    } finally {
      setClientFlowSeeding(false);
    }
  }, [user, apiPath]);

  const closeLeadgenFlow = useCallback(() => {
    setClientFlowState(null);
    setClientFlowError(null);
  }, []);

  const openVisualDna = useCallback(async () => {
    if (!user || visualDnaOpening) return;
    setClientFlowError(null);
    setVisualDnaOpening(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(apiPath('/api/leadgen/seed-client-prospect'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setVisualDnaProspect({
        ...(clientProspect || {}),
        name: data.name || clientProspect?.name || client?.companyName || 'Client',
        website: data.website || clientProspect?.website || client?.websiteUrl || null,
        vertical: data.vertical || clientProspect?.vertical || 'default',
        placeId: data.placeId,
        visualDna: clientProspect?.visualDna || null,
      });
    } catch (err) {
      console.error('[openVisualDna] seed failed:', err);
      setClientFlowError(err?.message || 'Failed to open Visual DNA.');
    } finally {
      setVisualDnaOpening(false);
    }
  }, [user, apiPath, visualDnaOpening, clientProspect, client]);

  const leadgenFlowGetIdToken = useCallback(() => {
    if (!user) return Promise.reject(new Error('No authenticated user.'));
    return user.getIdToken();
  }, [user, apiPath]);

  // Default to Data Visualization immediately so a slow/unavailable bootstrap
  // cannot leave the nav and card shell hidden.
  const [activeCapabilityFilter, setActiveCapabilityFilter] = useState('onboarding');
  const [expandedMobileCards, setExpandedMobileCards] = useState(new Set());
  const [chatDraft, setChatDraft] = useState('');
  const [modalChatMode, setModalChatMode] = useState('ai');
  const toggleMobileCard = (id) => setExpandedMobileCards((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const capabilityGridRef = useRef(null);
  const dashboardVisibleRef = useRef(false);
  const [pendingSignupProvision, setPendingSignupProvision] = useState(null);
  const [moduleRunLoading, setModuleRunLoading] = useState({});
  const [moduleToggleLoading, setModuleToggleLoading] = useState({});
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const cancelledRef = useRef(false);
  const prevRunStatusRef = useRef(null);
  const postSurveyRevealFiredRef = useRef(false);
  const runWasActiveRef = useRef(false);
  const prevRunIdRef = useRef(null);
  const terminalOutputRef = useRef(null);
  const terminalLengthRef = useRef(0);
  const prevLogLengthRef = useRef(0);
  const prevStatusForRevealRef = useRef(null);
  const [completionCountdown, setCompletionCountdown] = useState(null);
  const [revealedLineCount, setRevealedLineCount] = useState(null);
  const [surveyResolved, setSurveyResolved] = useState(false);
  const [onboardingAnswersSeed, setOnboardingAnswersSeed] = useState(null);
  const [intakeModalDismissed, setIntakeModalDismissed] = useState(false);
  const modalMarqueeTrackRef = useRef(null);
  const modalMarqueeOffsetRef = useRef(0);
  const modalMarqueeAnimRef = useRef(null);
  const modalMarqueePrevTimeRef = useRef(null);
  const heroMarqueeShellRef = useRef(null);
  const heroMarqueeTrackRef = useRef(null);
  const noWorkspaceMarqueeTrackRef = useRef(null);
  const noWorkspaceMarqueeOffsetRef = useRef(0);
  const noWorkspaceMarqueeAnimRef = useRef(null);
  const noWorkspaceMarqueePrevTimeRef = useRef(null);
  const heroMarqueeCopyRef = useRef(null);
  const [heroMarqueeCopies, setHeroMarqueeCopies] = useState(2);
  const autoProvisionRecoveryAttemptedRef = useRef(false);
  const [reseedUrl, setReseedUrl] = useState('');
  const [reseedLoading, setReseedLoading] = useState(false);
  const [reseedError, setReseedError] = useState('');
  const [reseedSuccess, setReseedSuccess] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const applyBootstrapResponse = useCallback((data) => {
    if (cancelledRef.current) return;
    setBootstrap(data);
    setBootstrapError(data?._bootstrapWarning || '');
  }, []);

  const [intakeMockupSrc, setIntakeMockupSrc] = useState(null);
  // HTML preview for the brief tile — fetched from /api/dashboard/brief-preview
  // and injected via iframe srcDoc. Keeps the brief's <style> isolated from
  // the dashboard's own styles.
  const [briefPreviewHtml, setBriefPreviewHtml] = useState('');
  // Dedicated HTML preview for the Marketing Brief modal's BRIEF tab.
  // Always fetched with `?type=marketing` so it shows the marketing render
  // regardless of which pipeline produced the latest run.
  const [marketingBriefPreviewHtml, setMarketingBriefPreviewHtml] = useState('');
  // HTML preview for the newsletter tile — fetched from /api/dashboard/newsletter-preview
  const [newsletterPreviewHtml, setNewsletterPreviewHtml] = useState('');
  const [marketingBriefConfig, setMarketingBriefConfig] = useState(null);
  const [marketingBriefLoading, setMarketingBriefLoading] = useState(false);
  const [marketingBriefSaving, setMarketingBriefSaving] = useState(false);
  const [marketingBriefRunning, setMarketingBriefRunning] = useState(false);
  const [marketingBriefError, setMarketingBriefError] = useState('');
  const [estimateBriefDraft, setEstimateBriefDraft] = useState(() => buildDefaultEstimateBriefDraft(null));
  const [estimateBriefLoading, setEstimateBriefLoading] = useState(false);
  const [estimateBriefSaving, setEstimateBriefSaving] = useState(false);
  const [estimateBriefError, setEstimateBriefError] = useState('');
  const [customBriefs, setCustomBriefs] = useState([]);
  const [customBriefsLoading, setCustomBriefsLoading] = useState(false);
  const [customBriefsError, setCustomBriefsError] = useState('');
  const [customBriefDraft, setCustomBriefDraft] = useState(() => ({
    title: '',
    briefSlug: '',
    description: '',
    ogLabel: 'BRYAN BALLI',
    hideOgSubhead: false,
    html: '',
    public: true,
    addToClientBrain: true,
    knowledgeBaseTitle: '',
  }));
  const [customBriefSaving, setCustomBriefSaving] = useState(false);
  const [customBriefDeletingId, setCustomBriefDeletingId] = useState('');
  const [customBriefVercelLaunchingId, setCustomBriefVercelLaunchingId] = useState('');
  const [customBriefSubmitError, setCustomBriefSubmitError] = useState('');
  const [customBriefSubmitSuccess, setCustomBriefSubmitSuccess] = useState('');
  const [brandSnapshotDraft, setBrandSnapshotDraft] = useState(() => buildBrandSnapshotDraft(null));
  const [brandSnapshotSaving, setBrandSnapshotSaving] = useState(false);
  const [brandSnapshotError, setBrandSnapshotError] = useState('');

  const hydrateMarketingBriefConfig = useCallback((config) => {
    const fallback = buildDefaultMarketingBriefConfig(client, bootstrap?.dashboardState);
    const next = config || fallback;
    return {
      ...fallback,
      ...next,
      sourcePlatforms: Array.isArray(next.sourcePlatforms) && next.sourcePlatforms.length > 0
        ? next.sourcePlatforms
        : fallback.sourcePlatforms,
      kols: joinConfigList(next.kols),
      competitors: joinConfigList(next.competitors),
      searches: Array.isArray(next.searches) && next.searches.length > 0 ? next.searches : fallback.searches,
      scribeTone: typeof next.scribeTone === 'string' && next.scribeTone.trim() ? next.scribeTone : fallback.scribeTone,
      scribeHardConstraints: joinConfigList(next.scribeHardConstraints) || fallback.scribeHardConstraints,
      guardianReviewerContext: typeof next.guardianReviewerContext === 'string' && next.guardianReviewerContext.trim()
        ? next.guardianReviewerContext
        : fallback.guardianReviewerContext,
      guardianRestrictedPatterns: joinConfigList(next.guardianRestrictedPatterns),
    };
  }, [client, bootstrap?.dashboardState]);

  useEffect(() => {
    if (!user || !client) return undefined;
    let cancelled = false;
    (async () => {
      setMarketingBriefLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch(apiPath('/api/dashboard/marketing-brief/config'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setMarketingBriefConfig(hydrateMarketingBriefConfig(res.ok ? data.config : null));
          setMarketingBriefError('');
        }
      } catch (err) {
        if (!cancelled) {
          setMarketingBriefConfig(hydrateMarketingBriefConfig(null));
          setMarketingBriefError(err instanceof Error ? err.message : 'Could not load marketing brief config.');
        }
      } finally {
        if (!cancelled) setMarketingBriefLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, client, apiPath, hydrateMarketingBriefConfig]);

  const saveMarketingBriefConfig = useCallback(async () => {
    if (!user || !marketingBriefConfig) return null;
    setMarketingBriefSaving(true);
    setMarketingBriefError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(apiPath('/api/dashboard/marketing-brief/config'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(marketingBriefConfig),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not save Scout config.');
      const next = hydrateMarketingBriefConfig(data.config);
      setMarketingBriefConfig(next);
      return next;
    } catch (err) {
      setMarketingBriefError(err instanceof Error ? err.message : 'Could not save Scout config.');
      return null;
    } finally {
      setMarketingBriefSaving(false);
    }
  }, [user, marketingBriefConfig, apiPath, hydrateMarketingBriefConfig]);

  useEffect(() => {
    if (!user || !client) return undefined;
    let cancelled = false;
    (async () => {
      setEstimateBriefLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch(apiPath('/api/dashboard/estimate-brief/config'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setEstimateBriefDraft(hydrateEstimateBriefDraft(res.ok ? data.config : null, client));
          setEstimateBriefError('');
        }
      } catch (err) {
        if (!cancelled) {
          setEstimateBriefDraft(hydrateEstimateBriefDraft(null, client));
          setEstimateBriefError(err instanceof Error ? err.message : 'Could not load estimate config.');
        }
      } finally {
        if (!cancelled) setEstimateBriefLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, client, apiPath]);

  const saveEstimateBriefConfig = useCallback(async () => {
    if (!user || !estimateBriefDraft) return null;
    setEstimateBriefSaving(true);
    setEstimateBriefError('');
    try {
      const token = await user.getIdToken();
      const payload = buildEstimateBriefConfigPayload(estimateBriefDraft);
      if (!payload.lineItems.length) throw new Error('Add at least one estimate line item.');
      const res = await fetch(apiPath('/api/dashboard/estimate-brief/config'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not save estimate config.');
      const next = hydrateEstimateBriefDraft(data.config, client);
      setEstimateBriefDraft(next);
      return next;
    } catch (err) {
      setEstimateBriefError(err instanceof Error ? err.message : 'Could not save estimate config.');
      return null;
    } finally {
      setEstimateBriefSaving(false);
    }
  }, [user, estimateBriefDraft, apiPath, client]);

  // Fetch the brief HTML for the Brief tile's miniature preview. Re-fetches
  // whenever latestRunId changes so the tile always shows the newest render.
  // Cache-busted with the runId + `cache: 'no-store'` to defeat both browser
  // and Next.js response caches.
  useEffect(() => {
    if (!user) return;
    const dash = bootstrap?.dashboardState;
    const runId = dash?.latestRunId || null;
    if (!dash?.scribe?.brief && !dash?.marketingBrief) { setBriefPreviewHtml(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const url = runId
          ? `/api/dashboard/brief-preview?runId=${encodeURIComponent(runId)}`
          : '/api/dashboard/brief-preview';
        const res = await fetch(apiPath(url), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const html = await res.text();
        if (!cancelled) setBriefPreviewHtml(html);
      } catch {
        // non-fatal — tile falls back to placeholder label
      }
    })();
    return () => { cancelled = true; };
  }, [user, apiPath, bootstrap?.dashboardState?.latestRunId, bootstrap?.dashboardState?.scribe?.brief?.headline, bootstrap?.dashboardState?.marketingBrief?.generatedAtIso]);

  // Always fetch the Marketing Brief render (?type=marketing) for the
  // Marketing Brief modal's BRIEF tab. Independent of the main brief preview
  // so the modal stays correct after any subsequent non-marketing run.
  useEffect(() => {
    if (!user) return;
    const dash = bootstrap?.dashboardState;
    if (!dash?.marketingBrief) { setMarketingBriefPreviewHtml(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(apiPath('/api/dashboard/brief-preview?type=marketing'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const html = await res.text();
        if (!cancelled) setMarketingBriefPreviewHtml(html);
      } catch {
        // non-fatal — tab falls back to placeholder
      }
    })();
    return () => { cancelled = true; };
  }, [user, apiPath, bootstrap?.dashboardState?.marketingBrief?.generatedAtIso, bootstrap?.dashboardState?.modules?.['marketing-brief']?.lastRunId]);

  useEffect(() => {
    if (!user || !client) {
      setCustomBriefs([]);
      setCustomBriefsError('');
      setCustomBriefsLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setCustomBriefsLoading(true);
      setCustomBriefsError('');
      try {
        const token = await user.getIdToken();
        const res = await fetch(apiPath('/api/dashboard/custom-briefs'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Could not load custom briefs.');
        if (!cancelled) setCustomBriefs(Array.isArray(data.briefs) ? data.briefs : []);
      } catch (err) {
        if (!cancelled) {
          setCustomBriefs([]);
          setCustomBriefsError(err instanceof Error ? err.message : 'Could not load custom briefs.');
        }
      } finally {
        if (!cancelled) setCustomBriefsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, client?.clientId, client?.id, bootstrap?.effectiveClientId, apiPath]);

  const updateCustomBriefDraft = useCallback((patch) => {
    setCustomBriefDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const loadCustomBriefStarter = useCallback(() => {
    const title = `${client?.companyName || client?.name || client?.dashboardTitle || 'Client'} Custom Brief`;
      setCustomBriefDraft((prev) => ({
        ...prev,
        title: prev.title || title,
        briefSlug: prev.briefSlug || briefSlugify(title),
        knowledgeBaseTitle: prev.knowledgeBaseTitle || title,
        ogLabel: prev.ogLabel || 'BRYAN BALLI',
        html: buildCustomBriefStarterHtml(client),
      }));
    setCustomBriefSubmitError('');
    setCustomBriefSubmitSuccess('');
  }, [client]);

  const handleCustomBriefFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCustomBriefSubmitError('');
    setCustomBriefSubmitSuccess('');
    try {
      const html = await file.text();
      const baseName = file.name.replace(/\.html?$/i, '');
      const title = customBriefDraft.title || baseName.replace(/[-_]+/g, ' ');
      setCustomBriefDraft((prev) => ({
        ...prev,
        title,
        briefSlug: prev.briefSlug || briefSlugify(baseName.replace(/-brief$/i, '')),
        knowledgeBaseTitle: prev.knowledgeBaseTitle || title,
        ogLabel: prev.ogLabel || 'BRYAN BALLI',
        html,
      }));
    } catch (err) {
      setCustomBriefSubmitError(err instanceof Error ? err.message : 'Could not read HTML file.');
    } finally {
      event.target.value = '';
    }
  }, [customBriefDraft.title]);

  const submitCustomBrief = useCallback(async () => {
    if (!user || customBriefSaving) return;
    setCustomBriefSaving(true);
    setCustomBriefSubmitError('');
    setCustomBriefSubmitSuccess('');
    try {
      const token = await user.getIdToken();
      const title = customBriefDraft.title.trim();
      const html = customBriefDraft.html.trim();
      const briefSlug = briefSlugify(customBriefDraft.briefSlug || title);
      const res = await fetch(apiPath('/api/dashboard/custom-briefs'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          title,
          briefSlug,
          description: customBriefDraft.description,
          ogLabel: customBriefDraft.ogLabel,
          hideOgSubhead: customBriefDraft.hideOgSubhead,
          html,
          public: customBriefDraft.public,
          addToClientBrain: customBriefDraft.addToClientBrain,
          knowledgeBaseTitle: customBriefDraft.knowledgeBaseTitle || title,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not save custom brief.');
      if (data?.brief) {
        setCustomBriefs((prev) => [data.brief, ...prev.filter((item) => item.id !== data.brief.id)]);
      }
      setCustomBriefDraft({
        title: '',
        briefSlug: '',
        description: '',
        ogLabel: 'BRYAN BALLI',
        hideOgSubhead: false,
        html: '',
        public: true,
        addToClientBrain: true,
        knowledgeBaseTitle: '',
      });
      const pdfMessage = data?.pdf?.ok === false ? 'PDF generation is not available for this save.' : 'PDF ready.';
      const brainMessage = customBriefDraft.addToClientBrain
        ? (data?.brain?.ok
          ? (data?.brain?.status === 'error' ? 'Added to Client Brain; embedding needs attention.' : 'Added to Client Brain.')
          : 'Client Brain ingest needs attention.')
        : 'Client Brain skipped.';
      setCustomBriefSubmitSuccess(`Brief saved. ${pdfMessage} ${brainMessage}`);
    } catch (err) {
      setCustomBriefSubmitError(err instanceof Error ? err.message : 'Could not save custom brief.');
    } finally {
      setCustomBriefSaving(false);
    }
  }, [user, customBriefSaving, customBriefDraft, apiPath]);

  const deleteCustomBrief = useCallback(async (brief) => {
    const briefId = brief?.id || brief?.briefSlug;
    if (!user || !briefId || customBriefDeletingId) return;
    const title = brief?.title || brief?.briefSlug || 'this custom brief';
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${title}"? This removes the public brief and its Client Brain data.`)) {
      return;
    }

    setCustomBriefDeletingId(briefId);
    setCustomBriefSubmitError('');
    setCustomBriefSubmitSuccess('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(apiPath('/api/dashboard/custom-briefs'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ briefId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not delete custom brief.');
      setCustomBriefs((prev) => prev.filter((item) => item.id !== briefId && item.briefSlug !== briefId));
      const deletedChunks = Number(data?.brain?.deletedChunks) || 0;
      const vercelMessage = data?.vercel?.deleted
        ? ` Vercel site deleted${data.vercel.projectName ? ` (${data.vercel.projectName})` : ''}.`
        : data?.vercel?.alreadyDeleted
          ? ' Vercel site was already deleted.'
          : '';
      setCustomBriefSubmitSuccess(`Brief deleted. Removed ${deletedChunks} Client Brain chunk${deletedChunks === 1 ? '' : 's'}.${vercelMessage}`);
    } catch (err) {
      setCustomBriefSubmitError(err instanceof Error ? err.message : 'Could not delete custom brief.');
    } finally {
      setCustomBriefDeletingId('');
    }
  }, [user, customBriefDeletingId, apiPath]);

  const launchCustomBriefVercel = useCallback(async (brief) => {
    const briefId = brief?.id || brief?.briefSlug;
    if (!user || !briefId || customBriefVercelLaunchingId) return;

    setCustomBriefVercelLaunchingId(briefId);
    setCustomBriefSubmitError('');
    setCustomBriefSubmitSuccess('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(apiPath('/api/dashboard/custom-briefs/vercel'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ briefId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not launch custom brief on Vercel.');
      setCustomBriefs((prev) => prev.map((item) => {
        if (item.id !== briefId && item.briefSlug !== briefId) return item;
        return {
          ...item,
          vercel: data.vercel || item.vercel || null,
          vercelUrl: data.vercel?.url || item.vercelUrl || '',
          vercelReadyState: data.vercel?.readyState || item.vercelReadyState || '',
        };
      }));
      setCustomBriefSubmitSuccess(data?.vercel?.url
        ? `Brief launched on Vercel. Link added to the brief card: ${data.vercel.url}`
        : 'Brief deploy sent to Vercel.');
    } catch (err) {
      setCustomBriefSubmitError(err instanceof Error ? err.message : 'Could not launch custom brief on Vercel.');
    } finally {
      setCustomBriefVercelLaunchingId('');
    }
  }, [user, customBriefVercelLaunchingId, apiPath]);

  // Fetch the newsletter HTML for the Newsletter tile's PREVIEW tab.
  // Loads the real newsletter if available, otherwise the generic template.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const dash = bootstrap?.dashboardState;
        const hasReal = Boolean(dash?.newsletter?.content?.hero_story);
        const url = hasReal
          ? '/api/dashboard/newsletter-preview'
          : '/api/dashboard/newsletter-preview?template=generic';
        const res = await fetch(apiPath(url), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const html = await res.text();
        if (!cancelled) setNewsletterPreviewHtml(html);
      } catch {
        // non-fatal — tab falls back to placeholder
      }
    })();
    return () => { cancelled = true; };
  }, [user, apiPath, bootstrap?.dashboardState?.newsletter?.content?.hero_story]);

  // Clock tick
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdownHours((c) => (c <= 9 ? 14 : c - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Reset modal tab each time a card modal opens. Standard cards now land on
  // the shared report page; custom cards keep their purpose-built default tabs.
  // Exceptions:
  //   - multi-device-view → defaults to the 'desktop' viewport tab.
  //   - seo-performance / social-preview / agent-readiness / design-evaluation
  //     use their specialized mini-brief report adapters.
  useEffect(() => {
    if (!activeTileModal?.cardId) return;
    const id = activeTileModal.cardId;
    if (id === 'multi-device-view') { setModalTab('desktop'); return; }
    // Reference via bootstrap here — `dashboardState` is declared later in the
    // component body (TDZ) so the direct name isn't safe at effect-definition time.
    if (id === 'survey-status') { setModalTab('chat'); return; }
    if (id === 'submit-custom-brief') { setModalTab('upload'); return; }
    if (id === 'marketing-brief') { setModalTab('brief'); return; }
    if (id === 'newsletter') { setModalTab('preview'); return; }
    if (id === 'client-brief')  { setModalTab('preview'); return; }
    if (id === 'client-mockup') { setModalTab('preview'); return; }
    if (id === 'client-site')   { setModalTab('preview'); return; }
    if (id === 'client-estimate') { setModalTab('estimate'); return; }
    if (id === 'seo-performance') { setModalTab('report'); return; }
    if (id === 'agent-readiness') { setModalTab('report'); return; }
    if (id === 'design-evaluation' && bootstrap?.dashboardState?.analyzerOutputs?.['design-evaluation']) { setModalTab('report'); return; }
    if (id === 'social-preview' && bootstrap?.dashboardState?.siteMeta) { setModalTab('report'); return; }
    if (id === 'industry') { setModalTab('report'); return; }
    if (id === 'brand-system') { setModalTab('master-prompt'); return; }
    setModalTab(CUSTOM_DETAIL_CARD_IDS.has(id) ? 'solutions' : 'report');
  }, [activeTileModal?.cardId, bootstrap?.dashboardState?.artifacts?.skillDocs]);

  useEffect(() => {
    if (!showTierModal) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowTierModal(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showTierModal]);

  useEffect(() => {
    if (!activeTileModal) return;
    trackTileOpened(activeTileModal.cardId || activeTileModal.number, activeTileModal.label || activeTileModal.title);
  }, [activeTileModal]);

  useEffect(() => {
    if (!activeTileModal) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e) => { if (e.key === 'Escape') setActiveTileModal(null); };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTileModal]);

  // Bootstrap fetch (stable reference)
  const doBootstrap = useCallback(() => {
    if (!user) return;
    fetchDashboardBootstrap(user, impersonateId)
      .then(applyBootstrapResponse)
      .catch((err) => { if (!cancelledRef.current) setBootstrapError(err instanceof Error ? err.message : 'Could not load dashboard data.'); });
  }, [user, impersonateId, applyBootstrapResponse]);

  const runMarketingBrief = useCallback(async () => {
    if (!user || marketingBriefRunning) return;
    setMarketingBriefRunning(true);
    setMarketingBriefError('');
    setIntakeModalDismissed(false);
    let pollHandle = null;
    const kickBootstrap = () => { try { doBootstrap(); } catch {} };
    setTimeout(kickBootstrap, 400);
    pollHandle = setInterval(kickBootstrap, 2000);
    try {
      const saved = await saveMarketingBriefConfig();
      if (!saved) throw new Error('Scout config was not saved.');
      const token = await user.getIdToken();
      const res = await fetch(apiPath('/api/dashboard/marketing-brief/run'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Marketing brief run failed.');
      doBootstrap();
    } catch (err) {
      setMarketingBriefError(err instanceof Error ? err.message : 'Marketing brief run failed.');
    } finally {
      if (pollHandle) clearInterval(pollHandle);
      setMarketingBriefRunning(false);
    }
  }, [user, marketingBriefRunning, saveMarketingBriefConfig, apiPath, doBootstrap]);

  const updateMarketingBriefSearch = useCallback((index, patch) => {
    setMarketingBriefConfig((prev) => {
      const searches = [...(prev?.searches || [])];
      searches[index] = { ...(searches[index] || {}), ...patch };
      return { ...(prev || {}), searches };
    });
  }, []);

  const addMarketingBriefSearch = useCallback(() => {
    setMarketingBriefConfig((prev) => ({
      ...(prev || {}),
      searches: [...(prev?.searches || []), { label: 'NEW SEARCH', query: '', goal: '' }],
    }));
  }, []);

  const removeMarketingBriefSearch = useCallback((index) => {
    setMarketingBriefConfig((prev) => {
      const searches = (prev?.searches || []).filter((_, i) => i !== index);
      return { ...(prev || {}), searches: searches.length ? searches : [{ label: 'BRAND', query: '', goal: '' }] };
    });
  }, []);

  const toggleMarketingBriefSourcePlatform = useCallback((key) => {
    setMarketingBriefConfig((prev) => {
      const current = Array.isArray(prev?.sourcePlatforms) && prev.sourcePlatforms.length > 0
        ? prev.sourcePlatforms
        : DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS;
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];
      return {
        ...(prev || {}),
        sourcePlatforms: next.length ? next : ['web'],
      };
    });
  }, []);

  const updateBrandSnapshotDraft = useCallback((path, value) => {
    setBrandSnapshotDraft((prev) => {
      const next = cloneJson(prev) || buildBrandSnapshotDraft(null);
      let cursor = next;
      path.slice(0, -1).forEach((key) => {
        cursor[key] = cursor[key] || {};
        cursor = cursor[key];
      });
      cursor[path[path.length - 1]] = value;
      return next;
    });
  }, []);

  const saveBrandSnapshotConfig = useCallback(async () => {
    if (!user) return;
    setBrandSnapshotSaving(true);
    setBrandSnapshotError('');
    try {
      const token = await user.getIdToken();
      const styleGuide = draftToStyleGuide(brandSnapshotDraft, bootstrap?.dashboardState?.snapshot?.visualIdentity?.styleGuide || null);
      const res = await fetch(apiPath('/api/dashboard/brand-snapshot/config'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ styleGuide }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not save Brand Snapshot.');
      setBrandSnapshotDraft(buildBrandSnapshotDraft(data.styleGuide || styleGuide));
      doBootstrap();
    } catch (err) {
      setBrandSnapshotError(err instanceof Error ? err.message : 'Could not save Brand Snapshot.');
    } finally {
      setBrandSnapshotSaving(false);
    }
  }, [user, brandSnapshotDraft, bootstrap?.dashboardState?.snapshot?.visualIdentity?.styleGuide, apiPath, doBootstrap]);

  useEffect(() => {
    setBrandSnapshotDraft(buildBrandSnapshotDraft(bootstrap?.dashboardState?.snapshot?.visualIdentity?.styleGuide || null));
  }, [bootstrap?.dashboardState?.snapshot?.visualIdentity?.styleGuide]);

  // Initial load
  useEffect(() => {
    cancelledRef.current = false;
    if (!user) {
      setBootstrapLoading(false);
      setBootstrap({ userProfile: null, client: null, recentRuns: [] });
      return () => { cancelledRef.current = true; };
    }
    setBootstrapLoading(true);
    setBootstrapError('');
    fetchDashboardBootstrap(user, impersonateId)
      .then(applyBootstrapResponse)
      .catch((err) => { if (!cancelledRef.current) setBootstrapError(err instanceof Error ? err.message : 'Could not load dashboard data.'); })
      .finally(() => { if (!cancelledRef.current) setBootstrapLoading(false); });
    return () => { cancelledRef.current = true; };
  }, [user, impersonateId, applyBootstrapResponse]);

  useEffect(() => {
    if (!user) {
      setPendingSignupProvision(null);
      autoProvisionRecoveryAttemptedRef.current = false;
      clearPendingDashboardSignup();
      return;
    }
    setPendingSignupProvision(readPendingDashboardSignup());
    autoProvisionRecoveryAttemptedRef.current = false;
  }, [user, apiPath]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const isImpersonating = Boolean(bootstrap.impersonating || impersonateId);
  const adminDashboards = useMemo(() => {
    const byId = new Map();
    [...(bootstrap.adminDashboards || []), ...adminClientOptions].forEach((item) => {
      if (!item?.clientId) return;
      const existing = byId.get(item.clientId) || {};
      byId.set(item.clientId, {
        ...existing,
        ...item,
        name: item.name || item.companyName || existing.name || existing.companyName || item.clientId,
        websiteUrl: item.websiteUrl || existing.websiteUrl || null,
      });
    });
    return Array.from(byId.values()).sort((a, b) => String(a.name || a.clientId).localeCompare(String(b.name || b.clientId)));
  }, [bootstrap.adminDashboards, adminClientOptions]);

  const switchDashboard = useCallback((clientId) => {
    const nextId = clientId || null;
    writeImpersonateClientId(nextId);
    setImpersonateId(nextId);
    setClientSwitcherOpen(false);
    setShowTierModal(false);
    setShowClientEditModal(false);
    setShowDeleteAccountModal(false);
    setActiveTileModal(null);
    setBrandSystemBuildOpen(false);
    setClientFlowState(null);
    setIntakeModalDismissed(true);
    setBootstrapLoading(true);
    setBootstrapError('');
  }, []);

  // Live snapshot of the synthetic per-client prospect doc — drives card state
  // (status dot, footer text, DETAILS modal content) for the leadgen flow cards.
  useEffect(() => {
    const cid = client?.clientId || client?.id;
    if (!cid || !db || isImpersonating) {
      setClientProspect(null);
      return undefined;
    }
    const ref = doc(db, 'leadgen_prospects', `client:${cid}`);
    const unsub = onSnapshot(
      ref,
      (snap) => setClientProspect(snap.exists() ? snap.data() : null),
      (err) => { if (process.env.NODE_ENV !== 'production') console.warn('[client-prospect] snapshot:', err?.message || err); },
    );
    return () => unsub();
  }, [client?.clientId, client?.id, isImpersonating]);

  const recentRuns = bootstrap.recentRuns || [];
  const displayProfile = bootstrap.userProfile || userProfile;
  const currentRun = recentRuns[0] || null;
  const dashboardState = bootstrap.dashboardState;
  const getKnowledgeBaseSources = (...candidateLists) => {
    for (const list of candidateLists) {
      if (Array.isArray(list) && list.length) return list;
    }
    return [];
  };
  const summarizeKnowledgeBaseSources = (sources, fallback = 'Not retrieved this run') => {
    const list = Array.isArray(sources) ? sources : [];
    if (!list.length) return fallback;
    return list
      .slice(0, 3)
      .map((source) => {
        const title = source?.title || source?.itemTitle || source?.sourceUrl || 'Knowledge item';
        const section = source?.sectionTitle || source?.heading || '';
        return section ? `${title} / ${section}` : title;
      })
      .join(' · ');
  };
  const globalKnowledgeBaseSources = getKnowledgeBaseSources(dashboardState?.knowledgeBase?.sources);
  const artifactVersionKey =
    dashboardState?.latestRunId
    || dashboardState?.updatedAt?.seconds
    || currentRun?.id
    || currentRun?.runId
    || null;
  const homepageDeviceMockup = dashboardState?.artifacts?.homepageDeviceMockup || null;
  const homepageDeviceMockupUrl = appendCacheBust(
    homepageDeviceMockup?.downloadUrl || null,
    homepageDeviceMockup?.capturedAt || artifactVersionKey
  );
  const homepageScreenshotUrl = appendCacheBust(
    dashboardState?.artifacts?.homepageScreenshot?.downloadUrl || null,
    dashboardState?.artifacts?.homepageScreenshot?.capturedAt || artifactVersionKey
  );
  const homepageScreenshots = dashboardState?.artifacts?.homepageScreenshots || {};
  const fullPageScreenshots = dashboardState?.artifacts?.fullPageScreenshots || {};
  // Full-page screenshots preferred for the tabs; fall back to viewport screenshots
  const deviceScreenshots = {
    desktop: appendCacheBust(
      fullPageScreenshots['desktop-full']?.downloadUrl || homepageScreenshots.desktop?.downloadUrl || null,
      fullPageScreenshots['desktop-full']?.capturedAt || homepageScreenshots.desktop?.capturedAt || artifactVersionKey
    ),
    tablet: appendCacheBust(
      fullPageScreenshots['tablet-full']?.downloadUrl || homepageScreenshots.tablet?.downloadUrl || null,
      fullPageScreenshots['tablet-full']?.capturedAt || homepageScreenshots.tablet?.capturedAt || artifactVersionKey
    ),
    mobile: appendCacheBust(
      fullPageScreenshots['mobile-full']?.downloadUrl || homepageScreenshots.mobile?.downloadUrl || null,
      fullPageScreenshots['mobile-full']?.capturedAt || homepageScreenshots.mobile?.capturedAt || artifactVersionKey
    ),
  };
  const multiDevicePreviewSrc =
    homepageDeviceMockupUrl ||
    homepageScreenshotUrl ||
    deviceScreenshots.desktop ||
    deviceScreenshots.tablet ||
    deviceScreenshots.mobile ||
    null;
  const clientStatus = dashboardState?.status || client?.status || null;
  // Prefer the live run status from brief_runs (polled every 4s) over the cached
  // dashboardState.latestRunStatus — the cached value is written as 'queued' at
  // provisioning and only flips to 'succeeded' at completion, so it never reports
  // 'running' and would lock the terminal on the queued branch mid-run.
  const latestRunStatus = currentRun?.status || dashboardState?.latestRunStatus || null;
  const provisioningState = dashboardState?.provisioningState || null;
  const errorState = dashboardState?.errorState || null;
  const hasClientWorkspace = Boolean(client || dashboardState || recentRuns.length > 0);
  const hasRecentPendingSignup = Boolean(
    pendingSignupProvision?.websiteUrl &&
    pendingSignupProvision?.createdAt &&
    (Date.now() - pendingSignupProvision.createdAt) < 15 * 60 * 1000
  );
  const awaitingSignupProvision = Boolean(user) && !hasClientWorkspace && hasRecentPendingSignup;

  // Free-tier intake fields
  const snapshot = dashboardState?.snapshot || null;
  const signals = dashboardState?.signals || null;
  const strategy = dashboardState?.strategy || null;
  const brandOverview = snapshot?.brandOverview || null;
  const brandTone = snapshot?.brandTone || null;
  const siteMeta = dashboardState?.siteMeta || null;
  const evidencePages = dashboardState?.evidence?.pages || [];
  const visualIdentity  = snapshot?.visualIdentity || null;
  const styleGuideData  = visualIdentity?.styleGuide ?? null;
  const sgDisplayData   = styleGuideData || null;
  const sgModalDisplayData = activeTileModal?.cardId === 'style-guide'
    ? draftToStyleGuide(brandSnapshotDraft, styleGuideData)
    : sgDisplayData;
  const isStyleGuideMock = !styleGuideData;
  const outputsPreview  = dashboardState?.outputsPreview || null;
  // Phase-4 Scribe: per-card short + expanded copy. When present for a card,
  // the modal description is overridden with scribe.expanded. Absent → static
  // fallback copy already defined on each intakeCapabilityCards entry.
  const scribeCards = dashboardState?.scribe?.cards || null;
  const seoGuardianState = dashboardState?.scribe?.seoGuardian || null;
  // Per-card analyzer skill outputs (P3 shape: { skills, aggregate }). Null when
  // no skill is wired for the card. Consumed by the modal analyzer-findings
  // section (P7).
  const analyzerOutputs = dashboardState?.analyzerOutputs || null;
  const seoAnalyzerCard = analyzerOutputs?.['seo-performance'] || null;
  const seoDepthAudit = seoAnalyzerCard?.skills?.['seo-depth-audit'] ?? null;
  const briefPdfUrl = dashboardState?.artifacts?.briefPdf?.downloadUrl || null;
  // Intelligence-first SEO data: prefer intelligence source, fall back to dashboardState.seoAudit
  const intelligencePayload = bootstrap.intelligence || null;
  const moduleConfig = bootstrap.moduleConfig || null;
  const moduleState  = bootstrap.moduleState  || dashboardState?.modules || null;
  const onboardingSummary = bootstrap.onboardingSummary || null;
  // Set of currently enabled modular card IDs — drives nav gating and card visibility
  const enabledModuleIds = useMemo(() => {
    if (!moduleConfig) return new Set();
    return new Set(Object.entries(moduleConfig).filter(([, cfg]) => cfg?.enabled === true).map(([id]) => id));
  }, [moduleConfig]);
  const seoAudit = intelligencePayload?.dashboardSeoAudit ?? dashboardState?.seoAudit ?? null;
  const isFromIntelligence  = Boolean(intelligencePayload?.dashboardSeoAudit != null);
  const intelligenceSummary = intelligencePayload?.psiSummary || null;
  const psiNarrative        = intelligencePayload?.psiNarrative || null;
  const capabilityHeadline = (() => {
    const url = client?.websiteUrl || reseedUrl || null;
    if (url) {
      try { return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return url; }
    }
    return client?.dashboardTitle || displayProfile?.dashboardTitle || 'An operating stack that runs itself.';
  })();

  // Legacy compat fields (pre-intake runs)
  const headline = dashboardState?.headline || null;
  const summaryCards = dashboardState?.summaryCards || [];
  const latestInsights = dashboardState?.latestInsights || [];

  // Broader check than just the brand headline — a run can succeed with
  // rich scribe/snapshot output even when synth's top-line headline string
  // is empty. Any of these signals means the dashboard has enough to show.
  const hasIntakeData = Boolean(
    brandOverview?.headline
    || brandOverview?.summary
    || brandOverview?.industry
    || brandOverview?.businessModel
    || dashboardState?.scribe?.brief?.headline
    || dashboardState?.scribe?.cards
    || headline
  );
  // True for clients provisioned with moduleConfig who have not yet run the full pipeline.
  // Drives nav gating and initial filter — these clients see only Data Visualization.
  const isModularOnboardingClient = Boolean(moduleConfig) && !hasIntakeData;

  const isRunActive = latestRunStatus === 'queued' || latestRunStatus === 'running';
  const noWorkspaceState = !bootstrapLoading
    && !bootstrapError
    && Boolean(user)
    && !hasClientWorkspace
    && !awaitingSignupProvision;

  // Mark the run as active for this session so we know whether to hold the
  // intake modal for survey resolution (only relevant when the build happened
  // during this session — returning users with a long-succeeded run skip this).
  // IMPORTANT: scope to INTAKE runs only. Module reruns (pipelineType:
  // 'module-run') are triggered from per-card Run buttons and must NOT hold
  // the onboarding survey modal open after they complete.
  const activeRunIsIntake = currentRun?.pipelineType !== 'module-run';
  if ((latestRunStatus === 'queued' || latestRunStatus === 'running') && activeRunIsIntake) {
    runWasActiveRef.current = true;
  }

  // Show terminal modal during active builds, failures, and the post-completion countdown.
  // Hold it while the run has succeeded but the onboarding survey is still unresolved,
  // but ONLY if the build happened this session — never flash it for returning users
  // whose dashboard was already built.
  // Also show it for new users who have never completed a build: there's no dashboard
  // to reveal yet, so the onboarding terminal + survey should be the entry experience
  // (even if no brief_run is queued — e.g., idea-only signup without a URL).
  const hasReadyDashboard = latestRunStatus === 'succeeded' && hasIntakeData;
  // Client-side bridge: when a module Run has been clicked, `moduleRunLoading`
  // flips true immediately. Use it to surface the terminal before the server
  // round-trip updates latestRunStatus — otherwise there's a visible 2s gap
  // between click and the terminal appearing.
  const moduleRunInFlight = Object.values(moduleRunLoading || {}).some(Boolean);
  const showIntakeModal = !intakeModalDismissed && !bootstrapLoading && (
    (awaitingSignupProvision || !noWorkspaceState) && (
    awaitingSignupProvision
    || moduleRunInFlight
    || (
    isRunActive
    || latestRunStatus === 'failed'
    || completionCountdown !== null
    || (latestRunStatus === 'succeeded' && !surveyResolved && runWasActiveRef.current)
    || (Boolean(client) && clientStatus === 'provisioning' && !hasReadyDashboard)
    ))
  );

  useEffect(() => {
    const anyModalOpen = showIntakeModal || showTierModal || showClientEditModal || showDeleteAccountModal || briefFullScreen || auditFullScreen;
    if (!anyModalOpen) {
      document.body.style.overflow = '';
      return undefined;
    }
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [showIntakeModal, showTierModal, showClientEditModal, showDeleteAccountModal, briefFullScreen, auditFullScreen]);

  // Page-load / processing-handoff intro.
  // Three states this effect handles:
  //   1. Initial mount with the intake modal showing → instantly hide dashboard
  //      (background-only with the modal on top).
  //   2. Initial mount or transition into "ready" (modal closed) → animate the
  //      dashboard in nav → hero → cards top-left to bottom-right.
  //   3. Transition from a visible dashboard into processing (e.g. user clicks
  //      "Update & Rerun") → quick fade out so the modal can take over.
  // The three.js background is owned by the parent route and stays mounted, so
  // we never touch it here.
  useLayoutEffect(() => {
    const strip    = document.querySelector('#founders-top-strip');
    const heroNum  = document.querySelector('#founders-hero-numeric-shell');
    const heroMeta = document.querySelector('#founders-hero-meta');
    const capNav   = document.querySelector('#capability-nav-col');
    const capGrid  = capabilityGridRef.current;
    const cards    = capGrid ? gsap.utils.toArray('[data-capability-card]', capGrid) : [];
    const gridBorderColor = capGrid ? getComputedStyle(capGrid).borderTopColor : null;
    const sections = [strip, heroNum, heroMeta, capNav].filter(Boolean);

    if (showIntakeModal) {
      if (dashboardVisibleRef.current) {
        // Was visible — fade out so the modal can take over
        dashboardVisibleRef.current = false;
        const outTl = gsap.timeline();
        outTl.to([...sections, ...cards], { autoAlpha: 0, duration: 0.3, ease: 'power2.in' });
        if (capGrid) outTl.to(capGrid, { borderColor: 'transparent', duration: 0.3, ease: 'power2.in' }, '<');
        return () => outTl.kill();
      }
      // Initial mount with modal already showing — hide instantly
      gsap.set(sections, { autoAlpha: 0 });
      if (capGrid && gridBorderColor) gsap.set(capGrid, { borderColor: 'transparent' });
      if (cards.length) gsap.set(cards, { autoAlpha: 0 });
      return undefined;
    }

    // Modal is closed — animate dashboard in (initial load OR after processing)
    dashboardVisibleRef.current = true;
    gsap.set(sections, { autoAlpha: 0 });
    if (capGrid && gridBorderColor) gsap.set(capGrid, { borderColor: 'transparent' });
    if (cards.length) gsap.set(cards, { autoAlpha: 0 });

    const tl = gsap.timeline({ delay: 0.5 });
    tl.to(strip,    { autoAlpha: 1, duration: 0.5, ease: 'power2.out' }, '<0.1')
      .to(heroNum,  { autoAlpha: 1, duration: 0.65, ease: 'power2.out' }, '0.28')
      .to(heroMeta, { autoAlpha: 1, duration: 0.55, ease: 'power2.out' }, '<0.12')
      .to(capNav,   { autoAlpha: 1, duration: 0.5, ease: 'power2.out' }, '0.55')
      .to(capGrid,  { borderColor: gridBorderColor, duration: 0.25, ease: 'power2.out' }, '<')
      .to(cards,    { autoAlpha: 1, duration: 0.42, ease: 'power1.out', stagger: 0.15 }, '<0.05');

    return () => tl.kill();
  }, [showIntakeModal]);

  // Polling while a run is in-flight
  useEffect(() => {
    if (!user || !isRunActive) return undefined;
    const interval = setInterval(() => {
      fetchDashboardBootstrap(user, impersonateId)
        .then(applyBootstrapResponse)
        .catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, [user, isRunActive, impersonateId, applyBootstrapResponse]);

  useEffect(() => {
    if (!awaitingSignupProvision) return;
    const interval = setInterval(() => {
      fetchDashboardBootstrap(user, impersonateId)
        .then(applyBootstrapResponse)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [user, awaitingSignupProvision, impersonateId, applyBootstrapResponse]);

  useEffect(() => {
    if (!awaitingSignupProvision || hasClientWorkspace) return;
    if (autoProvisionRecoveryAttemptedRef.current) return;
    const timer = setTimeout(async () => {
      if (!user || !pendingSignupProvision?.websiteUrl) return;
      autoProvisionRecoveryAttemptedRef.current = true;
      try {
        const token = await user.getIdToken();
        await fetch('/api/clients/provision', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            websiteUrl: pendingSignupProvision.websiteUrl,
            ideaDescription: pendingSignupProvision.ideaDescription || '',
            displayName: pendingSignupProvision.displayName || user.displayName || '',
            companyName: pendingSignupProvision.companyName || '',
          }),
        });
        doBootstrap();
      } catch {
        // non-fatal: polling will continue and the recovery panel remains the fallback
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [user, awaitingSignupProvision, hasClientWorkspace, pendingSignupProvision, doBootstrap]);

  useEffect(() => {
    if (!hasClientWorkspace) return;
    clearPendingDashboardSignup();
    setPendingSignupProvision(null);
  }, [hasClientWorkspace]);

  // Inject Google Fonts for the style-guide type specimen
  useEffect(() => {
    // Try loading ALL extracted font families via Google Fonts — not just
    // ones classified as google-fonts. The classifier can miss; Google Fonts
    // will silently 404 for non-Google fonts with no side effects.
    const families = (sgDisplayData?.typography?.fontFamilies || [])
      .filter((f) => f.family && f.source !== 'system')
      .map((f) => f.family);
    if (!families.length) return;
    const id = 'sg-google-fonts-link';
    const existing = document.getElementById(id);
    const query = families
      .map((fam) => `family=${encodeURIComponent(fam)}:wght@300;400;600;700;900`)
      .join('&');
    const href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
    if (existing?.href === href) return;
    if (existing) existing.remove();
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return () => { document.getElementById(id)?.remove(); };
  }, [sgDisplayData]);

  // GSAP: style-guide layout quadrant — desktop → mobile viewport animation
  // Pin the capability nav col while the capability section scrolls
  useEffect(() => {
    const nav = document.getElementById('capability-nav-col');
    const section = document.getElementById('capability-section-shell');
    if (!nav || !section) return undefined;
    if (window.innerWidth <= 900 && isModularOnboardingClient) return undefined;
    const st = ScrollTrigger.create({
      trigger: nav,
      start: 'top top+=72',
      endTrigger: section,
      end: 'bottom bottom',
      pin: true,
      pinSpacing: false,
    });
    return () => st.kill();
  }, [isModularOnboardingClient]);

  // Animates the frame width so flex-wrap causes columns to actually reflow:
  // at desktop width (100%) all columns fit in one row side-by-side;
  // at mobile width (~36%) they wrap to stacked, overflow:hidden clips to show 1 col.
  useEffect(() => {
    const el = document.getElementById('sg-rg-demo');
    if (!el) return undefined;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { width: '100%' },
        {
          width: '36%',
          duration: 1.6,
          ease: 'power2.inOut',
          repeat: -1,
          yoyo: true,
        }
      );
    });
    return () => ctx.revert();
  }, [sgDisplayData]);

  useEffect(() => {
    setIntakeMockupSrc(homepageDeviceMockupUrl || null);
  }, [homepageDeviceMockupUrl]);

  // Seed reseedUrl from client websiteUrl once loaded
  useEffect(() => {
    if (client?.websiteUrl && !reseedUrl) {
      setReseedUrl(client.websiteUrl);
    }
  }, [client?.websiteUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect run completion → start 3-second countdown before revealing dashboard.
  // Gated: hold the countdown until the onboarding survey is resolved so answers
  // can influence answer-dependent pipeline stages before reveal.
  // Skip entirely for module re-runs — those don't need a reveal countdown.
  useEffect(() => {
    if (latestRunStatus === prevRunStatusRef.current) return;
    if (latestRunStatus === 'succeeded' && (prevRunStatusRef.current === 'running' || prevRunStatusRef.current === 'queued')) {
      if (surveyResolved && activeRunIsIntake) setCompletionCountdown(3);
    }
    prevRunStatusRef.current = latestRunStatus;
  }, [latestRunStatus, surveyResolved, activeRunIsIntake]);

  // If the run finished during this session before the survey resolved, start
  // the countdown once the survey becomes resolved. Guarded by:
  //   - runWasActiveRef so returning users (whose run long succeeded) never
  //     trigger a countdown on page load,
  //   - postSurveyRevealFiredRef so this can only fire once per session and
  //     can't loop after the countdown ticks back to null.
  useEffect(() => {
    if (postSurveyRevealFiredRef.current) return;
    if (!runWasActiveRef.current) return;
    if (!activeRunIsIntake) return;
    if (surveyResolved && latestRunStatus === 'succeeded' && completionCountdown === null) {
      postSurveyRevealFiredRef.current = true;
      setCompletionCountdown(3);
    }
  }, [surveyResolved, latestRunStatus, completionCountdown, activeRunIsIntake]);

  // When a new brief_run starts (run ID changes from a prior non-null value),
  // reset survey resolution so the bento survey reappears alongside the fresh
  // terminal. Previous answers remain in Firestore and seed the survey again.
  useEffect(() => {
    const currentRunId = client?.latestRunId || null;
    if (prevRunIdRef.current !== null && currentRunId && currentRunId !== prevRunIdRef.current) {
      setSurveyResolved(false);
      postSurveyRevealFiredRef.current = false;
    }
    if (currentRunId) prevRunIdRef.current = currentRunId;
  }, [client?.latestRunId]);

  // Load current onboarding state on mount so a returning/mid-build user
  // picks up where they left off (or passes through if already resolved).
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(apiPath('/api/dashboard/onboarding'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const answers = data.onboardingAnswers || null;
        setOnboardingAnswersSeed(answers?.answers || null);
        if (answers?.completedAt || answers?.skippedAt) {
          setSurveyResolved(true);
        }
      } catch {
        /* non-fatal — survey will still render */
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const postOnboarding = useCallback(async (body) => {
    if (!user) throw new Error('No user.');
    const token = await user.getIdToken();
    const res = await fetch(apiPath('/api/dashboard/onboarding'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Onboarding save failed.');
    return res.json();
  }, [user]);

  // Tick countdown down to 0, then clear it (modal unmounts)
  useEffect(() => {
    if (completionCountdown === null || completionCountdown <= 0) {
      if (completionCountdown === 0) setCompletionCountdown(null);
      return undefined;
    }
    const t = setTimeout(() => setCompletionCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [completionCountdown]);

  // Reveal succeeded lines one by one — each line appears 120ms after the previous.
  // Uses terminalLengthRef (updated after the useMemo below) to avoid a
  // "cannot access before initialization" error from referencing terminalLog here.
  useEffect(() => {
    if (revealedLineCount === null) return undefined;
    if (revealedLineCount >= terminalLengthRef.current) {
      setRevealedLineCount(null);
      return undefined;
    }
    const t = setTimeout(() => setRevealedLineCount((c) => c + 1), 120);
    return () => clearTimeout(t);
  }, [revealedLineCount]);

  // Auto-scroll embedded terminal to bottom on new lines
  useEffect(() => {
    if (terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
  }, [showIntakeModal, completionCountdown, revealedLineCount]);

  // Marquee rAF for modal — exact same implementation as AuthPage
  useEffect(() => {
    if (!showIntakeModal) return undefined;
    const SPEED = 72;
    const tick = (timestamp) => {
      if (modalMarqueePrevTimeRef.current === null) modalMarqueePrevTimeRef.current = timestamp;
      const delta = Math.min(timestamp - modalMarqueePrevTimeRef.current, 64);
      modalMarqueePrevTimeRef.current = timestamp;
      const track = modalMarqueeTrackRef.current;
      if (track && track.children[0]) {
        const singleWidth = track.children[0].offsetWidth;
        modalMarqueeOffsetRef.current -= SPEED * (delta / 1000);
        if (modalMarqueeOffsetRef.current <= -singleWidth) modalMarqueeOffsetRef.current += singleWidth;
        track.style.transform = `translate3d(${modalMarqueeOffsetRef.current}px, 0, 0)`;
      }
      modalMarqueeAnimRef.current = requestAnimationFrame(tick);
    };
    modalMarqueeAnimRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(modalMarqueeAnimRef.current); modalMarqueePrevTimeRef.current = null; };
  }, [showIntakeModal]);

  // Marquee rAF for no-workspace associate screen
  useEffect(() => {
    if (!noWorkspaceState) return undefined;
    const SPEED = 72;
    const tick = (timestamp) => {
      if (noWorkspaceMarqueePrevTimeRef.current === null) noWorkspaceMarqueePrevTimeRef.current = timestamp;
      const delta = Math.min(timestamp - noWorkspaceMarqueePrevTimeRef.current, 64);
      noWorkspaceMarqueePrevTimeRef.current = timestamp;
      const track = noWorkspaceMarqueeTrackRef.current;
      if (track && track.children[0]) {
        const singleWidth = track.children[0].offsetWidth;
        noWorkspaceMarqueeOffsetRef.current -= SPEED * (delta / 1000);
        if (noWorkspaceMarqueeOffsetRef.current <= -singleWidth) noWorkspaceMarqueeOffsetRef.current += singleWidth;
        track.style.transform = `translate3d(${noWorkspaceMarqueeOffsetRef.current}px, 0, 0)`;
      }
      noWorkspaceMarqueeAnimRef.current = requestAnimationFrame(tick);
    };
    noWorkspaceMarqueeAnimRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(noWorkspaceMarqueeAnimRef.current); noWorkspaceMarqueePrevTimeRef.current = null; };
  }, [noWorkspaceState]);

  useEffect(() => {
    const shell = heroMarqueeShellRef.current;
    const track = heroMarqueeTrackRef.current;
    const firstCopy = heroMarqueeCopyRef.current;
    if (!shell || !track || !firstCopy) return undefined;

    const SPEED = 60;
    let frameId = null;

    const updateMarqueeMetrics = () => {
      frameId = null;
      const copyWidth = firstCopy.getBoundingClientRect().width;
      const shellWidth = shell.getBoundingClientRect().width;
      if (!copyWidth || !shellWidth) return;

      track.style.setProperty('--hero-marquee-width', `${copyWidth}px`);
      track.style.setProperty('--hero-marquee-duration', `${Math.max(copyWidth / SPEED, 10)}s`);

      const requiredCopies = Math.max(2, Math.ceil(shellWidth / copyWidth) + 2);
      setHeroMarqueeCopies((prev) => (prev === requiredCopies ? prev : requiredCopies));
    };

    const scheduleUpdate = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updateMarqueeMetrics);
    };

    scheduleUpdate();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scheduleUpdate())
      : null;

    resizeObserver?.observe(shell);
    resizeObserver?.observe(firstCopy);

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => scheduleUpdate()).catch(() => {});
    }

    window.addEventListener('resize', scheduleUpdate);

    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [capabilityHeadline]);

  const handleChatSend = (msg) => {
    const trimmed = msg.trim();
    if (!trimmed) return;
    const context = activeTileModal?.label ? `[Re: ${activeTileModal.label}] ` : '';
    window.open(`sms:+13122865129&body=${encodeURIComponent(context + trimmed)}`, '_self');
    setChatDraft('');
  };

  const handleSignOut = useCallback(() => {
    trackSignOut();
    signOutUser();
  }, [signOutUser]);

  const handleUpdateClientName = useCallback(async () => {
    if (!user || clientEditLoading) return;
    const next = clientNameInput.trim();
    if (!next) {
      setClientEditError('Client name cannot be empty.');
      return;
    }
    setClientEditLoading(true);
    setClientEditError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(apiPath('/api/account/update-client'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Update failed.');
      setShowClientEditModal(false);
      doBootstrap();
    } catch (err) {
      setClientEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setClientEditLoading(false);
    }
  }, [user, clientEditLoading, clientNameInput, doBootstrap, apiPath]);

  const handleDeleteAccount = useCallback(async () => {
    if (!user || deleteAccountLoading) return;
    if (deleteConfirmInput.trim().toUpperCase() !== 'DELETE') return;
    setDeleteAccountLoading(true);
    setDeleteAccountError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.errors?.[0]?.message || data?.error || 'Account deletion failed.');
      }
      // Auth user is gone at this point — signOutUser clears client state and redirects.
      signOutUser();
    } catch (err) {
      setDeleteAccountError(err instanceof Error ? err.message : String(err));
      setDeleteAccountLoading(false);
    }
  }, [user, deleteAccountLoading, deleteConfirmInput, signOutUser]);

  const handleReseed = useCallback(async () => {
    if (!user || !reseedUrl.trim() || reseedLoading) return;
    setReseedLoading(true);
    setReseedError('');
    setReseedSuccess(false);
    try {
      const token = await user.getIdToken();
      // No provisioned client yet → provision; otherwise reseed
      const isFirstRun = !client;
      const endpoint = isFirstRun ? '/api/clients/provision' : apiPath('/api/dashboard/reseed-intake');
      const body = isFirstRun
        ? { websiteUrl: reseedUrl.trim(), displayName: user.displayName || '', companyName: '' }
        : { websiteUrl: reseedUrl.trim() };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Request failed.');
      if (isFirstRun) trackDashboardCreated(reseedUrl.trim());
      else trackPipelineRerun(reseedUrl.trim());
      setReseedSuccess(true);
      setMarketingBriefConfig(null);
      doBootstrap();
    } catch (err) {
      setReseedError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setReseedLoading(false);
    }
  }, [user, client, reseedUrl, reseedLoading, doBootstrap, apiPath]);

  const handleCancelRun = useCallback(async () => {
    if (!user || cancelLoading) return;
    setCancelLoading(true);
    setCancelError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(apiPath('/api/dashboard/cancel-intake'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Cancel failed.');
      trackPipelineCancelled();
      setReseedSuccess(false);
      doBootstrap();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Cancel failed.');
    } finally {
      setCancelLoading(false);
    }
  }, [user, cancelLoading, doBootstrap, apiPath]);


  const handleModuleToggle = useCallback(async (cardId, enabled) => {
    if (!user || moduleToggleLoading[cardId]) return;
    setModuleToggleLoading((prev) => ({ ...prev, [cardId]: true }));
    // When enabling (which triggers the first run), poll bootstrap so the
    // terminal UI surfaces mid-run instead of only after the run POST resolves.
    let pollHandle = null;
    const kickBootstrap = () => { try { doBootstrap(); } catch {} };
    if (enabled) {
      // Re-open the terminal overlay for the run that's about to start.
      setIntakeModalDismissed(false);
      setTimeout(kickBootstrap, 400);
      pollHandle = setInterval(kickBootstrap, 2000);
    }
    try {
      const token = await user.getIdToken();
      // Step 1: persist the config change
      const res = await fetch(apiPath('/api/dashboard/modules/config'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Toggle failed.');
      // Step 2: enabling a card immediately triggers its first run
      if (enabled) {
        await fetch(apiPath('/api/dashboard/modules/run'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardIds: [cardId], force: false }),
        });
      }
      doBootstrap();
    } catch {
      // non-fatal
    } finally {
      if (pollHandle) clearInterval(pollHandle);
      setModuleToggleLoading((prev) => ({ ...prev, [cardId]: false }));
    }
  }, [user, moduleToggleLoading, doBootstrap, apiPath]);

  const handleModuleRun = useCallback(async (cardId, force = false, options = null, autoEnable = false) => {
    if (!user || moduleRunLoading[cardId]) return;
    setModuleRunLoading((prev) => ({ ...prev, [cardId]: true }));
    // Re-open the terminal overlay for this run. Without this, any prior
    // dismiss of the terminal stays sticky for the session and subsequent
    // module runs would stream invisibly in the background.
    setIntakeModalDismissed(false);
    // Kick an immediate bootstrap + short interval so the dashboard picks up the
    // server's early writes (latestRunStatus='running', new runId). This flips
    // showIntakeModal so the terminal UI surfaces mid-run instead of only after
    // the fetch below resolves.
    let pollHandle = null;
    const kickBootstrap = () => { try { doBootstrap(); } catch {} };
    setTimeout(kickBootstrap, 400);
    pollHandle = setInterval(kickBootstrap, 2000);
    try {
      const token = await user.getIdToken();
      const body = { cardIds: [cardId], force };
      if (options && typeof options === 'object') {
        body.moduleOptions = { [cardId]: options };
      }
      if (autoEnable) body.autoEnable = true;
      const res = await fetch(apiPath('/api/dashboard/modules/run'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Module run failed.');
      doBootstrap();
    } catch {
      // non-fatal
    } finally {
      if (pollHandle) clearInterval(pollHandle);
      setModuleRunLoading((prev) => ({ ...prev, [cardId]: false }));
    }
  }, [user, moduleRunLoading, doBootstrap, apiPath]);

  const terminalLines = useMemo(
    () => buildTerminalLines(currentRun, dashboardState, latestRunStatus, client),
    [currentRun, dashboardState, latestRunStatus, client]
  );

  // ── Real-time pipeline events ────────────────────────────────────────────
  // Subscribe to clients/{clientId}/brief_runs/{runId}/events (ordered by
  // createdAt). Each event is written by the worker via updateRunProgress →
  // appendRunEvent. When events are present, the terminal uses them instead
  // of the cosmetic hardcoded lines so progress shows the ACTUAL pipeline
  // stage as it happens.
  const [realEvents, setRealEvents] = useState([]);
  const eventsRunKeyRef = useRef(null);
  useEffect(() => {
    const cid = client?.clientId || client?.id || null;
    const rid = currentRun?.runId || currentRun?.id || null;
    if (!cid || !rid || !db || isImpersonating) {
      setRealEvents([]);
      eventsRunKeyRef.current = null;
      return undefined;
    }
    const key = `${cid}:${rid}`;
    if (eventsRunKeyRef.current !== key) {
      // New run — reset before attaching the snapshot listener.
      setRealEvents([]);
      eventsRunKeyRef.current = key;
    }
    const q = query(
      collection(db, 'clients', cid, 'brief_runs', rid, 'events'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data() || {};
        const t = data.createdAt;
        const at = t?.toDate ? t.toDate().toISOString() : (typeof t === 'string' ? t : null);
        return {
          id: d.id,
          stage: data.stage || 'progress',
          label: data.label || '',
          extra: data.extra || null,
          at,
        };
      });
      setRealEvents(list);
    }, () => { /* non-fatal snapshot error */ });
    return () => unsub();
  }, [client?.clientId, client?.id, currentRun?.runId, currentRun?.id, isImpersonating]);

  // Map a pipeline event to a terminal line. Stages from runner.js:
  //   capture, fetch, analyze, styleguide, synthesize, compose,
  //   scout-config, skills, scribe, brief, normalize
  const realEventLines = useMemo(() => {
    const stagePrefix = {
      capture:       ['screen', '[SCREEN]'],
      fetch:         ['fetch',  '[FETCH]'],
      analyze:       ['ok',     '[ANALYZE]'],
      styleguide:    ['ai',     '[STYLE]'],
      synthesize:    ['ai',     '[AI]'],
      compose:       ['mock',   '[MOCK]'],
      'scout-config':    ['ai',     '[SCOUT]'],
      skills:            ['ai',     '[SKILL]'],
      scribe:            ['ai',     '[SCRIBE]'],
      brief:             ['ai',     '[BRIEF]'],
      normalize:         ['build',  '[BUILD]'],
      'design-evaluation': ['ai',   '[DSN]'],
      progress:          ['ok',     '✓'],
      error:             ['error',  '✗'],
    };
    return realEvents.map((ev) => {
      const [type, prefix] = stagePrefix[ev.stage] || ['info', `[${(ev.stage || '').toUpperCase()}]`];
      return {
        type,
        prefix,
        text: ev.label || ev.stage || '',
        cursor: false,
        _realId: ev.id,
      };
    });
  }, [realEvents]);


  const terminalLog = useMemo(
    () => buildTerminalLog(currentRun, dashboardState, latestRunStatus, client, completionCountdown),
    [currentRun, dashboardState, latestRunStatus, client, completionCountdown]
  );

  // Keep ref in sync so the reveal effect (declared above) can read the current length
  terminalLengthRef.current = terminalLog.length;

  // General line-by-line reveal trigger — fires on status change or log growth.
  // Declared after terminalLog useMemo so we can reference it directly.
  //
  // Flash-avoidance rule: only reset revealedLineCount to 0 on the INITIAL mount
  // (no prior status yet). Mid-run status transitions (queued → running →
  // succeeded) previously wiped the terminal to empty and re-revealed from zero,
  // which read as a "refresh" flash. Instead, treat every non-initial transition
  // like content growth — keep what's on screen and reveal only the new delta.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const currLen = terminalLog.length;
    const prevLen = prevLogLengthRef.current;
    const isInitialReveal = prevStatusForRevealRef.current === null && latestRunStatus !== null;

    prevLogLengthRef.current = currLen;
    prevStatusForRevealRef.current = latestRunStatus;

    if (isInitialReveal) {
      // First time we have a status — reveal from the start
      setRevealedLineCount(0);
    } else if (currLen > prevLen) {
      // New lines appended (stage advance or status transition that grew the log)
      // — keep prior content on screen and reveal just the new ones.
      //
      // If the reveal is idle (null = all lines visible), kick it from prevLen
      // so the new lines animate in. If a reveal is already in flight, leave it
      // alone — the interval reads terminalLengthRef.current each tick and will
      // keep going until the new total is reached, so jumping the counter would
      // only cause hidden lines to pop in all at once.
      setRevealedLineCount((c) => (c === null ? prevLen : c));
    }
    // Same or shrinking length, same status (countdown tick, line content swap
    // in place) — do not touch revealedLineCount, avoids flashing.
  }, [latestRunStatus, terminalLog]); // eslint-disable-line react-hooks/exhaustive-deps

  // During the succeeded reveal, slice to how many lines have been unlocked so far
  const slicedLog = revealedLineCount !== null
    ? terminalLog.slice(0, revealedLineCount)
    : terminalLog;

  // ── Real-event reveal animation ──────────────────────────────────────────
  // Real events arrive in bursts (2–5 at once) then long pauses. We animate
  // them out one-at-a-time at 180ms intervals so they read like a live
  // terminal, but the reveal counter never exceeds the number of events
  // actually received.
  const [revealedRealCount, setRevealedRealCount] = useState(0);
  useEffect(() => {
    // If events arrive faster than animation, keep stepping up.
    if (revealedRealCount >= realEventLines.length) return undefined;
    const t = setTimeout(() => {
      setRevealedRealCount((c) => Math.min(c + 1, realEventLines.length));
    }, 180);
    return () => clearTimeout(t);
  }, [revealedRealCount, realEventLines.length]);

  // Reset reveal counter when a new run's events replace the previous set.
  const prevFirstEventIdRef = useRef(null);
  useEffect(() => {
    const firstId = realEventLines[0]?._realId || null;
    if (firstId !== prevFirstEventIdRef.current) {
      prevFirstEventIdRef.current = firstId;
      setRevealedRealCount(0);
    }
  }, [realEventLines]);

  // Append synthetic post-run lines when the pipeline has succeeded:
  //   - Survey resolved  → "launching dashboard in 3,2,1…" countdown
  //   - Survey unresolved → "complete the survey to continue →"
  const realEventLinesWithTail = useMemo(() => {
    if (realEventLines.length === 0) return realEventLines;
    if (latestRunStatus !== 'succeeded') return realEventLines;
    const tail = [...realEventLines];
    tail.push({ type: 'dim', prefix: '', text: '─'.repeat(46), cursor: false });
    if (!activeRunIsIntake) {
      tail.push({ type: 'ok', prefix: '✓', text: 'module complete', cursor: false });
    } else if (surveyResolved) {
      if (completionCountdown !== null && completionCountdown > 0) {
        tail.push({ type: 'countdown', prefix: '▶', text: `launching dashboard in ${completionCountdown}…`, cursor: false });
      } else {
        tail.push({ type: 'countdown', prefix: '▶', text: 'launching…', cursor: false });
      }
    } else {
      tail.push({ type: 'active', prefix: '▶', text: 'complete the survey above to reveal your dashboard →', cursor: true });
    }
    return tail;
  }, [realEventLines, latestRunStatus, surveyResolved, completionCountdown, activeRunIsIntake]);

  // How many lines to show: events revealed so far + all synthetic tail
  // lines (no animation delay on the tail — it's just status/gating).
  const realDisplayLimit = realEventLines.length === 0
    ? 0
    : revealedRealCount + (realEventLinesWithTail.length - realEventLines.length);
  const slicedRealLines = realEventLinesWithTail.slice(0, realDisplayLimit);
  const hasMeaningfulRealEvents = useMemo(
    () => realEvents.some((ev) => ev.stage && ev.stage !== 'progress' && ev.stage !== 'error'),
    [realEvents]
  );

  const pendingSignupTerminalLines = useMemo(() => {
    if (!awaitingSignupProvision) return [];
    const websiteUrl = pendingSignupProvision?.websiteUrl || '';
    const host = websiteUrl
      ? (() => { try { return new URL(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`).hostname.replace(/^www\./, ''); } catch { return websiteUrl; } })()
      : '—';
    return [
      { type: 'system', prefix: '$', text: 'signup/provision — linking workspace' },
      { type: 'dim', prefix: '', text: '─'.repeat(46) },
      { type: 'info', prefix: 'site', text: host },
      { type: 'ok', prefix: '✓', text: 'account created' },
      { type: 'active', prefix: '▶', text: 'attaching workspace and queueing multi-device-view…', cursor: true },
      { type: 'dim', prefix: '·', text: '[FETCH]  fetch homepage' },
      { type: 'dim', prefix: '·', text: '[SCREEN] capture desktop, tablet, and mobile screenshots' },
      { type: 'dim', prefix: '·', text: '[MOCK]   render device mockup' },
      { type: 'dim', prefix: '·', text: '[WRITE]  write dashboard module' },
    ];
  }, [awaitingSignupProvision, pendingSignupProvision]);

  // Prefer real-time pipeline events when a run has emitted any. Falls back
  // to the hardcoded cosmetic log only when the events subcollection is empty
  // (legacy runs pre-dating the event stream, or still loading).
  const displayedTerminalLines = awaitingSignupProvision && !currentRun
    ? pendingSignupTerminalLines
    : _isModularOnlyRun(dashboardState) && hasMeaningfulRealEvents
      ? slicedRealLines
      : _isModularOnlyRun(dashboardState)
      ? slicedLog
      : realEventLines.length > 0
        ? slicedRealLines
        : slicedLog;

  // Auto-scroll the terminal so the latest line is always in view.
  // Runs after every change to displayedTerminalLines.
  useEffect(() => {
    const el = terminalOutputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayedTerminalLines]);

  const intakeTerminalStatus = isRunActive
    ? 'Processing'
    : latestRunStatus === 'succeeded'
      ? 'Complete'
      : latestRunStatus === 'failed'
        ? 'Error'
        : latestRunStatus === 'cancelled'
          ? 'Cancelled'
          : 'Ready';
  const resolvedPrioritySignal = headline || '';
  const resolvedDraftPost = outputsPreview?.samplePost || summaryCards.find((card) => card.label === 'Draft Post')?.value || '';
  const resolvedContentAngle = strategy?.contentAngles?.[0]?.angle || summaryCards.find((card) => card.label === 'Content Angle')?.value || '';
  const resolvedIndustry = brandOverview?.industry || '';
  // User-set Market Category override wins over auto-detected industry; this is
  // what feeds the Strategy Builder vertical.
  const resolvedCategory = dashboardState?.marketCategory?.value || resolvedIndustry;
  const hasCategoryData = Boolean(resolvedCategory);
  // Shell label + description react to how the category was reached.
  const _mc = dashboardState?.marketCategory || null;
  const _mcSource = _mc?.source || (_mc?.value ? 'user' : (resolvedIndustry ? 'auto' : ''));
  const _mcRationale = String(_mc?.rationale || '').trim();
  const _mcConfidence = Number.isFinite(_mc?.confidence) ? Math.round(_mc.confidence * 100) : null;
  const _mcEvidence = Array.isArray(_mc?.evidence) ? _mc.evidence.slice(0, 3).join(' · ') : '';
  const marketCategoryImageUrl = dashboardState?.marketCategory?.cardImageUrl || null;
  const categoryShellLabel = hasCategoryData
    ? String(resolvedCategory).replace(/-/g, '\n').toUpperCase()
    : 'RUN TO\nCLASSIFY';
  const categoryDescription = !hasCategoryData
    ? 'We map your business into a clear category. Run it to auto-classify from Social Preview, Brand Snapshot and Scout data — or set it manually. Feeds competitor benchmarking and the Strategy Builder.'
    : _mcSource === 'agent'
      ? `Classified as "${resolvedCategory}"${_mcConfidence != null ? ` (${_mcConfidence}% confidence)` : ''} by analysing your pipeline${_mcRationale ? `: ${_mcRationale}` : _mcEvidence ? ` from ${_mcEvidence}.` : ' from Social Preview, Brand Snapshot and Scout data.'} Feeds competitor benchmarking and the Strategy Builder.`
      : _mcSource === 'user'
        ? `Set to "${resolvedCategory}" manually. Re-run to re-classify from your pipeline data. Feeds competitor benchmarking and the Strategy Builder.`
        : `Detected as "${resolvedCategory}" from your brand snapshot. Run to re-classify from Social Preview / Scout data, or open the card to edit. Feeds competitor benchmarking and the Strategy Builder.`;
  const resolvedBusinessModel = brandOverview?.businessModel || '';
  const resolvedOpportunities = (strategy?.opportunityMap?.length ? strategy.opportunityMap : latestInsights.length ? latestInsights : []).slice(0, 4);
  const hasBrandToneData = Boolean(brandTone?.primary || brandTone?.secondary || brandTone?.writingStyle || brandTone?.tags?.length);
  const hasStyleGuideData = Boolean(visualIdentity?.summary || visualIdentity?.colorPalette || visualIdentity?.styleNotes || visualIdentity?.styleGuide);
  const sgLogoSrc = sgDisplayData?.assets?.logoUrl || siteMeta?.appleTouchIcon || siteMeta?.favicon || null;
  const hasSgColors = Boolean(sgDisplayData?.colors && [sgDisplayData.colors.primary, sgDisplayData.colors.secondary, sgDisplayData.colors.tertiary, sgDisplayData.colors.neutral].some((color) => color?.hex));
  const hasSgType = Boolean(sgDisplayData?.typography?.headingSystem?.fontFamily);
  const sgModalLogoSrc = sgModalDisplayData?.assets?.logoUrl || siteMeta?.appleTouchIcon || siteMeta?.favicon || null;
  const hasSgModalColors = Boolean(sgModalDisplayData?.colors && [sgModalDisplayData.colors.primary, sgModalDisplayData.colors.secondary, sgModalDisplayData.colors.tertiary, sgModalDisplayData.colors.neutral].some((color) => color?.hex));
  const hasSgModalType = Boolean(sgModalDisplayData?.typography?.headingSystem?.fontFamily);
  const hasSgQuadrant = true; // brand-mark quadrant always renders (logo or "NO LOGO" fallback)
  const hasIndustryData = Boolean(resolvedIndustry);
  const hasBusinessModelData = Boolean(resolvedBusinessModel);
  const hasPrioritySignalData = Boolean(resolvedPrioritySignal);
  const hasDraftPostData = Boolean(resolvedDraftPost);
  const hasNewsletterData = Boolean(dashboardState?.newsletter?.content?.hero_story);
  const newsletterHeroPreview = dashboardState?.newsletter?.content?.hero_story?.slice(0, 140) || '';
  const marketingBrief = dashboardState?.marketingBrief || null;
  const marketingBriefKnowledgeBaseSources = getKnowledgeBaseSources(
    marketingBrief?.knowledgeBaseSources,
    globalKnowledgeBaseSources
  );
  const customBriefCount = customBriefs.length;
  const hasCustomBriefs = customBriefCount > 0;
  const latestCustomBrief = hasCustomBriefs ? customBriefs[0] : null;
  const strategyBuilderKnowledgeBaseSources = getKnowledgeBaseSources(
    dashboardState?.strategyBuilder?.lastPlan?.knowledgeBaseSources,
    globalKnowledgeBaseSources
  );
  const brandSystemKnowledgeBaseSources = getKnowledgeBaseSources(
    dashboardState?.brandSystem?.knowledgeBaseSources,
    globalKnowledgeBaseSources
  );
  const marketCategoryKnowledgeBaseSources = getKnowledgeBaseSources(
    dashboardState?.marketCategory?.knowledgeBaseSources,
    globalKnowledgeBaseSources
  );
  const knowledgeBaseSourceSummary = summarizeKnowledgeBaseSources(globalKnowledgeBaseSources, "Available as this client's brain");
  const hasMarketingBriefData = Boolean(marketingBrief?.content || dashboardState?.headline || latestInsights.length > 0);
  const hasDailyBriefData = hasMarketingBriefData || hasCustomBriefs;
  const hasBriefDocumentData = Boolean(hasIntakeData || hasDailyBriefData);
  const marketingBriefStatus = moduleState?.['marketing-brief']?.status || (hasMarketingBriefData ? 'succeeded' : 'idle');
  const marketingBriefPreview = marketingBrief?.headline || dashboardState?.headline || latestCustomBrief?.title || 'Scout, Scribe, and Guardian are ready to build the daily founder brief.';
  const marketingScoutAgentData = marketingBrief?.scoutBrief?.agentData || null;
  const marketingBriefSelectedPlatforms = (marketingBriefConfig?.sourcePlatforms || DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS);
  const marketingBriefPerPlatformResults = deriveMarketingBriefPerPlatformResults(marketingScoutAgentData, marketingBriefSelectedPlatforms);
  const marketingBriefHasRunResults = Boolean(marketingScoutAgentData);
  const socialGeneratedDraft =
    marketingBrief?.content?.x_post
    || marketingBrief?.content?.primary_post
    || dashboardState?.summaryCards?.find((c) => c.type === 'content_post')?.value
    || resolvedDraftPost
    || '';
  const hasSocialGeneratedDraft = Boolean(socialGeneratedDraft);
  const hasContentAngleData = Boolean(resolvedContentAngle);
  const hasOpportunitiesData = resolvedOpportunities.length > 0;
  const hasSeoAuditData = Boolean((seoAudit?.status === 'ok' || seoAudit?.status === 'partial') && seoAudit?.scores);
  const hasWebsiteUrl = Boolean(client?.websiteUrl);
  // Five-state resolution — exactly one is true at a time
  const seoCardState = hasSeoAuditData
    ? (seoAudit.status === 'partial' ? 'partial' : 'ok')
    : seoAudit?.status === 'error'
      ? 'error'
      : hasWebsiteUrl || isRunActive
        ? 'queued'
        : 'no-url';
  const isSeoQueued   = seoCardState === 'queued';
  const isSeoError    = seoCardState === 'error';
  const isSeoPartial  = seoCardState === 'partial';
  const seoDiag = seoAudit?.diagnosticsContext || null;
  const seoRunWarnings = Array.isArray(currentRun?.warnings)
    ? currentRun.warnings.filter((w) => w?.stage === 'psi')
    : [];
  const skillRunWarnings = Array.isArray(currentRun?.warnings)
    ? currentRun.warnings.filter((w) => w?.stage === 'skills')
    : [];
  const scribeRunWarnings = Array.isArray(currentRun?.warnings)
    ? currentRun.warnings.filter((w) => w?.stage === 'scribe')
    : [];
  const seoHostTypeLabel = seoDiag?.hostType
    ? seoDiag.hostType
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase())
    : null;
  const seoHostServiceLabel = seoDiag?.hostService || null;
  const seoHostingProviderLabel = seoDiag?.hostingProvider || null;
  const seoProviderConfidence = seoDiag?.providerConfidence || null;
  const seoBusinessModelText = String(resolvedBusinessModel || '').toLowerCase();
  const seoHasCommerceModel = /e-?commerce|retail|store|shop|checkout|cart|product|marketplace|shopify|catalog/.test(seoBusinessModelText);
  const seoProviderNote = (() => {
    if (!seoHostingProviderLabel || seoProviderConfidence !== 'high') return null;
    if (seoHostingProviderLabel === 'Vercel' || seoHostingProviderLabel === 'Netlify' || seoHostingProviderLabel === 'Cloudflare Pages' || seoHostingProviderLabel === 'GitHub Pages') {
      return null;
    }
    if (seoHostingProviderLabel === 'Wix' || seoHostingProviderLabel === 'Squarespace' || seoHostingProviderLabel === 'GoDaddy') {
      if (!seoHasCommerceModel) {
        return `This site also appears to be built on ${seoHostingProviderLabel}. If you are not using its store or booking features, a lighter stack may cut recurring cost and give you more control.`;
      }
      return `This site also appears to be built on ${seoHostingProviderLabel}, so some structure and template constraints may come from the platform itself.`;
    }
    if (seoHostingProviderLabel === 'Shopify') {
      return 'This site appears to be built on Shopify, which usually makes sense when the business depends on built-in cart and checkout flows.';
    }
    return `This site also appears to be served from ${seoHostingProviderLabel}.`;
  })();
  const seoProviderTileNote = (() => {
    if (!seoHostingProviderLabel || seoProviderConfidence !== 'high') return null;
    if (seoHostingProviderLabel === 'Vercel' || seoHostingProviderLabel === 'Netlify' || seoHostingProviderLabel === 'Cloudflare Pages' || seoHostingProviderLabel === 'GitHub Pages') {
      return null;
    }
    if (seoHostingProviderLabel === 'Shopify') {
      return 'Built on Shopify, so some structure comes from its commerce platform.';
    }
    if (seoHostingProviderLabel === 'Wix' || seoHostingProviderLabel === 'Squarespace' || seoHostingProviderLabel === 'GoDaddy') {
      return `Built on ${seoHostingProviderLabel}, so some layout and template constraints may come from the platform itself.`;
    }
    return `Built on ${seoHostingProviderLabel}.`;
  })();
  const formatLogScalar = (value) => {
    if (value == null || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const formatLogList = (list, mapper = (item) => item) => {
    if (!Array.isArray(list) || !list.length) return '—';
    return list.map((item) => mapper(item)).filter(Boolean).join(' | ') || '—';
  };
  const countSeverity = (items, severity) => Array.isArray(items) ? items.filter((item) => item?.severity === severity).length : 0;

  // Derive rows for seo-performance card
  const seoAuditRows = (() => {
    if (seoCardState === 'queued') {
      return [
        { key: 'status', label: 'Status', value: 'Audit queued — results pending' },
        { key: 'strategy', label: 'Strategy', value: 'Mobile · PageSpeed Insights' },
      ];
    }
    if (seoCardState === 'error') {
      const errMsg = seoAudit?.error || 'PageSpeed audit failed.';
      const rows = [
        { key: 'status', label: 'Status', value: 'Audit failed — retry available' },
        { key: 'target', label: 'Target', value: seoAudit?.websiteUrl || client?.websiteUrl || '—' },
      ];
      if (seoDiag?.failureReason) rows.push({ key: 'cause', label: 'Cause', value: seoDiag.failureReason });
      if (seoDiag?.resolvedUrl && seoDiag.resolvedUrl !== (seoAudit?.websiteUrl || client?.websiteUrl || '')) {
        rows.push({ key: 'resolved', label: 'Resolved URL', value: seoDiag.resolvedUrl });
      }
      if (seoHostServiceLabel) {
        rows.push({ key: 'host-service', label: 'Hosting service', value: seoHostServiceLabel });
      }
      if (seoHostingProviderLabel) {
        rows.push({ key: 'hosting-provider', label: 'Hosting provider', value: seoHostingProviderLabel });
      }
      if (seoProviderConfidence) {
        rows.push({ key: 'provider-confidence', label: 'Provider confidence', value: seoProviderConfidence });
      }
      if (seoHostTypeLabel && seoHostTypeLabel !== 'Standard') {
        rows.push({ key: 'host-type', label: 'Host type', value: seoHostTypeLabel });
      }
      if (seoDiag?.redirectCount) rows.push({ key: 'redirects', label: 'Redirects', value: String(seoDiag.redirectCount) });
      if (seoDiag?.httpStatus != null) rows.push({ key: 'http-status', label: 'HTTP status', value: String(seoDiag.httpStatus) });
      if (seoDiag?.blockedBy) rows.push({ key: 'blocked-by', label: 'Blocked by', value: seoDiag.blockedBy });
      rows.push({ key: 'error', label: 'Error', value: errMsg.length > 140 ? `${errMsg.slice(0, 137)}…` : errMsg });
      rows.push(
        { key: 'strategy', label: 'Strategy', value: 'Mobile · PageSpeed Insights' },
      );
      return rows;
    }
    if (seoCardState === 'no-url') {
      return buildWorkNeededRows('No website URL on file. Submit a URL to trigger the PageSpeed audit.');
    }
    const {
      scores, coreWebVitals, labCoreWebVitals, opportunities,
      seoRedFlags, a11yFailures, bpFailures, insights, diagnostics, thirdParties, meta,
    } = seoAudit;
    const rows = [];
    const catMap = { FAST: 'FAST', AVERAGE: 'AVG', SLOW: 'SLOW' };

    // ── ANALYSIS (intelligence source summary) ──
    if (isFromIntelligence && intelligenceSummary) {
      rows.push({ key: 'hdr-analysis', label: '── ANALYSIS ──', isHeader: true, id: 'seo-audit-analysis' });
      rows.push({ key: 'analysis-summary', label: 'Assessment', value: intelligenceSummary });
      if (seoHostingProviderLabel) {
        rows.push({
          key: 'analysis-provider',
          label: 'Platform',
          value: `${seoHostingProviderLabel}${seoProviderConfidence ? ` (${seoProviderConfidence} confidence)` : ''}`,
        });
      }
      if (seoProviderNote) {
        rows.push({ key: 'analysis-provider-note', label: 'Provider note', value: seoProviderNote });
      }
    }

    // ── PARTIAL NOTICE ──
    if (seoCardState === 'partial') {
      const rtCode = seoAudit.runtimeError?.code || 'UNKNOWN';
      const rtMsg  = seoAudit.runtimeError?.message || 'Lighthouse could not fully load the page.';
      rows.push({ key: 'hdr-partial', label: '── PARTIAL AUDIT ──', isHeader: true, id: 'seo-audit-partial' });
      rows.push({ key: 'partial-notice', label: 'Notice', value: 'Diagnostic data unavailable — scores and CWV may be incomplete', isFailing: true });
      if (seoDiag?.failureReason) rows.push({ key: 'partial-cause', label: 'Cause', value: seoDiag.failureReason });
      if (seoDiag?.resolvedUrl && seoDiag.resolvedUrl !== (seoAudit?.websiteUrl || client?.websiteUrl || '')) {
        rows.push({ key: 'partial-resolved', label: 'Resolved URL', value: seoDiag.resolvedUrl });
      }
      if (seoHostingProviderLabel) rows.push({ key: 'partial-provider', label: 'Hosting provider', value: seoHostingProviderLabel });
      if (seoProviderConfidence) rows.push({ key: 'partial-provider-confidence', label: 'Provider confidence', value: seoProviderConfidence });
      if (seoHostTypeLabel && seoHostTypeLabel !== 'Standard') {
        rows.push({ key: 'partial-host-type', label: 'Host type', value: seoHostTypeLabel });
      }
      if (seoDiag?.redirectCount) rows.push({ key: 'partial-redirects', label: 'Redirects', value: String(seoDiag.redirectCount) });
      rows.push({ key: 'partial-code', label: 'Error code', value: rtCode });
      rows.push({ key: 'partial-msg',  label: 'Detail', value: rtMsg.length > 140 ? `${rtMsg.slice(0, 137)}…` : rtMsg });
    }

    // ── SCORES ──
    rows.push({ key: 'hdr-scores', label: '── SCORES ──', isHeader: true, id: 'seo-audit-scores' });
    if (scores?.performance  != null) rows.push({ key: 'perf',  label: 'PERF',  value: `${scores.performance}/100` });
    if (scores?.seo          != null) rows.push({ key: 'seo',   label: 'SEO',   value: `${scores.seo}/100` });
    if (scores?.accessibility != null) rows.push({ key: 'a11y', label: 'A11Y',  value: `${scores.accessibility}/100` });
    if (scores?.bestPractices != null) rows.push({ key: 'bp',   label: 'BP',    value: `${scores.bestPractices}/100` });

    // ── CORE WEB VITALS ──
    rows.push({ key: 'hdr-cwv', label: '── CORE WEB VITALS ──', isHeader: true, id: 'seo-audit-cwv' });
    const lcp = coreWebVitals?.lcp?.p75 != null ? coreWebVitals.lcp : labCoreWebVitals?.lcp;
    rows.push({ key: 'lcp', label: 'LCP', value: lcp?.p75 != null
      ? `${(lcp.p75 / 1000).toFixed(1)}s${catMap[lcp.category] ? ' ' + catMap[lcp.category] : ''}${lcp.source === 'lab' ? ' (lab)' : ''}`
      : '—' });
    const inp = coreWebVitals?.inp;
    rows.push({ key: 'inp', label: 'INP', value: inp?.p75 != null
      ? `${inp.p75}ms${catMap[inp.category] ? ' ' + catMap[inp.category] : ''}`
      : '—' });
    const cls = coreWebVitals?.cls?.p75 != null ? coreWebVitals.cls : labCoreWebVitals?.cls;
    rows.push({ key: 'cls', label: 'CLS', value: cls?.p75 != null
      ? `${Number(cls.p75).toFixed(2)}${cls.source === 'lab' ? ' (lab)' : ''}`
      : '—' });
    const ttfb = coreWebVitals?.ttfb?.p75 != null ? coreWebVitals.ttfb : labCoreWebVitals?.ttfb;
    rows.push({ key: 'ttfb', label: 'TTFB', value: ttfb?.p75 != null
      ? `${(ttfb.p75 / 1000).toFixed(1)}s${ttfb.source === 'lab' ? ' (lab)' : ''}`
      : '—' });

    // ── TOP FIXES ──
    rows.push({ key: 'hdr-fixes', label: '── TOP FIXES ──', isHeader: true, id: 'seo-audit-fixes' });
    if (opportunities?.length) {
      opportunities.forEach((op, i) => {
        rows.push({ key: `fix-${i}`, label: `FIX ${i + 1}`, value: `${op.title} — ${op.savingsMs}ms` });
      });
    } else {
      rows.push({ key: 'fix-none', label: 'Status', value: 'No savings opportunities found' });
    }

    // ── SEO FLAGS ──
    rows.push({ key: 'hdr-seo', label: '── SEO FLAGS ──', isHeader: true, id: 'seo-audit-seo-flags' });
    if (seoRedFlags?.length) {
      seoRedFlags.forEach((flag) => {
        const flagId   = typeof flag === 'string' ? flag : flag.id;
        const flagDesc = typeof flag === 'string' ? null : flag.description;
        rows.push({ key: `seo-${flagId}`, label: (flagId || '').replace(/-/g, ' '), value: `Failing${flagDesc ? ' — ' + flagDesc : ''}`, isFailing: true });
      });
    } else {
      rows.push({ key: 'seo-ok', label: 'Status', value: 'No issues found' });
    }

    // ── ACCESSIBILITY FLAGS ──
    rows.push({ key: 'hdr-a11y', label: '── ACCESSIBILITY FLAGS ──', isHeader: true, id: 'seo-audit-a11y-flags' });
    if (a11yFailures?.length) {
      a11yFailures.forEach((flag) => {
        rows.push({ key: `a11y-${flag.id}`, label: flag.title, value: `Failing${flag.description ? ' — ' + flag.description : ''}`, isFailing: true });
      });
    } else {
      rows.push({ key: 'a11y-ok', label: 'Status', value: 'No issues found' });
    }

    // ── BEST PRACTICES FLAGS ──
    rows.push({ key: 'hdr-bp', label: '── BEST PRACTICES FLAGS ──', isHeader: true, id: 'seo-audit-bp-flags' });
    if (bpFailures?.length) {
      bpFailures.forEach((flag) => {
        rows.push({ key: `bp-${flag.id}`, label: flag.title, value: `Failing${flag.description ? ' — ' + flag.description : ''}`, isFailing: true });
      });
    } else {
      rows.push({ key: 'bp-ok', label: 'Status', value: 'No issues found' });
    }

    // ── INSIGHTS ──
    if (insights?.length) {
      rows.push({ key: 'hdr-insights', label: '── INSIGHTS ──', isHeader: true, id: 'seo-audit-insights' });
      insights.forEach((ins) => {
        rows.push({ key: `ins-${ins.id}`, label: ins.label, value: ins.value });
      });
    }

    // ── DIAGNOSTICS ──
    if (diagnostics?.length) {
      rows.push({ key: 'hdr-diag', label: '── DIAGNOSTICS ──', isHeader: true, id: 'seo-audit-diagnostics' });
      diagnostics.forEach((d) => {
        rows.push({ key: `diag-${d.id}`, label: d.label, value: d.value });
      });
    }

    // ── THIRD PARTIES ──
    if (thirdParties?.length) {
      rows.push({ key: 'hdr-tp', label: '── THIRD PARTIES ──', isHeader: true, id: 'seo-audit-third-parties' });
      thirdParties.forEach((tp, i) => {
        const tpParts = [];
        if (tp.blockingMs != null) tpParts.push(`${tp.blockingMs}ms blocking`);
        if (tp.sizeFormatted)      tpParts.push(tp.sizeFormatted);
        rows.push({ key: `tp-${i}`, label: tp.entity, value: tpParts.join(' · ') || '—' });
      });
    }

    // ── META ──
    rows.push({ key: 'hdr-meta', label: '── META ──', isHeader: true, id: 'seo-audit-meta' });
    if (seoAudit.fetchedAt) {
      const ago = (() => {
        try {
          const ms   = Date.now() - new Date(seoAudit.fetchedAt).getTime();
          const mins = Math.round(ms / 60_000);
          if (mins < 1)  return 'just now';
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.round(mins / 60);
          return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
        } catch { return null; }
      })();
      if (ago) rows.push({ key: 'meta-audited', label: 'Audited', value: ago });
    }
    if (meta?.lighthouseVersion)       rows.push({ key: 'meta-lh',  label: 'Lighthouse',     value: meta.lighthouseVersion });
    if (meta?.totalDurationMs != null) rows.push({ key: 'meta-dur', label: 'Audit duration', value: `${(meta.totalDurationMs / 1000).toFixed(1)}s` });
    if (seoDiag?.resolvedUrl && seoDiag.resolvedUrl !== (seoAudit?.websiteUrl || client?.websiteUrl || '')) {
      rows.push({ key: 'meta-resolved-url', label: 'Resolved URL', value: seoDiag.resolvedUrl });
    }
    rows.push({ key: 'meta-host-service', label: 'Hosting service', value: formatLogScalar(seoDiag?.hostService) });
    rows.push({ key: 'meta-hosting-provider', label: 'Hosting provider', value: formatLogScalar(seoDiag?.hostingProvider) });
    rows.push({ key: 'meta-provider-kind', label: 'Provider kind', value: formatLogScalar(seoDiag?.providerKind) });
    rows.push({ key: 'meta-provider-confidence', label: 'Provider confidence', value: formatLogScalar(seoDiag?.providerConfidence) });
    if (seoHostTypeLabel && seoHostTypeLabel !== 'Standard') {
      rows.push({ key: 'meta-host-type', label: 'Host type', value: seoHostTypeLabel });
    }
    if (seoDiag?.redirectCount) rows.push({ key: 'meta-redirects', label: 'Redirects', value: String(seoDiag.redirectCount) });
    rows.push({ key: 'meta-warn', label: 'Warnings', value: meta?.warnings?.length ? meta.warnings.join(' · ') : '—' });

    // ── RUN MICRO LOG ──
    rows.push({ key: 'hdr-run-micro-log', label: '── RUN MICRO LOG ──', isHeader: true, id: 'seo-audit-run-micro-log' });
    rows.push({ key: 'run-status', label: 'Run status', value: formatLogScalar(currentRun?.status || latestRunStatus) });
    rows.push({ key: 'run-source-url', label: 'Run source URL', value: formatLogScalar(currentRun?.sourceUrl || client?.websiteUrl) });
    rows.push({ key: 'run-error-message', label: 'Run error', value: formatLogScalar(currentRun?.error?.message || errorState?.message) });
    rows.push({ key: 'run-psi-warning-codes', label: 'PSI warning codes', value: formatLogList(seoRunWarnings, (w) => w?.code) });
    rows.push({ key: 'run-psi-warning-msgs', label: 'PSI warning messages', value: formatLogList(seoRunWarnings, (w) => w?.message) });
    rows.push({
      key: 'run-psi-warning-details',
      label: 'PSI warning details',
      value: formatLogList(seoRunWarnings, (w) => {
        const d = w?.details;
        if (!d) return null;
        return [
          d.failureCode,
          d.failureClass,
          d.httpStatus != null ? `http=${d.httpStatus}` : null,
          d.hostType ? `host=${d.hostType}` : null,
          d.hostingProvider ? `provider=${d.hostingProvider}` : null,
          d.providerConfidence ? `confidence=${d.providerConfidence}` : null,
          d.redirectCount != null ? `redirects=${d.redirectCount}` : null,
        ].filter(Boolean).join(' · ');
      }),
    });
    rows.push({ key: 'run-psi-audit-status', label: 'PSI audit status', value: formatLogScalar(seoAudit?.status) });
    rows.push({
      key: 'run-psi-data-presence',
      label: 'PSI data presence',
      value: [
        `scores:${seoAudit?.scores ? 'yes' : 'no'}`,
        `cwv:${seoAudit?.coreWebVitals || seoAudit?.labCoreWebVitals ? 'yes' : 'no'}`,
        `opps:${seoAudit?.opportunities?.length ?? 0}`,
        `flags:${seoAudit?.seoRedFlags?.length ?? 0}`,
        `diag:${seoAudit?.diagnostics?.length ?? 0}`,
      ].join(' · '),
    });
    rows.push({ key: 'run-psi-failure-code', label: 'Failure code', value: formatLogScalar(seoDiag?.failureCode) });
    rows.push({ key: 'run-psi-failure-class', label: 'Failure class', value: formatLogScalar(seoDiag?.failureClass) });
    rows.push({ key: 'run-psi-failure-reason', label: 'Failure reason', value: formatLogScalar(seoDiag?.failureReason || seoAudit?.error) });
    rows.push({ key: 'run-psi-input-url', label: 'Input URL', value: formatLogScalar(seoDiag?.inputUrl || client?.websiteUrl) });
    rows.push({ key: 'run-psi-requested-url', label: 'Requested URL', value: formatLogScalar(meta?.requestedUrl) });
    rows.push({ key: 'run-psi-final-url', label: 'Final URL', value: formatLogScalar(meta?.finalUrl) });
    rows.push({ key: 'run-psi-displayed-url', label: 'Displayed URL', value: formatLogScalar(meta?.finalDisplayedUrl) });
    rows.push({ key: 'run-psi-resolved-url', label: 'Probe resolved URL', value: formatLogScalar(seoDiag?.resolvedUrl) });
    rows.push({ key: 'run-psi-http-status', label: 'Probe HTTP status', value: formatLogScalar(seoDiag?.httpStatus) });
    rows.push({ key: 'run-psi-content-type', label: 'Content type', value: formatLogScalar(seoDiag?.contentType) });
    rows.push({ key: 'run-psi-server', label: 'Server', value: formatLogScalar(seoDiag?.server) });
    rows.push({ key: 'run-psi-host-service', label: 'Hosting service', value: formatLogScalar(seoDiag?.hostService) });
    rows.push({ key: 'run-psi-hosting-provider', label: 'Hosting provider', value: formatLogScalar(seoDiag?.hostingProvider) });
    rows.push({ key: 'run-psi-provider-kind', label: 'Provider kind', value: formatLogScalar(seoDiag?.providerKind) });
    rows.push({ key: 'run-psi-provider-confidence', label: 'Provider confidence', value: formatLogScalar(seoDiag?.providerConfidence) });
    rows.push({ key: 'run-psi-provider-evidence', label: 'Provider evidence', value: formatLogList(seoDiag?.providerEvidence) });
    rows.push({ key: 'run-psi-host-type', label: 'Host type', value: formatLogScalar(seoDiag?.hostType) });
    rows.push({ key: 'run-psi-blocked-by', label: 'Blocked by', value: formatLogScalar(seoDiag?.blockedBy) });
    rows.push({ key: 'run-psi-probe-status', label: 'Probe status', value: formatLogScalar(seoDiag?.probeStatus) });
    rows.push({ key: 'run-psi-probe-error-code', label: 'Probe error code', value: formatLogScalar(seoDiag?.probeErrorCode) });
    rows.push({ key: 'run-psi-probe-error', label: 'Probe error', value: formatLogScalar(seoDiag?.probeError) });
    rows.push({ key: 'run-psi-redirect-count', label: 'Redirect count', value: formatLogScalar(seoDiag?.redirectCount) });
    rows.push({
      key: 'run-psi-redirect-chain',
      label: 'Redirect chain',
      value: formatLogList(seoDiag?.redirectChain, (hop) => hop ? `${hop.status || '?'} ${hop.from || '—'} -> ${hop.to || '—'}` : null),
    });
    rows.push({ key: 'run-psi-runtime-code', label: 'Runtime error code', value: formatLogScalar(seoAudit?.runtimeError?.code || seoDiag?.runtimeErrorCode) });
    rows.push({ key: 'run-psi-runtime-msg', label: 'Runtime error message', value: formatLogScalar(seoAudit?.runtimeError?.message || seoDiag?.runtimeErrorMessage) });
    rows.push({ key: 'run-psi-fetch-time', label: 'Fetch time', value: formatLogScalar(meta?.fetchTime) });
    rows.push({ key: 'run-psi-duration-ms', label: 'Duration ms', value: formatLogScalar(meta?.totalDurationMs) });
    rows.push({ key: 'run-psi-lh-version', label: 'Lighthouse version', value: formatLogScalar(meta?.lighthouseVersion) });
    rows.push({ key: 'run-psi-meta-warnings', label: 'Lighthouse warnings', value: formatLogList(meta?.warnings) });
    rows.push({
      key: 'run-psi-opportunities',
      label: 'Top opportunities',
      value: formatLogList((seoAudit?.opportunities || []).slice(0, 5), (op) => op?.title ? `${op.title} (${op.savingsMs ?? '—'}ms)` : null),
    });
    rows.push({
      key: 'run-psi-flag-ids',
      label: 'SEO red flags',
      value: formatLogList(seoAudit?.seoRedFlags, (flag) => typeof flag === 'string' ? flag : flag?.id),
    });
    rows.push({
      key: 'run-psi-diagnostic-ids',
      label: 'Diagnostic ids',
      value: formatLogList(seoAudit?.diagnostics, (d) => d?.id),
    });

    // ── AI TRACE ──
    rows.push({ key: 'hdr-ai-trace', label: '── AI TRACE ──', isHeader: true, id: 'seo-audit-ai-trace' });
    rows.push({ key: 'ai-synth-model', label: 'Synthesis model', value: formatLogScalar(currentRun?.providerUsage?.model) });
    rows.push({ key: 'ai-synth-input', label: 'Synthesis input tokens', value: formatLogScalar(currentRun?.providerUsage?.inputTokens) });
    rows.push({ key: 'ai-synth-output', label: 'Synthesis output tokens', value: formatLogScalar(currentRun?.providerUsage?.outputTokens) });
    rows.push({ key: 'ai-synth-cost', label: 'Synthesis cost USD', value: formatLogScalar(currentRun?.providerUsage?.estimatedCostUsd) });
    rows.push({ key: 'seo-skill-run-at', label: 'SEO depth skill runAt', value: formatLogScalar(seoDepthAudit?.runAt) });
    rows.push({ key: 'seo-skill-model', label: 'SEO depth skill model', value: formatLogScalar(seoDepthAudit?.metadata?.model) });
    rows.push({ key: 'seo-skill-cost', label: 'SEO depth skill cost USD', value: formatLogScalar(seoDepthAudit?.metadata?.estimatedCostUsd) });
    rows.push({ key: 'seo-skill-readiness', label: 'SEO depth readiness', value: formatLogScalar(seoDepthAudit?.readiness || seoAnalyzerCard?.aggregate?.readiness) });
    rows.push({ key: 'seo-skill-critical', label: 'SEO critical findings', value: formatLogScalar(countSeverity(seoDepthAudit?.findings, 'critical')) });
    rows.push({ key: 'seo-skill-warning', label: 'SEO warning findings', value: formatLogScalar(countSeverity(seoDepthAudit?.findings, 'warning')) });
    rows.push({ key: 'seo-skill-gap-count', label: 'SEO triggered gaps', value: formatLogScalar(Array.isArray(seoDepthAudit?.gaps) ? seoDepthAudit.gaps.filter((g) => g?.triggered).length : null) });
    rows.push({ key: 'seo-skill-highlights', label: 'SEO skill highlights', value: formatLogList(seoDepthAudit?.highlights) });
    rows.push({ key: 'seo-skill-warning-codes', label: 'Skill warning codes', value: formatLogList(skillRunWarnings, (w) => w?.code) });
    rows.push({ key: 'seo-skill-warning-msgs', label: 'Skill warning messages', value: formatLogList(skillRunWarnings, (w) => w?.message) });
    rows.push({
      key: 'seo-knowledge-base',
      label: 'Knowledge Base',
      value: summarizeKnowledgeBaseSources(globalKnowledgeBaseSources, 'Available for claim-check context'),
    });
    rows.push({ key: 'seo-scribe-warning-codes', label: 'Scribe warning codes', value: formatLogList(scribeRunWarnings, (w) => w?.code) });
    rows.push({ key: 'seo-scribe-warning-msgs', label: 'Scribe warning messages', value: formatLogList(scribeRunWarnings, (w) => w?.message) });
    rows.push({ key: 'seo-guardian-source', label: 'SEO guardian source', value: formatLogScalar(seoGuardianState?.source) });
    rows.push({ key: 'seo-guardian-cost', label: 'SEO guardian cost USD', value: formatLogScalar(seoGuardianState?.runCostData?.estimatedCostUsd) });
    rows.push({ key: 'seo-guardian-validation', label: 'SEO guardian validation', value: formatLogList(seoGuardianState?.validationErrors) });

    return rows;
  })();

  const seoPrimaryLcp = seoAudit?.coreWebVitals?.lcp?.p75 != null
    ? seoAudit.coreWebVitals.lcp
    : seoAudit?.labCoreWebVitals?.lcp || null;

  const seoAuditDescription = (() => {
    if (seoCardState === 'queued')  return 'PageSpeed Insights audit is queued — mobile scores and Core Web Vitals will appear here.';
    if (seoCardState === 'error')   return seoDiag?.failureReason
      ? `${seoDiag.failureReason}${seoProviderNote ? ` ${seoProviderNote}` : ''} Re-run to retry after the access issue is fixed.`
      : 'PageSpeed audit could not complete. Press Re-run to retry — details below.';
    if (seoCardState === 'no-url')  return buildUnavailableDescription('PageSpeed performance data');
    if (seoCardState === 'partial') return seoDiag?.failureReason
      ? `Partial audit — ${seoDiag.failureReason}${seoProviderNote ? ` ${seoProviderNote}` : ''} Scores may be incomplete.`
      : 'Partial audit — Lighthouse could not fully load the page. Scores may be incomplete. Re-run to retry.';
    const { scores, opportunities, meta } = seoAudit;
    const parts = [];
    if (scores?.performance  != null) parts.push(`PERF ${scores.performance}`);
    if (scores?.seo          != null) parts.push(`SEO ${scores.seo}`);
    if (scores?.accessibility != null) parts.push(`A11Y ${scores.accessibility}`);
    if (scores?.bestPractices != null) parts.push(`BP ${scores.bestPractices}`);
    const fixCount = opportunities?.length ?? 0;
    if (fixCount) parts.push(`${fixCount} fix${fixCount === 1 ? '' : 'es'}`);
    if (meta?.totalDurationMs != null) parts.push(`${(meta.totalDurationMs / 1000).toFixed(0)}s`);
    if (seoHostingProviderLabel && seoProviderConfidence === 'high') parts.push(`built on ${seoHostingProviderLabel}`);
    return parts.join(' · ');
  })();
  // Derive rows for agent-readiness card
  const agentReadinessData  = analyzerOutputs?.['agent-readiness']?.skills?.['agent-readiness'] || null;
  const agentReadinessAiSeo = analyzerOutputs?.['agent-readiness']?.skills?.['ai-seo-audit']    || null;
  const agentReadinessState = moduleState?.['agent-readiness']?.status || 'disabled';
  const hasAgentReadinessData = !!(agentReadinessData?.score != null);
  const agentReadinessRows = (() => {
    if (agentReadinessState === 'queued') {
      return [{ key: 'ar-status', label: 'Status', value: 'Audit queued — results pending' }];
    }
    if (!hasAgentReadinessData) {
      return buildWorkNeededRows('Run the AI Agent Readiness check to see how well your site supports AI crawlers and agents.');
    }
    const rows = [];
    rows.push({ key: 'ar-score',   label: 'Overall Score', value: `${Math.round(agentReadinessData.score)} / 100` });
    rows.push({ key: 'ar-verdict', label: 'Verdict',       value: agentReadinessData.verdict || '—' });
    const dims = agentReadinessData.dimensions || {};
    const DIM_LABELS = { discoverability: 'Discoverability', accessibility: 'Accessibility', botAccess: 'Bot Access', capabilities: 'Capabilities' };
    for (const [key, val] of Object.entries(dims)) {
      if (val != null) rows.push({ key: `ar-dim-${key}`, label: DIM_LABELS[key] || key, value: `${Math.round(val)} / 100` });
    }
    const aiScore = agentReadinessAiSeo?.aiVisibility?.score;
    if (aiScore != null) rows.push({ key: 'ar-ai-score', label: 'AI Visibility', value: `${aiScore} / 100` });
    rows.push({
      key: 'ar-knowledge-base',
      label: 'Knowledge Base',
      value: summarizeKnowledgeBaseSources(globalKnowledgeBaseSources, 'Available for claim-check context'),
    });
    const failedChecks = (agentReadinessData.checks || []).filter((c) => c.status === 'fail' || c.status === 'warn');
    if (failedChecks.length > 0) {
      rows.push({ key: 'ar-checks-hdr', label: '── CHECKS NEEDING ATTENTION ──', isHeader: true });
      failedChecks.slice(0, 6).forEach((c) => {
        rows.push({ key: `ar-check-${c.id}`, label: c.id, value: c.status.toUpperCase() });
      });
    }
    const cfSignals = agentReadinessData?.cfSignals;
    if (cfSignals) {
      rows.push({ key: 'ar-cf-hdr', label: '── CLOUDFLARE SCAN ──', isHeader: true });
      rows.push({ key: 'ar-cf-cdn',    label: 'Cloudflare CDN',    value: cfSignals.onCloudflare  ? 'Detected'     : 'Not detected' });
      if (cfSignals.cacheStatus)   rows.push({ key: 'ar-cf-cache',  label: 'Cache Status',        value: cfSignals.cacheStatus });
      if (cfSignals.botManagement) rows.push({ key: 'ar-cf-bot',    label: 'Bot Management',      value: 'Active'  });
      rows.push({ key: 'ar-cf-radar',  label: 'Radar API',         value: cfSignals.radarAvailable ? 'Connected'   : 'No token set' });
      if (cfSignals.radarRank?.rank)   rows.push({ key: 'ar-cf-rank', label: 'Radar Rank', value: `#${cfSignals.radarRank.rank.toLocaleString()}` });
      const customFixCount = Object.keys(agentReadinessData?.customFixes || {}).length;
      if (customFixCount > 0) rows.push({ key: 'ar-custom-fixes', label: 'LLM Fix Prompts', value: `${customFixCount} generated` });
    }
    return rows;
  })();

  const DETERMINISTIC_CARD_IDS = new Set([
    'audit-summary', 'brief', 'multi-device-view', 'social-preview',
    'business-model', 'seo-performance', 'agent-readiness', 'style-guide', 'design-evaluation', 'industry', 'visibility-snapshot', 'priority-signal',
    'marketing-brief', 'brief-marketing', 'brief-creative', 'brief-competitor', 'brief-strategy', 'brief-performance',
  ]);

  const intakeCapabilityCards = [
    // ── ONBOARDING ──────────────────────────────────────────────────────────
    {
      id: 'brief',
      category: 'onboarding',
      number: 'BR',
      label: 'BRIEF',
      title: 'Client Brief',
      description: brandOverview?.headline
        ? brandOverview.headline
        : hasMarketingBriefData
          ? 'Founder-ready daily marketing brief generated from Scout, Scribe, and Guardian.'
          : 'A structured breakdown of your business, positioning, and site. This becomes the baseline for all strategy and recommendations.',
      placeholderLabel: hasBriefDocumentData ? 'BRIEF' : 'NO\nBRIEF',
      rows: hasIntakeData
        ? [
            { key: 'industry',   label: 'Industry',  value: resolvedIndustry || 'Pending' },
            { key: 'model',      label: 'Model',     value: resolvedBusinessModel || 'Pending' },
            { key: 'tone',       label: 'Tone',      value: brandTone?.primary || 'Pending' },
            { key: 'priority',   label: 'Priority',  value: resolvedPrioritySignal || 'Pending' },
            { key: 'channels',   label: 'Channels',  value: strategy?.postStrategy?.formats?.join(' · ') || 'Pending' },
          ]
        : hasMarketingBriefData
          ? [
              { key: 'mb-brief-priority', label: 'Priority', value: marketingBrief?.headline || dashboardState?.headline || 'Generated' },
              { key: 'mb-brief-x', label: 'X Post', value: marketingBrief?.content?.x_post || marketingBrief?.content?.primary_post || 'Generated' },
              { key: 'mb-brief-scout', label: 'Scout Brief', value: marketingBrief?.scoutBrief?.humanBrief ? 'Available' : 'No Scout text' },
              { key: 'mb-brief-guardian', label: 'Guardian', value: marketingBrief?.guardianFlags?.readyToPublish ? 'Ready to publish' : 'Needs review' },
            ]
          : buildWorkNeededRows('Intake has not produced enough signal to generate a reliable brief.'),
      footerLeft: hasBriefDocumentData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },

    // ── COMPANY BRAIN ───────────────────────────────────────────────────────
    {
      id: 'survey-status',
      category: 'knowledge',
      number: 'SV',
      label: 'Q&A',
      title: 'Q&A',
      description: 'Across design, content, and systems. This survey helps me get the context I need upfront — so we skip the back-and-forth and get straight to the work that matters.',
      placeholderLabel: 'SURVEY',
      rows: (() => {
        const total = onboardingSummary?.total ?? 10;
        const answered = onboardingSummary?.answeredCount ?? 0;
        return [
          { key: 'sv-answered', label: 'Answered', value: `${answered} / ${total}` },
          { key: 'sv-status',   label: 'Status',   value: onboardingSummary?.completedAt ? 'Complete' : answered > 0 ? 'In progress' : 'Not started' },
        ];
      })(),
      footerLeft: onboardingSummary?.completedAt ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'SURVEY',
      surveyStatus: (() => {
        if (onboardingSummary?.completedAt) return 'complete';
        if ((onboardingSummary?.answeredCount ?? 0) > 0) return 'partial';
        return 'empty';
      })(),
    },
    {
      id: 'business-model',
      category: 'knowledge',
      number: 'BM',
      label: 'MODEL',
      title: 'Business Model',
      description: 'Based on your site, we identified your business model and positioning. This helps shape how content, SEO, and messaging should be structured.',
      placeholderLabel: hasBusinessModelData ? 'MODEL' : 'NO\nMODEL',
      rows: hasBusinessModelData
        ? [
            { key: 'model', label: 'Structure', value: resolvedBusinessModel },
            { key: 'bm-knowledge-base', label: 'Knowledge Base', value: knowledgeBaseSourceSummary },
          ]
        : buildWorkNeededRows('No pricing, packaging, or service structure was clear in fetched pages.'),
      footerLeft: hasBusinessModelData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'industry',
      category: 'knowledge',
      number: 'MC',
      label: 'CATEGORY',
      title: 'Market Category',
      description: categoryDescription,
      placeholderLabel: categoryShellLabel,
      rows: hasCategoryData
        ? [
            { key: 'sector', label: 'Sector', value: resolvedCategory },
            {
              key: 'sector-src',
              label: 'Source',
              value:
                dashboardState?.marketCategory?.source === 'agent'
                  ? 'Agent-classified'
                  : dashboardState?.marketCategory?.value
                  ? 'User-set'
                  : 'Auto-detected',
            },
            {
              key: 'sector-kb',
              label: 'Knowledge Base',
              value: summarizeKnowledgeBaseSources(marketCategoryKnowledgeBaseSources, 'Available for category evidence'),
            },
          ]
        : buildWorkNeededRows('No category yet — open this card and Run analysis, or set it manually.'),
      footerLeft: hasCategoryData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'RUN · EDIT',
      footerAction: {
        label: marketCategoryRunLoading ? '…' : hasCategoryData ? 'Re-run' : 'RUN',
        loading: marketCategoryRunLoading,
        onClick: runMarketCategoryAnalyze,
      },
    },
    {
      id: 'audit-summary',
      category: 'knowledge',
      number: 'DQ',
      label: 'DATA QUALITY',
      title: 'Data Stream',
      description: 'A live read on how much data has been captured — across Brief, Market, Brain, Brand, and Web.',
      ...(() => {
        // A field counts as captured only when it holds real data. Critically,
        // numeric 0 (e.g. an empty `?.length` for KB sources, KOL signals, etc.)
        // is NOT captured — otherwise every count row with zero items reads green.
        const ok = (v) => v != null && v !== '' && v !== false && v !== 0;
        const st = (v) => ok(v) ? 'Captured' : 'Missing';
        const row = (key, label, v, tierLevel = 1) => ({
          key, label,
          status: tierLevel > 1 ? 'Upgrade ↗' : st(v),
          tier: tierLevel === 1 ? 'Onboarding' : tierLevel === 2 ? 'Weekly' : tierLevel === 3 ? 'Daily' : 'Pro',
          isAuditRow: true,
          _captured: tierLevel === 1 ? ok(v) : false,
          isUpgrade: tierLevel > 1,
        });
        const evidence = dashboardState?.snapshot ? true : false;
        const pages = dashboardState?.evidence?.pages || [];
        const homePage = pages[0] || null;
        const scoutCfg = dashboardState?.scoutConfig || null;
        const seoMeta = seoAudit?.meta || null;
        const seoDiagnostics = seoAudit?.diagnosticsContext || null;
        const runWarnings = Array.isArray(currentRun?.warnings) ? currentRun.warnings : [];
        const psiWarnings = runWarnings.filter((w) => w?.stage === 'psi');
        const skillsWarnings = runWarnings.filter((w) => w?.stage === 'skills');
        const scribeWarnings = runWarnings.filter((w) => w?.stage === 'scribe');
        const countSeverity = (items, severity) => Array.isArray(items) ? items.filter((item) => item?.severity === severity).length : 0;

        const allRows = [
          { key: 'col-header', isAuditRow: true, isColumnHeader: true, label: 'DATA FIELD', tier: 'TIER', status: 'STATUS' },

          // NOTE: EXECUTIVE DAILY BRIEF rows were removed from the Data Quality
          // score — the brief is pipeline OUTPUT ("what's been run"), not incoming
          // data. It still lives on its own card and in the daily email.

          // ── STRATEGY BUILDER ──────────────────────────────────────────────
          { key: 'sec-strategy', isHeader: true, label: 'STRATEGY BUILDER', cardId: 'strategy-builder', cardCategory: 'growth' },
          row('strat-post',        'Post strategy',         strategy?.postStrategy),
          row('strat-angles',      'Content angles',        strategy?.contentAngles?.length),
          row('strat-opps',        'Opportunity map',       strategy?.opportunityMap?.length),
          row('strat-priority',    'Priority signal',       resolvedPrioritySignal),
          row('strat-draft',       'Sample post',           dashboardState?.outputsPreview?.samplePost),
          row('strat-caption',     'Sample caption',        dashboardState?.outputsPreview?.sampleCaption),
          row('strat-kb-sources',  'KB sources used',       strategyBuilderKnowledgeBaseSources?.length),

          // ── COMPANY BRAIN (Knowledge Base) ────────────────────────────────
          { key: 'sec-knowledge', isHeader: true, label: 'COMPANY BRAIN', cardId: 'knowledge-base', cardCategory: 'knowledge' },
          row('kb-global',         'Brain sources',         globalKnowledgeBaseSources?.length),
          row('kb-brief',          'Brief KB sources',      marketingBriefKnowledgeBaseSources?.length),
          row('kb-strategy',       'Strategy KB sources',   strategyBuilderKnowledgeBaseSources?.length),
          row('kb-brand',          'Brand system KB',       brandSystemKnowledgeBaseSources?.length),
          row('kb-market',         'Market category KB',    marketCategoryKnowledgeBaseSources?.length),

          // ── MARKET CATEGORY ───────────────────────────────────────────────
          { key: 'sec-market', isHeader: true, label: 'MARKET CATEGORY', cardId: 'industry', cardCategory: 'knowledge' },
          row('mkt-industry',      'Industry',              resolvedIndustry),
          row('mkt-model',         'Business model',        resolvedBusinessModel),
          row('mkt-audience',      'Target audience',       brandOverview?.targetAudience),
          row('mkt-positioning',   'Positioning',           brandOverview?.positioning),
          row('mkt-headline',      'Brand headline',        brandOverview?.headline),
          row('mkt-summary',       'Brand summary',         brandOverview?.summary),

          // ── BRAND VOICE ───────────────────────────────────────────────────
          { key: 'sec-brand-voice', isHeader: true, label: 'BRAND VOICE', cardId: 'brand-voice', cardCategory: 'content' },
          row('bv-tone-pri',       'Tone (primary)',        brandTone?.primary),
          row('bv-tone-sec',       'Tone (secondary)',      brandTone?.secondary),
          row('bv-writing-style',  'Writing style',         brandTone?.writingStyle),
          row('bv-tone-tags',      'Tone tags',             brandTone?.tags?.length),

          // ── BRAND IDENTITY ────────────────────────────────────────────────
          { key: 'sec-brand-id', isHeader: true, label: 'BRAND IDENTITY', cardId: 'brand-system', cardCategory: 'content' },
          row('bi-prompt',         'Master prompt',         dashboardState?.brandSystem?.masterPrompt),
          row('bi-json',           'Brand JSON',            dashboardState?.brandSystem?.json),
          row('bi-kb-sources',     'KB sources used',       brandSystemKnowledgeBaseSources?.length),
          row('bi-art-report',     'Brand asset report',    dashboardState?.artifacts?.skillDocs?.['brand-asset-gap']),

          // ── NEWSLETTER ────────────────────────────────────────────────────
          { key: 'sec-newsletter', isHeader: true, label: 'NEWSLETTER', cardId: 'newsletter', cardCategory: 'growth' },
          row('nl-hero',           'Hero story',            dashboardState?.newsletter?.content?.hero_story),
          row('nl-status',         'Run status',            moduleState?.['newsletter']?.status),

          // ── SEO PERFORMANCE ───────────────────────────────────────────────
          { key: 'sec-psi', isHeader: true, label: 'SEO PERFORMANCE', cardId: 'seo-performance', cardCategory: 'website' },
          row('psi-perf',          'Performance score',     seoAudit?.scores?.performance),
          row('psi-seo',           'SEO score',             seoAudit?.scores?.seo),
          row('psi-a11y',          'Accessibility',         seoAudit?.scores?.accessibility),
          row('psi-bp',            'Best practices',        seoAudit?.scores?.bestPractices),
          row('psi-lcp',           'LCP',                   seoAudit?.coreWebVitals?.lcp || seoAudit?.labCoreWebVitals?.lcp),
          row('psi-inp',           'INP',                   seoAudit?.coreWebVitals?.inp),
          row('psi-cls',           'CLS',                   seoAudit?.coreWebVitals?.cls || seoAudit?.labCoreWebVitals?.cls),
          row('psi-ttfb',          'TTFB',                  seoAudit?.coreWebVitals?.ttfb || seoAudit?.labCoreWebVitals?.ttfb),
          row('psi-opps',          'Opportunities',         seoAudit?.opportunities?.length),
          row('psi-red-flags',     'SEO red flags',         seoAudit?.seoRedFlags?.length),
          row('psi-a11y-fail',     'A11y failures',         seoAudit?.a11yFailures?.length),
          row('psi-insights',      'Insights',              seoAudit?.insights?.length),
          row('psi-diagnostics',   'Diagnostics',           seoAudit?.diagnostics?.length),
          row('psi-3p',            'Third parties',         seoAudit?.thirdParties?.length),
          row('psi-depth-ready',   'SEO depth readiness',   seoDepthAudit?.readiness || seoAnalyzerCard?.aggregate?.readiness),
          row('psi-depth-crit',    'SEO depth criticals',   seoDepthAudit ? countSeverity(seoDepthAudit.findings, 'critical') : null),
          row('psi-depth-warn',    'SEO depth warnings',    seoDepthAudit ? countSeverity(seoDepthAudit.findings, 'warning') : null),
          row('psi-depth-gaps',    'SEO depth gaps',        Array.isArray(seoDepthAudit?.gaps) ? seoDepthAudit.gaps.filter((g) => g?.triggered).length : null),
          row('psi-depth-hl',      'SEO depth highlights',  seoDepthAudit?.highlights?.length),

          // ── STYLE GUIDE ───────────────────────────────────────────────────
          { key: 'sec-design', isHeader: true, label: 'STYLE GUIDE', cardId: 'style-guide', cardCategory: 'website' },
          row('ds-heading-font',   'Heading font',          sgDisplayData?.typography?.headingSystem?.fontFamily),
          row('ds-body-font',      'Body font',             sgDisplayData?.typography?.bodySystem?.fontFamily),
          row('ds-font-scale',     'Type scale',            sgDisplayData?.typography?.scale),
          row('ds-primary-color',  'Primary color',         sgDisplayData?.colors?.primary?.hex),
          row('ds-secondary',      'Secondary color',       sgDisplayData?.colors?.secondary?.hex),
          row('ds-tertiary',       'Tertiary color',        sgDisplayData?.colors?.tertiary?.hex),
          row('ds-neutral',        'Neutral color',         sgDisplayData?.colors?.neutral?.hex),
          row('ds-layout',         'Layout grid',           sgDisplayData?.layout?.grid),
          row('ds-max-width',      'Max width',             sgDisplayData?.layout?.maxWidth),
          row('ds-border-radius',  'Border radius',         sgDisplayData?.layout?.borderRadius),
          row('ds-motion',         'Motion level',          sgDisplayData?.motion?.level),
          row('ds-art-report',     'Style guide report',    dashboardState?.artifacts?.skillDocs?.['style-guide-audit']),

          // ── SOCIAL PREVIEW ────────────────────────────────────────────────
          { key: 'sec-meta', isHeader: true, label: 'SOCIAL PREVIEW', cardId: 'social-preview', cardCategory: 'website' },
          row('meta-og-title',     'og:title',              siteMeta?.title),
          row('meta-og-desc',      'og:description',        siteMeta?.description),
          row('meta-og-image',     'og:image',              siteMeta?.ogImage),
          row('meta-og-image-alt', 'og:image:alt',          siteMeta?.ogImageAlt),
          row('meta-site-name',    'og:site_name',          siteMeta?.siteName),
          row('meta-og-type',      'og:type',               siteMeta?.type),
          row('meta-locale',       'og:locale',             siteMeta?.locale),
          row('meta-canonical',    'Canonical URL',         siteMeta?.canonical),
          row('meta-favicon',      'Favicon',               siteMeta?.favicon),
          row('meta-apple-icon',   'Apple touch icon',      siteMeta?.appleTouchIcon),
          row('meta-theme',        'Theme color',           siteMeta?.themeColor),

          // ── MULTI-DEVICE VIEW ─────────────────────────────────────────────
          { key: 'sec-multidev', isHeader: true, label: 'MULTI-DEVICE VIEW', cardId: 'multi-device-view', cardCategory: 'website' },
          row('art-screenshot',    'Homepage screenshot',   homepageScreenshotUrl),
          row('art-full-desktop',  'Full page (desktop)',   fullPageScreenshots['desktop-full']?.downloadUrl),
          row('art-full-tablet',   'Full page (tablet)',    fullPageScreenshots['tablet-full']?.downloadUrl),
          row('art-full-mobile',   'Full page (mobile)',    fullPageScreenshots['mobile-full']?.downloadUrl),
          row('art-mockup',        'Device mockup',         intakeMockupSrc),

          // ── AGENT READINESS ───────────────────────────────────────────────
          { key: 'sec-agent', isHeader: true, label: 'AGENT READINESS', cardId: 'agent-readiness', cardCategory: 'website' },
          row('az-agent-ready',    'Agent readiness',       analyzerOutputs?.['agent-readiness']?.skills?.['agent-readiness']),
          row('az-site-meta',      'Site meta audit',       analyzerOutputs?.['brand-tone']),
          row('az-conversion',     'Conversion audit',      analyzerOutputs?.['website-landing']),

          // ── SITE EVIDENCE (baseline) ──────────────────────────────────────
          { key: 'sec-site', isHeader: true, label: 'SITE EVIDENCE' },
          row('site-url',          'Website URL',           client?.websiteUrl),
          row('site-pages',        'Pages crawled',         pages.length || (evidence ? true : null)),
          row('site-title',        'Page title',            siteMeta?.title),
          row('site-meta-desc',    'Meta description',      siteMeta?.description),
          row('site-h1',           'H1 heading',            homePage?.h1?.[0] || brandOverview?.headline),
          row('site-h2',           'H2 headings',           homePage?.h2?.length),
          row('site-body',         'Body paragraphs',       homePage?.bodyParagraphs?.length),
          row('site-cta',          'CTA texts',             homePage?.ctaTexts?.length),
          row('site-nav',          'Nav labels',            homePage?.navLabels?.length),
          row('site-social',       'Social links',          homePage?.socialLinks?.length),
          row('site-contact',      'Contact clues',         homePage?.contactClues?.length),

          // NOTE: ARTIFACTS rows (Brief HTML/PDF, audit reports) were removed from
          // the Data Quality score — they are generated outputs, not incoming data.

          // NOTE: MODULE STATUS / RUN HEALTH / PSI TRACE sections were removed
          // from the Data Quality score — they are operational diagnostics, not
          // incoming-data opportunities, and inflated the captured count (every
          // module reports a status string). Run health/status still live on the
          // individual module cards.

          // ── PLATFORM SEARCH (upgrade) ─────────────────────────────────────
          { key: 'sec-platforms', isHeader: true, label: 'PLATFORM SEARCH' },
          row('plat-reddit',         'Reddit',              null, 2),
          row('plat-producthunt',    'ProductHunt',         null, 2),
          row('plat-betalist',       'Betalist',            null, 2),
          row('plat-uneed',          'Uneed',               null, 2),
          row('plat-trustmrr',       'TrustMRR',            null, 2),
          row('plat-fazier',         'Fazier',              null, 2),
          row('plat-openalt',        'OpenAlternative',     null, 2),
          row('plat-microlaunch',    'Microlaunch',         null, 2),
          row('plat-peerlist',       'Peerlist',            null, 2),
          row('plat-tinylaunch',     'TinyLaunch',          null, 2),
          row('plat-saashub',        'SaaSHub',             null, 2),
          row('plat-indiehackers',   'Indie Hackers',       null, 2),
          row('plat-hackernews',     'Hacker News',         null, 2),
          row('plat-toolfolio',      'Toolfolio',           null, 2),
          row('plat-tinystartup',    'Tiny Startup',        null, 2),
          row('plat-sideprojectors', 'SideProjectors',      null, 2),
          row('plat-alternativeto',  'AlternativeTo',       null, 2),
          row('plat-launchigniter',  'LaunchIgniter',       null, 2),
          row('plat-peerpush',       'PeerPush',            null, 2),
          row('plat-saasgenius',     'SaaS Genius',         null, 2),
          row('plat-theresanai',     "There's an AI for that", null, 2),
          row('plat-devhunt',        'DevHunt',             null, 2),

          // ── SOCIAL MEDIA (upgrade) ────────────────────────────────────────
          { key: 'sec-social', isHeader: true, label: 'SOCIAL MEDIA SIGNALS' },
          row('soc-instagram',       'Instagram',           null, 2),
          row('soc-twitter',         'X / Twitter',         null, 2),
          row('soc-linkedin',        'LinkedIn',            null, 2),
          row('soc-facebook',        'Facebook',            null, 2),
          row('soc-tiktok',          'TikTok',              null, 2),
          row('soc-youtube',         'YouTube',             null, 2),
          row('soc-pinterest',       'Pinterest',           null, 2),
          row('soc-threads',         'Threads',             null, 2),
          row('soc-bluesky',         'Bluesky',             null, 2),
          row('soc-mastodon',        'Mastodon',            null, 2),
          row('soc-discord',         'Discord',             null, 2),
          row('soc-twitch',          'Twitch',              null, 2),
          row('soc-snapchat',        'Snapchat',            null, 2),

          // ── EXTERNAL SIGNALS (upgrade) ────────────────────────────────────
          { key: 'sec-ext', isHeader: true, label: 'EXTERNAL SIGNALS' },
          row('ext-weather',       'Weather / local',       null, 2),
          row('ext-reviews',       'Reviews',               null, 2),
          row('ext-google-trends', 'Google Trends',         null, 2),
        ];

        const dataRows = allRows.filter((r) => r.isAuditRow && !r.isColumnHeader);
        const captured = dataRows.filter((r) => r._captured).length;
        const total = dataRows.length;

        return {
          placeholderLabel: `${captured}/${total}`,
          rows: allRows,
        };
      })(),
      footerLeft: hasIntakeData ? 'Live' : 'Run all cards to unlock Brief',
      footerRight: 'REVIEWED',
    },
    {
      id: 'knowledge-base',
      category: 'knowledge',
      number: 'KB',
      label: 'KNOWLEDGE',
      title: 'Knowledge Base',
      description: 'Add your own content — documents, URLs, or notes — so every card generates output using your real context, not generic assumptions.',
      placeholderLabel: 'CLIENT\nBRAIN',
      rows: [
        { key: 'kb-source', label: 'Sources', value: 'Text · URLs · documents' },
        { key: 'kb-limit', label: 'Limit', value: '100 items / client' },
        { key: 'kb-retrieval', label: 'Retrieval', value: 'OpenAI embeddings · Firestore vector search · top 5 chunks' },
        { key: 'kb-runtime-source', label: 'Pipeline source', value: 'Priority context for Strategy Builder, cards, briefs, posts, and generated sites' },
      ],
      footerLeft: 'Ready',
      footerRight: 'CLIENT DATA',
      readinessBadge: { tone: 'ok', label: 'Ready' },
    },

    // ── CREATIVE DIRECTOR ───────────────────────────────────────────────────
    {
      id: 'brand-voice',
      category: 'content',
      number: 'BV',
      label: 'VOICE',
      title: 'Brand Voice',
      description: 'Your tone and messaging. Identifies unclear or inconsistent positioning.',
      placeholderLabel: hasBrandToneData ? 'VOICE' : 'NO\nVOICE',
      rows: hasBrandToneData
        ? [
            { key: 'primary', label: 'Primary', value: brandTone?.primary || 'Pending' },
            { key: 'secondary', label: 'Secondary', value: brandTone?.secondary || 'Pending' },
            { key: 'tags', label: 'Tags', value: brandTone?.tags?.slice(0, 3).join(' · ') || 'Pending' },
            { key: 'bv-knowledge-base', label: 'Knowledge Base', value: knowledgeBaseSourceSummary },
          ]
        : buildWorkNeededRows('Not enough long-form copy or repeated messaging was fetched to infer voice.'),
      footerLeft: hasBrandToneData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    (() => {
      const vd = clientProspect?.visualDna || {};
      const subjects = Array.isArray(vd.subjects) ? vd.subjects : [];
      const hasVisualDna = subjects.length > 0;
      const domainLabel = vd.domain
        ? vd.domain.charAt(0).toUpperCase() + vd.domain.slice(1)
        : 'Not selected';
      return {
        id: 'visual-dna',
        category: 'content',
        number: 'VD',
        label: 'VISUAL DNA',
        title: 'Visual DNA',
        description: 'Upload reference photos of your products, spaces, or people. The system uses these to generate visuals that look like your brand — not stock photos.',
        placeholderLabel: hasVisualDna ? 'VISUAL\nDNA' : 'NO\nDNA',
        rows: hasVisualDna
          ? [
              { key: 'vd-domain',   label: 'Domain',   value: domainLabel },
              { key: 'vd-subjects', label: 'Subjects', value: `${subjects.length}` },
              { key: 'vd-list',     label: 'Profiles', value: subjects.slice(0, 4).map((s) => s.label || s.id).join(' · ') || '—' },
              { key: 'vd-updated',  label: 'Updated',  value: vd.updatedAt ? new Date(vd.updatedAt).toLocaleString() : '—' },
            ]
          : [
              { key: 'vd-domain', label: 'Domains', value: 'Food · Product · Location · Lifestyle · People · Environment' },
              { key: 'vd-food',   label: 'Food example', value: 'Tacos, enchiladas, nachitos, drinks, table spreads' },
              { key: 'vd-action', label: 'Action', value: 'Click OPEN to upload reference images and create subject profiles' },
            ],
        footerLeft: hasVisualDna ? 'Live' : 'Not trained',
        footerRight: 'REFERENCES',
        readinessBadge: hasVisualDna ? { tone: 'ok', label: 'Passed' } : null,
        footerAction: {
          label: visualDnaOpening ? '…' : 'OPEN',
          loading: visualDnaOpening,
          onClick: openVisualDna,
        },
      };
    })(),
    {
      id: 'style-guide',
      category: 'content',
      number: 'BS',
      label: 'BRAND SNAPSHOT',
      title: 'Brand Snapshot',
      description: 'Your visual system—colors, typography, layout. Highlights inconsistency and missing structure.',
      placeholderLabel: hasStyleGuideData ? 'STYLE' : 'NO\nSTYLE',
      rows: (() => {
        // Design Evaluation verifications cross-check the mechanically-extracted
        // tokens against the homepage screenshot. Map them to the Brand Snapshot
        // rows so each row can show a ✓ (confirmed) or ⚠ (contradicted) chip.
        const verifications = Array.isArray(analyzerOutputs?.['design-evaluation']?.verifications)
          ? analyzerOutputs['design-evaluation'].verifications
          : [];
        const byPath = Object.fromEntries(verifications.map((v) => [v?.path, v]));
        const ROW_PATH = {
          'sg-heading':   'synth.styleGuide.typography.headingSystem.fontFamily',
          'sg-body':      'synth.styleGuide.typography.bodySystem.fontFamily',
          'sg-primary':   'synth.styleGuide.colors.primary.hex',
          'sg-secondary': 'synth.styleGuide.colors.secondary.hex',
          'sg-neutral':   'synth.styleGuide.colors.neutral.hex',
        };
        const verifyChip = (rowKey) => {
          const v = byPath[ROW_PATH[rowKey]];
          if (!v) return null;
          const title = v.evidence || '';
          const style = {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 6,
            width: 14,
            height: 14,
            borderRadius: 7,
            fontSize: 10,
            lineHeight: '14px',
            textAlign: 'center',
            color: '#fff',
            background: v.confirmed ? '#22c55e' : '#f59e0b',
            flexShrink: 0,
          };
          return (
            <span
              aria-label={v.confirmed ? 'Confirmed in homepage screenshot' : 'Screenshot contradicts extracted value'}
              title={title}
              style={style}
            >
              {v.confirmed ? '✓' : '!'}
            </span>
          );
        };

        const headingText = [sgDisplayData?.typography?.headingSystem?.fontFamily, sgDisplayData?.typography?.headingSystem?.fontWeight, sgDisplayData?.typography?.headingSystem?.fontSize].filter(Boolean).join(' · ') || 'Pending';
        const bodyText    = [sgDisplayData?.typography?.bodySystem?.fontFamily, sgDisplayData?.typography?.bodySystem?.fontSize].filter(Boolean).join(' · ') || 'Pending';
        const withChip = (rowKey, text) => {
          const chip = verifyChip(rowKey);
          if (!chip) return text;
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
              <span style={{ whiteSpace: 'normal' }}>{text}</span>
              {chip}
            </span>
          );
        };

        const sgColorRow = (key, label, entry) => ({
          key,
          label,
          value: entry?.hex ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: entry.hex,
                  border: '1px solid rgba(0, 0, 0, 0.18)',
                  flexShrink: 0,
                }}
              />
              <span style={{ whiteSpace: 'normal' }}>
                {entry.hex}{entry.role ? ` · ${entry.role}` : ''}
              </span>
              {verifyChip(key)}
            </span>
          ) : 'Pending',
        });

        return [
          { key: 'sg-heading', label: 'Heading', value: withChip('sg-heading', headingText) },
          { key: 'sg-body',    label: 'Body',    value: withChip('sg-body',    bodyText) },
          sgColorRow('sg-primary',   'Primary',   sgDisplayData?.colors?.primary),
          sgColorRow('sg-secondary', 'Secondary', sgDisplayData?.colors?.secondary),
          sgColorRow('sg-neutral',   'Neutral',   sgDisplayData?.colors?.neutral),
        ];
      })(),
      footerLeft: hasStyleGuideData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
      moduleControls: { tech: ['html-fetch', 'css-parser', 'anthropic'] },
    },

    // ── BRAND SYSTEM (Image 2.0 prompt generator) ──────────────────────────
    // Standalone card. RUN opens the Brand System terminal modal (P2);
    // Details ↗ opens the 3-tab output modal (MASTER PROMPT / JSON / DATA).
    // No moduleControls — this card runs its own flow, not the runner pipeline.
    (() => {
      const bsRun = dashboardState?.brandSystem || null;
      const hasBsRun = Boolean(bsRun?.masterPrompt && bsRun?.json);
      return {
        id: 'brand-system',
        category: 'content',
        number: 'BG',
        label: 'BRAND IDENTITY',
        title: 'Brand Identity Card',
        description: 'Build a complete brand identity system from your pipeline data. Get creative specs ready to use across any channel or tool.',
        placeholderLabel: hasBsRun ? 'PROMPT\nREADY' : 'BRAND\nIDENTITY',
        rows: hasBsRun
          ? [
              { key: 'bs-prompt-status', label: 'Master Prompt', value: 'Ready to copy' },
              { key: 'bs-json-status',   label: 'JSON Object',   value: 'Ready to copy' },
              { key: 'bs-knowledge-base', label: 'Knowledge Base', value: summarizeKnowledgeBaseSources(brandSystemKnowledgeBaseSources, 'Available for brand truth') },
              { key: 'bs-last-run',      label: 'Generated',     value: bsRun?.generatedAt || '—' },
            ]
          : buildWorkNeededRows('No prompt generated yet — click RUN to scan your pipeline and fill any gaps.'),
        footerLeft: hasBsRun ? 'Live' : WORK_NEEDED_LABEL,
        footerRight: 'GENERATED',
        footerAction: {
          label: hasBsRun ? 'Re-run' : 'RUN',
          loading: false,
          onClick: () => { setBrandSystemBuildOpen(true); setHasBrandSystemMounted(true); },
        },
      };
    })(),

    // ── LEADGEN FLOW (per-client) ─────────────────────────────────────────
    // Reuses /api/leadgen/* routes against a synthetic prospect doc seeded by
    // /api/leadgen/seed-client-prospect. Phase B exposes only Prepare Brief;
    // Generate Mockup / Generate Site cards land in Phase C.
    (() => {
      const gen = clientProspect?.generation || {};
      const hasBrief = !!gen.designMd;
      const briefLines = gen.briefLines || (gen.designMd ? gen.designMd.split('\n').length : 0);
      let parsedContent = null;
      try { parsedContent = gen.contentJson ? JSON.parse(gen.contentJson) : null; } catch { parsedContent = null; }
      const services = parsedContent?.copy?.serviceNames?.length || 0;
      const testimonials = parsedContent?.copy?.testimonials?.length || 0;
      const heroHeadline = parsedContent?.copy?.heroHeadline || '';
      const generatedAt = gen.briefGeneratedAt || null;
      return {
        id: 'client-brief',
        category: 'content',
        number: 'PB',
        label: 'DESIGN BRIEF',
        title: 'Design Brief',
        description: 'Reads your current website and turns it into a creative direction document — the foundation for your mockup and site preview.',
        placeholderLabel: hasBrief ? 'BRIEF' : 'NO\nBRIEF',
        rows: hasBrief
          ? [
              { key: 'cb-target',     label: 'Target',         value: clientProspect?.website || client?.websiteUrl || '—' },
              { key: 'cb-vertical',   label: 'Vertical',       value: clientProspect?.vertical || 'default' },
              { key: 'cb-headline',   label: 'Hero headline',  value: heroHeadline ? `"${heroHeadline.slice(0, 80)}"` : '—' },
              { key: 'cb-services',   label: 'Services',       value: String(services) },
              { key: 'cb-testimon',   label: 'Testimonials',   value: String(testimonials) },
              { key: 'cb-lines',      label: 'Brief size',     value: `${briefLines} lines` },
              { key: 'cb-generated',  label: 'Generated',      value: generatedAt ? new Date(generatedAt).toLocaleString() : '—' },
            ]
          : [
              { key: 'cb-target',  label: 'Target',  value: client?.websiteUrl || 'No website on file' },
              { key: 'cb-action',  label: 'Action',  value: 'Click RUN to scrape your site and build the brief' },
              { key: 'cb-output',  label: 'Output',  value: 'DESIGN.MD creative brief + scraped content' },
            ],
        footerLeft: hasBrief ? 'Live' : 'Not run yet',
        footerRight: 'LEADGEN',
        // Drives status dot — set tone:'ok' when brief is ready so the card flips
        // to STATUS: Passed. When absent, the standard "needs work" treatment applies.
        readinessBadge: hasBrief ? { tone: 'ok', label: 'Passed' } : null,
        // Triggers RUN/DETAILS dual-button footer. tech is decorative metadata.
        moduleControls: { tech: ['nano-banana', 'firebase-storage'] },
        leadgenStep: {
          moduleId:    'prepare-brief',
          moduleLabel: 'Prepare Brief',
          endpoint:    '/api/leadgen/prepare-brief',
        },
      };
    })(),
    (() => {
      const gen = clientProspect?.generation || {};
      const hasMockup = !!gen.mockupUrl;
      const hasBrief = !!gen.designMd;
      return {
        id: 'client-mockup-creative',
        category: 'content',
        number: 'GM',
        label: 'GENERATE MOCKUP',
        title: 'Generate Mockup',
        description: 'Turns your brief into a visual homepage concept — see a creative direction before anything gets built.',
        placeholderLabel: hasMockup ? 'MOCKUP' : 'NO\nMOCKUP',
        rows: hasMockup
          ? [
              { key: 'cm-target',    label: 'Target',       value: clientProspect?.website || client?.websiteUrl || '—' },
              { key: 'cm-provider',  label: 'Provider',     value: gen.mockupProvider || '—' },
              { key: 'cm-generated', label: 'Generated',    value: gen.mockupGeneratedAt ? new Date(gen.mockupGeneratedAt).toLocaleString() : '—' },
              { key: 'cm-url',       label: 'Image URL',    value: gen.mockupUrl ? 'Stored' : '—' },
            ]
          : [
              { key: 'cm-target',  label: 'Target',  value: client?.websiteUrl || 'No website on file' },
              { key: 'cm-prereq',  label: 'Prereq',  value: hasBrief ? 'Brief ready' : 'Run Prepare Brief first' },
              { key: 'cm-action',  label: 'Action',  value: 'Click RUN to generate the visual concept' },
            ],
        footerLeft: hasMockup ? 'Live' : (hasBrief ? 'Ready to run' : 'Needs brief'),
        footerRight: 'LEADGEN',
        readinessBadge: hasMockup ? { tone: 'ok', label: 'Passed' } : null,
        moduleControls: { tech: ['nano-banana', 'firebase-storage'] },
        leadgenStep: {
          moduleId:    'generate-mockup',
          moduleLabel: 'Generate Mockup',
          endpoint:    '/api/leadgen/generate-mockup',
        },
      };
    })(),

    // ── WEBSITE DEVELOPER ───────────────────────────────────────────────────
    {
      id: 'seo-performance',
      category: 'website',
      number: 'SE',
      label: 'SEO HEALTH',
      title: 'SEO + Performance Snapshot',
      description: 'We ran a performance and SEO scan on your site. Load speed, metadata, and structure all impact visibility and conversion — this card shows where you stand.',
      placeholderLabel: isSeoError ? 'SEO\nAUDIT\nFAILED' : isSeoQueued ? 'AUDIT\nQUEUED' : hasSeoAuditData ? 'SEO' : 'NO\nAUDIT',
      rows: seoAuditRows,
      footerLeft: isSeoPartial ? 'Partial' : hasSeoAuditData ? 'Live' : isSeoQueued ? 'Queued' : isSeoError ? 'Error' : WORK_NEEDED_LABEL,
      domId: 'intake-card-seo-performance',
      footerRight: 'REVIEWED',
      moduleControls: { tech: ['pagespeed-insights', 'anthropic'] },
    },
    {
      id: 'site-performance',
      category: 'website',
      number: 'SP',
      label: 'PERFORMANCE',
      title: 'Site Performance',
      description: 'Load speed and technical issues impacting experience and rankings.',
      placeholderLabel: hasSeoAuditData ? 'PERFORMANCE' : 'NO\nDATA',
      rows: seoAuditRows.slice(0, 6),
      footerLeft: hasSeoAuditData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'social-preview',
      category: 'website',
      number: 'SP',
      label: 'SOCIAL PREVIEW',
      title: 'Social Preview Check',
      description: 'How your site appears when shared—title, description, and image. Missing previews reduce clicks and trust.',
      placeholderLabel: siteMeta?.ogImage ? 'PREVIEW' : 'RUN\nSOCIAL\nPREVIEW',
      rows: (() => {
        const NP = 'Not provided';
        return siteMeta ? [
          { key: 'og-title',       label: 'Title',       value: siteMeta.title       || NP },
          { key: 'og-description', label: 'OG Text',     value: siteMeta.description || NP },
          { key: 'og-site-name',   label: 'Site Name',   value: siteMeta.siteName    || NP },
          { key: 'og-image-alt',   label: 'Image Alt',   value: siteMeta.ogImageAlt  || NP },
          { key: 'og-type',        label: 'OG Type',     value: siteMeta.type        || NP },
          { key: 'og-locale',      label: 'Locale',      value: siteMeta.locale      || NP },
          { key: 'og-theme',       label: 'Theme Color', value: siteMeta.themeColor  || NP },
          { key: 'og-favicon',     label: 'Favicon',     value: siteMeta.favicon        ? 'Present' : NP },
          { key: 'og-apple-icon',  label: 'Apple Icon',  value: siteMeta.appleTouchIcon ? 'Present' : NP },
          { key: 'og-canonical',   label: 'Canonical',   value: siteMeta.canonical   || NP },
        ] : buildWorkNeededRows('No site meta captured from the homepage.');
      })(),
      footerLeft: siteMeta ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
      moduleControls: { tech: ['html-fetch', 'meta-parser'] },
    },
    {
      id: 'agent-readiness',
      category: 'website',
      number: 'AR',
      label: 'AGENT READY',
      title: 'AI Agent Readiness',
      description: 'We checked how easy it is for AI tools and search engines to understand your site. This shows what\'s blocking visibility and what to fix first.',
      placeholderLabel: agentReadinessState === 'queued' ? 'AUDIT\nQUEUED' : hasAgentReadinessData ? 'AGENT\nREADY' : 'NO\nAUDIT',
      rows: agentReadinessRows,
      footerLeft: hasAgentReadinessData ? 'Live' : agentReadinessState === 'queued' ? 'Queued' : WORK_NEEDED_LABEL,
      domId: 'intake-card-agent-readiness',
      footerRight: 'REVIEWED',
      moduleControls: { tech: ['agent-ready-checks', 'anthropic', 'ai-seo-audit'] },
    },
    {
      id: 'design-evaluation',
      category: 'website',
      number: 'DE',
      label: 'DESIGN EVAL',
      title: 'Design Evaluation',
      description: 'We looked at your homepage and rated your visual design. See how your brand comes across to a first-time visitor — and what to tighten up.',
      placeholderLabel: hasStyleGuideData ? 'DESIGN.md' : 'DESIGN\nEVALUATION',
      rows: (() => {
        const ev = analyzerOutputs?.['design-evaluation'] || null;
        if (!ev) {
          return buildWorkNeededRows('Run the Design Evaluation skill to generate a DESIGN.md audit of your site\'s tokens.');
        }
        const findings = Array.isArray(ev.findings) ? ev.findings : [];
        const critical = findings.filter((f) => f.severity === 'critical').length;
        const warning  = findings.filter((f) => f.severity === 'warning').length;
        return [
          { key: 'de-readiness', label: 'Readiness', value: ev.readiness || '—' },
          { key: 'de-findings',  label: 'Findings',  value: String(findings.length) },
          { key: 'de-critical',  label: 'Critical',  value: String(critical) },
          { key: 'de-warning',   label: 'Warnings',  value: String(warning) },
        ];
      })(),
      footerLeft: analyzerOutputs?.['design-evaluation'] ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
      moduleControls: { tech: ['html-fetch', 'anthropic'] },
      analyzer: analyzerOutputs?.['design-evaluation'] || null,
    },
    {
      id: 'multi-device-view',
      category: 'website',
      number: 'MD',
      label: 'LAYOUT',
      title: 'Cross-Device Layouts',
      description: 'Your site across desktop, tablet, and mobile. Identifies layout and usability issues.',
      placeholderLabel: multiDevicePreviewSrc ? 'LAYOUT' : 'NO\nLAYOUT',
      rows: multiDevicePreviewSrc ? [
        { key: 'md-desktop', label: 'Desktop capture', value: deviceScreenshots.desktop ? 'Captured' : homepageScreenshotUrl ? 'Captured' : 'Missing' },
        { key: 'md-tablet', label: 'Tablet capture', value: deviceScreenshots.tablet ? 'Captured' : 'Missing' },
        { key: 'md-mobile', label: 'Mobile capture', value: deviceScreenshots.mobile ? 'Captured' : 'Missing' },
        { key: 'md-mockup', label: 'Device mockup', value: intakeMockupSrc ? 'Generated' : 'Missing — using screenshot fallback' },
      ] : buildWorkNeededRows('Device view requires a completed homepage screenshot capture.'),
      footerLeft: intakeMockupSrc ? 'Live' : multiDevicePreviewSrc ? 'Partial' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
      moduleControls: { tech: ['browserless', 'firebase-storage', 'python-mockup'] },
    },
    {
      id: 'website-landing',
      category: 'website',
      number: 'CR',
      label: 'CONVERT',
      title: 'Conversion Readiness',
      description: 'How effectively your site turns visitors into customers—CTA, layout, flow.',
      placeholderLabel: 'CONVERT',
      rows: buildWorkNeededRows('Conversion analysis requires page evidence with CTA and value proposition data.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    (() => {
      const gen = clientProspect?.generation || {};
      const hasMockup = !!gen.mockupUrl;
      const hasBrief = !!gen.designMd;
      return {
        id: 'client-mockup',
        category: 'website',
        number: 'GM',
        label: 'GENERATE MOCKUP',
        title: 'Generate Mockup',
        description: 'Turns your brief into a visual homepage concept — see a creative direction before anything gets built.',
        placeholderLabel: hasMockup ? 'MOCKUP' : 'NO\nMOCKUP',
        rows: hasMockup
          ? [
              { key: 'cm-target',    label: 'Target',       value: clientProspect?.website || client?.websiteUrl || '—' },
              { key: 'cm-provider',  label: 'Provider',     value: gen.mockupProvider || '—' },
              { key: 'cm-generated', label: 'Generated',    value: gen.mockupGeneratedAt ? new Date(gen.mockupGeneratedAt).toLocaleString() : '—' },
              { key: 'cm-url',       label: 'Image URL',    value: gen.mockupUrl ? 'Stored' : '—' },
            ]
          : [
              { key: 'cm-target',  label: 'Target',  value: client?.websiteUrl || 'No website on file' },
              { key: 'cm-prereq',  label: 'Prereq',  value: hasBrief ? 'Brief ready' : 'Run Prepare Brief first' },
              { key: 'cm-action',  label: 'Action',  value: 'Click RUN to generate the visual concept' },
            ],
        footerLeft: hasMockup ? 'Live' : (hasBrief ? 'Ready to run' : 'Needs brief'),
        footerRight: 'LEADGEN',
        readinessBadge: hasMockup ? { tone: 'ok', label: 'Passed' } : null,
        moduleControls: { tech: ['nano-banana', 'firebase-storage'] },
        leadgenStep: {
          moduleId:    'generate-mockup',
          moduleLabel: 'Generate Mockup',
          endpoint:    '/api/leadgen/generate-mockup',
        },
      };
    })(),
    (() => {
      const gen = clientProspect?.generation || {};
      const hasSite   = !!gen.previewUrl;
      const hasMockup = !!gen.mockupUrl;
      const cmp = gen.readinessComparison || null;
      return {
        id: 'client-site',
        category: 'website',
        number: 'GS',
        label: 'GENERATE SITE',
        title: 'Generate Site',
        description: 'Builds and deploys a live homepage from your brief and mockup. Compare it side-by-side with your current site to see the improvement.',
        placeholderLabel: hasSite ? 'SITE' : 'NO\nSITE',
        rows: hasSite
          ? [
              { key: 'cs-target',    label: 'Target',         value: clientProspect?.website || client?.websiteUrl || '—' },
              { key: 'cs-preview',   label: 'Preview URL',    value: gen.previewUrl || '—' },
              { key: 'cs-deployed',  label: 'Deployed',       value: gen.deployedAt ? new Date(gen.deployedAt).toLocaleString() : '—' },
              { key: 'cs-size',      label: 'HTML size',      value: gen.htmlSizeBytes ? `${(gen.htmlSizeBytes / 1024).toFixed(1)} KB` : '—' },
              { key: 'cs-readiness', label: 'AI Readiness',   value: cmp?.before?.score != null && cmp?.after?.score != null ? `${cmp.before.score} → ${cmp.after.score}` : '—' },
              { key: 'cs-cost',      label: 'Estimated cost', value: gen.estimatedCostUsd ? `$${gen.estimatedCostUsd.toFixed(4)}` : '—' },
            ]
          : [
              { key: 'cs-target',  label: 'Target',  value: client?.websiteUrl || 'No website on file' },
              { key: 'cs-prereq',  label: 'Prereq',  value: hasMockup ? 'Mockup ready' : 'Run Generate Mockup first' },
              { key: 'cs-action',  label: 'Action',  value: 'Click RUN to generate + deploy the site preview' },
            ],
        footerLeft: hasSite ? 'Live' : (hasMockup ? 'Ready to run' : 'Needs mockup'),
        footerRight: 'LEADGEN',
        readinessBadge: hasSite ? { tone: 'ok', label: 'Passed' } : null,
        moduleControls: { tech: ['claude-sonnet', 'vercel'] },
        leadgenStep: {
          moduleId:    'generate-site',
          moduleLabel: 'Generate Site',
          endpoint:    '/api/leadgen/generate-site',
        },
      };
    })(),
    (() => {
      const gen = clientProspect?.generation || {};
      const estimate = gen.estimate?.latest || null;
      const hasSite = !!gen.previewUrl;
      const hasEstimate = !!estimate?.estimateJson;
      const total = estimate?.estimateJson?.total;
      const currency = estimate?.estimateJson?.currency || 'USD';
      const totalLabel = total != null
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(total)
        : '—';
      return {
        id: 'client-estimate',
        category: 'website',
        number: 'CE',
        label: 'CREATE ESTIMATE',
        title: 'Create Estimate',
        description: 'Creates a client-facing estimate from the generated site, scope defaults, pricing inputs, and before/after readiness proof.',
        placeholderLabel: hasEstimate ? 'ESTIMATE' : 'NO\nESTIMATE',
        rows: hasEstimate
          ? [
              { key: 'ce-client',    label: 'Client',      value: clientProspect?.name || client?.companyName || '—' },
              { key: 'ce-total',     label: 'Total',       value: totalLabel },
              { key: 'ce-version',   label: 'Version',     value: estimate.versionId || '—' },
              { key: 'ce-generated', label: 'Generated',   value: estimate.generatedAt ? new Date(estimate.generatedAt).toLocaleString() : '—' },
              { key: 'ce-preview',   label: 'Preview URL', value: estimate.proof?.previewUrl ? 'Included' : 'Not included' },
              { key: 'ce-pdf',       label: 'PDF',         value: estimate.pdfArtifact?.downloadUrl ? 'Ready' : 'Unavailable' },
            ]
          : [
              { key: 'ce-target', label: 'Target', value: clientProspect?.website || client?.websiteUrl || '—' },
              { key: 'ce-prereq', label: 'Prereq', value: hasSite ? 'Generated site ready' : 'Run Generate Site first' },
              { key: 'ce-action', label: 'Action', value: 'Click RUN to create the client-facing estimate' },
            ],
        footerLeft: hasEstimate ? 'Live' : (hasSite ? 'Ready to run' : 'Needs site'),
        footerRight: 'LEADGEN',
        readinessBadge: hasEstimate ? { tone: 'ok', label: 'Passed' } : null,
        moduleControls: { tech: ['estimate', 'pdf', 'firebase-storage'] },
        leadgenStep: {
          moduleId:    'create-estimate',
          moduleLabel: 'Create Estimate',
          endpoint:    '/api/leadgen/create-estimate',
        },
      };
    })(),

    // ── MARKETING DIRECTOR ──────────────────────────────────────────────────
    {
      id: 'signals',
      category: 'growth',
      number: 'MS',
      label: 'SIGNALS',
      title: 'Market Signals',
      description: 'Trends, conversations, and demand signals relevant to your business.',
      placeholderLabel: 'NO\nSIGNALS',
      rows: buildWorkNeededRows('Signal collection requires active scout feeds.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'competitor-info',
      category: 'growth',
      number: 'CS',
      label: 'COMPETITION',
      title: 'Competitor Snapshot',
      description: 'How competitors position and communicate.',
      placeholderLabel: 'NOT\nMAPPED',
      rows: buildWorkNeededRows('Competitor mapping requires validated industry and positioning signals.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'local-signals',
      category: 'growth',
      number: 'LS',
      label: 'LOCAL',
      title: 'Local Signals',
      description: 'Events, location-based demand, and local activity.',
      placeholderLabel: 'LOCAL',
      rows: buildWorkNeededRows('Local signal data requires geo and location parameters.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'visibility-snapshot',
      category: 'growth',
      number: 'VS',
      label: 'VISIBILITY',
      title: 'Visibility Snapshot',
      description: 'We checked where your business shows up across search and platforms. This shows what\'s indexed, what\'s visible, and where there\'s room to expand reach.',
      placeholderLabel: 'NO\nDATA',
      rows: buildWorkNeededRows('AI Visibility data has moved to the AI Agent Readiness card.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'priority-signal',
      category: 'growth',
      number: 'PA',
      label: 'PRIORITY',
      title: 'Priority Action',
      description: 'The highest-impact fix based on current gaps.',
      placeholderLabel: hasPrioritySignalData ? 'NEXT\nSTEP' : 'NO\nSIGNAL',
      rows: hasPrioritySignalData
        ? [
            { key: 'focus', label: 'Focus', value: resolvedPrioritySignal },
            { key: 'channel', label: 'Channel', value: strategy?.postStrategy?.formats?.join(' · ') || 'Pending' },
          ]
        : buildWorkNeededRows('Not enough validated signals to surface a priority action.'),
      footerLeft: hasPrioritySignalData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'strategy-builder',
      category: 'growth',
      number: 'SB',
      label: 'STRATEGY',
      title: 'Strategy Builder',
      description: 'Turns Scout signals, brand voice, and content gaps into a focused social direction for the next post.',
      placeholderLabel: hasMarketingBriefData ? 'STRATEGY' : 'NO\nBRIEF',
      rows: [
        { key: 'sb-source', label: 'Source', value: hasMarketingBriefData ? 'Marketing Brief' : 'Needs Scout brief' },
        {
          key: 'sb-knowledge-base',
          label: 'Knowledge Base',
          value: summarizeKnowledgeBaseSources(strategyBuilderKnowledgeBaseSources, 'Toggleable priority source'),
        },
        { key: 'sb-angle', label: 'Angle', value: marketingBrief?.content?.content_angle || marketingBrief?.headline || resolvedContentAngle || 'Run Marketing Brief to generate the angle.' },
        { key: 'sb-platform', label: 'Platform', value: 'X / Twitter' },
      ],
      footerLeft: hasMarketingBriefData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
      readinessBadge: hasMarketingBriefData ? { tone: 'ok', label: 'Ready' } : null,
    },
    {
      id: 'trust-credibility',
      category: 'growth',
      number: 'TC',
      label: 'TRUST',
      title: 'Trust & Credibility',
      description: 'Proof signals like reviews, consistency, and authority. Missing trust reduces conversions.',
      placeholderLabel: 'TRUST',
      rows: buildWorkNeededRows('Trust signal analysis requires contact clues, about page, and schema markup data.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'content-gaps',
      category: 'growth',
      number: 'CG',
      label: 'GAPS',
      title: 'Content Gaps',
      description: 'Topics and pages missing from your site that competitors are capturing.',
      placeholderLabel: 'GAPS',
      rows: buildWorkNeededRows('Content gap analysis requires competitor and keyword data.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'search-opportunities',
      category: 'growth',
      number: 'SO',
      label: 'SEARCH',
      title: 'Search Opportunities',
      description: 'Keywords and topics with clear ranking potential.',
      placeholderLabel: hasOpportunitiesData ? 'SEARCH' : 'NO\nDATA',
      rows: hasOpportunitiesData
        ? resolvedOpportunities.map((op, index) => ({
            key: `op-${index}`,
            label: `[${String(op.priority || 'medium').slice(0, 4).toUpperCase()}]`,
            value: `${op.topic || op.opportunity}${op.whyNow || op.why ? ` — ${op.whyNow || op.why}` : ''}`,
          }))
        : buildWorkNeededRows('No search opportunities surfaced from the current intake.'),
      footerLeft: hasOpportunitiesData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'marketing',
      category: 'growth',
      number: 'PS',
      label: 'STRATEGY',
      title: 'Post Strategy',
      description: 'What to post, where, and why—based on gaps and audience signals.',
      placeholderLabel: 'NO\nSTRATEGY',
      rows: hasContentAngleData
        ? [
            { key: 'ps-angle', label: 'Angle', value: resolvedContentAngle },
            { key: 'ps-knowledge-base', label: 'Knowledge Base', value: knowledgeBaseSourceSummary },
          ]
        : buildWorkNeededRows('Post strategy requires brand tone, audience signals, and content gap data.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'platform-coverage',
      category: 'growth',
      number: 'PC',
      label: 'PLATFORMS',
      title: 'Platform Coverage',
      description: 'Where your brand is active and where visibility is missing.',
      placeholderLabel: 'PLATFORMS',
      rows: buildWorkNeededRows('Platform analysis requires social link data from crawled pages.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'creative-builder',
      category: 'growth',
      number: 'CB',
      label: 'CREATIVE',
      title: 'Creative Builder',
      description: 'Your generated copy and creative output in one place — ready to review, refine, and publish.',
      placeholderLabel: hasSocialGeneratedDraft ? 'CREATIVE' : 'NO\nDRAFT',
      rows: [
        { key: 'cb-copy', label: 'Copy', value: hasSocialGeneratedDraft ? socialGeneratedDraft : 'No generated X draft yet.' },
        { key: 'cb-media', label: 'Media', value: 'Video/audio generation queued for next phase' },
        { key: 'cb-source', label: 'Source', value: hasMarketingBriefData ? 'Strategy Builder' : 'Manual / Draft Content' },
        { key: 'cb-knowledge-base', label: 'Knowledge Base', value: knowledgeBaseSourceSummary },
      ],
      footerLeft: hasSocialGeneratedDraft ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
      readinessBadge: hasSocialGeneratedDraft ? { tone: 'ok', label: 'Ready' } : null,
    },
    {
      id: 'draft-post',
      category: 'growth',
      number: 'DC',
      label: 'DRAFT',
      title: 'Draft Content',
      description: 'Ready-to-use posts tailored to your brand.',
      placeholderLabel: hasDraftPostData ? 'DRAFT' : 'NO\nDRAFT',
      rows: hasDraftPostData
        ? [
            { key: 'post', label: 'Draft', value: resolvedDraftPost },
            { key: 'draft-knowledge-base', label: 'Knowledge Base', value: knowledgeBaseSourceSummary },
          ]
        : buildWorkNeededRows('Not enough brand voice clarity to draft content credibly.'),
      footerLeft: hasDraftPostData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'newsletter',
      category: 'growth',
      number: 'NL',
      label: 'NEWSLETTER',
      title: 'Newsletter',
      description: hasNewsletterData
        ? 'Auto-generated newsletter from your latest intelligence brief.'
        : 'Newsletter generation requires a completed Scout brief.',
      placeholderLabel: hasNewsletterData ? 'READY' : 'NO\nBRIEF',
      rows: hasNewsletterData
        ? [{ key: 'preview', label: 'Lead', value: newsletterHeroPreview + (newsletterHeroPreview.length >= 140 ? '…' : '') }]
        : buildWorkNeededRows('Run the Scout pipeline first to generate newsletter content.'),
      footerLeft: hasNewsletterData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },

    // ── SOCIAL MEDIA MANAGER ────────────────────────────────────────────────
    {
      id: 'social-media-posting',
      category: 'social',
      number: 'XP',
      label: 'POST',
      title: 'Schedule Posts',
      description: 'Write, optimize, and post to X/Twitter directly from the dashboard. Content is checked against your brand voice before it goes out.',
      placeholderLabel: 'X\nPOST',
      rows: [
        { key: 'smp-channel', label: 'Channel', value: 'X / Twitter' },
        { key: 'smp-agent-system', label: 'Agents', value: 'Content Creator · Hashtag Specialist · Engagement Optimizer' },
        { key: 'smp-source', label: 'Creative Source', value: hasSocialGeneratedDraft ? 'Creative Builder output available' : 'Manual composer ready' },
        { key: 'smp-knowledge-base', label: 'Knowledge Base', value: knowledgeBaseSourceSummary },
      ],
      footerLeft: 'Ready',
      footerRight: 'LIVE',
      readinessBadge: { tone: 'ok', label: 'Ready' },
    },

    // ── DAILY BRIEFS ────────────────────────────────────────────────────────
    {
      id: 'marketing-brief',
      category: 'brief',
      number: 'DB',
      label: 'EXECUTIVE DAILY BRIEF',
      title: 'Executive Daily Brief',
      description: 'Morning snapshot of what matters. Pulls live signals from GA4, Search Console, Firebase, and Vercel to surface business health, active risks, and the 2–3 things worth your attention today.',
      placeholderLabel: hasDailyBriefData ? 'BRIEF' : 'SCOUT',
      rows: [
        { key: 'mb-status', label: 'Status', value: marketingBriefStatus },
        { key: 'mb-custom-briefs', label: 'Custom briefs', value: customBriefsLoading ? 'Loading' : hasCustomBriefs ? `${customBriefCount} imported` : 'None imported' },
        { key: 'mb-focus', label: 'Scout focus', value: marketingBriefConfig?.sourceFocus || 'Not configured' },
        { key: 'mb-instructions', label: 'Instructions', value: marketingBriefConfig?.scoutInstructions ? 'Custom' : 'Default' },
        { key: 'mb-sources', label: 'Sources', value: (marketingBriefConfig?.sourcePlatforms || DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS).join(' · ') },
        { key: 'mb-knowledge-base', label: 'Knowledge Base', value: summarizeKnowledgeBaseSources(marketingBriefKnowledgeBaseSources, 'Priority client context') },
        { key: 'mb-searches', label: 'Searches', value: String(marketingBriefConfig?.searches?.filter((row) => row.query)?.length || 0) },
        { key: 'mb-kols', label: 'KOL signals', value: String(marketingScoutAgentData?.kolActivity?.length || 0) },
        { key: 'mb-viral', label: 'Viral windows', value: String(marketingScoutAgentData?.viralOpportunities?.opportunities?.length || marketingBrief?.contentOpportunities?.length || 0) },
        { key: 'mb-preview', label: 'Latest signal', value: marketingBriefPreview },
        { key: 'mb-x-post', label: 'X post', value: marketingBrief?.content?.x_post || dashboardState?.summaryCards?.find((c) => c.type === 'content_post')?.value || null },
      ],
      footerLeft: hasDailyBriefData ? 'Live' : 'Configure Scout',
      footerRight: 'REVIEWED',
      footerAction: {
        label: marketingBriefRunning ? '…' : hasMarketingBriefData ? 'Re-run' : 'Run Brief',
        loading: marketingBriefRunning || marketingBriefSaving,
        onClick: runMarketingBrief,
      },
      readinessBadge: hasDailyBriefData ? { tone: 'ok', label: 'Passed' } : null,
    },
    ...(isAdmin ? [{
      id: 'submit-custom-brief',
      category: 'brief',
      number: 'SC',
      label: 'SUBMIT CUSTOM BRIEF',
      title: 'Submit Custom Brief',
      description: 'Admin workspace for publishing a client-facing HTML brief and downloadable PDF into this client dashboard.',
      placeholderLabel: 'HTML',
      rows: [
        { key: 'sc-client', label: 'Client', value: client?.companyName || client?.name || client?.dashboardTitle || bootstrap?.effectiveClientId || 'Selected client' },
        { key: 'sc-existing', label: 'Saved briefs', value: customBriefsLoading ? 'Loading' : String(customBriefCount) },
        { key: 'sc-pdf', label: 'PDF export', value: 'Generated on save' },
        { key: 'sc-access', label: 'Access', value: 'Admin only' },
      ],
      footerLeft: 'Ready',
      footerRight: 'ADMIN',
      readinessBadge: { tone: 'ok', label: 'Ready' },
    }] : []),

    // ── ADMIN · EMAIL ─────────────────────────────────────────────────────────
    ...(isAdmin ? [{
      id: 'email-digest',
      category: 'admin',
      number: 'ED',
      label: 'EMAIL DIGEST',
      title: 'Email Digest',
      description: 'View the daily digest email — executive summary, calendar agenda, and site analytics — and send it on demand.',
      placeholderLabel: 'MAIL',
      rows: [
        { key: 'ed-recipient', label: 'Recipient', value: 'Configured (DIGEST_EMAIL)' },
        { key: 'ed-schedule', label: 'Schedule', value: 'Daily · cron' },
        { key: 'ed-content', label: 'Content', value: 'Summary + agenda + analytics' },
        { key: 'ed-access', label: 'Access', value: 'Admin only' },
      ],
      footerLeft: 'Live',
      footerRight: 'ADMIN',
      readinessBadge: { tone: 'ok', label: 'Live' },
    }, {
      id: 'email-settings',
      category: 'admin',
      number: 'ES',
      label: 'EMAIL SETTINGS',
      title: 'Email Settings',
      description: 'Enable, format, and customize the LLM summary — tone, how many uploaded documents feed it, and extra instructions.',
      placeholderLabel: 'CFG',
      rows: [
        { key: 'es-summary', label: 'LLM summary', value: 'Toggle on/off' },
        { key: 'es-tone', label: 'Tone', value: 'Customizable' },
        { key: 'es-docs', label: 'Docs fed', value: 'Recent uploads' },
        { key: 'es-access', label: 'Access', value: 'Admin only' },
      ],
      footerLeft: 'Ready',
      footerRight: 'ADMIN',
      readinessBadge: { tone: 'ok', label: 'Ready' },
    }, {
      id: 'create-client',
      category: 'admin',
      number: 'NC',
      label: 'NEW CLIENT',
      title: 'Create Client',
      description: 'Provision a website-less client (survey-only / from-scratch / email-only template). Feed it via the brain + a brief after switching to it in the client dropdown.',
      placeholderLabel: 'NEW',
      rows: [
        { key: 'nc-type', label: 'Type', value: 'Website-less workspace' },
        { key: 'nc-feed', label: 'Feed', value: 'Brain uploads + brief' },
        { key: 'nc-owner', label: 'Owner', value: 'You (admin)' },
        { key: 'nc-access', label: 'Access', value: 'Client dropdown' },
      ],
      footerLeft: 'Ready',
      footerRight: 'ADMIN',
      readinessBadge: { tone: 'ok', label: 'Ready' },
    }] : []),

    {
      id: 'brief-competitor',
      category: 'brief',
      locked: true,
      number: 'CP',
      label: 'COMPETITOR BRIEF',
      title: 'Competitor Brief',
      description: 'What your competitors shipped, changed, or said since yesterday. Tracks positioning shifts, new launches, messaging patterns, and engagement signals across your vertical.',
      placeholderLabel: 'LOCK',
      rows: [{ key: 'status', label: 'Status', value: 'Coming soon' }],
      footerLeft: 'Locked',
      footerRight: '',
    },
    {
      id: 'brief-marketing',
      category: 'brief',
      locked: true,
      number: 'MB',
      label: 'MARKETING BRIEF',
      title: 'Marketing Brief',
      description: 'Search visibility, audience growth, and campaign performance in one read. Monitors organic rankings, Core Web Vitals, PageSpeed trends, and discovery opportunities so you catch momentum shifts early.',
      placeholderLabel: 'LOCK',
      rows: [{ key: 'status', label: 'Status', value: 'Coming soon' }],
      footerLeft: 'Locked',
      footerRight: '',
    },
    {
      id: 'brief-strategy',
      category: 'brief',
      locked: true,
      number: 'SB',
      label: 'STRATEGY BRIEF',
      title: 'Strategy Brief',
      description: 'Founder-level recommendations built from live data. Combines operational metrics, market conditions, and system intelligence into prioritized next steps — not theory, specific actions.',
      placeholderLabel: 'LOCK',
      rows: [{ key: 'status', label: 'Status', value: 'Coming soon' }],
      footerLeft: 'Locked',
      footerRight: '',
    },
    {
      id: 'brief-creative',
      category: 'brief',
      locked: true,
      number: 'CB',
      label: 'CREATIVE BRIEF',
      title: 'Creative Brief',
      description: 'Content direction you can act on today. Generates posting opportunities, messaging angles, and visual direction aligned to your brand system — calibrated to platform, audience, and calendar.',
      placeholderLabel: 'LOCK',
      rows: [{ key: 'status', label: 'Status', value: 'Coming soon' }],
      footerLeft: 'Locked',
      footerRight: '',
    },
    {
      id: 'brief-performance',
      category: 'brief',
      locked: true,
      number: 'PB',
      label: 'PERFORMANCE BRIEF',
      title: 'Performance Brief',
      description: 'Tracks traffic, search visibility, social reach, and conversions over time. Surfaces growth patterns, platform-level performance, and where momentum is building or stalling.',
      placeholderLabel: 'LOCK',
      rows: [{ key: 'status', label: 'Status', value: 'Coming soon' }],
      footerLeft: 'Locked',
      footerRight: '',
    },
    {
      id: 'marketing-brief-doc',
      category: 'onboarding',
      number: 'BD',
      label: 'BRIEF',
      title: 'Brief Document',
      description: 'The latest Scout/Scribe brief rendered as a formatted founder document.',
      placeholderLabel: hasMarketingBriefData ? 'BRIEF' : 'NO\nBRIEF',
      rows: hasMarketingBriefData
        ? [
            { key: 'bd-headline', label: 'Headline', value: marketingBrief?.headline || dashboardState?.headline || '—' },
            { key: 'bd-generated', label: 'Generated', value: marketingBrief?.generatedAtIso ? new Date(marketingBrief.generatedAtIso).toLocaleString() : '—' },
          ]
        : buildWorkNeededRows('Run the Marketing Brief agent to generate the document.'),
      footerLeft: hasMarketingBriefData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
      readinessBadge: hasMarketingBriefData ? { tone: 'ok', label: 'Ready' } : null,
    },

    // ── AUTOMATION & SYSTEMS ────────────────────────────────────────────────
    {
      id: 'content-engine',
      category: 'automation',
      number: 'CE',
      label: 'ENGINE',
      title: 'Content Engine',
      description: 'Automated system for generating and distributing content.',
      placeholderLabel: hasContentAngleData || hasOpportunitiesData ? 'ENGINE' : 'COMING\nSOON',
      rows: (() => {
        const engineRows = [];
        if (hasContentAngleData) engineRows.push({ key: 'angle', label: 'Angle', value: resolvedContentAngle });
        if (hasOpportunitiesData) resolvedOpportunities.slice(0, 3).forEach((op, i) => {
          engineRows.push({ key: `eng-op-${i}`, label: `[${String(op.priority || 'med').slice(0, 4).toUpperCase()}]`, value: op.topic || op.opportunity });
        });
        return engineRows.length ? engineRows : buildWorkNeededRows('Content engine requires angles and opportunity data.');
      })(),
      footerLeft: (hasContentAngleData || hasOpportunitiesData) ? 'Live' : 'Coming Soon',
      footerRight: 'REVIEWED',
    },
    {
      id: 'automation-opportunities',
      category: 'automation',
      number: 'AO',
      label: 'AUTOMATE',
      title: 'Automation Opportunities',
      description: 'Tasks that can be automated across marketing and operations.',
      placeholderLabel: 'COMING\nSOON',
      rows: buildWorkNeededRows('Automation analysis is coming soon.'),
      footerLeft: 'Coming Soon',
      footerRight: 'PLANNED',
    },
    {
      id: 'reporting-insights',
      category: 'automation',
      number: 'RI',
      label: 'INSIGHTS',
      title: 'Reporting & Insights',
      description: 'Ongoing tracking of performance and growth.',
      placeholderLabel: 'COMING\nSOON',
      rows: buildWorkNeededRows('Reporting and insights tracking is coming soon.'),
      footerLeft: 'Coming Soon',
      footerRight: 'PLANNED',
    },

    // ── WORK WITH ME ──────────────────────────────────────────────────────────
    {
      id: 'contact',
      category: 'services',
      number: 'CH',
      label: 'CONTACT',
      title: 'Contact Your Human',
      description: 'Direct communication to execute work.',
      placeholderLabel: 'CONTACT',
      rows: [{ key: 'cta', label: 'Action', value: 'Ask anything about your dashboard →' }],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },
    {
      id: 'fix-this',
      category: 'services',
      number: 'FX',
      label: 'FIX',
      title: 'Fix This',
      description: 'Request a fix for any issue surfaced in the dashboard.',
      placeholderLabel: 'FIX',
      rows: [{ key: 'cta', label: 'Action', value: 'Book a call to fix an issue →' }],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },
    {
      id: 'run-my-marketing',
      category: 'services',
      number: 'RM',
      label: 'RUN',
      title: 'Run My Marketing',
      description: 'Full execution across content, SEO, and distribution.',
      placeholderLabel: 'RUN',
      rows: [{ key: 'cta', label: 'Action', value: 'Book a strategy call →' }],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },
    {
      id: 'creative-work',
      category: 'services',
      number: 'CW',
      label: 'CREATE',
      title: 'Creative Work',
      description: 'Design, video, and brand asset creation.',
      placeholderLabel: 'CREATE',
      rows: [{ key: 'cta', label: 'Action', value: 'Book a creative session →' }],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },
    {
      id: 'build-a-page',
      category: 'services',
      number: 'BP',
      label: 'BUILD',
      title: 'Build a Page',
      description: 'Landing pages and website builds focused on conversion.',
      placeholderLabel: 'BUILD',
      rows: [{ key: 'cta', label: 'Action', value: 'Book a build session →' }],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },

    // ── VIDEO SERVICES ──────────────────────────────────────────────────────
    {
      id: 'short-form-video',
      category: 'services',
      number: 'SV',
      label: 'VIDEO',
      title: 'Short-Form Video',
      description: 'Vertical video edit up to 60 seconds. Includes cuts, captions, music, and brand framing—built for social performance and fast turnaround.',
      placeholderLabel: 'VIDEO',
      rows: [
        { key: 'scope', label: 'Scope', value: 'Up to 60s vertical edit' },
        { key: 'includes', label: 'Includes', value: 'Cuts · captions · music · brand framing' },
        { key: 'cta', label: 'Action', value: 'Request a video →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },
    {
      id: 'long-form-video',
      category: 'services',
      number: 'LV',
      label: 'VIDEO',
      title: 'Long-Form Video',
      description: 'Edited video up to 5 minutes with multi-cam support, color grading, and sound mix. Designed for product, storytelling, or campaign content.',
      placeholderLabel: 'VIDEO',
      rows: [
        { key: 'scope', label: 'Scope', value: 'Up to 5 min · multi-cam' },
        { key: 'includes', label: 'Includes', value: 'Color grading · sound mix · titles' },
        { key: 'cta', label: 'Action', value: 'Request a video →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },

    // ── DESIGN SERVICES ─────────────────────────────────────────────────────
    {
      id: 'single-graphic',
      category: 'services',
      number: 'DG',
      label: 'DESIGN',
      title: 'Single Graphic',
      description: 'One static asset for social, ads, or web. Designed on-brand and ready to publish immediately.',
      placeholderLabel: 'DESIGN',
      rows: [
        { key: 'scope', label: 'Scope', value: '1 static asset · any platform' },
        { key: 'cta', label: 'Action', value: 'Request a graphic →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },
    {
      id: 'carousel-kit',
      category: 'services',
      number: 'CK',
      label: 'DESIGN',
      title: 'Carousel Kit',
      description: 'Multi-slide post with structured layout, copy, and flow. Built for engagement and clarity across platforms.',
      placeholderLabel: 'DESIGN',
      rows: [
        { key: 'scope', label: 'Scope', value: 'Multi-slide · copy + layout' },
        { key: 'cta', label: 'Action', value: 'Request a carousel →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },

    // ── SOCIAL SERVICES ─────────────────────────────────────────────────────
    {
      id: 'social-management',
      category: 'services',
      number: 'SM',
      label: 'SOCIAL',
      title: 'Social Management',
      description: 'Ongoing posting, scheduling, and light community interaction layered on top of automation. Keeps your presence active and consistent.',
      placeholderLabel: 'SOCIAL',
      rows: [
        { key: 'scope', label: 'Scope', value: 'Ongoing · posting + scheduling' },
        { key: 'cta', label: 'Action', value: 'Request social management →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },

    // ── BRAND SERVICES ──────────────────────────────────────────────────────
    {
      id: 'logo-brand-refresh',
      category: 'services',
      number: 'LB',
      label: 'BRAND',
      title: 'Logo & Brand Refresh',
      description: 'Refined logo system including wordmark, icon, and platform-ready assets. Improves consistency and brand recognition.',
      placeholderLabel: 'BRAND',
      rows: [
        { key: 'scope', label: 'Scope', value: 'Wordmark · icon · platform assets' },
        { key: 'cta', label: 'Action', value: 'Request a brand refresh →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },

    // ── WEB SERVICES ────────────────────────────────────────────────────────
    {
      id: 'landing-page-build',
      category: 'services',
      number: 'LP',
      label: 'BUILD',
      title: 'Landing Page Build',
      description: 'Single-page site designed and built to convert. Includes copy, layout, and deployment.',
      placeholderLabel: 'BUILD',
      rows: [
        { key: 'scope', label: 'Scope', value: 'Single page · copy + design + deploy' },
        { key: 'cta', label: 'Action', value: 'Request a landing page →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },

    // ── EMAIL SERVICES ──────────────────────────────────────────────────────
    {
      id: 'email-campaign',
      category: 'services',
      number: 'EC',
      label: 'EMAIL',
      title: 'Email Campaign',
      description: 'One complete campaign with template, copy, and send setup. Ready to deploy and track performance.',
      placeholderLabel: 'EMAIL',
      rows: [
        { key: 'scope', label: 'Scope', value: '1 campaign · template + copy + send' },
        { key: 'cta', label: 'Action', value: 'Request an email campaign →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },

    // ── PRODUCT / UI SERVICES ───────────────────────────────────────────────
    {
      id: 'ui-screen-design',
      category: 'services',
      number: 'UI',
      label: 'UI',
      title: 'UI Screen Design',
      description: 'One production-ready Figma screen with components, variants, and dev-ready structure.',
      placeholderLabel: 'UI',
      rows: [
        { key: 'scope', label: 'Scope', value: '1 Figma screen · components + variants' },
        { key: 'cta', label: 'Action', value: 'Request a UI screen →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },
    {
      id: 'ui-flow-design',
      category: 'services',
      number: 'UF',
      label: 'UI',
      title: 'UI Flow Design',
      description: 'Multi-screen flow with shared components and prototype. Built as a scalable system with consistent design logic.',
      placeholderLabel: 'UI',
      rows: [
        { key: 'scope', label: 'Scope', value: 'Multi-screen · prototype + system' },
        { key: 'cta', label: 'Action', value: 'Request a UI flow →' },
      ],
      footerLeft: 'Available',
      footerRight: 'SERVICE',
    },
  ].map((card) => {
    const scribe = scribeCards?.[card.id];
    let analyzer = resolveAnalyzerSource(card.id, analyzerOutputs);

    // Derive readiness for cards without a real analyzer (skip services)
    if (!analyzer && card.category !== 'services') {
      const derivedReadiness = (() => {
        if (card.footerLeft === 'Live') return 'healthy';
        if (card.footerLeft === 'Partial' || card.footerLeft === 'Queued' || card.footerLeft === 'Coming Soon') return 'partial';
        if (card.footerLeft === 'Error') return 'critical';
        return 'critical'; // WORK_NEEDED_LABEL or no data = needs attention
      })();
      analyzer = { readiness: derivedReadiness, findings: [], gaps: [], highlights: [] };
    }

    // Merge deterministic derived findings into analyzer (all non-service cards).
    // Derived findings are data-inspection rules that produce catalog-matchable
    // finding IDs without an LLM call. They augment — never replace — skill findings.
    if (analyzer && card.category !== 'services') {
      const derivedData = { siteMeta, brandOverview, sgDisplayData, seoAudit, homePage: evidencePages[0] || null, pages: evidencePages, client };
      const derived = deriveFindings(card.id, derivedData);
      if (derived.length) {
        // Dedupe: skip derived findings whose ID already exists in skill findings
        const existingIds = new Set((analyzer.findings || []).map((f) => f.id).filter(Boolean));
        const novel = derived.filter((d) => !existingIds.has(d.id));
        if (novel.length) {
          analyzer = {
            ...analyzer,
            findings: [...(analyzer.findings || []), ...novel],
          };
          // Upgrade readiness if derived findings are more severe
          if (novel.some((f) => f.severity === 'critical') && analyzer.readiness !== 'critical') {
            analyzer = { ...analyzer, readiness: 'critical' };
          } else if (novel.some((f) => f.severity === 'warning') && analyzer.readiness === 'healthy') {
            analyzer = { ...analyzer, readiness: 'partial' };
          }
        }
      }
    }

    if (!scribe && !analyzer && !DETERMINISTIC_CARD_IDS.has(card.id)) return card;

    // Deterministic tile description — onboarding cards only, no LLM call.
    // Falls through to scribeShort → static description when builder returns null.
    let dynamicShortDescription = null;
    let built = null;
    let rawData = {};
    const isFactLockedSeo = card.id === 'seo-performance' && scribe?.generatedBy === 'seo-comment-guardian';
    if (DETERMINISTIC_CARD_IDS.has(card.id)) {
      rawData = (() => {
        switch (card.id) {
          case 'audit-summary': {
            const dataRows = Array.isArray(card.rows)
              ? card.rows.filter((row) => row?.isAuditRow && !row?.isColumnHeader)
              : [];
            const capturedCount = dataRows.filter((row) => row?._captured).length;
            const totalCount = dataRows.length;
            const missingCount = Math.max(0, totalCount - capturedCount);
            const weakSection = (() => {
              const groups = [
                ['site evidence', /^site-/],
                ['site metadata', /^meta-/],
                ['AI synthesis', /^synth-|^strat-/],
                ['design system', /^ds-/],
                ['PageSpeed', /^psi-/],
                ['AI visibility', /^aiv-|^ai-/],
                ['artifacts', /^art-/],
              ].map(([label, pattern]) => {
                const rows = dataRows.filter((row) => pattern.test(String(row?.key || '')));
                if (!rows.length) return null;
                const captured = rows.filter((row) => row?._captured).length;
                return { label, ratio: captured / rows.length };
              }).filter(Boolean);
              groups.sort((a, b) => a.ratio - b.ratio);
              return groups[0]?.label || null;
            })();
            return {
              capturedCount,
              totalCount,
              missingCount,
              pagesCrawled: dashboardState?.evidence?.pages?.length ?? 0,
              warningCount: Array.isArray(currentRun?.warnings) ? currentRun.warnings.length : 0,
              psiStatus: seoAudit?.status || null,
              hasScreenshot: Boolean(homepageScreenshotUrl),
              hasMockup: Boolean(intakeMockupSrc),
              hasBrief: hasIntakeData,
              hasIndustry: hasIndustryData,
              hasBusinessModel: hasBusinessModelData,
              weakestArea: weakSection,
            };
          }
          case 'social-preview':
            return {
              ogImage:       siteMeta ? Boolean(siteMeta.ogImage) : null,
              ogTitle:       siteMeta?.title       || null,
              ogDescription: siteMeta?.description || null,
              canonical:     siteMeta?.canonical   || null,
              favicon:       siteMeta?.favicon     || null,
              siteName:      siteMeta?.siteName    || null,
              ogImageAlt:    siteMeta?.ogImageAlt  || null,
              themeColor:    siteMeta?.themeColor  || null,
            };
          case 'visibility-snapshot':
            return {
              score:       null,
              letterGrade: null,
            };
          case 'multi-device-view':
            return {
              captureDone: Boolean(intakeMockupSrc),
              hasMockup: Boolean(intakeMockupSrc),
              screenshotCount: ['desktop', 'tablet', 'mobile'].filter((variant) => Boolean(deviceScreenshots[variant])).length,
              variantCount: 3,
              hasDesktop: Boolean(deviceScreenshots.desktop),
              hasTablet: Boolean(deviceScreenshots.tablet),
              hasMobile: Boolean(deviceScreenshots.mobile),
            };
          case 'brief':
            return { hasBrief: hasIntakeData };
          case 'business-model':
            return { hasModel: hasBusinessModelData, modelLabel: resolvedBusinessModel };
          case 'style-guide':
            return {
              headingFont: sgDisplayData?.typography?.headingSystem?.fontFamily || null,
              bodyFont: sgDisplayData?.typography?.bodySystem?.fontFamily || null,
              primaryColor: sgDisplayData?.colors?.primary?.hex || null,
              neutralColor: sgDisplayData?.colors?.neutral?.hex || null,
              secondaryColor: sgDisplayData?.colors?.secondary?.hex || null,
              motionLevel: sgDisplayData?.motion?.level || null,
            };
          case 'industry':
            return {
              hasCategory: hasIndustryData,
              categoryLabel: resolvedIndustry,
              targetAudience: brandOverview?.targetAudience || null,
              positioning: brandOverview?.positioning || null,
            };
          case 'priority-signal':
            return {
              hasPriority: hasPrioritySignalData,
              focusLabel: resolvedPrioritySignal || null,
              channelLabel: strategy?.postStrategy?.formats?.join(' · ') || null,
            };
          case 'seo-performance':
            return {
              auditStatus:   seoCardState,
              failureCode:   seoDiag?.failureCode || null,
              failureReason: seoDiag?.failureReason || null,
              resolvedUrl:   seoDiag?.resolvedUrl || null,
              hostType:      seoDiag?.hostType || null,
              hostService:   seoDiag?.hostService || null,
              redirectCount: seoDiag?.redirectCount ?? null,
              inputUrl:      seoDiag?.inputUrl || client?.websiteUrl || null,
              requestedUrl:  seoAudit?.meta?.requestedUrl || seoDiag?.inputUrl || client?.websiteUrl || null,
              finalUrl:      seoAudit?.meta?.finalUrl || seoDiag?.resolvedUrl || null,
              displayedUrl:  seoAudit?.meta?.displayedUrl || null,
              performanceScore: seoAudit?.scores?.performance ?? null,
              seoScore:         seoAudit?.scores?.seo ?? null,
              lcpSeconds: seoPrimaryLcp?.p75 != null ? Math.round((seoPrimaryLcp.p75 / 1000) * 10) / 10 : null,
              lcpMs: seoPrimaryLcp?.p75 ?? null,
              lcpSource: seoPrimaryLcp?.source || null,
            };
          default:
            return {};
        }
      })();
      built = buildCardDescription(card.id, analyzer, rawData);
      dynamicShortDescription = card.id === 'seo-performance'
        ? (
            (seoCardState === 'error' || seoCardState === 'partial')
              ? seoAuditDescription
              : (built.description || null)
          )
        : isFactLockedSeo
          ? (scribe?.short || built.description || null)
          : (built.description || null);
      if (
        card.id === 'seo-performance' &&
        dynamicShortDescription &&
        seoProviderTileNote &&
        !isFactLockedSeo &&
        built?.dominantSignal?.type !== 'hosting-context'
      ) {
        dynamicShortDescription = `${dynamicShortDescription} ${seoProviderTileNote}`;
      }
    }

    // Data Stream description — built from real audit row counts (same source as the gauge).
    if (card.id === 'audit-summary' && rawData?.totalCount > 0) {
      const { capturedCount, totalCount, weakestArea } = rawData;
      const pct = Math.round((capturedCount / totalCount) * 100);
      dynamicShortDescription = pct === 100
        ? `${capturedCount} of ${totalCount} data points captured — all sections complete.`
        : weakestArea
          ? `${capturedCount} of ${totalCount} data points captured — ${weakestArea} is the thinnest section.`
          : `${capturedCount} of ${totalCount} data points captured (${pct}%).`;
    }

    // Module state override — replaces description for disabled/failed/idle modular cards.
    // Running/queued states defer to the standard description so progress copy shows.
    if (card.moduleControls) {
      const moduleCardState = moduleState?.[card.id] ?? null;

      let moduleContext = {};
      if (card.id === 'multi-device-view') {
        moduleContext = {
          hasMockup: Boolean(dashboardState?.artifacts?.homepageDeviceMockup?.downloadUrl),
          hasFullPages: Boolean(
            dashboardState?.artifacts?.fullPageScreenshots?.['desktop-full']?.downloadUrl
            || dashboardState?.artifacts?.fullPageScreenshots?.['tablet-full']?.downloadUrl
            || dashboardState?.artifacts?.fullPageScreenshots?.['mobile-full']?.downloadUrl
          ),
        };
      } else if (card.id === 'seo-performance') {
        const signal = built?.dominantSignal || null;
        const signalId = String(signal?.id || '');
        const isAiSignal = signalId.startsWith('ai-');
        const isAiCritical = isAiSignal && signal?.readiness === 'critical';
        moduleContext = {
          hasPsi: Boolean(seoAudit?.scores),
          psiStatus: seoAudit?.status || null,
          perf: seoAudit?.scores?.performance ?? null,
          seo:  seoAudit?.scores?.seo ?? null,
          a11y: seoAudit?.scores?.accessibility ?? null,
          bp:   seoAudit?.scores?.bestPractices ?? null,
          psiErrorReason: seoAudit?.diagnosticsContext?.failureReason || seoAudit?.error || null,
          aiGap: isAiSignal,
          aiCritical: isAiCritical,
          aiGapDetail: isAiSignal ? (signal?.finding || signal?.description || null) : null,
          dominantType: signal?.type || null,
          dominantFinding: signal?.finding || signal?.description || null,
          dominantAction: signal?.action || null,
        };
      } else if (card.id === 'social-preview') {
        const SOCIAL_FIELDS = [
          { key: 'title',          label: 'page title' },
          { key: 'description',    label: 'share description' },
          { key: 'ogImage',        label: 'share image' },
          { key: 'ogImageAlt',     label: 'share image alt text' },
          { key: 'favicon',        label: 'favicon' },
          { key: 'appleTouchIcon', label: 'Apple touch icon' },
          { key: 'themeColor',     label: 'mobile theme color' },
          { key: 'siteName',       label: 'site name' },
          { key: 'canonical',      label: 'canonical URL' },
        ];
        const meta = siteMeta || {};
        const missing = SOCIAL_FIELDS.filter((f) => !meta[f.key]).map((f) => f.label);
        const present = SOCIAL_FIELDS.filter((f) => Boolean(meta[f.key])).map((f) => f.label);
        moduleContext = { missing, present };
      }
      const moduleDesc = buildModuleStateDescription(card.id, moduleCardState, moduleContext);
      if (moduleDesc) dynamicShortDescription = moduleDesc;

      // Design Evaluation: once the analyzer has findings, replace the generic
      // module-state copy with a results-focused summary that points the user
      // to the Design Brief inside the modal.
      if (card.id === 'design-evaluation' && analyzer && moduleCardState?.status === 'succeeded') {
        const findings = Array.isArray(analyzer.findings) ? analyzer.findings : [];
        const critical = findings.filter((f) => f?.severity === 'critical').length;
        const warning  = findings.filter((f) => f?.severity === 'warning').length;
        const readiness = analyzer.readiness || 'partial';
        const verdict = readiness === 'critical'
          ? 'Your design has foundational issues holding the visual system back'
          : readiness === 'healthy'
            ? 'Your design reads as coherent with only minor refinements suggested'
            : 'Your design is recoverable but needs attention in a few places';
        const countPhrase = findings.length === 0
          ? 'No findings surfaced this run.'
          : `${findings.length} finding${findings.length === 1 ? '' : 's'}${critical ? ` (${critical} critical)` : warning ? ` (${warning} to address)` : ''}.`;
        dynamicShortDescription = `${verdict}. ${countPhrase} Open the Design Brief inside to review the DESIGN.md and change recommendations.`;
      }
    }

    const isSeoHostingContext = card.id === 'seo-performance' && built?.dominantSignal?.type === 'hosting-context';

    const readinessContext = (() => {
      if (card.id === 'seo-performance') return '';
      if (card.id === 'survey-status') return '';
      if (card.id === 'industry') return '';
      if (!analyzer?.readiness) return '';
      switch (analyzer.readiness) {
        case 'critical':
          return ' Status: Holding you back — at least one major issue found that directly impacts visibility, trust, or conversion.';
        case 'partial':
          return ' Status: Needs attention — some warnings or incomplete data detected. Room to improve.';
        case 'healthy':
          return ' Status: In a good spot — all checks passed. No issues found.';
        default:
          return '';
      }
    })();

    const baseDescription = (() => {
      // Market Category owns its own dynamic description (value + how it was
      // reached). Bypass the generic analyzer/scribe copy entirely.
      if (card.id === 'industry') return card.description;
      if ((card.id === 'audit-summary' || card.id === 'social-preview' || card.id === 'multi-device-view' || card.id === 'style-guide' || card.id === 'priority-signal') && built?.description) {
        return built.description;
      }
      if (card.id === 'seo-performance' && built?.description) {
        const providerTail = seoProviderNote && built?.dominantSignal?.type !== 'hosting-context'
          ? seoProviderNote
          : null;
        const finding = built?.dominantSignal?.finding || null;
        const impact = built?.dominantSignal?.impact || null;
        const action = built?.dominantSignal?.action || null;
        const seoParts = [finding, impact, providerTail, action].filter(Boolean);
        return seoParts.length ? seoParts.join(' ') : built.description;
      }
      if (card.id === 'seo-performance' && (seoCardState === 'error' || seoCardState === 'partial')) {
        return seoAuditDescription;
      }
      if (isSeoHostingContext && built?.description) {
        return built.description;
      }
      if (card.id === 'seo-performance' && seoProviderNote && scribe?.generatedBy !== 'seo-comment-guardian') {
        return `${scribe?.expanded || card.description} ${seoProviderNote}`;
      }
      return scribe?.expanded || card.description;
    })();

    const readinessBadge = (() => {
      if (card.id === 'survey-status') {
        const s = card.surveyStatus;
        return s === 'complete'
          ? { tone: 'ok',       label: 'Complete'    }
          : s === 'partial'
          ? { tone: 'partial',  label: 'In Progress' }
          : { tone: 'critical', label: 'Not Started' };
      }
      if (card.id === 'industry') {
        if (!hasCategoryData) return { tone: 'partial', label: 'Set category' };
        return {
          tone: 'ok',
          label: _mcSource === 'agent' ? 'Classified' : _mcSource === 'user' ? 'User-set' : 'Detected',
        };
      }
      const seoSignalReadiness = card.id === 'seo-performance' ? built?.dominantSignal?.readiness || null : null;
      const seoSignalId = card.id === 'seo-performance' ? built?.dominantSignal?.id || '' : '';
      const isAiSpecificSeoSignal = card.id === 'seo-performance' && String(seoSignalId).startsWith('ai-');
      if (card.id === 'seo-performance' && seoCardState === 'error') {
        return { tone: 'partial', label: 'Audit limited' };
      }
      if (card.id === 'seo-performance' && seoCardState === 'partial') {
        return { tone: 'partial', label: 'Partial audit' };
      }
      if (card.id === 'seo-performance' && isSeoHostingContext) {
        if (rawData.hostService === 'Internet Computer (ICP)') {
          return { tone: 'partial', label: 'ICP-hosted' };
        }
        if (rawData.hostService === 'Arweave') {
          return { tone: 'partial', label: 'Arweave-hosted' };
        }
        if (rawData.hostService === 'IPFS') {
          return { tone: 'partial', label: 'IPFS-hosted' };
        }
        return {
          tone: 'partial',
          label: String(rawData.hostType || '').toLowerCase().includes('gateway') ? 'Gateway-hosted' : 'Forwarded URL',
        };
      }
      if (card.id === 'seo-performance' && seoSignalReadiness) {
        if (isAiSpecificSeoSignal) {
          return {
            tone: seoSignalReadiness === 'critical' ? 'critical' : 'partial',
            label: seoSignalReadiness === 'critical' ? 'AI access issue' : 'AI gap found',
          };
        }
        return {
          tone: seoSignalReadiness,
          label: seoSignalReadiness === 'critical'
            ? 'Holding you back'
            : seoSignalReadiness === 'partial'
              ? 'Needs attention'
              : 'In a good spot',
        };
      }
      if (card.id === 'audit-summary' && built?.dominantSignal?.readiness) {
        return {
          tone: built.dominantSignal.readiness,
          label: built.dominantSignal.readiness === 'critical'
            ? 'Data quality issue'
            : built.dominantSignal.readiness === 'partial'
              ? 'Baseline needs work'
              : 'Baseline ready',
        };
      }
      if (card.id === 'social-preview' && built?.dominantSignal?.readiness) {
        return {
          tone: built.dominantSignal.readiness,
          label: built.dominantSignal.readiness === 'critical'
            ? 'Share preview issue'
            : built.dominantSignal.readiness === 'partial'
              ? 'Share gaps found'
              : 'Share-ready',
        };
      }
      if (card.id === 'multi-device-view') {
        // Derive readiness from actual artifact presence so the badge matches
        // the footer dot: both artifacts → Passed, one missing → Partial,
        // both missing → Capture failed.
        const mdHasMockup = Boolean(dashboardState?.artifacts?.homepageDeviceMockup?.downloadUrl);
        const mdFp = dashboardState?.artifacts?.fullPageScreenshots || {};
        const mdHasFullPages = Boolean(
          mdFp['desktop-full']?.downloadUrl || mdFp['tablet-full']?.downloadUrl || mdFp['mobile-full']?.downloadUrl
        );
        if (mdHasMockup && mdHasFullPages) {
          return { tone: 'ok', label: 'Passed' };
        }
        if (!mdHasMockup && !mdHasFullPages) {
          return { tone: 'critical', label: 'Capture failed' };
        }
        return { tone: 'partial', label: 'Partial' };
      }
      if (card.id === 'style-guide') {
        // After a modular run, derive pass state from the actual style-guide
        // data presence. Fall back to analyzer signal when no data yet.
        if (hasStyleGuideData) {
          return { tone: 'ok', label: 'Passed' };
        }
        if (built?.dominantSignal?.readiness) {
          return {
            tone: built.dominantSignal.readiness,
            label: built.dominantSignal.readiness === 'critical'
              ? 'System thin'
              : built.dominantSignal.readiness === 'partial'
                ? 'System partial'
                : 'System ready',
          };
        }
      }
      if (card.id === 'industry' && built?.dominantSignal?.readiness) {
        return {
          tone: built.dominantSignal.readiness,
          label: built.dominantSignal.readiness === 'critical'
            ? 'Category needs clarity'
            : built.dominantSignal.readiness === 'partial'
              ? 'Category still forming'
              : 'Category set',
        };
      }
      if (card.id === 'priority-signal' && built?.dominantSignal?.readiness) {
        return {
          tone: built.dominantSignal.readiness,
          label: built.dominantSignal.readiness === 'critical'
            ? 'Next step missing'
            : built.dominantSignal.readiness === 'partial'
              ? 'Next step taking shape'
              : 'Next step ready',
        };
      }
      if (!analyzer?.readiness) return null;
      return {
        tone: analyzer.readiness,
        label: analyzer.readiness === 'critical'
          ? 'Holding you back'
          : analyzer.readiness === 'partial'
            ? 'Needs attention'
            : 'In a good spot',
      };
    })();

    return {
      ...card,
      description:             baseDescription,
      // Market Category owns its copy on the tile face too — suppress the
      // generic module/scribe short text so the face uses its description.
      scribeShort:             card.id === 'industry' ? null : (DETERMINISTIC_CARD_IDS.has(card.id) ? null : (scribe?.short || null)),
      dynamicShortDescription: card.id === 'industry' ? null : dynamicShortDescription,
      recommendation:          scribe?.recommendation || null,
      readinessBadge,
      analyzer,
    };
  });

  // ── Active module card (for terminal UI customisation) ───────────────────
  const activeModuleCardId = Object.keys(moduleRunLoading).find((k) => moduleRunLoading[k]) || null;
  const activeModuleCard = activeModuleCardId
    ? intakeCapabilityCards.find((c) => c.id === activeModuleCardId) || null
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div data-dashboard-theme={theme} style={shellStyle}>
      <style>{dashboardCss}</style>
      <header id="founders-top-strip">
        <div id="founders-top-strip-inner">
          <Link href="/" id="founders-brand" aria-label="Back to homepage">
            <img src="/img/circle_logo.png" alt="" aria-hidden="true" />
          </Link>
          <div id="founders-top-actions">
            <Link href="/" id="founders-linkedin" aria-label="Homepage">
              <House size={18} strokeWidth={1.75} />
            </Link>
            <button type="button" id="founders-login-link" onClick={handleSignOut}>
              Logout
            </button>
            <a
              id="founders-chat-cta"
              href="https://calendly.com/bballi/30min"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="founders-chat-label-full">Contact</span>
              <span className="founders-chat-label-short">Contact</span>
              <span id="founders-chat-cta-icon">↗</span>
            </a>
          </div>
          <div id="founders-hidden-controls" aria-hidden="true">
            <div id="theme-toggle" role="group" aria-label="Theme">
              <button type="button" data-theme="dark" className={theme === 'dark' ? 'is-active' : ''} onClick={() => { setTheme('dark'); trackThemeChanged('dark'); }}>DARK</button>
              <button type="button" data-theme="light" className={theme === 'light' ? 'is-active' : ''} onClick={() => { setTheme('light'); trackThemeChanged('light'); }}>LIGHT</button>
            </div>
            <button type="button" id="founders-signout" onClick={handleSignOut}>Sign Out</button>
          </div>
        </div>
      </header>
      <main id="founders-shell">

        {noWorkspaceState ? (
          <div id="dashboard-associate-shell" style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'clamp(1rem, 5vw, 2rem)',
            boxSizing: 'border-box',
            overflowX: 'hidden',
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
          }}>
            <InternalPageBackground />
            <style>{`
              #dashboard-associate-submit-btn:disabled {
                opacity: 0.25;
                cursor: not-allowed;
              }
              @media (max-width: 480px) {
                #dashboard-associate-shell {
                  align-items: start;
                  padding-top: 1.5rem;
                  padding-bottom: 1.5rem;
                }
                #dashboard-associate-card {
                  padding: 1.25rem;
                  width: 100%;
                  max-width: none !important;
                  box-sizing: border-box;
                }
              }
            `}</style>
            <div id="dashboard-associate-gradient" style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(60% 60% at 10% 15%, rgba(102, 184, 164, 0.12), transparent 60%), radial-gradient(50% 50% at 82% 72%, rgba(171, 148, 218, 0.14), transparent 65%), linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))',
              pointerEvents: 'none',
              zIndex: 1,
            }} />

            <div id="dashboard-associate-card" style={{
              position: 'relative',
              zIndex: 2,
              width: '100%',
              maxWidth: '30rem',
              padding: 'clamp(1.25rem, 5vw, 2rem)',
              borderRadius: '1.1rem',
              boxSizing: 'border-box',
              ...internalPageGlassCardStyle,
              boxShadow: '0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4), 0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1), 0px 20px 40px rgba(0,0,0,0.15)',
            }}>
              <div id="dashboard-associate-brand-row" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', justifyContent: 'space-between' }}>
                <img src="/img/sig.png" alt="" aria-hidden="true" style={{ width: '2.75rem', height: 'auto', display: 'block' }} />
                <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>Client Access</span>
                <Link href="/" id="dashboard-associate-back-btn" aria-label="Back to site" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2.4rem', height: '2.4rem', borderRadius: '999px', background: 'rgba(255,255,255,0.34)', border: '1px solid rgba(42,36,32,0.12)', color: 'rgba(42,36,32,0.58)', textDecoration: 'none', fontSize: '1.05rem', fontFamily: '"Space Mono", monospace', lineHeight: 1 }}>✕</Link>
              </div>

              <div id="dashboard-associate-marquee-viewport" style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
                <div ref={noWorkspaceMarqueeTrackRef} style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform' }}>
                  <span style={{ margin: 0, flexShrink: 0, color: '#2a2420', fontSize: 'clamp(2rem, 8.5vw, 7rem)', lineHeight: 1, letterSpacing: '-0.04em', fontFamily: '"Doto", "Space Mono", monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    LINK YOUR DASHBOARD&nbsp;&nbsp;·&nbsp;&nbsp;ASSOCIATE WEBSITE&nbsp;&nbsp;·&nbsp;&nbsp;
                  </span>
                  <span aria-hidden="true" style={{ margin: 0, flexShrink: 0, color: '#2a2420', fontSize: 'clamp(2rem, 8.5vw, 7rem)', lineHeight: 1, letterSpacing: '-0.04em', fontFamily: '"Doto", "Space Mono", monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    LINK YOUR DASHBOARD&nbsp;&nbsp;·&nbsp;&nbsp;ASSOCIATE WEBSITE&nbsp;&nbsp;·&nbsp;&nbsp;
                  </span>
                </div>
              </div>

              <div id="dashboard-associate-email-chip" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', padding: '0.6rem 0.75rem', borderRadius: '0.75rem', background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(42,36,32,0.1)', overflow: 'hidden' }}>
                <Lock size={14} strokeWidth={1.5} style={{ flexShrink: 0, color: 'rgba(42,36,32,0.45)' }} aria-hidden="true" />
                <span id="dashboard-associate-email-text" style={{ flex: 1, fontSize: '0.82rem', color: 'rgba(42,36,32,0.72)', fontFamily: '"Space Grotesk", system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0, fontSize: '0.6rem', fontFamily: '"Space Mono", monospace', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.4)', background: 'rgba(42,36,32,0.06)', borderRadius: '999px', padding: '0.2rem 0.5rem' }}>
                  <Lock size={10} strokeWidth={2} aria-hidden="true" />
                  SIGNED IN
                </span>
              </div>

              <form
                id="dashboard-associate-form"
                style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginTop: '1.2rem' }}
                onSubmit={(e) => { e.preventDefault(); handleReseed(); }}
              >
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <span style={{ color: 'rgba(42,36,32,0.55)', fontSize: '0.72rem', fontWeight: 400, fontFamily: '"Space Mono", monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Website URL</span>
                  <input
                    id="dashboard-associate-url"
                    type="url"
                    value={reseedUrl}
                    onChange={(e) => { setReseedUrl(e.target.value); setReseedError(''); setReseedSuccess(false); }}
                    placeholder="yourbusiness.com"
                    spellCheck={false}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '0.9rem 1rem', borderRadius: '0.95rem', border: '1px solid rgba(42,36,32,0.12)', background: 'rgba(255,255,255,0.72)', color: '#2a2420', fontSize: '1rem', fontFamily: '"Space Grotesk", system-ui, sans-serif' }}
                  />
                </label>

                {reseedError ? (
                  <div id="dashboard-associate-error" style={{ color: '#8b1e1e', fontSize: '0.82rem', fontFamily: '"Space Mono", monospace', letterSpacing: '0.04em' }}>[ERROR: {reseedError}]</div>
                ) : null}
                {reseedSuccess ? (
                  <div id="dashboard-associate-success" style={{ color: '#2d6a4f', fontSize: '0.82rem', fontFamily: '"Space Mono", monospace', letterSpacing: '0.04em' }}>Dashboard creation queued. This page will update when ready.</div>
                ) : null}

                <button
                  type="submit"
                  id="dashboard-associate-submit-btn"
                  className="cta-pill-btn"
                  disabled={reseedLoading || !reseedUrl.trim()}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: '3rem', border: 'none', borderRadius: '999px', background: 'linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)', color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', marginTop: '0.4rem', fontFamily: '"Space Mono", monospace', letterSpacing: '0.05em', textTransform: 'uppercase' }}
                >
                  {reseedLoading ? 'Working…' : 'Create Dashboard'}
                </button>

                <div id="dashboard-associate-secondary-actions" style={{ display: 'flex', gap: '0.6rem', marginTop: '0.2rem' }}>
                  <button
                    type="button"
                    id="dashboard-associate-signout-btn"
                    onClick={handleSignOut}
                    style={{ flex: 1, borderRadius: '999px', border: '1px solid rgba(42,36,32,0.14)', padding: '0.75rem 1rem', color: 'rgba(42,36,32,0.65)', background: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.82rem', fontFamily: '"Space Mono", monospace', letterSpacing: '0.04em', textTransform: 'uppercase' }}
                  >
                    Sign Out
                  </button>
                  <Link
                    href="/"
                    id="dashboard-associate-back-site-link"
                    style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '999px', border: '1px solid rgba(42,36,32,0.14)', padding: '0.75rem 1rem', textDecoration: 'none', color: 'rgba(42,36,32,0.65)', background: 'rgba(255,255,255,0.6)', fontSize: '0.82rem', fontFamily: '"Space Mono", monospace', letterSpacing: '0.04em', textTransform: 'uppercase' }}
                  >
                    Back to Site
                  </Link>
                </div>
              </form>
            </div>
          </div>
        ) : (
        <>
        {/* ── Hero ── */}
        <section id="founders-hero-shell">
          <div id="founders-hero-numeric-shell">
            <div id="founders-hero-numeric" aria-label="Dashboard headline">
              <div id="founders-hero-marquee-shell" ref={heroMarqueeShellRef}>
                <div id="founders-hero-marquee-track" ref={heroMarqueeTrackRef}>
                  {Array.from({ length: heroMarqueeCopies }).map((_, index) => (
                    <span
                      key={`hero-marquee-copy-${index}`}
                      className="founders-hero-marquee-copy"
                      ref={index === 0 ? heroMarqueeCopyRef : null}
                      aria-hidden={index > 0 ? 'true' : undefined}
                    >
                      {capabilityHeadline} <span className="founders-hero-marquee-sep">/</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div id="founders-hero-meta">
            <div className="meta-row" id="client-meta-row">
              <span className="label">CLIENT</span>
              <span className="value">{client?.companyName || 'UNASSIGNED'}</span>
              {client?.clientId && (
                <button
                  type="button"
                  id="client-edit-trigger-btn"
                  className="meta-row-action-btn"
                  aria-label="Edit client name"
                  title="Edit client name"
                  onClick={() => {
                    setClientNameInput(client?.companyName || '');
                    setClientEditError(null);
                    setShowClientEditModal(true);
                  }}
                >
                  <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
              {isAdmin ? (
                <div className="client-switcher">
                  <button
                    type="button"
                    className="client-switcher-trigger"
                    aria-label="Switch dashboard client"
                    aria-expanded={clientSwitcherOpen}
                    title="Switch dashboard client"
                    onClick={() => setClientSwitcherOpen((open) => !open)}
                  >
                    <span>{impersonateId ? 'Viewing client' : 'My dashboard'}</span>
                    <ChevronDown size={13} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                  {clientSwitcherOpen ? (
                    <div className="client-switcher-menu" role="menu">
                      <button
                        type="button"
                        className={!impersonateId ? 'active' : undefined}
                        role="menuitem"
                        onClick={() => switchDashboard(null)}
                      >
                        Switch to my dashboard
                      </button>
                      {adminDashboards.length > 0 ? (
                        adminDashboards.map((item) => (
                          <button
                            key={item.clientId}
                            type="button"
                            className={impersonateId === item.clientId ? 'active' : undefined}
                            role="menuitem"
                            onClick={() => switchDashboard(item.clientId)}
                          >
                            <span>{item.name || item.clientId}</span>
                            <small>{item.websiteUrl || item.clientId}</small>
                          </button>
                        ))
                      ) : (
                        <span className="client-switcher-empty">No provisioned dashboards</span>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="meta-row" id="account-meta-row">
              <span className="label">ACCOUNT</span>
              <span className="value">{user?.email || 'SIGNED IN'}</span>
              {user?.email && (
                <button
                  type="button"
                  id="account-delete-trigger-btn"
                  className="meta-row-action-btn meta-row-action-btn--danger"
                  aria-label="Delete account"
                  title="Delete account"
                  onClick={() => {
                    setDeleteConfirmInput('');
                    setDeleteAccountError(null);
                    setShowDeleteAccountModal(true);
                  }}
                >
                  <XIcon size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="meta-row" id="tier-meta-row">
              <span className="label">STATUS</span>
              <span className="value">Onboarded</span>
              <button
                type="button"
                id="tier-trigger-btn"
                className="meta-row-action-btn"
                aria-label="View pricing tiers"
                title="View pricing tiers"
                onClick={() => { setShowTierModal(true); trackTierModalOpened(); }}
              >
                <ArrowUpRight size={12} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="meta-row meta-row-source">
              <div className="meta-row-source-body">
                <div id="reseed-control-row">
                  <div id="dashboard-source-cta-row">
                    <Globe id="dashboard-source-cta-icon" size={15} strokeWidth={1.5} aria-hidden="true" />
                    <input
                      id="reseed-url-input"
                      type="url"
                      value={reseedUrl}
                      onChange={(e) => { setReseedUrl(e.target.value); setReseedError(''); setReseedSuccess(false); }}
                      placeholder="yourbusiness.com"
                      disabled={reseedLoading || isRunActive}
                      spellCheck={false}
                    />
                    <button
                      id="reseed-run-btn"
                      className="cta-pill-btn"
                      type="button"
                      onClick={handleReseed}
                      disabled={reseedLoading || isRunActive || !reseedUrl.trim()}
                    >
                      <span className="reseed-run-btn-label-desktop">
                        {reseedLoading ? 'Queueing...' :
                         latestRunStatus === 'queued' ? 'Intake Queued' :
                         latestRunStatus === 'running' ? 'Intake Running' :
                         client ? 'Update & Rerun' : 'Create Dashboard'}
                      </span>
                      <span className="reseed-run-btn-label-mobile">
                        {reseedLoading ? 'Queueing...' : 'Rerun'}
                      </span>
                      <span id="reseed-run-btn-icon">↗</span>
                    </button>
                  </div>
                </div>
                {/*
                  This row is meaningful only for full-intake pipeline runs
                  (re-seeding the website URL). When the user clicks Run on a
                  card the brief_run has pipelineType: 'module-run' — the terminal
                  UI shows the progress, and this intake-field row should stay
                  hidden. Only surface for intake-type (non module-run) runs.
                */}
                {isRunActive && currentRun?.pipelineType !== 'module-run' ? (
                  <div id="reseed-active-row">
                    <span id="reseed-run-status-label">
                      {latestRunStatus === 'queued' ? 'RUN IS QUEUED — WAITING FOR WORKER' : 'RUN IN PROGRESS — PROCESSING'}
                    </span>
                    <button
                      id="reseed-cancel-btn"
                      type="button"
                      onClick={handleCancelRun}
                      disabled={cancelLoading}
                    >
                      {cancelLoading ? 'CANCELLING...' : 'RESET & CHANGE WEBSITE'}
                    </button>
                  </div>
                ) : null}
                {cancelError ? <div id="reseed-error-msg">{cancelError}</div> : null}
                {reseedError ? <div id="reseed-error-msg">{reseedError}</div> : null}
              </div>
            </div>
          </div>
        </section>

        {/* ── Capability section ── */}
        <section id="capability-section">
          {bootstrapError ? <div className="db-alert">{bootstrapError}</div> : null}
          {/* Error banner removed — errors surface in the terminal + survey
              chat thread. Never show a top-level alert that shifts layout. */}

          {/* ── Capability section shell ── */}
          {/* Hold render until the initial capability filter is resolved so the
              nav pills + grid don't flash 'brief' before correcting to
              'onboarding' for modular clients. */}
          <div id="capability-section-shell" style={{ visibility: activeCapabilityFilter ? 'visible' : 'hidden' }}>

          {/* Left — grid */}
          <div id="capability-grid-col">
          {activeCapabilityFilter === 'leadgen' ? (
            <div id="leadgen-grid-col-shell">
              <LeadGenDashboard />
            </div>
          ) : null}
          <div id="capability-grid" ref={capabilityGridRef} style={activeCapabilityFilter === 'leadgen' ? { display: 'none' } : undefined}>
            {(() => {
              // Ordered unlock chain for the onboarding section. Index 0 is
              // always unlocked; every card after it requires the previous
              // card in the chain to have passed. Cards not in the chain stay
              // locked until they're added here.
              const CARD_UNLOCK_CHAIN = ['multi-device-view', 'design-evaluation', 'social-preview', 'style-guide', 'seo-performance'];
              const INACTIVE_CARD_DESCRIPTIONS = {
                'design-evaluation':   'Run this to evaluate your site\'s design — we read a homepage screenshot with a custom design-critique skill, rate your visual system from our perspective, and return a DESIGN.md brief with change recommendations.',
                'multi-device-view':   'Run this to capture your site on desktop, tablet, and mobile, composite a single device-frame mockup, and collect full-page screenshots per device.',
                'social-preview':      'Run this to pull your site metadata, favicon, and share description, and generate a preview of exactly how your site appears when shared — plus a flag list for anything that is missing.',
                'style-guide':         'Run this to extract colors, typography, and logo usage from the live site and render a compact style guide for the brand layer of your dashboard.',
                'seo-performance':     'Run this to score your site in PageSpeed Insights and run a structured SEO scan — speed, metadata, and structural issues summarized in one view.',
                'business-model':      'Run this to synthesize what your business does, who it serves, and how it makes money — drawn from site evidence, not guesswork.',
                'industry':            'Run this to classify your industry and positioning so the dashboard can benchmark you against the right peers.',
                'visibility-snapshot': 'Run this to probe how your site surfaces in AI search — citations, answers, and competitor coverage — in a single readout.',
                'audit-summary':       'Run every card in Data Visualization to unlock a Brief with all the information — each module fills a section. Then this card aggregates the baseline checks into a single go / no-go foundation score.',
                'priority-signal':     'Run this to pick the single highest-leverage action for your site right now, with the evidence behind it.',
                'agent-readiness':     'Run this to probe robots.txt, sitemaps, llms.txt, structured data, and MCP endpoints — returns a readiness score, a list of what\'s blocking AI agents, and copy-paste fixes for each issue.',
              };
              const LOCKED_CARD_DESCRIPTIONS = {
                'design-evaluation':   'Evaluates your site\'s design by reading a homepage screenshot with a custom design-critique skill and rating your visual system from our perspective. Returns a DESIGN.md brief with change recommendations you can review or hand to a design agent.',
                'multi-device-view':   'Captures your site on desktop, tablet, and mobile, composites them into a single device-frame mockup, and provides full-page screenshots you can browse per device.',
                'social-preview':      'Reads your site metadata, favicon, and share description, and shows exactly how your site appears when shared on social platforms. Flags missing images, titles, and descriptions.',
                'audit-summary':       'Run every card in Data Visualization to unlock a complete Brief — each module feeds a section. This card then aggregates pages fetched, metadata coverage, and analyzer warnings into a single go / no-go readout.',
                'business-model':      'Synthesizes what your business actually does, who it serves, and how it makes money — written from site evidence, not guesswork.',
                'seo-performance':     'Runs a PageSpeed Insights audit and a structured SEO scan, then summarizes speed, metadata, and structural issues that affect visibility and conversion.',
                'industry':            'Classifies your industry and positioning so the dashboard can benchmark you against the right peers and apply the right content playbook.',
                'visibility-snapshot': 'Probes how your site surfaces in AI search (LLM responses, citations, answers) and reports where you show up versus where competitors dominate.',
                'style-guide':         'Extracts your visual identity from the live site — colors, typography, logo usage — and renders a compact style guide for the brand layer of your dashboard.',
                'priority-signal':     'Picks the single highest-leverage action for your site right now, with the evidence behind it, so you know exactly what to work on next.',
              };
              const hasCardPassed = (cardId) => {
                if (cardId === 'design-evaluation') {
                  // Running design-evaluation at all progresses the chain.
                  const s = moduleState?.[cardId]?.status;
                  return s === 'succeeded' || s === 'failed' || s === 'partial';
                }
                if (cardId === 'multi-device-view') {
                  const mockup = Boolean(dashboardState?.artifacts?.homepageDeviceMockup?.downloadUrl);
                  const fp = dashboardState?.artifacts?.fullPageScreenshots || {};
                  const full = Boolean(fp['desktop-full']?.downloadUrl || fp['tablet-full']?.downloadUrl || fp['mobile-full']?.downloadUrl);
                  return mockup && full;
                }
                if (cardId === 'social-preview') {
                  // Unlocks the next card whether social-preview passed, was
                  // partial, or failed — running it at all is enough to
                  // progress the chain.
                  const s = moduleState?.[cardId]?.status;
                  return s === 'succeeded' || s === 'failed' || s === 'partial';
                }
                if (cardId === 'seo-performance') {
                  // Same rule — running SEO at all progresses the chain, so
                  // Brand Snapshot appears even if PSI was flaky.
                  const s = moduleState?.[cardId]?.status;
                  return s === 'succeeded' || s === 'failed' || s === 'partial';
                }
                if (cardId === 'style-guide') {
                  // Same progression rule as the other chain cards — running
                  // Brand Snapshot at all (succeeded/failed/partial) unlocks
                  // the next slot (SEO Performance).
                  const s = moduleState?.[cardId]?.status;
                  return s === 'succeeded' || s === 'failed' || s === 'partial';
                }
                return false;
              };
              // Data Visualization bucket is fully unlocked — every card can
              // be run individually in any order. Server-side autoEnable in
              // /api/dashboard/modules/run handles flipping moduleConfig.enabled
              // on first click for cards that were previously gated.
              const isCardLocked = () => false;
              const chainSortKey = (cardId) => {
                if (cardId === 'audit-summary')  return -1;
                      if (cardId === 'social-preview') return 0.5; // 3rd
                      if (cardId === 'style-guide')    return 0.6; // 4th — Brand Snapshot right after Social
                      if (cardId === 'visual-dna')     return 3.4; // after generated site, before analysis cards
                      if (cardId === 'survey-status')  return Number.MAX_SAFE_INTEGER;
                const idx = CARD_UNLOCK_CHAIN.indexOf(cardId);
                return idx === -1 ? 999 + cardId.charCodeAt(0) : idx;
              };
              return activeCapabilityFilter && intakeCapabilityCards
                .filter((card) => {
                  if (activeCapabilityFilter === 'onboarding') {
                    if (!ONBOARDING_CARD_IDS.has(card.id)) return false;
                    return true;
                  }
                  return activeCapabilityFilter === card.category;
                })
                .sort((a, b) => {
                  if (activeCapabilityFilter === 'onboarding') return chainSortKey(a.id) - chainSortKey(b.id);
                  if (activeCapabilityFilter === 'knowledge') {
                    const order = ['audit-summary', 'knowledge-base', 'survey-status', 'industry', 'business-model'];
                    const ai = order.indexOf(a.id); const bi = order.indexOf(b.id);
                    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                  }
                  return 0;
                })
                .map((card) => {
              const _mEnabled = moduleConfig ? (moduleConfig[card.id]?.enabled ?? false) : true;
              const _mStatus = moduleState?.[card.id]?.status ?? 'inactive';
              const hasBothButtons = Boolean(card.moduleControls) && !(!_mEnabled && _mStatus === 'inactive');
              // All client dashboard cards are now visible without legacy
              // modular-onboarding dimming; module buttons still control run state.
              const isDimmed = false;
              const isLocked = card.locked || (activeCapabilityFilter === 'onboarding' && isCardLocked(card.id));
              // Unlocked but not yet run (enabled/disabled without a succeeded status) —
              // we want no card-level hover effect, only direct button hover.
              // Leadgen flow cards aren't tracked in moduleState — drive the
              // disabled state from the synthetic-prospect-derived readinessBadge.
              const isInactiveUnlocked = card.leadgenStep
                ? (!isLocked && !card.readinessBadge)
                : (!isLocked && Boolean(card.moduleControls)
                   && !(_mStatus === 'succeeded' || _mStatus === 'running' || _mStatus === 'queued'));
              return (
              <article
                data-capability-card
                data-flip-id={`cap-${card.id}`}
                className={`tile tile-intake-card${hasIntakeData ? ' tile-ready' : ''}${card.wide ? ' tile-intake-card--wide' : ''}${hasBothButtons && !isLocked ? ' tile-intake-card--btns-only' : ''}${isDimmed && !isLocked ? ' tile-intake-card--dimmed' : ''}${isLocked ? ' tile-intake-card--locked' : ''}${isInactiveUnlocked || card.id === 'survey-status' ? ' tile-intake-card--inactive' : ''}${expandedMobileCards.has(card.id) ? ' tile-intake-card--mobile-expanded' : ''}`}
                id={card.domId || `tile-${card.id}`}
                key={card.id}
                onClick={(e) => {
                  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches) {
                    const isCollapsed = !expandedMobileCards.has(card.id);
                    if (isCollapsed) {
                      // Any tap on a collapsed card expands it
                      toggleMobileCard(card.id);
                    } else if (e.target.closest('.tile-number')) {
                      // Only the header strip collapses an expanded card
                      toggleMobileCard(card.id);
                    }
                    return;
                  }
                  if (isLocked || isInactiveUnlocked || card.id === 'survey-status' || hasBothButtons) return;
                  if (card.id === 'brief' && briefPreviewHtml) { setBriefFullScreen(true); return; }
                  setActiveTileModal({ title: card.title, description: card.description, dynamicShortDescription: card.dynamicShortDescription || null, rows: card.rows, cardId: card.id, placeholderLabel: card.placeholderLabel, number: card.number, label: card.label, isCapabilityCard: true, vizType: null, recommendation: card.recommendation || null, analyzer: card.analyzer || null, readinessBadge: card.readinessBadge || null });
                }}
              >
                <div className="tile-number">
                  <span className="tile-header-label">{card.title}</span>
                  <span className="tile-mobile-chevron" aria-hidden="true">
                    <svg viewBox="0 0 12 12"><polyline points="2,4 6,8 10,4" /></svg>
                  </span>
                </div>
                {isLocked ? (
                  <div
                    className={`tile-intake-placeholder tile-intake-placeholder-${card.id} tile-intake-placeholder--locked`}
                    aria-label="Locked card"
                  >
                    <span className="tile-intake-lock-overlay">
                      <Lock size={56} strokeWidth={1.25} className="tile-intake-lock-icon" aria-hidden="true" />
                    </span>
                  </div>
                ) : (
                <div
                  className={`tile-intake-placeholder tile-intake-placeholder-${card.id}`}
                  style={card.id === 'style-guide' && sgDisplayData?.colors?.primary?.hex
                    ? { background: `linear-gradient(135deg, ${sgDisplayData.colors.primary.hex}, ${sgDisplayData.colors.secondary?.hex || sgDisplayData.colors.neutral?.hex || '#ddd'})` }
                    : undefined}
                >
                  {card.id === 'brief' && briefPreviewHtml ? (
                    <iframe
                      key={dashboardState?.latestRunId || 'brief-preview'}
                      className="tile-brief-preview"
                      title="Brief preview"
                      srcDoc={briefPreviewHtml}
                      sandbox="allow-same-origin"
                    />
	                  ) : card.id === 'visual-dna' ? (
	                    <div id="visual-dna-card-preview">
	                      <Images size={34} strokeWidth={1.55} aria-hidden="true" />
	                      <span>{clientProspect?.visualDna?.subjects?.length ? `${clientProspect.visualDna.subjects.length} profiles` : 'Reference DNA'}</span>
	                    </div>
	                  ) : card.id === 'style-guide' && hasSgQuadrant ? (
                    <div id="sg-preview-shell" className="sg-preview">
                      {(() => {
                        const sgHead = sgDisplayData?.typography?.headingSystem;
                        const sgBody = sgDisplayData?.typography?.bodySystem;
                        const headName = sanitizeStylePreviewLabel(
                          sgHead?.fontFamily?.split(',')[0].replace(/["']/g, '').trim() || null
                        );
                        return (
                          <>
                            {/* BRAND MARK (top-left) */}
                            <div
                              className="sg-quad sg-q-brand-mark"
                              style={{ background: sgLogoSrc ? (sgDisplayData?.colors?.neutral?.hex || sgDisplayData?.colors?.primary?.hex || '#f0efed') : 'rgba(255, 255, 255, 0.65)' }}
                            >
                              {sgLogoSrc ? (
                                <img
                                  id="sg-brand-mark-img"
                                  src={sgLogoSrc}
                                  alt="Site brand mark"
                                  onError={(e) => { e.currentTarget.style.display = 'none'; const p = e.currentTarget.parentElement; if (p) { const s = document.createElement('span'); s.className = 'sg-no-logo'; s.textContent = 'LOGO'; p.appendChild(s); } }}
                                />
                              ) : (
                                <span className="sg-no-logo">{"LOGO"}</span>
                              )}
                            </div>

                            {/* COLOR (top-right) */}
                            <div className="sg-quad sg-q-color" style={!hasSgColors ? { background: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' } : undefined}>
                              {hasSgColors ? [
                                sgDisplayData.colors.primary,
                                sgDisplayData.colors.secondary,
                                sgDisplayData.colors.tertiary,
                                sgDisplayData.colors.neutral,
                              ].filter(Boolean).map((color, ci) => (
                                <div key={ci} className="sg-swatch" style={{ background: color.hex }} title={color.role} />
                              )) : (
                                <span className="sg-no-data">{"COLOR"}</span>
                              )}
                            </div>

                            {/* TYPE (bottom-left) */}
                            <div
                              className="sg-quad sg-q-type"
                              style={{ background: hasSgType ? (sgDisplayData?.colors?.neutral?.shades?.[0] || sgDisplayData?.colors?.primary?.shades?.[0] || sgDisplayData?.colors?.neutral?.hex || '#faf8f4') : 'rgba(255,255,255,0.65)' }}
                            >
                              {hasSgType && headName ? (
                                <>
                                  <p className="sg-h1" style={{ fontFamily: sgHead?.fontFamily || 'serif' }}>
                                    {headName}
                                  </p>
                                  <p className="sg-p" style={{ fontFamily: sgBody?.fontFamily || 'sans-serif' }}>
                                    The quick brown fox jumps over the lazy dog.
                                  </p>
                                </>
                              ) : (
                                <span className="sg-no-data">{"FONT"}</span>
                              )}
                            </div>

                            {/* GRADIENT (bottom-right) */}
                            <div
                              className="sg-quad sg-q-gradient"
                              style={hasSgColors ? {
                                background: `linear-gradient(135deg, ${sgDisplayData.colors.primary?.hex || '#888'}, ${sgDisplayData.colors.secondary?.hex || sgDisplayData.colors.neutral?.hex || '#ddd'})`,
                              } : { background: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              {!hasSgColors && <span className="sg-no-data">{"GRADIENT"}</span>}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : card.id === 'multi-device-view' && multiDevicePreviewSrc ? (
                    <span className="tile-intake-mockup-wrap">
                      <img
                        className="tile-intake-mockup-image"
                        src={multiDevicePreviewSrc}
                        alt={intakeMockupSrc ? 'Generated multi-device website mockup' : 'Captured website screenshot preview'}
                        onError={() => setIntakeMockupSrc(null)}
                      />
                    </span>
                  ) : card.id === 'audit-summary' ? (
                    renderAuditViz(card.rows, moduleState)
                  ) : card.id === 'seo-performance' && hasSeoAuditData ? (
                    renderSeoViz(seoAudit)
                  ) : card.id === 'agent-readiness' && hasAgentReadinessData ? (
                    renderAgentReadyViz(agentReadinessData, agentReadinessAiSeo)
                  ) : card.id === 'social-preview' && siteMeta?.ogImage ? (
                    <div id="bt-preview-shell">
                      <img
                        id="bt-og-image"
                        src={siteMeta.ogImage}
                        alt={siteMeta.ogImageAlt || ''}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                      {siteMeta.favicon && (
                        <img
                          id="bt-favicon"
                          src={siteMeta.favicon}
                          alt=""
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                    </div>
                  ) : card.id === 'business-model' && homepageScreenshotUrl ? (
                    <div id="bi-preview-shell">
                      <img
                        id="bi-hero-image"
                        src={homepageScreenshotUrl}
                        alt="Homepage screenshot"
                        onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                      />
                    </div>
                  ) : card.id === 'design-evaluation' && moduleState?.['design-evaluation']?.status === 'succeeded' && homepageScreenshotUrl ? (
                    <div id="de-preview-shell">
                      <img
                        id="de-hero-image"
                        src={homepageScreenshotUrl}
                        alt="Homepage screenshot evaluated for design"
                        onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                      />
                    </div>
                  ) : card.id === 'survey-status' ? (
                    <div id="survey-status-avatar-shell">
                      <img
                        id="survey-status-avatar-img"
                        src="/img/profile2_400x400.png"
                        alt="Bryan Balli"
                      />
                      {siteMeta?.favicon && (
                        <img
                          id="survey-status-brand-favicon"
                          src={siteMeta.favicon}
                          alt="Brand"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                    </div>
                  ) : card.id === 'industry' && marketCategoryImageUrl ? (
                    <div id="market-category-card-image-shell" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 'inherit' }}>
                      <img
                        id="market-category-card-image"
                        src={marketCategoryImageUrl}
                        alt={resolvedCategory || 'Market category'}
                        onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', mixBlendMode: 'difference' }}
                      />
                      <span id="market-category-card-label" style={{ position: 'absolute', bottom: 8, left: 10, right: 10, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#fff', pointerEvents: 'none' }}>Market Category</span>
                    </div>
                  ) : card.id === 'industry' ? (
                    <span className="tile-empty-label" id="market-category-shell-label">
                      {card.placeholderLabel}
                    </span>
                  ) : (card.id === 'marketing-brief' || card.id === 'marketing-brief-doc') && marketingBriefPreviewHtml ? (
                    <iframe
                      key={marketingBrief?.generatedAtIso || 'mb-card-preview'}
                      className="tile-brief-preview"
                      title="Marketing brief preview"
                      srcDoc={marketingBriefPreviewHtml}
                      sandbox="allow-same-origin"
                    />
                  ) : (
                    <span className="tile-empty-label">{card.title || card.placeholderLabel}</span>
                  )}
                </div>
                )}
                <div className="tile-intake-body">
                  <h3 className="tile-heading tile-intake-heading">{card.title}</h3>
                  {card.category !== 'services' && (
                    <span className="tile-intake-source-line">
                      Generated {(() => {
                        try {
                          const raw = dashboardState?.updatedAt || dashboardState?.createdAt || dashboardState?.latestRunTimestamp;
                          const ts = raw?.toDate?.() || (raw?.seconds ? new Date(raw.seconds * 1000) : raw);
                          const d = ts ? new Date(ts) : null;
                          if (!d || isNaN(d.getTime())) return '';
                          return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' EST';
                        } catch { return ''; }
                      })()}
                    </span>
                  )}
                  <p className="tile-description tile-intake-description">
                    {isLocked ? (
                      <span className="tile-readiness-tag readiness-locked">
                        STATUS: LOCKED
                      </span>
                    ) : isInactiveUnlocked ? (
                      <span className="tile-readiness-tag readiness-run-modal">
                        STATUS: RUN
                      </span>
                    ) : card.readinessBadge && (
                      <span className={`tile-readiness-tag readiness-${card.readinessBadge.tone}`}>
                        STATUS: {card.readinessBadge.label || 'NEEDS ATTENTION'}
                      </span>
                    )}
                    {' '}
                    {isLocked
                      ? (LOCKED_CARD_DESCRIPTIONS[card.id] || card.description || 'This card will unlock after the previous steps are complete.')
                      : isInactiveUnlocked
                        ? (INACTIVE_CARD_DESCRIPTIONS[card.id] || 'Run this module to populate this card.')
                        : (card.dynamicShortDescription || card.scribeShort || card.description)}
                  </p>
                </div>
                {/* ModuleCardControls removed — footer handles Run/Details */}
                <div className="tile-foot">
                  <span className="tile-foot-status">
                    {(() => {
                      const STATUS_DOT = {
                        succeeded: { dot: '#22c55e', label: 'Active',   glow: '0 0 5px 2px rgba(34,197,94,0.45)' },
                        failed:    { dot: '#ef4444', label: 'Failed',   glow: '0 0 5px 2px rgba(239,68,68,0.45)' },
                        running:   { dot: '#f59e0b', label: 'Running…', glow: '0 0 5px 2px rgba(245,158,11,0.45)' },
                        queued:    { dot: '#f59e0b', label: 'Queued',   glow: '0 0 5px 2px rgba(245,158,11,0.30)' },
                        idle:      { dot: '#6b7280', label: 'Idle',     glow: 'none' },
                        disabled:  { dot: '#6b7280', label: 'Inactive', glow: 'none' },
                        inactive:  { dot: '#6b7280', label: 'Inactive', glow: 'none' },
                      };
                      if (isLocked) {
                        return (
                          <>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: '#6b7280', flexShrink: 0 }} />
                            Locked
                          </>
                        );
                      }
                      if (isInactiveUnlocked) {
                        return (
                          <>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: '#6b7280', flexShrink: 0 }} />
                            RUN
                          </>
                        );
                      }
                      // Leadgen flow cards: drive status from synthetic prospect state, not moduleState.
                      if (card.leadgenStep) {
                        const ok = card.readinessBadge?.tone === 'ok';
                        const meta = ok
                          ? { dot: '#22c55e', label: 'Passed',  glow: '0 0 5px 2px rgba(34,197,94,0.45)' }
                          : { dot: '#6b7280', label: 'Not run', glow: 'none' };
                        return (
                          <>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: meta.dot, boxShadow: meta.glow, flexShrink: 0 }} />
                            {meta.label}
                          </>
                        );
                      }
                      if (card.moduleControls) {
                        let s = moduleState?.[card.id]?.status ?? 'inactive';
                        // multi-device-view: treat succeeded-but-partial (or missing both)
                        // as partial/failed so the status dot reflects actual artifact state.
                        if (card.id === 'multi-device-view') {
                          const hasMockup = Boolean(dashboardState?.artifacts?.homepageDeviceMockup?.downloadUrl);
                          const fp = dashboardState?.artifacts?.fullPageScreenshots || {};
                          const hasFullPages = Boolean(
                            fp['desktop-full']?.downloadUrl || fp['tablet-full']?.downloadUrl || fp['mobile-full']?.downloadUrl
                          );
                          if (s === 'succeeded') {
                            if (!hasMockup && !hasFullPages) s = 'failed';
                            else if (!hasMockup || !hasFullPages) s = 'partial';
                          }
                        }
                        const PARTIAL_META = { dot: '#f59e0b', label: 'Partial', glow: '0 0 5px 2px rgba(245,158,11,0.35)' };
                        const meta = s === 'partial' ? PARTIAL_META : (STATUS_DOT[s] ?? STATUS_DOT.inactive);
                        return (
                          <>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: meta.dot, boxShadow: meta.glow, flexShrink: 0 }} />
                            {meta.label}
                          </>
                        );
                      }
                      if (card.id === 'survey-status') {
                        const SURVEY_STATUS = {
                          complete: { dot: '#22c55e', label: 'Complete',    glow: '0 0 5px 2px rgba(34,197,94,0.45)' },
                          partial:  { dot: '#f59e0b', label: 'In Progress', glow: '0 0 5px 2px rgba(245,158,11,0.45)' },
                          empty:    { dot: '#ef4444', label: 'Not Started', glow: '0 0 5px 2px rgba(239,68,68,0.45)' },
                        };
                        const sMeta = SURVEY_STATUS[card.surveyStatus] ?? SURVEY_STATUS.empty;
                        return (
                          <>
                            <span id="survey-status-dot" style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', background: sMeta.dot, boxShadow: sMeta.glow, flexShrink: 0 }} />
                            {sMeta.label}
                          </>
                        );
                      }
                      return (
                        <>
                          <span className={`power-dot lamp${card.footerLeft !== 'Live' ? ' power-dot-needs-work' : ''}`} />
                          {card.footerRight}
                        </>
                      );
                    })()}
                  </span>
                  <span className="tile-foot-right-group">
                    {card.id === 'brief' && briefPdfUrl && (
                      <a
                        href={briefPdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download="brief.pdf"
                        className="tile-download-btn"
                        onClick={(e) => { e.stopPropagation(); }}
                        aria-label="Download brief PDF"
                      >
                        DL ↓
                      </a>
                    )}
                    {(() => {
                      if (isLocked) return (
                        <button
                          type="button"
                          id={`tile-${card.id}-unlock-btn`}
                          className="tile-foot-rerun-btn tile-foot-unlock-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open('https://calendly.com/bballi/30min', '_blank', 'noopener,noreferrer');
                          }}
                        >
                          UNLOCK
                        </button>
                      );
                      if (card.id === 'survey-status') return null;
                      if (!card.moduleControls) {
                        if (!card.footerAction) return null;
                        return (
                          <button
                            type="button"
                            id={`tile-${card.id}-rerun-btn`}
                            className="tile-foot-rerun-btn"
                            onClick={(e) => { e.stopPropagation(); card.footerAction.onClick?.(e); }}
                            disabled={card.footerAction.loading}
                          >
                            {card.footerAction.loading ? '…' : card.footerAction.label}
                          </button>
                        );
                      }
                      const mStatus = moduleState?.[card.id]?.status ?? 'inactive';
                      const mEnabled = moduleConfig ? (moduleConfig[card.id]?.enabled ?? false) : true;
                      const mLoading = moduleRunLoading[card.id] || moduleToggleLoading[card.id] || false;
                      const tierAllowsRerun = !!moduleConfig?.[card.id]?.allowMultiRun;
                      const mBusy = mStatus === 'running' || mStatus === 'queued';
                      // multi-device-view: Retry activates whenever either artifact
                      // is missing (mockup OR full-page captures), even when the run
                      // reports 'succeeded' at the module level.
                      let mdArtifactsMissing = false;
                      let mdMockupOnlyRetry = false;
                      let mdFullPagesOnlyRetry = false;
                      if (card.id === 'multi-device-view' && (mStatus === 'succeeded' || mStatus === 'failed')) {
                        const hasMockup = Boolean(dashboardState?.artifacts?.homepageDeviceMockup?.downloadUrl);
                        const fp = dashboardState?.artifacts?.fullPageScreenshots || {};
                        const hasFullPages = Boolean(
                          fp['desktop-full']?.downloadUrl || fp['tablet-full']?.downloadUrl || fp['mobile-full']?.downloadUrl
                        );
                        const hs = dashboardState?.artifacts?.homepageScreenshots || {};
                        const hasViewportScreenshots = Boolean(
                          hs.desktop?.downloadUrl || hs.tablet?.downloadUrl || hs.mobile?.downloadUrl
                        );
                        mdArtifactsMissing = !hasMockup || !hasFullPages;
                        // Mockup missing but viewport screenshots are already stored →
                        // retry should skip browserless capture and only rebuild the mockup.
                        mdMockupOnlyRetry = !hasMockup && hasViewportScreenshots;
                        // Mockup present but full-page screenshots are missing →
                        // retry should only re-capture full-page screenshots and
                        // preserve the existing mockup + viewport artifacts.
                        mdFullPagesOnlyRetry = hasMockup && !hasFullPages;
                      }
                      // Any card that hasn't reached STATUS: Passed stays re-runnable so
                      // the user can retry without waiting for a tier unlock. Missing
                      // readinessBadge entirely (e.g. SEO succeeded but with no PSI data
                      // → card is stuck on 'queued') also counts as not-passed — we'd
                      // otherwise leave the button dead with no way forward.
                      const cardNotPassed = !card.readinessBadge || card.readinessBadge.tone !== 'ok';
                      const mIsRetry = mStatus === 'failed' || mdArtifactsMissing || (mStatus === 'succeeded' && cardNotPassed);
                      const mIsRerun = mStatus === 'succeeded' && !mdArtifactsMissing && !cardNotPassed;
                      // Inactive = no config-enabled yet AND never succeeded. RUN here enables + kicks off first run.
                      const mIsInactive = !mEnabled && !mIsRerun && !mBusy && !mdArtifactsMissing && !cardNotPassed;
                      // Retry must work even if moduleConfig.enabled never flipped true
                      // on the server (autoEnable race, legacy client, etc). If the card
                      // has been run but hasn't reached STATUS: Passed, allow retry
                      // regardless of the enabled flag — the onClick forwards autoEnable=true
                      // so the server flips the flag before dispatching.
                      const leadgenPrereqMissing = card.leadgenStep && /^Needs\b/i.test(String(card.footerLeft || ''));
                      const interactive =
                        !mBusy && (mIsInactive || (mEnabled && (mIsRetry || tierAllowsRerun)) || cardNotPassed);
                      let label = mLoading ? '…' : mIsRetry ? 'Retry' : mIsRerun ? 'Re-run' : mIsInactive ? 'RUN' : 'Run';
                      // Leadgen cards aren't tracked in moduleState — derive label from readinessBadge.
                      if (card.leadgenStep && !mLoading) {
                        label = card.readinessBadge?.tone === 'ok' ? 'Re-run' : 'RUN';
                      }
                      return (
                        <button
                          type="button"
                          id={`tile-${card.id}-rerun-btn`}
                          className="tile-foot-rerun-btn"
                          disabled={!interactive || mLoading || leadgenPrereqMissing}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!interactive || leadgenPrereqMissing) return;
                            // Leadgen flow cards run via /api/leadgen/* not the
                            // module pipeline — short-circuit before handleModuleRun.
                            if (card.leadgenStep) { openLeadgenFlow(card.leadgenStep); return; }
                            if (mIsInactive) {
                              // First-run: single call with autoEnable so the
                              // server flips enabled=true and runs in one shot.
                              handleModuleRun(card.id, false, null, true);
                              return;
                            }
                            const retryOptions = mdMockupOnlyRetry
                              ? { skipScreenshots: true }
                              : mdFullPagesOnlyRetry
                              ? { fullPagesOnly: true }
                              : null;
                            // Force=true whenever the card hasn't reached STATUS: Passed
                            // so the server doesn't skip an already-succeeded module.
                            // autoEnable=true when the module isn't yet config-enabled
                            // so the server flips the flag and runs in a single shot.
                            const shouldForce = mIsRerun || mdArtifactsMissing || cardNotPassed;
                            handleModuleRun(card.id, shouldForce, retryOptions, !mEnabled);
                          }}
                        >
                          {label}
                        </button>
                      );
                    })()}
                    {!isLocked && (
                      <button
                        type="button"
                        className={`tile-view-details-btn${isInactiveUnlocked ? ' tile-view-details-btn--disabled' : ''}`}
                        disabled={isInactiveUnlocked}
                        aria-disabled={isInactiveUnlocked}
                        title={isInactiveUnlocked ? 'Run this module first to enable Details.' : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isInactiveUnlocked) return;
                          setActiveTileModal({ title: card.title, description: card.description, dynamicShortDescription: card.dynamicShortDescription || null, rows: card.rows, cardId: card.id, placeholderLabel: card.placeholderLabel, number: card.number, label: card.label, isCapabilityCard: true, vizType: null, recommendation: card.recommendation || null, analyzer: card.analyzer || null, readinessBadge: card.readinessBadge || null });
                        }}
                      >
                          Details ↗
                      </button>
                    )}
                  </span>
                </div>
              </article>
              );
            });
            })()}
          </div>
          </div>{/* end capability-grid-col */}

          {/* Right — filter nav */}
          <div id="capability-nav-col">
            {[
              // { key: 'onboarding', label: 'Data Visualization',      sub: 'Capture & inspect',       icon: ClipboardList,         color: '#7b5fff' },
              { key: 'brief',      label: 'Daily Briefs',            sub: 'Your full report',         icon: ChartColumnIncreasing, color: '#2a2420' },
              { key: 'knowledge',  label: 'Company Brain',           sub: 'Custom data & context',    icon: Database,              color: '#3b82f6' },
              { key: 'growth',     label: 'Marketing Director',      sub: 'SEO, signals & growth',    icon: Settings2,             color: '#10b981' },
              { key: 'content',    label: 'Creative Director',        sub: 'Posts & platforms',        icon: Workflow,               color: '#14b8a6' },
              { key: 'social',     label: 'Social Media Manager',     sub: 'Schedule & publish',       icon: CalendarDays,          color: '#6366f1' },
              { key: 'website',    label: 'Website Developer',        sub: 'Speed & conversion',       icon: LaptopMinimalCheck,    color: '#0ea5e9' },
              { key: 'automation', label: 'Automation & Systems',    sub: 'Scale & automate',         icon: BrainIcon,             color: '#6366f1' },
              { key: 'services',   label: 'Work With Me',            sub: 'Get it done',              icon: MessageSquareMore,     color: '#ec4899' },
              { key: 'leadgen',    label: 'Sales',                    sub: 'Prospect pipeline',        icon: Radar,                 color: '#ff3b30' },
              ...(isAdmin ? [{ key: 'admin', label: 'Admin', sub: 'Email & system', icon: Send, color: '#a855f7' }] : []),
            ].map(({ key, label, sub, icon: NavIcon, color }) => {
              const isLocked = false;
              return (
              <button
                key={key ?? 'all'}
                type="button"
                id={`capability-nav-btn-${key ?? 'all'}`}
                className={`capability-nav-btn${activeCapabilityFilter === key ? ' capability-nav-btn--active' : ''}${isLocked ? ' capability-nav-btn--locked' : ''}`}
                disabled={isLocked}
                onClick={() => {
                  if (key === activeCapabilityFilter) return;
                  const grid = capabilityGridRef.current;
                  if (!grid) { setActiveCapabilityFilter(key); return; }
                  const cards = grid.querySelectorAll('[data-capability-card]');
                  // Skip the fade choreography for leadgen transitions —
                  // the grid is hidden in that view so there are no cards
                  // to animate on either side.
                  if (key === 'leadgen' || activeCapabilityFilter === 'leadgen' || cards.length === 0) {
                    setActiveCapabilityFilter(key);
                    return;
                  }
                  gsap.killTweensOf(cards);
                  gsap.to(cards, {
                    opacity: 0,
                    duration: 0.18,
                    ease: 'power2.in',
                    onComplete: () => {
                      // flushSync forces React to commit new cards to DOM synchronously
                      // so we can immediately query and animate them before first paint
                      flushSync(() => setActiveCapabilityFilter(key));
                      const newCards = grid.querySelectorAll('[data-capability-card]');
                      if (newCards.length) {
                        gsap.fromTo(
                          newCards,
                          { opacity: 0 },
                          { opacity: 1, duration: 0.4, ease: 'power2.out', stagger: 0.08 },
                        );
                      }
                    },
                  });
                }}
              >
                <span className="capability-nav-btn-line" aria-hidden="true" />
                <span className="capability-nav-btn-content">
                  <span className="capability-nav-btn-label">
                    <span className="capability-nav-btn-label-full">{label}</span>
                    <span className="capability-nav-btn-label-short">{label.split(' ')[0]}</span>
                  </span>
                  <span className="capability-nav-btn-sub">{sub}</span>
                </span>
                {NavIcon ? (
                  <span className="capability-nav-btn-icon-wrap" style={{ color }}>
                    <NavIcon size={18} strokeWidth={2} />
                  </span>
                ) : null}
              </button>
              );
            })}
          </div>

          </div>{/* end capability-section-shell */}
        </section>
        </>
        )}

      </main>

      {/* ── Leadgen flow panel (per-client cards: Prepare Brief, etc.) ── */}
      {clientFlowState?.open && user ? (
        <LeadgenModulePanel
          open={clientFlowState.open}
          placeId={clientFlowState.placeId}
          moduleId={clientFlowState.moduleId}
          moduleLabel={clientFlowState.moduleLabel}
          endpoint={clientFlowState.endpoint}
          getIdToken={leadgenFlowGetIdToken}
          onClose={closeLeadgenFlow}
          onDone={() => { /* Phase D will refresh the card body from the synthetic prospect doc */ }}
        />
      ) : null}

      <VisualDnaModal
        open={Boolean(visualDnaProspect)}
        prospect={visualDnaProspect}
        onClose={() => setVisualDnaProspect(null)}
        getIdToken={leadgenFlowGetIdToken}
      />

      {/* ── Intake build modal — unified card: shared top rows + 2-col body (terminal / survey) ── */}
      {hasBrandSystemMounted && user ? (
        <BrandSystemBuildModal
          open={brandSystemBuildOpen}
          onClose={() => setBrandSystemBuildOpen(false)}
          getIdToken={brandSystemGetIdToken}
          apiPath={apiPath}
          onComplete={() => {
            // Refresh dashboardState so brandSystem.masterPrompt is in memory,
            // close the build modal, then surface the Details modal on the
            // MASTER PROMPT tab so the user sees the generated output.
            const openDetails = () => {
              setBrandSystemBuildOpen(false);
              setActiveTileModal({
                cardId: 'brand-system',
                title: 'Brand System',
                description: 'Build a complete brand identity system from your pipeline data. Get creative specs ready to use across any channel or tool.',
                rows: [],
                placeholderLabel: 'PROMPT\nREADY',
                number: 'BG',
                label: 'BRAND SYSTEM',
                isCapabilityCard: true,
                vizType: null,
                recommendation: null,
                analyzer: null,
                readinessBadge: null,
              });
            };
            fetchDashboardBootstrap(user, impersonateId)
              .then((data) => {
                applyBootstrapResponse(data);
                openDetails();
              })
              .catch(() => openDetails());
          }}
        />
      ) : null}

      {showIntakeModal ? (
        <div id="intake-modal-overlay" role="dialog" aria-modal="true" aria-label="Dashboard build in progress">

          {/* Card: auth cardStyle. Survey is always rendered — 2-col layout
              always active so the terminal never sits alone. */}
          <div
            id="intake-modal-card"
            data-with-survey={activeRunIsIntake ? 'true' : 'false'}
            style={{
              position: 'relative',
              zIndex: 2,
              width: '100%',
              maxWidth: '52rem',
              padding: 'clamp(1.25rem, 5vw, 2rem)',
              borderRadius: '10px',
              boxSizing: 'border-box',
              ...internalPageGlassCardStyle,
              background: 'rgba(255, 255, 255, 0.6)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              boxShadow: '0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15)',
              border: '1px solid rgba(255, 255, 255, 0.5)',
            }}
          >

            {/* Brand row — exact auth brandStyle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', justifyContent: 'space-between' }}>
              <img src="/img/sig.png" alt="" aria-hidden="true" style={{ width: '2.75rem', height: 'auto', display: 'block' }} />
              <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
                {activeModuleCard ? 'Updating Dashboard' : 'Client Access'}
              </span>
              {/* Status orb — same shape as auth back button */}
              <span
                id="intake-modal-status-orb"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2.4rem', height: '2.4rem', borderRadius: '999px', background: 'rgba(255,255,255,0.34)', border: '1px solid rgba(42,36,32,0.12)' }}
                aria-hidden="true"
              >
                <span style={{
                  width: '0.46rem', height: '0.46rem', borderRadius: '999px',
                  background: latestRunStatus === 'failed' ? '#D71921' : completionCountdown !== null ? '#4A9E5C' : (latestRunStatus === 'queued' || awaitingSignupProvision) ? '#D4A843' : '#4A9E5C',
                  animation: (isRunActive || awaitingSignupProvision) ? 'status-pulse 1.4s ease-in-out infinite' : 'none',
                }} />
              </span>
            </div>

            {/* Marquee — exact auth titleViewport/Track/titleStyle */}
            <div style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
              <div ref={modalMarqueeTrackRef} style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform' }}>
                {(['a', 'b']).map((k) => (
                  <span key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ margin: 0, flexShrink: 0, color: '#2a2420', fontSize: 'clamp(2rem, 8.5vw, 7rem)', lineHeight: 1, letterSpacing: '-0.04em', fontFamily: '"Doto", "Space Mono", monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {activeModuleCard
                      ? `UPDATING ${activeModuleCard.label}\u00A0\u00A0\u00B7\u00A0\u00A0RUNNING MODULE\u00A0\u00A0\u00B7\u00A0\u00A0`
                      : 'BUILDING YOUR DASHBOARD\u00A0\u00A0\u00B7\u00A0\u00A0PROCESSING WEBSITE\u00A0\u00A0\u00B7\u00A0\u00A0'}
                  </span>
                ))}
              </div>
            </div>

            {/* ── Bottom row: terminal (left) + survey (right) ── */}
            <div id="intake-modal-body">
              <div id="intake-modal-terminal-col">
                <div id="intake-modal-terminal-titlebar">
                  <span className="term-win-dot term-win-dot-close" />
                  <span className="term-win-dot term-win-dot-min" />
                  <span className="term-win-dot term-win-dot-max" />
                  <span id="intake-modal-terminal-title">build.process</span>
                </div>
                <div id="intake-modal-terminal-embed" ref={terminalOutputRef}>
                  {displayedTerminalLines.map((line, i) => (
                    <div key={`tl-${i}`} className={`term-line term-${line.type}`}>
                      <span className="term-pfx">{line.prefix}</span>
                      <span className="term-msg">{line.text}</span>
                      {line.cursor ? <span className="term-caret" /> : null}
                    </div>
                  ))}
                </div>
              </div>

              {activeRunIsIntake && <div id="intake-modal-survey-col" data-resolved={surveyResolved ? 'true' : 'false'}>
                <OnboardingChatModal
                  steps={ONBOARDING_ENTRY_STEPS}
                  initialAnswers={onboardingAnswersSeed || {}}
                  onAnswer={(stepId, value) => postOnboarding({ action: 'answer', stepId, value })}
                  onSkipStep={(stepId) => postOnboarding({ action: 'skipStep', stepId })}
                  onSkipAll={() => postOnboarding({ action: 'skipAll' })}
                  onComplete={() => postOnboarding({ action: 'complete' })}
                  onResolved={() => {
                    postSurveyRevealFiredRef.current = true;
                    flushSync(() => {
                      setSurveyResolved(true);
                      if (latestRunStatus === 'succeeded' && completionCountdown === null) {
                        setCompletionCountdown(3);
                      }
                    });
                  }}
                  pipelineError={latestRunStatus === 'failed' ? (dashboardState?.errorState?.message || currentRun?.error?.message || 'Setup encountered an issue.') : null}
                  retryUrl={reseedUrl}
                  onRetryUrlChange={(v) => { setReseedUrl(v); setReseedError(''); setReseedSuccess(false); }}
                  onRetry={handleReseed}
                  retryLoading={reseedLoading}
                  retryError={reseedError}
                  onClose={() => setIntakeModalDismissed(true)}
                />
                {/* Retry prompt — shows inside the survey chat when pipeline
                    fails. No layout shift; scrolls into view naturally. */}
                {/* Retry prompt removed from here — passed into
                    OnboardingChatModal as a prop so it renders inside the
                    chat message thread, not as a separate block. */}
              </div>}
            </div>

            {/* Footer */}
            <div id="intake-modal-footer">
              <span id="intake-modal-footer-host">
                {client?.normalizedHost
                  || (awaitingSignupProvision && pendingSignupProvision?.websiteUrl
                    ? (() => { try { return new URL(/^https?:\/\//i.test(pendingSignupProvision.websiteUrl) ? pendingSignupProvision.websiteUrl : `https://${pendingSignupProvision.websiteUrl}`).hostname.replace(/^www\./, ''); } catch { return pendingSignupProvision.websiteUrl; } })()
                    : null)
                  || (currentRun?.sourceUrl ? (() => { try { return new URL(currentRun.sourceUrl).hostname.replace(/^www\./, ''); } catch { return currentRun.sourceUrl; } })() : null)
                  || '\u00A0'}
              </span>
              <button
                type="button"
                id="intake-modal-footer-cancel"
                onClick={() => setIntakeModalDismissed(true)}
                aria-label="Close terminal and return to dashboard"
              >[ cancel ]</button>
            </div>

          </div>
        </div>
      ) : null}


      {/* ── Tile detail modal ── */}
      {/* Pricing modal */}
      {showTierModal && (
        <div id="tier-modal-overlay" onClick={() => setShowTierModal(false)}>
          <div id="tier-modal-fullscreen" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              id="tier-modal-close"
              onClick={() => setShowTierModal(false)}
              aria-label="Close"
            >[ ✕ ]</button>
            <iframe
              id="tier-modal-iframe"
              title="Pricing"
              src="/docs/pricing-modal.html"
            />
          </div>
        </div>
      )}

      {showClientEditModal && (
        <div
          id="client-edit-modal-overlay"
          onClick={() => { if (!clientEditLoading) setShowClientEditModal(false); }}
        >
          <div id="client-edit-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              id="client-edit-modal-close"
              onClick={() => { if (!clientEditLoading) setShowClientEditModal(false); }}
              aria-label="Close"
              disabled={clientEditLoading}
            >[ ✕ ]</button>
            <h2 id="client-edit-modal-title">Edit client</h2>
            <p id="client-edit-modal-body">
              Updates the company name shown across this dashboard and the brief.
            </p>
            <label id="client-edit-label" htmlFor="client-edit-input">
              Client name
            </label>
            <input
              id="client-edit-input"
              type="text"
              autoComplete="off"
              value={clientNameInput}
              onChange={(e) => setClientNameInput(e.target.value)}
              disabled={clientEditLoading}
              placeholder="Acme, Inc."
              maxLength={120}
            />
            {clientEditError && (
              <p id="client-edit-modal-error">{clientEditError}</p>
            )}
            <div id="client-edit-modal-actions">
              <button
                type="button"
                id="client-edit-modal-cancel"
                onClick={() => setShowClientEditModal(false)}
                disabled={clientEditLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                id="client-edit-modal-confirm"
                onClick={handleUpdateClientName}
                disabled={clientEditLoading || !clientNameInput.trim() || clientNameInput.trim() === (client?.companyName || '')}
              >
                {clientEditLoading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAccountModal && (
        <div
          id="delete-account-modal-overlay"
          onClick={() => { if (!deleteAccountLoading) setShowDeleteAccountModal(false); }}
        >
          <div id="delete-account-modal" onClick={(e) => e.stopPropagation()}>
            <div id="delete-account-brand-row">
              <img src="/img/sig.png" alt="" aria-hidden="true" id="delete-account-sig" />
              <span id="delete-account-eyebrow">Delete Account</span>
              <button
                type="button"
                id="delete-account-modal-close"
                onClick={() => { if (!deleteAccountLoading) setShowDeleteAccountModal(false); }}
                aria-label="Close"
                disabled={deleteAccountLoading}
              >✕</button>
            </div>

            <h2 id="delete-account-modal-headline">DELETE ACCOUNT</h2>

            <p id="delete-account-modal-copy">
              This permanently removes your Firebase Auth identity, all client data in
              Firestore, and every generated artifact in Storage (screenshots, mockups,
              brief PDFs). This cannot be undone.
            </p>

            <label id="delete-account-confirm-label" htmlFor="delete-account-confirm-input">
              Type <strong>DELETE</strong> to confirm
            </label>
            <input
              id="delete-account-confirm-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              disabled={deleteAccountLoading}
              placeholder="DELETE"
            />
            {deleteAccountError && (
              <p id="delete-account-modal-error">{deleteAccountError}</p>
            )}
            <div id="delete-account-modal-actions">
              <button
                type="button"
                id="delete-account-modal-confirm"
                className="cta-pill-btn"
                onClick={handleDeleteAccount}
                disabled={deleteAccountLoading || deleteConfirmInput.trim().toUpperCase() !== 'DELETE'}
              >
                {deleteAccountLoading ? 'Deleting…' : 'Delete Account'}
              </button>
              <button
                type="button"
                id="delete-account-modal-cancel"
                onClick={() => setShowDeleteAccountModal(false)}
                disabled={deleteAccountLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-page brief overlay */}
      {/* Audit Summary fullscreen modal */}
      {auditFullScreen && (() => {
        const auditCard = intakeCapabilityCards.find((c) => c.id === 'audit-summary');
        const auditRows = auditCard?.rows || [];
        return (
          <div id="audit-fullscreen-overlay" onClick={() => setAuditFullScreen(false)}>
            <div id="audit-fullscreen-container" onClick={(e) => e.stopPropagation()}>
              <div id="audit-fullscreen-header">
                <h2 id="audit-fullscreen-title">Data Stream</h2>
                <button type="button" id="audit-fullscreen-close" onClick={() => setAuditFullScreen(false)}>[ ✕ ]</button>
              </div>
              <div id="audit-fullscreen-rows">
                {auditRows.map((row) => (
                  row.isHeader ? (
                    <div key={row.key} className="tile-detail-row-section-head audit-section-head">
                      <span>{row.label}</span>
                      {row.cardId && (
                        <button
                          type="button"
                          className="audit-section-open-btn"
                          onClick={() => {
                            const targetCard = intakeCapabilityCards.find((c) => c.id === row.cardId);
                            if (!targetCard) return;
                            setAuditFullScreen(false);
                            if (row.cardCategory) setActiveCapabilityFilter(row.cardCategory);
                            setActiveTileModal({ title: targetCard.title, description: targetCard.description, rows: targetCard.rows, cardId: targetCard.id, placeholderLabel: targetCard.placeholderLabel, number: targetCard.number, label: targetCard.label, isCapabilityCard: true, vizType: null, recommendation: null, analyzer: null, readinessBadge: null });
                          }}
                        >
                          ↗ VIEW
                        </button>
                      )}
                    </div>
                  ) : row.isAuditRow ? (
                    <div key={row.key} className={`tile-detail-audit-row${row.isColumnHeader ? ' tile-detail-audit-row--header' : ''}`}>
                      <span className="tile-detail-audit-label">{row.label}</span>
                      <span className="tile-detail-audit-tier">{row.tier}</span>
                      <span className={`tile-detail-audit-status${!row.isColumnHeader ? (row.isUpgrade ? ' audit-upgrade' : row.status === 'Captured' ? ' audit-ok' : ' audit-miss') : ''}`} onClick={row.isUpgrade ? () => setShowTierModal(true) : undefined}>{row.status}</span>
                    </div>
                  ) : (
                    <div key={row.key} className="tile-detail-stat-row">
                      <span className="tile-detail-stat-label">{row.label}</span>
                      <span className="tile-detail-stat-value">{row.value}</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {briefFullScreen && briefPreviewHtml && (
        <div id="brief-fullscreen-overlay" onClick={() => setBriefFullScreen(false)}>
          <div id="brief-fullscreen-container" onClick={(e) => e.stopPropagation()}>
            <div id="brief-fullscreen-actions">
              {briefPdfUrl && (
                <a
                  id="brief-fullscreen-download"
                  href={briefPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download="brief.pdf"
                >↓ Download PDF</a>
              )}
              <button
                type="button"
                id="brief-fullscreen-close"
                onClick={() => setBriefFullScreen(false)}
              >[ ✕ ]</button>
            </div>
            <iframe
              id="brief-fullscreen-iframe"
              title="Daily Brief"
              srcDoc={briefPreviewHtml}
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      )}

      {activeTileModal ? (
        <div
          id="tile-detail-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Tile detail"
          onClick={() => setActiveTileModal(null)}
        >
          <div
            id="tile-detail-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Header strip ── */}
            <div id="tile-detail-modal-header" className="tile-detail-bento-cell">
              <div id="tile-detail-modal-header-main">
                <h2 id="tile-detail-modal-title">{activeTileModal.title}</h2>
              </div>
              <button
                id="tile-detail-modal-close"
                type="button"
                onClick={() => setActiveTileModal(null)}
                aria-label="Close"
              >[ ✕ ]</button>
            </div>

            {/* ── Bento grid ── */}
            <div id="tile-detail-bento-grid">

              {/* Left — visual + about */}
              <div id="tile-detail-bento-image-cell" className="tile-detail-bento-cell">
                <div className={`tile-intake-placeholder tile-intake-placeholder-${activeTileModal.cardId || 'draft-post'} tile-detail-bento-placeholder`}>
                {activeTileModal.cardId === 'style-guide' ? (
                    <div className="sg-preview">
                      {!sgModalDisplayData || sgModalDisplayData?.confidence === 'low' ? (
                        <div className="sg-empty">
                          <span className="sg-empty-label">NO CSS EXTRACTED</span>
                          <span className="sg-empty-msg">{!sgModalDisplayData ? 'Brand Snapshot has no data yet — run the intake pipeline or trigger a re-extraction.' : 'Site may be JS-rendered or stylesheet-free'}</span>
                        </div>
                      ) : (() => {
                        // Mirror the dashboard card shell exactly — same four
                        // quadrants (BRAND MARK / COLOR / TYPE / GRADIENT) so
                        // the modal reads as a zoomed-in version of the card.
                        const sgHead = sgModalDisplayData.typography?.headingSystem;
                        const sgBody = sgModalDisplayData.typography?.bodySystem;
                        const headName = sanitizeStylePreviewLabel(
                          sgHead?.fontFamily?.split(',')[0].replace(/["']/g, '').trim() || null
                        );
                        return (
                          <>
                            {isStyleGuideMock && <span className="sg-demo-watermark">DEMO</span>}
                            {/* BRAND MARK (top-left) */}
                            <div
                              className="sg-quad sg-q-brand-mark"
                              style={{ background: sgModalLogoSrc ? (sgModalDisplayData?.colors?.neutral?.hex || sgModalDisplayData?.colors?.primary?.hex || '#f0efed') : 'rgba(255, 255, 255, 0.65)' }}
                            >
                              {sgModalLogoSrc ? (
                                <img
                                  src={sgModalLogoSrc}
                                  alt="Site brand mark"
                                  onError={(e) => { e.currentTarget.style.display = 'none'; const p = e.currentTarget.parentElement; if (p) { const s = document.createElement('span'); s.className = 'sg-no-logo'; s.textContent = 'LOGO'; p.appendChild(s); } }}
                                />
                              ) : (
                                <span className="sg-no-logo">{"LOGO"}</span>
                              )}
                            </div>

                            {/* COLOR (top-right) */}
                            <div className="sg-quad sg-q-color" style={!hasSgModalColors ? { background: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' } : undefined}>
                              {hasSgModalColors ? [
                                sgModalDisplayData.colors.primary,
                                sgModalDisplayData.colors.secondary,
                                sgModalDisplayData.colors.tertiary,
                                sgModalDisplayData.colors.neutral,
                              ].filter((color) => color?.hex).map((color, ci) => (
                                <div key={ci} className="sg-swatch" style={{ background: color.hex }} title={color.role} />
                              )) : (
                                <span className="sg-no-data">{"COLOR"}</span>
                              )}
                            </div>

                            {/* TYPE (bottom-left) */}
                            <div
                              className="sg-quad sg-q-type"
                              style={{ background: hasSgModalType ? (sgModalDisplayData?.colors?.neutral?.shades?.[0] || sgModalDisplayData?.colors?.primary?.shades?.[0] || sgModalDisplayData?.colors?.neutral?.hex || '#faf8f4') : 'rgba(255,255,255,0.65)' }}
                            >
                              {hasSgModalType && headName ? (
                                <>
                                  <p className="sg-h1" style={{ fontFamily: sgHead?.fontFamily || 'serif' }}>
                                    {headName}
                                  </p>
                                  <p className="sg-p" style={{ fontFamily: sgBody?.fontFamily || 'sans-serif' }}>
                                    The quick brown fox jumps over the lazy dog.
                                  </p>
                                </>
                              ) : (
                                <span className="sg-no-data">{"FONT"}</span>
                              )}
                            </div>

                            {/* GRADIENT (bottom-right) */}
                            <div
                              className="sg-quad sg-q-gradient"
                              style={hasSgModalColors ? {
                                background: `linear-gradient(${sgModalDisplayData.gradient?.angle || '135deg'}, ${sgModalDisplayData.gradient?.from || sgModalDisplayData.colors.primary?.hex || '#888'}, ${sgModalDisplayData.gradient?.to || sgModalDisplayData.colors.secondary?.hex || sgModalDisplayData.colors.neutral?.hex || '#ddd'})`,
                              } : { background: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              {!hasSgModalColors && <span className="sg-no-data">{"GRADIENT"}</span>}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : activeTileModal.cardId === 'multi-device-view' && multiDevicePreviewSrc ? (
                    <img className="tile-intake-mockup-image" src={multiDevicePreviewSrc} alt={intakeMockupSrc ? 'Generated multi-device website mockup' : 'Captured website screenshot preview'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : activeTileModal.cardId === 'social-preview' && siteMeta?.ogImage ? (
                    <div id="bt-preview-shell">
                      <img id="bt-og-image" src={siteMeta.ogImage} alt={siteMeta.ogImageAlt || ''} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      {siteMeta.favicon && <img id="bt-favicon" src={siteMeta.favicon} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                    </div>
                  ) : activeTileModal.cardId === 'audit-summary' ? (
                    renderAuditViz(activeTileModal.rows, moduleState)
                  ) : activeTileModal.cardId === 'seo-performance' && hasSeoAuditData ? (
                    renderSeoViz(seoAudit)
                  ) : activeTileModal.cardId === 'agent-readiness' && hasAgentReadinessData ? (
                    renderAgentReadyViz(agentReadinessData, agentReadinessAiSeo)
                  ) : activeTileModal.cardId === 'business-model' && homepageScreenshotUrl ? (
                    <div id="bi-preview-shell">
                      <img
                        id="bi-hero-image"
                        src={homepageScreenshotUrl}
                        alt="Homepage screenshot"
                        onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                      />
                    </div>
                  ) : activeTileModal.cardId === 'industry' && marketCategoryImageUrl ? (
                    <div id="market-category-modal-image-shell">
                      <img
                        id="market-category-modal-image"
                        src={marketCategoryImageUrl}
                        alt={resolvedCategory || 'Market category'}
                        onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>
                  ) : activeTileModal.cardId === 'newsletter' ? (
                    <span className="tile-empty-label">{activeTileModal.placeholderLabel}</span>
                  ) : activeTileModal.cardId === 'brief' && briefPreviewHtml ? (
                    <iframe
                      key={dashboardState?.latestRunId || 'brief-preview-modal'}
                      className="tile-brief-preview"
                      title="Brief preview"
                      srcDoc={briefPreviewHtml}
                      sandbox="allow-same-origin"
                    />
                  ) : (activeTileModal.cardId === 'marketing-brief' || activeTileModal.cardId === 'marketing-brief-doc') && marketingBriefPreviewHtml ? (
                    <iframe
                      key={marketingBrief?.generatedAtIso || 'mb-modal-preview'}
                      className="tile-brief-preview"
                      title="Marketing brief preview"
                      srcDoc={marketingBriefPreviewHtml}
                      sandbox="allow-same-origin"
                    />
                  ) : activeTileModal.isCapabilityCard ? (
                    <span className="tile-empty-label">{activeTileModal.placeholderLabel}</span>
                  ) : (
                    renderViz(activeTileModal.vizType, countdownHours)
                  )}
                </div>

                {/* About module */}
                <div id="tile-detail-bento-about" className="tile-detail-bento-cell">
                  <h3 className="tile-heading tile-intake-heading">{activeTileModal.title}</h3>
                  <p id="tile-detail-bento-description">
                    {activeTileModal.readinessBadge && (
                      <span className={`tile-readiness-tag readiness-${activeTileModal.readinessBadge.tone}`}>
                        STATUS: {activeTileModal.readinessBadge.label || 'NEEDS ATTENTION'}
                      </span>
                    )}
                    {activeTileModal.readinessBadge ? ' ' : ''}
                    {activeTileModal.cardId === 'audit-summary' && activeTileModal.dynamicShortDescription
                      ? activeTileModal.dynamicShortDescription
                      : activeTileModal.description}
                  </p>
                </div>

              </div>

              {/* Right — content modules */}
              <div id="tile-detail-bento-content">

                {/* Multi-device-view: custom DESKTOP/TABLET/MOBILE tabs */}
                {activeTileModal.cardId === 'multi-device-view' ? (
                  <div className="tile-detail-bento-cell tile-detail-tabbed-container">
                    <div className="tile-detail-tabs">
                      {[
                        { key: 'desktop', label: 'DESKTOP' },
                        { key: 'tablet',  label: 'TABLET' },
                        { key: 'mobile',  label: 'MOBILE' },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`tile-detail-tab${modalTab === key ? ' tile-detail-tab--active' : ''}`}
                          onClick={() => setModalTab(key)}
                        >{label}</button>
                      ))}
                    </div>
                    <div className="tile-detail-tab-content">
                      {['desktop', 'tablet', 'mobile'].map((variant) => (
                        modalTab === variant && (
                          <div key={variant} className="tile-detail-tab-pane" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                            {deviceScreenshots[variant] ? (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 0' }}>
                                  <a
                                    href={deviceScreenshots[variant]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download={`screenshot-${variant}.png`}
                                    style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 10px' }}
                                  >&darr; Download</a>
                                </div>
                                <img
                                  src={deviceScreenshots[variant]}
                                  alt={`${variant} full page screenshot`}
                                  style={{ width: '100%', height: 'auto', borderRadius: 0 }}
                                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                              </>
                            ) : (
                              <span className="tile-empty-label" style={{ padding: '40px 0' }}>{"NO\n" + variant.toUpperCase()}</span>
                            )}
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Admin · Email Digest — view rendered email + analytics, send */}
                {activeTileModal.cardId === 'email-digest' && (
                  <AdminEmailDigestView user={user} />
                )}

                {/* Admin · Email Settings — enable / format / customize summary */}
                {activeTileModal.cardId === 'email-settings' && (
                  <AdminEmailSettingsView user={user} />
                )}

                {/* Admin · Create Client — website-less workspace */}
                {activeTileModal.cardId === 'create-client' && (
                  <AdminCreateClientView user={user} />
                )}

                {/* Survey card — CHAT + DATA tabs */}
                {activeTileModal.cardId === 'survey-status' && (
                  <div
                    id="survey-status-modal-tabs-container"
                    className="tile-detail-bento-cell tile-detail-tabbed-container"
                  >
                    <div className="tile-detail-tabs">
                      <button
                        id="survey-modal-tab-chat"
                        type="button"
                        className={`tile-detail-tab${modalTab === 'chat' ? ' tile-detail-tab--active' : ''}`}
                        onClick={() => setModalTab('chat')}
                      >CHAT</button>
                      <button
                        id="survey-modal-tab-data"
                        type="button"
                        className={`tile-detail-tab${modalTab === 'data' ? ' tile-detail-tab--active' : ''}`}
                        onClick={() => setModalTab('data')}
                      >DATA</button>
                    </div>
                    <div className="tile-detail-tab-content">
                      {modalTab === 'chat' && (
                        <div className="tile-detail-tab-pane" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
                          <OnboardingChatModal
                            key={activeTileModal.cardId}
                            steps={ONBOARDING_ENTRY_STEPS}
                            initialAnswers={onboardingAnswersSeed || {}}
                            onAnswer={(stepId, value) => postOnboarding({ action: 'answer', stepId, value })}
                            onSkipStep={(stepId) => postOnboarding({ action: 'skipStep', stepId })}
                            onSkipAll={() => postOnboarding({ action: 'skipAll' })}
                            onComplete={() => postOnboarding({ action: 'complete' })}
                          />
                        </div>
                      )}
                      {modalTab === 'data' && (
                        <div id="survey-answers-table" className="tile-detail-tab-pane">
                          {ONBOARDING_ENTRY_STEPS.length === 0 ? (
                            <p className="tile-analyzer-solutions-empty">No questions found.</p>
                          ) : (() => {
                            const answers = onboardingAnswersSeed || {};
                            return ONBOARDING_ENTRY_STEPS.map((step) => {
                              const ans = answers[step.id];
                              const rawVal = ans?.value;
                              const displayVal = Array.isArray(rawVal) ? rawVal.join(', ') : (rawVal ?? null);
                              const skipped = ans?.skipped ?? false;
                              return (
                                <div key={step.id} className="tile-detail-stat-row">
                                  <span className="tile-detail-stat-label">{step.title}</span>
                                  <span className="tile-detail-stat-value">
                                    {skipped ? '—' : displayVal != null ? String(displayVal) : <span style={{ opacity: 0.4 }}>Not answered</span>}
                                  </span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Brand System card — MASTER PROMPT + JSON + DATA tabs.
                    The chat / build flow lives in BrandSystemBuildModal,
                    opened from the card's RUN button. */}
                {activeTileModal.cardId === 'brand-system' && (() => {
                  const bsRun = dashboardState?.brandSystem || null;
                  const masterPrompt = bsRun?.masterPrompt || '';
                  const jsonObj = bsRun?.json || null;
                  const sources = bsRun?.sources || {};
                  const hasRun = Boolean(masterPrompt && jsonObj);
                  const emptyState = (label) => (
                    <div className="tile-detail-tab-pane" style={{ padding: 24 }}>
                      <p className="tile-analyzer-solutions-empty" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: 0.7 }}>
                        No {label} yet — click RUN on the Brand System card to scan your pipeline and fill any gaps.
                      </p>
                    </div>
                  );
                  return (
                    <div
                      id="brand-system-modal-tabs-container"
                      className="tile-detail-bento-cell tile-detail-tabbed-container"
                    >
                      <div className="tile-detail-tabs">
                        <button
                          id="brand-system-tab-master-prompt"
                          type="button"
                          className={`tile-detail-tab${modalTab === 'master-prompt' ? ' tile-detail-tab--active' : ''}`}
                          onClick={() => setModalTab('master-prompt')}
                        >MASTER PROMPT</button>
                        <button
                          id="brand-system-tab-json"
                          type="button"
                          className={`tile-detail-tab${modalTab === 'json' ? ' tile-detail-tab--active' : ''}`}
                          onClick={() => setModalTab('json')}
                        >JSON</button>
                        <button
                          id="brand-system-tab-data"
                          type="button"
                          className={`tile-detail-tab${modalTab === 'data' ? ' tile-detail-tab--active' : ''}`}
                          onClick={() => setModalTab('data')}
                        >DATA</button>
                      </div>
                      <div className="tile-detail-tab-content">
                        {modalTab === 'master-prompt' && (
                          hasRun ? (
                            <div id="brand-system-master-prompt-pane" className="tile-detail-tab-pane" style={{ padding: 16 }}>
                              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)', margin: 0 }}>
                                {masterPrompt}
                              </pre>
                            </div>
                          ) : emptyState('master prompt')
                        )}
                        {modalTab === 'json' && (
                          jsonObj ? (
                            <div id="brand-system-json-pane" className="tile-detail-tab-pane" style={{ padding: 16 }}>
                              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5, color: 'var(--text-primary)', margin: 0 }}>
                                {JSON.stringify(jsonObj, null, 2)}
                              </pre>
                            </div>
                          ) : emptyState('json object')
                        )}
                        {modalTab === 'data' && (
                          hasRun ? (
                            <div id="brand-system-data-pane" className="tile-detail-tab-pane">
                              <div className="tile-detail-row-section-head">SOURCES</div>
                              {Object.entries(sources).map(([key, val]) => (
                                <div key={key} className="tile-detail-stat-row">
                                  <span className="tile-detail-stat-label">{key}</span>
                                  <span className="tile-detail-stat-value">{String(val)}</span>
                                </div>
                              ))}
                              <div className="tile-detail-stat-row">
                                <span className="tile-detail-stat-label">Knowledge Base</span>
                                <span className="tile-detail-stat-value">
                                  {summarizeKnowledgeBaseSources(brandSystemKnowledgeBaseSources, 'Available for brand truth')}
                                </span>
                              </div>
                            </div>
                          ) : emptyState('data')
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Client-brief card — BRIEF + DATA tabs (synthetic prospect doc) */}
                {activeTileModal.cardId === 'client-brief' && (() => {
                  const gen = clientProspect?.generation || {};
                  const designMd = gen.designMd || '';
                  let parsed = null;
                  try { parsed = gen.contentJson ? JSON.parse(gen.contentJson) : null; } catch { parsed = null; }
                  const copy = parsed?.copy || {};
                  const colors = parsed?.colors || {};
                  const structure = parsed?.structure || {};
                  return (
                    <div
                      id="client-brief-modal-tabs-container"
                      className="tile-detail-bento-cell tile-detail-tabbed-container"
                    >
                      <div className="tile-detail-tabs">
                        <button type="button" className={`tile-detail-tab${modalTab === 'preview' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('preview')}>BRIEF</button>
                        <button type="button" className={`tile-detail-tab${modalTab === 'data' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('data')}>DATA</button>
                      </div>
                      <div className="tile-detail-tab-content">
                        {modalTab === 'preview' && (
                          <div className="tile-detail-tab-pane" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
                            {designMd ? (
                              <pre
                                style={{
                                  margin: 0, padding: '16px 18px', height: '100%', overflow: 'auto',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                  fontSize: 12, lineHeight: 1.55, color: '#2a2420',
                                  background: '#f8f7f4', border: '1px solid rgba(42,36,32,0.08)', borderRadius: 8,
                                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                }}
                              >{designMd}</pre>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400, gap: 16, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
                                <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>No brief yet</span>
                                <span style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 340 }}>Click RUN on the Prepare Brief card to scrape your website and generate the creative brief.</span>
                              </div>
                            )}
                          </div>
                        )}
                        {modalTab === 'data' && (
                          <div id="client-brief-data-tab" className="tile-detail-tab-pane">
                            {(() => {
                              const dataRows = [
                                { key: 'cb-h1',         isHeader: true, label: 'PROSPECT' },
                                { key: 'cb-d-name',     label: 'Name',          value: clientProspect?.name      || '—' },
                                { key: 'cb-d-website',  label: 'Website',       value: clientProspect?.website   || '—' },
                                { key: 'cb-d-vertical', label: 'Vertical',      value: clientProspect?.vertical  || '—' },
                                { key: 'cb-d-stage',    label: 'Stage',         value: clientProspect?.stage     || '—' },
                                { key: 'cb-d-gen',      label: 'Generated',     value: gen.briefGeneratedAt ? new Date(gen.briefGeneratedAt).toLocaleString() : '—' },
                                { key: 'cb-d-lines',    label: 'Brief size',    value: gen.briefLines ? `${gen.briefLines} lines` : (designMd ? `${designMd.split('\n').length} lines` : '—') },
                                { key: 'cb-d-kb',       label: 'Knowledge Base', value: summarizeKnowledgeBaseSources(gen.knowledgeBaseSources || globalKnowledgeBaseSources, 'Available for offer / proof context') },

                                { key: 'cb-h2',         isHeader: true, label: 'SCRAPED COPY' },
                                { key: 'cb-c-headline', label: 'Hero headline', value: copy.heroHeadline    || '—' },
                                { key: 'cb-c-subhead',  label: 'Subheadline',   value: copy.heroSubheadline || '—' },
                                { key: 'cb-c-tagline',  label: 'Tagline',       value: copy.tagline         || '—' },
                                { key: 'cb-c-services', label: 'Services',      value: (copy.serviceNames?.length ? copy.serviceNames.join(', ') : '—') },
                                { key: 'cb-c-ctas',     label: 'CTA texts',     value: (copy.ctaTexts?.length ? copy.ctaTexts.join(' · ') : '—') },
                                { key: 'cb-c-testim',   label: 'Testimonials',  value: String(copy.testimonials?.length || 0) },
                                { key: 'cb-c-about',    label: 'About text',    value: copy.aboutText ? `${copy.aboutText.slice(0, 120)}${copy.aboutText.length > 120 ? '…' : ''}` : '—' },

                                { key: 'cb-h3',         isHeader: true, label: 'STRUCTURE' },
                                { key: 'cb-s-nav',      label: 'Nav items',     value: (structure.navItems?.length ? structure.navItems.join(' · ') : '—') },
                                { key: 'cb-s-sections', label: 'Sections',      value: String(structure.sectionCount || '—') },

                                { key: 'cb-h4',         isHeader: true, label: 'COLORS' },
                                { key: 'cb-col-prim',   label: 'Primary',       value: colors.primary   || '—' },
                                { key: 'cb-col-sec',    label: 'Secondary',     value: colors.secondary || '—' },
                                { key: 'cb-col-acc',    label: 'Accent',        value: colors.accent    || '—' },

                                { key: 'cb-h5',         isHeader: true, label: 'ASSETS' },
                                { key: 'cb-a-logo',     label: 'Logo',          value: gen.assetManifest?.logo?.url ? 'Found' : '—' },
                                { key: 'cb-a-hero',     label: 'Hero images',   value: String(gen.assetManifest?.heroImages?.length || 0) },
                                { key: 'cb-a-section',  label: 'Section images', value: String(gen.assetManifest?.sectionImages?.length || 0) },
                              ];
                              return dataRows.map((row) =>
                                row.isHeader
                                  ? <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
                                  : (
                                    <div key={row.key} className="tile-detail-stat-row">
                                      <span className="tile-detail-stat-label">{row.label}</span>
                                      <span className="tile-detail-stat-value" style={{ wordBreak: 'break-word' }}>{row.value}</span>
                                    </div>
                                  )
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Client-mockup card — MOCKUP + DATA tabs (synthetic prospect doc) */}
                {activeTileModal.cardId === 'client-mockup' && (() => {
                  const gen = clientProspect?.generation || {};
                  const url = gen.mockupUrl || '';
                  return (
                    <div
                      id="client-mockup-modal-tabs-container"
                      className="tile-detail-bento-cell tile-detail-tabbed-container"
                    >
                      <div className="tile-detail-tabs">
                        <button type="button" className={`tile-detail-tab${modalTab === 'preview' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('preview')}>MOCKUP</button>
                        <button type="button" className={`tile-detail-tab${modalTab === 'data' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('data')}>DATA</button>
                      </div>
                      <div className="tile-detail-tab-content">
                        {modalTab === 'preview' && (
                          <div className="tile-detail-tab-pane" style={{ padding: 0, height: '100%', overflow: 'auto', background: '#f8f7f4', border: '1px solid rgba(42,36,32,0.08)', borderRadius: 8 }}>
                            {url ? (
                              <img src={url} alt="Generated homepage mockup" style={{ display: 'block', width: '100%', height: 'auto' }} />
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400, gap: 16, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
                                <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>No mockup yet</span>
                                <span style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 340 }}>Click RUN on the Generate Mockup card to produce the visual concept from your brief.</span>
                              </div>
                            )}
                          </div>
                        )}
                        {modalTab === 'data' && (
                          <div id="client-mockup-data-tab" className="tile-detail-tab-pane">
                            {(() => {
                              const dataRows = [
                                { key: 'cm-h1',          isHeader: true, label: 'MOCKUP' },
                                { key: 'cm-d-target',    label: 'Target',         value: clientProspect?.website || '—' },
                                { key: 'cm-d-provider',  label: 'Provider',       value: gen.mockupProvider || '—' },
                                { key: 'cm-d-generated', label: 'Generated',      value: gen.mockupGeneratedAt ? new Date(gen.mockupGeneratedAt).toLocaleString() : '—' },
                                { key: 'cm-d-url',       label: 'Storage URL',    value: url ? url : '—' },
                                { key: 'cm-h2',          isHeader: true, label: 'PROMPT' },
                                { key: 'cm-d-prompt',    label: 'Prompt size',    value: gen.mockupPrompt ? `${gen.mockupPrompt.length} chars` : '—' },
                              ];
                              return dataRows.map((row) =>
                                row.isHeader
                                  ? <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
                                  : (
                                    <div key={row.key} className="tile-detail-stat-row">
                                      <span className="tile-detail-stat-label">{row.label}</span>
                                      <span className="tile-detail-stat-value" style={{ wordBreak: 'break-all' }}>{row.value}</span>
                                    </div>
                                  )
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Client-site card — PREVIEW + DATA tabs (synthetic prospect doc) */}
                {activeTileModal.cardId === 'client-site' && (() => {
                  const gen = clientProspect?.generation || {};
                  const previewUrl = gen.previewUrl || '';
                  const cmp = gen.readinessComparison || null;
                  return (
                    <div
                      id="client-site-modal-tabs-container"
                      className="tile-detail-bento-cell tile-detail-tabbed-container"
                    >
                      <div className="tile-detail-tabs">
                        <button type="button" className={`tile-detail-tab${modalTab === 'preview' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('preview')}>PREVIEW</button>
                        <button type="button" className={`tile-detail-tab${modalTab === 'data' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('data')}>DATA</button>
                      </div>
                      <div className="tile-detail-tab-content">
                        {modalTab === 'preview' && (
                          <div className="tile-detail-tab-pane" style={{ padding: 24, height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {previewUrl ? (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, maxWidth: 480, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                                <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.55)' }}>Preview deployed</span>
                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 8,
                                    padding: '12px 20px', borderRadius: 8,
                                    background: '#2a2420', color: '#fff',
                                    fontSize: '0.78rem', letterSpacing: '0.08em', fontWeight: 700, textTransform: 'uppercase',
                                    textDecoration: 'none', boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
                                  }}
                                >Open Preview ↗</a>
                                <span style={{ fontSize: 11, color: 'rgba(42,36,32,0.55)', wordBreak: 'break-all', padding: '8px 12px', background: 'rgba(42,36,32,0.04)', borderRadius: 6 }}>{previewUrl}</span>
                                <span style={{ fontSize: 11, lineHeight: 1.5, color: 'rgba(42,36,32,0.45)', maxWidth: 360 }}>
                                  Vercel preview deployments block iframe embedding by default. Use the link above to view the live site in a new tab.
                                </span>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
                                <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>No site yet</span>
                                <span style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 340 }}>Click RUN on the Generate Site card to produce + deploy the homepage preview.</span>
                              </div>
                            )}
                          </div>
                        )}
                        {modalTab === 'data' && (
                          <div id="client-site-data-tab" className="tile-detail-tab-pane">
                            {(() => {
                              const dataRows = [
                                { key: 'cs-h1',          isHeader: true, label: 'DEPLOYMENT' },
                                { key: 'cs-d-target',    label: 'Target',         value: clientProspect?.website || '—' },
                                { key: 'cs-d-preview',   label: 'Preview URL',    value: previewUrl || '—' },
                                { key: 'cs-d-deployed',  label: 'Deployed',       value: gen.deployedAt ? new Date(gen.deployedAt).toLocaleString() : '—' },
                                { key: 'cs-d-htmlat',    label: 'HTML generated', value: gen.htmlGeneratedAt ? new Date(gen.htmlGeneratedAt).toLocaleString() : '—' },
                                { key: 'cs-d-size',      label: 'HTML size',      value: gen.htmlSizeBytes ? `${(gen.htmlSizeBytes / 1024).toFixed(1)} KB` : '—' },
                                { key: 'cs-d-issues',    label: 'Validation issues', value: Array.isArray(gen.validationIssues) ? `${gen.validationIssues.length}` : '—' },
                                { key: 'cs-d-kb',        label: 'Knowledge Base', value: summarizeKnowledgeBaseSources(gen.knowledgeBaseSources || globalKnowledgeBaseSources, 'Available for offer / FAQ / proof context') },

                                { key: 'cs-h2',          isHeader: true, label: 'AI READINESS' },
                                { key: 'cs-d-before',    label: 'Before',         value: cmp?.before?.score != null ? String(cmp.before.score) : '—' },
                                { key: 'cs-d-after',     label: 'After',          value: cmp?.after?.score  != null ? String(cmp.after.score)  : '—' },
                                { key: 'cs-d-improve',   label: 'Improvement',    value: cmp?.improvement   != null ? `+${cmp.improvement} points` : '—' },

                                { key: 'cs-h3',          isHeader: true, label: 'COST' },
                                { key: 'cs-d-tokens-in', label: 'Input tokens',   value: gen.tokenUsage?.input  != null ? String(gen.tokenUsage.input)  : '—' },
                                { key: 'cs-d-tokens-out',label: 'Output tokens',  value: gen.tokenUsage?.output != null ? String(gen.tokenUsage.output) : '—' },
                                { key: 'cs-d-cost',      label: 'Estimated cost', value: gen.estimatedCostUsd != null ? `$${gen.estimatedCostUsd.toFixed(4)}` : '—' },
                              ];
                              return dataRows.map((row) =>
                                row.isHeader
                                  ? <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
                                  : (
                                    <div key={row.key} className="tile-detail-stat-row">
                                      <span className="tile-detail-stat-label">{row.label}</span>
                                      <span className="tile-detail-stat-value" style={{ wordBreak: 'break-all' }}>{row.value}</span>
                                    </div>
                                  )
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Client-estimate card — ESTIMATE + DATA + MESSAGE tabs */}
                {activeTileModal.cardId === 'client-estimate' && (() => {
                  const gen = clientProspect?.generation || {};
                  const estimate = gen.estimate?.latest || null;
                  const estimateJson = estimate?.estimateJson || null;
                  const html = estimate?.html || '';
                  const pdfUrl = estimate?.pdfArtifact?.downloadUrl || '';
                  const currency = estimateJson?.currency || 'USD';
                  const formatMoney = (value) => {
                    if (value == null) return '—';
                    try {
                      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
                    } catch {
                      return `$${Number(value || 0).toFixed(2)}`;
                    }
                  };
                  return (
                    <div
                      id="client-estimate-modal-tabs-container"
                      className="tile-detail-bento-cell tile-detail-tabbed-container"
                    >
                      <div className="tile-detail-tabs">
                        <button type="button" className={`tile-detail-tab${modalTab === 'estimate' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('estimate')}>ESTIMATE</button>
                        <button type="button" className={`tile-detail-tab${modalTab === 'config' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('config')}>CONFIG</button>
                        <button type="button" className={`tile-detail-tab${modalTab === 'data' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('data')}>DATA</button>
                        <button type="button" className={`tile-detail-tab${modalTab === 'message' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('message')}>MESSAGE</button>
                      </div>
                      <div className="tile-detail-tab-content">
                        {modalTab === 'config' && (
                          <div id="client-estimate-config-tab" className="tile-detail-tab-pane custom-brief-submit-pane">
                            {estimateBriefLoading ? (
                              <p className="tile-analyzer-solutions-empty">Loading estimate config...</p>
                            ) : (
                              <>
                                <section className="mb-config-section">
                                  <div className="mb-config-section-head">
                                    <span className="mb-config-section-index">01</span>
                                    <div>
                                      <h4>Offer and pricing</h4>
                                      <p>Line format: Label | Description | Unit Price | Quantity. Save before running Create Estimate.</p>
                                    </div>
                                    <span className="mb-config-section-status">{parseEstimateLineItems(estimateBriefDraft.lineItemsText).length} item{parseEstimateLineItems(estimateBriefDraft.lineItemsText).length === 1 ? '' : 's'}</span>
                                  </div>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Offer summary</span>
                                    <textarea className="mb-config-textarea" value={estimateBriefDraft.offerSummary || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), offerSummary: e.target.value }))} rows={3} />
                                  </label>
                                  <div className="custom-brief-submit-grid">
                                    <label className="mb-config-field">
                                      <span className="mb-config-label">Pricing model</span>
                                      <select className="mb-config-input" value={estimateBriefDraft.pricingModel || 'line_items'} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), pricingModel: e.target.value }))}>
                                        <option value="line_items">Line items</option>
                                        <option value="fixed">Fixed price</option>
                                        <option value="package">Package</option>
                                        <option value="hourly">Hourly</option>
                                        <option value="tiered">Tiered</option>
                                      </select>
                                    </label>
                                    <label className="mb-config-field">
                                      <span className="mb-config-label">Currency</span>
                                      <input className="mb-config-input" value={estimateBriefDraft.currency || 'USD'} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), currency: e.target.value.toUpperCase().slice(0, 3) }))} />
                                    </label>
                                  </div>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Line items</span>
                                    <textarea className="mb-config-textarea mb-config-textarea--code" value={estimateBriefDraft.lineItemsText || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), lineItemsText: e.target.value }))} rows={7} spellCheck={false} />
                                  </label>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Optional add-ons</span>
                                    <textarea className="mb-config-textarea mb-config-textarea--code" value={estimateBriefDraft.optionalAddOnsText || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), optionalAddOnsText: e.target.value }))} rows={4} spellCheck={false} />
                                  </label>
                                </section>

                                <section className="mb-config-section">
                                  <div className="mb-config-section-head">
                                    <span className="mb-config-section-index">02</span>
                                    <div>
                                      <h4>Scope, terms, and message</h4>
                                      <p>One item per line for scope, exclusions, terms, and payment schedule.</p>
                                    </div>
                                    <span className="mb-config-section-status">Editable</span>
                                  </div>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Timeline</span>
                                    <input className="mb-config-input" value={estimateBriefDraft.timeline || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), timeline: e.target.value }))} />
                                  </label>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Scope</span>
                                    <textarea className="mb-config-textarea" value={estimateBriefDraft.scopeText || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), scopeText: e.target.value }))} rows={5} />
                                  </label>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Exclusions</span>
                                    <textarea className="mb-config-textarea" value={estimateBriefDraft.exclusionsText || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), exclusionsText: e.target.value }))} rows={4} />
                                  </label>
                                  <div className="custom-brief-submit-grid">
                                    <label className="mb-config-field">
                                      <span className="mb-config-label">Terms</span>
                                      <textarea className="mb-config-textarea" value={estimateBriefDraft.termsText || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), termsText: e.target.value }))} rows={4} />
                                    </label>
                                    <label className="mb-config-field">
                                      <span className="mb-config-label">Payment schedule</span>
                                      <textarea className="mb-config-textarea" value={estimateBriefDraft.paymentScheduleText || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), paymentScheduleText: e.target.value }))} rows={4} />
                                    </label>
                                  </div>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Estimate tone</span>
                                    <input className="mb-config-input" value={estimateBriefDraft.estimateTone || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), estimateTone: e.target.value }))} />
                                  </label>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Send message instructions</span>
                                    <textarea className="mb-config-textarea" value={estimateBriefDraft.sendMessageInstructions || ''} onChange={(e) => setEstimateBriefDraft((prev) => ({ ...(prev || {}), sendMessageInstructions: e.target.value }))} rows={3} />
                                  </label>
                                </section>

                                {estimateBriefError && <p className="mb-config-error">{estimateBriefError}</p>}
                                <div className="mb-config-actionbar">
                                  <span className="mb-config-actionbar-note">Saved config is used by the next Create Estimate run.</span>
                                  <div className="mb-config-actionbar-buttons">
                                    <button type="button" className="tile-foot-rerun-btn" onClick={saveEstimateBriefConfig} disabled={estimateBriefSaving}>{estimateBriefSaving ? 'Saving...' : 'Save Config'}</button>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {modalTab === 'estimate' && (
                          <div className="tile-detail-tab-pane" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
                            {html ? (
                              <iframe
                                key={estimate?.versionId || 'estimate-document'}
                                title="Client estimate"
                                srcDoc={html}
                                style={{ width: '100%', height: '100%', minHeight: 620, border: '1px solid rgba(42,36,32,0.08)', borderRadius: 8, background: '#fff' }}
                              />
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400, gap: 16, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
                                <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>No estimate yet</span>
                                <span style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 360 }}>Run Create Estimate after the site preview is generated to produce the client-facing estimate and PDF.</span>
                              </div>
                            )}
                          </div>
                        )}
                        {modalTab === 'data' && (
                          <div id="client-estimate-data-tab" className="tile-detail-tab-pane">
                            {(() => {
                              const proof = estimateJson?.proof || {};
                              const versions = Array.isArray(gen.estimate?.versions) ? gen.estimate.versions : [];
                              const dataRows = [
                                { key: 'ce-h1',          isHeader: true, label: 'ESTIMATE' },
                                { key: 'ce-d-client',    label: 'Client',        value: estimateJson?.clientName || clientProspect?.name || '—' },
                                { key: 'ce-d-version',   label: 'Version',       value: estimate?.versionId || '—' },
                                { key: 'ce-d-generated', label: 'Generated',     value: estimate?.generatedAt ? new Date(estimate.generatedAt).toLocaleString() : '—' },
                                { key: 'ce-d-model',     label: 'Pricing model', value: estimateJson?.pricingModel || '—' },
                                { key: 'ce-d-subtotal',  label: 'Subtotal',      value: formatMoney(estimateJson?.subtotal) },
                                { key: 'ce-d-total',     label: 'Total',         value: formatMoney(estimateJson?.total) },
                                { key: 'ce-d-pdf',       label: 'PDF',           value: pdfUrl ? 'Ready' : (estimate?.pdfWarning?.message || 'Unavailable') },

                                { key: 'ce-h2',          isHeader: true, label: 'PROOF' },
                                { key: 'ce-d-preview',   label: 'Preview URL',   value: proof.previewUrl || gen.previewUrl || '—' },
                                { key: 'ce-d-readiness', label: 'AI Readiness',  value: proof.readinessBefore != null && proof.readinessAfter != null ? `${proof.readinessBefore} → ${proof.readinessAfter}` : '—' },
                                { key: 'ce-d-improve',   label: 'Improvement',   value: proof.readinessImprovement != null ? `+${proof.readinessImprovement} points` : '—' },

                                { key: 'ce-h3',          isHeader: true, label: 'VERSIONING' },
                                { key: 'ce-d-current',   label: 'Current',       value: gen.estimate?.currentVersionId || '—' },
                                { key: 'ce-d-versions',  label: 'Versions',      value: String(versions.length || 0) },
                              ];
                              return (
                                <>
                                  {dataRows.map((row) =>
                                    row.isHeader
                                      ? <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
                                      : (
                                        <div key={row.key} className="tile-detail-stat-row">
                                          <span className="tile-detail-stat-label">{row.label}</span>
                                          <span className="tile-detail-stat-value" style={{ wordBreak: 'break-all' }}>{row.value}</span>
                                        </div>
                                      )
                                  )}
                                  {pdfUrl && (
                                    <a
                                      href={pdfUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      download="estimate.pdf"
                                      className="tile-foot-rerun-btn"
                                      style={{ display: 'inline-flex', marginTop: 14, textDecoration: 'none' }}
                                    >
                                      Download PDF
                                    </a>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}
                        {modalTab === 'message' && (
                          <div id="client-estimate-message-tab" className="tile-detail-tab-pane">
                            {estimateJson?.sendMessage ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                <div className="tile-detail-stat-row">
                                  <span className="tile-detail-stat-label">Subject</span>
                                  <span className="tile-detail-stat-value">{estimateJson.sendMessage.subject || '—'}</span>
                                </div>
                                <pre
                                  style={{
                                    margin: 0, padding: '16px 18px', minHeight: 360, overflow: 'auto',
                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                    fontSize: 12, lineHeight: 1.6, color: '#2a2420',
                                    background: '#f8f7f4', border: '1px solid rgba(42,36,32,0.08)', borderRadius: 8,
                                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                  }}
                                >{estimateJson.sendMessage.body || ''}</pre>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400, gap: 16, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'center', padding: 40 }}>
                                <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>No message yet</span>
                                <span style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 340 }}>The send-ready message is generated with the estimate.</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Submit Custom Brief — admin HTML/PDF publishing */}
                {activeTileModal.cardId === 'submit-custom-brief' && (
                  <div id="submit-custom-brief-panel" className="tile-detail-bento-cell tile-detail-tabbed-container">
                    <div className="tile-detail-tabs">
                      <button type="button" className={`tile-detail-tab${modalTab === 'upload' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('upload')}>UPLOAD HTML</button>
                      <button type="button" className={`tile-detail-tab${modalTab === 'create' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('create')}>CREATE HTML</button>
                      <button type="button" className={`tile-detail-tab${modalTab === 'brain' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('brain')}>CLIENT BRAIN</button>
                      <button type="button" className={`tile-detail-tab${modalTab === 'custom' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('custom')}>SAVED BRIEFS</button>
                    </div>
                    <div className="tile-detail-tab-content">
                      {(modalTab === 'upload' || modalTab === 'create') && (
                        <div className="tile-detail-tab-pane custom-brief-submit-pane">
                          <div className="custom-brief-submit-grid">
                            <label className="mb-config-field">
                              <span className="mb-config-label">Brief title</span>
                              <input
                                className="mb-config-input"
                                value={customBriefDraft.title}
                                onChange={(e) => {
                                  const title = e.target.value;
                                  updateCustomBriefDraft({
                                    title,
                                    briefSlug: customBriefDraft.briefSlug ? customBriefDraft.briefSlug : briefSlugify(title),
                                    knowledgeBaseTitle: customBriefDraft.knowledgeBaseTitle ? customBriefDraft.knowledgeBaseTitle : title,
                                  });
                                }}
                                placeholder="Platform Brief"
                              />
                            </label>
                            <label className="mb-config-field">
                              <span className="mb-config-label">URL slug</span>
                              <input
                                className="mb-config-input"
                                value={customBriefDraft.briefSlug}
                                onChange={(e) => updateCustomBriefDraft({ briefSlug: briefSlugify(e.target.value) })}
                                placeholder="platform"
                              />
                            </label>
                          </div>

                          <label className="mb-config-field">
                            <span className="mb-config-label">OG top label</span>
                            <input
                              className="mb-config-input"
                              value={customBriefDraft.ogLabel}
                              onChange={(e) => updateCustomBriefDraft({ ogLabel: e.target.value })}
                              placeholder="BRYAN BALLI"
                            />
                          </label>

                          <label className="mb-config-field">
                            <span className="mb-config-label">Description</span>
                            <input
                              className="mb-config-input"
                              value={customBriefDraft.description}
                              onChange={(e) => updateCustomBriefDraft({ description: e.target.value })}
                              placeholder="OG meta description and dashboard summary"
                            />
                          </label>

                          <label className="custom-brief-public-toggle">
                            <input
                              type="checkbox"
                              checked={customBriefDraft.hideOgSubhead}
                              onChange={(e) => updateCustomBriefDraft({ hideOgSubhead: e.target.checked })}
                            />
                            <span>Remove subhead from OG image</span>
                          </label>

                          {modalTab === 'upload' ? (
                            <label className="custom-brief-file-drop">
                              <input type="file" accept=".html,text/html" onChange={handleCustomBriefFile} />
                              <span className="custom-brief-file-label">Select HTML File</span>
                              <span className="custom-brief-file-meta">{customBriefDraft.html ? `${customBriefDraft.html.length.toLocaleString()} characters loaded` : 'No file selected'}</span>
                            </label>
                          ) : (
                            <div className="custom-brief-create-actions">
                              <button type="button" className="tile-foot-rerun-btn" onClick={loadCustomBriefStarter}>Use Starter HTML</button>
                            </div>
                          )}

                          <label className="mb-config-field">
                            <span className="mb-config-label">HTML document</span>
                            <textarea
                              className="mb-config-textarea mb-config-textarea--code custom-brief-html-textarea"
                              value={customBriefDraft.html}
                              onChange={(e) => updateCustomBriefDraft({ html: e.target.value })}
                              rows={18}
                              spellCheck={false}
                              placeholder="<!doctype html>..."
                            />
                          </label>

                          <label className="custom-brief-public-toggle">
                            <input
                              type="checkbox"
                              checked={customBriefDraft.public}
                              onChange={(e) => updateCustomBriefDraft({ public: e.target.checked })}
                            />
                            <span>Public URL enabled</span>
                          </label>

                          <label className="custom-brief-public-toggle">
                            <input
                              type="checkbox"
                              checked={customBriefDraft.addToClientBrain}
                              onChange={(e) => updateCustomBriefDraft({ addToClientBrain: e.target.checked })}
                            />
                            <span>Add to Client Brain</span>
                          </label>

                          {customBriefSubmitError && <p className="mb-config-error">{customBriefSubmitError}</p>}
                          {customBriefSubmitSuccess && <p className="custom-brief-submit-success">{customBriefSubmitSuccess}</p>}

                          <div className="mb-config-actionbar">
                            <span className="mb-config-actionbar-note">Saves to the selected client and renders a PDF when Browserless is configured.</span>
                            <div className="mb-config-actionbar-buttons">
                              <button
                                type="button"
                                className="tile-foot-rerun-btn"
                                onClick={submitCustomBrief}
                                disabled={customBriefSaving || !customBriefDraft.html.trim() || !customBriefDraft.title.trim()}
                              >
                                {customBriefSaving ? 'Saving...' : 'Save Brief'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {modalTab === 'brain' && (
                        <div className="tile-detail-tab-pane custom-brief-submit-pane">
                          <section className="mb-config-section">
                            <div className="mb-config-section-head">
                              <span className="mb-config-section-index">KB</span>
                              <div>
                                <h4>Client Brain Ingest</h4>
                                <p>Saved briefs can be embedded into the selected client's knowledge base for questions and downstream pipeline context.</p>
                              </div>
                              <span className="mb-config-section-status">{customBriefDraft.addToClientBrain ? 'Enabled' : 'Skipped'}</span>
                            </div>

                            <label className="custom-brief-public-toggle">
                              <input
                                type="checkbox"
                                checked={customBriefDraft.addToClientBrain}
                                onChange={(e) => updateCustomBriefDraft({ addToClientBrain: e.target.checked })}
                              />
                              <span>Reference this brief in the client brain</span>
                            </label>

                            <label className="mb-config-field">
                              <span className="mb-config-label">Brain title</span>
                              <input
                                className="mb-config-input"
                                value={customBriefDraft.knowledgeBaseTitle}
                                onChange={(e) => updateCustomBriefDraft({ knowledgeBaseTitle: e.target.value })}
                                placeholder={customBriefDraft.title || 'Custom Brief'}
                              />
                            </label>

                            <div className="custom-brief-brain-summary">
                              <span className="custom-brief-brain-pill">
                                HTML {customBriefDraft.html ? `${customBriefDraft.html.length.toLocaleString()} chars` : 'not loaded'}
                              </span>
                              <span className="custom-brief-brain-pill">
                                Saved brain briefs {customBriefs.filter((brief) => brief.addedToClientBrain).length}
                              </span>
                            </div>
                          </section>

                          {customBriefSubmitError && <p className="mb-config-error">{customBriefSubmitError}</p>}
                          {customBriefSubmitSuccess && <p className="custom-brief-submit-success">{customBriefSubmitSuccess}</p>}

                          <div className="mb-config-actionbar">
                            <span className="mb-config-actionbar-note">Ingest saves the brief as a Knowledge Base item and embeds its text for downstream questions and pipeline use.</span>
                            <div className="mb-config-actionbar-buttons">
                              <button
                                type="button"
                                className="tile-foot-rerun-btn"
                                onClick={submitCustomBrief}
                                disabled={customBriefSaving || !customBriefDraft.html.trim() || !customBriefDraft.title.trim()}
                              >
                                {customBriefSaving ? 'Saving...' : 'Save Brief'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {modalTab === 'custom' && (
                        <div className="tile-detail-tab-pane custom-briefs-pane">
                          <div className="custom-briefs-head">
                            <span className="custom-briefs-kicker">Saved Briefs</span>
                            <span className="custom-briefs-count">{customBriefsLoading ? 'Loading' : `${customBriefCount} available`}</span>
                          </div>
                          {customBriefSubmitError && <p className="mb-config-error">{customBriefSubmitError}</p>}
                          {customBriefSubmitSuccess && <p className="custom-brief-submit-success">{customBriefSubmitSuccess}</p>}
                          {customBriefsError ? (
                            <p className="tile-analyzer-solutions-empty">{customBriefsError}</p>
                          ) : customBriefsLoading ? (
                            <p className="tile-analyzer-solutions-empty">Loading custom briefs...</p>
                          ) : hasCustomBriefs ? (
                            <div className="custom-briefs-list">
                              {customBriefs.map((brief) => (
                                <article key={`submit-${brief.id || brief.publicPath}`} className="custom-brief-card">
                                  <div className="custom-brief-card-main">
                                    <span className="custom-brief-card-label">PUBLIC BRIEF</span>
                                    <h4>{brief.title || brief.briefSlug || 'Custom brief'}</h4>
                                    {brief.description && <p>{brief.description}</p>}
                                    <div className="custom-brief-card-meta">
                                      <span>{brief.updatedAt ? new Date(brief.updatedAt).toLocaleString() : 'Imported'}</span>
                                      {brief.sourcePath && <span>{brief.sourcePath}</span>}
                                      {brief.addedToClientBrain ? (
                                        <span>Client Brain - {brief.knowledgeBaseChunkCount || 0} chunks</span>
                                      ) : brief.knowledgeBaseStatus ? (
                                        <span>Client Brain - {brief.knowledgeBaseStatus}</span>
                                      ) : null}
                                      {brief.vercelReadyState && <span>Vercel - {brief.vercelReadyState}</span>}
                                      {brief.vercelUrl && (
                                        <a className="custom-brief-meta-link" href={brief.vercelUrl} target="_blank" rel="noopener noreferrer">
                                          Live Site <ArrowUpRight size={12} strokeWidth={2} />
                                        </a>
                                      )}
                                      {brief.hideOgSubhead && <span>OG subhead hidden</span>}
                                    </div>
                                  </div>
                                  <div className="custom-brief-card-actions">
                                    {brief.publicUrl && (
                                      <a className="custom-brief-open-btn" href={brief.publicUrl} target="_blank" rel="noopener noreferrer">
                                        Open <ArrowUpRight size={16} strokeWidth={2} />
                                      </a>
                                    )}
                                    {brief.ogImageUrl && (
                                      <a className="custom-brief-open-btn" href={brief.ogImageUrl} target="_blank" rel="noopener noreferrer">
                                        OG Image
                                      </a>
                                    )}
                                    {brief.ogImageUrl && (
                                      <a className="custom-brief-open-btn" href={withDownloadParam(brief.ogImageUrl)} download={`${brief.title || brief.briefSlug || 'custom-brief'} OG Image.png`}>
                                        Download OG
                                      </a>
                                    )}
                                    {brief.vercelUrl && (
                                      <a className="custom-brief-open-btn custom-brief-vercel-btn" href={brief.vercelUrl} target="_blank" rel="noopener noreferrer">
                                        Vercel <ArrowUpRight size={16} strokeWidth={2} />
                                      </a>
                                    )}
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        className="custom-brief-open-btn custom-brief-vercel-btn"
                                        onClick={() => launchCustomBriefVercel(brief)}
                                        disabled={customBriefVercelLaunchingId === (brief.id || brief.briefSlug)}
                                      >
                                        {customBriefVercelLaunchingId === (brief.id || brief.briefSlug)
                                          ? 'Launching...'
                                          : brief.vercelUrl ? 'Redeploy' : 'Launch'}
                                      </button>
                                    )}
                                    {(brief.pdfDownloadUrl || brief.pdfUrl) ? (
                                      <a className="custom-brief-open-btn" href={brief.pdfDownloadUrl || brief.pdfUrl} target="_blank" rel="noopener noreferrer" download={brief.pdfFileName || titlePdfFileName(brief.title || brief.briefSlug)}>
                                        PDF ↓
                                      </a>
                                    ) : (
                                      <span className="custom-brief-pdf-empty">No PDF</span>
                                    )}
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        className="custom-brief-open-btn custom-brief-delete-btn"
                                        onClick={() => deleteCustomBrief(brief)}
                                        disabled={customBriefDeletingId === (brief.id || brief.briefSlug)}
                                      >
                                        {customBriefDeletingId === (brief.id || brief.briefSlug) ? 'Deleting...' : 'Delete'}
                                      </button>
                                    )}
                                  </div>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="tile-analyzer-solutions-empty">No custom briefs are saved for this client yet.</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Marketing Brief card — Scout config + launch */}
                {activeTileModal.cardId === 'marketing-brief' && (
                  <div id="marketing-brief-config-panel" className="tile-detail-bento-cell tile-detail-tabbed-container">
                    <div className="tile-detail-tabs">
                      <button type="button" className={`tile-detail-tab${modalTab === 'brief' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('brief')}>BRIEF</button>
                      <button type="button" className={`tile-detail-tab${modalTab === 'custom' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('custom')}>CUSTOM BRIEFS</button>
                      <button type="button" className={`tile-detail-tab${modalTab === 'data' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('data')}>SCOUT CONFIG</button>
                      <button type="button" className={`tile-detail-tab${modalTab === 'preview' ? ' tile-detail-tab--active' : ''}`} onClick={() => setModalTab('preview')}>LATEST OUTPUT</button>
                    </div>
                    <div className="tile-detail-tab-content">
                      {modalTab === 'data' && (
                        <div className="tile-detail-tab-pane">
                          {marketingBriefLoading || !marketingBriefConfig ? (
                            <p className="tile-analyzer-solutions-empty">Loading Scout config...</p>
                          ) : (
                            <div className="mb-config-shell">
                              <div className="mb-config-summary" aria-label="Scout configuration summary">
                                <span className="mb-config-summary-item">
                                  <span className="mb-config-summary-key">Freshness</span>
                                  <span className="mb-config-summary-val">{marketingBriefConfig.freshnessDays || 1}d</span>
                                </span>
                                <span className="mb-config-summary-item">
                                  <span className="mb-config-summary-key">Searches</span>
                                  <span className="mb-config-summary-val">{(marketingBriefConfig.searches || []).filter((row) => row.query).length}</span>
                                </span>
                                <span className="mb-config-summary-item">
                                  <span className="mb-config-summary-key">Sources</span>
                                  <span className="mb-config-summary-val">{(marketingBriefConfig.sourcePlatforms || DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS).length}</span>
                                </span>
                                <span className="mb-config-summary-item">
                                  <span className="mb-config-summary-key">KOLs</span>
                                  <span className="mb-config-summary-val">{String(marketingBriefConfig.kols || '').split(/\n|,/).filter((item) => item.trim()).length}</span>
                                </span>
                                <span className="mb-config-summary-item">
                                  <span className="mb-config-summary-key">Competitors</span>
                                  <span className="mb-config-summary-val">{String(marketingBriefConfig.competitors || '').split(/\n|,/).filter((item) => item.trim()).length}</span>
                                </span>
                                <span className="mb-config-summary-item">
                                  <span className="mb-config-summary-key">Scribe</span>
                                  <span className="mb-config-summary-val">{(marketingBriefConfig.scribeTone || '').trim() ? 'Custom' : 'Default'}</span>
                                </span>
                                <span className="mb-config-summary-item">
                                  <span className="mb-config-summary-key">Guardian</span>
                                  <span className="mb-config-summary-val">{String(marketingBriefConfig.guardianRestrictedPatterns || '').split(/\n/).filter((item) => item.trim()).length} rule{String(marketingBriefConfig.guardianRestrictedPatterns || '').split(/\n/).filter((item) => item.trim()).length === 1 ? '' : 's'}</span>
                                </span>
                              </div>

                              <section className="mb-config-section">
                                <div className="mb-config-section-head">
                                  <span className="mb-config-section-index">01</span>
                                  <div>
                                    <h4>Scout Focus</h4>
                                    <p>Sets the overall research lens before Scout builds the daily market brief.</p>
                                  </div>
                                </div>
                                <label className="mb-config-field">
                                  <span className="mb-config-label">What should Scout care about?</span>
                                  <textarea className="mb-config-textarea" value={marketingBriefConfig.sourceFocus || ''} onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), sourceFocus: e.target.value }))} rows={4} />
                                </label>
                              </section>

                              <section className="mb-config-section">
                                <div className="mb-config-section-head">
                                  <span className="mb-config-section-index">02</span>
                                  <div>
                                    <h4>Source Platforms</h4>
                                    <p>Controls where Scout should look for signals. Ready sources are safe defaults; available sources depend on the social search layer being configured.</p>
                                  </div>
                                </div>
                                <div className="mb-config-platform-grid" role="group" aria-label="Scout source platforms">
                                  {MARKETING_BRIEF_SOURCE_PLATFORMS.map((platform) => {
                                    const selected = (marketingBriefConfig.sourcePlatforms || DEFAULT_MARKETING_BRIEF_SOURCE_PLATFORMS).includes(platform.key);
                                    return (
                                      <button
                                        key={platform.key}
                                        type="button"
                                        className={`mb-config-platform-toggle${selected ? ' is-on' : ''}`}
                                        onClick={() => toggleMarketingBriefSourcePlatform(platform.key)}
                                        aria-pressed={selected}
                                      >
                                        <span className="mb-config-platform-check">{selected ? '✓' : ''}</span>
                                        <span className="mb-config-platform-body">
                                          <span className="mb-config-platform-title">
                                            {platform.label}
                                            <span className={`mb-config-platform-status mb-config-platform-status--${platform.status}`}>{platform.status}</span>
                                          </span>
                                          <span className="mb-config-platform-desc">{platform.description}</span>
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>

                                <div id="mb-config-platform-results" className="mb-config-platform-results" aria-label="Latest results by platform">
                                  <div className="mb-config-platform-results-head">
                                    <span className="mb-config-platform-results-title">Latest results by platform</span>
                                    <span className="mb-config-platform-results-sub">
                                      {marketingBriefRunning
                                        ? 'Scout is running — results will populate when the run completes.'
                                        : marketingBriefHasRunResults
                                          ? 'Counts and samples below come from the latest Scout brief.'
                                          : 'No Scout brief yet. Run the brief to populate per-platform results.'}
                                    </span>
                                  </div>
                                  {marketingBriefSelectedPlatforms.map((key) => {
                                    const meta = MARKETING_BRIEF_SOURCE_PLATFORMS.find((p) => p.key === key) || { key, label: key, status: 'available' };
                                    const bucket = marketingBriefPerPlatformResults[key] || { count: 0, items: [] };
                                    return (
                                      <div key={`mb-platform-result-${key}`} className="mb-config-platform-result-row" data-platform={key}>
                                        <div className="mb-config-platform-result-meta">
                                          <span className="mb-config-platform-result-label">{meta.label}</span>
                                          <span className={`mb-config-platform-status mb-config-platform-status--${meta.status}`}>{meta.status}</span>
                                          <span className="mb-config-platform-result-count">{bucket.count} result{bucket.count === 1 ? '' : 's'}</span>
                                        </div>
                                        {bucket.items.length === 0 ? (
                                          <p className="mb-config-platform-result-empty">
                                            {marketingBriefHasRunResults
                                              ? 'No items attributed to this platform in the latest run.'
                                              : '—'}
                                          </p>
                                        ) : (
                                          <ul className="mb-config-platform-result-list">
                                            {bucket.items.map((item, i) => (
                                              <li key={`mb-platform-result-${key}-${i}`} className="mb-config-platform-result-item">
                                                <div className="mb-config-platform-result-item-head">
                                                  <span className="mb-config-platform-result-item-tag">{item.kind}</span>
                                                  <span className="mb-config-platform-result-item-title">{item.title}</span>
                                                </div>
                                                {item.summary && <p className="mb-config-platform-result-item-summary">{item.summary}</p>}
                                                {item.url && (
                                                  <a className="mb-config-platform-result-item-link" href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </section>

                              <section className="mb-config-section">
                                <div className="mb-config-section-head">
                                  <span className="mb-config-section-index">03</span>
                                  <div>
                                    <h4>Search Plan</h4>
                                    <p>Each row becomes a targeted Scout query. Use the goal to explain why that query matters.</p>
                                  </div>
                                  <button type="button" className="mb-config-mini-btn" onClick={addMarketingBriefSearch}>Add Search</button>
                                </div>
                                <div className="mb-config-search-list">
                                  {(marketingBriefConfig.searches || []).map((row, index) => (
                                    <div key={`mb-search-${index}`} className="mb-config-search-row">
                                      <div className="mb-config-search-meta">
                                        <span className="mb-config-row-dot" aria-hidden="true" />
                                        <span className="mb-config-row-num">{String(index + 1).padStart(2, '0')}</span>
                                      </div>
                                      <label className="mb-config-field mb-config-field--label">
                                        <span className="mb-config-label">Label</span>
                                        <input className="mb-config-input" value={row.label || ''} placeholder="Brand / KOLs / Viral Windows" onChange={(e) => updateMarketingBriefSearch(index, { label: e.target.value })} />
                                      </label>
                                      <label className="mb-config-field mb-config-field--query">
                                        <span className="mb-config-label">Search query</span>
                                        <textarea className="mb-config-textarea mb-config-textarea--compact" value={row.query || ''} placeholder="Terms, handles, competitor names, category phrases..." onChange={(e) => updateMarketingBriefSearch(index, { query: e.target.value })} rows={2} />
                                      </label>
                                      <label className="mb-config-field mb-config-field--goal">
                                        <span className="mb-config-label">Signal Scout should extract</span>
                                        <input className="mb-config-input" value={row.goal || ''} placeholder="Find founder-ready angles, KOL reactions, competitor moves..." onChange={(e) => updateMarketingBriefSearch(index, { goal: e.target.value })} />
                                      </label>
                                      <button type="button" className="mb-config-remove-btn" onClick={() => removeMarketingBriefSearch(index)} disabled={(marketingBriefConfig.searches || []).length <= 1}>Remove</button>
                                    </div>
                                  ))}
                                </div>
                              </section>

                              <section className="mb-config-section">
                                <div className="mb-config-section-head">
                                  <span className="mb-config-section-index">04</span>
                                  <div>
                                    <h4>Watchlists</h4>
                                    <p>Named accounts and competitors are injected into the search strategy and final angle selection.</p>
                                  </div>
                                </div>
                                <div className="mb-config-grid">
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Freshness window in days</span>
                                    <input className="mb-config-input" type="number" min="1" max="30" value={marketingBriefConfig.freshnessDays || 1} onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), freshnessDays: Number(e.target.value || 1) }))} aria-label="Freshness days" />
                                  </label>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">KOLs / handles</span>
                                    <textarea className="mb-config-textarea" placeholder="@handle or name, one per line" value={marketingBriefConfig.kols || ''} onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), kols: e.target.value }))} rows={4} />
                                  </label>
                                  <label className="mb-config-field">
                                    <span className="mb-config-label">Competitors</span>
                                    <textarea className="mb-config-textarea" placeholder="Competitor names, one per line" value={marketingBriefConfig.competitors || ''} onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), competitors: e.target.value }))} rows={4} />
                                  </label>
                                </div>
                              </section>

                              <section className="mb-config-section">
                                <div className="mb-config-section-head">
                                  <span className="mb-config-section-index">05</span>
                                  <div>
                                    <h4>Advanced Scout Instructions</h4>
                                    <p>Controls the judgment layer: what to prioritize, what to ignore, and how to separate live signals from background context.</p>
                                  </div>
                                </div>
                                <label className="mb-config-field">
                                  <span className="mb-config-label">Instruction block</span>
                                  <textarea className="mb-config-textarea" value={marketingBriefConfig.scoutInstructions || ''} onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), scoutInstructions: e.target.value }))} rows={7} />
                                </label>
                              </section>

                              <section className="mb-config-section">
                                <div className="mb-config-section-head">
                                  <span className="mb-config-section-index">06</span>
                                  <div>
                                    <h4>Agent Data Contract</h4>
                                    <p>Defines the structured fields Scout should return for Scribe and Guardian. Edit only when the output shape needs to change.</p>
                                  </div>
                                </div>
                                <label className="mb-config-field">
                                  <span className="mb-config-label">Expected structured output</span>
                                  <textarea className="mb-config-textarea mb-config-textarea--code" value={marketingBriefConfig.agentDataTemplate || ''} onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), agentDataTemplate: e.target.value }))} rows={12} spellCheck={false} />
                                </label>
                              </section>

                              <section id="mb-config-scribe-section" className="mb-config-section">
                                <div className="mb-config-section-head">
                                  <span className="mb-config-section-index">07</span>
                                  <div>
                                    <h4>Scribe Tone &amp; Constraints</h4>
                                    <p>Controls how Scribe writes the founder brief: voice, posture, and the hard rules each output must respect. Used as the voice block when no separate brand-voice doc exists.</p>
                                  </div>
                                </div>
                                <label className="mb-config-field">
                                  <span className="mb-config-label">Scribe tone</span>
                                  <textarea
                                    id="mb-config-scribe-tone"
                                    className="mb-config-textarea"
                                    value={marketingBriefConfig.scribeTone || ''}
                                    onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), scribeTone: e.target.value }))}
                                    rows={6}
                                    placeholder="Tone: sharp, timely, founder-ready..."
                                  />
                                </label>
                                <label className="mb-config-field">
                                  <span className="mb-config-label">Hard constraints (one per line)</span>
                                  <textarea
                                    id="mb-config-scribe-hard-constraints"
                                    className="mb-config-textarea"
                                    value={marketingBriefConfig.scribeHardConstraints || ''}
                                    onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), scribeHardConstraints: e.target.value }))}
                                    rows={7}
                                    placeholder={"Every piece connects to Scout's priority action\nNever fabricate competitor activity\n..."}
                                  />
                                </label>
                              </section>

                              <section id="mb-config-guardian-section" className="mb-config-section">
                                <div className="mb-config-section-head">
                                  <span className="mb-config-section-index">08</span>
                                  <div>
                                    <h4>Guardian Rules</h4>
                                    <p>Guides Guardian&apos;s QA pass: what the reviewer should know about the brand, and any words or phrases that should be flagged as off-brand or risky.</p>
                                  </div>
                                </div>
                                <label className="mb-config-field">
                                  <span className="mb-config-label">Reviewer context</span>
                                  <textarea
                                    id="mb-config-guardian-context"
                                    className="mb-config-textarea"
                                    value={marketingBriefConfig.guardianReviewerContext || ''}
                                    onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), guardianReviewerContext: e.target.value }))}
                                    rows={4}
                                    placeholder="Brand positioning, audience, and what Guardian should care about most."
                                  />
                                </label>
                                <label className="mb-config-field">
                                  <span className="mb-config-label">Restricted phrases / patterns (one per line)</span>
                                  <textarea
                                    id="mb-config-guardian-patterns"
                                    className="mb-config-textarea"
                                    value={marketingBriefConfig.guardianRestrictedPatterns || ''}
                                    onChange={(e) => setMarketingBriefConfig((prev) => ({ ...(prev || {}), guardianRestrictedPatterns: e.target.value }))}
                                    rows={5}
                                    placeholder={"revolutionary\ngame-changer\nguaranteed returns\n..."}
                                  />
                                </label>
                              </section>

                              {marketingBriefError && <p className="mb-config-error">{marketingBriefError}</p>}

                              <div className="mb-config-actionbar">
                                <span className="mb-config-actionbar-note">Save updates before running, or Run Brief to save and launch Scout immediately.</span>
                                <div className="mb-config-actionbar-buttons">
                                  <button type="button" className="tile-foot-rerun-btn" onClick={saveMarketingBriefConfig} disabled={marketingBriefSaving}>{marketingBriefSaving ? 'Saving...' : 'Save Config'}</button>
                                  <button type="button" className="tile-foot-rerun-btn" onClick={runMarketingBrief} disabled={marketingBriefRunning || marketingBriefSaving}>{marketingBriefRunning ? 'Running...' : 'Run Brief'}</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {modalTab === 'custom' && (
                        <div className="tile-detail-tab-pane custom-briefs-pane">
                          <div className="custom-briefs-head">
                            <span className="custom-briefs-kicker">Imported Briefs</span>
                            <span className="custom-briefs-count">{customBriefsLoading ? 'Loading' : `${customBriefCount} available`}</span>
                          </div>
                          {customBriefSubmitError && <p className="mb-config-error">{customBriefSubmitError}</p>}
                          {customBriefSubmitSuccess && <p className="custom-brief-submit-success">{customBriefSubmitSuccess}</p>}
                          {customBriefsError ? (
                            <p className="tile-analyzer-solutions-empty">{customBriefsError}</p>
                          ) : customBriefsLoading ? (
                            <p className="tile-analyzer-solutions-empty">Loading custom briefs...</p>
                          ) : hasCustomBriefs ? (
                            <div className="custom-briefs-list">
                              {customBriefs.map((brief) => (
                                <article key={brief.id || brief.publicPath} className="custom-brief-card">
                                  <div className="custom-brief-card-main">
                                    <span className="custom-brief-card-label">PUBLIC BRIEF</span>
                                    <h4>{brief.title || brief.briefSlug || 'Custom brief'}</h4>
                                    {brief.description && <p>{brief.description}</p>}
                                    <div className="custom-brief-card-meta">
                                      <span>{brief.updatedAt ? new Date(brief.updatedAt).toLocaleString() : 'Imported'}</span>
                                      {brief.sourcePath && <span>{brief.sourcePath}</span>}
                                      {brief.addedToClientBrain ? (
                                        <span>Client Brain - {brief.knowledgeBaseChunkCount || 0} chunks</span>
                                      ) : brief.knowledgeBaseStatus ? (
                                        <span>Client Brain - {brief.knowledgeBaseStatus}</span>
                                      ) : null}
                                      {brief.vercelReadyState && <span>Vercel - {brief.vercelReadyState}</span>}
                                      {brief.vercelUrl && (
                                        <a className="custom-brief-meta-link" href={brief.vercelUrl} target="_blank" rel="noopener noreferrer">
                                          Live Site <ArrowUpRight size={12} strokeWidth={2} />
                                        </a>
                                      )}
                                      {brief.hideOgSubhead && <span>OG subhead hidden</span>}
                                    </div>
                                  </div>
                                  <div className="custom-brief-card-actions">
                                    {brief.publicUrl && (
                                      <a className="custom-brief-open-btn" href={brief.publicUrl} target="_blank" rel="noopener noreferrer">
                                        Open Brief <ArrowUpRight size={16} strokeWidth={2} />
                                      </a>
                                    )}
                                    {brief.ogImageUrl && (
                                      <a className="custom-brief-open-btn" href={brief.ogImageUrl} target="_blank" rel="noopener noreferrer">
                                        OG Image
                                      </a>
                                    )}
                                    {brief.ogImageUrl && (
                                      <a className="custom-brief-open-btn" href={withDownloadParam(brief.ogImageUrl)} download={`${brief.title || brief.briefSlug || 'custom-brief'} OG Image.png`}>
                                        Download OG
                                      </a>
                                    )}
                                    {brief.vercelUrl && (
                                      <a className="custom-brief-open-btn custom-brief-vercel-btn" href={brief.vercelUrl} target="_blank" rel="noopener noreferrer">
                                        Vercel <ArrowUpRight size={16} strokeWidth={2} />
                                      </a>
                                    )}
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        className="custom-brief-open-btn custom-brief-vercel-btn"
                                        onClick={() => launchCustomBriefVercel(brief)}
                                        disabled={customBriefVercelLaunchingId === (brief.id || brief.briefSlug)}
                                      >
                                        {customBriefVercelLaunchingId === (brief.id || brief.briefSlug)
                                          ? 'Launching...'
                                          : brief.vercelUrl ? 'Redeploy' : 'Launch'}
                                      </button>
                                    )}
                                    {(brief.pdfDownloadUrl || brief.pdfUrl) ? (
                                      <a className="custom-brief-open-btn" href={brief.pdfDownloadUrl || brief.pdfUrl} target="_blank" rel="noopener noreferrer" download={brief.pdfFileName || titlePdfFileName(brief.title || brief.briefSlug)}>
                                        PDF ↓
                                      </a>
                                    ) : (
                                      <span className="custom-brief-pdf-empty">No PDF</span>
                                    )}
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        className="custom-brief-open-btn custom-brief-delete-btn"
                                        onClick={() => deleteCustomBrief(brief)}
                                        disabled={customBriefDeletingId === (brief.id || brief.briefSlug)}
                                      >
                                        {customBriefDeletingId === (brief.id || brief.briefSlug) ? 'Deleting...' : 'Delete'}
                                      </button>
                                    )}
                                  </div>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="tile-analyzer-solutions-empty">No custom briefs are imported for this client yet.</p>
                          )}
                        </div>
                      )}
                      {modalTab === 'brief' && (
                        <div id="marketing-brief-modal-doc-pane" className="tile-detail-tab-pane" style={{ padding: 0, height: '100%', minHeight: '70vh', overflow: 'hidden', display: 'flex' }}>
                          {marketingBriefPreviewHtml ? (
                            <iframe
                              id="marketing-brief-modal-iframe"
                              key={marketingBrief?.generatedAtIso || dashboardState?.modules?.['marketing-brief']?.lastRunId || 'marketing-brief-document'}
                              title="Marketing brief document"
                              srcDoc={marketingBriefPreviewHtml}
                              sandbox="allow-same-origin"
                              style={{ flex: 1, width: '100%', minHeight: '70vh', border: 'none', background: '#fff', borderRadius: '8px' }}
                            />
                          ) : (
                            <p className="tile-analyzer-solutions-empty">Run the Marketing Brief card to generate the designed founder brief.</p>
                          )}
                        </div>
                      )}
                      {modalTab === 'preview' && (
                        <div className="tile-detail-tab-pane">
                          {[
                            ['Priority', marketingBrief?.headline || dashboardState?.headline],
                            ['Scout Brief', marketingBrief?.scoutBrief?.humanBrief],
                            ['X Post', marketingBrief?.content?.x_post || dashboardState?.summaryCards?.find((c) => c.type === 'content_post')?.value],
                            ['Thread Opener', marketingBrief?.content?.x_thread_opener || dashboardState?.summaryCards?.find((c) => c.type === 'thread_opener')?.value],
                            ['Content Angle', marketingBrief?.content?.content_angle || dashboardState?.summaryCards?.find((c) => c.type === 'content_angle')?.value],
                            ['KOLs', marketingScoutAgentData?.kolActivity?.map((item) => item.name || item.content).filter(Boolean).slice(0, 3).join(' · ')],
                            ['Viral Windows', marketingScoutAgentData?.viralOpportunities?.opportunities?.map((item) => item.conversation || item.injectionAngle).filter(Boolean).slice(0, 3).join(' · ')],
                            ['Guardian', marketingBrief?.guardianFlags?.readyToPublish === undefined ? null : (marketingBrief.guardianFlags.readyToPublish ? 'Ready to publish' : 'Needs review')],
                          ].map(([label, value]) => (
                            <div key={label} className="tile-detail-stat-row">
                              <span className="tile-detail-stat-label">{label}</span>
                              <span className="tile-detail-stat-value">{value || 'No output yet'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Brief Document card — formatted founder brief viewer */}
                {activeTileModal.cardId === 'marketing-brief-doc' && (
                  <div id="marketing-brief-doc-modal-panel" className="tile-detail-bento-cell tile-detail-tabbed-container">
                    <div className="tile-detail-tabs">
                      <button type="button" className="tile-detail-tab tile-detail-tab--active">BRIEF</button>
                    </div>
                    <div className="tile-detail-tab-content">
                      <div id="marketing-brief-doc-tab-pane" className="tile-detail-tab-pane" style={{ padding: 0, height: '100%', minHeight: '70vh', overflow: 'hidden', display: 'flex' }}>
                        {marketingBriefPreviewHtml ? (
                          <iframe
                            id="marketing-brief-doc-iframe"
                            key={marketingBrief?.generatedAtIso || dashboardState?.modules?.['marketing-brief']?.lastRunId || 'marketing-brief-doc'}
                            title="Brief document"
                            srcDoc={marketingBriefPreviewHtml}
                            sandbox="allow-same-origin"
                            style={{ flex: 1, width: '100%', minHeight: '70vh', border: 'none', background: '#fff', borderRadius: '8px' }}
                          />
                        ) : (
                          <p className="tile-analyzer-solutions-empty">Run the Marketing Brief agent to generate the document.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Social Media Posting card — X composer + queue */}
                {activeTileModal.cardId === 'social-media-posting' && (
                  <div id="social-posting-modal-panel" className="tile-detail-bento-cell tile-detail-tabbed-container">
                    <div className="tile-detail-tabs">
                      <button type="button" className="tile-detail-tab tile-detail-tab--active">X PUBLISHING</button>
                    </div>
                    <div className="tile-detail-tab-content">
                      <div className="tile-detail-tab-pane">
                        <SocialPostingPanel
                          getIdToken={brandSystemGetIdToken}
                          sourceDraft={socialGeneratedDraft}
                          sourceLabel={hasSocialGeneratedDraft ? 'creative-builder' : 'manual'}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Strategy Builder card */}
                {activeTileModal.cardId === 'strategy-builder' && (
                  <div id="strategy-builder-modal-panel" className="tile-detail-bento-cell tile-detail-tabbed-container">
                    <StrategyBuilderCard
                      bootstrap={bootstrap}
                      getIdToken={brandSystemGetIdToken}
                      onOpenCard={(cardId) => {
                        const c = intakeCapabilityCards.find((x) => x.id === cardId);
                        if (!c) return;
                        setActiveTileModal({
                          title: c.title,
                          description: c.description,
                          rows: c.rows,
                          cardId: c.id,
                          placeholderLabel: c.placeholderLabel,
                          number: c.number,
                          label: c.label,
                          isCapabilityCard: true,
                          vizType: null,
                          recommendation: c.recommendation || null,
                          analyzer: c.analyzer || null,
                          readinessBadge: c.readinessBadge || null,
                        });
                      }}
                      onOpenSocialPosting={() => {
                        setActiveTileModal({
                          title: 'Social Media Posting',
                          description: 'Compose, optimize, schedule, and post to X/Twitter.',
                          cardId: 'social-media-posting',
                          isCapabilityCard: true,
                          vizType: null,
                        });
                      }}
                    />
                  </div>
                )}

                {/* Knowledge Base card */}
                {activeTileModal.cardId === 'knowledge-base' && (
                  <div
                    id="knowledge-base-modal-panel"
                    className="tile-detail-bento-cell tile-detail-tabbed-container"
                    style={{ overflowY: 'auto', minHeight: 0 }}
                  >
                    <KnowledgeBaseCard getIdToken={brandSystemGetIdToken} />
                  </div>
                )}

                {/* Market Category card — auto-detect + user override */}
                {activeTileModal.cardId === 'industry' && (
                  <div id="market-category-modal-panel" className="tile-detail-bento-cell tile-detail-tabbed-container">
                    <div className="tile-detail-tabs">
                      <button
                        type="button"
                        className={`tile-detail-tab${modalTab === 'report' ? ' tile-detail-tab--active' : ''}`}
                        onClick={() => setModalTab('report')}
                      >REPORT</button>
                      <button
                        type="button"
                        className={`tile-detail-tab${modalTab === 'category' ? ' tile-detail-tab--active' : ''}`}
                        onClick={() => setModalTab('category')}
                      >CATEGORY</button>
                      <button
                        type="button"
                        className={`tile-detail-tab${modalTab === 'data' ? ' tile-detail-tab--active' : ''}`}
                        onClick={() => setModalTab('data')}
                      >DATA</button>
                    </div>
                    <div className="tile-detail-tab-content">
                      {modalTab === 'report' && (
                        <TileDetailAnalysisContent
                          modalTab={modalTab}
                          activeTileModal={activeTileModal}
                          client={client}
                          styleGuideData={styleGuideData}
                          analyzerOutputs={analyzerOutputs}
                          dashboardState={dashboardState}
                          siteMeta={siteMeta}
                          seoAudit={seoAudit}
                        />
                      )}
                      {modalTab === 'category' && (
                        <div className="tile-detail-tab-pane">
                        <MarketCategoryPanel
                          bootstrap={bootstrap}
                          getIdToken={brandSystemGetIdToken}
                          onSaved={(mc) => {
                            setBootstrap((prev) => ({
                              ...prev,
                              dashboardState: {
                                ...(prev?.dashboardState || {}),
                                marketCategory: mc && typeof mc === 'object' ? mc : { value: String(mc || '') },
                              },
                            }));
                          }}
                        />
                        </div>
                      )}
                      {modalTab === 'data' && (
                        <div id="market-category-data-tab" className="tile-detail-tab-pane">
                          {activeTileModal.rows.map((row) => (
                            row.isHeader ? <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
                            : (
                              <div key={row.key} className={`tile-detail-stat-row${row.isFailing ? ' tile-detail-stat-row--flag' : ''}`}>
                                <span className="tile-detail-stat-label">{row.label}</span>
                                <span className="tile-detail-stat-value">{row.value}</span>
                              </div>
                            )
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Newsletter card — PREVIEW + DATA tabs */}
                {activeTileModal.cardId === 'newsletter' && (
                  <div
                    id="newsletter-modal-tabs-container"
                    className="tile-detail-bento-cell tile-detail-tabbed-container"
                  >
                    <div className="tile-detail-tabs">
                      <button
                        type="button"
                        className={`tile-detail-tab${modalTab === 'preview' ? ' tile-detail-tab--active' : ''}`}
                        onClick={() => setModalTab('preview')}
                      >NEWSLETTER</button>
                      <button
                        type="button"
                        className={`tile-detail-tab${modalTab === 'data' ? ' tile-detail-tab--active' : ''}`}
                        onClick={() => setModalTab('data')}
                      >DETAILS</button>
                    </div>
                    <div className="tile-detail-tab-content">
                      {modalTab === 'preview' && (
                        <div className="tile-detail-tab-pane" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
                          {newsletterPreviewHtml ? (
                            <iframe
                              key="newsletter-preview-tab"
                              title="Newsletter email preview"
                              srcDoc={newsletterPreviewHtml}
                              sandbox="allow-same-origin"
                              style={{ width: '100%', height: '100%', minHeight: '500px', border: 'none', borderRadius: '8px', background: '#f8f7f4' }}
                            />
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '400px', gap: '16px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'center', padding: '40px' }}>
                              <span style={{ fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 }}>Newsletter Preview</span>
                              <span style={{ fontSize: '13px', lineHeight: '1.6', maxWidth: '340px' }}>
                                No newsletter has been generated yet. Run the Scout pipeline to generate intelligence, then the newsletter will be auto-generated from that data.
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      {modalTab === 'data' && (
                        <div id="newsletter-data-tab" className="tile-detail-tab-pane">
                          {(() => {
                            const nl = dashboardState?.newsletter;
                            if (!nl?.content) {
                              return <p className="tile-analyzer-solutions-empty">No newsletter data available yet.</p>;
                            }
                            const dataRows = [
                              { key: 'nl-header',    isHeader: true, label: 'NEWSLETTER OUTPUT' },
                              { key: 'nl-status',    label: 'Status',           value: nl.status || 'generated' },
                              { key: 'nl-alert',     label: 'Alert Level',      value: nl.alertLevel || '—' },
                              { key: 'nl-scout-ts',  label: 'Scout Brief',      value: nl.scoutBriefTimestamp || '—' },
                              { key: 'nl-timestamp', label: 'Generated',        value: nl.timestamp || '—' },
                              { key: 'nl-sections',  isHeader: true, label: 'SECTIONS' },
                              { key: 'nl-hero',      label: 'Hero Story',       value: nl.content.hero_story ? `${nl.content.hero_story.length} chars` : 'Empty' },
                              { key: 'nl-hits',      label: 'Quick Hits',       value: nl.content.quick_hits ? `${nl.content.quick_hits.length} chars` : 'Empty' },
                              { key: 'nl-metrics',   label: 'Metrics Snapshot', value: nl.content.metrics_snapshot ? `${nl.content.metrics_snapshot.length} chars` : 'Empty' },
                              { key: 'nl-upcoming',  label: 'On the Radar',     value: nl.content.upcoming ? `${nl.content.upcoming.length} chars` : 'Empty' },
                              { key: 'nl-cta',       label: 'This Week\'s Move', value: nl.content.cta ? `${nl.content.cta.length} chars` : 'Empty' },
                            ];
                            return dataRows.map((row) =>
                              row.isHeader
                                ? <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
                                : (
                                  <div key={row.key} className="tile-detail-stat-row">
                                    <span className="tile-detail-stat-label">{row.label}</span>
                                    <span className="tile-detail-stat-value">{row.value}</span>
                                  </div>
                                )
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Shared REPORT / SOLUTIONS / PROBLEMS / DATA tabs for standard cards */}
                {!CUSTOM_DETAIL_CARD_IDS.has(activeTileModal.cardId) ? (
                  <div
                    id={`${activeTileModal.cardId}-analyzer-findings`}
                    className="tile-detail-bento-cell tile-detail-tabbed-container"
                  >
                    <div className="tile-detail-tabs">
                      {(() => {
                        const tabs = [
                          { key: 'report', label: 'REPORT' },
                          ...(activeTileModal.analyzer ? [
                            { key: 'solutions', label: 'SOLUTIONS' },
                            { key: 'problems', label: 'PROBLEMS' },
                          ] : []),
                          { key: 'data', label: 'DATA' },
                        ];
                        return tabs.map(({ key, label }) => (
                          <button
                            key={key}
                            type="button"
                            className={`tile-detail-tab${modalTab === key ? ' tile-detail-tab--active' : ''}`}
                            onClick={() => setModalTab(key)}
                          >{label}</button>
                        ));
                      })()}
                    </div>
                    <div className="tile-detail-tab-content">
                      {['report', 'solutions', 'problems'].includes(modalTab) && (
                        <TileDetailAnalysisContent
                          modalTab={modalTab}
                          activeTileModal={activeTileModal}
                          client={client}
                          styleGuideData={styleGuideData}
                          analyzerOutputs={analyzerOutputs}
                          dashboardState={dashboardState}
                          siteMeta={siteMeta}
                          seoAudit={seoAudit}
                        />
                      )}

                      {modalTab === 'data' && (
                        <div id="tile-detail-bento-rows">
                          {activeTileModal.cardId === 'style-guide' && (
                            <div className="brand-snapshot-editor">
                              <div className="tile-detail-row-section-head">BRAND SNAPSHOT OVERRIDES</div>
                              <p className="brand-snapshot-editor-note">
                                Edit the four Brand Snapshot quadrants here. Saving updates the shared style guide used by the Brief, Design Evaluation, Brand System, and downstream content generation.
                              </p>
                              <section className="brand-snapshot-editor-section">
                                <div className="brand-snapshot-editor-section-title">01 · Brand Mark</div>
                                <div className="brand-snapshot-editor-grid">
                                  <label className="brand-snapshot-field">
                                    <span>Logo URL or uploaded mark</span>
                                    <input
                                      className="brand-snapshot-input"
                                      value={brandSnapshotDraft.brandMark.logoUrl}
                                      onChange={(e) => updateBrandSnapshotDraft(['brandMark', 'logoUrl'], e.target.value)}
                                      placeholder="https://... or upload below"
                                    />
                                  </label>
                                  <label className="brand-snapshot-field">
                                    <span>Alt label</span>
                                    <input
                                      className="brand-snapshot-input"
                                      value={brandSnapshotDraft.brandMark.alt}
                                      onChange={(e) => updateBrandSnapshotDraft(['brandMark', 'alt'], e.target.value)}
                                      placeholder="Brand mark"
                                    />
                                  </label>
                                  <label className="brand-snapshot-file">
                                    <span>Upload logo / mark</span>
                                    <input
                                      type="file"
                                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        if (file.size > 700000) {
                                          setBrandSnapshotError('Logo upload is too large. Use a smaller image or hosted URL.');
                                          return;
                                        }
                                        const reader = new FileReader();
                                        reader.onload = () => updateBrandSnapshotDraft(['brandMark', 'logoUrl'], String(reader.result || ''));
                                        reader.onerror = () => setBrandSnapshotError('Could not read uploaded logo.');
                                        reader.readAsDataURL(file);
                                      }}
                                    />
                                  </label>
                                </div>
                              </section>
                              <section className="brand-snapshot-editor-section">
                                <div className="brand-snapshot-editor-section-title">02 · Color System</div>
                                <div className="brand-snapshot-color-grid">
                                  {[
                                    ['primary', 'Primary'],
                                    ['secondary', 'Secondary'],
                                    ['tertiary', 'Accent'],
                                    ['neutral', 'Neutral'],
                                  ].map(([key, label]) => (
                                    <div key={key} className="brand-snapshot-color-row">
                                      <label className="brand-snapshot-field">
                                        <span>{label} hex</span>
                                        <div className="brand-snapshot-color-input">
                                          <input
                                            type="color"
                                            value={colorInputValue(brandSnapshotDraft.colors[key].hex)}
                                            onChange={(e) => updateBrandSnapshotDraft(['colors', key, 'hex'], e.target.value)}
                                            aria-label={`${label} color picker`}
                                          />
                                          <input
                                            className="brand-snapshot-input"
                                            value={brandSnapshotDraft.colors[key].hex}
                                            onChange={(e) => updateBrandSnapshotDraft(['colors', key, 'hex'], e.target.value)}
                                            placeholder="#000000"
                                          />
                                        </div>
                                      </label>
                                      <label className="brand-snapshot-field">
                                        <span>{label} role</span>
                                        <input
                                          className="brand-snapshot-input"
                                          value={brandSnapshotDraft.colors[key].role}
                                          onChange={(e) => updateBrandSnapshotDraft(['colors', key, 'role'], e.target.value)}
                                          placeholder="How this color should be used"
                                        />
                                      </label>
                                    </div>
                                  ))}
                                </div>
                              </section>
                              <section className="brand-snapshot-editor-section">
                                <div className="brand-snapshot-editor-section-title">03 · Type System</div>
                                <div className="brand-snapshot-editor-grid">
                                  <label className="brand-snapshot-field">
                                    <span>Heading font</span>
                                    <input className="brand-snapshot-input" value={brandSnapshotDraft.typography.headingSystem.fontFamily} onChange={(e) => updateBrandSnapshotDraft(['typography', 'headingSystem', 'fontFamily'], e.target.value)} placeholder="Inter, Space Grotesk, serif..." />
                                  </label>
                                  <label className="brand-snapshot-field">
                                    <span>Heading weight</span>
                                    <input className="brand-snapshot-input" value={brandSnapshotDraft.typography.headingSystem.fontWeight} onChange={(e) => updateBrandSnapshotDraft(['typography', 'headingSystem', 'fontWeight'], e.target.value)} placeholder="700" />
                                  </label>
                                  <label className="brand-snapshot-field">
                                    <span>Body font</span>
                                    <input className="brand-snapshot-input" value={brandSnapshotDraft.typography.bodySystem.fontFamily} onChange={(e) => updateBrandSnapshotDraft(['typography', 'bodySystem', 'fontFamily'], e.target.value)} placeholder="Inter, system-ui, sans-serif..." />
                                  </label>
                                  <label className="brand-snapshot-field">
                                    <span>Body weight</span>
                                    <input className="brand-snapshot-input" value={brandSnapshotDraft.typography.bodySystem.fontWeight} onChange={(e) => updateBrandSnapshotDraft(['typography', 'bodySystem', 'fontWeight'], e.target.value)} placeholder="400" />
                                  </label>
                                </div>
                              </section>
                              <section className="brand-snapshot-editor-section">
                                <div className="brand-snapshot-editor-section-title">04 · Gradient / Treatment</div>
                                <div className="brand-snapshot-editor-grid">
                                  <label className="brand-snapshot-field">
                                    <span>Gradient from</span>
                                    <div className="brand-snapshot-color-input">
                                      <input type="color" value={colorInputValue(brandSnapshotDraft.gradient.from)} onChange={(e) => updateBrandSnapshotDraft(['gradient', 'from'], e.target.value)} />
                                      <input className="brand-snapshot-input" value={brandSnapshotDraft.gradient.from} onChange={(e) => updateBrandSnapshotDraft(['gradient', 'from'], e.target.value)} placeholder="#000000" />
                                    </div>
                                  </label>
                                  <label className="brand-snapshot-field">
                                    <span>Gradient to</span>
                                    <div className="brand-snapshot-color-input">
                                      <input type="color" value={colorInputValue(brandSnapshotDraft.gradient.to, '#ffffff')} onChange={(e) => updateBrandSnapshotDraft(['gradient', 'to'], e.target.value)} />
                                      <input className="brand-snapshot-input" value={brandSnapshotDraft.gradient.to} onChange={(e) => updateBrandSnapshotDraft(['gradient', 'to'], e.target.value)} placeholder="#ffffff" />
                                    </div>
                                  </label>
                                  <label className="brand-snapshot-field">
                                    <span>Angle</span>
                                    <input className="brand-snapshot-input" value={brandSnapshotDraft.gradient.angle} onChange={(e) => updateBrandSnapshotDraft(['gradient', 'angle'], e.target.value)} placeholder="135deg" />
                                  </label>
                                </div>
                              </section>
                              <label className="brand-snapshot-field">
                                <span>Snapshot notes</span>
                                <textarea
                                  className="brand-snapshot-textarea"
                                  value={brandSnapshotDraft.summary}
                                  onChange={(e) => updateBrandSnapshotDraft(['summary'], e.target.value)}
                                  rows={3}
                                  placeholder="Optional notes that explain the visual system."
                                />
                              </label>
                              {brandSnapshotError && <p className="brand-snapshot-error">{brandSnapshotError}</p>}
                              <div className="brand-snapshot-actions">
                                <button type="button" className="tile-foot-rerun-btn" onClick={() => setBrandSnapshotDraft(buildBrandSnapshotDraft(styleGuideData))} disabled={brandSnapshotSaving}>Reset</button>
                                <button type="button" className="tile-foot-rerun-btn" onClick={saveBrandSnapshotConfig} disabled={brandSnapshotSaving}>{brandSnapshotSaving ? 'Saving...' : 'Save Brand Snapshot'}</button>
                              </div>
                            </div>
                          )}
                          {activeTileModal.rows.map((row) => (
                            row.isHeader ? <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
                            : row.isAuditRow ? (
                              <div key={row.key} className={`tile-detail-audit-row${row.isColumnHeader ? ' tile-detail-audit-row--header' : ''}`}>
                                <span className="tile-detail-audit-label">{row.label}</span>
                                <span className="tile-detail-audit-tier">{row.tier}</span>
                                <span className={`tile-detail-audit-status${!row.isColumnHeader ? (row.isUpgrade ? ' audit-upgrade' : row.status === 'Captured' ? ' audit-ok' : ' audit-miss') : ''}`} onClick={row.isUpgrade ? () => setShowTierModal(true) : undefined}>{row.status}</span>
                              </div>
                            ) : (
                              <div key={row.key} className={`tile-detail-stat-row${row.isFailing ? ' tile-detail-stat-row--flag' : ''}`}>
                                <span className="tile-detail-stat-label">{row.label}</span>
                                <span className="tile-detail-stat-value">{row.value}</span>
                              </div>
                            )
                          ))}
                          {(() => {
                            const cms = moduleState?.[activeTileModal.cardId];
                            if (!cms) return null;
                            const fmtTs = (ts) => {
                              try {
                                const d = ts?.toDate?.() ?? (ts?.seconds ? new Date(ts.seconds * 1000) : null);
                                return d ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
                              } catch { return '—'; }
                            };
                            const diagRows = [
                              { key: 'mod-header',  isHeader: true, label: 'MODULE DIAGNOSTICS' },
                              { key: 'mod-status',  label: 'Status',          value: cms.status             || '—' },
                              { key: 'mod-enabled', label: 'Enabled',         value: cms.enabled ? 'Yes' : 'No' },
                              { key: 'mod-run',     label: 'Last run ID',     value: cms.lastAttemptRunId   || '—' },
                              { key: 'mod-success', label: 'Last success ID', value: cms.lastSuccessfulRunId || '—' },
                              { key: 'mod-at',      label: 'Last attempt',    value: fmtTs(cms.lastAttemptAt) },
                              { key: 'mod-ok-at',   label: 'Last success',    value: fmtTs(cms.lastSuccessAt) },
                              { key: 'mod-err',     label: 'Error code',      value: cms.lastErrorCode      || '—' },
                              { key: 'mod-msg',     label: 'Error message',   value: cms.lastErrorMessage   || '—' },
                              { key: 'mod-warns',   label: 'Warning codes',   value: (cms.warningCodes?.join(', ')) || 'None' },
                            ];
                            return diagRows.map((row) =>
                              row.isHeader
                                ? <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
                                : (
                                  <div key={row.key} className="tile-detail-stat-row">
                                    <span className="tile-detail-stat-label">{row.label}</span>
                                    <span className="tile-detail-stat-value" style={{ wordBreak: 'break-all' }}>{row.value}</span>
                                  </div>
                                )
                            );
                          })()}
                          {activeTileModal.cardId === 'design-evaluation' && (
                            <div id="design-evaluation-raw-data">
                              <div className="tile-detail-row-section-head">EXTRACTED TOKENS (synth.styleGuide)</div>
                              <pre
                                id="design-evaluation-tokens-json"
                                style={{
                                  margin: 0,
                                  padding: 12,
                                  background: 'rgba(0,0,0,0.35)',
                                  color: '#e8e6e1',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                  fontSize: 11,
                                  lineHeight: 1.45,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  borderRadius: 6,
                                  maxHeight: '40vh',
                                  overflow: 'auto',
                                }}
                              >{JSON.stringify(styleGuideData ?? null, null, 2)}</pre>
                              <div className="tile-detail-row-section-head" style={{ marginTop: 12 }}>SKILL OUTPUT (design-evaluation)</div>
                              <pre
                                id="design-evaluation-skill-json"
                                style={{
                                  margin: 0,
                                  padding: 12,
                                  background: 'rgba(0,0,0,0.35)',
                                  color: '#e8e6e1',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                  fontSize: 11,
                                  lineHeight: 1.45,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  borderRadius: 6,
                                  maxHeight: '40vh',
                                  overflow: 'auto',
                                }}
                              >{JSON.stringify(activeTileModal.analyzer ?? null, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Data-only column for brief (no tabs) */}
                {activeTileModal.cardId === 'brief' ? (
                  <div
                    id="brief-detail-data"
                    className="tile-detail-bento-cell"
                    style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
                  >
                    <div id="tile-detail-bento-rows">
                      {activeTileModal.rows.map((row) => (
                        row.isHeader ? <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
                        : row.isAuditRow ? (
                          <div key={row.key} className={`tile-detail-audit-row${row.isColumnHeader ? ' tile-detail-audit-row--header' : ''}`}>
                            <span className="tile-detail-audit-label">{row.label}</span>
                            <span className="tile-detail-audit-tier">{row.tier}</span>
                            <span className={`tile-detail-audit-status${!row.isColumnHeader ? (row.isUpgrade ? ' audit-upgrade' : row.status === 'Captured' ? ' audit-ok' : ' audit-miss') : ''}`} onClick={row.isUpgrade ? () => setShowTierModal(true) : undefined}>{row.status}</span>
                          </div>
                        ) : (
                          <div key={row.key} className={`tile-detail-stat-row${row.isFailing ? ' tile-detail-stat-row--flag' : ''}`}>
                            <span className="tile-detail-stat-label">{row.label}</span>
                            <span className="tile-detail-stat-value">{row.value}</span>
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Tabbed column for audit-summary */}
                {activeTileModal.cardId === 'audit-summary' ? (
                  <div
                    id="audit-summary-modal-tabs-container"
                    className="tile-detail-bento-cell tile-detail-tabbed-container"
                  >
                    <div className="tile-detail-tabs">
                      <button type="button" className="tile-detail-tab tile-detail-tab--active">DATA QUALITY</button>
                    </div>
                    <div className="tile-detail-tab-content">
                      <div id="adq-pane" className="tile-detail-tab-pane">
                        {(() => {
                          const CARD_COLOR = {
                            'marketing-brief':   '#0ea5e9',
                            'strategy-builder':  '#8b5cf6',
                            'newsletter':        '#ec4899',
                            'knowledge-base':    '#f59e0b',
                            'industry':          '#6366f1',
                            'brand-voice':       '#f472b6',
                            'brand-system':      '#f97316',
                            'seo-performance':   '#8b5cf6',
                            'style-guide':       '#06b6d4',
                            'social-preview':    '#6366f1',
                            'multi-device-view': '#0ea5e9',
                            'agent-readiness':   '#a78bfa',
                          };
                          const CARD_ICONS = {
                            'marketing-brief':   ChartColumnIncreasing,
                            'strategy-builder':  Workflow,
                            'newsletter':        MessageSquareMore,
                            'knowledge-base':    Database,
                            'industry':          Globe,
                            'brand-voice':       Pencil,
                            'brand-system':      Settings2,
                            'seo-performance':   Search,
                            'style-guide':       Images,
                            'social-preview':    ArrowRightLeft,
                            'multi-device-view': LaptopMinimalCheck,
                            'agent-readiness':   BriefcaseBusiness,
                          };
                          const SECTION_SUBTITLES = {
                            'EXECUTIVE DAILY BRIEF': 'Market intel, KOL signals & publishing',
                            'STRATEGY BUILDER':      'Content angles, opportunity map & posts',
                            'COMPANY BRAIN':         'Knowledge powering all AI modules',
                            'MARKET CATEGORY':       'Industry classification & positioning',
                            'BRAND VOICE':           'Tone system, style & personality',
                            'BRAND IDENTITY':        'Master prompt, brand JSON & assets',
                            'NEWSLETTER':            'Weekly AI-generated email content',
                            'SEO PERFORMANCE':       'PageSpeed, Core Web Vitals & flags',
                            'STYLE GUIDE':           'Typography, color palette & motion',
                            'SOCIAL PREVIEW':        'Open Graph & share card image',
                            'MULTI-DEVICE VIEW':     'Screenshots & device mockups',
                            'AGENT READINESS':       'AI readiness & structured data audit',
                            'SITE EVIDENCE':         'Crawled pages, headings & nav',
                            'ARTIFACTS':             'Reports, PDFs & skill documents',
                            'MODULE STATUS':         'Run status for pipeline modules',
                            'RUN HEALTH':            'Recent pipeline run diagnostics',
                          };
                          const CARD_BUCKET = {
                            'marketing-brief':   'brief',
                            'strategy-builder':  'growth',
                            'newsletter':        'growth',
                            'knowledge-base':    'knowledge',
                            'industry':          'knowledge',
                            'brand-voice':       'content',
                            'brand-system':      'content',
                            'seo-performance':   'website',
                            'style-guide':       'website',
                            'social-preview':    'website',
                            'multi-device-view': 'website',
                            'agent-readiness':   'website',
                          };
                          const BUCKET_META = {
                            brief:    { label: 'Executive Daily Brief',  sub: 'Daily market intelligence & publishing', icon: ChartColumnIncreasing, color: '#2a2420' },
                            growth:   { label: 'Marketing Director',     sub: 'Strategy, signals & growth pipeline',   icon: Settings2,             color: '#10b981' },
                            knowledge:{ label: 'Company Brain',          sub: 'Knowledge sources powering AI modules', icon: Database,              color: '#3b82f6' },
                            content:  { label: 'Creative Director',      sub: 'Brand voice, identity & systems',       icon: Workflow,              color: '#14b8a6' },
                            website:  { label: 'Website Developer',      sub: 'Speed, SEO & conversion metrics',       icon: LaptopMinimalCheck,    color: '#0ea5e9' },
                            _system:  { label: 'System',                 sub: 'Pipeline, artifacts & diagnostics',     icon: ClipboardList,         color: '#6b7280' },
                          };
                          const BUCKET_ORDER = ['brief', 'growth', 'knowledge', 'content', 'website', '_system'];

                          const FIELD_SOURCES = {
                            // SCOUT — social listening & search signals
                            'db-kol': 'SCOUT', 'db-brand-mentions': 'SCOUT', 'db-competitor-intel': 'SCOUT',
                            'db-viral': 'SCOUT', 'db-category-trends': 'SCOUT', 'db-escalations': 'SCOUT',
                            'plat-reddit': 'SCOUT', 'plat-producthunt': 'SCOUT', 'plat-betalist': 'SCOUT',
                            'plat-uneed': 'SCOUT', 'plat-trustmrr': 'SCOUT', 'plat-fazier': 'SCOUT',
                            'plat-openalt': 'SCOUT', 'plat-microlaunch': 'SCOUT', 'plat-peerlist': 'SCOUT',
                            'plat-tinylaunch': 'SCOUT', 'plat-saashub': 'SCOUT', 'plat-indiehackers': 'SCOUT',
                            'plat-hackernews': 'SCOUT', 'plat-toolfolio': 'SCOUT', 'plat-tinystartup': 'SCOUT',
                            'plat-sideprojectors': 'SCOUT', 'plat-alternativeto': 'SCOUT', 'plat-launchigniter': 'SCOUT',
                            'plat-peerpush': 'SCOUT', 'plat-saasgenius': 'SCOUT', 'plat-theresanai': 'SCOUT', 'plat-devhunt': 'SCOUT',
                            'soc-instagram': 'SCOUT', 'soc-twitter': 'SCOUT', 'soc-linkedin': 'SCOUT',
                            'soc-facebook': 'SCOUT', 'soc-tiktok': 'SCOUT', 'soc-youtube': 'SCOUT',
                            'soc-pinterest': 'SCOUT', 'soc-threads': 'SCOUT', 'soc-bluesky': 'SCOUT',
                            'soc-mastodon': 'SCOUT', 'soc-discord': 'SCOUT', 'soc-twitch': 'SCOUT', 'soc-snapchat': 'SCOUT',
                            'ext-weather': 'SCOUT', 'ext-reviews': 'SCOUT', 'ext-google-trends': 'SCOUT',
                            // USER — manually configured inputs
                            'db-scout-focus': 'USER', 'db-scout-instr': 'USER', 'db-searches': 'USER', 'db-platforms': 'USER',
                            'kb-global': 'USER', 'kb-brief': 'USER', 'kb-strategy': 'USER', 'kb-brand': 'USER', 'kb-market': 'USER',
                            'bi-kb-sources': 'USER', 'site-url': 'USER', 'run-source-url': 'USER',
                            // PSI — PageSpeed Insights API
                            'psi-perf': 'PSI', 'psi-seo': 'PSI', 'psi-a11y': 'PSI', 'psi-bp': 'PSI',
                            'psi-lcp': 'PSI', 'psi-inp': 'PSI', 'psi-cls': 'PSI', 'psi-ttfb': 'PSI',
                            'psi-opps': 'PSI', 'psi-red-flags': 'PSI', 'psi-a11y-fail': 'PSI',
                            'psi-insights': 'PSI', 'psi-diagnostics': 'PSI', 'psi-3p': 'PSI',
                            'psi-audit-status': 'PSI', 'psi-data': 'PSI', 'psi-fail-code': 'PSI',
                            'psi-fail-reason': 'PSI', 'psi-final-url': 'PSI', 'psi-http-status': 'PSI',
                            'psi-host-service': 'PSI', 'psi-host-provider': 'PSI', 'psi-blocked-by': 'PSI',
                            'psi-redirects': 'PSI', 'psi-duration': 'PSI', 'psi-lh-version': 'PSI',
                            // CRAWL — site scrape / crawler
                            'meta-og-title': 'CRAWL', 'meta-og-desc': 'CRAWL', 'meta-og-image': 'CRAWL',
                            'meta-og-image-alt': 'CRAWL', 'meta-site-name': 'CRAWL', 'meta-og-type': 'CRAWL',
                            'meta-locale': 'CRAWL', 'meta-canonical': 'CRAWL', 'meta-favicon': 'CRAWL',
                            'meta-apple-icon': 'CRAWL', 'meta-theme': 'CRAWL',
                            'art-screenshot': 'CRAWL', 'art-full-desktop': 'CRAWL', 'art-full-tablet': 'CRAWL', 'art-full-mobile': 'CRAWL',
                            'site-pages': 'CRAWL', 'site-title': 'CRAWL', 'site-meta-desc': 'CRAWL',
                            'site-h1': 'CRAWL', 'site-h2': 'CRAWL', 'site-body': 'CRAWL', 'site-cta': 'CRAWL',
                            'site-nav': 'CRAWL', 'site-social': 'CRAWL', 'site-contact': 'CRAWL',
                            // ARTIFACT — generated reports & files
                            'bi-art-report': 'ARTIFACT', 'ds-art-report': 'ARTIFACT',
                            'art-brief-html': 'ARTIFACT', 'art-brief-pdf': 'ARTIFACT',
                            'art-skill-seo': 'ARTIFACT', 'art-skill-brand': 'ARTIFACT', 'art-skill-style': 'ARTIFACT',
                            'art-skill-conv': 'ARTIFACT', 'art-skill-asset': 'ARTIFACT',
                            // MODULE — pipeline / run state
                            'nl-status': 'MODULE',
                            'mod-marketing-brief': 'MODULE', 'mod-strategy-builder': 'MODULE', 'mod-knowledge-base': 'MODULE',
                            'mod-industry': 'MODULE', 'mod-seo': 'MODULE', 'mod-style-guide': 'MODULE',
                            'mod-social-preview': 'MODULE', 'mod-multi-device': 'MODULE', 'mod-agent-readiness': 'MODULE',
                            'mod-brand-voice': 'MODULE', 'mod-brand-system': 'MODULE', 'mod-newsletter': 'MODULE',
                            'mod-social-posting': 'MODULE',
                            'run-status': 'MODULE', 'run-timestamp': 'MODULE', 'run-error': 'MODULE',
                            'run-warnings': 'MODULE', 'run-psi-warnings': 'MODULE',
                            'ai-synth-model': 'MODULE', 'ai-synth-cost': 'MODULE', 'ai-scribe-cost': 'MODULE', 'ai-skill-cost': 'MODULE',
                          };

                          const sections = [];
                          let cur = null;
                          for (const row of activeTileModal.rows) {
                            if (row.isColumnHeader) continue;
                            if (row.isHeader) { cur = { header: row, rows: [] }; sections.push(cur); }
                            else if (cur) cur.rows.push(row);
                          }

                          const buckets = {};
                          for (const section of sections) {
                            const key = CARD_BUCKET[section.header.cardId] || '_system';
                            if (!buckets[key]) buckets[key] = [];
                            buckets[key].push(section);
                          }

                          const allAuditRows = sections.flatMap((s) => s.rows.filter((r) => r.isAuditRow && !r.isColumnHeader));
                          const totalCaptured = allAuditRows.filter((r) => r._captured).length;
                          const totalFields = allAuditRows.length;
                          const runTs = currentRun?.updatedAt || dashboardState?.updatedAt;
                          const runTsLabel = runTs
                            ? new Date(runTs).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                            : null;
                          const SOURCE_TYPES = ['AI', 'SCOUT', 'CRAWL', 'PSI', 'USER', 'ARTIFACT', 'MODULE'];

                          const getTone = (ratio) => ratio === 1 ? 'healthy' : ratio >= 0.5 ? 'partial' : 'critical';
                          const getToneLabel = (ratio) => ratio === 1 ? 'COMPLETE' : ratio >= 0.5 ? 'PARTIAL' : 'REVIEW';

                          const renderSection = (section) => {
                            const auditRows = section.rows.filter((r) => r.isAuditRow);
                            const capturedCount = auditRows.filter((r) => r._captured).length;
                            const total = auditRows.length;
                            const ratio = total > 0 ? capturedCount / total : 0;
                            const pct = total > 0 ? Math.round(ratio * 100) : 0;
                            const tone = getTone(ratio);
                            const subtitle = SECTION_SUBTITLES[section.header.label] || '';
                            const openCard = section.header.cardId ? () => {
                              const targetCard = intakeCapabilityCards.find((c) => c.id === section.header.cardId);
                              if (!targetCard) return;
                              setActiveTileModal(null);
                              if (section.header.cardCategory) setActiveCapabilityFilter(section.header.cardCategory);
                              setActiveTileModal({ title: targetCard.title, description: targetCard.description, rows: targetCard.rows, cardId: targetCard.id, placeholderLabel: targetCard.placeholderLabel, number: targetCard.number, label: targetCard.label, isCapabilityCard: true, vizType: null, recommendation: null, analyzer: null, readinessBadge: null });
                            } : null;
                            return (
                              <div key={section.header.key} className="adq-section-card">
                                <div className="adq-sc-top">
                                  <div className="adq-sc-meta">
                                    <span className="adq-sc-name">{section.header.label}</span>
                                    <span className="adq-sc-sub">{subtitle}</span>
                                  </div>
                                </div>
                                <div className="adq-sc-footer-row">
                                  <span className={`tile-readiness-tag readiness-${tone}`}>{getToneLabel(ratio)}</span>
                                  {openCard && (
                                    <button type="button" className="adq-sc-open-btn" onClick={openCard} aria-label={`Open ${section.header.label}`}>
                                      View card <ArrowUpRight size={10} strokeWidth={2} />
                                    </button>
                                  )}
                                </div>
                                {auditRows.length > 0 && (
                                  <ul className="adq-field-rows">
                                    {auditRows.map((r) => (
                                      <li key={r.key} className={`adq-fr${r._captured ? ' adq-fr--ok' : r.isUpgrade ? ' adq-fr--lock' : ' adq-fr--miss'}`}>
                                        <span className="adq-fr-indicator">
                                          {r.isUpgrade
                                            ? <Lock size={9} strokeWidth={2} />
                                            : <span className={`adq-fr-pip${r._captured ? ' adq-fr-pip--ok' : ' adq-fr-pip--miss'}`} />
                                          }
                                        </span>
                                        <span className="adq-fr-label">{r.label}</span>
                                        {(() => { const src = FIELD_SOURCES[r.key] || 'AI'; return <span className={`adq-fr-src adq-fr-src--${src.toLowerCase()}`}>{src}</span>; })()}
                                        {r._captured && (
                                          <span className="adq-fr-badge adq-fr-badge--ok">CAPTURED</span>
                                        )}
                                        {!r._captured && !r.isUpgrade && (
                                          <span className="adq-fr-badge adq-fr-badge--miss">MISSING</span>
                                        )}
                                        {r.isUpgrade && (
                                          <button type="button" className="adq-fr-upgrade" onClick={() => setShowTierModal(true)}>UPGRADE →</button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          };

                          return (
                            <div id="adq-shell">
                              {/* Gradient defs for bucket ring SVGs — scoped here so rings work even if image cell is hidden */}
                              <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
                                <defs>
                                  <linearGradient id="adq-ring-g" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="#00cfff" />
                                    <stop offset="48%" stopColor="#7b5fff" />
                                    <stop offset="100%" stopColor="#ff3de8" />
                                  </linearGradient>
                                </defs>
                              </svg>
                              <div id="adq-scroll">
                                {BUCKET_ORDER.filter((b) => buckets[b]?.length).map((bucketKey) => {
                                  const bSections = buckets[bucketKey];
                                  const bRows = bSections.flatMap((s) => s.rows.filter((r) => r.isAuditRow));
                                  const bCaptured = bRows.filter((r) => r._captured).length;
                                  const bTotal = bRows.length;
                                  const bPct = bTotal > 0 ? (bCaptured / bTotal) * 100 : 0;
                                  const bRatio = bTotal > 0 ? bCaptured / bTotal : 0;
                                  const bTone = getTone(bRatio);
                                  const meta = BUCKET_META[bucketKey];
                                  const BucketNavIcon = meta.icon || null;
                                  const ringCirc = 2 * Math.PI * 24;
                                  const ringOffset = ringCirc * (1 - Math.min(bPct / 100, 1));
                                  return (
                                    <div key={bucketKey} className="adq-bucket">
                                      <div className="adq-bucket-hdr">
                                        <div className="adq-bucket-hdr-left">
                                          {BucketNavIcon && (
                                            <span className="adq-bucket-icon-wrap" style={{ color: meta.color }}>
                                              <BucketNavIcon size={18} strokeWidth={2} />
                                            </span>
                                          )}
                                          <div className="adq-bucket-text">
                                            <span className="adq-bucket-name">{meta.label.toUpperCase()}</span>
                                          </div>
                                        </div>
                                        <div className="adq-bucket-hdr-right">
                                          <div className="adq-bucket-ring-wrap">
                                            <svg className="adq-bucket-ring-svg" viewBox="0 0 58 58" aria-hidden="true">
                                              <circle cx="29" cy="29" r="24" fill="none" stroke="rgba(42,36,32,0.08)" strokeWidth="4" />
                                              <circle
                                                cx="29" cy="29" r="24"
                                                fill="none"
                                                strokeWidth="4"
                                                stroke="url(#adq-ring-g)"
                                                strokeDasharray={ringCirc}
                                                strokeDashoffset={ringOffset}
                                                transform="rotate(-90 29 29)"
                                                strokeLinecap="round"
                                              />
                                            </svg>
                                            <div className="adq-bucket-ring-val">{bCaptured}<span className="adq-bucket-ring-sep">/</span>{bTotal}</div>
                                          </div>
                                        </div>
                                      </div>
                                      <div className="adq-section-grid">
                                        {bSections.map(renderSection)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div id="adq-footer">
                                <span className="adq-footer-status">STATUS LEGEND</span>
                                <span className="adq-legend-item">
                                  <span className="adq-fr-pip adq-fr-pip--ok" />
                                  <span>Captured</span>
                                </span>
                                <span className="adq-legend-item">
                                  <span className="adq-fr-pip adq-fr-pip--miss" />
                                  <span>Missing</span>
                                </span>
                                <span className="adq-legend-item">
                                  <Lock size={9} strokeWidth={2} style={{ color: '#9ca3af', display: 'inline-flex' }} />
                                  <span>Upgrade</span>
                                </span>
                                <span className="adq-legend-item adq-legend-item--right">
                                  <span className="tile-readiness-tag readiness-healthy">COMPLETE</span>
                                  <span className="tile-readiness-tag readiness-partial">PARTIAL</span>
                                  <span className="tile-readiness-tag readiness-critical">REVIEW</span>
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                ) : null}


              </div>


            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
};

// ── Tile viz renderers ────────────────────────────────────────────────────────

// Shared half-circle gauge + up-to-5 dimension rings layout. Used by
// AI Agent Readiness, Data Summary, and SEO Performance Snapshot so the
// three cards share a consistent visual shell.
//
// `score` is the central numeric/string label.
// `gaugePct` (optional) controls how full the half-arc renders, on a 0–100
// scale. If omitted, falls back to using `score` (treated as a percentage).
// This lets a card display a count like "6" while the arc fills based on
// 6/12 = 50 %.
const renderGaugeViz = ({ score, verdictLabel, rings, gaugePct: gaugePctOverride, shellClass, scoreClass }) => {
  const gaugeCirc = Math.PI * 44;
  const rawPct = gaugePctOverride != null ? gaugePctOverride : (typeof score === 'number' ? score : 0);
  const gaugePct = Math.min(Math.max(rawPct, 0) / 100, 1);
  const gaugeOffset = gaugeCirc * (1 - gaugePct);
  const ringCirc = 2 * Math.PI * 24;
  const safeRings = rings || [];

  return (
    <div id="ar-viz-shell" className={shellClass || ''}>
      <svg className="seo-grad-defs" aria-hidden="true">
        <defs>
          <linearGradient id="ar-g" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#00cfff"/>
            <stop offset="48%"  stopColor="#7b5fff"/>
            <stop offset="100%" stopColor="#ff3de8"/>
          </linearGradient>
          <linearGradient id="ar-gv" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%"   stopColor="#00cfff"/>
            <stop offset="100%" stopColor="#ff3de8"/>
          </linearGradient>
        </defs>
      </svg>
      <div id="ar-gauge-wrap">
        <svg id="ar-gauge-svg" viewBox="0 0 100 56" aria-hidden="true">
          <path d="M 6 52 A 44 44 0 0 1 94 52" fill="none" stroke="rgba(42,36,32,0.1)" strokeWidth="7" strokeLinecap="round" />
          <path
            d="M 6 52 A 44 44 0 0 1 94 52"
            fill="none"
            stroke="url(#ar-gv)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={gaugeCirc}
            strokeDashoffset={gaugeOffset}
          />
        </svg>
        <div id="ar-gauge-score" className={scoreClass || ''}>{score != null ? score : '—'}</div>
        {verdictLabel && <div id="ar-verdict-pill">{verdictLabel}</div>}
      </div>
      <div id="ar-dim-row">
        {safeRings.map(({ id: ringId, label, icon, val, sub, p, locked }) => {
          const RingIcon = icon?.Icon || null;
          const iconColor = icon?.color || null;
          return (
            <div className={`audit-ring-cell ar-dim-cell${locked ? ' ar-ring-locked' : ''}`} key={ringId || label}>
              <div className="ar-ring-wrap">
                <svg className="seo-ring-svg" viewBox="0 0 58 58">
                  <circle className="ring-bg" cx="29" cy="29" r="24" fill="none" strokeWidth="4" />
                  <circle
                    cx="29" cy="29" r="24"
                    fill="none"
                    strokeWidth="4"
                    stroke={locked ? 'rgba(42,36,32,0.15)' : 'url(#ar-g)'}
                    strokeDasharray={ringCirc}
                    strokeDashoffset={locked ? 0 : ringCirc - (ringCirc * Math.max(0, Math.min(p ?? 0, 100)) / 100)}
                    transform="rotate(-90 29 29)"
                    strokeLinecap="round"
                    className="stroke-lit"
                  />
                </svg>
                <div className="ar-ring-val">{val != null ? val : '—'}</div>
              </div>
              <div className="audit-ring-label">
                {RingIcon
                  ? <RingIcon size={13} strokeWidth={2} style={{ color: iconColor, display: 'block', margin: '0 auto' }} />
                  : label}
              </div>
              {sub != null && <div className="ar-dim-sub">{sub}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Data Summary — counts how many runnable Data Visualization cards have
// completed and surfaces the five most important ones as the dimension rings.
// Half-circle gauge: count-of-run cards in the center, "OUT OF X" pill below,
// arc fill ratio = run / total of the data-viz bucket.
const renderAuditViz = (auditRows, _moduleState) => {
  const CARD_BUCKET = {
    'marketing-brief':   'brief',
    'strategy-builder':  'growth',
    'newsletter':        'growth',
    'knowledge-base':    'knowledge',
    'industry':          'knowledge',
    'brand-voice':       'content',
    'brand-system':      'content',
    'seo-performance':   'website',
    'style-guide':       'website',
    'social-preview':    'website',
    'multi-device-view': 'website',
    'agent-readiness':   'website',
  };

  const BUCKET_ORDER  = ['brief', 'growth', 'knowledge', 'content', 'website', '_system'];
  const BUCKET_LABELS = { brief: 'Brief', growth: 'Market', knowledge: 'Brain', content: 'Brand', website: 'Web', _system: 'System' };
  const BUCKET_ICONS  = {
    brief:     { Icon: ChartColumnIncreasing, color: '#2a2420' },
    growth:    { Icon: Settings2,             color: '#10b981' },
    knowledge: { Icon: Database,              color: '#3b82f6' },
    content:   { Icon: Workflow,              color: '#14b8a6' },
    website:   { Icon: LaptopMinimalCheck,    color: '#0ea5e9' },
  };

  const counts = {};
  [...BUCKET_ORDER, '_upgrade'].forEach((b) => { counts[b] = { captured: 0, total: 0 }; });

  let curBucket = '_system';
  for (const row of (auditRows || [])) {
    if (row.isColumnHeader) continue;
    if (row.isHeader) { curBucket = CARD_BUCKET[row.cardId] || '_system'; continue; }
    if (!row.isAuditRow) continue;
    if (row.isUpgrade) {
      counts['_upgrade'].total++;
    } else {
      const bucket = curBucket || '_system';
      counts[bucket].total++;
      if (row._captured) counts[bucket].captured++;
    }
  }

  // Gauge center: all rows including upgrade-locked
  const allRows     = (auditRows || []).filter((r) => r.isAuditRow && !r.isColumnHeader);
  const allCaptured = allRows.filter((r) => r._captured).length;
  const allTotal    = allRows.length;
  const gaugePct    = allTotal > 0 ? Math.round((allCaptured / allTotal) * 100) : 0;

  const rings = [
    ...BUCKET_ORDER.map((b) => {
      const { captured, total } = counts[b];
      const p = total > 0 ? Math.round((captured / total) * 100) : 0;
      const bucketIcon = BUCKET_ICONS[b];
      return {
        id: b,
        label: BUCKET_LABELS[b],
        icon: bucketIcon || null,
        val: captured,
        sub: bucketIcon ? null : `/ ${total}`,
        p,
      };
    }),
    counts['_upgrade'].total > 0
      ? { id: '_upgrade', label: 'Locked', icon: null, val: counts['_upgrade'].total, sub: 'upgrade', p: 0, locked: true }
      : null,
  ].filter(Boolean);

  return renderGaugeViz({
    score:        `${gaugePct}%`,
    gaugePct,
    verdictLabel: `${allCaptured}/${allTotal} DATA POINTS`,
    shellClass:   'dq-gauge-viz',
    scoreClass:   'dq-gauge-score',
    rings,
  });
};

const renderSeoViz = (seoAudit) => {
  const sc  = seoAudit?.scores ?? {};
  const cwv = seoAudit?.coreWebVitals ?? {};
  const lab = seoAudit?.labCoreWebVitals ?? {};

  const scoreEntries = [
    ['Mobile', sc.performance],
    ['SEO',     sc.seo],
    ['Access',  sc.accessibility],
    ['BP',      sc.bestPractices],
  ].filter(([, s]) => s != null);

  const overall = scoreEntries.length > 0
    ? Math.round(scoreEntries.reduce((sum, [, s]) => sum + s, 0) / scoreEntries.length)
    : null;

  const rings = scoreEntries.map(([label, s]) => ({
    label,
    val: s,
    sub: 'Score',
    p: s,
  }));

  // Optionally append a single Core Web Vital ring as the 5th cell.
  const goodnessPct = (key, raw) => {
    if (raw == null) return 0;
    switch (key) {
      case 'lcp':  return Math.max(2, Math.min(100, (1 - raw / 8000) * 100));
      case 'inp':  return Math.max(2, Math.min(100, (1 - raw / 1000) * 100));
      case 'cls':  return Math.max(2, Math.min(100, (1 - raw / 0.5)  * 100));
      default:     return 0;
    }
  };
  const lcpMs = cwv.lcp?.p75 ?? lab.lcp?.p75;
  if (lcpMs != null && rings.length < 5) {
    const cat = cwv.lcp?.category ?? lab.lcp?.category;
    const sub = cat === 'FAST' ? 'Fast' : cat === 'AVERAGE' ? 'Avg' : cat === 'SLOW' ? 'Slow' : 'p75';
    rings.push({
      label: 'LCP',
      val: `${(lcpMs / 1000).toFixed(1)}s`,
      sub,
      p: goodnessPct('lcp', lcpMs),
    });
  }

  const verdictLabel = overall == null ? null : overall >= 90 ? 'FAST' : overall >= 50 ? 'AVERAGE' : 'SLOW';
  return renderGaugeViz({ score: overall, verdictLabel, rings });
};

const renderAgentReadyViz = (agentData, aiSeoData) => {
  const score   = agentData?.score != null ? Math.round(agentData.score) : null;
  const verdict = agentData?.verdict || null;
  const dims    = agentData?.dimensions || {};
  const checks  = Array.isArray(agentData?.checks) ? agentData.checks : [];
  const aiScore = aiSeoData?.aiVisibility?.score ?? null;

  const verdictLevel = (v) => {
    if (!v) return 'LEVEL 2';
    const r = v.toLowerCase();
    if (r.includes('not') && r.includes('ready')) return 'LEVEL 1';
    if (r.includes('partial'))                     return 'LEVEL 2';
    if (r.includes('ready'))                       return 'LEVEL 3';
    return 'LEVEL 2';
  };

  const DIM_META = [
    { key: 'discoverability', label: 'Discover',     dimChecks: ['robots-txt-present','robots-txt-parseable','sitemap-xml-reachable','link-header-sitemap','api-catalog-wellknown'] },
    { key: 'accessibility',   label: 'Content',      dimChecks: ['llms-txt-present','markdown-content-negotiation','structured-data-present'] },
    { key: 'botAccess',       label: 'Bot Access',   dimChecks: ['robots-content-signal','web-bot-auth-supported'] },
    { key: 'capabilities',    label: 'Capabilities', dimChecks: ['mcp-discovery','agent-skills-manifest','x402-payment-supported','oauth-discovery'] },
  ];

  const rings = [
    ...DIM_META.map(({ key, label, dimChecks }) => {
      const val   = dims[key] != null ? Math.round(dims[key]) : null;
      const total = dimChecks.length;
      const passed = checks.filter((c) => dimChecks.includes(c.id) && c.status === 'pass').length;
      return { label, val, sub: val != null ? `${passed}/${total}` : 'N/A', p: val ?? 0 };
    }),
    ...(aiScore != null ? [{ label: 'AI Vis', val: aiScore, sub: 'Score', p: aiScore }] : []),
  ];

  return renderGaugeViz({
    score,
    verdictLabel: verdict ? verdictLevel(verdict) : null,
    rings,
  });
};

const renderViz = (type, countdownHours) => {
  switch (type) {
    case 'segbars':
      return (
        <div className="segbar-wrap">
          {[
            ['INSTAGRAM', 8, 'on'],
            ['X / TWITTER', 10, 'on'],
            ['LINKEDIN', 6, 'on'],
            ['TIKTOK', 4, 'warn'],
          ].map(([label, value, state]) => (
            <React.Fragment key={label}>
              <div className="segbar-row"><span>{label}</span><span className="val">{String(value).padStart(2, '0')} / 10</span></div>
              <div className="segbar-track">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={`${label}-${i}`} className={`segbar-cell ${i < value ? state : ''}`.trim()} />
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
      );
    case 'memory':
      return (
        <div className="memory-map">
          {memoryNodes.map((state, index) => (
            <div key={index} className={`memory-node ${state}`.trim()} />
          ))}
        </div>
      );
    case 'qa':
      return (
        <div className="qa-wrap">
          <div className="qa-q">WHERE IS Q3 ROADMAP?</div>
          <div className="qa-a">Notion / strategy / q3-2026. Last edited 2d ago by @priya. Top 3 milestones: voice-cloning beta, EU launch, pricing test.<span className="cursor" /></div>
        </div>
      );
    case 'meetings':
      return (
        <div className="mtg-wrap">
          {[
            ['10:30', 'BOARD SYNC', 'READY'],
            ['13:00', 'DESIGN REVIEW', 'READY'],
            ['15:45', 'INVESTOR CALL', 'READY'],
            ['17:30', '1:1 · PRIYA', 'DRAFTING'],
          ].map(([time, title, badge]) => (
            <div className="mtg-row" key={`${time}-${title}`}>
              <span className="time">{time}</span>
              <span className="title">{title}</span>
              <span className={`badge ${badge === 'DRAFTING' ? 'pending' : ''}`.trim()}>{badge}</span>
            </div>
          ))}
        </div>
      );
    case 'rings':
      return (
        <div className="rings">
          {[
            ['87%', 'TRIAGE', 'display', 87],
            ['62%', 'TASKS', 'warning', 62],
            ['100%', 'UPDATES', 'success', 100],
          ].map(([value, label, tone, percent]) => (
            <div className="ring-cell" key={label}>
              <svg className="ring-svg" width="58" height="58" viewBox="0 0 58 58">
                <circle className="ring-bg" cx="29" cy="29" r="24" fill="none" strokeWidth="4" />
                <circle
                  className={`ring-fill ring-fill-${tone} stroke-lit`}
                  cx="29" cy="29" r="24" fill="none" strokeWidth="4"
                  strokeDasharray="150.8"
                  strokeDashoffset={150.8 - ((150.8 * percent) / 100)}
                  transform="rotate(-90 29 29)"
                />
              </svg>
              <div className="ring-val">{value}</div>
              <div className="ring-label">{label}</div>
            </div>
          ))}
        </div>
      );
    case 'spark':
      return (
        <div className="spark-wrap">
          <div className="spark-val">38.4<span className="unit">% OPEN RATE</span></div>
          <svg className="spark-svg" viewBox="0 0 200 40" preserveAspectRatio="none">
            <line className="spark-grid" x1="0" y1="30" x2="200" y2="30" strokeWidth="1" strokeDasharray="2 3" />
            <path className="spark-line stroke-lit" d="M0,30 L18,26 L36,28 L54,20 L72,24 L90,15 L108,18 L126,12 L144,14 L162,8 L180,10 L200,6" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle className="spark-dot stroke-lit" cx="200" cy="6" r="2.5" />
          </svg>
          <div className="chips">
            <span className="chip on">EU</span>
            <span className="chip">NA</span>
            <span className="chip on">APAC</span>
          </div>
        </div>
      );
    case 'countdown':
      return (
        <div className="countdown-wrap">
          <div className="countdown">{String(countdownHours).padStart(2, '0')}<span className="unit">H TO DELIVERY</span></div>
          <div className="countdown-meta">COMPETITOR TEARDOWN · Q2 2026</div>
        </div>
      );
    case 'stats':
      return (
        <div className="stat-wrap">
          {[
            ['RECONCILED', '$184,220.00', ''],
            ['FLAGGED', '$2,340.18', 'warn'],
            ['PENDING', '$12,884.00', ''],
            ['TAX WITHHELD', '$38,201.44', ''],
          ].map(([label, value, tone]) => (
            <div className="stat-row" key={label}>
              <span className="label">{label}</span>
              <span className={`value ${tone}`.trim()}>{value}</span>
            </div>
          ))}
        </div>
      );
    case 'deadlines':
      return (
        <div className="deadline-wrap">
          {[
            ['FORM 10-Q FILING', '18 DAYS', 60, false],
            ['CA SALES TAX', '6 DAYS', 85, true],
            ['GDPR AUDIT', '42 DAYS', 25, false],
            ['SOC 2 REVIEW', '71 DAYS', 15, false],
          ].map(([name, days, width, warn]) => (
            <div className="deadline-row" key={name}>
              <div className="deadline-head"><span className="name">{name}</span><span className={`days ${warn ? 'warn' : ''}`.trim()}>{days}</span></div>
              <div className="deadline-bar"><div className={`fill ${warn ? 'warn' : ''}`.trim()} style={{ width: `${width}%` }} /></div>
            </div>
          ))}
        </div>
      );
    case 'table':
      return (
        <table className="mini-table">
          <thead>
            <tr><th>CHANNEL</th><th className="num">POSTS</th><th className="num">Δ RANK</th></tr>
          </thead>
          <tbody>
            <tr><td>ORGANIC</td><td className="num">142</td><td className="num delta-up">▲ 8</td></tr>
            <tr><td>SOCIAL</td><td className="num">68</td><td className="num delta-up">▲ 3</td></tr>
            <tr><td>REFERRAL</td><td className="num">24</td><td className="num delta-down">▼ 2</td></tr>
            <tr><td>DIRECT</td><td className="num">—</td><td className="num delta-up">▲ 1</td></tr>
          </tbody>
        </table>
      );
    case 'pipeline':
      return (
        <div className="pipeline-wrap">
          <div className="pipeline">
            <div className="pipe-stop done" />
            <div className="pipe-line done" />
            <div className="pipe-stop done" />
            <div className="pipe-line done" />
            <div className="pipe-stop active lamp-lg" />
            <div className="pipe-line" />
            <div className="pipe-stop" />
            <div className="pipe-line" />
            <div className="pipe-stop" />
          </div>
          <div className="pipe-labels">
            <span>BRIEF</span><span>SPEC</span><span className="active">BUILD</span><span>QA</span><span>SHIP</span>
          </div>
        </div>
      );
    case 'delta':
      return (
        <div className="delta-wrap">
          {[
            ['RESPONSE TIME', '+12%', 55, 72],
            ['ACCEPT RATE', '+8%', 48, 60],
            ['COST / RUN', '−18%', 74, 52],
          ].map(([label, pct, before, after]) => (
            <div className="delta-pair" key={label}>
              <div className="delta-label"><span>{label}</span><span className="pct">{pct}</span></div>
              <div className="delta-bar-before"><div className="fill" style={{ width: `${before}%` }} /></div>
              <div className="delta-bar-after"><div className="fill" style={{ width: `${after}%` }} /></div>
            </div>
          ))}
        </div>
      );
    case 'threads':
      return (
        <div className="thread-wrap">
          {[
            ['R/SAAS', 'Best AI tools for small teams', '2 DRAFTS', false],
            ['R/STARTUPS', 'How founders automate ops', '1 DRAFT', false],
            ['R/MARKETING', 'Cold email that works 2026', '1 DRAFT', false],
            ['R/DEVOPS', 'Monitoring for seed co.', 'WATCH', true],
            ['R/BIZ', 'Pricing experiments Q2', 'WATCH', true],
          ].map(([sub, title, drafts, watch]) => (
            <div className="thread-row" key={`${sub}-${title}`}>
              <span className="sub">{sub}</span>
              <span className="title">{title}</span>
              <span className={`drafts ${watch ? 'watch' : ''}`.trim()}>{drafts}</span>
            </div>
          ))}
        </div>
      );
    case 'keywords':
      return (
        <div className="kw-wrap">
          {[
            ['AI AGENTS FOR STARTUPS', '18K / MO', 92],
            ['FOUNDER DASHBOARD TOOLS', '9.4K / MO', 64],
            ['AUTOMATED COMPLIANCE', '6.1K / MO', 48],
            ['SELF-SERVE BRAND VOICE', '3.8K / MO', 32],
          ].map(([term, vol, width]) => (
            <div className="kw-row" key={term}>
              <div className="kw-head"><span>{term}</span><span className="vol">{vol}</span></div>
              <div className="kw-bar"><div className="fill" style={{ width: `${width}%` }} /></div>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
};

const shellStyle = { minHeight: '100dvh', position: 'relative', overflow: 'hidden' };

// ── CSS ───────────────────────────────────────────────────────────────────────

const dashboardCss = `
  :root {
    --accent: #D71921;
    --success: #4A9E5C;
    --warning: #D4A843;
    --font-display: "Doto", "Space Mono", monospace;
    --font-ui: "Space Grotesk", system-ui, sans-serif;
    --font-mono: "Space Mono", monospace;
    --ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  }
  [data-dashboard-theme="dark"] {
    --page: #000000;
    --surface: #111111;
    --surface-raised: #1A1A1A;
    --border: #222222;
    --border-visible: #333333;
    --text-disabled: #666666;
    --text-secondary: #999999;
    --text-primary: #E8E8E8;
    --text-display: #FFFFFF;
    --dot-grid-color: rgba(255,255,255,0.045);
  }
  [data-dashboard-theme="light"] {
    --page: #F5F5F5;
    --surface: #FFFFFF;
    --surface-raised: #F0F0F0;
    --border: #E4E4E4;
    --border-visible: #C8C8C8;
    --text-disabled: #A3A3A3;
    --text-secondary: #666666;
    --text-primary: #222222;
    --text-display: #000000;
    --dot-grid-color: rgba(0,0,0,0.065);
  }
  [data-dashboard-theme] {
    background: transparent;
    color: var(--text-primary);
    min-height: 100dvh;
    transition: background 300ms var(--ease), color 300ms var(--ease);
    font-family: var(--font-ui);
  }
  [data-dashboard-theme] * { box-sizing: border-box; }
  #founders-shell {
    position: relative;
    z-index: 1;
    max-width: 1440px;
    margin: 0 auto;
    padding: 116px 48px 96px;
    background-image:
      linear-gradient(180deg, rgba(245, 241, 223, 0.08), rgba(245, 241, 223, 0.04)),
      radial-gradient(circle, var(--dot-grid-color) 0.8px, transparent 0.8px);
    background-size: 16px 16px;
  }
  #founders-top-strip {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    z-index: 200;
    min-height: 64px;
    background: rgba(245, 241, 223, 0.18);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 -1px 0 rgba(42,36,32,0.08);
  }
  #founders-top-strip-inner {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 24px;
    min-height: 64px;
    width: 100%;
    max-width: 1440px;
    margin: 0 auto;
    padding: 0 48px;
    flex-wrap: nowrap;
    box-sizing: border-box;
  }
  #founders-brand {
    display: flex;
    align-items: center;
    text-decoration: none;
  }
  #founders-brand img {
    height: clamp(2rem, 4vw, 2.8rem);
    width: auto;
    display: block;
  }
  #founders-top-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  #founders-linkedin {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(0.9rem, 1.4vw, 1rem);
    font-weight: 500;
    letter-spacing: -0.02em;
    color: rgba(42, 36, 32, 0.42);
    text-decoration: none;
    line-height: 1;
  }
  #founders-login-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.65rem 1rem;
    border-radius: 999px;
    background: rgba(255,255,255,0.34);
    border: 1px solid rgba(42, 36, 32, 0.1);
    color: #2a2420;
    text-decoration: none;
    font-size: 0.84rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1;
    transform: scale(1);
    transition: background 0.45s ease, box-shadow 0.45s ease, transform 0.45s ease;
  }
  #founders-login-link:hover {
    background: rgba(255,255,255,1);
    box-shadow: 0px 5px 10px rgba(0,0,0,0.067), 0px 15px 30px rgba(0,0,0,0.067), 0px 20px 40px rgba(0,0,0,0.1);
    transform: scale(1.012);
    transition: background 0.28s ease, box-shadow 0.28s ease, transform 0.28s ease;
  }
  #founders-chat-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0.65rem 1rem;
    border-radius: 999px;
    background:
      linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%),
      linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1);
    color: #ffffff;
    text-decoration: none;
    font-size: 0.84rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1;
    white-space: nowrap;
    transform: scale(1);
    transition: box-shadow 0.45s ease, transform 0.45s ease;
  }
  #founders-chat-cta:hover {
    box-shadow: 0px 5px 10px rgba(0,0,0,0.067), 0px 15px 30px rgba(0,0,0,0.067), 0px 20px 40px rgba(0,0,0,0.1);
    transform: scale(1.012);
    transition: box-shadow 0.28s ease, transform 0.28s ease;
  }
  .founders-chat-label-short { display: none; }
  .founders-chat-label-full  { display: inline; }
  #founders-chat-cta-icon {
    font-size: 0.72rem;
    opacity: 0.82;
  }
  #founders-hidden-controls {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  #theme-toggle {
    display: inline-flex;
    border: 1px solid rgba(42, 36, 32, 0.1);
    border-radius: 999px;
    overflow: hidden;
    padding: 2px;
    background: rgba(255,255,255,0.34);
  }
  #theme-toggle button {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 0.65rem 0.92rem;
    color: rgba(42, 36, 32, 0.48);
    border-radius: 999px;
  }
  #theme-toggle button.is-active {
    background: #2a2420;
    color: #f5f1df;
  }
  #founders-signout {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.65rem 1rem;
    border-radius: 999px;
    background: rgba(255,255,255,0.34);
    border: 1px solid rgba(42, 36, 32, 0.1);
    color: #2a2420;
    font-size: 0.84rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1;
    cursor: pointer;
  }
  #founders-hero-shell {
    display: grid;
    grid-template-columns: 1.5fr 1fr;
    gap: 64px;
    align-items: center;
  }
  .hero-label,
  .meta-row .label,
  .tile-number,
  .tile-foot {
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .tile-number {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tile-number-right-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .tile-open-modal-btn {
    background: none;
    border: 1px solid rgba(180, 180, 180, 0.7);
    cursor: pointer;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    padding: 5px 10px;
    border-radius: 4px;
    line-height: 1;
    transition: background 0.55s cubic-bezier(0.16, 1, 0.3, 1), color 0.55s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.55s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .tile-open-modal-btn:hover,
  .tile:hover .tile-open-modal-btn {
    background:
      linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%),
      linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    border-color: transparent;
    color: #fff;
    transition: background 0.32s cubic-bezier(0.16, 1, 0.3, 1), color 0.32s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.32s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .hero-label {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 400;
    color: var(--text-secondary);
    margin-bottom: 24px;
  }
  #founders-hero-numeric-shell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 100%;
    min-width: 0;
  }
  #founders-hero-numeric {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(88px, 14vw, 176px);
    line-height: 0.9;
    color: var(--text-display);
    letter-spacing: -0.03em;
    width: 100%;
    min-width: 0;
  }
  #founders-hero-marquee-shell {
    width: 100%;
    overflow: hidden;
    min-width: 0;
    mask-image: linear-gradient(90deg, transparent 0, rgba(0,0,0,0.94) 8%, rgba(0,0,0,0.94) 92%, transparent 100%);
    -webkit-mask-image: linear-gradient(90deg, transparent 0, rgba(0,0,0,0.94) 8%, rgba(0,0,0,0.94) 92%, transparent 100%);
  }
  #founders-hero-marquee-track {
    display: flex;
    align-items: center;
    width: max-content;
    will-change: transform;
    transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    animation: founders-hero-marquee var(--hero-marquee-duration, 16s) linear infinite;
  }
  .founders-hero-marquee-copy {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.2em;
    padding-right: 0.2em;
    white-space: nowrap;
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    line-height: inherit;
    letter-spacing: inherit;
    text-transform: uppercase;
    color: inherit;
  }
  .founders-hero-marquee-sep {
    color: var(--text-disabled);
  }
  @keyframes founders-hero-marquee {
    from { transform: translate3d(0, 0, 0); }
    to { transform: translate3d(calc(-1 * var(--hero-marquee-width, 0px)), 0, 0); }
  }
  #founders-hero-caption {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-top: 28px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  #founders-hero-caption .status-dot,
  .tile-number .power-dot,
  .tile-foot .power-dot,
  .status-live::before {
    border-radius: 999px;
    background: var(--success);
  }
  #founders-hero-caption .status-dot {
    width: 9px;
    height: 9px;
    display: inline-block;
    flex-shrink: 0;
  }
  @keyframes status-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  .status-dot-pulse { animation: status-pulse 1.4s ease-in-out infinite; }
  #founders-hero-meta { display: flex; flex-direction: column; }
  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }
  .meta-row-source {
    display: block;
  }
  .meta-row-source .label {
    display: block;
    margin-bottom: 10px;
  }
  .meta-row-source-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: none;
  }
  .meta-row-source {
    border-bottom: none;
  }
  .meta-row:last-child { border-bottom: none; }
  .meta-row .label { font-size: 0.72rem; color: var(--text-secondary); font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
  .meta-row .value { font-family: var(--font-mono); font-size: clamp(0.82rem, 1.1vw, 0.95rem); color: var(--text-display); flex: 1; text-align: center; }
  #client-meta-row, #account-meta-row, #tier-meta-row { display: flex; align-items: center; gap: 8px; }
  .meta-row-action-btn {
    background: transparent;
    border: 1px solid #000;
    color: #000;
    width: 22px;
    height: 22px;
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .meta-row-action-btn:hover {
    background: #000;
    color: #fff;
    border-color: #000;
  }
  .meta-row-action-btn--danger,
  .meta-row-action-btn--danger:hover {
    /* Kept black-themed to match other action buttons. No red accent. */
  }
  .client-switcher {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }
  .client-switcher-trigger {
    min-height: 22px;
    border: 1px solid #000;
    background: transparent;
    color: #000;
    border-radius: 3px;
    padding: 0 7px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 0.64rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .client-switcher-trigger:hover {
    background: #000;
    color: #fff;
    border-color: #000;
  }
  .client-switcher-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    min-width: 238px;
    max-width: min(320px, 82vw);
    padding: 5px;
    border: 1px solid #000;
    background: rgba(255, 255, 255, 0.98);
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.18);
  }
  .client-switcher-menu button {
    width: 100%;
    border: 0;
    background: transparent;
    color: #111;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 8px 9px;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    text-align: left;
    cursor: pointer;
  }
  .client-switcher-menu button:hover,
  .client-switcher-menu button.active {
    background: #000;
    color: #fff;
  }
  .client-switcher-menu small {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.62;
    font-size: 0.64rem;
  }
  .client-switcher-empty {
    display: block;
    padding: 8px 9px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 0.7rem;
  }
  #tier-trigger-btn {
    /* Icon-only action button — styled via .meta-row-action-btn. No underline. */
    text-decoration: none;
  }
  .meta-value-wrap { font-size: 11px; max-width: 28ch; text-align: right; line-height: 1.4; white-space: normal; }
  #capability-section { padding: 0; }
  #capability-section-shell {
    display: grid;
    grid-template-columns: 1fr 268.336px;
    gap: 12px;
  }
  #capability-grid-col {
    min-width: 0;
    border-radius: 28px;
  }
  #capability-nav-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-radius: 1rem;
  }
  .capability-nav-btn {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: rgba(255, 255, 255, 0.35);
    border: none;
    border-radius: 1rem;
    padding: 14px 18px;
    cursor: pointer;
    text-align: left;
    box-shadow: 0px 0px 0px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22);
    transform: scale(1) translateY(0);
    transition:
      background 0.55s cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 0.55s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
    width: 100%;
    position: relative;
    will-change: transform;
  }
  .capability-nav-btn::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 1rem;
    padding: 1px;
    background: linear-gradient(180deg, rgba(228,228,228,0.9), transparent 62%);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    opacity: 0.85;
    transition: opacity 0.45s ease;
  }
  .capability-nav-btn:hover {
    background: rgba(255, 255, 255, 1);
    box-shadow:
      0px 6px 14px rgba(0,0,0,0.06),
      0px 18px 36px rgba(0,0,0,0.06),
      0px 28px 56px rgba(0,0,0,0.09),
      inset 0 1px 0 rgba(255,255,255,0.55);
    transform: scale(1.02) translateY(-2px);
    transition:
      background 0.32s cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 0.32s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .capability-nav-btn:hover::before {
    background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    opacity: 1;
  }
  .capability-nav-btn:hover .capability-nav-btn-content {
    transform: translateX(5px);
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .capability-nav-btn:hover .capability-nav-btn-icon-wrap {
    transform: scale(1.12);
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .capability-nav-btn:active {
    transform: scale(0.98) translateY(0);
    box-shadow:
      0px 2px 6px rgba(0,0,0,0.05),
      0px 6px 12px rgba(0,0,0,0.05),
      inset 0 1px 0 rgba(255,255,255,0.35);
    transition:
      transform 0.12s cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 0.12s ease;
  }
  .capability-nav-btn:active .capability-nav-btn-content {
    transform: translateX(2px);
    transition: transform 0.12s ease;
  }
  .capability-nav-btn--active {
    background: rgba(255, 255, 255, 1);
    box-shadow:
      0px 6px 14px rgba(0,0,0,0.06),
      0px 18px 36px rgba(0,0,0,0.06),
      0px 28px 56px rgba(0,0,0,0.09),
      inset 0 1px 0 rgba(255,255,255,0.55);
    transition:
      background 0.32s cubic-bezier(0.16, 1, 0.3, 1) 0.15s,
      box-shadow 0.32s cubic-bezier(0.16, 1, 0.3, 1) 0.15s,
      transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s;
  }
  .capability-nav-btn--active::before {
    background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    opacity: 1;
  }
  .capability-nav-btn--active .capability-nav-btn-content {
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s;
  }
  /* Dim active item whenever the nav container is hovered (prevents flash between buttons) */
  #capability-nav-col:hover .capability-nav-btn--active {
    background: rgba(255, 255, 255, 0.35);
    box-shadow: 0px 0px 0px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22);
    transform: scale(1) translateY(0);
    transition:
      background 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0s,
      box-shadow 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0s,
      transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) 0s;
  }
  #capability-nav-col:hover .capability-nav-btn--active::before {
    background: linear-gradient(180deg, rgba(228,228,228,0.9), transparent 62%);
    opacity: 0.85;
  }
  #capability-nav-col:hover .capability-nav-btn--active:hover {
    background: rgba(255, 255, 255, 1);
    box-shadow:
      0px 6px 14px rgba(0,0,0,0.06),
      0px 18px 36px rgba(0,0,0,0.06),
      0px 28px 56px rgba(0,0,0,0.09),
      inset 0 1px 0 rgba(255,255,255,0.55);
    transform: scale(1.02) translateY(-2px);
    transition:
      background 0.32s cubic-bezier(0.16, 1, 0.3, 1),
      box-shadow 0.32s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  #capability-nav-col:hover .capability-nav-btn--active:hover .capability-nav-btn-content {
    transform: translateX(5px);
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .capability-nav-btn--locked {
    opacity: 0.32;
    cursor: not-allowed;
    pointer-events: none;
  }
  .capability-nav-btn--locked .capability-nav-btn-icon-wrap {
    filter: grayscale(1);
  }
  #capability-nav-col:hover .capability-nav-btn--active:hover .capability-nav-btn-icon-wrap {
    transform: scale(1.12);
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .capability-nav-btn--active:hover::before {
    background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    opacity: 1;
  }
  #capability-nav-col:hover .capability-nav-btn--active .capability-nav-btn-content {
    transform: translateX(0);
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) 0s;
  }
  .capability-nav-btn-icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    margin-left: auto;
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .capability-nav-btn-icon-wrap svg {
    width: 18px;
    height: 18px;
  }
  .capability-nav-btn-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    position: relative;
    z-index: 1;
    transform: translateX(0);
    transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .capability-nav-btn-label {
    font-size: clamp(0.8rem, 1.1vw, 0.875rem);
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--text-display);
    line-height: 1.15;
  }
  .capability-nav-btn-label-short { display: none; }
  .capability-nav-btn-sub {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    line-height: 1.2;
  }
  #capability-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: minmax(470px, auto);
    gap: 1px;
    border: 1px solid rgba(42, 36, 32, 0.1);
    border-radius: 28px;
    overflow: hidden;
    isolation: isolate;
  }
  .tile {
    aspect-ratio: 16 / 9;
    background: var(--surface);
    padding: 20px;
    display: grid;
    grid-template-areas:
      "num num"
      "head viz"
      "desc viz"
      "foot foot";
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    grid-template-rows: auto auto auto 1fr;
    column-gap: 20px;
    row-gap: 4px;
    overflow: hidden;
  }
  .tile-preview {
    opacity: 1;
  }
  .tile-intake-card {
    aspect-ratio: auto;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .tile-intake-card > .tile-number,
  .tile-intake-card > .tile-foot {
    align-self: stretch;
    width: 100%;
  }
  .tile-intake-card > .tile-foot {
    margin-top: auto;
  }
  .tile-intake-card--wide {
    grid-column: 1 / -1;
  }
  .tile-intake-card--wide .tile-intake-placeholder {
    aspect-ratio: auto;
    height: 220px;
  }
  .tr--section-header td {
    padding-top: 14px;
    padding-bottom: 3px;
    font-size: 9px;
    letter-spacing: 0.12em;
    color: var(--text-secondary);
    border-top: 1px solid var(--border);
    text-transform: uppercase;
  }
  .tr--section-header:first-child td {
    border-top: none;
    padding-top: 0;
  }
  .tr--flag td:first-child {
    border-left: 2px solid #d05;
    padding-left: 6px;
  }
  [data-dashboard-theme="light"] .tr--flag td:first-child {
    border-left-color: #c03;
  }
  .tile-intake-placeholder {
    position: relative;
    width: 100%;
    height: auto;
    aspect-ratio: 1536 / 1024;
    border-radius: 12px;
    border: 1px solid rgba(42, 36, 32, 0.1);
    background:
      linear-gradient(135deg, rgba(255,255,255,0.75), rgba(255,255,255,0.22)),
      linear-gradient(135deg, rgba(93, 201, 184, 0.24), rgba(156, 129, 225, 0.22) 55%, rgba(240, 114, 185, 0.18));
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.45);
    overflow: hidden;
  }
	  .tile-intake-placeholder-style-guide {
	    align-items: stretch;
	    justify-content: stretch;
	    padding: 0;
	    font-family: 'Doto', var(--font-mono);
	    font-size: clamp(14px, 1.4vw, 20px);
	  }
	  .tile-intake-placeholder-visual-dna {
	    background:
	      radial-gradient(circle at 24% 24%, rgba(245, 158, 11, 0.26), transparent 32%),
	      radial-gradient(circle at 72% 70%, rgba(20, 184, 166, 0.22), transparent 34%),
	      linear-gradient(135deg, rgba(255,255,255,0.82), rgba(255,255,255,0.28));
	  }
	  #visual-dna-card-preview {
	    display: flex;
	    flex-direction: column;
	    align-items: center;
	    justify-content: center;
	    gap: 8px;
	    color: rgba(42,36,32,0.64);
	  }
  /* Brief tile — miniaturized iframe preview of the full brief document.
     Render iframe at 4x the tile size, scale to 25% via transform to fit. */
  .tile-intake-placeholder-brief {
    align-items: stretch;
    justify-content: stretch;
    padding: 0;
    position: relative;
  }
  /* Audit fullscreen modal */
  #audit-fullscreen-overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(8px);
  }
  #audit-fullscreen-container {
    width: 90vw;
    height: 90vh;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
  }
  #audit-fullscreen-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    border-bottom: 1px solid rgba(42, 36, 32, 0.08);
    flex-shrink: 0;
  }
  #audit-fullscreen-title {
    font-family: var(--font-ui);
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    color: #2a2420;
  }
  #audit-fullscreen-close {
    background: none;
    border: 1px solid rgba(42, 36, 32, 0.1);
    border-radius: 4px;
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    cursor: pointer;
    color: var(--text-secondary);
    line-height: 1;
  }
  #audit-fullscreen-close:hover {
    background: #2a2420;
    color: #fff;
    border-color: #2a2420;
  }
  #audit-fullscreen-rows {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
  }
  /* Embedded pricing in grid */
  #pricing-embed-container {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    min-height: 80vh;
  }
  #pricing-embed-iframe {
    flex: 1;
    width: 100%;
    min-height: 80vh;
    border: none;
    background: #fff;
  }
  /* Embedded brief in grid */
  #brief-embed-container {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    background: transparent;
    border-radius: 16px;
    overflow: hidden;
    min-height: 70vh;
  }
  #brief-embed-header {
    display: flex;
    justify-content: flex-start;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid rgba(42, 36, 32, 0.08);
    background: rgba(250, 248, 243, 0.6);
  }
  .brief-embed-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    text-decoration: none;
    padding: 5px 10px;
    border: 1px solid rgba(42, 36, 32, 0.1);
    border-radius: 4px;
    background: none;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  }
  .brief-embed-btn:hover {
    background: #2a2420;
    color: #fff;
    border-color: #2a2420;
  }
  #brief-embed-iframe {
    flex: 1;
    width: 100%;
    min-height: 65vh;
    border: none;
    background: #fff;
  }
  @keyframes briefSpin {
    to { transform: rotate(360deg); }
  }
  .brief-loader {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }
  .brief-loader-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(42, 36, 32, 0.1);
    border-top-color: rgba(42, 36, 32, 0.5);
    border-radius: 50%;
    animation: briefSpin 0.8s linear infinite;
  }
  #brief-embed-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 300px;
  }
  /* Full-page brief overlay */
  #brief-fullscreen-overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(8px);
  }
  #brief-fullscreen-container {
    width: 90vw;
    height: 90vh;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3);
  }
  #brief-fullscreen-actions {
    position: absolute;
    top: 12px;
    right: 16px;
    z-index: 10;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  #brief-fullscreen-download,
  #brief-fullscreen-close {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(42, 36, 32, 0.15);
    border-radius: 6px;
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    color: #2a2420;
    text-decoration: none;
  }
  #brief-fullscreen-download:hover,
  #brief-fullscreen-close:hover {
    background: #2a2420;
    color: #fff;
  }
  #brief-fullscreen-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
  }
  .tile-brief-preview {
    position: absolute;
    top: 0;
    left: 0;
    width: 400%;
    height: 400%;
    border: none;
    background: transparent;
    transform: scale(0.25);
    transform-origin: top left;
    pointer-events: none;
    /* Browsers throttle off-screen iframes, but this keeps it crisp when visible. */
    image-rendering: -webkit-optimize-contrast;
  }
  .tile-intake-placeholder-industry {
    background:
      linear-gradient(135deg, rgba(255,255,255,0.78), rgba(255,255,255,0.24)),
      linear-gradient(135deg, rgba(182, 212, 137, 0.22), rgba(126, 188, 242, 0.2) 50%, rgba(244, 195, 120, 0.18));
  }
  .tile-intake-placeholder-business-model {
    background:
      linear-gradient(135deg, rgba(255,255,255,0.8), rgba(255,255,255,0.22)),
      linear-gradient(135deg, rgba(255, 208, 132, 0.18), rgba(243, 162, 186, 0.18) 48%, rgba(150, 184, 244, 0.18));
  }
  .tile-intake-placeholder-priority-signal {
    background:
      linear-gradient(135deg, rgba(255,255,255,0.78), rgba(255,255,255,0.24)),
      linear-gradient(135deg, rgba(125, 214, 184, 0.22), rgba(126, 188, 242, 0.2) 48%, rgba(255, 208, 132, 0.18));
  }
  .tile-intake-placeholder-draft-post {
    background:
      linear-gradient(135deg, rgba(255,255,255,0.8), rgba(255,255,255,0.22)),
      linear-gradient(135deg, rgba(242, 186, 118, 0.2), rgba(246, 138, 177, 0.18) 50%, rgba(162, 141, 236, 0.18));
    padding: clamp(14px, 3.5%, 28px);
  }
  .tile-intake-placeholder-draft-post > * {
    max-width: 100%;
    max-height: 100%;
  }
  .tile-blocked { position: relative; }
  .tile-blocked .tile-number,
  .tile-blocked .tile-foot {
    position: relative;
    z-index: 5;
  }
  .tile-blocked-overlay {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 4;
    border-radius: inherit;
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 0;
    background: rgba(255, 252, 248, 0.38);
    backdrop-filter: blur(14px) saturate(118%);
    -webkit-backdrop-filter: blur(14px) saturate(118%);
    border: 1px solid rgba(42, 36, 32, 0.08);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);
    -webkit-mask-image: linear-gradient(to bottom,
      transparent 0,
      transparent 44px,
      #000 64px,
      #000 calc(100% - 52px),
      transparent calc(100% - 32px),
      transparent 100%);
    mask-image: linear-gradient(to bottom,
      transparent 0,
      transparent 44px,
      #000 64px,
      #000 calc(100% - 52px),
      transparent calc(100% - 32px),
      transparent 100%);
  }
  .tile-blocked-inner {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    /* top padding approximates: tile-number strip (~24px) + gap (12px)
       + placeholder height (66.67% of width from aspect-ratio 1536/1024)
       + gap (12px) — so content lands where the live card's heading sits */
    padding: calc(66.67% + 48px) 16px 16px;
    text-align: left;
    gap: 10px;
    width: 100%;
    max-width: 100%;
  }
  .tile-blocked-title {
    margin: 0;
    max-width: 36ch;
  }
  .tile-blocked-description {
    margin: 0;
    max-width: 52ch;
    opacity: 0.82;
  }
  .tile-blocked-upgrade-btn {
    appearance: none;
    border: none;
    background: linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    color: #ffffff;
    font-family: "Space Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 10px 18px;
    border-radius: 999px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1);
    transition: transform 0.18s ease, opacity 0.18s ease, box-shadow 0.18s ease;
  }
  .tile-blocked-upgrade-btn:hover {
    opacity: 0.9;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(0,0,0,0.25);
  }
  [data-dashboard-theme="dark"] .tile-blocked-overlay {
    background: rgba(22, 20, 18, 0.42);
    border-color: rgba(255,255,255,0.08);
  }
  [data-dashboard-theme="dark"] .tile-blocked-title { color: #faf7f2; }
  [data-dashboard-theme="dark"] .tile-blocked-upgrade-btn {
    background: rgba(22, 20, 18, 0.72);
    color: #faf7f2;
    border-color: transparent;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
  }
  [data-dashboard-theme="dark"] .tile-blocked-upgrade-btn:hover {
    background: rgba(22, 20, 18, 0.88);
    color: #faf7f2;
  }
  .tile-intake-placeholder-content-angle {
    background:
      linear-gradient(135deg, rgba(255,255,255,0.78), rgba(255,255,255,0.22)),
      linear-gradient(135deg, rgba(114, 205, 214, 0.2), rgba(148, 191, 244, 0.2) 52%, rgba(191, 164, 245, 0.18));
  }
  .tile-intake-placeholder-content-opportunities {
    background:
      linear-gradient(135deg, rgba(255,255,255,0.8), rgba(255,255,255,0.22)),
      linear-gradient(135deg, rgba(129, 210, 178, 0.2), rgba(242, 202, 127, 0.18) 50%, rgba(152, 183, 244, 0.18));
  }
  .tile-intake-placeholder-seo-performance {
    align-items: stretch;
    justify-content: stretch;
    padding: 0;
  }
  .tile-intake-placeholder-brand-tone {
    align-items: stretch;
    justify-content: stretch;
    padding: 0;
  }
  /* Any placeholder variant that stretches for rich previews must re-center
     when the fallback empty label renders instead. Single rule covers all
     stretch variants (style-guide, brief, seo-performance, brand-tone). */
  .tile-intake-placeholder:has(.tile-empty-label) {
    align-items: center !important;
    justify-content: center !important;
  }
  #bt-preview-shell,
  #bi-preview-shell,
  #de-preview-shell {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #bi-hero-image,
  #de-hero-image {
    width: 100%;
    height: auto;
    object-fit: contain;
    object-position: center top;
  }
  #bt-og-image {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    object-position: center;
  }
  #bt-favicon {
    position: absolute;
    bottom: 10px;
    right: 10px;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: rgba(255,255,255,0.9);
    box-shadow: 0 1px 6px rgba(0,0,0,0.18);
    object-fit: contain;
    padding: 3px;
  }
  .tile-intake-placeholder span {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(42,36,32,0.52);
  }
  /* Big empty-state label — renders like the brief's dot-font headline
     when no preview data exists for a card. Two-line labels use \n in the
     string + white-space: pre-line to break naturally. */
  .tile-intake-placeholder .tile-empty-label {
    font-family: 'Doto', var(--font-mono);
    font-size: 44px;
    font-size: clamp(22px, 9cqi, 44px);
    font-weight: 900;
    letter-spacing: 0.04em;
    line-height: 1.08;
    text-transform: uppercase;
    color: #2a2420;
    text-align: center;
    white-space: normal;
    text-wrap: balance;
    padding: clamp(10px, 4%, 24px);
    max-width: 92%;
    word-break: normal;
    overflow-wrap: break-word;
    container-type: normal;
  }
  .tile-intake-placeholder {
    container-type: inline-size;
  }
  /* All images + iframes inside card shells and modals fade in on load */
  @keyframes tileFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .tile-intake-placeholder img,
  .tile-intake-placeholder iframe,
  .tile-detail-bento-placeholder img,
  .tile-detail-bento-placeholder iframe,
  .tile-detail-tab-pane img,
  #brief-embed-iframe,
  #bi-hero-image,
  #bt-og-image,
  #sg-brand-mark-img {
    animation: tileFadeIn 0.8s ease-out both;
  }
  .tile-intake-mockup-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
  }
  .tile-intake-mockup-wrap,
  .tile-brief-preview-wrap {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 12px;
    padding: 2px;
    position: relative;
    overflow: hidden;
    background: transparent;
  }
  .tile-intake-mockup-wrap::before,
  .tile-brief-preview-wrap::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    opacity: 0;
    transition: opacity 1.1s cubic-bezier(0.16, 1, 0.3, 1);
    z-index: 0;
  }
  .tile:hover .tile-intake-mockup-wrap::before,
  .tile:hover .tile-brief-preview-wrap::before {
    opacity: 1;
    transition: opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .tile:hover .tile-intake-placeholder-intake-terminal .tile-intake-mockup-wrap::before,
  .tile:hover .tile-intake-placeholder-multi-device-view .tile-intake-mockup-wrap::before {
    opacity: 0;
  }
  .tile-intake-mockup-wrap img,
  .tile-brief-preview-wrap iframe {
    position: relative;
    z-index: 1;
    border-radius: 10px;
    display: block;
    width: 100%;
    height: 100%;
  }

  /* ── Style Guide Preview ── */
  #sg-preview-shell,
  .sg-preview {
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    overflow: hidden;
    position: relative;
    box-sizing: border-box;
  }
  /* Brand mark quadrant — replaces the layout quadrant (bottom-left) when
     a logo/favicon is available. Background is a palette color. */
  .sg-q-brand-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    container-type: inline-size;
  }
  .sg-no-logo,
  .sg-no-data {
    font-family: 'Doto', var(--font-mono);
    /* Target 20px, scale up/down with the quadrant's width. */
    font-size: 20px;
    font-size: clamp(12px, 9cqw, 32px);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: rgba(42, 36, 32, 0.22);
    text-align: center;
    line-height: 1;
    white-space: nowrap;
    padding: 4px;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #sg-brand-mark-img {
    width: 50%;
    max-width: 80px;
    height: auto;
    object-fit: contain;
    border-radius: 8px;
  }
  .sg-demo-watermark {
    position: absolute;
    top: 8px;
    right: 10px;
    font-family: var(--font-mono);
    font-size: 6px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(42,36,32,0.35);
    background: rgba(255,255,255,0.55);
    border: 1px solid rgba(42,36,32,0.12);
    border-radius: 2px;
    padding: 2px 4px;
    z-index: 2;
    pointer-events: none;
  }
  .sg-quad {
    overflow: hidden;
    box-sizing: border-box;
    container-type: inline-size;
  }

  /* TYPE — top-left */
  .sg-q-type {
    border-right: 1px solid rgba(42,36,32,0.1);
    border-bottom: 1px solid rgba(42,36,32,0.1);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    gap: 5px;
  }
  .sg-h1 {
    margin: 0;
    font-size: 19px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.025em;
    color: rgba(42,36,32,0.9);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .sg-p {
    margin: 0;
    font-size: 8px;
    line-height: 1.55;
    color: rgba(42,36,32,0.52);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  /* COLOR — top-right, full-bleed equal bands */
  .sg-q-color {
    border-bottom: 1px solid rgba(42,36,32,0.1);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sg-swatch {
    flex: 1;
    width: 100%;
    min-height: 0;
    /* Prevent near-white swatches from disappearing against the card bg */
    box-shadow: inset 0 0 0 1px rgba(42, 36, 32, 0.08);
  }

  /* LAYOUT — bottom-left: viewport-resize grid demo */
  .sg-q-layout {
    border-right: 1px solid rgba(42,36,32,0.1);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 6px;
    overflow: hidden;
  }
  .sg-rg {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 0;
    overflow: hidden;
    /* Device-frame border to sell the "viewport" metaphor */
    border: 1px solid rgba(42,36,32,0.22);
    border-radius: 3px;
    /* GSAP animates width: 100% → 36% — flex-wrap then causes column reflow */
  }
  .sg-rg-nav {
    height: 7px;
    background: rgba(42,36,32,0.28);
    border-radius: 2px 2px 0 0;
    flex-shrink: 0;
  }
  .sg-rg-cols {
    flex: 1;
    display: flex;
    flex-wrap: wrap;        /* columns reflow naturally as frame narrows */
    align-content: stretch; /* rows share height equally; clipped rows stay hidden */
    gap: 3px;
    padding: 4px;
    overflow: hidden;
    min-height: 0;
  }
  .sg-rg-col {
    /* flex-basis = --sg-col-min-w; at desktop all N cols fit in 1 row;
       at mobile (36% width) each col can't share a row → wraps to stacked */
    flex: 1 1 var(--sg-col-min-w, 30px);
    min-width: var(--sg-col-min-w, 30px);
    background: rgba(42,36,32,0.1);
    border-radius: 1px;
    min-height: 12px;
  }
  /* card-based / boxed framing: blocks look like cards */
  .sg-rg-col--card {
    background: rgba(255,255,255,0.55);
    border: 1px solid rgba(42,36,32,0.12);
  }
  /* full-bleed: nav bar goes edge-to-edge, no margin */
  .sg-rg--fullbleed .sg-rg-nav { border-radius: 0; }
  .sg-grid-label {
    font-family: var(--font-mono);
    font-size: 6.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(42,36,32,0.4);
    flex-shrink: 0;
  }

  /* MOTION — bottom-right: full-bleed easing curve + meta row */
  .sg-q-motion {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .sg-ease-svg {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: block;
    overflow: visible;
  }
  .sg-motion-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .sg-motion-tech,
  .sg-motion-easing,
  .sg-motion-dur {
    font-family: var(--font-mono);
    font-size: 6.5px;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: rgba(42,36,32,0.45);
  }
  .sg-motion-sep {
    font-family: var(--font-mono);
    font-size: 6.5px;
    color: rgba(42,36,32,0.22);
  }

  /* Empty state */
  .sg-empty {
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 16px;
  }
  .sg-empty-label {
    font-family: var(--font-mono);
    font-size: 7px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(42,36,32,0.38);
  }
  .sg-empty-msg {
    font-size: 7px;
    color: rgba(42,36,32,0.42);
    text-align: center;
    letter-spacing: 0.04em;
    line-height: 1.4;
  }
  .tile-intake-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    flex: 1;
    position: relative;
  }
  .tile-intake-heading {
    grid-area: auto;
    margin: 0;
  }
  .tile-intake-source-line {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-disabled);
    margin-top: 2px;
    margin-bottom: 4px;
  }
  .tile-intake-description {
    grid-area: auto;
    margin-top: 0;
    max-width: none;
  }
  .tile-readiness-tag {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 3px;
    margin-right: 6px;
    margin-bottom: 2px;
    vertical-align: middle;
  }
  .tile-readiness-tag.readiness-critical {
    background: rgba(236, 72, 153, 0.22);
    color: hsl(314, 85%, 32%);
  }
  .tile-readiness-tag.readiness-partial {
    /* Matches the footer Partial dot (#f59e0b) so the card-level status and
       the footer status read as the same state. */
    background: rgba(245, 158, 11, 0.22);
    color: hsl(32, 92%, 28%);
  }
  .tile-readiness-tag.readiness-healthy {
    background: rgba(139, 92, 246, 0.22);
    color: hsl(262, 80%, 32%);
  }
  .tile-readiness-tag.readiness-ok {
    background: rgba(34, 197, 94, 0.18);
    color: hsl(142, 72%, 29%);
  }
  .tile-readiness-tag.readiness-locked,
  .tile-readiness-tag.readiness-run-modal {
    background: rgba(107, 114, 128, 0.18);
    color: rgba(55, 65, 81, 0.95);
    letter-spacing: 0.1em;
  }
  .tile-view-details-btn.tile-view-details-btn--disabled,
  .tile-view-details-btn[disabled] {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
    background: #fff;
    border-color: rgba(0, 0, 0, 0.4);
    color: rgba(0, 0, 0, 0.55);
  }
  .tile-intake-table-wrap {
    margin-top: 2px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    overflow: hidden;
  }
  .tile-intake-table {
    width: 100%;
    border-collapse: collapse;
    font-size: clamp(0.82rem, 1.1vw, 0.95rem);
    table-layout: fixed;
  }
  .tile-intake-table th {
    text-align: left;
    padding: 0 6px 8px 0;
    font-weight: 600;
    color: rgba(42,36,32,0.42);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-family: var(--font-mono);
    border-bottom: 1px solid var(--border);
  }
  .tile-intake-table th:last-child,
  .tile-intake-table td:last-child {
    padding-right: 0;
  }
  .tile-intake-table td {
    padding: 8px 6px 8px 0;
    color: var(--text-display);
    border-bottom: 1px solid rgba(42,36,32,0.08);
    vertical-align: top;
    line-height: 1.45;
    word-break: break-word;
  }
  .tile-intake-table td:first-child {
    width: 88px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tile-intake-table tr:last-child td {
    border-bottom: none;
  }
  /* ── Card compact tease ── */
  .tile-intake-card {
    cursor: pointer;
  }
  .tile-download-btn {
    background: none;
    border: 1px solid #000;
    cursor: pointer;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #000;
    padding: 5px 10px;
    border-radius: 4px;
    line-height: 1;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .tile-download-btn:hover {
    background: #000;
    color: #fff;
  }
  .tile:has(.tile-download-btn:hover) .tile-open-modal-btn {
    background: none;
    border-color: rgba(180, 180, 180, 0.7);
    color: var(--text-secondary);
  }
  .tile:has(.tile-download-btn:hover) .tile-view-details-btn {
    background: #fff;
    border-color: #000;
    color: #000;
  }
  .tile-view-details-btn {
    background: #fff;
    border: 1px solid #000;
    cursor: pointer;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #000;
    padding: 5px 10px;
    border-radius: 4px;
    line-height: 1;
    transition: background 0.55s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.55s cubic-bezier(0.16, 1, 0.3, 1), color 0.55s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .tile-view-details-btn:hover,
  /* Card-level hover styles Details, but exclude the case where the cursor
     is specifically on the Retry button so the retry hover doesn't bleed
     into the Details button. */
  .tile:hover:not(:has(.tile-foot-rerun-btn:hover)) .tile-view-details-btn {
    background: #2a2420;
    border-color: #2a2420;
    color: #fff;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }
  /* Locked cards — standard placeholder bg, no shell content, lock icon
     centered, card dimmed, no hover effects. */
  .tile.tile-intake-card--locked {
    cursor: not-allowed;
    pointer-events: auto;
    opacity: 0.5;
  }
  .tile.tile-intake-card--locked:hover { opacity: 0.5; }
  .tile-foot-unlock-btn {
    pointer-events: auto;
    cursor: pointer;
  }
  .tile-intake-placeholder--locked {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tile-intake-lock-overlay {
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .tile-intake-lock-icon {
    color: rgba(0, 0, 0, 0.55);
  }

  /* Survey card — avatar placeholder */
  #survey-status-avatar-shell {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  #survey-status-avatar-img {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
    flex-shrink: 0;
  }
  #survey-status-brand-favicon {
    width: 56px;
    height: 56px;
    border-radius: 0;
    object-fit: contain;
    display: block;
    flex-shrink: 0;
  }

  /* Inactive-but-unlocked cards (Run visible, not yet executed) — kill the
     card-level hover effects only. Buttons stay fully interactive so RUN
     actually fires and Details can still reject clicks via its disabled prop. */
  .tile.tile-intake-card--inactive { cursor: default; }
  .tile.tile-intake-card--inactive:hover { transform: none; box-shadow: none; }
  .tile.tile-intake-card--inactive:hover .tile-view-details-btn:not(:hover) {
    background: #fff;
    border-color: rgba(0, 0, 0, 0.4);
    color: rgba(0, 0, 0, 0.55);
  }
  /* New-user dimmed cards: 60% opacity, full on hover */
  .tile.tile-intake-card--dimmed {
    opacity: 0.4;
    transition: opacity 0.3s ease;
    pointer-events: auto;
  }
  /* Override --btns-only's pointer-events: none so hover fires */
  .tile.tile-intake-card--btns-only.tile-intake-card--dimmed {
    pointer-events: auto;
  }
  .tile.tile-intake-card--dimmed:hover {
    opacity: 1;
  }
  /* Details button: suppress card-hover activation, only activates on direct hover */
  .tile.tile-intake-card--dimmed:hover .tile-view-details-btn:not(:hover) {
    background: #fff;
    border-color: #000;
    color: #000;
  }
  /* Run button: only activates on direct hover */
  .tile-foot-rerun-btn:not(:disabled):hover {
    background: #2a2420;
    border-color: #2a2420;
    color: #fff;
  }
  /* Cards with both RUN + DETAILS: kill all card-level hover; buttons handle their own hover */
  .tile.tile-intake-card--btns-only {
    cursor: default;
    pointer-events: none;
  }
  .tile.tile-intake-card--btns-only .tile-foot-rerun-btn,
  .tile.tile-intake-card--btns-only .tile-view-details-btn {
    pointer-events: auto;
  }
  /* ── Global card-hover override: every intake/data-viz card renders at full
        opacity with no card-level hover state. Direct button :hover (Run,
        Details, download, etc.) still works because those rules don't depend
        on the parent .tile:hover selector. ──────────────────────────────── */
  .tile.tile-intake-card,
  .tile.tile-intake-card--dimmed,
  .tile.tile-intake-card--locked,
  .tile.tile-intake-card--inactive,
  .tile.tile-intake-card--btns-only {
    opacity: 1 !important;
  }
  .tile.tile-intake-card:hover,
  .tile.tile-intake-card--dimmed:hover,
  .tile.tile-intake-card--locked:hover,
  .tile.tile-intake-card--inactive:hover,
  .tile.tile-intake-card--btns-only:hover {
    opacity: 1 !important;
    transform: none !important;
    box-shadow: none !important;
  }
  /* Cancel card-hover-driven children effects (Details btn dark fill, mockup
     darkening overlays). Direct btn :hover rules elsewhere are unaffected. */
  .tile.tile-intake-card:hover .tile-view-details-btn:not(:hover) {
    background: #fff;
    border-color: rgba(0, 0, 0, 0.4);
    color: rgba(0, 0, 0, 0.55);
  }
  .tile.tile-intake-card:hover .tile-intake-mockup-wrap::before,
  .tile.tile-intake-card:hover .tile-brief-preview-wrap::before {
    opacity: 0;
  }
  .tile-foot-rerun-btn {
    background: #fff;
    border: 1px solid #000;
    cursor: pointer;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #000;
    padding: 5px 10px;
    border-radius: 4px;
    line-height: 1;
  }
  .tile-foot-rerun-btn:disabled {
    cursor: not-allowed;
    opacity: 0.35;
    background: #fff;
    border-color: rgba(0,0,0,0.4);
    color: rgba(0,0,0,0.55);
  }
  .tile-blocked-upgrade-btn::before {
    display: none;
  }
  /* ── Tile detail modal — bento layout ── */
  #tile-detail-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    z-index: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  /* Layout shell — transparent, no surface, just sizes + spaces cells */
  #tile-detail-modal-card {
    width: 100%;
    height: 100%;
    max-width: 1280px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: hidden;
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0;
  }
  /* Shared bento cell surface */
  .tile-detail-bento-cell {
    background: #fff;
    border: 1px solid rgba(42, 36, 32, 0.1);
    border-radius: 1rem;
    box-sizing: border-box;
    box-shadow: 0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15);
  }
  /* Header cell */
  #tile-detail-modal-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    flex-shrink: 0;
    box-shadow: none;
  }
  #tile-detail-modal-header-main {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    flex-wrap: wrap;
  }
  #tile-detail-modal-eyebrow {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  #tile-detail-modal-number {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--text-disabled);
    text-transform: uppercase;
  }
  #tile-detail-modal-title {
    font-family: var(--font-ui);
    font-size: clamp(1rem, 1.6vw, 1.2rem);
    font-weight: 700;
    margin: 0;
    color: var(--text-display);
    line-height: 1.2;
    flex: 1;
    letter-spacing: -0.03em;
  }
  #tile-detail-modal-close {
    background: none;
    border: 1px solid rgba(42, 36, 32, 0.1);
    cursor: pointer;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    padding: 5px 10px;
    border-radius: 4px;
    flex-shrink: 0;
    line-height: 1;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  #tile-detail-modal-close:hover {
    color: var(--text-display);
    border-color: var(--text-secondary);
  }
  /* Bento grid — image left, right column, 12px gap */
  #tile-detail-bento-grid {
    display: grid;
    grid-template-columns: 40% 1fr;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }
  #tile-detail-bento-grid,
  #tile-detail-bento-grid * {
    box-shadow: none !important;
  }
  /* Image cell — chat with Bryan */
  #tile-detail-bento-image-cell {
    align-self: stretch;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px 22px;
    flex: 1;
    min-height: 0;
  }
  .tile-detail-bento-placeholder {
    aspect-ratio: 3 / 2 !important;
    border-radius: calc(1rem - 1px) !important;
    border: none !important;
    flex-shrink: 0;
    width: 100%;
    height: auto;
  }
  /* Right column — about + data stacked, 12px gap, each independently scrollable */
  #tile-detail-bento-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow: hidden;
  }
  /* About cell — scrollable if description is very long */
  #tile-detail-bento-about .tile-intake-heading {
    margin: 0 0 8px 0;
  }
  #tile-detail-bento-about {
    padding: 18px 20px 20px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  /* Data cell — fills remaining height, independently scrollable */
  #tile-detail-bento-data {
    padding: 18px 20px 22px;
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  #tile-detail-chat-header {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  #tile-detail-chat-avatar-wrap {
    position: relative;
    flex-shrink: 0;
  }
  #tile-detail-chat-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
    border: 2px solid rgba(255,255,255,0.6);
  }
  #tile-detail-chat-status-dot {
    position: absolute;
    bottom: 1px;
    right: 1px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #22c55e;
    border: 2px solid #fff;
  }
  #tile-detail-chat-identity {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  #tile-detail-chat-name {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-display);
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  .tile-detail-chat-toggle {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgba(42,36,32,0.15);
    border-radius: 999px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .tile-detail-chat-toggle-btn {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease;
  }
  .tile-detail-chat-toggle-btn--active {
    background: rgba(42,36,32,0.08);
    color: var(--text-primary);
  }
  .tile-detail-chat-toggle-btn:hover:not(.tile-detail-chat-toggle-btn--active) {
    color: var(--text-primary);
    background: rgba(42,36,32,0.04);
  }
  #tile-detail-chat-bot-msg {
    display: flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    background: rgba(42, 36, 32, 0.06);
    border-radius: 1rem;
    padding: 10px 14px;
    max-width: 85%;
    margin-top: 16px;
  }
  #tile-detail-chat-bot-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #22c55e;
    flex-shrink: 0;
  }
  #tile-detail-chat-bot-text {
    font-size: 0.82rem;
    color: var(--text-display);
    line-height: 1.4;
  }
  #tile-detail-chat-input-row {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  #tile-detail-chat-input {
    flex: 1;
    min-width: 0;
    padding: 11px 16px;
    border-radius: 999px;
    border: 1px solid rgba(42,36,32,0.14);
    background: rgba(255,255,255,0.55);
    font-size: 0.88rem;
    color: var(--text-display);
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s ease;
  }
  #tile-detail-chat-input:focus {
    border-color: rgba(42,36,32,0.35);
    background: #fff;
  }
  #tile-detail-chat-input::placeholder {
    color: var(--text-disabled);
  }
  #tile-detail-chat-send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    width: 2.4rem;
    height: 2.4rem;
    padding: 0;
    border-radius: 999px;
    border: none;
    background: var(--text-primary);
    color: #fff;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  #tile-detail-chat-send-btn:hover:not(:disabled) {
    opacity: 0.85;
    transform: scale(1.02);
  }
  #tile-detail-chat-send-avatar {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    object-fit: cover;
    display: block;
    border: 2px solid rgba(255,255,255,0.35);
    flex-shrink: 0;
  }
  .tile-detail-chat--inactive {
    display: flex;
    flex-direction: column;
    gap: 12px;
    opacity: 0.55;
    filter: grayscale(0.35);
    user-select: none;
  }
  .tile-detail-chat-status-dot--inactive {
    background: #9ca3af !important;
    border-color: rgba(255,255,255,0.8) !important;
  }
  .tile-detail-chat-bot-dot--inactive {
    background: #9ca3af !important;
  }
  .tile-detail-chat--inactive #tile-detail-chat-input {
    background: rgba(255,255,255,0.55);
    border-color: rgba(42,36,32,0.12);
    color: var(--text-disabled);
  }
  .tile-detail-chat--inactive #tile-detail-chat-send-btn {
    opacity: 0.5;
  }
  /* ── Mobile: vertical single column ── */
  @media (max-width: 680px) {
    #tile-detail-modal-overlay {
      padding: 12px;
      align-items: flex-start;
    }
    #tile-detail-modal-card {
      height: auto;
      max-height: calc(100dvh - 24px);
      gap: 10px;
      overflow-y: auto;
    }
    #tile-detail-bento-grid {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
      gap: 10px;
      flex: none;
      overflow: visible;
    }
    #tile-detail-bento-image-cell {
      flex: none;
      min-height: 0;
      align-self: auto;
      width: 100%;
      padding: 12px 14px;
      overflow: hidden;
    }
    #tile-detail-bento-image-cell .tile-detail-bento-placeholder {
      width: 100%;
      height: auto;
      max-height: 42dvh;
      object-fit: contain;
    }
    #tile-detail-bento-content {
      flex: none;
      overflow: visible;
      gap: 10px;
    }
    #tile-detail-bento-about {
      max-height: none;
      overflow-y: visible;
    }
    #tile-detail-bento-data {
      flex: none;
      overflow-y: visible;
    }
    #tile-detail-bento-chat-cell {
      padding: 16px 18px;
      gap: 12px;
    }
    .tile-detail-chat-prompt-chip {
      font-size: 0.72rem;
      padding: 6px 11px;
    }
    #tile-detail-chat-input-row {
      flex-wrap: wrap;
    }
    #tile-detail-chat-input {
      min-width: 0;
      flex: 1 1 160px;
    }
  }
  .tile-detail-bento-label {
    display: block;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--text-disabled);
    margin-bottom: 10px;
  }
  #tile-detail-bento-description {
    font-family: var(--font-ui);
    font-size: clamp(0.82rem, 1.1vw, 0.95rem);
    color: var(--text-secondary);
    line-height: 1.55;
    margin: 0;
  }
  /* Analyzer module (P7) — legibility-only styles, refine in a separate pass */
  .tile-detail-tabbed-container {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-height: none;
    flex: 1;
    overflow: hidden;
  }
  .tile-detail-tabs {
    display: flex;
    flex-direction: row;
    border-bottom: 1px solid var(--border);
  }
  .tile-detail-tab {
    flex: 1;
    padding: 10px 8px;
    background: transparent;
    border: none;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    cursor: pointer;
    transition: color 0.28s ease, background 0.28s ease;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tile-detail-tab:hover {
    color: var(--text-display);
    background: rgba(255,255,255,0.35);
  }
  .tile-detail-tab--active {
    color: var(--text-display);
    border-bottom: 2px solid transparent;
    border-image: linear-gradient(90deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%) 0 0 1 0;
  }
  .tile-detail-tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 18px 22px;
  }
  /* Audit-summary fills its container edge-to-edge — no extra padding */
  #audit-summary-modal-tabs-container .tile-detail-tab-content {
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  #audit-summary-modal-tabs-container #adq-pane {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .tile-detail-tab-pane {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .custom-briefs-pane {
    gap: 16px;
  }
  .custom-briefs-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .custom-briefs-kicker,
  .custom-briefs-count,
  .custom-brief-card-label,
  .custom-brief-card-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .custom-briefs-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .custom-brief-submit-pane {
    gap: 16px;
  }
  .custom-brief-submit-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(180px, 0.45fr);
    gap: 12px;
  }
  .custom-brief-file-drop {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border: 1px dashed var(--border-visible);
    border-radius: 8px;
    background: var(--surface-raised);
    padding: 14px;
    cursor: pointer;
  }
  .custom-brief-file-drop input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .custom-brief-file-label {
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    color: var(--text-display);
  }
  .custom-brief-file-meta,
  .custom-brief-pdf-empty {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .custom-brief-create-actions {
    display: flex;
    justify-content: flex-start;
  }
  .custom-brief-html-textarea {
    min-height: 360px;
    white-space: pre;
  }
  .custom-brief-public-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .custom-brief-public-toggle input {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
  }
  .custom-brief-submit-success {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    color: #15803d;
  }
  .custom-brief-brain-summary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .custom-brief-brain-pill,
  .mb-config-section-status {
    display: inline-flex;
    align-items: center;
    min-height: 30px;
    border: 1px solid var(--border-visible);
    border-radius: 6px;
    background: var(--surface-raised);
    padding: 0 10px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .mb-config-section-status {
    justify-self: end;
  }
  .custom-brief-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: start;
    border: 1px solid var(--border-visible);
    border-radius: 8px;
    background: var(--surface-raised);
    padding: 16px;
  }
  .custom-brief-card-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .custom-brief-card h4 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 16px;
    line-height: 1.25;
    color: var(--text-display);
  }
  .custom-brief-card p {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .custom-brief-card-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    text-transform: none;
    letter-spacing: 0.02em;
    min-height: 20px;
    max-height: 46px;
    overflow: hidden;
  }
  .custom-brief-card-meta > span,
  .custom-brief-meta-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 220px;
    min-height: 20px;
    line-height: 20px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }
  .custom-brief-meta-link {
    color: var(--text-display);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .custom-brief-meta-link svg {
    flex: 0 0 auto;
  }
  .custom-brief-open-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 14px;
    border: 1px solid var(--border-visible);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text-display);
    font-family: var(--font-ui);
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;
    white-space: nowrap;
    transition: border-color 160ms var(--ease), transform 120ms var(--ease);
  }
  .custom-brief-open-btn:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .custom-brief-open-btn:disabled {
    cursor: not-allowed;
    opacity: 0.58;
    transform: none;
  }
  .custom-brief-delete-btn {
    color: #991b1b;
    border-color: rgba(153, 27, 27, 0.32);
  }
  .custom-brief-delete-btn:hover:not(:disabled) {
    border-color: rgba(153, 27, 27, 0.68);
    background: rgba(153, 27, 27, 0.06);
  }
  .custom-brief-vercel-btn {
    border-color: rgba(0, 173, 181, 0.34);
  }
  .custom-brief-vercel-btn:hover:not(:disabled) {
    border-color: rgba(0, 173, 181, 0.7);
    background: rgba(0, 173, 181, 0.06);
  }
  .custom-brief-card-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }
  @media (max-width: 720px) {
    .custom-brief-submit-grid {
      grid-template-columns: 1fr;
    }
    .custom-brief-brain-summary {
      grid-template-columns: 1fr;
    }
    .custom-brief-file-drop {
      align-items: flex-start;
      flex-direction: column;
    }
    .custom-brief-card {
      grid-template-columns: 1fr;
      align-items: stretch;
    }
    .custom-brief-card-actions {
      justify-content: stretch;
    }
    .custom-brief-open-btn {
      width: 100%;
    }
  }
  /* Strategy Builder + Market Category — aligned to the dashboard design system.
     Reuses .tile-detail-tab, .mb-config-platform-toggle, .tile-detail-stat-row,
     .brand-snapshot-* and .tile-foot-rerun-btn; these add only the gaps. */
  .sb-section { display: flex; flex-direction: column; gap: 8px; margin-bottom: 22px; }
  .sb-label {
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--text-secondary);
  }
  .sb-hint { font-family: var(--font-ui); font-size: 11px; line-height: 1.5; color: var(--text-disabled); }
  .sb-select, .sb-input {
    width: 100%; box-sizing: border-box; border: 1px solid var(--border-visible);
    background: var(--surface-raised); color: var(--text-primary);
    font-family: var(--font-mono); font-size: 12px; padding: 9px 11px;
    border-radius: 6px; outline: none; transition: border-color 160ms var(--ease);
  }
  .sb-select:focus, .sb-input:focus { border-color: var(--text-secondary); }
  .sb-range { width: 100%; accent-color: var(--accent); cursor: pointer; }
  .sb-range-scale {
    display: flex; justify-content: space-between; margin-top: 3px;
    font-family: var(--font-mono); font-size: 9px; color: var(--text-disabled);
  }
  .sb-seg { display: flex; gap: 6px; }
  .sb-seg-btn {
    flex: 1; padding: 7px 0; font-family: var(--font-mono); font-size: 10px;
    letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; border-radius: 6px;
    border: 1px solid var(--border-visible); background: var(--surface); color: var(--text-secondary);
    transition: color 160ms var(--ease), border-color 160ms var(--ease), background 160ms var(--ease);
  }
  .sb-seg-btn:hover { color: var(--text-primary); border-color: var(--text-disabled); }
  .sb-seg-btn.is-active {
    color: var(--text-display); border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .sb-cta {
    width: 100%; padding: 11px 0; font-family: var(--font-mono); font-size: 12px;
    font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 6px;
    cursor: pointer; border: 1px solid var(--accent); background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: opacity 160ms var(--ease), transform 120ms var(--ease);
  }
  .sb-cta:hover:not(:disabled) { opacity: 0.88; }
  .sb-cta:active:not(:disabled) { transform: translateY(1px); }
  .sb-cta:disabled {
    cursor: not-allowed; border-color: var(--border-visible);
    background: var(--surface-raised); color: var(--text-disabled);
  }
  .sb-chip {
    font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--border-visible); color: var(--text-secondary); flex-shrink: 0;
  }
  .sb-chip--ready { color: var(--success); border-color: color-mix(in srgb, var(--success) 45%, transparent); }
  .sb-chip--partial { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 45%, transparent); }
  .sb-chip--empty { color: var(--text-disabled); }
  .sb-notice { font-family: var(--font-ui); font-size: 11px; }
  .sb-notice--ok { color: var(--success); }
  .sb-notice--error { color: var(--accent); }
  .sb-link-btn {
    background: transparent; border: 1px solid var(--border-visible); border-radius: 6px;
    color: var(--text-secondary); cursor: pointer; font-size: 12px; line-height: 1;
    padding: 5px 8px; flex-shrink: 0;
    transition: color 160ms var(--ease), border-color 160ms var(--ease);
  }
  .sb-link-btn:hover { color: var(--text-primary); border-color: var(--text-disabled); }
  .sb-toggle-row-meta { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  .sb-spinner {
    width: 14px; height: 14px; border: 2px solid color-mix(in srgb, var(--text-primary) 30%, transparent);
    border-top-color: var(--text-primary); border-radius: 50%; animation: sb-spin 0.7s linear infinite;
  }
  @keyframes sb-spin { to { transform: rotate(360deg); } }
  .brand-snapshot-editor {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 0 0 16px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    margin-bottom: 8px;
  }
  .brand-snapshot-editor-note {
    margin: -4px 0 0;
    max-width: 780px;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .brand-snapshot-editor-section {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    background: rgba(255,255,255,0.035);
  }
  .brand-snapshot-editor-section-title {
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .brand-snapshot-editor-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
  }
  .brand-snapshot-color-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }
  .brand-snapshot-color-row {
    display: grid;
    gap: 8px;
  }
  .brand-snapshot-field,
  .brand-snapshot-file {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .brand-snapshot-input,
  .brand-snapshot-textarea {
    width: 100%;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(0,0,0,0.3);
    color: var(--text-primary);
    padding: 10px 11px;
    font-family: var(--font-mono);
    font-size: 0.76rem;
    line-height: 1.45;
    outline: none;
    text-transform: none;
    letter-spacing: 0;
  }
  .brand-snapshot-textarea {
    resize: vertical;
  }
  .brand-snapshot-input:focus,
  .brand-snapshot-textarea:focus {
    border-color: rgba(14,165,233,0.68);
    box-shadow: 0 0 0 2px rgba(14,165,233,0.12);
  }
  .brand-snapshot-color-input {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
  }
  .brand-snapshot-color-input input[type="color"] {
    width: 38px;
    height: 38px;
    padding: 0;
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }
  .brand-snapshot-file input[type="file"] {
    width: 100%;
    border-radius: 6px;
    border: 1px dashed rgba(255,255,255,0.18);
    padding: 9px;
    color: var(--text-secondary);
    background: rgba(0,0,0,0.2);
    font-family: var(--font-ui);
    font-size: 0.74rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .brand-snapshot-error {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid rgba(255,59,48,0.28);
    border-radius: 6px;
    background: rgba(255,59,48,0.08);
    color: #ff8b84;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .brand-snapshot-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .mb-config-shell {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .mb-config-summary {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    overflow: hidden;
    background: rgba(255,255,255,0.045);
  }
  .mb-config-summary-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    padding: 12px 14px;
    border-right: 1px solid rgba(255,255,255,0.1);
  }
  .mb-config-summary-item:last-child { border-right: 0; }
  .mb-config-summary-key,
  .mb-config-label,
  .mb-config-row-num {
    font-family: var(--font-ui);
    font-size: 0.66rem;
    line-height: 1.2;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .mb-config-summary-val {
    font-family: var(--font-mono);
    font-size: 0.92rem;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mb-config-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 0 16px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
  }
  .mb-config-section:last-of-type { border-bottom: 0; }
  .mb-config-section-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 12px;
  }
  .mb-config-section-index {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 24px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.16);
    background: rgba(0,0,0,0.24);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--text-secondary);
  }
  .mb-config-section-head h4 {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.9rem;
    color: var(--text-primary);
    letter-spacing: 0;
  }
  .mb-config-section-head p {
    margin: 4px 0 0;
    max-width: 760px;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .mb-config-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    min-width: 0;
  }
  .mb-config-grid {
    display: grid;
    grid-template-columns: minmax(120px, 0.42fr) repeat(2, minmax(180px, 1fr));
    gap: 10px;
    align-items: stretch;
  }
  .mb-config-platform-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
  }
  .mb-config-platform-toggle {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 9px;
    align-items: start;
    min-height: 72px;
    padding: 10px;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    background: rgba(255,255,255,0.035);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
  }
  .mb-config-platform-toggle:hover {
    border-color: rgba(255,255,255,0.25);
    background: rgba(255,255,255,0.07);
  }
  .mb-config-platform-toggle.is-on {
    border-color: rgba(12,206,107,0.36);
    background: rgba(12,206,107,0.08);
  }
  .mb-config-platform-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    border: 1px solid rgba(255,255,255,0.22);
    border-radius: 4px;
    color: #0cce6b;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    line-height: 1;
  }
  .is-on .mb-config-platform-check {
    border-color: rgba(12,206,107,0.55);
    background: rgba(12,206,107,0.12);
  }
  .mb-config-platform-body {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .mb-config-platform-title {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    font-family: var(--font-ui);
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text-primary);
  }
  .mb-config-platform-status {
    display: inline-flex;
    align-items: center;
    min-height: 16px;
    padding: 0 5px;
    border-radius: 3px;
    font-family: var(--font-ui);
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: 1px solid rgba(255,255,255,0.12);
    color: var(--text-secondary);
  }
  .mb-config-platform-status--ready {
    color: #0cce6b;
    border-color: rgba(12,206,107,0.32);
    background: rgba(12,206,107,0.08);
  }
  .mb-config-platform-desc {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--text-secondary);
  }
  .mb-config-platform-results {
    margin-top: 16px;
    border-top: 1px solid rgba(255,255,255,0.08);
    padding-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .mb-config-platform-results-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mb-config-platform-results-title {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .mb-config-platform-results-sub {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    line-height: 1.4;
    color: var(--text-secondary);
  }
  .mb-config-platform-result-row {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.025);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mb-config-platform-result-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .mb-config-platform-result-label {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    color: var(--text-primary);
    letter-spacing: 0.01em;
  }
  .mb-config-platform-result-count {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-left: auto;
  }
  .mb-config-platform-result-empty {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--text-secondary);
    margin: 0;
    opacity: 0.75;
  }
  .mb-config-platform-result-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mb-config-platform-result-item {
    border-top: 1px dashed rgba(255,255,255,0.07);
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mb-config-platform-result-item:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .mb-config-platform-result-item-head {
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .mb-config-platform-result-item-tag {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.14);
    color: var(--text-secondary);
    background: rgba(255,255,255,0.04);
  }
  .mb-config-platform-result-item-title {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    color: var(--text-primary);
    line-height: 1.35;
  }
  .mb-config-platform-result-item-summary {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--text-secondary);
    margin: 0;
  }
  .mb-config-platform-result-item-link {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: rgba(12,206,107,0.85);
    word-break: break-all;
    text-decoration: none;
  }
  .mb-config-platform-result-item-link:hover {
    text-decoration: underline;
  }
  .mb-config-input,
  .mb-config-textarea {
    width: 100%;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(0,0,0,0.28);
    color: var(--text-primary);
    padding: 10px 11px;
    font-family: var(--font-mono);
    font-size: 0.76rem;
    line-height: 1.45;
    outline: none;
  }
  .mb-config-input:focus,
  .mb-config-textarea:focus {
    border-color: rgba(14,165,233,0.68);
    box-shadow: 0 0 0 2px rgba(14,165,233,0.12);
  }
  .mb-config-textarea {
    resize: vertical;
  }
  .mb-config-textarea--compact {
    min-height: 58px;
  }
  .mb-config-textarea--code {
    font-size: 0.72rem;
    line-height: 1.55;
  }
  .mb-config-search-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mb-config-search-row {
    display: grid;
    grid-template-columns: 50px minmax(110px, 0.36fr) minmax(220px, 1fr) minmax(180px, 0.7fr) auto;
    gap: 8px;
    align-items: end;
    padding: 10px;
    border: 1px solid rgba(255,255,255,0.11);
    border-radius: 8px;
    background: rgba(255,255,255,0.035);
  }
  .mb-config-search-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    align-self: center;
  }
  .mb-config-row-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #0cce6b;
    box-shadow: 0 0 0 3px rgba(12,206,107,0.13);
  }
  .mb-config-mini-btn,
  .mb-config-remove-btn {
    border: 1px solid rgba(255,255,255,0.16);
    border-radius: 6px;
    background: rgba(255,255,255,0.04);
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
  }
  .mb-config-mini-btn {
    padding: 8px 10px;
    white-space: nowrap;
  }
  .mb-config-remove-btn {
    min-height: 37px;
    padding: 0 10px;
    color: var(--text-secondary);
  }
  .mb-config-mini-btn:hover,
  .mb-config-remove-btn:hover:not(:disabled) {
    background: rgba(255,255,255,0.1);
    border-color: rgba(255,255,255,0.28);
    color: var(--text-primary);
  }
  .mb-config-remove-btn:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }
  .mb-config-error {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid rgba(255,59,48,0.28);
    border-radius: 6px;
    background: rgba(255,59,48,0.08);
    color: #ff8b84;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .mb-config-actionbar {
    position: sticky;
    bottom: -18px;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 0 4px;
    background: linear-gradient(180deg, rgba(16,16,18,0) 0%, rgba(16,16,18,0.96) 32%, rgba(16,16,18,0.98) 100%);
  }
  .mb-config-actionbar-note {
    font-family: var(--font-ui);
    font-size: 0.74rem;
    line-height: 1.35;
    color: var(--text-secondary);
  }
  .mb-config-actionbar-buttons {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
    flex-shrink: 0;
  }
  @media (max-width: 900px) {
    .mb-config-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .mb-config-summary-item { border-bottom: 1px solid rgba(255,255,255,0.1); }
    .mb-config-summary-item:nth-child(2n) { border-right: 0; }
    .mb-config-grid { grid-template-columns: 1fr; }
    .mb-config-platform-grid { grid-template-columns: 1fr; }
    .mb-config-search-row {
      grid-template-columns: 44px 1fr;
      align-items: stretch;
    }
    .mb-config-field--label,
    .mb-config-field--query,
    .mb-config-field--goal,
    .mb-config-remove-btn {
      grid-column: 1 / -1;
    }
    .mb-config-remove-btn { width: 100%; }
    .mb-config-actionbar {
      align-items: stretch;
      flex-direction: column;
    }
    .mb-config-actionbar-buttons { justify-content: flex-start; }
  }
  .tile-analyzer-readiness {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 6px 10px;
    border-radius: 4px;
    align-self: flex-start;
    background: var(--border);
    color: var(--text-primary);
  }
  .tile-analyzer-readiness.readiness-critical { background: rgba(236, 72, 153, 0.22); color: hsl(314, 85%, 32%); }
  .tile-analyzer-readiness.readiness-partial  { background: rgba(14, 165, 233, 0.22); color: hsl(185, 90%, 25%); }
  .tile-analyzer-readiness.readiness-healthy  { background: rgba(139, 92, 246, 0.22); color: hsl(262, 80%, 32%); }
  .tile-analyzer-readiness-label { font-weight: 600; }
  .tile-analyzer-readiness-reason {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    color: var(--text-secondary);
  }
  .tile-analyzer-findings-list,
  .tile-analyzer-gaps-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tile-analyzer-finding,
  .tile-analyzer-gap {
    padding: 14px 18px;
    border-left: 3px solid var(--border);
    background: rgba(255,255,255,0.04);
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-radius: 0 6px 6px 0;
  }
  .tile-analyzer-finding.severity-critical { border-left-color: hsl(262,100%,55%); }
  .tile-analyzer-finding.severity-warning  { border-left-color: hsl(185,100%,45%); }
  .tile-analyzer-finding.severity-info     { border-left-color: hsl(314,100%,50%); }
  .tile-analyzer-gap                        { border-left-color: hsl(262,100%,55%); }
  .tile-analyzer-finding-header,
  .tile-analyzer-gap-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tile-analyzer-finding-header-top,
  .tile-analyzer-gap-header-top {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .tile-analyzer-severity-chip,
  .tile-analyzer-gap-chip {
    font-family: var(--font-ui);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: 2px;
    background: var(--border);
    color: var(--text-primary);
    flex-shrink: 0;
  }
  .severity-critical .tile-analyzer-severity-chip { background: rgba(139, 92, 246, 0.22); color: hsl(262,80%,32%); }
  .severity-warning .tile-analyzer-severity-chip  { background: rgba(14, 165, 233, 0.22); color: hsl(185,90%,25%); }
  .severity-info .tile-analyzer-severity-chip     { background: rgba(236, 72, 153, 0.22); color: hsl(314,85%,32%); }
  .tile-analyzer-gap-chip                          { background: rgba(139, 92, 246, 0.22); color: hsl(262,80%,32%); }
  .tile-analyzer-finding-label,
  .tile-analyzer-gap-rule {
    font-family: var(--font-ui);
    font-size: 0.86rem;
    color: var(--text-primary);
    font-weight: 600;
    line-height: 1.35;
  }
  .tile-analyzer-finding-detail,
  .tile-analyzer-finding-impact,
  .tile-analyzer-finding-remediation,
  .tile-analyzer-gap-evidence {
    font-family: var(--font-ui);
    font-size: 0.84rem;
    color: var(--text-secondary);
    line-height: 1.55;
    margin: 0;
  }
  .tile-analyzer-finding-detail .tile-analyzer-field-label {
    font-weight: 600;
    color: var(--text-primary);
    margin-right: 4px;
  }
  .tile-analyzer-finding-detail-text {
    font-family: var(--font-ui);
    font-size: 0.84rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }
  /* Audit data inventory — scrollable table with fixed column widths */
  #tile-detail-bento-rows:has(.tile-detail-audit-row) {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .tile-detail-audit-row {
    display: grid;
    grid-template-columns: 1fr 120px 120px;
    align-items: baseline;
    gap: 0;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 0.8rem;
    min-width: 480px;
  }
  .tile-detail-audit-row:last-child { border-bottom: none; }
  .tile-detail-audit-row--header .tile-detail-audit-label,
  .tile-detail-audit-row--header .tile-detail-audit-status,
  .tile-detail-audit-row--header .tile-detail-audit-tier {
    font-family: var(--font-mono, monospace);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #9a9080;
  }
  .tile-detail-audit-label {
    color: #2a2420;
    font-weight: 500;
  }
  .tile-detail-audit-status {
    font-family: var(--font-mono, monospace);
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    white-space: nowrap;
    font-weight: 600;
    text-align: left;
    padding-left: 12px;
  }
  .tile-detail-audit-status.audit-ok { color: #2d8a5e; }
  .tile-detail-audit-status.audit-miss { color: #c53030; }
  .tile-detail-audit-status.audit-upgrade {
    background: #2a2420;
    border: 1px solid #2a2420;
    color: #fff;
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 10px;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    cursor: pointer;
    text-transform: uppercase;
    line-height: 1;
    min-width: 100px;
    text-align: center;
    transition: opacity 0.15s ease;
  }
  .tile-detail-audit-status.audit-upgrade:hover {
    opacity: 0.8;
  }
  .tile-detail-audit-tier {
    font-family: var(--font-mono, monospace);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #9a9080;
    white-space: nowrap;
    font-weight: 600;
    text-align: left;
    padding-left: 12px;
  }
  .tile-detail-stat-row {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .tile-detail-stat-row:last-child { border-bottom: none; }
  .tile-detail-stat-label {
    font-weight: 600;
    color: var(--text-primary);
    flex-shrink: 0;
    font-family: var(--font-ui);
    font-size: 0.84rem;
    line-height: 1.55;
  }
  .tile-detail-stat-value {
    font-family: var(--font-ui);
    font-size: 0.84rem;
    color: var(--text-secondary);
    line-height: 1.55;
    text-align: right;
    word-break: break-word;
    flex: 1;
  }
  .tile-analyzer-finding-citation {
    font-family: var(--font-mono, monospace);
    font-size: 0.72rem;
    color: var(--text-disabled);
    line-height: 1.4;
    margin: 0;
    word-break: break-all;
  }
  .tile-analyzer-field-label {
    font-weight: 600;
    color: var(--text-primary);
    margin-right: 4px;
  }
  /* Solutions tab — catalog-driven solution cards */
  .tile-analyzer-solutions-empty {
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
    padding: 12px;
    border: 1px dashed var(--border);
    border-radius: 4px;
  }
  .tile-solutions-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    counter-reset: solution;
  }
  .tile-solution-card {
    padding: 14px 18px;
    border-left: 3px solid var(--border);
    background: rgba(255,255,255,0.04);
    border-radius: 0 6px 6px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    counter-increment: solution;
  }
  .tile-solution-card.severity-critical { border-left-color: hsl(262,100%,55%); }
  .tile-solution-card.severity-warning  { border-left-color: hsl(185,100%,45%); }
  .tile-solution-card.severity-info     { border-left-color: hsl(314,100%,50%); }
  /* Gap-sourced cards override the severity border to match the PROBLEMS-tab gap treatment. */
  .tile-solution-card.source-gap        { border-left-color: #ff5c8a; }
  .tile-solution-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tile-solution-header-top {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .tile-solution-source-label {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-disabled);
    line-height: 1.3;
  }
  .tile-solution-problem {
    font-family: var(--font-ui);
    font-size: 0.86rem;
    color: var(--text-primary);
    font-weight: 600;
    line-height: 1.35;
    margin: 0;
  }
  .tile-solution-why {
    font-family: var(--font-ui);
    font-size: 0.84rem;
    color: var(--text-secondary);
    line-height: 1.55;
    margin: 0;
  }
  .tile-solution-expert {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
  }
  .tile-solution-actions {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 4px;
  }
  .tile-solution-actions .tile-solution-diy-toggle-btn { order: 1; }
  .tile-solution-actions .tile-solution-expert-cta { order: 2; }
  /* Collapsible DIY — sits at the bottom of the solution card */
  .tile-solution-diy-details {
    margin: 0;
    border: none;
    padding: 0;
    flex-shrink: 0;
  }
  .tile-solution-diy-details[open] {
    position: static;
    width: auto;
    margin-top: 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(14, 165, 233, 0.25);
    border-radius: 6px;
    padding: 12px 14px;
    box-shadow: none;
  }
  .tile-solution-diy-summary-toggle {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    cursor: pointer;
    list-style: none;
    padding: 4px 0;
    user-select: none;
  }
  .tile-solution-diy-summary-toggle--hidden {
    display: none;
  }
  .tile-solution-diy-summary-toggle::-webkit-details-marker { display: none; }
  .tile-solution-diy-toggle-btn {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    user-select: none;
  }
  .tile-solution-diy-toggle-btn:hover .tile-solution-diy-toggle-label {
    color: hsl(185,100%,55%);
  }
  .tile-solution-diy-summary-toggle::before {
    content: '+';
    display: inline-block;
    width: 14px;
    color: hsl(185,100%,45%);
    font-weight: 700;
    transition: transform 0.15s ease;
  }
  .tile-solution-diy-details[open] .tile-solution-diy-summary-toggle::before {
    content: '−';
  }
  .tile-solution-diy-toggle-label {
    flex: 1;
    font-family: var(--font-ui);
    font-size: 0.82rem;
    font-weight: 600;
    color: hsl(185,100%,45%);
    letter-spacing: 0.02em;
  }
  .tile-solution-diy-summary-toggle:hover .tile-solution-diy-toggle-label {
    color: hsl(185,100%,55%);
  }
  .tile-solution-diy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 0 2px 18px;
    margin-top: 4px;
    border-left: 2px solid rgba(14, 165, 233, 0.25);
  }
  .tile-solution-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 2px;
  }
  .tile-solution-section-label {
    font-family: var(--font-ui);
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: hsl(185,100%,45%);
  }
  .tile-solution-section-label--expert {
    color: hsl(314,100%,50%);
  }
  .tile-solution-meta {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--text-disabled);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tile-solution-diy-summary,
  .tile-solution-expert-summary,
  .tile-solution-expert-deliverable {
    font-family: var(--font-ui);
    font-size: 0.84rem;
    color: var(--text-secondary);
    line-height: 1.55;
    margin: 0;
  }
  .tile-solution-steps {
    margin: 4px 0 0 0;
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .tile-solution-step {
    font-family: var(--font-ui);
    font-size: 0.84rem;
    color: var(--text-secondary);
    line-height: 1.55;
    white-space: pre-wrap;
  }
  .tile-solution-links {
    list-style: none;
    margin: 6px 0 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .tile-solution-links a {
    font-family: var(--font-ui);
    font-size: 0.76rem;
    color: hsl(185,100%,45%);
    text-decoration: none;
    border-bottom: 1px solid currentColor;
    padding-bottom: 1px;
  }
  .tile-solution-links a:hover {
    opacity: 0.8;
  }
  .tile-solution-expert-title {
    font-family: var(--font-ui);
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.35;
    margin: 2px 0 0 0;
  }
  .tile-solution-expert-cta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 8px 14px;
    border-radius: 999px;
    background:
      linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%),
      linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    box-shadow: 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1);
    color: #ffffff;
    font-family: var(--font-ui);
    font-size: 0.82rem;
    font-weight: 600;
    text-decoration: none;
    align-self: flex-start;
    letter-spacing: 0.02em;
    transform: scale(1);
    transition: box-shadow 0.45s cubic-bezier(0.16, 1, 0.3, 1), transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .tile-solution-expert-cta:hover {
    box-shadow: 0px 5px 10px rgba(0,0,0,0.067), 0px 15px 30px rgba(0,0,0,0.067), 0px 20px 40px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.35);
    transform: scale(1.02);
    transition: box-shadow 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  /* Stat rows */
  #tile-detail-bento-rows {
    display: flex;
    flex-direction: column;
    padding: 18px 20px 22px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }
  .tile-detail-stat-row--flag .tile-detail-stat-label {
    border-left: 2px solid #d05;
    padding-left: 6px;
  }
  .tile-detail-row-section-head {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
    padding: 12px 0 4px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 2px;
    min-width: 480px;
  }
  .audit-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .audit-section-open-btn {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    background: none;
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 2px 6px;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .audit-section-open-btn:hover {
    opacity: 1;
    color: var(--text-primary);
  }

  /* ── Data Quality Overview — card grid redesign ──────────────────────────── */
  #adq-pane {
    padding: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: #fff;
  }
  #adq-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: #fff;
  }
  /* Provenance bar */
  #adq-provenance {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px 9px;
    border-bottom: 1px solid #ebebeb;
    flex-shrink: 0;
    background: #fafafa;
    flex-wrap: wrap;
  }
  #adq-prov-left {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
  }
  .adq-prov-label {
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #aaa;
  }
  #adq-prov-ts {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    color: #555;
  }
  .adq-prov-sep {
    color: #ccc;
    font-size: 11px;
  }
  #adq-prov-stat {
    font-family: var(--font-mono);
    font-size: 11px;
    color: #888;
  }
  .adq-prov-num {
    font-weight: 700;
    color: #111;
  }
  .adq-prov-of {
    opacity: 0.45;
  }
  #adq-prov-sources {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .adq-prov-chip {
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 3px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 1px solid transparent;
  }
  .adq-prov-chip-count {
    opacity: 0.65;
    font-weight: 500;
  }
  /* Source chip colors */
  .adq-prov-chip--ai       { color: #6d28d9; background: rgba(109,40,217,0.07); border-color: rgba(109,40,217,0.18); }
  .adq-prov-chip--scout    { color: #0369a1; background: rgba(3,105,161,0.07);  border-color: rgba(3,105,161,0.18); }
  .adq-prov-chip--crawl    { color: #0f766e; background: rgba(15,118,110,0.07); border-color: rgba(15,118,110,0.18); }
  .adq-prov-chip--psi      { color: #b45309; background: rgba(180,83,9,0.07);   border-color: rgba(180,83,9,0.18); }
  .adq-prov-chip--user     { color: #374151; background: rgba(55,65,81,0.07);   border-color: rgba(55,65,81,0.18); }
  .adq-prov-chip--artifact { color: #9333ea; background: rgba(147,51,234,0.07); border-color: rgba(147,51,234,0.18); }
  .adq-prov-chip--module   { color: #0f766e; background: rgba(15,118,110,0.05); border-color: rgba(15,118,110,0.14); }
  /* Field row source tag */
  .adq-fr-src {
    font-family: var(--font-mono);
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 1px 4px;
    border-radius: 2px;
    flex-shrink: 0;
    white-space: nowrap;
    border: 1px solid transparent;
  }
  .adq-fr-src--ai       { color: #6d28d9; background: rgba(109,40,217,0.06); border-color: rgba(109,40,217,0.15); }
  .adq-fr-src--scout    { color: #0369a1; background: rgba(3,105,161,0.06);  border-color: rgba(3,105,161,0.15); }
  .adq-fr-src--crawl    { color: #0f766e; background: rgba(15,118,110,0.06); border-color: rgba(15,118,110,0.15); }
  .adq-fr-src--psi      { color: #b45309; background: rgba(180,83,9,0.06);   border-color: rgba(180,83,9,0.15); }
  .adq-fr-src--user     { color: #374151; background: rgba(55,65,81,0.06);   border-color: rgba(55,65,81,0.15); }
  .adq-fr-src--artifact { color: #9333ea; background: rgba(147,51,234,0.06); border-color: rgba(147,51,234,0.15); }
  .adq-fr-src--module   { color: #0f766e; background: rgba(15,118,110,0.04); border-color: rgba(15,118,110,0.12); }
  #adq-scroll {
    flex: 1;
    overflow-y: auto;
    background: #fff;
  }
  /* Bucket section */
  .adq-bucket {
    border-bottom: 1px solid #ebebeb;
    padding-bottom: 2px;
  }
  .adq-bucket:last-child { border-bottom: none; }
  .adq-bucket-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 16px 10px;
  }
  .adq-bucket-hdr-left {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }
  .adq-bucket-icon-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
  }
  .adq-bucket-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .adq-bucket-name {
    font-family: var(--font-ui);
    font-size: 17px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #111;
    line-height: 1;
  }
  .adq-bucket-sub {
    font-family: var(--font-ui);
    font-size: 12px;
    color: #999;
    line-height: 1.4;
  }
  .adq-bucket-hdr-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .adq-bucket-count-wrap {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 7px;
  }
  .adq-bucket-count-label {
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #bbb;
    white-space: nowrap;
  }
  .adq-bucket-count {
    font-family: var(--font-mono);
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: #111;
    line-height: 1;
    white-space: nowrap;
  }
  .adq-bucket-count-sep { opacity: 0.25; font-size: 16px; font-weight: 400; margin: 0 1px; }
  /* Bucket header ring — mirrors shell gauge ring style */
  .adq-bucket-ring-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .adq-bucket-ring-svg {
    width: 48px;
    height: 48px;
    display: block;
  }
  .adq-bucket-ring-val {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #2a2420;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
  }
  .adq-bucket-ring-sep { opacity: 0.3; margin: 0 0.5px; }
  /* Single-column stack for section cards */
  .adq-section-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 12px 14px;
  }
  /* Section card — white bg, uniform border */
  .adq-section-card {
    background: #fff;
    border: 1px solid #e2e2e2;
    border-radius: 10px;
    padding: 12px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    transition: box-shadow 0.15s ease;
  }
  .adq-section-card:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.07); }
  /* Card top row: name+sub | pct */
  .adq-sc-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 9px;
  }
  .adq-sc-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .adq-sc-name {
    font-family: var(--font-ui);
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #111;
    line-height: 1.2;
  }
  .adq-sc-sub {
    font-family: var(--font-ui);
    font-size: 10.5px;
    color: #999;
    line-height: 1.35;
  }
  .adq-sc-pct {
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.04em;
    color: #111;
    line-height: 1;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .adq-sc-pct-unit {
    font-size: 14px;
    font-weight: 600;
    opacity: 0.55;
    margin-left: 1px;
  }
  .adq-sc-footer-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 6px;
  }
  .adq-sc-open-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #888;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.12s;
  }
  .adq-sc-open-btn:hover { color: #111; }
  /* Field rows — vertical stacked list items */
  .adq-field-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid #f0f0f0;
  }
  .adq-fr {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 0;
    border-bottom: 1px solid #f0f0f0;
    min-height: 28px;
  }
  .adq-fr:last-child { border-bottom: none; }
  .adq-fr-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    flex-shrink: 0;
  }
  .adq-fr-pip {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    display: block;
  }
  .adq-fr-pip--ok   { background: #16a34a; }
  .adq-fr-pip--miss { background: #dc2626; }
  .adq-fr-label {
    font-family: var(--font-ui);
    font-size: 12px;
    line-height: 1.3;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .adq-fr--ok  .adq-fr-label { color: #111; }
  .adq-fr--miss .adq-fr-label { color: #dc2626; font-weight: 500; }
  .adq-fr--lock .adq-fr-label { color: #9ca3af; }
  .adq-fr--lock .adq-fr-indicator { color: #9ca3af; }
  .adq-fr-badge {
    font-family: var(--font-mono);
    font-size: 7.5px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border-radius: 3px;
    padding: 1px 5px;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .adq-fr-badge--ok {
    color: #15803d;
    background: rgba(22,163,74,0.1);
    border: 1px solid rgba(22,163,74,0.25);
  }
  .adq-fr-badge--miss {
    color: #b91c1c;
    background: rgba(220,38,38,0.08);
    border: 1px solid rgba(220,38,38,0.22);
  }
  .adq-fr-upgrade {
    font-family: var(--font-mono);
    font-size: 7.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #9ca3af;
    background: none;
    border: 1px solid #e2e2e2;
    border-radius: 3px;
    padding: 1px 5px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.12s, border-color 0.12s;
    line-height: 1.6;
  }
  .adq-fr-upgrade:hover { color: #555; border-color: #aaa; }
  /* Footer */
  #adq-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 16px;
    border-top: 1px solid #e8e8e8;
    background: #fff;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .adq-footer-status {
    font-family: var(--font-mono);
    font-size: 7.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #aaa;
    flex-shrink: 0;
    margin-right: 2px;
  }
  .adq-legend-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: #555;
    white-space: nowrap;
  }
  .adq-legend-item--right { margin-left: auto; display: flex; gap: 4px; align-items: center; }

  /* ── ADQ mobile responsiveness ──────────────────────────────────────────── */
  @media (max-width: 520px) {
    #adq-shell, #adq-pane {
      overflow-x: hidden;
    }
    /* Provenance bar — stack left/right sections vertically */
    #adq-provenance {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 12px 7px;
    }
    #adq-prov-left {
      gap: 5px;
    }
    .adq-prov-label {
      font-size: 7px;
    }
    #adq-prov-ts {
      font-size: 10px;
    }
    #adq-prov-stat {
      font-size: 10px;
    }
    #adq-prov-sources {
      gap: 3px;
    }
    .adq-prov-chip {
      font-size: 7px;
      padding: 1px 5px;
    }
    /* Bucket header — tighten up */
    .adq-bucket-hdr {
      padding: 12px 12px 8px;
      gap: 8px;
      flex-wrap: nowrap;
      align-items: center;
    }
    .adq-bucket-hdr-left {
      gap: 7px;
      min-width: 0;
    }
    .adq-bucket-icon-wrap {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
    }
    .adq-bucket-name {
      font-size: 13px;
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Count + label — hide the label text on small screens */
    .adq-bucket-count-label {
      display: none;
    }
    .adq-bucket-count {
      font-size: 16px;
    }
    .adq-bucket-count-sep {
      font-size: 12px;
    }
    /* Section grid — full bleed, tighter */
    .adq-section-grid {
      padding: 0 8px 12px;
      gap: 6px;
    }
    /* Section card — tighter padding */
    .adq-section-card {
      padding: 10px 10px 8px;
    }
    .adq-sc-name {
      font-size: 11px;
    }
    .adq-sc-sub {
      font-size: 9.5px;
    }
    /* Footer row — allow wrapping if needed */
    .adq-sc-footer-row {
      gap: 4px;
    }
    /* Field rows — tighter */
    .adq-field-rows {
      gap: 5px;
    }
    .adq-fr-label {
      font-size: 11px;
    }
    .adq-fr-src {
      font-size: 6.5px;
    }
    .adq-fr-badge {
      font-size: 6.5px;
      padding: 1px 4px;
    }
  }
  .tile-number {
    grid-area: num;
    font-size: 10px;
    color: var(--text-disabled);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tile-header-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-disabled);
  }
  .tile-header-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-disabled);
  }
  .tile-card-readiness {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 2px;
    margin-left: auto;
    margin-right: 4px;
    background: var(--border);
    color: var(--text-primary);
  }
  .tile-card-readiness.readiness-critical { background: rgba(139, 92, 246, 0.22); color: hsl(262,80%,32%); }
  .tile-card-readiness.readiness-partial  { background: rgba(14, 165, 233, 0.22); color: hsl(185,90%,25%); }
  .tile-card-readiness.readiness-healthy  { background: rgba(236, 72, 153, 0.22); color: hsl(314,85%,32%); }
  .tile-number .power-dot,
  .tile-foot .power-dot {
    width: 6px;
    height: 6px;
    display: inline-block;
    flex-shrink: 0;
  }
  .tile-foot-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  #module-controls-multi-device-view {
    display: none;
  }
  .power-dot-dim { background: var(--text-disabled) !important; box-shadow: none !important; }
  .power-dot-needs-work { background: var(--accent) !important; box-shadow: 0 0 5px 2px rgba(215, 25, 33, 0.55) !important; }
  .tile-heading {
    grid-area: head;
    font-weight: 700;
    font-size: clamp(1rem, 1.6vw, 1.2rem);
    line-height: 1.2;
    color: var(--text-display);
    letter-spacing: -0.03em;
  }
  .tile-description {
    grid-area: desc;
    font-size: clamp(0.82rem, 1.1vw, 0.95rem);
    color: var(--text-secondary);
    line-height: 1.55;
    width: 100%;
    max-width: none;
    margin-top: 6px;
  }
  .tile-viz {
    grid-area: viz;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    min-width: 0;
    align-self: stretch;
  }
  .tile-foot {
    grid-area: foot;
    margin-top: 12px;
    padding-top: 10px;
    border-top: none;
    font-size: 10px;
    color: var(--text-secondary);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    align-self: end;
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .tile-foot-right-group {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .tile-foot-action-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    padding: 0;
    opacity: 0.6;
  }
  .tile-foot-action-btn:hover:not(:disabled) {
    opacity: 1;
    color: var(--text-primary);
  }
  .tile-foot-action-btn:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }
  .status-live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .status-live::before {
    content: "";
    width: 5px;
    height: 5px;
    display: inline-block;
  }
  .status-preview::before { background: var(--text-disabled) !important; box-shadow: none !important; }
  .segbar-wrap, .qa-wrap, .mtg-wrap, .spark-wrap, .countdown-wrap, .stat-wrap, .deadline-wrap, .pipeline-wrap, .delta-wrap, .thread-wrap, .kw-wrap {
    width: 100%;
  }
  .segbar-row, .deadline-head, .kw-head, .delta-label, .thread-row, .stat-row, .mini-table {
    font-family: var(--font-mono);
  }
  .segbar-row {
    display: flex;
    justify-content: space-between;
    font-size: 8.5px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }
  .segbar-row .val { color: var(--text-display); }
  .segbar-track { display: flex; gap: 2px; margin-bottom: 10px; }
  .segbar-cell { flex: 1; height: 5px; background: var(--border); }
  .segbar-cell.on { background: var(--text-display); }
  .segbar-cell.warn { background: var(--warning); }
  .memory-map {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(16, 1fr);
    gap: 5px;
    aspect-ratio: 16 / 7;
  }
  .memory-node { background: var(--border); border-radius: 999px; aspect-ratio: 1; }
  .memory-node.on { background: var(--text-primary); }
  .memory-node.hot { background: var(--text-display); }
  .qa-q {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-display);
    margin-bottom: 8px;
    line-height: 1.4;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .qa-q::before { content: "Q / "; color: var(--text-secondary); }
  .qa-a {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.5;
    padding-left: 12px;
    border-left: 1px solid var(--border-visible);
  }
  .cursor {
    display: inline-block;
    width: 6px;
    height: 11px;
    background: var(--text-display);
    vertical-align: -1px;
    margin-left: 2px;
    animation: blink 1s step-start infinite;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
  .mtg-row {
    display: grid;
    grid-template-columns: 42px 1fr auto;
    gap: 10px;
    align-items: baseline;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
  }
  .mtg-row:last-child { border-bottom: none; }
  .mtg-row .time { color: var(--text-secondary); }
  .mtg-row .title { color: var(--text-display); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mtg-row .badge { color: var(--success); font-size: 8.5px; display: inline-flex; align-items: center; gap: 5px; }
  .mtg-row .badge.pending { color: var(--warning); }
  .mtg-row .badge::before { content: ""; width: 5px; height: 5px; background: currentColor; border-radius: 999px; }
  .rings { display: flex; gap: 10px; width: 100%; justify-content: space-around; align-items: center; }
  .ring-cell { text-align: center; }
  .ring-bg { stroke: var(--border); }
  .ring-fill-display { stroke: var(--text-display); }
  .ring-fill-warning { stroke: var(--warning); }
  .ring-fill-success { stroke: var(--success); }
  .ring-fill-danger  { stroke: var(--accent); }
  .ring-val { font-family: var(--font-mono); font-size: 12px; color: var(--text-display); margin-top: 6px; }
  .ring-label { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-secondary); margin-top: 1px; letter-spacing: 0.08em; text-transform: uppercase; }

  /* ── SEO + Performance viz shell ── */
  /* ── Audit Summary Viz ── */
  #audit-viz-shell {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: clamp(8px, 3%, 18px) clamp(10px, 4%, 22px);
    justify-content: center;
    gap: 0;
    container-type: size;
  }
  #audit-viz-quality {
    flex-shrink: 0;
    margin-top: clamp(6px, 2cqi, 14px);
    padding: clamp(6px, 2cqi, 10px) clamp(8px, 2.5cqi, 14px);
    border: 1px solid rgba(42, 36, 32, 0.1);
    border-radius: clamp(6px, 2cqi, 10px);
    background: rgba(255, 255, 255, 0.55);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .audit-quality-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .audit-quality-label {
    font-family: var(--font-mono);
    font-size: clamp(7px, 2.2cqi, 9px);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.55);
  }
  .audit-quality-pct {
    font-family: 'Doto', var(--font-mono);
    font-weight: 900;
    font-size: clamp(14px, 4cqi, 22px);
    color: #2a2420;
    line-height: 1;
  }
  .audit-quality-track {
    height: clamp(4px, 1.2cqi, 6px);
    background: rgba(42, 36, 32, 0.08);
    border-radius: 3px;
    overflow: hidden;
  }
  .audit-quality-fill {
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(90deg, #00cfff 0%, #7b5fff 50%, #ff3de8 100%);
    transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }
  #audit-viz-ring-row {
    display: flex;
    align-items: center;
    justify-content: space-evenly;
    flex: 1;
    min-height: 0;
  }
  .audit-ring-cell {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 0 1 auto;
    padding: clamp(6px, 2cqi, 12px);
    border: 1px solid rgba(42, 36, 32, 0.1);
    border-radius: clamp(8px, 2.5cqi, 14px);
    background: rgba(255, 255, 255, 0.55);
  }
  .audit-ring-cell .seo-ring-svg {
    width: clamp(44px, 22cqi, 78px);
    height: clamp(44px, 22cqi, 78px);
  }
  .audit-ring-val {
    position: absolute;
    top: 46%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: 'Doto', var(--font-mono);
    font-weight: 900;
    font-size: clamp(12px, 5cqi, 22px);
    line-height: 1;
  }
  .audit-ring-label {
    font-family: var(--font-mono);
    font-size: clamp(7px, 2.5cqi, 9px);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.6);
    margin-top: 3px;
  }
  #audit-viz-bars {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(4px, 1.5cqi, 8px) clamp(8px, 3cqi, 16px);
    padding: clamp(4px, 1.5cqi, 10px) 0;
    flex-shrink: 0;
  }
  .audit-bar-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .audit-bar-label {
    font-family: var(--font-mono);
    font-size: clamp(6px, 2cqi, 8px);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.45);
    white-space: nowrap;
  }
  .audit-bar-track {
    width: 100%;
    height: clamp(3px, 1cqi, 5px);
    background: rgba(42, 36, 32, 0.08);
    border-radius: 3px;
    overflow: hidden;
  }
  .audit-bar-fill {
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(90deg, #00cfff 0%, #7b5fff 50%, #ff3de8 100%);
    transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }
  #seo-perf-viz-shell {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 0.4em;
    padding: 6px;
    box-sizing: border-box;
    min-height: 0;
    overflow: hidden;
    container-type: size;
    font-size: clamp(4px, min(3cqi, 3.5cqh), 12px);
  }
  .seo-grad-defs {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
  }
  .seo-scores {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    gap: 0.5em;
    flex: 1 1 0%;
    min-height: 0;
    width: 100%;
  }
  .seo-score-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35em;
    padding: 0.5em 0.3em;
    background: rgba(255,255,255,0.55);
    border: 1px solid rgba(212,196,171,0.82);
    border-radius: 1.1em;
    min-width: 0;
    height: 100%;
  }
  .seo-ring-wrap {
    position: relative;
    width: clamp(3em, 8cqi, 5.5em);
    height: clamp(3em, 8cqi, 5.5em);
    flex-shrink: 0;
  }
  .seo-ring-wrap svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
    display: block;
  }
  .seo-ring-track {
    fill: none;
    stroke: rgba(0,0,0,0.07);
    stroke-width: 5;
    stroke-linecap: round;
  }
  .seo-ring-num {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Doto', var(--font-display), sans-serif;
    font-weight: 900;
    font-size: clamp(1.2em, 3.5cqi, 2em);
    line-height: 1;
  }
  .seo-ring-num--grad {
    background: linear-gradient(92deg, #00cfff, #7b5fff, #ff3de8);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .seo-ring-num--partial {
    color: #ff3de8;
  }
  .seo-score-lbl {
    font-family: 'Space Mono', var(--font-mono), monospace;
    font-size: clamp(0.62em, 2cqi, 0.9em);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #5a5346;
    text-align: center;
    line-height: 1.2;
  }
  .seo-div {
    display: none;
  }
  .seo-vitals {
    display: flex;
    flex-direction: column;
    gap: 0.35em;
    flex: 1 1 0%;
    min-height: 0;
    justify-content: center;
    width: 100%;
  }
  .seo-vital-row {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.2em;
    flex: 1 1 0%;
    min-height: 0;
  }
  .seo-vital-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5em;
  }
  .seo-vital-key {
    font-family: 'Space Mono', var(--font-mono), monospace;
    font-size: 0.72em;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #0a0a0a;
    font-weight: 700;
  }
  .seo-vital-val {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }
  .seo-vital-n {
    font-family: 'Doto', var(--font-display), sans-serif;
    font-weight: 900;
    font-size: 1.3em;
    line-height: 1;
    letter-spacing: 0;
  }
  .seo-vital-n--pink { color: #ff3de8; }
  .seo-vital-n--cyan { color: #00cfff; }
  .seo-vital-badge {
    font-family: 'Space Mono', var(--font-mono), monospace;
    font-size: 0.6em;
    letter-spacing: 0.2em;
    padding: 0.28em 0.7em;
    border-radius: 999px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .seo-vital-badge--avg {
    background: rgba(255,61,232,0.08);
    color: #ff3de8;
    border: 1px solid rgba(255,61,232,0.30);
  }
  .seo-vital-badge--fast {
    background: rgba(0,207,255,0.08);
    color: #00cfff;
    border: 1px solid rgba(0,207,255,0.32);
  }
  .seo-vital-bar {
    height: 0.5em;
    border-radius: 999px;
    background: rgba(0,0,0,0.07);
    overflow: hidden;
  }
  .seo-vital-bar > i {
    display: block;
    height: 100%;
    border-radius: 999px;
  }
  .seo-vital-bar > i.pink { background: linear-gradient(90deg, #ff3de8, #7b5fff); }
  .seo-vital-bar > i.cyan { background: linear-gradient(90deg, #00cfff, #7b5fff); }
  .seo-diag-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5em;
    flex: 1 1 0%;
    min-height: 0;
    width: 100%;
  }
  .seo-diag-tile {
    background: rgba(255,255,255,0.55);
    border: 1px solid rgba(212,196,171,0.82);
    border-radius: 1em;
    padding: 0.5em 0.7em;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.25em;
    min-width: 0;
    height: 100%;
  }
  .seo-diag-num {
    font-family: 'Doto', var(--font-display), sans-serif;
    font-weight: 900;
    font-size: clamp(2em, 8cqh, 4.5em);
    line-height: 0.9;
    background: linear-gradient(92deg, #00cfff, #7b5fff, #ff3de8);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .seo-diag-lbl {
    font-family: 'Space Mono', var(--font-mono), monospace;
    font-size: clamp(0.6em, 2.5cqh, 1em);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #5a5346;
  }
  .seo-diag-bar {
    height: 0.4em;
    border-radius: 999px;
    background: rgba(0,0,0,0.07);
    overflow: hidden;
    margin-top: auto;
  }
  .seo-diag-bar > i {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #00cfff, #7b5fff, #ff3de8);
  }
  /* ── Agent Readiness card shell viz ──────────────────────────────────── */
  #ar-viz-shell {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(4px, 1.5cqi, 10px);
    padding: clamp(8px, 3%, 18px) clamp(10px, 4%, 22px);
    box-sizing: border-box;
    overflow: hidden;
    container-type: size;
  }
  #ar-gauge-wrap {
    position: relative;
    width: clamp(90px, 86cqi, 200px);
    flex-shrink: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(3px, 1cqi, 6px);
  }
  #ar-gauge-svg { width: 100%; display: block; }
  #ar-gauge-score {
    position: absolute;
    top: 56%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: 'Doto', var(--font-mono);
    font-weight: 900;
    font-size: clamp(16px, 6.5cqi, 34px);
    line-height: 1;
    color: #2a2420;
  }
  #ar-verdict-pill {
    font-family: var(--font-mono);
    font-size: clamp(7px, 2.2cqi, 9px);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.3em 0.9em;
    border-radius: 999px;
    border: 1px solid rgba(42,36,32,0.1);
    background: rgba(255,255,255,0.55);
    color: rgba(42,36,32,0.6);
    line-height: 1;
  }
  #ar-dim-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-evenly;
    width: 100%;
    flex-shrink: 0;
    gap: clamp(3px, 1cqi, 8px);
  }
  .ar-dim-cell {
    flex: 1 1 0%;
    min-width: 0;
    padding: clamp(4px, 1.5cqi, 10px) clamp(3px, 1cqi, 8px);
  }
  .ar-dim-cell .seo-ring-svg {
    width: clamp(30px, 16cqi, 56px);
    height: clamp(30px, 16cqi, 56px);
  }
  .ar-dim-cell .audit-ring-val {
    font-size: clamp(9px, 3.5cqi, 17px);
  }
  .ar-dim-cell .audit-ring-label {
    font-size: clamp(5px, 1.8cqi, 8px);
  }
  .ar-ring-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .ar-ring-val {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: 'Doto', var(--font-mono);
    font-weight: 900;
    font-size: clamp(9px, 3.5cqi, 17px);
    line-height: 1;
    color: #2a2420;
    pointer-events: none;
  }
  .ar-dim-sub {
    font-family: var(--font-mono);
    font-size: clamp(5px, 1.6cqi, 7px);
    color: rgba(42,36,32,0.45);
    letter-spacing: 0.06em;
    text-align: center;
    margin-top: 1px;
  }
  .ar-dim-sub-icon-total {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    line-height: 1;
  }
  .ar-dim-sub-icon-total svg {
    flex-shrink: 0;
    vertical-align: middle;
  }
  /* ── Data Quality gauge overrides — compact X/Y display ─────────────── */
  .dq-gauge-viz #ar-gauge-wrap {
    width: clamp(113px, 73cqi, 227px);
  }
  .dq-gauge-viz #ar-verdict-pill {
    font-size: clamp(11px, 3.4cqi, 15px);
    padding: 0.45em 1.2em;
    font-weight: 800;
    letter-spacing: 0.06em;
    position: relative;
    top: -2px;
  }
  .dq-gauge-score {
    font-family: 'Doto', var(--font-mono) !important;
    font-size: clamp(36px, 19cqi, 86px) !important;
    font-weight: 900 !important;
    letter-spacing: -0.03em !important;
  }
  .dq-gauge-viz #ar-dim-row {
    flex-wrap: wrap;
    justify-content: center;
    gap: clamp(2px, 0.8cqi, 5px);
  }
  .dq-gauge-viz .ar-dim-cell {
    flex: 0 1 calc(14.28% - 3px);
    min-width: clamp(28px, 10cqi, 48px);
    padding: clamp(3px, 1cqi, 6px) clamp(2px, 0.6cqi, 5px);
  }
  .dq-gauge-viz .ar-dim-cell .seo-ring-svg {
    width: clamp(24px, 11cqi, 40px);
    height: clamp(24px, 11cqi, 40px);
  }
  .dq-gauge-viz .ar-ring-val {
    font-family: var(--font-mono) !important;
    font-size: clamp(7px, 2.6cqi, 12px) !important;
    font-weight: 800 !important;
    letter-spacing: -0.02em !important;
  }
  .dq-gauge-viz .ar-dim-sub {
    font-size: clamp(5px, 1.6cqi, 7px) !important;
    letter-spacing: 0.04em !important;
  }
  .ar-ring-locked .ar-ring-val {
    color: rgba(42,36,32,0.35) !important;
  }
  .ar-ring-locked .audit-ring-label {
    color: rgba(42,36,32,0.4) !important;
  }
  .ar-ring-locked .ar-dim-sub {
    color: rgba(42,36,32,0.3) !important;
    font-style: italic;
  }
  /* ── end Agent Readiness viz ──────────────────────────────────────────── */
  .spark-val { font-family: var(--font-mono); font-size: 24px; color: var(--text-display); line-height: 1; margin-bottom: 4px; }
  .spark-val .unit, .countdown .unit, .countdown-meta, .chip { font-family: var(--font-mono); text-transform: uppercase; }
  .spark-val .unit { font-size: 9px; color: var(--text-secondary); margin-left: 5px; letter-spacing: 0.08em; }
  .spark-svg { width: 100%; height: 38px; display: block; margin: 2px 0 10px; }
  .spark-grid { stroke: var(--border); }
  .spark-line { stroke: var(--text-display); }
  .spark-dot { fill: var(--text-display); }
  .chips { display: flex; gap: 4px; }
  .chip { border: 1px solid var(--border-visible); padding: 2px 9px; font-size: 9px; color: var(--text-secondary); border-radius: 999px; letter-spacing: 0.08em; }
  .chip.on { color: var(--text-display); border-color: var(--text-display); }
  .countdown { font-family: var(--font-display); font-size: clamp(60px, 7vw, 84px); line-height: 0.9; color: var(--text-display); letter-spacing: -0.02em; }
  .countdown .unit { font-size: 13px; color: var(--text-secondary); margin-left: 6px; letter-spacing: 0.08em; }
  .countdown-meta { font-size: 9px; color: var(--text-secondary); margin-top: 8px; letter-spacing: 0.08em; }
  .stat-row { display: flex; justify-content: space-between; align-items: baseline; padding: 7px 0; border-bottom: 1px solid var(--border); }
  .stat-row:last-child { border-bottom: none; }
  .stat-row .label { font-size: 9.5px; color: var(--text-secondary); letter-spacing: 0.08em; text-transform: uppercase; font-family: var(--font-mono); }
  .stat-row .value { font-size: 12px; color: var(--text-display); font-family: var(--font-mono); }
  .stat-row .value.warn { color: var(--warning); }
  .deadline-row { margin-bottom: 10px; }
  .deadline-head { display: flex; justify-content: space-between; font-size: 9px; margin-bottom: 4px; letter-spacing: 0.06em; text-transform: uppercase; }
  .deadline-head .name { color: var(--text-secondary); }
  .deadline-head .days { color: var(--text-display); }
  .deadline-head .days.warn { color: var(--warning); }
  .deadline-bar, .kw-bar, .delta-bar-before, .delta-bar-after { height: 3px; background: var(--border); position: relative; }
  .deadline-bar > .fill, .kw-bar > .fill, .delta-bar-after > .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--text-display); }
  .deadline-bar > .fill.warn { background: var(--warning); }
  .delta-bar-before > .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--text-secondary); }
  .mini-table { width: 100%; border-collapse: collapse; font-size: 10px; }
  .mini-table th { text-align: left; padding: 4px 6px 6px 0; color: var(--text-secondary); font-size: 8.5px; border-bottom: 1px solid var(--border-visible); letter-spacing: 0.08em; text-transform: uppercase; font-weight: 400; }
  .mini-table td { padding: 7px 6px 7px 0; color: var(--text-display); border-bottom: 1px solid var(--border); }
  .mini-table tr:last-child td { border-bottom: none; }
  .num { text-align: right; padding-right: 0; }
  .delta-up { color: var(--success); }
  .delta-down { color: var(--accent); }
  .pipeline { display: flex; align-items: center; width: 100%; padding: 4px 0; }
  .pipe-stop { width: 10px; height: 10px; background: var(--border); border-radius: 999px; flex-shrink: 0; }
  .pipe-stop.done { background: var(--text-display); }
  .pipe-stop.active { width: 16px; height: 16px; background: var(--text-display); border: 3px solid var(--surface); outline: 1px solid var(--text-display); }
  .pipe-line { flex: 1; height: 1px; background: var(--border); }
  .pipe-line.done { background: var(--text-display); }
  .pipe-labels { display: flex; justify-content: space-between; margin-top: 12px; font-family: var(--font-mono); font-size: 8.5px; color: var(--text-disabled); letter-spacing: 0.1em; text-transform: uppercase; }
  .pipe-labels .active { color: var(--text-display); }
  .delta-pair { margin-bottom: 10px; }
  .delta-label { font-size: 9px; color: var(--text-secondary); margin-bottom: 4px; display: flex; justify-content: space-between; letter-spacing: 0.06em; text-transform: uppercase; }
  .delta-label .pct { color: var(--success); }
  .delta-bar-before { margin-bottom: 3px; }
  .thread-row { display: grid; grid-template-columns: 68px 1fr auto; gap: 9px; padding: 6px 0; border-bottom: 1px solid var(--border); align-items: baseline; font-size: 9px; font-family: var(--font-mono); }
  .thread-row:last-child { border-bottom: none; }
  .thread-row .sub { color: var(--text-secondary); text-transform: uppercase; }
  .thread-row .title { color: var(--text-display); font-family: var(--font-ui); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .thread-row .drafts { color: var(--warning); text-transform: uppercase; }
  .thread-row .drafts.watch { color: var(--text-disabled); }
  .kw-row { margin-bottom: 8px; }
  .kw-head { display: flex; justify-content: space-between; font-size: 9px; color: var(--text-display); margin-bottom: 4px; letter-spacing: 0.06em; text-transform: uppercase; }
  .kw-head .vol { color: var(--text-secondary); }

  /* ── Responsive ── */
  @media (min-width: 1400px) {
    #capability-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @media (max-width: 1200px) {
    #founders-hero-shell { grid-template-columns: 1fr; gap: 32px; }
  }
  @media (max-width: 900px) {
    #founders-shell { padding: 104px 24px 64px; }
    #founders-top-strip-inner { padding: 0 24px; }
    #dashboard-source-cta-row { width: 100%; }
    #capability-section { padding-top: 0; }
    #capability-section-shell { grid-template-columns: 1fr; }
    #capability-nav-col { order: -1; position: static; flex-direction: row; flex-wrap: wrap; gap: 6px; z-index: 10; }
    .capability-nav-btn { flex: 1 1 auto; min-width: 0; padding: 10px 16px; border-radius: 999px; flex-direction: row; align-items: center; justify-content: center; gap: 0; width: auto; background: rgba(255, 255, 255, 1); }
    .capability-nav-btn:hover { background: rgba(255, 255, 255, 1); box-shadow: 0px 5px 10px rgba(0, 0, 0, 0.067), 0px 15px 30px rgba(0, 0, 0, 0.067), 0px 20px 40px rgba(0, 0, 0, 0.1); }
    .capability-nav-btn::before { border-radius: 999px; }
    .capability-nav-btn--active::before {
      background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
      opacity: 1;
    }
    #capability-nav-col:hover .capability-nav-btn--active::before {
      background: linear-gradient(180deg, rgba(228,228,228,0.9), transparent 62%);
      opacity: 0.85;
    }
    #capability-nav-col:hover .capability-nav-btn--active:hover::before {
      background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
      opacity: 1;
    }
    .capability-nav-btn-sub { display: none; }
    .capability-nav-btn-label { font-family: var(--font-mono); font-size: 11px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; }
    .capability-nav-btn-label-full { display: none; }
    .capability-nav-btn-label-short { display: inline; }
    .capability-nav-btn-content { flex-direction: row; align-items: center; gap: 0; }
    .capability-nav-btn-icon-wrap { display: none; }
    #capability-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tile-solution-actions { flex-direction: column; align-items: stretch; gap: 10px; }
    .tile { aspect-ratio: auto; min-height: 230px; grid-template-areas: "num" "head" "desc" "viz" "foot"; grid-template-columns: 1fr; row-gap: 14px; }
    .tile-description { }
    #intake-identity-row { grid-template-columns: 1fr; gap: 16px; }
    #audit-viz-bars .audit-bar-item:nth-child(n+3) { display: none; }
  }
  @media (max-width: 520px) {
    #capability-grid { grid-template-columns: 1fr; grid-auto-rows: auto; }
    .tile-intake-card { height: auto; min-height: unset; padding: 12px 14px; gap: 10px; }
    /* Preserve the desktop shell aspect ratio on mobile — never shrink the
       shell's height relative to its width. Remove the prior max-height cap
       and the aspect-ratio: auto override that squashed the card on phones. */
    .tile-intake-placeholder {
      aspect-ratio: 1536 / 1024;
      flex: none;
      min-height: 0;
      max-height: none;
      overflow: hidden;
    }
    .tile-intake-placeholder-audit-summary { flex: none; min-height: 220px; }
    /* Keep the full copy at a readable size — no line-clamp, no hidden
       source/timestamp line. */
    .tile-intake-source-line { display: inline-block; font-size: 11px; }
    .tile-intake-description {
      font-size: 13px;
      line-height: 1.45;
      -webkit-line-clamp: unset;
      display: block;
      -webkit-box-orient: unset;
      overflow: visible;
    }
    .tile-intake-heading { font-size: 16px; line-height: 1.25; }

    /* ── Mobile collapsible cards ────────────────────────────────────────── */
    /* Re-enable pointer events so all cards can be tapped to expand */
    .tile.tile-intake-card--btns-only { pointer-events: auto; }
    .tile-intake-card .tile-number {
      cursor: pointer;
      display: flex;
      align-items: center;
      min-height: 44px;
      padding-top: 4px;
      padding-bottom: 4px;
      user-select: none;
      -webkit-user-select: none;
    }
    .tile-intake-card .tile-header-label {
      color: var(--text-primary);
      font-size: 11px;
      font-weight: 600;
    }
    .tile-mobile-chevron {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--border);
      flex-shrink: 0;
      margin-left: auto;
      transition: background 0.18s ease, transform 0.22s ease;
    }
    .tile-mobile-chevron svg {
      width: 11px;
      height: 11px;
      stroke: var(--text-secondary);
      fill: none;
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: stroke 0.18s ease;
      transform: rotate(0deg);
      transition: transform 0.22s ease;
    }
    .tile-intake-card--mobile-expanded .tile-mobile-chevron {
      background: var(--surface-raised);
    }
    .tile-intake-card--mobile-expanded .tile-mobile-chevron svg {
      transform: rotate(180deg);
    }
    /* Collapsed: hide everything below tile-number */
    .tile-intake-card .tile-intake-placeholder,
    .tile-intake-card .tile-intake-body,
    .tile-intake-card .tile-foot {
      display: none;
    }
    /* Expanded: restore all sections */
    .tile-intake-card--mobile-expanded .tile-intake-placeholder,
    .tile-intake-card--mobile-expanded .tile-intake-placeholder--locked,
    .tile-intake-card--mobile-expanded .tile-intake-body,
    .tile-intake-card--mobile-expanded .tile-foot {
      display: flex;
    }
    .tile-intake-card--mobile-expanded .tile-intake-body {
      flex-direction: column;
    }
  }
  /* Chevron hidden above mobile breakpoint */
  @media (min-width: 521px) {
    .tile-mobile-chevron { display: none; }
  }
  @media (max-width: 620px) {
    #founders-shell { padding-top: 96px; }
    #founders-top-strip-inner {
      gap: 12px;
      padding: 0 12px;
    }
    #founders-top-actions { gap: 0.5rem; }
    #founders-linkedin { font-size: 0.72rem; }
    #founders-login-link { padding: 0.4rem 0.6rem; font-size: 0.55rem; }
    #founders-chat-cta { padding: 0.4rem 0.6rem; font-size: 0.55rem; gap: 0.25rem; }
    .founders-chat-label-full  { display: none; }
    .founders-chat-label-short { display: inline; }
    #capability-section { padding-top: 0; }
    .reseed-run-btn-label-desktop { display: none; }
    .reseed-run-btn-label-mobile { display: inline; }
    #reseed-run-btn-icon { display: none; }
    #founders-hero-meta { width: 100%; max-width: 100%; overflow: hidden; }
    .meta-row { overflow: hidden; }
    .meta-row .value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    #dashboard-source-cta-row { max-width: 100%; box-sizing: border-box; }
    #reseed-run-btn { min-width: 0; }
  }

  #reseed-control-row {
    display: block;
  }
  #dashboard-source-cta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5.6px 5.6px 5.6px 12px;
    background: rgba(255,255,255,0.45);
    border: 1px solid rgba(42,36,32,0.12);
    border-radius: 999px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4), 0 30px 90px rgba(42,36,32,0.12);
    box-sizing: border-box;
    position: relative;
    z-index: 10;
    flex-wrap: nowrap;
  }
  #dashboard-source-cta-icon {
    flex-shrink: 0;
    color: rgba(42,36,32,0.45);
  }
  #reseed-url-input {
    flex: 1;
    min-width: 0;
    max-width: none;
    background: transparent;
    border: none;
    color: rgba(42,36,32,0.75);
    font-family: var(--font-ui);
    font-size: clamp(0.75rem, 1.1vw, 0.88rem);
    padding: 0;
    outline: none;
  }
  #reseed-url-input::placeholder { color: rgba(42,36,32,0.38); }
  #reseed-url-input:disabled { opacity: 0.45; cursor: not-allowed; }
  #reseed-run-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    flex-shrink: 0;
    min-width: 6.75rem;
    padding: 0.5rem 0.75rem;
    font-size: clamp(0.8rem, 1.1vw, 0.875rem);
    font-weight: 700;
    letter-spacing: 0.01em;
    text-decoration: none;
    color: #2a2420;
    background: rgba(255,255,255,0.92);
    border: 1px solid rgba(42,36,32,0.08);
    border-radius: 999px;
    box-shadow: none;
    cursor: pointer;
    white-space: nowrap;
    transform: scale(1);
    transition: background 0.45s ease, box-shadow 0.45s ease, transform 0.45s ease;
  }
  #reseed-run-btn:not(:disabled):hover {
    background: rgba(255,255,255,1);
    box-shadow: 0px 5px 10px rgba(0,0,0,0.067), 0px 15px 30px rgba(0,0,0,0.067), 0px 20px 40px rgba(0,0,0,0.1);
    transform: scale(1.012);
    transition: background 0.28s ease, box-shadow 0.28s ease, transform 0.28s ease;
  }
  #reseed-run-btn:disabled {
    background: rgba(255,255,255,0.72);
    color: #2a2420;
    box-shadow: 0 1px 4px rgba(42,36,32,0.1), inset 0 1px 0 rgba(255,255,255,0.6);
    opacity: 0.65;
    cursor: default;
  }
  .reseed-run-btn-label-mobile { display: none; }
  #reseed-run-btn-icon {
    font-size: 0.7rem;
    opacity: 0.75;
    margin-left: 0.1rem;
  }
  #reseed-active-row {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  #reseed-run-status-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--warning);
  }
  #reseed-cancel-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 6px 14px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-visible);
    cursor: pointer;
    white-space: nowrap;
    transition: color 150ms, border-color 150ms;
  }
  #reseed-cancel-btn:hover:not(:disabled) {
    color: var(--text-display);
    border-color: var(--text-secondary);
  }
  #reseed-cancel-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  #reseed-error-msg {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
  }
  @media (max-width: 620px) {
    #dashboard-source-cta-row {
      gap: 6px;
      padding: 5.6px 5.6px 5.6px 10px;
    }
    #reseed-run-btn {
      min-width: 5.5rem;
      min-height: 2.15rem;
      padding: 0.5rem 0.85rem;
      gap: 0;
    }
    .reseed-run-btn-label-desktop { display: none; }
    .reseed-run-btn-label-mobile {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
  }

  /* ── Intake build modal ── */
  #intake-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    backdrop-filter: blur(5px);
    -webkit-backdrop-filter: blur(5px);
  }
  /* Status row */
  #intake-modal-status-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 0.75rem;
    font-family: "Space Mono", monospace;
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.5);
    flex-wrap: wrap;
  }
  #intake-modal-status-row .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    flex-shrink: 0;
    display: inline-block;
  }
  #intake-modal-status-label { color: rgba(42, 36, 32, 0.72); }
  #intake-modal-sep { color: rgba(42, 36, 32, 0.28); }
  #intake-modal-host-label { color: rgba(42, 36, 32, 0.44); }
  /* Embedded terminal panel */
  #intake-modal-terminal-embed {
    border-radius: 0;
    padding: 0.7rem 0.85rem 0.8rem;
    height: 9rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    max-height: 240px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.08) transparent;
  }
  #intake-modal-terminal-embed::-webkit-scrollbar { width: 3px; }
  #intake-modal-terminal-embed::-webkit-scrollbar-track { background: transparent; }
  #intake-modal-terminal-embed::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  /* Log line */
  .term-line {
    display: grid;
    grid-template-columns: 3.6rem 1fr;
    gap: 0.5em;
    font-family: "Space Mono", monospace;
    font-size: 0.68rem;
    line-height: 1.65;
    align-items: baseline;
  }
  .term-pfx { text-align: right; white-space: nowrap; font-size: 0.64rem; letter-spacing: 0.02em; }
  .term-msg { word-break: break-word; }
  /* One Dark palette — tuned for legibility on #1a1a1a background */
  .term-system .term-pfx, .term-system .term-msg { color: #6b7280; }
  .term-dim    .term-pfx, .term-dim    .term-msg { color: #6b7280; }
  .term-info   .term-pfx { color: #7b8798; }
  .term-info   .term-msg { color: #aab2bd; }
  .term-fetch  .term-pfx { color: #56b6c2; }
  .term-fetch  .term-msg { color: #aee0e3; }
  .term-ok     .term-pfx { color: #98c379; }
  .term-ok     .term-msg { color: #c8e1b4; }
  .term-ai     .term-pfx { color: #c678dd; }
  .term-ai     .term-msg { color: #e3b6f0; }
  .term-build  .term-pfx { color: #e5c07b; }
  .term-build  .term-msg { color: #f0d9a6; }
  .term-error  .term-pfx { color: #e06c75; }
  .term-error  .term-msg { color: #f1a6ac; }
  .term-active .term-pfx { color: #61afef; }
  .term-active .term-msg { color: #eaf0fa; font-weight: 700; }
  .term-screen .term-pfx { color: #7b9eff; }
  .term-screen .term-msg { color: #c5d3f7; }
  .term-mock   .term-pfx { color: #ffb36b; }
  .term-mock   .term-msg { color: #ffd4aa; }
  .term-countdown .term-pfx { color: #ffd78a; }
  .term-countdown .term-msg { color: #ffe3a6; font-weight: 700; font-size: 0.72rem; letter-spacing: 0.03em; }
  /* Blinking block caret */
  .term-caret {
    display: inline-block;
    width: 0.45em;
    height: 0.95em;
    background: #61afef;
    vertical-align: text-bottom;
    margin-left: 2px;
    animation: blink 1s step-start infinite;
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  /* Footer */
  #intake-modal-footer {
    font-family: "Space Mono", monospace;
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.32);
    margin-top: 0.9rem;
    border-top: 1px solid rgba(212, 196, 171, 0.4);
    padding-top: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  #intake-modal-footer-host {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #intake-modal-footer-cancel {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: rgba(42, 36, 32, 0.5);
    cursor: pointer;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    transition: color 0.15s ease;
    flex-shrink: 0;
  }
  #intake-modal-footer-cancel:hover,
  #intake-modal-footer-cancel:focus-visible {
    color: rgba(42, 36, 32, 0.95);
    outline: none;
  }

  /* Retry row — failed-state only */
  /* Old retry bar — removed from DOM, kept as reference */
  #intake-modal-retry-row { display: none; }

  /* Retry prompt inside the survey chat thread */
  #intake-retry-chat-block { padding: 0.5rem 0.75rem 0.75rem; }
  #intake-retry-chat-input {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.6rem;
    padding: 0.4rem 0.5rem;
    background: rgba(255, 252, 248, 0.9);
    border: 1px solid rgba(215, 25, 33, 0.3);
    border-radius: 8px;
  }
  #intake-retry-chat-input input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.82rem;
    color: #2a2420;
  }
  #intake-retry-chat-input button {
    flex-shrink: 0;
    font-family: "Space Mono", monospace;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.4rem 0.8rem;
    background: #D71921;
    color: #fff;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }
  #intake-retry-chat-input button:disabled { opacity: 0.5; cursor: default; }
  #intake-retry-chat-error {
    margin-top: 0.4rem;
    font-family: "Space Mono", monospace;
    font-size: 0.65rem;
    color: #D71921;
  }
  #intake-modal-retry-inner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: rgba(255, 252, 248, 0.7);
    border: 1px solid rgba(215, 25, 33, 0.35);
    border-radius: 8px;
    padding: 0.45rem 0.6rem;
  }
  #intake-modal-retry-icon {
    flex-shrink: 0;
    color: rgba(42, 36, 32, 0.55);
  }
  #intake-modal-retry-input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.95rem;
    color: #2a2420;
    padding: 0.25rem 0;
  }
  #intake-modal-retry-input::placeholder {
    color: rgba(42, 36, 32, 0.38);
  }
  #intake-modal-retry-btn {
    flex-shrink: 0;
    font-family: "Space Mono", monospace;
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #fff;
    background: #D71921;
    border: none;
    border-radius: 6px;
    padding: 0.45rem 0.85rem;
    cursor: pointer;
    transition: background 120ms ease, opacity 120ms ease;
  }
  #intake-modal-retry-btn:hover:not(:disabled) {
    background: #b61319;
  }
  #intake-modal-retry-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  #intake-modal-retry-error {
    margin-top: 0.5rem;
    font-family: "Space Mono", monospace;
    font-size: 0.7rem;
    color: #D71921;
  }
  @media (max-width: 480px) {
    #intake-modal-overlay { padding: 1rem 0.5rem; align-items: center; overflow-y: auto; min-height: 100%; }
    #intake-modal-card { width: 95vw; box-sizing: border-box; margin: auto; }
  }

  /* ── Intake body — 2-col layout when survey is active ── */
  #intake-modal-body {
    display: block;
    margin-top: 0.85rem;
  }
  #intake-modal-card[data-with-survey="true"] #intake-modal-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: 1rem;
    align-items: stretch;
    height: 360px;
  }
  #intake-modal-terminal-col {
    min-width: 0;
    min-height: 0;
    background: #1a1a1a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-top: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow: 0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15);
    border-radius: 10px;
    overflow: hidden;
    margin-top: 0.85rem;
  }
  #intake-modal-terminal-titlebar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.02);
    flex-shrink: 0;
  }
  .term-win-dot {
    width: 0.52rem;
    height: 0.52rem;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .term-win-dot-close { background: rgba(255, 95, 86, 0.65); }
  .term-win-dot-min   { background: rgba(255, 189, 46, 0.65); }
  .term-win-dot-max   { background: rgba(39, 201, 63, 0.65); }
  #intake-modal-terminal-title {
    flex: 1;
    text-align: center;
    font-family: "Space Mono", monospace;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.3);
  }
  #intake-modal-card[data-with-survey="true"] #intake-modal-terminal-col {
    display: flex;
    flex-direction: column;
    margin-top: 0;
  }
  #intake-modal-card[data-with-survey="true"] #intake-modal-terminal-embed {
    margin-top: 0;
    flex: 1 1 auto;
    height: 0;
    min-height: 0;
    max-height: none;
  }
  #intake-modal-survey-col {
    min-width: 0;
    min-height: 0;
    /* clip for border-radius without creating a blocking scroll context */
    overflow: clip;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    /* explicit height lets flex children use flex: 1 correctly */
    height: 100%;
  }
  @media (max-width: 900px) {
    #intake-modal-overlay {
      align-items: flex-start;
      overflow-y: auto;
      padding: 1rem 0.75rem;
    }
    #intake-modal-card {
      width: 95vw;
      box-sizing: border-box;
    }
    #intake-modal-card[data-with-survey="true"] #intake-modal-body {
      grid-template-columns: 1fr;
      height: auto;
    }
    #intake-modal-card[data-with-survey="true"] #intake-modal-terminal-col {
      height: 180px;
      flex-shrink: 0;
    }
    #intake-modal-card[data-with-survey="true"] #intake-modal-terminal-embed {
      height: 0;
      max-height: none;
    }
    #intake-modal-survey-col {
      /* on mobile the body is height:auto — cap the chat column so it scrolls */
      max-height: 420px;
      height: auto;
    }
  }

  /* ── Onboarding survey — embedded column inside the intake card ── */
  #onboarding-survey-card {
    position: relative;
    width: 100%;
    box-sizing: border-box;
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
    flex: 1 1 auto;
  }
  #onboarding-step-header {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }
  #onboarding-step-sig {
    width: 2rem;
    height: auto;
    display: block;
    flex-shrink: 0;
  }
  #onboarding-step-eyebrow {
    font-family: "Space Mono", monospace;
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.58);
    font-weight: 700;
    flex: 1;
  }
  #onboarding-step-progress {
    font-family: "Space Mono", monospace;
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    color: rgba(42, 36, 32, 0.44);
    flex-shrink: 0;
  }
  #onboarding-step-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(42, 36, 32, 0.12);
    cursor: pointer;
    font-size: 0.78rem;
    color: rgba(42, 36, 32, 0.62);
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    flex-shrink: 0;
  }
  #onboarding-step-close:hover:not(:disabled) {
    color: rgba(42, 36, 32, 0.92);
    border-color: rgba(42, 36, 32, 0.28);
    background: rgba(255, 255, 255, 0.78);
  }
  #onboarding-step-close:disabled {
    opacity: 0.5;
    cursor: default;
  }
  #onboarding-progress-rail {
    position: relative;
    height: 2px;
    background: rgba(42, 36, 32, 0.12);
    border-radius: 999px;
    overflow: hidden;
  }
  #onboarding-progress-fill {
    display: block;
    height: 100%;
    background: rgba(42, 36, 32, 0.72);
    border-radius: 999px;
    transition: width 0.32s ease;
  }
  #onboarding-step-title {
    margin: 0;
    color: #2a2420;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-weight: 700;
    font-size: clamp(1.35rem, 3.2vw, 1.85rem);
    line-height: 1.15;
    letter-spacing: -0.02em;
  }
  #onboarding-step-helper {
    margin: -0.3rem 0 0;
    color: rgba(42, 36, 32, 0.6);
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.92rem;
    line-height: 1.5;
  }
  #onboarding-step-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
    margin-top: 0.2rem;
    overflow-y: auto;
    min-height: 0;
    flex: 1 1 auto;
    padding-right: 0.25rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(42,36,32,0.22) transparent;
  }
  #onboarding-step-options::-webkit-scrollbar { width: 4px; }
  #onboarding-step-options::-webkit-scrollbar-thumb { background: rgba(42,36,32,0.22); border-radius: 2px; }
  #onboarding-step-options::-webkit-scrollbar-track { background: transparent; }
  #onboarding-step-options[data-select-type="text"] {
    grid-template-columns: 1fr;
  }
  .onboarding-option-tile {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    text-align: left;
    padding: 0.85rem 1rem;
    border-radius: 0.85rem;
    border: 1px solid rgba(42, 36, 32, 0.14);
    background: rgba(255, 255, 255, 0.72);
    color: #2a2420;
    cursor: pointer;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.95rem;
    line-height: 1.3;
    transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);
  }
  .onboarding-option-tile:hover {
    border-color: rgba(42, 36, 32, 0.36);
    background: rgba(255, 255, 255, 0.92);
  }
  .onboarding-option-tile.is-selected {
    border-color: #2a2420;
    background: #2a2420;
    color: #faf7f2;
    box-shadow: 0 1px 0 rgba(255,255,255,0.2), inset 0 1px 0 rgba(255,255,255,0.08);
  }
  .onboarding-option-label {
    display: block;
    font-weight: 500;
  }
  #onboarding-step-textarea {
    width: 100%;
    min-height: 8rem;
    resize: vertical;
    padding: 0.85rem 1rem;
    border-radius: 0.85rem;
    border: 1px solid rgba(42, 36, 32, 0.14);
    background: rgba(255, 255, 255, 0.82);
    color: #2a2420;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.95rem;
    line-height: 1.45;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  #onboarding-step-textarea:focus {
    border-color: rgba(42, 36, 32, 0.42);
    background: #fff;
  }
  #onboarding-step-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.4rem;
  }
  #onboarding-step-footer-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  #onboarding-skip-all,
  #onboarding-back,
  #onboarding-next {
    appearance: none;
    cursor: pointer;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.88rem;
    border-radius: 999px;
    padding: 0.55rem 1.05rem;
    line-height: 1;
    transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
  }
  #onboarding-skip-all {
    background: transparent;
    border: 1px solid transparent;
    color: rgba(42, 36, 32, 0.56);
  }
  #onboarding-skip-all:hover:not(:disabled) {
    color: #2a2420;
  }
  #onboarding-back {
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(42, 36, 32, 0.14);
    color: rgba(42, 36, 32, 0.72);
  }
  #onboarding-back:hover:not(:disabled) {
    color: #2a2420;
    border-color: rgba(42, 36, 32, 0.32);
  }
  #onboarding-next {
    background: #2a2420;
    border: 1px solid #2a2420;
    color: #faf7f2;
    font-weight: 600;
  }
  #onboarding-next:hover:not(:disabled) {
    background: #1a1412;
    border-color: #1a1412;
  }
  #onboarding-skip-all:disabled,
  #onboarding-back:disabled,
  #onboarding-next:disabled {
    opacity: 0.5;
    cursor: default;
  }
  @media (max-width: 480px) {
    #onboarding-step-options { grid-template-columns: 1fr; }
  }

  /* ── Onboarding chat modal ── */
  #onboarding-chat-shell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    max-height: 100%;
    flex: 1 1 auto;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.5) 100%);
    box-shadow: 0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-radius: 10px;
    border: 1px solid rgba(42, 36, 32, 0.1);
    overflow: hidden;
  }
  #onboarding-chat-header {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid rgba(42, 36, 32, 0.08);
    background: rgba(255, 255, 255, 0.7);
    flex-shrink: 0;
  }
  #onboarding-chat-avatar-wrap {
    position: relative;
    flex-shrink: 0;
  }
  #onboarding-chat-avatar-img {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 999px;
    object-fit: cover;
    display: block;
  }
  #onboarding-chat-online-dot {
    position: absolute;
    bottom: 1px;
    right: 1px;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 999px;
    background: #4A9E5C;
    border: 2px solid rgba(255, 252, 248, 0.92);
  }
  #onboarding-chat-identity {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1;
    min-width: 0;
  }
  #onboarding-chat-name {
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-weight: 700;
    font-size: 0.88rem;
    color: #2a2420;
    line-height: 1.2;
  }
  #onboarding-chat-subtitle {
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.72rem;
    color: rgba(42, 36, 32, 0.5);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #onboarding-chat-badge {
    font-family: "Space Mono", monospace;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.62);
    border: 1px solid rgba(42, 36, 32, 0.18);
    border-radius: 999px;
    padding: 0.25rem 0.6rem;
    white-space: nowrap;
    flex-shrink: 0;
  }
  #onboarding-chat-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(42, 36, 32, 0.12);
    cursor: pointer;
    font-size: 0.76rem;
    color: rgba(42, 36, 32, 0.55);
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease;
  }
  #onboarding-chat-close:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.85);
    color: rgba(42, 36, 32, 0.9);
  }
  #onboarding-chat-close:disabled { opacity: 0.4; cursor: default; }
  #onboarding-chat-step-count {
    font-family: "Space Mono", monospace;
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    color: rgba(42, 36, 32, 0.44);
    flex-shrink: 0;
    white-space: nowrap;
  }
  #onboarding-chat-progress-rail {
    height: 2px;
    background: rgba(42, 36, 32, 0.08);
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
  }
  #onboarding-chat-progress-fill {
    display: block;
    height: 100%;
    background: linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    transition: width 0.35s ease;
  }
  /* Messages scroll area */
  #onboarding-chat-messages {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(42,36,32,0.14) transparent;
  }
  #onboarding-chat-messages::-webkit-scrollbar { width: 3px; }
  #onboarding-chat-messages::-webkit-scrollbar-thumb { background: rgba(42,36,32,0.14); border-radius: 2px; }
  #onboarding-chat-messages::-webkit-scrollbar-track { background: transparent; }
  @keyframes chat-msg-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .chat-turn { display: flex; flex-direction: column; gap: 0.5rem; animation: chat-msg-in 0.22s ease; }
  .chat-row-user { animation: chat-msg-in 0.18s ease; }
  .chat-row { display: flex; align-items: flex-end; gap: 0.5rem; }
  .chat-row-bot { justify-content: flex-start; }
  .chat-row-user { justify-content: flex-end; }
  .chat-avatar-sm {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 999px;
    object-fit: cover;
    flex-shrink: 0;
    display: block;
  }
  .chat-bubble {
    max-width: 82%;
    padding: 0.6rem 0.85rem;
    border-radius: 1rem;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.9rem;
    line-height: 1.45;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .chat-bubble-bot {
    background: #ffffff;
    border: 1px solid rgba(42, 36, 32, 0.09);
    border-bottom-left-radius: 0.2rem;
    color: #2a2420;
    box-shadow: 0 1px 3px rgba(42,36,32,0.06);
  }
  .chat-bubble-user {
    background: #2a2420;
    color: #faf7f2;
    border-bottom-right-radius: 0.2rem;
    font-size: 0.88rem;
  }
  .chat-eyebrow {
    font-family: "Space Mono", monospace;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.44);
    font-weight: 700;
  }
  .chat-question {
    font-weight: 300;
    font-size: clamp(1.15rem, 2vw, 1.6rem);
    color: rgba(42, 36, 32, 0.75);
    line-height: 1.4;
  }
  .chat-helper {
    font-size: 0.8rem;
    color: rgba(42, 36, 32, 0.55);
  }
  /* Typing indicator */
  .chat-typing-bubble {
    flex-direction: row;
    gap: 0.3rem;
    align-items: center;
    padding: 0.65rem 1rem;
  }
  .typing-dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 999px;
    background: rgba(42, 36, 32, 0.35);
    animation: typing-bounce 1.2s ease-in-out infinite;
  }
  .typing-dot:nth-child(2) { animation-delay: 0.18s; }
  .typing-dot:nth-child(3) { animation-delay: 0.36s; }
  @keyframes typing-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-0.3rem); opacity: 1; }
  }
  /* Options zone */
  .chat-options-zone {
    padding-left: 2.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .chat-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .chat-chip {
    appearance: none;
    cursor: pointer;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.82rem;
    font-weight: 500;
    padding: 0.4rem 0.85rem;
    border-radius: 999px;
    border: 1px solid #2a2420;
    background: #fff;
    color: #2a2420;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    line-height: 1.3;
  }
  .chat-chip:hover:not(:disabled) {
    background: #2a2420;
    border-color: #2a2420;
    color: #faf7f2;
  }
  .chat-chip.is-selected {
    background: #2a2420;
    border-color: #2a2420;
    color: #faf7f2;
  }
  .chat-chip:disabled { opacity: 0.5; cursor: default; }
  .chat-chip-primary {
    background: #2a2420;
    border-color: #2a2420;
    color: #faf7f2;
    font-weight: 600;
  }
  .chat-chip-primary:hover:not(:disabled) {
    background: #1a1412;
    border-color: #1a1412;
    color: #faf7f2;
  }
  /* Text input + action row */
  .chat-text-wrap { display: flex; flex-direction: column; gap: 0.4rem; width: 100%; }
  .chat-text-input {
    width: 100%;
    resize: vertical;
    padding: 0.65rem 0.85rem;
    border-radius: 0.65rem;
    border: 1px solid rgba(42, 36, 32, 0.14);
    background: rgba(255, 255, 255, 0.9);
    color: #2a2420;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.88rem;
    line-height: 1.45;
    outline: none;
    transition: border-color 0.15s ease;
    box-sizing: border-box;
  }
  .chat-text-input:focus { border-color: rgba(42, 36, 32, 0.42); }
  .chat-text-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.4rem;
  }
  .chat-skip-btn {
    appearance: none;
    cursor: pointer;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.8rem;
    padding: 0.38rem 0.8rem;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(42, 36, 32, 0.5);
    transition: color 0.13s ease;
  }
  .chat-skip-btn:hover:not(:disabled) { color: #2a2420; }
  .chat-skip-btn:disabled { opacity: 0.4; cursor: default; }
  .chat-confirm-btn {
    appearance: none;
    cursor: pointer;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.82rem;
    font-weight: 600;
    padding: 0.4rem 1rem;
    border-radius: 999px;
    border: 1px solid #2a2420;
    background: #2a2420;
    color: #faf7f2;
    transition: background 0.13s ease, border-color 0.13s ease;
  }
  .chat-confirm-btn:hover:not(:disabled) { background: #1a1412; border-color: #1a1412; }
  .chat-confirm-btn:disabled { opacity: 0.45; cursor: default; }
  /* Inline helpers used by file upload + short-text-list step types */
  .chat-header-image {
    width: 100%;
    margin: 0.45rem 0 0.5rem;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid rgba(42, 36, 32, 0.08);
    max-height: 140px;
    background: #0d0d0d;
  }
  .chat-header-image img {
    display: block;
    width: 100%;
    height: 140px;
    object-fit: cover;
    object-position: top;
  }
  .chat-files-summary {
    font-family: "Space Mono", monospace;
    font-size: 0.7rem;
    line-height: 1.45;
    color: rgba(42, 36, 32, 0.6);
    background: rgba(42, 36, 32, 0.03);
    border: 1px solid rgba(42, 36, 32, 0.08);
    border-radius: 6px;
    padding: 0.45rem 0.6rem;
    word-break: break-word;
  }
  .chat-upload-error {
    font-family: "Space Mono", monospace;
    font-size: 0.68rem;
    color: #D71921;
    margin-top: 0.3rem;
  }
  .chat-helper-inline {
    font-family: "Space Mono", monospace;
    font-size: 0.66rem;
    color: rgba(42, 36, 32, 0.5);
    line-height: 1.45;
  }
  /* Footer */
  #onboarding-chat-footer {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0.6rem 1rem;
    border-top: 1px solid rgba(42, 36, 32, 0.07);
    background: rgba(255, 255, 255, 0.5);
    flex-shrink: 0;
  }
  #onboarding-chat-skip-all {
    appearance: none;
    cursor: pointer;
    font-family: "Space Grotesk", system-ui, sans-serif;
    font-size: 0.78rem;
    padding: 0.35rem 0.8rem;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(42, 36, 32, 0.45);
    transition: color 0.13s ease;
  }
  #onboarding-chat-skip-all:hover:not(:disabled) { color: #2a2420; }
  #onboarding-chat-skip-all:disabled { opacity: 0.4; cursor: default; }

  /* ── Tier modal ── */
  #tier-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 360;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  #tier-modal-fullscreen {
    width: 90vw;
    height: 90vh;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    position: relative;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.3);
  }
  #tier-modal-close {
    position: absolute;
    top: 12px;
    right: 16px;
    z-index: 10;
    background: none;
    border: 1px solid rgba(42, 36, 32, 0.1);
    border-radius: 4px;
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    cursor: pointer;
    color: var(--text-secondary);
    line-height: 1;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  #tier-modal-close:hover {
    color: var(--text-display);
    border-color: var(--text-secondary);
  }
  #tier-modal-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
  }
  #tier-modal-top {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  #tier-modal-brand-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    justify-content: space-between;
  }
  #tier-modal-eyebrow {
    font-size: 0.82rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(42,36,32,0.44);
    font-weight: 700;
    font-family: "Space Mono", monospace;
  }
  #tier-modal-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  #tier-modal-title {
    margin: 0;
    color: #2a2420;
    font-size: clamp(2rem, 8.5vw, 4.5rem);
    line-height: 1;
    letter-spacing: -0.04em;
    font-family: "Doto", "Space Mono", monospace;
    font-weight: 700;
  }
  #tier-modal-summary {
    margin: 0;
    color: rgba(42,36,32,0.66);
    line-height: 1.6;
    font-family: "Space Grotesk", system-ui, sans-serif;
  }
  #tier-modal-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin-top: 1.25rem;
  }
  .tier-option-card {
    padding: 16px;
    border-radius: 1rem;
    border: 1px solid rgba(212, 196, 171, 0.82);
    background: rgba(255,255,255,0.52);
    box-shadow: 0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tier-option-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: baseline;
  }
  .tier-option-label {
    font-size: 1rem;
    font-weight: 700;
    color: #2a2420;
    letter-spacing: -0.03em;
  }
  .tier-option-price {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(42,36,32,0.56);
  }
  .tier-option-summary {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.55;
    color: rgba(42,36,32,0.68);
  }
  #tier-modal-footer {
    font-family: "Space Mono", monospace;
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.32);
    margin-top: 1rem;
    border-top: 1px solid rgba(212, 196, 171, 0.4);
    padding-top: 0.75rem;
  }
  @media (max-width: 780px) {
    #tier-modal-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 480px) {
    #tier-modal-overlay { padding: 1rem; align-items: flex-start; padding-top: 1.5rem; }
    #tier-modal-card { width: 100%; box-sizing: border-box; }
  }

  /* ── Account delete + client edit modals ── */
  #client-edit-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }
  #delete-account-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(1rem, 5vw, 2rem);
  }
  #client-edit-modal {
    position: relative;
    background: #14100c;
    color: #e7d9c3;
    border: 1px solid rgba(231, 217, 195, 0.18);
    border-radius: 6px;
    padding: 1.5rem 1.5rem 1.25rem;
    max-width: 460px;
    width: 100%;
    font-family: var(--font-mono, monospace);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  }
  #client-edit-modal-close {
    position: absolute;
    top: 10px;
    right: 10px;
    background: transparent;
    border: none;
    color: rgba(231, 217, 195, 0.6);
    font-size: 11px;
    cursor: pointer;
    letter-spacing: 0.1em;
  }
  #client-edit-modal-close:hover { color: #e7d9c3; }
  #client-edit-modal-title {
    margin: 0 0 0.75rem;
    font-size: 14px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #e7d9c3;
  }
  #client-edit-modal-body {
    margin: 0 0 1rem;
    font-size: 12px;
    line-height: 1.5;
    color: rgba(231, 217, 195, 0.7);
    font-family: system-ui, -apple-system, sans-serif;
  }
  #client-edit-label {
    display: block;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(231, 217, 195, 0.65);
    margin-bottom: 0.4rem;
  }
  #client-edit-input {
    width: 100%;
    box-sizing: border-box;
    background: #0b0906;
    border: 1px solid rgba(231, 217, 195, 0.18);
    color: #e7d9c3;
    padding: 0.55rem 0.7rem;
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    letter-spacing: 0.04em;
    border-radius: 3px;
    outline: none;
  }
  #client-edit-input:focus { border-color: rgba(231, 217, 195, 0.5); }
  #client-edit-modal-error {
    margin: 0.6rem 0 0;
    padding: 0.5rem 0.6rem;
    background: rgba(239, 68, 68, 0.1);
    border-left: 2px solid #ef4444;
    color: #f87171;
    font-size: 11px;
    line-height: 1.4;
  }
  #client-edit-modal-actions {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    margin-top: 1.1rem;
  }
  #client-edit-modal-cancel,
  #client-edit-modal-confirm {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0.55rem 0.9rem;
    border-radius: 3px;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  #client-edit-modal-cancel {
    background: transparent;
    border: 1px solid rgba(231, 217, 195, 0.2);
    color: rgba(231, 217, 195, 0.75);
  }
  #client-edit-modal-cancel:hover { color: #e7d9c3; border-color: rgba(231, 217, 195, 0.4); }
  #client-edit-modal-confirm {
    background: #e7d9c3;
    border: 1px solid #e7d9c3;
    color: #14100c;
    font-weight: 600;
  }
  #client-edit-modal-confirm:hover:not(:disabled) { background: #fff; border-color: #fff; }
  #client-edit-modal-confirm:disabled,
  #client-edit-modal-cancel:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Delete modal — redesigned to match login screen design system */
  #delete-account-modal {
    position: relative;
    width: 100%;
    max-width: 30rem;
    padding: clamp(1.25rem, 5vw, 2rem);
    border-radius: 1.1rem;
    box-sizing: border-box;
    background: rgba(255, 252, 248, 0.94);
    backdrop-filter: blur(28px);
    -webkit-backdrop-filter: blur(28px);
    border: 1px solid rgba(212, 196, 171, 0.82);
    box-shadow: 0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4), 0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15);
    font-family: var(--font-ui, "Space Grotesk", system-ui, sans-serif);
    color: #2a2420;
  }
  #delete-account-brand-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
    justify-content: space-between;
  }
  #delete-account-sig {
    width: 2.75rem;
    height: auto;
    display: block;
  }
  #delete-account-eyebrow {
    font-size: 0.82rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.44);
    font-weight: 700;
    font-family: var(--font-mono, monospace);
  }
  #delete-account-modal-close {
    width: 2.4rem;
    height: 2.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: rgba(255,255,255,0.34);
    border: 1px solid rgba(42, 36, 32, 0.12);
    color: rgba(42, 36, 32, 0.58);
    font-size: 1.05rem;
    font-family: var(--font-mono, monospace);
    line-height: 1;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
    flex-shrink: 0;
  }
  #delete-account-modal-close:hover {
    background: rgba(255,255,255,1);
    color: #2a2420;
  }
  #delete-account-modal-headline {
    margin: 0 0 0.7rem;
    color: #2a2420;
    font-size: clamp(1.4rem, 4.5vw, 2.4rem);
    line-height: 1.05;
    letter-spacing: -0.02em;
    font-family: "Doto", "Space Mono", monospace;
    font-weight: 700;
    text-align: center;
    white-space: nowrap;
  }
  #delete-account-modal-copy {
    margin: 0 0 1.2rem;
    color: rgba(42, 36, 32, 0.66);
    line-height: 1.6;
    font-family: var(--font-ui, "Space Grotesk", system-ui, sans-serif);
    text-align: center;
    font-size: 0.92rem;
  }
  #delete-account-confirm-label {
    display: block;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(42, 36, 32, 0.55);
    font-family: var(--font-mono, monospace);
    margin-bottom: 0.4rem;
  }
  #delete-account-confirm-label strong { color: #8b1e1e; }
  #delete-account-confirm-input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.9rem 1rem;
    border-radius: 0.95rem;
    border: 1px solid rgba(42, 36, 32, 0.12);
    background: rgba(255,255,255,0.72);
    color: #2a2420;
    font-family: var(--font-ui, "Space Grotesk", system-ui, sans-serif);
    font-size: 1rem;
    outline: none;
    transition: border-color 0.2s ease;
  }
  #delete-account-confirm-input:focus { border-color: rgba(42, 36, 32, 0.35); }
  #delete-account-modal-error {
    margin: 0.6rem 0 0;
    color: #8b1e1e;
    font-size: 0.82rem;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.04em;
    line-height: 1.4;
  }
  #delete-account-modal-actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1.4rem;
  }
  #delete-account-modal-confirm {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 3rem;
    width: 100%;
    border: none;
    border-radius: 999px;
    background: linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    color: #fff;
    font-weight: 700;
    font-size: 0.95rem;
    cursor: pointer;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    line-height: 1;
    transition: box-shadow 0.28s ease, transform 0.28s ease;
  }
  #delete-account-modal-confirm:hover:not(:disabled) {
    box-shadow: 0px 5px 10px rgba(0,0,0,0.067), 0px 15px 30px rgba(0,0,0,0.067), 0px 20px 40px rgba(0,0,0,0.1);
    transform: scale(1.012);
  }
  #delete-account-modal-confirm:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
  #delete-account-modal-cancel {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    min-height: 3rem;
    width: 100%;
    border-radius: 999px;
    border: 1px solid rgba(42, 36, 32, 0.18);
    background: rgba(255,255,255,0.92);
    color: #3c3c3c;
    font-weight: 500;
    font-size: 0.9rem;
    cursor: pointer;
    font-family: var(--font-ui, "Space Grotesk", system-ui, sans-serif);
    letter-spacing: 0.01em;
    box-shadow: 0 1px 3px rgba(42,36,32,0.08);
    line-height: 1;
    transition: background 0.28s ease, box-shadow 0.28s ease, transform 0.28s ease;
  }
  #delete-account-modal-cancel:hover {
    background: rgba(255,255,255,1);
    box-shadow: 0px 5px 10px rgba(0,0,0,0.05), 0px 15px 30px rgba(0,0,0,0.05), 0px 20px 40px rgba(0,0,0,0.08);
    transform: scale(1.012);
  }
  #delete-account-modal-cancel:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

  /* ── Lamp effects ── */
  .lamp {
    box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 12%, transparent), 0 0 10px color-mix(in srgb, currentColor 55%, transparent);
  }
  .lamp-lg {
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent), 0 0 14px color-mix(in srgb, currentColor 60%, transparent);
  }
  .stroke-lit {
    filter: drop-shadow(0 0 3px color-mix(in srgb, currentColor 55%, transparent));
  }
`;

export default DashboardPage;
