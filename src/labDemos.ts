/**
 * The Lab: a second sheet of live demo cells. Every block is real TypeScript, exactly like the cells on the game
 * board's sheet; the plots animate by calling plot() again from every(). Code is raw text (String.raw), so
 * "\n" below is the two characters backslash-n inside the demo's own strings.
 */
export const LAB_DEMOS: Array<[string, string]> = [
  [
    'A1',
    String.raw`// Welcome to the Lab! This sheet works exactly like the one under the game board.
span(10, 2)
color('#d9e8dd')
print('🧪 Welcome to the Lab')
print('Every block here is TypeScript that runs by itself.')
print('Double-click a block to change it.')`,
  ],
  [
    'K1',
    String.raw`// Hover the little ⋮ at the top-right of any cell: edit, run again, resize, ids, delete.
span(8, 2)
color('#f2e4bd')
print('⋮ Hover the dots in a cell corner')
print('It opens that cell\'s menu')`,
  ],
  [
    'S1',
    String.raw`// The Lab has no battle of its own, but its code can still read the game on the first tab.
span(8, 2)
color('#f0d8d5')
print('Game: ' + game.phase + ', move ' + game.moveCount)
print(game.turn === 'red' ? 'Red to move' : 'Blue to move')`,
  ],
  [
    'A3',
    String.raw`// A wave that travels: every 100 milliseconds the plot is drawn again, shifted a little.
// Try: '50ms' for a faster wave, or Math.cos instead of Math.sin
span(5, 3)
const draw = (n) => plot((x) => Math.sin(x - n / 4), { from: 0, to: 12.5, steps: 120, title: 'Travelling wave', yMin: -1.2, yMax: 1.2 })
draw(0)
every('100ms', draw)`,
  ],
  [
    'F3',
    String.raw`// Two waves with names (so the plot has a legend). One runs left, the other right.
span(5, 3)
const draw = (n) => {
  const t = n / 6
  plot({ sin: (x) => Math.sin(x + t), cos: (x) => Math.cos(x - t) }, { from: 0, to: 6.28, title: 'Dancing waves', yMin: -1.2, yMax: 1.2 })
}
draw(0)
every('120ms', draw)`,
  ],
  [
    'K3',
    String.raw`// A Lissajous curve: x and y both swing, at different speeds. The shape slowly turns.
// Try: change 3 and 2 to other small numbers.
span(5, 3)
const draw = (n) => {
  const phase = n / 20
  const points = []
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * 6.2832
    points.push([Math.sin(3 * t + phase), Math.sin(2 * t)])
  }
  plot(points, { title: 'Lissajous 3 : 2', xMin: -1.2, xMax: 1.2, yMin: -1.2, yMax: 1.2 })
}
draw(0)
every('120ms', draw)`,
  ],
  [
    'P3',
    String.raw`// A ball in a box. Gravity pulls it down, the floor and walls bounce it back.
// A series whose name starts with _ stays out of the legend.
span(5, 3)
const box = [[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]]
let x = 1, y = 5, vx = 0.18, vy = 0
const trail = []
every('60ms', () => {
  vy -= 0.03
  x += vx
  y += vy
  if (y < 0.2) { y = 0.2; vy = -vy * 0.9 }
  if (x < 0.2 || x > 9.8) vx = -vx
  trail.push([x, y])
  if (trail.length > 10) trail.shift()
  plot({ _box: box, _trail: trail, _ball: [[x, y]] }, { title: 'Bouncing ball', xMin: -0.2, xMax: 10.2, yMin: -0.2, yMax: 6.2 })
})`,
  ],
  [
    'U3',
    String.raw`// A spirograph: a pen on a small wheel that rolls inside a big one. It draws a bit more every tick.
span(5, 3)
const R = 5, r = 3, d = 5
memory.n ??= 0
every('70ms', () => {
  memory.n = (memory.n + 1) % 260
  const points = []
  for (let i = 0; i <= memory.n; i++) {
    const t = i * 0.12
    points.push([(R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t), (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)])
  }
  plot(points, { title: 'Spirograph', xMin: -8, xMax: 8, yMin: -8, yMax: 8 })
})`,
  ],
  [
    'A7',
    String.raw`// Bubble sort, one comparison at a time. The two bars being compared are red.
span(5, 3)
const N = 12
const reset = () => {
  memory.v = Array.from({ length: N }, () => 1 + Math.floor(Math.random() * 20))
  memory.i = 0
  memory.pass = 0
  memory.wait = 0
}
if (!memory.v) reset()
const bars = (list) => {
  const pts = []
  list.forEach((h, k) => pts.push([k, 0], [k, h], [k + 0.8, h], [k + 0.8, 0]))
  return pts
}
every('120ms', () => {
  const v = memory.v
  if (memory.wait > 0) {
    memory.wait--
    if (memory.wait === 0) reset()
    return
  }
  const i = memory.i
  if (v[i] > v[i + 1]) [v[i], v[i + 1]] = [v[i + 1], v[i]]
  memory.i++
  if (memory.i >= N - 1 - memory.pass) { memory.i = 0; memory.pass++ }
  if (memory.pass >= N - 1) memory.wait = 12
  const j = memory.i
  const pair = bars([v[j], v[j + 1] ?? 0]).map(([px, py]) => [px + j, py])
  plot({ bars: bars(v), _pair: pair }, { title: 'Bubble sort', xMin: -0.5, xMax: N + 0.5, yMin: 0, yMax: 22 })
})`,
  ],
  [
    'F7',
    String.raw`// Three random walkers. Every tick each one takes a step up or down. Who ends up highest?
span(5, 3)
const fresh = () => [[0], [0], [0]]
memory.w ??= fresh()
every('150ms', () => {
  for (const walk of memory.w) walk.push(walk[walk.length - 1] + (Math.random() < 0.5 ? -1 : 1))
  if (memory.w[0].length > 60) memory.w = fresh()
  plot({ ann: memory.w[0], ben: memory.w[1], cy: memory.w[2] }, { title: 'Random walks', xMin: 0, xMax: 60 })
})`,
  ],
  [
    'K7',
    String.raw`// Adding sine waves makes a square wave. Every 0.7 seconds one more wave is added: watch the corners get sharper.
span(5, 3)
let terms = 1
const square = (x) => (Math.sin(x) >= 0 ? 1 : -1)
const draw = () => {
  const sum = (x) => {
    let s = 0
    for (let k = 0; k < terms; k++) s += Math.sin((2 * k + 1) * x) / (2 * k + 1)
    return (4 / Math.PI) * s
  }
  plot({ target: square, ['sum of ' + terms]: sum }, { from: 0, to: 6.2832, steps: 240, title: 'Fourier', yMin: -1.6, yMax: 1.6 })
}
draw()
every('700ms', () => {
  terms = terms >= 12 ? 1 : terms + 1
  draw()
})`,
  ],
  [
    'P7',
    String.raw`// An oscilloscope: a wave plus a little noise, scrolling by.
// Try: change 0.3 (the noise) or 2 (the speed of the wave).
span(5, 3)
let t = 0
every('80ms', () => {
  t += 0.25
  const f = (x) => Math.sin(2 * (x + t)) + 0.3 * Math.sin(13 * (x + t)) + (Math.random() - 0.5) * 0.3
  plot(f, { from: 0, to: 6, steps: 90, title: 'Oscilloscope', yMin: -2, yMax: 2, color: '#3f8f5a' })
})`,
  ],
  [
    'U7',
    String.raw`// Roll two dice again and again and count the totals. The pile in the middle appears all by itself!
span(5, 3)
memory.counts ??= new Array(11).fill(0)
every('80ms', () => {
  const total = 2 + Math.floor(Math.random() * 6) + Math.floor(Math.random() * 6)
  memory.counts[total - 2]++
  const rolls = memory.counts.reduce((a, b) => a + b, 0)
  if (rolls > 500) memory.counts = new Array(11).fill(0)
  const pts = []
  memory.counts.forEach((c, k) => pts.push([k + 2, 0], [k + 2, c], [k + 2.8, c], [k + 2.8, 0]))
  plot(pts, { title: 'Two dice, ' + rolls + ' rolls', xMin: 2, xMax: 13, yMin: 0, yMax: Math.max(10, ...memory.counts) * 1.1, color: '#a66cc4' })
})`,
  ],
  [
    'A11',
    String.raw`// An analog clock drawn with plot(): a circle for the face and three lines for the hands.
span(4, 4)
const draw = () => {
  const now = new Date()
  const s = now.getSeconds()
  const m = now.getMinutes() + s / 60
  const h = (now.getHours() % 12) + m / 60
  const hand = (turns, length) => [[0, 0], [length * Math.sin(turns * 6.2832), length * Math.cos(turns * 6.2832)]]
  const face = []
  for (let i = 0; i <= 60; i++) face.push([Math.sin(i * 0.10472), Math.cos(i * 0.10472)])
  plot({ _face: face, _hour: hand(h / 12, 0.5), _minute: hand(m / 60, 0.8), _second: hand(s / 60, 0.92) }, { axes: false, xMin: -1.1, xMax: 1.1, yMin: -1.1, yMax: 1.1 })
}
draw()
every('1s', draw)`,
  ],
  [
    'E11',
    String.raw`// A digital clock. every('1s', ...) runs again each second.
span(3, 2)
color('#dbe2ec')
show(new Date().toLocaleTimeString())
every('1s', () => show(new Date().toLocaleTimeString()))`,
  ],
  [
    'E13',
    String.raw`// A progress bar that fills during each minute of the clock.
span(3, 2)
color('#e3dcee')
const draw = () => {
  const s = new Date().getSeconds()
  const done = Math.round(s / 3)
  show('#'.repeat(done) + '.'.repeat(20 - done) + '\n' + s + ' of 60 seconds')
}
draw()
every('1s', draw)`,
  ],
  [
    'I11',
    String.raw`// A "sensor": a number that moves up and down. Other cells can read it with at('I11').
span(3, 2)
color('#f2e4bd')
show('50.0')
every('150ms', (n) => show((50 + 45 * Math.sin(n / 9)).toFixed(1)))`,
  ],
  [
    'I13',
    String.raw`// This cell reads I11. Whenever I11 changes, this cell runs again by itself. That is the spreadsheet idea!
span(3, 2)
color('#d9e8dd')
const v = Number(at('I11').text)
show('I11 × 2 = ' + (v * 2).toFixed(1))`,
  ],
  [
    'L11',
    String.raw`// A chart that remembers the last 40 values of I11. It runs again each time I11 changes; memory keeps the history.
span(5, 4)
memory.history ??= []
const v = Number(at('I11').text)
if (!Number.isNaN(v)) memory.history.push(v)
if (memory.history.length > 40) memory.history.shift()
if (memory.history.length > 0) plot(memory.history, { title: 'I11 over time', yMin: 0, yMax: 100, color: '#c4553b' })`,
  ],
  [
    'Q11',
    String.raw`// A beating heart: x = 16·sin³t, y = 13·cos t − 5·cos 2t − 2·cos 3t − cos 4t. The size pulses with the beat.
span(5, 4)
every('60ms', (n) => {
  const beat = 1 + 0.12 * Math.max(0, Math.sin(n / 3)) ** 3
  const pts = []
  for (let i = 0; i <= 100; i++) {
    const t = (i / 100) * 6.2832
    pts.push([beat * 16 * Math.sin(t) ** 3, beat * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))])
  }
  plot(pts, { axes: false, xMin: -27.5, xMax: 27.5, yMin: -22, yMax: 22, color: '#c4553b' })
})`,
  ],
  [
    'V11',
    String.raw`// A rose curve r = cos(k · angle). Every tick k changes a little, so the petals bloom and fold.
span(5, 4)
every('90ms', (n) => {
  const k = 2 + 3 * Math.sin(n / 25) ** 2
  const pts = []
  for (let i = 0; i <= 360; i++) {
    const a = (i / 360) * 12.566
    pts.push([Math.cos(k * a) * Math.cos(a), Math.cos(k * a) * Math.sin(a)])
  }
  plot(pts, { axes: false, xMin: -1.4, xMax: 1.4, yMin: -1.1, yMax: 1.1, color: '#a66cc4' })
})`,
  ],
  [
    'A16',
    String.raw`// Conway's Game of Life on a tile grid that lives inside this block.
// Tiles have their own coordinates (x across, y down), not sheet addresses,
// so you can move or resize this block and nothing breaks. Click a tile to flip it.
span(10, 8)
color('#eef3ee')
const g = grid(10, 8)
const W = g.cols, H = g.rows
const seed = () => {
  memory.grid = Array.from({ length: H }, () => Array.from({ length: W }, () => Math.random() < 0.35))
  memory.gen = 0
}
if (!memory.grid) seed()
const paint = () => {
  let alive = 0
  g.paint((x, y) => {
    if (!memory.grid[y][x]) return null
    alive++
    return '#3f8f5a'
  })
  show('Life: generation ' + memory.gen + ' · ' + alive + ' alive')
}
const step = () => {
  const cells = memory.grid
  memory.grid = cells.map((row, y) => row.map((on, x) => {
    let n = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) n += cells[(y + dy + H) % H][(x + dx + W) % W] ? 1 : 0
      }
    }
    return on ? n === 2 || n === 3 : n === 3
  }))
  memory.gen++
  if (memory.gen > 80 || !memory.grid.flat().some(Boolean)) seed()
}
on(g, 'click', (tile) => {
  memory.grid[tile.y][tile.x] = !memory.grid[tile.y][tile.x]
  paint()
})
paint()
every('250ms', () => {
  step()
  paint()
})`,
  ],
  [
    'Q16',
    String.raw`// Reads the game on the first tab. Every time something changes there, this cell runs again and adds a point.
span(5, 4)
memory.red ??= []
memory.blue ??= []
if (game.moveCount < (memory.moves ?? 0)) {
  memory.red = []
  memory.blue = []
}
if (memory.moves !== game.moveCount || memory.red.length === 0) {
  memory.moves = game.moveCount
  memory.red.push(game.pieces('red').length)
  memory.blue.push(game.pieces('blue').length)
}
plot({ red: memory.red, blue: memory.blue }, { title: 'Pieces left (play on the Game board tab)', yMin: 0, yMax: 42, dots: true })`,
  ],
  [
    'V16',
    String.raw`// Click me to add a petal. The flower is plotted from the number stored in memory.
span(5, 4)
memory.petals ??= 3
const draw = () => {
  const pts = []
  for (let i = 0; i <= 300; i++) {
    const a = (i / 300) * 6.2832
    const r = 1 + 0.4 * Math.cos(memory.petals * a)
    pts.push([r * Math.cos(a), r * Math.sin(a)])
  }
  plot(pts, { title: memory.petals + ' petals (click me)', xMin: -1.8, xMax: 1.8, yMin: -1.5, yMax: 1.5, color: '#d19a2a' })
}
on(cell, 'click', () => {
  memory.petals = memory.petals >= 12 ? 2 : memory.petals + 1
  draw()
})
draw()`,
  ],
  [
    'A24',
    String.raw`// A cell that changes its own colour: it walks round the colour wheel (hue 0 to 360).
span(3, 2)
const hsl = (h) => {
  const f = (n) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (0.82 - 0.126 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}
const paint = (n) => {
  const hue = (n * 12) % 360
  color(hsl(hue))
  show('hue ' + hue + '°')
}
paint(0)
every('150ms', paint)`,
  ],
  [
    'D24',
    String.raw`// A typewriter: one more letter every 90 milliseconds, then a short pause, then again.
span(6, 2)
color('#f2e4bd')
const text = 'Hello! I am a cell and I can type by myself.'
every('90ms', (n) => show(text.slice(0, n % (text.length + 12)) + (n % 2 ? '▮' : '')))`,
  ],
  [
    'J24',
    String.raw`// A countdown that launches a rocket. Click me to run it again!
span(6, 2)
color('#f0d8d5')
const launch = () => {
  let left = 5
  show('T minus ' + left)
  const stopCounting = every('700ms', () => {
    left--
    if (left > 0) show('T minus ' + left)
    else {
      show('🚀 Liftoff!')
      stopCounting()
    }
  })
}
on(cell, 'click', launch)
launch()`,
  ],
  [
    'P24',
    String.raw`// A face that reacts to the game on the first tab: who has more pieces left?
span(5, 2)
color('#e3dcee')
const red = game.pieces('red').length
const blue = game.pieces('blue').length
show(red > blue ? '😎 Red is ahead' : red < blue ? '😟 Blue is ahead' : '🙂 All even')`,
  ],
  [
    'U24',
    String.raw`// A sparkline made of letters: ▁▂▃▄▅▆▇█ each stand for a height.
span(5, 2)
color('#dbe2ec')
const bars = '▁▂▃▄▅▆▇█'
every('150ms', (n) => {
  let line = ''
  for (let i = 0; i < 24; i++) line += bars[Math.round(3.5 + 3.5 * Math.sin((n + i) / 3))]
  show(line)
})`,
  ],
  [
    'A27',
    String.raw`// Your turn! Change a, or the function, then press Ctrl+Enter.
// Try: a = 2, or (x) => Math.sin(x) * a, or from: -8, to: 8
span(8, 3)
const a = 0.5
plot((x) => a * x * x, { from: -4, to: 4, title: 'a · x²' })`,
  ],
  [
    'J27',
    String.raw`// A challenge for you.
span(8, 3)
color('#d9e8dd')
print('Make the parabola on the left breathe:')
print('wrap its plot() in every(\'100ms\', (n) => ...)')
print('and let a change with Math.sin(n / 5).')`,
  ],
];
