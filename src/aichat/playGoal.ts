/** What the person asked the helper to keep doing on the board, pinned for every round and every later question until it is done. */
export interface PlayGoal {
  text: string;
  /** How many moves were asked for (null: play until someone wins). */
  target: number | null;
  done: number;
}

const PLAY_WORDS = /\b(play(ing)?|moves?|game|battle|board|turns?)\b/i;
const PLAY_ON = /\b\d{1,3}\s*(more\s*)?(moves?|turns?)\b|\b(until|till|to the end|to completion|all the way|finish\w*|complet\w*|someone (should )?win|keep (on )?playing|continue (to )?play\w*|play on|carry on playing)\b/i;
const WANTS_PLAY = { test: (q: string): boolean => PLAY_WORDS.test(q) && PLAY_ON.test(q) };
const WANTS_STOP = /^\W*(stop|enough|pause|halt|cancel|never ?mind)\b|\bstop (playing|now|it)\b|\bthat'?s (enough|all)\b/i;
export const MAX_PLAY_ROUNDS = 150;
export const MAX_PLAY_NUDGES = 80;

/** The number of moves asked for in "play 30 moves" / "30 more turns", else null. */
export function movesAsked(question: string): number | null {
  const m = /\b(\d{1,3})\s*(?:more\s*)?(?:moves?|turns?)\b/i.exec(question);
  return m ? Math.min(200, Number(m[1])) : null;
}

/** Reads a play request, or the end of one, from what the person wrote. */
export function playGoalFrom(question: string, current: PlayGoal | null): PlayGoal | null {
  if (WANTS_PLAY.test(question)) return { text: question.trim().slice(0, 300), target: movesAsked(question), done: 0 };
  return WANTS_STOP.test(question) ? null : current;
}

/** The standing task as the model reads it, in its fixed instructions (it is never trimmed away with the old chat). */
export function goalPrompt(goal: PlayGoal | null): string {
  if (!goal) return '';
  const finished = goal.target !== null && goal.done >= goal.target;
  if (finished) return `\n\nThe standing task ("${goal.text}") is finished: ${goal.done} moves were played. Tell the person in two sentences how the game stands.`;
  const left = goal.target === null ? 'until the game is over and someone has won' : `${goal.done} of ${goal.target} moves played so far; keep going until ${goal.target} are played or the game is over`;
  return `\n\nSTANDING TASK from the person (pinned; it stays until it is done): "${goal.text}". You are playing Red on the board: ${left}. Every turn: call make_move (use legal_moves when you need a choice). Do not stop to ask what the person wants, do not describe a move without making it, and do not answer until the task is finished or a tool refuses you. When it is finished, say in two sentences who won or how many moves were played.`;
}
