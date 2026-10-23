import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiReference, rulesChapter, rulesSections, withApiReference } from '../src/ai/readmeSections';
import { readmeInSync } from '../scripts/readme-sync';
import { anchor } from '../scripts/ai-docs';

const root = join(__dirname, '..');

describe('the README is the one source', () => {
  it('chapter 8.22 holds the current API declarations (starting or building the app brings it up to date)', async () => {
    const { current, wanted } = await readmeInSync(root);
    expect(current === wanted, 'README.md chapter 8.22 is out of date: run `npm run docs` (it also happens whenever `npm run dev` or `npm run build` starts)').toBe(true);
  });

  it('the declarations can be read back out of the README', async () => {
    const { wanted } = await readmeInSync(root);
    const dts = apiReference(wanted);
    expect(dts).toContain('declare function print');
    expect(dts!.length).toBeGreaterThan(5000);
  });

  it('chapter 11.5 has the sections the helper asks for', () => {
    const sections = rulesSections(rulesChapter(readFileSync(join(root, 'README.md'), 'utf8')));
    for (const name of ['first contact', 'how to behave', 'work like a coder', 'cell code rules', 'helper: small models']) expect(sections[name], name).toBeTruthy();
  });

  it('replacing the block twice gives the same README', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const once = withApiReference(readme, 'declare function x(): void;');
    expect(withApiReference(once, 'declare function x(): void;')).toBe(once);
    expect(apiReference(once)).toBe('declare function x(): void;');
  });

  it('every link of the table of contents leads to a heading', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const anchors = new Set([...readme.matchAll(/^#{1,4} (.+)$/gm)].map((m) => anchor(m[1])));
    const toc = readme.slice(readme.indexOf('## Contents'), readme.indexOf('\n## 2 '));
    const dead = [...toc.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]).filter((a) => !anchors.has(a));
    expect(dead, `table of contents links without a heading: ${dead.join(', ')}`).toEqual([]);
  });
});
