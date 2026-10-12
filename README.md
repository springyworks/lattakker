# 1 Lattakker Sheet

A Lattakker board combined with a spreadsheet. The board is a grid of cells
like any other, each cell has an address (A1, C7, M14), and any cell below
the board can hold a small piece of TypeScript that runs, reads other
cells, and draws on the board. Everything is rendered through maxGraph; the
Monaco editor is used for code editing.

Live demo: https://springyworks.github.io/lattakker/

![Lattakker in action: playing the board, editing a cell, the Lab and the Examples tab](resources/animated_screen_recording.gif)

<a id="contents"></a>

## Contents

- [1 Lattakker Sheet](#1-lattakker-sheet) (this introduction)
- [2 Requirements](#2-requirements)
- [3 Running locally](#3-running-locally)
- [4 Playing Lattakker](#4-playing-lattakker)
- [5 Saved in your browser](#5-saved-in-your-browser)
- [6 The sheet](#6-the-sheet)
  - [6.1 Code follows the cells it names](#61-code-follows-the-cells-it-names)
  - [6.2 Long sheets](#62-long-sheets)
- [7 Your first program (start here)](#7-your-first-program-start-here)
- [8 Programmer's manual: the cell API](#8-programmers-manual-the-cell-api)
  - [8.1 Output and looks](#81-output-and-looks)
  - [8.2 The cell itself and other cells](#82-the-cell-itself-and-other-cells)
  - [8.3 The game](#83-the-game)
  - [8.4 Time: sleep, every, after](#84-time-sleep-every-after)
  - [8.5 Watching things: on](#85-watching-things-on)
  - [8.6 Events: size, code, click, sheet](#86-events-size-code-click-sheet)
  - [8.7 Known limits (what is still missing)](#87-known-limits-what-is-still-missing)
  - [8.8 Examples](#88-examples)
- [9 How the cell code is run (internals)](#9-how-the-cell-code-is-run-internals)
  - [9.1 When does a cell run?](#91-when-does-a-cell-run)
  - [9.2 Is this reactive programming?](#92-is-this-reactive-programming)
  - [9.3 Multitasking: how several cells and timers run at once](#93-multitasking-how-several-cells-and-timers-run-at-once)
- [10 How TypeScript runs inside a cell (for the curious)](#10-how-typescript-runs-inside-a-cell-for-the-curious)
- [11 Working with an AI helper](#11-working-with-an-ai-helper)
  - [11.1 An AI in the browser's sidebar](#111-an-ai-in-the-browsers-sidebar)
    - [11.1.1 Looking](#1111-looking)
    - [11.1.2 Suggesting](#1112-suggesting)
    - [11.1.3 Suggesting inside the editor](#1113-suggesting-inside-the-editor)
    - [11.1.4 Trying it on the live page](#1114-trying-it-on-the-live-page)
  - [11.2 Other AI helpers](#112-other-ai-helpers)
  - [11.3 Connect an external AI chat (MCP)](#113-connect-an-external-ai-chat-mcp)
    - [11.3.1 Connect step by step](#1131-connect-step-by-step)
    - [11.3.2 Talking to the AI from a cell](#1132-talking-to-the-ai-from-a-cell)
    - [11.3.3 What to tell the AI](#1133-what-to-tell-the-ai)
    - [11.3.4 Safety and limits](#1134-safety-and-limits)
- [12 Rows](#12-rows)
- [13 Project layout](#13-project-layout)
- [14 Licence and artwork](#14-licence-and-artwork)
- [15 Technology](#15-technology)
- [16 Deployment](#16-deployment)
- [17 Source](#17-source)

## 2 Requirements

[↑ Contents](#contents)

- Node.js 18 or later
- npm

## 3 Running locally

[↑ Contents](#contents)

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

## 4 Playing Lattakker

[↑ Contents](#contents)

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
  the code editor for the last-selected cell (see [6](#6-the-sheet)).

## 5 Saved in your browser

[↑ Contents](#contents)

The game (including Undo history) and every code cell are saved
automatically in this browser's own storage (`localStorage`, key
`lattakker:v1`), a moment after every change. Reload the page and you carry on
where you stopped. Nothing is sent anywhere. To start completely fresh, run
`localStorage.removeItem('lattakker:v1')` in the browser console and reload.

## 6 The sheet

[↑ Contents](#contents)

Cells outside the board (row 12 and below in the examples, but any row
after the board works) can hold code. A cell with code shows either its
source (view mode) or what it printed (run mode); the mode toggle button
switches both at once.

To edit a cell:

- Double-click it to open it in a popup Monaco editor. Drag its title bar to
  move it, double-click the title bar to fill the screen (and again to go
  back), and resize it from its corner handle.
- Or, in view mode, type directly into the cell on the sheet itself. The
  tiny ⋮ in the corner of the cell (see [the ⋮ menu](#the--menu)) is a handle: drag
  it to move the cell's content (code, output, colour, span) to another cell.
- To move a cell, or a merged block of cells, from anywhere on it: hold
  Ctrl (Cmd on a Mac) and drag, or on a touch screen tap, then tap again
  and hold, and move. The block follows your finger and snaps to the grid.
  If the new place is not free it springs back.

Code that names other cells is kept up to date when they move. See
[6.1 Code follows the cells it names](#61-code-follows-the-cells-it-names),
and for very large sheets [6.2 Long sheets](#62-long-sheets).

### 6.1 Code follows the cells it names

[↑ Contents](#contents)

When cells move, code that names them keeps pointing at the same cells, like
a spreadsheet formula. This holds for dragging a cell or block, swapping two
cells and inserting a row (see [12 Rows](#12-rows)). Every address written as plain text in code is
updated: `at('B20')`, `range('A1:B3')`, `range('C20-22')`, `on('E5', ...)`,
`$B$20`, in any quote style, including the code of the cell that moved. A
short message says how many references changed and in which cells (they
flash), and the editor is refreshed so an old address cannot be saved back.

- A swap works both ways at once: a reference to an empty square follows
  its square, so moved code never lands on a mailbox by accident.
- A range follows only when the whole range was inside the moved block. If a
  move splits a range, nothing is guessed: the range stays as written and a
  warning names the cell, so you check it instead of hitting another cell.
- Comments, and the text parts of template strings, are left alone. Only a
  string that is exactly one address or range counts, so `'B20 is full'` is
  never changed.
- Addresses built at run time (`'E' + n`) cannot be followed. Write the
  address once, as a `const`, and build from that.

### 6.2 Long sheets

[↑ Contents](#contents)

A strip on the right edge has a **Go to** box (type `Q120` or just `120`, then
Enter) and a miniature of the whole sheet: a tick for every row that holds
code (red for an error), with a window showing what is on screen. Click or
drag the strip to scroll. A row you insert scrolls into view and glows green
for half a second.

Inside the popup editor, cells are always live: **Restart** (Ctrl+Enter) stops the
cell's timers and runs its code again from the top, and **Restart & close**
(Escape) does the same and closes the editor. **Close** throws the edit away. The strip at the bottom shows the cell's
latest output. A click on that strip counts as a click on the cell (so code
that waits with `on(cell, 'click', ...)` reacts); the small **enlarge / shrink**
button in its corner makes the strip bigger.

## 7 Your first program (start here)

[↑ Contents](#contents)

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

**The coach.** When a line has a mistake, the editor puts a short friendly hint
on a line above it (Monaco CodeLens), a moment after you stop typing. For
`const red = game.piecies('red')` it says `💡 piecies is waarschijnlijk
verkeerd gespeld | 💡 probeer const red = game.pieces('red')`. The guess comes
from TypeScript's own "Did you mean ...?"; other errors (unknown name, missing
bracket, wrong kind of value) get a plain-words hint too. The hints are only
advice: the coach never changes your code. The text lives in
`src/editor/coachHints.ts`.

**Recipes.** Start typing a word like `stopwatch`, `button` or `countdown` in
any code editor (the big one or a cell's own) and the suggestion list offers
a small ready-made program; Tab jumps between the spots to change. Each one has
a `// Try: ...` line. The list also holds every example from the sheet, marked
`example`, so a player can pull one into a new cell. Recipes and examples are
kept in the code (`src/recipes.ts`, `src/examples.ts`), so they stay as
written even when someone edits the example cells in the sheet.
Everything you can use inside a cell is listed in [8 Programmer's manual: the cell API](#8-programmers-manual-the-cell-api).

**Tabs.** Three tabs sit above the page:

- **Game board**: the battle and your cells.
- **Lab** (`/#lab`): a second sheet with exactly the same abilities as the one
  under the board (cell addresses, TypeScript in cells and merged cell-blocks,
  the popup and inline editors, menus, reactivity, `plot()`), but no playing
  field. There is only one game, on the first tab; `game` in Lab code reads it,
  and the Lab's cells wake up when it changes. It starts full of live demos (an
  animated wave, a bouncing ball, a sorting race, a clock, Game of Life painted
  on cells, charts that read other cells...). Everything is saved in the
  browser (separately from the board's sheet); **Restore demos** puts the demos
  back as written. Addresses mean the Lab's
  own cells there: `at('A1')` in the Lab is the Lab's A1.
  A hidden Lab keeps running but does not redraw until you open it.
- **Examples** (`/#examples`): every example from `src/examples.ts` as a card with a real Monaco editor. It has
  the same help as a cell: hover a word for its type and a plain-words
  explanation (for example `const`, `every`, `span`), completions, and the coach's
  hints on errors. A search box filters the cards. **Put on the board** sends the
  code (with your changes) to a cell and switches to the board: an untouched
  example goes back to its own cell if that is empty, anything else goes to a
  fresh cell in column A below the last code cell. **Put in the Lab** does the
  same on the Lab's sheet (always a fresh cell). **Start over** restores the
  original text and **Copy** copies it.

The board keeps its scroll position and its running cells while you browse the other tabs.

<a id="the--menu"></a>

**The ⋮ menu.** Rest the pointer on a cell (not a board square) and a tiny ⋮
appears in its top-right corner (on the visible part of a big block). Rest on
the ⋮ and a menu opens with what you can do with that cell or cell-block:

| Item | What it does |
|---|---|
| tiny first line | The cell's address, its stable id (`c-1f3a9b02`, the same after moves) and how often it ran. Click to copy the id. |
| Edit code / Write TypeScript here | Opens the popup editor. |
| Run again, Size, Stop timers | Re-run the code; make the block wider, narrower, taller, shorter or 1×1; cancel its `every`/`on` tasks. |
| Used by / Reads | Lists of cells (pick one to jump there). *Used by* counts cells that read this one, watch its size/code/clicks, or name its address in their code. |
| Copy | Address, id or code. |
| Show ids on all cells | Draws each code cell's id in tiny type in its corner. |
| Delete cell / cell-block | Clears the code (and the block's size). It is **disabled while another cell uses this one** and says how many; otherwise it asks "Click again to delete". |

The ⋮ is also a drag handle for moving the block. The menu is built from plain
item lists (`src/ui/HoverMenu.ts`), so other things (pieces, buttons) can get
the same kind of menu later. The right-click menu still works as before.

**Hover help.** Resting the pointer on a word in any cell editor shows Monaco's
own hover (type, docs, and the kid-friendly "💡" line). After half a second, an
extra panel drawn by maxGraph lists the places where that word is used in the
cell, and cell addresses expand into a live, editable copy of that cell. (The
Examples tab uses Monaco's hover only, because the panel is drawn on the sheet.)

## 8 Programmer's manual: the cell API

[↑ Contents](#contents)

Each cell's code runs in its own scope, so names never clash between cells.
Top-level `await` works. The editor shows these names with help text as you type.

### 8.1 Output and looks

[↑ Contents](#contents)

| Call | What it does |
|---|---|
| `print(...values)` | Add a line to this cell's output (shown in run mode). Only the last 300 lines are kept. |
| `show(...values)` | Replace the output with one line. Use this for displays that update in place. |
| `clear()` | Empty the output and remove the plot. |
| `plot(data, options?)` | Draw an XY plot as this cell's output. `data` is a list of numbers, a list of `[x, y]` pairs, a list of `{ x, y }` points, a function of x such as `Math.sin` or `(x) => x * x`, or an object of several of these (`{ sin: Math.sin, cos: Math.cos }`, drawn with a legend). Options: `title`, `xLabel`, `yLabel`, `from`/`to`/`steps` (for functions: default -10 to 10 in 200 steps), `dots`, `color`, and `xMin`/`xMax`/`yMin`/`yMax` to fix the edges (so an animation does not jump around) and `axes: false` for just the lines. A series name that starts with `_` stays out of the legend. Call it again to redraw (do this inside `every()` for a live plot). Whatever you `print` or `show` becomes a caption under the plot. Make the cell bigger with `span(4, 3)`; a small cell draws a bare line without axes. |
| `grid(cols, rows?)` | Give this cell's block a grid of tiles that fills it: `span(10, 8)` then `const g = grid(10, 8)` is 80 tiles, however big the block is. Tiles have their own coordinates (`x` across, `y` down, from 0), not sheet addresses, so the code does not care where the block sits. `g.at(x, y)` is a tile with `.color(fill)` (`null` blanks it), `.show(text)`, `.clear()` and the readable `.fill` / `.text`. `g.paint((x, y) => colour)` paints every tile in one pass, and `g.fill(colour)`, `g.clear()`, `g.each(fn)`, `g.cols` and `g.rows` do what they say. `on(g, 'click', (tile) => ...)` runs when a tile is clicked. Other cells reach a tile by its path: `at('A16/3,4')` is the tile in column 3, row 4 of the grid in A16, and the path moves along with the block (move it or insert a row and the code is rewritten like any address). Text you `show()` in the block floats over the tiles. See the Game of Life in the Lab tab (A16). |
| `view(text)` | Replace what is shown in view mode (default: the code itself). |
| `color(fill)` | Background colour, e.g. `'#ffd6e7'` or `'lightgreen'`. |
| `log(...values)` | Like `print`, and also writes to the browser console. |
| `span(cols?, rows?)` | Merge the cell over `cols` x `rows` cells (never over the board). Leave one out to keep it: `span(4)` keeps the rows. With no arguments it changes nothing and returns `{ cols, rows }`. |

```ts
span(4, 3)
plot(Math.sin, { from: 0, to: 6.28, title: 'A wave' })
show('sin(x) from 0 to 2π')
```

The output pane of the editor: the floating editor has a strip below the code
that shows the latest output of the cell you are editing, plot included. Click
it to see the cell at its real size (a bit scaled up) while you keep typing;
click again to shrink it. It follows the cell live, so a timer or a plot that
redraws keeps moving there too.

The cell's size can be set (and read) from code. Dragging a cell border to
resize it is deliberately not offered: rewriting your `span(...)` line behind
your back would fight with the code you are typing. The code is the single
source of truth for the size.

### 8.2 The cell itself and other cells

[↑ Contents](#contents)

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
when the cell has timers running. The reactive reads behind `.usedBy` and
`.reads` are explained in [9.2 Is this reactive programming?](#92-is-this-reactive-programming).

### 8.3 The game

[↑ Contents](#contents)

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

### 8.4 Time: sleep, every, after

[↑ Contents](#contents)

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
  so a clock cell can feed other cells (see [8.5](#85-watching-things-on) below).

### 8.5 Watching things: on

[↑ Contents](#contents)

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

### 8.6 Events: size, code, click, sheet

[↑ Contents](#contents)

`on` can watch more than "the content changed". Give it an event name:

```ts
on('I18', 'size',  (box) => show('I18 is now ' + box.cols + '×' + box.rows))  // resized
on('E21', 'code',  (c)   => show('E21 was edited or moved'))                    // its code changed
on('I21', 'click', ()    => print('clicked!'))                                  // clicked on the sheet
on('sheet', 'rows', () => show('a row was inserted'))
on('sheet', 'mode', (s) => show('mode is ' + s.mode))                           // run or view
```

So a cell can react when a child resizes a merged cell (right-click →
**Size**), edits another cell's code by hand, or clicks a "button" cell.
These are also readable at the top level of a cell, which makes the cell
re-run on its own: `cell.cols`, `cell.rows`, `at('X').code`, `sheet.rows` and
`sheet.mode`. (Calling `span(4, 2)` to *set* a size is not a read.)

Two more tools make such cells behave:

- `memory` is the cell's notebook. Everything you put in it
  (`memory.count = (memory.count ?? 0) + 1`) survives re-runs, edits and
  moving the cell, so timers do not start from zero every time. It is
  cleared when the cell's code is cleared and it is not saved with the page.
- `run.reason` tells you *why* the cell is running: `'edit'` (its code was
  just written), `'moved'` (dragged or a row was inserted above) or
  `'update'` (something it reads changed). `run.count` counts the runs.
  The idiom for "choose a size once, then let the child resize it":
  `if (run.reason === 'edit') span(4, 2)`. Moves that change `run.reason` are
  part of [6.1 Code follows the cells it names](#61-code-follows-the-cells-it-names).

A cell that writes into another cell (`at('Y27').show(...)` from a timer)
wakes the cells that read it, but only when the text really changed.

**Safeguards, because cells can start loops.** An `on` handler that wakes
more than 50 times a second is stopped and the cell shows an error. If cells
keep re-running each other (more than 400 passes in two seconds) the chain
is stopped and the cells involved show "Stopped: cells keep re-running each
other in a loop". A cell never wakes itself by writing to itself. Events that
arrive after a cell has run again are dropped. Timers are described in
[8.4](#84-time-sleep-every-after).

The default sheet has about forty examples from row 18 down that use all of
this: resize watchers, a click-button robot, a mailbox between cells, a
countdown that stops itself, a slow loading bar. They build on
[8.5 Watching things](#85-watching-things-on) and this section. Existing sheets keep their
own cells; press F12 and run `loadExamples()` to fill every *empty* example
cell (cells that hold code are never overwritten). The examples are listed in
[8.8](#88-examples).

### 8.7 Known limits (what is still missing)

[↑ Contents](#contents)

- Sizes (merges) and [`memory`](#86-events-size-code-click-sheet) are not saved when the page is reloaded; a cell
  that sets its size with `span()` does so again when it runs.
- You can resize a cell from code or from the right-click **Size** menu, but
  not by dragging its corner.
- Events carry no *old* value (a size handler sees the new size only) and no
  "who did it" (child or code). There is no event for colour changes,
  selection or hover, and no debounce option.
- `on(range)` runs the handler once per pass with the first changed cell.
- Reads inside timers and handlers are not tracked (by design).
- Two slow cells that keep waking each other are only stopped by the loop
  guard, not by the rate limit.
- Inserting a row resets merged sizes.
- Code that builds an address from pieces (`'E' + n`) is not updated when cells move; ranges split by a move are reported, not rewritten. See [6.1](#61-code-follows-the-cells-it-names).
- Everything runs on the page's main thread. A tight loop without `await`
  freezes the page, because there are no Web Workers yet. See [9.3](#93-multitasking-how-several-cells-and-timers-run-at-once).
- The global `mode` is a snapshot while `sheet.mode` is live.

### 8.8 Examples

[↑ Contents](#contents)

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
More patterns are in [8.5 Watching things](#85-watching-things-on) and [8.6 Events](#86-events-size-code-click-sheet).

## 9 How the cell code is run (internals)

[↑ Contents](#contents)

### 9.1 When does a cell run?

[↑ Contents](#contents)

A cell runs in exactly these situations (`src/sheet/Sheet.ts`, `runAll`):

1. you saved or edited its code (also: pressed Ctrl+Enter, or a helper called `mms.setCode`);
2. something it **read** changed (another cell, a board square, or the game);
3. the page loaded, or rows were inserted or content moved (its address changed).

Nothing else. A cell that reads nothing runs once and then waits until you
touch it, just as a plain number in a spreadsheet does not recalculate. The
board and `game` count as changed when a move, undo, shuffle or new game happens.

### 9.2 Is this reactive programming?

[↑ Contents](#contents)

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
   same "this node changed" fact that re-runs readers also wakes watchers
   (see [8.5](#85-watching-things-on) and [8.6](#86-events-size-code-click-sheet)).

What we deliberately do not have: cells are not individual formulas but whole
programs, so a re-run starts the program from the top; and the only
change-detection ("did the value really change?") is for board squares. A
cell that prints the same text again still counts as changed. We checked this
by test: a cell reading `A12` re-runs when `A12` changes; a watcher on `A1`
stays quiet when a piece moves elsewhere, and fires when `A6` changes.

### 9.3 Multitasking: how several cells and timers run at once

[↑ Contents](#contents)

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
  change notifications that re-run cells (see [8.4](#84-time-sleep-every-after) and [8.5](#85-watching-things-on)).

Limit to know about: **a loop that never awaits** (`while (true) {}`) cannot
be interrupted, because there is only one thread, and it freezes the page.
Put `await sleep(0)` in a long loop to let others breathe. Web Workers could
give real parallelism, but a worker cannot touch the board or other cells, so
cell code would lose its main feature. We chose not to.

## 10 How TypeScript runs inside a cell (for the curious)

[↑ Contents](#contents)

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
   whole "cell API" (see [8](#8-programmers-manual-the-cell-api)); the code has no other special powers.
4. **Reads are tracked.** `at()`, `range()` and `game.*` record which cells
   the code looked at (`src/sheet/reactivity.ts`). When one of them
   changes, only the cells that read it run again, like a spreadsheet
   formula. Timers, `on()` and the rules of running are described in
   "How the cell code is run" above, in [9.1](#91-when-does-a-cell-run) and [9.3](#93-multitasking-how-several-cells-and-timers-run-at-once).

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

## 11 Working with an AI helper

[↑ Contents](#contents)

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
- An AI chat that runs *outside* the page (Claude Code, Claude Desktop, and
  other MCP clients) can use the same tools through the dev server's `/mcp`
  endpoint while you play in the browser. See
  [11.3](#113-connect-an-external-ai-chat-mcp).
- Every code cell has a stable `uid`, so an assistant can keep pointing at the
  same code after cells move ([11.1.1](#1111-looking)).
- `public/llms.txt` (served at `/llms.txt`) explains all this to an AI in
  plain words, including starter exercises.

### 11.1 An AI in the browser's sidebar

[↑ Contents](#contents)

Many browsers now have an AI panel next to the page (a side panel, an
extension, a "browse with an agent" mode). Such an assistant can use
Lattakker as a live workbench, because everything it needs is on the page
and nothing has to be uploaded anywhere.

#### 11.1.1 Looking

[↑ Contents](#contents)

Reading, no risk:

- *The cells:* `mms.cells()` lists every cell that has code, with its saved
  code, its printed output and its error. `mms.getCell('E24')` gives one cell.
  *Identity:* every code cell has a `uid` such as `c-1a2b3c4d`. The address is
  only where the content sits right now. The uid is made when code is first
  written, is kept through edits, moves, swaps, row inserts, saving and
  reloading, and is gone when the cell is emptied. Keep the uid and call
  `mms.resolve(uid)` to get the current address. `getCell`, `setCode`,
  `runCell` and `clearCell` accept a uid wherever they accept an address.
  The same list is in the accessibility tree under "Game state as text", so
  an assistant that can only "see" the page text still finds it.
- *The embedded code:* each cell's code is also a Monaco text model with the
  address `file:///cells/E24.ts`, so it is real TypeScript with real types
  (the model of the cell API is in `src/sheet/apiTypes.ts`). Press
  "Show code" (`mms.setMode('view')`) and the cells show their code on the
  sheet itself.
- *The wiring:* inside a cell, `cell.usedBy` and `cell.reads` list who reads
  whom, and right-click a cell shows the same lists. An assistant can ask a
  cell for them with `mms.runCell` on a small helper cell, or read the code
  of the neighbours. This answers "what breaks if I change this?". See
  [8.2](#82-the-cell-itself-and-other-cells).
- *The game:* `mms.state()`, `mms.board()`, `mms.legalMoves('red')`.
  Blue's hidden pieces stay hidden for the assistant too.
- *What the player is doing:* `mms.state().editorOpenOn` names the cell whose
  editor is open right now, so "fix this" can mean the cell in front of the
  child. Note that `cells()` shows the saved code, not text typed in the open
  editor that is not saved yet (Esc and Ctrl+Enter both restart the cell with the new code).

#### 11.1.2 Suggesting

[↑ Contents](#contents)

What exists today:

- `mms.setCode('E24', newCode, { run: true })` replaces the code of a cell and
  runs it. It returns `{ ok, output }` or `{ ok: false, error }` straight
  away, so the assistant can try its own idea, read the error, and fix it
  before the child ever sees a mistake.
- The write goes through the cell's Monaco model. If the cell's editor is
  open, the child sees the new code appear in it. It is a whole-text
  replacement, so the editor's undo history for that cell starts again.
  A careful assistant should read the cell first, change only what is needed,
  and say what it did with `mms.say('I changed the 1s to 500ms')`.
- `mms.writeCodeLive('E24', newCode)` (async) is the visible version: it opens
  the cell's editor and types the code in over a few seconds, then waits. The
  child reads it and presses Esc (or Restart & close) to keep and run it, or Close to
  throw it away. Nothing runs until they decide.
- Do not put suggestions into a cell you have not looked at. The child's own
  code is the point of the exercise. Ask first, or use an empty spare cell
  and describe the idea in `mms.say`.

#### 11.1.3 Suggesting inside the editor

[↑ Contents](#contents)

Not built yet, but Monaco can do it. Monaco is the same editor VS Code is
built on, and it has the pieces for showing an outside suggestion *in place*,
where the child can accept or refuse it, instead of silently replacing the code:

| Wish | Monaco feature |
|---|---|
| Show the AI's version next to the child's | `createDiffEditor`: two models, with changed lines highlighted. Accept = copy the right side into the left. |
| Change only some lines and keep Ctrl+Z working | `editor.executeEdits('ai', [{ range, text }])` is one undoable step per call. |
| Ghost text that Tab accepts, like Copilot | `registerInlineCompletionsProvider('typescript', ...)` |
| "Why is this red?" explained by the AI | `setModelMarkers(model, 'ai', [...])` draws squiggles with an AI message, and a `registerCodeActionProvider` can attach "Apply fix" to them. (Lattakker switches the quick-fix light bulb off today to keep the editor calm.) |
| Explain on hover | `registerHoverProvider` |

A small bridge such as `mms.suggest('E24', newCode, 'why')` would open the
cell's editor as a diff with Accept and Reject buttons. It would give a
sidebar assistant a safe way to *propose* without *overwriting*. The
building blocks are already here: one Monaco model per cell, a shared
`window.mms` API, and an editor panel that knows which cell is open. Until
it exists, `mms.setCode` is the way to apply a suggestion (see [11.1.2](#1112-suggesting)).

For wiring cells together, assistants should prefer the reactive features
(`on(x, 'size', ...)`, `cell.cols`, `memory`, `run.reason`) described in
[8](#8-programmers-manual-the-cell-api) over timers and polling. See
[8.6](#86-events-size-code-click-sheet) and [8.4](#84-time-sleep-every-after). They are what makes a cell wake up exactly when the
thing it cares about changes.

#### 11.1.4 Trying it on the live page

[↑ Contents](#contents)

The published page (https://springyworks.github.io/lattakker/) is a static
site: no server, no `/mcp`, no key. An AI that lives in the browser (a side
panel, an extension, an agent mode that can use the page) already has
everything it needs there. This is the easiest way to try the AI features.

What such an assistant can use, from the least to the most capable:

- *It can only read the page.* It finds the region "Game state as text"
  (`#mms-text`): the board, the last move and every code cell with its output
  and error. It also sees the text of an open editor in the accessibility tree.
- *It can run JavaScript in the page.* Then `window.mms` is there:
  `mms.help()` is the full guide, and everything in
  [11.1.1](#1111-looking) and [11.1.2](#1112-suggesting) works, including
  `mms.setCode`, `mms.writeCodeLive` and `mms.say`.
- *It can click and type.* Then it can also do what the child does: open a
  cell, type in the editor, press Esc.

**Chat by comments** works in the browser too. The child writes
`// AI: ...` in a cell ([11.3.2](#1132-talking-to-the-ai-from-a-cell)), and the
assistant answers with `// ↳ AI: ...` lines below it, using
`mms.requests()` (what is asked right now, also the unsaved text in an open
editor), `mms.waitForRequest(15)` (async, waits up to 20 seconds for a new
question) and `mms.replyToRequest('E24', line, 'text')`. A page cannot call an
assistant, so the assistant has to look: it asks again when the child says
"I asked", or keeps calling `mms.waitForRequest`. The grey hint behind a
question shows ⏳ while a `waitForRequest` call is running and 💤 when no
assistant has looked for a while.

Things worth knowing before you start:

- Everything stays in the browser tab. Cells are saved in that browser's
  local storage, so the assistant works on the same sheet the child sees.
- The tools that write (`setCode`, `clearCell`, `move`, `newGame`) change what
  the child sees at once. The child's own cells are the point of the
  exercise, so an assistant should read first, ask before replacing, and use
  `mms.say` or a `// ↳` reply to explain what it did.
- Blue's hidden pieces stay hidden for the assistant too.
- A good first test: double-click an empty cell, type `// AI: what does span do?`
  and see whether the assistant answers in the editor.

Suggested context to give an assistant (adjust freely, it is background, not
a script):

```
This page is Lattakker Sheet: a Lattakker board that is also a spreadsheet
of TypeScript cells, played by a child who is learning to program. It runs
locally in the page. window.mms.help() describes the JSON API, and the region
"Game state as text" mirrors the page for readers. The child may write
"// AI: question" in a cell; answer with mms.replyToRequest in plain, short,
friendly words and do not change their code unless asked. When you do change
code, show it with mms.writeCodeLive so they can read it before it runs.
```

### 11.2 Other AI helpers

[↑ Contents](#contents)

Today the above works for assistants that can reach the page. The editor's own
help is VS Code's *language* help (autocomplete, hover docs, signature
hints, red squiggles with explanations), not the AI-assisted features of VS
Code. Those are separate products and are not part of Monaco. The editor's
"quick fix" light bulb is switched off to keep it calm for children. To
share your code with any other AI chat, copy a cell's code and its error
text, and paste them together with the contents of `public/llms.txt`. An
assistant that can run MCP tools can do better: see
[11.3](#113-connect-an-external-ai-chat-mcp).

### 11.3 Connect an external AI chat (MCP)

[↑ Contents](#contents)

The page does not contain a chat. It acts as a tool server instead: while you
play in the browser, an AI chat in another window can read the same game and
cells and change them, using the same `window.mms` tools described above. You
watch the board and the sheet react as the assistant works.

How it works: `npm run dev` starts a small MCP endpoint at `/mcp` on the dev
server (`scripts/mcp-bridge.ts`, plain JSON-RPC over HTTP, no extra package).
It forwards each tool call over Vite's own live-reload socket to a browser
page that was opened with `?mcp` in its address, and returns the answer. It
exists only in the dev server. The built site (GitHub Pages) has no `/mcp`.

#### 11.3.1 Connect step by step

[↑ Contents](#contents)

1. Start the dev server: `npm run dev` (see [3](#3-running-locally)). Note the
   address it prints, for example `http://localhost:5178/`.
2. Open the app **with `?mcp` added**: `http://localhost:5178/?mcp`. A page
   opened without `?mcp` is never driven from outside. Keep that tab open
   (a background tab is fine, but a closed one means "no page connected").
3. Tell your AI client about the endpoint `http://localhost:5178/mcp`
   (use your own port). For example:
   - Claude Code: `claude mcp add --transport http lattakker http://localhost:5178/mcp`
   - A client that only speaks stdio: `npx mcp-remote http://localhost:5178/mcp`
   - Any other MCP client that supports "Streamable HTTP": add a server with
     that URL and no key.
4. Ask the assistant to call `get_state`. If it says no page is connected,
   check step 2.

To check by hand without any AI:
`curl -s -X POST http://localhost:5178/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`

The tools are the ones in `mms.help()`: `get_state`, `get_board`,
`legal_moves`, `make_move`, `shuffle_army`, `start_battle`, `pause_battle`,
`resume_battle`, `undo_move`, `new_game`, `list_cells`, `get_cell`,
`resolve_cell`, `set_cell_code`, `write_code_live`, `get_requests`,
`wait_for_request`, `reply_to_request`, `run_cell`, `set_mode`, `say_to_player`
and `export_svg`. The assistant gets the list from the page itself, so it is
always current.

#### 11.3.2 Talking to the AI from a cell

[↑ Contents](#contents)

MCP is ask-and-answer: the page cannot call the assistant, so the assistant
cannot work on its own while the child plays. The child talks to it from
inside a cell instead, as a chat made of comments. A comment line that starts
with `// AI:` (or `// @ai`) is a question:

```
// AI: how do I make this cell blue?
span(4, 2)
```

The assistant answers with `// ↳ AI: ...` lines right below the question and
leaves a fresh, empty `// ` line under its answer. The cursor jumps there when
it was on the question, so the child just keeps typing. A plain `//` line
under an answer is the next question; no `AI:` needed:

```
// AI: how do I make this cell blue?
// ↳ AI: call color('blue') on a line of its own.
// and red?
```

While the editor is open, the cell checks every 3 seconds where the cursor is
and writes a grey hint at the end of the line: on an empty `//` line it says
what to type, and behind a question it says whether the assistant is listening
(⏳ reading along, 💤 not listening right now).

The assistant reads questions with `get_requests` (also the text the child is
still typing in the open editor, before Save), or waits for one with
`wait_for_request` (returns at once when a request exists, otherwise after at
most 20 seconds; the assistant calls it again to keep listening). It answers
with `reply_to_request`, live in the editor if it is open. A question with a
`// ↳` line below it counts as answered. Changing code stays a separate,
visible step (`write_code_live`).

The page cannot wake the assistant, so something on the assistant's side has to
keep listening: an assistant chat that repeats `wait_for_request`, or a
scheduled loop (about one minute apart at best).

#### 11.3.3 What to tell the AI

[↑ Contents](#contents)

Modern assistants can do more than call tools: they read files, make a plan,
combine several steps and reason about code. So this is background for the
assistant, not a script. It gives the goal, the facts only this app knows and
a few safety rules, and leaves the method to the assistant. Paste it at the
start of the chat:

```
You are helping a child who is playing Lattakker (a board game: Red = the
child, Blue = the computer) in a web page that is also a spreadsheet. Cells
below the board (A12 and lower) hold TypeScript that runs live.

You may have MCP tools ("lattakker"), source files, browser inspection or
other abilities, depending on your client. Use what you have. For the
current state of the game and the sheet, trust the Lattakker tools over
anything you read or remember: the page is the source of truth.

Goal: the child learns to code by playing. Explain in simple, friendly
words, and prefer teaching over silently changing things. If you write code
while the child is watching, use write_code_live: the child sees the code
appear in the editor and presses Esc (or Save) to keep it and run it.

Before you change anything:
- Look first: get_state, get_board, list_cells. Read a cell (get_cell)
  before you modify it, and keep the child's own work. Try new ideas in an
  empty spare cell.

Facts about this app:
- Every code cell has a uid (c-xxxxxxxx) that moves with its code. The
  address (like B7) is only where it is now, and it changes when cells move
  or rows are inserted. Keep uids; resolve_cell tells you the address. Tools
  accept either.
- Blue's pieces are hidden (B?) and the tools never show them. Do not guess
  or hunt for them.
- set_cell_code runs the code and returns the output or the error. Fix an
  error before you show the result.
- The sheet is reactive: a cell that reads other cells (at(), range(),
  game.*) runs again when they change. Plain literal addresses in code
  ('B7') follow their cell when it moves.
- The child can talk to you from a cell: a comment line starting with
  `// AI:`. Read them with get_requests or wait_for_request (call it again
  and again to keep listening) and answer with reply_to_request.
- If a tool says no page is connected, the child must open the app with
  ?mcp in the address.
```

Everything else comes from the tool descriptions, which the page itself
provides. An assistant that can read files can also use `public/llms.txt` (the
same guide, served at `/llms.txt`) and section
[8](#8-programmers-manual-the-cell-api) of this README. Some clients also
pass on resources or prompts; nothing here depends on that.

#### 11.3.4 Safety and limits

[↑ Contents](#contents)

- The endpoint only answers requests that come from `localhost`, `127.0.0.1`
  or `::1` (it checks the `Origin` header, which protects against a web page
  that tries to reach your dev server). It has no password. Do not expose the
  dev server to a network (`vite --host`) while you use `?mcp`.
- Only one page is driven, the one that connected most recently. Two `?mcp`
  tabs open at once will compete.
- A tool call that the page does not answer within 30 seconds returns an
  error. `set_cell_code` also waits for the cell to settle, so a cell that
  sleeps for a minute will time out in the tool while it keeps running.
- Tool calls act on the real game and the real cells of that browser's
  saved state (see [5](#5-saved-in-your-browser)). Use a separate address
  (`localhost` and `127.0.0.1` keep separate saved states) for experiments.
- To check the whole round trip (an outside AI talks to the bridge, the bridge
  talks to the page, the page answers) run `node scripts/mcp-smoke.mjs` while
  `npm run dev` runs and a tab is open at `http://localhost:5178/?mcp`. It plays
  a scripted AI: reads state, writes and clears one scratch cell (`Z43`, or set
  `SCRATCH=...`), plays and undoes a move, and checks the error cases.

## 12 Rows

[↑ Contents](#contents)

Right-click a row header below the board to insert a row underneath it.
Any address reference inside a cell's code (`at('A13')`, `range('A1:J10')`)
is rewritten automatically to still point at the same logical cell after
the shift. The rules are the same as for moved cells, see
[6.1](#61-code-follows-the-cells-it-names).

## 13 Project layout

[↑ Contents](#contents)

```
src/sheet/        Sheet model: cells, addresses, dependency tracking (reactivity.ts), run contexts and timers (tasks.ts), the cell API (api.ts)
src/editor/       Monaco integration, popup editor, inline per-cell editor
src/game/     Game rules, board state, AI move suggestions
src/ui/           Control panel, phone dock, touch gestures, the tab strip (Tabs.ts), the Examples tab (ExamplesGallery.ts), SheetPane.ts (everything one sheet needs; used by the board and the Lab) and the ⋮ menu (CellMenu.ts, HoverMenu.ts)
src/lab.ts        The Lab tab: a second sheet, its toolbar and saving; labDemos.ts holds its demo cells
src/storage.ts    Saves and restores the game and cells in localStorage
src/ai/           window.mms, WebMCP tools, the text copy for AI helpers, and bridge.ts (the page end of /mcp)
src/theme.ts      The colour palette
src/examples.ts   The code cells shown on first load
public/llms.txt   Plain-words guide for AI helpers
resources/        Piece icons (original) and reference files, see its README
scripts/          make-piece-svgs.mjs writes resources/pieces/; mcp-bridge.ts is the dev-server /mcp endpoint; mcp-smoke.mjs plays a scripted outside AI against it
```

## 14 Licence and artwork

[↑ Contents](#contents)

Code: MIT, see `LICENSE`. All artwork (piece tiles, insignia symbols, bomb and flag drawings) is original or plain Unicode text; no third-party game artwork or names are used. Dependencies (maxGraph, Monaco, Vite, TypeScript) keep their own licences.

## 15 Technology

[↑ Contents](#contents)

TypeScript, maxGraph for all rendering and interaction (no other UI
framework), Monaco for code editing, Vite for the dev server and build.

## 16 Deployment

[↑ Contents](#contents)

The `deploy` GitHub Actions workflow builds the project and publishes
`dist/` to GitHub Pages on every push to `main`.

## 17 Source

[↑ Contents](#contents)

[L'Attaque wikipedia](https://en.wikipedia.org/wiki/L%27Attaque)
