'use strict';

// lib/analytics.js — GA4 custom event helpers
//
// Lightweight wrapper around gtag() for type-safe, consistent event tracking.
// All events use the GA4 recommended event format.
//
// Usage:
//   import { trackEvent, events } from '@/lib/analytics';
//   trackEvent(events.SIGN_IN, { method: 'google' });
//
// The gtag script is loaded in app/layout.jsx.
// This module is safe to import server-side — all calls are guarded.

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;

// ── Core tracker ─────────────────────────────────────────────────────────────

/**
 * Send a custom event to GA4.
 * No-ops silently if gtag is not loaded (SSR, ad blockers, missing ID).
 *
 * @param {string} eventName - GA4 event name (snake_case, max 40 chars)
 * @param {object} [params]  - Event parameters (max 25 per event)
 */
export function trackEvent(eventName, params = {}) {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag !== 'function') return;
  if (!GA_MEASUREMENT_ID) return;

  window.gtag('event', eventName, {
    ...params,
    send_to: GA_MEASUREMENT_ID,
  });
}

/**
 * Track a virtual page view (for SPA navigation).
 * Next.js App Router doesn't fire native pageviews on client nav.
 *
 * @param {string} path - The page path (e.g. '/dashboard')
 * @param {string} [title] - Page title
 */
export function trackPageView(path, title) {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag !== 'function') return;
  if (!GA_MEASUREMENT_ID) return;

  window.gtag('config', GA_MEASUREMENT_ID, {
    page_path: path,
    ...(title ? { page_title: title } : {}),
  });
}

// ── Event name constants ─────────────────────────────────────────────────────
// Centralised here so typos are caught at import time, not runtime.

export const events = {
  // Auth
  SIGN_IN: 'sign_in',
  SIGN_UP: 'sign_up',
  SIGN_OUT: 'sign_out',

  // Pipeline
  DASHBOARD_CREATED: 'dashboard_created',
  PIPELINE_RERUN: 'pipeline_rerun',
  PIPELINE_CANCELLED: 'pipeline_cancelled',

  // Intelligence
  SEO_RERUN: 'seo_rerun',

  // Dashboard interactions
  TILE_OPENED: 'tile_opened',
  THEME_CHANGED: 'theme_changed',
  TIER_MODAL_OPENED: 'tier_modal_opened',
};

// ── Convenience helpers ──────────────────────────────────────────────────────
// One-liner wrappers for the most common events.

export function trackSignIn(method) {
  trackEvent(events.SIGN_IN, { method });
}

export function trackSignUp(method) {
  trackEvent(events.SIGN_UP, { method });
}

export function trackSignOut() {
  trackEvent(events.SIGN_OUT);
}

export function trackDashboardCreated(url) {
  trackEvent(events.DASHBOARD_CREATED, { website_url: url });
}

export function trackPipelineRerun(url) {
  trackEvent(events.PIPELINE_RERUN, { website_url: url });
}

export function trackPipelineCancelled() {
  trackEvent(events.PIPELINE_CANCELLED);
}

export function trackSeoRerun(source = 'pagespeed-insights') {
  trackEvent(events.SEO_RERUN, { source });
}

export function trackTileOpened(tileId, label) {
  trackEvent(events.TILE_OPENED, { tile_id: tileId, tile_label: label });
}

export function trackThemeChanged(theme) {
  trackEvent(events.THEME_CHANGED, { theme });
}

export function trackTierModalOpened() {
  trackEvent(events.TIER_MODAL_OPENED);
}
