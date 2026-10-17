import { describe, expect, it } from 'vitest';
import { alive, isExpired, parseDirectives, renderDirectives, strengthWords, today, type Directive, type DirectiveFile } from '../src/ai/directives';

const make = (over: Partial<Directive> & { number: number }): Directive => ({
  created: '2026-10-17T12:00:00',
  updated: '2026-10-17T12:00:00',
  strength: 50,
  endOfLife: null,
  text: `rule ${over.number}`,
  history: [],
  ...over,
});
const file = (...directives: Directive[]): DirectiveFile => ({ version: 1, next: 99, directives });
const at = (iso: string): Date => new Date(`${iso}T12:00:00`);

describe('strengthWords', () => {
  it.each([
    [100, /ALWAYS/],
    [99, /nearly always/],
    [85, /nearly always/],
    [84, /strong preference/],
    [70, /strong preference/],
    [69, /mild preference/],
    [55, /mild preference/],
    [54, /Indifferent/],
    [50, /Indifferent/],
    [45, /Indifferent/],
    [44, /weak hint/],
    [1, /weak hint/],
    [0, /Not relevant/],
  ])('%i %% reads as %s', (strength, words) => {
    expect(strengthWords(strength)).toMatch(words);
  });
});

describe('end of life', () => {
  it('counts through the whole last day and ends the day after', () => {
    const d = make({ number: 1, endOfLife: '2026-10-17' });
    expect(isExpired(d, new Date('2026-10-17T00:00:01'))).toBe(false);
    expect(isExpired(d, new Date('2026-10-17T23:59:59'))).toBe(false);
    expect(isExpired(d, new Date('2026-10-18T00:00:01'))).toBe(true);
  });
  it('never ends without an end date', () => {
    expect(isExpired(make({ number: 1 }), at('2999-01-01'))).toBe(false);
  });
  it('today() is the local YYYY-MM-DD', () => {
    expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('alive', () => {
  it('drops ended directives and puts the strongest first, then the newest', () => {
    const list = alive(file(make({ number: 1, strength: 70 }), make({ number: 2, strength: 100 }), make({ number: 3, strength: 70 }), make({ number: 4, strength: 90, endOfLife: '2020-01-01' })), at('2026-10-17'));
    expect(list.map((d) => d.number)).toEqual([2, 3, 1]);
  });
});

describe('renderDirectives', () => {
  it('is empty when nothing counts', () => {
    expect(renderDirectives(file())).toBe('');
    expect(renderDirectives(file(make({ number: 1, endOfLife: '2020-01-01' })), at('2026-10-17'))).toBe('');
  });
  it('shows number, strength, words, end date and text, and explains the scale', () => {
    const text = renderDirectives(file(make({ number: 7, strength: 70, endOfLife: '2030-05-01', text: 'Use the scratch tab.' })), at('2026-10-17'));
    expect(text).toContain('0 to 100 %');
    expect(text).toContain('children');
    expect(text).toMatch(/7\. \[70 % · You should .*counts until 2030-05-01 inclusive\] Use the scratch tab\./);
  });
  it('says "no end date" for a directive without one, and leaves out an ended one', () => {
    const text = renderDirectives(file(make({ number: 1, text: 'keeps' }), make({ number: 2, text: 'gone', endOfLife: '2020-01-01' })), at('2026-10-17'));
    expect(text).toContain('no end date');
    expect(text).toContain('keeps');
    expect(text).not.toContain('gone');
  });
});

describe('parseDirectives (the file is never trusted)', () => {
  it('drops malformed entries and clamps what it keeps', () => {
    const parsed = parseDirectives({ directives: [{ number: 'x' }, { number: 1, text: '  ', strength: 5 }, null, 'text', { number: 2, text: ' ok ', strength: 250, endOfLife: 'soon' }, { number: 3, text: 'neg', strength: -4, endOfLife: '2031-02-03' }] });
    expect(parsed.directives.map((d) => [d.number, d.text, d.strength, d.endOfLife])).toEqual([
      [2, 'ok', 100, null],
      [3, 'neg', 0, '2031-02-03'],
    ]);
  });
  it('survives nothing at all and keeps "next" above every number', () => {
    expect(parseDirectives(undefined)).toEqual({ version: 1, next: 1, directives: [] });
    expect(parseDirectives({ next: 1, directives: [{ number: 5, text: 'a', strength: 1 }] }).next).toBe(6);
  });
});
