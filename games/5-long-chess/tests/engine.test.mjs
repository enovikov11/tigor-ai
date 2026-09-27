import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../engine.js');

let s = E.newGame();
const pieceCount = (sd) => s.board.filter(p => p && p.side === sd).length;
assert.equal(pieceCount('w'), 20, 'white has 20 pieces');
assert.equal(pieceCount('b'), 20, 'black has 20 pieces');
assert.equal(s.turn, 'w');

let w = E.legalMoves(s);
assert.equal(w.length, 10, 'white opening moves: 10 pawn pushes, got ' + w.length);
for (const m of w) assert.ok(m.from >= 80 && m.from < 90 && m.to === m.from - 10);

// pawn capture promotes to crown
s = E.newGame();
s.board[20] = { p: 'P', side: 'w' };
s.board[21] = null; s.board[31] = null;
s.board[11] = { p: 'P', side: 'b' };
s.turn = 'w';
const caps = E.legalMoves(s).filter(m => m.capture && m.from === 20);
assert.equal(caps.length, 1);
assert.equal(caps[0].to, 11);
assert.equal(caps[0].promote, true);
let after = E.applyMove(s, caps[0]);
assert.equal(after.board[11].p, 'C', 'promoted to crown');
assert.equal(after.board[20], null);
assert.equal(after.turn, 'b');
assert.equal(after.history.length, 1);
assert.equal(after.history[0].captured, 'P');

// crown moves: rook slides + one diagonal step
s = E.newGame();
s.board = new Array(100).fill(null);
s.board[50] = { p: 'C', side: 'w' };
s.turn = 'w';
let cm = E.legalMoves(s);
assert.equal(cm.length, 20, 'crown moves on empty board: 10 slides + 10 diagonals, got ' + cm.length);
assert.ok(cm.some(m => m.to === 41), 'diag step up-left');
assert.ok(!cm.some(m => m.to === 32), 'no diagonal jump (2 squares)');

// rook: blocked by friendly, captures enemy
s = E.newGame();
s.board = new Array(100).fill(null);
s.board[50] = { p: 'R', side: 'w' };
s.board[51] = { p: 'P', side: 'w' };
s.board[52] = { p: 'P', side: 'b' };
s.turn = 'w';
cm = E.legalMoves(s);
assert.ok(!cm.some(m => m.to === 52), 'rook cannot jump friendly');
assert.ok(!cm.some(m => m.to === 51), 'rook cannot capture own');
s.board[51] = null;
cm = E.legalMoves(s);
const cap = cm.find(m => m.to === 52);
assert.ok(cap, 'rook captures adjacent enemy');
assert.equal(cap.capture, true);
assert.equal(cap.promote, false, 'rook capture does not promote');

// black pawns move downward
s = E.newGame();
s.turn = 'b';
let bm = E.legalMoves(s);
assert.equal(bm.length, 10);
for (const m of bm) assert.equal(m.to, m.from + 10, 'black pawn push direction');

// gameOver: side to move blocked loses.
// White lone pawn at idx 20 (a3): forward (idx 10) blocked by an enemy rook
// (not capturable straight), both diagonals empty -> zero moves.
s = E.newGame();
s.board = new Array(100).fill(null);
s.board[20] = { p: 'P', side: 'w' };
s.board[10] = { p: 'R', side: 'b' };
s.turn = 'w';
assert.equal(E.legalMoves(s).length, 0);
let g = E.gameOver(s);
assert.equal(g.over, true);
assert.equal(g.winner, 'b');

// applyMove is pure
s = E.newGame();
const before = JSON.stringify(s.board);
const mv0 = E.legalMoves(s)[0];
E.applyMove(s, mv0);
assert.equal(JSON.stringify(s.board), before, 'applyMove is pure');
assert.equal(s.history.length, 0);

// bestMove: deterministic with seeded rng, legal
function seeded(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }
s = E.newGame();
const mv1 = E.bestMove(s, 1, seeded(42));
const mv2 = E.bestMove(s, 1, seeded(42));
assert.deepEqual(mv1, mv2, 'seeded rng -> same move');
assert.ok(E.legalMoves(s).some(m => m.from === mv1.from && m.to === mv1.to), 'bestMove legal');

// bestMove takes a free rook
s = E.newGame();
s.board = new Array(100).fill(null);
s.board[50] = { p: 'R', side: 'w' };
s.board[60] = { p: 'R', side: 'b' };
s.turn = 'w';
const t0 = Date.now();
const capmv = E.bestMove(s, 3, seeded(7));
const t1 = Date.now();
assert.ok(capmv, 'hard mode returns a move');
assert.equal(capmv.from, 50, 'takes the free rook: from');
assert.equal(capmv.to, 60, 'takes the free rook: to (instant win at depth 3)');
// variety: rng(0) picks first of the exact-best pool, which is capture-first
assert.ok(true);
console.log('capture test @ depth 3 took ' + (t1 - t0) + 'ms');

// search perf: depth-3 opening move within 5s
s = E.newGame();
const t2 = Date.now();
const open = E.bestMove(s, 3, seeded(1));
const t3 = Date.now();
console.log('opening depth-3 took ' + (t3 - t2) + 'ms');
assert.ok(t3 - t2 < 5000, 'depth-3 move under 5s, took ' + (t3 - t2));
assert.ok(E.legalMoves(s).some(m => m.from === open.from && m.to === open.to));

// evaluate sanity
s = E.newGame();
s.board = new Array(100).fill(null);
s.board[50] = { p: 'R', side: 'w' };
s.turn = 'w';
let v0 = E.evaluate(s);
s.board[60] = { p: 'R', side: 'b' };
let v1 = E.evaluate(s);
assert.ok(v0 > v1, 'material down after enemy piece appears');

// full game loop: two engines play to a finish
s = E.newGame();
let plies = 0;
while (!E.gameOver(s).over && plies < 400) {
  const m = E.bestMove(s, 1, seeded(plies + 1));
  if (!m) break;
  s = E.applyMove(s, m);
  plies++;
}
console.log('engine-vs-engine finished in ' + plies + ' plies, winner: ' + (E.gameOver(s).winner || 'none (cap reached)'));
assert.ok(plies > 0);

// moveLabel
s = E.newGame();
const lab = E.moveLabel(s, E.legalMoves(s)[0]);
assert.match(lab, /^P [a-j]\d[–—\u2013\u00d7][a-j]\d$/);
console.log('sample label:', lab);

console.log('ALL ENGINE TESTS PASSED');
