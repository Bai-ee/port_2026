import { fileURLToPath } from 'node:url';

// Reuse HITLOOP's components/styles without copying or changing the shared kit.
const repo = fileURLToPath(new URL('../../', import.meta.url));
export default {
  output: 'export',
  outputFileTracingRoot: repo,
  devIndicators: false,
  experimental: { externalDir: true },
  webpack(config) {
    config.resolve.alias['@hitloop'] = repo;
    return config;
  },
};
