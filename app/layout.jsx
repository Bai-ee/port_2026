import Script from 'next/script';
import '../colors.css';
import { AuthProvider } from '../AuthContext';
import AnalyticsPageView from '../components/AnalyticsPageView';

const GA_ID = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : 'https://hitloop.agency');

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'HIT Agency — AI Design & Engineering Studio',
    template: '%s · HIT Agency',
  },
  description:
    'HIT Agency (Human in the Loop) is an AI-powered design and engineering studio led by Bryan Balli. We build AI-assisted client dashboards, intelligent intake pipelines, and high-performance web experiences for founders and growth brands.',
  keywords: [
    'HIT Agency',
    'Human in the Loop Agency',
    'hitloop.agency',
    'Bryan Balli',
    'AI design engineer',
    'creative technologist',
    'AI consultant',
    'client dashboard',
    'design system extraction',
    'AI-assisted SEO',
    'generative engine optimization',
    'Next.js',
    'GSAP animation',
  ],
  authors: [{ name: 'Bryan Balli', url: SITE_URL }],
  creator: 'HIT Agency',
  publisher: 'HIT Agency',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'HIT Agency',
    title: 'HIT Agency — AI Design & Engineering Studio',
    description:
      'HIT Agency (Human in the Loop) is an AI-powered design and engineering studio led by Bryan Balli. We build AI-assisted client dashboards, intelligent intake pipelines, and high-performance web experiences for founders and growth brands.',
    images: [
      {
        url: '/img/og_meta.optimized.jpg',
        width: 1200,
        height: 630,
        alt: 'HIT Agency — AI-powered design and engineering studio led by Bryan Balli',
        type: 'image/jpeg',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@bai_ee',
    creator: '@bai_ee',
    title: 'HIT Agency — AI Design & Engineering Studio',
    description:
      'HIT Agency (Human in the Loop) is an AI-powered design and engineering studio led by Bryan Balli. We build AI-assisted client dashboards, intelligent intake pipelines, and high-performance web experiences.',
    images: [
      {
        url: '/img/og_meta.optimized.jpg',
        alt: 'HIT Agency — AI-powered design and engineering studio led by Bryan Balli',
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
  icons: {
    // Profile avatar as favicon — circular-masked version of the "Meet with Human" CTA art.
    icon: [
      { url: '/img/profile2_circle.png', type: 'image/png', sizes: '509x509' },
    ],
    shortcut: [{ url: '/img/profile2_circle.png', type: 'image/png' }],
    apple: [{ url: '/img/profile2_circle.png', type: 'image/png' }],
  },
  category: 'technology',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        suppressHydrationWarning
        style={{
          margin: 0,
          fontFamily: '"Space Grotesk", system-ui, sans-serif',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        }}
      >
        <AuthProvider>
          <AnalyticsPageView />
          {children}
        </AuthProvider>
        {GA_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_ID}', {
                  page_path: window.location.pathname,
                  send_page_view: true
                });
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
