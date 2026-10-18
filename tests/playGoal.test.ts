import { describe, expect, it } from 'vitest';
import { goalPrompt, movesAsked, playGoalFrom } from '../src/aichat/playGoal';

describe('standing play task', () => {
  it('reads a request to play on, with or without a number', () => {
    expect(movesAsked('continue playing the standing game further 30 move or until the game is finished')).toBe(30);
    expect(playGoalFrom('continue palying the game 30 moves', null)).toMatchObject({ target: 30, done: 0 });
    expect(playGoalFrom('you should play the game to completion', null)).toMatchObject({ target: null });
  });
  it('leaves one-move requests alone', () => {
    expect(playGoalFrom('play B7 to B6', null)).toBeNull();
    expect(playGoalFrom('play a move for me', null)).toBeNull();
  });
  it('keeps the task through a complaint and drops it on stop', () => {
    const goal = playGoalFrom('play 10 moves', null);
    expect(playGoalFrom('why did you stop', goal)).toBe(goal);
    expect(playGoalFrom('stop, enough', goal)).toBeNull();
  });
  it('pins the task in the instructions', () => {
    const goal = { text: 'play 30 moves', target: 30, done: 4 };
    expect(goalPrompt(goal)).toContain('4 of 30');
    expect(goalPrompt({ ...goal, done: 30 })).toContain('is finished');
    expect(goalPrompt(null)).toBe('');
  });
});
