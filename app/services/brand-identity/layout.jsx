const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Brand Identity',
  description:
    'Design system extraction, brand snapshot analysis, and visual identity work — translating brand direction into production-ready systems.',
  provider: {
    '@type': 'Person',
    name: 'Bryan Balli',
    url: SITE_URL,
  },
  url: `${SITE_URL}/services/brand-identity`,
  serviceType: 'Brand Identity Design',
  areaServed: 'Worldwide',
  datePublished: '2026-04-24',
};

export const metadata = {
  title: 'Brand Identity — Design System Extraction & Visual Identity',
  description:
    'Brand snapshot analysis, design system extraction, and visual identity work. Token-based design systems, color palettes, typography scales, and competitive positioning — delivered fast.',
  keywords: [
    'brand identity design',
    'design system extraction',
    'brand snapshot',
    'visual identity',
    'Figma design system',
    'Bryan Balli branding',
    'token-based design system',
    'typography scale',
    'color palette accessibility',
  ],
  alternates: { canonical: '/services/brand-identity' },
  openGraph: {
    title: 'Brand Identity — Bryan Balli',
    description:
      'Design system extraction, brand snapshot analysis, and visual identity work — translating brand direction into production-ready systems.',
    url: '/services/brand-identity',
    type: 'website',
  },
};

export default function BrandIdentityLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
      />
      {children}
    </>
  );
}
