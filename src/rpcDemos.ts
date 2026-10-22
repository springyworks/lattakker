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
];
