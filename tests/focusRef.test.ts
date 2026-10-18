import { describe, expect, it } from 'vitest';
import { FOCUS_REF_SOURCE, describeLines, formatFocusRef, parseFocusRef } from '../src/focusRef';

describe('focus references', () => {
  it('reads lines and columns', () => {
    expect(parseFocusRef('/lab/J24#L3')).toEqual({ path: '/lab/J24', startLine: 3, startColumn: undefined, endLine: 3, endColumn: undefined });
    expect(parseFocusRef('/lab/J24#L3-5')).toMatchObject({ startLine: 3, endLine: 5 });
    expect(parseFocusRef('/lab/J24#L3-L5')).toMatchObject({ startLine: 3, endLine: 5 });
    expect(parseFocusRef('A12#L2C4-L2C9')).toEqual({ path: 'A12', startLine: 2, startColumn: 4, endLine: 2, endColumn: 9 });
  });

  it('puts a backwards range the right way round', () => {
    expect(parseFocusRef('A12#L9-2')).toMatchObject({ startLine: 2, endLine: 9 });
    expect(parseFocusRef('A12#L2C9-L2C4')).toMatchObject({ startColumn: 4, endColumn: 9 });
  });

  it('refuses what is not a reference', () => {
    for (const bad of ['/lab/J24', '/lab/J24#L0', '#L3', 'A12#L3C0-L3C4', 'a12#L3', '/lab/J24#L3-', 'A12#L1x']) expect(parseFocusRef(bad), bad).toBeNull();
  });

  it('keeps columns only when both ends have one', () => {
    expect(parseFocusRef('A12#L2C4-5')).toMatchObject({ startLine: 2, endLine: 5, startColumn: undefined, endColumn: undefined });
  });

  it('writes what it reads', () => {
    for (const text of ['/lab/J24#L3', '/lab/J24#L3-5', 'A12#L2C4-L2C9', 'A12#L2C4-L7C1']) {
      const ref = parseFocusRef(text)!;
      expect(formatFocusRef(ref.path, ref)).toBe(text);
    }
  });

  it('finds references inside a sentence', () => {
    const found = [...'look at /lab/J24#L3-5 and A12#L2C4-L2C9, not J24.'.matchAll(new RegExp(FOCUS_REF_SOURCE, 'g'))].map((m) => m[0]);
    expect(found).toEqual(['/lab/J24#L3-5', 'A12#L2C4-L2C9']);
  });

  it('describes lines for a sentence', () => {
    expect(describeLines({ startLine: 4, endLine: 4 })).toBe('line 4');
    expect(describeLines({ startLine: 4, endLine: 6 })).toBe('lines 4-6');
  });
});

describe('deep link with a focus place', () => {
  it('carries the lines of a cell', async () => {
    const { buildLink, parseLink } = await import('../src/deeplink');
    const url = buildLink({ tab: 'lab', cell: '/lab/A41', lines: { from: 3, to: 5 } }, 'https://x.test/');
    expect(url).toBe('https://x.test/?cell=/lab/A41&sel=3-5#lab');
    expect(parseLink('?cell=/lab/A41&sel=3-5', '#lab').lines).toEqual({ from: 3, to: 5 });
    expect(parseLink('?cell=/lab/A41&sel=7', '').lines).toEqual({ from: 7, to: 7 });
  });

  it('ignores lines without a cell or with nonsense', async () => {
    const { buildLink, parseLink } = await import('../src/deeplink');
    expect(buildLink({ tab: 'board', lines: { from: 3, to: 5 } }, 'https://x.test/')).toBe('https://x.test/');
    expect(parseLink('?sel=3-5', '').lines).toBeUndefined();
    expect(parseLink('?cell=/lab/A41&sel=5-3', '').lines).toBeUndefined();
    expect(parseLink('?cell=/lab/A41&sel=x', '').lines).toBeUndefined();
  });
});
