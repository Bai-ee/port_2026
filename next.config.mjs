import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['playwright', 'pdf-parse', 'mammoth'],
  outputFileTracingExcludes: {
    '*': [
      './.claude/**/*',
      './.next/**/*',
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
