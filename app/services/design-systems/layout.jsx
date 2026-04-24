const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Design Systems',
  description:
    'Component libraries, token architecture, and design-to-code pipelines that give teams a single source of truth and a faster path to ship.',
  provider: {
    '@type': 'Person',
    name: 'Bryan Balli',
    url: SITE_URL,
  },
  url: `${SITE_URL}/services/design-systems`,
  serviceType: 'Design Systems',
  areaServed: 'Worldwide',
};

export const metadata = {
  title: 'Design Systems — Bryan Balli · Component Libraries & Token Architecture',
  description:
    'Component libraries, token architecture, and design-to-code pipelines. React + TypeScript component systems, Figma token integration, Storybook documentation, and Radix UI primitives.',
  keywords: [
    'design system development',
    'React component library',
    'TypeScript component library',
    'Figma tokens',
    'Storybook documentation',
    'CSS custom properties',
    'Radix UI',
    'Bryan Balli design systems',
    'design-to-code pipeline',
  ],
  alternates: { canonical: '/services/design-systems' },
  openGraph: {
    title: 'Design Systems — Bryan Balli',
    description:
      'Component libraries, token architecture, and design-to-code pipelines that give teams a single source of truth and a faster path to ship.',
    url: '/services/design-systems',
    type: 'website',
  },
};

export default function DesignSystemsLayout({ children }) {
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
