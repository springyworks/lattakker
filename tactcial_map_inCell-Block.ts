// TACTICAL MAP with Photoshop-style layers.
// Every layer is its own little <svg> inside the big drawing, so it can be shown, hidden, made
// see-through (alpha) and faded up or down on its own. The panel on the right is the layer list:
//   eye = show / hide (fades) · drag the bar = alpha · ▼ ▲ = slow fade down / up · buttons = presets.
// Drag the unit symbols to move them. Drop a picture file on the map (or press "Load map image")
// to use your own map; the built-in terrain is drawn from code.
span(21, 10)

const MW = 1000, MH = 600, PW = 260
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const gridRef = (x: number, y: number) => 'ABCDEFGHIJ'[clamp(Math.floor(x / 100), 0, 9)] + clamp(Math.floor(y / 100) + 1, 1, 6)

// ---------- the units (NATO-style symbols: blue box = friendly, red diamond = hostile) ----------
type Kind = 'inf' | 'mech' | 'armor' | 'art' | 'recon' | 'hq' | 'ad' | 'eng' | 'sup'
interface Unit { id: string; side: 'blue' | 'red'; kind: Kind; name: string; size: string; x: number; y: number; vis?: number; ring?: number }
const UNITS: Unit[] = [
  { id: 'b-hq', side: 'blue', kind: 'hq', name: 'Bn HQ', size: 'II', x: 140, y: 480, vis: 90 },
  { id: 'b-a', side: 'blue', kind: 'inf', name: 'A Coy', size: 'I', x: 270, y: 380, vis: 100 },
  { id: 'b-b', side: 'blue', kind: 'mech', name: 'B Coy', size: 'I', x: 390, y: 320, vis: 110 },
  { id: 'b-c', side: 'blue', kind: 'armor', name: 'C Coy', size: 'I', x: 310, y: 520, vis: 110 },
  { id: 'b-art', side: 'blue', kind: 'art', name: 'Fires', size: 'I', x: 120, y: 380, vis: 80 },
  { id: 'b-rec', side: 'blue', kind: 'recon', name: 'Scouts', size: '●●●', x: 470, y: 190, vis: 170 },
  { id: 'b-eng', side: 'blue', kind: 'eng', name: 'Engrs', size: '●●●', x: 420, y: 440, vis: 80 },
  { id: 'b-sup', side: 'blue', kind: 'sup', name: 'Supply', size: 'I', x: 200, y: 560, vis: 70 },
  { id: 'r-hq', side: 'red', kind: 'hq', name: 'OPFOR HQ', size: 'II', x: 880, y: 90 },
  { id: 'r-tk', side: 'red', kind: 'armor', name: 'Tank Bn', size: 'II', x: 700, y: 300 },
  { id: 'r-mech', side: 'red', kind: 'mech', name: 'Mech Coy', size: 'I', x: 640, y: 160 },
  { id: 'r-art', side: 'red', kind: 'art', name: 'Guns', size: 'I', x: 800, y: 190, ring: 190 },
  { id: 'r-ad', side: 'red', kind: 'ad', name: 'Air def', size: '●●●', x: 910, y: 330, ring: 110 },
  { id: 'r-rec', side: 'red', kind: 'recon', name: 'Recon', size: '●●●', x: 560, y: 110 },
  { id: 'r-inf', side: 'red', kind: 'inf', name: 'Inf Coy', size: 'I', x: 720, y: 420 },
]
const savedPos: Record<string, [number, number]> = memory.pos ?? {}
const homePos: Record<string, [number, number]> = {}
for (const u of UNITS) {
  homePos[u.id] = [u.x, u.y]
  const p = savedPos[u.id]
  if (p) { u.x = p[0]; u.y = p[1] }
}

const K = 'fill="none" stroke="#111" stroke-width="2"'
const TXT = 'font-family="system-ui, sans-serif"'
const HL = `paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round" ${TXT}`
function icon(kind: Kind): string {
  switch (kind) {
    case 'inf': return `<path d="M-20 -14 L20 14 M-20 14 L20 -14" ${K}/>`
    case 'mech': return `<path d="M-20 -14 L20 14 M-20 14 L20 -14" ${K}/><ellipse rx="11" ry="6.5" ${K}/>`
    case 'armor': return `<ellipse rx="12" ry="7" ${K}/>`
    case 'art': return `<circle r="4.5" fill="#111"/>`
    case 'recon': return `<path d="M-20 14 L20 -14" ${K}/>`
    case 'hq': return `<path d="M-20 14 V36" ${K}/>`
    case 'ad': return `<path d="M-14 8 A14 14 0 0 1 14 8" ${K}/>`
    case 'eng': return `<text y="5.5" text-anchor="middle" font-size="16" font-weight="700" fill="#111" ${TXT}>E</text>`
    case 'sup': return `<text y="5.5" text-anchor="middle" font-size="16" font-weight="700" fill="#111" ${TXT}>S</text>`
  }
}
function unitSvg(u: Unit): string {
  const blue = u.side === 'blue'
  const frame = blue
    ? `<rect x="-20" y="-14" width="40" height="28" fill="#80e0ff" stroke="#111" stroke-width="2.5"/>`
    : `<path d="M0 -24 L26 0 L0 24 L-26 0 Z" fill="#ff8080" stroke="#111" stroke-width="2.5"/>`
  const mark = u.size ? `<text y="${blue ? -18 : -28}" text-anchor="middle" font-size="11" font-weight="700" fill="#111" ${TXT}>${u.size}</text>` : ''
  const label = `<text x="${blue ? 27 : 33}" y="4" font-size="12" font-weight="700" fill="#0b1220" ${HL}>${u.name}</text>`
  return `<g id="unit-${u.id}" transform="translate(${u.x} ${u.y})" style="cursor:grab"><rect x="-28" y="-28" width="56" height="56" fill="transparent"/>${frame}<g transform="scale(${blue ? 1 : 0.75})">${icon(u.kind)}</g>${mark}${label}</g>`
}

// ---------- terrain helpers ----------
function blob(cx: number, cy: number, r: number, seed: number): string {
  const R = rng(seed), n = 12, pts: number[][] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = r * (0.8 + R() * 0.4)
    pts.push([cx + Math.cos(a) * rr * 1.25, cy + Math.sin(a) * rr])
  }
  const mid = (p: number[], q: number[]) => `${((p[0] + q[0]) / 2).toFixed(1)} ${((p[1] + q[1]) / 2).toFixed(1)}`
  let d = `M ${mid(pts[n - 1], pts[0])}`
  for (let i = 0; i < n; i++) d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mid(pts[i], pts[(i + 1) % n])}`
  return d + ' Z'
}
const HILLS: [number, number, number, number, number][] = [[210, 150, 85, 5, 412], [830, 110, 70, 9, 380], [860, 480, 80, 13, 351]]

// ---------- the layers, bottom to top ----------
const R1 = rng(21)
let forest = ''
for (const [fx, fy] of [[120, 250], [560, 480], [650, 60], [300, 250], [900, 400], [470, 560]]) {
  for (let i = 0; i < 14; i++) forest += `<circle cx="${(fx + (R1() - 0.5) * 110).toFixed(0)}" cy="${(fy + (R1() - 0.5) * 70).toFixed(0)}" r="${(7 + R1() * 7).toFixed(0)}" fill="#2f5d34" opacity=".6"/>`
}
const L_MAP = `<defs><filter id="tt-ground" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.008 0.011" numOctaves="5" seed="11"/><feColorMatrix type="matrix" values="1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1"/><feComponentTransfer><feFuncR type="table" tableValues=".73 .62 .50 .31"/><feFuncG type="table" tableValues=".64 .72 .62 .48"/><feFuncB type="table" tableValues=".42 .35 .31 .25"/></feComponentTransfer></filter></defs>
<g id="gen"><rect width="${MW}" height="${MH}" fill="#9bb36b" filter="url(#tt-ground)"/>${forest}</g>
<image id="photo" display="none" x="0" y="0" width="${MW}" height="${MH}" preserveAspectRatio="xMidYMid slice"/>`

let contours = ''
const hillShade = HILLS.map(([cx, cy, r], i) => `<radialGradient id="hs${i}"><stop offset="0" stop-color="#3b2a14" stop-opacity=".45"/><stop offset="1" stop-color="#3b2a14" stop-opacity="0"/></radialGradient><ellipse cx="${cx}" cy="${cy}" rx="${r * 1.5}" ry="${r * 1.2}" fill="url(#hs${i})"/>`).join('')
for (const [cx, cy, r, seed, h] of HILLS) {
  for (let k = 0; k < 5; k++) contours += `<path d="${blob(cx, cy, r * (1 - k * 0.19), seed)}" fill="none" stroke="#7a4a1d" stroke-width="${k % 2 === 0 ? 1.8 : 1}" opacity=".8"/>`
  contours += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" fill="#5b3510" ${TXT}>${h} m</text>`
}
const L_RELIEF = hillShade + contours

const RIVER = 'M 430 0 C 400 90, 520 150, 480 250 S 380 380, 520 470 S 600 560, 570 600'
const L_WATER = `<ellipse cx="880" cy="545" rx="60" ry="26" fill="#7cc0f0" stroke="#3b82c4" stroke-width="2"/>
<path d="${RIVER}" fill="none" stroke="#3b82c4" stroke-width="18" stroke-linecap="round"/><path d="${RIVER}" fill="none" stroke="#7cc0f0" stroke-width="12" stroke-linecap="round"/>
<g fill="none" stroke-linecap="round"><path d="M 120 360 C 250 330, 380 300, 480 255 S 640 220, 745 228" stroke="#6b4f2a" stroke-width="7"/><path d="M 745 228 C 770 330, 700 420, 640 470 S 560 480, 520 470 C 450 500, 400 520, 320 505" stroke="#6b4f2a" stroke-width="7"/>
<path d="M 120 360 C 250 330, 380 300, 480 255 S 640 220, 745 228" stroke="#f3d9a0" stroke-width="4.5"/><path d="M 745 228 C 770 330, 700 420, 640 470 S 560 480, 520 470 C 450 500, 400 520, 320 505" stroke="#f3d9a0" stroke-width="4.5"/></g>
<rect x="468" y="246" width="26" height="18" transform="rotate(-25 481 255)" fill="#fff" stroke="#333" stroke-width="2"/><rect x="508" y="461" width="26" height="18" transform="rotate(10 521 470)" fill="#fff" stroke="#333" stroke-width="2"/>
${[['Alder', 130, 362], ['Brook', 748, 226], ['Crest', 322, 506]].map(([n, x, y]) => `<g transform="translate(${x} ${y})"><rect x="-14" y="-8" width="10" height="9" fill="#9ca3af" stroke="#374151"/><rect x="-2" y="-12" width="12" height="12" fill="#9ca3af" stroke="#374151"/><rect x="-8" y="3" width="10" height="8" fill="#9ca3af" stroke="#374151"/><text x="14" y="16" font-size="12" font-weight="700" fill="#1f2937" ${HL}>${n}</text></g>`).join('')}`

let gl = ''
for (let i = 0; i <= 10; i++) gl += `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="${MH}" stroke="#111" stroke-width="1" opacity=".55"/>`
for (let j = 0; j <= 6; j++) gl += `<line x1="0" y1="${j * 100}" x2="${MW}" y2="${j * 100}" stroke="#111" stroke-width="1" opacity=".55"/>`
for (let i = 0; i < 10; i++) gl += `<text x="${i * 100 + 50}" y="15" text-anchor="middle" font-size="13" font-weight="700" fill="#111" ${HL}>${'ABCDEFGHIJ'[i]}</text>`
for (let j = 0; j < 6; j++) gl += `<text x="8" y="${j * 100 + 56}" font-size="13" font-weight="700" fill="#111" ${HL}>${j + 1}</text>`
const L_GRID = gl + `<g transform="translate(24 574)"><rect width="100" height="6" fill="#111"/><rect x="100" width="100" height="6" fill="#fff" stroke="#111"/><text y="-4" font-size="10" fill="#111" ${HL}>0</text><text x="100" y="-4" font-size="10" fill="#111" ${HL}>1</text><text x="200" y="-4" font-size="10" fill="#111" ${HL}>2 km</text></g>
<g transform="translate(960 56)"><path d="M0 -26 L8 4 L0 0 L-8 4 Z" fill="#111"/><text y="18" text-anchor="middle" font-size="13" font-weight="700" fill="#111" ${HL}>N</text></g>`

const L_ZONES = `<defs><pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" stroke="#dc2626" stroke-width="3" opacity=".75"/></pattern></defs>
${UNITS.filter((u) => u.ring).map((u) => `<g id="ring-${u.id}" transform="translate(${u.x} ${u.y})"><circle r="${u.ring}" fill="#ef4444" fill-opacity=".13" stroke="#dc2626" stroke-width="2.5" stroke-dasharray="10 6"/><text y="${-(u.ring ?? 0) + 16}" text-anchor="middle" font-size="11" font-weight="700" fill="#991b1b" ${HL}>${u.kind === 'ad' ? 'AIR DEFENCE' : 'ENEMY FIRES'}</text></g>`).join('')}
<polygon points="905,395 985,380 985,455 930,470" fill="url(#hatch)" stroke="#dc2626" stroke-width="2" stroke-dasharray="6 4"/><text x="945" y="428" text-anchor="middle" font-size="11" font-weight="700" fill="#7f1d1d" ${HL}>NO-GO</text>
<path d="M 330 0 V 600" stroke="#1d4ed8" stroke-width="3" stroke-dasharray="14 6 3 6"/><text x="338" y="590" font-size="11" font-weight="700" fill="#1e3a8a" ${HL}>BDRY 1 / 2 BN</text>
<g transform="translate(250 440)"><circle r="34" fill="#22c55e" fill-opacity=".2" stroke="#15803d" stroke-width="2.5" stroke-dasharray="7 4"/><text y="7" text-anchor="middle" font-size="20" font-weight="700" fill="#14532d" ${TXT}>H</text><text y="52" text-anchor="middle" font-size="11" font-weight="700" fill="#14532d" ${HL}>LZ FALCON</text></g>`

const L_ROUTES = `<defs><marker id="ah-b" markerUnits="userSpaceOnUse" markerWidth="30" markerHeight="30" refX="20" refY="15" orient="auto"><path d="M2 3 L26 15 L2 27 Z" fill="#1d4ed8"/></marker><marker id="ah-r" markerUnits="userSpaceOnUse" markerWidth="30" markerHeight="30" refX="20" refY="15" orient="auto"><path d="M2 3 L26 15 L2 27 Z" fill="#dc2626"/></marker></defs>
<path d="M 200 440 C 320 380, 450 330, 560 305" fill="none" stroke="#1d4ed8" stroke-width="9" stroke-linecap="round" opacity=".85" marker-end="url(#ah-b)"/>
<path d="M 330 540 C 470 540, 560 450, 610 335" fill="none" stroke="#1d4ed8" stroke-width="5" stroke-dasharray="12 8" opacity=".8" marker-end="url(#ah-b)"/>
<path d="M 900 210 C 840 260, 760 300, 650 310" fill="none" stroke="#dc2626" stroke-width="7" stroke-dasharray="14 8" opacity=".85" marker-end="url(#ah-r)"/>
<path d="M 0 400 H 1000" stroke="#111" stroke-width="2" stroke-dasharray="3 7"/><text x="990" y="394" text-anchor="end" font-size="11" font-weight="700" fill="#111" ${HL}>PL AMBER</text>
<path d="M 620 0 V 600" stroke="#111" stroke-width="2" stroke-dasharray="3 7"/><text x="628" y="578" font-size="11" font-weight="700" fill="#111" ${HL}>PL BRAVO</text>
<text x="330" y="404" font-size="11" font-weight="700" fill="#1e3a8a" ${HL} transform="rotate(-27 330 404)">MAIN AXIS</text>`

const L_BLUE = UNITS.filter((u) => u.side === 'blue').map(unitSvg).join('')
const L_RED = UNITS.filter((u) => u.side === 'red').map(unitSvg).join('')

const L_MARKS = `<g transform="translate(580 305)"><circle r="30" fill="none" stroke="#b91c1c" stroke-width="3"/><path d="M0 -14 L4 -4 L14 -4 L6 3 L9 13 L0 7 L-9 13 L-6 3 L-14 -4 L-4 -4 Z" fill="#facc15" stroke="#111" stroke-width="1.5"/><text y="48" text-anchor="middle" font-size="13" font-weight="800" fill="#7f1d1d" ${HL}>OBJ GOLD</text></g>
<g transform="translate(481 255)"><path d="M0 0 V-30" stroke="#111" stroke-width="2"/><path d="M0 -30 L20 -24 L0 -18 Z" fill="#2563eb" stroke="#111"/><text x="6" y="14" font-size="11" font-weight="700" fill="#111" ${HL}>CP 1</text></g>
<g transform="translate(640 385)"><path d="M-36 0 H36" stroke="#111" stroke-width="2.5" stroke-dasharray="4 3"/><circle cx="-36" r="7" fill="#fff" stroke="#111" stroke-width="2"/><circle cx="36" r="7" fill="#fff" stroke="#111" stroke-width="2"/><text y="-6" text-anchor="middle" font-size="12" font-weight="800" fill="#111" ${HL}>M</text><text y="18" text-anchor="middle" font-size="10" font-weight="700" fill="#7f1d1d" ${HL}>MINES</text></g>
<g transform="translate(520 360)"><path d="M0 -14 L14 12 H-14 Z" fill="#facc15" stroke="#111" stroke-width="2"/><text y="9" text-anchor="middle" font-size="14" font-weight="800" fill="#111" ${TXT}>!</text><text x="18" y="8" font-size="10" font-weight="700" fill="#111" ${HL}>IED</text></g>
<g transform="translate(215 150)"><circle r="12" fill="#fff" stroke="#111" stroke-width="2"/><ellipse rx="7" ry="4" fill="none" stroke="#111" stroke-width="1.6"/><circle r="2" fill="#111"/><text x="16" y="4" font-size="11" font-weight="700" fill="#111" ${HL}>OP 1</text></g>
<g transform="translate(590 562)"><rect width="270" height="30" rx="4" fill="#0f172a" fill-opacity=".85"/><text x="10" y="13" font-size="11" font-weight="800" fill="#fff" ${TXT}>OPERATION IRON ORCHARD · 1:50 000</text><text x="10" y="25" font-size="10" fill="#94a3b8" ${TXT}>H-hour 0530 · weather: overcast, light wind</text></g>`

const visCircles = UNITS.filter((u) => u.side === 'blue').map((u) => `<g id="vis-${u.id}" transform="translate(${u.x} ${u.y})"><circle r="${u.vis ?? 90}" fill="#000"/></g>`).join('')
const L_FOG = `<defs><filter id="fogblur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="16"/></filter><mask id="fogmask" maskUnits="userSpaceOnUse" x="0" y="0" width="${MW}" height="${MH}"><rect width="${MW}" height="${MH}" fill="#fff"/><g filter="url(#fogblur)">${visCircles}</g></mask></defs><rect width="${MW}" height="${MH}" fill="#0a1224" mask="url(#fogmask)"/>`

interface LayerDef { id: string; name: string; markup: string; shown: boolean; a: number }
const LAYERS: LayerDef[] = [
  { id: 'map', name: 'Map image', markup: L_MAP, shown: true, a: 1 },
  { id: 'relief', name: 'Elevation', markup: L_RELIEF, shown: true, a: 0.6 },
  { id: 'water', name: 'Water and roads', markup: L_WATER, shown: true, a: 1 },
  { id: 'grid', name: 'Grid reference', markup: L_GRID, shown: true, a: 0.6 },
  { id: 'zones', name: 'Zones and ranges', markup: L_ZONES, shown: true, a: 0.8 },
  { id: 'routes', name: 'Routes and lines', markup: L_ROUTES, shown: true, a: 1 },
  { id: 'blue', name: 'Friendly units', markup: L_BLUE, shown: true, a: 1 },
  { id: 'red', name: 'Hostile units', markup: L_RED, shown: true, a: 1 },
  { id: 'marks', name: 'Objectives, hazards', markup: L_MARKS, shown: true, a: 1 },
  { id: 'fog', name: 'Fog of war', markup: L_FOG, shown: false, a: 0.7 },
]
const INTERACTIVE = new Set(['blue', 'red'])
const layerSvg = (l: LayerDef) => `<svg id="layer-${l.id}" x="0" y="0" width="${MW}" height="${MH}" viewBox="0 0 ${MW} ${MH}"${INTERACTIVE.has(l.id) ? '' : ' pointer-events="none"'}>${l.markup}</svg>`

// ---------- the layer panel (top layer first, like Photoshop) ----------
const TX0 = MW + 46, TW = 120, ROW = 38
const PRESETS: [string, Record<string, number>][] = [
  ['Everything', Object.fromEntries(LAYERS.filter((l) => l.id !== 'fog').map((l) => [l.id, l.a]))],
  ['Commander', { map: 1, grid: 0.45, routes: 1, blue: 1, red: 1, marks: 1 }],
  ['Intel', { map: 0.7, relief: 0.7, water: 1, blue: 1, red: 1, marks: 1, fog: 0.75 }],
  ['Fires', { map: 0.5, grid: 0.9, zones: 1, blue: 1, red: 1 }],
  ['Map only', { map: 1 }],
]
const panelRows = [...LAYERS].reverse().map((l, i) => {
  const y = 40 + i * ROW, X = MW
  return `<g id="row-${l.id}"><rect x="${X + 8}" y="${y}" width="${PW - 16}" height="${ROW - 4}" rx="6" fill="#1e293b"/>
<circle id="eye-${l.id}" cx="${X + 27}" cy="${y + 15}" r="12" fill="#0f172a" stroke="#475569" style="cursor:pointer"/><ellipse cx="${X + 27}" cy="${y + 15}" rx="7" ry="4" fill="none" stroke="#e2e8f0" stroke-width="1.6" pointer-events="none"/><circle cx="${X + 27}" cy="${y + 15}" r="2" fill="#e2e8f0" pointer-events="none"/><path id="eyeoff-${l.id}" d="M${X + 20} ${y + 22} L${X + 34} ${y + 8}" stroke="#f87171" stroke-width="2.2" pointer-events="none"/>
<text x="${X + 46}" y="${y + 13}" font-size="12" fill="#e2e8f0" pointer-events="none" ${TXT}>${l.name}</text>
<rect x="${TX0}" y="${y + 21}" width="${TW}" height="5" rx="2.5" fill="#334155" pointer-events="none"/><rect id="bar-${l.id}" x="${TX0}" y="${y + 21}" width="${TW}" height="5" rx="2.5" fill="#38bdf8" pointer-events="none"/><circle id="knob-${l.id}" cx="${TX0 + TW}" cy="${y + 23.5}" r="6" fill="#f8fafc" stroke="#0f172a" pointer-events="none"/>
<rect id="hit-${l.id}" x="${TX0 - 6}" y="${y + 16}" width="${TW + 12}" height="16" fill="transparent" style="cursor:ew-resize;touch-action:none"/>
<text id="pct-${l.id}" x="${TX0 + TW + 12}" y="${y + 27}" font-size="10" fill="#94a3b8" pointer-events="none" ${TXT}>100%</text>
<g id="dn-${l.id}"><rect x="${X + 206}" y="${y + 6}" width="20" height="22" rx="4" fill="#334155"/><text x="${X + 216}" y="${y + 21}" text-anchor="middle" font-size="11" fill="#e2e8f0" pointer-events="none" ${TXT}>▼</text></g>
<g id="up-${l.id}"><rect x="${X + 229}" y="${y + 6}" width="20" height="22" rx="4" fill="#334155"/><text x="${X + 239}" y="${y + 21}" text-anchor="middle" font-size="11" fill="#e2e8f0" pointer-events="none" ${TXT}>▲</text></g></g>`
}).join('')
const presetY = 40 + LAYERS.length * ROW + 6
const presetBtns = PRESETS.map(([name], i) => {
  const x = MW + 8 + (i % 2) * 126, y = presetY + Math.floor(i / 2) * 30
  return `<g id="pre-${i}"><rect x="${x}" y="${y}" width="118" height="24" rx="5" fill="#0369a1"/><text x="${x + 59}" y="${y + 16}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" pointer-events="none" ${TXT}>${name}</text></g>`
}).join('')
const panel = `<rect x="${MW}" y="0" width="${PW}" height="${MH}" fill="#0f172a"/><text x="${MW + 14}" y="26" font-size="14" font-weight="800" fill="#f8fafc" letter-spacing="2" ${TXT}>LAYERS</text>${panelRows}${presetBtns}
<text x="${MW + 14}" y="${presetY + 100}" font-size="10" fill="#94a3b8" ${TXT}>👁 show/hide (fades) · bar = alpha</text><text x="${MW + 14}" y="${presetY + 114}" font-size="10" fill="#94a3b8" ${TXT}>▼ ▲ slow fade down / up · drag units</text>
<text id="status" x="${MW + 14}" y="${presetY + 136}" font-size="11" font-weight="700" fill="#fbbf24" ${TXT}>Drop a picture on the map</text>`

// ---------- build the drawing ----------
const pic = svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MW + PW} ${MH}"><rect width="${MW + PW}" height="${MH}" fill="#0b1220"/>${LAYERS.map(layerSvg).join('')}${panel}</svg>`)
const els: Record<string, SvgEl> = {}
const E = (id: string): SvgEl => (els[id] ??= pic.el('#' + id))
const toSvg = (e: PointerEvent): [number, number] => {
  const m = pic.svg.getScreenCTM()
  if (!m) return [0, 0]
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
  return [p.x, p.y]
}

// ---------- layer state: shown (eye), a (alpha), f (fade of the eye); aTo / fTo are where they are heading ----------
interface LayerState { shown: boolean; a: number; aTo: number; f: number; fTo: number; ra: number; rf: number }
const saved: Record<string, { shown: boolean; a: number }> = memory.layers ?? {}
const S: Record<string, LayerState> = {}
for (const l of LAYERS) {
  const s = saved[l.id] ?? { shown: l.shown, a: l.a }
  S[l.id] = { shown: s.shown, a: s.a, aTo: s.a, f: s.shown ? 1 : 0, fTo: s.shown ? 1 : 0, ra: 1, rf: 1 }
}
const saveLayers = () => {
  memory.layers = Object.fromEntries(LAYERS.map((l) => [l.id, { shown: S[l.id].shown, a: S[l.id].aTo }]))
}
const approach = (v: number, to: number, d: number) => (v < to ? Math.min(to, v + d) : Math.max(to, v - d))

function paint(l: LayerDef): void {
  const s = S[l.id]
  const vis = s.a * s.f
  const node = E('layer-' + l.id)
  node.opacity(vis)
  if (vis <= 0.002) node.hide(); else node.show()
  E('bar-' + l.id).attr('width', TW * s.a)
  E('knob-' + l.id).attr('cx', TX0 + TW * s.a)
  E('pct-' + l.id).text(Math.round(s.a * 100) + '%')
  E('eyeoff-' + l.id).attr('display', s.shown ? 'none' : 'inline')
  E('row-' + l.id).opacity(s.shown ? 1 : 0.5)
}
const setShown = (id: string, shown: boolean, secs = 0.5) => {
  const s = S[id]
  s.shown = shown
  s.fTo = shown ? 1 : 0
  s.rf = 1 / secs
  if (shown && s.aTo <= 0.001) { s.aTo = 1; s.ra = 1 / secs }
  saveLayers()
}
const fadeTo = (id: string, a: number, secs: number) => {
  const s = S[id]
  if (a > 0 && !s.shown) setShown(id, true, secs)
  s.aTo = a
  s.ra = 1 / secs
  saveLayers()
}
const status = (words: string) => E('status').text(words)

pic.frame((_t, dt) => {
  for (const l of LAYERS) {
    const s = S[l.id]
    if (s.a === s.aTo && s.f === s.fTo) continue
    s.a = approach(s.a, s.aTo, s.ra * dt)
    s.f = approach(s.f, s.fTo, s.rf * dt)
    paint(l)
  }
})
for (const l of LAYERS) paint(l)

// ---------- panel controls ----------
const SPAN_X0 = TX0
for (const l of LAYERS) {
  const s = S[l.id]
  E('eye-' + l.id).on('click', () => setShown(l.id, !s.shown))
  E('dn-' + l.id).on('click', () => fadeTo(l.id, 0, 2))
  E('up-' + l.id).on('click', () => fadeTo(l.id, 1, 2))
  const hit = E('hit-' + l.id)
  let down = false
  const slide = (e: Event) => {
    const a = clamp((toSvg(e as PointerEvent)[0] - SPAN_X0) / TW, 0, 1)
    s.a = s.aTo = a
    paint(l)
    status(`${l.name}: alpha ${Math.round(a * 100)}%`)
  }
  hit.on('pointerdown', (e) => { const p = e as PointerEvent; p.stopPropagation(); hit.node.setPointerCapture(p.pointerId); down = true; slide(e) })
  hit.on('pointermove', (e) => { if (down) slide(e) })
  hit.on('pointerup', () => { if (down) { down = false; saveLayers() } })
  hit.node.style.cursor = 'ew-resize'
}
PRESETS.forEach(([name, wanted], i) => {
  E('pre-' + i).on('click', () => {
    for (const l of LAYERS) {
      const a = wanted[l.id]
      if (a === undefined) setShown(l.id, false, 0.8)
      else { S[l.id].shown = true; S[l.id].fTo = 1; S[l.id].rf = 1 / 0.8; fadeTo(l.id, a, 0.8) }
    }
    saveLayers()
    status('Preset: ' + name)
  })
})

// ---------- units: drag to move (the fire ring and the field of view follow) ----------
function place(u: Unit): void {
  const t = `translate(${u.x} ${u.y})`
  for (const id of ['unit-', 'ring-', 'vis-']) pic.svg.querySelector('#' + id + u.id)?.setAttribute('transform', t)
}
for (const u of UNITS) {
  const g = E('unit-' + u.id)
  let grab: [number, number] | null = null
  g.on('pointerdown', (e) => {
    const ev = e as PointerEvent
    ev.stopPropagation()
    g.node.setPointerCapture(ev.pointerId)
    const p = toSvg(ev)
    grab = [p[0] - u.x, p[1] - u.y]
    g.node.style.cursor = 'grabbing'
  })
  g.on('pointermove', (e) => {
    if (!grab) return
    const p = toSvg(e as PointerEvent)
    u.x = Math.round(clamp(p[0] - grab[0], 24, MW - 24))
    u.y = Math.round(clamp(p[1] - grab[1], 30, MH - 24))
    place(u)
    status(`${u.name} at grid ${gridRef(u.x, u.y)}`)
  })
  g.on('pointerup', () => {
    if (!grab) return
    grab = null
    g.node.style.cursor = 'grab'
    memory.pos = Object.fromEntries(UNITS.map((v) => [v.id, [v.x, v.y]]))
  })
  g.node.style.cursor = 'grab'
  g.node.style.touchAction = 'none'
}

// ---------- your own map picture ----------
async function toDataUrl(file: Blob): Promise<string> {
  if (file.type === 'image/svg+xml') {
    return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(file) })
  }
  const bmp = await createImageBitmap(file)
  let url = ''
  for (const max of [1600, 1200, 800]) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k)
    c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    url = c.toDataURL('image/jpeg', 0.82)
    if (url.length < 1_200_000) break
  }
  return url
}
function usePhoto(url: string | null): void {
  if (url) E('photo').attr('href', url).show(); else E('photo').hide()
  if (url) E('gen').hide(); else E('gen').show()
}
usePhoto(memory.image ?? null)
async function takeFile(file: File | undefined) {
  if (!file || !file.type.startsWith('image/')) { status('That is not a picture file'); return }
  const url = await toDataUrl(file)
  usePhoto(url)
  try { memory.image = url } catch { status('Map shown (too big to keep)') }
  status('Map image: ' + file.name)
}
pic.svg.addEventListener('dragover', (e) => e.preventDefault())
pic.svg.addEventListener('drop', (e) => { e.preventDefault(); takeFile(e.dataTransfer?.files?.[0]) })

input.button('📂 Load map image…', () => {
  const pick = document.createElement('input')
  pick.type = 'file'
  pick.accept = 'image/*'
  pick.onchange = () => takeFile(pick.files?.[0])
  pick.click()
})
input.button('🗺 Built-in terrain', () => { usePhoto(null); memory.image = null; status('Built-in terrain') })
input.button('↺ Reset units and layers', () => {
  for (const u of UNITS) { u.x = homePos[u.id][0]; u.y = homePos[u.id][1]; place(u) }
  memory.pos = {}
  for (const l of LAYERS) { const s = S[l.id]; s.shown = l.shown; s.fTo = l.shown ? 1 : 0; s.rf = 2; s.aTo = l.a; s.ra = 2 }
  saveLayers()
  status('Reset')
})