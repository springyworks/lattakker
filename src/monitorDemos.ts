/**
 * The cells the Monitor tab starts with. Left: the router drawing, alive with the page's own MCP traffic. Right and below:
 * graphs of this computer (CPU, graphics card, temperatures, memory), the router's messages per second and the weather.
 * They are ordinary cells: open one, change it, copy it into your own tab.
 */
export const MONITOR_DEMOS: ReadonlyArray<readonly [string, string]> = [
  [
    'A1',
    String.raw`// THE ROUTER, ALIVE. Every tab, helper and service in this page talks over one MCP router.
// A request is a filled dot that runs to the box that is asked; its answer is a ring that runs back (ping-pong). A signal nobody answers runs one way.
// An AI chat outside the page (the box at the bottom, over the dev server's /mcp) shows its calls and answers here.
// The person (the stickman) talks with the sidebar chat: the question goes in, the answer comes back, and each time the chat asks the
// model (the helper) or uses a tool shows too.
// Inside the router block is its switchboard: every message makes the gateway plug a straight wire from the jack of the one that
// speaks to the jack of the one that listens. The wire shoots across behind a small arrowhead, glows in the colour of the message and
// fades away; below the router's text a dark pane logs every plug as it happens.
span(12, 9)

// svg.asset('router-architecture') is the drawing from resources/. Its boxes are called node-board,
// node-lab, node-weather ... and their lines link-board, link-lab ...
const pic = svg(svg.asset('router-architecture'))
const nodes = pic.ids.filter((id) => id.startsWith('node-')).map((id) => id.slice(5))

// Which box of the drawing belongs to who is talking: a cell ('lab:A3') is "cells", the AI helper is "helper".
function boxOf(name: string): string {
  const first = name.split(':')[0]
  if (nodes.includes(first)) return first
  if (first === 'local-ai') return 'ollama'
  if (first === 'ai') return 'outside_ai' // an AI chat outside the page, over the dev server's /mcp
  if (first === 'ai-chat') return 'sidebar_chat' // the chat in the sidebar of this page
  if (first === 'you') return 'user' // the person typing in it
  if (first.startsWith('ai')) return 'helper'
  if (first === 'system') return 'devserver' // the readings come from the dev server
  if (first === 'tabs' || first === '*') return 'router'
  return 'cells'
}

const busy: Record<string, number> = {}
let dots = 0
// Orange dot: a question (a request). Green ring: its answer, running back. Purple: a signal nobody has to answer. Red ring: the answer went wrong.
// Light blue: the heartbeat below (a ping every 3 seconds, to show the router is alive). The legend in the drawing says the same.
const colors = { request: '#f97316', response: '#16a34a', notification: '#8b5cf6', error: '#ef4444', heartbeat: '#38bdf8' }

// A box grows a little and shrinks back (a busy box does not flicker).
function bump(box: string, size: number): void {
  const now = performance.now()
  if (!nodes.includes(box) || now - (busy[box] ?? 0) < 90) return
  busy[box] = now
  pic.el('node-' + box).animate({ scale: size }, { time: 110, yoyo: true, loop: 2 })
}

const last = pic.write(40, 840, '', { fill: '#475569', 'font-size': 12, 'font-family': 'monospace' })

// Each line of the drawing has a little two-line ticker (tick-NAME-1 and tick-NAME-2 in the SVG): the last two messages over it.
// The drawing says where they sit and how many letters fit; this only fills them in.
const rows: Record<string, { old: ReturnType<typeof pic.el>; now: ReturnType<typeof pic.el>; chars: number; at: number }> = {}
for (const name of pic.ids.filter((id) => id.endsWith('-2') && id.startsWith('tick-')).map((id) => id.slice(5, -2))) {
  const old = pic.el('tick-' + name + '-1')
  rows[name] = { old, now: pic.el('tick-' + name + '-2'), chars: Number(old.attr('data-chars')) || 20, at: 0 }
}
const ink = { request: '#c2410c', notification: '#6d28d9', response: '#475569', error: '#dc2626' }

function tick(channel: string, kind: 'request' | 'response' | 'error' | 'notification', text: string): void {
  const row = rows[channel]
  if (!row) return
  row.old.text(row.now.text()).fill(row.now.attr('fill') ?? '#64748b').opacity(0.55)
  row.now.text(text.length > row.chars ? text.slice(0, row.chars - 1) + '…' : text).fill(ink[kind]).opacity(1)
  // The two lines slide up one place (not for every message of a burst).
  const t = performance.now()
  if (t - row.at > 80) {
    row.old.move(0, 9)
    row.now.move(0, 9)
    row.old.animate({ y: 0 }, { time: 180, ease: 'out' })
    row.now.animate({ y: 0 }, { time: 180, ease: 'out' })
  }
  row.at = t
}

// The drawing is a tree: the router in the middle, boxes around it. Two boxes hang behind another one: the person behind the sidebar chat,
// the outside AI behind the dev server.
const parent: Record<string, string> = { user: 'sidebar_chat', outside_ai: 'devserver' }
const up = (box: string): string[] => (box === 'router' ? ['router'] : [box, ...up(parent[box] ?? 'router')])

// The lines a message crosses: up from the sender to where the two ways meet, then down to the receiver.
// Every line is drawn from the router outwards, so going up is going backwards.
function route(a: string, b: string): { hops: Array<[string, boolean]>; meet: string } {
  const from = up(a)
  const to = up(b)
  const meet = from.find((n) => to.includes(n)) ?? 'router'
  const hops: Array<[string, boolean]> = [
    ...from.slice(0, from.indexOf(meet)).map((n): [string, boolean] => ['link-' + n, true]),
    ...to.slice(0, to.indexOf(meet)).reverse().map((n): [string, boolean] => ['link-' + n, false]),
  ]
  return { hops, meet }
}

// THE SWITCHBOARD inside the router block. Every box of the drawing has a jack where its line meets the router; when a message goes
// from one to another the gateway "plugs" a straight wire between the two jacks. It shoots across (a bright head runs ahead of it),
// glows in the colour of the message, and fades. Wires of a burst pile up as a bundle of fading lights. (A heartbeat is only a thin one.)
const nobody = { 'pointer-events': 'none' }
const BAY = { left: 450, right: 750, top: 200, bottom: 650 }
const JACK = 16
const jacks: Record<string, { x: number; y: number }> = {}
for (const id of pic.ids.filter((i) => i.startsWith('link-'))) {
  // Every line is drawn from the router outwards: the first point of its path is where it meets the router.
  const start = /^M\s+(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(String(pic.el(id).attr('d') ?? ''))
  if (!start) continue
  const x = Number(start[1])
  const y = Number(start[2])
  const edge = { left: Math.abs(x - BAY.left), right: Math.abs(x - BAY.right), top: Math.abs(y - BAY.top), bottom: Math.abs(y - BAY.bottom) }
  const near = Math.min(edge.left, edge.right, edge.top, edge.bottom)
  if (near > 10 || x < BAY.left - 10 || x > BAY.right + 10 || y < BAY.top - 10 || y > BAY.bottom + 10) continue
  const jx = near === edge.left ? BAY.left + JACK : near === edge.right ? BAY.right - JACK : x
  const jy = near === edge.top ? BAY.top + JACK : near === edge.bottom ? BAY.bottom - JACK : y
  const name = id.slice(5)
  jacks[name] = { x: jx, y: jy }
  // The socket, with the name of who is plugged in (short names so they fit inside the block).
  pic.add('circle', { cx: jx, cy: jy, r: 5, fill: '#ffffff', stroke: '#94a3b8', 'stroke-width': 1.5 })
  const side = near === edge.left ? 'start' : near === edge.right ? 'end' : 'middle'
  const tx = near === edge.left ? jx + 9 : near === edge.right ? jx - 9 : jx
  const ty = near === edge.top ? jy + 19 : near === edge.bottom ? jy - 11 : jy + 3
  pic.write(tx, ty, name === 'sidebar_chat' ? 'chat' : name, { fill: '#64748b', 'font-size': 8, 'font-family': 'monospace', 'text-anchor': side })
}
// The gateway itself is a jack under the router's own text: what the router says by itself starts there.
const core = { x: 560, y: 388 }
pic.add('circle', { cx: core.x, cy: core.y, r: 6, fill: '#ffffff', stroke: '#94a3b8', 'stroke-width': 1.5 })
pic.write(core.x + 11, core.y + 3, 'gateway', { fill: '#64748b', 'font-size': 8, 'font-family': 'monospace' })

// THE LOG PANE: a dark console in the lower middle of the block (about a quarter of it, between the jacks). Every plug writes a line
// at the bottom; the older lines slide up and fade, and the oldest disappear under the top edge.
const PANE = { x: 478, y: 432, w: 210, h: 174 }
const LH = 10.5
const clip = pic.add('clipPath', { id: 'switch-log-clip' })
clip.add('rect', { x: PANE.x + 3, y: PANE.y + 16, width: PANE.w - 6, height: PANE.h - 20 })
pic.add('rect', { x: PANE.x, y: PANE.y, width: PANE.w, height: PANE.h, rx: 6, fill: '#0f172a', stroke: '#334155', 'stroke-width': 1.2, opacity: 0.96 })
pic.write(PANE.x + 8, PANE.y + 11, 'switchboard log', { fill: '#94a3b8', 'font-size': 8, 'font-family': 'monospace' })
const plugged = pic.write(PANE.x + PANE.w - 8, PANE.y + 11, '0 plugs', { fill: '#64748b', 'font-size': 8, 'font-family': 'monospace', 'text-anchor': 'end' })
pic.add('line', { x1: PANE.x + 6, y1: PANE.y + 15, x2: PANE.x + PANE.w - 6, y2: PANE.y + 15, stroke: '#1e293b', 'stroke-width': 1 })
const paneRows = pic.add('g', { 'clip-path': 'url(#switch-log-clip)' })
const logRows: Array<{ el: ReturnType<typeof pic.el>; age: number }> = []
const maxChars = Math.floor((PANE.w - 16) / 4.8)
// The colours of the kinds, lighter than in the drawing so they shine on the dark pane.
const glow = { request: '#fb923c', response: '#4ade80', notification: '#a78bfa', error: '#f87171', heartbeat: '#7dd3fc' }
let logged = 0
function logLine(text: string, color: string): void {
  logged++
  plugged.text(logged + ' plugs')
  const row = paneRows.add('text', { x: PANE.x + 8, y: PANE.y + PANE.h - 6 + LH, fill: color, 'font-size': 8, 'font-family': 'monospace', opacity: 0, ...nobody })
  row.text(text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text)
  logRows.push({ el: row, age: 0 })
  for (const r of logRows) {
    r.age++
    r.el.animate({ y: -LH * r.age, opacity: Math.max(0.3, 1 - (r.age - 1) * 0.055) }, { time: 150, ease: 'out' })
  }
  while (logRows.length > 17) logRows.shift()?.el.remove()
}

// The jack of a box: the one where its way to the router meets the router (the outside AI comes in by the dev server, the person by the chat).
function jackOf(box: string): { x: number; y: number } | undefined {
  const chain = up(box)
  return chain.length > 1 ? jacks[chain[chain.length - 2]] : core
}

let wires = 0
function plug(a: string, b: string, color: string, thin: boolean, kind: keyof typeof glow, text: string): void {
  logLine(text, glow[kind])
  const from = jackOf(a)
  const to = jackOf(b)
  if (!from || !to || from === to || wires >= 36) return
  wires++
  const w = thin ? 0.55 : 1
  const glowLine = pic.add('line', { x1: from.x, y1: from.y, x2: from.x, y2: from.y, stroke: color, 'stroke-width': 11 * w, 'stroke-linecap': 'round', opacity: 0.3 * w, ...nobody })
  const wire = pic.add('line', { x1: from.x, y1: from.y, x2: from.x, y2: from.y, stroke: color, 'stroke-width': 3 * w, 'stroke-linecap': 'round', opacity: 1, ...nobody })
  const plugA = pic.add('circle', { cx: from.x, cy: from.y, r: 5.5, fill: color, opacity: 1, ...nobody })
  const plugB = pic.add('circle', { cx: to.x, cy: to.y, r: 5.5, fill: color, opacity: 0, ...nobody })
  // A small arrowhead rides the wire to the listener and stays on it, just before the jack: the direction of the message.
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const at = (px: number, py: number): string => [[6, 0], [-4, -4.2], [-1.5, 0], [-4, 4.2]].map(([f, side]) => (px + ux * f - uy * side).toFixed(1) + ',' + (py + uy * f + ux * side).toFixed(1)).join(' ')
  const arrow = pic.add('polygon', { points: at(from.x, from.y), fill: '#ffffff', stroke: color, 'stroke-width': 1.4, 'stroke-linejoin': 'round', opacity: thin ? 0.7 : 0.95, ...nobody })
  const parts = [glowLine, wire, plugA, plugB, arrow]
  const run = Math.max(len - 13, len * 0.5)
  const shoot = { time: 120, ease: 'out' as const }
  const gone = Promise.all([glowLine.animate({ x2: to.x, y2: to.y }, shoot), wire.animate({ x2: to.x, y2: to.y }, shoot), arrow.animate({ x: ux * run, y: uy * run }, shoot)])
    .then(() => {
      plugB.opacity(1)
      // The light stays a moment, then fades: the wire thins out while the plugs swell and vanish.
      const fade = { time: thin ? 450 : 800, ease: 'in' as const }
      return Promise.all([glowLine.animate({ opacity: 0, 'stroke-width': 3 }, fade), wire.animate({ opacity: 0, 'stroke-width': 0.5 }, fade), arrow.animate({ opacity: 0 }, fade), plugA.animate({ opacity: 0, r: 11 }, fade), plugB.animate({ opacity: 0, r: 11 }, fade)])
    })
  // When the cell runs again the drawing is gone: the late steps have nothing left to draw on.
  gone.then(() => { for (const part of parts) part.remove() }).catch(() => {}).then(() => { wires-- })
}

// The wire is plugged when the message reaches the router: after the lines from the sender to the router.
const plugLater = (a: string, b: string, color: string, thin: boolean, wait: number, kind: keyof typeof glow, text: string): void => {
  if (wait > 0) after(wait, () => plug(a, b, color, thin, kind, text))
  else plug(a, b, color, thin, kind, text)
}

// A dot runs along a list of lines, one after the other: [line, backwards?]. The promise is done when it has arrived.
// A question is a filled dot, its answer a ring (see the legend in the drawing).
function travel(hops: Array<[string, boolean]>, color: string, ring = false): Promise<void> {
  const way = hops.filter(([id]) => pic.ids.includes(id))
  if (!way.length || dots >= 30) return Promise.resolve()
  dots++
  const dot = ring ? pic.add('circle', { r: 6, fill: '#ffffff', stroke: color, 'stroke-width': 4 }) : pic.add('circle', { r: 8, fill: color, stroke: '#ffffff', 'stroke-width': 2 })
  let run: Promise<unknown> = Promise.resolve()
  for (const [id, back] of way) run = run.then(() => dot.animate({ along: '#' + id }, { time: 330, reverse: back }))
  // When the cell runs again the drawing is gone: the dot has nothing left to remove.
  return run.then(() => {
    dot.remove()
    dots--
  }).catch(() => {})
}

// PING-PONG: a question runs to the box that is asked. When the answer comes, it waits until the question has arrived
// and then runs back the same way. So you see both: the request going there, and the reply coming back.
const asked: Record<string, Array<Promise<void>>> = {}

// mcp.tap(fn) runs for every message that crosses the router, as it happens.
mcp.tap((m) => {
  const answer = m.kind === 'response' || m.kind === 'error'
  const failed = m.kind === 'error'
  // For an answer, "from" is the box that was asked and "to" is the one that asked.
  const from = boxOf(m.from)
  const to = boxOf(m.to)
  const { hops, meet } = route(from, to)
  const method = m.method.replace('notifications/', '')

  // The ticker of the line this message crossed: a question on the line it arrives by, an answer on the line it leaves by.
  const line = answer ? hops[0] : hops[hops.length - 1]
  if (line) tick(line[0].slice(5), m.kind, answer ? (failed ? '✕ ' + m.detail : '← ' + method + (m.ms !== undefined ? ' ' + m.ms + 'ms' : '')) : '→ ' + m.from + ' ' + method)
  if (from === 'outside_ai' || to === 'outside_ai') {
    // The way in and out of the page for an outside AI is the dev server: both lines carry its messages.
    const text = (answer ? '← ' : '→ ') + (answer ? m.from : m.to) + ' ' + method
    tick('devserver', m.kind, text)
    tick('outside_ai', m.kind, text)
  }

  const key = (answer ? m.to + '>' + m.from : m.from + '>' + m.to) + ' ' + m.method
  if (answer) {
    last.text('↩ ' + m.from + ' -> ' + m.to + ' ' + method.slice(0, 24) + (m.ms !== undefined ? ' ' + m.ms + 'ms' : ''))
    const question = asked[key]?.shift() ?? Promise.resolve()
    // When the cell runs again the drawing is gone: the late steps of a trip have nothing left to draw on.
    question.then(() => {
      bump(from, 1.03)
      plugLater(from, to, failed ? colors.error : colors.response, false, up(from).indexOf(meet) * 330, failed ? 'error' : 'response', (failed ? '✕ ' : '◂ ') + m.from + '→' + m.to + ' ' + method + (m.ms !== undefined ? ' ' + m.ms + 'ms' : ''))
      return travel(hops, failed ? colors.error : colors.response, true)
    }).then(() => bump(to, 1.03)).catch(() => {})
    return
  }

  last.text('→ ' + m.from + ' -> ' + m.to + ' ' + method.slice(0, 30))
  bump(from, 1.03)
  if (meet === 'router') bump('router', 1.02)
  plugLater(from, to, m.method === 'ping' ? colors.heartbeat : (colors[m.kind] ?? colors.request), m.method === 'ping', up(from).indexOf(meet) * 330, m.method === 'ping' ? 'heartbeat' : m.kind === 'notification' ? 'notification' : 'request', (m.method === 'ping' ? '♥ ' : m.kind === 'notification' ? '• ' : '▸ ') + m.from + '→' + m.to + ' ' + method)
  const trip = travel(hops, m.method === 'ping' ? colors.heartbeat : (colors[m.kind] ?? colors.request)).then(() => bump(to, 1.05)).catch(() => {})
  if (m.kind === 'request') (asked[key] ??= []).push(trip)
  if ((asked[key]?.length ?? 0) > 40) asked[key].shift()
})

// A little heartbeat, so something happens even when nobody does anything.
every('3s', () => mcp.call('status', 'ping'))

// The numbers at the bottom of the drawing.
const label = pic.write(40, 858, '', { fill: '#475569', 'font-size': 12, 'font-family': 'monospace' })
every('1s', () => {
  const s = mcp.stats()
  label.text(s.messages + ' messages so far, ' + s.ratePerSecond + ' per second, ' + s.serverCount + ' servers, ' + s.errors + ' errors')
})
`,
  ],
  [
    'N1',
    String.raw`// CPU AND GRAPHICS CARD LOAD, in percent, the last minute.
// system.read() asks how this computer is doing. system.series('cpu') is the list of the last readings.
// (The real numbers come from the dev server: npm run dev. On the published page a browser may not look.)
span(7, 4)
every('1s', async () => {
  const s = await system.read()
  clear()
  if (s.cpu.load === null) {
    print('📊 A web page may not look at the processor.')
    print('Run the app with npm run dev to see real numbers.')
    print(await system.text())
    return
  }
  plot({ 'CPU %': system.series('cpu', 60), 'GPU %': system.series('gpu', 60) }, { title: 'Load: CPU ' + s.cpu.load + '%' + (s.gpu ? ', GPU ' + s.gpu.load + '%' : ''), yMin: 0, yMax: 100 })
})
`,
  ],
  [
    'N5',
    String.raw`// TEMPERATURES in degrees Celsius: the processor and the graphics card.
span(7, 4)
every('1s', async () => {
  const s = await system.read()
  clear()
  if (s.cpu.temp === null) {
    print('🌡 No temperature sensors reachable from this page.')
    return
  }
  plot({ 'CPU °C': system.series('cpuTemp', 60), 'GPU °C': system.series('gpuTemp', 60) }, { title: 'Temperature: CPU ' + s.cpu.temp + '°C' + (s.gpu?.temp != null ? ', GPU ' + s.gpu.temp + '°C' : ''), yMin: 20, yMax: 100 })
})
`,
  ],
  [
    'N9',
    String.raw`// MEMORY in percent, and how fast this page draws (frames per second).
span(7, 4)
every('1s', async () => {
  const s = await system.read()
  clear()
  const series: Record<string, number[]> = { 'frames per second': system.series('fps', 60) }
  const memory = system.series('memory', 60)
  if (memory.length) series['memory %'] = memory
  plot(series, { title: (s.memory?.usedMb != null && s.memory.totalMb ? 'Memory ' + Math.round((s.memory.usedMb / s.memory.totalMb) * 100) + '%, ' : '') + (s.browser.fps ?? '?') + ' fps', yMin: 0 })
})
`,
  ],
  [
    'A10',
    String.raw`// ROUTER MESSAGES PER SECOND, the last minute. Click around in the other tabs and watch it move.
// mcp.stats().perSecond is a list of 60 numbers: just give it to plot().
span(6, 4)
every('1s', () => {
  plot(mcp.stats().perSecond, { title: 'Router messages per second', color: '#2563eb', yMin: 0 })
})
`,
  ],
  [
    'G10',
    String.raw`// THE WEATHER, from open-meteo.com. Change the place! (A lookup sends the place name there, nothing else.)
span(6, 4)
const place = 'Amsterdam'

async function show() {
  try {
    const w = await weather.now(place)
    clear()
    print(w.icon + ' ' + w.temperature + '°C in ' + place)
    print(w.text + ', wind ' + w.wind + ' km/h from ' + w.windFrom)
  } catch (err) {
    clear()
    print('No weather right now: ' + (err as Error).message)
  }
}
show()
every('10m', show)
`,
  ],
  [
    'A14',
    String.raw`// THIS COMPUTER IN WORDS, and the tabs of this page.
span(12, 3)
every('2s', async () => {
  const s = await system.read()
  clear()
  print('🖥 ' + (s.cpu.model || 'this computer') + ', ' + s.cpu.cores + ' cores' + (s.uptimeSeconds ? ', up ' + Math.round(s.uptimeSeconds / 3600) + ' hours' : ''))
  print(await system.text())
  print('Numbers measured by: ' + s.source + '   |   tabs: ' + tabs.list().map((t) => t.icon + ' ' + t.title).join(', '))
})
`,
  ],
];
