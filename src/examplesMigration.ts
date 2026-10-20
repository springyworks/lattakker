import type { Sheet } from './sheet/Sheet';

/**
 * Examples change between versions, but the page only loads them into a sheet that has never been used.
 * Someone who comes back with saved cells would never see the new ones. This brings them in, carefully:
 *
 *  - an example that was ADDED is put into its cell only if that cell is still empty;
 *  - an example that was CHANGED replaces the old one only if the cell still holds exactly the old
 *    shipped code (comments aside), which means nobody edited it.
 *
 * Anything a person wrote is never touched. It runs once per revision (the number is kept in this browser).
 */

const KEY = 'lattakker:examples-rev';
export const EXAMPLES_REV = 13;

/** What each revision added, per tab. */
const ADDED: Record<number, { board: string[]; lab: string[] }> = {
  2: { board: ['A42', 'G42', 'M42', 'Q42', 'U42'], lab: ['A31', 'G31'] },
  3: { board: [], lab: ['A35', 'J35', 'R35', 'A41', 'J41'] },
  4: { board: [], lab: ['A47'] },
  5: { board: [], lab: ['A53', 'K53'] },
  6: { board: ['A45', 'K45'], lab: [] },
  7: { board: ['A51'], lab: [] },
  8: { board: [], lab: [] },
  9: { board: ['K51'], lab: [] },
  10: { board: [], lab: [] },
  11: { board: [], lab: [] },
  12: { board: [], lab: ['R41'] },
  13: { board: [], lab: ['R50'] },
};

/** The code (without its comments) that an example had before a revision replaced it. */
const REPLACED: Record<number, { board: Record<string, string[]>; lab: Record<string, string[]> }> = {
  // 11: board A12 (the random player) used to start playing at once; it now starts on hold and a click starts or holds it.
  11: { board: { A12: ["span(4, 3)\ntype Side = 'red' | 'blue'\ninterface Step {\nfrom: string\nto: string\n}\nconst PLAYS: Side[] = ['red']\nconst PAUSE: string = '700ms'\nif (PLAYS.includes('blue')) game.takeOverBlue()\nlet made: number = 0\nconst pick = (steps: Step[]): Step => steps[Math.floor(Math.random() * steps.length)]\nconst tick = (): void => {\nif (game.phase === 'over') {\nshow(`Game over: ${game.winner ?? 'nobody'} won after ${made} moves of mine`)\nstop()\nreturn\n}\nif (game.phase !== 'play') {\nshow('Waiting: press Start on the game')\nreturn\n}\nif (game.busy) return\nconst side: Side = game.turn\nif (!PLAYS.includes(side)) return\nconst steps: Step[] = game.legalMoves(side)\nif (steps.length === 0) {\nshow(`${side} cannot move`)\nreturn\n}\nconst step: Step = pick(steps)\nconst answer: string = game.move(step.from, step.to, side)\nif (answer.startsWith('Moving')) made++\nshow(`${side}: ${step.from} → ${step.to}\\n${made} moves made\\nA random player: no thinking`)\n}\nevery(PAUSE, tick)\nshow('Random player ready')\ncolor('#e1e6f0')"] }, lab: {} },
  // 10: board A12 was the red/blue piece counter; it is now a typed random player (and can play Blue too).
  10: { board: { A12: ["span(4, 2)\nconst red = game.pieces('red').length\nconst blue = game.pieces('blue').length\nprint(`Red has ${red} pieces`)\nprint(`Blue has ${blue} pieces`)\ncolor(red >= blue ? '#d9e8dd' : '#f0d8d5')"] }, lab: {} },
  // 8: Lab A31 calls draw() without the arguments it asks for; the cells are now checked as strictly as the app (draw(last?, from?)).
  8: { board: {}, lab: { A31: ["span(5, 3)\nmemory.heard = memory.heard ?? 0\nconst draw = (last, from) => show(\n'I listen for waves from any tab\\n' +\n'Waves heard: ' + memory.heard + '\\n' +\n(from ? 'Latest: wave ' + last + ' from ' + from : 'Nothing yet. Click Q42 on the board.')\n)\nmcp.on('wave', (n, from) => {\nmemory.heard++\ncolor('hsl(' + ((n * 47) % 360) + ', 60%, 82%)')\ndraw(n, from)\nmcp.emit('echo', n)\n})\ndraw()"] } },
  2: {
    board: {
      A15: [
        "span(4, 2)\nconst first = at('A12').text.split('\\n')[0]\nprint('A12 says: ' + first)\nprint('2 + 3 * 4 = ' + (2 + 3 * 4))\nat('L12').print('Hello from A15 ').color('#f2e4bd')",
      ],
    },
    lab: {},
  },
};

const codeOnly = (code: string): string =>
  code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .join('\n');

export interface MigrationInput {
  /** True when the board's sheet was filled from this browser's saved cells (false: a first visit, which got every example). */
  restored: boolean;
  board: Sheet;
  lab: Sheet;
  examples: ReadonlyArray<[string, string]>;
  labDemos: ReadonlyArray<[string, string]>;
}

/** Returns how many cells were added or updated. */
export function migrateExamples({ restored, board, lab, examples, labDemos }: MigrationInput): number {
  let seen = EXAMPLES_REV;
  try {
    seen = restored ? Number(localStorage.getItem(KEY) ?? 1) || 1 : EXAMPLES_REV;
  } catch {
    return 0;
  }
  let changed = 0;
  for (let rev = seen + 1; rev <= EXAMPLES_REV; rev++) {
    const apply = (sheet: Sheet, list: ReadonlyArray<[string, string]>, added: string[] = [], replaced: Record<string, string[]> = {}): void => {
      for (const [address, code] of list) {
        // A demo below the last row of a saved sheet gets the rows it needs.
        const row = Number(/\d+/.exec(address)?.[0] ?? 1);
        while (added.includes(address) && sheet.rowCount < row + 8 && sheet.rowCount < 200) sheet.insertRow(sheet.rowCount - 1);
        const d = sheet.dataAt(address);
        if (!d) continue;
        const old = replaced[address];
        if (old && d.code.trim() && old.includes(codeOnly(d.code))) {
          sheet.setCode(address, code);
          changed++;
        } else if (added.includes(address) && !d.code.trim()) {
          sheet.setCode(address, code);
          changed++;
        }
      }
    };
    apply(board, examples, ADDED[rev]?.board, REPLACED[rev]?.board);
    apply(lab, labDemos, ADDED[rev]?.lab, REPLACED[rev]?.lab);
  }
  try {
    localStorage.setItem(KEY, String(EXAMPLES_REV));
  } catch {
    // not remembered: it simply runs again next time, and it only ever fills empty or untouched cells
  }
  return changed;
}
