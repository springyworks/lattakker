import { describe, expect, it } from 'vitest';
import { buildPattern, globTest, renderSearch, type CodeCell } from '../src/mcp/codeBlob';

const cell = (tab: string, address: string, code: string, extra: Partial<CodeCell> = {}): CodeCell => ({
  path: `/${tab}/${address}`,
  tab,
  address,
  uid: '',
  code,
  output: [],
  error: null,
  cols: 1,
  rows: 1,
  runs: 0,
  ...extra,
});

const run = (cells: CodeCell[], query: string, more: Record<string, unknown> = {}) => renderSearch(cells, { query, budget: 8000, ...more });

describe('globTest', () => {
  it('matches tabs, paths and bare addresses', () => {
    expect(globTest('lab')('/lab/J24')).toBe(true);
    expect(globTest('lab')('/rpc/J24')).toBe(false);
    expect(globTest('/lab/*')('/lab/J24')).toBe(true);
    expect(globTest('J24')('/rpc/J24')).toBe(true);
    expect(globTest('**/A2*')('/rpc/A24')).toBe(true);
  });
  it('leaves cells out with !', () => {
    const t = globTest('/lab/*,!/lab/J24');
    expect(t('/lab/J25')).toBe(true);
    expect(t('/lab/J24')).toBe(false);
    expect(t('/rpc/J25')).toBe(false);
    const only = globTest('!lab');
    expect(only('/lab/A1')).toBe(false);
    expect(only('/rpc/A1')).toBe(true);
  });
});

describe('buildPattern', () => {
  it('allows look-around but not a repeat inside a repeat', () => {
    expect(() => buildPattern({ query: '(?<=a)b(?!c)', regex: true })).not.toThrow();
    expect(() => buildPattern({ query: '(a+)+', regex: true })).toThrow();
  });
});

describe('renderSearch', () => {
  it('shows the match of a long line, not only its start', () => {
    const long = 'x'.repeat(400) + ' needle ' + 'y'.repeat(400);
    const { text } = run([cell('lab', 'A1', long)], 'needle');
    expect(text).toContain('needle');
    expect(text).toContain('…');
  });

  it('finds a regular expression over several lines', () => {
    const c = cell('lab', 'A1', 'a\nfoo(\n  1,\n  2)\nb');
    const r = run([c], 'foo\\(\\n\\s*1', { regex: true, context: 0 });
    expect(r.matches).toBe(1);
    expect(r.text).toContain('over line breaks');
    expect(r.text).toMatch(/\s2: foo\(/);
    expect(r.text).toMatch(/\s3: 1,/);
  });

  it('finds a literal line break', () => {
    const r = run([cell('lab', 'A1', 'one\ntwo\nthree')], 'one\ntwo', { context: 0 });
    expect(r.matches).toBe(1);
  });

  it('says only the cells with cellsOnly', () => {
    const r = run([cell('lab', 'A1', 'x\nx'), cell('lab', 'B1', 'x')], 'x', { cellsOnly: true });
    expect(r.matches).toBe(3);
    expect(r.text).toContain('/lab/A1 · 2 matches');
    expect(r.text).not.toMatch(/^\s+1: /m);
  });

  it('searches output and errors', () => {
    const c = cell('lab', 'A1', 'print(1)', { output: ['hello world'], error: 'Boom' });
    expect(run([c], 'hello', { where: 'output' }).matches).toBe(1);
    expect(run([c], 'boom', { where: 'error' }).matches).toBe(1);
    expect(run([c], 'hello').matches).toBe(0);
  });
});
