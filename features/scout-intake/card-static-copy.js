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
    description: 'Shows what information was collected during setup so you can tell whether the dashboard has enough context to help.',
    placeholderLabel: 'SEO AUDIT / status-driven',
  },
  'brief': {
    description: 'Acts like an account director: summarizes the business, audience, offer, and next move in one working brief.',
    placeholderLabel: 'BRAND BRIEF',
    dynamicOverride: 'brandOverview.headline overrides description when present',
  },
  'brand-tone': {
    description: 'Reviews how the brand sounds and points out where the message feels clear, unclear, or inconsistent.',
    alternateDescription: 'Shows how the site appears when the link is shared, including the title, description, and image.',
    altLabel: 'SITE META (when siteMeta present)',
    placeholderLabel: 'VOICE PREVIEW / NO OG IMAGE PROVIDED',
  },
  'style-guide': {
    description: 'Reviews the brand visuals - colors, type, layout, and consistency - so future designs have a clear guide.',
    placeholderLabel: 'STYLE SNAPSHOT',
  },
  'seo-performance': {
    description: 'Acts like a website developer: checks speed, search basics, and page structure so you know what is helping or hurting visibility.',
    placeholderLabel: 'SITE AUDIT',
  },
  'agent-readiness': {
    description: 'Checks whether search engines and AI tools can understand the site and points to the first visibility fixes.',
    placeholderLabel: 'AGENT READY',
  },
  'industry': {
    description: 'Sets the business category so recommendations are compared against the right market.',
    placeholderLabel: 'MARKET CATEGORY',
  },
  'business-model': {
    description: 'Explains how the business makes money and what it sells, so marketing, SEO, and offers can be aimed correctly.',
    placeholderLabel: 'REVENUE MODEL',
  },
  'priority-signal': {
    description: 'Chooses the most important next action and explains why it should come first.',
    placeholderLabel: 'SIGNAL BRIEF',
  },
  'draft-post': {
    description: 'Collects post drafts written for the brand so they can be reviewed and approved.',
    placeholderLabel: 'POST DRAFT',
  },
  'content-angle': {
    description: 'Sets the main content angle so posts, pages, and creative all point in the same direction.',
    placeholderLabel: 'ANGLE LOCKED',
  },
  'content-opportunities': {
    description: 'Lists the best content and channel opportunities, with the reason each one is worth considering.',
    placeholderLabel: 'OPPORTUNITY MAP',
  },
  'competitor-info': {
    description: 'Reviews how competitors talk about themselves so your positioning can stay sharper.',
    placeholderLabel: 'COMPETITOR MAP',
  },
  'signals': {
    description: 'Finds trends, events, and conversations that could affect what the business should say next.',
    placeholderLabel: 'SIGNAL FEED',
  },
  'marketing': {
    description: 'Turns market signals and brand context into recommended marketing moves.',
    placeholderLabel: 'STRATEGY OUTPUT',
  },
  'website-landing': {
    description: 'Reviews whether the website clearly guides visitors toward the next action.',
    placeholderLabel: 'SITE HEALTH',
  },
  'brand-identity-design': {
    description: 'Checks whether the basic brand assets are present and consistent enough for a polished web presence.',
    placeholderLabel: 'BRAND ASSETS',
  },

  // ── Upgrade-tier tiles (paid) ────────────────────────────────────────
  'creative-pipelines':      { description: 'Acts like a content producer: drafts posts in the brand voice so the team can review faster.' },
  'company-brain':           { description: 'Acts like an organized company librarian: keeps documents, notes, and context ready for use.' },
  'knowledge-assistant':     { description: 'Acts like an internal assistant: answers team questions from approved company material.' },
  'executive-support':       { description: 'Acts like an executive assistant: prepares meeting notes, context, and follow-up drafts.' },
  'daily-operations':        { description: 'Acts like an operations coordinator: sorts routine tasks and prepares daily updates.' },
  'email-marketing':         { description: 'Acts like an email marketer: plans, writes, schedules, and improves campaigns.' },
  'ai-research':             { description: 'Acts like a research analyst: gathers customer, competitor, and market notes.' },
  'financial-tax':           { description: 'Acts like a finance assistant: organizes transactions and prepares clean reporting inputs.' },
  'compliance':              { description: 'Acts like a compliance coordinator: watches deadlines, filings, and review items.' },
  'distribution-insight':    { description: 'Acts like a distribution manager: connects publishing, search visibility, and reporting.' },
  'rapid-product':           { description: 'Acts like a product builder: turns a clear request into a useful tool or workflow.' },
  'self-improving':          { description: 'Acts like a process manager: uses feedback to improve the next run of work.' },
  'reddit-community':        { description: 'Acts like a community manager: finds useful discussions and drafts replies for review.' },
  'seo-content':             { description: 'Acts like an SEO writer: finds search opportunities and prepares content directions.' },
  'multi-agent-pipeline':    { description: 'Runs a daily specialist team that finds signals, writes the brief, checks quality, and reports back.' },
  'hyperlocal-signals':      { description: 'Collects local and social context so content can respond to what is happening now.' },
  'platform-content-gen':    { description: 'Prepares platform-specific drafts so each channel gets copy that fits the format.' },
  'brand-safety-gate':       { description: 'Reviews content before publishing, checking accuracy, brand fit, and risky wording.' },
  'founder-daily-brief':     { description: 'Packages the day into one clear brief with priorities, signals, and approved drafts.' },
  'admin-dashboard-history': { description: 'Keeps every run and brief on record so progress and past decisions are easy to review.' },
  'image-generation':        { description: 'Creates branded post images with logo, layout, and text controls before publishing.' },
  'knowledge-file-config':   { description: 'Sets up a new brand by adding its facts, voice rules, and working notes.' },
};

function getStaticCopy(cardId) {
  return CARD_STATIC_COPY[cardId] || null;
}

module.exports = { CARD_STATIC_COPY, getStaticCopy };
