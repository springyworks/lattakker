import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const CLI = join(__dirname, '..', 'scripts', 'directives.mjs');
let file = '';

const run = (...args: string[]): { code: number; out: string } => {
  try {
    return { code: 0, out: execFileSync('node', [CLI, ...args], { env: { ...process.env, DIRECTIVES_FILE: file }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    const e = err as { status: number; stderr: string; stdout: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
};
const data = (): { next: number; directives: Array<{ number: number; strength: number; endOfLife: string | null; text: string; created: string; updated: string; history: unknown[] }> } => JSON.parse(readFileSync(file, 'utf8'));

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'directives-')), 'directives.json');
  writeFileSync(file, JSON.stringify({ version: 1, next: 1, directives: [] }));
});

describe('scripts/directives.mjs', () => {
  it('adds with a number, stamps, strength and end of life', () => {
    expect(run('add', '--strength', '70', '--end', '2030-12-31', 'Be kind.').code).toBe(0);
    const d = data().directives[0];
    expect(d).toMatchObject({ number: 1, strength: 70, endOfLife: '2030-12-31', text: 'Be kind.', history: [] });
    expect(d.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(d.updated).toBe(d.created);
    expect(data().next).toBe(2);
  });
  it('gives every directive its own number', () => {
    run('add', '--strength', '10', 'a');
    run('add', '--strength', '20', 'b');
    expect(data().directives.map((d) => d.number)).toEqual([1, 2]);
  });
  it('refuses strength 100 unless --yes, and accepts it with --yes', () => {
    const refused = run('add', '--strength', '100', 'always');
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/--yes/);
    expect(data().directives).toHaveLength(0);
    expect(run('add', '--strength', '100', '--yes', 'always').code).toBe(0);
    expect(data().directives[0].strength).toBe(100);
  });
  it.each([['101'], ['-1'], ['abc']])('refuses strength %s', (bad) => {
    expect(run('add', '--strength', bad, 'x').code).toBe(1);
  });
  it.each([['31-12-2030'], ['2030-13-45'], ['tomorrow']])('refuses end date %s', (bad) => {
    expect(run('add', '--strength', '50', '--end', bad, 'x').code).toBe(1);
  });
  it('needs text and a strength', () => {
    expect(run('add', '--strength', '50').code).toBe(1);
    expect(run('add', 'no strength').code).toBe(1);
  });
  it('update changes fields, stamps "updated" and keeps the earlier version', () => {
    run('add', '--strength', '70', '--end', '2030-01-01', 'old text');
    expect(run('update', '1', '--strength', '50', '--text', 'new text', '--end', 'none').code).toBe(0);
    const d = data().directives[0];
    expect(d).toMatchObject({ strength: 50, text: 'new text', endOfLife: null });
    expect(d.history).toEqual([{ updated: d.created, strength: 70, endOfLife: '2030-01-01', text: 'old text' }]);
  });
  it('retire ends it yesterday but keeps it in the file', () => {
    run('add', '--strength', '70', 'x');
    run('retire', '1');
    const d = data().directives[0];
    expect(d.endOfLife).toBeTruthy();
    expect(d.endOfLife! < new Date().toISOString().slice(0, 10) || d.endOfLife === new Date(Date.now() - 86400000).toISOString().slice(0, 10)).toBe(true);
    expect(d.history).toHaveLength(1);
  });
  it('knows when a number does not exist, and lists', () => {
    expect(run('update', '9', '--strength', '5').code).toBe(1);
    expect(run('list').out).toMatch(/No directives yet/);
    run('add', '--strength', '70', 'listed text');
    expect(run('list').out).toMatch(/#1\s+70%.*\n\s+listed text/);
  });
});
