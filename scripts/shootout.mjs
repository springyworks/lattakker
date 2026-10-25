// Runs scripts/eden-shootout.ts (TypeScript) through Vite, so it works on any Node that runs this project: EDEN_KEY=... npm run shootout [-- model model ...]
import { createServer } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
try {
  await server.ssrLoadModule('/scripts/eden-shootout.ts');
} finally {
  await server.close();
}
