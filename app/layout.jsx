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
    default: 'Bryan Balli — AI Design Engineer & Creative Technologist Portfolio',
    template: '%s · Bryan Balli',
  },
  description:
    'Bryan Balli is an AI design engineer and creative technologist building AI-assisted client dashboards, modular intake pipelines, and high-performance web experiences. Portfolio, case studies, and the Bballi client intelligence platform.',
  keywords: [
    'Bryan Balli',
    'AI design engineer',
    'creative technologist',
    'AI consultant',
    'client dashboard',
    'design system extraction',
    'AI-assisted SEO',
    'generative engine optimization',
    'Next.js portfolio',
    'GSAP animation',
  ],
  authors: [{ name: 'Bryan Balli', url: SITE_URL }],
  creator: 'Bryan Balli',
  publisher: 'Bryan Balli',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'Bryan Balli — Portfolio',
    title: 'Bryan Balli — AI Design Engineer & Creative Technologist',
    description:
      'Portfolio, case studies, and a modular AI-assisted client intelligence platform by Bryan Balli — multi-device layout capture, social preview check, brand snapshot extraction, and SEO + performance audit in one dashboard.',
    images: [
      {
        url: '/img/og_meta.png',
        width: 2390,
        height: 1254,
        alt: 'Bryan Balli — AI design engineer and creative technologist portfolio share card',
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@bai_ee',
    creator: '@bai_ee',
    title: 'Bryan Balli — AI Design Engineer & Creative Technologist',
    description:
      'Portfolio, case studies, and a modular AI-assisted client intelligence platform — multi-device capture, social preview, brand snapshot, SEO + performance in one dashboard.',
    images: [
      {
        url: '/img/og_meta.png',
        alt: 'Bryan Balli — AI design engineer and creative technologist portfolio share card',
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
    // Brand signature mark as favicon — same art used in the header logo.
    icon: [
      { url: '/img/sig.png', type: 'image/png', sizes: '276x208' },
    ],
    shortcut: [{ url: '/img/sig.png', type: 'image/png' }],
    apple: [{ url: '/img/sig.png', type: 'image/png' }],
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
