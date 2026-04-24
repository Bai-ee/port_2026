const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const creativeWorkSchema = {
  '@context': 'https://schema.org',
  '@type': 'ImageGallery',
  name: 'Gallery · Bryan Balli',
  description:
    'Visual samples across web, motion, brand, and interactive — a surface-level view of the work before the case studies are ready.',
  url: `${SITE_URL}/gallery`,
  author: {
    '@type': 'Person',
    name: 'Bryan Balli',
    url: SITE_URL,
  },
  about: [
    { '@type': 'CreativeWork', name: 'Web & Interactive', description: 'Three.js and WebGL interactive experiences' },
    { '@type': 'CreativeWork', name: 'Dashboard & Platform', description: 'AI-assisted client intelligence dashboards' },
    { '@type': 'CreativeWork', name: 'Brand & Identity', description: 'Design system extractions and visual identity work' },
    { '@type': 'CreativeWork', name: 'Animation & Motion', description: 'GSAP-powered scroll experiences and motion design' },
  ],
};

export const metadata = {
  title: 'Gallery · Bryan Balli',
  description:
    'Visual samples across web, motion, brand, and interactive — a surface-level view of the work before the case studies are ready.',
  keywords: [
    'Bryan Balli gallery',
    'design portfolio',
    'Three.js visuals',
    'web design samples',
    'motion design',
    'brand identity',
  ],
  alternates: { canonical: '/gallery' },
  openGraph: {
    title: 'Gallery · Bryan Balli',
    description: 'Web, motion, brand, and interactive — visual samples from the portfolio.',
    url: '/gallery',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function GalleryLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(creativeWorkSchema) }}
      />
      {children}
    </>
  );
}
