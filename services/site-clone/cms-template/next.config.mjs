import { withPayload } from '@payloadcms/next/withPayload';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The exact-mirror render route reads templates/*.html with fs at request
  // time — computed paths aren't traced, so ship the dir into every lambda.
  outputFileTracingIncludes: {
    '/**': ['./templates/**'],
  },
};

export default withPayload(nextConfig);
