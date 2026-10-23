import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { mmsGuide, rulesChapter, withApiReference } from '../src/ai/readmeSections';
import { evalConst } from './ai-docs';

/**
 * The README is the one source of truth, and nobody has to remember to keep parts of it up to date:
 *
 *  - Chapter 8.22 holds the exact API signatures. They are copied from src/sheet/apiTypes.ts (the typings the code editor
 *    uses) into the README every time the dev server or a build starts, so the README can never lag behind the code.
 *  - The rules for AI helpers are chapter 11.5 of the README, and the guide to the window.mms console is 11.3.5. The modules
 *    `virtual:readme-rules` and `virtual:readme-mms` hand those texts to the app, so the built-in helper and `mms.help()` use
 *    the very text everybody else reads in the README.
 *
 * `syncReadme(root)` is also what `npm run docs` runs, and what tests/readmeSync.test.ts checks.
 */

export async function apiDeclarations(root: string): Promise<string> {
  return String(await evalConst(join(root, 'src/sheet/apiTypes.ts'), 'CELL_API_DTS')).trim();
}

/** The README as it should be: with the current API declarations in chapter 8.22. */
export async function readmeInSync(root: string): Promise<{ current: string; wanted: string }> {
  const current = readFileSync(join(root, 'README.md'), 'utf8');
  return { current, wanted: withApiReference(current, await apiDeclarations(root)) };
}

/** Writes the README when chapter 8.22 is out of date. Returns true when it changed. */
export async function syncReadme(root: string): Promise<boolean> {
  const { current, wanted } = await readmeInSync(root);
  if (current === wanted) return false;
  writeFileSync(join(root, 'README.md'), wanted);
  return true;
}

const VIRTUAL: Record<string, { cut: (readme: string) => string; where: string }> = {
  'virtual:readme-rules': { cut: rulesChapter, where: 'chapter "11.5 Rules for AI helpers"' },
  'virtual:readme-mms': { cut: mmsGuide, where: 'chapter "11.3.5 The window.mms console"' },
};

export function readmeSync(): Plugin {
  let root = process.cwd();
  return {
    name: 'lattakker-readme-sync',
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      // Tests start many workers at once: they only check (tests/readmeSync.test.ts), they never write.
      if (process.env.VITEST) return;
      if (await syncReadme(root)) this.info('README.md: chapter 8.22 (API reference) brought up to date from src/sheet/apiTypes.ts');
    },
    resolveId(id) {
      return id in VIRTUAL ? `\0${id}` : null;
    },
    load(id) {
      const mod = VIRTUAL[id.slice(1)];
      if (!id.startsWith('\0') || !mod) return null;
      this.addWatchFile(join(root, 'README.md'));
      const text = mod.cut(readFileSync(join(root, 'README.md'), 'utf8'));
      if (!text) this.error(`README.md has no ${mod.where}`);
      return `export default ${JSON.stringify(text)};`;
    },
  };
}

