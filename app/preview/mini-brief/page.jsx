'use client';

import { useState, useMemo } from 'react';
import { renderMiniBriefHtml } from '../../../features/scout-intake/mini-brief-renderer.mjs';
import { socialPreviewAdapter } from '../../../features/scout-intake/mini-briefs/social-preview-adapter.mjs';

// ── Mock fixtures — one per section-type combination both adapters will emit ──

const FIXTURES = [
  {
    id: 'design-eval-full',
    label: 'Design Eval — Full',
    args: {
      eyebrow: 'Design Evaluation',
      title: 'Visual Identity',
      subtitle: 'Token verification, readiness verdict, and design findings for example.com',
      status: 'ready',
      sections: [
        {
          type: 'readiness',
          label: 'READY',
          verdict: 'ready',
          title: 'Design system is production-ready',
          description: 'Primary tokens confirmed across 4 surfaces. No critical contradictions detected.',
        },
        {
          type: 'verification-list',
          eyebrow: 'Token Verification',
          title: 'Style guide tokens vs. live site',
          confirmed: [
            'Primary brand color #116dff applied to CTAs',
            'Space Grotesk used for all body copy',
            'Border radius 16px on card components',
            '8px base spacing grid observed in layout',
          ],
          contradicted: [
            'Secondary font Doto not present in live rendering',
            'Card background uses #ffffff instead of rgba(255,255,255,0.5)',
          ],
        },
        {
          type: 'finding-list',
          eyebrow: 'Findings',
          title: 'Issues by severity',
          items: [
            { severity: 'high',   text: 'Color contrast ratio 2.8:1 on body text — WCAG AA requires 4.5:1.', detail: 'Affects approximately 60% of page body copy.' },
            { severity: 'high',   text: 'Interactive elements lack visible focus ring on keyboard navigation.' },
            { severity: 'medium', text: 'Hero image missing descriptive alt text.', detail: 'img#hero-banner has alt="".' },
            { severity: 'medium', text: 'CTA button hover state not visually distinct from default state.' },
            { severity: 'low',    text: 'Inconsistent border-radius: 12px used in 3 components, 16px in 5 others.' },
            { severity: 'info',   text: 'Motion/animation not defined in style guide — no animation tokens present.' },
          ],
        },
        {
          type: 'stat-rows',
          eyebrow: 'Design Metadata',
          title: 'Style guide summary',
          rows: [
            { k: 'Colors',       v: '6 swatches defined — 1 primary, 2 neutral, 3 accent' },
            { k: 'Typography',   v: 'Space Grotesk (body) · Doto (display) · Space Mono (mono)' },
            { k: 'Spacing',      v: '8px base grid — 8, 16, 24, 32, 48, 64, 80' },
            { k: 'Border Radius',v: '16px cards · 999px pills · 10px inputs' },
            { k: 'Breakpoints',  v: '480px · 640px · 800px · 900px · 1100px' },
          ],
        },
      ],
    },
  },

  {
    id: 'design-eval-empty',
    label: 'Design Eval — Empty',
    args: {
      eyebrow: 'Design Evaluation',
      title: 'Visual Identity',
      subtitle: 'Token verification and design findings',
      status: 'empty',
      sections: [],
    },
  },

  {
    id: 'seo-full',
    label: 'SEO Performance — Full',
    args: {
      eyebrow: 'SEO Performance',
      title: 'Search & Visibility',
      subtitle: 'Core Web Vitals, meta coverage, AI visibility, and top opportunities for example.com',
      status: 'ready',
      sections: [
        {
          type: 'score-block',
          eyebrow: 'PageSpeed Insights',
          scores: [
            { label: 'Performance',   value: 74, status: 'warn' },
            { label: 'Accessibility', value: 91, status: 'ok'   },
            { label: 'Best Practices',value: 83, status: 'ok'   },
            { label: 'SEO',           value: 62, status: 'warn' },
          ],
        },
        {
          type: 'bars',
          eyebrow: 'Core Web Vitals',
          title: 'Field data — mobile (lower is better, bars show budget consumed)',
          items: [
            { name: 'LCP',  value: 2.4, max: 4.0,  unit: 's' },
            { name: 'INP',  value: 148, max: 500,  unit: 'ms' },
            { name: 'CLS',  value: 0.08, max: 0.25, unit: '' },
            { name: 'FCP',  value: 1.2, max: 3.0,  unit: 's' },
            { name: 'TTFB', value: 380, max: 800,  unit: 'ms' },
          ],
        },
        {
          type: 'metric-grid',
          eyebrow: 'Meta Coverage',
          title: 'On-page metadata audit',
          items: [
            { k: 'Title tag',        v: 'Present · 58 chars' },
            { k: 'Meta description', v: 'Present · 142 chars' },
            { k: 'OG image',         v: 'Present · 1200×630' },
            { k: 'Canonical',        v: 'Set correctly' },
            { k: 'Robots',           v: 'index, follow' },
            { k: 'H1 count',         v: '1 (correct)' },
            { k: 'Structured data',  v: 'WebSite + Organization' },
            { k: 'Hreflang',         v: 'Not set' },
            { k: 'Sitemap',          v: '/sitemap.xml · 24 URLs' },
          ],
        },
        {
          type: 'prose',
          eyebrow: 'AI Visibility',
          title: 'LLM citation readiness',
          body: 'Site is cited in 3 of 10 AI overview queries tested. Brand name appears in ChatGPT web search results. Perplexity returns the homepage for 2 branded queries.',
        },
        {
          type: 'finding-list',
          eyebrow: 'Top Opportunities',
          title: 'Highest-impact fixes',
          items: [
            { severity: 'high',   text: 'Images not served in next-gen formats (WebP/AVIF).', detail: 'Estimated savings: 480 KiB — largest LCP improvement available.' },
            { severity: 'high',   text: 'Render-blocking resources delay FCP by ~680ms.', detail: '3 synchronous script tags in <head>.' },
            { severity: 'medium', text: 'Missing FAQ schema on /faq — AI overviews would benefit from structured Q&A markup.' },
            { severity: 'medium', text: '14 internal links use generic anchor text ("click here", "read more").' },
            { severity: 'low',    text: 'Title tags on 6 blog posts exceed 60 chars and will truncate in SERPs.' },
            { severity: 'info',   text: 'No hreflang tags — add if targeting multiple locales.' },
          ],
        },
      ],
    },
  },

  {
    id: 'seo-partial',
    label: 'SEO — Partial (no PSI)',
    args: {
      eyebrow: 'SEO Performance',
      title: 'Search & Visibility',
      subtitle: 'PageSpeed data unavailable — showing available audit results only',
      status: 'partial',
      statusMessage: 'PageSpeed Insights did not return data for this run. Core Web Vitals and score tiles are unavailable.',
      sections: [
        {
          type: 'metric-grid',
          eyebrow: 'Meta Coverage',
          title: 'On-page metadata audit',
          items: [
            { k: 'Title tag',        v: 'Present · 52 chars' },
            { k: 'Meta description', v: 'Missing' },
            { k: 'OG image',         v: 'Missing' },
            { k: 'Canonical',        v: 'Not set' },
            { k: 'H1 count',         v: '3 (too many)' },
            { k: 'Structured data',  v: 'None detected' },
          ],
        },
        {
          type: 'finding-list',
          eyebrow: 'SEO Findings',
          title: 'Issues from crawler data',
          items: [
            { severity: 'high',   text: 'Meta description missing on all pages — click-through rate will suffer in SERPs.' },
            { severity: 'high',   text: 'Multiple H1 tags on homepage (3 detected) — confuses crawlers and dilutes signal.' },
            { severity: 'medium', text: 'OG image not set — social shares will display a blank preview card.' },
            { severity: 'low',    text: 'Canonical tag absent — may cause duplicate content issues on paginated routes.' },
          ],
        },
      ],
    },
  },

  {
    id: 'social-preview-full',
    label: 'Social Preview — Full',
    args: socialPreviewAdapter({
      siteName: 'example.com',
      siteMeta: {
        title: 'Example — Digital Products & Design',
        description: 'We build fast, accessible web products for founders and growth teams. Strategy, design, and engineering under one roof.',
        siteName: 'Example',
        ogImage: 'https://example.com/og_meta.png',
        ogImageAlt: 'Example brand share image',
        type: 'website',
        locale: 'en_US',
        themeColor: '#116dff',
        favicon: '/favicon.ico',
        appleTouchIcon: '/apple-touch-icon.png',
        canonical: 'https://example.com/',
      },
    }),
  },

  {
    id: 'social-preview-partial',
    label: 'Social Preview — Partial',
    args: socialPreviewAdapter({
      siteName: 'broken.io',
      siteMeta: {
        title: 'Broken Site',
        description: null,
        ogImage: null,
        canonical: null,
        themeColor: null,
        favicon: '/favicon.ico',
        appleTouchIcon: null,
      },
    }),
  },
];

// ── Preview route ─────────────────────────────────────────────────────────────

export default function MiniBriefPreviewPage() {
  const [activeId, setActiveId] = useState(FIXTURES[0].id);
  const fixture = FIXTURES.find((f) => f.id === activeId) ?? FIXTURES[0];

  const srcDoc = useMemo(() => renderMiniBriefHtml(fixture.args), [fixture]);

  return (
    <div id="mini-brief-preview-root">
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        #mini-brief-preview-root {
          display: flex; flex-direction: column;
          min-height: 100dvh; background: #1a1614;
        }
        #mini-brief-preview-toolbar {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          padding: 10px 16px;
          background: #110f0e;
          border-bottom: 1px solid rgba(245,241,223,0.14);
          flex-shrink: 0;
        }
        #mini-brief-preview-label {
          font-family: "Space Mono", ui-monospace, monospace;
          font-size: 10px; letter-spacing: .15em; text-transform: uppercase;
          color: rgba(245,241,223,0.4); margin-right: 6px; white-space: nowrap;
        }
        .mbp-fixture-btn {
          font-family: "Space Mono", ui-monospace, monospace;
          font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
          padding: 5px 12px; border-radius: 999px; cursor: pointer;
          border: 1px solid rgba(245,241,223,0.2);
          background: transparent; color: rgba(245,241,223,0.5);
          transition: background 0.12s, color 0.12s, border-color 0.12s;
          white-space: nowrap;
        }
        .mbp-fixture-btn:hover { color: rgba(245,241,223,0.85); border-color: rgba(245,241,223,0.4); }
        .mbp-fixture-btn.active {
          background: rgba(245,241,223,0.12); color: #f5f1df;
          border-color: rgba(245,241,223,0.5);
        }
        #mini-brief-preview-frame {
          flex: 1; width: 100%; border: none; min-height: 0;
          display: block;
        }
      `}</style>

      <div id="mini-brief-preview-toolbar">
        <span id="mini-brief-preview-label">Mini-Brief Preview</span>
        {FIXTURES.map((f) => (
          <button
            key={f.id}
            className={`mbp-fixture-btn${activeId === f.id ? ' active' : ''}`}
            onClick={() => setActiveId(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <iframe
        id="mini-brief-preview-frame"
        title="Mini-brief preview"
        srcDoc={srcDoc}
        sandbox="allow-same-origin"
      />
    </div>
  );
}
