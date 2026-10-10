import { Shape, ShapeRegistry, type AbstractCanvas2D, type CellStyle } from '@maxgraph/core';
import { THEME } from '../theme';
import { Piece, RANK_NAMES } from './model';

/** A rounded army tile; subclasses add the picture on top. Colours come from the cell style. */
class PieceTile extends Shape {
  override paintVertexShape(c: AbstractCanvas2D, x: number, y: number, w: number, h: number): void {
    c.translate(x, y);
    const r = Math.min(w, h) * 0.14;
    c.begin();
    c.roundrect(0.5, 0.5, w - 1, h - 1, r, r);
    c.fillAndStroke();
    c.save();
    c.setStrokeColor('#ffffff');
    c.setStrokeAlpha(0.3);
    c.setStrokeWidth(Math.max(1, this.scale));
    c.begin();
    const inset = Math.min(w, h) * 0.07;
    c.roundrect(inset, inset, w - 2 * inset, h - 2 * inset, r * 0.6, r * 0.6);
    c.stroke();
    c.restore();
    this.paintGlyph(c, w, h);
  }

  protected paintGlyph(_c: AbstractCanvas2D, _w: number, _h: number): void {}

  /** Tiny rank name under the picture. The big number is the cell label, drawn by maxGraph. */
  protected paintName(c: AbstractCanvas2D, w: number, h: number, yMid: number): void {
    const name = (this.style as Record<string, unknown> | null)?.pieceName;
    if (typeof name !== 'string') return;
    c.save();
    c.setFontColor(THEME.tileInk);
    c.setFontFamily('system-ui, sans-serif');
    c.setFontStyle(1);
    c.setFontSize(Math.max(6, 8.5 * this.scale));
    c.text(w / 2, h * yMid, 0, 0, name, 'center', 'middle', false, '', 'visible', false, 0, '');
    c.restore();
  }
}

/** One free, original insignia per rank (plain Unicode symbols, no artwork), strongest at the top. */
export const INSIGNIA: Record<string, string> = {
  '10': '\u265A', // ♚ Marshal: crown
  '9': '\u272A', // ✪ General: star in a circle
  '8': '\u2605', // ★ Colonel: solid star
  '7': '\u2606', // ☆ Major: open star
  '6': '\u2726', // ✦ Captain: four-point star
  '5': '\u25C6', // ◆ Lieutenant: diamond
  '4': '\u25B2', // ▲ Sergeant: stripe arrow
  '3': '\u2692', // ⚒ Miner: hammer and pick
  '2': '\u27A4', // ➤ Scout: arrow ahead
  '1': '\u2660', // ♠ Spy: ace of spades
};
const SYMBOL_FONT = '"Noto Sans Symbols 2", "Noto Sans Symbols", "Segoe UI Symbol", "DejaVu Sans", sans-serif';

/** A tile with one big insignia (as big as the bomb), a small number, the tiny name and a ten-step strength meter. */
class RankPiece extends PieceTile {
  protected override paintGlyph(c: AbstractCanvas2D, w: number, h: number): void {
    const st = (this.style ?? {}) as Record<string, unknown>;
    const level = Number(st.pieceLevel ?? 0);
    const symbol = INSIGNIA[String(level)] ?? '';
    c.save();
    c.setFontColor(THEME.tileInk);
    c.setFontFamily(SYMBOL_FONT);
    c.setFontStyle(0);
    c.setFontSize(Math.max(10, Math.min(w, h) * 0.5));
    c.text(w / 2, h * 0.36, 0, 0, symbol, 'center', 'middle', false, '', 'visible', false, 0, '');
    c.setFontFamily('system-ui, sans-serif');
    c.setFontStyle(1);
    c.setFontSize(Math.max(7, Math.min(w, h) * 0.2));
    c.text(w * 0.14, h * 0.17, 0, 0, String(level), 'left', 'middle', false, '', 'visible', false, 0, '');
    c.restore();
    this.paintName(c, w, h, 0.67);
    const segW = (w * 0.72 - 9 * 1.2 * this.scale) / 10;
    const gap = 1.2 * this.scale;
    const x0 = w * 0.14;
    const y = h * 0.8;
    const sh = Math.max(3, h * 0.07);
    c.save();
    c.setFillColor(THEME.tileInk);
    for (let i = 0; i < 10; i++) {
      c.setFillAlpha(i < level ? 0.95 : 0.22);
      c.begin();
      c.rect(x0 + i * (segW + gap), y, segW, sh);
      c.fill();
    }
    c.restore();
  }
}

class HiddenPiece extends PieceTile {
  protected override paintGlyph(c: AbstractCanvas2D, w: number, h: number): void {
    c.save();
    c.setFillColor(THEME.tileInk);
    c.setFillAlpha(0.22);
    c.setStrokeColor(THEME.tileInk);
    c.setStrokeAlpha(0.5);
    c.setStrokeWidth(Math.max(1, this.scale));
    c.begin();
    c.moveTo(w * 0.5, h * 0.22);
    c.lineTo(w * 0.78, h * 0.5);
    c.lineTo(w * 0.5, h * 0.78);
    c.lineTo(w * 0.22, h * 0.5);
    c.close();
    c.fillAndStroke();
    c.restore();
  }
}

class BombPiece extends PieceTile {
  protected override paintGlyph(c: AbstractCanvas2D, w: number, h: number): void {
    c.save();
    c.setFillColor('#16202a');
    c.setStrokeColor(THEME.tileInk);
    c.setStrokeWidth(Math.max(1, this.scale));
    c.begin();
    c.ellipse(w * 0.3, h * 0.26, w * 0.4, h * 0.4);
    c.fillAndStroke();
    c.setStrokeColor(THEME.tileInk);
    c.setStrokeWidth(Math.max(1.5, 2 * this.scale));
    c.begin();
    c.moveTo(w * 0.6, h * 0.3);
    c.curveTo(w * 0.65, h * 0.2, w * 0.72, h * 0.22, w * 0.74, h * 0.13);
    c.stroke();
    c.setFillColor(THEME.tileInk);
    c.begin();
    c.ellipse(w * 0.71, h * 0.08, w * 0.09, h * 0.09);
    c.fill();
    c.setFillColor('#ffffff');
    c.setFillAlpha(0.35);
    c.begin();
    c.ellipse(w * 0.36, h * 0.33, w * 0.1, h * 0.1);
    c.fill();
    c.restore();
    this.paintName(c, w, h, 0.8);
  }
}

class FlagPiece extends PieceTile {
  protected override paintGlyph(c: AbstractCanvas2D, w: number, h: number): void {
    c.save();
    c.setStrokeColor(THEME.tileInk);
    c.setStrokeWidth(Math.max(1.5, 2 * this.scale));
    c.begin();
    c.moveTo(w * 0.34, h * 0.68);
    c.lineTo(w * 0.34, h * 0.14);
    c.stroke();
    c.setFillColor(THEME.tileInk);
    c.setStrokeWidth(Math.max(1, this.scale));
    c.begin();
    c.moveTo(w * 0.34, h * 0.14);
    c.lineTo(w * 0.74, h * 0.28);
    c.lineTo(w * 0.34, h * 0.44);
    c.close();
    c.fillAndStroke();
    c.restore();
    this.paintName(c, w, h, 0.8);
  }
}

ShapeRegistry.add('pieceTile', RankPiece);
ShapeRegistry.add('pieceHidden', HiddenPiece);
ShapeRegistry.add('pieceBomb', BombPiece);
ShapeRegistry.add('pieceFlag', FlagPiece);

export interface PieceVisual {
  value: string;
  style: CellStyle;
  key: string;
}

/** What a piece looks like right now: hidden Blue pieces show only their back. */
export function pieceVisual(piece: Piece): PieceVisual {
  const red = piece.color === 'red';
  const known = red || piece.revealed;
  const special = piece.rank === 'B' || piece.rank === 'F';
  const shape = !known ? 'pieceHidden' : piece.rank === 'B' ? 'pieceBomb' : piece.rank === 'F' ? 'pieceFlag' : 'pieceTile';
  const value = '';
  const name = known ? RANK_NAMES[String(piece.rank)] : '';
  const style: CellStyle = {
    baseStyleNames: ['piece'],
    shape,
    fillColor: red ? THEME.red : THEME.blue,
    strokeColor: red ? THEME.redDark : THEME.blueDark,
  };
  Object.assign(style, { pieceName: name, pieceLevel: known && !special ? piece.rank : 0 });
  return { value, style, key: `${shape}|${style.fillColor}|${value}|${name}` };
}
