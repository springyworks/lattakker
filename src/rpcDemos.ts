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
span(12, 3)
color('#ece3f6')
print('🔗 Cells that talk')
print('export in one cell, import in another')
print('A4 → G4 · A8 → G8 · A11 → G11 · A15 → G15')`,
  ],
  [
    'A4',
    String.raw`// This cell OFFERS things. The word export means: other cells may use this.
span(6, 4)
color('#dbe8f7')

// A function other cells can call. The types (: number) are checked where it is called.
export function add(a: number, b: number): number {
  return a + b
}

// A second function.
export function square(n: number): number {
  return n * n
}

// A value to share.
export const TAU = Math.PI * 2

print('📦 offers: add, square, TAU')`,
  ],
  [
    'G4',
    String.raw`// This cell USES what A4 offers. The names come from A4 and the editor knows what they are.
span(6, 4)
color('#e4f2e1')

import { add, square, TAU } from './A4'

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

let count = 0

export function bump(by = 1): number {
  count += by
  // show() writes in THIS cell, even when another cell called bump().
  show('count = ' + count)
  return count
}

export function reset(): void {
  count = 0
  show('count = 0')
}

show('count = 0')`,
  ],
  [
    'G8',
    String.raw`// Every 2 seconds this cell calls bump() in A8, and the answer comes back at once.
span(6, 3)
color('#e4f2e1')

import { bump } from './A8'

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

export interface Point {
  x: number
  y: number
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// An async function works too: the caller just writes await.
export async function slowDouble(n: number): Promise<number> {
  await sleep(300)
  return n * 2
}

print('📐 offers: Point, dist, slowDouble')`,
  ],
  [
    'G11',
    String.raw`span(6, 4)
color('#e4f2e1')

// import type brings in a type only; it needs no running cell.
import { dist, slowDouble, type Point } from './A11'

const home: Point = { x: 0, y: 0 }
const shop: Point = { x: 3, y: 4 }

print('home to shop: ' + dist(home, shop))
print('slow double: ' + (await slowDouble(21)))`,
  ],
  [
    'A15',
    String.raw`// One cell can use another cell that uses a third one: a chain. Here the result of A4 is used twice.
span(6, 3)
color('#dbe8f7')

import { add, square } from './A4'

export function sumOfSquares(a: number, b: number): number {
  return add(square(a), square(b))
}

print('📦 offers: sumOfSquares')`,
  ],
  [
    'G15',
    String.raw`span(6, 3)
color('#e4f2e1')

import { sumOfSquares } from './A15'

print('3² + 4² = ' + sumOfSquares(3, 4))
// Change square in A4 to n * n * 2 : this line changes by itself, two cells further.`,
  ],
  [
    'A19',
    String.raw`// TAKING TURNS. Cells that share something must agree who goes first.
span(12, 5)
color('#f6efd8')

print('🚦 Cells that wait for each other')
print('• Your TypeScript runs ONE piece of code at a time. Code with no await in it can never be cut in two: "if (n > 0) n--" is read and write in one go. That is a free semaphore.')
print('• Trouble starts only when a cell awaits (sleep, ask, fetch...) in the MIDDLE of read → change → write: other cells run in the gap and an old number gets written back.')
print('• Four ways out:')
print('   1. do not await in the middle (the cheapest);')
print('   2. let ONE cell own the data and let the others call its functions, like A8 and G8 above;')
print('   3. a SEMAPHORE (Dijkstra, still the base of everything newer): a number of permits. P = acquire waits while there are none, V = release gives one back. 1 permit is a Mutex, 4 permits let four in. They are in every cell, nothing to import;')
print('   4. take shared things always in the same order: no circle of waiting, no deadlock;')
print('   5. pass MESSAGES, do not share things: a Channel with a size (back-pressure). The modern way, and the one to try first.')
print('A24 lists what is ready made · G24 lost updates, cured with "using" · A30 a belt (classic semaphores) · A36 the same job with a Channel · G36 readers and a writer · G30 the dining philosophers: a deadlock, and two ways out.')`,
  ],
  [
    'A24',
    String.raw`// TAKING TURNS, READY MADE. These are in every cell, nothing to import:
span(6, 6)
color('#dbe8f7')

print('🚦 Semaphore(n)   n permits (Dijkstra: P = acquire, V = release)')
print('🔒 Mutex()        one permit: one at a time')
print('📖 RWLock()       many readers or one writer')
print('📬 Channel(size)  messages between cells, with back-pressure')
print('🏷 lock(name)     one lock by name for ALL cells')
print('')
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
span(6, 6)
color('#e4f2e1')

const WORKERS = 4
const STEPS = 8
const TOTAL = WORKERS * STEPS

interface Run {
  label: string
  count: number
  lock: Mutex | null
  done: number
}

function start(label: string, lock: Mutex | null): Run {
  const run: Run = { label, count: 0, lock, done: 0 }
  for (let w = 0; w < WORKERS; w++) {
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

let runs: Run[] = []
let restarting = false
function again(): void {
  restarting = false
  runs = [start('no lock', null), start('with a Mutex', new Mutex())]
}
again()

every('100ms', () => {
  const lines = ['🏁 ' + WORKERS + ' workers x ' + STEPS + ' steps: the right answer is ' + TOTAL, '']
  for (const r of runs) {
    const finished = r.done === WORKERS
    lines.push(r.label.padEnd(14) + ' counter = ' + r.count)
    lines.push('█'.repeat(r.count) + '·'.repeat(TOTAL - r.count))
    if (!finished) lines.push('   working' + (r.lock ? ', in line: ' + r.lock.waiting : ''))
    else lines.push(r.count === TOTAL ? '   ✅ right' : '   ❌ ' + (TOTAL - r.count) + ' updates lost')
    lines.push('')
  }
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

const PLACES = 4
const free = new Semaphore(PLACES, 'free')
const full = new Semaphore(0, 'full')
const hands = new Mutex('hands') // one at a time touches the belt itself
const belt: number[] = []
let made = 0
let eaten = 0
let producer = 'starting'
let consumer = 'starting'
// Every 6 seconds the speeds swap: the belt fills up, then it runs empty.
const gap = (who: 'producer' | 'consumer'): number => (Math.floor(Date.now() / 6000) % 2 === (who === 'producer' ? 0 : 1) ? 120 : 600)

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

const PLACES = 4
const belt = new Channel<number>(PLACES, 'belt')
let made = 0
let taken = 0
let producer = 'starting'
const workers = ['starting', 'starting']
// Every 6 seconds the speeds swap: the belt fills up, then it runs empty.
const gap = (who: 'producer' | 'workers'): number => (Math.floor(Date.now() / 6000) % 2 === (who === 'producer' ? 0 : 1) ? 120 : 500)

void (async () => {
  while (true) {
    producer = belt.size === PLACES ? 'belt is full, waits' : 'puts box ' + (made + 1)
    await belt.send(made + 1) // waits here while the belt is full
    made++
    await sleep(gap('producer'))
  }
})().catch(() => {})

workers.forEach((_, w) => {
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

interface Board {
  label: string
  slots: number[]
  lock: RWLock | null
  reads: number
  torn: number
  writes: number
}

function start(label: string, lock: RWLock | null): Board {
  const b: Board = { label, slots: [10, 10, 10], lock, reads: 0, torn: 0, writes: 0 }
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
span(6, 6)
color('#f6e7d8')

const N = 5
interface Mode {
  name: string
  order: (i: number) => [number, number]
  butler: boolean
}
const MODES: Mode[] = [
  { name: 'everyone takes the LEFT fork first', order: (i) => [i, (i + 1) % N], butler: false },
  { name: 'the LOWER fork number first', order: (i) => [Math.min(i, (i + 1) % N), Math.max(i, (i + 1) % N)], butler: false },
  { name: 'a butler lets only 4 sit down', order: (i) => [i, (i + 1) % N], butler: true },
]

interface Phil {
  state: 'thinks' | 'hungry' | 'has one fork' | 'eats'
  meals: number
}
let which = 0
let round = 0
let forks: Semaphore[] = []
let phils: Phil[] = []
let verdict = ''
let startedAt = 0
let endedAt = 0

async function dine(me: Phil, i: number, mine: number, m: Mode, table: Semaphore[], butler: Semaphore | null): Promise<void> {
  const [first, second] = m.order(i)
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
begin(0)

const ICON = { thinks: '🤔', hungry: '😋 wants to eat', 'has one fork': '🍴 holds one fork, waits for the other', eats: '🍝 eats' }

every('100ms', () => {
  const now = Date.now()
  const meals = phils.reduce((sum, p) => sum + p.meals, 0)
  if (!verdict && phils.every((p) => p.state === 'has one fork')) {
    verdict = '💀 DEADLOCK: all five hold one fork and wait for the next. Nobody can ever move on.'
    endedAt = now
  } else if (!verdict && now - startedAt > 7000) {
    verdict = '✅ Nobody got stuck: ' + meals + ' meals in 7 seconds.'
    endedAt = now
  }
  if (verdict && now - endedAt > 3000) begin((which + 1) % MODES.length)
  const lines = ['🍝 Round ' + (which + 1) + ': ' + MODES[which].name, '']
  phils.forEach((p, i) => lines.push('  ' + (i + 1) + '  ' + ICON[p.state] + '   (meals: ' + p.meals + ')'))
  lines.push('', 'forks: ' + forks.map((f) => (f.value > 0 ? '🍴' : '▫️')).join(' '))
  if (verdict) lines.push('', verdict)
  print.top(lines.join('\n'))
})`,
  ],
];
