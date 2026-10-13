import { parseInterval } from './tasks';

/**
 * Animated SVG for cells. A cell (or a block of cells) shows a drawing; its code finds parts of the drawing by id
 * or class, moves, turns, recolours and animates them, and reacts to clicks:
 *
 *   const pic = svg(`<svg viewBox="0 0 100 100"><circle id="sun" cx="50" cy="50" r="10" fill="gold"/></svg>`)
 *   pic.el('sun').animate({ r: 30, fill: '#ff6600' }, { time: '1s', yoyo: true, loop: true })
 *
 * Everything runs in the cell's run: when the cell runs again, its animations and handlers stop, like timers do.
 * An animation is also a promise, so `await arm.animate({ rotate: 45 }, { time: '300ms' })` waits for it.
 */

/** What the scene needs from the cell it lives in. */
export interface SceneHost {
  /** Throws when the cell's run is over, so stale code stops at its next call. */
  guard(): void;
  /** Registers something to stop when the run is over (an animation, a handler); returns a way to forget it. */
  addTask(stop: () => void): () => void;
  /** Wraps a function the scene calls later (a frame callback, a click handler): errors land on the cell, one call at a time. */
  wrap(fn: (...args: unknown[]) => unknown, stop: () => void): (...args: unknown[]) => unknown;
  /** The label of the cell should be read again (its caption changed). */
  changed(): void;
}

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'bounce' | 'elastic' | 'back';

export interface AnimateOptions {
  /** How long one play takes: 500, '500ms', '2s'. Default 500 ms. */
  time?: number | string;
  /** The shape of the movement: 'linear', 'in', 'out', 'inOut' (the default), 'bounce', 'elastic', 'back'. */
  ease?: Ease;
  /** Wait this long before it starts. */
  delay?: number | string;
  /** true: forever. A number: that many plays. Default: once. */
  loop?: boolean | number;
  /** Play backwards on every second play (so a loop swings to and fro). */
  yoyo?: boolean;
  /** For `along`: start at the end of the path and go to its start. */
  reverse?: boolean;
}

export type AnimateProps = Record<string, number | string | SvgEl | SVGGeometryElement>;

/** What animate() returns: a promise that is done when the animation is, with a way to stop it early. */
export type SvgAnimation = Promise<void> & { stop(): void };

const EASES: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => {
    const c = 1.70158;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
  elastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1),
  bounce: (t) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

// ---------------------------------------------------------------- one shared frame loop

const frames = new Set<(now: number) => boolean>();
let raf = 0;

function tick(now: number): void {
  raf = 0;
  for (const f of [...frames]) if (f(now)) frames.delete(f);
  if (frames.size) raf = requestAnimationFrame(tick);
}

/** Calls `f` on every frame until it answers true. Returns a way to stop it. */
function everyFrame(f: (now: number) => boolean): () => void {
  frames.add(f);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => frames.delete(f);
}

// ---------------------------------------------------------------- colours

let canvas: CanvasRenderingContext2D | null = null;

/** Any CSS colour ('gold', '#fa0', 'rgb(1,2,3)') as [r, g, b], or null when it is not a colour. */
function rgbOf(color: string): [number, number, number] | null {
  canvas ??= document.createElement('canvas').getContext('2d');
  if (!canvas) return null;
  const read = (seed: string): string => {
    canvas!.fillStyle = seed;
    canvas!.fillStyle = color;
    return String(canvas!.fillStyle);
  };
  const a = read('#000000');
  // A word that is no colour leaves the seed in place, so two different seeds give different answers.
  if (a !== read('#ffffff')) return null;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(a);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(a);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

const COLOR_ATTRS = new Set(['fill', 'stroke', 'stop-color', 'color', 'flood-color']);

// ---------------------------------------------------------------- one element

/** Words for where a part turns: its top, its centre ... */
const PIVOTS: Record<string, [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0],
  bottom: [0.5, 1],
  left: [0, 0.5],
  right: [1, 0.5],
  topleft: [0, 0],
  topright: [1, 0],
  bottomleft: [0, 1],
  bottomright: [1, 1],
};

export class SvgEl {
  private pos = { x: 0, y: 0, rotate: 0, sx: 1, sy: 1 };
  private base: string | null = null;
  private pivotAt: [number, number] | string = 'center';

  constructor(
    readonly node: SVGElement,
    private readonly scene: SvgScene,
  ) {}

  // ------------------------------------------------------------ attributes

  /** attr('r') reads, attr('r', 20) sets one, attr({ r: 20, fill: 'red' }) sets several. */
  attr(name: string): string | null;
  attr(name: string, value: string | number): SvgEl;
  attr(map: Record<string, string | number>): SvgEl;
  attr(first: string | Record<string, string | number>, value?: string | number): string | null | SvgEl {
    if (typeof first === 'string' && value === undefined) return this.node.getAttribute(first);
    this.scene.hostApi.guard();
    const map = typeof first === 'string' ? { [first]: value as string | number } : first;
    for (const [k, v] of Object.entries(map)) this.node.setAttribute(k, String(v));
    return this;
  }

  /** text('hello') sets the words of a <text> element; text() reads them. */
  text(): string;
  text(value: unknown): SvgEl;
  text(value?: unknown): string | SvgEl {
    if (arguments.length === 0) return this.node.textContent ?? '';
    this.scene.hostApi.guard();
    this.node.textContent = String(value);
    return this;
  }

  fill(color: string): SvgEl {
    return this.attr('fill', color);
  }

  stroke(color: string, width?: number): SvgEl {
    this.attr('stroke', color);
    return width === undefined ? this : this.attr('stroke-width', width);
  }

  opacity(value: number): SvgEl {
    return this.attr('opacity', value);
  }

  show(): SvgEl {
    this.scene.hostApi.guard();
    this.node.removeAttribute('display');
    return this;
  }

  hide(): SvgEl {
    this.scene.hostApi.guard();
    this.node.setAttribute('display', 'none');
    return this;
  }

  /** The element's box in its own coordinates. */
  bbox(): { x: number; y: number; width: number; height: number } {
    const b = (this.node as SVGGraphicsElement).getBBox?.();
    return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : { x: 0, y: 0, width: 0, height: 0 };
  }

  // ------------------------------------------------------------ moving and turning

  /** Moves the element by (x, y) from where it was drawn. */
  move(x: number, y: number): SvgEl {
    this.scene.hostApi.guard();
    this.pos.x = Number(x) || 0;
    this.pos.y = Number(y) || 0;
    this.applyTransform();
    return this;
  }

  /** Turns the element by `degrees` around its centre, or around its pivot (see pivot()). */
  rotate(degrees: number): SvgEl {
    this.scene.hostApi.guard();
    this.pos.rotate = Number(degrees) || 0;
    this.applyTransform();
    return this;
  }

  /** Makes the element `sx` times as wide and `sy` (default: the same) times as tall, around its pivot. */
  scale(sx: number, sy: number = sx): SvgEl {
    this.scene.hostApi.guard();
    this.pos.sx = Number(sx) || 0;
    this.pos.sy = Number(sy) || 0;
    this.applyTransform();
    return this;
  }

  /** Where the element turns and grows from: 'center' (the default), 'top', 'bottom', 'left', 'right', 'topleft' ..., or a point in its own coordinates. */
  pivot(where: string | number, y?: number): SvgEl {
    this.pivotAt = typeof where === 'number' ? [where, y ?? 0] : where;
    this.applyTransform();
    return this;
  }

  /** Where the element is now: { x, y, rotate, scale } (what move, rotate and animate made of it). */
  get state(): { x: number; y: number; rotate: number; scale: number } {
    return { x: this.pos.x, y: this.pos.y, rotate: this.pos.rotate, scale: this.pos.sx };
  }

  private pivotPoint(): [number, number] {
    if (Array.isArray(this.pivotAt)) return this.pivotAt;
    // A drawing can say where a part turns: data-pivot="100 86".
    if (this.pivotAt === 'center') {
      const given = this.node.getAttribute('data-pivot')?.trim().split(/[ ,]+/).map(Number);
      if (given && given.length === 2 && given.every(Number.isFinite)) return [given[0], given[1]];
    }
    const b = this.bbox();
    const f = PIVOTS[this.pivotAt] ?? PIVOTS.center;
    return [b.x + b.width * f[0], b.y + b.height * f[1]];
  }

  private applyTransform(): void {
    this.base ??= this.node.getAttribute('transform') ?? '';
    const p = this.pos;
    const parts: string[] = [];
    if (this.base) parts.push(this.base);
    if (p.x || p.y) parts.push(`translate(${p.x} ${p.y})`);
    if (p.rotate || p.sx !== 1 || p.sy !== 1) {
      const [cx, cy] = this.pivotPoint();
      if (p.rotate) parts.push(`rotate(${p.rotate} ${cx} ${cy})`);
      if (p.sx !== 1 || p.sy !== 1) parts.push(`translate(${cx} ${cy}) scale(${p.sx} ${p.sy}) translate(${-cx} ${-cy})`);
    }
    if (parts.length) this.node.setAttribute('transform', parts.join(' '));
    else this.node.removeAttribute('transform');
  }

  // ------------------------------------------------------------ building

  /** Adds a child element: g.add('circle', { cx: 10, cy: 10, r: 5, fill: 'red' }). */
  add(tag: string, attrs: Record<string, string | number> = {}): SvgEl {
    return this.scene.add(tag, attrs, this);
  }

  /** Takes the element out of the drawing. */
  remove(): void {
    this.scene.hostApi.guard();
    this.node.remove();
  }

  // ------------------------------------------------------------ events

  /** fn(event) runs when the element gets 'click' (or 'pointerdown', 'pointerover' ...). Returns a stop function; it also stops when the cell runs again. */
  on(event: string, fn: (event: Event) => unknown): () => void {
    this.scene.hostApi.guard();
    const cleanups: Array<() => void> = [];
    let forget = () => {};
    const stop = (): void => {
      for (const c of cleanups) c();
      forget();
    };
    const run = this.scene.hostApi.wrap(fn as (...args: unknown[]) => unknown, () => {});
    const listen = (type: string, handler: (e: Event) => void): void => {
      this.node.addEventListener(type, handler);
      cleanups.push(() => this.node.removeEventListener(type, handler));
    };
    if (event === 'click') {
      // Clicking a cell restyles it, and maxGraph then hosts the drawing again: the browser drops the native click.
      // So a press and a release on this part count as a click too (and a native click right after is not a second one).
      let pressedAt = 0;
      let firedAt = -1000;
      const fire = (e: Event): void => {
        firedAt = performance.now();
        void run(e);
      };
      listen('pointerdown', () => (pressedAt = performance.now()));
      listen('pointerup', (e) => {
        if (pressedAt && performance.now() - pressedAt < 800) {
          pressedAt = 0;
          fire(e);
        }
      });
      listen('click', (e) => {
        if (performance.now() - firedAt > 150) fire(e);
      });
    } else {
      listen(event, (e) => void run(e));
    }
    forget = this.scene.hostApi.addTask(stop);
    this.node.style.cursor ||= event === 'click' || event.startsWith('pointer') ? 'pointer' : '';
    return stop;
  }

  // ------------------------------------------------------------ animating

  /**
   * Changes properties smoothly. x and y move the element, rotate turns it (degrees), scale grows it, opacity fades it;
   * any other name is an attribute of the element (r, cx, width, fill ...), numbers and colours both work. `along` takes
   * a path and moves the element's centre along it.
   *
   *   await head.animate({ y: -20, rotate: 15 }, { time: '300ms', ease: 'bounce' })
   *   dot.animate({ along: '#link-board' }, { time: '800ms' })
   */
  animate(props: AnimateProps, options: AnimateOptions = {}): SvgAnimation {
    const host = this.scene.hostApi;
    host.guard();
    const duration = Math.max(1, parseInterval(options.time, 500));
    const delay = Math.max(0, parseInterval(options.delay, 0));
    const ease = EASES[options.ease ?? 'inOut'];
    if (!ease) throw new Error(`"${String(options.ease)}" is not an ease (try ${Object.keys(EASES).join(', ')})`);
    const plays = options.loop === true ? Infinity : typeof options.loop === 'number' ? Math.max(1, options.loop) : 1;

    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => (finish = resolve));
    let stopFrames = () => {};
    let forget = () => {};
    let ended = false;
    const stop = (): void => {
      if (ended) return;
      ended = true;
      stopFrames();
      forget();
      finish();
    };
    forget = host.addTask(stop);

    type Channel = { set(value: number | string): void; from: number | [number, number, number] | null; to: number | [number, number, number] | string; along?: SVGGeometryElement };
    const channels: Channel[] = [];
    let started = false;
    const prepare = (): void => {
      started = true;
      for (const [key, target] of Object.entries(props)) {
        if (key === 'along') {
          const path = this.scene.pathOf(target);
          const b = this.bbox();
          const c0: [number, number] = [b.x + b.width / 2, b.y + b.height / 2];
          const length = path.getTotalLength();
          channels.push({
            from: 0,
            to: 1,
            along: path,
            set: (v) => {
              const t = options.reverse ? 1 - Number(v) : Number(v);
              const point = path.getPointAtLength(length * t);
              this.pos.x = point.x - c0[0];
              this.pos.y = point.y - c0[1];
              this.applyTransform();
            },
          });
        } else if (key === 'x' || key === 'y' || key === 'rotate' || key === 'scale' || key === 'opacity') {
          const current = key === 'opacity' ? Number(this.node.getAttribute('opacity') ?? 1) : key === 'scale' ? this.pos.sx : this.pos[key];
          channels.push({
            from: current,
            to: Number(target),
            set: (v) => {
              if (key === 'opacity') this.node.setAttribute('opacity', String(v));
              else {
                if (key === 'scale') this.pos.sx = this.pos.sy = Number(v);
                else this.pos[key] = Number(v);
                this.applyTransform();
              }
            },
          });
        } else if (COLOR_ATTRS.has(key) && typeof target === 'string') {
          const from = rgbOf(getComputedStyle(this.node).getPropertyValue(key) || this.node.getAttribute(key) || '#000000');
          const to = rgbOf(target);
          if (from && to) channels.push({ from, to, set: (v) => this.node.setAttribute(key, String(v)) });
          else this.node.setAttribute(key, target);
        } else {
          const to = Number(target);
          const from = Number.parseFloat(this.node.getAttribute(key) ?? '');
          if (Number.isFinite(to) && Number.isFinite(from)) channels.push({ from, to, set: (v) => this.node.setAttribute(key, String(v)) });
          else this.node.setAttribute(key, String(target));
        }
      }
    };

    const write = (t: number): void => {
      for (const c of channels) {
        if (typeof c.from === 'number' && typeof c.to === 'number') c.set(c.from + (c.to - c.from) * t);
        else if (Array.isArray(c.from) && Array.isArray(c.to)) {
          const mix = c.from.map((a, i) => Math.round(a + ((c.to as [number, number, number])[i] - a) * t));
          c.set(`rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`);
        }
      }
    };

    let startAt = -1;
    stopFrames = everyFrame((now) => {
      if (ended) return true;
      if (startAt < 0) startAt = now + delay;
      if (now < startAt) return false;
      if (!started) prepare();
      const elapsed = (now - startAt) / duration;
      const play = Math.floor(elapsed);
      if (play >= plays) {
        write(options.yoyo && plays % 2 === 0 ? 0 : 1);
        stop();
        return true;
      }
      const fraction = elapsed - play;
      write(ease(options.yoyo && play % 2 === 1 ? 1 - fraction : fraction));
      return false;
    });
    return Object.assign(done, { stop });
  }
}

// ---------------------------------------------------------------- the scene

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Keeps a drawing harmless: no scripts, no inline handlers, no javascript: links. (Cells run arbitrary code anyway; this protects against accidents.) */
function clean(root: Element): void {
  for (const bad of [...root.querySelectorAll('script, foreignObject')]) bad.remove();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || (/^(xlink:)?href$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
    }
  }
}

export class SvgScene {
  /** The element that sits in the cell (a div that holds the drawing and a caption). */
  readonly element: HTMLElement;
  readonly svg: SVGSVGElement;
  private readonly caption: HTMLElement;
  private readonly wrapped = new WeakMap<Element, SvgEl>();
  private readonly t0 = performance.now();

  constructor(
    markup: string | { width?: number; height?: number } | undefined,
    readonly hostApi: SceneHost,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'cell-svg';
    this.caption = document.createElement('div');
    this.caption.className = 'cell-text out svg-caption';
    this.caption.hidden = true;
    if (typeof markup === 'string') {
      const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
      const problem = doc.querySelector('parsererror');
      if (problem || doc.documentElement.localName !== 'svg') {
        throw new Error(`That is not a valid SVG drawing${problem ? `: ${problem.textContent?.split('\n')[0] ?? ''}` : ' (it must start with <svg ...>)'}`);
      }
      this.svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
      clean(this.svg);
      // The drawing fills its cell and keeps its proportions.
      if (!this.svg.getAttribute('viewBox')) {
        const w = Number.parseFloat(this.svg.getAttribute('width') ?? '') || 300;
        const h = Number.parseFloat(this.svg.getAttribute('height') ?? '') || 200;
        this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
    } else {
      this.svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
      this.svg.setAttribute('viewBox', `0 0 ${markup?.width ?? 300} ${markup?.height ?? 200}`);
    }
    this.svg.removeAttribute('width');
    this.svg.removeAttribute('height');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.svg.style.cssText += ';width:100%;height:100%;display:block';
    this.element.append(this.svg, this.caption);
  }

  /** The cell's printed lines go under the drawing. */
  setCaption(text: string): void {
    this.caption.textContent = text;
    this.caption.hidden = !text;
  }

  private wrap(node: Element): SvgEl {
    let el = this.wrapped.get(node);
    if (!el) {
      el = new SvgEl(node as SVGElement, this);
      this.wrapped.set(node, el);
    }
    return el;
  }

  /** The ids in the drawing: what el('...') can find. */
  get ids(): string[] {
    return [...this.svg.querySelectorAll('[id]')].map((e) => e.id).filter((id) => !/^(grid|arrow|half)/.test(id));
  }

  private find(selector: string): Element | null {
    if (/^[\w-]+$/.test(selector)) {
      const byId = this.svg.querySelector(`[id="${selector}"]`);
      if (byId) return byId;
    }
    try {
      return this.svg.querySelector(selector);
    } catch {
      return null;
    }
  }

  /** The part of the drawing with that id ('sun' or '#sun'), or that matches the selector ('.leg', 'circle'). */
  el(selector: string | SvgEl): SvgEl {
    this.hostApi.guard();
    if (selector instanceof SvgEl) return selector;
    const node = this.find(selector);
    if (!node) {
      const ids = this.ids;
      throw new Error(`svg: nothing matches "${selector}".${ids.length ? ` Ids in this drawing: ${ids.slice(0, 14).join(', ')}${ids.length > 14 ? ' …' : ''}.` : ' This drawing has no ids yet: give a part id="name".'}`);
    }
    return this.wrap(node);
  }

  /** Every part that matches ('.leg', 'circle'). */
  all(selector: string): SvgEl[] {
    this.hostApi.guard();
    return [...this.svg.querySelectorAll(selector)].map((n) => this.wrap(n));
  }

  /** Adds an element, to the drawing or to a part of it: pic.add('circle', { cx: 50, cy: 50, r: 10, fill: 'tomato' }). */
  add(tag: string, attrs: Record<string, string | number> = {}, parent?: SvgEl): SvgEl {
    this.hostApi.guard();
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    (parent ? parent.node : this.svg).append(node);
    return this.wrap(node);
  }

  /** Writes words into the drawing: pic.write(10, 20, 'Score: 3'). */
  write(x: number, y: number, words: unknown, attrs: Record<string, string | number> = {}): SvgEl {
    const t = this.add('text', { x, y, 'font-family': 'system-ui, sans-serif', 'font-size': 14, ...attrs });
    t.node.textContent = String(words);
    return t;
  }

  /** Sets the words of several parts at once: pic.set({ score: 'Score: 3', who: 'Ann' }). */
  set(texts: Record<string, unknown>): SvgScene {
    for (const [selector, words] of Object.entries(texts)) this.el(selector).text(words);
    return this;
  }

  /** The visible part of the drawing: pic.viewBox(0, 0, 200, 100). */
  viewBox(x: number, y: number, width: number, height: number): SvgScene {
    this.hostApi.guard();
    this.svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
    return this;
  }

  /** Takes everything out of the drawing. */
  clear(): SvgScene {
    this.hostApi.guard();
    while (this.svg.firstChild) this.svg.firstChild.remove();
    return this;
  }

  /** fn(seconds, secondsSinceLastFrame) runs for every frame of the screen (about 60 times a second): for animation you calculate yourself. Returns a stop function. */
  frame(fn: (seconds: number, delta: number) => unknown): () => void {
    this.hostApi.guard();
    let last = performance.now();
    let stopFrames = () => {};
    let forget = () => {};
    const stop = (): void => {
      stopFrames();
      forget();
    };
    const run = this.hostApi.wrap((seconds, delta) => fn(seconds as number, delta as number), stop);
    stopFrames = everyFrame((now) => {
      const delta = (now - last) / 1000;
      last = now;
      void run((now - this.t0) / 1000, delta);
      return false;
    });
    forget = this.hostApi.addTask(stop);
    return stop;
  }

  /** The path element behind a selector or part (for `along`). */
  pathOf(target: unknown): SVGGeometryElement {
    const node = target instanceof SvgEl ? target.node : typeof target === 'string' ? this.find(target) : (target as Element | null);
    const g = node as SVGGeometryElement | null;
    if (!g || typeof g.getTotalLength !== 'function') throw new Error(`svg: "${String(target instanceof SvgEl ? target.node.id : target)}" is not a line or path, so nothing can move along it.`);
    return g;
  }
}
