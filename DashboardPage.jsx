'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);
import Link from 'next/link';
import {
  ArrowRightLeft,
  ArrowUpRight,
  BriefcaseBusiness,
  House,
  ChartColumnIncreasing,
  LaptopMinimalCheck,
  Lock,
  MessageSquareMore,
  Pencil,
  Search,
  Settings2,
  Workflow,
  Globe,
  X as XIcon,
} from 'lucide-react';
import { BrainIcon } from './components/ui/brain';
import { useAuth } from './AuthContext';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from './firebase';
import { internalPageGlassCardStyle } from './pageSurfaceSystem';
import OnboardingChatModal from './onboarding/OnboardingChatModal';
import onboardingConfig from './onboarding/questions.config.cjs';
import { buildSolutionsList, resolveSolution } from './features/scout-intake/solutions-catalog.mjs';
import { resolveAnalyzerSource, buildCardDescription, buildModuleStateDescription } from './features/scout-intake/card-description-builder.mjs';
import { deriveFindings } from './features/scout-intake/derived-findings.mjs';
import ModuleCardControls from './components/dashboard/ModuleCardControls';

// Entry-flow survey surfaces every question step (excludes the summary, which
// is added in Phase 4). Ordered by the `order` field in questions.config.cjs.
const ONBOARDING_ENTRY_STEPS = onboardingConfig.QUESTION_STEPS;

const ONBOARDING_CARD_IDS = new Set([
  'audit-summary',
  'multi-device-view',
  'social-preview',
  'business-model',
  'seo-performance',
  'industry',
  'visibility-snapshot',
  'style-guide',
  'priority-signal',
]);
const PENDING_DASHBOARD_SIGNUP_KEY = 'pending-dashboard-signup';
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

async function fetchDashboardBootstrap(user) {
  const token = await user.getIdToken();
  const response = await fetch('/api/dashboard/bootstrap', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Could not load dashboard data.');
  return data;
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
    if (countdown > 0) {
      add('countdown', '▶', `launching dashboard in ${countdown}…`);
    } else {
      add('countdown', '▶', 'dashboard ready');
    }
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
  const { user, userProfile, signOutUser } = useAuth();
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
  // null until bootstrap resolves, then synchronously set to 'onboarding' for
  // modular clients without brief data, or 'brief' otherwise. Avoids the flash
  // where the default 'brief' view paints before the effect corrects it.
  const [activeCapabilityFilter, setActiveCapabilityFilter] = useState(null);
  const [chatDraft, setChatDraft] = useState('');
  const [modalChatMode, setModalChatMode] = useState('ai');
  const capabilityGridRef = useRef(null);
  const dashboardVisibleRef = useRef(false);
  const [bootstrap, setBootstrap] = useState({ userProfile: null, client: null, dashboardState: null, recentRuns: [], intelligence: null, moduleConfig: null, moduleState: null });
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
  const modalMarqueeTrackRef = useRef(null);
  const modalMarqueeOffsetRef = useRef(0);
  const modalMarqueeAnimRef = useRef(null);
  const modalMarqueePrevTimeRef = useRef(null);
  const heroMarqueeShellRef = useRef(null);
  const heroMarqueeTrackRef = useRef(null);
  const heroMarqueeCopyRef = useRef(null);
  const [heroMarqueeCopies, setHeroMarqueeCopies] = useState(2);
  const autoProvisionRecoveryAttemptedRef = useRef(false);
  const [reseedUrl, setReseedUrl] = useState('');
  const [reseedLoading, setReseedLoading] = useState(false);
  const [reseedError, setReseedError] = useState('');
  const [reseedSuccess, setReseedSuccess] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const [intakeMockupSrc, setIntakeMockupSrc] = useState(null);
  // HTML preview for the brief tile — fetched from /api/dashboard/brief-preview
  // and injected via iframe srcDoc. Keeps the brief's <style> isolated from
  // the dashboard's own styles.
  const [briefPreviewHtml, setBriefPreviewHtml] = useState('');

  // Fetch the brief HTML for the Brief tile's miniature preview. Re-fetches
  // whenever latestRunId changes so the tile always shows the newest render.
  // Cache-busted with the runId + `cache: 'no-store'` to defeat both browser
  // and Next.js response caches.
  useEffect(() => {
    if (!user) return;
    const dash = bootstrap?.dashboardState;
    const runId = dash?.latestRunId || null;
    if (!dash?.scribe?.brief) { setBriefPreviewHtml(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const url = runId
          ? `/api/dashboard/brief-preview?runId=${encodeURIComponent(runId)}`
          : '/api/dashboard/brief-preview';
        const res = await fetch(url, {
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
  }, [user, bootstrap?.dashboardState?.latestRunId, bootstrap?.dashboardState?.scribe?.brief?.headline]);


  // Clock tick
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdownHours((c) => (c <= 9 ? 14 : c - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Reset modal tab to SOLUTIONS each time a card modal opens so users land on
  // the action view first. If the card has no analyzer data, the tab bar isn't
  // rendered and this value is unused.
  useEffect(() => {
    if (activeTileModal?.cardId) {
      setModalTab(activeTileModal.cardId === 'multi-device-view' ? 'desktop' : 'solutions');
    }
  }, [activeTileModal?.cardId]);

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
    fetchDashboardBootstrap(user)
      .then((data) => { if (!cancelledRef.current) setBootstrap(data); })
      .catch((err) => { if (!cancelledRef.current) setBootstrapError(err instanceof Error ? err.message : 'Could not load dashboard data.'); });
  }, [user]);

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
    fetchDashboardBootstrap(user)
      .then((data) => { if (!cancelledRef.current) setBootstrap(data); })
      .catch((err) => { if (!cancelledRef.current) setBootstrapError(err instanceof Error ? err.message : 'Could not load dashboard data.'); })
      .finally(() => { if (!cancelledRef.current) setBootstrapLoading(false); });
    return () => { cancelledRef.current = true; };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setPendingSignupProvision(null);
      autoProvisionRecoveryAttemptedRef.current = false;
      clearPendingDashboardSignup();
      return;
    }
    setPendingSignupProvision(readPendingDashboardSignup());
    autoProvisionRecoveryAttemptedRef.current = false;
  }, [user]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const client = bootstrap.client;
  const recentRuns = bootstrap.recentRuns || [];
  const displayProfile = bootstrap.userProfile || userProfile;
  const currentRun = recentRuns[0] || null;
  const dashboardState = bootstrap.dashboardState;
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
  const aiSeoAudit = seoAnalyzerCard?.skills?.['ai-seo-audit'] ?? null;
  const briefPdfUrl = dashboardState?.artifacts?.briefPdf?.downloadUrl || null;
  // Intelligence-first SEO data: prefer intelligence source, fall back to dashboardState.seoAudit
  const intelligencePayload = bootstrap.intelligence || null;
  const moduleConfig = bootstrap.moduleConfig || null;
  const moduleState  = bootstrap.moduleState  || dashboardState?.modules || null;
  // Set of currently enabled modular card IDs — drives nav gating and card visibility
  const enabledModuleIds = useMemo(() => {
    if (!moduleConfig) return new Set();
    return new Set(Object.entries(moduleConfig).filter(([, cfg]) => cfg?.enabled === true).map(([id]) => id));
  }, [moduleConfig]);
  const seoAudit = intelligencePayload?.dashboardSeoAudit ?? dashboardState?.seoAudit ?? null;
  const aiVisibility = aiSeoAudit?.aiVisibility ?? null;
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
  if (latestRunStatus === 'queued' || latestRunStatus === 'running') {
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
  const showIntakeModal = !bootstrapLoading && (
    (awaitingSignupProvision || !noWorkspaceState) && (
    awaitingSignupProvision
    || (
    isRunActive
    || latestRunStatus === 'failed'
    || completionCountdown !== null
    || (latestRunStatus === 'succeeded' && !surveyResolved && runWasActiveRef.current)
    || (Boolean(client) && clientStatus === 'provisioning' && !hasReadyDashboard)
    ))
  );

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
      fetchDashboardBootstrap(user)
        .then((data) => { if (!cancelledRef.current) setBootstrap(data); })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(interval);
  }, [user, isRunActive]);

  useEffect(() => {
    if (!awaitingSignupProvision) return;
    const interval = setInterval(() => {
      fetchDashboardBootstrap(user)
        .then((data) => { if (!cancelledRef.current) setBootstrap(data); })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [user, awaitingSignupProvision]);

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
    const st = ScrollTrigger.create({
      trigger: nav,
      start: 'top top+=72',
      endTrigger: section,
      end: 'bottom bottom',
      pin: true,
      pinSpacing: false,
    });
    return () => st.kill();
  }, []);

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
  useEffect(() => {
    if (latestRunStatus === prevRunStatusRef.current) return;
    if (latestRunStatus === 'succeeded' && (prevRunStatusRef.current === 'running' || prevRunStatusRef.current === 'queued')) {
      if (surveyResolved) setCompletionCountdown(3);
    }
    prevRunStatusRef.current = latestRunStatus;
  }, [latestRunStatus, surveyResolved]);

  // If the run finished during this session before the survey resolved, start
  // the countdown once the survey becomes resolved. Guarded by:
  //   - runWasActiveRef so returning users (whose run long succeeded) never
  //     trigger a countdown on page load,
  //   - postSurveyRevealFiredRef so this can only fire once per session and
  //     can't loop after the countdown ticks back to null.
  useEffect(() => {
    if (postSurveyRevealFiredRef.current) return;
    if (!runWasActiveRef.current) return;
    if (surveyResolved && latestRunStatus === 'succeeded' && completionCountdown === null) {
      postSurveyRevealFiredRef.current = true;
      setCompletionCountdown(3);
    }
  }, [surveyResolved, latestRunStatus, completionCountdown]);

  // Always land on Data Visualization on first paint. The brief tab hangs
  // until every onboarding card has been run, so defaulting there traps the
  // user in a loading state. User nav clicks still switch to 'brief' on
  // demand. useLayoutEffect so the value is set before the browser paints —
  // no flash from the null initial state.
  useLayoutEffect(() => {
    if (bootstrapLoading) return;
    if (activeCapabilityFilter !== null) return;
    setActiveCapabilityFilter('onboarding');
  }, [bootstrapLoading, activeCapabilityFilter]);

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
        const res = await fetch('/api/dashboard/onboarding', {
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
    const res = await fetch('/api/dashboard/onboarding', {
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
      const res = await fetch('/api/account/update-client', {
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
  }, [user, clientEditLoading, clientNameInput, doBootstrap]);

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
      const endpoint = isFirstRun ? '/api/clients/provision' : '/api/dashboard/reseed-intake';
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
      doBootstrap();
    } catch (err) {
      setReseedError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setReseedLoading(false);
    }
  }, [user, client, reseedUrl, reseedLoading, doBootstrap]);

  const handleCancelRun = useCallback(async () => {
    if (!user || cancelLoading) return;
    setCancelLoading(true);
    setCancelError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/dashboard/cancel-intake', {
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
  }, [user, cancelLoading, doBootstrap]);


  const handleModuleToggle = useCallback(async (cardId, enabled) => {
    if (!user || moduleToggleLoading[cardId]) return;
    setModuleToggleLoading((prev) => ({ ...prev, [cardId]: true }));
    // When enabling (which triggers the first run), poll bootstrap so the
    // terminal UI surfaces mid-run instead of only after the run POST resolves.
    let pollHandle = null;
    const kickBootstrap = () => { try { doBootstrap(); } catch {} };
    if (enabled) {
      setTimeout(kickBootstrap, 400);
      pollHandle = setInterval(kickBootstrap, 2000);
    }
    try {
      const token = await user.getIdToken();
      // Step 1: persist the config change
      const res = await fetch('/api/dashboard/modules/config', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Toggle failed.');
      // Step 2: enabling a card immediately triggers its first run
      if (enabled) {
        await fetch('/api/dashboard/modules/run', {
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
  }, [user, moduleToggleLoading, doBootstrap]);

  const handleModuleRun = useCallback(async (cardId, force = false, options = null, autoEnable = false) => {
    if (!user || moduleRunLoading[cardId]) return;
    setModuleRunLoading((prev) => ({ ...prev, [cardId]: true }));
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
      const res = await fetch('/api/dashboard/modules/run', {
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
  }, [user, moduleRunLoading, doBootstrap]);

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
    if (!cid || !rid || !db) {
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
  }, [client?.clientId, client?.id, currentRun?.runId, currentRun?.id]);

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
      'scout-config':['ai',     '[SCOUT]'],
      skills:        ['ai',     '[SKILL]'],
      scribe:        ['ai',     '[SCRIBE]'],
      brief:         ['ai',     '[BRIEF]'],
      normalize:     ['build',  '[BUILD]'],
      progress:      ['ok',     '✓'],
      error:         ['error',  '✗'],
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
    if (surveyResolved) {
      if (completionCountdown !== null && completionCountdown > 0) {
        tail.push({ type: 'countdown', prefix: '▶', text: `launching dashboard in ${completionCountdown}…`, cursor: false });
      } else {
        tail.push({ type: 'countdown', prefix: '▶', text: 'launching…', cursor: false });
      }
    } else {
      tail.push({ type: 'active', prefix: '▶', text: 'complete the survey above to reveal your dashboard →', cursor: true });
    }
    return tail;
  }, [realEventLines, latestRunStatus, surveyResolved, completionCountdown]);

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
  const resolvedBusinessModel = brandOverview?.businessModel || '';
  const resolvedOpportunities = (strategy?.opportunityMap?.length ? strategy.opportunityMap : latestInsights.length ? latestInsights : []).slice(0, 4);
  const hasBrandToneData = Boolean(brandTone?.primary || brandTone?.secondary || brandTone?.writingStyle || brandTone?.tags?.length);
  const hasStyleGuideData = Boolean(visualIdentity?.summary || visualIdentity?.colorPalette || visualIdentity?.styleNotes || visualIdentity?.styleGuide);
  const sgLogoSrc = siteMeta?.appleTouchIcon || siteMeta?.favicon || null;
  const hasSgColors = Boolean(sgDisplayData?.colors && (sgDisplayData.colors.primary || sgDisplayData.colors.secondary || sgDisplayData.colors.neutral));
  const hasSgType = Boolean(sgDisplayData?.typography?.headingSystem?.fontFamily);
  const hasSgQuadrant = true; // brand-mark quadrant always renders (logo or "NO LOGO" fallback)
  const hasIndustryData = Boolean(resolvedIndustry);
  const hasBusinessModelData = Boolean(resolvedBusinessModel);
  const hasPrioritySignalData = Boolean(resolvedPrioritySignal);
  const hasDraftPostData = Boolean(resolvedDraftPost);
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
  const aiSeoRunWarnings = Array.isArray(currentRun?.warnings)
    ? currentRun.warnings.filter((w) => w?.stage === 'ai-seo')
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
    rows.push({ key: 'ai-seo-run-at', label: 'AI SEO audited at', value: formatLogScalar(aiSeoAudit?.runAt) });
    rows.push({ key: 'ai-seo-model', label: 'AI SEO engine', value: formatLogScalar(aiSeoAudit?.metadata?.model) });
    rows.push({ key: 'ai-seo-cost', label: 'AI SEO cost USD', value: formatLogScalar(aiSeoAudit?.metadata?.estimatedCostUsd) });
    rows.push({ key: 'ai-seo-score', label: 'AI SEO score', value: formatLogScalar(aiVisibility?.score) });
    rows.push({ key: 'ai-seo-grade', label: 'AI SEO grade', value: formatLogScalar(aiVisibility?.letterGrade) });
    rows.push({ key: 'ai-seo-sections', label: 'AI SEO sections', value: formatLogList(aiVisibility?.sections ? Object.entries(aiVisibility.sections) : [], ([key, section]) => `${key}:${section?.score ?? '—'}(${section?.status ?? '—'})`) });
    rows.push({ key: 'ai-seo-findings-critical', label: 'AI SEO critical findings', value: formatLogScalar(countSeverity(aiSeoAudit?.findings, 'critical')) });
    rows.push({ key: 'ai-seo-findings-warning', label: 'AI SEO warning findings', value: formatLogScalar(countSeverity(aiSeoAudit?.findings, 'warning')) });
    rows.push({ key: 'ai-seo-gaps', label: 'AI SEO triggered gaps', value: formatLogScalar(Array.isArray(aiSeoAudit?.gaps) ? aiSeoAudit.gaps.filter((g) => g?.triggered).length : null) });
    rows.push({ key: 'ai-seo-highlights', label: 'AI SEO highlights', value: formatLogList(aiSeoAudit?.highlights) });
    rows.push({ key: 'ai-seo-schema-types', label: 'AI SEO schema types', value: formatLogList(aiSeoAudit?.rawSignals?.schema?.types) });
    rows.push({ key: 'ai-seo-robots-blocked', label: 'AI bots blocked', value: formatLogList(aiSeoAudit?.rawSignals?.robotsAi?.blockedBots, (bot) => bot?.name || bot?.id) });
    rows.push({ key: 'ai-seo-llms-found', label: 'llms.txt found', value: formatLogScalar(aiSeoAudit?.rawSignals?.llmsTxt?.found) });
    rows.push({ key: 'ai-seo-wikidata', label: 'Wikidata entity', value: formatLogScalar(aiSeoAudit?.rawSignals?.entity?.qid || aiSeoAudit?.rawSignals?.entity?.wikidataUrl) });
    rows.push({ key: 'ai-seo-tech-canonical', label: 'AI technical canonical', value: formatLogScalar(aiSeoAudit?.rawSignals?.technical?.canonical) });
    rows.push({ key: 'ai-seo-tech-meta-desc', label: 'AI technical meta description', value: formatLogScalar(aiSeoAudit?.rawSignals?.technical?.metaDescription) });
    rows.push({ key: 'ai-seo-warning-codes', label: 'AI SEO warning codes', value: formatLogList(aiSeoRunWarnings, (w) => w?.code) });
    rows.push({ key: 'ai-seo-warning-msgs', label: 'AI SEO warning messages', value: formatLogList(aiSeoRunWarnings, (w) => w?.message) });
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
    rows.push({ key: 'seo-scribe-warning-codes', label: 'Scribe warning codes', value: formatLogList(scribeRunWarnings, (w) => w?.code) });
    rows.push({ key: 'seo-scribe-warning-msgs', label: 'Scribe warning messages', value: formatLogList(scribeRunWarnings, (w) => w?.message) });
    rows.push({ key: 'seo-guardian-source', label: 'SEO guardian source', value: formatLogScalar(seoGuardianState?.source) });
    rows.push({ key: 'seo-guardian-cost', label: 'SEO guardian cost USD', value: formatLogScalar(seoGuardianState?.runCostData?.estimatedCostUsd) });
    rows.push({ key: 'seo-guardian-validation', label: 'SEO guardian validation', value: formatLogList(seoGuardianState?.validationErrors) });

    // ── AI VISIBILITY section ───────────────────────────────────────────────
    if (aiVisibility) {
      rows.push({ key: 'seo-performance-ai-visibility-section', label: 'AI VISIBILITY', isHeader: true });
      rows.push({ key: 'seo-performance-ai-score-row', label: 'AI Visibility Score', value: `${aiVisibility.score} / 100` });
      rows.push({ key: 'seo-performance-ai-grade-row', label: 'Grade', value: aiVisibility.letterGrade });
      const aiSecs = aiVisibility.sections || {};
      const aiSecLabels = [
        ['llmsTxt',  'llms.txt'],
        ['robotsAi', 'Robots (AI bots)'],
        ['schema',   'Schema'],
        ['content',  'Content'],
        ['entity',   'Entity authority'],
        ['technical','Technical'],
      ];
      for (const [secKey, secLabel] of aiSecLabels) {
        const sec = aiSecs[secKey];
        if (sec != null) {
          rows.push({ key: `seo-performance-ai-${secKey}-row`, label: secLabel, value: sec.score != null ? `${sec.score} / 100` : '—' });
        }
      }
    }

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
  const DETERMINISTIC_CARD_IDS = new Set([
    'audit-summary', 'brief', 'multi-device-view', 'social-preview',
    'business-model', 'seo-performance', 'style-guide', 'industry', 'visibility-snapshot', 'priority-signal',
  ]);

  const intakeCapabilityCards = [
    // ── ONBOARDING ──────────────────────────────────────────────────────────
    {
      id: 'brief',
      category: 'onboarding',
      number: 'BR',
      label: 'BRIEF',
      wide: true,
      title: 'Onboarding Brief',
      description: brandOverview?.headline
        ? brandOverview.headline
        : 'A structured breakdown of your business, positioning, and site. This becomes the baseline for all strategy and recommendations.',
      placeholderLabel: hasIntakeData ? 'BRIEF' : 'NO\nBRIEF',
      rows: hasIntakeData
        ? [
            { key: 'industry',   label: 'Industry',  value: resolvedIndustry || 'Pending' },
            { key: 'model',      label: 'Model',     value: resolvedBusinessModel || 'Pending' },
            { key: 'tone',       label: 'Tone',      value: brandTone?.primary || 'Pending' },
            { key: 'priority',   label: 'Priority',  value: resolvedPrioritySignal || 'Pending' },
            { key: 'channels',   label: 'Channels',  value: strategy?.postStrategy?.formats?.join(' · ') || 'Pending' },
          ]
        : buildWorkNeededRows('Intake has not produced enough signal to generate a reliable brief.'),
      footerLeft: hasIntakeData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'audit-summary',
      category: 'onboarding',
      number: 'AS',
      label: 'AUDIT',
      title: 'Data Summary',
      description: 'Your baseline across performance, SEO, and brand. Shows strengths and critical gaps.',
      ...(() => {
        const ok = (v) => v != null && v !== '' && v !== false;
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
        const aiSeoWarnings = runWarnings.filter((w) => w?.stage === 'ai-seo');
        const skillsWarnings = runWarnings.filter((w) => w?.stage === 'skills');
        const scribeWarnings = runWarnings.filter((w) => w?.stage === 'scribe');
        const countSeverity = (items, severity) => Array.isArray(items) ? items.filter((item) => item?.severity === severity).length : 0;

        const allRows = [
          { key: 'col-header', isAuditRow: true, isColumnHeader: true, label: 'DATA FIELD', tier: 'TIER', status: 'STATUS' },

          // ── SITE EVIDENCE ──
          { key: 'sec-site', isHeader: true, label: 'SITE EVIDENCE' },
          row('site-url',          'Website URL',       client?.websiteUrl),
          row('site-pages',        'Pages crawled',     pages.length || (evidence ? true : null)),
          row('site-title',        'Page title',        siteMeta?.title),
          row('site-meta-desc',    'Meta description',  siteMeta?.description),
          row('site-h1',           'H1 heading',        homePage?.h1?.[0] || brandOverview?.headline),
          row('site-h2',           'H2 headings',       homePage?.h2?.length),
          row('site-body',         'Body paragraphs',   homePage?.bodyParagraphs?.length),
          row('site-cta',          'CTA texts',         homePage?.ctaTexts?.length),
          row('site-nav',          'Nav labels',        homePage?.navLabels?.length),
          row('site-social',       'Social links',      homePage?.socialLinks?.length),
          row('site-contact',      'Contact clues',     homePage?.contactClues?.length),

          // ── SITE META ──
          { key: 'sec-meta', isHeader: true, label: 'SITE META · OG + BROWSER' },
          row('meta-og-title',     'og:title',          siteMeta?.title),
          row('meta-og-desc',      'og:description',    siteMeta?.description),
          row('meta-og-image',     'og:image',          siteMeta?.ogImage),
          row('meta-og-image-alt', 'og:image:alt',      siteMeta?.ogImageAlt),
          row('meta-site-name',    'og:site_name',      siteMeta?.siteName),
          row('meta-og-type',      'og:type',           siteMeta?.type),
          row('meta-locale',       'og:locale',         siteMeta?.locale),
          row('meta-canonical',    'Canonical URL',     siteMeta?.canonical),
          row('meta-favicon',      'Favicon',           siteMeta?.favicon),
          row('meta-apple-icon',   'Apple touch icon',  siteMeta?.appleTouchIcon),
          row('meta-theme',        'Theme color',       siteMeta?.themeColor),

          // ── AI SYNTHESIS ──
          { key: 'sec-synth', isHeader: true, label: 'AI SYNTHESIS' },
          row('synth-headline',    'Brand headline',    brandOverview?.headline),
          row('synth-summary',     'Brand summary',     brandOverview?.summary),
          row('synth-industry',    'Industry',          resolvedIndustry),
          row('synth-model',       'Business model',    resolvedBusinessModel),
          row('synth-audience',    'Target audience',   brandOverview?.targetAudience),
          row('synth-positioning', 'Positioning',       brandOverview?.positioning),
          row('synth-tone-pri',    'Tone (primary)',    brandTone?.primary),
          row('synth-tone-sec',    'Tone (secondary)',  brandTone?.secondary),
          row('synth-tone-tags',   'Tone tags',         brandTone?.tags?.length),

          // ── STRATEGY ──
          { key: 'sec-strategy', isHeader: true, label: 'STRATEGY' },
          row('strat-post',        'Post strategy',     strategy?.postStrategy),
          row('strat-angles',      'Content angles',    strategy?.contentAngles?.length),
          row('strat-opps',        'Opportunity map',   strategy?.opportunityMap?.length),
          row('strat-priority',    'Priority signal',   resolvedPrioritySignal),
          row('strat-draft',       'Sample post',       dashboardState?.outputsPreview?.samplePost),
          row('strat-caption',     'Sample caption',    dashboardState?.outputsPreview?.sampleCaption),

          // ── DESIGN SYSTEM ──
          { key: 'sec-design', isHeader: true, label: 'DESIGN SYSTEM' },
          row('ds-heading-font',   'Heading font',      sgDisplayData?.typography?.headingSystem?.fontFamily),
          row('ds-body-font',      'Body font',         sgDisplayData?.typography?.bodySystem?.fontFamily),
          row('ds-font-scale',     'Type scale',        sgDisplayData?.typography?.scale),
          row('ds-primary-color',  'Primary color',     sgDisplayData?.colors?.primary?.hex),
          row('ds-secondary',      'Secondary color',   sgDisplayData?.colors?.secondary?.hex),
          row('ds-tertiary',       'Tertiary color',    sgDisplayData?.colors?.tertiary?.hex),
          row('ds-neutral',        'Neutral color',     sgDisplayData?.colors?.neutral?.hex),
          row('ds-layout',         'Layout grid',       sgDisplayData?.layout?.grid),
          row('ds-max-width',      'Max width',         sgDisplayData?.layout?.maxWidth),
          row('ds-border-radius',  'Border radius',     sgDisplayData?.layout?.borderRadius),
          row('ds-motion',         'Motion level',      sgDisplayData?.motion?.level),

          // ── PAGESPEED INSIGHTS ──
          { key: 'sec-psi', isHeader: true, label: 'PAGESPEED INSIGHTS' },
          row('psi-perf',          'Performance score', seoAudit?.scores?.performance),
          row('psi-seo',           'SEO score',         seoAudit?.scores?.seo),
          row('psi-a11y',          'Accessibility',     seoAudit?.scores?.accessibility),
          row('psi-bp',            'Best practices',    seoAudit?.scores?.bestPractices),
          row('psi-lcp',           'LCP',               seoAudit?.coreWebVitals?.lcp || seoAudit?.labCoreWebVitals?.lcp),
          row('psi-inp',           'INP',               seoAudit?.coreWebVitals?.inp),
          row('psi-cls',           'CLS',               seoAudit?.coreWebVitals?.cls || seoAudit?.labCoreWebVitals?.cls),
          row('psi-ttfb',          'TTFB',              seoAudit?.coreWebVitals?.ttfb || seoAudit?.labCoreWebVitals?.ttfb),
          row('psi-opps',          'Opportunities',     seoAudit?.opportunities?.length),
          row('psi-red-flags',     'SEO red flags',     seoAudit?.seoRedFlags?.length),
          row('psi-a11y-fail',     'A11y failures',     seoAudit?.a11yFailures?.length),
          row('psi-insights',      'Insights',          seoAudit?.insights?.length),
          row('psi-diagnostics',   'Diagnostics',       seoAudit?.diagnostics?.length),
          row('psi-3p',            'Third parties',     seoAudit?.thirdParties?.length),

          // ── RUN HEALTH ──
          { key: 'sec-run', isHeader: true, label: 'RUN HEALTH' },
          row('run-status',        'Run status',          currentRun?.status || latestRunStatus),
          row('run-timestamp',     'Run timestamp',       currentRun?.updatedAt || dashboardState?.updatedAt),
          row('run-source-url',    'Source URL',          currentRun?.sourceUrl || client?.websiteUrl),
          row('run-error',         'Run error',           currentRun?.error?.message || errorState?.message),
          row('run-warnings',      'Warnings raised',     currentRun ? runWarnings.length : null),
          row('run-psi-warnings',  'PSI warnings',        currentRun ? psiWarnings.length : null),

          // ── PSI TRACE ──
          { key: 'sec-psi-trace', isHeader: true, label: 'PSI TRACE' },
          row('psi-audit-status',  'PSI audit status',    seoAudit?.status),
          row('psi-data',          'PSI data presence',   seoAudit?.scores),
          row('psi-fail-code',     'Failure code',        seoDiagnostics?.failureCode),
          row('psi-fail-class',    'Failure class',       seoDiagnostics?.failureClass),
          row('psi-fail-reason',   'Failure reason',      seoDiagnostics?.failureReason || seoAudit?.error),
          row('psi-input-url',     'Input URL',           seoDiagnostics?.inputUrl || client?.websiteUrl),
          row('psi-req-url',       'Requested URL',       seoMeta?.requestedUrl),
          row('psi-final-url',     'Final URL',           seoMeta?.finalUrl),
          row('psi-display-url',   'Displayed URL',       seoMeta?.finalDisplayedUrl),
          row('psi-resolved-url',  'Resolved URL',        seoDiagnostics?.resolvedUrl),
          row('psi-http-status',   'HTTP status',         seoDiagnostics?.httpStatus),
          row('psi-content-type',  'Content type',        seoDiagnostics?.contentType),
          row('psi-server',        'Server',              seoDiagnostics?.server),
          row('psi-host-service',  'Hosting service',     seoDiagnostics?.hostService),
          row('psi-host-provider', 'Hosting provider',    seoDiagnostics?.hostingProvider),
          row('psi-provider-kind', 'Provider kind',       seoDiagnostics?.providerKind),
          row('psi-provider-confidence', 'Provider confidence', seoDiagnostics?.providerConfidence),
          row('psi-provider-evidence', 'Provider evidence', seoDiagnostics?.providerEvidence?.length),
          row('psi-host-type',     'Host type',           seoDiagnostics?.hostType),
          row('psi-blocked-by',    'Blocked by',          seoDiagnostics?.blockedBy),
          row('psi-probe-status',  'Probe status',        seoDiagnostics?.probeStatus),
          row('psi-probe-err-code','Probe error code',    seoDiagnostics?.probeErrorCode),
          row('psi-probe-err',     'Probe error',         seoDiagnostics?.probeError),
          row('psi-redirects',     'Redirect count',      seoDiagnostics?.redirectCount),
          row('psi-redir-chain',   'Redirect chain',      seoDiagnostics?.redirectChain?.length),
          row('psi-rt-err-code',   'Runtime error code',  seoAudit?.runtimeError?.code || seoDiagnostics?.runtimeErrorCode),
          row('psi-rt-err-msg',    'Runtime error msg',   seoAudit?.runtimeError?.message || seoDiagnostics?.runtimeErrorMessage),
          row('psi-fetch-time',    'Fetch time',          seoMeta?.fetchTime),
          row('psi-duration',      'Duration (ms)',       seoMeta?.totalDurationMs),
          row('psi-lh-version',    'Lighthouse version',  seoMeta?.lighthouseVersion),
          row('psi-lh-warnings',   'Lighthouse warnings', seoMeta?.warnings?.length),

          // ── AI PIPELINE ──
          { key: 'sec-ai-pipeline', isHeader: true, label: 'AI PIPELINE' },
          row('ai-synth-model',    'Synthesis model',     currentRun?.providerUsage?.model),
          row('ai-synth-input',    'Synth input tokens',  currentRun?.providerUsage?.inputTokens),
          row('ai-synth-output',   'Synth output tokens', currentRun?.providerUsage?.outputTokens),
          row('ai-synth-cost',     'Synth cost USD',      currentRun?.providerUsage?.estimatedCostUsd),
          row('ai-az-count',       'Analyzer output cards', analyzerOutputs ? Object.keys(analyzerOutputs).length : null),
          row('ai-seo-run-at',     'AI SEO audited at',   aiSeoAudit?.runAt),
          row('ai-seo-engine',     'AI SEO engine',       aiSeoAudit?.metadata?.model),
          row('ai-seo-cost',       'AI SEO cost USD',     aiSeoAudit?.metadata?.estimatedCostUsd),
          row('ai-seo-score',      'AI SEO score',        aiVisibility?.score),
          row('ai-seo-grade',      'AI SEO grade',        aiVisibility?.letterGrade),
          row('ai-seo-critical',   'AI SEO criticals',    aiSeoAudit ? countSeverity(aiSeoAudit.findings, 'critical') : null),
          row('ai-seo-warning',    'AI SEO warnings',     aiSeoAudit ? countSeverity(aiSeoAudit.findings, 'warning') : null),
          row('ai-seo-gaps',       'AI SEO triggered gaps', Array.isArray(aiSeoAudit?.gaps) ? aiSeoAudit.gaps.filter((g) => g?.triggered).length : null),
          row('ai-seo-highlights', 'AI SEO highlights',   aiSeoAudit?.highlights?.length),
          row('ai-seo-schema',     'Schema types',        aiSeoAudit?.rawSignals?.schema?.types?.length),
          row('ai-seo-bots',       'AI bots blocked',     aiSeoAudit?.rawSignals?.robotsAi?.blockedBots?.length),
          row('ai-seo-llms',       'llms.txt found',      aiSeoAudit?.rawSignals?.llmsTxt?.found),
          row('ai-seo-wikidata',   'Wikidata entity',     aiSeoAudit?.rawSignals?.entity?.qid || aiSeoAudit?.rawSignals?.entity?.wikidataUrl),
          row('ai-seo-warn-codes', 'AI SEO warn codes',   aiSeoWarnings.length || null),
          row('ai-skill-run',      'SEO depth skill',     seoDepthAudit?.runAt),
          row('ai-skill-model',    'SEO depth model',     seoDepthAudit?.metadata?.model),
          row('ai-skill-cost',     'SEO depth cost USD',  seoDepthAudit?.metadata?.estimatedCostUsd),
          row('ai-skill-readiness','SEO depth readiness',  seoDepthAudit?.readiness || seoAnalyzerCard?.aggregate?.readiness),
          row('ai-skill-critical', 'SEO depth criticals', seoDepthAudit ? countSeverity(seoDepthAudit.findings, 'critical') : null),
          row('ai-skill-warning',  'SEO depth warnings',  seoDepthAudit ? countSeverity(seoDepthAudit.findings, 'warning') : null),
          row('ai-skill-gaps',     'SEO depth gaps',      Array.isArray(seoDepthAudit?.gaps) ? seoDepthAudit.gaps.filter((g) => g?.triggered).length : null),
          row('ai-skill-highlights','SEO depth highlights', seoDepthAudit?.highlights?.length),
          row('ai-skills-warn',    'Skills warn codes',   skillsWarnings.length || null),
          row('ai-scribe',         'Scribe output',       scribeCards),
          row('ai-scribe-count',   'Scribe card count',   scribeCards ? Object.keys(scribeCards).length : null),
          row('ai-scribe-headline','Brief headline',       dashboardState?.scribe?.brief?.headline),
          row('ai-scribe-cost',    'Scribe cost USD',     dashboardState?.scribe?.cost?.estimatedCostUsd),
          row('ai-scribe-warn',    'Scribe warn codes',   scribeWarnings.length || null),
          row('ai-seo-guardian-source', 'SEO guardian source', seoGuardianState?.source),
          row('ai-seo-guardian-cost',   'SEO guardian cost USD', seoGuardianState?.runCostData?.estimatedCostUsd),
          row('ai-seo-guardian-errors', 'SEO guardian validation', seoGuardianState?.validationErrors?.length),

          // ── AI VISIBILITY ──
          { key: 'sec-aiv', isHeader: true, label: 'AI VISIBILITY' },
          row('aiv-score',         'AI visibility score', aiVisibility?.score),
          row('aiv-grade',         'Letter grade',      aiVisibility?.letterGrade),
          row('aiv-llms',          'llms.txt',          aiVisibility?.sections?.llmsTxt),
          row('aiv-robots',        'Robots (AI bots)',  aiVisibility?.sections?.robotsAi),
          row('aiv-schema',        'Schema for AI',     aiVisibility?.sections?.schema),
          row('aiv-content',       'AI extractability', aiVisibility?.sections?.content),
          row('aiv-entity',        'Entity authority',  aiVisibility?.sections?.entity),

          // ── SCOUT CONFIG ──
          { key: 'sec-scout', isHeader: true, label: 'SCOUT CONFIG' },
          row('sc-keywords',       'Brand keywords',    scoutCfg?.brandKeywords?.length),
          row('sc-competitors',    'Competitors',       scoutCfg?.competitors?.length),
          row('sc-category',       'Category terms',    scoutCfg?.categoryTerms?.length),
          row('sc-search-plan',    'Search plan',       scoutCfg?.scout?.searchPlan?.length),
          row('sc-reddit',         'Reddit subreddits', scoutCfg?.reddit?.subreddits?.length),

          // ── EXTERNAL SCOUTS ──
          // ── PLATFORM SEARCH ──
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

          // ── SOCIAL MEDIA ──
          { key: 'sec-social', isHeader: true, label: 'SOCIAL MEDIA' },
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

          // ── EXTERNAL SIGNALS ──
          { key: 'sec-ext', isHeader: true, label: 'EXTERNAL SIGNALS' },
          row('ext-weather',       'Weather / local',   null, 2),
          row('ext-reviews',       'Reviews',           null, 2),
          row('ext-google-trends', 'Google Trends',     null, 2),

          // ── ARTIFACTS ──
          { key: 'sec-artifacts', isHeader: true, label: 'ARTIFACTS' },
          row('art-screenshot',    'Homepage screenshot',  homepageScreenshotUrl),
          row('art-full-desktop',  'Full page (desktop)',  fullPageScreenshots['desktop-full']?.downloadUrl),
          row('art-full-tablet',   'Full page (tablet)',   fullPageScreenshots['tablet-full']?.downloadUrl),
          row('art-full-mobile',   'Full page (mobile)',   fullPageScreenshots['mobile-full']?.downloadUrl),
          row('art-mockup',        'Device mockup',        intakeMockupSrc),
          row('art-brief-html',    'Brief HTML',           briefPreviewHtml),
          row('art-brief-pdf',     'Brief PDF',            briefPdfUrl),

          // ── SCRIBE ──
          { key: 'sec-scribe', isHeader: true, label: 'SCRIBE OUTPUT' },
          row('scr-cards',         'Card copy generated',  scribeCards),
          row('scr-brief-hl',      'Brief headline',       dashboardState?.scribe?.brief?.headline),
          row('scr-brief-sum',     'Brief summary',        dashboardState?.scribe?.brief?.summary),

          // ── ANALYZER SKILLS ──
          { key: 'sec-analyzers', isHeader: true, label: 'ANALYZER SKILLS' },
          row('az-seo',            'SEO depth audit',      analyzerOutputs?.['seo-performance']),
          row('az-ai-seo',         'AI SEO audit',         analyzerOutputs?.['seo-performance']?.skills?.['ai-seo-audit']),
          row('az-site-meta',      'Site meta audit',      analyzerOutputs?.['brand-tone']),
          row('az-style-guide',    'Style guide audit',    analyzerOutputs?.['style-guide']),
          row('az-conversion',     'Conversion audit',     analyzerOutputs?.['website-landing']),
          row('az-brand-gap',      'Brand asset gap',      analyzerOutputs?.['brand-identity-design']),
        ];

        const dataRows = allRows.filter((r) => r.isAuditRow && !r.isColumnHeader);
        const captured = dataRows.filter((r) => r._captured).length;
        const total = dataRows.length;

        return {
          placeholderLabel: `${captured}/${total}`,
          rows: allRows,
        };
      })(),
      footerLeft: hasIntakeData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'multi-device-view',
      category: 'onboarding',
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
      id: 'seo-performance',
      category: 'onboarding',
      number: 'SE',
      label: 'SEO HEALTH',
      title: 'SEO + Performance Snapshot',
      description: 'We ran a performance and SEO scan on your site. Load speed, metadata, and structure all impact visibility and conversion — this card shows where you stand.',
      placeholderLabel: isSeoError ? 'SEO\nAUDIT\nFAILED' : isSeoQueued ? 'AUDIT\nQUEUED' : hasSeoAuditData ? 'SEO' : 'NO\nAUDIT',
      rows: seoAuditRows,
      footerLeft: isSeoPartial ? 'Partial' : hasSeoAuditData ? 'Live' : isSeoQueued ? 'Queued' : isSeoError ? 'Error' : WORK_NEEDED_LABEL,
      domId: 'intake-card-seo-performance',
      footerRight: 'REVIEWED',
      moduleControls: { tech: ['pagespeed-insights', 'anthropic', 'ai-seo-audit'] },
    },
    {
      id: 'social-preview',
      category: 'onboarding',
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
      id: 'business-model',
      category: 'onboarding',
      number: 'BM',
      label: 'MODEL',
      title: 'Business Model',
      description: 'Based on your site, we identified your business model and positioning. This helps shape how content, SEO, and messaging should be structured.',
      placeholderLabel: hasBusinessModelData ? 'MODEL' : 'NO\nMODEL',
      rows: hasBusinessModelData
        ? [{ key: 'model', label: 'Structure', value: resolvedBusinessModel }]
        : buildWorkNeededRows('No pricing, packaging, or service structure was clear in fetched pages.'),
      footerLeft: hasBusinessModelData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'style-guide',
      category: 'onboarding',
      number: 'BS',
      label: 'BRAND SNAPSHOT',
      title: 'Brand Snapshot',
      description: 'Your visual system—colors, typography, layout. Highlights inconsistency and missing structure.',
      placeholderLabel: hasStyleGuideData ? 'STYLE' : 'NO\nSTYLE',
      rows: [
        { key: 'sg-heading', label: 'Heading', value: [sgDisplayData?.typography?.headingSystem?.fontFamily, sgDisplayData?.typography?.headingSystem?.fontWeight, sgDisplayData?.typography?.headingSystem?.fontSize].filter(Boolean).join(' · ') || 'Pending' },
        { key: 'sg-body', label: 'Body', value: [sgDisplayData?.typography?.bodySystem?.fontFamily, sgDisplayData?.typography?.bodySystem?.fontSize].filter(Boolean).join(' · ') || 'Pending' },
        { key: 'sg-primary', label: 'Primary', value: sgDisplayData?.colors?.primary ? `${sgDisplayData.colors.primary.hex} · ${sgDisplayData.colors.primary.role}` : 'Pending' },
        { key: 'sg-secondary', label: 'Secondary', value: sgDisplayData?.colors?.secondary?.hex || 'Pending' },
        { key: 'sg-neutral', label: 'Neutral', value: sgDisplayData?.colors?.neutral?.hex || 'Pending' },
      ],
      footerLeft: hasStyleGuideData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'industry',
      category: 'onboarding',
      number: 'MC',
      label: 'CATEGORY',
      title: 'Market Category',
      description: 'We mapped your business into a clear category. This helps benchmark competitors and identify where you should be showing up.',
      placeholderLabel: hasIndustryData ? 'CATEGORY' : 'UNKNOWN',
      rows: hasIndustryData
        ? [{ key: 'sector', label: 'Sector', value: resolvedIndustry }]
        : buildWorkNeededRows('Fetched pages did not clearly identify the market category or service vertical.'),
      footerLeft: hasIndustryData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'visibility-snapshot',
      category: 'onboarding',
      number: 'VS',
      label: 'VISIBILITY',
      title: 'Visibility Snapshot',
      description: 'We checked where your business shows up across search and platforms. This shows what\'s indexed, what\'s visible, and where there\'s room to expand reach.',
      placeholderLabel: aiVisibility ? 'VISIBILITY' : 'NO\nDATA',
      rows: aiVisibility ? [
        { key: 'ai-score',   label: 'AI Visibility', value: `${aiVisibility.score}/100 (${aiVisibility.letterGrade})` },
        ...(aiVisibility.sections ? Object.entries(aiVisibility.sections).map(([k, v]) => ({
          key: `vis-${k}`, label: k, value: v?.score != null ? `${v.score}/100` : '—',
        })) : []),
      ] : buildWorkNeededRows('Visibility data requires a completed audit with AI SEO analysis.'),
      footerLeft: aiVisibility ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },

    {
      id: 'priority-signal',
      category: 'onboarding',
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

    // ── BRAND & PRESENCE ──────────────────────────────────────────────────────
    {
      id: 'brand-voice',
      category: 'brand',
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
          ]
        : buildWorkNeededRows('Not enough long-form copy or repeated messaging was fetched to infer voice.'),
      footerLeft: hasBrandToneData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'trust-credibility',
      category: 'brand',
      number: 'TC',
      label: 'TRUST',
      title: 'Trust & Credibility',
      description: 'Proof signals like reviews, consistency, and authority. Missing trust reduces conversions.',
      placeholderLabel: 'TRUST',
      rows: buildWorkNeededRows('Trust signal analysis requires contact clues, about page, and schema markup data.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },

    // ── WEBSITE & CONVERSION ──────────────────────────────────────────────────
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

    // ── SEARCH & DISCOVERY ────────────────────────────────────────────────────
    {
      id: 'content-gaps',
      category: 'search',
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
      category: 'search',
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

    // ── CONTENT & SOCIAL ──────────────────────────────────────────────────────
    {
      id: 'marketing',
      category: 'content',
      number: 'PS',
      label: 'STRATEGY',
      title: 'Post Strategy',
      description: 'What to post, where, and why—based on gaps and audience signals.',
      placeholderLabel: 'NO\nSTRATEGY',
      rows: buildWorkNeededRows('Post strategy requires brand tone, audience signals, and content gap data.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'draft-post',
      category: 'content',
      number: 'DC',
      label: 'DRAFT',
      title: 'Draft Content',
      description: 'Ready-to-use posts tailored to your brand.',
      placeholderLabel: hasDraftPostData ? 'DRAFT' : 'NO\nDRAFT',
      rows: hasDraftPostData
        ? [{ key: 'post', label: 'Draft', value: resolvedDraftPost }]
        : buildWorkNeededRows('Not enough brand voice clarity to draft content credibly.'),
      footerLeft: hasDraftPostData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },
    {
      id: 'platform-coverage',
      category: 'content',
      number: 'PC',
      label: 'PLATFORMS',
      title: 'Platform Coverage',
      description: 'Where your brand is active and where visibility is missing.',
      placeholderLabel: 'PLATFORMS',
      rows: buildWorkNeededRows('Platform analysis requires social link data from crawled pages.'),
      footerLeft: WORK_NEEDED_LABEL,
      footerRight: 'REVIEWED',
    },

    // ── GROWTH SIGNALS ────────────────────────────────────────────────────────
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

    // ── AUTOMATION & SYSTEMS ──────────────────────────────────────────────────
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
      const derivedData = { siteMeta, brandOverview, sgDisplayData, seoAudit, aiSeoAudit, aiVisibility, homePage: evidencePages[0] || null, pages: evidencePages, client };
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
              ? card.rows.filter((row) => row?.isAuditRow && !row?.isColumnHeader && !row?.isUpgrade)
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
              score:       aiVisibility?.score       ?? null,
              letterGrade: aiVisibility?.letterGrade ?? null,
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
              aiVisibilityScore: aiVisibility?.score ?? null,
              aiVisibilityGrade: aiVisibility?.letterGrade ?? null,
              aiSectionSchemaScore: aiVisibility?.sections?.schema?.score ?? null,
              aiSectionEntityScore: aiVisibility?.sections?.entity?.score ?? null,
              aiBotsBlocked: Array.isArray(aiSeoAudit?.rawSignals?.robotsAi?.blockedBots)
                ? aiSeoAudit.rawSignals.robotsAi.blockedBots.map((bot) => bot?.name || bot?.id).filter(Boolean)
                : [],
              wikidataEntity: aiSeoAudit?.rawSignals?.entity?.qid || aiSeoAudit?.rawSignals?.entity?.wikidataUrl || null,
              metaDescriptionPresent: typeof aiSeoAudit?.rawSignals?.technical?.metaDescription === 'string'
                ? aiSeoAudit.rawSignals.technical.metaDescription.trim().length > 0
                : null,
              canonicalPresent: typeof aiSeoAudit?.rawSignals?.technical?.canonical === 'string'
                ? aiSeoAudit.rawSignals.technical.canonical.trim().length > 0
                : null,
              schemaTypesCount: Array.isArray(aiSeoAudit?.rawSignals?.schema?.types)
                ? aiSeoAudit.rawSignals.schema.types.length
                : null,
              llmsTxtFound: typeof aiSeoAudit?.rawSignals?.llmsTxt?.found === 'boolean'
                ? aiSeoAudit.rawSignals.llmsTxt.found
                : null,
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
    }

    const isSeoHostingContext = card.id === 'seo-performance' && built?.dominantSignal?.type === 'hosting-context';

    const readinessContext = (() => {
      if (card.id === 'seo-performance') return '';
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
      if ((card.id === 'audit-summary' || card.id === 'social-preview' || card.id === 'multi-device-view' || card.id === 'style-guide' || card.id === 'industry' || card.id === 'priority-signal') && built?.description) {
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
      if (card.id === 'style-guide' && built?.dominantSignal?.readiness) {
        return {
          tone: built.dominantSignal.readiness,
          label: built.dominantSignal.readiness === 'critical'
            ? 'System thin'
            : built.dominantSignal.readiness === 'partial'
              ? 'System partial'
              : 'System ready',
        };
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
      description:             baseDescription + readinessContext,
      scribeShort:             DETERMINISTIC_CARD_IDS.has(card.id) ? null : (scribe?.short || null),
      dynamicShortDescription,
      recommendation:          scribe?.recommendation || null,
      readinessBadge,
      analyzer,
    };
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div data-dashboard-theme={theme} style={shellStyle}>
      <style>{dashboardCss}</style>
      <header id="founders-top-strip">
        <div id="founders-top-strip-inner">
          <Link href="/" id="founders-brand" aria-label="Back to homepage">
            <img src="/img/sig.png" alt="" aria-hidden="true" />
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
          <section
            id="dashboard-recovery-shell"
            style={{
              width: '100%',
              maxWidth: '56rem',
              margin: '2rem auto 0',
              padding: '1.5rem',
              borderRadius: '20px',
              ...internalPageGlassCardStyle,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <p style={{ margin: 0, fontSize: '0.8rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.48)', fontFamily: '"Space Mono", monospace' }}>
                  Client access
                </p>
                <h1 style={{ margin: '0.5rem 0 0', fontSize: 'clamp(1.8rem, 4vw, 3rem)', lineHeight: 1.05, letterSpacing: '-0.04em' }}>
                  This login is not linked to a dashboard yet.
                </h1>
              </div>
              <p style={{ margin: 0, color: 'rgba(42,36,32,0.72)', lineHeight: 1.7, maxWidth: '46rem' }}>
                You signed in successfully, but this account does not currently have a client workspace attached to it. If you expected an existing dashboard, sign out and use the correct account. If you want to start a new workspace, enter a website below and create it intentionally.
              </p>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <label htmlFor="dashboard-recovery-url" style={{ fontSize: '0.82rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.5)', fontFamily: '"Space Mono", monospace' }}>
                  Website URL
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <input
                    id="dashboard-recovery-url"
                    type="url"
                    value={reseedUrl}
                    onChange={(e) => { setReseedUrl(e.target.value); setReseedError(''); setReseedSuccess(false); }}
                    placeholder="yourbusiness.com"
                    spellCheck={false}
                    style={{
                      flex: '1 1 22rem',
                      minWidth: '18rem',
                      borderRadius: '999px',
                      border: '1px solid rgba(42,36,32,0.14)',
                      background: 'rgba(255,255,255,0.72)',
                      padding: '0.95rem 1.1rem',
                      fontSize: '1rem',
                      color: '#2a2420',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleReseed}
                    disabled={reseedLoading || !reseedUrl.trim()}
                    style={{
                      borderRadius: '999px',
                      border: 'none',
                      background: '#2a2420',
                      color: '#fff',
                      padding: '0.95rem 1.2rem',
                      fontWeight: 600,
                      cursor: reseedLoading || !reseedUrl.trim() ? 'not-allowed' : 'pointer',
                      opacity: reseedLoading || !reseedUrl.trim() ? 0.55 : 1,
                    }}
                  >
                    {reseedLoading ? 'Creating…' : 'Create dashboard'}
                  </button>
                </div>
                {reseedError ? (
                  <div style={{ color: '#9f2d2d', fontSize: '0.94rem' }}>{reseedError}</div>
                ) : null}
                {reseedSuccess ? (
                  <div style={{ color: '#2d6a4f', fontSize: '0.94rem' }}>Dashboard creation has been queued. This page will refresh when bootstrap data is ready.</div>
                ) : null}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                <Link
                  href="/"
                  style={{
                    borderRadius: '999px',
                    border: '1px solid rgba(42,36,32,0.14)',
                    padding: '0.82rem 1.1rem',
                    textDecoration: 'none',
                    color: '#2a2420',
                    background: 'rgba(255,255,255,0.6)',
                  }}
                >
                  Back to homepage
                </Link>
                <button
                  type="button"
                  onClick={handleSignOut}
                  style={{
                    borderRadius: '999px',
                    border: '1px solid rgba(42,36,32,0.14)',
                    padding: '0.82rem 1.1rem',
                    color: '#2a2420',
                    background: 'rgba(255,255,255,0.6)',
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </section>
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
                {isRunActive ? (
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
          <div id="capability-grid" ref={capabilityGridRef}>
            {activeCapabilityFilter === 'brief' ? (
              <div id="brief-embed-container">
                {briefPdfUrl && (
                  <div id="brief-embed-header">
                    <button
                      type="button"
                      className="brief-embed-btn"
                      onClick={() => setBriefFullScreen(true)}
                    >Open ↗</button>
                    <a
                      className="brief-embed-btn"
                      href={briefPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download="brief.pdf"
                    >↓ Download PDF</a>
                  </div>
                )}
                {briefPreviewHtml ? (
                  <iframe
                    id="brief-embed-iframe"
                    title="Daily Brief"
                    srcDoc={briefPreviewHtml}
                    sandbox="allow-same-origin"
                  />
                ) : (
                  <div id="brief-embed-empty">
                    <div className="brief-loader">
                      <div className="brief-loader-spinner" />
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {(() => {
              // Ordered unlock chain for the onboarding section. Index 0 is
              // always unlocked; every card after it requires the previous
              // card in the chain to have passed. Cards not in the chain stay
              // locked until they're added here.
              const CARD_UNLOCK_CHAIN = ['multi-device-view', 'social-preview', 'seo-performance'];
              const INACTIVE_CARD_DESCRIPTIONS = {
                'multi-device-view':   'Run this to capture your site on desktop, tablet, and mobile, composite a single device-frame mockup, and collect full-page screenshots per device.',
                'social-preview':      'Run this to pull your site metadata, favicon, and share description, and generate a preview of exactly how your site appears when shared — plus a flag list for anything that is missing.',
                'style-guide':         'Run this to extract colors, typography, and logo usage from the live site and render a compact style guide for the brand layer of your dashboard.',
                'seo-performance':     'Run this to score your site in PageSpeed Insights and run a structured SEO scan — speed, metadata, and structural issues summarized in one view.',
                'business-model':      'Run this to synthesize what your business does, who it serves, and how it makes money — drawn from site evidence, not guesswork.',
                'industry':            'Run this to classify your industry and positioning so the dashboard can benchmark you against the right peers.',
                'visibility-snapshot': 'Run this to probe how your site surfaces in AI search — citations, answers, and competitor coverage — in a single readout.',
                'audit-summary':       'Run this to aggregate every baseline check into a single go / no-go foundation score for your dashboard.',
                'priority-signal':     'Run this to pick the single highest-leverage action for your site right now, with the evidence behind it.',
              };
              const LOCKED_CARD_DESCRIPTIONS = {
                'multi-device-view':   'Captures your site on desktop, tablet, and mobile, composites them into a single device-frame mockup, and provides full-page screenshots you can browse per device.',
                'social-preview':      'Reads your site metadata, favicon, and share description, and shows exactly how your site appears when shared on social platforms. Flags missing images, titles, and descriptions.',
                'audit-summary':       'Aggregates every baseline check — pages fetched, metadata coverage, analyzer warnings — into a single go / no-go readout for the foundation of your dashboard.',
                'business-model':      'Synthesizes what your business actually does, who it serves, and how it makes money — written from site evidence, not guesswork.',
                'seo-performance':     'Runs a PageSpeed Insights audit and a structured SEO scan, then summarizes speed, metadata, and structural issues that affect visibility and conversion.',
                'industry':            'Classifies your industry and positioning so the dashboard can benchmark you against the right peers and apply the right content playbook.',
                'visibility-snapshot': 'Probes how your site surfaces in AI search (LLM responses, citations, answers) and reports where you show up versus where competitors dominate.',
                'style-guide':         'Extracts your visual identity from the live site — colors, typography, logo usage — and renders a compact style guide for the brand layer of your dashboard.',
                'priority-signal':     'Picks the single highest-leverage action for your site right now, with the evidence behind it, so you know exactly what to work on next.',
              };
              const hasCardPassed = (cardId) => {
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
                return false;
              };
              const isCardLocked = (cardId) => {
                const idx = CARD_UNLOCK_CHAIN.indexOf(cardId);
                if (idx === -1) return true; // Not yet in the chain → locked.
                if (idx === 0) return false;
                // Unlocked iff every prior card in the chain has passed.
                for (let i = 0; i < idx; i += 1) {
                  if (!hasCardPassed(CARD_UNLOCK_CHAIN[i])) return true;
                }
                return false;
              };
              const chainSortKey = (cardId) => {
                const idx = CARD_UNLOCK_CHAIN.indexOf(cardId);
                return idx === -1 ? 999 + cardId.charCodeAt(0) : idx;
              };
              return activeCapabilityFilter && activeCapabilityFilter !== 'brief' && intakeCapabilityCards
                .filter((card) => {
                  if (activeCapabilityFilter === 'onboarding') {
                    if (!ONBOARDING_CARD_IDS.has(card.id)) return false;
                    return true;
                  }
                  return activeCapabilityFilter === card.category;
                })
                .sort((a, b) => {
                  if (activeCapabilityFilter !== 'onboarding') return 0;
                  return chainSortKey(a.id) - chainSortKey(b.id);
                })
                .map((card) => {
              const _mEnabled = moduleConfig ? (moduleConfig[card.id]?.enabled ?? false) : true;
              const _mStatus = moduleState?.[card.id]?.status ?? 'inactive';
              const hasBothButtons = Boolean(card.moduleControls) && !(!_mEnabled && _mStatus === 'inactive');
              const isInChain = CARD_UNLOCK_CHAIN.includes(card.id);
              // Chain cards have their own lock/unlock treatment, so they skip
              // the legacy modular-onboarding dimming entirely.
              const isDimmed = isModularOnboardingClient && card.id !== 'audit-summary' && card.id !== 'multi-device-view' && !isInChain;
              const isLocked = activeCapabilityFilter === 'onboarding' && isCardLocked(card.id);
              // Unlocked but not yet run (enabled/disabled without a succeeded status) —
              // we want no card-level hover effect, only direct button hover.
              const isInactiveUnlocked = !isLocked && Boolean(card.moduleControls)
                && !(_mStatus === 'succeeded' || _mStatus === 'running' || _mStatus === 'queued');
              return (
              <article
                data-capability-card
                data-flip-id={`cap-${card.id}`}
                className={`tile tile-intake-card${hasIntakeData ? ' tile-ready' : ''}${card.wide ? ' tile-intake-card--wide' : ''}${hasBothButtons && !isLocked ? ' tile-intake-card--btns-only' : ''}${isDimmed && !isLocked ? ' tile-intake-card--dimmed' : ''}${isLocked ? ' tile-intake-card--locked' : ''}${isInactiveUnlocked ? ' tile-intake-card--inactive' : ''}`}
                id={card.domId || `tile-${card.id}`}
                key={card.id}
                onClick={isLocked || isInactiveUnlocked ? undefined : (hasBothButtons ? undefined : () => {
                  if (card.id === 'brief' && briefPreviewHtml) { setBriefFullScreen(true); return; }
                  if (card.id === 'audit-summary') { setAuditFullScreen(true); return; }
                  setActiveTileModal({ title: card.title, description: card.description, rows: card.rows, cardId: card.id, placeholderLabel: card.placeholderLabel, number: card.number, label: card.label, isCapabilityCard: true, vizType: null, recommendation: card.recommendation || null, analyzer: card.analyzer || null, readinessBadge: card.readinessBadge || null });
                })}
              >
                <div className="tile-number">
                  <span className="tile-header-label">{card.label}</span>
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
                  style={card.id === 'multi-device-view' && sgDisplayData?.colors?.primary?.hex
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
                                  onError={(e) => { e.currentTarget.style.display = 'none'; const p = e.currentTarget.parentElement; if (p) { const s = document.createElement('span'); s.className = 'sg-no-logo'; s.textContent = 'NO\nLOGO'; p.appendChild(s); } }}
                                />
                              ) : (
                                <span className="sg-no-logo">{"NO\nLOGO"}</span>
                              )}
                            </div>

                            {/* COLOR (top-right) */}
                            <div className="sg-quad sg-q-color" style={!hasSgColors ? { background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' } : undefined}>
                              {hasSgColors ? [
                                sgDisplayData.colors.primary,
                                sgDisplayData.colors.secondary,
                                sgDisplayData.colors.tertiary,
                                sgDisplayData.colors.neutral,
                              ].filter(Boolean).map((color, ci) => (
                                <div key={ci} className="sg-swatch" style={{ background: color.hex }} title={color.role} />
                              )) : (
                                <span className="sg-no-data">{"NO\nCOLOR"}</span>
                              )}
                            </div>

                            {/* TYPE (bottom-left) */}
                            <div
                              className="sg-quad sg-q-type"
                              style={{ background: hasSgType ? (sgDisplayData?.colors?.neutral?.shades?.[0] || sgDisplayData?.colors?.primary?.shades?.[0] || sgDisplayData?.colors?.neutral?.hex || '#faf8f4') : 'transparent' }}
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
                                <span className="sg-no-data">{"NO\nTYPE"}</span>
                              )}
                            </div>

                            {/* GRADIENT (bottom-right) */}
                            <div
                              className="sg-quad sg-q-gradient"
                              style={hasSgColors ? {
                                background: `linear-gradient(135deg, ${sgDisplayData.colors.primary?.hex || '#888'}, ${sgDisplayData.colors.secondary?.hex || sgDisplayData.colors.neutral?.hex || '#ddd'})`,
                              } : { background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              {!hasSgColors && <span className="sg-no-data">{"NO\nGRADIENT"}</span>}
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
                    renderAuditViz(card.rows)
                  ) : card.id === 'seo-performance' && hasSeoAuditData ? (
                    renderSeoViz(seoAudit, aiVisibility)
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
                  ) : (
                    <span className="tile-empty-label">{card.placeholderLabel}</span>
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
                        STATUS: {card.readinessBadge.label}
                      </span>
                    )}
                    {' '}
                    {isLocked
                      ? (LOCKED_CARD_DESCRIPTIONS[card.id] || 'This card will unlock after the previous steps are complete.')
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
                      if (isLocked) return null;
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
                      if (card.id === 'multi-device-view' && mStatus === 'succeeded') {
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
                      // Any card that hasn't reached STATUS: Passed (readiness tone !== 'ok')
                      // stays re-runnable so the user can retry without waiting for a tier
                      // unlock. multi-device-view's artifact check already covered its case;
                      // this generalizes the same rule to every other card.
                      const cardNotPassed = Boolean(card.readinessBadge) && card.readinessBadge.tone !== 'ok';
                      const mIsRetry = mStatus === 'failed' || mdArtifactsMissing || (mStatus === 'succeeded' && cardNotPassed);
                      const mIsRerun = mStatus === 'succeeded' && !mdArtifactsMissing && !cardNotPassed;
                      // Inactive = no config-enabled yet AND never succeeded. RUN here enables + kicks off first run.
                      const mIsInactive = !mEnabled && !mIsRerun && !mBusy && !mdArtifactsMissing && !cardNotPassed;
                      const interactive =
                        !mBusy && (mIsInactive || (mEnabled && (mIsRetry || tierAllowsRerun)));
                      const label = mLoading ? '…' : mIsRetry ? 'Retry' : mIsRerun ? 'Re-run' : mIsInactive ? 'RUN' : 'Run';
                      return (
                        <button
                          type="button"
                          id={`tile-${card.id}-rerun-btn`}
                          className="tile-foot-rerun-btn"
                          disabled={!interactive || mLoading}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!interactive) return;
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
                            const shouldForce = mIsRerun || mdArtifactsMissing || cardNotPassed;
                            handleModuleRun(card.id, shouldForce, retryOptions);
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
                          setActiveTileModal({ title: card.title, description: card.description, rows: card.rows, cardId: card.id, placeholderLabel: card.placeholderLabel, number: card.number, label: card.label, isCapabilityCard: true, vizType: null, recommendation: card.recommendation || null, analyzer: card.analyzer || null, readinessBadge: card.readinessBadge || null });
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
          <div id="capability-nav-col" className={isModularOnboardingClient ? 'capability-nav-col--single-active' : undefined}>
            {[
              { key: 'brief',      label: 'Daily Brief',             sub: 'Your full report',         icon: ChartColumnIncreasing, color: '#2a2420' },
              { key: 'onboarding', label: 'Data Visualization',      sub: 'From your onboarding',     icon: Globe,                 color: '#f59e0b' },
              { key: 'brand',      label: 'Brand & Presence',        sub: 'Identity & trust',         icon: BriefcaseBusiness,     color: '#8b5cf6' },
              { key: 'website',    label: 'Website & Conversion',    sub: 'Speed & conversion',       icon: LaptopMinimalCheck,    color: '#0ea5e9' },
              { key: 'search',     label: 'Search & Discovery',      sub: 'SEO & content gaps',       icon: Search,                color: '#f97316' },
              { key: 'content',    label: 'Content & Social',        sub: 'Posts & platforms',        icon: Workflow,               color: '#14b8a6' },
              { key: 'growth',     label: 'Growth Signals',          sub: 'Trends & competitors',     icon: Settings2,             color: '#10b981' },
              { key: 'automation', label: 'Automation & Systems',    sub: 'Scale & automate',         icon: BrainIcon,             color: '#6366f1' },
              { key: 'services',   label: 'Work With Me',            sub: 'Get it done',              icon: MessageSquareMore,     color: '#ec4899' },
            ].map(({ key, label, sub, icon: NavIcon, color }) => {
              const isLocked = isModularOnboardingClient && key !== 'onboarding';
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

      {/* ── Intake build modal — unified card: shared top rows + 2-col body (terminal / survey) ── */}
      {showIntakeModal ? (
        <div id="intake-modal-overlay" role="dialog" aria-modal="true" aria-label="Dashboard build in progress">

          {/* Card: auth cardStyle. Survey is always rendered — 2-col layout
              always active so the terminal never sits alone. */}
          <div
            id="intake-modal-card"
            data-with-survey="true"
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
                Client Access
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
                    {'BUILDING YOUR DASHBOARD\u00A0\u00A0\u00B7\u00A0\u00A0PROCESSING WEBSITE\u00A0\u00A0\u00B7\u00A0\u00A0'}
                  </span>
                ))}
              </div>
            </div>

            {/* Copy — exact auth copyStyle */}
            <p id="intake-modal-copy" style={{ margin: 0, color: 'rgba(42,36,32,0.66)', lineHeight: 1.6, fontFamily: '"Space Grotesk", system-ui, sans-serif', textAlign: 'center' }}>
              {awaitingSignupProvision ? 'Linking Your Workspace' : 'Creating Your Dashboard'}
            </p>


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

              <div id="intake-modal-survey-col" data-resolved={surveyResolved ? 'true' : 'false'}>
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
                />
                {/* Retry prompt — shows inside the survey chat when pipeline
                    fails. No layout shift; scrolls into view naturally. */}
                {/* Retry prompt removed from here — passed into
                    OnboardingChatModal as a prop so it renders inside the
                    chat message thread, not as a separate block. */}
              </div>
            </div>

            {/* Footer */}
            <div id="intake-modal-footer">
              {client?.normalizedHost
                || (awaitingSignupProvision && pendingSignupProvision?.websiteUrl
                  ? (() => { try { return new URL(/^https?:\/\//i.test(pendingSignupProvision.websiteUrl) ? pendingSignupProvision.websiteUrl : `https://${pendingSignupProvision.websiteUrl}`).hostname.replace(/^www\./, ''); } catch { return pendingSignupProvision.websiteUrl; } })()
                  : null)
                || (currentRun?.sourceUrl ? (() => { try { return new URL(currentRun.sourceUrl).hostname.replace(/^www\./, ''); } catch { return currentRun.sourceUrl; } })() : null)
                || '\u00A0'}
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
            <button
              type="button"
              id="delete-account-modal-close"
              onClick={() => { if (!deleteAccountLoading) setShowDeleteAccountModal(false); }}
              aria-label="Close"
              disabled={deleteAccountLoading}
            >[ ✕ ]</button>
            <h2 id="delete-account-modal-title">Delete account</h2>
            <p id="delete-account-modal-body">
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
                id="delete-account-modal-cancel"
                onClick={() => setShowDeleteAccountModal(false)}
                disabled={deleteAccountLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                id="delete-account-modal-confirm"
                onClick={handleDeleteAccount}
                disabled={deleteAccountLoading || deleteConfirmInput.trim().toUpperCase() !== 'DELETE'}
              >
                {deleteAccountLoading ? 'Deleting…' : 'Delete account'}
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
                <h2 id="audit-fullscreen-title">Audit Summary</h2>
                <button type="button" id="audit-fullscreen-close" onClick={() => setAuditFullScreen(false)}>[ ✕ ]</button>
              </div>
              <div id="audit-fullscreen-rows">
                {auditRows.map((row) => (
                  row.isHeader ? (
                    <div key={row.key} className="tile-detail-row-section-head">{row.label}</div>
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
                      {sgDisplayData?.confidence === 'low' ? (
                        <div className="sg-empty">
                          <span className="sg-empty-label">NO CSS EXTRACTED</span>
                          <span className="sg-empty-msg">Site may be JS-rendered or stylesheet-free</span>
                        </div>
                      ) : (() => {
                        const sgHead = sgDisplayData.typography?.headingSystem;
                        const sgBody = sgDisplayData.typography?.bodySystem;
                        const headName = sanitizeStylePreviewLabel(
                          sgHead?.fontFamily?.split(',')[0].replace(/["']/g, '').trim() || 'Heading'
                        ) || 'Heading';
                        const LEVELS = ['none', 'minimal', 'moderate', 'heavy'];
                        const levelIdx = LEVELS.indexOf(sgDisplayData.motion?.level || 'minimal');
                        const primaryEasing = sgDisplayData.motion?.easings?.[0] || 'ease-in-out';
                        const animDur = sgDisplayData.motion?.durations?.[0] || '400ms';
                        const p = sgDisplayData.motion?.scrollPatterns || [];
                        const motionTech = p.some(s => /gsap/i.test(s)) ? 'GSAP' : p.some(s => /lenis/i.test(s)) ? 'Lenis' : p.length ? p[0].split(' ')[0] : 'CSS';
                        const curvePath = _sgEasingPath(primaryEasing, 80, 80);
                        const rtPath = _sgEasingPath(primaryEasing, 80, 80, true);
                        const easingSpline = _sgEasingSpline(primaryEasing);
                        const easingLabel = _sgGsapName(primaryEasing, motionTech === 'GSAP');
                        const gridType = sgDisplayData.layout?.grid || '12-column';
                        const cWidth = sgDisplayData.layout?.contentWidth || 'contained';
                        const framing = sgDisplayData.layout?.framing || 'open';
                        const bradius = sgDisplayData.layout?.borderRadius || '2px';
                        const maxWidth = sgDisplayData.layout?.maxWidth;
                        const COL_MAP = { '12-column': 3, 'auto-fit': 4, 'masonry': 3, 'minimal': 2, 'none': 1, 'custom': 2 };
                        const colCount = COL_MAP[gridType] ?? 3;
                        const isFullBleed = cWidth === 'full-bleed';
                        const isCard = framing === 'card-based' || framing === 'boxed';
                        const isMasonry = gridType === 'masonry';
                        const MASONRY_H = ['30px', '20px', '36px', '24px'];
                        const gridLabel = [gridType.replace('-column', ''), maxWidth && maxWidth !== 'none' ? maxWidth : null].filter(Boolean).join(' · ');
                        return (
                          <>
                            {isStyleGuideMock && <span className="sg-demo-watermark">DEMO</span>}
                            <div
                              className="sg-quad sg-q-type"
                              style={{ background: sgDisplayData?.colors?.neutral?.shades?.[0] || sgDisplayData?.colors?.primary?.shades?.[0] || sgDisplayData?.colors?.neutral?.hex || '#faf8f4' }}
                            >
                              <p className="sg-h1" style={{ fontFamily: sgHead?.fontFamily || 'serif' }}>{headName}</p>
                              <p className="sg-p" style={{ fontFamily: sgBody?.fontFamily || 'sans-serif' }}>The quick brown fox jumps over the lazy dog and the paragraph text continues here.</p>
                            </div>
                            <div className="sg-quad sg-q-color">
                              {[sgDisplayData.colors?.primary, sgDisplayData.colors?.secondary, sgDisplayData.colors?.tertiary, sgDisplayData.colors?.neutral].filter(Boolean).map((color, ci) => (
                                <div key={ci} className="sg-swatch" style={{ background: color.hex }} title={color.role} />
                              ))}
                            </div>
                            <div className="sg-quad sg-q-layout">
                              <>
                                <div id="sg-rg-demo-modal" className={`sg-rg${isFullBleed ? ' sg-rg--fullbleed' : ''}`}>
                                  <div className="sg-rg-nav" />
                                  <div className="sg-rg-cols" style={{ '--sg-col-min-w': colCount <= 1 ? '0px' : '30px' }}>
                                    {Array.from({ length: colCount }, (_, i) => (
                                      <div key={i} className={`sg-rg-col${isCard ? ' sg-rg-col--card' : ''}`} style={{ borderRadius: bradius, ...(isMasonry ? { height: MASONRY_H[i] ?? '28px', flex: 'none', width: `${Math.round(100 / colCount)}%` } : {}) }} />
                                    ))}
                                  </div>
                                </div>
                                <span className="sg-grid-label">{gridLabel}</span>
                              </>
                            </div>
                            <div className="sg-quad sg-q-motion">
                              <>
                                <svg className="sg-ease-svg" viewBox="-3 -3 86 86" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <line x1="0" y1="0" x2="0" y2="80" stroke="rgba(42,36,32,0.14)" strokeWidth="0.75"/>
                                  <line x1="0" y1="80" x2="80" y2="80" stroke="rgba(42,36,32,0.14)" strokeWidth="0.75"/>
                                  <line x1="0" y1="80" x2="80" y2="0" stroke="rgba(42,36,32,0.1)" strokeWidth="0.75" strokeDasharray="3 3"/>
                                  <path d={curvePath} stroke="rgba(42,36,32,0.82)" strokeWidth="2" strokeLinecap="round"/>
                                  <path id="sg-ease-rt-path-modal" d={rtPath} stroke="none" fill="none"/>
                                  <circle r="3.5" fill="rgba(42,36,32,0.8)">
                                    <animateMotion dur="3s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines={`${easingSpline};${easingSpline}`}>
                                      <mpath xlinkHref="#sg-ease-rt-path-modal"/>
                                    </animateMotion>
                                  </circle>
                                  <circle cx="0" cy="80" r="2.5" fill="rgba(42,36,32,0.3)"/>
                                  <circle cx="80" cy="0" r="2.5" fill="rgba(42,36,32,0.3)"/>
                                </svg>
                                <div className="sg-motion-meta">
                                  <span className="sg-motion-easing">{easingLabel}</span>
                                  <span className="sg-motion-sep">·</span>
                                  <span className="sg-motion-dur">{animDur}</span>
                                </div>
                              </>
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
                  ) : activeTileModal.cardId === 'seo-performance' && hasSeoAuditData ? (
                    renderSeoViz(seoAudit, aiVisibility)
                  ) : activeTileModal.cardId === 'business-model' && homepageScreenshotUrl ? (
                    <div id="bi-preview-shell">
                      <img
                        id="bi-hero-image"
                        src={homepageScreenshotUrl}
                        alt="Homepage screenshot"
                        onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
                      />
                    </div>
                  ) : activeTileModal.cardId === 'brief' && briefPreviewHtml ? (
                    <iframe
                      key={dashboardState?.latestRunId || 'brief-preview-modal'}
                      className="tile-brief-preview"
                      title="Brief preview"
                      srcDoc={briefPreviewHtml}
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
                        STATUS: {activeTileModal.readinessBadge.label}
                      </span>
                    )}
                    {activeTileModal.readinessBadge ? ' ' : ''}
                    {activeTileModal.description}
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

                {/* Tabbed SOLUTIONS / PROBLEMS / DATA for most cards */}
                {!['multi-device-view', 'brief', 'audit-summary'].includes(activeTileModal.cardId) && activeTileModal.analyzer ? (
                  <div
                    id={`${activeTileModal.cardId}-analyzer-findings`}
                    className="tile-detail-bento-cell tile-detail-tabbed-container"
                  >
                    <div className="tile-detail-tabs">
                      {[
                        { key: 'solutions', label: 'SOLUTIONS' },
                        { key: 'problems', label: 'PROBLEMS' },
                        { key: 'data', label: 'DATA' },
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
                      {modalTab === 'solutions' && (() => {
                        const solutionsList = buildSolutionsList(activeTileModal.analyzer);
                        if (!solutionsList.length) return <div className="tile-detail-tab-pane"><p className="tile-analyzer-solutions-empty">No matched solutions yet.</p></div>;
                        return (
                          <div className="tile-detail-tab-pane">
                            <ol id={`${activeTileModal.cardId}-solutions-list`} className="tile-solutions-list">
                              {solutionsList.map(({ key, source, severity, finding, solution, isGeneric }) => {
                                const problemClean = String(solution.problem || '').replace(/\.+$/, '').trim();
                                const expertTitle = String(solution.expertOffer?.title || '').trim();
                                const combinedHeadline = isGeneric ? (expertTitle || problemClean) : (problemClean && expertTitle ? `${problemClean} — ${expertTitle}` : (problemClean || expertTitle));
                                const sourceLabel = source === 'gap' ? `Gap: ${finding?.ruleId || ''}` : (finding?.label || '');
                                return (
                                  <li key={key} id={`${activeTileModal.cardId}-solution-${solution.id}`} className={`tile-solution-card severity-${severity || solution.severity || 'info'}${source === 'gap' ? ' source-gap' : ''}`}>
                                    <header className="tile-solution-header">
                                      <div className="tile-solution-header-top">
                                        {source === 'gap' ? <span className="tile-analyzer-gap-chip">gap</span> : <span className="tile-analyzer-severity-chip">{severity || solution.severity}</span>}
                                        {sourceLabel && <span className="tile-solution-source-label">{sourceLabel}</span>}
                                      </div>
                                      <h4 className="tile-solution-problem">{combinedHeadline}</h4>
                                    </header>
                                    {solution.expertOffer && (
                                      <section className="tile-solution-expert">
                                        {solution.expertOffer.summary && <p className="tile-solution-expert-summary">{solution.expertOffer.summary}</p>}
                                        {solution.expertOffer.cta?.href && <a href={solution.expertOffer.cta.href} target="_blank" rel="noopener noreferrer" className="tile-solution-expert-cta">{solution.expertOffer.cta.label || 'Book a call'} →</a>}
                                        {solution.diy && (
                                          <details className="tile-solution-diy-details">
                                            <summary className="tile-solution-diy-summary-toggle"><span className="tile-solution-diy-toggle-label">Prefer to do it yourself?</span></summary>
                                            <div className="tile-solution-diy">
                                              {solution.diy.summary && <p className="tile-solution-diy-summary">{solution.diy.summary}</p>}
                                              {Array.isArray(solution.diy.steps) && solution.diy.steps.length > 0 && <ol className="tile-solution-steps">{solution.diy.steps.map((step, idx) => <li key={idx} className="tile-solution-step">{step}</li>)}</ol>}
                                            </div>
                                          </details>
                                        )}
                                      </section>
                                    )}
                                  </li>
                                );
                              })}
                            </ol>
                          </div>
                        );
                      })()}

                      {modalTab === 'problems' && (
                        <div className="tile-detail-tab-pane">
                          {activeTileModal.analyzer.readiness && (
                            <div id={`${activeTileModal.cardId}-analyzer-readiness`} className={`tile-analyzer-readiness readiness-${activeTileModal.analyzer.readiness}`}>
                              <span className="tile-analyzer-readiness-label">{activeTileModal.analyzer.readiness === 'critical' ? 'Holding you back' : activeTileModal.analyzer.readiness === 'partial' ? 'Needs attention' : 'In a good spot'}</span>
                            </div>
                          )}
                          {Array.isArray(activeTileModal.analyzer.findings) && activeTileModal.analyzer.findings.length > 0 && (
                            <ul className="tile-analyzer-findings-list">
                              {activeTileModal.analyzer.findings.map((f) => {
                                const catalogEntry = resolveSolution(f);
                                const headline = catalogEntry?.problem || f.label;
                                return (
                                  <li key={f.id} className={`tile-analyzer-finding severity-${f.severity || 'info'}`}>
                                    <div className="tile-analyzer-finding-header"><span className="tile-analyzer-severity-chip">{f.severity}</span><span className="tile-analyzer-finding-label">{headline}</span></div>
                                    {catalogEntry?.whyItMatters && <p className="tile-solution-why">{catalogEntry.whyItMatters}</p>}
                                    {f.detail && <p className="tile-analyzer-finding-detail">{f.detail}</p>}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}

                      {modalTab === 'data' && (
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
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Data-only column for brief + audit-summary (no tabs) */}
                {['brief', 'audit-summary'].includes(activeTileModal.cardId) ? (
                  <div
                    id={`${activeTileModal.cardId}-detail-data`}
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


              </div>


            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
};

// ── Tile viz renderers ────────────────────────────────────────────────────────

const renderAuditViz = (auditRows) => {
  if (!auditRows || !auditRows.length) return null;
  const dataRows = auditRows.filter((r) => r.isAuditRow && !r.isColumnHeader);
  const captured = dataRows.filter((r) => r._captured).length;
  const missing = dataRows.filter((r) => !r._captured && !r.isUpgrade).length;
  const upgrade = dataRows.filter((r) => r.isUpgrade).length;
  const total = dataRows.length;
  const pct = total > 0 ? Math.round((captured / total) * 100) : 0;
  const circ = 2 * Math.PI * 27;

  // Per-section breakdown
  const sections = [];
  let currentSection = null;
  for (const r of auditRows) {
    if (r.isHeader) { currentSection = { label: r.label, captured: 0, total: 0 }; sections.push(currentSection); }
    else if (r.isAuditRow && !r.isColumnHeader && currentSection) {
      currentSection.total++;
      if (r._captured) currentSection.captured++;
    }
  }
  const topSections = sections.filter((s) => s.total > 0).sort((a, b) => b.captured - a.captured).slice(0, 4);

  return (
    <div id="audit-viz-shell">
      <svg className="seo-grad-defs" aria-hidden="true">
        <defs>
          <linearGradient id="ag" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#00cfff"/>
            <stop offset="48%"  stopColor="#7b5fff"/>
            <stop offset="100%" stopColor="#ff3de8"/>
          </linearGradient>
        </defs>
      </svg>

      {/* Rings in a row */}
      <div id="audit-viz-ring-row">
        {[
          { label: 'Total',    val: total,    p: 100 },
          { label: 'Captured', val: captured, p: total > 0 ? (captured / total) * 100 : 0 },
          { label: 'Upgrade',  val: upgrade,  p: total > 0 ? (upgrade / total) * 100 : 0 },
        ].map(({ label, val, p }) => (
          <div className="audit-ring-cell" key={label}>
            <svg className="seo-ring-svg" viewBox="0 0 58 58">
              <circle className="ring-bg" cx="29" cy="29" r="24" fill="none" strokeWidth="4" />
              <circle
                cx="29" cy="29" r="24" fill="none" strokeWidth="4"
                stroke="url(#ag)"
                strokeDasharray={circ}
                strokeDashoffset={circ - (circ * p / 100)}
                transform="rotate(-90 29 29)"
                strokeLinecap="round"
                className="stroke-lit"
              />
            </svg>
            <div className="audit-ring-val">{val}</div>
            <div className="audit-ring-label">{label}</div>
          </div>
        ))}
      </div>

      {/* Section bars — 2 columns */}
      <div id="audit-viz-bars">
        {topSections.map((s) => {
          const sPct = s.total > 0 ? Math.round((s.captured / s.total) * 100) : 0;
          const short = s.label.split(' ')[0].replace('·','').trim();
          return (
            <div className="audit-bar-item" key={s.label}>
              <span className="audit-bar-label">{short}</span>
              <div className="audit-bar-track">
                <div className="audit-bar-fill" style={{ width: `${sPct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Quality score bar — bottom */}
      <div id="audit-viz-quality">
        <div className="audit-quality-head">
          <span className="audit-quality-label">Data Quality</span>
          <span className="audit-quality-pct">{pct}%</span>
        </div>
        <div className="audit-quality-track">
          <div className="audit-quality-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
};

const renderSeoViz = (seoAudit, aiVisibility) => {
  const sc  = seoAudit?.scores ?? {};
  const cwv = seoAudit?.coreWebVitals ?? {};
  const lab = seoAudit?.labCoreWebVitals ?? {};
  const scoreRings = [
    ['Perform', sc.performance],
    ['SEO',     sc.seo],
    ['Access',  sc.accessibility],
    ['BP',      sc.bestPractices],
    aiVisibility?.score != null ? ['AI Vis', aiVisibility.score] : null,
  ].filter((entry) => entry != null && entry[1] != null);
  const lcpMs   = cwv.lcp?.p75  ?? lab.lcp?.p75;
  const inpMs   = cwv.inp?.p75;
  const clsVal  = cwv.cls?.p75  ?? lab.cls?.p75;
  const goodnessPct = (key, raw) => {
    if (raw == null) return 0;
    switch (key) {
      case 'lcp':  return Math.max(2, Math.min(100, (1 - raw / 8000) * 100));
      case 'inp':  return Math.max(2, Math.min(100, (1 - raw / 1000) * 100));
      case 'cls':  return Math.max(2, Math.min(100, (1 - raw / 0.5)  * 100));
      default:     return 0;
    }
  };
  const cwvItems = [
    lcpMs  != null && { key: 'lcp', label: 'LCP', display: `${(lcpMs / 1000).toFixed(1)}s`, cat: cwv.lcp?.category ?? lab.lcp?.category, pct: goodnessPct('lcp', lcpMs)  },
    inpMs  != null && { key: 'inp', label: 'INP', display: `${inpMs}ms`,                    cat: cwv.inp?.category,                       pct: goodnessPct('inp', inpMs)  },
    clsVal != null && { key: 'cls', label: 'CLS', display: Number(clsVal).toFixed(2),       cat: cwv.cls?.category ?? lab.cls?.category,  pct: goodnessPct('cls', clsVal) },
  ].filter(Boolean);
  const diagItems = (seoAudit?.diagnostics ?? []).slice(0, 2);
  const catLabel   = (c) => c === 'FAST' ? 'Fast' : c === 'AVERAGE' ? 'Average' : c === 'SLOW' ? 'Slow' : null;
  const circ = 2 * Math.PI * 27; // ≈ 169.646
  return (
    <div id="seo-perf-viz-shell">
      <svg className="seo-grad-defs" aria-hidden="true">
        <defs>
          <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#00cfff"/>
            <stop offset="48%"  stopColor="#7b5fff"/>
            <stop offset="100%" stopColor="#ff3de8"/>
          </linearGradient>
          <linearGradient id="rg-v" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%"   stopColor="#00cfff"/>
            <stop offset="100%" stopColor="#ff3de8"/>
          </linearGradient>
        </defs>
      </svg>

      {scoreRings.length > 0 && (
        <div className="seo-scores">
          {scoreRings.map(([label, score]) => {
            const offset = circ - (circ * score / 100);
            const isPerfect = score === 100;
            return (
              <div className="seo-score-tile" key={label}>
                <div className="seo-ring-wrap">
                  <svg viewBox="0 0 64 64">
                    <circle className="seo-ring-track" cx="32" cy="32" r="27" />
                    <circle
                      cx="32" cy="32" r="27" fill="none"
                      stroke={isPerfect ? 'url(#rg)' : 'url(#rg-v)'}
                      strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={circ}
                      strokeDashoffset={offset}
                    />
                  </svg>
                  <div className={`seo-ring-num ${isPerfect ? 'seo-ring-num--grad' : 'seo-ring-num--partial'}`}>{score}</div>
                </div>
                <div className="seo-score-lbl">{label}</div>
              </div>
            );
          })}
        </div>
      )}

      {scoreRings.length > 0 && cwvItems.length > 0 && <div className="seo-div" />}

      {cwvItems.length > 0 && (
        <div className="seo-vitals">
          {cwvItems.map(({ key, label, display, cat, pct }) => {
            const cLabel = catLabel(cat);
            const isGood = cat === 'FAST';
            const tone = isGood ? 'cyan' : 'pink';
            return (
              <div className="seo-vital-row" key={key}>
                <div className="seo-vital-meta">
                  <span className="seo-vital-key">{label}</span>
                  <div className="seo-vital-val">
                    <span className={`seo-vital-n seo-vital-n--${tone}`}>{display}</span>
                    {cLabel && <span className={`seo-vital-badge seo-vital-badge--${isGood ? 'fast' : 'avg'}`}>{cLabel}</span>}
                  </div>
                </div>
                <div className="seo-vital-bar">
                  <i className={tone} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cwvItems.length > 0 && diagItems.length > 0 && <div className="seo-div" />}

      {diagItems.length > 0 && (() => {
        const parseNum = (str) => {
          if (str == null) return null;
          const n = parseFloat(String(str).replace(/,/g, ''));
          return isNaN(n) ? null : n;
        };
        const diagNums = diagItems.map((d) => parseNum(d.value));
        const maxNum   = Math.max(...diagNums.filter((n) => n != null), 0.001);
        return (
          <div className="seo-diag-row">
            {diagItems.map((d, i) => {
              const num = diagNums[i];
              const barPct = num != null ? Math.max(4, (num / maxNum) * 100) : null;
              return (
                <div className="seo-diag-tile" key={d.id}>
                  <div className="seo-diag-num">{d.value}</div>
                  <div className="seo-diag-lbl">{d.label}</div>
                  {barPct != null && (
                    <div className="seo-diag-bar">
                      <i style={{ width: `${barPct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
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
  /* Single-active state: kill all pointer interaction so zero hover effects fire */
  #capability-nav-col.capability-nav-col--single-active {
    pointer-events: none;
  }
  /* Keep the one live nav always showing as active */
  #capability-nav-col.capability-nav-col--single-active:hover .capability-nav-btn--active {
    background: rgba(255, 255, 255, 1);
    box-shadow:
      0px 6px 14px rgba(0,0,0,0.06),
      0px 18px 36px rgba(0,0,0,0.06),
      0px 28px 56px rgba(0,0,0,0.09),
      inset 0 1px 0 rgba(255,255,255,0.55);
    transform: scale(1.02) translateY(-2px);
    opacity: 1;
  }
  #capability-nav-col.capability-nav-col--single-active:hover .capability-nav-btn--active::before {
    background: linear-gradient(180deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
    opacity: 1;
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
  #bi-preview-shell {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #bi-hero-image {
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
    font-size: 80px;
    font-size: clamp(40px, 16cqi, 80px);
    font-weight: 900;
    letter-spacing: 0.06em;
    line-height: 1.05;
    text-transform: uppercase;
    color: #2a2420;
    text-align: center;
    white-space: pre-line;
    padding: clamp(12px, 4%, 32px);
    max-width: 90%;
    word-break: break-word;
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
  #sg-preview-shell {
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
    font-size: 72px;
    font-size: clamp(28px, 24cqi, 72px);
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(42, 36, 32, 0.18);
    text-align: center;
    line-height: 1.05;
    white-space: pre-line;
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
    pointer-events: none;
    opacity: 0.5;
  }
  .tile.tile-intake-card--locked:hover { opacity: 0.5; }
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
      aspect-ratio: 1536 / 1024;
      align-self: auto;
      width: 100%;
      flex-shrink: 0;
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
  .tile-detail-tab-pane {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    .tile-intake-card { height: auto; min-height: unset; padding: 8px 10px; gap: 6px; }
    .tile-intake-placeholder { aspect-ratio: auto !important; flex: 1; min-height: 0; max-height: 160px; overflow: hidden; }
    .tile-intake-placeholder-audit-summary { max-height: none; flex: none; min-height: 180px; }
    .tile-intake-source-line { display: none; }
    .tile-intake-description { font-size: 10px; line-height: 1.3; -webkit-line-clamp: 2; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
  }
  @media (max-width: 620px) {
    #founders-shell { padding-top: 96px; }
    #founders-top-strip-inner {
      gap: 16px;
      padding: 0 16px;
    }
    #founders-top-actions { gap: 0.75rem; }
    #founders-linkedin { font-size: 0.92rem; }
    #founders-login-link { padding: 0.62rem 0.9rem; font-size: 0.8rem; }
    #founders-chat-cta { padding: 0.62rem 0.9rem; font-size: 0.8rem; gap: 0.35rem; }
    .founders-chat-label-full  { display: none; }
    .founders-chat-label-short { display: inline; }
    #capability-section { padding-top: 0; }
    .reseed-run-btn-label-desktop { display: none; }
    .reseed-run-btn-label-mobile { display: inline; }
    #reseed-run-btn-icon { display: none; }
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
    #intake-modal-overlay { padding: 1rem 0.5rem; align-items: flex-start; overflow-y: auto; }
    #intake-modal-card { width: 95vw; box-sizing: border-box; }
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
    overflow: hidden;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
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
  #delete-account-modal-overlay,
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
  #delete-account-modal {
    position: relative;
    background: #14100c;
    color: #e7d9c3;
    border: 1px solid rgba(239, 68, 68, 0.45);
    border-radius: 6px;
    padding: 1.5rem 1.5rem 1.25rem;
    max-width: 480px;
    width: 100%;
    font-family: var(--font-mono, monospace);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  }
  #delete-account-modal-close {
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
  #delete-account-modal-close:hover { color: #e7d9c3; }
  #delete-account-modal-title {
    margin: 0 0 0.75rem;
    font-size: 14px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #ef4444;
  }
  #delete-account-modal-body {
    margin: 0 0 1rem;
    font-size: 12px;
    line-height: 1.5;
    color: rgba(231, 217, 195, 0.8);
    font-family: system-ui, -apple-system, sans-serif;
  }
  #delete-account-confirm-label {
    display: block;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(231, 217, 195, 0.65);
    margin-bottom: 0.4rem;
  }
  #delete-account-confirm-label strong { color: #ef4444; }
  #delete-account-confirm-input {
    width: 100%;
    box-sizing: border-box;
    background: #0b0906;
    border: 1px solid rgba(231, 217, 195, 0.18);
    color: #e7d9c3;
    padding: 0.55rem 0.7rem;
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    letter-spacing: 0.08em;
    border-radius: 3px;
    outline: none;
  }
  #delete-account-confirm-input:focus { border-color: #ef4444; }
  #delete-account-modal-error {
    margin: 0.6rem 0 0;
    padding: 0.5rem 0.6rem;
    background: rgba(239, 68, 68, 0.1);
    border-left: 2px solid #ef4444;
    color: #f87171;
    font-size: 11px;
    line-height: 1.4;
  }
  #delete-account-modal-actions {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    margin-top: 1.1rem;
  }
  #delete-account-modal-cancel,
  #delete-account-modal-confirm {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0.55rem 0.9rem;
    border-radius: 3px;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  #delete-account-modal-cancel {
    background: transparent;
    border: 1px solid rgba(231, 217, 195, 0.2);
    color: rgba(231, 217, 195, 0.75);
  }
  #delete-account-modal-cancel:hover { color: #e7d9c3; border-color: rgba(231, 217, 195, 0.4); }
  #delete-account-modal-confirm {
    background: #ef4444;
    border: 1px solid #ef4444;
    color: #14100c;
    font-weight: 600;
  }
  #delete-account-modal-confirm:hover:not(:disabled) { background: #f87171; border-color: #f87171; }
  #delete-account-modal-confirm:disabled,
  #delete-account-modal-cancel:disabled { opacity: 0.4; cursor: not-allowed; }

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
