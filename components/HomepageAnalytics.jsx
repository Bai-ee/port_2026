'use client';

import { useEffect, useRef } from 'react';
import { useReportWebVitals } from 'next/web-vitals';
import { events, trackHomepageEvent } from '@/lib/analytics';

const SCROLL_MILESTONES = [25, 50, 75, 90, 100];

function cleanText(value, fallback = '') {
  return String(value || fallback)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function getElementLabel(element) {
  if (!element) return '';
  return cleanText(
    element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.innerText ||
      element.textContent ||
      element.id ||
      element.name ||
      element.tagName
  );
}

function getSectionId(element) {
  const section = element?.closest?.('section, header, footer, main, [id]');
  return section?.id || section?.tagName?.toLowerCase?.() || '';
}

function getHrefDetails(anchor) {
  const rawHref = anchor?.getAttribute?.('href') || '';
  if (!rawHref) return { href: '', outbound: false };

  try {
    const url = new URL(rawHref, window.location.href);
    const protocol = url.protocol.toLowerCase();
    const outbound =
      protocol === 'mailto:' ||
      protocol === 'tel:' ||
      (protocol.startsWith('http') && url.hostname !== window.location.hostname);
    return {
      href: protocol === 'mailto:' || protocol === 'tel:' ? rawHref : `${url.origin}${url.pathname}${url.search}${url.hash}`,
      outbound,
    };
  } catch {
    return { href: rawHref.slice(0, 180), outbound: false };
  }
}

function isCta(element, href = '') {
  const label = getElementLabel(element).toLowerCase();
  const id = String(element?.id || '').toLowerCase();
  const className = String(element?.className || '').toLowerCase();
  const target = `${label} ${id} ${className} ${href}`.toLowerCase();
  return (
    className.includes('cta') ||
    id.includes('cta') ||
    /calendly|mailto:|tel:|contact|book|meet|onboard|get dashboard|create dashboard|login/.test(target)
  );
}

function classifyClick(target) {
  const anchor = target.closest?.('a[href]');
  const button = target.closest?.('button, [role="button"]');
  const portfolioItem = target.closest?.('[data-capability-card], [data-peek-card], [data-stack-panel], [data-gallery-item], [data-portfolio-item]');
  const element = anchor || button || portfolioItem;
  if (!element) return null;

  const { href, outbound } = getHrefDetails(anchor);
  const base = {
    element_id: element.id || '',
    element_text: getElementLabel(element),
    element_tag: element.tagName?.toLowerCase?.() || '',
    section: getSectionId(element),
    link_url: href,
    outbound,
  };

  if (isCta(element, href)) {
    return { eventName: events.HOMEPAGE_CTA_CLICK, params: { ...base, interaction_type: 'cta' }, mirrorOutbound: outbound };
  }

  if (portfolioItem && !target.closest?.('input, textarea, select')) {
    return { eventName: events.HOMEPAGE_PORTFOLIO_CLICK, params: { ...base, interaction_type: 'portfolio' }, mirrorOutbound: outbound };
  }

  if (anchor && outbound) {
    return { eventName: events.HOMEPAGE_OUTBOUND_CLICK, params: { ...base, interaction_type: 'outbound' }, mirrorOutbound: false };
  }

  if (anchor) {
    return { eventName: events.HOMEPAGE_NAV_CLICK, params: { ...base, interaction_type: 'nav' }, mirrorOutbound: false };
  }

  return { eventName: events.HOMEPAGE_BUTTON_CLICK, params: { ...base, interaction_type: 'button' }, mirrorOutbound: false };
}

function fieldParams(field) {
  return {
    field_id: field.id || '',
    field_name: field.name || '',
    field_type: field.type || field.tagName?.toLowerCase?.() || '',
    field_label: cleanText(field.getAttribute('aria-label') || field.placeholder || field.name || field.id || 'field'),
    section: getSectionId(field),
    interaction_type: 'form',
  };
}

export default function HomepageAnalytics() {
  const focusedFieldsRef = useRef(new Set());
  const changedFieldsRef = useRef(new Set());
  const scrollMilestonesRef = useRef(new Set());
  const tickingRef = useRef(false);

  useReportWebVitals((metric) => {
    trackHomepageEvent(events.HOMEPAGE_WEB_VITAL, {
      interaction_type: 'performance',
      metric_name: metric.name,
      metric_value: Math.round(Number(metric.value || 0)),
      metric_rating: metric.rating || '',
      metric_id: metric.id || '',
    });
  });

  useEffect(() => {
    const handleClick = (event) => {
      const classified = classifyClick(event.target);
      if (!classified) return;
      trackHomepageEvent(classified.eventName, classified.params);

      if (classified.mirrorOutbound) {
        trackHomepageEvent(events.HOMEPAGE_OUTBOUND_CLICK, {
          ...classified.params,
          interaction_type: 'outbound',
          source_event: classified.eventName,
        });
      }
    };

    const handleFocus = (event) => {
      const field = event.target?.closest?.('input, textarea, select');
      if (!field) return;
      const key = field.id || field.name || field.placeholder || field.type || field.tagName;
      if (focusedFieldsRef.current.has(key)) return;
      focusedFieldsRef.current.add(key);
      trackHomepageEvent(events.HOMEPAGE_FORM_FOCUS, fieldParams(field));
    };

    const handleChange = (event) => {
      const field = event.target?.closest?.('input, textarea, select');
      if (!field) return;
      const key = `${field.id || field.name || field.placeholder || field.type || field.tagName}:change`;
      if (changedFieldsRef.current.has(key)) return;
      changedFieldsRef.current.add(key);
      trackHomepageEvent(events.HOMEPAGE_FORM_CHANGE, fieldParams(field));
    };

    const checkScrollDepth = () => {
      tickingRef.current = false;
      const doc = document.documentElement;
      const maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
      const depth = Math.min(100, Math.round((window.scrollY / maxScroll) * 100));
      const nextMilestone = SCROLL_MILESTONES.find((milestone) => depth >= milestone && !scrollMilestonesRef.current.has(milestone));
      if (!nextMilestone) return;
      scrollMilestonesRef.current.add(nextMilestone);
      trackHomepageEvent(events.HOMEPAGE_SCROLL_DEPTH, {
        interaction_type: 'scroll',
        scroll_depth: nextMilestone,
      });
    };

    const handleScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      requestAnimationFrame(checkScrollDepth);
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('focusin', handleFocus, true);
    document.addEventListener('change', handleChange, true);
    window.addEventListener('scroll', handleScroll, { passive: true });
    checkScrollDepth();

    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('focusin', handleFocus, true);
      document.removeEventListener('change', handleChange, true);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return null;
}
