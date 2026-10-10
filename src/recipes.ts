/** Fixed recipes: small starting points offered by the completion list in every code editor. They live in the code, so editing the sheet's own examples never changes them. */
export interface Recipe {
  label: string;
  doc: string;
  /** Monaco snippet text: ${1:name} are the spots Tab jumps between. */
  body: string;
}

export const RECIPES: Recipe[] = [
  { label: 'print text', doc: 'Show text in this cell', body: "print('${1:Hello}')" },
  { label: 'if', doc: 'Do something only when a test is true', body: 'if (${1:condition}) {\n  ${2}\n}' },
  { label: 'if else', doc: 'Choose between two things', body: "if (${1:condition}) {\n  ${2:print('yes')}\n} else {\n  ${3:print('no')}\n}" },
  { label: 'colour my cell', doc: 'Change the background colour of this cell', body: "color('${1:#d9e8dd}')" },
  { label: 'read another cell', doc: 'Look at another cell by address', body: "const ${1:other} = at('${2:A12}')\nprint(${1:other}.text)" },
  { label: 'for each square', doc: 'Visit every square of the board', body: "for (const square of range('A1:J10')) {\n  ${1:square.color('#d9e8dd')}\n}" },
  { label: 'for each red piece', doc: 'Visit every piece of the Red army', body: "for (const piece of game.pieces('red')) {\n  ${1:print(piece.name, piece.address)}\n}" },
  { label: 'count pieces', doc: 'Count the pieces of one colour', body: "const ${1:count} = game.pieces('${2:red}').length\nprint(${1:count})" },
  {
    label: 'stopwatch',
    doc: 'Count seconds: every() runs again and again',
    body: "span(3, 2)\n// Try: '500ms' instead of '1s' for twice as fast\nevery('${1:1s}', (n) => show(n + ' seconds'))",
  },
  {
    label: 'countdown',
    doc: 'Count down and stop by itself',
    body: "span(3, 2)\nlet left = ${1:5}\n// Try: change the 5, or the word Boom!\nconst stopCounting = every('1s', () => {\n  left--\n  show(left > 0 ? left + '…' : '${2:Boom!}')\n  if (left === 0) stopCounting()\n})",
  },
  { label: 'do it later', doc: 'after() runs something once, a bit later', body: "show('Wait for it…')\n// Try: '10s' instead of '4s'\nafter('${1:4s}', () => show('${2:Ready!}'))" },
  {
    label: 'button',
    doc: 'A cell that reacts when you click it',
    body: "span(3, 2)\ncolor('#e3dcee')\n// Try: change what the button does\non(cell, 'click', () => {\n  memory.clicks = (memory.clicks ?? 0) + 1\n  show('Clicked ' + memory.clicks + ' times')\n})\nshow('${1:Click me!}')",
  },
  {
    label: 'react to the game',
    doc: 'Run again after every move',
    body: "span(4, 2)\n// Try: show something else than the move number\non('game', () => show('Move number ' + game.moveCount))",
  },
  {
    label: 'whose turn',
    doc: 'Show whose turn it is',
    body: "span(3, 2)\non('game', () => show(game.phase === 'play' ? game.turn.toUpperCase() + ' to move' : 'Setting up…'))",
  },
  {
    label: 'watch a cell',
    doc: 'Wake up when another cell changes',
    body: "span(3, 2)\non('${1:A12}', (c) => show('${1:A12} now says: ' + c.text))\nshow('Watching ${1:A12}…')",
  },
  {
    label: 'colour by number',
    doc: 'Green, yellow or red depending on a number',
    body: "const ${1:value} = ${2:game.moveCount}\ncolor(${1:value} < 10 ? '#d9e8dd' : ${1:value} < 30 ? '#f2e4bd' : '#f0d8d5')\nshow(${1:value})",
  },
  { label: 'remember a number', doc: 'memory keeps a value, even after the cell runs again', body: "memory.${1:count} = (memory.${1:count} ?? 0) + 1\nshow(memory.${1:count})" },
  {
    label: 'plot a wave',
    doc: 'Draw an XY plot of a function',
    body: "span(4, 3)\n// Try: Math.cos, or (x) => x * x, or change from and to\nplot(${1:Math.sin}, { from: ${2:0}, to: ${3:6.28}, title: '${4:A wave}' })",
  },
  { label: 'plot numbers', doc: 'Draw a list of numbers as a line', body: "span(4, 3)\nplot([${1:3, 1, 4, 1, 5, 9, 2, 6}], { title: '${2:My numbers}', dots: true })" },
  { label: 'flash a cell', doc: 'Make another cell blink', body: "at('${1:A12}').flash('${2:#f2e4bd}')" },
  { label: 'wait a bit', doc: 'sleep() pauses this cell only; others keep running', body: "show('Counting…')\nfor (let i = 1; i <= ${1:5}; i++) {\n  await sleep('1s')\n  show(i)\n}\nshow('Done!')" },
];

export interface ExampleRecipe {
  label: string;
  doc: string;
  code: string;
}

/** The sheet's example cells, as insertable text. They are taken from the code, so they stay as written even after a player edits the cell in the sheet. */
export function exampleRecipes(examples: ReadonlyArray<[string, string]>): ExampleRecipe[] {
  return examples.map(([address, code]) => {
    const title = (code.split('\n')[0] ?? '').replace(/^\/\/\s*/, '').trim() || address;
    return { label: 'example: ' + (title.length > 50 ? title.slice(0, 47) + '…' : title), doc: `The sheet's example in ${address}. Change it and make it yours.`, code };
  });
}
