import routerArchitecture from '../../resources/router-architecture-Lattakker-gemini-svg.svg?raw';

/**
 * Drawings that come with the app, for `svg.asset('name')`. Each has ids on its parts, so a cell can find them.
 * The router drawing is the original file in resources/; its parts get their ids when it is loaded (by what they
 * are called in the drawing), so redrawing the file keeps working as long as the boxes keep their names.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const num = (el: Element, name: string): number => Number.parseFloat(el.getAttribute(name) ?? '0') || 0;

/** The name a box in the router drawing goes by: "board : Tab" is board, "other_tabs : Tab [0..*]" is other_tabs, "mcp_router : Router" is router, "outside_ai : Client" is outside_ai ... */
function nodeName(text: string): string | null {
  const t = text.trim();
  const m = /^(\w+) : (Tab|Service|Router|Client|Panel)(?: \[[^\]]*\])?$/.exec(t);
  if (m) return m[1] === 'mcp_router' ? 'router' : m[1];
  if (/^Cell Scripts/.test(t)) return 'cells';
  if (/^WebRTC/.test(t)) return 'webrtc';
  if (/^Dev Server/.test(t)) return 'devserver';
  return null;
}

/** Wraps every box (with its texts and ports) in <g id="node-NAME"> and gives every line <path id="link-NAME">, named after the box it leads to. */
function annotateRouter(markup: string): string {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.localName !== 'svg') return markup;
  const all = [...svg.children];
  const rects = all.filter((e) => e.localName === 'rect' && num(e, 'height') >= 50 && num(e, 'width') >= 150 && num(e, 'stroke-width') >= 1.5);
  const texts = all.filter((e) => e.localName === 'text');
  // The whole drawing has a frame around it: that is not a box. Of two rectangles with the same name (a box and its header strip) the bigger one is the box.
  const vb = (svg.getAttribute('viewBox') ?? '0 0 1200 900').split(/\s+/).map(Number);
  const frameArea = (vb[2] || 1200) * (vb[3] || 900) * 0.4;
  const best = new Map<string, { rect: Element; box: { x: number; y: number; w: number; h: number }; mine: Element[] }>();
  for (const rect of rects) {
    const box = { x: num(rect, 'x'), y: num(rect, 'y'), w: num(rect, 'width'), h: num(rect, 'height') };
    if (box.w * box.h > frameArea) continue;
    const inside = (el: Element, pad = 0): boolean => {
      const x = num(el, 'x') + (el.localName === 'rect' ? num(el, 'width') / 2 : 0);
      const y = num(el, 'y') + (el.localName === 'rect' ? num(el, 'height') / 2 : 0);
      return x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad;
    };
    const mine = texts.filter((t) => inside(t));
    const name = mine.map((t) => nodeName(t.textContent ?? '')).find((n) => n !== null);
    if (!name) continue;
    const known = best.get(name);
    if (!known || box.w * box.h > known.box.w * known.box.h) best.set(name, { rect, box, mine });
  }
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [name, { rect, box, mine }] of best) {
    const g = doc.createElementNS(SVG_NS, 'g');
    g.setAttribute('id', `node-${name}`);
    g.setAttribute('class', 'node');
    g.setAttribute('data-name', name);
    g.setAttribute('data-pivot', `${box.x + box.w / 2} ${box.y + box.h / 2}`);
    rect.before(g);
    // The box, its words, and the small port squares sitting on its edge.
    const ports = all.filter((e) => {
      if (e.localName !== 'rect' || e === rect || num(e, 'width') > 10) return false;
      const x = num(e, 'x') + num(e, 'width') / 2;
      const y = num(e, 'y') + num(e, 'height') / 2;
      return x >= box.x - 10 && x <= box.x + box.w + 10 && y >= box.y - 10 && y <= box.y + box.h + 10;
    });
    g.append(rect, ...mine, ...ports);
    boxes.set(name, box);
  }
  const near = (x: number, y: number, box: { x: number; y: number; w: number; h: number }): boolean => x >= box.x - 12 && x <= box.x + box.w + 12 && y >= box.y - 12 && y <= box.y + box.h + 12;
  for (const path of all.filter((e) => e.localName === 'path' && (e.getAttribute('marker-end') || e.getAttribute('marker-start')))) {
    const pairs = [...(path.getAttribute('d') ?? '').matchAll(/(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    if (pairs.length < 2) continue;
    // A line that carries its own name (link-outside_ai) keeps it; only lines that join a box to the router are named here.
    if (path.getAttribute('id')?.startsWith('link-')) {
      path.setAttribute('class', 'link');
      path.setAttribute('data-name', path.getAttribute('id')!.slice(5));
      continue;
    }
    const ends = [pairs[0], pairs[pairs.length - 1]];
    const target = [...boxes].find(([name, box]) => name !== 'router' && ends.some(([x, y]) => near(x, y, box)));
    if (!target) continue;
    path.setAttribute('id', `link-${target[0]}`);
    path.setAttribute('class', 'link');
    path.setAttribute('data-name', target[0]);
  }
  return new XMLSerializer().serializeToString(svg);
}

const STICKMAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <line id="ground" x1="10" y1="182" x2="190" y2="182" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
  <ellipse id="shadow" cx="100" cy="183" rx="26" ry="4" fill="#0f172a" opacity="0.15"/>
  <g id="man" stroke="#1f2933" stroke-width="5" stroke-linecap="round" fill="none" data-pivot="100 120">
    <g id="legL" data-pivot="100 118"><line x1="100" y1="118" x2="84" y2="178"/></g>
    <g id="legR" data-pivot="100 118"><line x1="100" y1="118" x2="116" y2="178"/></g>
    <line id="body" x1="100" y1="74" x2="100" y2="118"/>
    <g id="armL" data-pivot="100 86"><line x1="100" y1="86" x2="78" y2="112"/></g>
    <g id="armR" data-pivot="100 86"><line x1="100" y1="86" x2="122" y2="112"/></g>
    <circle id="head" cx="100" cy="58" r="16" fill="#fde68a" data-pivot="100 74"/>
    <circle id="eyeL" cx="94" cy="55" r="2" fill="#1f2933" stroke="none"/>
    <circle id="eyeR" cx="106" cy="55" r="2" fill="#1f2933" stroke="none"/>
    <path id="mouth" d="M 93 63 Q 100 70 107 63" stroke-width="2.5"/>
  </g>
  <text id="speech" x="100" y="22" text-anchor="middle" font-family="system-ui, sans-serif" font-size="15" fill="#334155"></text>
</svg>`;


/**
 * A stick figure with a screen in his belly, wired to a control panel: a lever, a dial and a lamp. The part called
 * `screen` is empty on purpose: a cell puts an animated picture in it (clip.show({ scene, into: pic.el('screen') })),
 * and the picture then moves with the man. The wires (wire1 to wire3) are paths that dots can run along.
 */
const L = 'stroke="#1f2933" stroke-width="5" stroke-linecap="round" fill="none"';
const TVMAN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260">
  <line id="ground" x1="10" y1="236" x2="390" y2="236" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
  <ellipse id="shadow" cx="150" cy="237" rx="44" ry="5" fill="#0f172a" opacity="0.15"/>
  <path id="wire1" d="M 196 128 C 240 128 236 196 280 196" stroke="#dc2626" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path id="wire2" d="M 196 112 C 236 112 236 132 280 132" stroke="#2563eb" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path id="wire3" d="M 196 96 C 236 96 236 70 280 70" stroke="#16a34a" stroke-width="3" fill="none" stroke-linecap="round"/>
  <g id="panel">
    <rect x="280" y="44" width="104" height="176" rx="10" fill="#e2e8f0" stroke="#64748b" stroke-width="3"/>
    <circle id="lamp" cx="332" cy="70" r="12" fill="#475569" stroke="#1f2933" stroke-width="2"/>
    <circle id="dialFace" cx="332" cy="132" r="26" fill="#ffffff" stroke="#1f2933" stroke-width="3"/>
    <g id="needle" data-pivot="332 132"><line x1="332" y1="132" x2="332" y2="112" stroke="#dc2626" stroke-width="4" stroke-linecap="round"/></g>
    <circle cx="332" cy="132" r="4" fill="#1f2933"/>
    <rect x="312" y="186" width="40" height="22" rx="6" fill="#cbd5e1" stroke="#1f2933" stroke-width="2"/>
    <g id="lever" data-pivot="332 197" style="cursor:pointer"><line x1="332" y1="197" x2="332" y2="160" stroke="#1f2933" stroke-width="6" stroke-linecap="round"/><circle cx="332" cy="158" r="8" fill="#f59e0b" stroke="#1f2933" stroke-width="2"/></g>
    <text x="332" y="236" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#475569">speed · play</text>
  </g>
  <g id="man" data-pivot="150 150">
    <g id="legL" data-pivot="150 150"><line x1="150" y1="150" x2="126" y2="232" ${L}/></g>
    <g id="legR" data-pivot="150 150"><line x1="150" y1="150" x2="174" y2="232" ${L}/></g>
    <rect id="cabinet" x="104" y="76" width="92" height="76" rx="8" fill="#334155" stroke="#1f2933" stroke-width="4"/>
    <g id="screen"></g>
    <g id="armL" data-pivot="108 88"><line x1="108" y1="88" x2="76" y2="128" ${L}/></g>
    <g id="armR" data-pivot="192 88"><line x1="192" y1="88" x2="224" y2="128" ${L}/></g>
    <g id="head" data-pivot="150 74">
      <circle cx="150" cy="52" r="20" fill="#fde68a" stroke="#1f2933" stroke-width="4"/>
      <path d="M 131 44 Q 150 22 169 44" stroke="#9ca3af" stroke-width="6" fill="none" stroke-linecap="round"/>
      <circle cx="143" cy="52" r="2.5" fill="#1f2933"/><circle cx="157" cy="52" r="2.5" fill="#1f2933"/>
      <path d="M 141 61 Q 150 69 159 61" stroke="#1f2933" stroke-width="3" fill="none" stroke-linecap="round"/>
    </g>
  </g>
  <circle id="pulse1" cx="196" cy="128" r="4.5" fill="#dc2626"/>
  <circle id="pulse2" cx="196" cy="112" r="4.5" fill="#2563eb"/>
  <circle id="pulse3" cx="196" cy="96" r="4.5" fill="#16a34a"/>
  <text id="caption" x="150" y="22" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#334155"></text>
</svg>`;

const ASSETS: Record<string, () => string> = {
  'router-architecture': () => annotateRouter(routerArchitecture),
  stickman: () => STICKMAN,
  tvman: () => TVMAN,
};

/** The names of the drawings that come with the app. */
export function svgAssetNames(): string[] {
  return Object.keys(ASSETS);
}

/** The SVG text of a bundled drawing, with ids on its parts. */
export function svgAsset(name: string): string {
  const make = ASSETS[name];
  if (!make) throw new Error(`There is no drawing called "${name}". Drawings: ${svgAssetNames().join(', ')}.`);
  return make();
}
