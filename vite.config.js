import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/gsap')) {
            return 'gsap-vendor';
          }

          if (
            id.includes('node_modules/three') ||
            id.includes('node_modules/@react-three') ||
            id.includes('node_modules/three-stdlib')
          ) {
            return 'three-vendor';
          }

          if (id.includes('node_modules/react')) {
            return 'react-vendor';
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
  },
});
