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
print('   3. a SEMAPHORE (Dijkstra): a number of permits. P = acquire waits while there are none, V = release gives one back. 1 permit is a Mutex, 4 permits let four in;')
print('   4. take shared things always in the same order: no circle of waiting, no deadlock.')
print('A24 offers Semaphore and Mutex · G24 shows lost updates · A30 is a belt with a bounded buffer · G30 is the dining philosophers: a deadlock, and two ways out.')`,
  ],
  [
    'A24',
    String.raw`// A SEMAPHORE is a number that says how many may go in. Import it in any cell: import { Semaphore, Mutex } from './A24'
span(6, 6)
color('#dbe8f7')

export class Semaphore {
  // Who waits, first come first served. A waiter wants n permits.
  private queue: { n: number; go: () => void }[] = []

  constructor(public value = 1, readonly name = 'semaphore') {}

  /** How many are waiting right now. */
  get waiting(): number {
    return this.queue.length
  }

  /** P (Dijkstra's "proberen", to try): take n permits, or wait until they are there. */
  acquire(n = 1): Promise<void> {
    // This check and the subtraction are ONE step: no other cell can run between them.
    if (this.queue.length === 0 && this.value >= n) {
      this.value -= n
      return Promise.resolve()
    }
    return new Promise<void>((go) => this.queue.push({ n, go }))
  }

  /** Take n permits only if they are there right now. Never waits. */
  tryAcquire(n = 1): boolean {
    if (this.queue.length > 0 || this.value < n) return false
    this.value -= n
    return true
  }

  /** V ("verhogen", to raise): give n permits back and wake the ones that can go now. */
  release(n = 1): void {
    this.value += n
    while (this.queue.length > 0 && this.value >= this.queue[0].n) {
      const next = this.queue.shift()!
      this.value -= next.n
      next.go()
    }
  }

  /** Acquire, run, and always release, even when fn throws. */
  async use<T>(fn: () => T | Promise<T>, n = 1): Promise<T> {
    await this.acquire(n)
    try {
      return await fn()
    } finally {
      this.release(n)
    }
  }
}

/** A semaphore with one permit: only one at a time. */
export class Mutex extends Semaphore {
  constructor(name = 'mutex') {
    super(1, name)
  }
  get locked(): boolean {
    return this.value <= 0
  }
}

print('📦 offers: Semaphore, Mutex')
print('value = how many permits are free')
print('acquire(n) = P: take n, or wait in line')
print('release(n) = V: give n back, wake the first in line')
print('tryAcquire(n): take only if free now')
print('use(fn): acquire, run fn, release')
print('waiting = how many stand in line')
print('')
print('value 1 = a Mutex (one at a time)')
print('value 4 = four at a time')
print('value 0 at the start = a signal: "wait until somebody calls release()"')
print('')
print('The line is first come, first served, so nobody waits for ever just because others keep coming.')
print('The members (value, waiting) are real members of one object: every cell that imports this class sees the same ones.')`,
  ],
  [
    'G24',
    String.raw`// LOST UPDATES. Four workers add 1 to the same counter, 8 times each. The right answer is 32.
// Each add is: read the number, wait a little (a real cell would await an answer), write number + 1.
span(6, 6)
color('#e4f2e1')

import { Mutex } from './A24'

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
        await lock?.acquire() // P: one at a time through the next three lines
        const seen = run.count // read ...
        await sleep(20 + Math.random() * 60) // ... others run in this gap ...
        run.count = seen + 1 // ... and we write back what we SAW: maybe an old number
        lock?.release() // V
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

import { Semaphore, Mutex } from './A24'

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
    'G30',
    String.raw`// THE DINING PHILOSOPHERS. Five sit at a round table with five forks, one between each two. To eat you need BOTH of your forks.
// Round 1: everyone takes the left fork first, so they can all end up holding one and waiting for ever: a DEADLOCK.
// Round 2: the forks are numbered and everyone takes the lower number first: the circle of waiting is gone.
// Round 3: a butler (a Semaphore with 4 permits) lets only 4 sit at once, so one can always finish.
span(6, 6)
color('#f6e7d8')

import { Semaphore } from './A24'

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
