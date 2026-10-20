/**
 * What a typed character sounds like. The same character always gives the same sound, and different characters differ
 * only a little: about 3 % in pitch (a bit above the smallest difference a listener notices for a short click) and
 * about 1.5 dB in loudness, so the ear learns the keyboard without ever being startled.
 * The sound follows the place of the key: left to right sets the pitch, the row sets the loudness, the finger picks
 * the recording. Space, backspace and capitals have their own small character.
 */
export interface KeyProfile {
  /** Which of the key recordings (0-based, wrapped by the caller). */
  sample: number;
  /** Playback speed, 1 = as recorded. */
  rate: number;
  /** Loudness factor, 1 = as usual. */
  gain: number;
}

const ROWS = ['1234567890-=', 'qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./'];
const ROW_OFFSET = [0, 0.5, 0.75, 1.25];
const ROW_DB = [-1, 0, 1, 0];
const FINGER_BY_COLUMN = [0, 0, 1, 2, 3, 3, 4, 4, 5, 6, 7, 7];

const PITCH_SPAN = 0.06;
const PITCH_LOW = 0.97;
const db = (x: number): number => Math.pow(10, x / 20);

function locate(ch: string): { col: number; row: number } | null {
  const lower = ch.toLowerCase();
  for (let r = 0; r < ROWS.length; r++) {
    const c = ROWS[r].indexOf(lower);
    if (c >= 0) return { col: c + ROW_OFFSET[r], row: r };
  }
  return null;
}

/** `ch` is a typed character, or the key names 'Backspace' / 'Delete'. */
export function keyProfile(ch: string): KeyProfile {
  if (ch === 'Backspace' || ch === 'Delete') return { sample: 5, rate: 0.9, gain: db(-1.5) };
  const first = [...ch][0] ?? '';
  if (first === ' ') return { sample: 2, rate: 0.93, gain: db(1.5) };
  const spot = locate(first);
  if (!spot) {
    // anything else (accents, symbols, other scripts): a place on the keyboard taken from the character itself
    const code = first.codePointAt(0) ?? 0;
    const x = ((code * 7) % 13) / 12;
    return { sample: code % 7, rate: PITCH_LOW + PITCH_SPAN * x, gain: db(((code % 5) - 2) * 0.4) };
  }
  const finger = FINGER_BY_COLUMN[Math.min(11, Math.round(spot.col))];
  const x = Math.min(1, spot.col / 12);
  const capital = first !== first.toLowerCase();
  return {
    sample: finger % 7,
    rate: PITCH_LOW + PITCH_SPAN * x,
    gain: db(ROW_DB[spot.row] + (capital ? 1 : 0)),
  };
}
