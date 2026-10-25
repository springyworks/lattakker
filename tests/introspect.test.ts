import { describe, expect, it } from 'vitest';
import { feelings, Vitals, type Signals } from '../src/aichat/introspect';

const calm: Signals = { budgetUsed: 0.1, memoryFull: 0.2, memoryCut: false, failStreak: 0, recentFailRate: 0, lastQuestionFailed: false, answers: 3 };
const names = (s: Partial<Signals>): string[] => feelings({ ...calm, ...s }).feelings.map((f) => f.feeling);

describe('the helper feels, with a purpose', () => {
  it('is content when all goes well, and says why', () => {
    const r = feelings(calm);
    expect(r.mood).toBe('happy');
    expect(r.feelings[0]).toMatchObject({ feeling: 'content' });
    expect(r.feelings[0].purpose).not.toBe('');
  });

  it('is calm, not happy, before anything has happened', () => {
    expect(feelings({ ...calm, answers: 0 }).mood).toBe('calm');
  });

  it('gets thrifty as the budget goes, and broke when it is gone', () => {
    expect(names({ budgetUsed: 0.4 })).not.toContain('thrifty');
    expect(names({ budgetUsed: 0.8 })).toContain('thrifty');
    const broke = feelings({ ...calm, budgetUsed: 1 });
    expect(broke.feelings.map((f) => f.feeling)).toContain('broke');
    expect(broke.mood).toBe('sad');
  });

  it('feels crowded when the memory is nearly full or was cut', () => {
    expect(names({ memoryFull: 0.9 })).toContain('crowded');
    expect(names({ memoryCut: true, memoryFull: null })).toContain('crowded');
  });

  it('is sad when calls keep failing or the question failed', () => {
    expect(feelings({ ...calm, failStreak: 3, recentFailRate: 0.6 }).mood).toBe('sad');
    expect(names({ lastQuestionFailed: true })).toContain('sad');
  });

  it('has no money feeling when the model costs nothing', () => {
    expect(names({ budgetUsed: null })).not.toContain('thrifty');
  });
});

describe('vital signs', () => {
  it('counts tool calls and the failures in a row', () => {
    const v = new Vitals();
    v.tool('a', true);
    v.tool('b', false);
    v.tool('c', false);
    expect(v.failStreak).toBe(2);
    expect(v.toolFailures).toBe(2);
    v.tool('d', true);
    expect(v.failStreak).toBe(0);
    expect(v.recentFailRate).toBeCloseTo(0.5);
    v.reset();
    expect(v.toolCalls).toBe(0);
  });

  it('remembers an error until the next answer', () => {
    const v = new Vitals();
    v.failed('The budget is used up');
    expect(v.lastError).toContain('budget');
    v.answered(2.34);
    expect(v.lastError).toBeNull();
    expect(v.lastSeconds).toBe(2.3);
  });
});
