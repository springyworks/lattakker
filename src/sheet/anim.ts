import type { SceneHost, SvgEl, SvgScene } from './svgScene';

/**
 * Animated pictures (WebP, GIF, APNG) for cells, with the controls a browser's <img> does not have: play, pause,
 * step frame by frame, jump to a frame, change the speed, run backwards. The file is cut into its frames with the
 * browser's own decoder (ImageDecoder), so a WebP keeps its transparency, and the frames are drawn on a canvas that
 * sits inside an SVG drawing: the drawing can put shapes behind and in front of it and animate them.
 *
 *   const clip = await anim.load('bouncer')
 *   clip.show()                       // the picture and a bar with the buttons
 *   clip.step(1)                      // one frame on (this pauses it)
 */

/** What a clip needs from the cell it lives in. */
export interface ClipHost extends SceneHost {
  /** A blank drawing in this cell, as svg({ width, height }) makes. */
  newScene(width: number, height: number): SvgScene;
}

export interface ShowOptions {
  /** Put the picture into this drawing instead of making a new one. */
  scene?: SvgScene;
  /** With `scene`: put the picture INSIDE this part of the drawing (a group), so it moves, turns and fades with the part. x and y are then the part's own coordinates. */
  into?: SvgEl;
  /** Where the picture goes in the drawing, and how big. Default: the top left, at its own size. */
  x?: number;
  y?: number;
  width?: number;
  /** The bar with the play, step and slider controls. Default: on when the picture makes its own drawing. */
  controls?: boolean;
}

/** The pictures that come with the app (files in public/anim): anim.load('bouncer'), anim.load('truck.gif'). A name without an ending is the .webp. */
const ASSET_FILES = ['bouncer.webp', 'spinner.webp', 'truck.webp', 'truck.gif'];
const ASSETS = ASSET_FILES.map((f) => (f.endsWith('.webp') ? f.slice(0, -5) : f));
export const animAssetNames = (): string[] => [...ASSETS];

const MIN_FRAME_MS = 10;
const DEFAULT_FRAME_MS = 100;
/** Decoded frames are kept in memory: this many pixels in all (64 million is about 256 MB). */
const MAX_PIXELS = 64_000_000;
const BAR_W = 280;
const PAD = 10;
const BAR_H = 34;

type Listener = (frame: number) => void;

export class Clip {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  /** How long each frame is shown, in milliseconds. */
  readonly durations: readonly number[];
  /** Plays forever (true) or stops at the last frame (false). */
  loop = true;
  /** 1 is the speed of the file, 2 twice as fast, 0.5 half, -1 backwards. */
  speed = 1;

  private readonly pen: CanvasRenderingContext2D;
  private index = 0;
  private running = false;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private disposed = false;
  private readonly frameListeners = new Set<Listener>();
  private readonly endListeners = new Set<() => void>();

  constructor(
    private readonly bitmaps: ImageBitmap[],
    durations: number[],
    private readonly host: ClipHost,
  ) {
    this.frameCount = bitmaps.length;
    this.durations = durations;
    this.width = bitmaps[0].width;
    this.height = bitmaps[0].height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.pen = this.canvas.getContext('2d')!;
    this.draw();
  }

  /** The number of the frame that is showing, from 0. */
  get frame(): number {
    return this.index;
  }

  get playing(): boolean {
    return this.running;
  }

  /** The length of one run through the picture, in milliseconds. */
  get duration(): number {
    return this.durations.reduce((a, b) => a + b, 0);
  }

  /** Where in the picture we are, in milliseconds from its start. */
  get time(): number {
    let t = 0;
    for (let i = 0; i < this.index; i++) t += this.durations[i];
    return t;
  }

  private draw(): void {
    this.pen.clearRect(0, 0, this.width, this.height);
    this.pen.drawImage(this.bitmaps[this.index], 0, 0);
  }

  private goto(i: number): void {
    const next = Math.min(this.frameCount - 1, Math.max(0, Math.round(i)));
    this.acc = 0;
    if (next === this.index) return;
    this.index = next;
    this.draw();
    for (const fn of [...this.frameListeners]) fn(next);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    if (!this.running || this.disposed) return;
    this.acc = Math.min(this.acc + (now - this.last) * Math.abs(this.speed), 2000);
    this.last = now;
    const dir = this.speed < 0 ? -1 : 1;
    let moved = false;
    for (let guard = 0; this.acc >= this.durations[this.index] && guard < this.frameCount * 2; guard++) {
      this.acc -= this.durations[this.index];
      let next = this.index + dir;
      if (next >= this.frameCount || next < 0) {
        if (!this.loop) {
          this.running = false;
          this.acc = 0;
          for (const fn of [...this.endListeners]) fn();
          break;
        }
        next = (next + this.frameCount) % this.frameCount;
      }
      this.index = next;
      moved = true;
    }
    if (moved) {
      this.draw();
      for (const fn of [...this.frameListeners]) fn(this.index);
    }
    if (this.running) this.raf = requestAnimationFrame(this.tick);
  };

  /** Starts (or goes on) playing. A clip that ended starts again from the other end. */
  play(): Clip {
    this.host.guard();
    if (this.running || this.disposed) return this;
    if (!this.loop && ((this.speed >= 0 && this.index === this.frameCount - 1) || (this.speed < 0 && this.index === 0))) this.goto(this.speed < 0 ? this.frameCount - 1 : 0);
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.changed();
    return this;
  }

  pause(): Clip {
    this.host.guard();
    this.stopRunning();
    return this;
  }

  toggle(): Clip {
    return this.running ? this.pause() : this.play();
  }

  /** Goes `count` frames on (negative: back) and pauses. It goes round at the ends. */
  step(count = 1): Clip {
    this.host.guard();
    this.stopRunning();
    const n = this.frameCount;
    this.goto((((this.index + Math.round(count)) % n) + n) % n);
    return this;
  }

  /** Shows frame number `i` (0 is the first). The clip goes on playing if it was playing. */
  seek(i: number): Clip {
    this.host.guard();
    this.goto(i);
    return this;
  }

  /** Shows the frame that is on screen `ms` milliseconds after the start. */
  seekTime(ms: number): Clip {
    this.host.guard();
    let t = 0;
    let i = 0;
    while (i < this.frameCount - 1 && t + this.durations[i] <= ms) t += this.durations[i++];
    this.goto(i);
    return this;
  }

  /** fn(frameNumber) runs every time the frame changes. Returns a stop function; it also stops when the cell runs again. */
  onFrame(fn: (frame: number) => unknown): () => void {
    this.host.guard();
    let forget = () => {};
    const run = this.host.wrap(fn as (...args: unknown[]) => unknown, () => {}) as Listener;
    const stop = (): void => {
      this.frameListeners.delete(run);
      forget();
    };
    this.frameListeners.add(run);
    forget = this.host.addTask(stop);
    return stop;
  }

  /** fn() runs when a clip that does not loop reaches its end. */
  onEnd(fn: () => unknown): () => void {
    this.host.guard();
    let forget = () => {};
    const run = this.host.wrap(fn as (...args: unknown[]) => unknown, () => {}) as () => void;
    const stop = (): void => {
      this.endListeners.delete(run);
      forget();
    };
    this.endListeners.add(run);
    forget = this.host.addTask(stop);
    return stop;
  }

  private changeListeners = new Set<() => void>();

  private changed(): void {
    for (const fn of this.changeListeners) fn();
  }

  private stopRunning(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.changed();
  }

  /** Stops everything and gives the frames' memory back (done when the cell runs again). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.frameListeners.clear();
    this.endListeners.clear();
    this.changeListeners.clear();
    for (const b of this.bitmaps) b.close();
  }

  /**
   * Puts the picture into a drawing of this cell (its own, unless options.scene says which) and, by default, a bar
   * with the controls under it: ⏮ first frame, ◀ one back, ▶/⏸ play and pause, ▶ one on, a slider, and the frame number.
   * Returns the drawing, so shapes can be added in front of and behind the picture.
   */
  show(options: ShowOptions = {}): SvgScene {
    this.host.guard();
    const w = options.width ?? this.width;
    const h = (w / this.width) * this.height;
    const own = !options.scene;
    const controls = options.controls ?? own;
    // Its own drawing gets a margin: a code cell draws its content a few pixels off, and the edge would cut the controls.
    const pad = own ? PAD : 0;
    const innerW = own && controls ? Math.max(w, BAR_W) : w;
    const scene = options.scene ?? this.host.newScene(innerW + pad * 2, h + (controls ? BAR_H : 0) + pad * 2);
    const x = options.x ?? pad + (innerW - w) / 2;
    const y = options.y ?? pad;
    if (options.into && !options.scene) throw new Error('clip.show: `into` needs `scene` too: clip.show({ scene: pic, into: pic.el(\'screen\') })');
    const holder = options.into ? options.into.add('foreignObject', { x, y, width: w, height: h }) : scene.add('foreignObject', { x, y, width: w, height: h });
    this.canvas.style.cssText = 'width:100%;height:100%;display:block';
    holder.node.append(this.canvas);
    if (controls) this.addControls(scene, own ? pad + (innerW - BAR_W) / 2 : Math.max(0, ((scene.svg.viewBox.baseVal.width || BAR_W) - BAR_W) / 2), y + h + 4);
    return scene;
  }

  private addControls(scene: SvgScene, left: number, top: number): void {
    const bar = scene.add('g', { transform: `translate(${left} ${top})` });
    const button = (x: number, w: number, label: string, tip: string, fn: () => void, size = 14): SvgEl => {
      const g = bar.add('g', { style: 'cursor:pointer' });
      g.add('title').node.textContent = tip;
      g.add('rect', { x, y: 0, width: w, height: 26, rx: 6, fill: '#f6f7f9', stroke: '#8795a1' });
      const t = g.add('text', { x: x + w / 2, y: 18, 'text-anchor': 'middle', 'font-size': size, 'font-family': 'system-ui, sans-serif', fill: '#1f2933', 'pointer-events': 'none' });
      t.node.textContent = label;
      g.on('click', fn);
      return t;
    };
    button(0, 30, '⏮', 'First frame', () => this.pause().seek(0));
    button(34, 30, '❘◀', 'One frame back', () => this.step(-1), 11);
    const play = button(68, 36, '▶', 'Play or pause', () => this.toggle());
    button(108, 30, '▶❘', 'One frame on', () => this.step(1), 11);

    const x0 = 150;
    const x1 = BAR_W - 58;
    bar.add('rect', { x: x0, y: 11, width: x1 - x0, height: 4, rx: 2, fill: '#c5ccd3' });
    const fill = bar.add('rect', { x: x0, y: 11, width: 0, height: 4, rx: 2, fill: '#2f6fb0' });
    const thumb = bar.add('circle', { cx: x0, cy: 13, r: 7, fill: '#fff', stroke: '#2f6fb0', 'stroke-width': 2, 'pointer-events': 'none' });
    const count = bar.add('text', { x: BAR_W, y: 18, 'text-anchor': 'end', 'font-size': 12, 'font-family': 'ui-monospace, monospace', fill: '#3e4c59' });
    const hit = bar.add('rect', { x: x0 - 8, y: 0, width: x1 - x0 + 16, height: 26, fill: 'transparent', style: 'cursor:ew-resize', 'touch-action': 'none' });

    const sync = (): void => {
      const p = this.frameCount > 1 ? this.index / (this.frameCount - 1) : 0;
      fill.node.setAttribute('width', String((x1 - x0) * p));
      thumb.node.setAttribute('cx', String(x0 + (x1 - x0) * p));
      count.node.textContent = `${this.index + 1}/${this.frameCount}`;
      play.node.textContent = this.running ? '⏸' : '▶';
    };
    sync();
    this.frameListeners.add(sync);
    this.changeListeners.add(sync);

    // Dragging on the slider scrubs; the clip pauses while the button is down and goes on after, if it was playing.
    const el = hit.node;
    let wasPlaying = false;
    let dragging = false;
    const at = (e: PointerEvent): void => {
      const svg = scene.svg;
      const m = svg.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      const f = Math.min(1, Math.max(0, (p.x - left - x0) / (x1 - x0)));
      this.goto(f * (this.frameCount - 1));
    };
    // The slider keeps its presses to itself: the sheet must not take them as a drag of the block.
    const keep = (e: Event): void => e.stopPropagation();
    const down = (e: Event): void => {
      e.stopPropagation();
      dragging = true;
      wasPlaying = this.running;
      this.stopRunning();
      (e.target as Element).setPointerCapture?.((e as PointerEvent).pointerId);
      at(e as PointerEvent);
    };
    const move = (e: Event): void => {
      if (dragging) at(e as PointerEvent);
    };
    const up = (): void => {
      if (!dragging) return;
      dragging = false;
      if (wasPlaying) this.play();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('mousedown', keep);
    el.addEventListener('touchstart', keep, { passive: true });
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    this.host.addTask(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('mousedown', keep);
      el.removeEventListener('touchstart', keep);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    });
  }
}

// ---------------------------------------------------------------- reading the file

function sniff(bytes: Uint8Array, fallback: string): string {
  const ascii = (from: number, to: number): string => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  return fallback || 'image/webp';
}

async function bytesOf(src: string | Blob | ArrayBuffer | Uint8Array): Promise<{ bytes: Uint8Array; type: string }> {
  if (typeof src === 'string') {
    if (/^[\w-]+(\.(webp|gif))?$/.test(src) && !ASSETS.includes(src)) throw new Error(`anim.load: there is no picture called "${src}". Pictures that come with the app: ${ASSETS.join(', ')}. Or give a web address or a file.`);
    const url = ASSETS.includes(src) ? `${import.meta.env.BASE_URL}anim/${src.includes('.') ? src : `${src}.webp`}` : src;
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new Error(`anim.load: could not fetch "${src}". Is the address right, and does that site allow other pages to read it? Pictures that come with the app: ${ASSETS.join(', ')}.`);
    }
    if (!res.ok) throw new Error(`anim.load: "${src}" answered ${res.status}. Pictures that come with the app: ${ASSETS.join(', ')}.`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
  }
  if (src instanceof Blob) return { bytes: new Uint8Array(await src.arrayBuffer()), type: src.type };
  return { bytes: src instanceof Uint8Array ? src : new Uint8Array(src), type: '' };
}

/** Cuts an animated WebP, GIF or APNG into frames (with their transparency) and makes a Clip. */
export async function loadClip(src: string | Blob | ArrayBuffer | Uint8Array, host: ClipHost): Promise<Clip> {
  host.guard();
  if (typeof ImageDecoder === 'undefined') {
    throw new Error('anim: this browser cannot cut animated pictures into frames (it has no ImageDecoder). Chrome and Edge can.');
  }
  const { bytes, type } = await bytesOf(src);
  host.guard();
  const decoder = new ImageDecoder({ data: bytes, type: sniff(bytes, type.split(';')[0]), preferAnimation: true });
  const bitmaps: ImageBitmap[] = [];
  const durations: number[] = [];
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      if (i === 0 && count * image.displayWidth * image.displayHeight > MAX_PIXELS) {
        image.close();
        throw new Error(`anim: this picture is too big to keep in memory (${count} frames of ${image.displayWidth}×${image.displayHeight}). Use a smaller or shorter one.`);
      }
      bitmaps.push(await createImageBitmap(image));
      durations.push(Math.max(MIN_FRAME_MS, (image.duration ?? 0) / 1000 || DEFAULT_FRAME_MS));
      image.close();
    }
    if (!bitmaps.length) throw new Error('anim: there is no picture in that file.');
  } catch (err) {
    for (const b of bitmaps) b.close();
    if (err instanceof Error && err.message.startsWith('anim:')) throw err;
    throw new Error(`anim: that file is not a picture this browser can read (${err instanceof Error ? err.message : String(err)}). WebP, GIF and PNG work.`);
  } finally {
    decoder.close();
  }
  try {
    host.guard();
  } catch (err) {
    for (const b of bitmaps) b.close();
    throw err;
  }
  const clip = new Clip(bitmaps, durations, host);
  host.addTask(() => clip.dispose());
  return clip;
}

/** Asks the person for a picture file (it must be called from a click, e.g. inside input.button) and loads it. */
export function pickClip(host: ClipHost): Promise<Clip> {
  host.guard();
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/webp,image/gif,image/png,.webp,.gif,.png,.apng';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) loadClip(file, host).then(resolve, reject);
      else reject(new Error('anim.pick: no file was chosen.'));
    };
    input.oncancel = () => reject(new Error('anim.pick: no file was chosen.'));
    input.click();
  });
}
