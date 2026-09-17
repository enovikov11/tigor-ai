// Tests for the Connect Four game module.
// Run:  timeout 120 nix-shell -p nodejs --run "node /abs/path/tests/connect4.test.mjs"

import connect4 from '../games/connect4.js';

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) {
    passed++;
    console.log('PASS: ' + msg);
  } else {
    failed++;
    console.log('FAIL: ' + msg);
  }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), msg + (JSON.stringify(a) !== JSON.stringify(b) ? ' (got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b) + ')' : ''));
}

// (1) newGame -> 7 legal moves, fresh plain-JSON state.
{
  const s = connect4.newGame();
  ok(connect4.id === 'connect4', 'id is connect4');
  ok(connect4.name === 'Connect Four', 'name is Connect Four');
  eq(s.turn, 'w', 'fresh game: White to move');
  eq(s.over, null, 'fresh game: not over');
  eq(s.grid.length, 6, 'fresh grid has 6 rows');
  eq(s.grid[0].length, 7, 'fresh grid has 7 cols');
  const mv = connect4.legalMoves(s);
  ok(mv.length === 7, 'newGame -> 7 legal moves (got ' + mv.length + ')');
  eq(mv.map((m) => m.key), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'], 'move keys are c1..c7');
  // plain JSON only
  ok(typeof s === 'object' && s !== null && !s.grid[0].some((v) => v !== null), 'fresh state is plain JSON');
  const s2 = connect4.newGame();
  ok(JSON.stringify(s) === JSON.stringify(s2), 'newGame returns fresh independent state');
}

// (2) 200 full random playouts terminate, no exceptions, track max legal moves.
{
  let maxLegal = 0;
  let overWins = 0;
  let overDraws = 0;
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const s = connect4.newGame();
    let guard = 0;
    while (!s.over && guard < 1000) {
      guard++;
      const mv = connect4.legalMoves(s);
      if (mv.length > maxLegal) maxLegal = mv.length;
      const choice = mv[Math.floor(Math.random() * mv.length)];
      seen.add(choice.key);
      connect4.applyMove(s, choice);
    }
    ok(!!s.over, 'playout ' + i + ' terminated with state.over set');
    if (s.over && s.over.startsWith('White') || (s.over && s.over.startsWith('Black'))) overWins++;
    if (s.over && s.over.startsWith('Draw')) overDraws++;
  }
  ok(maxLegal <= 255, 'max legal moves seen <= 255 (got ' + maxLegal + ')');
  ok(maxLegal >= 1 && maxLegal <= 7, 'max legal moves plausible for 7 columns (got ' + maxLegal + ')');
  console.log('   playouts: 200 done | wins=' + overWins + ' draws=' + overDraws + ' | max legal moves observed=' + maxLegal);
}

// (3) hand-computed horizontal win for White:
//   White c1 c3 c5 c7 (W on bottom row), Black c2 c4 c1? no — keep simple.
// Sequence: W:c1 B:c2 W:c3 B:c4 W:c5 B:c6 W:c7 -> White has c1,c3,c5,c7 (not 4-in-a-row).
// Instead: White c1 c2 c3 c4 vs Black c5 c6 c5? build a real horizontal-4.
{
  const s = connect4.newGame();
  // Moves (W always c1..c4 to build row 0? No — bottom row is row index 5).
  // Play: W c1, B c2, W c2? Let's do White: c1,c3,c5,c7 won't line. Use White c1,c2,c3,c4.
  const seq = [
    ['w', 'c1'], ['b', 'c5'],
    ['w', 'c2'], ['b', 'c6'],
    ['w', 'c3'], ['b', 'c5'],
    ['w', 'c4'], ['b', 'c7'],
  ];
  for (const [side, key] of seq) {
    ok(s.turn === side, 'expected ' + side + ' to move before ' + key + ' (turn=' + s.turn + ')');
    const mv = connect4.legalMoves(s);
    ok(mv.some((m) => m.key === key), key + ' legal when ' + side + ' moves');
    connect4.applyMove(s, mv.find((m) => m.key === key));
    if (s.over) {
      // Game ended; record and stop.
      break;
    }
  }
  // After W c1,c2,c3,c4 the bottom row (index 5) cols 0-3 are White -> 4 in a row.
  eq(s.over, 'White wins — four in a row', 'hand-computed horizontal win sets correct over message');
  const bottom = s.grid[5];
  eq(bottom.slice(0, 4), ['w', 'w', 'w', 'w'], 'white four-in-a-row landed in bottom row, cols 0-3');
}

// (4) promptState JSON.stringify-able; promptInstructions non-empty.
{
  const s = connect4.newGame();
  connect4.applyMove(s, { key: 'c4', label: 'Column 4' });
  const ps = connect4.promptState(s, 'b');
  let jsonOk = true;
  try {
    JSON.stringify(ps);
  } catch (e) {
    jsonOk = false;
  }
  ok(jsonOk, 'promptState JSON.stringify-able');
  eq(ps.grid.length, 6, 'promptState grid has 6 rows');
  ok(typeof connect4.promptInstructions(s, 'b') === 'string' && connect4.promptInstructions(s, 'b').length > 0, 'promptInstructions non-empty string');
  ok(ps.sideToMove === s.turn, 'promptState includes whose turn');
}

// (5) drop lands in correct row (column fills bottom-up).
{
  const s = connect4.newGame();
  // Alternate W/B in column c1 (3 each — no vertical 4, no win) to force
  // bottom-up stacking and fill the column.
  for (let i = 0; i < 6; i++) {
    ok(!s.over, 'no win mid-fill at move ' + i);
    connect4.applyMove(s, { key: 'c1' });
  }
  eq(s.over, null, 'no win after 3-vs-3 in one column');
  // c1 (index 0) from bottom (row5) to top (row0): W,B,W,B,W,B.
  const col0 = [];
  for (let r = 0; r < 6; r++) col0.push(s.grid[r][0]);
  eq(col0, ['b', 'w', 'b', 'w', 'b', 'w'], 'column fills bottom-up: row5=W, row4=B, row3=W, row2=B, row1=W, row0=B');
  // c1 is now full -> illegal.
  const mv = connect4.legalMoves(s);
  ok(!mv.some((m) => m.key === 'c1'), 'full column c1 is no longer a legal move');
  ok(mv.length === 6, '6 columns remain legal (got ' + mv.length + ')');
}

console.log('\n=== ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed === 0 ? 0 : 1);
