/** XY plots for cells: turns what plot(...) was given into numbers, and the numbers into an SVG that fits the cell. */
export interface PlotSeries {
  name: string;
  points: Array<[number, number]>;
  color: string;
  dots: boolean;
}

export interface PlotSpec {
  title: string;
  xLabel: string;
  yLabel: string;
  series: PlotSeries[];
  /** Fixed edges of the picture; an edge left out follows the data. */
  bounds: { xMin?: number; xMax?: number; yMin?: number; yMax?: number };
  /** False draws only the lines (no numbers, grid or legend). */
  axes: boolean;
}

export interface PlotOptions {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  /** For a function: the first and last x (default -10 and 10). */
  from?: number;
  to?: number;
  /** For a function: how many points (default 200). */
  steps?: number;
  /** Draw a dot at every point. */
  dots?: boolean;
  color?: string;
  /** Fix the edges of the picture, so an animation does not jump around. */
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** false: no numbers, grid or legend, just the lines. */
  axes?: boolean;
}

const PALETTE = ['#3b6ea5', '#c4553b', '#3f8f5a', '#a66cc4', '#d19a2a', '#2f9aa8'];
const MAX_POINTS = 5000;

type Source = unknown;

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function pointsOf(source: Source, options: PlotOptions): Array<[number, number]> {
  let raw: Array<[unknown, unknown]>;
  if (typeof source === 'function') {
    const from = options.from ?? -10;
    const to = options.to ?? 10;
    const steps = Math.max(2, Math.min(MAX_POINTS, Math.floor(options.steps ?? 200)));
    raw = [];
    for (let i = 0; i <= steps; i++) {
      const x = from + ((to - from) * i) / steps;
      raw.push([x, (source as (x: number) => unknown)(x)]);
    }
  } else if (Array.isArray(source)) {
    raw = source.map((item, i): [unknown, unknown] => {
      if (Array.isArray(item)) return [item[0], item[1]];
      if (item && typeof item === 'object' && 'x' in item && 'y' in item) return [(item as { x: unknown }).x, (item as { y: unknown }).y];
      return [i, item];
    });
  } else {
    throw new Error('plot needs a list of numbers, a list of [x, y] pairs, or a function like Math.sin');
  }
  const points: Array<[number, number]> = [];
  for (const [x, y] of raw.slice(0, MAX_POINTS)) {
    const px = toNumber(x);
    const py = toNumber(y);
    if (Number.isFinite(px) && Number.isFinite(py)) points.push([px, py]);
  }
  return points;
}

/** Turns the arguments of plot(...) into a spec. One series, or an object of named series: plot({ sin: Math.sin, cos: Math.cos }). */
export function makePlot(source: Source, options: PlotOptions = {}): PlotSpec {
  const named: Array<[string, Source]> =
    source !== null && typeof source === 'object' && !Array.isArray(source) && !('x' in source && 'y' in source)
      ? Object.entries(source as Record<string, Source>)
      : [['', source]];
  if (named.length === 0) throw new Error('plot has nothing to draw');
  const series = named.map(([name, src], i): PlotSeries => ({
    name,
    points: pointsOf(src, options),
    color: (named.length === 1 && options.color) || PALETTE[i % PALETTE.length],
    dots: options.dots ?? false,
  }));
  if (series.every((s) => s.points.length === 0)) throw new Error('plot found no numbers to draw');
  const edge = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    title: options.title ?? '',
    xLabel: options.xLabel ?? '',
    yLabel: options.yLabel ?? '',
    series,
    bounds: { xMin: edge(options.xMin), xMax: edge(options.xMax), yMin: edge(options.yMin), yMax: edge(options.yMax) },
    axes: options.axes !== false,
  };
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** About `count` round numbers (1, 2, 5, 10, ...) covering min..max. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / pow;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
  const ticks: number[] = [];
  for (let i = Math.ceil(min / step); i * step <= max + step * 1e-9; i++) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

function label(v: number): string {
  return String(Number(v.toPrecision(4)));
}

/** The plot as an SVG that is `width` x `height` in its own units; the caller scales it to the cell. */
export function plotSvg(spec: PlotSpec, width: number, height: number): string {
  const w = Math.max(20, width);
  const h = Math.max(20, height);
  const roomy = spec.axes && h >= 80 && w >= 120;
  const fs = Math.max(8, Math.min(12, h / 12));
  const left = roomy ? fs * 3.6 : 4;
  const right = roomy ? 8 : 4;
  const top = (spec.title && roomy ? fs * 2 : 0) + 6;
  const bottom = roomy ? fs * 2.6 : 4;
  const pw = Math.max(10, w - left - right);
  const ph = Math.max(10, h - top - bottom);

  const all = spec.series.flatMap((s) => s.points);
  const b = spec.bounds;
  let xmin = b.xMin ?? Math.min(...all.map((p) => p[0]));
  let xmax = b.xMax ?? Math.max(...all.map((p) => p[0]));
  let ymin = b.yMin ?? Math.min(...all.map((p) => p[1]));
  let ymax = b.yMax ?? Math.max(...all.map((p) => p[1]));
  const xt = niceTicks(xmin, xmax, Math.max(2, Math.floor(pw / 60)));
  const yt = niceTicks(ymin, ymax, Math.max(2, Math.floor(ph / 35)));
  if (!(xmax > xmin)) [xmin, xmax] = [xt[0], xt[xt.length - 1]];
  if (!(ymax > ymin)) [ymin, ymax] = [yt[0], yt[yt.length - 1]];
  const sx = (x: number) => left + ((x - xmin) / (xmax - xmin)) * pw;
  const sy = (y: number) => top + ph - ((y - ymin) / (ymax - ymin)) * ph;
  const f = (n: number) => n.toFixed(1);

  const parts: string[] = [];
  parts.push(`<rect x="${f(left)}" y="${f(top)}" width="${f(pw)}" height="${f(ph)}" fill="#ffffff" stroke="#9aa5b1" stroke-width="1"/>`);
  if (roomy) {
    for (const t of xt) {
      if (t < xmin || t > xmax) continue;
      parts.push(`<line x1="${f(sx(t))}" y1="${f(top)}" x2="${f(sx(t))}" y2="${f(top + ph)}" stroke="#e4e7eb"/>`);
      parts.push(`<text x="${f(sx(t))}" y="${f(top + ph + fs * 1.3)}" font-size="${fs}" text-anchor="middle" fill="#52606d">${label(t)}</text>`);
    }
    for (const t of yt) {
      if (t < ymin || t > ymax) continue;
      parts.push(`<line x1="${f(left)}" y1="${f(sy(t))}" x2="${f(left + pw)}" y2="${f(sy(t))}" stroke="#e4e7eb"/>`);
      parts.push(`<text x="${f(left - 4)}" y="${f(sy(t) + fs * 0.35)}" font-size="${fs}" text-anchor="end" fill="#52606d">${label(t)}</text>`);
    }
    if (spec.title) parts.push(`<text x="${f(left + pw / 2)}" y="${f(fs * 1.4)}" font-size="${f(fs * 1.15)}" font-weight="600" text-anchor="middle" fill="#1f2933">${esc(spec.title)}</text>`);
    if (spec.xLabel) parts.push(`<text x="${f(left + pw / 2)}" y="${f(h - 2)}" font-size="${fs}" text-anchor="middle" fill="#52606d">${esc(spec.xLabel)}</text>`);
    if (spec.yLabel) parts.push(`<text x="${f(fs)}" y="${f(top + ph / 2)}" font-size="${fs}" text-anchor="middle" fill="#52606d" transform="rotate(-90 ${f(fs)} ${f(top + ph / 2)})">${esc(spec.yLabel)}</text>`);
  }
  for (const s of spec.series) {
    if (s.points.length === 0) continue;
    const pts = s.points.map(([x, y]) => `${f(sx(x))},${f(sy(y))}`);
    if (!s.dots || s.points.length > 1) parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${esc(s.color)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (s.dots || s.points.length === 1) for (const p of pts) parts.push(`<circle cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="3" fill="${esc(s.color)}"/>`);
  }
  const named = spec.series.filter((s) => s.name && !s.name.startsWith('_'));
  if (roomy && named.length) {
    named.forEach((s, i) => {
      const y = top + 4 + fs * 1.2 * (i + 1);
      parts.push(`<line x1="${f(left + 8)}" y1="${f(y - fs * 0.35)}" x2="${f(left + 22)}" y2="${f(y - fs * 0.35)}" stroke="${esc(s.color)}" stroke-width="3"/>`);
      parts.push(`<text x="${f(left + 27)}" y="${f(y)}" font-size="${fs}" fill="#1f2933">${esc(s.name)}</text>`);
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="100%" height="100%" font-family="system-ui, sans-serif">${parts.join('')}</svg>`;
}
