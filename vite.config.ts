import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/data': {
        target: 'https://raw.githubusercontent.com/NashNQ/albion-market-intel/data',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/data/, ''),
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
} as any);
