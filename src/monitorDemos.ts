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
span(12, 9)

// svg.asset('router-architecture') is the drawing from resources/. Its boxes are called node-board,
// node-lab, node-weather ... and their lines link-board, link-lab ...
const pic = svg(svg.asset('router-architecture'))
const nodes = pic.ids.filter((id) => id.startsWith('node-')).map((id) => id.slice(5))

// Which box of the drawing belongs to who is talking: a cell ('lab:A3') is "cells", the AI helper is "helper".
function boxOf(name: string): string {
  const first = name.split(':')[0]
  if (nodes.includes(first)) return first
  if (first.startsWith('ai') || first === 'local-ai') return 'helper'
  return 'cells'
}

const busy: Record<string, number> = {}
let dots = 0

// mcp.tap(fn) runs for every message that crosses the router, as it happens.
mcp.tap((m) => {
  if (m.kind === 'response') return
  const to = boxOf(m.to)
  const now = performance.now()
  if (now - (busy[to] ?? 0) < 90) return // a busy box does not flicker
  busy[to] = now

  // The box grows a little and shrinks back.
  if (nodes.includes(to)) pic.el('node-' + to).animate({ scale: 1.05 }, { time: 110, yoyo: true, loop: 2 })

  // A dot runs along the line to that box.
  if (pic.ids.includes('link-' + to) && dots < 30) {
    dots++
    const dot = pic.add('circle', { r: 8, fill: '#f97316', stroke: '#ffffff', 'stroke-width': 2 })
    dot.animate({ along: '#link-' + to }, { time: 550 }).then(() => {
      dot.remove()
      dots--
    })
  }
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
