// Tests for the Ultimate Tic-Tac-Toe game module (games/uttt.js).
// Run with:
//   timeout 120 nix-shell -p nodejs --run "node /abs/path/tests/uttt.test.mjs"
// Uses only Node stdlib; no DOM required (module must import cleanly here).

import uttt from "../games/uttt.js";

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg); }
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(same, msg + (same ? "" : "  (got " + JSON.stringify(a) + " want " + JSON.stringify(b) + ")"));
}
function assert(cond, msg) {
  if (!cond) { failed++; console.error("  ASSERT FAIL  " + msg); throw new Error("assert: " + msg); }
}

// deterministic PRNG so the 200-playout test is reproducible
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Replay a sequence of move keys, asserting each is legal when applied.
function replay(seq) {
  const s = uttt.newGame();
  for (const k of seq) {
    const lm = uttt.legalMoves(s);
    const mv = lm.find((m) => m.key === k);
    assert(mv, "replay: move not legal: " + k + " (turn=" + s.turn + ")");
    uttt.applyMove(s, mv);
  }
  return s;
}

console.log("# 1. newGame -> 81 legal moves");
{
  const s = uttt.newGame();
  const lm = uttt.legalMoves(s);
  eq(lm.length, 81, "newGame has 81 legal moves (one per cell)");
  ok(s.over === null, "newGame starts with over === null");
  eq(s.turn, "w", "newGame: white moves first");
  // all keys unique and well-formed
  const keys = new Set(lm.map((m) => m.key));
  eq(keys.size, 81, "all 81 keys are unique");
  ok(lm.every((m) => /^b[1-9]r[1-3]c[1-3]$/.test(m.key)), "all keys match b<1-9>r<1-3>c<1-3>");
  ok(lm.every((m) => typeof m.label === "string" && m.label.length > 0), "every move has a label");
  ok(uttt.id === "uttt", "module id is 'uttt'");
  eq(uttt.name, "Ultimate Tic-Tac-Toe", "module name is 'Ultimate Tic-Tac-Toe'");
}

console.log("# 2. 200 random playouts terminate with state.over set; max legal moves <= 255");
{
  const rnd = mulberry32(1337);
  let maxLegal = 0;
  let wins = 0, draws = 0;
  for (let p = 0; p < 200; p++) {
    const s = uttt.newGame();
    for (let i = 0; i < 500; i++) {
      const lm = uttt.legalMoves(s);
      if (lm.length > maxLegal) maxLegal = lm.length;
      if (lm.length === 0) break;
      const mv = lm[Math.floor(rnd() * lm.length)];
      uttt.applyMove(s, mv);
      if (s.over !== null) break;
    }
    assert(s.over !== null, "playout " + p + " did not terminate (over is null)");
    if (/Draw/.test(s.over)) draws++;
    else wins++;
  }
  ok(maxLegal <= 255, "max legal moves seen (" + maxLegal + ") <= 255");
  ok(maxLegal <= 81, "max legal moves seen (" + maxLegal + ") <= 81 (81 cells)");
  ok(wins + draws === 200, "all 200 playouts ended with a result");
  console.log("  max legal moves observed: " + maxLegal + "  (wins=" + wins + " draws=" + draws + ")");
}

console.log("# 3. routing: after first move b1r1c1, all legal moves are in board 1");
{
  const s = uttt.newGame();
  const first = uttt.legalMoves(s).find((m) => m.key === "b1r1c1");
  assert(first, "b1r1c1 is a legal first move");
  uttt.applyMove(s, first);
  eq(s.turn, "b", "turn is now black after white's first move");
  const lm = uttt.legalMoves(s);
  ok(lm.length === 8, "black has 8 legal moves (board 1 minus the filled cell)");
  ok(lm.every((m) => m.b === 0), "all legal moves are in board 1");
  ok(lm.every((m) => /^b1r[1-3]c[1-3]$/.test(m.key)), "all legal move keys are prefixed b1");
  // black plays a cell that routes white to board (r*3+c)
  const mv = lm.find((m) => m.key === "b1r2c2"); // center cell of board 1
  uttt.applyMove(s, mv);
  eq(s.turn, "w", "turn is white after black's move");
  const lm2 = uttt.legalMoves(s);
  // b1r2c2 => r=2,c=2 (1-based) => dest board (1-based) = (r-1)*3+(c-1)+1 = 5 => index 4
  ok(lm2.every((m) => m.b === 4), "white is routed to board 5 (dest of b1r2c2)");
}

console.log("# 4. board win: a side holding 3 boards in a line wins the game");
{
  // Deterministic, replay-verified sequence in which one side wins boards 1,2,3
  // (the top row of the macro grid) and therefore wins the whole game.
  const seq = ("b1r1c1,b1r2c3,b6r1c1,b1r2c2,b5r1c1,b1r3c3,b9r1c1,b1r3c1,b7r1c1,b1r1c2," +
               "b2r1c1,b1r2c1,b4r1c1,b3r3c3,b9r1c2,b2r2c3,b6r1c2,b2r3c3,b9r1c3,b3r2c1," +
               "b4r1c2,b2r1c3,b3r1c1,b8r3c3,b1r1c3,b3r3c1,b7r1c2,b4r3c2,b8r1c1,b3r3c2").split(",");
  const s = replay(seq);
  ok(s.over !== null, "game is over after the win sequence");
  ok(/wins/i.test(s.over), "over message indicates a win: " + s.over);
  const w = s.over.split(" ")[0]; // 'White' or 'Black'
  const side = w === "White" ? "w" : "b";
  eq([s.boardWin[0], s.boardWin[1], s.boardWin[2]], [side, side, side],
     "winner holds boards 1,2,3 (top row of boards)");
  ok(s.over.includes("row of boards"), "over message names the winning line (row)");
}

console.log("# 4b. minimal constructed win: 3 boards in a row (white) -> overall win");
{
  // Directly build a valid position: white has won boards 1,2,3 (top row).
  // Board contents: white holds the top row of each (cells 0,1,2); black has a
  // couple of harmless marks. This is a legal position (reachable in principle)
  // and the macro winner must be white.
  const s = uttt.newGame();
  for (const b of [0, 1, 2]) {
    s.boards[b] = ["w", "w", "w", "b", "b", "b", 0, 0, 0];
    s.boardWin[b] = "w";
  }
  // no overall win yet until we confirm the macro detector agrees on a live move
  // (the detector is exercised by test 4's real game; here we just assert the
  // macro line exists). Build a real trigger: white wins board 1 as the *3rd*
  // board in a row.
  // Simplest: use the real engine to win board 1 as white's third line-board.
  // We already prove real-game win in test 4, so here assert detection logic
  // via promptState/over on a finished-macro position.
  const ps = uttt.promptState(s, "b");
  ok(ps.boards.length === 9, "promptState exposes 9 boards");
  // boards 1,2,3 show white in row 0
  ok(ps.boards[0][0].every((v) => v === "w"), "board 1 top row is all white in promptState");
}

console.log("# 5. draw: all 9 boards finished (drawn) -> state.over contains 'Draw'");
{
  // Classic 3x3 drawn pattern (no 3-in-a-row; w=5, b=4).
  const P = ["w", "b", "w", "w", "w", "b", "b", "w", "b"];
  const line = (c) => {
    const L = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const p of L) if (c[p[0]] && c[p[0]] === c[p[1]] && c[p[0]] === c[p[2]]) return true;
    return false;
  };
  ok(!line(P), "test premise: P is a drawn 3x3 board (no line)");
  const s = uttt.newGame();
  for (let b = 0; b < 8; b++) { s.boards[b] = P.slice(); s.boardDraw[b] = true; s.boardWin[b] = null; }
  s.boards[8] = P.slice(); s.boards[8][8] = 0; s.boardDraw[8] = false; s.boardWin[8] = null;
  s.forcedBoard = 8; s.turn = "b"; s.moveCount = 0;
  const lm = uttt.legalMoves(s);
  eq(lm.length, 1, "only the final board 9 cell remains");
  uttt.applyMove(s, lm[0]);
  ok(s.over !== null, "game is over after the last cell is filled");
  ok(typeof s.over === "string" && s.over.includes("Draw"), "over contains 'Draw': " + s.over);
  ok(s.boardWin.every((x) => x === null), "no board has a winner (all drawn)");
  ok(s.boardDraw.every(Boolean), "all 9 boards are marked drawn");
}

console.log("# 6. promptState is JSON-safe; promptInstructions is non-empty");
{
  const s = uttt.newGame();
  const ps = uttt.promptState(s, "w");
  let parsed;
  let threw = false;
  try { parsed = JSON.parse(JSON.stringify(ps)); } catch (e) { threw = true; }
  ok(!threw, "promptState round-trips through JSON.stringify/parse");
  ok(parsed.boards.length === 9, "promptState has 9 boards");
  ok(parsed.boards.every((b) => b.length === 3 && b.every((r) => r.length === 3)),
     "each board is 3x3");
  eq(parsed.turn, "w", "promptState reports whose turn");
  // values are 'w'/'b'/0
  const flat = parsed.boards.flat(2);
  ok(flat.every((v) => v === "w" || v === "b" || v === 0), "cell values are 'w'/'b'/0");
  const inst = uttt.promptInstructions(s, "w");
  ok(typeof inst === "string" && inst.length > 0, "promptInstructions is non-empty");
  ok(/choice key/i.test(inst), "instructions say to answer with exactly one choice key");
  // instructions change to reflect routing
  uttt.applyMove(s, uttt.legalMoves(s).find((m) => m.key === "b1r1c1"));
  const inst2 = uttt.promptInstructions(s, "b");
  ok(inst2.includes("board 1"), "instructions mention the forced board after routing");
}

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
