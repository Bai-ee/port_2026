const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'The Process · Bryan Balli',
  description:
    'A phased, approval-gated process built for speed, clarity, and zero scope drift.',
  step: [
    {
      '@type': 'HowToStep',
      position: 1,
      name: 'Discovery',
      text: 'A 30-minute call or async intake run. We establish what you\'re trying to fix, what already exists, and what the smallest safe first move looks like. Output: a scoped brief and a phase proposal.',
    },
    {
      '@type': 'HowToStep',
      position: 2,
      name: 'Intake & Brief',
      text: 'If you have a live site, the intake scraper runs — extracting tone, offer clarity, audience signals, SEO baseline, and performance data. Normalized into a structured brief. Delivered within 24–48 hours.',
    },
    {
      '@type': 'HowToStep',
      position: 3,
      name: 'Build',
      text: 'Implementation in explicit phases. Phase 1 is always the smallest safe move. Each phase ships a working artifact — prototype, component, or dashboard. Your approval gates the next phase.',
    },
    {
      '@type': 'HowToStep',
      position: 4,
      name: 'Handoff',
      text: 'Code, documentation, and a handoff brief. What was built, what was intentionally left out, what to watch. No black-box handoffs.',
    },
  ],
};

export const metadata = {
  title: 'Process',
  description:
    'A phased, approval-gated process built for speed, clarity, and zero scope drift. Every step is visible. Every decision is explained.',
  keywords: [
    'Bryan Balli process',
    'AI design engineer workflow',
    'phased development process',
    'design handoff',
    'intake brief',
  ],
  alternates: { canonical: '/process' },
  openGraph: {
    title: 'Process · Bryan Balli',
    description: 'Phased, approval-gated — from discovery through handoff.',
    url: '/process',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function ProcessLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }}
      />
      {children}
    </>
  );
}
