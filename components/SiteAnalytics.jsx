'use client';

// SiteAnalytics.jsx — first-party visitor analytics for hitloop.agency (alongside GA4, not instead of it).
//
// Same beacon contract as the Underground Existence site (website/js/ue-analytics.js in arweave-video-generator):
// pageview / engagement / click events to /api/public/site-events -> site_analytics/hitloop/events, read through the
// owner MCP (get_site_analytics / get_site_sessions, site "hitloop"). App Router navigations are client-side, so a
// pageview is sent on every pathname change. No cookies or fingerprinting: a random visitor id in localStorage and a
// session id that expires after 30 idle minutes. Only the public site is tracked (see EXCLUDED); only runs on
// hitloop.agency unless ?site_analytics=1. ?site_analytics_test=1 flags the tab as test traffic.

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const ENDPOINT = '/api/public/site-events';
const SITE = 'hitloop';
const SESSION_IDLE_MS = 30 * 60 * 1000;
const ENGAGE_DWELL_MS = 15 * 1000;
const ENGAGE_SCROLL_RATIO = 0.5;
// The app and private surfaces, not the public site.
const EXCLUDED = /^\/(dashboard|admin|api|preview|capture|post-approval|oauth|telegram-upload|briefs|sites)(\/|$)/;

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

function randomId() {
  try {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 24);
  }
}

function enabled() {
  const h = window.location.hostname;
  if (h === 'hitloop.agency' || h === 'www.hitloop.agency') return true;
  // Elsewhere (localhost, previews) only when opted in; the opt-in lasts for the tab.
  try {
    if (/[?&]site_analytics=1\b/.test(window.location.search)) sessionStorage.setItem('hl_a_on', '1');
    return sessionStorage.getItem('hl_a_on') === '1';
  } catch { return /[?&]site_analytics=1\b/.test(window.location.search); }
}

function testMode() {
  try {
    if (/[?&]site_analytics_test=1\b/.test(window.location.search)) sessionStorage.setItem('hl_a_test', '1');
    return sessionStorage.getItem('hl_a_test') === '1';
  } catch { return /[?&]site_analytics_test=1\b/.test(window.location.search); }
}

/** Visitor + session ids; isEntry when this call started a new session. */
function ids() {
  let vid = read('hl_a_vid');
  if (!vid) { vid = randomId(); write('hl_a_vid', vid); }
  let sid = read('hl_a_sid');
  const last = Number(read('hl_a_last')) || 0;
  let isEntry = false;
  if (!sid || Date.now() - last > SESSION_IDLE_MS) { sid = randomId(); write('hl_a_sid', sid); isEntry = true; }
  write('hl_a_last', String(Date.now()));
  return { vid, sid, isEntry };
}

function send(payload) {
  const { vid, sid } = ids();
  const body = JSON.stringify({ ...payload, site: SITE, vid, sid, path: window.location.pathname, title: document.title, ...(testMode() ? { test: true } : {}) });
  try { if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return; } catch { /* fall through */ }
  try { fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }); } catch { /* give up quietly */ }
}

function labelOf(el) {
  let t = el.getAttribute('data-track') || el.getAttribute('aria-label') || el.getAttribute('title');
  if (!t) t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!t) t = el.querySelector?.('img[alt]')?.getAttribute('alt');
  return (t || el.id || el.tagName.toLowerCase()).slice(0, 120);
}

export default function SiteAnalytics() {
  const pathname = usePathname();
  const firstView = useRef(true);

  // Clicks: one capture listener for the whole app; ignored on excluded paths.
  useEffect(() => {
    if (!enabled()) return undefined;
    const onClick = (ev) => {
      try {
        if (EXCLUDED.test(window.location.pathname)) return;
        const el = ev.target?.closest?.('a[href], button, [role="button"], [data-track]');
        if (!el) return;
        let href = null;
        let kind = 'button';
        if (el.tagName === 'A') {
          const url = new URL(el.getAttribute('href'), window.location.href);
          href = url.href;
          kind = /^(mailto|tel):/.test(url.protocol) ? 'contact' : (url.hostname === window.location.hostname ? 'internal' : 'outbound');
        }
        send({ type: 'click', label: labelOf(el), href, kind });
      } catch { /* never break a click */ }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Pageview + one engagement per page (15 s on it or half of it scrolled).
  useEffect(() => {
    if (!pathname || !enabled() || EXCLUDED.test(pathname)) return undefined;
    const { isEntry } = ids();
    const params = new URLSearchParams(window.location.search);
    const utm = (k) => params.get(`utm_${k}`);
    send({
      type: 'pageview',
      entry: isEntry,
      // document.referrer stays the landing referrer across client navigations; only the first view carries it.
      ref: firstView.current ? (document.referrer || null) : null,
      utm: { source: utm('source') || params.get('ref'), medium: utm('medium'), campaign: utm('campaign') },
    });
    firstView.current = false;

    let engaged = false;
    const engage = () => { if (engaged) return; engaged = true; send({ type: 'engagement' }); };
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable > 0 && (window.scrollY || doc.scrollTop) / scrollable >= ENGAGE_SCROLL_RATIO) engage();
    };
    const timer = setTimeout(engage, ENGAGE_DWELL_MS);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener('scroll', onScroll); };
  }, [pathname]);

  return null;
}
