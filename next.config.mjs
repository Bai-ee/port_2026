import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['playwright', 'pdf-parse', 'mammoth', 'firebase-admin'],
  outputFileTracingIncludes: {
    '*': [
      // App logic loaded at runtime via createRequire() from outside the app/ tree.
      // The tracer does not follow these external CJS/JS modules, so include them explicitly.
      './api/**/*',
      './features/**/*',
      './onboarding/**/*',
      // firebase-admin deps with conditional `exports` maps that the tracer
      // only records package.json for -> "Cannot find module" at runtime.
      './node_modules/jose/**/*',
      './node_modules/uuid/**/*',
      './node_modules/gaxios/node_modules/uuid/**/*',
      './node_modules/teeny-request/node_modules/uuid/**/*',
      './node_modules/google-gax/node_modules/uuid/**/*',
      // Next runtime (Turbopack keeps these external to the route bundle).
      './node_modules/next/dist/client/**/*.js',
      './node_modules/next/dist/build/**/*.js',
      './node_modules/next/dist/lib/**/*.js',
      './node_modules/next/dist/server/**/*.js',
      './node_modules/next/dist/shared/lib/**/*.js',
      './node_modules/next/dist/compiled/**/*',
      './node_modules/@swc/helpers/**/*',
      './node_modules/react/**/*',
      './node_modules/react-dom/**/*',
      './node_modules/scheduler/**/*',
    ],
  },
  outputFileTracingExcludes: {
    '*': [
      // Type defs and source maps are never loaded at runtime — trim from bundles.
      './node_modules/**/*.d.ts',
      './node_modules/**/*.d.mts',
      './node_modules/**/*.d.cts',
      './node_modules/**/*.js.map',
      './node_modules/**/*.mjs.map',
      './node_modules/**/*.cjs.map',
      './.claude/**/*',
      './.venv/**/*',
      './dist/**/*',
      './docs/storyboards/**/*',
      './input/**/*',
      './output/**/*',
      './print-screenshots/**/*',
      './public/img/fast_poker_BW*.png',
      './public/img/interactive_ss_*.png',
      './public/img/og_meta.png',
      './public/img/port/*.png',
      './public/img/port_videos/**/*',
      './public/output/**/*',
      './public/vid/**/*',
      './public/vid/reel.mp4',
    ],
    '/api/leadgen/generate': [
      './WHITEPAPER.pdf',
      './admin/**/*',
      './ai-seo-audit/**/*',
      './brief-design-system-reference/**/*',
      './dashboard/**/*',
      './docs/**/*',
      './public/docs/**/*',
      './public/vid/**/*',
      './scripts/**/*',
    ],
    '/api/leadgen/generate-site': [
      './WHITEPAPER.pdf',
      './admin/**/*',
      './ai-seo-audit/**/*',
      './brief-design-system-reference/**/*',
      './dashboard/**/*',
      './docs/**/*',
      './public/docs/**/*',
      './public/vid/**/*',
      './scripts/**/*',
    ],
  },
  turbopack: {
    root: __dirname,
    resolveAlias: {
      playwright: './lib/playwright-stub.js',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Link',
            value: [
              '</.well-known/api-catalog>; rel="api-catalog"',
              '</llms.txt>; rel="describedby"; type="text/plain"',
              '</sitemap.xml>; rel="sitemap"; type="application/xml"',
            ].join(', '),
          },
        ],
      },
      {
        source: '/.well-known/api-catalog',
        headers: [
          { key: 'Content-Type', value: 'application/linkset+json' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
      {
        source: '/md/:path*',
        headers: [
          { key: 'Content-Type', value: 'text/markdown; charset=utf-8' },
          { key: 'Vary', value: 'Accept' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },
};

export default nextConfig;
