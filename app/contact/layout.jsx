const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const contactSchema = {
  '@context': 'https://schema.org',
  '@type': 'ContactPage',
  name: 'Contact Bryan Balli',
  description:
    'Book a 30-minute call, send a note, or start with the intake brief — whichever fits where you are right now.',
  url: `${SITE_URL}/contact`,
  mainEntity: {
    '@type': 'Person',
    name: 'Bryan Balli',
    email: 'bryanballi@gmail.com',
    url: SITE_URL,
    jobTitle: 'AI Design Engineer & Creative Technologist',
  },
};

export const metadata = {
  title: 'Contact',
  description:
    'Book a 30-minute call, send a note, or start with the intake brief — whichever fits where you are right now.',
  keywords: [
    'contact Bryan Balli',
    'hire AI design engineer',
    'book a call',
    'creative technologist contact',
    'bryanballi@gmail.com',
  ],
  alternates: { canonical: '/contact' },
  openGraph: {
    title: 'Contact · Bryan Balli',
    description: 'Book a call, send a note, or start with the intake brief.',
    url: '/contact',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function ContactLayout({ children }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(contactSchema) }}
      />
      {children}
    </>
  );
}
