import { describe, expect, it } from 'vitest';
import { printInto, readAnsi, TOP } from '../src/sheet/ansi';

describe('readAnsi', () => {
  it('leaves plain text alone', () => {
    expect(readAnsi('hello')).toEqual({ startOver: false, text: 'hello' });
  });

  it('recognises clear, home and reset and keeps what comes after the last one', () => {
    for (const code of ['\u001b[2J', '\u001b[3J', '\u001b[H', '\u001b[1;1H', '\u001b[0;0H', '\u001b[f', '\u001bc']) {
      expect(readAnsi(`old${code}new`)).toEqual({ startOver: true, text: 'new' });
    }
    expect(readAnsi('a\u001b[2Jb\u001b[Hc')).toEqual({ startOver: true, text: 'c' });
    expect(readAnsi(TOP + 'page')).toEqual({ startOver: true, text: 'page' });
  });

  it('drops colours and other codes without clearing', () => {
    expect(readAnsi('\u001b[31mred\u001b[0m and \u001b[1;32mgreen\u001b[0m')).toEqual({ startOver: false, text: 'red and green' });
    expect(readAnsi('x\u001b[2Ky\u001b[5A')).toEqual({ startOver: false, text: 'xy' });
  });

  it('does not treat a half-clear (to the end of the screen) as clear', () => {
    expect(readAnsi('a\u001b[0Jb')).toEqual({ startOver: false, text: 'ab' });
  });
});

describe('printInto', () => {
  it('adds lines and keeps the newest max lines', () => {
    const out: string[] = [];
    for (let i = 1; i <= 5; i++) printInto(out, `line ${i}`, 3);
    expect(out).toEqual(['line 3', 'line 4', 'line 5']);
  });

  it('starts again at the top on a clear code', () => {
    const out = ['a', 'b'];
    printInto(out, TOP + 'c', 10);
    expect(out).toEqual(['c']);
  });

  it('a bare clear code leaves the output empty, not one blank line', () => {
    const out = ['a', 'b'];
    printInto(out, '\u001b[2J', 10);
    expect(out).toEqual([]);
    printInto(out, '', 10);
    expect(out).toEqual(['']);
  });
});
