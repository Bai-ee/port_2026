const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'SEO & GEO',
  description:
    'AI-assisted SEO audits, generative engine optimization, and performance baselines — built for visibility in both traditional search and AI-powered answers.',
  provider: {
    '@type': 'Person',
    name: 'Bryan Balli',
    url: SITE_URL,
  },
  url: `${SITE_URL}/services/seo-geo`,
  serviceType: 'SEO & Generative Engine Optimization',
  areaServed: 'Worldwide',
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Generative Engine Optimization (GEO)?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Generative Engine Optimization (GEO) is the practice of optimizing web content to be cited and surfaced by AI-powered answer engines such as ChatGPT, Perplexity, Google AI Overviews, and Bing Copilot. It involves structured answers, schema markup, first-party data signals, and topical authority — all optimized for AI citation rather than traditional blue-link rankings.',
      },
    },
    {
      '@type': 'Question',
      name: 'What does an SEO audit cover?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'An SEO audit covers crawlability, indexability, Core Web Vitals (LCP, CLS, TTFB, INP), structured data validity, on-page signals, internal linking structure, keyword coverage gaps, and E-E-A-T scoring. Findings are delivered as a prioritized action list with before/after benchmarks.',
      },
    },
    {
      '@type': 'Question',
      name: 'What Core Web Vitals are tracked?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), Time to First Byte (TTFB), and Interaction to Next Paint (INP) are tracked against both lab data (Lighthouse) and field data (CrUX). Fixes are prioritized by actual user-facing impact.',
      },
    },
    {
      '@type': 'Question',
      name: 'How is a GEO citation readiness score determined?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'The GEO citation readiness score evaluates structured data completeness, content answer density, topical authority signals, FAQ schema coverage, and first-party data presence — all factors that influence whether AI answer engines choose to cite your content.',
      },
    },
  ],
};

export const metadata = {
  title: 'SEO & GEO — Bryan Balli · AI-Assisted SEO & Generative Engine Optimization',
  description:
    'AI-assisted SEO audits, Core Web Vitals analysis, and generative engine optimization (GEO) for visibility in ChatGPT, Perplexity, Google AI Overviews, and traditional search.',
  keywords: [
    'SEO audit',
    'generative engine optimization',
    'GEO',
    'Core Web Vitals',
    'AI Overviews optimization',
    'ChatGPT citation optimization',
    'Perplexity SEO',
    'Bryan Balli SEO',
    'Lighthouse audit',
    'structured data JSON-LD',
    'E-E-A-T',
  ],
  alternates: { canonical: '/services/seo-geo' },
  openGraph: {
    title: 'SEO & GEO — Bryan Balli',
    description:
      'AI-assisted SEO audits, generative engine optimization, and performance baselines — built for visibility in both traditional search and AI-powered answers.',
    url: '/services/seo-geo',
    type: 'website',
  },
};

export default function SeoGeoLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      {children}
    </>
  );
}
