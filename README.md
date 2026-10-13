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
  - [3.1 The live demo (nothing to install)](#31-the-live-demo-nothing-to-install)
  - [3.2 How the demo got to github.io](#32-how-the-demo-got-to-githubio)
- [4 Playing Lattakker](#4-playing-lattakker)
- [5 Saved in your browser](#5-saved-in-your-browser)
- [6 The sheet](#6-the-sheet)
  - [6.1 Code follows the cells it names](#61-code-follows-the-cells-it-names)
  - [6.2 Long sheets](#62-long-sheets)
  - [6.3 Tabs and cell paths: where am I?](#63-tabs-and-cell-paths-where-am-i)
  - [6.4 Working together (Share)](#64-working-together-share)
  - [6.5 Your own tabs and the Monitor](#65-your-own-tabs-and-the-monitor)
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
  - [8.9 Cells in other tabs: at('/lab/J24')](#89-cells-in-other-tabs-atlabj24)
  - [8.10 Talking to tabs over MCP: the mcp global](#810-talking-to-tabs-over-mcp-the-mcp-global)
  - [8.11 The MCP servers of the page and the router's statistics](#811-the-mcp-servers-of-the-page-and-the-routers-statistics)
  - [8.12 The weather](#812-the-weather)
  - [8.13 The model on this computer (Ollama)](#813-the-model-on-this-computer-ollama)
  - [8.14 Input from the person: the input global](#814-input-from-the-person-the-input-global)
  - [8.15 Animated drawings: the svg global](#815-animated-drawings-the-svg-global)
  - [8.16 How this computer is doing: the system global](#816-how-this-computer-is-doing-the-system-global)
  - [8.17 Making tabs from code: the tabs global](#817-making-tabs-from-code-the-tabs-global)
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
  - [11.4 The built-in AI helper (optional)](#114-the-built-in-ai-helper-optional)
    - [11.4.1 Choosing a helper](#1141-choosing-a-helper)
    - [11.4.2 Asking: the 🤖 button, Alt+I, right-click](#1142-asking-the--button-alti-right-click)
    - [11.4.3 A “// AI:” line pops the helper up](#1143-a--ai--line-pops-the-helper-up)
    - [11.4.4 What the helper can and cannot do](#1144-what-the-helper-can-and-cannot-do)
    - [11.4.5 Memory, and outside AIs asking the helper](#1145-memory-and-outside-ais-asking-the-helper)
    - [11.4.6 What is going on? The status service](#1146-what-is-going-on-the-status-service)
    - [11.4.7 Help and “show me”, everywhere](#1147-help-and-show-me-everywhere)
    - [11.4.8 Documents for AIs: rules, API, examples, README](#1148-documents-for-ais-rules-api-examples-readme)
- [12 Rows](#12-rows)
- [13 Project layout](#13-project-layout)
- [14 Licence and artwork](#14-licence-and-artwork)
- [15 Technology](#15-technology)
- [16 Deployment](#16-deployment)
- [17 Source](#17-source)

## 2 Requirements

[↑ Contents](#contents)

- Node.js 20.19 or later (or 22.12 or later), which is what Vite requires
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

### 3.1 The live demo (nothing to install)

[↑ Contents](#contents)

The latest version of the page is always running at
**https://springyworks.github.io/lattakker/**. Open it in any current browser
and play, or double-click a cell below the board and write some TypeScript.

- *It is the same page you get from `npm run dev`.* There is no server behind
  it: the browser downloads a set of static files and everything runs inside
  your tab. Nothing you type or play is sent anywhere, unless you start a
  **Share** session yourself ([6.4](#64-working-together-share)) or choose an
  AI helper in its settings ([11.4](#114-the-built-in-ai-helper-optional)).
- *The first load is a few megabytes,* because the Monaco editor and the
  TypeScript compiler come with the page. Later visits are usually faster,
  because the browser can keep those files.
- *Your game and your cells are saved in your own browser* (local storage, see
  [5](#5-saved-in-your-browser)), separately for each address. The demo at
  `springyworks.github.io` and a copy on `localhost` do not share anything.
  Clearing the site data of your browser starts you from scratch.
- *`window.mms` and the WebMCP tools work there too.* The one thing that does
  not exist on the demo is the `/mcp` endpoint of
  [11.3](#113-connect-an-external-ai-chat-mcp): that is part of the dev server,
  so to connect an outside AI chat you run `npm run dev` yourself.
- *Every change to `main` shows up on the demo* about a minute or two after it
  is pushed (see below).

### 3.2 How the demo got to github.io

[↑ Contents](#contents)

GitHub Pages is a free service that serves the files of a repository as a
website, at `https://<user>.github.io/<repository>/`. Lattakker only needs
files (HTML, JavaScript, CSS), so there are four small pieces:

1. **A static build.** `npm run build` type-checks the code and writes the
   finished site into `dist/`.
2. **The right base path.** A project site lives in a sub-folder
   (`/lattakker/`), not at the root, so every link inside the page must start
   with that folder. [`vite.config.ts`](vite.config.ts) does this: when the
   environment variable `GITHUB_PAGES` is set, `base` is `/lattakker/`,
   otherwise `/` (what `npm run dev` wants).
3. **A workflow that builds and publishes.**
   [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every
   push to `main` (and by hand from the *Actions* tab, "Run workflow"). One job
   checks out the code, installs Node 20, runs `npm ci` and `npm run build`
   with `GITHUB_PAGES=true`, and uploads `dist/` as a Pages artifact. A second
   job hands that artifact to GitHub with `actions/deploy-pages`. It needs the
   permissions `pages: write` and `id-token: write`, and a newer push cancels an
   older deploy that is still running.
4. **One setting in the repository.** *Settings → Pages → Build and
   deployment → Source* is set to **GitHub Actions** (not "Deploy from a
   branch"). That is why no `gh-pages` branch exists. On a free account the
   repository has to be public.

Watching a deploy: open the *Actions* tab of the repository (the run is called
`deploy`), or in a terminal `gh run list --limit 3`. A normal run takes
between half a minute and two minutes. When it is green, the demo is updated.

To see exactly what GitHub will publish, before pushing:

```
GITHUB_PAGES=true npm run build
GITHUB_PAGES=true npm run preview
```

then open `http://localhost:4173/lattakker/` (note the sub-folder; plain
`http://localhost:4173/` just redirects there). Set `GITHUB_PAGES=true` for
the preview as well: without it the preview looks for the files in the wrong
folder and the page stays blank.

To publish **your own copy**: fork the repository, turn on *Settings → Pages →
Source: GitHub Actions*, and push to `main` (or run the workflow by hand). Your
copy appears at `https://<your-name>.github.io/<repository>/`. If you rename
the repository, change `/lattakker/` in `vite.config.ts` to `/<new-name>/`,
otherwise the page loads blank because its scripts are looked up in the wrong
folder.

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
button in its corner makes the strip bigger. To choose the size yourself, **drag the
separator** between the code and the output up or down: the output scales with the pane
(double-click the separator to go back to the small strip). The little AI chat
([11.4](#114-the-built-in-ai-helper-optional)) can be moved by dragging its header.

### 6.3 Tabs and cell paths: where am I?

[↑ Contents](#contents)

The strip at the top of the page is drawn by maxGraph, like the rest of the
page: **🎲 Game board**, **🧪 Lab**, **📚 Examples** and **📡 Monitor**, then the tabs you
add yourself (see [6.5](#65-your-own-tabs-and-the-monitor)). Each of them is a
sheet with code cells (the Examples notebook has big blocks, see below), and all
have cells named `A1`,
`J24` and so on. So a bare address only makes sense *inside one tab*. To name a
cell from anywhere, use a **cell path**, written like a file path, where `/`
means "inside":

| Written | Means |
|---|---|
| `J24` | the cell J24 of the tab you are in (what code normally writes) |
| `J24/3,4` | tile x=3, y=4 of the grid inside block J24 (see `grid()` in [8.1](#81-output-and-looks)) |
| `/lab/J24` | absolute: tab first (`board`, `lab`, `examples`, `monitor`, or a tab of your own), so it works from every tab |
| `/lab/J24/3,4` | the same tile, absolute |
| `@c-1a2b3c4d` | a cell by its **identity** (its `uid`), which follows the code when the cell moves |
| `lattakker:///lab/J24` | an absolute path as a URI (what tools use) |

The path uses only letters, digits and `/ , @ -`, so it needs no escaping in
JSON or in a URL, and in code it is an ordinary string: `at('/lab/J24')`.
TypeScript needs no new syntax. A plain address keeps working exactly as before.

Rest the pointer on a cell and its **address** appears small in its top-left corner after a
second; when the pointer leaves, it fades out slowly, so the last five cells you touched stay
readable for a moment. A short yellow hint under the cell says what a double-click does; tick
**Do not show these hints** in it to switch it off (F1 on a cell has a button to bring it back).

Next to the **⋮** icon of a hovered cell sits a small **magnifier**: it zooms in so the cell fills the
window with some room around it, and then turns amber; press it again to zoom back out to where you
were (zooming by hand forgets the old view). The ⋮ menu has the same item, plus **Duplicate** (a copy of
the code in a free spot) and **Copy → output**.

At the right of the strip, **📍** always shows where you are: click a cell (or a
tile of a grid) and the path follows, for example `📍 /lab/A17/3,4`. Click the
path to copy it. The ⋮ menu of a cell has **Copy → path** and **Copy → id**.

The strip is a small maxGraph drawing, but the real tab buttons are still in
the page, hidden. They keep the keyboard (arrow keys between tabs), screen
readers and AI helpers working: the model is the source of truth and HTML is
only a thin adapter where a browser needs it (the editor, the text mirror).

### 6.4 Working together (Share)

[↑ Contents](#contents)

A learner and a tutor (or two friends) can work on the same cells from two
computers. Click **🤝 Share** in the strip:

1. The person who shares ("I want to share my sheets") types a name and clicks
   *Create my invitation*. A short code appears (it starts with `lk1.`). They
   send it to the other person through any chat.
2. The other person ("I was invited") pastes it, clicks *Create my reply* and
   sends the reply code back.
3. The first person pastes the reply and clicks *Connect*. The strip now says
   `🤝 Name 👁` on both sides.

What happens next:

- *The guest sees the host's cells.* The host's code cells and sizes are copied
  to the guest, in both tabs. The guest's **own** cells are not touched: while
  connected, saving is switched off for the guest, so the guest's own work is
  still in the browser when they leave (the page reloads to bring it back).
- *Each side runs the cells itself.* Only code, sizes, pointers and chat
  travel; moving cells, the game and what cells print are not shared. A demo
  that uses random numbers (the Game of Life) therefore looks different on the
  two screens.
- *View-only is the default.* The host can switch **"Let X change my code"** on
  and off at any time. Only then do edits travel, in both directions (the last
  edit to a cell wins, so take turns). This switch matters: code runs in the
  page, so a person who may write code there can do anything a cell can do.
  Only allow it for someone you trust.
- *Pointers.* A click on a cell or tile shows on the other screen: the cell
  flashes purple and a **🧑 /lab/J24** badge appears in the strip (click it to
  copy the path). The guest can **follow the host between tabs**.
- *Chat.* A line of text in the Share window shows as a notice on the other side.
- *Stopping.* Either side can stop at any time (**Stop sharing** / **Leave**).

How it connects, and what it costs in privacy: the two browsers talk
**directly** over a WebRTC data channel; the two codes are the whole
handshake, there is no server and no account. Without anything else it works
between computers on the **same network** and nothing leaves that network. To
connect across the internet the Share window has an opt-in tick box, *Connect
across the internet*, which uses a public STUN server (a helper that tells each
browser how it looks from outside); that is the only time the page contacts
another server, and only if you tick the box. The page never shares anything
unless a session is running.

### 6.5 Your own tabs and the Monitor

[↑ Contents](#contents)

**＋** at the end of the tab strip makes a new tab: ask for a name and you get a
sheet of its own with everything the others have (cells, blocks, editors, the whole
cell API). Its cells are named with the tab's id (`Plots` becomes `/plots/A1`), and
the tab is an MCP server of that name, so other tabs, AI helpers and tools can reach
it. **Right-click a tab** to rename or close it (closing a tab with code asks twice,
and deletes its cells). Up to 12 tabs of your own; this browser remembers them.
Tabs can also be made from code (`tabs.ensure('plots', 'Plots')`, see
[8.17](#817-making-tabs-from-code-the-tabs-global)) and over MCP (the server `tabs`).

**📡 Monitor** is a tab of the page itself (it cannot be closed): the router drawing
from `resources/router-architecture-Lattakker-gemini-svg.svg`, alive. Every message
that crosses the MCP router lights up the box it goes to and sends a dot along its
line. The AI helper's chat (the question, each model call, each tool) shows too, and so does
an AI chat outside the page (the `outside_ai` box at the bottom, over the dev server's `/mcp`):
its calls run in a dot along the whole way, and the answer comes back. Every line also has a tiny two-line ticker with the last two messages over it
(`→` a question going to the box, `←` its answer with the time it took, `✕` an error). Next to it, live graphs of this computer (processor and graphics card load,
temperatures, memory, frames per second), the router's messages per second and the
weather. They are ordinary cells: change them, copy them into a tab of your own.
Right-click the Monitor tab (or press **↺ Restore monitor**) to put the starting cells
back.

A web page cannot see the processor or the temperatures of the computer it runs on.
While the page is served by the dev server (`npm run dev`) that server reads them
(`/proc`, `/sys`, `nvidia-smi` on Linux) and offers them to this computer only
(`/__lattakker/system`). On the published page the Monitor shows what a browser can
tell (cores, frames per second, battery) and says so.

## 7 Your first program (start here)

[↑ Contents](#contents)

You do not need to know any programming to begin. The game works as it is:
the page opens zoomed in on the red flag (H10); click anywhere and the view glides out
to the board. A new battle is already running every time the page opens: click a red
piece, click a dot. (**New game** brings back the setup, with **Shuffle** and
**Start the battle!**.) A cell's 🔍 zooms in on it; **🔍 Zoom back out**, top right, goes back. Below the board
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
- **Examples** (`/#examples`): a **notebook**. It is a real sheet, like the
  board's and the Lab's (headers, grid lines, the ⋮ menu, popups, the editor),
  but its blocks are big: one example under the other, each with its code at full
  size on top and its **live output underneath**, like the strip under the
  floating editor. The notebook builds the blocks as you scroll, and a search box
  filters them. The shipped examples were written for the game board (they read
  `A12`, paint the squares, write to `L12`...), so they run where they live: a
  notebook block is a large view of the example's own cell on the board. Its code
  is the very same text (edit it in the notebook and the board's cell changes,
  and the other way round), and the output pane shows what that cell shows; a
  click on the pane clicks the cell. The chip in the block's bar says which cell
  it is (`board A12`, or `· your version` once you changed it). **Restart** runs
  it again, **On the board** jumps to the cell, **Original** puts the text back as
  it was written and **Copy** copies it. If you emptied that board cell, the block
  shows the original and **Put on the board** brings it back. The blocks have the
  same help as a cell: hover a word for its type and a plain-words explanation,
  completions, and the coach's hints.

  The empty cells of the notebook are free. **📝 New example** (above the sheet),
  or **⋮ → Create an example here…** on any empty cell (in any tab), makes a
  block of your own from a starting text to fill in: a title line, then your idea
  step by step. It runs right there (`at('/board/A12')` reads the board from it),
  can use everything in [8](#8-programmers-manual-the-cell-api), and is saved in
  this browser. **Show code** switches your own blocks between what they print and
  their TypeScript.

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
cell, and cell addresses expand into a live, editable copy of that cell. (In a block of the Examples notebook
the panel is not drawn: Monaco's hover is the help there.)

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
| `span(cols?, rows?)` | The size this cell wants by default: merge it over `cols` x `rows` cells (never over the board). Leave one out to keep it: `span(4)` keeps the rows. With no arguments it changes nothing and returns `{ cols, rows }`. If the person resizes the block by hand, their size is kept and a plain `span(4, 2)` line is updated to match; change the numbers yourself and your size wins again (see below). |

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

The cell's size can be set (and read) from code, and changed by hand. `span(4, 2)` is
the size the code *wants by default*; the person can also resize the block with the
green handles of the picked block (east, south and south-east; they snap to whole
cells) or make a block from picked cells (8.1.1). Who decides is one rule, kept in
`src/sheet/shape.ts`:

- Nobody said anything: the block keeps its shape (1 × 1 for a new cell).
- Only the code spoke: the code's size is used.
- The person spoke: their size is kept for as long as the code keeps asking for the
  same size. When the code's own numbers change (you edited them, or the code
  computes something else) the code speaks again and wins.
- When the person resizes a block whose code has a plain `span(4, 2)` line, that line
  is rewritten to the new numbers (never while the cell's editor is open, and never
  anything but a plain line of numbers), so the code and the screen never disagree.
  Code without a `span` line is left alone; the shape is simply remembered (and
  saved with the cell).
- Other code or the board in the way limits a resize: the biggest size that fits is
  used, and the status line says so.

#### 8.1.1 Picking cells

The usual gestures: drag over empty cells for a **rubber band** (Alt+drag starts one
over code cells too), **Shift+click** for the rectangle from the first cell,
**Ctrl+click** to add or remove one cell. Picked cells wear the amber frame (empty ones
are tinted). **Enter** makes one block of the picked cells and opens the editor on it
(or edits the one picked cell), **Delete** clears the picked cells with code (press
twice; cells that other cells still read stay), **Esc** lets go. The cell menu has the
same actions: *Make one block of these cells*, *Run*, *Clear*.

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

### 8.9 Cells in other tabs: at('/lab/J24')

[↑ Contents](#contents)

`at()` and `on()` accept a cell path ([6.3](#63-tabs-and-cell-paths-where-am-i)),
so a cell in the Lab can read the board and the other way round:

```ts
// In the Lab: show what the board's cell A12 says, and wake up whenever it changes
show('board A12 says: ' + at('/board/A12').text)
```

- *Reading works and is reactive:* the cell runs again when the other cell
  changes. `.text`, `.code`, `.cols`, `.rows`, `.piece` and a tile's `.fill` and
  `.text` can be read. `at('@c-1a2b3c4d')` finds a cell by its identity.
- *Writing is not allowed:* `print`, `show`, `color`, `span(4, 2)` and a tile's
  `color()` on a cell in another tab throw a clear error ("only its own tab's
  code can change it"). A cell that writes into another tab could not clean up
  after itself when it runs again.
- *Paths follow moves:* insert a row or move a block in the Lab and every
  `'/lab/J24'` written in the board's code is rewritten (and the other way
  round), just like plain addresses within one tab.
- Every cell reference has `cell.tab` (`'lab'`) and `cell.path` (`'/lab/J24'`);
  a tile has the same, plus its own `x` and `y`.
- `range()` only covers the tab the code is in.
- *Two tabs that keep changing each other are stopped.* If a cell is woken more
  than 50 times in a second by cells of another tab (for example a cell in the
  board that shows the Lab's cell plus one, and a Lab cell that shows the
  board's cell plus one), the reader stops with the error "woke this cell up over
  50 times in a second... Do two tabs keep changing each other?". `on()`,
  `mcp.watch` and `mcp.on` have the same guard.

**What crosses tabs, and what does not**

| | Across tabs? |
|---|---|
| Reading a cell: `at('/lab/J24')` | yes, and reactive: the reader runs again when that cell changes |
| Watching: `on('/lab/J24', 'change' \| 'size' \| 'code' \| 'click', fn)` | yes |
| A trigger: `await mcp.click('/lab/J24')` | yes (it wakes that cell's `on(cell, 'click')`) |
| Your own events: `mcp.emit(name, data)` and `mcp.on(name, fn)` | yes, every tab hears them |
| Following a cell over MCP: `mcp.watch(path, fn)` | yes (the news is an MCP notification, a little later than `at()`) |
| The game: `game.*` and `on('game', fn)` | yes: there is one game and every tab is woken when it changes |
| Writing another tab's cell (`print`, `show`, `color`, `span`) | no, read-only; send a signal or use an MCP tool instead |
| `range()`, `on('sheet', 'rows' \| 'mode')` | the tab the code is in only |
| Which tab is in front, where the pointer is | not available to cells (yet) |
| Order between tabs | none: a change in one tab reaches the other a moment later |

### 8.10 Talking to tabs over MCP: the mcp global

[↑ Contents](#contents)

Every tab is also an **MCP server**, and the page has one **router** that carries
the messages. MCP is the small JSON message language that AI helpers use, so a
cell, an outside AI and (one day) another computer all talk to a tab in the same
words. In a cell, the `mcp` global is the way in. Everything in it is
asynchronous, so use `await`:

```ts
const rocket = await mcp.read('/lab/J24')      // the cell as a plain object (text, code, uid, size...)
const cells = await mcp.list('lab')            // the Lab's cells that hold code
const tools = (await mcp.call('lab', 'tools/list')).tools
mcp.watch('/lab/J24', (c) => show(c.text))     // runs now, and again every time that cell changes
await mcp.click('/lab/J24')                    // a TRIGGER: the Lab's on(cell, 'click') wakes up
mcp.emit('wave', 3)                            // a SIGNAL for every cell that listens...
mcp.on('wave', (n, from) => show(n, from))     // ...in any tab
mcp.recent(8)                                  // the last messages that crossed the router
mcp.tap((message) => print(message.method))    // every message, the moment it is sent
```

How it maps to MCP: a cell is a **resource** (`lattakker:///lab/J24`);
`mcp.watch` is `resources/subscribe` plus the server's
`notifications/resources/updated`; `mcp.click`, `run_cell`, `set_code`, `flash`
and `signal` are **tools** (`tools/call`); `mcp.emit` is a notification. The
messages are copied as JSON when they cross the router and answers always
arrive a moment later, as they would over a real connection.

**When to use `at()` and when `mcp`.** `at('/lab/J24')` is direct and
instant, and it makes this cell depend on that one (see [8.9](#89-cells-in-other-tabs-atlabj24)).
Use it for plain reading. `mcp` is for what a message is good at: triggers
(`click`), events (`emit` / `on`), following a cell from another tab with
`watch`, tools, and watching or logging the traffic. Two things to know:

- *Reactivity over MCP is eventually consistent.* The news of a change is a
  notification that arrives after the change, there is no global order between
  tabs, and a read through `mcp` is not a dependency. If two tabs keep changing
  each other the watcher is stopped with an error after 50 wake-ups in a second.
- *The same router serves AI helpers.* They use `mms.mcp('lab', 'tools/list')`
  and `mms.mcpLog()`, or the tools `mcp_request` and `mcp_log`, so an assistant
  can ask a tab anything a cell can and can watch what the cells say to each
  other.

See it work: on the Game board, **A15** shows every way to name a cell, including
cells of the Lab; **A42** counts changes of the Lab's rocket; **G42** asks the
Lab over MCP; **M42** is a button that starts the Lab's rocket (a trigger over
MCP); **Q42** shouts a `wave` that the Lab's **A31** answers with an `echo`;
and **U42** shows the traffic live.

### Moving around: cell links and ◀ ▶

A path that names a real cell is a **blue link** wherever the page shows one: in the Inputs panel, in the AI chat
(where a question was asked, a code suggestion's cell, and `A12` or `/lab/A41` written in `code` marks in an answer).
Clicking it opens that tab, flies to the cell and zooms so that its block fills the window, then gives it a short
pulse. The flight eases in and out and takes about a second (longer for a longer way, with a little zoom out
halfway on far jumps), because its job is to let the eye follow where the view went. The ◀ ▶ buttons right of 🤖 AI (or Alt+← and Alt+→) go back and forward through the places you
visited, like an editor: switching tabs or following a link adds a place, clicking around inside a tab does not, and
going back also restores how that place was zoomed and scrolled.

### 8.11 The MCP servers of the page and the router's statistics

[↑ Contents](#contents)

Tabs are not the only MCP servers. Everything that can be asked something is
one, and they all sit on the same router:

| Server | What it is for | Tools |
| --- | --- | --- |
| `board`, `lab`, `examples` | the cells of a tab | `list_cells`, `get_cell`, `run_cell`, `set_code`, `click`, `flash`, `signal` |
| `router` | the router itself | `stats`, `catalog`, `servers`, `recent`, `reset_stats` |
| `weather` | the weather ([8.12](#812-the-weather)) | `now`, `forecast`, `find` |
| `ollama` | the model on this computer ([8.13](#813-the-model-on-this-computer-ollama)) | `status`, `models`, `ask` |
| `memory` | the helper's notes and little database | `remember`, `recall`, `db_put` ... |
| `status` | what is going on right now | `jobs` |
| `helper`, `local-ai` | the built-in AI helper and its second brain | `ask`, `consult` ... |

Not sure what exists? Ask the router. It is the first thing to try for a person,
a cell or an AI helper (the helper has a `discover` tool for it):

```ts
const everything = await mcp.catalog()          // every server: what it is for, its tools, how many resources
print((await mcp.tools('weather')).map((t) => t.name))
const s = mcp.stats()                            // instant, not a message itself
print(s.messages, 'messages,', s.errors, 'errors,', s.ratePerSecond, 'per second')
plot(s.perSecond)                                // messages per second over the last minute
print(s.servers[0])                              // busiest server: { name, requests, errors, avgMs, maxMs }
print(s.clients[0], s.methods[0], s.slowest)     // who asks most, what is asked most, the slowest answer
mcp.resetStats()                                 // start counting again
```

`mcp.stats()` is the same data as `mcp.tool('router', 'stats')`. It counts every
request, answer, error and notification that crossed the router since the page
started (nothing is estimated). Reading it is not a dependency: use
`every('1s', ...)` to follow it. The Lab's **A35** is a live dashboard and **J35**
lists the servers.

### 8.12 The weather

[↑ Contents](#contents)

```ts
const w = await weather.now('Amsterdam')         // also 'Paris, France', '52.37,4.89' or { lat, lon }
print(w.icon, w.temperature + '°C', w.text, 'wind', w.wind, 'km/h from', w.windFrom)
const f = await weather.forecast('Oslo', 5)      // 1 to 7 days: { place, now, days: [{ date, min, max, rain, ... }] }
plot(f.days.map((d) => d.max), { title: 'highest temperature' })
print(await weather.find('Springfield'))         // places with that name, with country and coordinates
print(await weather.text('Tokyo'))               // one sentence
```

The data comes from [Open-Meteo](https://open-meteo.com) (free, no key). **A lookup
sends the place name, or the coordinates, to open-meteo.com and nothing else.**
Answers are kept for 10 minutes and the page asks at most 20 times a minute, so
`every('1s', ...)` with a weather call is pointless and refused after a while. It
can be switched off for the whole page in the helper settings (⚙, "Other"). Over
MCP it is the server `weather` (`now`, `forecast`, `find`), so the built-in helper
and outside AIs can ask too. Try the Lab's **A41**.

### 8.13 The model on this computer (Ollama)

[↑ Contents](#contents)

```ts
const s = await ollama.status()                   // never throws
if (!s.ready) print(s.message)                    // says in plain words what is missing and what to do
else print(await ollama.ask('Explain a loop to a child in two sentences.'))
print((await ollama.models()).map((m) => m.name + ' ' + m.sizeGB + ' GB'))
print(await ollama.chat([{ role: 'user', content: 'Hi!' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: 'And now in Dutch.' }], { system: 'Be brief.' }))
```

It talks to the address in the helper settings (default `http://localhost:11434`)
and to the model chosen there (else the first installed one). Nothing leaves the
computer. If the server is not found, every call says so: install
[Ollama](https://ollama.com), start it (`ollama serve`), pull a model
(`ollama pull qwen2.5-coder:7b`) and start it with
`OLLAMA_ORIGINS=<the address of this page>` so the page may talk to it. The AI
chat's header shows the same warning in orange whenever a local model is chosen but
does not answer. Ask one thing at a time (`await` it); the first question can be
slow while the model loads, and a third question at the same time is refused when two
are already running. LM Studio and other servers with the OpenAI-style door work
for `ask` and `chat`; `status` then says it is not Ollama itself. Over MCP: the
server `ollama` (`status`, `models`, `ask`; outside AIs may only `ask` when the
person allowed outside questions). Try the Lab's **J41**.

### 8.14 Input from the person: the input global

[↑ Contents](#contents)

```ts
const name = await input.ask('Your name?', 'Ada')              // text, or null when cancelled
if (await input.confirm('Start over?')) seed()                  // yes or no
const colour = await input.choose('Colour?', ['red', 'blue'])   // one of the words, or null
const speed = input.slider('speed', { min: 1, max: 10, step: 1, value: 3 }, (v) => print('speed', v))
input.number('size', 8, (n) => resize(n))
input.text('place', 'Amsterdam', (p) => draw(p))
input.checkbox('sound', true, (on) => ...)
input.select('mode', ['easy', 'hard'], (m) => ...)
input.button('reset', () => seed())
speed.value; speed.set(5); speed.remove()
input.onKey((key, { shift, ctrl, alt, repeat }) => ...)       // 'a', 'ArrowLeft', 'Enter', 'Space'
input.isDown('ArrowLeft')                                       // is it held right now?
```

Questions appear as a card at the top of the page, one at a time. Controls live in
a small "🎛 Inputs" panel at the bottom left, grouped by the cell that made them.
They go away when the cell runs again or calls `stop()`, and a control comes back
with the value the person had given it. The change function runs as an event
handler of the cell (one at a time, errors land on the cell), so **put the code that
uses a value inside the function**: the cell does not re-run by itself when a
control changes. Keys are only heard while the person is not typing in a box or an
editor. A cell can have 24 controls, the page 60. See the Lab's **R35** (arrow
keys), **A41** and **J41** (text boxes).

### 8.15 Animated drawings: the svg global

[↑ Contents](#contents)

SVG is a picture written as text. `svg()` puts one in a cell or block and gives back
a handle to find its parts by `id`, move, turn, recolour and animate them.

```ts
span(5, 5)
const pic = svg(svg.asset('stickman'))                   // a drawing that comes with the app
const arm = pic.el('armR').pivot('top')                   // find a part; pivot = where it turns
await arm.animate({ rotate: -140 }, { time: '300ms', ease: 'bounce' })
pic.el('head').on('click', () => pic.el('speech').text('Hello!'))
pic.frame((t, dt) => pic.el('man').move(Math.sin(t) * 20, 0))   // every screen frame (about 60 a second)
```

- `svg(markup)` shows the drawing; `svg()` alone is a blank one (`pic.add('circle', { cx, cy, r })`,
  `pic.write(x, y, 'words')`, `pic.viewBox(...)`, `pic.clear()`).
- Parts: `attr`, `text`, `fill`, `stroke`, `opacity`, `show`/`hide`, `bbox`, `move`, `rotate`, `scale`,
  `pivot`, `add`, `remove`, `on(event, fn)`. A drawing can set a pivot itself with `data-pivot="x y"`.
- `animate(props, options)` changes properties smoothly: `x`, `y` (move), `rotate`, `scale`, `opacity`,
  any attribute (numbers and colours), and `along: '#path-id'` to ride a path.
  Options: `time`, `ease` (`linear`, `in`, `out`, `inOut`, `bounce`, `elastic`, `back`), `delay`, `loop`,
  `yoyo`, `reverse`. It returns something you can `await`, with `.stop()`.
- `svg.asset('stickman')` and `svg.asset('router-architecture')` come with the app (see `svg.assets()`).
  The router drawing is the file in `resources/`; its boxes get the ids `node-board`, `node-lab`,
  `node-weather` ... `node-outside_ai` and its lines `link-board` ... `link-outside_ai` when it is loaded.
  Every line is drawn from the router to its box (`link-outside_ai` runs from the outside AI to the dev server). The tickers are `tick-NAME-1` and `tick-NAME-2`
  (empty in the file; the Monitor's A1 fills them in, and `data-chars` says how many letters fit).
- Scripts, `on...` attributes and `javascript:` links in a drawing are removed. Handlers and frames stop
  when the cell runs again. See the Lab's **A47** (the stickman) and the Monitor's **A1**.

### 8.16 How this computer is doing: the system global

[↑ Contents](#contents)

```ts
const s = await system.read()        // { source, cpu: { load, cores, model, temp }, memory, gpu, temps, browser: { fps, ... } }
print(await system.text())            // 'CPU 31% 57°C, memory 24%, GPU 27% 28°C, 60 fps'
every('1s', async () => { await system.read(); plot(system.series('cpu', 60)) })   // 'cpu', 'cpuTemp', 'gpu', 'gpuTemp', 'memory', 'fps'
```

`source` says where the numbers come from: `'dev-server'` (measured, see
[6.5](#65-your-own-tabs-and-the-monitor)) or `'browser'` (only what a browser tells; the rest is
`null`). `series()` fills while somebody calls `read()`. Over MCP: server `system`, tools `read`, `history`.

### 8.17 Making tabs from code: the tabs global

[↑ Contents](#contents)

```ts
tabs.ensure('plots', 'Plots', { icon: '📈', cells: { A1: 'plot([1, 4, 9])' } })   // made once, safe to run again
const t = tabs.create('Scratch')     // a new tab every time: { id: 'scratch', title, icon, builtin, active, cells }
tabs.list(); tabs.rename('scratch', 'Notes'); tabs.select('plots'); tabs.close('scratch')
```

Use `ensure` in a cell that can run again; `create` makes one more tab on every run. The page's own
tabs (`board`, `lab`, `examples`, `monitor`) cannot be renamed or closed. Over MCP: server `tabs`, tools
`list`, `create`, `ensure`, `rename`, `close`, `select`. The built-in AI helper may list and select tabs;
making, renaming and closing them needs the helper setting that lets it write code.

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

The page contains **no AI service**. By design it makes no network calls on
its own: the only exceptions are the Share session of
[6.4](#64-working-together-share) and the optional helper of
[11.4](#114-the-built-in-ai-helper-optional), and both start only when you
choose them. Out of the box it needs no API key. The page is made easy
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
  Cells are named by *paths* ([6.3](#63-tabs-and-cell-paths-where-am-i)):
  `mms.tabs()` lists the tabs, `mms.cells('lab')` (or `'all'`) lists another
  tab's cells, and every cell comes back with `tab`, `address`, `path` and
  `uid`. Calls accept a path (`mms.getCell('/lab/J24')`) or a tab
  (`mms.getCell('J24', 'lab')`); the MCP tools take a `tab` argument and there
  is a `list_tabs` tool. A bare `J24` still means the board tab.
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
  editor that is not saved yet (Esc and Ctrl+Enter both restart the cell with the new code; `unsaved` in `requests()` marks text still in the open editor).

#### 11.1.2 Suggesting

[↑ Contents](#contents)

What exists today:

- `mms.setCode('E24', newCode, { run: true })` replaces the code of a cell and
  runs it. It returns `{ ok: true, address, uid, output, text }` or
  `{ ok: false, error, address, uid, output }` straight away (`error` is a plain
  string: `line 6: '}' expected.` for the first syntax error, just the message
  for a runtime error, no codes; type errors do not stop a cell from running), so the assistant can try its own idea, read the error, and fix it
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
  and error. Each cell is one list item, `A12: code: <first 3 lines joined with
  " / ", at most 200 characters> | output: <...> | error: <...>`, so the code
  there can be cut short and only `mms.getCell` returns all of it. It also sees the text of an open editor in the accessibility tree.
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
`resume_battle`, `undo_move`, `new_game`, `list_tabs`, `list_cells`, `get_cell`,
`resolve_cell`, `set_cell_code`, `write_code_live`, `get_requests`,
`wait_for_request`, `reply_to_request`, `run_cell`, `set_mode`, `say_to_player`,
`mcp_request`, `mcp_log` and `export_svg`. The assistant gets the list from the page itself, so it is
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
still typing in the open editor, before Restart), or waits for one with
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
appear in the editor and presses Esc (or Restart & close) to keep it and run it.

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
  and again to keep listening) and answer with reply_to_request. The page
  cannot wake you, so while the child is playing and has not told you to stop,
  end each turn by calling wait_for_request again; stop listening when asked.
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

### 11.4 The built-in AI helper (optional)

[↑ Contents](#contents)

The **🤖 AI** button in the tab strip opens a chat on the right (like the chat
of a code editor). The same conversation is also available as a **tiny pop-up
next to any cell**. The helper knows which cell you are pointing at, and it
looks at your cells the same way an outside assistant would: through the
page's own MCP router ([8.10](#810-talking-to-tabs-over-mcp-the-mcp-global)),
so everything it reads shows up in the MCP monitor cell (U42) as traffic from
`ai-chat`.

Nothing is sent anywhere until a grown-up has chosen a helper in its settings (⚙).

#### 11.4.1 Choosing a helper

- **A model on this computer (recommended, and the default).** Any server that
  speaks the OpenAI chat format on your own machine, for example
  [Ollama](https://ollama.com) or LM Studio. It is free and private: nothing
  leaves the computer. Best for children. Set it up once:
  1. Install Ollama and get a model that can use tools, for example
     `ollama pull qwen2.5-coder:7b`.
  2. Let the page talk to it: start Ollama with
     `OLLAMA_ORIGINS=http://localhost:5173` (or the address of the page; the
     live demo needs `https://springyworks.github.io`).
  3. Open ⚙ in the helper, press **Find models**, pick one.
  Ollama starts with a small memory (4096 tokens): if answers get cut off, start
  it with `OLLAMA_CONTEXT_LENGTH=8192`. Models that think out loud are told not
  to (`reasoning_effort: none`), so answers come in seconds, not minutes.
  On the live (https) page your browser may ask whether the site may reach
  devices on your own network: allow it.
- **Google Gemini (adults only, off by default).** Called straight from the page
  with your own API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
  Google's terms (https://ai.google.dev/gemini-api/terms, checked March 2026)
  say the API is for people of **18 or older**, must **not be used in an app
  directed at, or likely to be used by, people under 18**, and that in the
  EEA, Switzerland and the UK a **paid** service is required when an app is
  offered to others. On the free tier Google may use what is sent to improve
  its products and people may read it. That is why it is not the default for a
  children's app, and why the settings make you tick *"I am 18 or older"*
  before a key can be entered. The helper was written against Google's API
  description and tested with a stand-in server, not with a real Gemini key.
- **Microsoft Copilot** is not available: it has no free way to be called from
  a web page.

The key is kept **in memory only** (gone when the page closes) unless you tick
*Remember the key on this computer*. Code in a cell can read the browser's
storage, so a remembered key is a choice with a cost: do it only on your own
computer. It is never put on `window`, and "Forget all helper settings and
keys" wipes everything. The line under the input always says where your
question goes.

Under the header a tiny line says **who answers**: the company, the model, where
it runs and a rough guess how well it writes code (for example "Google ·
gemini-flash-lite-latest · Google (online) · fastest and simplest: short, easy
code"). It is a guess made from the model's name only; how smart a model feels
depends on the task and on who is asking. Each answer ends with a small "via …".
While the helper waits, the chat shows a clock and a few lines of what is going
on and what it waits for ("Google answered HTTP 503 (busy). Trying again in 4 s…").
Every output pane next to an editor (floating editor, Examples blocks, hover
previews) and the chat itself have the app's own right-click menu.

#### 11.4.2 Asking: the 🤖 button, Alt+I, right-click

- In a code editor, **Ctrl+I** (as in VS Code) opens the little chat at the cursor, knowing the line and any selected text. **“🤖 Ask the AI…” is always the first item of every right-click menu** with a cell behind it.
- **🤖 AI** in the strip, or **Alt+I** anywhere (also inside an editor): the side
  chat. Its 📍 chip shows the cell the question will be about; click another
  cell and it follows. **Alt+Shift+I** opens the little pop-up at that cell.
- Right-click a cell, the ⋮ menu, a code editor, the title bar or output strip
  of the floating editor: **🤖 Ask the AI about this…** (a pop-up next to it).
- Every Examples block has a **🤖 Ask** button.
- Press **⇥** in the pop-up to move the conversation to the side chat; both show
  the same story.

#### 11.4.3 A “// AI:” line pops the helper up

Write a comment line such as `// AI: why is this red?` in a cell, or just
`//ai` or `//help` on its own line (any capitals, with or without a colon), and
leave it alone. After **3 seconds** (change it in ⚙, 3 to 600) the pop-up opens
by itself and asks the question (for a bare `//ai` or `//help`: "please look at
my code here and help me"). The helper is told **which cell and which line** you
wrote it on, and reads the text in the open editor even if it is not saved
yet, so "here" means that line. It writes its answer back under your line as `// ↳ AI: …`,
exactly as an outside assistant would. If it wants to add code *at that spot*,
it shows a card with **✍ Add it below line N**: only when you press it, the
lines are inserted there (Ctrl+Z undoes it). If an outside assistant is already
listening on MCP (`wait_for_request`), the built-in helper stays quiet so
nobody answers twice. Without a helper set up you only get a one-time hint.

#### 11.4.4 What the helper can and cannot do

It can: look at the cell you are in, list and read cells in any tab, read the
game, read the guide, make a cell blink, **take you to a cell** (`goto_cell`:
it opens the tab, flies there and blinks the cell), **run a cell** and tell you
what it printed or why it failed (`run_cell`), find an empty spot
(`find_free_cell`), speak **raw MCP** to any tab (`mcp_call`: `resources/list`,
`resources/read`, `tools/list`, `tools/call` for `get_cell`, `list_cells`,
`run_cell`, `click`, `flash`, `signal`), and **suggest** code. A suggestion
is a card with the code and the button *✍ Type it into A13*: only if you press
it, the code is typed slowly into the cell where you watch, and you keep it
with Esc or **Restart & close**.

A bare cell name such as `A16` exists in every tab. When it is empty in the tab
you are in and exactly one other tab has code there, the helper's tools use that
one and say so (`/lab/A16`); when two tabs qualify it asks which. Cell names in
the chat (`/lab/A16`, or `A16` when it holds code) are blue links that fly to the
cell.

**Small models** (a model on this computer whose name says under 14B, such as
`qwen3.5:4b`) get a shorter list of ten tools and shorter instructions, because a
long list makes them fumble. Bigger models and Gemini get everything.

**Writing by itself** is off by default. A grown-up can switch on *Let the helper
write code in empty cells by itself* in the helper settings (⚙, "Other"). The
helper then uses `write_code`: it picks (or is given) an **empty** cell, the code
is typed where you watch, it is kept and run, and the helper sees what it printed
or its error and may fix it. Every such write gets a card with *👀 Show me* and
*↶ Undo* (undo only removes the code if nobody changed the cell since). It never
touches a cell that already has code, only writes in the board and Lab tabs, and
does so at most six times per conversation. No single tool call keeps the chat
waiting longer than 40 seconds, and Stop ends it at once.

It cannot: change a cell that already has code (`set_code` is refused for it),
move pieces, or start or end games. Text inside cells is treated as data, never
as orders, and what the model writes is shown as plain text (no markup is ever
executed). The code is in `src/aichat/` (providers, tools, the agent loop,
the chat window, the watcher).

#### 11.4.5 Memory, and outside AIs asking the helper

The helper has a **memory**: short notes (title, text, tags) in this browser's
IndexedDB, so they survive a reload. It reads them with `recall` and writes with
`remember`; it tidies them (`tidy_memory`: find near-duplicates, merge, forget)
when asked. Notes that look like personal information (e-mail, phone, address,
password, key) are refused. In ⚙ you can look through the notes, forget
them, **back them up to a file** (and load a backup), and ask the browser to keep
the storage safe. If the browser wipes its storage the memory starts over, so
back up what you care about.

**One memory for everything (dev server).** A browser keeps its storage per
address, so every port of `npm run dev` would have its own memory. While the dev
server runs, the notes and the little database are therefore also kept in one
file, `~/.lattakker/memory.json` (or the path in `LATTAKKER_MEMORY`), and every
page, whatever its port, uses it. A page merges the file in when it starts
(the newer copy of a note wins), writes every change a moment later, and takes
the file over when it gets the focus back, so a note forgotten in one page is gone
in the others (one old copy in another port's browser storage can bring it back
once, when that page first starts). The file is plain JSON: the command line or an
AI in the editor can read it, and the helper reads it like any note. Only this
computer may reach it (`/__lattakker/memory`, loopback only). The published page
has no server, so there the memory stays in the browser and the backup button is
the way to move it.

The memory and the helper are MCP servers on the page's router, named `memory`
and `helper`. An outside AI uses them like the tabs
([8.10](#810-talking-to-tabs-over-mcp-the-mcp-global)):
`mms.mcp('memory', 'tools/call', { name: 'recall', arguments: { query: 'rocket' } })`.
`mms.mcp('helper', 'tools/call', { name: 'ask', arguments: { question: '…' } })`
puts a question to the built-in helper, but only after a person ticks **Let an
outside AI ask the helper** in ⚙ (off by default, because it spends your own key
or computer). The question appears in the chat marked as coming from an outside AI.

**The second brain.** When the main helper is Gemini and a model on your own
computer is also set up (⚙, "Second brain"; Ollama or LM Studio) and answering, the
chat header says "🧠 second brain: …" and Gemini gets three more tools:
`consult_local` (ask the local model something: it can look in the memory and the
database first), `teach_local` (hand it knowledge: it decides whether that
becomes notes or **database records**, and avoids duplicates) and `manage_local`
(database administration: merge duplicates, list collections, forget things). The
local model is the **librarian**: it has the memory tools and a small database
(`db_put`, `db_get`, `db_query`, `db_delete`, `db_collections`: named collections
of JSON records, kept in IndexedDB next to the notes, included in the backup file).
Everything goes over the router as the server `local-ai` (you can watch it in the
MCP monitor); an outside AI may use `local-ai` and `memory` too, but only when
**Let an outside AI ask the helper** is ticked. If the local model is not there, the
tools are simply not offered. The chat tells you what the local model is doing
("filing new knowledge… answered after 52 s (3 database steps)").
A big model that has been idle must be loaded into memory first, which can take
**minutes** (a 22 GB model did here); the chat says so, and the page waits up to
15 minutes instead of giving up. For a snappier librarian choose a small model
(a 3 to 7 billion parameter one).

*A model that runs inside the page itself* (WebGPU) is not built in: it needs a
download of hundreds of megabytes and a browser with WebGPU. The helper's providers
are one small interface (`providers.ts`), so such a model can be added there later and
the memory and the `helper` server will work with it unchanged.

#### 11.4.6 What is going on? The status service

A person is never left watching a silent screen. Everything that takes time
(the chat, a call to Google, a tool, the local model, the database) opens a
**job** (`src/aichat/jobs.ts`), says in words what it does and what it waits for,
and gives a **sign of life** whenever something really happened: an answer
arrived, a word of the answer was received, a server replied to a poll. Jobs
nest, so a chat that waits for a tool that waits for the local model shows as a chain:

```
⚙️ chat: answering “Teach the local model what a variable is” [25 s]
  ⚙️ tool: teach_local [25 s]
    ⚙️ local-ai: filing knowledge — the local model decides how to store the material
      ⏳ local-model: qwen3.6 — the model is in memory and works on the question; no word yet (24 s)
```

It is not a timer that runs by itself: each line shows how long ago the job last
showed a sign of life, and one that is quiet for too long is marked
"⚠ nothing heard for 60 s: it may be stuck". What each service can honestly know:

- *Google* (answers arrive all at once): "question sent, the answer has not arrived
  yet". No answer within 120 s: it is asked again (3 tries), then the chat says so.
- *The local model* (answers arrive word by word): every word is a sign of life.
  Before the first word the page asks Ollama whether the model is in memory:
  "not in memory yet: most likely still loading" (allowed for up to 20 minutes) or
  "in memory and working on it".
- *The librarian's claims are checked*: a small model sometimes says it stored
  something without doing it. After `teach` the counts of notes and records are
  compared, it is asked once more to really use a tool, and if nothing was written the
  answer is a failure, not a story.

The same list is an MCP server named `status`: **🔎 Status** in the chat asks it, a
cell can (`mcp.call('status', 'tools/call', { name: 'jobs' })`), and so can an outside
AI (`mms.mcp('status', 'tools/call', { name: 'jobs' })`). **Stop** cancels the whole chain.

*Why am I waiting, and where?* While the helper works, a line above the list says in
plain words what is being waited for (“The model is being loaded into this computer's
memory”, “The helper is using a tool: write_code”), the **chain** that leads there
(`chat › local-model qwen3.5:4b`) and, when there is something to try, a 💡 hint.
Nothing is guessed: `src/aichat/diagnose.ts` only rephrases what the jobs reported. If
Ollama is busy holding another model, it says which and how to free it
(`ollama stop <model>`).

*Ammunition: the model's memory.* A model can only hold so many tokens in mind (its
context window). Ollama's own default is 4096, which is less than the helper's
instructions plus its tool descriptions plus one `read_guide` answer; the server then
silently drops the oldest part, which is the instructions, and the answers turn
strange. So: for Ollama the page uses its native `/api/chat` and asks for `num_ctx`
itself (**⚙ › Memory of the chat**, 16k by default); the header shows a measured
**🔋 4.9k of 16k tokens in use** (the server's own count); before every question
old, long tool answers are shortened to fit, and a model with a tiny memory gets the
shortest tool list, each with a note in the chat. Other servers (LM Studio ...) keep
the OpenAI-style door and show no gauge. The code is `src/aichat/ammo.ts`.

#### 11.4.7 Help and “show me”, everywhere

**F1** opens a small help card for whatever you are pointing at: the picked cell
(it reads the cell's own comments, shows what it prints and offers *👀 Show me this
cell*, *✏️ Edit*, *▶ Run again*, *🤖 Ask the helper*), the helper, the Inputs panel,
the tabs or the code editor. Inside a code editor F1 stays Monaco's list of
commands and **Shift+F1** is the help. A tiny **?** sits in the tab strip, the
Lab and Examples bars, the Inputs panel and the helper's headers, and every cell's
menu (hover ⋮, or right-click) has *❓ Help for this cell*. *👀 Show me around*
is a five-step tour that lights up the tabs, the cell path, the AI button, the
cells and the **?** with a pulsing ring. The code is in `src/ui/help.ts`.

**Links that follow.** A blue cell link (in the chat, the help card, the Inputs panel)
remembers its cell by identity, not by address. When the cell is moved, shifted by a
new row, or made room for, the link's words, tooltip and target update by themselves
and flash once; when the cell's code is cleared the link turns grey and struck
through. The focused cell (the path chip in the tab strip, the highlighted cell) and
the ◀ ▶ history follow in the same way. The sheets report moves through
`workspace.onCellsChanged` (`src/workspace.ts`), once per burst of changes.

**The cell under attention** (the one you clicked, or were taken to by a link, “go to”
or the helper) has a see-through amber frame, so its own content stays readable.
**The chat's width** is changed by dragging the thin bar at its left edge (it sticks
softly at 380, 480 and 600 px), with the arrow keys, or by double-click to reset; it is
remembered.

#### 11.4.8 Documents for AIs: rules, API, examples, README

An AI helps best the way a human coder does: with the rules, the API and examples.
Everything is published next to the page (and by the dev server) as plain files, made
from the real sources by `scripts/ai-docs.ts`, so they cannot drift from the code the
children play with:

| File | What it is |
| --- | --- |
| `ai/index.md` | what exists and where; start here |
| `ai/rules.md` | how to behave with children, how to work like a coder, the rules of cell code (source: `ai-docs/rules.md`) |
| `ai/cell-api.d.ts` | the TypeScript declarations of everything a cell can use (from `src/sheet/apiTypes.ts`) |
| `ai/examples.md`, `ai/lab-demos.md` | every example cell and Lab demo with its comments, headed by its cell path (from `src/examples.ts`, `src/labDemos.ts`) |
| `ai/README.md` | this README |
| `ai/everything.md`, `ai/manifest.json` | all of it in one file; the same list for programs |

On GitHub the sources are
[README.md](https://github.com/springyworks/lattakker/blob/main/README.md),
[src/sheet/apiTypes.ts](https://github.com/springyworks/lattakker/blob/main/src/sheet/apiTypes.ts),
[src/examples.ts](https://github.com/springyworks/lattakker/blob/main/src/examples.ts) and
[src/labDemos.ts](https://github.com/springyworks/lattakker/blob/main/src/labDemos.ts).

- **Outside AIs** find the addresses in `llms.txt` (“Read these first”), in the page's
  `<head>`, in `mms.help()` and with `mms.docs()` (also the WebMCP tool `get_docs`).
- **The built-in helper** gets the same rules in its instructions (one file, so it
  cannot disagree with the published one) and the tool `read_docs`: `doc: "api"` with a
  query (“plot”, “CellRef flash”) gives exact signatures, `doc: "examples"` with a few
  words finds working cells (or `path: "/lab/A16"` returns one whole), `doc: "readme"`
  finds a topic. Answers are cut to fit the model's memory (🔋). The helper is told never
  to invent a function or a cell path; a path that a tool returned can be opened with
  `goto_cell`. The code is in `src/aichat/docs.ts`.

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
src/ui/           Control panel, phone dock, touch gestures, the tab strip (Tabs.ts, drawn by TabStrip.ts), the Share window (ShareDialog.ts), the Examples notebook (Notebook.ts), SheetPane.ts (everything one sheet needs; used by the board and the Lab) and the ⋮ menu (CellMenu.ts, HoverMenu.ts)
src/mcp/          The MCP layer: router.ts (the page's message router and traffic log), tabServer.ts (one MCP server per tab)
src/workspace.ts  The workspace: every tab, cell paths (/lab/J24, @uid), where you and the other person are
src/share/        Sharing: link.ts (the WebRTC link and its copy-paste codes), session.ts (what travels, and the checks on it)
src/sheetTab.ts   A tab with a sheet of its own (toolbar, saving), used by the Lab, the Monitor and every tab you add; lab.ts and labDemos.ts (the Lab), monitorDemos.ts (the Monitor)
src/tabManager.ts Tabs that come and go: the ＋ and the right-click menu, tabs.* in cells, MCP server `tabs` (services/tabsServer.ts)
src/sheet/overlays.ts   Small pictures over the cells (rubber band, address tags, id badges, the glide of blocks making room) drawn by maxGraph itself on the UI layer: no loose HTML on top of the board
src/sheet/svgScene.ts, svgAssets.ts   The animated-SVG engine (the svg global) and the drawings that come with the app
src/services/system.ts + scripts/system-stats.ts   How this computer is doing (the system global; the dev server reads /proc, /sys, nvidia-smi)
src/storage.ts    Saves and restores the game and cells in localStorage
src/ai/           window.mms, WebMCP tools, the text copy for AI helpers, and bridge.ts (the page end of /mcp)
src/aichat/       The built-in helper: providers.ts (local OpenAI-compatible server, Gemini), tools.ts (what it may do, over the page's MCP), agent.ts, ui.ts (side chat + pop-up + settings), watcher.ts (the // AI: lines), config.ts (settings; keys stay in memory)
src/theme.ts      The colour palette
src/examples.ts   The code cells shown on first load. Like labDemos.ts and recipes.ts, every line is explained by a // comment above it in plain words for beginners: keep it that way when you add or change a cell
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
`dist/` to GitHub Pages on every push to `main`. How that works, how to watch
it and how to publish your own copy is explained in
[3.2](#32-how-the-demo-got-to-githubio).

## 17 Source

[↑ Contents](#contents)

[L'Attaque wikipedia](https://en.wikipedia.org/wiki/L%27Attaque)
