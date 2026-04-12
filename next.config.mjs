/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent webpack from bundling browser-only Three.js packages server-side.
  // @react-three/drei's barrel import pulls in Bvh → three-mesh-bvh → BatchedMesh,
  // which doesn't exist in three@0.157. Marking these as external skips that analysis.
  serverExternalPackages: [
    'three',
    '@react-three/fiber',
    '@react-three/drei',
    'three-mesh-bvh',
    'three-stdlib',
  ],
};

export default nextConfig;
