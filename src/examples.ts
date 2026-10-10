/** Example code cells placed below the board so there is always something to click, read and copy. */
export const EXAMPLES: Array<[string, string]> = [
  [
    'A12',
    `// This cell is TypeScript. Double-click it to edit.
// It re-runs after every move, so the numbers stay fresh.
span(4, 2)
const red = game.pieces('red').length
const blue = game.pieces('blue').length
print(\`Red has \${red} pieces\`)
print(\`Blue has \${blue} pieces\`)
color(red >= blue ? '#d9e8dd' : '#f0d8d5')`,
  ],
  [
    'E12',
    `// Paint the board from code: a warm tint under every red piece.
span(3, 2)
let count = 0
for (const square of range('A1:J10')) {
  if (square.piece?.color === 'red') { square.color('#ecdcd8'); count++ }
}
print(\`Painted \${count} squares\`)`,
  ],
  [
    'H12',
    `// Whose turn is it? What happened last?
span(4, 2)
if (game.phase === 'setup') print('Setting up the armies…')
if (game.phase === 'play') print(\`Move \${game.moveCount}: it is \${game.turn.toUpperCase()}'s turn\`)
if (game.winner) print(\`\${game.winner.toUpperCase()} wins!\`)
const m = game.lastMove
if (m) print(\`Last: \${m.piece} \${m.from}→\${m.to}\${m.defender ? ' vs ' + m.defender + ' → ' + m.outcome : ''}\`)`,
  ],
  [
    'A15',
    `// Cells can read other cells, like a spreadsheet.
span(4, 2)
const first = at('A12').text.split('\\n')[0]
print('A12 says: ' + first)
print('2 + 3 * 4 = ' + (2 + 3 * 4))
at('L12').print('Hello from A15 ').color('#f2e4bd')`,
  ],
  [
    'E15',
    `// Danger meter: how close is Blue to your back row?
span(3, 2)
let closest = 10
for (const p of game.pieces('blue')) {
  const row = Number(p.address.slice(1))
  closest = Math.min(closest, 10 - row)
}
print(closest > 4 ? 'All calm' : closest > 2 ? 'Blue is coming…' : 'Blue is at your door!')
color(closest > 4 ? '#d9e8dd' : closest > 2 ? '#f2e4bd' : '#f0d8d5')`,
  ],
  [
    'H15',
    `// Robot cell: remove the // from the lines below and this
// cell plays a random move for RED whenever it is Red's turn.
span(4, 2)
// if (game.phase === 'play' && game.turn === 'red') {
//   const moves = game.legalMoves('red')
//   const pick = moves[Math.floor(Math.random() * moves.length)]
//   await sleep(600)
//   print(game.move(pick.from, pick.to))
// }
print('Robot is sleeping. Edit me to wake it up!')`,
  ],
  [
    'N12',
    `// A stopwatch! every() does something again and again.
// Try '500ms', '10s' or '1m' instead of '1s'.
span(3, 2)
color('#e3dcee')
every('1s', (n) => {
  show(\`\${n} seconds\`)
})
show('Starting…')`,
  ],
  [
    'N15',
    `// on() watches something and wakes up when it changes.
// Here: every time a piece lands on E5, this cell wakes up.
span(3, 2)
let visits = 0
on('E5', (square) => {
  const p = square.piece
  if (p) { visits++; show(\`E5: \${p.name} (visit \${visits})\`) }
  else show(\`E5 is empty (visits: \${visits})\`)
})
show('Watching E5…')`,
  ],
  [
    'A18',
    `// Column C rows 32 to 55: ranges can also be written C32-55
span(4, 2)
const cells = range('C32-55')
cells.color('#dbe2ec')
print(\`Range C32-55 has \${cells.length} cells\`)
print('Scroll down to see them coloured ')`,
  ],
];
