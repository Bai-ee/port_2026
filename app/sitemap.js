const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

const PUBLIC_ROUTES = [
  { path: '',                                   priority: 1.0, freq: 'weekly'  },
  { path: '/about',                             priority: 0.9, freq: 'monthly' },
  { path: '/work',                              priority: 0.9, freq: 'weekly'  },
  { path: '/case-studies',                      priority: 0.8, freq: 'weekly'  },
  { path: '/services/ai-design-consulting',     priority: 0.8, freq: 'monthly' },
  { path: '/services/brand-identity',           priority: 0.8, freq: 'monthly' },
  { path: '/services/design-systems',           priority: 0.8, freq: 'monthly' },
  { path: '/services/seo-geo',                  priority: 0.8, freq: 'monthly' },
  { path: '/services/web-development',          priority: 0.8, freq: 'monthly' },
  { path: '/how-it-works',                      priority: 0.7, freq: 'monthly' },
  { path: '/process',                           priority: 0.7, freq: 'monthly' },
  { path: '/gallery',                           priority: 0.7, freq: 'monthly' },
  { path: '/faq',                               priority: 0.7, freq: 'monthly' },
  { path: '/contact',                           priority: 0.6, freq: 'monthly' },
];

export default function sitemap() {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map(({ path, priority, freq }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency: freq,
    priority,
  }));
}
