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
- Click a red piece, then click a highlighted square to move it. Scouts
  (rank 2) can move any distance in a straight line.
- Click a highlighted enemy square to attack it. The higher rank wins;
  equal ranks are both removed.
- Bombs beat every attacker except Miners (rank 3). The Spy (rank 1) beats
  the Marshal (rank 10) only when the Spy is the attacker.
- Capture the enemy flag to win.
- The buttons under the board: shuffle the setup, start the game, start a
  new game, toggle between code view and output view, cycle the zoom
  level, open the help text, and open the code editor for the
  last-selected cell.

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

## Writing code in a cell

Each cell's code runs in its own function scope (so names never clash
between cells) with a few globals available. The editor shows type information for all of them while you
type.

- `cell` — the cell the code is running in.
- `print(...values)` — append a line of output, shown in run mode.
- `view(text)` — replace what is shown in view mode (default: the code
  itself).
- `color(fill)` — set the cell's background colour.
- `span(cols, rows)` — merge the cell over the given number of columns and
  rows (not over the board). Merged blocks can be moved too, see above.
- `at(address)` — get another cell by address, e.g. `at('B7')`. Returns a
  `CellRef` with `.text`, `.code`, `.piece`, `.color()`, `.print()`, and so
  on.
- `range(text)` — get a range of cells, e.g. `range('A1:J10')` or
  `range('C32-55')`. Returns an array with `.color()` and `.print()`
  helpers that apply to every cell in the range.
- `game` — read-only information about the match: `game.phase`,
  `game.turn`, `game.winner`, `game.moveCount`, `game.lastMove`,
  `game.history`, `game.pieces(color?)`, `game.captured(color)`,
  `game.pieceAt(address)`, `game.legalMoves(addressOrColor)`. Also
  `game.move(from, to)` to move a red piece from code, and `game.say(text)`
  to show a message in the game's message bubble.
- `sheet` — `sheet.mode` (`'run'` or `'view'`), `sheet.cols`, `sheet.rows`.
- `mode` — shorthand for `sheet.mode`.
- `sleep(ms)` — `await sleep(500)` to pause inside a cell's code.
- `log(...values)` — like `print`, but also writes to the browser console.

Reading a cell with `at()` or `range()` registers a dependency: when the
cell you read from changes (including board squares after a move), your
cell re-runs automatically. There is no need to manually refresh anything.

Example, read live in cell A12 of the default sheet:

```ts
span(4, 2)
const red = game.pieces('red').length
const blue = game.pieces('blue').length
print(`Red has ${red} pieces`)
print(`Blue has ${blue} pieces`)
color(red >= blue ? '#dcfce7' : '#fee2e2')
```

Painting the board from a cell:

```ts
let count = 0
for (const square of range('A1:J10')) {
  if (square.piece?.color === 'red') { square.color('#ffd6e7'); count++ }
}
print(`Painted ${count} squares pink`)
```

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
   formula.

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
src/sheet/        Sheet model: cells, addresses, dependency tracking, row insertion
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
