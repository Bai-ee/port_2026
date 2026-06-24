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
    default: 'HITLOOP | Human in the Loop',
    template: '%s | HITLOOP',
  },
  description:
    'HITLOOP is a Human in the Loop creative partnership led by Bryan Balli, combining strategy, design, development, and automation to help founders launch products, grow their brand, and scale execution. Human judgment where it matters. Automation where it helps.',
  keywords: [
    'HITLOOP',
    'Human in the Loop',
    'hitloop.agency',
    'Bryan Balli',
    'creative partnership',
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
  creator: 'HITLOOP',
  publisher: 'HITLOOP',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'HITLOOP',
    title: 'HITLOOP | Human in the Loop',
    description:
      'A creative partnership led by Bryan Balli, helping founders launch products, execute marketing campaigns, and build scalable systems through strategy, design, development, and automation.',
    images: [
      {
        url: '/img/og_meta.optimized.jpg',
        width: 1200,
        height: 630,
        alt: 'HITLOOP — Human in the Loop creative partnership led by Bryan Balli',
        type: 'image/jpeg',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@bai_ee',
    creator: '@bai_ee',
    title: 'HITLOOP | Human in the Loop',
    description:
      'Led by Bryan Balli. Built for founders who need momentum.',
    images: [
      {
        url: '/img/og_meta.optimized.jpg',
        alt: 'HITLOOP — Human in the Loop creative partnership led by Bryan Balli',
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
        {/* Non-render-blocking font load: preload the CSS, attach it as
            media="print" (so it doesn't block first paint), then flip to
            media="all" once loaded. display=swap covers FOIT. Literal font
            family names are preserved, so all existing styles keep working.
            <noscript> guarantees fonts for JS-disabled clients. */}
        <link
          rel="preload"
          as="style"
          href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap"
        />
        <link
          id="gfont-css"
          rel="stylesheet"
          media="print"
          href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap"
          // The inline script below flips media print→all before hydration, so the
          // client DOM intentionally differs from the SSR'd attribute. Suppress the
          // expected hydration mismatch (fonts still load correctly).
          suppressHydrationWarning
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var l=document.getElementById('gfont-css');if(!l)return;if(l.sheet){l.media='all';}else{l.addEventListener('load',function(){l.media='all';});}})();",
          }}
        />
        <noscript>
          {/* eslint-disable-next-line @next/next/no-page-custom-font */}
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap"
          />
        </noscript>
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
