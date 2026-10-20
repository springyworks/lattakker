import { describe, expect, it } from 'vitest';
import { advance, feedMs, PAPER_LINE_PX, paperLayout, paperSpeed, paperStyle, printStep, settle } from '../src/sheet/paper';

describe('the teletype types at the pace of the real machine', () => {
  it('types one letter per 100 ms and takes two character times for a line feed', () => {
    expect(printStep('ab\ncd', 0, 10, true)).toEqual({ take: 1, wait: 100 });
    expect(printStep('ab\ncd', 2, 10, true)).toEqual({ take: 1, wait: 200 });
  });

  it('speeds up when a lot of text waits, but never while the sound has to keep in step', () => {
    const long = 'x'.repeat(1000);
    const fast = printStep(long, 0, 10, false);
    expect(fast.take).toBe(10);
    expect(fast.wait).toBeCloseTo(100, 5);
    expect(printStep(long, 0, 10, true)).toEqual({ take: 1, wait: 100 });
  });

  it('carries on when the text grew and starts again when it was cleared or rewritten', () => {
    const typed = advance('HELLO WORLD', 5);
    expect(settle(typed, 'HELLO WORLD AGAIN', false)).toBe(typed);
    expect(settle(typed, 'HELP', false)).toEqual({ shown: 0, head: '' });
    expect(settle(typed, 'GOODBYE WORLD', false)).toEqual({ shown: 0, head: '' });
    expect(settle(undefined, 'HELLO', false).shown).toBe(0);
  });

  it('shows everything at once when the speed is 0', () => {
    expect(paperSpeed({ speed: 0 })).toBe(0);
    expect(settle(undefined, 'HELLO', true).shown).toBe(5);
    expect(paperSpeed({})).toBe(10);
  });
});

describe('the paper slides up one line at every line feed', () => {
  const text = Array.from({ length: 30 }, (_, i) => `LINE ${i}`).join('\n');

  it('shows one more line while the paper is moving', () => {
    const still = paperLayout(text, 300, 200, {}, 0);
    const moving = paperLayout(text, 300, 200, {}, 0, 1);
    expect(moving.label.split('\n').length).toBe(still.label.split('\n').length + 1);
    expect(moving.label.endsWith(still.label)).toBe(true);
  });

  it('lowers the text by one line at the start of the slide and settles at the normal margin', () => {
    const rest = paperStyle({}, 0).spacingBottom as number;
    expect(paperStyle({}, 0, 1).spacingBottom).toBe(rest);
    expect(paperStyle({}, 0, 0).spacingBottom).toBeCloseTo(rest - PAPER_LINE_PX, 5);
  });

  it('keeps the slide long enough to see, and short enough to finish before the next line', () => {
    expect(feedMs(10)).toBe(200);
    expect(feedMs(1000)).toBe(160);
    expect(feedMs(1)).toBe(400);
  });
});
