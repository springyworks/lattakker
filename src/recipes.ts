/** Fixed recipes: small starting points offered by the completion list in every code editor. They live in the code, so editing the sheet's own examples never changes them. */
export interface Recipe {
  label: string;
  doc: string;
  /** Monaco snippet text: ${1:name} are the spots Tab jumps between. */
  body: string;
}

export const RECIPES: Recipe[] = [
  {
    label: 'print text',
    doc: 'Show text in this cell',
    body: "// print() adds one line of text to this cell's output.\n// The text goes between quotes. Change Hello to anything you like.\nprint('${1:Hello}')",
  },
  {
    label: 'if',
    doc: 'Do something only when a test is true',
    body: "// An if is a question. If the answer is yes (true), the code in the\n// curly brackets runs. If the answer is no, it is skipped.\nif (${1:condition}) {\n  // Put what should happen when the answer is yes here\n  ${2}\n}",
  },
  {
    label: 'if else',
    doc: 'Choose between two things',
    body: "// if ... else picks ONE of two paths, like a fork in the road.\n// If the test is true the first block runs, otherwise the else block runs.\nif (${1:condition}) {\n  // The test was true: do this\n  ${2:print('yes')}\n} else {\n  // The test was false: do this instead\n  ${3:print('no')}\n}",
  },
  {
    label: 'colour my cell',
    doc: 'Change the background colour of this cell',
    body: "// color() paints this cell's background.\n// A colour is a name like 'pink' or a code like '#d9e8dd' (red, green, blue).\ncolor('${1:#d9e8dd}')",
  },
  {
    label: 'read another cell',
    doc: 'Look at another cell by address',
    body: "// at('A12') points at the cell with that address, like a spreadsheet.\n// We keep it in a box called a constant (const) so we can use it twice.\nconst ${1:other} = at('${2:A12}')\n\n// .text is whatever that cell is showing right now.\nprint(${1:other}.text)",
  },
  {
    label: 'for each square',
    doc: 'Visit every square of the board',
    body: "// range('A1:J10') is every square of the board, from A1 to J10.\n// A for loop visits them one by one. Each time round, square is the next one.\nfor (const square of range('A1:J10')) {\n  // Do something with this square (here: paint it)\n  ${1:square.color('#d9e8dd')}\n}",
  },
  {
    label: 'for each red piece',
    doc: 'Visit every piece of the Red army',
    body: "// game.pieces('red') is the list of all Red pieces still on the board.\n// The loop takes them one at a time and calls the current one piece.\nfor (const piece of game.pieces('red')) {\n  // piece.name is its rank (like Scout), piece.address is its square\n  ${1:print(piece.name, piece.address)}\n}",
  },
  {
    label: 'count pieces',
    doc: 'Count the pieces of one colour',
    body: "// game.pieces('red') is a list. A list knows how long it is: .length\n// So this counts the pieces. Try 'blue' instead of 'red'.\nconst ${1:count} = game.pieces('${2:red}').length\n\n// Show the number in this cell\nprint(${1:count})",
  },
  {
    label: 'stopwatch',
    doc: 'Count seconds: every() runs again and again',
    body: "// span(3, 2) makes this cell 3 columns wide and 2 rows tall\nspan(3, 2)\n\n// every('1s', ...) runs the code inside it again and again, once a second.\n// n counts 1, 2, 3, ... and show() replaces the old text with the new text.\n// Try: '500ms' instead of '1s' for twice as fast\nevery('${1:1s}', (n) => show(n + ' seconds'))",
  },
  {
    label: 'countdown',
    doc: 'Count down and stop by itself',
    body: "// Make this cell 3 columns wide and 2 rows tall\nspan(3, 2)\n\n// let makes a box called left that we may change later. It starts at 5.\nlet left = ${1:5}\n\n// Try: change the 5, or the word Boom!\n// every() gives us back a stop button (a function), which we keep in stopCounting.\nconst stopCounting = every('1s', () => {\n  // Take one away each second (left-- means left = left - 1)\n  left--\n\n  // While there is time left show the number, at zero show the last word\n  show(left > 0 ? left + '…' : '${2:Boom!}')\n\n  // At zero press the stop button so the timer ends\n  if (left === 0) stopCounting()\n})",
  },
  {
    label: 'do it later',
    doc: 'after() runs something once, a bit later',
    body: "// First show a message straight away\nshow('Wait for it…')\n\n// after() waits, then runs its code just ONE time (every() keeps repeating).\n// Try: '10s' instead of '4s'\nafter('${1:4s}', () => show('${2:Ready!}'))",
  },
  {
    label: 'button',
    doc: 'A cell that reacts when you click it',
    body: "// Make this cell 3 columns wide and 2 rows tall, and give it a colour\nspan(3, 2)\ncolor('#e3dcee')\n\n// on(cell, 'click', ...) means: when someone clicks THIS cell, run the code inside.\n// Try: change what the button does\non(cell, 'click', () => {\n  // memory is this cell's notebook. It keeps its numbers when the cell runs again.\n  // ?? 0 means: if there is nothing in the notebook yet, start from 0.\n  memory.clicks = (memory.clicks ?? 0) + 1\n\n  // Tell the player how many clicks there have been\n  show('Clicked ' + memory.clicks + ' times')\n})\n\n// What the cell says before the first click\nshow('${1:Click me!}')",
  },
  {
    label: 'react to the game',
    doc: 'Run again after every move',
    body: "// Make this cell 4 columns wide and 2 rows tall\nspan(4, 2)\n\n// on('game', ...) wakes this code up every time something changes in the game.\n// Try: show something else than the move number\non('game', () => show('Move number ' + game.moveCount))",
  },
  {
    label: 'whose turn',
    doc: 'Show whose turn it is',
    body: "// Make this cell 3 columns wide and 2 rows tall\nspan(3, 2)\n\n// Every time the game changes, check the phase of the game.\n// The ? : is a short if: (test) ? answer if yes : answer if no.\n// During play we show whose turn it is, before that we say we are setting up.\non('game', () => show(game.phase === 'play' ? game.turn.toUpperCase() + ' to move' : 'Setting up…'))",
  },
  {
    label: 'watch a cell',
    doc: 'Wake up when another cell changes',
    body: "// Make this cell 3 columns wide and 2 rows tall\nspan(3, 2)\n\n// on('A12', ...) watches the cell with that address.\n// When it changes the code runs, and c is that cell, so c.text is what it says now.\non('${1:A12}', (c) => show('${1:A12} now says: ' + c.text))\n\n// What this cell says until something changes\nshow('Watching ${1:A12}…')",
  },
  {
    label: 'colour by number',
    doc: 'Green, yellow or red depending on a number',
    body: "// Keep a number in a box called value (here: how many moves were played)\nconst ${1:value} = ${2:game.moveCount}\n\n// Choose a colour with two short ifs chained together:\n// under 10 is green, under 30 is yellow, anything bigger is red.\ncolor(${1:value} < 10 ? '#d9e8dd' : ${1:value} < 30 ? '#f2e4bd' : '#f0d8d5')\n\n// Show the number itself\nshow(${1:value})",
  },
  {
    label: 'remember a number',
    doc: 'memory keeps a value, even after the cell runs again',
    body: "// memory is this cell's notebook. Whatever you write in it is still there\n// the next time the cell runs, even after you edit the code.\n// ?? 0 means: if the notebook has no number yet, start from 0. Then add 1.\nmemory.${1:count} = (memory.${1:count} ?? 0) + 1\n\n// Show the number we remembered\nshow(memory.${1:count})",
  },
  {
    label: 'plot a wave',
    doc: 'Draw an XY plot of a function',
    body: "// A plot needs room: make this cell 4 columns wide and 3 rows tall\nspan(4, 3)\n\n// plot() draws a picture of a function: x goes along, the answer goes up.\n// from and to say where on the x line to start and stop (6.28 is one full turn).\n// Try: Math.cos, or (x) => x * x, or change from and to\nplot(${1:Math.sin}, { from: ${2:0}, to: ${3:6.28}, title: '${4:A wave}' })",
  },
  {
    label: 'plot numbers',
    doc: 'Draw a list of numbers as a line',
    body: "// A plot needs room: make this cell 4 columns wide and 3 rows tall\nspan(4, 3)\n\n// A list of numbers goes between [ and ]. plot() draws them as a line:\n// the first number at the left, the next one a step to the right, and so on.\n// dots: true adds a dot on every number.\nplot([${1:3, 1, 4, 1, 5, 9, 2, 6}], { title: '${2:My numbers}', dots: true })",
  },
  {
    label: 'flash a cell',
    doc: 'Make another cell blink',
    body: "// at('A12') points at another cell. flash() makes it blink for a moment\n// in the colour you choose, so you can say: look over here!\nat('${1:A12}').flash('${2:#f2e4bd}')",
  },
  {
    label: 'wait a bit',
    doc: 'sleep() pauses this cell only; others keep running',
    body: "// Say we are starting\nshow('Counting…')\n\n// A for loop that counts: i starts at 1, and goes up by 1 (i++) while i is small enough.\nfor (let i = 1; i <= ${1:5}; i++) {\n  // sleep('1s') waits one second. await means: wait here until it is finished.\n  // Only this cell waits. All the other cells keep running.\n  await sleep('1s')\n\n  // Show the number we have reached\n  show(i)\n}\n\n// The loop is over: say so\nshow('Done!')",
  },
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
