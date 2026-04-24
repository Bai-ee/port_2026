const FAQS = [
  {
    q: 'What is an AI design engineer?',
    a: 'An AI design engineer works at the intersection of software engineering, product design, and applied AI — building production-quality web experiences while integrating AI workflows directly into the design and development pipeline.',
  },
  {
    q: 'What is a creative technologist?',
    a: 'A creative technologist sits between design strategy and front-end engineering, responsible for making ideas technically real: prototyping interactions, building design systems, translating brand direction into production code, and identifying where automation or AI can compress timelines without sacrificing quality.',
  },
  {
    q: 'How does the intake process work?',
    a: 'A scraper runs against your site, extracting tone cues, offer clarity, audience signals, and performance data. That data is normalized against a brand/industry/model schema and delivered as a structured brief covering positioning, SEO baseline, and the highest-confidence next move.',
  },
  {
    q: 'What does a typical engagement look like?',
    a: 'Most engagements start with a discovery call or async intake brief. The scope is phased — Phase 1 is always the smallest safe move, and approvals gate each subsequent phase.',
  },
  {
    q: 'What is your tech stack?',
    a: 'Next.js, React, TypeScript, GSAP, Three.js, Tailwind CSS, Firebase, Vercel on the front end. Python for intake pipelines. Claude API (Anthropic) and OpenAI for intelligence layers. Playwright and Puppeteer for automated capture.',
  },
  {
    q: 'How long does a project take?',
    a: 'A scoped web build typically runs 2–6 weeks. An intake brief with a dashboard prototype can be ready in under a week. Design system extraction: 3–5 days. Timelines are explicit at the start of each phase.',
  },
  {
    q: 'What does it cost to work with you?',
    a: 'Engagements start at $3,500 for a focused scope — intake, brief, and a working prototype. Ongoing retainers for dashboard maintenance, content pipelines, and SEO monitoring are available month-to-month.',
  },
  {
    q: 'Do you work with early-stage startups?',
    a: 'Yes. The intake pipeline is particularly useful pre-launch — it surfaces positioning gaps and performance baselines before you are committed to a stack or a brand direction.',
  },
  {
    q: 'What is a client intelligence dashboard?',
    a: 'A private, real-time surface that aggregates brand snapshot, SEO baseline, Lighthouse scores, social preview state, multi-device layout capture, and AI-generated content recommendations — replacing the spreadsheet-and-email loop with a single source of truth.',
  },
  {
    q: 'How do I get started?',
    a: 'Book a 30-minute call via the Contact link. Come with a rough sense of what you are trying to fix, or let the intake brief surface what matters most.',
  },
];

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
};

export const metadata = {
  title: 'FAQ — AI Design Engineer & Creative Technologist · Bryan Balli',
  description:
    'Answers to common questions about working with Bryan Balli — an AI design engineer and creative technologist. Services, pricing, intake process, tech stack, and how to get started.',
  keywords: [
    'AI design engineer FAQ',
    'creative technologist FAQ',
    'hire AI design engineer',
    'AI-assisted web development',
    'intake pipeline explained',
    'Bryan Balli pricing',
    'Next.js GSAP Three.js developer',
    'client intelligence dashboard',
  ],
  alternates: { canonical: '/faq' },
  openGraph: {
    title: 'FAQ — Bryan Balli · AI Design Engineer',
    description:
      'What an AI design engineer does, how engagements work, what things cost, and how to get started.',
    url: '/faq',
    type: 'website',
  },
};

export default function FAQLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      {children}
    </>
  );
}
