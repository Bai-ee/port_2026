const itemListSchema = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Case Studies · Bryan Balli',
  description:
    'Process documentation, results, and the decisions behind them — from intake through delivery.',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Client Intelligence Platform',
      description:
        'End-to-end documentation of the Bballi AI-assisted intake pipeline — from scraper architecture through dashboard delivery.',
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Three.js Interactive Experience',
      description:
        'Build log for a high-performance particle system — performance budget, WebGL constraints, GSAP integration, and mobile optimization decisions.',
    },
    {
      '@type': 'ListItem',
      position: 3,
      name: 'GEO Audit & Implementation',
      description:
        'Full case study of a generative engine optimization engagement — baseline, structured data implementation, AI Overviews appearance, and measurable citation gains.',
    },
  ],
};

export const metadata = {
  title: 'Case Studies · Bryan Balli',
  description:
    'Process documentation, results, and the decisions behind them — from intake through delivery.',
  keywords: [
    'Bryan Balli case studies',
    'AI design engineer case study',
    'GEO audit case study',
    'Three.js case study',
    'client intelligence platform',
  ],
  alternates: { canonical: '/case-studies' },
  openGraph: {
    title: 'Case Studies · Bryan Balli',
    description: 'Process documentation, results, and the decisions behind each project.',
    url: '/case-studies',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function CaseStudiesLayout({ children }) {
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
