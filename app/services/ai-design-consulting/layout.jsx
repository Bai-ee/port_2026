const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'AI Design Consulting',
  description:
    'Building AI-assisted workflows, client intelligence pipelines, and production-quality web systems — from brand intake to deployed dashboard.',
  provider: {
    '@type': 'Person',
    name: 'Bryan Balli',
    url: SITE_URL,
  },
  url: `${SITE_URL}/services/ai-design-consulting`,
  serviceType: 'AI Design Consulting',
  areaServed: 'Worldwide',
  datePublished: '2026-04-24',
};

export const metadata = {
  title: 'AI Design Consulting — AI Design Engineer',
  description:
    'AI design consulting combining software engineering, applied AI, and product design. Client intelligence pipelines, brand intake, modular workflows, and deployed dashboards.',
  keywords: [
    'AI design consulting',
    'AI design engineer',
    'client intelligence dashboard',
    'brand intake pipeline',
    'AI-assisted workflows',
    'Bryan Balli',
    'applied AI web development',
    'modular intake pipeline',
  ],
  alternates: { canonical: '/services/ai-design-consulting' },
  openGraph: {
    title: 'AI Design Consulting — Bryan Balli',
    description:
      'AI-assisted workflows, client intelligence pipelines, and production-quality web systems — from brand intake to deployed dashboard.',
    url: '/services/ai-design-consulting',
    type: 'website',
  },
};

export default function AiDesignConsultingLayout({ children }) {
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
