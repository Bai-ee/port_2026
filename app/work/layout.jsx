const itemListSchema = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Featured Work | HITLOOP',
  description:
    'Four active projects — intake pipeline, particle renderer, design system extraction, and SEO audit. Case study write-ups in progress.',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Bballi Intelligence',
      description:
        'Modular AI-assisted client intelligence platform — intake pipelines, brand snapshot extraction, multi-device layout capture, SEO + performance audits, and real-time dashboards.',
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Particle Systems',
      description:
        'High-performance interactive particle and 3D environments built with Three.js and WebGL — torus swarms, terrain generation, and holographic rendering.',
    },
    {
      '@type': 'ListItem',
      position: 3,
      name: 'System Build',
      description:
        'Token-based design system extracted from an existing brand — typography scale, color palette, spacing system, and a React component library built on top.',
    },
    {
      '@type': 'ListItem',
      position: 4,
      name: 'Search Intelligence',
      description:
        'AI-assisted SEO and generative engine optimization audit — Lighthouse baseline, structured data implementation, GEO citation readiness, and content gap analysis.',
    },
  ],
};

export const metadata = {
  title: 'Featured Work',
  description:
    'Four active projects — intake pipeline, particle renderer, design system extraction, and SEO audit. Case study write-ups in progress.',
  keywords: [
    'HITLOOP portfolio',
    'AI design engineer work',
    'Three.js projects',
    'design systems',
    'SEO audit',
    'client intelligence dashboard',
  ],
  alternates: { canonical: '/work' },
  openGraph: {
    title: 'Featured Work | HITLOOP',
    description:
      'AI platforms, Three.js experiences, design systems, and SEO intelligence — selected work.',
    url: '/work',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function WorkLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
      />
      {children}
    </>
  );
}
