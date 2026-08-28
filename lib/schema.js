// Shared JSON-LD schema builders for SEO/AEO.
// Keep entity facts (name, sameAs, pricing) in sync with app/layout.jsx metadata
// and app/page.jsx. Consumed by route layouts and the homepage.

export function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : 'https://hitloop.agency')
  );
}

// Standalone Organization — the primary entity signal AI crawlers use to
// disambiguate the brand from the Person (#bryan-balli).
export function organizationSchema(siteUrl = getSiteUrl()) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}#organization`,
    name: 'HITLOOP',
    alternateName: 'Human in the Loop',
    url: siteUrl,
    logo: `${siteUrl}/img/profile2_circle.png`,
    image: `${siteUrl}/img/og_meta_82628v.optimized.jpg`,
    description:
      'HITLOOP is a Human in the Loop creative partnership led by Bryan Balli, combining strategy, design, development, and automation to help founders launch products, grow their brand, and scale execution.',
    founder: { '@id': `${siteUrl}#bryan-balli` },
    sameAs: [
      'https://github.com/Bai-ee',
      'https://www.linkedin.com/in/bryanballi/',
      'https://twitter.com/bai_ee',
    ],
  };
}

// WebApplication — signals the client intelligence dashboard as a software
// product so AI crawlers can surface it in "best tool for X" contexts.
export function webApplicationSchema(siteUrl = getSiteUrl()) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${siteUrl}#client-intelligence-dashboard`,
    name: 'HITLOOP Client Intelligence Dashboard',
    url: siteUrl,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description:
      'AI-assisted client intelligence platform — modular intake pipelines, brand snapshot extraction, multi-device layout capture, SEO and performance audits, and real-time dashboards.',
    provider: { '@id': `${siteUrl}#organization` },
    offers: {
      '@type': 'Offer',
      price: '5',
      priceCurrency: 'USD',
      description: 'Pay-per-run Creative Brief',
    },
  };
}

// BreadcrumbList — items: [{ name, path }]. Paths are joined to siteUrl.
export function breadcrumbSchema(items, siteUrl = getSiteUrl()) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${siteUrl}${it.path}`,
    })),
  };
}
