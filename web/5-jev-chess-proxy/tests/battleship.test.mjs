// Battleship module tests — run:
// timeout 120 nix-shell -p nodejs --run "node /abs/path/tests/battleship.test.mjs"
import bs from '../games/battleship.js';

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name); }
}

// ---- (1) newGame: placement moves + 'rand'
{
  const st = bs.newGame();
  ok(st.turn === 'w' && st.over === null, '1a newGame fresh state');
  const mv = bs.legalMoves(st);
  ok(mv.some((m) => m.key === 'rand'), '1b newGame legalMoves includes rand');
  // ship1 (len5): 10 rows x 6 h-starts + 6 v-starts x 10 cols = 120 placements
  const p1 = mv.filter((m) => m.key.startsWith('p1')).length;
  ok(p1 === 120, '1c ship1 has 120 valid placements (got ' + p1 + ')');
  ok(mv.every((m) => m.key && m.label), '1d every placement move has key+label');
  ok(mv.every((m) => m.key === 'rand' || m.key.startsWith('p1')), '1e only ship1 placements offered');
  ok(mv.length <= 255, '1f placement moves <= 255');
}

// ---- (2) 'rand' both sides -> combat, 100 legal fire moves
{
  const st = bs.newGame();
  bs.applyMove(st, { key: 'rand' });
  ok(bs.promptState(st, 'b').phase === 'placing', '2a after w rand, still placing');
  bs.applyMove(st, { key: 'rand' });
  ok(bs.promptState(st, 'w').phase === 'combat', '2b after both rand, combat phase');
  ok(st.turn === 'w', '2c back to white turn after placement pair');
  const mv = bs.legalMoves(st);
  ok(mv.length === 100, '2d combat start: 100 legal fire moves');
  ok(mv.every((m) => m.key.startsWith('f') && m.label), '2e fire moves keyed f<row><col>');
}

// ---- (3) 200 random playouts terminate (max possible game length = 200 shots)
{
  let maxMoves = 0;
  let winners = { w: 0, b: 0 };
  let allTerminated = true;
  let noExceptions = true;
  for (let g = 0; g < 200; g++) {
    try {
      const st = bs.newGame();
      bs.applyMove(st, { key: 'rand' });
      bs.applyMove(st, { key: 'rand' });
      let guard = 0;
      while (!st.over && guard++ < 400) {
        const mv = bs.legalMoves(st);
        if (mv.length > maxMoves) maxMoves = mv.length;
        if (mv.length === 0) { allTerminated = false; break; }
        bs.applyMove(st, mv[Math.floor(Math.random() * mv.length)]);
      }
      if (!st.over) { allTerminated = false; continue; }
      const winner = st.over.startsWith('White') ? 'w' : 'b';
      const loser = winner === 'w' ? 'b' : 'w';
      const loserSunk = st[loser].ships.every((s) => s.hit.length === s.len);
      const winnerSurvived = st[winner].ships.some((s) => s.hit.length < s.len);
      if (!loserSunk || !winnerSurvived) allTerminated = false;
      winners[winner]++;
    } catch (e) {
      noExceptions = false;
      allTerminated = false;
      console.log('playout exception:', e.message);
    }
  }
  ok(allTerminated, '3a all 200 playouts terminated with a winner');
  ok(noExceptions, '3b no exceptions during playouts');
  ok(maxMoves <= 255, '3c max legal moves seen <= 255');
  console.log('   max legal moves seen:', maxMoves, '| winners:', JSON.stringify(winners));
}

// ---- (4) hidden info: promptState('b') must not leak 'w' ship cells
{
  const st = bs.newGame();
  // deterministic white placements (turns alternate: w, b, w, b, ... so interleave
  // black 'rand' is not allowed yet — black must wait; instead place white ships
  // one per white turn, black placing nothing... but black MUST place in order.
  // So: w ship1, b ship1, w ship2, b ship2, w ship3, b rand(rest)
  bs.applyMove(st, { key: 'p111h' });            // w ship1 (0,0..4)
  bs.applyMove(st, { key: 'p111h' });            // b ship1 (0,0..4)
  bs.applyMove(st, { key: 'p231h' });            // w ship2 (2,0..3)
  bs.applyMove(st, { key: 'p231h' });            // b ship2 (2,0..3)
  bs.applyMove(st, { key: 'p351h' });            // w ship3 (4,0..2)
  bs.applyMove(st, { key: 'rand' });             // b places rest randomly
  bs.applyMove(st, { key: 'rand' });             // w places rest randomly
  ok(bs.promptState(st, 'w').phase === 'combat', '4a both fleets placed, combat');
  // black (to move now) fires one shot, then it is white's turn
  const first = bs.legalMoves(st)[0];
  bs.applyMove(st, first);
  const bViewObj = bs.promptState(st, 'b');
  const bView = JSON.stringify(bViewObj);
  // (i) enemyGrid may only contain ''/hit/miss — no fleet info
  let leaked = false;
  for (const row of bViewObj.enemyGrid)
    for (const cell of row) if (cell !== '' && cell !== 'hit' && cell !== 'miss') leaked = true;
  // (ii) white's deterministic ship cells (0,0..4),(2,0..3),(4,0..2) must not appear in b's view
  const wKnown = [[0,0],[0,1],[0,2],[0,3],[0,4],[2,0],[2,1],[2,2],[2,3],[4,0],[4,1],[4,2]];
  for (const [r, c] of wKnown) {
    const s = JSON.stringify([r, c]); // "r,c"
    if (bView.includes(s)) {
      // rule out the coincidence of [r,c] being one of black's OWN cells or a shot
      const isOwn = bViewObj.myFleet.some((sh) => (sh.cells || []).some(([rr, cc]) => rr === r && cc === c));
      const isShot = bViewObj.myShots.some((f) => f.r === r && f.c === c);
      // also the opponent grid cells at (r,c) are black's own ships — black firing at own grid is
      // impossible, so a "hit"/"miss" at (r,c) in enemyGrid means black shot there.
      if (!isOwn && !isShot) leaked = true;
    }
  }
  ok(!leaked, '4b promptState(b) does not reveal white ship positions');
  ok(bViewObj.phase === 'combat' && bViewObj.turn === st.turn, '4c promptState(b) has phase+turn');
  ok(bViewObj.myFleet.length === 11 && bViewObj.myFleet.every((s) => s.placed), '4d b sees own fleet fully placed');
}

// ---- (5) firing rules
{
  const st = bs.newGame();
  bs.applyMove(st, { key: 'rand' });
  bs.applyMove(st, { key: 'rand' });
  const before = bs.legalMoves(st).length;
  ok(before === 100, '5a start combat 100 moves');
  const first = bs.legalMoves(st)[0];
  const firedKey = first.key;
  bs.applyMove(st, first);
  ok(st.turn === 'b', '5b turn alternates after fire');
  ok(bs.legalMoves(st).length === 100, '5c black still has 100 moves');
  bs.applyMove(st, { key: 'f11' });
  ok(st.turn === 'w', '5d turn back to white');
  const wMoves = bs.legalMoves(st);
  ok(!wMoves.some((m) => m.key === firedKey), '5e white cannot re-fire own already-fired cell');
  ok(wMoves.length === 99, '5f white has 99 moves after 1 shot');
  const wFired = st.w.fired;
  ok(wFired.length === 1 && (wFired[0].res === 'hit' || wFired[0].res === 'miss'), '5g shot recorded with res');
  // white fires a second cell, black replies, then white re-fires its FIRST cell -> illegal
  const second = wMoves.find((m) => m.key !== firedKey && m.key !== 'f11');
  bs.applyMove(st, second);
  bs.applyMove(st, { key: 'f22' }); // black
  ok(st.turn === 'w', '5h back to white after second exchange');
  let threw = false;
  try { bs.applyMove(st, { key: firedKey }); } catch (e) { threw = true; }
  ok(threw, '5i applyMove duplicate fire by same side throws');
}

// ---- (6) ship destruction: hit all 5 cells of white ship1
{
  const st = bs.newGame();
  bs.applyMove(st, { key: 'p111h' });            // w ship1 (0,0..4); turn b
  bs.applyMove(st, { key: 'rand' });             // b places all; turn w
  bs.applyMove(st, { key: 'rand' });             // w places rest; turn b
  ok(bs.promptState(st, 'w').phase === 'combat', '6a combat after both fleets placed');
  ok(st.turn === 'b', '6b black to fire first');
  // black fires at white ship1 cells f11..f15; white fires a non-target cell each turn
  const targets = ['f11', 'f12', 'f13', 'f14', 'f15'];
  const decoys = ['f99', 'f88', 'f77', 'f66', 'f55'];
  let allHit = true;
  for (let i = 0; i < 5; i++) {
    const mv = bs.legalMoves(st);
    if (!mv.some((m) => m.key === targets[i])) allHit = false;
    bs.applyMove(st, { key: targets[i] });       // black
    if (st.w.ships[0].hit.length !== i + 1) allHit = false;
    const wmv = bs.legalMoves(st);
    bs.applyMove(st, wmv.find((m) => m.key === decoys[i]) || wmv[0]); // white
  }
  const ship1 = st.w.ships[0];
  ok(allHit, '6c each of the 5 shots hit ship1 in order');
  ok(ship1.hit.length === 5, '6d ship1 has 5 hits');
  ok(ship1.hit.length === ship1.len, '6e ship1 fully sunk');
  const totalHits = st.w.ships.reduce((a, s) => a + s.hit.length, 0);
  ok(totalHits >= 5, '6f total hits on white fleet >= 5 (got ' + totalHits + ')');
  ok(!st.over, '6g game not over (other 10 ships alive)');
}

// ---- (7) promptState JSON-safe, instructions non-empty
{
  const st = bs.newGame();
  const js = bs.promptState(st, 'w');
  const jstr = JSON.stringify(js);
  ok(typeof jstr === 'string' && jstr.length > 0, '7a promptState serializes to JSON string');
  const parsed = JSON.parse(jstr);
  ok(parsed.turn === 'w' && parsed.phase === 'placing', '7b parsed promptState has turn+phase');
  const inst = bs.promptInstructions(st, 'w');
  ok(typeof inst === 'string' && inst.length > 50, '7c promptInstructions non-empty');
  ok(inst.includes("p<shipId><row><col><h|v>"), '7d instructions give placement key encoding');
  ok(inst.includes("'rand'"), '7e instructions mention rand');
  ok(inst.includes('Answer with exactly one choice key'), '7f instructions end with one-choice rule');
  // combat instructions
  const st2 = bs.newGame();
  bs.applyMove(st2, { key: 'rand' });
  bs.applyMove(st2, { key: 'rand' });
  ok(bs.promptInstructions(st2, 'w').includes("f<row><col>"), '7g combat instructions give fire encoding');
  // moveLabel
  ok(bs.moveLabel({ key: 'p325v' }) === 'Place ship 3 at r2c5 v', '7h moveLabel placement');
  ok(bs.moveLabel({ key: 'f47' }) === 'Fire r4c7', '7i moveLabel combat');
  ok(bs.moveLabel({ key: 'rand' }) === 'Random fleet', '7j moveLabel rand');
}

// ---- (8) game over: message + no further moves (random fast game)
{
  const st = bs.newGame();
  bs.applyMove(st, { key: 'rand' });
  bs.applyMove(st, { key: 'rand' });
  let guard = 0;
  while (!st.over && guard++ < 300) {
    const mv = bs.legalMoves(st);
    bs.applyMove(st, mv[Math.floor(Math.random() * mv.length)]);
  }
  ok(!!st.over && st.over.includes('wins — all enemy ships destroyed'), '8a over message correct');
  ok(bs.legalMoves(st).length === 0, '8b legalMoves empty when over');
  let threw = false;
  try { bs.applyMove(st, { key: 'f11' }); } catch (e) { threw = true; }
  ok(threw, '8c applyMove on finished game throws');
  ok(bs.promptState(st, 'w').over === st.over, '8d promptState carries over message');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
