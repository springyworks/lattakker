# Lattakker Sheet

A Lattakker board combined with a spreadsheet. The board is a grid of cells
like any other, each cell has an address (A1, C7, M14), and any cell below
the board can hold a small piece of TypeScript that runs, reads other
cells, and draws on the board. Everything is rendered through maxGraph; the
Monaco editor is used for code editing.

Live demo: https://springyworks.github.io/lattakker/

## Requirements

- Node.js 18 or later
- npm

## Running locally

```
npm install
npm run dev
```

Open the printed local address in a browser. The game starts in setup
phase with both armies placed randomly.

Other commands:

```
npm run build       # type-check, then produce a production build in dist/
npm run preview      # serve the production build locally
npm run typecheck    # type-check only, no build output
```

## Playing Lattakker

- Both sides have 40 pieces. Red is yours, Blue's pieces are face down
  until revealed by combat.
- Every piece shows one big insignia (a plain Unicode symbol, free to use),
  its number, its name and a ten-step strength meter. Bomb and flag have
  their own pictures.
- Every move (one step or a long Scout jump) leaves an arrow: amber for
  Red, teal for Blue. Arrows fade on a logarithmic scale, so the latest
  move is bold and older ones thin out and nearly vanish within about ten
  seconds (the last 14 are kept). Undo removes the arrows of undone moves.
- Click a red piece, then click a highlighted square to move it. Scouts
  (rank 2) can move any distance in a straight line.
- Click a highlighted enemy square to attack it. The higher rank wins;
  equal ranks are both removed.
- Bombs beat every attacker except Miners (rank 3). The Spy (rank 1) beats
  the Marshal (rank 10) only when the Spy is the attacker.
- Capture the enemy flag to win.
- The cockpit sits on the sheet grid, columns L to Q and rows 1 to 10, so
  every part has an A1-style name (for example the Start button is L5:N5).
  Buttons are never hidden: unavailable ones are greyed out and explain
  themselves when pressed. Hover any part for its helper text.
  The big button at the left starts the battle, then becomes **Pause**,
  and while paused it says **Continue** (nobody can move, not even Blue).
  The others: shuffle, undo, new game, how to play, show code/output, and
  the code editor for the last-selected cell.

## Saved in your browser

The game (including Undo history) and every code cell are saved
automatically in this browser's own storage (`localStorage`, key
`lattakker:v1`), a moment after every change. Reload the page and you carry on
where you stopped. Nothing is sent anywhere. To start completely fresh, run
`localStorage.removeItem('lattakker:v1')` in the browser console and reload.

## The sheet

Cells outside the board (row 12 and below in the examples, but any row
after the board works) can hold code. A cell with code shows either its
source (view mode) or what it printed (run mode); the mode toggle button
switches both at once.

To edit a cell:

- Double-click it to open it in a popup Monaco editor. Drag its title bar to
  move it, double-click the title bar to fill the screen (and again to go
  back), and resize it from its corner handle.
- Or, in view mode, type directly into the cell on the sheet itself. A
  small grip icon in the corner of the cell lets you drag the cell's
  content (code, output, colour, span) to another, empty cell.
- To move a cell, or a merged block of cells, from anywhere on it: hold
  Ctrl (Cmd on a Mac) and drag, or on a touch screen tap, then tap again
  and hold, and move. The block follows your finger and snaps to the grid.
  If the new place is not free it springs back.

Inside the popup editor: Ctrl+Enter runs the code once without closing the
editor, Escape saves and closes.

## Your first program (start here)

You do not need to know any programming to begin. The game works as it is:
press **Start the battle!**, click a red piece, click a dot. Below the board
are some grey-green cells that already do things: one counts the pieces, one
paints the board, one tells whose turn it is. They update by themselves after
every move. They are small programs, written in **TypeScript**.

1. Click a cell such as `A12` and press **Show code** (or double-click the cell).
   You are now reading the program that makes the numbers.
2. Change `'red'` to `'blue'`, press **Ctrl+Enter**. The numbers change.
3. Click an empty cell, double-click it and type `print('Hello!')`. Press
   Ctrl+Enter. That is your first program.
4. Make it alive:

   ```ts
   every('1s', (n) => show(`${n} seconds`))
   ```

   A stopwatch. Replace `'1s'` with `'500ms'` for twice as fast.
5. Make it react to the game:

   ```ts
   on('game', () => show('Move number ' + game.moveCount))
   ```

TypeScript is JavaScript with labels that catch mistakes while you type
(`let age: number = 10`; try `age = 'ten'` and the editor underlines it). If
you know Java or C#, it will feel familiar: classes, interfaces, generics,
`async`/`await`. It is "Java, only lighter and it runs in every browser".
Everything you can use inside a cell is listed below.

## Programmer's manual: the cell API

Each cell's code runs in its own scope, so names never clash between cells.
Top-level `await` works. The editor shows these names with help text as you type.

### Output and looks

| Call | What it does |
|---|---|
| `print(...values)` | Add a line to this cell's output (shown in run mode). Only the last 300 lines are kept. |
| `show(...values)` | Replace the output with one line. Use this for displays that update in place. |
| `clear()` | Empty the output. |
| `view(text)` | Replace what is shown in view mode (default: the code itself). |
| `color(fill)` | Background colour, e.g. `'#ffd6e7'` or `'lightgreen'`. |
| `log(...values)` | Like `print`, and also writes to the browser console. |
| `span(cols?, rows?)` | Merge the cell over `cols` x `rows` cells (never over the board). Leave one out to keep it: `span(4)` keeps the rows. With no arguments it changes nothing and returns `{ cols, rows }`. |

The cell's size can be set (and read) from code. Dragging a cell border to
resize it is deliberately not offered: rewriting your `span(...)` line behind
your back would fight with the code you are typing. The code is the single
source of truth for the size.

### The cell itself and other cells

`cell` is the cell the code lives in. `at('B7')` gives any other cell, and
`range('A1:J10')` (or `range('C32-55')`, a column down) an array of cells.
Every cell reference has:

| Member | Meaning |
|---|---|
| `.address`, `.col`, `.row` | Where it is (`'B7'`, column 1, row 6; both start at 0). |
| `.text` | The text shown in it right now. |
| `.code` | Its source code, if any. |
| `.piece` | The piece standing on this square (board squares only), or `null`. |
| `.isBoard`, `.isLake` | Is it on the board; is it a lake. |
| `.cols`, `.rows` | How many columns and rows it covers. |
| `.usedBy` | Addresses of cells whose code read this cell (they re-run when it changes). |
| `.reads` | What this cell's code read last time it ran (`'game'` counts too). |
| `.print()`, `.show()`, `.clear()`, `.view()`, `.color()`, `.textColor()`, `.span()`, `.flash()` | Write into that cell. They return the cell, so you can chain: `at('L12').print('Hi').color('#f2e4bd')`. |

A range also has `.color(fill)` and `.print(...)` that apply to every cell in it.
Right-click any cell for the same information as menus: **Used by** and
**Reads** list the cells (click one to jump to it), and **Stop timers** appears
when the cell has timers running.

### The game

| Call | Meaning |
|---|---|
| `game.phase` | `'setup'`, `'play'` or `'over'`. |
| `game.turn`, `game.winner`, `game.moveCount` | Whose turn, who won (or `null`), moves played. |
| `game.lastMove`, `game.history` | Details of the last move, or of all moves. |
| `game.pieces(color?)` | All pieces on the board (`'red'` / `'blue'` / both), each with an `address`. |
| `game.captured(color)` | Pieces of that colour that were removed. |
| `game.pieceAt('B7', { peek? })` | The piece on a square. `peek: true` shows hidden Blue ranks (cheating, but handy for bots). |
| `game.legalMoves('B7' or 'red')` | Where a piece (or a whole colour) can move. |
| `game.move(from, to)` | Move a red piece, only on Red's turn. Returns a message. |
| `game.say(text)` | Show a message in the game's speech bubble. |

Also: `sheet.mode` (`'run'`/`'view'`), `sheet.cols`, `sheet.rows`, `mode`.

### Time: sleep, every, after

| Call | Meaning |
|---|---|
| `await sleep(500)` | Wait. A number is milliseconds; text works too: `'2s'`. Other cells keep running while you wait. |
| `every(interval, fn)` | Run `fn` again and again. `fn(n)` gets the count 1, 2, 3... `every(fn)` means once a second. |
| `after(interval, fn)` | Run `fn` once, later. |
| `stop()` | Stop every timer and watcher this cell started. |

An *interval* is a number of milliseconds or text: `'250ms'`, `'1s'`, `'1.5s'`,
`'1m'` (a minute), `'1h'`. The shortest allowed is 10 ms. `every` and `after`
return a function that stops just that one: `const off = every('1s', ...)`
and later `off()`.

Rules that keep it simple and safe:

- **Timers belong to the cell.** When the cell runs again (you edited it, or
  something it read changed), is cleared, or is moved, its old timers stop
  first. You cannot pile up timers by pressing Ctrl+Enter ten times.
- A tick that is still busy (its code is waiting on `sleep`) is not started
  twice. The next tick waits; no pile-up.
- If code inside a tick throws an error, the cell shows it and that timer stops.
- After every tick the cell is shown again and **cells that read it re-run**,
  so a clock cell can feed other cells (see below).

### Watching things: on

```ts
on('B7', (square) => show(square.piece?.name ?? 'empty'))
on('A1:J10', (square) => print(square.address + ' changed'))   // once per change
on('game', (g) => show('Move ' + g.moveCount))
```

`on(target, fn)` waits until the cell, any cell of the range, or the `game`
changes, then calls `fn` with the cell that changed (or `game`). Board
squares count as changed only when what stands on them is different. It
returns a function that stops the watcher.

The difference between *reading* and *watching*, which is the one idea worth
remembering:

- **Top level of a cell** (`const n = at('B7').text`): reading makes a
  dependency. The *whole cell* runs again when B7 changes. Good for
  "calculate something from other cells".
- **Inside `every`/`on`/`after`**: reading is free and not tracked. Only the
  function runs again. Good for "keep a counter or a clock".

### Examples

```ts
// A chess clock: counts only while it is Red's turn
let seconds = 0
every('1s', () => { if (game.turn === 'red') show(++seconds + ' s') })
```

```ts
// Show how many cells use this one
every('2s', () => show(cell.usedBy.length + ' cells read me'))
```

```ts
// A cell that waits without blocking the game or other cells
await sleep('3s')
print('three seconds later')
```

The default sheet has a stopwatch in `N12` and a watcher in `N15` to copy from.

## How the cell code is run (internals)

### When does a cell run?

A cell runs in exactly these situations (`src/sheet/Sheet.ts`, `runAll`):

1. you saved or edited its code (also: pressed Ctrl+Enter, or a helper called `mms.setCode`);
2. something it **read** changed (another cell, a board square, or the game);
3. the page loaded, or rows were inserted or content moved (its address changed).

Nothing else. A cell that reads nothing runs once and then waits until you
touch it, just as a plain number in a spreadsheet does not recalculate. The
board and `game` count as changed when a move, undo, shuffle or new game happens.

### Is this reactive programming?

Yes. Reactive programming means: you describe *what depends on what*, and the
system, not you, pushes changes through. A spreadsheet is the best-known
example (`=A1+B1` updates by itself). Frameworks call the same idea signals,
observables or computed values. Here it is implemented like this
(`src/sheet/reactivity.ts`, `DependencyGraph`):

1. **Dependencies are discovered, not declared.** While a cell runs, every
   `at()`, `range()` and `game.*` it uses is recorded as an edge "this cell
   reads that node". You never write a list of dependencies. The edges are
   rebuilt each time the cell runs, so an `if` that reads A1 only sometimes
   gets the edge only sometimes (a *dynamic* dependency graph).
2. **Changes are pushed.** An edit, a move, a timer tick or a finished cell
   marks nodes *dirty* (`markDirty`, `markDependentsDirty`).
3. **Only the affected cells run, in the right order.** `closure()` collects the
   dirty nodes and everything that transitively reads them, then sorts them
   topologically (Kahn's algorithm), so a cell never runs before the cells it
   reads. That avoids the classic "glitch" of showing a half-updated
   result. If cells read each other in a circle, a warning is logged and they
   run in grid order instead of hanging.
4. **Events are the same machinery.** `on()` is a subscription on a node; the
   same "this node changed" fact that re-runs readers also wakes watchers.

What we deliberately do not have: cells are not individual formulas but whole
programs, so a re-run starts the program from the top; and the only
change-detection ("did the value really change?") is for board squares. A
cell that prints the same text again still counts as changed. We checked this
by test: a cell reading `A12` re-runs when `A12` changes; a watcher on `A1`
stays quiet when a piece moves elsewhere, and fires when `A6` changes.

### Multitasking: how several cells and timers run at once

The browser runs your JavaScript on **one thread**, so nothing in a cell
runs truly in parallel. What we get is cooperative multitasking, the same
trick as `async`/`await` in the article that inspired this: a cell hands
control back every time it does `await sleep(...)`, so others can run.

- Every run of a cell has a **run context** (`src/sheet/tasks.ts`). It is the
  owner of the cell's timers, watchers and pending sleeps. Cancelling it
  (re-run, edit, clear, move) stops them all. Code that is still running from
  an old run is stopped at its next call (`print`, `at`, `sleep`, ...).
- Cells run one after another in dependency order. A cell that takes longer
  than **150 ms** (usually: it is waiting in a `sleep`) is moved to the
  background, so the cells after it are not held up. When it finishes, cells
  that read it run again to pick up its result.
- Timers (`every`, `after`) use the browser's timers; `on` uses the same
  change notifications that re-run cells.

Limit to know about: **a loop that never awaits** (`while (true) {}`) cannot
be interrupted, because there is only one thread, and it freezes the page.
Put `await sleep(0)` in a long loop to let others breathe. Web Workers could
give real parallelism, but a worker cannot touch the board or other cells, so
cell code would lose its main feature. We chose not to.

## How TypeScript runs inside a cell (for the curious)

Short answer: it is a **transpiler plus the browser's own JavaScript
engine**. We do not write a compiler or an interpreter ourselves, and
nothing is sent to a server. Everything happens inside the page.

A browser cannot run TypeScript directly; it only understands JavaScript.
TypeScript is JavaScript with extra type notes (`let n: number = 3`). The
trick is to remove the notes and hand the rest to the browser. What
happens when a cell runs (`src/sheet/runtime.ts`, `src/editor/monaco.ts`):

1. **The text lives in a Monaco model.** Each cell's code is a small
   virtual file such as `file:///cells/A12.ts`. This is the same editor
   engine as VS Code.
2. **Monaco's TypeScript worker transpiles it.** Monaco ships the real
   TypeScript compiler and runs it in a Web Worker (a background thread),
   so typing never freezes the page. We ask it two things: "are there
   syntax errors?" and "what is the JavaScript for this?" (`getEmitOutput`,
   target ES2020). Transpiling means translating one language into another
   of the same level, here TypeScript into JavaScript, by erasing the
   types. The result is ordinary text like `let n = 3`.
3. **The browser runs that JavaScript.** The text is wrapped with
   `new AsyncFunction(...names, js)`. `AsyncFunction` is a built-in
   constructor that builds a function from a string; the browser's engine
   (V8, SpiderMonkey, JavaScriptCore) then parses it and compiles it to
   machine code just in time. Because the cell body becomes the body of an
   *async* function, `await` works at the top level of a cell.
   The names handed in (`print`, `at`, `range`, `game`, `sheet`, `color`,
   `span`, `sleep`, ...) are the parameters of that function. That is the
   whole "cell API"; the code has no other special powers.
4. **Reads are tracked.** `at()`, `range()` and `game.*` record which cells
   the code looked at (`src/sheet/reactivity.ts`). When one of them
   changes, only the cells that read it run again, like a spreadsheet
   formula. Timers, `on()` and the rules of running are described in
   "How the cell code is run" above.

So, in the words you asked about: not a compiler to machine code (the
browser does that last step), not an interpreter we built, but a
**transpiler followed by the browser's built-in just-in-time engine**.

Good to know:

- **Type errors do not stop a cell.** Only syntax errors do. Wrong types
  show as red squiggles in the editor (the editor type-checks against
  `src/sheet/apiTypes.ts`, which is also what powers the autocomplete),
  but because types are erased the code still runs. This is the same
  as plain TypeScript.
- **If the TypeScript worker is unavailable**, the source is run as plain
  JavaScript, so simple cells still work.
- **It is not a security sandbox.** A cell is like `eval`: it runs with
  the full power of the page (it can reach `window`, `document`, the
  network, local storage). That is fine for your own sheet on your own
  machine. Do not paste code into a cell, or load a sheet, from someone you
  do not trust.
- The price of doing everything locally is download size: the Monaco
  editor and the TypeScript compiler are several megabytes.

## Working with an AI helper

There is **no chat or AI service built into the page**. By design the page
makes no network calls and needs no API key. Instead the page is made easy
to *read and drive* by an AI assistant that you run yourself, for example
one that can use your browser or a coding assistant next to your editor:

- `window.mms` is a small JSON API (`mms.help()` prints the guide). An
  assistant can read the board (`mms.board()`), read every cell with its
  output and error (`mms.cells()`), and write code with
  `mms.setCode('A12', code, { run: true })`, which runs it and returns the
  output or error straight away.
- A text copy of the game and all cells sits in the page as the region
  "Game state as text" (`#mms-text`), so assistants that read the
  accessibility tree see the same things.
- If the browser supports WebMCP, the same actions are registered as tools.
- `public/llms.txt` (served at `/llms.txt`) explains all this to an AI in
  plain words, including starter exercises.

Today this works for assistants that can reach the page. The editor's own
help is VS Code's *language* help (autocomplete, hover docs, signature
hints, red squiggles with explanations), not the AI-assisted features of VS
Code. Those are separate products and are not part of Monaco. The editor's
"quick fix" light bulb is switched off to keep it calm for children. To
share your code with any other AI chat, copy a cell's code and its error
text, and paste them together with the contents of `public/llms.txt`.

## Rows

Right-click a row header below the board to insert a row underneath it.
Any address reference inside a cell's code (`at('A13')`, `range('A1:J10')`)
is rewritten automatically to still point at the same logical cell after
the shift.

## Project layout

```
src/sheet/        Sheet model: cells, addresses, dependency tracking (reactivity.ts), run contexts and timers (tasks.ts), the cell API (api.ts)
src/editor/       Monaco integration, popup editor, inline per-cell editor
src/game/     Game rules, board state, AI move suggestions
src/ui/           Control panel, phone dock, touch gestures
src/storage.ts    Saves and restores the game and cells in localStorage
src/ai/           window.mms, WebMCP tools and the text copy for AI helpers
src/theme.ts      The colour palette
src/examples.ts   The code cells shown on first load
public/llms.txt   Plain-words guide for AI helpers
resources/        Piece icons (original) and reference files, see its README
scripts/          make-piece-svgs.mjs writes resources/pieces/
```

## Licence and artwork

Code: MIT, see `LICENSE`. All artwork (piece tiles, insignia symbols, bomb and flag drawings) is original or plain Unicode text; no third-party game artwork or names are used. Dependencies (maxGraph, Monaco, Vite, TypeScript) keep their own licences.

## Technology

TypeScript, maxGraph for all rendering and interaction (no other UI
framework), Monaco for code editing, Vite for the dev server and build.

## Deployment

The `deploy` GitHub Actions workflow builds the project and publishes
`dist/` to GitHub Pages on every push to `main`.

## Source
[L'Attaque wikipedia](https://en.wikipedia.org/wiki/L%27Attaque)
