import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// firebase-admin is a serverExternalPackage, so Turbopack relies on file-tracing
// to ship its transitive deps — but it under-traces packages with conditional
// `exports` / "main"-entry resolution, recording only their package.json. Those
// then fail at runtime on Vercel with "Cannot find module". This is the set of
// firebase-admin closure packages whose runtime code the tracer misses (~8MB).
// Regenerate by diffing the firebase-admin dependency closure against a route's
// .next/server/.../route.js.nft.json for packages that have .js on disk but no
// .js traced. (jose + uuid copies are part of this set.)
const firebaseAdminTraceDeps = [
  'jose',
  'uuid',
  'gaxios/node_modules/uuid',
  'teeny-request/node_modules/uuid',
  'google-gax/node_modules/uuid',
  '@firebase/component', '@firebase/database', '@firebase/database-compat',
  '@firebase/logger', '@firebase/util', '@js-sdsl/ordered-map', '@nodable/entities',
  '@tootallnate/once', 'abort-controller', 'agent-base', 'ansi-regex', 'ansi-styles',
  'anynum', 'asynckit', 'call-bind-apply-helpers', 'cliui', 'color-convert',
  'color-name', 'combined-stream', 'data-uri-to-buffer', 'delayed-stream',
  'dunder-proto', 'emoji-regex', 'es-define-property', 'es-errors', 'es-object-atoms',
  'es-set-tostringtag', 'escalade', 'event-target-shim', 'farmhash-modern',
  'fast-xml-builder', 'form-data', 'function-bind', 'get-caller-file', 'get-intrinsic',
  'get-proto', 'gopd', 'has-symbols', 'has-tostringtag', 'hasown', 'html-entities',
  'http-parser-js', 'http-proxy-agent', 'http-proxy-agent/node_modules/agent-base',
  'https-proxy-agent', 'is-fullwidth-code-point', 'math-intrinsics', 'mime-db',
  'mime-types', 'path-expression-matcher', 'require-directory', 'string-width',
  'strip-ansi', 'strnum', 'tslib', 'web-streams-polyfill', 'websocket-driver',
  'websocket-extensions', 'wrap-ansi', 'xml-naming', 'y18n', 'yargs', 'yargs-parser',
  'teeny-request/node_modules/agent-base', 'teeny-request/node_modules/https-proxy-agent',
].map((p) => `./node_modules/${p}/**/*`);

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
      // firebase-admin transitive deps the tracer under-includes (see above).
      ...firebaseAdminTraceDeps,
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
