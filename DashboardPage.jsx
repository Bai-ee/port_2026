'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import Link from 'next/link';
import { Globe } from 'lucide-react';
import { useAuth } from './AuthContext';
import InternalPageBackground from './InternalPageBackground';
import { internalPageGlassCardStyle } from './pageSurfaceSystem';

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
    description: 'Posts drafted in real time, aligned to brand voice.',
    status: 'LIVE',
    metric: 'BRAND READY',
    viz: 'segbars',
  },
  {
    id: 'company-brain',
    number: '02',
    label: 'COMPANY BRAIN',
    title: 'Searchable, structured, stateful.',
    description: 'Your stack indexed and queryable.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'memory',
  },
  {
    id: 'knowledge-assistant',
    number: '03',
    label: 'KNOWLEDGE ASSISTANT',
    title: 'Answers from your data.',
    description: 'Team asks, system pulls from your docs.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'qa',
  },
  {
    id: 'executive-support',
    number: '04',
    label: 'EXECUTIVE SUPPORT',
    title: 'Walk in already briefed.',
    description: 'Every meeting prepared before you sit down.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'meetings',
  },
  {
    id: 'daily-operations',
    number: '05',
    label: 'DAILY OPERATIONS',
    title: 'Core tasks run themselves.',
    description: 'Triage, tracking, reports — no oversight.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'rings',
  },
  {
    id: 'email-marketing',
    number: '06',
    label: 'EMAIL MARKETING',
    title: 'Campaigns that learn.',
    description: 'Builds, schedules, optimizes across regions.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'spark',
  },
  {
    id: 'ai-research',
    number: '07',
    label: 'AI RESEARCH',
    title: 'Weeks of insight in hours.',
    description: 'Deep consumer and market analysis on demand.',
    status: 'LIVE',
    metric: 'BRAND READY',
    viz: 'countdown',
  },
  {
    id: 'financial-tax',
    number: '08',
    label: 'FINANCIAL & TAX',
    title: 'Books reconciled nightly.',
    description: 'Transactions sorted, flagged, report-ready.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'stats',
  },
  {
    id: 'compliance',
    number: '09',
    label: 'COMPLIANCE MONITORING',
    title: 'Nothing critical gets missed.',
    description: 'Deadlines, filings, rules — watched continuously.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'deadlines',
  },
  {
    id: 'distribution-insight',
    number: '10',
    label: 'DISTRIBUTION & INSIGHT',
    title: 'One loop for everything.',
    description: 'Publishing, SEO, rankings — unified.',
    status: 'LIVE',
    metric: 'BRAND READY',
    viz: 'table',
  },
  {
    id: 'rapid-product',
    number: '11',
    label: 'RAPID PRODUCT DEV',
    title: 'Concept to launch, fast.',
    description: 'Tools and integrations shipped on demand.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'pipeline',
  },
  {
    id: 'self-improving',
    number: '12',
    label: 'SELF-IMPROVING',
    title: 'Every run smarter.',
    description: 'Workflows refine themselves from feedback.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'delta',
  },
  {
    id: 'reddit-community',
    number: '13',
    label: 'REDDIT & COMMUNITY',
    title: 'Conversations to be in.',
    description: 'Finds threads, drafts replies for review.',
    status: 'LIVE',
    metric: 'BRAND READY',
    viz: 'threads',
  },
  {
    id: 'seo-content',
    number: '14',
    label: 'SEO CONTENT',
    title: 'Keywords to capture.',
    description: 'Opportunities surfaced, drafts ready.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'keywords',
  },
  // ── Reserved add-on cards (mirror commented add-ons in StackedSlidesSection.jsx) ──
  {
    id: 'multi-agent-pipeline',
    number: '15',
    label: 'MULTI-AGENT PIPELINE',
    title: 'Scout, Scribe, Guardian, Reporter.',
    description: 'Four-stage agent architecture running daily on raw market signals.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'segbars',
  },
  {
    id: 'hyperlocal-signals',
    number: '16',
    label: 'HYPERLOCAL SIGNALS',
    title: 'Live multi-source intelligence.',
    description: 'X, Instagram, Reddit, reviews, and weather — normalized and synthesized.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'spark',
  },
  {
    id: 'platform-content-gen',
    number: '17',
    label: 'PLATFORM CONTENT GEN',
    title: 'Platform-native drafts.',
    description: 'Instagram, X, Facebook, Discord — formatted and voiced per channel.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'threads',
  },
  {
    id: 'brand-safety-gate',
    number: '18',
    label: 'BRAND SAFETY GATE',
    title: 'Four-check quality gate.',
    description: 'Restricted terms, competitor mentions, factual accuracy, voice scoring.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'deadlines',
  },
  {
    id: 'founder-daily-brief',
    number: '19',
    label: 'FOUNDER DAILY BRIEF',
    title: 'One brief, every morning.',
    description: 'Priority action, signals, drafts, QA — delivered on schedule.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'meetings',
  },
  {
    id: 'admin-dashboard-history',
    number: '20',
    label: 'ADMIN & BRIEF HISTORY',
    title: 'Every run, on the record.',
    description: 'Real-time dashboard with full archive of past briefs and metrics.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'table',
  },
  {
    id: 'image-generation',
    number: '21',
    label: 'IMAGE GENERATION',
    title: 'Post images on autopilot.',
    description: 'Canvas-based generator with logo controls and live preview.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'rings',
  },
  {
    id: 'knowledge-file-config',
    number: '22',
    label: 'KNOWLEDGE FILE CONFIG',
    title: 'Four files, new vertical.',
    description: 'Swap JSON knowledge files to onboard a brand — no code changes.',
    status: 'PREVIEW',
    metric: 'PRO TIER',
    viz: 'memory',
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
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Could not load dashboard data.');
  return data;
}

async function checkMockupAvailability() {
  const response = await fetch('/output/final_mockup.png', {
    method: 'HEAD',
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return `/output/final_mockup.png?v=${Date.now()}`;
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
function buildSeoRerunTerminalLines(stage, websiteUrl) {
  const host = websiteUrl
    ? (() => { try { return new URL(websiteUrl).hostname.replace(/^www\./, ''); } catch { return websiteUrl; } })()
    : '...';

  const ok   = (tag, text) => ({ tag, text, type: 'ok' });
  const act  = (tag, text) => ({ tag, text, type: 'active', active: true });
  const dim  = (tag, text) => ({ tag, text, type: 'dim' });

  const base = [ok('SEO', `PageSpeed Insights audit · ${host}`)];

  if (stage === 'start') {
    return [act('SEO', `Triggering PageSpeed Insights audit for ${host}...`)];
  }
  if (stage === 'fetch') {
    return [...base, act('FETCH', 'Fetching mobile performance data from Google PSI...')];
  }
  if (stage === 'audit') {
    return [...base, ok('FETCH', 'Mobile data received'), act('AUDIT', 'Running Lighthouse analysis...')];
  }
  if (stage === 'narrator') {
    return [
      ...base,
      ok('FETCH', 'Mobile data received'),
      ok('AUDIT', 'Lighthouse analysis complete'),
      act('AI', 'Generating SEO performance summary for card...'),
    ];
  }
  if (stage === 'write') {
    return [
      ...base,
      ok('FETCH', 'Mobile data received'),
      ok('AUDIT', 'Lighthouse analysis complete'),
      ok('AI',    'SEO performance summary generated'),
      act('WRITE', 'Writing results to database...'),
    ];
  }
  return [dim('SEO', `Running SEO audit for ${host}...`)];
}

// ── Component ─────────────────────────────────────────────────────────────────

const DashboardPage = () => {
  const { user, userProfile, signOutUser } = useAuth();
  const [theme, setTheme] = useState('light');
  const [countdownHours, setCountdownHours] = useState(14);
  const [showTierModal, setShowTierModal] = useState(false);
  const [bootstrap, setBootstrap] = useState({ userProfile: null, client: null, dashboardState: null, recentRuns: [], intelligence: null });
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const cancelledRef = useRef(false);
  const prevRunStatusRef = useRef(null);
  const terminalOutputRef = useRef(null);
  const terminalLengthRef = useRef(0);
  const prevLogLengthRef = useRef(0);
  const prevStatusForRevealRef = useRef(null);
  const [completionCountdown, setCompletionCountdown] = useState(null);
  const [revealedLineCount, setRevealedLineCount] = useState(null);
  const modalMarqueeTrackRef = useRef(null);
  const modalMarqueeOffsetRef = useRef(0);
  const modalMarqueeAnimRef = useRef(null);
  const modalMarqueePrevTimeRef = useRef(null);
  const heroMarqueeShellRef = useRef(null);
  const heroMarqueeTrackRef = useRef(null);
  const heroMarqueeCopyRef = useRef(null);
  const [heroMarqueeCopies, setHeroMarqueeCopies] = useState(2);
  const [reseedUrl, setReseedUrl] = useState('');
  const [reseedLoading, setReseedLoading] = useState(false);
  const [reseedError, setReseedError] = useState('');
  const [reseedSuccess, setReseedSuccess] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [seoRerunLoading, setSeoRerunLoading] = useState(false);
  const [seoRerunStage,   setSeoRerunStage]   = useState(null);
  const [intakeMockupSrc, setIntakeMockupSrc] = useState(null);

  // Advance scripted terminal stages during SEO rerun
  useEffect(() => {
    if (!seoRerunLoading) { setSeoRerunStage(null); return; }
    setSeoRerunStage('start');
    const t1 = setTimeout(() => setSeoRerunStage('fetch'),    10_000);
    const t2 = setTimeout(() => setSeoRerunStage('audit'),    25_000);
    const t3 = setTimeout(() => setSeoRerunStage('narrator'), 38_000);
    const t4 = setTimeout(() => setSeoRerunStage('write'),    52_000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [seoRerunLoading]);

  // Clock tick
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdownHours((c) => (c <= 9 ? 14 : c - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!showTierModal) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowTierModal(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showTierModal]);

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

  // ── Derived state ─────────────────────────────────────────────────────────
  const client = bootstrap.client;
  const recentRuns = bootstrap.recentRuns || [];
  const displayProfile = bootstrap.userProfile || userProfile;
  const currentRun = recentRuns[0] || null;
  const dashboardState = bootstrap.dashboardState;
  const homepageDeviceMockup = dashboardState?.artifacts?.homepageDeviceMockup || null;
  const clientStatus = dashboardState?.status || client?.status || 'provisioning';
  // Prefer the live run status from brief_runs (polled every 4s) over the cached
  // dashboardState.latestRunStatus — the cached value is written as 'queued' at
  // provisioning and only flips to 'succeeded' at completion, so it never reports
  // 'running' and would lock the terminal on the queued branch mid-run.
  const latestRunStatus = currentRun?.status || dashboardState?.latestRunStatus || null;
  const provisioningState = dashboardState?.provisioningState || null;
  const errorState = dashboardState?.errorState || null;

  // Free-tier intake fields
  const snapshot = dashboardState?.snapshot || null;
  const signals = dashboardState?.signals || null;
  const strategy = dashboardState?.strategy || null;
  const brandOverview = snapshot?.brandOverview || null;
  const brandTone = snapshot?.brandTone || null;
  const siteMeta = dashboardState?.siteMeta || null;
  const visualIdentity  = snapshot?.visualIdentity || null;
  const styleGuideData  = visualIdentity?.styleGuide ?? null;
  const sgDisplayData   = styleGuideData ?? SG_MOCK;
  const isStyleGuideMock = styleGuideData === null;
  const outputsPreview  = dashboardState?.outputsPreview || null;
  // Intelligence-first SEO data: prefer intelligence source, fall back to dashboardState.seoAudit
  const intelligencePayload = bootstrap.intelligence || null;
  const seoAudit = intelligencePayload?.dashboardSeoAudit ?? dashboardState?.seoAudit ?? null;
  const isFromIntelligence  = Boolean(intelligencePayload?.dashboardSeoAudit != null);
  const intelligenceSummary = intelligencePayload?.psiSummary || null;
  const psiNarrative        = intelligencePayload?.psiNarrative || null;
  const capabilityHeadline = client?.dashboardTitle || displayProfile?.dashboardTitle || 'An operating stack that runs itself.';

  // Legacy compat fields (pre-intake runs)
  const headline = dashboardState?.headline || null;
  const summaryCards = dashboardState?.summaryCards || [];
  const latestInsights = dashboardState?.latestInsights || [];

  const hasIntakeData = Boolean(brandOverview?.headline);
  const isRunActive = latestRunStatus === 'queued' || latestRunStatus === 'running';

  // Show terminal modal during active builds, failures, and the post-completion countdown.
  const showIntakeModal = !bootstrapLoading && (isRunActive || latestRunStatus === 'failed' || completionCountdown !== null);

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

  // Inject Google Fonts for the style-guide type specimen
  useEffect(() => {
    const families = (sgDisplayData?.typography?.fontFamilies || [])
      .filter((f) => f.source === 'google-fonts')
      .map((f) => f.family);
    if (!families.length) return;
    const id = 'sg-google-fonts-link';
    if (document.getElementById(id)) return;
    const query = families
      .map((fam) => `family=${encodeURIComponent(fam)}:wght@400;600;700`)
      .join('&');
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
    document.head.appendChild(link);
  }, [sgDisplayData]);

  // GSAP: style-guide layout quadrant — desktop → mobile viewport animation
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
    let cancelled = false;

    const refreshMockup = async () => {
      if (homepageDeviceMockup?.downloadUrl) {
        if (!cancelled) {
          setIntakeMockupSrc(homepageDeviceMockup.downloadUrl);
        }
        return;
      }

      try {
        const src = await checkMockupAvailability();
        if (!cancelled) {
          setIntakeMockupSrc(src);
        }
      } catch {
        if (!cancelled) {
          setIntakeMockupSrc(null);
        }
      }
    };

    refreshMockup();
    const interval = setInterval(refreshMockup, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [homepageDeviceMockup?.downloadUrl]);

  // Seed reseedUrl from client websiteUrl once loaded
  useEffect(() => {
    if (client?.websiteUrl && !reseedUrl) {
      setReseedUrl(client.websiteUrl);
    }
  }, [client?.websiteUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect run completion → start 3-second countdown before revealing dashboard
  useEffect(() => {
    if (latestRunStatus === prevRunStatusRef.current) return;
    if (latestRunStatus === 'succeeded' && (prevRunStatusRef.current === 'running' || prevRunStatusRef.current === 'queued')) {
      setCompletionCountdown(3);
    }
    prevRunStatusRef.current = latestRunStatus;
  }, [latestRunStatus]);

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
      setReseedSuccess(false);
      doBootstrap();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Cancel failed.');
    } finally {
      setCancelLoading(false);
    }
  }, [user, cancelLoading, doBootstrap]);

  const handleSeoRerun = useCallback(async () => {
    if (!user || seoRerunLoading) return;
    setSeoRerunLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/intelligence/rerun', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: 'pagespeed-insights' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Re-run failed.');
      // Rerun route is now synchronous — by the time we get here, PSI + narrator
      // have completed and the Firestore record has facts.narrative. One bootstrap
      // refresh is all that's needed to show the full dashboard.
      doBootstrap();
    } catch {
      // non-fatal — user can retry
    } finally {
      setSeoRerunLoading(false);
    }
  }, [user, seoRerunLoading, doBootstrap]);

  const terminalLines = useMemo(
    () => buildTerminalLines(currentRun, dashboardState, latestRunStatus, client),
    [currentRun, dashboardState, latestRunStatus, client]
  );

  // While SEO rerun is in progress, override terminal with live stage messages
  const activeTerminalLines = (seoRerunLoading && seoRerunStage)
    ? buildSeoRerunTerminalLines(seoRerunStage, seoAudit?.websiteUrl)
    : terminalLines;

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
  const displayedTerminalLines = revealedLineCount !== null
    ? terminalLog.slice(0, revealedLineCount)
    : terminalLog;

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
      return [
        { key: 'status', label: 'Status', value: 'Audit failed — retry available' },
        { key: 'target', label: 'Target', value: seoAudit?.websiteUrl || client?.websiteUrl || '—' },
        { key: 'error', label: 'Error', value: errMsg.length > 140 ? `${errMsg.slice(0, 137)}…` : errMsg },
        { key: 'strategy', label: 'Strategy', value: 'Mobile · PageSpeed Insights' },
      ];
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
    }

    // ── PARTIAL NOTICE ──
    if (seoCardState === 'partial') {
      const rtCode = seoAudit.runtimeError?.code || 'UNKNOWN';
      const rtMsg  = seoAudit.runtimeError?.message || 'Lighthouse could not fully load the page.';
      rows.push({ key: 'hdr-partial', label: '── PARTIAL AUDIT ──', isHeader: true, id: 'seo-audit-partial' });
      rows.push({ key: 'partial-notice', label: 'Notice', value: 'Diagnostic data unavailable — scores and CWV may be incomplete', isFailing: true });
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
    rows.push({ key: 'meta-warn', label: 'Warnings', value: meta?.warnings?.length ? meta.warnings.join(' · ') : '—' });

    return rows;
  })();

  const seoAuditDescription = (() => {
    if (seoCardState === 'queued')  return 'PageSpeed Insights audit is queued — mobile scores and Core Web Vitals will appear here.';
    if (seoCardState === 'error')   return 'PageSpeed audit could not complete. Press Re-run to retry — details below.';
    if (seoCardState === 'no-url')  return buildUnavailableDescription('PageSpeed performance data');
    if (seoCardState === 'partial') return 'Partial audit — Lighthouse could not fully load the page. Scores may be incomplete. Re-run to retry.';
    const { scores, opportunities, meta } = seoAudit;
    const parts = [];
    if (scores?.performance  != null) parts.push(`PERF ${scores.performance}`);
    if (scores?.seo          != null) parts.push(`SEO ${scores.seo}`);
    if (scores?.accessibility != null) parts.push(`A11Y ${scores.accessibility}`);
    if (scores?.bestPractices != null) parts.push(`BP ${scores.bestPractices}`);
    const fixCount = opportunities?.length ?? 0;
    if (fixCount) parts.push(`${fixCount} fix${fixCount === 1 ? '' : 'es'}`);
    if (meta?.totalDurationMs != null) parts.push(`${(meta.totalDurationMs / 1000).toFixed(0)}s`);
    return parts.join(' · ');
  })();
  const intakeCapabilityCards = [
    {
      id: 'intake-terminal',
      number: '08',
      label: 'INTAKE TERMINAL',
      title: 'Intake Terminal',
      description: activeTerminalLines[0]?.text || 'No recent intake runs.',
      placeholderLabel: seoRerunLoading ? 'SEO AUDIT' : intakeTerminalStatus.toUpperCase(),
      rows: activeTerminalLines.slice(0, 6).map((line, index) => ({
        key: `terminal-${index}`,
        label: line.tag || `STEP ${index + 1}`,
        value: line.text,
      })),
      footerLeft: intakeTerminalStatus.toUpperCase(),
      footerRight: latestRunStatus === 'succeeded' ? 'Latest Run' : 'Run Status',
    },
    (() => {
      const hasSiteMeta = siteMeta && typeof siteMeta === 'object' && Object.values(siteMeta).some((v) => v);
      const NOT_PROVIDED = 'Not provided';
      const siteMetaRows = hasSiteMeta
        ? [
            { key: 'og-title',       label: 'Title',        value: siteMeta.title        || NOT_PROVIDED },
            { key: 'og-description', label: 'OG Text',      value: siteMeta.description  || NOT_PROVIDED },
            { key: 'og-site-name',   label: 'Site Name',    value: siteMeta.siteName     || NOT_PROVIDED },
            { key: 'og-image-alt',   label: 'Image Alt',    value: siteMeta.ogImageAlt   || NOT_PROVIDED },
            { key: 'og-type',        label: 'OG Type',      value: siteMeta.type         || NOT_PROVIDED },
            { key: 'og-locale',      label: 'Locale',       value: siteMeta.locale       || NOT_PROVIDED },
            { key: 'og-theme',       label: 'Theme Color',  value: siteMeta.themeColor   || NOT_PROVIDED },
            { key: 'og-favicon',     label: 'Favicon',      value: siteMeta.favicon         ? 'Present' : NOT_PROVIDED },
            { key: 'og-apple-icon',  label: 'Apple Icon',   value: siteMeta.appleTouchIcon  ? 'Present' : NOT_PROVIDED },
            { key: 'og-canonical',   label: 'Canonical',    value: siteMeta.canonical    || NOT_PROVIDED },
          ]
        : null;

      return {
        id: 'brand-tone',
        number: 'BT',
        label: hasSiteMeta ? 'SITE META' : 'BRAND TONE',
        title: hasSiteMeta ? 'Site Meta' : 'Brand Tone',
        description: hasSiteMeta
          ? (siteMeta.description || siteMeta.title || 'Open Graph, Twitter Card, and favicon metadata pulled from the homepage.')
          : (hasBrandToneData
              ? brandTone?.writingStyle || 'Voice system, tone markers, and writing rules pulled from intake.'
              : buildUnavailableDescription('brand tone')),
        placeholderLabel: hasSiteMeta ? 'NO OG IMAGE PROVIDED' : 'VOICE PREVIEW',
        rows: hasSiteMeta
          ? siteMetaRows
          : hasBrandToneData
            ? [
                { key: 'primary', label: 'Primary', value: brandTone?.primary || 'Pending' },
                { key: 'secondary', label: 'Secondary', value: brandTone?.secondary || 'Pending' },
                { key: 'tags', label: 'Tags', value: brandTone?.tags?.slice(0, 3).join(' · ') || 'Pending' },
              ]
            : buildWorkNeededRows('Not enough long-form copy or repeated messaging was fetched to infer voice confidently.'),
        footerLeft: hasSiteMeta ? 'Live' : (hasBrandToneData ? 'Live' : WORK_NEEDED_LABEL),
        footerRight: hasSiteMeta ? 'OG Meta' : (hasBrandToneData ? 'Intake Data' : 'Contact Human'),
      };
    })(),
    {
      id: 'style-guide',
      number: 'SG',
      label: 'STYLE GUIDE',
      title: 'Style Guide',
      description: sgDisplayData.summary || (hasStyleGuideData
        ? 'Visual direction, palette cues, and style notes pulled from intake.'
        : buildUnavailableDescription('visual style guide')),
      placeholderLabel: 'STYLE SNAPSHOT',
      rows: [
        {
          key: 'sg-heading',
          label: 'Heading',
          value: [
            sgDisplayData.typography?.headingSystem?.fontFamily,
            sgDisplayData.typography?.headingSystem?.fontWeight,
            sgDisplayData.typography?.headingSystem?.fontSize,
          ].filter(Boolean).join(' · ') || 'Pending',
        },
        {
          key: 'sg-body',
          label: 'Body',
          value: [
            sgDisplayData.typography?.bodySystem?.fontFamily,
            sgDisplayData.typography?.bodySystem?.fontSize,
          ].filter(Boolean).join(' · ') || 'Pending',
        },
        {
          key: 'sg-primary',
          label: 'Primary',
          value: sgDisplayData.colors?.primary
            ? `${sgDisplayData.colors.primary.hex} · ${sgDisplayData.colors.primary.role}`
            : 'Pending',
        },
        {
          key: 'sg-secondary',
          label: 'Secondary',
          value: sgDisplayData.colors?.secondary?.hex || 'Pending',
        },
        {
          key: 'sg-neutral',
          label: 'Neutral',
          value: sgDisplayData.colors?.neutral?.hex || 'Pending',
        },
        {
          key: 'sg-layout',
          label: 'Layout',
          value: [
            sgDisplayData.layout?.grid,
            sgDisplayData.layout?.maxWidth,
            sgDisplayData.layout?.borderRadius && `r${sgDisplayData.layout.borderRadius}`,
          ].filter(Boolean).join(' · ') || 'Pending',
        },
        {
          key: 'sg-motion',
          label: 'Motion',
          value: [
            sgDisplayData.motion?.level,
            sgDisplayData.motion?.scrollPatterns?.[0],
            sgDisplayData.motion?.durations?.join('–'),
          ].filter(Boolean).join(' · ') || 'Pending',
        },
      ],
      footerLeft: hasStyleGuideData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: hasStyleGuideData ? 'Guide Ready' : 'Contact Human',
    },
    {
      id: 'seo-performance',
      number: 'SP',
      label: 'SEO + PERF',
      title: 'SEO + Performance',
      description: psiNarrative || seoAuditDescription,
      placeholderLabel: 'SITE AUDIT',
      rows: seoAuditRows,
      footerLeft: isSeoPartial ? 'Partial' : hasSeoAuditData ? 'Live' : isSeoQueued ? 'Queued' : isSeoError ? 'Error' : WORK_NEEDED_LABEL,
      domId: 'intake-card-seo-performance',
      footerRight: 'PSI · Mobile',
      footerAction: (hasSeoAuditData || isSeoError) && hasWebsiteUrl
        ? { label: isSeoError ? 'Retry' : 'Re-run', onClick: handleSeoRerun, loading: seoRerunLoading }
        : null,
    },
    {
      id: 'industry',
      number: 'IN',
      label: 'INDUSTRY',
      title: 'Industry',
      description: hasIndustryData
        ? resolvedIndustry
        : buildUnavailableDescription('industry'),
      placeholderLabel: 'MARKET CATEGORY',
      rows: hasIndustryData
        ? [
            { key: 'sector', label: 'Sector', value: resolvedIndustry },
          ]
        : buildWorkNeededRows('Fetched pages did not clearly identify the market category or service vertical.'),
      footerLeft: hasIndustryData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: hasIndustryData ? 'Positioning Context' : 'Contact Human',
    },
    {
      id: 'business-model',
      number: 'BM',
      label: 'MODEL',
      title: 'Business Model',
      description: hasBusinessModelData
        ? resolvedBusinessModel
        : buildUnavailableDescription('business model'),
      placeholderLabel: 'REVENUE MODEL',
      rows: hasBusinessModelData
        ? [
            { key: 'model', label: 'Structure', value: resolvedBusinessModel },
          ]
        : buildWorkNeededRows('No pricing, packaging, or service structure was clear in fetched pages.'),
      footerLeft: hasBusinessModelData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: hasBusinessModelData ? 'Commercial Setup' : 'Contact Human',
    },
    {
      id: 'priority-signal',
      number: 'PS',
      label: 'PRIORITY SIGNAL',
      title: 'Priority Signal',
      description: hasPrioritySignalData
        ? resolvedPrioritySignal
        : buildUnavailableDescription('priority signal'),
      placeholderLabel: 'SIGNAL BRIEF',
      rows: hasPrioritySignalData
        ? [
            { key: 'focus', label: 'Focus', value: resolvedPrioritySignal },
            { key: 'channel', label: 'Channel', value: strategy?.postStrategy?.formats?.join(' · ') || 'Derived from intake strategy' },
          ]
        : buildWorkNeededRows('The crawl did not surface enough validated positioning or urgency signals.'),
      footerLeft: hasPrioritySignalData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: hasPrioritySignalData ? 'Campaign Direction' : 'Contact Human',
    },
    {
      id: 'draft-post',
      number: 'DP',
      label: 'DRAFT POST',
      title: 'Draft Post',
      description: hasDraftPostData
        ? resolvedDraftPost
        : buildUnavailableDescription('draft post'),
      placeholderLabel: 'POST DRAFT',
      rows: hasDraftPostData
        ? [
            { key: 'post', label: 'Draft', value: resolvedDraftPost },
          ]
        : buildWorkNeededRows('There is not enough trustworthy brand voice and offer clarity to draft credibly.'),
      footerLeft: hasDraftPostData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: hasDraftPostData ? 'Ready To Edit' : 'Contact Human',
    },
    {
      id: 'content-angle',
      number: 'CA',
      label: 'CONTENT ANGLE',
      title: 'Content Angle',
      description: hasContentAngleData
        ? resolvedContentAngle
        : buildUnavailableDescription('content angle'),
      placeholderLabel: 'ANGLE LOCKED',
      rows: hasContentAngleData
        ? [
            { key: 'angle', label: 'Angle', value: resolvedContentAngle },
            { key: 'format', label: 'Format', value: strategy?.contentAngles?.[0]?.format || 'Pending' },
          ]
        : buildWorkNeededRows('Audience/problem framing is too thin to establish a reliable angle.'),
      footerLeft: hasContentAngleData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: hasContentAngleData ? 'Publishing Cue' : 'Contact Human',
    },
    {
      id: 'content-opportunities',
      number: 'CO',
      label: 'CONTENT OPPORTUNITIES',
      title: 'Content Opportunities',
      description: hasOpportunitiesData
        ? 'High-priority growth opportunities surfaced from intake and strategy normalization.'
        : buildUnavailableDescription('content opportunities'),
      placeholderLabel: 'OPPORTUNITY MAP',
      rows: hasOpportunitiesData
        ? resolvedOpportunities.map((op, index) => ({
            key: `op-${index}`,
            label: `[${String(op.priority || 'medium').slice(0, 4).toUpperCase()}]`,
            value: `${op.topic || op.opportunity}${op.whyNow || op.why ? ` — ${op.whyNow || op.why}` : ''}`,
          }))
        : buildWorkNeededRows('The current intake did not surface enough concrete evidence to suggest high-confidence opportunities.'),
      footerLeft: hasOpportunitiesData ? 'Live' : WORK_NEEDED_LABEL,
      footerRight: hasOpportunitiesData ? `${resolvedOpportunities.length} Active` : 'Contact Human',
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div data-dashboard-theme={theme} style={shellStyle}>
      <InternalPageBackground />
      <style>{dashboardCss}</style>
      <header id="founders-top-strip">
        <div id="founders-top-strip-inner">
          <Link href="/" id="founders-brand" aria-label="Back to homepage">
            <img src="/img/sig.png" alt="" aria-hidden="true" />
          </Link>
          <div id="founders-top-actions">
            <Link href="/" id="founders-linkedin">
              Homepage
            </Link>
            <button type="button" id="founders-login-link" onClick={signOutUser}>
              Logout
            </button>
            <a
              id="founders-chat-cta"
              href="https://calendly.com/bballi/30min"
              target="_blank"
              rel="noopener noreferrer"
            >
              Chat with Bryan
              <span id="founders-chat-cta-icon">↗</span>
            </a>
          </div>
          <div id="founders-hidden-controls" aria-hidden="true">
            <div id="theme-toggle" role="group" aria-label="Theme">
              <button type="button" data-theme="dark" className={theme === 'dark' ? 'is-active' : ''} onClick={() => setTheme('dark')}>DARK</button>
              <button type="button" data-theme="light" className={theme === 'light' ? 'is-active' : ''} onClick={() => setTheme('light')}>LIGHT</button>
            </div>
            <button type="button" id="founders-signout" onClick={signOutUser}>Sign Out</button>
          </div>
        </div>
      </header>
      <main id="founders-shell">

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
            <div className="meta-row">
              <span className="label">CLIENT</span>
              <span className="value">{client?.companyName || 'UNASSIGNED'}</span>
            </div>
            <div className="meta-row">
              <span className="label">ACCOUNT</span>
              <span className="value">{user?.email || 'SIGNED IN'}</span>
            </div>
            <div className="meta-row">
              <span className="label">TIER</span>
              <button
                id="tier-trigger-btn"
                type="button"
                onClick={() => setShowTierModal(true)}
              >
                Onboarded
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
          {!bootstrapError && errorState ? (
            <div className="db-alert" id="dashboard-error-banner">
              {errorState.message}{errorState.retryPending ? ' Retry is pending.' : ''}
            </div>
          ) : null}
          {!bootstrapError && !errorState && !bootstrapLoading && clientStatus === 'provisioning' ? (
            <div className="db-alert db-alert-muted" id="dashboard-provisioning-banner">
              {provisioningState?.message || 'Your intelligence stack is being initialized. This typically takes a few minutes.'}
            </div>
          ) : null}

          {/* ── Capability grid ── */}
          <div id="capability-grid">
            {intakeCapabilityCards.map((card) => (
              <article
                className={`tile tile-intake-card${hasIntakeData ? ' tile-ready' : ''}${card.wide ? ' tile-intake-card--wide' : ''}`}
                id={card.domId || `tile-${card.id}`}
                key={card.id}
              >
                <div className="tile-number">
                  <span>{card.number} / {card.label}</span>
                  <span className="power-dot lamp" />
                </div>
                <div className={`tile-intake-placeholder tile-intake-placeholder-${card.id}`}>
                  {card.id === 'style-guide' ? (
                    <div id="sg-preview-shell" className="sg-preview">
                      {sgDisplayData?.confidence === 'low' ? (
                        <div className="sg-empty">
                          <span className="sg-empty-label">NO CSS EXTRACTED</span>
                          <span className="sg-empty-msg">Site may be JS-rendered or stylesheet-free</span>
                        </div>
                      ) : (() => {
                        const sgHead = sgDisplayData.typography?.headingSystem;
                        const sgBody = sgDisplayData.typography?.bodySystem;
                        const headName = sgHead?.fontFamily?.split(',')[0].replace(/["']/g, '').trim() || 'Heading';
                        const LEVELS = ['none', 'minimal', 'moderate', 'heavy'];
                        const levelIdx = LEVELS.indexOf(sgDisplayData.motion?.level || 'minimal');
                        return (
                          <>
                            {isStyleGuideMock && <span className="sg-demo-watermark">DEMO</span>}

                            {/* TYPE — H1 sample + P sample */}
                            <div className="sg-quad sg-q-type">
                              <p className="sg-h1" style={{ fontFamily: sgHead?.fontFamily || 'serif' }}>
                                {headName}
                              </p>
                              <p className="sg-p" style={{ fontFamily: sgBody?.fontFamily || 'sans-serif' }}>
                                The quick brown fox jumps over the lazy dog and the paragraph text continues here.
                              </p>
                            </div>

                            {/* COLOR — full-bleed equal bands */}
                            <div className="sg-quad sg-q-color">
                              {[
                                sgDisplayData.colors?.primary,
                                sgDisplayData.colors?.secondary,
                                sgDisplayData.colors?.tertiary,
                                sgDisplayData.colors?.neutral,
                              ].filter(Boolean).map((color, ci) => (
                                <div
                                  key={ci}
                                  className="sg-swatch"
                                  style={{ background: color.hex }}
                                  title={color.role}
                                />
                              ))}
                            </div>

                            {/* LAYOUT — data-driven responsive grid: desktop → mobile */}
                            <div className="sg-quad sg-q-layout">
                              {(() => {
                                const gridType  = sgDisplayData.layout?.grid         || '12-column';
                                const cWidth    = sgDisplayData.layout?.contentWidth || 'contained';
                                const framing   = sgDisplayData.layout?.framing      || 'open';
                                const bradius   = sgDisplayData.layout?.borderRadius || '2px';
                                const maxWidth  = sgDisplayData.layout?.maxWidth;

                                const COL_MAP  = { '12-column': 3, 'auto-fit': 4, 'masonry': 3, 'minimal': 2, 'none': 1, 'custom': 2 };
                                const colCount = COL_MAP[gridType] ?? 3;

                                const isFullBleed = cWidth === 'full-bleed';
                                const isCard      = framing === 'card-based' || framing === 'boxed';
                                const isMasonry   = gridType === 'masonry';
                                const MASONRY_H   = ['30px', '20px', '36px', '24px'];

                                const label = [
                                  gridType.replace('-column', ''),
                                  maxWidth && maxWidth !== 'none' ? maxWidth : null,
                                ].filter(Boolean).join(' · ');

                                return (
                                  <>
                                    <div id="sg-rg-demo" className={`sg-rg${isFullBleed ? ' sg-rg--fullbleed' : ''}`}>
                                      <div className="sg-rg-nav" />
                                      <div
                                        className="sg-rg-cols"
                                        style={{ '--sg-col-min-w': colCount <= 1 ? '0px' : '30px' }}
                                      >
                                        {Array.from({ length: colCount }, (_, i) => (
                                          <div
                                            key={i}
                                            className={`sg-rg-col${isCard ? ' sg-rg-col--card' : ''}`}
                                            style={{
                                              borderRadius: bradius,
                                              ...(isMasonry ? { height: MASONRY_H[i] ?? '28px', flex: 'none', width: `${Math.round(100 / colCount)}%` } : {}),
                                            }}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                    <span className="sg-grid-label">{label}</span>
                                  </>
                                );
                              })()}
                            </div>

                            {/* MOTION — easing curve SVG + tech label */}
                            <div className="sg-quad sg-q-motion">
                              {(() => {
                                const primaryEasing = sgDisplayData.motion?.easings?.[0] || 'ease-in-out';
                                const animDur = sgDisplayData.motion?.durations?.[0] || '400ms';
                                const p = sgDisplayData.motion?.scrollPatterns || [];
                                const motionTech = p.some(s => /gsap/i.test(s)) ? 'GSAP'
                                  : p.some(s => /lenis/i.test(s)) ? 'Lenis'
                                  : p.some(s => /aos/i.test(s)) ? 'AOS'
                                  : p.some(s => /framer/i.test(s)) ? 'Framer'
                                  : p.length ? p[0].split(' ')[0] : 'CSS';
                                // Forward-only path: drawn as the visible curve
                                const curvePath    = _sgEasingPath(primaryEasing, 80, 80);
                                // Round-trip path: forward + reversed bezier, no jump at end
                                const rtPath       = _sgEasingPath(primaryEasing, 80, 80, true);
                                const easingSpline = _sgEasingSpline(primaryEasing);
                                // Show GSAP power name when tech is GSAP, otherwise CSS name
                                const easingLabel  = _sgGsapName(primaryEasing, motionTech === 'GSAP');
                                return (
                                  <>
                                    <svg className="sg-ease-svg" viewBox="-3 -3 86 86" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      {/* Axes */}
                                      <line x1="0" y1="0" x2="0" y2="80" stroke="rgba(42,36,32,0.14)" strokeWidth="0.75"/>
                                      <line x1="0" y1="80" x2="80" y2="80" stroke="rgba(42,36,32,0.14)" strokeWidth="0.75"/>
                                      {/* Linear reference diagonal */}
                                      <line x1="0" y1="80" x2="80" y2="0" stroke="rgba(42,36,32,0.1)" strokeWidth="0.75" strokeDasharray="3 3"/>
                                      {/* Visible easing curve (forward only) */}
                                      <path d={curvePath} stroke="rgba(42,36,32,0.82)" strokeWidth="2" strokeLinecap="round"/>
                                      {/* Hidden round-trip path — dot travels forward then retraces back, no restart jump */}
                                      <path id="sg-ease-rt-path" d={rtPath} stroke="none" fill="none"/>
                                      {/* Animated dot: 3s total (1.5s forward + 1.5s reverse), easing both ways */}
                                      <circle r="3.5" fill="rgba(42,36,32,0.8)">
                                        <animateMotion dur="3s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines={`${easingSpline};${easingSpline}`}>
                                          <mpath xlinkHref="#sg-ease-rt-path"/>
                                        </animateMotion>
                                      </circle>
                                      {/* Endpoint dots */}
                                      <circle cx="0" cy="80" r="2.5" fill="rgba(42,36,32,0.3)"/>
                                      <circle cx="80" cy="0" r="2.5" fill="rgba(42,36,32,0.3)"/>
                                    </svg>
                                    <div className="sg-motion-meta">
                                      <span className="sg-motion-easing">{easingLabel}</span>
                                      <span className="sg-motion-sep">·</span>
                                      <span className="sg-motion-dur">{animDur}</span>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : card.id === 'intake-terminal' && intakeMockupSrc ? (
                    <img
                      className="tile-intake-mockup-image"
                      src={intakeMockupSrc}
                      alt="Generated multi-device website mockup"
                      onError={() => setIntakeMockupSrc(null)}
                    />
                  ) : card.id === 'seo-performance' && hasSeoAuditData ? (() => {
                    const sc  = seoAudit?.scores ?? {};
                    const cwv = seoAudit?.coreWebVitals ?? {};
                    const lab = seoAudit?.labCoreWebVitals ?? {};
                    const scoreRings = [
                      ['Performance',    sc.performance],
                      ['SEO',            sc.seo],
                      ['Accessibility',  sc.accessibility],
                      ['Best Practices', sc.bestPractices],
                    ].filter(([, v]) => v != null);
                    const lcpMs   = cwv.lcp?.p75  ?? lab.lcp?.p75;
                    const inpMs   = cwv.inp?.p75;
                    const clsVal  = cwv.cls?.p75  ?? lab.cls?.p75;
                    const ttfbMs  = cwv.ttfb?.p75 ?? lab.ttfb?.p75;
                    // Goodness percentage: 100 = best, 0 = worst. Bar fill shows quality level.
                    const goodnessPct = (key, raw) => {
                      if (raw == null) return 0;
                      switch (key) {
                        case 'lcp':  return Math.max(2, Math.min(100, (1 - raw / 8000) * 100));
                        case 'inp':  return Math.max(2, Math.min(100, (1 - raw / 1000) * 100));
                        case 'cls':  return Math.max(2, Math.min(100, (1 - raw / 0.5)  * 100));
                        case 'ttfb': return Math.max(2, Math.min(100, (1 - raw / 3000) * 100));
                        default:     return 0;
                      }
                    };
                    const cwvItems = [
                      lcpMs  != null && { key: 'lcp', label: 'Largest Contentful Paint', display: `${(lcpMs / 1000).toFixed(1)}s`, cat: cwv.lcp?.category ?? lab.lcp?.category, pct: goodnessPct('lcp', lcpMs)  },
                      inpMs  != null && { key: 'inp', label: 'Interaction to Next Paint', display: `${inpMs}ms`,                    cat: cwv.inp?.category,                       pct: goodnessPct('inp', inpMs)  },
                      clsVal != null && { key: 'cls', label: 'Cumulative Layout Shift',   display: Number(clsVal).toFixed(2),       cat: cwv.cls?.category ?? lab.cls?.category,  pct: goodnessPct('cls', clsVal) },
                    ].filter(Boolean);
                    const diagItems = (seoAudit?.diagnostics ?? []).slice(0, 2);
                    const scoreColor = (v) => v >= 90 ? 'success' : v >= 50 ? 'warning' : 'danger';
                    const cwvColor   = (c) => c === 'FAST' ? 'success' : c === 'AVERAGE' ? 'warning' : c === 'SLOW' ? 'danger' : null;
                    const catLabel   = (c) => c === 'FAST' ? 'Fast' : c === 'AVERAGE' ? 'Average' : c === 'SLOW' ? 'Slow' : null;
                    const circ = 150.8;
                    return (
                      <div id="seo-perf-viz-shell">
                        <div id="seo-perf-rings-row">
                          {scoreRings.map(([label, score]) => (
                            <div className="seo-ring-cell" key={label}>
                              <svg className="seo-ring-svg" viewBox="0 0 58 58">
                                <circle className="ring-bg" cx="29" cy="29" r="24" fill="none" strokeWidth="4" />
                                <circle
                                  className={`ring-fill ring-fill-${scoreColor(score)} stroke-lit`}
                                  cx="29" cy="29" r="24" fill="none" strokeWidth="4"
                                  strokeDasharray={circ}
                                  strokeDashoffset={circ - (circ * score / 100)}
                                  transform="rotate(-90 29 29)"
                                />
                              </svg>
                              <div className="ring-val">{score}</div>
                              <div className="ring-label">{label}</div>
                            </div>
                          ))}
                        </div>
                        {cwvItems.length > 0 && (
                          <div id="seo-perf-cwv-row">
                            {cwvItems.map(({ key, label, display, cat, pct }) => {
                              const tone = cwvColor(cat);
                              const cLabel = catLabel(cat);
                              return (
                                <div className="seo-cwv-item" key={key}>
                                  <div className="seo-cwv-head">
                                    <span className="seo-cwv-label">{label}</span>
                                    <span className={`seo-cwv-val${tone ? ` seo-cwv-val--${tone}` : ''}`}>
                                      {display}{cLabel ? ` · ${cLabel}` : ''}
                                    </span>
                                  </div>
                                  <div className="seo-cwv-bar-track">
                                    <div
                                      className={`seo-cwv-bar-fill${tone ? ` seo-cwv-bar-fill--${tone}` : ''}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {diagItems.length > 0 && (() => {
                          // Parse a numeric value from strings like "0.2 S", "1,234 KiB", "3.1 s"
                          const parseNum = (str) => {
                            if (str == null) return null;
                            const n = parseFloat(String(str).replace(/,/g, ''));
                            return isNaN(n) ? null : n;
                          };
                          const diagNums = diagItems.map((d) => parseNum(d.value));
                          const maxNum   = Math.max(...diagNums.filter((n) => n != null), 0.001);
                          return (
                            <div id="seo-perf-diag-row">
                              <span id="seo-perf-diag-heading">Diagnostics</span>
                              <div id="seo-perf-diag-cards">
                                {diagItems.map((d, i) => {
                                  const num = diagNums[i];
                                  const barPct = num != null ? Math.max(4, (num / maxNum) * 100) : null;
                                  return (
                                    <div className="seo-diag-card" key={d.id}>
                                      <div className="seo-diag-card-val">{d.value}</div>
                                      <div className="seo-diag-card-label">{d.label}</div>
                                      {barPct != null && (
                                        <div className="seo-diag-bar-track">
                                          <div className="seo-diag-bar-fill" style={{ width: `${barPct}%` }} />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })() : card.id === 'brand-tone' && siteMeta?.ogImage ? (
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
                  ) : (
                    <span>{card.placeholderLabel}</span>
                  )}
                </div>
                <div className="tile-intake-body">
                  <h3 className="tile-heading tile-intake-heading">{card.title}</h3>
                  <p className="tile-description tile-intake-description">{card.description}</p>
                  <div className="tile-intake-table-wrap">
                    <table className="tile-intake-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {card.rows.map((row) => (
                          row.isHeader ? (
                            <tr key={`${card.id}-${row.key}`} className="tr--section-header" id={row.id || undefined}>
                              <td colSpan={2}>{row.label}</td>
                            </tr>
                          ) : (
                            <tr key={`${card.id}-${row.key}`} className={row.isFailing ? 'tr--flag' : undefined}>
                              <td>{row.label}</td>
                              <td>{row.value}</td>
                            </tr>
                          )
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="tile-foot">
                  <span className="status-live">{card.footerLeft}</span>
                  <span className="tile-foot-right-group">
                    {card.footerAction ? (
                      <button
                        type="button"
                        id={`tile-${card.id}-rerun-btn`}
                        className="tile-foot-action-btn"
                        onClick={card.footerAction.onClick}
                        disabled={card.footerAction.loading}
                      >
                        {card.footerAction.loading ? '…' : card.footerAction.label}
                      </button>
                    ) : null}
                    <span>{card.footerRight}</span>
                  </span>
                </div>
              </article>
            ))}
            {tiles.map((tile) => {
              const isFreeTier = FREE_TIER_TILE_IDS.has(tile.id);
              const isReady = isFreeTier && hasIntakeData;
              const tileStatus = isReady ? tile.status : isFreeTier ? 'INITIALIZING' : 'PREVIEW';
              const tileMetric = isReady ? tile.metric : isFreeTier ? '—' : 'PRO TIER';
              const isBlocked = true;
              const upgradeTitle = UPGRADE_TILE_TITLES[tile.id] || tile.label;
              const resolvedDescription = UPGRADE_TILE_DESCRIPTIONS[tile.id] || tile.description;
              const tileRows = [
                { key: 'tier',    label: 'Tier',    value: isFreeTier ? 'Free Tier' : 'Pro Tier' },
                { key: 'status',  label: 'Status',  value: tileStatus },
                { key: 'metric',  label: 'Metric',  value: tileMetric },
                { key: 'module',  label: 'Module',  value: tile.label || 'Not provided' },
                { key: 'summary', label: 'Summary', value: resolvedDescription || 'Not provided' },
              ];
              return (
                <article
                  className={`tile tile-intake-card${!isFreeTier ? ' tile-preview' : ''}${isReady ? ' tile-ready' : ''}${isBlocked ? ' tile-blocked' : ''}`}
                  id={`tile-${tile.number}-${tile.id}`}
                  key={tile.id}
                >
                  {isBlocked ? (
                    <div className="tile-blocked-overlay" aria-hidden="false">
                      <div className="tile-blocked-inner">
                        <h3 className="tile-heading tile-intake-heading tile-blocked-title">{upgradeTitle}</h3>
                        <p className="tile-description tile-intake-description tile-blocked-description">{resolvedDescription}</p>
                        <button
                          type="button"
                          className="cta-pill-btn tile-blocked-upgrade-btn"
                          id={`tile-${tile.id}-upgrade-btn`}
                          onClick={() => setShowTierModal(true)}
                        >
                          Upgrade Tier
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="tile-number">
                    <span>{tile.number} / {tile.label}</span>
                    <span className={`power-dot lamp${!isFreeTier ? ' power-dot-dim' : ''}`} />
                  </div>
                  <div className="tile-intake-placeholder tile-intake-placeholder-draft-post">
                    {renderViz(tile.viz, countdownHours)}
                  </div>
                  <div className="tile-intake-body">
                    <h3 className="tile-heading tile-intake-heading">{tile.title}</h3>
                    <p className="tile-description tile-intake-description">{resolvedDescription}</p>
                    <div className="tile-intake-table-wrap">
                      <table className="tile-intake-table">
                        <thead>
                          <tr>
                            <th>Field</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tileRows.map((row) => (
                            <tr key={`${tile.id}-${row.key}`}>
                              <td>{row.label}</td>
                              <td>{row.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="tile-foot">
                    <span className={`status-live${!isFreeTier ? ' status-preview' : ''}`}>{tileStatus}</span>
                    <span>{tileMetric}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

      </main>

      {/* ── Intake build modal — auth card shell + embedded terminal ── */}
      {showIntakeModal ? (
        <div id="intake-modal-overlay" role="dialog" aria-modal="true" aria-label="Dashboard build in progress">

          {/* Card: exact auth cardStyle */}
          <div
            id="intake-modal-card"
            style={{
              position: 'relative',
              zIndex: 2,
              width: '100%',
              maxWidth: '30rem',
              padding: 'clamp(1.25rem, 5vw, 2rem)',
              borderRadius: '1.1rem',
              boxSizing: 'border-box',
              ...internalPageGlassCardStyle,
              background: 'rgba(255, 252, 248, 0.97)',
              boxShadow: `${internalPageGlassCardStyle.boxShadow}, 0 30px 90px rgba(42,36,32,0.12)`,
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
                  background: latestRunStatus === 'failed' ? '#D71921' : completionCountdown !== null ? '#4A9E5C' : latestRunStatus === 'queued' ? '#D4A843' : '#4A9E5C',
                  animation: isRunActive ? 'status-pulse 1.4s ease-in-out infinite' : 'none',
                }} />
              </span>
            </div>

            {/* Marquee — exact auth titleViewport/Track/titleStyle */}
            <div style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
              <div ref={modalMarqueeTrackRef} style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform' }}>
                {(['a', 'b']).map((k) => (
                  <span key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ margin: 0, flexShrink: 0, color: '#2a2420', fontSize: 'clamp(2rem, 8.5vw, 7rem)', lineHeight: 1, letterSpacing: '-0.04em', fontFamily: '"Doto", "Space Mono", monospace', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {completionCountdown !== null
                      ? 'DASHBOARD READY\u00A0\u00A0\u00B7\u00A0\u00A0'
                      : latestRunStatus === 'failed'
                        ? 'BUILD FAILED\u00A0\u00A0\u00B7\u00A0\u00A0SETUP REQUIRED\u00A0\u00A0\u00B7\u00A0\u00A0'
                        : 'BUILDING YOUR DASHBOARD\u00A0\u00A0\u00B7\u00A0\u00A0PROCESSING WEBSITE\u00A0\u00A0\u00B7\u00A0\u00A0'}
                  </span>
                ))}
              </div>
            </div>

            {/* Copy — exact auth copyStyle */}
            <p id="intake-modal-copy" style={{ margin: 0, color: 'rgba(42,36,32,0.66)', lineHeight: 1.6, fontFamily: '"Space Grotesk", system-ui, sans-serif', textAlign: 'center' }}>
              {completionCountdown !== null
                ? `Dashboard launching in ${completionCountdown}…`
                : latestRunStatus === 'queued'
                  ? 'Creating Your Dashboard'
                  : latestRunStatus === 'running'
                    ? 'Creating Your Dashboard. You can close this window and come back.'
                    : 'Setup encountered an issue. Update the website URL below to retry.'}
            </p>


            {/* ── Embedded terminal panel ── */}
            <div id="intake-modal-terminal-embed" ref={terminalOutputRef}>
              {displayedTerminalLines.map((line, i) => (
                <div key={`tl-${i}`} className={`term-line term-${line.type}`}>
                  <span className="term-pfx">{line.prefix}</span>
                  <span className="term-msg">{line.text}</span>
                  {line.cursor ? <span className="term-caret" /> : null}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div id="intake-modal-footer">
              {client?.normalizedHost
                || (currentRun?.sourceUrl ? (() => { try { return new URL(currentRun.sourceUrl).hostname.replace(/^www\./, ''); } catch { return currentRun.sourceUrl; } })() : null)
                || '\u00A0'}
            </div>

          </div>
        </div>
      ) : null}

      {showTierModal ? (
        <div
          id="tier-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Pricing options"
          onClick={() => setShowTierModal(false)}
        >
          <div
            id="tier-modal-card"
            onClick={(event) => event.stopPropagation()}
            style={{
              position: 'relative',
              zIndex: 2,
              width: '100%',
              maxWidth: '44rem',
              padding: 'clamp(1.25rem, 5vw, 2rem)',
              borderRadius: '1.1rem',
              boxSizing: 'border-box',
              ...internalPageGlassCardStyle,
              background: 'rgba(255, 252, 248, 0.97)',
              boxShadow: `${internalPageGlassCardStyle.boxShadow}, 0 30px 90px rgba(42,36,32,0.12)`,
            }}
          >
            <div id="tier-modal-top">
              <div id="tier-modal-brand-row">
                <img src="/img/sig.png" alt="" aria-hidden="true" style={{ width: '2.75rem', height: 'auto', display: 'block' }} />
                <span id="tier-modal-eyebrow">Client Access</span>
                <button id="tier-modal-close" type="button" onClick={() => setShowTierModal(false)} aria-label="Close pricing modal">✕</button>
              </div>
              <div id="tier-modal-title-wrap">
                <h2 id="tier-modal-title">Pricing Options</h2>
                <p id="tier-modal-summary">Current tier and upgrade paths. This content is placeholder copy and will be updated later.</p>
              </div>
            </div>

            <div id="tier-modal-grid">
              {PRICING_MODAL_OPTIONS.map((option) => (
                <article className="tier-option-card" key={option.id} id={`tier-option-${option.id}`}>
                  <div className="tier-option-head">
                    <span className="tier-option-label">{option.label}</span>
                    <span className="tier-option-price">{option.price}</span>
                  </div>
                  <p className="tier-option-summary">{option.summary}</p>
                </article>
              ))}
            </div>

            <div id="tier-modal-footer">Placeholder pricing modal — content to be updated.</div>
          </div>
        </div>
      ) : null}

    </div>
  );
};

// ── Tile viz renderers ────────────────────────────────────────────────────────

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
  }
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
    border-bottom: 1px solid var(--border);
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
  }
  .meta-row:last-child { border-bottom: none; }
  .meta-row .label { font-size: 0.72rem; color: var(--text-secondary); font-family: var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
  .meta-row .value { font-family: var(--font-mono); font-size: clamp(0.82rem, 1.1vw, 0.95rem); color: var(--text-display); }
  #tier-trigger-btn {
    border: none;
    background: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text-display);
    text-decoration: underline;
    text-underline-offset: 0.18em;
    cursor: pointer;
  }
  .meta-value-wrap { font-size: 11px; max-width: 28ch; text-align: right; line-height: 1.4; white-space: normal; }
  #capability-section { padding: 80px 0 0; }
  .db-alert {
    margin: 0 0 20px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-display);
    font-size: 12px;
    line-height: 1.5;
  }
  .db-alert-muted { color: var(--text-secondary); }
  #capability-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
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
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
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
    border: 1px solid transparent;
    background: rgba(255, 252, 248, 0.92);
    color: #2a2420;
    font-family: "Space Mono", monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 10px 18px;
    border-radius: 999px;
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(42, 36, 32, 0.12);
    transition: transform 0.18s ease, background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
  }
  .tile-blocked-upgrade-btn:hover {
    background: #faf7f2;
    color: #2a2420;
    transform: translateY(-1px);
    box-shadow: 0 10px 22px rgba(42, 36, 32, 0.16);
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
  #bt-preview-shell {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
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
  .tile-intake-mockup-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
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
  }

  /* TYPE — top-left */
  .sg-q-type {
    border-right: 1px solid rgba(42,36,32,0.1);
    border-bottom: 1px solid rgba(42,36,32,0.1);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
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
    min-height: 0;
    overflow-y: auto;
  }
  .tile-intake-heading {
    grid-area: auto;
    margin: 0;
  }
  .tile-intake-description {
    grid-area: auto;
    margin-top: 0;
    max-width: none;
  }
  .tile-intake-table-wrap {
    margin-top: 2px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    height: 180px;
    overflow-y: auto;
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
  .tile-number {
    grid-area: num;
    font-size: 10px;
    color: var(--text-disabled);
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tile-number .power-dot {
    width: 6px;
    height: 6px;
    display: inline-block;
  }
  .power-dot-dim { background: var(--text-disabled) !important; box-shadow: none !important; }
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
    border-top: 1px solid var(--border);
    font-size: 10px;
    color: var(--text-secondary);
    display: flex;
    justify-content: space-between;
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
  #seo-perf-viz-shell {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 10px 12px;
    box-sizing: border-box;
  }
  #seo-perf-rings-row {
    display: flex;
    gap: 6px;
    justify-content: space-around;
    align-items: center;
    width: 100%;
  }
  .seo-ring-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
  }
  .seo-ring-svg {
    display: block;
    width: clamp(34px, 6vw, 52px);
    height: clamp(34px, 6vw, 52px);
  }
  #seo-perf-cwv-row {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
  }
  .seo-cwv-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .seo-cwv-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .seo-cwv-label {
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .seo-cwv-val {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-primary);
    letter-spacing: 0.04em;
  }
  .seo-cwv-val--success { color: var(--success); }
  .seo-cwv-val--warning { color: var(--warning); }
  .seo-cwv-val--danger  { color: var(--accent); }
  .seo-cwv-bar-track {
    width: 100%;
    height: 3px;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .seo-cwv-bar-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--text-secondary);
    transition: width 600ms var(--ease);
  }
  .seo-cwv-bar-fill--success { background: var(--success); }
  .seo-cwv-bar-fill--warning { background: var(--warning); }
  .seo-cwv-bar-fill--danger  { background: var(--accent); }
  #seo-perf-diag-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-top: 7px;
    border-top: 1px solid var(--border);
  }
  #seo-perf-diag-heading {
    font-family: var(--font-mono);
    font-size: 7px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-bottom: 2px;
  }
  #seo-perf-diag-cards {
    display: flex;
    gap: 6px;
    width: 100%;
  }
  .seo-diag-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px 7px 6px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid var(--border);
    min-width: 0;
    overflow: hidden;
  }
  .seo-diag-card-val {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--warning);
    letter-spacing: 0.01em;
    line-height: 1;
    white-space: nowrap;
  }
  .seo-diag-card-label {
    font-family: var(--font-mono);
    font-size: 7px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }
  .seo-diag-bar-track {
    width: 100%;
    height: 3px;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
    margin-top: 3px;
  }
  .seo-diag-bar-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--warning);
    transition: width 600ms var(--ease);
  }
  @media (max-width: 480px) {
    .seo-ring-svg { width: 30px; height: 30px; }
    #seo-perf-rings-row { gap: 3px; }
    .ring-val { font-size: 9px; margin-top: 3px; }
    .ring-label { font-size: 6px; }
    .seo-cwv-label { font-size: 6.5px; }
    .seo-cwv-val { font-size: 7.5px; }
    #seo-perf-viz-shell { gap: 7px; padding: 8px 8px; }
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
  @media (max-width: 1200px) {
    #founders-hero-shell { grid-template-columns: 1fr; gap: 32px; }
  }
  @media (max-width: 900px) {
    #founders-shell { padding: 104px 24px 64px; }
    #founders-top-strip-inner { padding: 0 24px; }
    #dashboard-source-cta-row { width: 100%; }
    #capability-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tile { aspect-ratio: auto; min-height: 220px; grid-template-areas: "num" "head" "desc" "viz" "foot"; grid-template-columns: 1fr; row-gap: 14px; }
    .tile-description { }
    #intake-identity-row { grid-template-columns: 1fr; gap: 16px; }
  }
  @media (max-width: 520px) {
    #capability-grid { grid-template-columns: 1fr; }
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
    box-shadow: 0 1px 4px rgba(42,36,32,0.07);
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
    transition: opacity 150ms;
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
    background: #1a1a1a;
    border-radius: 0.55rem;
    padding: 0.7rem 0.85rem 0.8rem;
    margin-top: 0.85rem;
    height: 9rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    max-height: 11rem;
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
  /* One Dark palette */
  .term-system .term-pfx, .term-system .term-msg { color: #3a3a3a; }
  .term-dim .term-pfx, .term-dim .term-msg { color: #333; }
  .term-info .term-pfx { color: #4b5263; }
  .term-info .term-msg { color: #6a6f7a; }
  .term-fetch .term-pfx { color: #56b6c2; }
  .term-fetch .term-msg { color: #7ab8bd; }
  .term-ok .term-pfx { color: #98c379; }
  .term-ok .term-msg { color: #5d8a44; }
  .term-ai .term-pfx { color: #c678dd; }
  .term-ai .term-msg { color: #8c52b8; }
  .term-build .term-pfx { color: #e5c07b; }
  .term-build .term-msg { color: #a8843c; }
  .term-error .term-pfx { color: #e06c75; }
  .term-error .term-msg { color: #a84f57; }
  .term-active .term-pfx { color: #61afef; }
  .term-active .term-msg { color: #dde1e8; font-weight: 700; }
  .term-countdown .term-pfx { color: #e5c07b; }
  .term-countdown .term-msg { color: #e5c07b; font-weight: 700; font-size: 0.72rem; letter-spacing: 0.03em; }
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
  @media (max-width: 480px) {
    #intake-modal-overlay { padding: 1rem; align-items: center; }
    #intake-modal-card { width: 100%; box-sizing: border-box; }
  }

  /* ── Tier modal ── */
  #tier-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 360;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(32, 28, 24, 0.18);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
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
  #tier-modal-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 999px;
    background: rgba(255,255,255,0.34);
    border: 1px solid rgba(42,36,32,0.12);
    color: rgba(42,36,32,0.58);
    font-size: 0.95rem;
    cursor: pointer;
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
