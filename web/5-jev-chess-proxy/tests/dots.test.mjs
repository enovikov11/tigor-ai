// Tests for the Dots-and-Boxes game module.
import assert from 'node:assert/strict';
import dots from '../games/dots.js';

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log('ok - ' + msg);
}

// ---------- (1) newGame legal moves ----------
// NOTE: the contract's test note says 32, but the contract's own key
// encoding defines 20 h-lines (r1-5 x c1-4) + 20 v-lines (r1-4 x c1-5)
// = 40 lines for a 5x5 dot grid. The key encoding is the authoritative
// spec, so the expected count here is 40.
{
  const s = dots.newGame();
  ok(s && typeof s === 'object', 'newGame returns a plain object');
  const lm = dots.legalMoves(s);
  ok(lm.length === 40, 'newGame: 40 legal moves (got ' + lm.length + ')');
  for (const m of lm) {
    assert.ok(m.key && m.label, 'move has key+label');
  }
  ok(true, 'newGame: all moves have key+label');
  const keys = new Set(lm.map((m) => m.key));
  ok(keys.size === 40, 'newGame: keys are unique');
  ok(s.over === null, 'newGame: over === null');
}

// ---------- (2) 200 random playouts ----------
{
  // deterministic LCG so runs are reproducible
  let seed = 0x1234abcd;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };

  let maxLegal = 0;
  for (let g = 0; g < 200; g++) {
    const s = dots.newGame();
    let guard = 0;
    while (!s.over) {
      assert.ok(guard < 1000, 'game ' + g + ' did not terminate');
      guard++;
      const lm = dots.legalMoves(s);
      assert.ok(lm.length > 0, 'game ' + g + ': legal moves never empty before over');
      assert.ok(lm.length <= 255, 'legal moves <= 255');
      if (lm.length > maxLegal) maxLegal = lm.length;
      const pick = lm[Math.floor(rand() * lm.length)];
      const before = s.turn;
      dots.applyMove(s, pick);
      // invariants
      const claimed = Object.keys(s.boxes).length;
      assert.ok(claimed === s.score.w + s.score.b, 'score consistent with claimed boxes');
      assert.ok(claimed <= 16, 'no more than 16 boxes claimed');
      if (s.over) break;
      const t = s.turn;
      assert.ok(t === 'w' || t === 'b', 'turn is w or b');
      void before;
    }
    ok(true, 'game ' + g + ' terminated with over=' + JSON.stringify(s.over));
    const claimed = Object.keys(s.boxes).length;
    assert.ok(claimed === 16, 'game ' + g + ': total claimed boxes == 16 (got ' + claimed + ')');
    assert.ok(s.over !== null, 'game ' + g + ': state.over set');
    // over string matches score
    const w = s.score.w, b = s.score.b;
    const expect = w === b ? 'Draw ' + w + '-' + b
      : (w > b ? 'White wins ' + w + '-' + b : 'Black wins ' + b + '-' + w);
    assert.ok(s.over === expect, 'game ' + g + ': over string ' + s.over + ' == ' + expect);
  }
  ok(true, 'all 200 playouts: over set, 16 boxes claimed, no exceptions');
  ok(maxLegal <= 255, 'max legal moves ' + maxLegal + ' <= 255');
  console.log('max legal moves seen: ' + maxLegal);
  globalThis.__maxLegal = maxLegal;
}

// ---------- (3) extra-move rule ----------
{
  const s = dots.newGame();
  // Box (1,1) sides: h1-1 (top), h2-1 (bottom), v1-1 (left), v1-2 (right).
  // Draw 3 sides without completing: none of these alone completes a box.
  dots.applyMove(s, { key: 'h1-1' }); // w -> b
  dots.applyMove(s, { key: 'h2-1' }); // b -> w
  dots.applyMove(s, { key: 'v1-1' }); // w -> b
  assert.ok(!s.boxes['1-1'], 'box 1-1 not claimed after 3 sides');
  assert.equal(s.turn, 'b', 'black to move with 3 sides drawn');
  dots.applyMove(s, { key: 'v1-2' }); // black completes box 1-1
  assert.equal(s.turn, 'b', 'extra move: turn unchanged (still b)');
  assert.ok(s.boxes['1-1'] === 'b', 'box 1-1 claimed by b');
  assert.equal(s.score.b, 1, 'black score 1');
  assert.equal(s.over, null, 'game not over yet');
  ok(true, 'extra-move rule: 4th line keeps turn, claims box');
}

// ---------- (4) winner string ----------
{
  // White 12 boxes, Black 3; last box (1,1) has 3 sides drawn, White to move.
  // The only undrawn line is the 4th side, so only White's move remains.
  const s = dots.newGame();
  const wantW = [
    '2-1', '2-2', '2-3', '2-4',
    '3-1', '3-2', '3-3', '3-4',
    '4-1', '4-2', '4-3', '4-4',
  ];
  const wantB = ['1-2', '1-3', '1-4'];
  const all = {};
  for (const bk of wantW) s.boxes[bk] = 'w';
  for (const bk of wantB) s.boxes[bk] = 'b';
  s.score = { w: 12, b: 3 };
  s.turn = 'w';
  // 3 sides of box 1-1 already drawn (do not complete it)
  for (const k of ['h1-1', 'h2-1', 'v1-1']) s.lines[k] = true;
  // fill in the other 39 lines so only v1-2 (4th side of box 1-1) remains
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 4; c++) {
    const k = 'h' + r + '-' + c;
    if (!s.lines[k]) s.lines[k] = true;
  }
  for (let r = 1; r <= 4; r++) for (let c = 1; c <= 5; c++) {
    const k = 'v' + r + '-' + c;
    if (!s.lines[k] && k !== 'v1-2') s.lines[k] = true;
  }
  assert.ok(!s.lines['v1-2'], 'only the 4th side of box 1-1 is undrawn');
  const lm = dots.legalMoves(s);
  assert.equal(lm.length, 1, 'exactly one legal move remains');
  assert.equal(lm[0].key, 'v1-2', 'remaining move is v1-2 (White to play)');
  dots.applyMove(s, lm[0]);
  assert.equal(s.over, 'White wins 13-3', 'over string correct (got ' + s.over + ')');
  assert.ok(s.boxes['1-1'] === 'w', 'last box claimed by White');
  assert.equal(dots.legalMoves(s).length, 0, 'no legal moves after game over');
  ok(true, 'winner: White wins 13-3 forced to end');
}

// ---------- (5) promptState / promptInstructions ----------
{
  const s = dots.newGame();
  dots.applyMove(s, { key: 'h1-1' });
  dots.applyMove(s, { key: 'h2-1' });
  const ps = dots.promptState(s, 'b');
  const parsed = (typeof ps === 'string') ? JSON.parse(ps) : ps; // object or JSON string
  assert.equal(parsed.turn, 'w', 'promptState turn');
  assert.ok(Array.isArray(parsed.lines), 'promptState lines is array');
  assert.ok(Array.isArray(parsed.grid), 'promptState grid is array');
  JSON.stringify(ps); // must be JSON-safe (no throw)
  ok(true, 'promptState is JSON-safe (serializes)');
  const ins = dots.promptInstructions(s, 'b');
  assert.ok(typeof ins === 'string' && ins.length > 0, 'instructions non-empty');
  assert.ok(ins.includes('answer with exactly one choice key'), 'instructions end with choice directive');
  ok(true, 'promptInstructions non-empty');
}

console.log('');
console.log('ALL DOTS TESTS PASSED (' + passed + ' checks)');
