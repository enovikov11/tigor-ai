// Tests for games/othello.js — run via nix node, no DOM required.
import assert from 'node:assert/strict';
import othello from '../games/othello.js';

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log('ok ' + passed + ' - ' + name);
}

// --- (1) newGame -> exactly 4 legal moves for 'b' ---
ok('newGame gives black exactly 4 legal moves', () => {
  const state = othello.newGame();
  const moves = othello.legalMoves(state);
  assert.equal(moves.length, 4);
  assert.deepEqual(
    moves.map((m) => m.key).sort(),
    ['r2c3', 'r3c2', 'r4c5', 'r5c4']
  );
  for (const m of moves) {
    assert.equal(m.label, m.key);
    assert.match(m.key, /^r[1-8]c[1-8]$/);
  }
  assert.equal(state.turn, 'b');
  assert.equal(state.over, null);
  // state must be plain JSON (no functions, no cycles)
  const s = JSON.parse(JSON.stringify(state));
  assert.equal(s.board[2][2], 'w');
  assert.equal(s.board[3][3], 'w');
  assert.equal(s.board[2][3], 'b');
  assert.equal(s.board[3][2], 'b');
});

// --- (2) 200 random playouts terminate; track max legal moves seen ---
ok('200 random playouts terminate with state.over set', () => {
  let maxMoves = 0;
  for (let i = 0; i < 200; i += 1) {
    const state = othello.newGame();
    let guard = 0;
    while (!state.over && guard < 500) {
      const moves = othello.legalMoves(state);
      maxMoves = Math.max(maxMoves, moves.length);
      assert.ok(moves.length >= 1 && moves.length <= 255, 'move count out of bounds');
      const mv = moves[Math.floor(Math.random() * moves.length)];
      othello.applyMove(state, mv);
      guard += 1;
    }
    assert.ok(guard < 500, 'playout did not terminate');
    assert.ok(typeof state.over === 'string' && state.over.length > 0, 'state.over not set');
    assert.match(state.over, /^(White wins|Black wins) \d{1,2}-\d{1,2}|Draw \d{1,2}-\d{1,2}$/);
    const total = state.board.flat().filter((v) => v !== 0).length;
    assert.ok(total >= 4, 'board should have discs');
  }
  assert.ok(maxMoves <= 255, 'max legal moves exceeded 255');
  console.log('  max legal moves seen: ' + maxMoves + ' (<=255)');
});

// --- (3) known position: r4c5 (e6) flips exactly one disc, count 2->3 ---
ok('opening move r4c5 flips exactly one disc', () => {
  const state = othello.newGame();
  const before = { w: 2, b: 2 };
  const moves = othello.legalMoves(state);
  const mv = moves.find((m) => m.key === 'r4c5');
  assert.ok(mv, 'r4c5 must be a legal black move');
  assert.deepEqual(mv.flips, ['r4c4']);
  assert.equal(state.board[3][3], 'w'); // disc that will flip
  othello.applyMove(state, mv);
  const after = { w: 0, b: 0 };
  for (const v of state.board.flat()) {
    if (v === 'w') after.w += 1;
    else if (v === 'b') after.b += 1;
  }
  assert.equal(before.b, 2);
  // r4c5: black places 1 disc + flips r4c4 (w->b) => black 2 -> 4, white 2 -> 1
  assert.equal(after.b, 4, 'black went 2 -> 4 (1 placed + 1 flipped)');
  assert.equal(after.w, 1, 'white went 2 -> 1');
  assert.equal(state.board[3][3], 'b', 'flipped disc changed w -> b');
  assert.equal(state.turn, 'w');
  assert.equal(state.over, null);
});

// --- (4) pass handling: side with no legal moves ---
ok('pass handling: legalMoves returns pass, applyMove keeps board and flips turn', () => {
  const state = othello.newGame();
  // Force a position where White has no disc at all -> no legal flips.
  for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) state.board[r][c] = 0;
  state.board[0][0] = 'b';
  state.board[0][1] = 'b';
  state.board[1][0] = 'b';
  state.turn = 'w';
  state.passes = 0;
  state.over = null;
  const before = state.board.map((row) => row.slice());
  const moves = othello.legalMoves(state);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].key, 'pass');
  assert.equal(moves[0].label, 'Pass (no flips)');
  othello.applyMove(state, { key: 'pass' });
  assert.deepEqual(state.board, before, 'board unchanged by pass');
  assert.equal(state.turn, 'b', 'turn flipped after pass');
  assert.equal(state.over, null, 'game continues after a single pass');
  // now black also has no move? black surrounds an empty board edge:
  // black moves: r2c3 flips r1c1? (1,2) dir(0,-1)->(1,1) empty... construct next pass too:
  const moves2 = othello.legalMoves(state);
  assert.deepEqual(moves2, [{ key: 'pass', label: 'Pass (no flips)' }], 'black also stuck');
  othello.applyMove(state, { key: 'pass' });
  assert.equal(state.over, 'Black wins 3-0');
});

// --- (5) game over: board full -> over with correct winner string ---
ok('full board triggers game over with correct winner string', () => {
  const board = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => ((r * 8 + c) % 5 !== 0 ? 'b' : 'w'))
  );
  const state = { board, turn: 'w', over: null, passes: 1 };
  const counts = state.board.flat().reduce(
    (a, v) => ((a[v] += 1), a),
    { w: 0, b: 0 }
  );
  othello.applyMove(state, { key: 'pass' }); // board full -> over
  assert.equal(state.over, 'Black wins ' + counts.b + '-' + counts.w);
  // draw case
  const draw = {
    board: Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => ((r + c) % 2 === 0 ? 'w' : 'b'))
    ),
    turn: 'b',
    over: null,
    passes: 0,
  };
  othello.applyMove(draw, { key: 'pass' });
  assert.equal(draw.over, 'Draw 32-32');
  // after over, applyMove is a no-op
  const snap = draw.board.map((row) => row.slice());
  othello.applyMove(draw, { key: 'r1c1' });
  assert.deepEqual(draw.board, snap);
});

// --- (6) promptState JSON-safe, instructions non-empty ---
ok('promptState is JSON-safe and instructions are non-empty', () => {
  const state = othello.newGame();
  const ps = othello.promptState(state, 'b');
  const round = JSON.parse(JSON.stringify(ps));
  assert.deepEqual(round, ps);
  assert.equal(round.turn, 'b');
  assert.equal(round.board.length, 8);
  assert.equal(round.board[0].length, 8);
  assert.ok(['w', 'b', 0].includes(round.board[0][0]));
  assert.deepEqual(round.board[2][2], 'w');
  assert.equal(typeof ps.over, 'object' /* null */);
  const inst = othello.promptInstructions(state, 'w');
  assert.ok(typeof inst === 'string' && inst.length > 100);
  assert.ok(inst.includes('answer with exactly one choice key'));
  assert.ok(inst.includes('r<1-8>c<1-8>'));
  // moveLabel
  assert.equal(othello.moveLabel({ key: 'r4c5' }), 'r4c5');
  assert.equal(othello.moveLabel({ key: 'pass' }), 'Pass');
});

// --- extra contract checks: illegal move ignored, module shape ---
ok('illegal moves ignored; module shape', () => {
  const state = othello.newGame();
  othello.applyMove(state, { key: 'r1c1' }); // not legal
  othello.applyMove(state, { key: 'nonsense' });
  othello.applyMove(state, { key: 'r5c3' }); // occupied
  assert.equal(state.turn, 'b');
  assert.equal(state.over, null);
  assert.deepEqual(othello.legalMoves(state).map((m) => m.key).sort(), ['r2c3', 'r3c2', 'r4c5', 'r5c4']);
  assert.equal(othello.id, 'othello');
  assert.equal(othello.name, 'Othello');
  for (const fn of ['newGame', 'legalMoves', 'applyMove', 'promptState', 'promptInstructions', 'moveLabel', 'render']) {
    assert.equal(typeof othello[fn], 'function', fn + ' must be a function');
  }
});

console.log('all ' + passed + ' othello tests passed');
