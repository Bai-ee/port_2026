'use strict';

// card-static-copy.js — Dashboard baseline copy per card.
//
// This is the static text rendered on the dashboard when Scribe has NOT
// produced a per-card expansion yet. Pulled verbatim from DashboardPage.jsx
// so the Data Map shows exactly what the user sees in either state.
//
// Shape: { [cardId]: { description, placeholderLabel? } }
//
// If you edit copy on the dashboard, mirror the change here so the Data Map
// stays accurate. No runtime behavior change — this file is read-only data
// for the admin Data Map tab.

const CARD_STATIC_COPY = {
  // ── Intake-fed cards (free tier) ─────────────────────────────────────
  'intake-terminal': {
    description: "Tracks every scraped page, extracted signal, and normalization decision across the full intake lifecycle — so you can see exactly what the pipeline consumed and produced.",
    placeholderLabel: 'SEO AUDIT / status-driven',
  },
  'brief': {
    description: "A synthesized creative brief built from intake signals — brand positioning, audience frame, voice, and the one move most worth making right now.",
    placeholderLabel: 'BRAND BRIEF',
    dynamicOverride: 'brandOverview.headline overrides description when present',
  },
  'brand-tone': {
    description: "Voice system and tone markers extracted from intake copy — defines how your brand writes, what it avoids, and the personality it projects across every channel.",
    alternateDescription: "Open Graph metadata, Twitter Card tags, favicon, and canonical URL parsed directly from your live homepage — the first layer of your public brand surface.",
    altLabel: 'SITE META (when siteMeta present)',
    placeholderLabel: 'VOICE PREVIEW / NO OG IMAGE PROVIDED',
  },
  'style-guide': {
    description: "Typography, color palette, layout system, and motion signals extracted from your live site's CSS — normalized into a portable design reference used to keep all generated output on-brand.",
    placeholderLabel: 'STYLE SNAPSHOT',
  },
  'seo-performance': {
    description: "Core Web Vitals, Lighthouse scores, and meta-tag coverage pulled directly from PageSpeed Insights — shows where your site loses rankings, load performance, and mobile experience points.",
    placeholderLabel: 'SITE AUDIT',
  },
  'industry': {
    description: "Market vertical and service category normalized from intake signals — used to calibrate tone, benchmark competitors, and align content to the right audience frame.",
    placeholderLabel: 'MARKET CATEGORY',
  },
  'business-model': {
    description: "Revenue structure and commercial setup extracted from pricing pages, service tiers, and product copy — defines how the business captures value and what offers exist to promote.",
    placeholderLabel: 'REVENUE MODEL',
  },
  'priority-signal': {
    description: "The highest-confidence marketing move available right now — derived by crossing brand readiness, content gaps, and channel fit to surface the one thing most worth shipping first.",
    placeholderLabel: 'SIGNAL BRIEF',
  },
  'draft-post': {
    description: "A publish-ready social draft built from your brand voice, audience frame, and priority signal — structured to the approved format and ready for a final edit before it goes live.",
    placeholderLabel: 'POST DRAFT',
  },
  'content-angle': {
    description: "The specific editorial lens, audience pain point, and positioning frame selected for the next content push — locks the POV so every asset in this cycle is pulling in the same direction.",
    placeholderLabel: 'ANGLE LOCKED',
  },
  'content-opportunities': {
    description: "Ranked list of content and channel moves with the highest signal-to-noise ratio — each opportunity is scored by priority, matched to a format, and tied to a concrete why-now rationale.",
    placeholderLabel: 'OPPORTUNITY MAP',
  },
  'competitor-info': {
    description: "Competitive landscape pulled from live sources — shows how your positioning, messaging, and offer stack up against direct and indirect competitors in your space.",
    placeholderLabel: 'COMPETITOR MAP',
  },
  'signals': {
    description: "Live signal feed from geographic events, trending topics, and social conversations relevant to your brand — surfaces what is happening in your market right now.",
    placeholderLabel: 'SIGNAL FEED',
  },
  'marketing': {
    description: "Strategy recommendations generated from live signals — cross-referenced with your brand positioning and audience frame to produce prioritized marketing moves.",
    placeholderLabel: 'STRATEGY OUTPUT',
  },
  'website-landing': {
    description: "Evaluates the live site for conversion, UX, and performance gaps — flags thin content, missing CTAs, single-page architecture, and slow load times, then proposes targeted fixes.",
    placeholderLabel: 'SITE HEALTH',
  },
  'brand-identity-design': {
    description: "Audits the live brand asset surface — favicon, Open Graph image, theme color, Apple touch icon, and canonical — and surfaces missing pieces with a concrete scope for a brand refresh.",
    placeholderLabel: 'BRAND ASSETS',
  },

  // ── Upgrade-tier tiles (paid) ────────────────────────────────────────
  'creative-pipelines':      { description: "Automates content creation in real time, aligning every post with your brand's voice while driving consistent engagement." },
  'company-brain':           { description: 'Centralizes your entire operating stack into a structured, searchable system that powers faster decisions and smarter execution.' },
  'knowledge-assistant':     { description: 'Instantly answers team questions by pulling from your documents, conversations, and data—eliminating bottlenecks and repetitive work.' },
  'executive-support':       { description: 'Prepares meetings, surfaces insights, and drafts communications so you walk into every decision fully informed.' },
  'daily-operations':        { description: 'Runs core business tasks automatically—email triage, task tracking, reporting, and team updates—without manual oversight.' },
  'email-marketing':         { description: 'Builds, schedules, and optimizes campaigns across regions while learning and improving from feedback over time.' },
  'ai-research':             { description: 'Generates deep consumer insights, competitive analysis, and market validation in hours instead of weeks.' },
  'financial-tax':           { description: 'Organizes transactions, corrects discrepancies, and produces reporting-ready outputs aligned with accounting workflows.' },
  'compliance':              { description: 'Continuously checks deadlines, filings, and regulatory requirements to ensure nothing critical is missed.' },
  'distribution-insight':    { description: 'Unifies social publishing, SEO fixes, search visibility, and performance reporting into one continuous system that surfaces what to ship, where to publish, and what to improve next.' },
  'rapid-product':           { description: 'Builds and deploys functional tools, integrations, and experiences from concept to launch in a fraction of the time.' },
  'self-improving':          { description: 'Continuously refines workflows, tools, and outputs based on feedback, increasing performance over time.' },
  'reddit-community':        { description: 'Finds relevant threads and drafts reply ideas and post concepts for review before publishing.' },
  'seo-content':             { description: 'Surfaces keyword opportunities and drafts landing pages, blog outlines, and content directions for approval.' },
  'multi-agent-pipeline':    { description: 'A four-stage agent architecture — Scout, Scribe, Guardian, Reporter — runs automatically each day, taking raw market data from five sources and producing a founder-ready content brief with zero manual input.' },
  'hyperlocal-signals':      { description: 'Scout pulls live data from X/Twitter, Instagram, Reddit, customer reviews, and weather APIs, normalizes them into a unified intelligence format, and trims context to ~5K tokens before synthesis — optimized to under $0.10 per full run.' },
  'platform-content-gen':    { description: "Scribe reads the day's brief and produces ready-to-publish drafts for Instagram, X/Twitter, Facebook, and Discord — each formatted to platform conventions and constrained by brand voice rules defined in client knowledge files." },
  'brand-safety-gate':       { description: 'Guardian runs four sequential validation checks on every piece of generated content: restricted term scanning, competitor mention detection, factual accuracy, and brand voice scoring — outputting a readiness verdict and 0–100 quality score before anything moves forward.' },
  'founder-daily-brief':     { description: "Reporter transforms the day's intelligence, content drafts, and QA results into a formatted HTML briefing — with operational context, review insights, Reddit signals, competitor activity, and content opportunities — delivered to the admin dashboard on schedule." },
  'admin-dashboard-history': { description: 'A real-time web dashboard surfaces the latest pipeline run: priority action, weather impact, content angle, Guardian verdict, and cost per run. A full archive of past runs lets the team compare briefs, track signal trends, and trigger fresh runs on demand.' },
  'image-generation':        { description: 'A canvas-based generator handles post image production — with configurable presets, logo placement controls, and live preview. Completed renders upload to Firebase Storage and attach automatically to the current brief run.' },
  'knowledge-file-config':   { description: 'The entire system adapts to a new client by swapping four JSON files: brand voice rules, intelligence config, business facts, and a restricted-terms glossary. No code changes required to onboard a new brand or vertical.' },
};

function getStaticCopy(cardId) {
  return CARD_STATIC_COPY[cardId] || null;
}

module.exports = { CARD_STATIC_COPY, getStaticCopy };
