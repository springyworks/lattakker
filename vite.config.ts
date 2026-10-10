import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/lattakker/' : '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
  },
});
