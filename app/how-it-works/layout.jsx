const howToSchema = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How Bryan Balli Works',
  description:
    'From first contact to shipped product — a phased process designed to stay lean, move fast, and keep every decision reviewable.',
  step: [
    {
      '@type': 'HowToStep',
      name: 'Intake & Brief',
      text: 'A scraper runs against your site — or we start from a discovery call if you\'re pre-launch. Tone, offer clarity, audience signals, SEO baseline, and performance data are extracted and normalized into a structured brief. Delivered within 24–48 hours.',
    },
    {
      '@type': 'HowToStep',
      name: 'Scope & Prototype',
      text: 'Based on the brief, a scope is proposed: the smallest safe move that solves the highest-priority problem. You approve the scope before any code ships.',
    },
    {
      '@type': 'HowToStep',
      name: 'Build & Handoff',
      text: 'Implementation runs in explicit phases, each gated by your approval. Deliverables are reviewable at every step. You receive code, documentation, and a handoff brief.',
    },
  ],
};

export const metadata = {
  title: 'How It Works · Bryan Balli',
  description:
    'From first contact to shipped product — a phased process designed to stay lean, move fast, and keep every decision reviewable.',
  keywords: [
    'AI design engineer process',
    'phased development',
    'intake pipeline',
    'design system process',
    'Bryan Balli how it works',
  ],
  alternates: { canonical: '/how-it-works' },
  openGraph: {
    title: 'How It Works · Bryan Balli',
    description:
      'A phased process from intake brief through build and handoff — lean, fast, and fully reviewable.',
    url: '/how-it-works',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function HowItWorksLayout({ children }) {
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
