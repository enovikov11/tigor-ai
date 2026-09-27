// Long Chess engine — pure logic, no DOM. UMD (browser global + CommonJS for Node tests).
//
// Board: 10x10 (100 squares). Each side starts with 10 pieces:
//   rank 9 (bottom) — white rooks, rank 8 — white pawns (advance up)
//   rank 0 (top)    — black rooks, rank 1 — black pawns (advance down)
//
// Pieces:
//   R rook  — slides along rank/file, cannot jump
//   P pawn  — 1 step forward; captures 1 diagonal forward; capture promotes to crown
//   C crown — rook slides + one step in any of the 8 directions
//
// Capture race: the side that cannot move (fully blocked) loses.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.LongChess = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIZE = 10, CELLS = 100;
  var FILES = 'abcdefghij';
  var VALUE = { P: 100, R: 500, C: 950 };
  var MATE = 100000;

  var ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var STEP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function idx(r, c) { return r * SIZE + c; }
  function rc(i) { return [i / SIZE | 0, i % SIZE]; }
  function other(s) { return s === 'w' ? 'b' : 'w'; }
  function sq(i) { var p = rc(i); return FILES[p[1]] + (p[0] + 1); }

  function newGame() {
    var board = new Array(CELLS).fill(null);
    for (var c = 0; c < SIZE; c++) {
      board[idx(SIZE - 1, c)] = { p: 'R', side: 'w' };
      board[idx(SIZE - 2, c)] = { p: 'P', side: 'w' };
      board[idx(0, c)] = { p: 'R', side: 'b' };
      board[idx(1, c)] = { p: 'P', side: 'b' };
    }
    return { board: board, turn: 'w', history: [] };
  }

  function cloneState(s) {
    return { board: s.board.slice(), turn: s.turn, history: s.history.slice() };
  }

  // All legal moves for `side` (default: side to move).
  // Move: {from, to, capture, promote}
  function legalMoves(state, side) {
    side = side || state.turn;
    var out = [];
    var b = state.board;
    for (var i = 0; i < CELLS; i++) {
      var pc = b[i];
      if (!pc || pc.side !== side) continue;
      var r = i / SIZE | 0, c = i % SIZE;

      if (pc.p === 'P') {
        var d = side === 'w' ? -1 : 1;
        var fwd = r + d;
        if (fwd >= 0 && fwd < SIZE) {
          if (!b[idx(fwd, c)]) out.push({ from: i, to: idx(fwd, c), capture: false });
          for (var dc = -1; dc <= 1; dc += 2) {
            var cc = c + dc;
            if (cc < 0 || cc >= SIZE) continue;
            var t = idx(fwd, cc);
            if (b[t] && b[t].side !== side) out.push({ from: i, to: t, capture: true, promote: true });
          }
        }
        continue;
      }

      // rook slides
      for (var k = 0; k < ROOK_DIRS.length; k++) {
        var dr = ROOK_DIRS[k][0], ddc = ROOK_DIRS[k][1];
        var rr = r + dr, c2 = c + ddc;
        while (rr >= 0 && rr < SIZE && c2 >= 0 && c2 < SIZE) {
          var ti = idx(rr, c2);
          if (!b[ti]) {
            out.push({ from: i, to: ti, capture: false });
          } else {
            if (b[ti].side !== side) out.push({ from: i, to: ti, capture: true, promote: false });
            break;
          }
          rr += dr; c2 += ddc;
        }
      }
      // crown extra: one step diagonally
      if (pc.p === 'C') {
        for (var s2 = 0; s2 < STEP_DIRS.length; s2++) {
          var er = r + STEP_DIRS[s2][0], ec = c + STEP_DIRS[s2][1];
          if (er < 0 || er >= SIZE || ec < 0 || ec >= SIZE) continue;
          var ei = idx(er, ec);
          if (!b[ei]) out.push({ from: i, to: ei, capture: false });
          else if (b[ei].side !== side) out.push({ from: i, to: ei, capture: true, promote: false });
        }
      }
    }
    return out;
  }

  function applyMove(state, move) {
    var s = cloneState(state);
    var pc = { p: state.board[move.from].p, side: state.board[move.from].side };
    var target = s.board[move.to];
    s.board[move.from] = null;
    if (move.promote) pc.p = 'C';
    s.board[move.to] = pc;
    s.history = s.history.concat([{
      from: move.from, to: move.to, piece: pc.p, side: state.turn,
      captured: target ? target.p : null
    }]);
    s.turn = other(s.turn);
    return s;
  }

  // Game over when the side to move has no legal move (fully blocked) — that side loses.
  function gameOver(state) {
    if (legalMoves(state).length) return { over: false };
    return { over: true, winner: other(state.turn), reason: 'blocked' };
  }

  // Signed material + pawn-advance, from the perspective of the side to move.
  function evaluate(state) {
    var w = 0, b = 0;
    for (var i = 0; i < CELLS; i++) {
      var pc = state.board[i];
      if (!pc) continue;
      var v = VALUE[pc.p];
      if (pc.p === 'P') {
        var r = i / SIZE | 0;
        v += (pc.side === 'w' ? (SIZE - 2) - r : r - 1) * 4;
      }
      if (pc.side === 'w') w += v; else b += v;
    }
    return state.turn === 'w' ? w - b : b - w;
  }

  function orderMoves(moves, board) {
    function capScore(m) {
      var t = board[m.to];
      return t ? (t.p === 'C' ? 300 : t.p === 'R' ? 500 : 100) : 0;
    }
    return moves.slice().sort(function (a, b) { return capScore(b) - capScore(a); });
  }

  function negamax(state, depth, alpha, beta) {
    var moves = legalMoves(state);
    if (!moves.length) return -MATE - depth; // side to move is blocked -> loses
    if (depth <= 0) return evaluate(state);
    var best = -Infinity;
    moves = orderMoves(moves, state.board);
    for (var i = 0; i < moves.length; i++) {
      var sc = -negamax(applyMove(state, moves[i]), depth - 1, -beta, -alpha);
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // depth: 1 easy, 2 normal, 3 hard. rng injectable for tests.
  function bestMove(state, depth, rng) {
    rng = rng || Math.random;
    var moves = legalMoves(state);
    if (!moves.length) return null;
    moves = orderMoves(moves, state.board);
    var alpha = -Infinity;
    var scored = [];
    for (var i = 0; i < moves.length; i++) {
      var sc = -negamax(applyMove(state, moves[i]), depth - 1, -Infinity, -alpha);
      scored.push({ m: moves[i], sc: sc });
      if (sc > alpha) alpha = sc;
    }
    // pick among EXACT best moves; on ties add light variety
    var top = scored.filter(function (x) { return x.sc === alpha; });
    if (top.length > (depth <= 1 ? 3 : 1)) top = top.slice(0, depth <= 1 ? 3 : 1);
    return top[Math.floor(rng() * top.length)].m;
  }

  function moveLabel(state, move) {
    var pc = state.board[move.from];
    var lbl = (pc ? pc.p : '?') + ' ' + sq(move.from) + (move.capture ? '\u00d7' : '\u2013') + sq(move.to);
    if (move.promote) lbl += ' =C';
    return lbl;
  }

  return {
    SIZE: SIZE, CELLS: CELLS, FILES: FILES,
    idx: idx, rc: rc, other: other, sq: sq,
    newGame: newGame, cloneState: cloneState,
    legalMoves: legalMoves, applyMove: applyMove,
    gameOver: gameOver, evaluate: evaluate,
    bestMove: bestMove, moveLabel: moveLabel
  };
});
