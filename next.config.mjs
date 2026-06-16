import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Compute firebase-admin's full on-disk dependency closure. firebase-admin is a
// serverExternalPackage, so Turbopack relies on file-tracing to ship its deps —
// but packages with conditional `exports` maps (jose, uuid, *-proxy-agent, grpc-js)
// only get their package.json traced, causing "Cannot find module" at runtime on
// Vercel. Including the whole closure makes those deps ship regardless of tracing.
function firebaseAdminTraceIncludes() {
  const resolvePkgDir = (name, fromDir) => {
    let dir = fromDir;
    while (true) {
      const cand = path.join(dir, 'node_modules', name);
      if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  };
  const seen = new Set();
  const queue = [{ name: 'firebase-admin', from: __dirname }];
  while (queue.length) {
    const { name, from } = queue.shift();
    const dir = resolvePkgDir(name, from);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    let pj;
    try {
      pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const deps = { ...(pj.dependencies || {}), ...(pj.optionalDependencies || {}) };
    for (const d of Object.keys(deps)) queue.push({ name: d, from: dir });
  }
  // @types/* are type-only and never loaded at runtime — skip to save bundle size.
  return [...seen]
    .filter((d) => !path.relative(__dirname, d).includes('node_modules/@types/'))
    .map((d) => './' + path.relative(__dirname, d) + '/**/*');
}

const firebaseAdminClosure = firebaseAdminTraceIncludes();

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['playwright', 'pdf-parse', 'mammoth', 'firebase-admin'],
  outputFileTracingIncludes: {
    '*': [
      // App logic loaded at runtime via createRequire() from outside the app/ tree.
      // Turbopack does not trace these external CJS/JS modules, so include them explicitly.
      './api/**/*',
      './features/**/*',
      './onboarding/**/*',
      // Full firebase-admin dependency closure (see helper above).
      ...firebaseAdminClosure,
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
