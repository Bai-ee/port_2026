const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const personSchema = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Bryan Balli',
  url: SITE_URL,
  jobTitle: 'AI Design Engineer & Creative Technologist',
  description:
    'Creative technologist with a decade of experience spanning design strategy and front-end engineering — building AI-assisted systems for founders, agencies, and growing teams.',
  knowsAbout: [
    'AI design engineering',
    'design systems',
    'Next.js',
    'Three.js',
    'GSAP',
    'SEO',
    'GEO',
    'Firebase',
  ],
  worksFor: [
    { '@type': 'Organization', name: 'Publicis' },
    { '@type': 'Organization', name: 'Epsilon' },
    { '@type': 'Organization', name: 'Conversant' },
    { '@type': 'Organization', name: 'Alliance Data' },
  ],
  address: { '@type': 'PostalAddress', addressLocality: 'Chicago', addressRegion: 'IL' },
};

export const metadata = {
  title: 'About',
  description:
    'Creative technologist with a decade of experience spanning design strategy and front-end engineering — building AI-assisted systems for founders, agencies, and growing teams.',
  keywords: [
    'Bryan Balli',
    'AI design engineer',
    'creative technologist',
    'design systems',
    'front-end engineering',
    'Chicago',
  ],
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About · Bryan Balli',
    description:
      'Creative technologist with a decade of experience spanning design strategy and front-end engineering.',
    url: '/about',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function AboutLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
      />
      {children}
    </>
  );
}
