import { defineConfig } from 'vite';
import { mcpBridge } from './scripts/mcp-bridge';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/lattakker/' : '/',
  plugins: [mcpBridge()],
  server: { port: 5178 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
  },
});
