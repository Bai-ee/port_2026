import HomePage from '../../HomePage.jsx';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const PAGE_URL = `${SITE_URL}/bryanballi`;

export const metadata = {
  title: 'Bryan Balli — Portfolio',
  description:
    'Portfolio, case studies, and the Bballi modular AI-assisted client intelligence platform.',
  alternates: { canonical: '/bryanballi' },
};

const personSchema = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  '@id': `${SITE_URL}#bryan-balli`,
  name: 'Bryan Balli',
  alternateName: ['Bai-ee', 'bballi'],
  url: PAGE_URL,
  image: `${SITE_URL}/img/og_meta_82628b.optimized.jpg`,
  jobTitle: 'AI Design Engineer & Creative Technologist',
  email: 'mailto:bryanballi@gmail.com',
  description:
    'Bryan Balli builds AI-assisted client dashboards, modular intake pipelines, and high-performance web experiences. Creator of the Bballi client intelligence platform.',
  knowsAbout: [
    'AI design engineering',
    'Generative engine optimization',
    'Client intelligence dashboards',
    'Next.js',
    'React',
    'GSAP animation',
    'Design systems',
    'Anthropic Claude API',
    'Firebase',
  ],
  sameAs: [
    'https://github.com/Bai-ee',
    'https://github.com/Bai-ee/port_2026',
    'https://www.linkedin.com/in/bryanballi/',
    'https://twitter.com/bai_ee',
  ],
};

const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL}#website`,
  url: PAGE_URL,
  name: 'Bryan Balli — Portfolio',
  description:
    'Portfolio, case studies, and the Bballi modular AI-assisted client intelligence platform.',
  publisher: { '@id': `${SITE_URL}#bryan-balli` },
  inLanguage: 'en-US',
};

// Testimonials surfaced on the portfolio homepage. Mirrors StackedSlidesSection's
// `testimonials` array — if that changes, update here too.
const REVIEWS = [
  { quote: 'Transforms ideas into polished, high-impact experiences. Strong across devices, highly responsive, and consistently delivers under pressure.', name: 'Melissa Hsiao', title: 'Industry Lead', company: 'TikTok', linkedinUrl: 'https://www.linkedin.com/in/melissahsiao/' },
  { quote: 'Rare ability to operate across both design and development. Pixel-perfect execution with deep technical ownership across platforms.', name: 'Jeanne Cheung', title: 'Director, Design Management', company: 'HBO Max', linkedinUrl: 'https://www.linkedin.com/in/jeannecheung/' },
  { quote: 'Brings expert-level creative and technical thinking across platforms. Pushes concepts further and executes with precision.', name: 'Eric Farias', title: 'Senior Art Director', company: 'Epsilon', linkedinUrl: 'https://www.linkedin.com/in/ericfarias/' },
  { quote: "A go-to for complex creative builds across desktop, mobile, and video. Combines technical depth with strong design instincts.", name: "Vanessa D'Amore", title: 'Sr. Product Manager (AI, SaaS, Integrations)', company: 'TST', linkedinUrl: 'https://www.linkedin.com/in/vdamore/' },
];

const reviewSchemas = REVIEWS.map((r, i) => ({
  '@context': 'https://schema.org',
  '@type': 'Review',
  '@id': `${SITE_URL}#review-${i + 1}`,
  reviewBody: r.quote,
  author: {
    '@type': 'Person',
    name: r.name,
    jobTitle: r.title,
    worksFor: { '@type': 'Organization', name: r.company },
    sameAs: [r.linkedinUrl],
  },
  itemReviewed: { '@id': `${SITE_URL}#bryan-balli` },
  reviewRating: {
    '@type': 'Rating',
    ratingValue: 5,
    bestRating: 5,
    worstRating: 1,
  },
}));

export default function BryanBalliPortfolio() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([personSchema, websiteSchema, ...reviewSchemas]),
        }}
      />
      <HomePage />
    </>
  );
}
