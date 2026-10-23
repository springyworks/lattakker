import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mmsGuide } from '../src/ai/readmeSections';
import { llmsTxt } from '../scripts/ai-docs';

const root = join(__dirname, '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

/** The method names of the `const api = { ... }` object of src/ai/surface.ts (the window.mms console). */
function mmsMethods(): string[] {
  const lines = readFileSync(join(root, 'src/ai/surface.ts'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l === '  const api = {');
  const end = lines.findIndex((l, i) => i > start && l === '  };');
  return lines
    .slice(start + 1, end)
    .map((l) => /^ {4}(?:async )?([a-zA-Z]\w*)\s*[:(]/.exec(l)?.[1])
    .filter((n): n is string => !!n);
}

describe('the window.mms guide in the README', () => {
  const guide = mmsGuide(readme);

  it('exists', () => {
    expect(guide.length).toBeGreaterThan(1000);
  });

  it('names every method of window.mms (add a method: describe it in README chapter 11.3.5)', () => {
    const methods = mmsMethods();
    expect(methods.length).toBeGreaterThan(20);
    const missing = methods.filter((m) => !new RegExp(`\\b${m}\\b`).test(guide));
    expect(missing, `README 11.3.5 does not mention: ${missing.join(', ')}`).toEqual([]);
  });

  it('llms.txt is made from the README and carries the guide', () => {
    const text = llmsTxt(readme, 'https://example.test/');
    expect(text).toContain('Step zero');
    expect(text).toContain('README 11.3.5');
    expect(text).toContain(guide.split('\n')[1] ?? guide.slice(0, 40));
  });
});
