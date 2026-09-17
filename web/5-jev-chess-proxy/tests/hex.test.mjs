// Tests for games/hex.js
import hex from '../games/hex.js';

let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`);
  }
}

// --- Test 1: newGame -> 49 legal moves, plain JSON state ---------------------
{
  const s = hex.newGame();
  const moves = hex.legalMoves(s);
  check('newGame: 49 legal moves', moves.length === 49, `got ${moves.length}`);
  check('newGame: turn is w', s.turn === 'w', `got ${s.turn}`);
  check('newGame: over is null', s.over === null);
  const sJson = JSON.parse(JSON.stringify(s));
  check('newGame: state is plain JSON', sJson.turn === 'w' && sJson.over === null && Object.keys(sJson.grid).length === 49);
  const keys = moves.map((m) => m.key);
  check('newGame: keys look like r1c1..r7c7', keys.includes('r1c1') && keys.includes('r7c7') && keys.every((k) => /^r\d+c\d+$/.test(k)));
  check('newGame: every move has a label', moves.every((m) => typeof m.label === 'string' && m.label.length > 0));
  check('module id/name', hex.id === 'hex' && hex.name === 'Hex');
}

// --- Test 2: 200 random playouts terminate with over set ---------------------
{
  let maxLegal = 0;
  let allTerminated = true;
  let noExceptions = true;
  const winners = { w: 0, b: 0 };
  try {
    for (let i = 0; i < 200; i++) {
      const s = hex.newGame();
      let guard = 0;
      while (!s.over && guard++ < 1000) {
        const moves = hex.legalMoves(s);
        if (moves.length > maxLegal) maxLegal = moves.length;
        if (!moves.length) { allTerminated = false; break; }
        const mv = moves[Math.floor(Math.random() * moves.length)];
        hex.applyMove(s, mv);
      }
      if (!s.over) allTerminated = false;
      else if (s.over.startsWith('White')) winners.w++;
      else winners.b++;
    }
  } catch (e) {
    noExceptions = false;
    console.log('  playout exception:', e.message);
  }
  check('playouts: no exceptions', noExceptions);
  check('playouts: all 200 terminate with over set', allTerminated);
  check('playouts: max legal moves <= 255', maxLegal <= 255, `got ${maxLegal}`);
  check('playouts: max legal moves seen equals 49 (board size)', maxLegal === 49, `got ${maxLegal}`);
  console.log(`  playout stats: white=${winners.w} black=${winners.b}, max legal moves observed = ${maxLegal}`);
}

// --- Test 3: connectivity — chains missing one cell --------------------------
// Odd-r neighbors:
//   even r: (r-1,c-1),(r-1,c),(r,c-1),(r,c+1),(r+1,c-1),(r+1,c)
//   odd  r: (r-1,c),(r-1,c+1),(r,c-1),(r,c+1),(r+1,c),(r+1,c+1)
{
  // White top-to-bottom: r1c3, r2c3, r3c3, r4c4, r5c4, r6c4 — missing r7c4.
  // r1c3(odd)->r2c3 ✓, r2c3(even)->r3c3 ✓, r3c3(odd)->r4c4 ✓,
  // r4c4(even)->r5c4 ✓, r5c4(odd)->r6c4 ✓, r6c4(even)->r7c4 ✓ (bottom row).
  const s = hex.newGame();
  s.turn = 'w';
  for (const k of ['r1c3', 'r2c3', 'r3c3', 'r4c4', 'r5c4', 'r6c4']) s.grid[k] = 'w';
  hex.applyMove(s, { key: 'r5c1' }); // decoy move far from the chain
  check('white chain: decoy move does not win', s.over === null, `got ${s.over}`);
  const s2 = hex.newGame();
  s2.turn = 'w';
  for (const k of ['r1c3', 'r2c3', 'r3c3', 'r4c4', 'r5c4', 'r6c4']) s2.grid[k] = 'w';
  hex.applyMove(s2, { key: 'r7c4' });
  check('white chain: r7c4 completes top-bottom', s2.over === 'White wins — connected top to bottom', `got ${s2.over}`);
  check('white chain: over freezes further moves', (hex.applyMove(s2, { key: 'r1c1' }), s2.grid['r1c1'] === 0));
  check('white chain: legalMoves empty once over', hex.legalMoves(s2).length === 0);
}
{
  // Black left-to-right straight along even row 4: r4c1..r4c6, missing r4c7.
  const s = hex.newGame();
  s.turn = 'b';
  for (const k of ['r4c1', 'r4c2', 'r4c3', 'r4c4', 'r4c5', 'r4c6']) s.grid[k] = 'b';
  hex.applyMove(s, { key: 'r4c7' });
  check('black chain: r4c7 completes left-right', s.over === 'Black wins — connected left to right', `got ${s.over}`);
}
{
  // Negative: white line that stops short of the bottom row is not a win.
  const s = hex.newGame();
  s.turn = 'w';
  for (const k of ['r1c3', 'r2c3', 'r3c3']) s.grid[k] = 'w';
  hex.applyMove(s, { key: 'r4c3' });
  check('white line stopped at row 4 is not a win', s.over === null, `got ${s.over}`);
}

// --- Test 4: offset-layout neighbor correctness via flood fill ---------------
{
  // Chain relying on BOTH even-row and odd-row up-neighbor offsets:
  // r1c2 -> r2c3 : r2 is even, up-neighbors are r1c1, r1c2  (so r1c2~r2c3) ✓
  // r2c3 -> r3c3 : r3 is odd,  up-neighbors are r2c3, r2c4  ✓
  // r3c3 -> r4c4 : r4 is even, up-neighbors are r3c3, r3c4  ✓
  // r4c4 -> r5c4 : r5 is odd,  up-neighbors are r4c4, r4c5  ✓
  // r5c4 -> r6c4 : r6 is even, up-neighbors are r5c3, r5c4  ✓
  // r6c4 -> r7c4 : r7 is odd,  up-neighbors are r6c4, r6c5  ✓ (bottom row)
  // If the even/odd offset rows were swapped, the r1c2~r2c3 and r3c3~r4c4
  // links would break and this chain would never connect.
  const s = hex.newGame();
  s.turn = 'w';
  for (const k of ['r1c2', 'r2c3', 'r3c3', 'r4c4', 'r5c4', 'r6c4']) s.grid[k] = 'w';
  hex.applyMove(s, { key: 'r7c4' });
  check('offset layout: even/odd zigzag chain r1c2..r7c4 connects', s.over === 'White wins — connected top to bottom', `got ${s.over}`);

  // Straight right-edge column r1c7..r7c7 (vertical links valid on both
  // parity rows).
  const s2 = hex.newGame();
  s2.turn = 'w';
  for (const k of ['r1c7', 'r2c7', 'r3c7', 'r4c7', 'r5c7', 'r6c7']) s2.grid[k] = 'w';
  hex.applyMove(s2, { key: 'r7c7' });
  check('offset layout: right-edge column chain connects', s2.over === 'White wins — connected top to bottom', `got ${s2.over}`);

  // Black chain mixing parity rows: r2c1, r2c2, r3c2, r4c3, r4c4, r4c5, r4c6, r4c7.
  // r2c2(even)->r3c2 via r3's up-neighbor r2c2 ✓; r3c2(odd)->r4c3 via r4's
  // up-neighbor r3c3? No: r4 even up-neighbors are r3c3, r3c4 — but r3c2 is
  // ODD: its down-neighbors include r4c2, r4c3 ✓.
  const s3 = hex.newGame();
  s3.turn = 'b';
  for (const k of ['r2c1', 'r2c2', 'r3c2', 'r4c3', 'r4c4', 'r4c5', 'r4c6']) s3.grid[k] = 'b';
  hex.applyMove(s3, { key: 'r4c7' });
  check('offset layout: black zigzag chain wins left-right', s3.over === 'Black wins — connected left to right', `got ${s3.over}`);

  // Negative: r1c7 and r2c6 are NOT neighbors (r2 even up-neighbors are
  // r1c5, r1c6), so this "chain" with the gap unfilled must not win.
  const s4 = hex.newGame();
  s4.turn = 'w';
  for (const k of ['r1c7', 'r2c6', 'r3c6', 'r4c5', 'r5c5', 'r6c5']) s4.grid[k] = 'w';
  // r2c6~r1c7 broken; r2c6(odd? no, even) down: r3c5, r3c6 ✓; r3c6(odd) down:
  // r4c6, r4c7 — NOT r4c5. So also broken at r3c6~r4c5. Fill the real links'
  // missing pieces as 'w' except keep r1c7 isolated from r2c6: add r2c7? That
  // would connect r1c7(r2c7 odd up: r2c7? r1c7~r2c7: r2c7 even up = r1c6, r1c7 ✓).
  // Keep it simple: verify the as-is position is NOT a win.
  s4.grid['r4c5'] = 'w'; // already set
  hex.applyMove(s4, { key: 'r7c5' });
  check('offset layout: non-adjacent diagonal pair does not connect', s4.over === null, `got ${s4.over}`);
}

// --- Test 5: promptState JSON-safe, instructions non-empty -------------------
{
  const s = hex.newGame();
  hex.applyMove(s, { key: 'r3c5' });
  const ps = hex.promptState(s, 'w');
  const j = JSON.parse(JSON.stringify(ps));
  check('promptState: JSON round-trips', j.turn === 'b' && j.grid.length === 7 && j.grid[0].length === 7);
  check('promptState: row 0 is the top row', j.grid[0][0] === 0 && j.grid[2][4] === 'w');
  check('promptState: values only w/b/0', j.grid.flat().every((v) => v === 'w' || v === 'b' || v === 0));
  const ins = hex.promptInstructions(s, 'w');
  check('promptInstructions: non-empty string', typeof ins === 'string' && ins.length > 20);
  check('promptInstructions: mentions all four edges', /top/i.test(ins) && /bottom/i.test(ins) && /left/i.test(ins) && /right/i.test(ins));
  check('promptInstructions: asks for exactly one choice key', /exactly one choice key/.test(ins));
  check('moveLabel', hex.moveLabel({ key: 'r3c5', label: 'r3c5' }) === 'r3c5' && hex.moveLabel(null) === '');
}

// --- Guard: full board with no winner yields a single pass move --------------
// (Unreachable in real play — a full hex board always contains a connection —
// so the guard is exercised mechanically.)
{
  const s = hex.newGame();
  for (const k of Object.keys(s.grid)) s.grid[k] = 'x';
  s.over = null;
  const moves = hex.legalMoves(s);
  check('no empty cells + no winner: falls back to one pass move', moves.length === 1 && moves[0].key === 'pass' && moves[0].label === 'Pass');
  const s2 = hex.newGame();
  hex.applyMove(s2, { key: 'r1c1' });
  hex.applyMove(s2, { key: 'r1c1' }); // occupied: must be a no-op
  check('occupied move is a no-op', s2.grid['r1c1'] === 'w' && s2.turn === 'b');
}

console.log('');
if (failures) {
  console.log(`${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('All tests passed.');
}
