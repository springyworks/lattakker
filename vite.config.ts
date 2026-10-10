import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { mcpBridge } from './scripts/mcp-bridge';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/lattakker/' : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [mcpBridge()],
  server: { port: 5178 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
  },
});
