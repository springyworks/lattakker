import { RectangleShape, ShapeRegistry, type AbstractCanvas2D } from '@maxgraph/core';
import { PAPER_HEAD, PAPER_HEAD_W, PAPER_LINE_PX, PAPER_SCROLL, PAPER_SHAPE } from './paper';

/** A small repeatable random generator: the same cell always gets the same grain, so it never shimmers when redrawn. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_SPECKS = 3200;

/**
 * Roll paper: the cell's own plain fill with a fine grain on top (dark specks, pale specks and a few short fibres),
 * all drawn by maxGraph as ordinary vector paths. Three paths in all, however many specks, and the count follows the
 * size of the cell at 100%, so zooming does not change the look.
 */
class PaperRollShape extends RectangleShape {
  override isHtmlAllowed(): boolean {
    return false;
  }

  override paintBackground(c: AbstractCanvas2D, x: number, y: number, w: number, h: number): void {
    super.paintBackground(c, x, y, w, h);
    const s = this.scale || 1;
    if (w < 6 || h < 6) return;
    const travelled = (Number((this.style as Record<string, unknown> | undefined)?.[PAPER_SCROLL]) || 0) * s;
    const rnd = seeded(this.state?.cell.getId() ?? 'paper');
    const count = Math.min(MAX_SPECKS, Math.round(((w / s) * (h / s)) / 48));
    const speck = (alpha: number, color: string, min: number, max: number, n: number): void => {
      c.setFillColor(color);
      c.setFillAlpha(alpha);
      c.begin();
      for (let i = 0; i < n; i++) {
        const size = Math.max(0.5, (min + rnd() * (max - min)) * s);
        const px = x + 1 + rnd() * (w - size - 2);
        const span = h - size - 2;
        // The roll moves up under the print head: a speck rides up with the paper and comes round again from the bottom.
        const py = y + 1 + ((((rnd() * span - travelled) % span) + span) % span);
        c.moveTo(px, py);
        c.lineTo(px + size, py);
        c.lineTo(px + size, py + size);
        c.lineTo(px, py + size);
        c.close();
      }
      c.fill();
    };
    c.save();
    speck(0.2, '#6f6c60', 0.7, 1.7, count);
    speck(0.7, '#ffffff', 1, 2.4, Math.round(count / 2));
    c.setStrokeColor('#9b978a');
    c.setStrokeAlpha(0.24);
    c.setStrokeWidth(Math.max(0.4, 0.6 * s));
    c.begin();
    for (let i = 0; i < Math.round(count / 9); i++) {
      const px = x + 4 + rnd() * (w - 8);
      const span = h - 8;
      const py = y + 4 + ((((rnd() * span - travelled) % span) + span) % span);
      const angle = rnd() * Math.PI;
      const len = (3 + rnd() * 5) * s;
      c.moveTo(px, py);
      c.lineTo(px + Math.cos(angle) * len, py + Math.sin(angle) * len);
    }
    c.stroke();
    c.restore();
    this.paintHead(c, x, y, w, h, s);
  }

  /** The print head: a pale block on the line being typed, over the column the next letter strikes, with a dark pointer under it. It stays at the bottom of the cell: the paper moves, not the head. */
  private paintHead(c: AbstractCanvas2D, x: number, y: number, w: number, h: number, s: number): void {
    const style = this.style as Record<string, unknown> | undefined;
    const at = Number(style?.[PAPER_HEAD]);
    if (!Number.isFinite(at) || at < 0) return;
    const bw = Math.max(2, Number(style?.[PAPER_HEAD_W]) || 7) * s;
    const bh = PAPER_LINE_PX * s;
    const bx = x + at * s;
    const by = y + h - 4 * s - bh;
    if (bx + bw > x + w) return;
    c.save();
    c.setFillColor('#2b6cb0');
    c.setFillAlpha(0.18);
    c.begin();
    c.moveTo(bx, by);
    c.lineTo(bx + bw, by);
    c.lineTo(bx + bw, by + bh);
    c.lineTo(bx, by + bh);
    c.close();
    c.fill();
    c.setFillColor('#16161a');
    c.setFillAlpha(0.75);
    c.begin();
    c.moveTo(bx, by + bh + 1.5 * s);
    c.lineTo(bx + bw, by + bh + 1.5 * s);
    c.lineTo(bx + bw / 2, by + bh - 1 * s);
    c.close();
    c.fill();
    c.restore();
  }
}

let registered = false;

/** Teaches maxGraph the paper shape (once, before the first paper cell is drawn). */
export function registerPaperShape(): void {
  if (registered) return;
  registered = true;
  ShapeRegistry.add(PAPER_SHAPE, PaperRollShape);
}
