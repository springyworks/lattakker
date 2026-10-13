/**
 * The cells the Monitor tab starts with. Left: the router drawing, alive with the page's own MCP traffic. Right and below:
 * graphs of this computer (CPU, graphics card, temperatures, memory), the router's messages per second and the weather.
 * They are ordinary cells: open one, change it, copy it into your own tab.
 */
export const MONITOR_DEMOS: ReadonlyArray<readonly [string, string]> = [
  [
    'A1',
    String.raw`// THE ROUTER, ALIVE. Every tab, helper and service in this page talks over one MCP router.
// This drawing lights up the part that was asked, and sends a dot along its line.
// An AI chat outside the page (the box at the bottom, over the dev server's /mcp) shows its calls and answers here.
// Chatting with the AI helper shows here too: the question, each time the model is asked, and each tool it uses.
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
  if (first.startsWith('ai') || first === 'you') return 'helper'
  if (first === 'system') return 'devserver' // the readings come from the dev server
  if (first === 'tabs' || first === '*') return 'router'
  return 'cells'
}

const busy: Record<string, number> = {}
let dots = 0
// Light blue: the heartbeat below (a ping every 3 seconds, to show the router is alive). Orange: a question. Purple: a signal nobody has to answer. Green: the answer to the outside AI. Red: it went wrong.
const colors = { request: '#f97316', notification: '#8b5cf6', error: '#ef4444', heartbeat: '#38bdf8' }

// A box grows a little and shrinks back (a busy box does not flicker).
function bump(box: string, size: number): void {
  const now = performance.now()
  if (!nodes.includes(box) || now - (busy[box] ?? 0) < 90) return
  busy[box] = now
  pic.el('node-' + box).animate({ scale: size }, { time: 110, yoyo: true, loop: 2 })
}

const last = pic.write(24, 856, '', { fill: '#475569', 'font-size': 20, 'font-family': 'monospace' })

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

// A dot runs along a list of lines, one after the other: [line, backwards?]. Every line is drawn from the router to its box.
function travel(hops: Array<[string, boolean]>, color: string): void {
  const way = hops.filter(([id]) => pic.ids.includes(id))
  if (!way.length || dots >= 30) return
  dots++
  const dot = pic.add('circle', { r: 8, fill: color, stroke: '#ffffff', 'stroke-width': 2 })
  let run: Promise<unknown> = Promise.resolve()
  for (const [id, back] of way) run = run.then(() => dot.animate({ along: '#' + id }, { time: 380, reverse: back }))
  // When the cell runs again the drawing is gone: the dot has nothing left to remove.
  run.then(() => {
    dot.remove()
    dots--
  }).catch(() => {})
}

// mcp.tap(fn) runs for every message that crosses the router, as it happens.
mcp.tap((m) => {
  const failed = m.kind === 'error' // an error travels back: the box that failed is the one at the far end
  const to = boxOf(failed ? m.from : m.to)
  const from = boxOf(failed ? m.to : m.from)

  // The ticker of the line this message crossed: a question goes to its box, an answer comes from it.
  const method = m.method.replace('notifications/', '')
  const outside = from === 'outside_ai' || boxOf(m.to) === 'outside_ai'
  if (m.kind === 'response' || failed) tick(boxOf(m.from), m.kind, (failed ? '✕ ' + m.detail : '← ' + method + (m.ms !== undefined ? ' ' + m.ms + 'ms' : '')))
  else tick(boxOf(m.to), m.kind, '→ ' + m.from + ' ' + method)
  if (outside) {
    // The way in and out of the page for an outside AI is the dev server: both lines carry its messages.
    const who = m.kind === 'request' || m.kind === 'notification' ? m.to : m.from
    const line = (m.kind === 'request' || m.kind === 'notification' ? '→ ' : '← ') + who + ' ' + method
    tick('devserver', m.kind, line)
    tick('outside_ai', m.kind, line)
  }

  // The AI chat outside the page (VS Code, Claude ...): its words come in over the dev server, its answers go back the same way.
  if (from === 'outside_ai' && m.kind !== 'response' && !failed) {
    bump('outside_ai', 1.05)
    bump('devserver', 1.04)
    bump('router', 1.02)
    bump(to, 1.05)
    last.text(m.from + ' -> ' + m.to + ' ' + m.method.replace('notifications/', '').slice(0, 30))
    travel([['link-outside_ai', true], ['link-devserver', true], ['link-' + to, false]], colors[m.kind] ?? colors.request)
    return
  }
  if (boxOf(m.to) === 'outside_ai') {
    bump(boxOf(m.from), 1.03)
    travel([['link-' + boxOf(m.from), true], ['link-devserver', false], ['link-outside_ai', false]], failed ? colors.error : '#16a34a')
    return
  }

  // Answers are not drawn: the question already lit the way, and the numbers below count both.
  if (m.kind === 'response') return
  bump(to, 1.05)
  if (from !== to) bump(from, 1.03)
  last.text(m.from + ' -> ' + m.to + ' ' + m.method.replace('notifications/', '').slice(0, 30))
  travel([['link-' + to, false]], m.method === 'ping' ? colors.heartbeat : (colors[m.kind] ?? colors.request))
})

// A little heartbeat, so something happens even when nobody does anything.
every('3s', () => mcp.call('status', 'ping'))

// The numbers at the bottom of the drawing.
const label = pic.write(24, 884, '', { fill: '#475569', 'font-size': 20, 'font-family': 'monospace' })
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
