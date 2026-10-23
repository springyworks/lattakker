/**
 * The few ANSI terminal escape codes a cell's print() understands, so a printed frame can start again at the top like on a real terminal:
 *   ESC[2J  (clear screen)  ESC[3J  (clear scrollback)  ESC[H  (cursor home)  ESC[1;1H  ESC c  (full reset)
 * In a cell all of them mean the same: what was printed before is dropped and the text after it starts at the top.
 * Colours and other cursor codes are not drawn in a cell, so they are removed instead of showing up as odd letters.
 */

export const ESC = '\u001b';
/** "Start again at the top": clear the screen and go home. A string to put in front of what print() writes. */
export const TOP = `${ESC}[2J${ESC}[H`;

const START_OVER = new RegExp(`${ESC}(?:c|\\[(?:[23]J|(?:0?;?0?|1;1)?[Hf]))`, 'g');
const OTHER = new RegExp(`${ESC}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)|[@-Z\\\\-_])`, 'g');

/** The text that is left after the last "start again" code (and whether there was one), with every other escape code removed. */
export function readAnsi(text: string): { startOver: boolean; text: string } {
  if (!text.includes(ESC)) return { startOver: false, text };
  let from = 0;
  let startOver = false;
  for (const m of text.matchAll(START_OVER)) {
    startOver = true;
    from = (m.index ?? 0) + m[0].length;
  }
  return { startOver, text: text.slice(from).replace(OTHER, '') };
}

/** What print() does to the lines of a cell's output: drops them all on a "start again" code, then adds the rest of the text (nothing, when only a code was printed). */
export function printInto(output: string[], text: string, max: number): void {
  const { startOver, text: rest } = readAnsi(text);
  if (startOver) output.length = 0;
  if (rest === '' && startOver) return;
  output.push(rest);
  if (output.length > max) output.splice(0, output.length - max);
}
