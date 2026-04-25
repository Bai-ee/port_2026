const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Web Development',
  description:
    'High-performance web builds using Next.js, React, GSAP, and Three.js — shipped with design precision and production-grade engineering.',
  provider: {
    '@type': 'Person',
    name: 'Bryan Balli',
    url: SITE_URL,
  },
  url: `${SITE_URL}/services/web-development`,
  serviceType: 'Web Development',
  areaServed: 'Worldwide',
  datePublished: '2026-04-24',
};

export const metadata = {
  title: 'Web Development — Next.js, GSAP & Three.js',
  description:
    'High-performance web builds using Next.js, React, GSAP, and Three.js. Marketing sites, dashboards, design systems, animated landing pages, and data-driven applications.',
  keywords: [
    'Next.js web development',
    'React developer',
    'GSAP animation',
    'Three.js developer',
    'web development Bryan Balli',
    'Tailwind CSS',
    'Firebase',
    'Vercel deployment',
    'TypeScript developer',
  ],
  alternates: { canonical: '/services/web-development' },
  openGraph: {
    title: 'Web Development — Bryan Balli',
    description:
      'High-performance web builds using Next.js, React, GSAP, and Three.js — shipped with design precision and production-grade engineering.',
    url: '/services/web-development',
    type: 'website',
  },
};

export default function WebDevelopmentLayout({ children }) {
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
