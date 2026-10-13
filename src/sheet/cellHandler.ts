import { VertexHandler, type CellState, type Point, type Rectangle } from '@maxgraph/core';

/**
 * The resize handles of a code cell: maxGraph's own (the small green squares), reduced to the three that keep the
 * block's top-left corner where it is (east, south and south-east), and snapped to whole cells while dragging, so
 * what the preview shows is exactly the shape the block gets.
 */

// maxGraph numbers its sizers like this: 0 NW, 1 N, 2 NE, 3 W, 4 E, 5 SW, 6 S, 7 SE.
const EAST = 4;
const SOUTH = 6;
const SOUTH_EAST = 7;

export class SheetCellHandler extends VertexHandler {
  constructor(
    state: CellState,
    /** The size of one cell, in model units. */
    private readonly unit: { width: number; height: number },
  ) {
    super(state);
  }

  isSizerVisible(index: number): boolean {
    return index === EAST || index === SOUTH || index === SOUTH_EAST;
  }

  union(bounds: Rectangle, dx: number, dy: number, index: number, gridEnabled: boolean, scale: number, tr: Point, constrained: boolean, centered: boolean): Rectangle {
    const result = super.union(bounds, dx, dy, index, gridEnabled, scale, tr, constrained, centered);
    const w = this.unit.width * scale;
    const h = this.unit.height * scale;
    result.width = Math.max(w, Math.round(result.width / w) * w);
    result.height = Math.max(h, Math.round(result.height / h) * h);
    return result;
  }
}
