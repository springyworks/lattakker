import { Game, Move, Piece, Pos, rankValue, samePos } from './model';

/**
 * A friendly, slightly greedy opponent for Blue. It only "knows" Red pieces that have been revealed,
 * likes attacking weaker known pieces, probes unknown pieces with mid-rank soldiers and otherwise
 * ambles forward.
 */
export function chooseBlueMove(game: Game, rnd: () => number = Math.random): Move | null {
  const moves = game.allLegalMoves('blue');
  if (moves.length === 0) return null;
  const prev = game.history.length >= 2 ? game.history[game.history.length - 2] : null;

  let best: Move | null = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = scoreMove(game, m, prev?.color === 'blue' ? prev : null) + rnd() * 3;
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

function scoreMove(game: Game, m: Move, prevBlue: { from: Pos; to: Pos } | null): number {
  const piece = game.at(m.from)!;
  const target = game.at(m.to);
  let score = 0;

  if (target) {
    if (target.revealed) {
      const outcome = game.resolveBattle(piece, target);
      if (outcome === 'win') score += 40 + rankValue(target.rank) * 3 + (target.rank === 'F' ? 1000 : 0);
      else if (outcome === 'draw') score += 4;
      else score -= 60;
    } else {
      // Unknown Red piece: braver with mid ranks, careful with the Marshal and the Spy.
      score += 6;
      if (piece.rank === 3) score += 6; // miners happily defuse bombs
      if (piece.rank === 2) score += 3; // scouts are cheap probes
      const v = rankValue(piece.rank);
      if (v >= 8) score -= 8;
      if (piece.rank === 1) score -= 12;
      if (!target.moved) score -= 4; // never-moved pieces are often bombs
    }
  } else {
    // Plain move: creep toward Red, prefer pieces that have not moved yet, avoid shuffling back and forth.
    score += (m.to.row - m.from.row) * 2.5;
    score += distanceGain(game, piece, m);
    if (!piece.moved) score += 1.5;
    if (piece.revealed && rankValue(piece.rank) >= 8) score -= 2;
    if (prevBlue && samePos(prevBlue.to, m.from) && samePos(prevBlue.from, m.to)) score -= 10;
    if (piece.rank === 1) score -= 3;
  }
  return score;
}

function distanceGain(game: Game, piece: Piece, m: Move): number {
  const reds = game.pieces('red');
  if (reds.length === 0) return 0;
  const near = (p: Pos) => Math.min(...reds.map((r) => Math.abs(r.pos.row - p.row) + Math.abs(r.pos.col - p.col)));
  const gain = near(m.from) - near(m.to);
  return rankValue(piece.rank) >= 5 ? gain * 1.5 : gain * 0.5;
}
