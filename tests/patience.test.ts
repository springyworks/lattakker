import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerCheckpoint, askToContinue, checkpoints, minutesText } from '../src/aichat/patience';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('askToContinue (the question after a long silence)', () => {
  it('is open until the person answers, and passes the minutes on', async () => {
    const q = askToContinue('big:22b', () => 600, () => ['alive']);
    expect(checkpoints()).toHaveLength(1);
    answerCheckpoint(checkpoints()[0].id, 30);
    await expect(q.answer).resolves.toEqual({ minutes: 30, away: false });
    expect(checkpoints()).toHaveLength(0);
  });

  it('stops the request by itself when nobody answers (the person walked away)', async () => {
    const q = askToContinue('big:22b', () => 600, () => [], 1000);
    vi.advanceTimersByTime(1000);
    await expect(q.answer).resolves.toEqual({ minutes: 0, away: true });
    expect(checkpoints()).toHaveLength(0);
  });

  it('is withdrawn when the model speaks after all, and a late answer changes nothing', async () => {
    const q = askToContinue('big:22b', () => 600, () => []);
    const id = checkpoints()[0].id;
    q.withdraw();
    await expect(q.answer).resolves.toEqual({ minutes: -1, away: false });
    answerCheckpoint(id, 10);
    expect(checkpoints()).toHaveLength(0);
  });
});

describe('minutesText', () => {
  it('writes minutes and whole hours', () => {
    expect([10, 60, 120, 90].map(minutesText)).toEqual(['10 min', '1 h', '2 h', '90 min']);
  });
});
