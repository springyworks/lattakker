/**
 * The cells the "Cells talk" tab starts with: cells that use each other's functions inside one tab. A cell writes `export` in front of
 * what it offers, another cell writes `import { name } from './A4'`; it is a real call in the same page (see sheet/cellModules.ts).
 * They are ordinary cells: open one, change it, copy it into your own tab.
 */
export const RPC_DEMOS: ReadonlyArray<readonly [string, string]> = [
  [
    'A1',
    String.raw`// CELLS THAT TALK TO EACH OTHER.
// In one tab a cell can use the functions of another cell, like a person asking a neighbour.
// The cell that OFFERS something writes the word export in front of it.
// The cell that WANTS it writes import { name } from './A4', where A4 is the address of the other cell.
// Type from ' and the cells of this tab are offered; the editor knows the types of what they export.
// It is a real call: the function runs at once, in this page, and the answer comes back at once.
// The cell you import from runs first. When you change it, the cells that use it run again by themselves.
// Change a name in A4 and, a moment later, the cell that uses it shows a red line.
// Drag a cell somewhere else and the './A4' in the cells that use it follows.

/** Sets the size and the colour of this cell. */
span(12, 3)
color('#ece3f6')

/** Shows the title and a map of which cell uses which. */
print('🔗 Cells that talk')
print('export in one cell, import in another')
print('A4 → G4 · A8 → G8 · A11 → G11 · A15 → G15 · A43 → G43 (a Roman bakery feeds the philosophers)')`,
  ],
  [
    'A4',
    String.raw`// This cell OFFERS things. The word export means: other cells may use this.
span(6, 4)
color('#dbe8f7')

/** A function other cells can call. The types (: number) are checked where it is called. */
export function add(a: number, b: number): number {
  return a + b
}

/** A second function. */
export function square(n: number): number {
  return n * n
}

/** A value to share. */
export const TAU = Math.PI * 2

/** Tells what this cell offers. */
print('📦 offers: add, square, TAU')`,
  ],
  [
    'G4',
    String.raw`// This cell USES what A4 offers. The names come from A4 and the editor knows what they are.
span(6, 4)
color('#e4f2e1')

/** Brings in the three names that A4 offers. */
import { add, square, TAU } from './A4'

/** Uses them and shows the answers. */
print('add(2, 3) = ' + add(2, 3))
print('square(7) = ' + square(7))
print('TAU = ' + TAU.toFixed(3))
// Try it: write add(2, 'x') and see the red line, a number was expected.`,
  ],
  [
    'A8',
    String.raw`// A cell can keep something for the others: this number lives here, and they change it by calling bump().
span(6, 3)
color('#dbe8f7')

/** The number this cell keeps for the others. */
let count = 0

/** Adds to the number and returns the new value. */
export function bump(by = 1): number {
  count += by

  /** show() writes in THIS cell, even when another cell called bump(). */
  show('count = ' + count)
  return count
}

/** Puts the number back to 0. */
export function reset(): void {
  count = 0
  show('count = 0')
}

/** Shows the start value. */
show('count = 0')`,
  ],
  [
    'G8',
    String.raw`// Every 2 seconds this cell calls bump() in A8, and the answer comes back at once.
span(6, 3)
color('#e4f2e1')

/** Brings in bump() from A8. */
import { bump } from './A8'

/** Every 2 seconds: call bump() and show the answer. */
every('2s', () => {
  const n = bump(1)
  print('A8 says: ' + n)
})`,
  ],
  [
    'A11',
    String.raw`// Types can be offered too. A type is only for the editor: it is checked while you type and costs nothing when the cell runs.
span(6, 4)
color('#dbe8f7')

/** A point on the plane: a type only the editor sees. */
export interface Point {
  x: number
  y: number
}

/** The straight distance between two points. */
export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** An async function works too: the caller just writes await. */
export async function slowDouble(n: number): Promise<number> {
  await sleep(300)
  return n * 2
}

/** Tells what this cell offers. */
print('📐 offers: Point, dist, slowDouble')`,
  ],
  [
    'G11',
    String.raw`span(6, 4)
color('#e4f2e1')

/** import type brings in a type only; it needs no running cell. */
import { dist, slowDouble, type Point } from './A11'

/** Two places to measure between. */
const home: Point = { x: 0, y: 0 }
const shop: Point = { x: 3, y: 4 }

/** Shows the distance and the slow double. */
print('home to shop: ' + dist(home, shop))
print('slow double: ' + (await slowDouble(21)))`,
  ],
  [
    'A15',
    String.raw`// One cell can use another cell that uses a third one: a chain. Here the result of A4 is used twice.
span(6, 3)
color('#dbe8f7')

/** Brings in two functions from A4. */
import { add, square } from './A4'

/** Offers the sum of two squares, built on A4. */
export function sumOfSquares(a: number, b: number): number {
  return add(square(a), square(b))
}

/** Tells what this cell offers. */
print('📦 offers: sumOfSquares')`,
  ],
  [
    'G15',
    String.raw`span(6, 3)
color('#e4f2e1')

/** Brings in sumOfSquares() from A15. */
import { sumOfSquares } from './A15'

/** Shows the answer. */
print('3² + 4² = ' + sumOfSquares(3, 4))
// Change square in A4 to n * n * 2 : this line changes by itself, two cells further.`,
  ],
  [
    'A19',
    String.raw`// TAKING TURNS. Cells that share something must agree who goes first.

/** Sets the size and the colour of this cell. */
span(12, 5)
color('#f6efd8')

/** Explains in words why cells must take turns and the ways out. */
print('🚦 Cells that wait for each other')
print('• Your TypeScript runs ONE piece of code at a time. Code with no await in it can never be cut in two: "if (n > 0) n--" is read and write in one go. That is a free semaphore.')
print('• Trouble starts only when a cell awaits (sleep, ask, fetch...) in the MIDDLE of read → change → write: other cells run in the gap and an old number gets written back.')
print('• Four ways out:')
print('   1. do not await in the middle (the cheapest);')
print('   2. let ONE cell own the data and let the others call its functions, like A8 and G8 above;')
print('   3. a SEMAPHORE (Dijkstra, still the base of everything newer): a number of permits. P = acquire waits while there are none, V = release gives one back. 1 permit is a Mutex, 4 permits let four in. They are in every cell, nothing to import;')
print('   4. take shared things always in the same order: no circle of waiting, no deadlock;')
print('   5. pass MESSAGES, do not share things: a Channel with a size (back-pressure). The modern way, and the one to try first.')
print('A24 lists what is ready made · G24 lost updates, cured with "using" · A30 a belt (classic semaphores) · A36 the same job with a Channel · G36 readers and a writer · G30 the dining philosophers: a deadlock, and two ways out · A43 + G43 a living Roman bakery and dinner that talk through a shared Channel.')`,
  ],
  [
    'A24',
    String.raw`// TAKING TURNS, READY MADE. These are in every cell, nothing to import:

/** Sets the size and the colour of this cell. */
span(6, 6)
color('#dbe8f7')

/** Lists the ready-made tools for taking turns. */
print('🚦 Semaphore(n)   n permits (Dijkstra: P = acquire, V = release)')
print('🔒 Mutex()        one permit: one at a time')
print('📖 RWLock()       many readers or one writer')
print('📬 Channel(size)  messages between cells, with back-pressure')
print('🏷 lock(name)     one lock by name for ALL cells')
print('')

/** Tells how a permit is a lease, and how a wait can give up. */
print('A permit is a lease. It goes back at the end of the block, also after an error, and by itself when the cell that holds it is edited or run again:')
print('   using turn = await lock("printer")')
print('   ...only one cell at a time is here...')
print('')
print('Every wait can give up: await sem.acquire(1, { timeout: "2s" }), or { signal }. The line is first come, first served.')
print('Members are real: sem.value, sem.waiting, mutex.locked, channel.size, rw.readers.')`,
  ],
  [
    'G24',
    String.raw`// LOST UPDATES. Four workers add 1 to the same counter, 8 times each. The right answer is 32.
// Each add is: read the number, wait a little (a real cell would await an answer), write number + 1.
// The Mutex is built in. "using" gives the permit back at the closing brace, whatever happens.

/** Sets the size and the colour of this cell. */
span(6, 6)
color('#e4f2e1')

/** How many workers, how many steps each, and the right final answer. */
const WORKERS = 4
const STEPS = 8
const TOTAL = WORKERS * STEPS

/** One experiment: its name, the shared counter, the lock (or none) and how many workers are finished. */
interface Run {
  label: string
  count: number
  lock: Mutex | null
  done: number
}

/** Starts the workers on one counter, with a lock or without, and returns the run to watch. */
function start(label: string, lock: Mutex | null): Run {
  const run: Run = { label, count: 0, lock, done: 0 }
  for (let w = 0; w < WORKERS; w++) {
    /** One worker: adds 1 to the shared counter STEPS times, with a pause between the adds. */
    void (async () => {
      for (let i = 0; i < STEPS; i++) {
        {
          using _turn = lock ? await lock.acquire() : null // P: one at a time until the closing brace, which gives the permit back (V)
          const seen = run.count // read ...
          await sleep(20 + Math.random() * 60) // ... others run in this gap ...
          run.count = seen + 1 // ... and we write back what we SAW: maybe an old number
        }
        await sleep(Math.random() * 40)
      }
      run.done++
    })().catch(() => {})
  }
  return run
}

/** The two runs on screen, and a flag so the restart is planned only once. */
let runs: Run[] = []
let restarting = false

/** Starts both experiments again: first without a lock, then with a Mutex. */
function again(): void {
  restarting = false
  runs = [start('no lock', null), start('with a Mutex', new Mutex())]
}

/** First start. */
again()

/** Ten times a second: draw both counters, and start over 3 seconds after both are finished. */
every('100ms', () => {
  /** Builds the text: for each run its counter, a bar and a verdict. */
  const lines = ['🏁 ' + WORKERS + ' workers x ' + STEPS + ' steps: the right answer is ' + TOTAL, '']
  for (const r of runs) {
    const finished = r.done === WORKERS
    lines.push(r.label.padEnd(14) + ' counter = ' + r.count)
    lines.push('█'.repeat(r.count) + '·'.repeat(TOTAL - r.count))
    if (!finished) lines.push('   working' + (r.lock ? ', in line: ' + r.lock.waiting : ''))
    else lines.push(r.count === TOTAL ? '   ✅ right' : '   ❌ ' + (TOTAL - r.count) + ' updates lost')
    lines.push('')
  }

  /** Shows the text, and when both runs are finished starts again after 3 seconds. */
  print.top(lines.join('\n'))
  if (!restarting && runs.every((r) => r.done === WORKERS)) {
    restarting = true
    after('3s', again)
  }
})`,
  ],
  [
    'A30',
    String.raw`// A BELT WITH 4 PLACES. A producer puts boxes on it, a consumer takes them off. Two counting semaphores keep them in step:
// free = empty places (the producer waits when it is 0), full = boxes on the belt (the consumer waits when it is 0).
span(6, 6)
color('#dbe8f7')

/** The belt has PLACES places; free counts the empty ones, full the boxes, hands lets one touch the belt at a time. */
const PLACES = 4
const free = new Semaphore(PLACES, 'free')
const full = new Semaphore(0, 'full')
const hands = new Mutex('hands') // one at a time touches the belt itself
const belt: number[] = []

/** Counters and the words each side shows about what it is doing. */
let made = 0
let eaten = 0
let producer = 'starting'
let consumer = 'starting'

/** Every 6 seconds the speeds swap: the belt fills up, then it runs empty. */
const gap = (who: 'producer' | 'consumer'): number => (Math.floor(Date.now() / 6000) % 2 === (who === 'producer' ? 0 : 1) ? 120 : 600)

/** The producer: waits for a free place, puts a box on the belt, and tells the consumer a box is there. */
void (async () => {
  while (true) {
    producer = 'waits: free = ' + free.value
    await free.acquire()
    await hands.acquire()
    belt.push(++made)
    hands.release()
    full.release()
    producer = 'puts box ' + made
    await sleep(gap('producer'))
  }
})().catch(() => {})

/** The consumer: waits for a box, takes it off the belt, and tells the producer a place is free. */
void (async () => {
  while (true) {
    consumer = 'waits: full = ' + full.value
    await full.acquire()
    await hands.acquire()
    const box = belt.shift()
    hands.release()
    free.release()
    eaten++
    consumer = 'takes box ' + box
    await sleep(gap('consumer'))
  }
})().catch(() => {})

/** Ten times a second: draw the producer, the belt, the consumer and the counters. */
every('100ms', () => {
  const places = Array.from({ length: PLACES }, (_, i) => (i < belt.length ? '📦' : '▫️')).join(' ')
  print.top(
    [
      '🏭 producer: ' + producer,
      '',
      '   ' + places,
      '',
      '🍽 consumer: ' + consumer,
      '',
      'free = ' + free.value + '   full = ' + full.value + '   (free + full = ' + (free.value + full.value) + ')',
      'made ' + made + ' · taken ' + eaten + ' · on the belt ' + belt.length,
    ].join('\n'),
  )
})`,
  ],
  [
    'A36',
    String.raw`// THE BELT AGAIN, NEW WAY. No counting of free and full places by hand: a Channel with 4 places does it.
// send waits when the belt is full (the producer is slowed down: back-pressure), receive waits when it is empty. Two workers share the belt.
span(6, 6)
color('#dbe8f7')

/** The belt is a Channel with PLACES places; the counters and words show what each side is doing. */
const PLACES = 4
const belt = new Channel<number>(PLACES, 'belt')
let made = 0
let taken = 0
let producer = 'starting'
const workers = ['starting', 'starting']

/** Every 6 seconds the speeds swap: the belt fills up, then it runs empty. */
const gap = (who: 'producer' | 'workers'): number => (Math.floor(Date.now() / 6000) % 2 === (who === 'producer' ? 0 : 1) ? 120 : 500)

/** The producer: sends a box onto the belt, and waits there while the belt is full. */
void (async () => {
  while (true) {
    producer = belt.size === PLACES ? 'belt is full, waits' : 'puts box ' + (made + 1)
    await belt.send(made + 1) // waits here while the belt is full
    made++
    await sleep(gap('producer'))
  }
})().catch(() => {})

workers.forEach((_, w) => {
  /** One worker: takes boxes off the belt one by one, works on each, and counts it. */
  void (async () => {
    workers[w] = 'waits for a box'
    for await (const box of belt) {
      workers[w] = 'works on box ' + box
      await sleep(gap('workers') * 2)
      taken++
      workers[w] = 'waits for a box'
    }
  })().catch(() => {})
})

/** Ten times a second: draw the producer, the belt, the two workers and the counters. */
every('100ms', () => {
  const places = Array.from({ length: PLACES }, (_, i) => (i < belt.size ? '📦' : '▫️')).join(' ')
  print.top(
    [
      '🏭 producer: ' + producer,
      '',
      '   ' + places + '   ' + belt.size + ' of ' + PLACES,
      '',
      '👷 worker 1: ' + workers[0],
      '👷 worker 2: ' + workers[1],
      '',
      'made ' + made + ' · taken ' + taken + ' · in line: ' + belt.waiting,
      'No lock, no counters: the Channel keeps the order.',
    ].join('\n'),
  )
})`,
  ],
  [
    'G36',
    String.raw`// READERS AND A WRITER. The writer moves 5 from one slot to the next in two steps, with a pause between. The total must always be 30.
// A reader who looks in that pause sees a torn board. An RWLock lets many readers in together, but the writer only alone.
span(6, 6)
color('#e4f2e1')

/** The shared board: its slots, the lock (or none), and how many reads, torn reads and writes happened. */
interface Board {
  label: string
  slots: number[]
  lock: RWLock | null
  reads: number
  torn: number
  writes: number
}

/** Starts one writer and three readers on a new board, with a lock or without, and returns the board to watch. */
function start(label: string, lock: RWLock | null): Board {
  const b: Board = { label, slots: [10, 10, 10], lock, reads: 0, torn: 0, writes: 0 }

  /** The writer: now and then moves 5 from one slot to the next, in two steps with a pause between. */
  void (async () => {
    while (true) {
      await sleep(150 + Math.random() * 150)
      using _write = lock ? await lock.write() : null // alone until the end of this block
      const full = [0, 1, 2].filter((i) => b.slots[i] >= 5)
      const from = full[Math.floor(Math.random() * full.length)] ?? 0
      b.slots[from] -= 5
      await sleep(80) // the board is torn right now: 5 are nowhere
      b.slots[(from + 1) % 3] += 5
      b.writes++
    }
  })().catch(() => {})
  for (let r = 0; r < 3; r++) {
    /** A reader: looks at the board again and again, and counts a read as torn when the total is not 30. */
    void (async () => {
      while (true) {
        await sleep(60 + Math.random() * 120)
        using _read = lock ? await lock.read() : null // readers can be here together
        b.reads++
        if (b.slots.reduce((sum, n) => sum + n, 0) !== 30) b.torn++
        await sleep(40)
      }
    })().catch(() => {})
  }
  return b
}

const boards = [start('no lock', null), start('with an RWLock', new RWLock('board'))]

/** Ten times a second: draw each board, with its total and the number of torn reads. */
every('100ms', () => {
  const lines = ['📋 total must be 30', '']
  for (const b of boards) {
    lines.push(b.label.padEnd(15) + b.slots.map((n) => String(n).padStart(3)).join(' ') + '   = ' + b.slots.reduce((sum, n) => sum + n, 0))
    lines.push('   writes ' + b.writes + ' · reads ' + b.reads + ' · ' + (b.torn ? '❌ torn reads: ' + b.torn : '✅ torn reads: 0'))
    if (b.lock) lines.push('   inside now: ' + b.lock.readers + ' reading' + (b.lock.writing ? ', 1 writing' : '') + ' · in line: ' + b.lock.waiting)
    lines.push('')
  }
  print.top(lines.join('\n'))
})`,
  ],
  [
    'G30',
    String.raw`// THE DINING PHILOSOPHERS. Five sit at a round table with five forks, one between each two. To eat you need BOTH of your forks.
// Round 1: everyone takes the left fork first, so they can all end up holding one and waiting for ever: a DEADLOCK.
// Round 2: the forks are numbered and everyone takes the lower number first: the circle of waiting is gone.
// Round 3: a butler (a Semaphore with 4 permits) lets only 4 sit at once, so one can always finish.

/** Sets the size and the colour of this cell. */
span(6, 6)
color('#f6e7d8')

/** The number of philosophers (and forks). */
const N = 5

/** A way of dining: its name, which two forks philosopher i takes (in this order), and whether a butler is there. */
interface Mode {
  name: string
  order: (i: number) => [number, number]
  butler: boolean
}

/** The three rounds, one after the other. */
const MODES: Mode[] = [
  { name: 'everyone takes the LEFT fork first', order: (i) => [i, (i + 1) % N], butler: false },
  { name: 'the LOWER fork number first', order: (i) => [Math.min(i, (i + 1) % N), Math.max(i, (i + 1) % N)], butler: false },
  { name: 'a butler lets only 4 sit down', order: (i) => [i, (i + 1) % N], butler: true },
]

/** What one philosopher is doing now, and how many meals he has had. */
interface Phil {
  state: 'thinks' | 'hungry' | 'has one fork' | 'eats'
  meals: number
}

/** The state of the round that is running: its number, the forks, the philosophers, the verdict and the times. */
let which = 0
let round = 0
let forks: Semaphore[] = []
let phils: Phil[] = []
let verdict = ''
let startedAt = 0
let endedAt = 0

/** One philosopher's life in one round: think, get hungry, take two forks in the order of the mode, eat, put them back. */
async function dine(me: Phil, i: number, mine: number, m: Mode, table: Semaphore[], butler: Semaphore | null): Promise<void> {
  /** The two forks this philosopher needs, in the order the mode says. */
  const [first, second] = m.order(i)

  /** Lives until the round is over (a new round changes the number). */
  while (mine === round) {
    me.state = 'thinks'
    await sleep(20 + Math.random() * 100)
    me.state = 'hungry'
    await butler?.acquire()
    await table[first].acquire()
    me.state = 'has one fork'
    await sleep(150) // reaching for the second fork takes a moment: all of them get stuck right here
    await table[second].acquire()
    me.state = 'eats'
    me.meals++
    await sleep(300)
    table[second].release()
    table[first].release()
    butler?.release()
  }
}

/** Starts a new round with the given mode: new forks, a butler if the mode has one, and N philosophers sitting down. */
function begin(next: number): void {
  which = next
  round++
  verdict = ''
  startedAt = Date.now()
  forks = Array.from({ length: N }, (_, i) => new Semaphore(1, 'fork ' + i))
  const butler = MODES[which].butler ? new Semaphore(N - 1, 'butler') : null
  phils = Array.from({ length: N }, () => ({ state: 'thinks', meals: 0 }))
  phils.forEach((p, i) => void dine(p, i, round, MODES[which], forks, butler).catch(() => {}))
}

/** First round. */
begin(0)

/** What to show for each state of a philosopher. */
const ICON = { thinks: '🤔', hungry: '😋 wants to eat', 'has one fork': '🍴 holds one fork, waits for the other', eats: '🍝 eats' }

/** Ten times a second: find out if the round is over, start the next one after a pause, and draw the table. */
every('100ms', () => {
  const now = Date.now()
  const meals = phils.reduce((sum, p) => sum + p.meals, 0)

  /** The verdict: a deadlock when all five hold one fork, or success after 7 seconds. */
  if (!verdict && phils.every((p) => p.state === 'has one fork')) {
    verdict = '💀 DEADLOCK: all five hold one fork and wait for the next. Nobody can ever move on.'
    endedAt = now
  } else if (!verdict && now - startedAt > 7000) {
    verdict = '✅ Nobody got stuck: ' + meals + ' meals in 7 seconds.'
    endedAt = now
  }

  /** Three seconds after the verdict, the next round begins. */
  if (verdict && now - endedAt > 3000) begin((which + 1) % MODES.length)

  /** Draws the round, each philosopher, the forks and the verdict. */
  const lines = ['🍝 Round ' + (which + 1) + ': ' + MODES[which].name, '']
  phils.forEach((p, i) => lines.push('  ' + (i + 1) + '  ' + ICON[p.state] + '   (meals: ' + p.meals + ')'))
  lines.push('', 'forks: ' + forks.map((f) => (f.value > 0 ? '🍴' : '▫️')).join(' '))
  if (verdict) lines.push('', verdict)
  print.top(lines.join('\n'))
})`,
  ],
  [
    'A43',
    String.raw`// ROME, a bakery (pistrinum) with a donkey mill. Grain goes in on the left, loaves come out of the oven, and every loaf is put on the shelf.
// The pipeline is four workers, each one a loop that takes from a Channel, works, and sends on. A full Channel makes the sender wait: back-pressure.
// THIS CELL OFFERS two things to the cell next door (G43, the philosophers): the shelf, and makeMover(), the little engine that walks the figures.

/** Sets the size and the colour of this cell. */
span(6, 8)
color('#f3e3c3')

/** The drawing: its size, and the sky, the floor and the red border of the bakery. */
const W = 360
const H = 480
const pic = svg({ width: W, height: H })
pic.add('rect', { x: 0, y: 0, width: W, height: H, fill: '#f3e3c3' })
pic.add('rect', { x: 0, y: 66, width: W, height: 120, fill: '#e6cf9f' })
pic.add('rect', { x: 0, y: 0, width: W, height: 8, fill: '#a4302a' })

/** A figure that walks: its picture, where it is, where it goes, how fast, how much it bobs, and who waits for it to arrive. */
export interface Sprite {
  el: SvgEl
  x: number
  y: number
  tx: number
  ty: number
  speed: number
  bob: number
  arrived: Array<() => void>
}

/** Figures that walk. Give it a drawing; sprite() puts a letter or an emoji in it, goTo() walks it somewhere and says when it is there. */
export function makeMover(scene: SvgScene) {
  /** Every figure made so far. */
  const all = new Set<Sprite>()

  /** On every frame each figure takes a step towards its goal, bobs a little, and tells those who wait when it arrives. */
  scene.frame((t, dt) => {
    for (const s of all) {
      const dx = s.tx - s.x
      const dy = s.ty - s.y
      const d = Math.hypot(dx, dy)
      if (d > 0.5) {
        const step = Math.min(d, s.speed * dt)
        s.x += (dx / d) * step
        s.y += (dy / d) * step
      } else {
        s.x = s.tx
        s.y = s.ty
        if (s.arrived.length) s.arrived.splice(0).forEach((done) => done())
      }
      s.el.attr({ x: s.x, y: s.y + Math.sin(t * 9 + s.x) * s.bob })
    }
  })

  /** The three things a caller can do with the figures. */
  return {
    /** Puts a new figure (a letter or an emoji) in the drawing. */
    sprite(glyph: string, x: number, y: number, size = 26): Sprite {
      const el = scene.write(x, y, glyph, { 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
      const s: Sprite = { el, x, y, tx: x, ty: y, speed: 80, bob: 0, arrived: [] }
      all.add(s)
      return s
    },

    /** Walks a figure to a place, and returns a promise that is done when it is there. */
    goTo(s: Sprite, x: number, y: number, speed = 80): Promise<void> {
      s.tx = x
      s.ty = y
      s.speed = speed
      return new Promise((done) => s.arrived.push(done))
    },

    /** Takes a figure out of the drawing for good. */
    drop(s: Sprite): void {
      all.delete(s)
      s.el.remove()
    },
  }
}

/** The shelf is a Channel with 6 places. The baker sends a loaf; a philosopher in G43 receives it. Nothing else is shared. */
export const shelf = new Channel<number>(6, 'shelf')

/** The walking engine for this drawing, and a helper that writes a centred label. */
const mv = makeMover(pic)
const label = (x: number, y: number, words: string, size = 10, fill = '#6b3e12') =>
  pic.write(x, y, words, { 'font-size': size, 'text-anchor': 'middle', fill, 'font-family': 'Georgia, serif' })

/** The title of the picture. */
label(W / 2, 32, '🏛 PISTRINUM', 20, '#7b1e1a')
label(W / 2, 52, 'a Roman bakery · Pompeii, 79 AD', 11)

/** The four stages of the bakery, from left to right, on the line Y. */
const Y = 130
const STAGES = [
  { name: 'HORREUM', note: 'grain store', x: 45 },
  { name: 'MOLA', note: 'donkey mill', x: 135 },
  { name: 'ALVEUS', note: 'kneading', x: 225 },
  { name: 'FURNUS', note: 'oven', x: 315 },
]

/** Draws a box and two names for each stage. */
for (const s of STAGES) {
  pic.add('rect', { x: s.x - 34, y: Y - 38, width: 68, height: 76, rx: 8, fill: '#fff6df', stroke: '#b98b4a', 'stroke-width': 2 })
  label(s.x, Y + 52, s.name, 11, '#7b1e1a')
  label(s.x, Y + 65, s.note, 9)
}

/** The millstone, the sack of grain, the fire, the donkey and the baker. */
pic.add('circle', { cx: 135, cy: Y, r: 11, fill: '#9a9a9a', stroke: '#555' })
mv.sprite('🌾', 45, Y - 22, 20)
mv.sprite('🔥', 315, Y - 24, 22).bob = 2
const donkey = mv.sprite('🐴', 157, Y, 24)
const baker = mv.sprite('🧑‍🍳', 225, Y - 20, 26)

/** A short name for sleep(). */
const wait = (ms: number) => sleep(ms)

/** How many loaves were baked, and what the bakery is doing now. */
let baked = 0
let state = 'starting'

/** Each stage: an inbox (a Channel of one), a station, what it does to the item, and the shape the item has afterwards. */
const inbox = [new Channel<Sprite>(1, 'mill'), new Channel<Sprite>(1, 'trough'), new Channel<Sprite>(1, 'oven')]

/** The x of the door of stage i, where an item waits to go in. */
const door = (i: number) => STAGES[i].x - 34

/** The granary: a new bag of grain every 2.4 seconds. */
void (async () => {
  while (true) {
    const grain = mv.sprite('🌾', STAGES[0].x, Y + 6, 22)
    await mv.goTo(grain, door(1), Y + 28, 70)
    await inbox[0].send(grain)
    await wait(2400)
  }
})().catch(() => {})

/** The miller: the donkey walks round the millstone, the grain becomes flour. */
void (async () => {
  while (true) {
    const item = await inbox[0].receive()
    await mv.goTo(item, STAGES[1].x, Y + 8, 90)
    state = 'the donkey turns the mill'
    for (const [dx, dy] of [[22, 0], [0, 20], [-22, 0], [0, -20], [22, 0], [0, 20], [-22, 0], [0, -20], [22, 0]]) await mv.goTo(donkey, STAGES[1].x + dx, Y + dy, 55)
    item.el.text('🥣')
    await mv.goTo(item, door(2), Y + 28, 70)
    await inbox[1].send(item)
  }
})().catch(() => {})

/** The kneader: pushes the dough three times, flour becomes dough. */
void (async () => {
  while (true) {
    const item = await inbox[1].receive()
    await mv.goTo(item, STAGES[2].x, Y + 18, 90)
    state = 'the baker kneads'
    for (let i = 0; i < 3; i++) {
      await mv.goTo(baker, STAGES[2].x, Y + 6, 60)
      await mv.goTo(baker, STAGES[2].x, Y - 20, 60)
    }
    item.el.text('🫓')
    await mv.goTo(item, door(3), Y + 28, 70)
    await inbox[2].send(item)
  }
})().catch(() => {})

/** The oven: dough in, loaf out, and the loaf goes on the shelf. send() waits while the shelf is full. */
void (async () => {
  while (true) {
    const item = await inbox[2].receive()
    await mv.goTo(item, STAGES[3].x, Y + 18, 90)
    state = 'the oven bakes'
    await wait(1800)
    item.el.text('🍞')

    /** The loaf waits at its place BEFORE it is sent: a philosopher takes it in under 40 ms, so the shelf would never be seen filling. */
    await mv.goTo(item, 56 + Math.min(shelf.size, shelf.capacity - 1) * 50, 328, 110)
    if (shelf.size >= shelf.capacity) state = '😓 the shelf is full: the baker waits'
    await wait(500)
    await shelf.send(++baked)
    await wait(160)
    mv.drop(item)
  }
})().catch(() => {})

/** The shelf, as a row of places. It only LOOKS at shelf.size, the very number the philosophers in G43 take from. */
label(W / 2, 292, 'PLUTEUS · the shelf (a Channel of ' + shelf.capacity + ')', 11, '#7b1e1a')
pic.add('rect', { x: 28, y: 300, width: 304, height: 56, rx: 6, fill: '#c9a46a', stroke: '#8a5a2b', 'stroke-width': 3 })

/** One bread picture for each place on the shelf; they fade in and out with shelf.size. */
const places = Array.from({ length: shelf.capacity }, (_, i) => {
  const x = 56 + i * 50
  pic.add('rect', { x: x - 20, y: 308, width: 40, height: 40, rx: 5, fill: '#e8d3a5' })
  return pic.write(x, 328, '🍞', { 'font-size': 28, 'text-anchor': 'middle', 'dominant-baseline': 'central' })
})

/** Three lines of text under the shelf: a note, then the counters, then what the bakery is doing. */
label(W / 2, 384, '⬇ shelf.receive() in G43 · hungry philosophers take a loaf', 10)
const info = label(W / 2, 418, '', 12, '#3a2a12')
const info2 = label(W / 2, 438, '', 11, '#6b3e12')
const info3 = label(W / 2, 458, 'makeMover() walks the figures here AND in G43', 10, '#8a6a3a')

/** A shy rat 🐀 hunts for crumbs in the corners and bolts from anything big that MOVES: the donkey and the baker. Nobody asked it to be here. */
const nooks: Array<[number, number]> = [[16, 76], [344, 76], [16, 372], [344, 372], [16, 462], [344, 462], [180, 466]]
const rat = mv.sprite('🐀', 16, 462, 18)
rat.bob = 1
const fright = pic.write(0, 0, '❗', { 'font-size': 11, 'text-anchor': 'middle', opacity: 0 })

/** What the rat watches: the big figures, where they were last time, and the times when it stops sniffing or stops being scared. */
const bigOnes = [donkey, baker]
const before = bigOnes.map((b) => [b.x, b.y])
let sniffUntil = 0
let scaredUntil = 0

/** Many times a second: the rat runs from any big figure that moves close to it, else it sniffs a while and walks to another nook. */
every('120ms', () => {
  const now = Date.now()
  const dangers: Sprite[] = []

  /** Finds the big figures that are moving and are near the rat. */
  for (let i = 0; i < bigOnes.length; i++) {
    const b = bigOnes[i]
    const moving = Math.hypot(b.x - before[i][0], b.y - before[i][1]) > 1.2
    before[i] = [b.x, b.y]
    if (moving && Math.hypot(b.x - rat.x, b.y - rat.y) < 75) dangers.push(b)
  }

  /** Scared: bolt away. Calm: after a pause at a nook, stroll slowly to a nook chosen by chance. */
  if (dangers.length) {
    const d = dangers[0]

    /** Run to the nook that is farthest from the thing it fears. */
    const far = nooks.reduce((best, n) => (Math.hypot(n[0] - d.x, n[1] - d.y) > Math.hypot(best[0] - d.x, best[1] - d.y) ? n : best))
    rat.tx = far[0]
    rat.ty = far[1]
    rat.speed = 170
    scaredUntil = now + 1500
  } else if (now > scaredUntil && Math.hypot(rat.tx - rat.x, rat.ty - rat.y) < 2) {
    if (!sniffUntil) sniffUntil = now + 1200 + Math.random() * 2000
    if (now > sniffUntil) {
      sniffUntil = 0
      const next = nooks[Math.floor(Math.random() * nooks.length)]
      rat.tx = next[0]
      rat.ty = next[1]
      rat.speed = 28
    }
  }

  /** The ❗ follows the rat and shows only while it is scared. */
  fright.attr({ x: rat.x + 10, y: rat.y - 16 })
  fright.opacity(now < scaredUntil ? 1 : 0)
})

/** Updates the shelf: the bread fades with shelf.size, and the lines tell what is baked, on the shelf, and who is waiting. */
every('150ms', () => {
  places.forEach((p, i) => p.opacity(i < shelf.size ? 1 : 0.12))
  info.text('baked ' + baked + ' · on the shelf ' + shelf.size + ' of ' + shelf.capacity)
  const hungry = shelf.size === 0 ? shelf.waiting : 0
  info2.text(hungry > 0 ? '👥 ' + hungry + ' hungry customer' + (hungry > 1 ? 's' : '') + ' waiting for bread' : state)
  if (shelf.size < shelf.capacity && state.startsWith('😓')) state = 'the oven bakes'
})`,
  ],
  [
    'G43',
    String.raw`// ROME, a dinner of five philosophers who are always a little hungry. THIS CELL USES TWO THINGS FROM THE BAKERY NEXT DOOR (A43):
// shelf, a Channel the baker puts loaves on (receive() waits until there is one), and makeMover(), the engine that walks the figures.
// To eat, a philosopher needs the loaf AND two spoons (Rome had spoons, ligulae, not forks yet). There are only five spoons, one between each two.
// The spoons are numbered and everybody takes the LOWER number first, so the circle of waiting can never close: no deadlock (see G30).

/** Sets the size and the colour of this cell. */
span(10, 8)
color('#efe0c0')

/** Brings in the shelf and the walking engine from A43. */
import { shelf, makeMover } from './A43'

/** The drawing: its size, the floor, the red border, the walking engine, and a helper that writes a centred text. */
const W = 600
const H = 480
const pic = svg({ width: W, height: H })
pic.add('rect', { x: 0, y: 0, width: W, height: H, fill: '#efe0c0' })
pic.add('rect', { x: 0, y: 0, width: W, height: 8, fill: '#a4302a' })
const mv = makeMover(pic)
const text = (x: number, y: number, words: string, size = 10, fill = '#5a3a14') =>
  pic.write(x, y, words, { 'font-size': size, 'text-anchor': 'middle', fill, 'font-family': 'Georgia, serif' })

/** The title and the subtitle. */
text(W / 2, 32, '🏛 TRICLINIUM · the philosophers dine', 18, '#7b1e1a')
text(W / 2, 50, 'five hungry thinkers, five spoons, bread from the pistrinum in A43', 11)

/** The bread stall on the left: its shelf is the very Channel the baker fills in A43. */
pic.add('rect', { x: 14, y: 150, width: 92, height: 200, rx: 8, fill: '#c9a46a', stroke: '#8a5a2b', 'stroke-width': 3 })
text(60, 170, 'TABERNA', 12, '#7b1e1a')
text(60, 184, 'from A43', 9)

/** One bread picture for each place of the shelf, and a line of text under the stall. */
const stall = Array.from({ length: shelf.capacity }, (_, i) => pic.write(34 + (i % 2) * 52 - 8 + 8, 215 + Math.floor(i / 2) * 44, '🍞', { 'font-size': 26, 'text-anchor': 'middle', 'dominant-baseline': 'central' }))
const stallInfo = text(60, 338, '', 10)

/** The table, five seats around it, and five spoons lying between them. */
const TX = 440
const TY = 262
pic.add('circle', { cx: TX, cy: TY, r: 64, fill: '#9a6b35', stroke: '#6b4520', 'stroke-width': 4 })
pic.add('circle', { cx: TX, cy: TY, r: 46, fill: 'none', stroke: '#b98b4a', 'stroke-width': 2 })

/** A point on a circle round the table: k = 0..4 are the seats, and k + 0.5 lies between two seats. */
const around = (k: number, r: number): [number, number] => {
  const a = ((-90 + k * 72) * Math.PI) / 180
  return [TX + Math.cos(a) * r, TY + Math.sin(a) * r]
}

/** The five guests: their names, their faces, and three thoughts each that they say now and then. */
const NAMES = ['Seneca', 'Cicero', 'Marcus', 'Epictetus', 'Lucretius']
const FACES = ['🧔', '👴', '🤴', '🧓', '👨‍🦲']
const THOUGHTS = [
  ['We suffer more in imagination than in reality.', 'Is the bread late, or am I early?', 'Time is the one loaf nobody can bake again.'],
  ['With a garden and a library you lack nothing.', 'Who bakes for the baker?', 'A shelf is a promise made of flour.'],
  ['You have power over your mind, not over events.', 'This loaf is the whole empire in small.', 'Wait without grumbling: the oven is also stoic.'],
  ['It is not things that upset us, but our judgments of them.', 'One spoon in hand, one missing: hunger or logic?', 'A queue is a lesson in patience.'],
  ['Nothing comes from nothing, so someone made this bread.', 'Atoms swerve, and so do hungry men in line.', 'Is the crumb smaller than the thought of the crumb?'],
]

/** Where guest i sits, and the five spoons (one Semaphore each) with their pictures and their home places on the table. */
const seat = (i: number): [number, number] => around(i, 112)
const spoons = Array.from({ length: 5 }, (_, i) => new Semaphore(1, 'spoon ' + i))
const spoonSprites = spoons.map((_, i) => {
  const [x, y] = around(i + 0.5, 46)
  return mv.sprite('🥄', x, y, 22)
})
const spoonHome = spoons.map((_, i) => around(i + 0.5, 46))

/** The number of each spoon, written on the table. */
for (let i = 0; i < 5; i++) text(...around(i + 0.5, 28), String(i), 9, '#f3e3c3')

/** One guest: his name, his figure, his name tag, his thought bubble (box and lines), the loaf he carries, his meals and what he does. */
interface Phil {
  name: string
  me: Sprite
  tag: SvgEl
  bubble: SvgEl
  lines: SvgEl[]
  box: SvgEl
  loaf: Sprite | null
  meals: number
  doing: string
}

/** The five guests, sitting at their seats, each with a hidden thought bubble. */
const phils: Phil[] = NAMES.map((name, i) => {
  const [x, y] = seat(i)
  const me = mv.sprite(FACES[i], x, y, 32)
  const tag = text(x, y + 26, name, 10)
  const bubble = pic.add('g')
  const box = bubble.add('rect', { x: -78, y: -4, width: 156, height: 34, rx: 10, fill: '#fffdf5', stroke: '#8a6a3a', 'stroke-width': 1.5 })
  const lines = [0, 1, 2].map((k) => bubble.add('text', { x: 0, y: 8 + k * 11, 'font-size': 9, 'text-anchor': 'middle', fill: '#3a2a12', 'font-family': 'Georgia, serif' }))
  bubble.hide()
  return { name, me, tag, bubble, lines, box, loaf: null, meals: 0, doing: 'thinks' }
})

/** A thought bubble above the philosopher, the words cut into lines. */
function say(p: Phil, words: string): void {
  const parts: string[] = []
  let line = ''
  for (const w of words.split(' ')) {
    if ((line + ' ' + w).trim().length > 27) {
      parts.push(line)
      line = w
    } else line = (line + ' ' + w).trim()
  }
  parts.push(line)
  p.lines.forEach((l, k) => l.text(parts[k] ?? ''))
  p.box.attr('height', 10 + Math.min(3, parts.length) * 11)
  p.bubble.show()
}

/** Hides the thought bubble of a philosopher. */
const hush = (p: Phil): void => void p.bubble.hide()

/** Bubbles and names follow the figures. A name also says how many meals the philosopher has had. */
pic.frame(() => {
  for (const p of phils) {
    const lift = p.loaf ? 62 : 54
    p.bubble.move(p.me.x, p.me.y - lift - 26)
    p.tag.attr({ x: p.me.x, y: p.me.y + 26 })
    p.tag.text(p.name + ' · ' + p.meals)
    if (p.loaf) {
      p.loaf.tx = p.me.x + 16
      p.loaf.ty = p.me.y - 10
      p.loaf.x = p.loaf.tx
      p.loaf.y = p.loaf.ty
    }
  }
})

let held = 0 // loaves lying on the stall for their half second

/** Picks one thing from a list by chance. */
const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]

/** The life of guest i, for ever: think while walking, fetch a loaf, take two spoons, eat, give everything back. */
async function life(i: number): Promise<void> {
  /** This guest, the two spoons he needs, and a start delay so they do not all begin together. */
  const p = phils[i]
  const mine = [i, (i + 1) % 5].sort((a, b) => a - b) // the lower spoon number first
  await sleep(i * 900)
  while (true) {
    /** Thinking, out walking: the Peripatetic way. */
    p.doing = 'thinks'
    for (let k = 0; k < 2; k++) {
      say(p, pick(THOUGHTS[i]))
      await mv.goTo(p.me, 150 + Math.random() * 130, 90 + Math.random() * 340, 45)
      await sleep(900)
    }

    /** Hungry: walk to the stall and wait in line. shelf.receive() is the call into A43. */
    p.doing = 'hungry'
    say(p, 'To the stall! 🍞?')
    await mv.goTo(p.me, 128, 200 + i * 28, 85)
    say(p, shelf.size === 0 ? 'Empty shelf. I wait for the baker...' : 'Bread!')
    await shelf.receive()

    /** The loaf stays on the TABERNA for half a second: receive() can be so quick that the stall would never show it leaving. */
    const slot = Math.min(shelf.size, shelf.capacity - 1)
    const bread = mv.sprite('🍞', 34 + (slot % 2) * 52, 215 + Math.floor(slot / 2) * 44, 26)
    held++
    await sleep(500)
    held--

    /** The loaf flies to the hand, and the guest walks back to his seat. */
    await mv.goTo(bread, p.me.x + 16, p.me.y - 10, 220)
    p.loaf = bread
    say(p, 'A loaf! Now the spoons.')
    const [sx, sy] = seat(i)
    await mv.goTo(p.me, sx, sy, 85)

    /** Two spoons, lower number first. Each one flies to the hand that takes it. */
    const first = await spoons[mine[0]].acquire()
    await mv.goTo(spoonSprites[mine[0]], sx + (mine[0] === i ? -14 : 14), sy + 16, 170)
    say(p, 'One spoon (' + mine[0] + '). I wait for ' + mine[1] + '.')
    const second = await spoons[mine[1]].acquire()
    await mv.goTo(spoonSprites[mine[1]], sx + (mine[1] === i ? -14 : 14), sy + 16, 170)

    /** Eating. */
    p.doing = 'eats'
    say(p, '😋 Nom nom nom')
    for (let bite = 0; bite < 3; bite++) {
      await mv.goTo(p.me, sx, sy - 4, 40)
      await mv.goTo(p.me, sx, sy, 40)
      await sleep(500)
    }

    /** Done: count the meal, eat the loaf, bring the spoons home and give them back. */
    p.meals++
    if (p.loaf) mv.drop(p.loaf)
    p.loaf = null
    for (const k of mine) await mv.goTo(spoonSprites[k], spoonHome[k][0], spoonHome[k][1], 170)
    second.release()
    first.release()

    /** A last thought, a rest, and start again. */
    say(p, pick(THOUGHTS[i]))
    await sleep(1500)
    hush(p)
  }
}

/** Starts the life of all five guests. */
phils.forEach((_, i) => void life(i).catch(() => {}))

/** The line of text at the bottom. */
const footer = text(W / 2, 456, '', 11, '#3a2a12')

/** Updates the stall (bread, who waits) and the bottom line (hungry, eating, meals) a few times a second. */
every('150ms', () => {
  stall.forEach((s, i) => s.opacity(i < shelf.size + held ? 1 : 0.12))
  const waiting = shelf.size === 0 ? shelf.waiting : 0
  stallInfo.text(shelf.size + ' on the shelf' + (waiting ? ' · ' + waiting + ' waiting' : ''))
  const eating = phils.filter((p) => p.doing === 'eats').length
  const hungry = phils.filter((p) => p.doing === 'hungry').length
  footer.text('🍞 shelf ' + shelf.size + ' · hungry ' + hungry + ' · eating ' + eating + ' · meals ' + phils.reduce((n, p) => n + p.meals, 0))
})`,
  ],
];
