/** Example code cells placed below the board so there is always something to click, read and copy. */
export const EXAMPLES: Array<[string, string]> = [
  [
    'A12',
    `// This cell is TypeScript. Double-click it to edit.
// It re-runs after every move, so the numbers stay fresh.
// Code is a list of instructions. The computer reads them from top to bottom.
// A line starting with two slashes is a comment: a note for humans.
// The computer ignores comments, so I can talk to you as much as I like!

// span(4, 2) sets the size of this cell: 4 columns wide and 2 rows tall.
// Think of the cell as a window; now you know how big the window is.
span(4, 2)

// const makes a named box that holds a value. The name here is red.
// game.pieces('red') asks the game for a list of all red pieces.
// .length counts how many things are in that list. So red is a number.
const red = game.pieces('red').length

// Same idea for the blue pieces. A new box called blue holds that count.
const blue = game.pieces('blue').length

// print adds a new line of text to this cell. Text can be glued to values.
// Text between backticks is a template string: whatever sits inside the
// dollar-and-curly-brackets part is replaced by the value of that box.
// So if red is 40, the cell shows: Red has 40 pieces
print(\`Red has \${red} pieces\`)

// Same trick again, this time to show the Blue count.
print(\`Blue has \${blue} pieces\`)

// color() paints the cell background. The ? : part is a tiny question.
// "Is red at least as big as blue?" If yes, use green (#d9e8dd).
// If no, use a soft red (#f0d8d5). So the cell turns green when Red leads.
color(red >= blue ? '#d9e8dd' : '#f0d8d5')`,
  ],
  [
    'E12',
    `// Paint the board from code: a warm tint under every red piece.
// A square is one little tile of the board. We will visit every tile.

// This cell is 3 columns wide and 2 rows tall.
span(3, 2)

// let makes a box whose value can change later (const boxes cannot change).
// count starts at 0 and we will add one each time we paint a square.
let count = 0

// A loop repeats the same instructions many times.
// range('A1:J10') means all squares from A1 to J10: the whole board.
// The loop takes the squares one at a time and calls the current one square.
for (const square of range('A1:J10')) {
  // An if runs its instructions only when a question is true.
  // Question: is there a piece on this square, and is it red?
  // The ?. means "if there is no piece, just say no instead of crashing".
  // If yes: paint the square a warm tint, then do count++ (add one to count).
  if (square.piece?.color === 'red') { square.color('#ecdcd8'); count++ }
}

// When the loop is done, tell us how many squares we painted.
print(\`Painted \${count} squares\`)`,
  ],
  [
    'H12',
    `// Whose turn is it? What happened last?
// The game object knows everything about the match. We just ask it questions.

// 4 columns wide, 2 rows tall.
span(4, 2)

// game.phase tells which part of the game we are in: 'setup' or 'play'.
// === asks "are these two exactly equal?". If so, print the message.
if (game.phase === 'setup') print('Setting up the armies…')

// During play, show the move number and whose turn it is.
// toUpperCase() turns letters into CAPITALS, so 'red' becomes 'RED'.
// The dollar-curly parts inside backticks are filled in with real values.
if (game.phase === 'play') print(\`Move \${game.moveCount}: it is \${game.turn.toUpperCase()}'s turn\`)

// game.winner is empty until somebody wins. An empty value counts as "no".
if (game.winner) print(\`\${game.winner.toUpperCase()} wins!\`)

// Save the most recent move in a box called m. Before the first move there
// is nothing to save, so m can be empty.
const m = game.lastMove

// If there is a last move, describe it: which piece, from where, to where.
// And if the piece attacked someone (m.defender), add who defended and
// what happened. The ? : picks between "add the fight text" or "add nothing".
if (m) print(\`Last: \${m.piece} \${m.from}→\${m.to}\${m.defender ? ' vs ' + m.defender + ' → ' + m.outcome : ''}\`)`,
  ],
  [
    'A15',
    `// Cells can read other cells, like a spreadsheet. Here is every way to NAME a cell.
// A cell name is like the address of a house: add more (street, town, country)
// and it works from further away. This cell shows ONE cell named in several
// ways, then cells of ANOTHER tab (the Lab). Follow the numbers in the comments.

// 4 columns wide, 2 rows tall: the seven lines below fit in that.
span(4, 2)

// A little recipe (a function) that keeps only the first line of a text.
// split('new line') cuts a text into a list of lines; [0] picks the first
// one (computers start counting at 0, not 1).
const first = (text) => String(text).split('\\n')[0]

// 1. A plain address names a cell of THIS tab, like a seat in a theatre.
// at('A12') points at it. We keep it in a box called a12 to use it twice.
const a12 = at('A12')

// .text is what the cell shows. print adds a line to this cell.
print('A12        ' + first(a12.text))

// 2. The long name, called a path: /board/A12 means "in the board tab, cell
// A12". It names the very same cell, and it also works from other tabs.
print('/board/A12  ' + first(at('/board/A12').text))

// 3. @ names the identity: a code that stays with the cell's CODE, even if
// you drag the cell somewhere else. a12.uid is that identity (it is empty if
// A12 has no code, so we check that first with the ? : short if).
print(a12.uid ? '@id         ' + first(at('@' + a12.uid).text) : '@id         A12 has no code')

// 4. ANOTHER tab: the path starts with the tab's name. The Lab is full of demos.
// at() READS the cell, and this cell runs again whenever the Lab cell changes.
print('/lab/A1     ' + first(at('/lab/A1').text))

// The Lab's J24 is a rocket countdown: watch this line change when it runs.
print('/lab/J24    ' + first(at('/lab/J24').text))

// 5. A path can go INSIDE a cell. The Lab's Game of Life is a block of tiles;
// /lab/A16/3,4 is the tile 3 across and 4 down. .fill is its colour (empty
// when the tile is dead), so the ? : picks a word for each case.
print('tile 3,4    ' + (at('/lab/A16/3,4').fill ? '🟩 alive' : '⬜ empty'))

// 6. Every cell knows its own name too: cell.path.
print('me          ' + cell.path)

// Writing works in YOUR OWN tab: add a line to L12 and paint it yellow.
// (A cell of another tab can be read, but only that tab's code writes to it.)
at('L12').print('Hello from A15 ').color('#f2e4bd')`,
  ],
  [
    'E15',
    `// Danger meter: how close is Blue to your back row?
// The idea: find the blue piece that is nearest to our back row, then
// turn that distance into a friendly message and a colour.

// 3 columns wide, 2 rows tall.
span(3, 2)

// let makes a box that can change. closest starts at 10, a big number
// meaning "far away". We will lower it when we find a nearer piece.
let closest = 10

// Loop over the list of blue pieces, one at a time. Each one is called p.
for (const p of game.pieces('blue')) {
  // p.address is like 'E7'. slice(1) drops the first letter, leaving '7'.
  // Number() turns the text '7' into the real number 7 so we can do maths.
  const row = Number(p.address.slice(1))

  // 10 - row is how far that piece is from our back row.
  // Math.min picks the smaller of two numbers, so closest keeps the record.
  closest = Math.min(closest, 10 - row)
}

// Chained questions: if closest is over 4 say calm; else if over 2 warn;
// else shout. The first true question wins.
print(closest > 4 ? 'All calm' : closest > 2 ? 'Blue is coming…' : 'Blue is at your door!')

// Same questions, but they choose a colour: green, yellow, or red.
color(closest > 4 ? '#d9e8dd' : closest > 2 ? '#f2e4bd' : '#f0d8d5')`,
  ],
  [
    'H15',
    `// Robot cell: remove the // from the lines below and this
// cell plays a random move for RED whenever it is Red's turn.
// Removing the slashes is called "uncommenting": the computer then reads
// those lines as real instructions instead of notes.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Here is what the sleeping lines do, in plain words:
// 1. Check it is the play phase AND it is Red's turn (&& means "and").
// 2. Ask the game for the list of all legal moves for red.
// 3. Pick a random one: Math.random() gives a number between 0 and 1,
//    times the list length, rounded down by Math.floor, gives a random
//    position in the list.
// 4. await sleep(600) waits 0.6 seconds, so you can watch the move happen.
// 5. game.move(from, to) plays the move and print shows the result.
// if (game.phase === 'play' && game.turn === 'red') {
//   const moves = game.legalMoves('red')
//   const pick = moves[Math.floor(Math.random() * moves.length)]
//   await sleep(600)
//   print(game.move(pick.from, pick.to))
// }
// While the lines above are comments, the only real line is this one.
print('Robot is sleeping. Edit me to wake it up!')`,
  ],
  [
    'N12',
    `// A stopwatch! every() does something again and again.
// Try '500ms', '10s' or '1m' instead of '1s'.
// ms means milliseconds (1000 of them make one second), s is seconds,
// m is minutes.

// 3 columns wide, 2 rows tall.
span(3, 2)

// Paint the cell a soft purple so it looks different from its neighbours.
color('#e3dcee')

// every('1s', ...) is like an alarm clock that rings again and again.
// The part after the arrow => is a little function: a recipe that runs
// each time the alarm rings. n counts the rings: 1, 2, 3...
every('1s', (n) => {
  // show replaces everything in the cell with this text.
  // (print would add a new line instead, show swaps the old text away.)
  show(\`\${n} seconds\`)
})

// This line runs right away, before the first ring. So you see this
// first, then the counting starts.
show('Starting…')`,
  ],
  [
    'N15',
    `// on() watches something and wakes up when it changes.
// Here: every time a piece lands on E5, this cell wakes up.
// A function that runs when something happens is called a callback.
// You hand it over and say: "call this later, when the event comes".

// 3 columns wide, 2 rows tall.
span(3, 2)

// A box that can change, counting how many times a piece arrived.
let visits = 0

// on('E5', ...) means: watch the square E5. When it changes, run the
// callback (the part after the comma). The square is given to us as 'square'.
on('E5', (square) => {
  // Look at the piece standing on that square. It may be nothing at all.
  const p = square.piece

  // If a piece is there: add 1 to visits, then show its name and the count.
  if (p) { visits++; show(\`E5: \${p.name} (visit \${visits})\`) }

  // Otherwise (else) the square was just emptied, so say so.
  else show(\`E5 is empty (visits: \${visits})\`)
})

// This runs once, right away, so the cell is not blank before anything moves.
show('Watching E5…')`,
  ],
  [
    'A18',
    `// Column Z rows 21 to 39: ranges can also be written Z21-39
// A range is a group of cells you can handle all together, like a class.

// 4 columns wide, 2 rows tall.
span(4, 2)

// range('Z21-39') grabs column Z from row 21 down to row 39 as one group.
// We store the group in a box called cells (const = the name never changes).
const cells = range('Z21-39')

// Paint every cell in the group light blue with a single command.
cells.color('#dbe2ec')

// .length is how many cells are in the group. Then print shows it.
print(\`Range Z21-39 has \${cells.length} cells\`)

// Z is far to the right, so tell the reader where to look.
print('Scroll right to see them coloured ')`,
  ],
  // ---- Row 18 onwards: the cell API, one idea per cell. Right-click any cell to see who uses it.
  [
    'E18',
    `// Right-click this cell → Size → Wider. Reading cell.cols makes me wake up
// when I am resized.
// Only choose a size when the code was just written, so a size you made by hand is left alone.
// 'cell' means "this very cell", the one running this code.
// run.reason tells us why the code is running right now.
// 'edit' means someone just typed new code. Then we pick our starting size.
// Later re-runs skip it, so your own resizing is never undone.
if (run.reason === 'edit') span(4, 2)

// cell.cols and cell.rows say how big I am now. Multiply: area = squares.
const area = cell.cols * cell.rows

// show swaps the text of this cell. cell.address is my own address.
// The × is just a character. The special two-character code in the code
// below makes a new line, so the text lands on two lines.
show(\`I am \${cell.address}: \${cell.cols} × \${cell.rows}\\narea = \${area}\`)

// Pick a colour by size: green if big (12 or more), yellow if medium
// (8 or more), grey if small. Chained ? : questions, first true one wins.
color(area >= 12 ? '#d9e8dd' : area >= 8 ? '#f2e4bd' : '#ece8de')`,
  ],
  [
    'I18',
    `// A cell that adapts to its size: make it bigger (right-click → Size) to see more.
// Small windows show little, big windows show more details.
// If we just edited the code, start at 3 columns by 1 row.
if (run.reason === 'edit') span(3, 1)

// room = columns times rows = how many squares of space I have.
const room = cell.cols * cell.rows

// Always show the move number (tiny space is enough for that).
print(\`Move \${game.moveCount}\`)

// With room for 4 or more squares, also tell whose turn it is.
if (room >= 4) print(\`Turn: \${game.turn}\`)

// With 6 or more, add how many pieces each side has (the dot is a joiner).
if (room >= 6) print(\`Red \${game.pieces('red').length} · Blue \${game.pieces('blue').length}\`)

// With 9 or more, add the last move. The ? : picks: if there was a last
// move describe it, otherwise say 'No moves yet'.
if (room >= 9) print(game.lastMove ? \`Last: \${game.lastMove.piece} \${game.lastMove.from}→\${game.lastMove.to}\` : 'No moves yet')`,
  ],
  [
    'M18',
    `// on(cell, 'size', fn): fn runs when someone resizes I18 (right-click I18 → Size).
// memory is this cell's notebook: it keeps the log even when you edit this code.
// fn is short for function: a little recipe the computer follows later.

// 4 columns wide, 2 rows tall.
span(4, 2)

// memory is a notebook that survives re-runs. ??= means: if memory.lines is
// still empty, start it as an empty list []. Otherwise keep what is there.
// ': string[]' tells TypeScript "this is a list of texts".
const lines: string[] = (memory.lines ??= [])

// Watch cell I18, and call our recipe whenever its size changes.
// box is the information about I18 that we get handed.
on('I18', 'size', (box) => {
  // push adds a new item at the end of the list.
  lines.push(\`I18 is now \${box.cols}×\${box.rows}\`)

  // Keep only the last 4 lines: if there are more, shift removes the oldest.
  if (lines.length > 4) lines.shift()

  // join glues the items together with a new line between each one.
  show(lines.join('\\n'))
})

// At the start: show the saved log. The || means "or": if the log is empty,
// show the friendly hint instead.
show(lines.join('\\n') || 'Resize I18 and watch me…')`,
  ],
  [
    'Q18',
    `// on(cell, 'code', fn): fn runs when someone edits E21's code
// (or moves code in or out of it).
// So this cell is a spy that notices when another cell's program changes.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Watch the code of cell E21. c describes E21 each time it changes.
on('E21', 'code', (c) => {
  // memory is this cell's notebook. Add 1 to the saved count. The ?? 0 means
  // "if nothing is saved yet, start from 0".
  memory.edits = (memory.edits ?? 0) + 1

  // c.code is E21's code text. split by new line gives its lines, and [0]
  // is the first one. We show the count and that first line.
  show(\`E21 was edited \${memory.edits}×\\nFirst line now:\\n\${c.code.split('\\n')[0]}\`)
})

// At the start, show the saved count if there is one, else invite you to edit.
show(memory.edits ? \`E21 was edited \${memory.edits}×\` : 'Edit E21 and I will notice')`,
  ],
  [
    'A21',
    `// "Why am I running?" run.reason says: 'edit', 'moved' (drag me by the
// grip) or 'update' (something I read changed).
// memory survives all of those, so I can keep count.
// Think of memory as a diary that the cell keeps between runs.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Add 1 to the number of runs. The ?? 0 starts at 0 the very first time.
memory.runs = (memory.runs ?? 0) + 1

// Only when someone edited the code, add 1 to the number of edits too.
if (run.reason === 'edit') memory.edits = (memory.edits ?? 0) + 1

// why is a lookup table: a name on the left, a message on the right.
// We can later ask it: "what is the message for this reason?".
const why = { edit: 'Someone edited me', moved: \`I was moved to \${cell.address}\`, update: \`The game moved on (move \${game.moveCount})\` }

// Pick the message with why[run.reason], then add the two counters.
show(\`\${why[run.reason]}\\nedits: \${memory.edits} · runs: \${memory.runs}\`)`,
  ],
  [
    'E21',
    `// Edit this text, then press Esc. Cell Q18 is watching my code.
// Try: change the words below, then look at cell Q18.

// 4 columns wide, 2 rows tall.
span(4, 2)

// print adds a line of text to the cell. Text goes between quote marks.
print('Change me: Q18 is watching!')`,
  ],
  [
    'I21',
    `// A button. on(cell, 'click', fn) runs fn whenever the cell is clicked.
// 'cell' means this very cell. So we say: "when I get clicked, do this".

// 4 columns wide, 2 rows tall.
span(4, 2)

// Paint the button purple.
color('#e3dcee')

// label is a function stored in a box. The arrow => builds it. When called,
// it shows how many clicks we counted, or 'Click me!' if there are none yet.
// (0 counts as "no" in a question, so the 0 clicks case picks the text.)
const label = () => show(memory.clicks ? \`Clicked \${memory.clicks}×\` : 'Click me!')

// Every click runs the recipe between the curly brackets.
on(cell, 'click', () => {
  // Add 1 to the click counter kept in memory (the cell's notebook).
  memory.clicks = (memory.clicks ?? 0) + 1

  // Call label() to redraw the text. The brackets mean "run it now".
  label()
})

// Draw the text once at the start too.
label()`,
  ],
  [
    'M21',
    `// Two dice. Math.random() gives a number from 0 up to (not including) 1.
// Multiply by 6 and round down and you get 0 to 5. Add 1: a dice from 1 to 6!

// 4 columns wide, 2 rows tall.
span(4, 2)

// Paint the cell yellow, like a wooden dice.
color('#f2e4bd')

// Every click on the cell rolls the dice again.
on(cell, 'click', () => {
  // Math.floor rounds down (4.9 becomes 4). This is the first die.
  const a = 1 + Math.floor(Math.random() * 6)

  // And the second die, rolled separately.
  const b = 1 + Math.floor(Math.random() * 6)

  // Show 'a + b = total'. === asks if both dice are equal; if so we add
  // '  double!'. Otherwise we add an empty text (nothing).
  show(\`\${a} + \${b} = \${a + b}\${a === b ? '  double!' : ''}\`)
})

// Before the first click, tell the player what to do.
show('Click to roll')`,
  ],
  [
    'Q21',
    `// Click me and Red plays one random legal move.
// A legal move is one the rules of the game allow.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Paint the cell a soft red: it is the Red player's button.
color('#f0d8d5')

// When the cell is clicked, run the recipe below.
on(cell, 'click', () => {
  // !== means "is NOT equal". || means "or". If the game is not in the play
  // phase, or it is not Red's turn, say so and return (leave early).
  if (game.phase !== 'play' || game.turn !== 'red') return show('Not your turn yet')

  // Ask the game for every legal move for red, as a list.
  const moves = game.legalMoves('red')

  // Pick one at random: Math.random() is 0 to 1, times the list length,
  // Math.floor rounds down: a random position in the list.
  const pick = moves[Math.floor(Math.random() * moves.length)]

  // Play the move (from one square to another) and show what happened.
  show(game.move(pick.from, pick.to))
})

// Before any click, invite the player.
show('Click me for a random Red move')`,
  ],
  [
    'U21',
    `// on('game', fn): fn runs after anything in the game changes.
// So this cell is a news reporter that shouts "something happened!".

// 4 columns wide, 2 rows tall.
span(4, 2)

// Watch the whole game. g is the game, handed to our recipe each time.
on('game', (g) => {
  // g.history is the list of all moves so far. slice(-4) keeps only the last
  // four. map turns each move m into a short text, like 'piece from→to'.
  // join glues the texts together, one per line. If the result is empty
  // (no moves), the || 'or' part gives 'No moves yet' instead.
  show(g.history.slice(-4).map((m) => \`\${m.piece} \${m.from}→\${m.to}\`).join('\\n') || 'No moves yet')
})

// Shown at the start, until the first move happens.
show('The last four moves appear here')`,
  ],
  [
    'A24',
    `// A chain, step 1: a number that changes with the game.
// A chain is cells passing news along: A24 tells E24, E24 tells I24.

// 4 columns wide, 2 rows tall.
span(4, 2)

// game.moveCount is how many moves have been played. show puts it in the
// cell. Because the cell reads the game, it re-runs after every move.
show(game.moveCount)`,
  ],
  [
    'E24',
    `// Step 2 reads A24, so it re-runs right after A24 changes (in the right order).
// This is how a spreadsheet works: a cell reading another follows it.

// 4 columns wide, 2 rows tall.
span(4, 2)

// at('A24').text is the text written in A24. Text is not a number yet,
// so Number() converts it. The || 0 means "or 0": if the conversion fails
// (it gives NaN, "not a number") we use 0 instead.
const n = Number(at('A24').text) || 0

// Show the sum. * means times. The part in dollar-curly brackets is
// calculated and put into the text.
show(\`\${n} × 2 = \${n * 2}\`)`,
  ],
  [
    'I24',
    `// Step 3 reads E24. Right-click E24 → "Used by" lists this cell.
// The chain is now A24 → E24 → I24. A change at the start flows to the end.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Read the text of E24 and keep it in a box called t.
const t = at('E24').text

// endsWith('0') asks: does the text finish with the character 0?
// If yes (a round number like 10 or 20), cheer. Otherwise nudge us on.
show(t.endsWith('0') ? 'Round number!' : 'Keep playing: ' + t)

// The same question picks the colour: green for round, grey otherwise.
color(t.endsWith('0') ? '#d9e8dd' : '#ece8de')`,
  ],
  [
    'M24',
    `// range() reads many squares at once; this cell re-runs when any of them changes.
// Like a teacher watching a whole row of desks, not only one.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Squares from A7 to J10: the four rows at Red's end of the board.
// They are saved in a box called home.
const home = range('A7:J10')

// filter keeps only the squares that pass a test. The test (s) => ... says:
// "does this square have a piece, and is it red?". .length counts the keepers.
const mine = home.filter((s) => s.piece?.color === 'red').length

// Tell the number, using a template string.
show(\`\${mine} Red pieces in the home rows\`)`,
  ],
  [
    'Q24',
    `// A timer's variables start over when the cell runs again, but memory does not.
// So a normal box (const or let) forgets; memory is a notebook that remembers.

// 4 columns wide, 2 rows tall.
span(4, 2)

// ??= means: if memory.beats has no value yet, set it to 0. Otherwise leave it.
memory.beats ??= 0

// every('2s', ...) runs the recipe again and again, every two seconds.
every('2s', () => {
  // ++ adds one to the notebook counter.
  memory.beats++

  // Show the new heartbeat number.
  show(\`Heartbeat \${memory.beats}\`)
})

// Show the saved number straight away, before the first beat.
show(\`Heartbeat \${memory.beats}\`)`,
  ],
  [
    'U24',
    `// every() returns a stop function. This countdown stops itself.
// A function can be kept in a box and called later, like a remote control.

// 4 columns wide, 2 rows tall.
span(4, 2)

// A box that can change: start the countdown at 5.
let left = 5

// every makes a timer. It hands back a 'stop button' that we keep in a box
// called stopCounting. The timer ticks once per second.
const stopCounting = every('1s', () => {
  // -- takes one away from left.
  left--

  // If time is left show 'number…', else show 'Boom!'. (? : is a quick if.)
  show(left > 0 ? \`\${left}…\` : 'Boom!')

  // === asks "is it exactly 0?". If so, press the stop button: the timer ends.
  if (left === 0) stopCounting()
})

// Show the first number right away.
show(\`\${left}…\`)`,
  ],
  [
    'A27',
    `// A ticking clock. Each tick tells the cells that read this one (E27 does).
// Like a metronome: it ticks, and anyone listening can follow along.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Every second, run the recipe. n is the tick number: 1, 2, 3...
// show(n) writes that number into this cell. Cells that read this one
// are told "it changed!" each time.
every('1s', (n) => show(n))

// Show 0 right away, before the first tick.
show(0)`,
  ],
  [
    'E27',
    `// Reads A27: wakes up on every tick without any timer of its own.
// It is lazy in a clever way: it just waits for A27 to nudge it.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Read A27's text and turn it into a number. If that fails, use 0.
const t = Number(at('A27').text) || 0

// % is the remainder after dividing. t % 2 is 0 for even, 1 for odd.
// 0 counts as "no" and 1 as "yes", so odd numbers say 'tick', even 'tock'.
show(t % 2 ? 'tick' : 'tock')

// Same question for colour: green on odd, yellow on even.
color(t % 2 ? '#d9e8dd' : '#f2e4bd')`,
  ],
  [
    'I27',
    `// A timer can write into other cells. Y27 is an empty cell; Q27 reads it.
// Y27 acts like a mailbox: this cell posts letters, Q27 reads them.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Every 2 seconds run the recipe. n counts the rings: 1, 2, 3...
every('2s', (n) => {
  // at('Y27') points at the far-away cell Y27. show replaces its text.
  at('Y27').show(\`Letter number \${n}\`)
})

// print adds a line here, so we know what this cell is doing.
print('Posting into Y27 every 2 seconds')`,
  ],
  [
    'M27',
    `// on() with a range: wakes up once when something in rows 5 and 6 changes.
// 'A5:J6' means from A5 to J6: two rows across the middle of the board.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Watch the whole range. square is the one square that changed.
on('A5:J6', (square) => {
  // Add 1 to the saved counter. ?? 0 starts it at 0 the first time.
  memory.n = (memory.n ?? 0) + 1

  // Show which square changed and the total. The two-character code in the
  // text below makes a new line.
  show(\`\${square.address} changed\\n\${memory.n} changes in rows 5-6\`)
})

// Start text, shown before anything changes.
show('Watching rows 5 and 6…')`,
  ],
  [
    'Q27',
    `// The mailbox reader: it never runs a timer, it just reads Y27.
// Whenever Y27 gets a new letter, this cell wakes up and shows it.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Read the text currently in Y27 and keep it in a box called mail.
const mail = at('Y27').text

// If mail has some text, show 'Got: ' plus it. If it is empty, say so.
show(mail ? \`Got: \${mail}\` : 'No mail yet')`,
  ],
  [
    'U27',
    `// A cell can ask who uses whom: the same lists as right-click → Used by / Reads.
// Like asking "who is your friend?" and "whose friend are you?".

// 4 columns wide, 2 rows tall.
span(4, 2)

// Point at the cell E24 and keep that pointer in a box called e24.
const e24 = at('E24')

// e24.usedBy is a list of the cells that read E24. join(', ') glues the list
// into one text with commas. The || 'nobody' is the "or" for an empty list.
// cell.reads is the list of cells that THIS cell reads.
show(\`E24 is read by: \${e24.usedBy.join(', ') || 'nobody'}\\nI read: \${cell.reads.join(', ')}\`)`,
  ],
  [
    'A30',
    `// A cell can resize other cells. I30 grows by one column every 5 moves.
// Like a boss telling another cell: "be this wide!".

// 4 columns wide, 2 rows tall.
span(4, 2)

// Work out the width. moveCount / 5 is how many groups of five moves were
// played. Math.floor rounds down (7.9 becomes 7). We add 2 as a minimum
// width, and Math.min stops it from going over 6.
const wide = Math.min(6, 2 + Math.floor(game.moveCount / 5))

// at('I30') points at cell I30. span(wide, 2) sets its size: wide columns,
// 2 rows.
at('I30').span(wide, 2)

// Report the new width.
show(\`I30 is \${wide} columns wide\`)`,
  ],
  [
    'I30',
    `// I draw a bar as wide as I am. A30 resizes me; right-click → Size works too.
// There is no span() here: A30 decides how wide I am.

// '#'.repeat(3) gives '###': repeat copies a text that many times.
// cell.cols is how many columns wide this cell is. So the bar is 3 hash
// signs per column. A box called bar holds the text.
const bar = '#'.repeat(cell.cols * 3)

// Put the bar into the cell.
show(bar)

// Paint the cell light blue.
color('#dbe2ec')`,
  ],
  [
    'Q30',
    `// sheet.mode and sheet.rows are reactive: no on() needed.
// Press "Show code" or insert a row (right-click a row number) to see me change.
// sheet is the whole spreadsheet. mode says what you see now: code or output.
// 'Reactive' means: this cell updates itself when those values change.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Show two lines: the mode and the number of rows. The two-character code
// inside the text below makes a new line.
show(\`Mode: \${sheet.mode}\\nRows: \${sheet.rows}\`)`,
  ],
  [
    'U30',
    `// on('sheet', 'rows', fn): fn runs when a row is inserted.
// The sheet is a grid of rows. This cell counts how often you add one.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Watch the rows of the sheet. Run the recipe each time they change.
on('sheet', 'rows', () => {
  // Add 1 to the saved counter. ?? 0 starts from 0 the first time.
  memory.inserted = (memory.inserted ?? 0) + 1

  // Show the new total.
  show(\`Rows inserted: \${memory.inserted}\`)
})

// Starting text: the saved count (or 0) plus a hint on how to insert a row.
show(\`Rows inserted: \${memory.inserted ?? 0}\\nRight-click a row number → Insert row\`)`,
  ],
  [
    'A33',
    `// A robot with an on/off switch: click me. It plays Red whenever it is Red's turn.
// memory.on remembers if the robot is switched on (true) or off (false).

// 4 columns wide, 2 rows tall.
span(4, 2)

// label is a small function that shows the switch state in words.
// The ? : picks the text for 'on' or for 'off' (two lines each).
const label = () => show(memory.on ? 'Robot is playing Red.\\nClick to stop.' : 'Robot is asleep.\\nClick to wake it.')

// Here we define a function with a name, play. 'async' lets it wait
// (sleep) in the middle without freezing everything else.
async function play() {
  // return means "stop here". ! means NOT. Stop if the robot is off, or the
  // game is not in play, or it is not Red's turn. (|| means "or".)
  if (!memory.on || game.phase !== 'play' || game.turn !== 'red') return

  // Wait half a second (500 ms) so you can follow the game with your eyes.
  await sleep(500)

  // Check again: the situation could have changed while we waited.
  if (!memory.on || game.turn !== 'red') return

  // Get all the legal moves for red.
  const moves = game.legalMoves('red')

  // Choose one at random. Math.random() is between 0 and 1; times the list
  // length and rounded down gives a random place in the list.
  const pick = moves[Math.floor(Math.random() * moves.length)]

  // If there is a move to make, play it (from one square to another).
  if (pick) game.move(pick.from, pick.to)
}

// When this cell is clicked, flip the switch.
on(cell, 'click', () => {
  // ! flips true to false and false to true, like a light switch.
  memory.on = !memory.on

  // Update the text so it matches the new state.
  label()

  // Try playing straight away (it checks if it is allowed).
  return play()
})

// After every change in the game, try to play: it is the robot's chance.
on('game', play)

// Show the switch state at the start.
label()`,
  ],
  [
    'E33',
    `// Remember what you saw last time (memory) and compare: flash every square that changed.
// It is a game of "spot the difference" between two photos of the board.

// 4 columns wide, 2 rows tall.
span(4, 2)

// memory.seen is our old photo: a table with square addresses on the left
// and what stood there on the right. ??= makes an empty one the first time.
// 'Record<string, string>' just tells TypeScript: text keys, text values.
const seen: Record<string, string> = (memory.seen ??= {})

// Count how many squares are different this time. Starts at 0.
let changed = 0

// Visit every square of the board, one by one.
for (const square of range('A1:J10')) {
  // JSON.stringify turns the piece into plain text (so we can compare it).
  const now = JSON.stringify(square.piece)

  // Different from the photo? !== means "is not equal". We need the old photo
  // to exist (!== undefined), otherwise the first run flashes everything.
  if (seen[square.address] !== undefined && seen[square.address] !== now) {
    // Flash this square orange for a moment.
    square.flash('#ffd27f')

    // Count it.
    changed++
  }

  // Update the photo for next time.
  seen[square.address] = now
}

// Report the count.
show(\`\${changed} squares changed\`)`,
  ],
  [
    'I33',
    `// A thinking clock: seconds since the last move. A timer and a watcher share one variable.
// Both parts use the same box, secs: the timer adds, the watcher resets.

// 4 columns wide, 2 rows tall.
span(4, 2)

// A box that can change. It counts the seconds, starting at 0.
let secs = 0

// Every second: ++secs adds 1 first and then gives the new number.
// The arrow => makes a little recipe; show prints the sentence.
every('1s', () => show(\`\${++secs}s since the last move\`))

// After any change in the game (a move!), run this recipe.
on('game', () => {
  // Start counting from zero again.
  secs = 0

  // Show it straight away.
  show('0s since the last move')
})

// Starting text, before any timer ring.
show('0s since the last move')`,
  ],
  [
    'M33',
    `// A slow cell: await sleep() lets all the other cells carry on while this one counts.
// await means "wait here until this is done", but only for THIS cell.

// 4 columns wide, 2 rows tall.
span(4, 2)

// A loop that counts i from 0 to 10. 'i <= 10' is the keep-going question,
// and i++ adds one after every round.
for (let i = 0; i <= 10; i++) {
  // Draw a progress bar: i hash signs, then dots to fill up to 10 places.
  // repeat copies a text that many times.
  show('#'.repeat(i) + '.'.repeat(10 - i))

  // Pause for 300 milliseconds (a bit less than a third of a second).
  await sleep(300)
}

// The loop is over, so the bar is full. Say so.
show('Done! Nobody had to wait for me.')`,
  ],
  [
    'Q33',
    `// Mistakes inside a timer show up on the cell and stop that timer.
// On tick 3 something goes wrong. Fix it and press Ctrl+Enter.
// A bug is a mistake in a program. This one is on purpose: find it!
// Hint: read the recipe inside every() slowly. What happens when n is 3?
// What does JSON.parse expect to receive? Is the text it gets valid?

// 4 columns wide, 2 rows tall.
span(4, 2)

// Every 2 seconds run the recipe. n is the tick number: 1, 2, 3...
every('2s', (n) => {
  // This line is meant to read a piece of text and understand it (parse).
  // It only runs on tick 3. Look closely at the text between the quotes.
  if (n === 3) JSON.parse('{oops')

  // Show the tick number (this works fine on the other ticks).
  show(\`tick \${n}\`)
})

// Starting text, before the first tick.
show('tick 0')`,
  ],
  [
    'U33',
    `// What one cell can do to others: color, textColor, print, show, view, flash.
// Each line below is aimed at a different cell in column Y.

// 4 columns wide, 2 rows tall.
span(4, 2)

// range('Y33:Y36') is a group: the four cells Y33, Y34, Y35, Y36.
// color paints all four a soft yellow in one go.
range('Y33:Y36').color('#f2e4bd')

// print ADDS a new line of text. Two prints in a row give two lines.
at('Y33').print('print adds a line').print('and another')

// show REPLACES the text. The second show wipes out the first one.
at('Y34').show('show replaces').show('the text')

// view sets what the cell shows in View mode. textColor changes the colour
// of the letters (here a dark red).
at('Y35').view('view is what View mode shows').textColor('#7a3b3b')

// flash lights the cell up for a moment, to catch your eye.
at('Y36').flash('#ffd27f')

// And in this cell, tell the reader where the action is.
show('Look at Y33 to Y36 →')`,
  ],
  [
    'A36',
    `// Cheat sheet. Right-click any cell for Used by, Reads, Size and Stop timers.
// Move a cell and the addresses in code follow it, so keep them as plain text: at('B7')
// This cell is a cheat sheet: a short list to look things up in.

// 8 columns wide, 3 rows tall: roomy, because there are many lines to show.
span(8, 3)

// Paint it light grey, like a piece of paper.
color('#ece8de')

// Each print adds one line of text. This list explains on(x, fn):
// 'x' can be a cell, a range or the game, and fn runs when it changes.
print('on(x, fn)             x changed (cell, range, game)')

// Double quotes work for text just like single quotes. We use them here
// because the text itself contains single quotes.
print("on(x, 'size', fn)     x was resized")
print("on(x, 'code', fn)     x had its code edited or moved")
print("on(x, 'click', fn)    x was clicked")

// The vertical bar | in the text just means "or", it is not code here.
print("on('sheet', 'rows' | 'mode', fn)")

// every(t, fn) repeats; after(t, fn) runs once later; stop() ends timers.
print('every(t, fn) · after(t, fn) · stop()')

// memory is the cell's notebook; run.reason says why the cell is running.
print('memory: notebook that survives re-runs · run.reason')`,
  ],
  [
    'Q12',
    `// A ticker: text that slides one letter every second. It reads and writes nothing else.
// Like the news banner at the bottom of a TV screen.

// 4 columns wide, 2 rows tall.
span(4, 2)

// The message, with spaces around it so there is a gap before it repeats.
const news = '   Lattakker: move the armies, watch the cells work   '

// pos is our position in the message. It changes, so we use let.
let pos = 0

// Every second, slide one letter along.
every('1s', () => {
  // Add 1 to pos. % (remainder) makes it jump back to 0 at the end of the
  // message, so the text goes round and round like a clock hand.
  pos = (pos + 1) % news.length

  // Put the message twice in a row, then cut out a window of 14 letters
  // starting at pos. slice(start, end) cuts a piece of text.
  show((news + news).slice(pos, pos + 14))
})

// Show the first 14 letters straight away.
show(news.slice(0, 14))`,
  ],
  [
    'U12',
    `// A clock with a running timer. It only looks at the computer's time, not at the game.
// Two things appear: the time of day and how long this cell has been open.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Date.now() is the current time as a number of milliseconds. We save the
// moment we started, so we can measure how long ago that was.
const started = Date.now()

// tick is a small function stored in a box (the arrow => creates it).
// new Date().toLocaleTimeString() is the clock time as text, like 10:36:31.
// The difference now minus started, divided by 1000 and rounded down with
// Math.floor, is the number of whole seconds. The two-character code in
// the quotes below makes a new line.
const tick = () => show(new Date().toLocaleTimeString() + '\\n' + Math.floor((Date.now() - started) / 1000) + ' s open')

// Run tick every second.
every('1s', tick)

// And run it once right now, so we do not wait a whole second for text.
tick()`,
  ],
  [
    'Q15',
    `// after(time, fn) runs once, later. Nothing repeats and no timer is left behind.
// every() is a repeating alarm. after() is a single alarm that rings once.

// 4 columns wide, 2 rows tall.
span(4, 2)

// This shows right away: a message while we wait.
show('Fuse lit… ready in 4 seconds')

// After 4 seconds run the recipe once (the arrow => makes it) and replace
// the text with 'Ready!'.
after('4s', () => show('Ready!'))`,
  ],
  [
    'U15',
    `// on('sheet', 'mode', fn) runs each time the sheet switches mode. Press "Show code" to count.
// The mode is how the sheet looks: showing code, or showing the results.

// 4 columns wide, 2 rows tall.
span(4, 2)

// Watch the sheet's mode. The recipe runs on every switch.
on('sheet', 'mode', () => {
  // Add 1 to the saved count (?? 0 starts it at 0 the first time).
  memory.switches = (memory.switches ?? 0) + 1

  // Show the count and the new mode. The two-character code in the text
  // makes a new line. The + glues the pieces of text together.
  show('Mode switched ' + memory.switches + ' time(s)\\nNow: ' + sheet.mode)
})

// Starting text: the current mode and a hint.
show('Now: ' + sheet.mode + '\\nSwitch modes to count')`,
  ],
  [
    'U18',
    `// game.captured('red') lists the Red pieces that were taken.
// The counts update after each capture.
// Captured means a piece was beaten and left the board.

// 4 columns wide, 2 rows tall.
span(4, 2)

// draw is a function kept in a box. Each time it is called it asks the game
// for the captured pieces of each colour, counts them with .length, and
// shows both numbers. The two-character code in the text is a new line.
const draw = () => show('Red pieces lost: ' + game.captured('red').length + '\\nBlue pieces lost: ' + game.captured('blue').length)

// Call draw after every change in the game, so the numbers stay fresh.
on('game', draw)

// And call it once now, so we see numbers before the first change.
draw()`,
  ],
  [
    'I36',
    `// on('game', fn) runs after every move. Here: how many moves Red can choose from right now.
// A "choice" is a legal move. The more choices, the more freedom Red has.

// 4 columns wide, 3 rows tall.
span(4, 3)

// draw is a function in a box. It builds the text in this order:
// If the game is in the play phase, show the number of legal moves for red
// (.length counts a list), then add a second line (the two-character code
// makes it): 'Your turn!' if it is Red's turn, else 'Waiting for Blue'.
// If the game is not in play yet, show 'Setting up'. ? : is a quick if.
const draw = () => show(game.phase === 'play'
  ? game.legalMoves('red').length + ' legal moves for Red\\n' + (game.turn === 'red' ? 'Your turn!' : 'Waiting for Blue')
  : 'Setting up')

// Call draw after every change in the game.
on('game', draw)

// And once now, so the cell is not empty at the start.
draw()`,
  ],
  [
    'M36',
    `// A progress bar: one block for every four moves.
// Like a loading bar that fills up while the game goes on.

// 4 columns wide, 3 rows tall.
span(4, 3)

// Paint the cell soft purple.
color('#e3dcee')

// draw is a function: a recipe in a box that we can run many times.
const draw = () => {
  // moveCount / 4 gives how many full groups of four moves were played.
  // Math.floor rounds down; Math.min keeps it at most 10 (the bar length).
  const n = Math.min(10, Math.floor(game.moveCount / 4))

  // Filled part: n hash signs. Empty part: 10 - n dots. Then the move count.
  show('[' + '#'.repeat(n) + '.'.repeat(10 - n) + '] ' + game.moveCount + ' moves')
}

// Redraw after every change in the game.
on('game', draw)

// And once now, for the starting picture.
draw()`,
  ],
  [
    'Q36',
    `// game.history holds every move. This cell shows the last eight pieces that moved.
// History is a list: the first move is first, the newest move is last.

// 4 columns wide, 3 rows tall.
span(4, 3)

// draw is a function in a box. slice(-8) keeps the last eight moves. map
// turns each move m into just its piece name. join(' ') glues the names
// together with spaces. The || 'or' shows 'No moves yet' if the list is empty.
const draw = () => show(game.history.slice(-8).map((m) => m.piece).join(' ') || 'No moves yet')

// Redraw after every change in the game.
on('game', draw)

// And once now.
draw()`,
  ],
  [
    'U36',
    `// Pieces still on the board, as bars: one block for every two pieces.
// A bar chart made from letters!

// 4 columns wide, 3 rows tall.
span(4, 3)

// draw is a function: a recipe in a box that we can run whenever we want.
const draw = () => {
  // Count the red pieces, and keep the number in a box called red.
  const red = game.pieces('red').length

  // Same for blue.
  const blue = game.pieces('blue').length

  // Math.ceil rounds UP (3 / 2 = 1.5 becomes 2). One block per two pieces.
  // repeat copies the block that many times. The two-character code in the
  // text makes a new line, so Red and Blue sit on two rows.
  show('Red  ' + '█'.repeat(Math.ceil(red / 2)) + ' ' + red + '\\nBlue ' + '█'.repeat(Math.ceil(blue / 2)) + ' ' + blue)
}

// Redraw after every change in the game.
on('game', draw)

// And once now.
draw()`,
  ],
  [
    'A39',
    `// try / catch: a wrong address does not break the cell. The error is caught and shown instead.
// Think of a safety net under a trapeze artist: if something falls, the net
// catches it, and the show goes on.

// 6 columns wide, 2 rows tall.
span(6, 2)

// try means "have a go at this code, and watch out for mistakes".
try {
  // ZZ99 is not a real cell, so asking for it makes an error.
  // The error jumps straight to the catch part below.
  at('ZZ99').show('never shown')

// catch runs only if something went wrong. err holds the error.
} catch (err) {
  // err.message is the error's description in words. We show it politely.
  show('Not a cell: ' + err.message)
}`,
  ],
  [
    'M39',
    `// A rainbow: every 150 ms the colour moves a little further round the
// colour wheel (hue 0 to 360).
// Change 150ms for a faster or slower rainbow, or 'step' for bigger jumps.
// Hue is the "which colour" part of a colour: red, orange, yellow, green...

// 4 columns wide, 2 rows tall.
span(4, 2)

// hsl is a function that turns a hue angle h (0 to 360) into a colour code.
// h is required. s (saturation, how vivid) and l (lightness, how bright)
// have default values 70 and 82 after the equals sign: soft pastel colours.
// You do not need to understand the maths inside; treat it as a magic box.
const hsl = (h: number, s = 70, l = 82) => {
  // f works out one colour channel (red, green or blue) for this hue.
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))

    // Turn the 0..1 number into 0..255, then into two hex digits (base 16).
    return Math.round(255 * v).toString(16).padStart(2, '0')
  }

  // Colour codes look like #rrggbb: glue the three channels after a #.
  return '#' + f(0) + f(8) + f(4)
}

// How many degrees round the wheel we turn per tick. Try a bigger number!
const step = 4

// Every 150 milliseconds run the recipe. n is the tick number.
every('150ms', (n) => {
  // n * step is how far we have turned. % 360 wraps back to 0 after a full
  // circle (the remainder after dividing by 360).
  const hue = (n * step) % 360

  // Paint the cell with that colour.
  color(hsl(hue))

  // Show the hue number, with the degree sign.
  show('hue ' + hue + '°')
})

// Start with hue 0 right away, before the first tick.
color(hsl(0))
show('hue 0°')`,
  ],
  [
    'W15',
    `// A rainbow wave: this cell paints W16 to W26 below it, each one a bit
// further round the wheel.
// Each cell below gets a slightly different colour, so together they look
// like a wave of colour that moves down the column.

// Only 1 column wide and 1 row tall: a tiny cell.
span(1, 1)

// hsl is a function: give it a hue (0 to 360) and it gives back a colour.
// The maths inside is a colour recipe. Treat it as a magic box.
const hsl = (h: number) => {
  // f works out one colour channel (red, green or blue).
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const a = 0.7 * 0.18

    // Make a number from 0 to 255, then turn it into two hex digits.
    return Math.round(255 * (0.82 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }

  // Glue the three channels after a # to make a colour code.
  return '#' + f(0) + f(8) + f(4)
}

// range() is called inside the timer on purpose: a cell that reads the
// squares it paints would wake itself up.
// Every 200 milliseconds run the recipe. n counts the ticks.
every('200ms', (n) => {
  // forEach does something for each cell in the group. square is the cell,
  // i is its number in the group: 0 for W16, 1 for W17, and so on.
  // Each gets a hue that depends on the tick n and its place i, so the
  // colours shift down the column. % 360 wraps around the wheel.
  range('W16:W26').forEach((square, i) => square.color(hsl((n * 6 + i * 30) % 360)))
})

// A little mark in this cell so it is not empty.
show('~')`,
  ],
  [
    'G39',
    `// Click me to cycle my colour. memory keeps the choice, even when the code is edited.
// Like a paint pot with five colours: each click picks the next one.

// 6 columns wide, 2 rows tall.
span(6, 2)

// A list (array) of five colour codes, written between square brackets
// and separated by commas. The first item is number 0, the second 1, etc.
const palette = ['#d9e8dd', '#f2e4bd', '#f0d8d5', '#e3dcee', '#dbe2ec']

// memory.step remembers which colour we are on. ??= sets it to 0 only if
// it has no value yet, so editing the code does not reset it.
memory.step ??= 0

// paint is a function in a box: it applies the current colour and text.
const paint = () => {
  // % is the remainder after dividing: step % 5 loops 0,1,2,3,4,0,1,...
  // so we never run past the end of the list.
  cell.color(palette[memory.step % palette.length])

  // Show 'Colour 3 of 5 (click me)'. We add 1 because people count from 1.
  show('Colour ' + (memory.step % palette.length + 1) + ' of ' + palette.length + ' (click me)')
}

// On every click on this cell:
on(cell, 'click', () => {
  // Move to the next colour, then redraw.
  memory.step++
  paint()
})

// Draw once at the start so the cell is coloured before any click.
paint()`,
  ],
  [
    'R39',
    `// plot() turns the output into an XY plot. Try Math.cos, or (x) => x * x, or change from and to.
// A plot is a picture of a function: for each x on the line, it draws the
// height y. sin and cos are the famous wave functions from maths class.

// 4 columns wide, 2 rows tall.
span(4, 2)

// plot gets two things. First: curves to draw, as name and function pairs
// inside curly brackets { }. Math.sin and Math.cos are ready-made functions.
// Second: settings. from and to say where x starts and ends (6.28 is about
// one full circle, 2 times pi). title is the heading of the plot.
plot({ sin: Math.sin, cos: Math.cos }, { from: 0, to: 6.28, title: 'Waves' })

// Also write a little caption into the cell as text.
show('sin and cos')`,
  ],
  [
    'A42',
    `// Paths, part 2: more spellings, and a cell that WATCHES another tab's cell.
// This cell counts how often the Lab's rocket cell changes. If you move the
// rocket, the path in this code is rewritten to follow it.

// 5 columns wide, 3 rows tall.
span(5, 3)

// A path can be written like a web address (a URI) that starts with
// lattakker:/// - it means exactly the same as /lab/J24. Tools use this form.
const rocket = at('lattakker:///lab/J24')

// memory is this cell's notebook. If it has no counter yet, start at 0.
// (?? means: use the right side when the left side is empty.)
memory.changes = memory.changes ?? 0

// draw is a recipe that fills this cell: its own path and tab, the rocket's
// path and size, its latest text, and our counter. \\n starts a new line.
const draw = () => show(
  'I am ' + cell.path + ' (tab ' + cell.tab + ')\\n' +
  'Watching ' + rocket.path + ', size ' + rocket.cols + 'x' + rocket.rows + '\\n' +
  'Latest: ' + String(rocket.text).split('\\n')[0] + '\\n' +
  'The rocket cell changed ' + memory.changes + ' times'
)

// on(path, recipe) works across tabs: the recipe runs EVERY time that cell of
// the Lab changes. Click the button next to this cell to make it change.
on('/lab/J24', () => {
  // Count the change...
  memory.changes++

  // ...and draw again.
  draw()
})

// Draw once right now, so the cell is not empty before the first change.
draw()`,
  ],
  [
    'G42',
    `// MCP part 1: ask another tab a question, the way an AI helper would.
// MCP is a small language of messages. Every tab (board, lab) answers it.
// at() reads a neighbour instantly; mcp asks by message, so the answer takes
// a moment and we must wait for it with await.

// 6 columns wide, 3 rows tall.
span(6, 3)

// mcp.servers() lists the tabs that answer messages.
const servers = mcp.servers()

// mcp.read('/lab/J24') asks the Lab for its cell J24 and gives back a plain
// object: its path, text, code, size... await = wait here for the answer.
const rocket = await mcp.read('/lab/J24')

// mcp.list('lab') asks the Lab for all of its cells that hold code.
const cells = await mcp.list('lab')

// Every server also has tools: things it can do for you. Ask which ones.
const tools = (await mcp.call('lab', 'tools/list')).tools.map((t) => t.name)

// Show the answers. .join(', ') glues a list into one text with commas.
show(
  'MCP servers: ' + servers.join(', ') + '\\n' +
  rocket.path + ' says: ' + rocket.text.split('\\n')[0] + '\\n' +
  'its identity: ' + rocket.uid + '\\n' +
  'The Lab has ' + cells.length + ' cells with code\\n' +
  'Lab tools: ' + tools.join(', ')
)`,
  ],
  [
    'M42',
    `// MCP part 2: a remote control. Click this cell and it clicks the Lab's
// rocket over MCP: a TRIGGER that crosses from one tab to another.

// 4 columns wide, 3 rows tall, with a purple background like a button.
span(4, 3)
color('#e3dcee')

// memory is this cell's notebook: how often we pressed the remote.
memory.clicks = memory.clicks ?? 0

// A box for the rocket's latest words. let = a box that may change later.
let rocket = '...'

// draw fills this cell. We call it again whenever something changes.
const draw = () => show(
  '🚀 Click me: remote start\\n' +
  'Rocket says: ' + rocket + '\\n' +
  'Remote starts: ' + memory.clicks
)

// mcp.watch follows a cell of another tab. Its recipe runs now and again
// every time the rocket changes. The news arrives as an MCP notification.
mcp.watch('/lab/J24', (c) => {
  // c is the rocket cell. Keep its first line of text...
  rocket = c.text.split('\\n')[0]

  // ...and show it.
  draw()
})

// When THIS cell is clicked, send a click message to the Lab's J24.
on(cell, 'click', async () => {
  // The Lab's cell reacts exactly as if a person had clicked it.
  await mcp.click('/lab/J24')

  // Count it and show it.
  memory.clicks++
  draw()
})

// Draw once now, before anything happens.
draw()`,
  ],
  [
    'Q42',
    `// MCP part 3: shout across tabs. A click here sends a signal called 'wave'.
// A cell in the Lab (A31) listens for it and shouts 'echo' back to us.

// 4 columns wide, 3 rows tall, light blue like a button.
span(4, 3)
color('#dbe8ec')

// memory: how many waves we sent. The ?? 0 starts at 0 the first time.
memory.sent = memory.sent ?? 0

// A box for the last echo we heard (it changes later, so let).
let echo = 'nothing yet'

// draw fills this cell.
const draw = () => show(
  'Click me: shout wave ' + (memory.sent + 1) + '\\n' +
  'Waves sent: ' + memory.sent + '\\n' +
  'Echo from the Lab: ' + echo
)

// mcp.on('echo', recipe) hears signals named echo from ANY tab. The recipe
// gets the data that was sent and the name of the cell that sent it.
mcp.on('echo', (data, from) => {
  // Remember what we heard and who said it...
  echo = data + ' (from ' + from + ')'

  // ...and show it.
  draw()
})

// When this cell is clicked, shout a new wave to every listening cell.
on(cell, 'click', () => {
  // Count the wave.
  memory.sent++

  // mcp.emit(name, data) tells every cell in every tab that is listening.
  mcp.emit('wave', memory.sent)

  // Show the new count.
  draw()
})

// Draw once now.
draw()`,
  ],
  [
    'U42',
    `// MCP part 4: a window on the traffic. Every message between cells and tabs
// goes through one router, and mcp.tap lets us watch them go by.
// Click the other MCP cells and see what they say to each other.

// 6 columns wide, 3 rows tall, a pale paper colour.
span(6, 3)
color('#f4f1e8')

// line(m) turns one message into a short line of text.
const line = (m) => {
  // A little picture for each kind of message.
  const mark = { request: '->', response: '<-', error: 'X ', notification: '(!)' }[m.kind]

  // Who sent it, who gets it, and what it is about. replace() shortens the name.
  return mark + ' ' + m.from + ' ' + m.to + ' ' + m.method.replace('notifications/', '')
}

// Start with the last 8 messages that already went by (map turns each message
// into a line of text).
const lines = mcp.recent(8).map(line)

// pending: have we already planned a redraw? (true or false)
let pending = false

// draw shows the lines, one under the other.
const draw = () => {
  // The planned redraw is happening now, so nothing is planned any more.
  pending = false
  show(lines.join('\\n'))
}

// mcp.tap runs its recipe for EVERY message, the moment it is sent.
mcp.tap((m) => {
  // Add the new line at the end...
  lines.push(line(m))

  // ...and forget the oldest one when there are more than 8.
  if (lines.length > 8) lines.shift()

  // Redraw soon, but not for every single message (that would be too busy).
  if (!pending) {
    pending = true
    after('120ms', draw)
  }
})

// Draw once now.
draw()`,
  ],
];
