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
    `// Column Z rows 21 to 39: ranges can also be written Z21-39
span(4, 2)
const cells = range('Z21-39')
cells.color('#dbe2ec')
print(\`Range Z21-39 has \${cells.length} cells\`)
print('Scroll right to see them coloured ')`,
  ],
  // ---- Row 18 onwards: the cell API, one idea per cell. Right-click any cell to see who uses it.
  [
    'E18',
    `// Right-click this cell → Size → Wider. Reading cell.cols makes me wake up when I am resized.
// Only choose a size when the code was just written, so a size you made by hand is left alone.
if (run.reason === 'edit') span(4, 2)
const area = cell.cols * cell.rows
show(\`I am \${cell.address}: \${cell.cols} × \${cell.rows}\\narea = \${area}\`)
color(area >= 12 ? '#d9e8dd' : area >= 8 ? '#f2e4bd' : '#ece8de')`,
  ],
  [
    'I18',
    `// A cell that adapts to its size: make it bigger (right-click → Size) to see more.
if (run.reason === 'edit') span(3, 1)
const room = cell.cols * cell.rows
print(\`Move \${game.moveCount}\`)
if (room >= 4) print(\`Turn: \${game.turn}\`)
if (room >= 6) print(\`Red \${game.pieces('red').length} · Blue \${game.pieces('blue').length}\`)
if (room >= 9) print(game.lastMove ? \`Last: \${game.lastMove.piece} \${game.lastMove.from}→\${game.lastMove.to}\` : 'No moves yet')`,
  ],
  [
    'M18',
    `// on(cell, 'size', fn): fn runs when someone resizes I18 (right-click I18 → Size).
// memory is this cell's notebook: it keeps the log even when you edit this code.
span(4, 2)
const lines: string[] = (memory.lines ??= [])
on('I18', 'size', (box) => {
  lines.push(\`I18 is now \${box.cols}×\${box.rows}\`)
  if (lines.length > 4) lines.shift()
  show(lines.join('\\n'))
})
show(lines.join('\\n') || 'Resize I18 and watch me…')`,
  ],
  [
    'Q18',
    `// on(cell, 'code', fn): fn runs when someone edits E21's code (or moves code in or out of it).
span(4, 2)
on('E21', 'code', (c) => {
  memory.edits = (memory.edits ?? 0) + 1
  show(\`E21 was edited \${memory.edits}×\\nFirst line now:\\n\${c.code.split('\\n')[0]}\`)
})
show(memory.edits ? \`E21 was edited \${memory.edits}×\` : 'Edit E21 and I will notice')`,
  ],
  [
    'A21',
    `// "Why am I running?" run.reason says: 'edit', 'moved' (drag me by the grip) or 'update' (something I read changed).
// memory survives all of those, so I can keep count.
span(4, 2)
memory.runs = (memory.runs ?? 0) + 1
if (run.reason === 'edit') memory.edits = (memory.edits ?? 0) + 1
const why = { edit: 'Someone edited me', moved: \`I was moved to \${cell.address}\`, update: \`The game moved on (move \${game.moveCount})\` }
show(\`\${why[run.reason]}\\nedits: \${memory.edits} · runs: \${memory.runs}\`)`,
  ],
  [
    'E21',
    `// Edit this text, then press Esc. Cell Q18 is watching my code.
span(4, 2)
print('Change me: Q18 is watching!')`,
  ],
  [
    'I21',
    `// A button. on(cell, 'click', fn) runs fn whenever the cell is clicked.
span(4, 2)
color('#e3dcee')
const label = () => show(memory.clicks ? \`Clicked \${memory.clicks}×\` : 'Click me!')
on(cell, 'click', () => {
  memory.clicks = (memory.clicks ?? 0) + 1
  label()
})
label()`,
  ],
  [
    'M21',
    `// Two dice. Math.random() gives a number from 0 up to (not including) 1.
span(4, 2)
color('#f2e4bd')
on(cell, 'click', () => {
  const a = 1 + Math.floor(Math.random() * 6)
  const b = 1 + Math.floor(Math.random() * 6)
  show(\`\${a} + \${b} = \${a + b}\${a === b ? '  double!' : ''}\`)
})
show('Click to roll')`,
  ],
  [
    'Q21',
    `// Click me and Red plays one random legal move.
span(4, 2)
color('#f0d8d5')
on(cell, 'click', () => {
  if (game.phase !== 'play' || game.turn !== 'red') return show('Not your turn yet')
  const moves = game.legalMoves('red')
  const pick = moves[Math.floor(Math.random() * moves.length)]
  show(game.move(pick.from, pick.to))
})
show('Click me for a random Red move')`,
  ],
  [
    'U21',
    `// on('game', fn): fn runs after anything in the game changes.
span(4, 2)
on('game', (g) => {
  show(g.history.slice(-4).map((m) => \`\${m.piece} \${m.from}→\${m.to}\`).join('\\n') || 'No moves yet')
})
show('The last four moves appear here')`,
  ],
  [
    'A24',
    `// A chain, step 1: a number that changes with the game.
span(4, 2)
show(game.moveCount)`,
  ],
  [
    'E24',
    `// Step 2 reads A24, so it re-runs right after A24 changes (in the right order).
span(4, 2)
const n = Number(at('A24').text) || 0
show(\`\${n} × 2 = \${n * 2}\`)`,
  ],
  [
    'I24',
    `// Step 3 reads E24. Right-click E24 → "Used by" lists this cell.
span(4, 2)
const t = at('E24').text
show(t.endsWith('0') ? 'Round number!' : 'Keep playing: ' + t)
color(t.endsWith('0') ? '#d9e8dd' : '#ece8de')`,
  ],
  [
    'M24',
    `// range() reads many squares at once; this cell re-runs when any of them changes.
span(4, 2)
const home = range('A7:J10')
const mine = home.filter((s) => s.piece?.color === 'red').length
show(\`\${mine} Red pieces in the home rows\`)`,
  ],
  [
    'Q24',
    `// A timer's variables start over when the cell runs again, but memory does not.
span(4, 2)
memory.beats ??= 0
every('2s', () => {
  memory.beats++
  show(\`Heartbeat \${memory.beats}\`)
})
show(\`Heartbeat \${memory.beats}\`)`,
  ],
  [
    'U24',
    `// every() returns a stop function. This countdown stops itself.
span(4, 2)
let left = 5
const stopCounting = every('1s', () => {
  left--
  show(left > 0 ? \`\${left}…\` : 'Boom!')
  if (left === 0) stopCounting()
})
show(\`\${left}…\`)`,
  ],
  [
    'A27',
    `// A ticking clock. Each tick tells the cells that read this one (E27 does).
span(4, 2)
every('1s', (n) => show(n))
show(0)`,
  ],
  [
    'E27',
    `// Reads A27: wakes up on every tick without any timer of its own.
span(4, 2)
const t = Number(at('A27').text) || 0
show(t % 2 ? 'tick' : 'tock')
color(t % 2 ? '#d9e8dd' : '#f2e4bd')`,
  ],
  [
    'I27',
    `// A timer can write into other cells. Y27 is an empty cell; Q27 reads it.
span(4, 2)
every('2s', (n) => {
  at('Y27').show(\`Letter number \${n}\`)
})
print('Posting into Y27 every 2 seconds')`,
  ],
  [
    'M27',
    `// on() with a range: wakes up once when something in rows 5 and 6 changes.
span(4, 2)
on('A5:J6', (square) => {
  memory.n = (memory.n ?? 0) + 1
  show(\`\${square.address} changed\\n\${memory.n} changes in rows 5-6\`)
})
show('Watching rows 5 and 6…')`,
  ],
  [
    'Q27',
    `// The mailbox reader: it never runs a timer, it just reads Y27.
span(4, 2)
const mail = at('Y27').text
show(mail ? \`Got: \${mail}\` : 'No mail yet')`,
  ],
  [
    'U27',
    `// A cell can ask who uses whom: the same lists as right-click → Used by / Reads.
span(4, 2)
const e24 = at('E24')
show(\`E24 is read by: \${e24.usedBy.join(', ') || 'nobody'}\\nI read: \${cell.reads.join(', ')}\`)`,
  ],
  [
    'A30',
    `// A cell can resize other cells. I30 grows by one column every 5 moves.
span(4, 2)
const wide = Math.min(6, 2 + Math.floor(game.moveCount / 5))
at('I30').span(wide, 2)
show(\`I30 is \${wide} columns wide\`)`,
  ],
  [
    'I30',
    `// I draw a bar as wide as I am. A30 resizes me; right-click → Size works too.
const bar = '#'.repeat(cell.cols * 3)
show(bar)
color('#dbe2ec')`,
  ],
  [
    'Q30',
    `// sheet.mode and sheet.rows are reactive: no on() needed.
// Press "Show code" or insert a row (right-click a row number) to see me change.
span(4, 2)
show(\`Mode: \${sheet.mode}\\nRows: \${sheet.rows}\`)`,
  ],
  [
    'U30',
    `// on('sheet', 'rows', fn): fn runs when a row is inserted.
span(4, 2)
on('sheet', 'rows', () => {
  memory.inserted = (memory.inserted ?? 0) + 1
  show(\`Rows inserted: \${memory.inserted}\`)
})
show(\`Rows inserted: \${memory.inserted ?? 0}\\nRight-click a row number → Insert row\`)`,
  ],
  [
    'A33',
    `// A robot with an on/off switch: click me. It plays Red whenever it is Red's turn.
span(4, 2)
const label = () => show(memory.on ? 'Robot is playing Red.\\nClick to stop.' : 'Robot is asleep.\\nClick to wake it.')
async function play() {
  if (!memory.on || game.phase !== 'play' || game.turn !== 'red') return
  await sleep(500)
  if (!memory.on || game.turn !== 'red') return
  const moves = game.legalMoves('red')
  const pick = moves[Math.floor(Math.random() * moves.length)]
  if (pick) game.move(pick.from, pick.to)
}
on(cell, 'click', () => {
  memory.on = !memory.on
  label()
  return play()
})
on('game', play)
label()`,
  ],
  [
    'E33',
    `// Remember what you saw last time (memory) and compare: flash every square that changed.
span(4, 2)
const seen: Record<string, string> = (memory.seen ??= {})
let changed = 0
for (const square of range('A1:J10')) {
  const now = JSON.stringify(square.piece)
  if (seen[square.address] !== undefined && seen[square.address] !== now) {
    square.flash('#ffd27f')
    changed++
  }
  seen[square.address] = now
}
show(\`\${changed} squares changed\`)`,
  ],
  [
    'I33',
    `// A thinking clock: seconds since the last move. A timer and a watcher share one variable.
span(4, 2)
let secs = 0
every('1s', () => show(\`\${++secs}s since the last move\`))
on('game', () => {
  secs = 0
  show('0s since the last move')
})
show('0s since the last move')`,
  ],
  [
    'M33',
    `// A slow cell: await sleep() lets all the other cells carry on while this one counts.
span(4, 2)
for (let i = 0; i <= 10; i++) {
  show('#'.repeat(i) + '.'.repeat(10 - i))
  await sleep(300)
}
show('Done! Nobody had to wait for me.')`,
  ],
  [
    'Q33',
    `// Mistakes inside a timer show up on the cell and stop that timer.
// On tick 3 something goes wrong. Fix it and press Ctrl+Enter.
span(4, 2)
every('2s', (n) => {
  if (n === 3) JSON.parse('{oops')
  show(\`tick \${n}\`)
})
show('tick 0')`,
  ],
  [
    'U33',
    `// What one cell can do to others: color, textColor, print, show, view, flash.
span(4, 2)
range('Y33:Y36').color('#f2e4bd')
at('Y33').print('print adds a line').print('and another')
at('Y34').show('show replaces').show('the text')
at('Y35').view('view is what View mode shows').textColor('#7a3b3b')
at('Y36').flash('#ffd27f')
show('Look at Y33 to Y36 →')`,
  ],
  [
    'A36',
    `// Cheat sheet. Right-click any cell for Used by, Reads, Size and Stop timers.
// Move a cell and the addresses in code follow it, so keep them as plain text: at('B7')
span(8, 3)
color('#ece8de')
print('on(x, fn)             x changed (cell, range, game)')
print("on(x, 'size', fn)     x was resized")
print("on(x, 'code', fn)     x had its code edited or moved")
print("on(x, 'click', fn)    x was clicked")
print("on('sheet', 'rows' | 'mode', fn)")
print('every(t, fn) · after(t, fn) · stop()')
print('memory: notebook that survives re-runs · run.reason')`,
  ],
  [
    'Q12',
    `// A ticker: text that slides one letter every second. It reads and writes nothing else.
span(4, 2)
const news = '   Lattakker: move the armies, watch the cells work   '
let pos = 0
every('1s', () => {
  pos = (pos + 1) % news.length
  show((news + news).slice(pos, pos + 14))
})
show(news.slice(0, 14))`,
  ],
  [
    'U12',
    `// A clock with a running timer. It only looks at the computer's time, not at the game.
span(4, 2)
const started = Date.now()
const tick = () => show(new Date().toLocaleTimeString() + '\\n' + Math.floor((Date.now() - started) / 1000) + ' s open')
every('1s', tick)
tick()`,
  ],
  [
    'Q15',
    `// after(time, fn) runs once, later. Nothing repeats and no timer is left behind.
span(4, 2)
show('Fuse lit… ready in 4 seconds')
after('4s', () => show('Ready!'))`,
  ],
  [
    'U15',
    `// on('sheet', 'mode', fn) runs each time the sheet switches mode. Press "Show code" to count.
span(4, 2)
on('sheet', 'mode', () => {
  memory.switches = (memory.switches ?? 0) + 1
  show('Mode switched ' + memory.switches + ' time(s)\\nNow: ' + sheet.mode)
})
show('Now: ' + sheet.mode + '\\nSwitch modes to count')`,
  ],
  [
    'U18',
    `// game.captured('red') lists the Red pieces that were taken. The counts update after each capture.
span(4, 2)
const draw = () => show('Red pieces lost: ' + game.captured('red').length + '\\nBlue pieces lost: ' + game.captured('blue').length)
on('game', draw)
draw()`,
  ],
  [
    'I36',
    `// on('game', fn) runs after every move. Here: how many moves Red can choose from right now.
span(4, 3)
const draw = () => show(game.phase === 'play'
  ? game.legalMoves('red').length + ' legal moves for Red\\n' + (game.turn === 'red' ? 'Your turn!' : 'Waiting for Blue')
  : 'Setting up')
on('game', draw)
draw()`,
  ],
  [
    'M36',
    `// A progress bar: one block for every four moves.
span(4, 3)
color('#e3dcee')
const draw = () => {
  const n = Math.min(10, Math.floor(game.moveCount / 4))
  show('[' + '#'.repeat(n) + '.'.repeat(10 - n) + '] ' + game.moveCount + ' moves')
}
on('game', draw)
draw()`,
  ],
  [
    'Q36',
    `// game.history holds every move. This cell shows the last eight pieces that moved.
span(4, 3)
const draw = () => show(game.history.slice(-8).map((m) => m.piece).join(' ') || 'No moves yet')
on('game', draw)
draw()`,
  ],
  [
    'U36',
    `// Pieces still on the board, as bars: one block for every two pieces.
span(4, 3)
const draw = () => {
  const red = game.pieces('red').length
  const blue = game.pieces('blue').length
  show('Red  ' + '█'.repeat(Math.ceil(red / 2)) + ' ' + red + '\\nBlue ' + '█'.repeat(Math.ceil(blue / 2)) + ' ' + blue)
}
on('game', draw)
draw()`,
  ],
  [
    'A39',
    `// try / catch: a wrong address does not break the cell. The error is caught and shown instead.
span(6, 2)
try {
  at('ZZ99').show('never shown')
} catch (err) {
  show('Not a cell: ' + err.message)
}`,
  ],
  [
    'M39',
    `// A rainbow: every 150 ms the colour moves a little further round the colour wheel (hue 0 to 360).
// Change 150ms for a faster or slower rainbow, or 'step' for bigger jumps.
span(4, 2)
const hsl = (h: number, s = 70, l = 82) => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * v).toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}
const step = 4
every('150ms', (n) => {
  const hue = (n * step) % 360
  color(hsl(hue))
  show('hue ' + hue + '°')
})
color(hsl(0))
show('hue 0°')`,
  ],
  [
    'W15',
    `// A rainbow wave: this cell paints W16 to W26 below it, each one a bit further round the wheel.
span(1, 1)
const hsl = (h: number) => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = 0.7 * 0.18
    return Math.round(255 * (0.82 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}
// range() is called inside the timer on purpose: a cell that reads the squares it paints would wake itself up.
every('200ms', (n) => {
  range('W16:W26').forEach((square, i) => square.color(hsl((n * 6 + i * 30) % 360)))
})
show('~')`,
  ],
  [
    'G39',
    `// Click me to cycle my colour. memory keeps the choice, even when the code is edited.
span(6, 2)
const palette = ['#d9e8dd', '#f2e4bd', '#f0d8d5', '#e3dcee', '#dbe2ec']
memory.step ??= 0
const paint = () => {
  cell.color(palette[memory.step % palette.length])
  show('Colour ' + (memory.step % palette.length + 1) + ' of ' + palette.length + ' (click me)')
}
on(cell, 'click', () => {
  memory.step++
  paint()
})
paint()`,
  ],
];
