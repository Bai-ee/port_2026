import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  outputFileTracingIncludes: {
    '/api/worker/run-brief': ['./api/_lib/assets/**/*'],
    '/api/worker/run-psi': ['./api/_lib/assets/**/*'],
  },
};

export default nextConfig;
