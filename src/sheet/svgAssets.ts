import routerArchitecture from '../../resources/router-architecture-Lattakker-gemini-svg.svg?raw';

/**
 * Drawings that come with the app, for `svg.asset('name')`. Each has ids on its parts, so a cell can find them.
 * The router drawing is the original file in resources/; its parts get their ids when it is loaded (by what they
 * are called in the drawing), so redrawing the file keeps working as long as the boxes keep their names.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const num = (el: Element, name: string): number => Number.parseFloat(el.getAttribute(name) ?? '0') || 0;

/** The name a box in the router drawing goes by: "board : Tab" is board, "mcp_router : Router" is router ... */
function nodeName(text: string): string | null {
  const t = text.trim();
  const m = /^(\w+) : (Tab|Service|Router)$/.exec(t);
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

const ASSETS: Record<string, () => string> = {
  'router-architecture': () => annotateRouter(routerArchitecture),
  stickman: () => STICKMAN,
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
