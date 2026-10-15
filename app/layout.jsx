import Script from 'next/script';
import { Doto, Space_Grotesk, Space_Mono } from 'next/font/google';
import '../colors.css';
// Theme Studio: generated --t-* tokens first, then the legacy-alias bridge, both after colors.css
// so the aliases win over any same-name fallback in colors.css (contract §8.1).
import '../styles/theme/theme.generated.css';
import '../styles/theme/bridge.css';
import { AuthProvider } from '../AuthContext';
import AnalyticsPageView from '../components/AnalyticsPageView';
import SmoothScroll from '../components/SmoothScroll';
import ThemeRuntime from '../components/theme/ThemeRuntime';
import ThemeStudioMount from '../components/theme/ThemeStudioMount';
import { getBootstrapScript } from '../lib/theme/bootstrap-source.js';
import themeRuntimeData from '../lib/theme/production/resolved.runtime.generated.js';

// Self-hosted via next/font/google — preserves the literal family names
// ("Doto" / "Space Grotesk" / "Space Mono") that every existing inline
// style and dashboardCss rule already references, so nothing downstream
// needs to change. display:swap + automatic metric-matched fallback faces
// cover FOUT/CLS; no external Google Fonts origin on the critical path.
const doto = Doto({ subsets: ['latin'], weight: ['400', '700', '900'], display: 'swap' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], weight: ['300', '400', '500', '700'], display: 'swap' });
const spaceMono = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], display: 'swap' });

const GA_ID = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID;

// Theme Studio (contract §8.1). The production default viewer preference decides what the server
// renders on <html>; 'system' renders no data-theme (the generated @media fallback covers no-JS and
// the head bootstrap sets the real value before first paint).
const THEME_DEFAULT_PREF = themeRuntimeData.defaults.viewerPreference;
const THEME_BOOTSTRAP_SCRIPT = getBootstrapScript({ defaultPreference: THEME_DEFAULT_PREF });
const THEME_SSR_ATTRS = THEME_DEFAULT_PREF === 'system'
  ? {}
  : { 'data-theme': THEME_DEFAULT_PREF, 'data-theme-pref': THEME_DEFAULT_PREF };

// colorScheme/themeColor follow the production palette. Known limitation (contract risk 13):
// themeColor follows the OS, not an explicit viewer override.
export const viewport = {
  colorScheme: THEME_DEFAULT_PREF === 'system' ? 'light dark' : THEME_DEFAULT_PREF,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: themeRuntimeData.light.tokens['--t-page'] },
    { media: '(prefers-color-scheme: dark)', color: themeRuntimeData.dark.tokens['--t-page'] },
  ],
};

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
    title: 'DESIGN & DEVELOPMENT | Human in the Loop',
    description:
      'A creative partnership led by Bryan Balli, helping founders launch products, execute marketing campaigns, and build scalable systems through strategy, design, development, and automation.',
    images: [
      {
        url: '/img/og_meta_82628s.optimized.jpg',
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
    title: 'DESIGN & DEVELOPMENT | Human in the Loop',
    description:
      'Led by Bryan Balli. Built for founders who need momentum.',
    images: [
      {
        url: '/img/og_meta_82628s.optimized.jpg',
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
    <html
      lang="en"
      className={`${doto.className} ${spaceGrotesk.className} ${spaceMono.className}`}
      suppressHydrationWarning
      {...THEME_SSR_ATTRS}
    >
      <head>
        {/* Pre-paint theme bootstrap: constant ES5 script, first child of <head> (lib/theme/bootstrap-source.js). */}
        <script id="theme-bootstrap" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body
        suppressHydrationWarning
        style={{
          margin: 0,
          fontFamily: '"Space Grotesk", system-ui, sans-serif',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          // Baseline resolves to #ffffff / #000000 (the previous UA defaults), so the look is unchanged.
          background: 'var(--t-page)',
          color: 'var(--t-text-default)',
        }}
      >
        <ThemeRuntime />
        <SmoothScroll />
        <AuthProvider>
          <AnalyticsPageView />
          <ThemeStudioMount />
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
