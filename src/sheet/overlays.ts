import { Cell, Geometry, type Graph } from '@maxgraph/core';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Small pictures drawn on top of the sheet by maxGraph itself (a vertex on the UI layer), instead of loose HTML
 * placed over it: the rubber band, the address tags, the id badges, the glide of blocks that step aside. They live
 * in the same coordinates as the cells, so zoom and scroll carry them along without any position maths, and they
 * never catch the pointer (pointerEvents off), so the board and the cells keep every interaction to themselves.
 */
export class Overlays {
  private counter = 0;

  constructor(
    private readonly graph: Graph,
    private readonly layer: Cell,
  ) {}

  /** Adds a picture in model coordinates. It sits behind the row and column headers and the editor. */
  add(rect: Rect, style: Record<string, unknown>, value = ''): Cell {
    const model = this.graph.getDataModel();
    const cell = new Cell(value, new Geometry(rect.x, rect.y, rect.width, rect.height), { shape: 'rectangle', pointerEvents: false, ...style });
    cell.setVertex(true);
    cell.setId(`ovl:${++this.counter}`);
    model.beginUpdate();
    try {
      model.add(this.layer, cell, 0);
    } finally {
      model.endUpdate();
    }
    return cell;
  }

  place(cell: Cell, rect: Rect): void {
    const g = cell.getGeometry();
    if (g && g.x === rect.x && g.y === rect.y && g.width === rect.width && g.height === rect.height) return;
    this.graph.getDataModel().setGeometry(cell, new Geometry(rect.x, rect.y, rect.width, rect.height));
  }

  /** `opacity` is 0 to 1 and covers the shape and its text. */
  setOpacity(cell: Cell, opacity: number): void {
    const style = { ...(cell.getStyle() as Record<string, unknown>) };
    const percent = Math.max(0, Math.min(100, Math.round(opacity * 100)));
    if (style.opacity === percent) return;
    style.opacity = percent;
    style.textOpacity = percent;
    this.graph.getDataModel().setStyle(cell, style);
  }

  setValue(cell: Cell, value: string): void {
    if (cell.getValue() !== value) this.graph.getDataModel().setValue(cell, value);
  }

  remove(cell: Cell | null | undefined): void {
    if (cell && cell.getParent()) this.graph.getDataModel().remove(cell);
  }

  /**
   * Plays an animation: `frame(p)` runs for every screen frame with the progress p from 0 to 1 (after `delay` ms) and
   * gives back what the picture should look like. The picture is removed at the end. Returns a function that stops it.
   */
  play(cell: Cell, ms: number, delay: number, frame: (p: number) => { rect?: Rect; opacity?: number }): () => void {
    const begin = performance.now() + delay;
    let id = 0;
    const tick = (now: number): void => {
      const p = Math.max(0, Math.min(1, (now - begin) / ms));
      const look = frame(p);
      if (look.rect) this.place(cell, look.rect);
      if (look.opacity !== undefined) this.setOpacity(cell, look.opacity);
      if (p >= 1) {
        this.remove(cell);
        return;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(id);
      this.remove(cell);
    };
  }
}
