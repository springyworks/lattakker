import { Cell, Geometry, InternalEvent, InternalMouseEvent, Morphing } from '@maxgraph/core';
import type { MouseListenerSet } from '@maxgraph/core';
import { formatAddress, parseAddress } from '../sheet/address';
import { CH, CW, ORIGIN_X, ORIGIN_Y, Sheet } from '../sheet/Sheet';
import { Hud } from '../ui/Hud';
import { chooseBlueMove } from './ai';
import { Spring } from '../sheet/spring';
import { THEME } from '../theme';
import { pieceVisual } from './pieceShapes';
import {
  BOARD_COLS,
  BOARD_ROWS,
  Color,
  Game,
  MoveResult,
  Piece,
  Pos,
  isHomeSquare,
  isLake,
  isMobile,
  pieceName,
  samePos,
} from './model';

const DRAG_THRESHOLD = 4;

interface DragState {
  pieceId: number;
  from: Pos;
  cell: Cell;
  size: { width: number; height: number };
  startX: number;
  startY: number;
  moved: boolean;
  spring: Spring;
}

const INSET = 4;

export interface PieceInfo {
  color: Color;
  rank: number | 'B' | 'F' | '?';
  name: string;
  revealed: boolean;
  moved: boolean;
}

export interface MoveInfo {
  from: string;
  to: string;
  color: Color;
  piece: string;
  defender: string | null;
  outcome: 'win' | 'lose' | 'draw' | null;
  flagCaptured: boolean;
}

/** Draws the game on the sheet (board squares A1:J10 + piece vertices) and handles clicks. */
export class GameView {
  game = new Game();
  onChange: (() => void) | null = null;
  private pieceCells = new Map<number, Cell>();
  private pieceKeys = new Map<number, string>();
  private moveArrow: Cell | null = null;
  private arrowTimer = 0;
  private selected: Pos | null = null;
  private targets: Pos[] = [];
  private busy = false;
  private drag: DragState | null = null;
  lastInteraction = 0;

  constructor(
    private sheet: Sheet,
    private hud: Hud,
  ) {}

  // ----------------------------------------------------------- helpers

  addrOf(pos: Pos): string {
    return formatAddress(pos.col, pos.row);
  }

  posOf(address: string): Pos | null {
    const p = parseAddress(address);
    if (!p || p.row < 0 || p.row >= BOARD_ROWS || p.col < 0 || p.col >= BOARD_COLS) return null;
    return { row: p.row, col: p.col };
  }

  pieceInfo(piece: Piece, peek = false): PieceInfo {
    const known = piece.color === 'red' || piece.revealed || peek;
    return {
      color: piece.color,
      rank: known ? piece.rank : '?',
      name: known ? pieceName(piece) : 'Unknown Blue piece',
      revealed: piece.revealed,
      moved: piece.moved,
    };
  }

  pieceInfoAt(address: string, peek = false): PieceInfo | null {
    const pos = this.posOf(address);
    if (!pos) return null;
    const p = this.game.at(pos);
    return p ? this.pieceInfo(p, peek) : null;
  }

  moveInfo(r: MoveResult): MoveInfo {
    return {
      from: this.addrOf(r.from),
      to: this.addrOf(r.to),
      color: r.color,
      piece: pieceName(r.piece),
      defender: r.defender ? pieceName(r.defender) : null,
      outcome: r.outcome,
      flagCaptured: r.flagCaptured,
    };
  }

  tooltipFor(id: string): string | null {
    if (!id.startsWith('piece:')) return null;
    const piece = this.findPiece(Number(id.slice(6)));
    if (!piece) return '';
    if (piece.color === 'red') return `Your ${pieceName(piece)}${isMobile(piece.rank) ? '' : ' (cannot move)'}`;
    return piece.revealed ? `Blue ${pieceName(piece)}` : 'A Blue piece. Attack it to find out what it is!';
  }

  private findPiece(id: number): Piece | null {
    for (const { piece } of this.game.pieces()) if (piece.id === id) return piece;
    return null;
  }

  // ------------------------------------------------------------- render

  init(restored = false): void {
    this.paintBoard();
    this.syncPieces();
    this.updateHud();
    this.installDragHandling();
    if (restored && this.game.phase !== 'setup') {
      this.hud.say(
        this.game.phase === 'over'
          ? 'Welcome back, General! 👋 Your last game was kept in this browser. It is finished. Press "New game" to play again.'
          : 'Welcome back, General! 👋 Your game was kept in this browser. Carry on where you stopped.',
        'info',
      );
      if (this.game.phase === 'play' && this.game.turn === 'blue') void this.blueMoves();
      return;
    }
    this.hud.say(
      'Welcome, General! 👋\nThis is your army (red). Click one red piece, then another one to swap their places. ' +
        'Hide your flag 🚩 behind bombs 💣. When you are happy, press "Start the battle!"',
      'info',
    );
  }

  /** Blue answers when a saved game was stopped in the middle of Blue's turn. */
  private async blueMoves(): Promise<void> {
    this.busy = true;
    this.hud.setTurn('Blue is thinking. Please wait', 'blue', 'You cannot move until Blue has moved');
    await this.sleep(650);
    const move = chooseBlueMove(this.game);
    this.busy = false;
    if (move) await this.playMove(move.from, move.to, 'blue');
  }

  // --------------------------------------------------------------- drag

  private installDragHandling(): void {
    const listener: MouseListenerSet = {
      mouseDown: (_sender, me) => this.onDragMouseDown(me),
      mouseMove: (_sender, me) => this.onDragMouseMove(me),
      mouseUp: (_sender, me) => this.onDragMouseUp(me),
    };
    this.sheet.graph.addMouseListener(listener);
    this.sheet.onPointerCancel(() => this.cancelDrag());
  }

  /** The browser took the touch over (scrolling): put the piece back instead of leaving it hanging. */
  private cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (!drag.moved) {
      drag.spring.stop();
      return;
    }
    this.busy = true;
    void this.springBackAndSync(drag).then(() => {
      this.busy = false;
      this.clearSelection();
    });
  }

  private pickablePos(piece: Piece, pos: Pos): boolean {
    if (piece.color !== 'red') return false;
    if (this.busy) return false;
    if (this.game.phase === 'setup') return true;
    if (this.game.phase !== 'play' || this.game.turn !== 'red') return false;
    return isMobile(piece.rank) && this.game.legalMoves(pos).length > 0;
  }

  private onDragMouseDown(me: InternalMouseEvent): void {
    if (this.drag) return;
    const id = me.getCell()?.getId() ?? '';
    if (!id.startsWith('piece:')) return;
    if (this.sheet.fingerIsScrolling(me)) return;
    const piece = this.findPiece(Number(id.slice(6)));
    const pos = piece ? this.game.find(piece) : null;
    if (!piece || !pos || !this.pickablePos(piece, pos)) return;
    const cell = this.pieceCells.get(piece.id)!;
    const geo = cell.getGeometry()!;
    this.drag = {
      pieceId: piece.id,
      from: pos,
      cell,
      size: { width: geo.width, height: geo.height },
      startX: me.getGraphX(),
      startY: me.getGraphY(),
      moved: false,
      spring: new Spring({ x: geo.x + geo.width / 2, y: geo.y + geo.height / 2 }),
    };
  }

  private onDragMouseMove(me: InternalMouseEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const gx = me.getGraphX();
    const gy = me.getGraphY();
    if (!drag.moved) {
      if (Math.hypot(gx - drag.startX, gy - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      this.select(drag.from);
      this.sheet.graph.orderCells(false, [drag.cell]);
      const model = this.sheet.graph.getDataModel();
      drag.spring.start(({ x, y }) => {
        model.setGeometry(drag.cell, new Geometry(x - drag.size.width / 2, y - drag.size.height / 2, drag.size.width, drag.size.height));
      });
    }
    drag.spring.setTarget(this.sheet.modelPoint(me));
    me.consume();
  }

  private onDragMouseUp(me: InternalMouseEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (!drag.moved) {
      drag.spring.stop();
      return; // indistinguishable from a click — let the normal CLICK/onPieceClick path handle it
    }
    me.consume();
    const drop = this.sheet.modelPoint(me);
    void this.resolveDrop(drag, drop.x, drop.y);
  }

  private async resolveDrop(drag: DragState, gx: number, gy: number): Promise<void> {
    this.busy = true;
    const col = Math.floor((gx - ORIGIN_X) / CW);
    const row = Math.floor((gy - ORIGIN_Y) / CH);
    const inBounds = row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
    const dropPos: Pos | null = inBounds ? { row, col } : null;
    const legalTargets = this.targets;
    this.clearSelection();

    if (this.game.phase === 'setup') {
      const dropPiece = dropPos ? this.game.at(dropPos) : null;
      if (dropPos && dropPiece?.color === 'red' && isHomeSquare('red', dropPos)) {
        await drag.spring.settle(this.squareCenter(dropPos));
        drag.spring.stop();
        await this.swapAnimated(drag.from, dropPos); // manages this.busy itself
        this.hud.say(`Swapped! ${pieceName(this.game.at(dropPos)!)} is now on ${this.addrOf(dropPos)} ✨`, 'good');
        this.onChange?.();
      } else {
        await this.springBackAndSync(drag);
        this.busy = false;
        this.hud.say(dropPos ? 'Swapping only works between two of your own red pieces 🔴🔁🔴' : 'Pieces must stay on the board.', 'advice');
      }
      return;
    }

    // phase === 'play'
    const isLegalTarget = dropPos !== null && legalTargets.some((t) => samePos(t, dropPos));
    if (dropPos && isLegalTarget) {
      await drag.spring.settle(this.squareCenter(dropPos));
      drag.spring.stop();
      await this.playMove(drag.from, dropPos, 'red', { skipEntryAnimation: true }); // manages this.busy itself
    } else {
      await this.springBackAndSync(drag);
      this.busy = false;
      const reason = dropPos ? this.game.explain(drag.from, dropPos) : null;
      this.hud.say(reason ?? (dropPos ? 'That is not a legal move for this piece. Try a green dot or ⚔.' : 'Pieces must stay on the board.'), 'advice');
    }
  }

  private squareCenter(pos: Pos): { x: number; y: number } {
    const geo = this.squareGeometry(pos);
    return { x: geo.x + geo.width / 2, y: geo.y + geo.height / 2 };
  }

  private async springBackAndSync(drag: DragState): Promise<void> {
    await drag.spring.settle(this.squareCenter(drag.from));
    drag.spring.stop();
    this.syncPieces();
  }

  paintBoard(): void {
    const setup = this.game.phase === 'setup';
    this.sheet.graph.batchUpdate(() => {
      for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
          const addr = formatAddress(c, r);
          if (isLake(r, c)) {
            this.sheet.setBaseVisual(addr, {
              fill: THEME.lake,
              stroke: THEME.lakeStroke,
              label: '≈',
              fontColor: THEME.lakeInk,
              fontSize: 26,
              align: 'center',
              verticalAlign: 'middle',
            });
            continue;
          }
          const even = (r + c) % 2 === 0;
          let fill: string = even ? THEME.boardLight : THEME.boardDark;
          if (setup && r >= 6) fill = even ? THEME.redCampLight : THEME.redCampDark;
          if (setup && r <= 3) fill = even ? THEME.blueCampLight : THEME.blueCampDark;
          this.sheet.setBaseVisual(addr, { fill, stroke: THEME.boardStroke, strokeWidth: 1, fontSize: 10, align: 'left', verticalAlign: 'bottom' });
        }
      }
    });
  }

  private squareGeometry(pos: Pos): Geometry {
    const geo = this.sheet.geometryOf(this.addrOf(pos))!;
    return new Geometry(geo.x + INSET, geo.y + INSET, CW - 2 * INSET, CH - 2 * INSET);
  }

  /** Brings one piece vertex's shape, colour and rank label in line with the piece (no-op when unchanged). */
  private applyPieceVisual(cell: Cell, piece: Piece): void {
    const vis = pieceVisual(piece);
    if (this.pieceKeys.get(piece.id) === vis.key) return;
    this.pieceKeys.set(piece.id, vis.key);
    const model = this.sheet.graph.getDataModel();
    model.setStyle(cell, vis.style);
    model.setValue(cell, vis.value);
  }

  /** Makes the piece vertices match the game board exactly (no animation). */
  syncPieces(): void {
    const graph = this.sheet.graph;
    const model = graph.getDataModel();
    const alive = new Set<number>();
    graph.batchUpdate(() => {
      for (const { piece, pos } of this.game.pieces()) {
        alive.add(piece.id);
        let cell = this.pieceCells.get(piece.id);
        const geo = this.squareGeometry(pos);
        if (!cell) {
          const vis = pieceVisual(piece);
          cell = graph.insertVertex({
            parent: this.sheet.pieceLayer,
            id: `piece:${piece.id}`,
            value: vis.value,
            position: [geo.x, geo.y],
            size: [geo.width, geo.height],
            style: vis.style,
          });
          this.pieceCells.set(piece.id, cell);
          this.pieceKeys.set(piece.id, vis.key);
        } else {
          const g = cell.getGeometry()!;
          if (g.x !== geo.x || g.y !== geo.y) model.setGeometry(cell, geo);
          this.applyPieceVisual(cell, piece);
        }
      }
      for (const [id, cell] of [...this.pieceCells]) {
        if (!alive.has(id)) {
          graph.removeCells([cell], false);
          this.pieceCells.delete(id);
          this.pieceKeys.delete(id);
        }
      }
    });
  }

  /** Draws a maxGraph edge with an arrowhead from the origin square to the destination of the latest move. */
  private showMoveArrow(from: Pos, to: Pos): void {
    this.clearMoveArrow();
    const source = this.sheet.cellAt(this.addrOf(from));
    const target = this.sheet.cellAt(this.addrOf(to));
    if (!source || !target) return;
    this.moveArrow = this.sheet.graph.insertEdge({
      parent: this.sheet.pieceLayer,
      id: 'move:arrow',
      source,
      target,
      value: '',
      style: {
        strokeColor: THEME.select,
        strokeWidth: 4,
        endArrow: 'classic',
        endSize: 8,
        opacity: 80,
        pointerEvents: false,
        movable: false,
        deletable: false,
        editable: false,
      },
    });
    this.sheet.graph.orderCells(true, [this.moveArrow]);
    this.startArrowFade(this.moveArrow);
  }

  /**
   * The eye judges brightness on a logarithmic scale, so a straight-line fade looks like it drops
   * at the start and lingers at the end. This curve falls fast at first and then stays visible a
   * long time: 85% to 0% over about a minute, still about 40% after 20 seconds.
   */
  private startArrowFade(arrow: Cell): void {
    const FADE_MS = 60_000;
    const MAX = 85;
    const t0 = performance.now();
    this.arrowTimer = window.setInterval(() => {
      if (this.moveArrow !== arrow) return;
      const t = Math.min(1, (performance.now() - t0) / FADE_MS);
      if (t >= 1) {
        this.clearMoveArrow();
        return;
      }
      const opacity = Math.round(MAX * (1 - Math.log10(1 + 9 * t)));
      this.sheet.graph.setCellStyles('opacity', opacity, [arrow]);
    }, 250);
  }

  private clearMoveArrow(): void {
    window.clearInterval(this.arrowTimer);
    this.arrowTimer = 0;
    if (!this.moveArrow) return;
    this.sheet.graph.removeCells([this.moveArrow], false);
    this.moveArrow = null;
  }

  /** Takes back Red's last move together with Blue's answer. */
  undo(): void {
    if (this.busy) return;
    if (!this.game.undo()) {
      this.hud.say('Nothing to take back yet.', 'advice');
      return;
    }
    this.clearSelection();
    this.clearMoveArrow();
    this.syncPieces();
    this.updateHud();
    this.hud.say('Your last move was taken back. Try something different.', 'info');
    this.onChange?.();
  }

  private animateTo(cell: Cell, geo: Geometry): Promise<void> {
    const graph = this.sheet.graph;
    const model = graph.getDataModel();
    graph.orderCells(false, [cell]);
    return new Promise((resolve) => {
      model.beginUpdate();
      model.setGeometry(cell, geo);
      const morph = new Morphing(graph, 12, 1.5, 16);
      morph.addListener(InternalEvent.DONE, () => {
        model.endUpdate();
        resolve();
      });
      morph.startAnimation();
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => window.setTimeout(r, ms));
  }

  // ---------------------------------------------------------- selection

  private select(pos: Pos): void {
    this.clearSelection();
    this.selected = pos;
    this.targets = this.game.phase === 'play' ? this.game.legalMoves(pos) : [];
    const addr = this.addrOf(pos);
    this.sheet.setSelectionVisual(addr, { fill: THEME.selectFill, stroke: THEME.select, strokeWidth: 4 });
    for (const t of this.targets) {
      const ta = this.addrOf(t);
      const enemy = this.game.at(t);
      if (enemy) {
        this.sheet.setSelectionVisual(ta, { fill: THEME.attackFill, stroke: THEME.attackStroke, strokeWidth: 3 });
        this.sheet.setOverlay(ta, this.sheet.makeSwordsOverlay('Attack!'));
      } else {
        this.sheet.setSelectionVisual(ta, { fill: THEME.moveFill, stroke: THEME.moveStroke, strokeWidth: 2 });
        this.sheet.setOverlay(ta, this.sheet.makeDotOverlay(THEME.moveStroke, `Move to ${ta}`));
      }
    }
  }

  private clearSelection(): void {
    if (this.selected) this.sheet.clearOverlays(this.targets.map((t) => this.addrOf(t)));
    this.sheet.clearSelectionVisuals();
    this.selected = null;
    this.targets = [];
  }

  // -------------------------------------------------------------- clicks

  onSquareClick(address: string): void {
    const pos = this.posOf(address);
    if (pos) void this.handleClick(pos);
  }

  onPieceClick(id: number): void {
    const piece = this.findPiece(id);
    const pos = piece ? this.game.find(piece) : null;
    if (pos) void this.handleClick(pos);
  }

  private async handleClick(pos: Pos): Promise<void> {
    this.lastInteraction = Date.now();
    const addr = this.addrOf(pos);
    const piece = this.game.at(pos);
    const game = this.game;

    if (this.busy) {
      this.sheet.flash(addr, THEME.flashSoft);
      this.hud.say('One moment… pieces are still moving ⏳', 'think');
      return;
    }

    if (isLake(pos.row, pos.col)) {
      this.sheet.flash(addr, THEME.flashWater);
      this.hud.say('Splash! 🌊 That is a lake. Nobody can swim there, not even Scouts.', 'advice');
      return;
    }

    if (game.phase === 'over') {
      this.sheet.flash(addr);
      this.hud.say(`The game is over — ${game.winner === 'red' ? 'you won! 🎉' : 'Blue won this time.'} Press "New game" to play again.`, 'info');
      return;
    }

    if (game.phase === 'setup') {
      if (!this.selected) {
        if (piece?.color === 'red') {
          this.select(pos);
          this.hud.say(`${pieceName(piece)} picked up ✋ Now click another red piece to swap their places.`, 'info');
        } else if (piece?.color === 'blue') {
          this.sheet.flash(addr, THEME.flashWater);
          this.hud.say("That is Blue's camp 🔵 Your army lives in the bottom four rows (7 to 10).", 'advice');
        } else {
          this.sheet.flash(addr);
          this.hud.say('Pick one of your red pieces first ✋', 'advice');
        }
        return;
      }
      if (samePos(this.selected, pos)) {
        this.clearSelection();
        this.sheet.flash(addr);
        this.hud.say('Put back down. Click a red piece to pick it up again.', 'info');
        return;
      }
      if (piece?.color === 'red' && isHomeSquare('red', pos)) {
        const from = this.selected;
        this.clearSelection();
        await this.swapAnimated(from, pos);
        this.hud.say(`Swapped! ${pieceName(game.at(pos)!)} is now on ${addr} ✨`, 'good');
        this.onChange?.();
      } else {
        this.sheet.flash(addr, THEME.flashBad);
        this.hud.say('Swapping only works between two of your own red pieces 🔴🔁🔴', 'advice');
      }
      return;
    }

    // phase === 'play'
    if (game.turn !== 'red') {
      this.sheet.flash(addr, THEME.flashSoft);
      this.hud.say('Blue is still thinking 🤔 Your turn comes right after.', 'think');
      return;
    }

    if (!this.selected) {
      if (!piece) {
        this.sheet.flash(addr);
        this.hud.say('Empty square. First click one of your RED pieces, then click where it should go ✨', 'advice');
      } else if (piece.color === 'blue') {
        this.sheet.flash(addr, THEME.flashWater);
        this.hud.say('That is a Blue piece 🔵 You move RED pieces. To attack it, pick a red piece next to it, then click the blue one.', 'advice');
      } else if (!isMobile(piece.rank)) {
        this.sheet.flash(addr, THEME.flash);
        this.hud.say(
          piece.rank === 'B'
            ? 'Bombs cannot move 💣 They wait quietly until an enemy bumps into them.'
            : 'The flag stays put 🚩 Keep it protected!',
          'advice',
        );
      } else {
        const moves = game.legalMoves(pos);
        if (moves.length === 0) {
          this.sheet.flash(addr, THEME.flash);
          this.hud.say(`${pieceName(piece)} is stuck 😅 Nothing free around it. Try another piece.`, 'advice');
        } else {
          this.select(pos);
          this.hud.say(
            `${pieceName(piece)} is ready! 🟢 Green dots show where it can go, ⚔ marks an attack. Click one of them.`,
            'info',
          );
        }
      }
      return;
    }

    if (samePos(this.selected, pos)) {
      this.clearSelection();
      this.sheet.flash(addr);
      this.hud.say('Okay, un-picked. Click a red piece to choose again.', 'info');
      return;
    }
    if (piece?.color === 'red' && isMobile(piece.rank) && game.legalMoves(pos).length > 0) {
      this.select(pos);
      this.hud.say(`Switched to ${pieceName(piece)} 🟢 Now click a green dot or ⚔.`, 'info');
      return;
    }
    const reason = game.explain(this.selected, pos);
    if (reason) {
      this.sheet.flash(addr, THEME.flashBad);
      this.hud.say(reason, 'advice');
      return;
    }
    const from = this.selected;
    this.clearSelection();
    await this.playMove(from, pos, 'red');
  }

  private async swapAnimated(a: Pos, b: Pos): Promise<void> {
    const pa = this.game.at(a);
    const pb = this.game.at(b);
    this.game.swap('red', a, b);
    this.busy = true;
    const anims: Promise<void>[] = [];
    if (pa) anims.push(this.animateTo(this.pieceCells.get(pa.id)!, this.squareGeometry(b)));
    if (pb) anims.push(this.animateTo(this.pieceCells.get(pb.id)!, this.squareGeometry(a)));
    await Promise.all(anims);
    this.busy = false;
    this.syncPieces();
  }

  /** Executes a legal move with animation, then lets Blue answer. */
  async playMove(from: Pos, to: Pos, who: Color, opts: { skipEntryAnimation?: boolean } = {}): Promise<void> {
    this.busy = true;
    const result = this.game.move(from, to);
    const cell = this.pieceCells.get(result.piece.id)!;
    const targetGeo = this.squareGeometry(to);
    const model = this.sheet.graph.getDataModel();

    if (result.defender) {
      // step next to the defender, reveal both, then resolve
      const bump = new Geometry(
        targetGeo.x + (from.col - to.col) * 14 + (from.row - to.row) * 0,
        targetGeo.y + (from.row - to.row) * 14,
        targetGeo.width,
        targetGeo.height,
      );
      if (opts.skipEntryAnimation) model.setGeometry(cell, bump);
      else await this.animateTo(cell, bump);
      const defCell = this.pieceCells.get(result.defender.id)!;
      model.batchUpdate(() => {
        this.applyPieceVisual(cell, result.piece);
        this.applyPieceVisual(defCell, result.defender!);
      });
      this.sheet.flash(this.addrOf(to), THEME.flashBad, 700);
      this.report(result);
      await this.sleep(900);
    } else {
      if (opts.skipEntryAnimation) model.setGeometry(cell, targetGeo);
      else await this.animateTo(cell, targetGeo);
      this.report(result);
    }
    this.syncPieces();
    this.showMoveArrow(from, to);
    this.updateHud();
    this.onChange?.();

    if (this.game.phase === 'play' && this.game.turn === 'blue') {
      this.hud.setTurn('Blue is thinking. Please wait', 'blue', 'You cannot move until Blue has moved');
      await this.sleep(who === 'red' ? 650 : 250);
      const move = chooseBlueMove(this.game);
      this.busy = false;
      if (move) await this.playMove(move.from, move.to, 'blue');
      return;
    }
    this.busy = false;
  }

  private report(r: MoveResult): void {
    const you = r.color === 'red';
    const who = you ? 'You' : 'Blue';
    const from = this.addrOf(r.from);
    const to = this.addrOf(r.to);
    if (!r.defender) {
      const text = you ? `You moved ${pieceName(r.piece)} from ${from} to ${to}.` : `Blue moved a piece from ${from} to ${to}.`;
      this.hud.addLog(text);
      if (!you) this.hud.say(text + ' Your turn! 🔴', 'info');
      return;
    }
    const att = pieceName(r.piece);
    const def = pieceName(r.defender);
    let text: string;
    let tone: 'good' | 'bad' | 'info' = 'info';
    if (r.flagCaptured) {
      text = you
        ? `🎉 Your ${att} captured the Blue flag at ${to}! YOU WIN! 🏆`
        : `😮 Blue's ${att} captured your flag at ${to}. Blue wins this one. Press "New game" for a rematch!`;
      tone = you ? 'good' : 'bad';
    } else if (r.outcome === 'win') {
      text = `${who === 'You' ? 'Your' : "Blue's"} ${att} attacked ${you ? "Blue's" : 'your'} ${def} at ${to} and won! ⚔`;
      tone = you ? 'good' : 'bad';
    } else if (r.outcome === 'lose') {
      text = `${who === 'You' ? 'Your' : "Blue's"} ${att} attacked ${you ? "Blue's" : 'your'} ${def} at ${to} and lost. 💥`;
      tone = you ? 'bad' : 'good';
    } else {
      text = `${who === 'You' ? 'Your' : "Blue's"} ${att} met ${you ? "Blue's" : 'your'} ${def} at ${to}: same rank, both are gone! 🤝`;
    }
    if (!you && this.game.phase === 'play') text += ' Your turn! 🔴';
    this.hud.say(text, tone);
    this.hud.addLog(text.replace(/ Your turn! 🔴$/, ''));
  }

  updateHud(): void {
    const g = this.game;
    const progress = g.moveCount === 0 ? 'No move played yet' : `${g.moveCount} move${g.moveCount === 1 ? '' : 's'} played`;
    if (g.phase === 'setup') {
      this.hud.setTurn('You are arranging your army now', 'red', 'The battle has not started');
      this.hud.showButtons(['btn:shuffle', 'btn:start', 'btn:new', 'btn:help', 'btn:mode', 'btn:code']);
    } else if (g.phase === 'play') {
      if (g.turn === 'red') this.hud.setTurn('It is your turn now', 'red', 'Click a red piece, then a green dot');
      else this.hud.setTurn('Blue is thinking. Please wait', 'blue', 'You cannot move until Blue has moved');
      this.hud.showButtons(g.canUndo ? ['btn:undo', 'btn:new', 'btn:help', 'btn:mode', 'btn:code'] : ['btn:new', 'btn:help', 'btn:mode', 'btn:code']);
    } else {
      this.hud.setTurn(g.winner === 'red' ? 'The game is over. You won' : 'The game is over. Blue won', g.winner === 'red' ? 'red' : 'blue', 'Press New game to play again');
      this.hud.showButtons(g.canUndo ? ['btn:undo', 'btn:new', 'btn:help', 'btn:mode', 'btn:code'] : ['btn:new', 'btn:help', 'btn:mode', 'btn:code']);
    }
    this.hud.setButtonStatus('btn:new', g.phase === 'setup' ? 'No move played yet' : progress);
    this.hud.setButtonStatus('btn:start', g.phase === 'setup' ? 'The battle has not started' : 'The battle is running');
    const fmt = (list: Piece[]) => list.map((p) => pieceName(p));
    this.hud.setCaptured(fmt(g.captured.red), fmt(g.captured.blue));
  }

  // ------------------------------------------------------------- buttons

  shuffle(): void {
    if (this.game.phase !== 'setup') {
      this.hud.say('Shuffling only works before the battle starts.', 'advice');
      return;
    }
    this.clearSelection();
    this.game.placeArmy('red');
    this.syncPieces();
    this.hud.say('Shuffled! 🎲 Your flag is on the back row with bombs around it. Shuffle again or start the battle.', 'good');
    this.onChange?.();
  }

  start(): void {
    if (this.game.phase !== 'setup') return;
    this.clearSelection();
    this.clearMoveArrow();
    this.game.start();
    this.paintBoard();
    this.updateHud();
    this.hud.clearLog();
    this.hud.say('⚔️ The battle begins! Red moves first. Click one of your pieces, then click a green dot.', 'good');
    this.onChange?.();
  }

  newGame(): void {
    this.clearSelection();
    this.busy = false;
    this.clearMoveArrow();
    this.game.reset();
    this.sheet.graph.batchUpdate(() => {
      for (const cell of this.pieceCells.values()) this.sheet.graph.removeCells([cell], false);
      this.pieceCells.clear();
      this.pieceKeys.clear();
    });
    this.paintBoard();
    this.syncPieces();
    this.updateHud();
    this.hud.clearLog();
    this.hud.say('New game! 🆕 Arrange your army, then press "Start the battle!"', 'info');
    this.onChange?.();
  }

  /** Used by code cells: move for Red if it is legal right now. */
  codeMove(fromAddr: string, toAddr: string): string {
    const from = this.posOf(fromAddr);
    const to = this.posOf(toAddr);
    if (!from || !to) return 'Use board addresses like B7 and B6.';
    if (this.busy) return 'Pieces are still moving, try again in a moment.';
    if (this.game.phase !== 'play') return 'The battle has not started.';
    if (this.game.turn !== 'red') return "It is Blue's turn.";
    const reason = this.game.explain(from, to);
    if (reason) return reason;
    this.clearSelection();
    void this.playMove(from, to, 'red');
    return `Moving ${fromAddr} → ${toAddr}`;
  }

  isBusy(): boolean {
    return this.busy;
  }
}
