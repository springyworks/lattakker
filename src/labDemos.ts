/**
 * The Lab: a second sheet of live demo cells. Every block is real TypeScript, exactly like the cells on the game
 * board's sheet; the plots animate by calling plot() again from every(). Code is raw text (String.raw), so
 * "\n" below is the two characters backslash-n inside the demo's own strings.
 */
export const LAB_DEMOS: Array<[string, string]> = [
  [
    'A1',
    String.raw`// Welcome to the Lab! This sheet works exactly like the one under the game board.
// Any line that starts with two slashes is a COMMENT: a note for humans.
// The computer skips it, so you can write whatever helps you remember.
// Code is a list of small instructions. The computer reads them from the
// top to the bottom, one line after the other, like a recipe.

// span(10, 2) sets the size of this block (a "cell" of the sheet).
// 10 is how many columns wide it is, 2 is how many rows tall it is.
span(10, 2)
// color('...') paints the background of the cell. The text in quotes is a
// colour code: '#' followed by letters and digits that mix red, green, blue.
color('#d9e8dd')
// print('...') writes a line of text inside the cell. Text must live inside
// quotes so the computer knows it is words, not an instruction.
print('🧪 Welcome to the Lab')
// Each print() adds one more line under the previous one.
print('Every block here is TypeScript that runs by itself.')
print('Double-click a block to change it.')`,
  ],
  [
    'K1',
    String.raw`// Hover the little ⋮ at the top-right of any cell: edit, run again, resize, ids, delete.
// Lines starting with // are comments: notes for humans, ignored by the computer.

// This cell is 8 columns wide and 2 rows tall.
span(8, 2)
// Paint the background a warm sand colour (a colour code in quotes).
color('#f2e4bd')
// print() writes one line of text into the cell. Words go inside quotes.
print('⋮ Hover the dots in a cell corner')
// Inside quotes, an apostrophe would look like the end of the text. So we put
// a backslash in front of it: it means "this one is just a letter, keep going".
print('It opens that cell\'s menu')`,
  ],
  [
    'S1',
    String.raw`// The Lab has no battle of its own, but its code can still read the game on the first tab.
// 'game' is a ready-made object: think of it as a window that lets this cell
// peek at the board on the first tab. Reading is safe, nothing gets changed.

// 8 columns wide, 2 rows tall.
span(8, 2)
// A soft pink background.
color('#f0d8d5')
// The + sign glues pieces of text together. game.phase is the stage of the
// game (like "playing") and game.moveCount is how many moves were made so far.
print('Game: ' + game.phase + ', move ' + game.moveCount)
// "a === b" asks a yes/no question: are these two the same?
// "question ? this : that" is a tiny if: if the answer is yes we use the first
// text, otherwise the second. So we print whose turn it is.
print(game.turn === 'red' ? 'Red to move' : 'Blue to move')`,
  ],
  [
    'A3',
    String.raw`// A wave that travels: every 100 milliseconds the plot is drawn again, shifted a little.
// Try: '50ms' for a faster wave, or Math.cos instead of Math.sin
// The idea: sine is the smooth up-and-down of a swing, or a wave on the sea.
// Math.sin(x) gives a number between -1 and 1 that goes up, down, up, down
// as x grows. If we slowly subtract from x, the whole wave slides sideways.

// This block is 5 columns wide and 3 rows tall.
span(5, 3)
// 'const' makes a named box that keeps a value and never changes its content.
// Here the box is called draw and holds a little machine (a function).
// "(n) => ..." is an ARROW FUNCTION: give it a number n, it does the work
// after the arrow. The work is plot(what, options): it draws a graph.
// plot() gets a function (x) => ... to draw, and a list of options in { }:
// from/to is the range of x, steps is how many dots make the line,
// title is the heading, yMin/yMax is the lowest and highest height shown.
// The "- n / 4" is what moves the wave: n grows with every tick.
const draw = (n) => plot((x) => Math.sin(x - n / 4), { from: 0, to: 12.5, steps: 120, title: 'Travelling wave', yMin: -1.2, yMax: 1.2 })
// Draw the first picture right now, with n = 0 (no shift yet).
draw(0)
// every('100ms', f) calls f again and again, once every 100 milliseconds
// (that is 10 times a second). It hands f a counter n: 0, 1, 2, 3...
// Each new picture is shifted a bit, so your eyes see a moving wave.
every('100ms', draw)`,
  ],
  [
    'F3',
    String.raw`// Two waves with names (so the plot has a legend). One runs left, the other right.
// The idea: sine and cosine are twin waves, the same wave but starting at a
// different moment, like two kids on swings who started at different times.

// The block is 5 columns wide and 3 rows tall.
span(5, 3)
// 'const' names a value. draw is a small machine (an arrow function) that
// takes a counter n and draws one picture. The { } hold its steps.
const draw = (n) => {
  // t is "time". Dividing n by 6 makes time pass more slowly.
  const t = n / 6
  // plot({ name: function, name: function }, options) draws several lines.
  // The names ('sin' and 'cos') appear in the legend so you can tell them apart.
  // "+ t" slides the first wave one way, "- t" slides the other way.
  // from 0 to 6.28 is one full turn of the wave (6.28 is about 2 times pi).
  plot({ sin: (x) => Math.sin(x + t), cos: (x) => Math.cos(x - t) }, { from: 0, to: 6.28, title: 'Dancing waves', yMin: -1.2, yMax: 1.2 })
}
// Draw once at the start, with n = 0.
draw(0)
// every('120ms', f) runs f again each 120 milliseconds, giving it a counter
// n that goes 0, 1, 2... So t grows and the two waves keep dancing.
every('120ms', draw)`,
  ],
  [
    'K3',
    String.raw`// A Lissajous curve: x and y both swing, at different speeds. The shape slowly turns.
// Try: change 3 and 2 to other small numbers.
// The idea: imagine a pen moving left-right like a swing (that is x) while
// also moving up-down like another swing (that is y). If the two swings go
// at different speeds, the pen draws a pretty looping ribbon.

// 5 columns wide, 3 rows tall.
span(5, 3)
// draw is an arrow function: a small machine that draws one picture.
// It receives n, a counter that grows each tick.
const draw = (n) => {
  // phase is how far the x swing is "ahead". Changing it turns the shape.
  const phase = n / 20
  // A list (array) of points. It starts empty; we will fill it up.
  // 'const' means the box keeps pointing at the same list, but we may still
  // add things to the list itself.
  const points = []
  // A LOOP: repeat the lines inside { } many times. i starts at 0 and goes up
  // by one (i++) while i <= 200. So we make 201 points along the curve.
  for (let i = 0; i <= 200; i++) {
    // t walks from 0 to 6.2832 (one full turn: 2 times pi) as i goes 0 to 200.
    const t = (i / 200) * 6.2832
    // A point is a pair [x, y]. x swings 3 times per turn, y swings 2 times.
    // push() adds the new point at the end of the list.
    points.push([Math.sin(3 * t + phase), Math.sin(2 * t)])
  }
  // plot(points, options) joins the dots with a line. xMin/xMax and yMin/yMax
  // fix the window we look through, so the picture does not jump around.
  plot(points, { title: 'Lissajous 3 : 2', xMin: -1.2, xMax: 1.2, yMin: -1.2, yMax: 1.2 })
}
// Draw the first picture now.
draw(0)
// every('120ms', f) calls f every 120 milliseconds, passing a counter n.
// The phase grows, so the ribbon slowly turns.
every('120ms', draw)`,
  ],
  [
    'P3',
    String.raw`// A ball in a box. Gravity pulls it down, the floor and walls bounce it back.
// A series whose name starts with _ stays out of the legend.
// The idea: a ball has a position (x, y) and a speed (vx, vy). Every tick we
// move it by its speed. Gravity makes the downward speed a bit bigger each
// tick. When it hits the floor or a wall we flip the speed: a bounce!

// 5 columns wide, 3 rows tall.
span(5, 3)
// A list of corner points: going round the box and back to the start.
const box = [[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]]
// 'let' makes a box whose value CAN change later (const can not).
// x, y: where the ball is. vx: speed sideways. vy: speed up/down.
let x = 1, y = 5, vx = 0.18, vy = 0
// The trail is a list of the last places the ball has been.
const trail = []
// every('60ms', f) runs f again every 60 milliseconds. f is an arrow
// function () => { ... }: a little machine with no input.
every('60ms', () => {
  // Gravity: "-=" means "take this away". The ball gets faster downwards.
  vy -= 0.03
  // "+=" means "add this". Move the ball by its speeds.
  x += vx
  y += vy
  // IF: only do the part in { } when the question is true.
  // Is the ball below the floor? Put it back on the floor and send it up
  // again, a bit slower (times 0.9), as a real ball loses some energy.
  if (y < 0.2) { y = 0.2; vy = -vy * 0.9 }
  // "||" means OR. If the ball touches the left or right wall, flip vx.
  if (x < 0.2 || x > 9.8) vx = -vx
  // Remember the current position at the end of the trail.
  trail.push([x, y])
  // Keep only the last 10 positions: shift() throws away the oldest one.
  if (trail.length > 10) trail.shift()
  // Draw the box, the trail and the ball (a list holding just one point).
  // The names start with _ so they are not listed in the legend.
  plot({ _box: box, _trail: trail, _ball: [[x, y]] }, { title: 'Bouncing ball', xMin: -0.2, xMax: 10.2, yMin: -0.2, yMax: 6.2 })
})`,
  ],
  [
    'U3',
    String.raw`// A spirograph: a pen on a small wheel that rolls inside a big one. It draws a bit more every tick.
// The idea: put a pencil in a hole of a small wheel and roll the wheel round
// the inside of a big ring. The pencil draws a flower-like loop pattern.
// The maths mixes two circles (sine and cosine) that turn at different speeds.

// 5 columns wide, 3 rows tall.
span(5, 3)
// R: size of the big ring. r: size of the small wheel.
// d: how far the pencil hole is from the wheel's centre. Try other numbers!
const R = 5, r = 3, d = 5
// memory is a notebook that belongs to this cell and survives each tick.
// "??=" means: if memory.n has no value yet, start it at 0, else keep it.
memory.n ??= 0
// every('70ms', f) runs f every 70 milliseconds.
every('70ms', () => {
  // Count one step up. "% 260" is the remainder after dividing by 260,
  // so after 259 we wrap round to 0 and start drawing again.
  memory.n = (memory.n + 1) % 260
  // An empty list that will collect the points of the curve.
  const points = []
  // LOOP: for each i from 0 to memory.n we compute one more point.
  // So the drawing grows longer each tick, like a pen at work.
  for (let i = 0; i <= memory.n; i++) {
    // t is the angle (how far the wheel has turned) for this point.
    const t = i * 0.12
    // The pencil x and y: a big circle motion plus a small, faster one.
    // The wheel turns (R - r) / r times as fast as the main motion.
    points.push([(R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t), (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)])
  }
  // plot(points, options) joins the points. The min/max keep the window still.
  plot(points, { title: 'Spirograph', xMin: -8, xMax: 8, yMin: -8, yMax: 8 })
})`,
  ],
  [
    'A7',
    String.raw`// Bubble sort, one comparison at a time. The two bars being compared are red.
// The idea: to put bars in order, look at two neighbours. If the left one is
// taller than the right one, swap them. Walk along the row doing this. The
// tallest bar "bubbles up" to the end. Repeat until everything is in order.

// 5 columns wide, 3 rows tall.
span(5, 3)
// N is how many bars we sort.
const N = 12
// reset is a small machine that makes a new random row of bars.
// memory is this cell's notebook: it keeps values between ticks.
const reset = () => {
  // Array.from({ length: N }, f) builds a list of N things, calling f for each.
  // Here each bar gets a random height from 1 to 20 (Math.random() is a
  // number between 0 and 1; Math.floor cuts off the decimals).
  memory.v = Array.from({ length: N }, () => 1 + Math.floor(Math.random() * 20))
  // i: which pair we look at now. pass: how many rounds we finished.
  memory.i = 0
  memory.pass = 0
  // wait: a pause counter, so we can admire the sorted bars for a moment.
  memory.wait = 0
}
// "!" means NOT. If the notebook has no bars yet, make some.
if (!memory.v) reset()
// bars turns a list of heights into dots that plot() draws as rectangles.
const bars = (list) => {
  // pts will collect the corner points of all bars.
  const pts = []
  // forEach runs a function for every item: h is the height, k the position.
  // Each bar is 4 corners: bottom-left, top-left, top-right, bottom-right.
  list.forEach((h, k) => pts.push([k, 0], [k, h], [k + 0.8, h], [k + 0.8, 0]))
  // Give the finished list of points back to whoever asked.
  return pts
}
// Every 120 milliseconds we do ONE small step of the sorting.
every('120ms', () => {
  // A short name for the list of bars.
  const v = memory.v
  // If we are in the pause after finishing...
  if (memory.wait > 0) {
    // ...count the pause down (-- means "minus one")...
    memory.wait--
    // ...and when it hits zero, shuffle new bars and start over.
    if (memory.wait === 0) reset()
    // return means: stop here for this tick.
    return
  }
  // The position of the left bar of the pair we compare.
  const i = memory.i
  // If the left bar is taller than its right neighbour, swap the two.
  // The [a, b] = [b, a] trick swaps two values in one line.
  if (v[i] > v[i + 1]) [v[i], v[i + 1]] = [v[i + 1], v[i]]
  // Move on to the next pair (++ means "plus one").
  memory.i++
  // At the end of the row, go back to the start and begin a new pass. The
  // last bars are already in place, so each pass can stop a bit sooner.
  if (memory.i >= N - 1 - memory.pass) { memory.i = 0; memory.pass++ }
  // When all passes are done, start the pause (12 ticks).
  if (memory.pass >= N - 1) memory.wait = 12
  // j is the pair to highlight in red.
  const j = memory.i
  // Make the two highlighted bars, then slide them right by j positions.
  // "?? 0" means: if there is no bar there, use 0. map() changes each point.
  const pair = bars([v[j], v[j + 1] ?? 0]).map(([px, py]) => [px + j, py])
  // Draw all bars, plus the pair in a second colour. The _ keeps it out of
  // the legend.
  plot({ bars: bars(v), _pair: pair }, { title: 'Bubble sort', xMin: -0.5, xMax: N + 0.5, yMin: 0, yMax: 22 })
})`,
  ],
  [
    'F7',
    String.raw`// Three random walkers. Every tick each one takes a step up or down. Who ends up highest?
// The idea: imagine flipping a coin each second. Heads: take one step up.
// Tails: one step down. Where do you end up after 60 flips? Nobody knows
// before! That is a "random walk", and it shows how luck behaves.

// 5 columns wide, 3 rows tall.
span(5, 3)
// fresh makes a brand-new list of three walkers. Each walker is a list that
// holds the heights it has had so far: it starts at 0.
const fresh = () => [[0], [0], [0]]
// memory is this cell's notebook. "??=" fills it only if it is still empty.
memory.w ??= fresh()
// every('150ms', f) runs f again every 150 milliseconds.
every('150ms', () => {
  // For each walker, add a new height: the last height (walk[walk.length - 1])
  // plus -1 or +1. Math.random() is between 0 and 1, so "< 0.5" is a coin flip.
  for (const walk of memory.w) walk.push(walk[walk.length - 1] + (Math.random() < 0.5 ? -1 : 1))
  // After 60 steps, throw the old walks away and start new ones.
  if (memory.w[0].length > 60) memory.w = fresh()
  // Draw the three lines. Their names go in the legend. A plain list of
  // numbers is drawn with the step number across and the height up.
  plot({ ann: memory.w[0], ben: memory.w[1], cy: memory.w[2] }, { title: 'Random walks', xMin: 0, xMax: 60 })
})`,
  ],
  [
    'K7',
    String.raw`// Adding sine waves makes a square wave. Every 0.7 seconds one more wave is added: watch the corners get sharper.
// The idea: a sine wave is a smooth hill and valley. A square wave is a flat
// top, a sudden drop, a flat bottom. Surprise: if you add sine waves that are
// faster (3 times, 5 times, 7 times...) and smaller (1/3, 1/5, 1/7...), the
// sum gets closer and closer to the square! This is the Fourier idea: any
// shape can be built from simple waves, like a song from separate notes.

// 5 columns wide, 3 rows tall.
span(5, 3)
// 'let' is a box whose value can change later. terms counts how many waves
// we add together right now.
let terms = 1
// The target: +1 when sine is zero or above, otherwise -1. It is the perfect
// square wave we want to copy. "cond ? a : b" picks a if cond is true.
const square = (x) => (Math.sin(x) >= 0 ? 1 : -1)
// draw is a machine that plots the target and our sum of waves.
const draw = () => {
  // sum(x) adds up the first 'terms' waves at the place x.
  const sum = (x) => {
    // s is our running total, it starts at 0.
    let s = 0
    // LOOP: k = 0, 1, 2... Wave number k is sin((2k+1)x) / (2k+1): the odd
    // speeds 1, 3, 5... and the sizes 1, 1/3, 1/5...
    for (let k = 0; k < terms; k++) s += Math.sin((2 * k + 1) * x) / (2 * k + 1)
    // Multiply by 4 / pi so the flat tops land at height 1.
    return (4 / Math.PI) * s
  }
  // plot({ name: function, ... }) draws both lines. The name of the second
  // one is built from text + the number of terms: ['sum of ' + terms].
  // steps: 240 uses many points so the line looks smooth.
  plot({ target: square, ['sum of ' + terms]: sum }, { from: 0, to: 6.2832, steps: 240, title: 'Fourier', yMin: -1.6, yMax: 1.6 })
}
// Show the first picture.
draw()
// Every 700 milliseconds: add one more wave (up to 12, then start again
// from 1), and draw the picture once more.
every('700ms', () => {
  terms = terms >= 12 ? 1 : terms + 1
  draw()
})`,
  ],
  [
    'P7',
    String.raw`// An oscilloscope: a wave plus a little noise, scrolling by.
// Try: change 0.3 (the noise) or 2 (the speed of the wave).
// The idea: an oscilloscope is a gadget that draws electric signals. Real
// signals are never perfectly smooth: they wobble a little. So we draw a
// clean wave, a small fast wiggle on top, and a bit of random noise.

// 5 columns wide, 3 rows tall.
span(5, 3)
// 'let' makes a box that can change. t is time; it starts at 0.
let t = 0
// every('80ms', f) runs f every 80 milliseconds.
every('80ms', () => {
  // "+=" adds to the box. Time moves forward, so the wave scrolls by.
  t += 0.25
  // f is the signal: a main wave (speed 2) + a small fast wave (0.3 high,
  // speed 13) + random noise. Math.random() - 0.5 is between -0.5 and 0.5.
  const f = (x) => Math.sin(2 * (x + t)) + 0.3 * Math.sin(13 * (x + t)) + (Math.random() - 0.5) * 0.3
  // plot(f, options) draws the function f from x = 0 to x = 6 using 90 dots,
  // with the given title, window (yMin..yMax) and line colour.
  plot(f, { from: 0, to: 6, steps: 90, title: 'Oscilloscope', yMin: -2, yMax: 2, color: '#3f8f5a' })
})`,
  ],
  [
    'U7',
    String.raw`// Roll two dice again and again and count the totals. The pile in the middle appears all by itself!
// The idea: with two dice, a total of 7 can be made in 6 ways (1+6, 2+5, ...)
// but 2 only one way (1+1). So 7 shows up most often, and 2 or 12 rarely.
// The more you roll, the more the bars look like a hill.

// 5 columns wide, 3 rows tall.
span(5, 3)
// The notebook (memory) keeps 11 counters, one for each total from 2 to 12.
// new Array(11).fill(0) makes a list of 11 zeros.
memory.counts ??= new Array(11).fill(0)
// Roll two dice every 80 milliseconds.
every('80ms', () => {
  // One die: Math.random() * 6 is 0 up to (not including) 6; Math.floor cuts
  // off decimals, giving 0..5. Two of them give 0..10, plus 2 gives 2..12.
  const total = 2 + Math.floor(Math.random() * 6) + Math.floor(Math.random() * 6)
  // Add one to the counter of this total (total 2 is counter number 0).
  memory.counts[total - 2]++
  // reduce adds up all the counters: how many rolls so far.
  const rolls = memory.counts.reduce((a, b) => a + b, 0)
  // After 500 rolls, empty the counters and start again.
  if (rolls > 500) memory.counts = new Array(11).fill(0)
  // Build the bars: each counter becomes a rectangle of that height.
  const pts = []
  memory.counts.forEach((c, k) => pts.push([k + 2, 0], [k + 2, c], [k + 2.8, c], [k + 2.8, 0]))
  // Draw the bars. The title shows the number of rolls. yMax grows with the
  // tallest bar (Math.max picks the biggest number; "..." spreads the list).
  plot(pts, { title: 'Two dice, ' + rolls + ' rolls', xMin: 2, xMax: 13, yMin: 0, yMax: Math.max(10, ...memory.counts) * 1.1, color: '#a66cc4' })
})`,
  ],
  [
    'A11',
    String.raw`// An analog clock drawn with plot(): a circle for the face and three lines for the hands.
// The idea: a clock hand is a line from the middle that points in a direction.
// A full turn is 6.2832 (that is 2 times pi), the angle in "radians". Sine and
// cosine turn an angle into a spot on a circle: sine says how far right and
// cosine says how far up. At angle 0 the hand points to 12 and goes clockwise.

// 4 columns wide, 4 rows tall: a square, so the circle stays round.
span(4, 4)
// draw is an arrow function: a machine we can run again and again.
const draw = () => {
  // new Date() is an object that knows the time right now.
  const now = new Date()
  // seconds (0 to 59)
  const s = now.getSeconds()
  // minutes, with the seconds as a fraction so the minute hand moves smoothly
  const m = now.getMinutes() + s / 60
  // hours on a 12-hour dial ("% 12" turns 13 into 1), plus the minutes fraction
  const h = (now.getHours() % 12) + m / 60
  // hand(turns, length) makes a line from the middle [0, 0] to the tip.
  // turns is how much of a full circle (0 to 1), length is how long the hand is.
  // Multiplying by 6.2832 converts "turns" into an angle.
  const hand = (turns, length) => [[0, 0], [length * Math.sin(turns * 6.2832), length * Math.cos(turns * 6.2832)]]
  // The face is a list of points on a circle of radius 1.
  const face = []
  // LOOP: 61 points; each step turns by 0.10472 (one 60th of a full turn).
  for (let i = 0; i <= 60; i++) face.push([Math.sin(i * 0.10472), Math.cos(i * 0.10472)])
  // Draw the face and 3 hands: the hour hand turns once per 12 hours, the
  // minute and second hands once per 60 minutes / seconds. Names starting with
  // _ stay out of the legend; axes: false hides the graph paper numbers.
  plot({ _face: face, _hour: hand(h / 12, 0.5), _minute: hand(m / 60, 0.8), _second: hand(s / 60, 0.92) }, { axes: false, xMin: -1.1, xMax: 1.1, yMin: -1.1, yMax: 1.1 })
}
// Draw once right away so we do not wait a second to see the clock.
draw()
// every('1s', draw) runs draw again every second ('1s' = one second).
every('1s', draw)`,
  ],
  [
    'E11',
    String.raw`// A digital clock. every('1s', ...) runs again each second.
// The idea: a computer keeps the time in a Date object, like a wristwatch.
// We ask it for the time and write it as text in the cell.

// 3 columns wide, 2 rows tall.
span(3, 2)
// A cool pale blue background.
color('#dbe2ec')
// new Date() holds the time right now. toLocaleTimeString() turns it into
// text like 10:36:31, written the way your computer's language likes.
// show(text) replaces everything in the cell by this one text (print() adds).
show(new Date().toLocaleTimeString())
// every('1s', f) calls f once each second. The () => ... is an arrow
// function: a little machine with no input. Each time, it asks for a fresh
// Date, so the shown time moves on.
every('1s', () => show(new Date().toLocaleTimeString()))`,
  ],
  [
    'E13',
    String.raw`// A progress bar that fills during each minute of the clock.
// The idea: a minute has 60 seconds. We want a bar of 20 little blocks, so
// every 3 seconds one more block fills up (60 / 3 = 20).

// 3 columns wide, 2 rows tall.
span(3, 2)
// A light purple background.
color('#e3dcee')
// draw is a machine (an arrow function) that shows the bar once.
const draw = () => {
  // The seconds of the current time: a number from 0 to 59.
  const s = new Date().getSeconds()
  // Divide by 3 and round to a whole number: how many blocks are filled.
  const done = Math.round(s / 3)
  // '#'.repeat(done) writes # as many times as done. The dots fill the rest of
  // the 20 places. The backslash-n in the text means "start a new line".
  // Then we add the seconds
  // number, glued with + (a number glued to text becomes text).
  show('#'.repeat(done) + '.'.repeat(20 - done) + '\n' + s + ' of 60 seconds')
}
// Show the bar once at the start.
draw()
// Run draw again every second ('1s').
every('1s', draw)`,
  ],
  [
    'I11',
    String.raw`// A "sensor": a number that moves up and down. Other cells can read it with at('I11').
// The idea: a sensor is a gadget that measures something, like a thermometer.
// This pretend sensor makes a number that swings smoothly between 5 and 95,
// like a sine wave. Other cells can look at this number and react.

// 3 columns wide, 2 rows tall.
span(3, 2)
// A warm sand colour.
color('#f2e4bd')
// show(text) puts one text in the cell. We start with 50.0 (the middle).
show('50.0')
// every('150ms', f) calls f every 150 milliseconds, giving it a counter n
// (0, 1, 2, 3...). Math.sin(n / 9) swings between -1 and 1; times 45 gives
// -45 to 45; plus 50 gives 5 to 95. toFixed(1) keeps one decimal digit.
every('150ms', (n) => show((50 + 45 * Math.sin(n / 9)).toFixed(1)))`,
  ],
  [
    'I13',
    String.raw`// This cell reads I11. Whenever I11 changes, this cell runs again by itself. That is the spreadsheet idea!
// In a spreadsheet, a cell can use the value of another cell. When that other
// cell changes, the answer is worked out again, without you pressing anything.

// 3 columns wide, 2 rows tall.
span(3, 2)
// A soft green background.
color('#d9e8dd')
// at('I11') points at the cell with the address I11 (column I, row 11).
// .text is the words it shows. Number(...) turns that text into a real number
// so we can do maths with it. 'const v' names the result v.
const v = Number(at('I11').text)
// Double it (* means times). toFixed(1) keeps one digit after the dot.
// Then glue the pieces of text together with + and show the result.
show('I11 × 2 = ' + (v * 2).toFixed(1))`,
  ],
  [
    'L11',
    String.raw`// A chart that remembers the last 40 values of I11. It runs again each time I11 changes; memory keeps the history.
// The idea: a cell forgets its local boxes each time it runs again. But
// 'memory' is a notebook that stays, so we can write down every value we see
// and draw them all as a line. This is how a heart-rate monitor works.

// 5 columns wide, 4 rows tall.
span(5, 4)
// "??=" means: if the notebook page 'history' is empty, start it as an empty
// list []. If it already has a list, leave it alone.
memory.history ??= []
// Read the sensor in I11 and turn its text into a number.
const v = Number(at('I11').text)
// Number.isNaN(v) is true when v is "not a number". "!" means NOT, so only
// real numbers are written down at the end of the list (push).
if (!Number.isNaN(v)) memory.history.push(v)
// Keep at most 40 values: shift() throws the oldest one away.
if (memory.history.length > 40) memory.history.shift()
// If there is anything to draw, plot the list. A list of plain numbers is
// drawn as height values at positions 0, 1, 2... The window is 0 to 100.
if (memory.history.length > 0) plot(memory.history, { title: 'I11 over time', yMin: 0, yMax: 100, color: '#c4553b' })`,
  ],
  [
    'Q11',
    String.raw`// A beating heart: x = 16·sin³t, y = 13·cos t − 5·cos 2t − 2·cos 3t − cos 4t. The size pulses with the beat.
// The idea: a curve is just a trail of points. Here a clever recipe mixes a
// few sine and cosine waves, and the points land on the outline of a heart!
// The number t is an angle that goes once round a circle (0 to 6.28).

// 5 columns wide, 4 rows tall.
span(5, 4)
// every('60ms', f) calls f every 60 milliseconds, passing a counter n.
every('60ms', (n) => {
  // beat is a size factor: 1 means normal. The sine rises and falls; Math.max
  // (0, ...) cuts away the negative part, so there is a rest between beats;
  // "** 3" (cubed) makes each beat short and sharp. 0.12 is how big it grows.
  const beat = 1 + 0.12 * Math.max(0, Math.sin(n / 3)) ** 3
  // An empty list to collect the points of the outline.
  const pts = []
  // LOOP: i goes 0, 1, 2 ... 100, so we create 101 points.
  for (let i = 0; i <= 100; i++) {
    // Turn i into an angle t between 0 and 6.2832 (a full turn).
    const t = (i / 100) * 6.2832
    // The heart recipe. x uses sin(t) cubed, y adds four cosine waves
    // (t, 2t, 3t, 4t). Multiplying by beat makes the heart grow and shrink.
    pts.push([beat * 16 * Math.sin(t) ** 3, beat * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))])
  }
  // plot(points, options) draws the line through the points. axes: false
  // hides the graph paper; the min/max numbers keep the window fixed, so only
  // the heart seems to move.
  plot(pts, { axes: false, xMin: -27.5, xMax: 27.5, yMin: -22, yMax: 22, color: '#c4553b' })
})`,
  ],
  [
    'V11',
    String.raw`// A rose curve r = cos(k · angle). Every tick k changes a little, so the petals bloom and fold.
// The idea: stand in the middle and turn round. While turning, walk out and
// in, out and in, following a cosine wave. The distance from the middle is r
// and the direction is the angle. Walk faster in and out (a bigger k) and you
// get more petals. A rose is a wave wrapped around a circle!

// 5 columns wide, 4 rows tall.
span(5, 4)
// every('90ms', f) runs f every 90 milliseconds with a counter n (0, 1, 2...).
every('90ms', (n) => {
  // k is the petal speed. sin(...) ** 2 is never negative and swings between
  // 0 and 1, so k drifts smoothly between 2 and 5.
  const k = 2 + 3 * Math.sin(n / 25) ** 2
  // An empty list for the points.
  const pts = []
  // LOOP: i goes from 0 to 360, so 361 points make a smooth line.
  for (let i = 0; i <= 360; i++) {
    // The angle a goes from 0 to 12.566 (two full turns).
    const a = (i / 360) * 12.566
    // r = cos(k * a) is the distance. cos(a) and sin(a) turn a distance and
    // a direction into a spot [x, y] on the paper.
    pts.push([Math.cos(k * a) * Math.cos(a), Math.cos(k * a) * Math.sin(a)])
  }
  // Draw the line. axes: false hides numbers; the fixed window keeps it steady.
  plot(pts, { axes: false, xMin: -1.4, xMax: 1.4, yMin: -1.1, yMax: 1.1, color: '#a66cc4' })
})`,
  ],
  [
    'A16',
    String.raw`// Conway's Game of Life on a tile grid that lives inside this block.
// Tiles have their own coordinates (x across, y down), not sheet addresses,
// so you can move or resize this block and nothing breaks. Click a tile to flip it.
// The idea: Life is a tiny world of squares. Each square is ALIVE (green) or
// DEAD (empty). All squares change at the same moment, using just 3 rules.
// A neighbour is any of the 8 squares touching it, even diagonally.
//   1. A live square with 2 or 3 live neighbours stays alive.
//   2. A live square with fewer than 2 (lonely) or more than 3 (crowded) dies.
//   3. An empty square with exactly 3 live neighbours comes alive (a birth).
// From these simple rules, moving shapes and patterns appear by themselves.

// This block is 10 columns wide and 8 rows tall.
span(10, 8)
// Paint the background of the cell a pale green.
color('#eef3ee')
// grid(10, 8) puts a tile grid in this cell: 10 tiles across, 8 tiles down.
// g is the name we give to it, so we can talk to it later.
const g = grid(10, 8)
// W (width) and H (height) are the number of columns and rows of the grid.
const W = g.cols, H = g.rows
// seed makes a new random world: a table (a list of rows, each a list of
// squares). Each square is true (alive) or false (dead).
const seed = () => {
  // Array.from({ length: H }, f) makes H rows; every row makes W squares.
  // Math.random() is between 0 and 1, so "< 0.35" is true about 35% of the
  // time: roughly a third of the squares start alive.
  memory.grid = Array.from({ length: H }, () => Array.from({ length: W }, () => Math.random() < 0.35))
  // Count the generations (rounds of change) from 0.
  memory.gen = 0
}
// memory is this cell's notebook. If there is no world yet, make one.
if (!memory.grid) seed()
// paint draws the world on the tiles and shows a caption.
const paint = () => {
  // 'let' makes a box that can change. We count the live squares in it.
  let alive = 0
  // g.paint(f) asks f for every tile: (x, y) is the tile's column and row.
  // f must answer with a colour to paint, or null to leave the tile empty.
  g.paint((x, y) => {
    // Rows come first: memory.grid[y][x] is the square in row y, column x.
    // If it is dead, answer null (no colour).
    if (!memory.grid[y][x]) return null
    // It is alive: count it...
    alive++
    // ...and paint it green.
    return '#3f8f5a'
  })
  // show(text) writes the caption: generation number and how many are alive.
  show('Life: generation ' + memory.gen + ' · ' + alive + ' alive')
}
// step moves the whole world one generation forward.
const step = () => {
  // A short name for the current world.
  const cells = memory.grid
  // map() builds a NEW table from the old one, so every square changes based
  // on the OLD world (they must all change at the same moment).
  // row is a list of squares, y is its row number; on says if this square is
  // alive, x is its column number.
  memory.grid = cells.map((row, y) => row.map((on, x) => {
    // n counts the live neighbours of this square.
    let n = 0
    // Two loops: dy goes -1, 0, 1 (row above, same, below) and dx goes
    // -1, 0, 1 (column left, same, right). Together: the 9 squares around.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        // "dx || dy" is false only when both are 0: that is the square itself,
        // which is not its own neighbour. For the other 8, add 1 if alive.
        // The "% H" and "% W" wrap round the edges: leave on the right, come
        // back on the left, like a game where the world is a donut.
        if (dx || dy) n += cells[(y + dy + H) % H][(x + dx + W) % W] ? 1 : 0
      }
    }
    // The rules in one line: a live square stays alive with 2 or 3
    // neighbours; a dead square is born with exactly 3.
    return on ? n === 2 || n === 3 : n === 3
  }))
  // One more generation has passed.
  memory.gen++
  // After 80 generations, or if everyone died (flat() makes one long list and
  // some(Boolean) asks "is any square alive?"), start with a new world.
  if (memory.gen > 80 || !memory.grid.flat().some(Boolean)) seed()
}
// on(g, 'click', f) waits until somebody clicks a tile of g. Then it calls f
// and hands it the tile that was clicked: tile.x is its column and tile.y its
// row.
on(g, 'click', (tile) => {
  // "!" means NOT: flip that square. Alive becomes dead, dead becomes alive.
  memory.grid[tile.y][tile.x] = !memory.grid[tile.y][tile.x]
  // Draw the change right away.
  paint()
})
// Draw the first picture of the world now.
paint()
// every('250ms', f) runs f four times each second: calculate the next
// generation, then draw it. That is what makes the pattern move.
every('250ms', () => {
  step()
  paint()
})`,
  ],
  [
    'Q16',
    String.raw`// Reads the game on the first tab. Every time something changes there, this cell runs again and adds a point.
// The idea: a chart of "who is winning" over time. After every move we write
// down how many pieces each side has left, and draw both lines.

// 5 columns wide, 4 rows tall.
span(5, 4)
// memory is this cell's notebook; it stays between runs. "??=" means: if
// there is nothing yet, start with an empty list []. One list per colour.
memory.red ??= []
memory.blue ??= []
// If the game's move counter is now SMALLER than the last one we saw, a new
// game must have begun, so we throw the old history away.
// "memory.moves ?? 0" means: use memory.moves, or 0 if it does not exist.
if (game.moveCount < (memory.moves ?? 0)) {
  memory.red = []
  memory.blue = []
}
// "!==" means "is different from", "||" means OR. Add a point only if the move
// number changed since last time, or if we have no points at all yet.
if (memory.moves !== game.moveCount || memory.red.length === 0) {
  // Remember which move we have just seen.
  memory.moves = game.moveCount
  // game.pieces('red') is the list of red pieces still on the board; its
  // length is how many. push() adds that number at the end of our history.
  memory.red.push(game.pieces('red').length)
  memory.blue.push(game.pieces('blue').length)
}
// plot({ name: list, ... }, options) draws one line per colour. dots: true
// draws a dot for each value. yMin and yMax fix the height of the window.
plot({ red: memory.red, blue: memory.blue }, { title: 'Pieces left (play on the Game board tab)', yMin: 0, yMax: 42, dots: true })`,
  ],
  [
    'V16',
    String.raw`// Click me to add a petal. The flower is plotted from the number stored in memory.
// The idea: a flower shape is a circle whose radius wobbles. r = 1 + 0.4 *
// cos(petals * angle): the radius goes in and out 'petals' times while we go
// once around, so each wobble becomes one petal.

// 5 columns wide, 4 rows tall.
span(5, 4)
// memory is this cell's notebook. "??=" means: if there is no number yet,
// start with 3 petals; otherwise keep what is there.
memory.petals ??= 3
// draw is an arrow function: a machine that draws the flower once.
const draw = () => {
  // A list for the points of the outline.
  const pts = []
  // LOOP: i goes 0 to 300: 301 points.
  for (let i = 0; i <= 300; i++) {
    // The angle a goes once around the circle (6.2832 is a full turn).
    const a = (i / 300) * 6.2832
    // The distance from the middle: 1 plus or minus 0.4, following a cosine
    // wave that has as many bumps as there are petals.
    const r = 1 + 0.4 * Math.cos(memory.petals * a)
    // Distance + angle become a spot on the paper: x = r cos a, y = r sin a.
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  // Draw the line. The title is text glued together with + : it shows how many
  // petals there are now. The min/max numbers keep the window still.
  plot(pts, { title: memory.petals + ' petals (click me)', xMin: -1.8, xMax: 1.8, yMin: -1.5, yMax: 1.5, color: '#d19a2a' })
}
// on(cell, 'click', f) waits until somebody clicks this cell ('cell' means
// this very block). Then it runs f once for each click.
on(cell, 'click', () => {
  // One more petal; after 12 go back to 2. "a ? b : c" means: if a is true
  // use b, otherwise c.
  memory.petals = memory.petals >= 12 ? 2 : memory.petals + 1
  // Draw the new flower.
  draw()
})
// Draw the first flower right now.
draw()`,
  ],
  [
    'A24',
    String.raw`// A cell that changes its own colour: it walks round the colour wheel (hue 0 to 360).
// The idea: colours form a circle, like a rainbow bent into a ring. A number
// from 0 to 360 (degrees round the ring) is called the HUE: 0 is red, 120 is
// green, 240 is blue, and 360 is red again. Screens want a code like '#a3c4f0'
// (amounts of red, green and blue), so we need a little maths to convert.

// 3 columns wide, 2 rows tall.
span(3, 2)
// hsl(h) is an arrow function: you give it a hue h, it answers with a colour
// code. (The answer is the pastel version of that hue.)
const hsl = (h) => {
  // f(n) works out ONE of the three colour amounts (red, green or blue).
  // n says which one; the three amounts sit at different places on the wheel.
  const f = (n) => {
    // k slides along the wheel. "% 12" wraps the number round after 12.
    const k = (n + h / 30) % 12
    // Math.min and Math.max squeeze a value between limits: this makes a wave
    // with flat top and bottom. Then we scale it to 0..255 (the size of one
    // colour amount), round it, and write it in base 16 (hexadecimal).
    // padStart(2, '0') makes sure it always has two characters.
    return Math.round(255 * (0.82 - 0.126 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  // Glue '#' and the red, green and blue pieces together to make the code.
  return '#' + f(0) + f(8) + f(4)
}
// paint(n) sets the colour and the text for one tick (n counts 0, 1, 2...).
const paint = (n) => {
  // Each tick turn 12 degrees more round the wheel. "% 360" wraps back to 0.
  const hue = (n * 12) % 360
  // color(code) paints the cell's background.
  color(hsl(hue))
  // show(text) writes the hue number in the cell.
  show('hue ' + hue + '°')
}
// Paint once now, with n = 0.
paint(0)
// every('150ms', paint) calls paint every 150 ms, giving it the counter n.
every('150ms', paint)`,
  ],
  [
    'D24',
    String.raw`// A typewriter: one more letter every 90 milliseconds, then a short pause, then again.
// The idea: to "type" a sentence, show only its first few letters, and show
// one more letter each tick.

// 6 columns wide, 2 rows tall.
span(6, 2)
// A warm sand colour.
color('#f2e4bd')
// The sentence we will type. Text lives inside quotes and is called a string.
const text = 'Hello! I am a cell and I can type by myself.'
// every('90ms', f) calls f every 90 ms with a counter n (0, 1, 2, 3...).
// text.slice(0, k) cuts out the first k letters. We use k = n % (length + 12):
// "%" is the remainder after dividing, so k climbs up to the full length and
// goes on 12 more ticks (the whole text stays: that is the pause), then wraps
// back to 0 and we start typing again.
// "n % 2 ? '▮' : ''" adds a blinking cursor: it shows on odd ticks only.
every('90ms', (n) => show(text.slice(0, n % (text.length + 12)) + (n % 2 ? '▮' : '')))`,
  ],
  [
    'J24',
    String.raw`// A countdown that launches a rocket. Click me to run it again!
// The idea: a countdown is "start at 5, take one away each second, and when
// you reach 0, do something big".

// 6 columns wide, 2 rows tall.
span(6, 2)
// A soft pink background.
color('#f0d8d5')
// launch is a machine (an arrow function) that runs one whole countdown.
const launch = () => {
  // 'let' makes a box whose value can change. left is the seconds left.
  let left = 5
  // Show the first message at once.
  show('T minus ' + left)
  // every('700ms', f) runs f every 700 ms. It ALSO gives us back a "stop"
  // button (a function). We keep it in stopCounting to call it later.
  const stopCounting = every('700ms', () => {
    // "--" takes one away.
    left--
    // IF the number is still above 0, show it...
    if (left > 0) show('T minus ' + left)
    // ...ELSE (otherwise) the countdown is over!
    else {
      // Show the liftoff message...
      show('🚀 Liftoff!')
      // ...and press the stop button, or the timer would tick on forever.
      stopCounting()
    }
  })
}
// on(cell, 'click', launch) waits for a click on this cell ('cell' means
// this block). When it comes, it runs launch again.
on(cell, 'click', launch)
// Start the first countdown now.
launch()`,
  ],
  [
    'P24',
    String.raw`// A face that reacts to the game on the first tab: who has more pieces left?
// The idea: a program can make a decision. It compares two numbers and
// chooses what to show, like a referee looking at the score.

// 5 columns wide, 2 rows tall.
span(5, 2)
// A light purple background.
color('#e3dcee')
// game.pieces('red') is the list of red pieces on the board; .length is how
// many there are. 'const' names the answer red (a box that will not change).
const red = game.pieces('red').length
// The same for blue.
const blue = game.pieces('blue').length
// "a ? b : c" is a tiny if: if a is true give b, otherwise c. Here we chain
// two of them: if red > blue, red is ahead; else if red < blue, blue is
// ahead; else nobody is ahead. show(text) puts that text in the cell.
show(red > blue ? '😎 Red is ahead' : red < blue ? '😟 Blue is ahead' : '🙂 All even')`,
  ],
  [
    'U24',
    String.raw`// A sparkline made of letters: ▁▂▃▄▅▆▇█ each stand for a height.
// The idea: a sparkline is a very small chart that fits inside a line of
// text. Each little block character is a bar: short ones are low values and
// tall ones are high values. A sine wave moves along them.

// 5 columns wide, 2 rows tall.
span(5, 2)
// A pale blue background.
color('#dbe2ec')
// A string of 8 characters, from the lowest bar to the highest. We can pick
// one with a number: bars[0] is the first, bars[7] is the last.
const bars = '▁▂▃▄▅▆▇█'
// every('150ms', f) calls f every 150 ms with a counter n (0, 1, 2...).
every('150ms', (n) => {
  // 'let' makes a box that can change. line starts as empty text ''.
  let line = ''
  // LOOP: i goes 0 to 23, so we build 24 characters.
  // Math.sin(...) swings between -1 and 1. Times 3.5 and plus 3.5 puts it
  // between 0 and 7, then Math.round makes it a whole number: which bar to use.
  // Adding n shifts the wave a little each tick, so it seems to run along.
  // "+=" glues the new character to the end of line.
  for (let i = 0; i < 24; i++) line += bars[Math.round(3.5 + 3.5 * Math.sin((n + i) / 3))]
  // Put the finished line of bars into the cell.
  show(line)
})`,
  ],
  [
    'A27',
    String.raw`// Your turn! Change a, or the function, then press Ctrl+Enter.
// Try: a = 2, or (x) => Math.sin(x) * a, or from: -8, to: 8
// The idea: a parabola is the curve of a thrown ball. The function a * x * x
// squares x (so negative and positive x both give a positive height), and
// the number a makes it narrow (big a) or wide (small a).

// 8 columns wide, 3 rows tall.
span(8, 3)
// 'const' names a value. a is the number that stretches the curve. Change it!
const a = 0.5
// plot(f, options) draws the function f. (x) => a * x * x is an arrow
// function: give it x, it answers a times x times x. The options in { } say
// to draw from x = -4 to x = 4, with a title above the chart.
plot((x) => a * x * x, { from: -4, to: 4, title: 'a · x²' })`,
  ],
  [
    'J27',
    String.raw`// A challenge for you.
// Now you try it yourself! The cell to the left draws a parabola. Your job
// is to change its code so that it moves. Hints are printed below.

// 8 columns wide, 3 rows tall.
span(8, 3)
// A soft green background.
color('#d9e8dd')
// print('...') writes a line of text into this cell. These lines are only
// text (they are not run as code): they tell you what to do.
print('Make the parabola on the left breathe:')
// An apostrophe inside quotes needs a backslash in front of it: that says
// "it is just a letter, keep going".
print('wrap its plot() in every(\'100ms\', (n) => ...)')
print('and let a change with Math.sin(n / 5).')`,
  ],
];
