// Brings chapter 8.22 of README.md (the API reference) up to date with src/sheet/apiTypes.ts. `npm run dev` and `npm run build` do this by themselves.
import { createServer } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
try {
  const { syncReadme } = await server.ssrLoadModule('/scripts/readme-sync.ts');
  console.log((await syncReadme(root)) ? 'README.md: chapter 8.22 brought up to date.' : 'README.md: chapter 8.22 was already up to date.');
} finally {
  await server.close();
}
