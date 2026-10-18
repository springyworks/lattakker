import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDirectives, alive, renderDirectives } from '../src/ai/directives';

/**
 * The rules have one home: ai-docs/rules.md (with the owner's weighted directives in ai-docs/directives.json).
 * This test keeps it that way. It fails when a rule text is copied into the code (two copies grow apart, and an
 * AI given both goes mad), when the code asks for a section of rules.md that is not there (it would silently get
 * an empty string), when the rules name a tool that does not exist, or when the directives file is unsound.
 */

const root = join(__dirname, '..');
const rulesMd = readFileSync(join(root, 'ai-docs/rules.md'), 'utf8');
const directivesRaw = readFileSync(join(root, 'ai-docs/directives.json'), 'utf8');

/** Every .ts file under src, path and text. */
function srcFiles(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts')) out.push({ path: full.slice(root.length + 1), text: readFileSync(full, 'utf8') });
    }
  };
  walk(join(root, 'src'));
  return out;
}

const files = srcFiles();
const headings = [...rulesMd.matchAll(/^##\s+(.*)$/gm)].map((m) => m[1].trim().toLowerCase());
const squeeze = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('one home for the rules', () => {
  it('every section of rules.md the code asks for exists', () => {
    const asked = new Set<string>();
    for (const f of files) {
      for (const m of f.text.matchAll(/parts\['([^']+)'\]/g)) asked.add(m[1].toLowerCase());
      for (const m of f.text.matchAll(/RULES\.section\('([^']+)'\)/g)) asked.add(m[1].toLowerCase());
    }
    expect(asked.size).toBeGreaterThanOrEqual(10);
    for (const name of asked) expect(headings, `the code asks for the rules section "${name}", but rules.md has no "## ${name}" heading`).toContain(name);
  });

  it('no rule sentence lives in the code as well (a second copy would grow apart)', () => {
    const prose = rulesMd
      .split('\n')
      .map(squeeze)
      .filter((l) => l.length >= 60 && !l.startsWith('#'));
    const copies: string[] = [];
    for (const f of files) {
      const flat = squeeze(f.text);
      for (const line of prose) if (flat.includes(line)) copies.push(`${f.path}: "${line.slice(0, 80)}..."`);
    }
    expect(copies, `rule text found copied into the code; let the code read it from rules.md instead:\n${copies.join('\n')}`).toEqual([]);
  });

  it('every tool the rules name exists in the code', () => {
    const all = files.map((f) => f.text).join('\n');
    const named = [...new Set([...rulesMd.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)].map((m) => m[1]))];
    expect(named.length).toBeGreaterThanOrEqual(10);
    for (const tool of named) expect(all.includes(tool), `rules.md names "${tool}", but nothing in src/ knows it`).toBe(true);
  });
});

describe('the directives file is sound', () => {
  const raw = JSON.parse(directivesRaw) as { next: number; directives: Array<{ number: number; strength: number; endOfLife: string | null; text: string }> };
  const parsed = parseDirectives(raw);

  it('nothing is dropped or clamped when the file is parsed', () => {
    expect(parsed.directives.length).toBe(raw.directives.length);
    for (const [i, d] of parsed.directives.entries()) {
      expect(d.strength, `directive ${d.number} has a strength outside 0..100 in the file`).toBe(raw.directives[i].strength);
      expect(d.text).toBe(raw.directives[i].text.trim());
    }
  });

  it('numbers are unique and next is above them all', () => {
    const numbers = parsed.directives.map((d) => d.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(parsed.next).toBeGreaterThan(n);
  });

  it('every living directive is rendered with its strength, the strongest first', () => {
    const living = alive(parsed, new Date());
    const text = renderDirectives(parsed, new Date());
    for (const d of living) expect(text).toContain(`${d.number}. [${d.strength} % ·`);
    const strengths = living.map((d) => d.strength);
    expect(strengths).toEqual([...strengths].sort((a, b) => b - a));
  });

  it('rules.md itself holds no directive text (the json is its one home)', () => {
    for (const d of parsed.directives) expect(squeeze(rulesMd).includes(squeeze(d.text)), `directive ${d.number} is copied into rules.md`).toBe(false);
  });
});
