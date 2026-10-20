import { describe, expect, it } from 'vitest';
import { keyProfile } from '../src/aichat/keyProfile';

describe('keyProfile', () => {
  it('is the same every time for the same character', () => {
    for (const c of ['a', 'Q', ' ', '7', 'é', 'Backspace']) expect(keyProfile(c)).toEqual(keyProfile(c));
  });

  it('stays within a few percent in pitch and a couple of dB in loudness on the keyboard letters', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz0123456789,.;/';
    const rates = [...letters].map((c) => keyProfile(c).rate);
    const gains = [...letters].map((c) => 20 * Math.log10(keyProfile(c).gain));
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThanOrEqual(0.061);
    expect(Math.max(...gains) - Math.min(...gains)).toBeLessThanOrEqual(2.1);
  });

  it('puts neighbours at different pitches and gives left and right a clear order', () => {
    expect(keyProfile('a').rate).toBeLessThan(keyProfile('l').rate);
    expect(keyProfile('q').rate).not.toBe(keyProfile('w').rate);
  });

  it('gives space and backspace their own character', () => {
    expect(keyProfile(' ').rate).toBeLessThan(0.95);
    expect(keyProfile('Backspace').rate).toBeLessThan(keyProfile(' ').rate);
  });
});
