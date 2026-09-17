// Battleship — 10x10, classic fleet (1x5, 2x4, 3x3, 4x2, 1x1 => 11 ships per side).
// Hidden-info duel: promptState only ever exposes the requesting side's fleet and shots.
// Sides: 'w' (White, moves first) / 'b' (Black). Placement alternates: each side
// places its own next ship in turn until both fleets are placed, then combat.
// Plain-JSON state only (no Sets). Importable in node without a DOM.

const SIZE = 10;
const FLEET = [5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 1];
const OTHER = { w: 'b', b: 'w' };
const NAME = { w: 'White', b: 'Black' };

let orient = 'h'; // placement orientation toggle (module closure, UI only)

function freshSide() {
  return {
    ships: FLEET.map((len, i) => ({ id: i + 1, len, cells: null, hit: [] })),
    fired: [], // shots BY this side: {r, c, res:'hit'|'miss'} (0-indexed)
  };
}

function newGame() {
  return { turn: 'w', over: null, lastShot: null, w: freshSide(), b: freshSide() };
}

function nextShip(st) {
  return st.ships.find((s) => !s.cells) || null;
}

function phase(state) {
  const any = state.w.ships.some((s) => !s.cells) || state.b.ships.some((s) => !s.cells);
  return any ? 'placing' : 'combat';
}

function shipCells(r0, c0, len, o) {
  const cells = [];
  for (let i = 0; i < len; i++) cells.push(o === 'h' ? [r0, c0 + i] : [r0 + i, c0]);
  return cells;
}

function fits(state, side, r0, c0, len, o) {
  const cells = shipCells(r0, c0, len, o);
  const occ = new Set();
  for (const s of state[side].ships) if (s.cells) for (const [r, c] of s.cells) occ.add(r * SIZE + c);
  for (const [r, c] of cells) {
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;
    if (occ.has(r * SIZE + c)) return false;
  }
  return true;
}

function parseP(key) {
  if (typeof key !== 'string' || key.length < 5 || key[0] !== 'p') return null;
  const o = key.slice(-1);
  if (o !== 'h' && o !== 'v') return null;
  const cCh = key[key.length - 2];
  const rCh = key[key.length - 3];
  if (!/^\d$/.test(rCh) || !/^\d$/.test(cCh)) return null;
  const idStr = key.slice(1, key.length - 3);
  if (!/^\d+$/.test(idStr)) return null;
  const shipId = +idStr;
  const r = +rCh;
  const c = +cCh;
  if (shipId < 1 || shipId > FLEET.length || r < 1 || r > SIZE || c < 1 || c > SIZE) return null;
  return { shipId, r: r - 1, c: c - 1, o };
}

function parseF(key) {
  if (typeof key !== 'string' || !key.startsWith('f') || key.length < 3) return null;
  const body = key.slice(1);
  // col is 1-2 digits; try 2-digit col first, then 1-digit.
  if (body.length >= 2) {
    const colStr = body.slice(-2);
    // leading-zero col ('01'..'09') is never generated, so fall through to the
    // 2-digit-row interpretation ('f10Z' = row 10, col Z).
    if (colStr[0] !== '0') {
      const c2 = +colStr;
      const rStr = body.slice(0, -2);
      if (/^\d+$/.test(rStr) && +rStr >= 1 && +rStr <= SIZE && c2 >= 1 && c2 <= SIZE) {
        return { r: +rStr - 1, c: c2 - 1 };
      }
    }
  }
  const c1 = +body.slice(-1);
  const rStr = body.slice(0, -1);
  if (/^\d+$/.test(rStr) && +rStr >= 1 && +rStr <= SIZE && c1 >= 1 && c1 <= SIZE) {
    return { r: +rStr - 1, c: c1 - 1 };
  }
  return null;
}

function randomize(state, side) {
  for (const ship of state[side].ships) {
    if (ship.cells) continue;
    const opts = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        for (const o of ['h', 'v']) if (fits(state, side, r, c, ship.len, o)) opts.push([r, c, o]);
    const [r, c, o] = opts[Math.floor(Math.random() * opts.length)];
    ship.cells = shipCells(r, c, ship.len, o);
  }
}

function legalMoves(state) {
  if (state.over) return [];
  const side = state.turn;
  if (phase(state) === 'placing') {
    const ship = nextShip(state[side]);
    if (!ship) throw new Error('battleship: placing phase but no unplaced ship for ' + side);
    const moves = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        for (const o of ['h', 'v'])
          if (fits(state, side, r, c, ship.len, o))
            moves.push({
              key: `p${ship.id}${r + 1}${c + 1}${o}`,
              label: `Place ship ${ship.id} at r${r + 1}c${c + 1} ${o}`,
              shipId: ship.id,
              r: r + 1,
              c: c + 1,
              o,
            });
    moves.push({ key: 'rand', label: 'Randomize fleet' });
    if (moves.length > 255) throw new Error('battleship: legalMoves exceeds 255');
    return moves;
  }
  const fired = new Set(state[side].fired.map((f) => f.r * SIZE + f.c));
  const moves = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (!fired.has(r * SIZE + c))
        moves.push({ key: `f${r + 1}${c + 1}`, label: `Fire r${r + 1}c${c + 1}`, r: r + 1, c: c + 1 });
  if (moves.length > 255) throw new Error('battleship: legalMoves exceeds 255');
  return moves;
}

function applyMove(state, move) {
  if (state.over) throw new Error('battleship: game already over');
  const side = state.turn;
  const other = OTHER[side];
  if (move.key === 'rand') {
    if (phase(state) !== 'placing' || !nextShip(state[side])) throw new Error('battleship: bad move rand');
    randomize(state, side);
  } else if (typeof move.key === 'string' && move.key.startsWith('p')) {
    if (phase(state) !== 'placing') throw new Error('battleship: bad move (not placing)');
    const m = parseP(move.key);
    if (!m) throw new Error('battleship: bad move ' + move.key);
    const st = state[side];
    const ship = st.ships[m.shipId - 1];
    if (nextShip(st) !== ship) throw new Error('battleship: not the next ship to place');
    if (!fits(state, side, m.r, m.c, ship.len, m.o)) throw new Error('battleship: illegal placement');
    ship.cells = shipCells(m.r, m.c, ship.len, m.o);
  } else if (typeof move.key === 'string' && move.key.startsWith('f')) {
    if (phase(state) !== 'combat') throw new Error('battleship: bad move (not combat)');
    const m = parseF(move.key);
    if (!m) throw new Error('battleship: bad move ' + move.key);
    const st = state[side];
    if (st.fired.some((f) => f.r === m.r && f.c === m.c)) throw new Error('battleship: already fired there');
    let res = 'miss';
    for (const s of state[other].ships) {
      if (s.cells && s.cells.some(([r, c]) => r === m.r && c === m.c)) {
        s.hit.push([m.r, m.c]);
        res = 'hit';
      }
    }
    st.fired.push({ r: m.r, c: m.c, res });
    state.lastShot = { side, r: m.r, c: m.c, res };
    if (state[other].ships.every((s) => s.cells && s.hit.length === s.len)) {
      state.over = `${NAME[side]} wins — all enemy ships destroyed`;
    }
  } else {
    throw new Error('battleship: bad move ' + move.key);
  }
  state.turn = other;
}

function promptState(state, side) {
  const st = state[side];
  const enemyGrid = Array.from({ length: SIZE }, () => Array(SIZE).fill(''));
  for (const f of st.fired) enemyGrid[f.r][f.c] = f.res;
  const grid = enemyGrid.map((row) =>
    row.map((v) => (v === 'x' ? 'x' : v === 'o' ? 'o' : '.'))
  );
  return {
    game: 'battleship',
    side,
    turn: state.turn,
    phase: phase(state),
    grid,
    over: state.over,
    myFleet: st.ships.map((s) => ({ id: s.id, len: s.len, placed: !!s.cells, cells: s.cells, hits: s.hit })),
    myShots: st.fired.map((f) => ({ r: f.r, c: f.c, res: f.res })),
    enemyGrid,
  };
}

function promptInstructions(state, side) {
  const ph = phase(state);
  const ship = nextShip(state[side]);
  const lines = [
    'Battleship: two fleets of 11 ships each (1x5, 2x4, 3x3, 4x2, 1x1) on a 10x10 grid; rows/cols are 1-10, row 1 = top, col 1 = left.',
    'Ships must stay on the grid and may not overlap other ships (touching is allowed).',
    'Phases: 1) placing — White and Black alternate placing their own next ship (or randomize); 2) combat — you alternate firing at one cell each turn; every shot reports hit or miss.',
    'A ship is sunk when all its cells are hit. Sinking all 11 enemy ships wins the game.',
    `Current phase: ${ph}${ph === 'placing' && ship ? `; your next ship: #${ship.id} (length ${ship.len})` : ''}.`,
    ph === 'placing'
      ? "Placement move keys: 'p<shipId><row><col><h|v>' — row/col is the topmost/leftmost cell of the ship, shipId MUST be your next unplaced ship in order, h=horizontal, v=vertical. You may use 'rand' at any time during placement to randomly place ALL your remaining ships."
      : "Combat move keys: 'f<row><col>' — any cell you have not fired at yet (firing an already-fired cell is illegal).",
    'Answer with exactly one choice key.',
  ];
  return lines.join('\n');
}

function moveLabel(move) {
  const k = move && move.key;
  if (k === 'rand') return 'Random fleet';
  if (typeof k === 'string' && k.startsWith('p')) {
    const m = parseP(k);
    return m ? `Place ship ${m.shipId} at r${m.r + 1}c${m.c + 1} ${m.o}` : k;
  }
  if (typeof k === 'string' && k.startsWith('f')) {
    const m = parseF(k);
    return m ? `Fire r${m.r + 1}c${m.c + 1}` : k;
  }
  return String(k);
}

const CSS = `
.bs-root{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-start}
.bs-gridbox{display:flex;flex-direction:column;gap:6px}
.bs-title{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a93a8}
.bs-grid{display:grid;grid-template-columns:repeat(10,26px);grid-template-rows:repeat(10,26px);gap:2px}
.bs-cell{background:#1c2027;border:1px solid #2b303c;border-radius:3px;display:flex;align-items:center;justify-content:center;user-select:none}
.bs-cell.clickable{cursor:pointer}
.bs-cell.clickable:hover{background:#2a3040;border-color:#4a5468}
.bs-cell.ship{background:#33465f;border-color:#4d6a8c}
.bs-cell.hit{background:#b23b3b;border-color:#d05555}
.bs-cell.miss::after{content:"";width:7px;height:7px;border-radius:50%;background:#7f8aa0}
.bs-cell.last{outline:2px solid #e8c547;outline-offset:-2px}
.bs-over{width:100%;color:#e8c547;font-size:15px;padding:8px 0}
.bs-chips{display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.bs-ship{width:24px;height:24px;padding:0;font-size:11px;border-radius:4px;border:1px solid #3a4152;background:#232936;color:#cdd3e1;cursor:default}
.bs-ship.placed{opacity:.35}
.bs-ship.next{border-color:#e8c547;color:#e8c547}
.bs-btns{display:flex;gap:8px;margin-bottom:8px}
.bs-btns button{padding:4px 10px;font-size:12px;border-radius:4px;border:1px solid #3a4152;background:#232936;color:#cdd3e1;cursor:pointer}
.bs-btns button:hover{background:#2a3040}
`;

function render(view, state) {
  const { mount, pad, interactive, commitMove } = view;
  if (!document.getElementById('style-battleship')) {
    const el = document.createElement('style');
    el.id = 'style-battleship';
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  const side = state.turn;
  const other = OTHER[side];
  const ph = phase(state);
  const st = state[side];
  const legal = new Set(legalMoves(state).map((m) => m.key));

  // pad: placement controls
  pad.innerHTML = '';
  if (ph === 'placing') {
    const next = nextShip(st);
    const chips = document.createElement('div');
    chips.className = 'bs-chips';
    const lbl = document.createElement('span');
    lbl.className = 'bs-title';
    lbl.textContent = `${NAME[side]} fleet — ${interactive ? 'your turn' : 'waiting'}`;
    chips.appendChild(lbl);
    for (const s of st.ships) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bs-ship' + (s.cells ? ' placed' : '') + (s === next ? ' next' : '');
      b.textContent = s.id;
      b.title = `ship ${s.id}, length ${s.len}`;
      chips.appendChild(b);
    }
    pad.appendChild(chips);
    const btns = document.createElement('div');
    btns.className = 'bs-btns';
    const oBtn = document.createElement('button');
    oBtn.type = 'button';
    oBtn.textContent = `Orient: ${orient === 'h' ? 'H' : 'V'}`;
    oBtn.title = 'Toggle orientation (H/V)';
    oBtn.addEventListener('click', () => { orient = orient === 'h' ? 'v' : 'h'; });
    const rBtn = document.createElement('button');
    rBtn.type = 'button';
    rBtn.textContent = 'R';
    rBtn.title = 'Randomize fleet';
    rBtn.addEventListener('click', () => { if (interactive) commitMove({ key: 'rand', label: 'Randomize fleet' }); });
    btns.appendChild(oBtn);
    btns.appendChild(rBtn);
    pad.appendChild(btns);
  } else {
    const d = document.createElement('div');
    d.className = 'bs-title';
    d.textContent = state.over ? state.over : `${NAME[side]} to fire at ${NAME[other]}'s waters`;
    pad.appendChild(d);
  }

  // grids
  const ownShip = new Set();
  const ownHit = new Set();
  const oppShot = new Map();
  for (const s of st.ships) if (s.cells) for (const [r, c] of s.cells) ownShip.add(r * SIZE + c);
  for (const s of st.ships) for (const [r, c] of s.hit) ownHit.add(r * SIZE + c);
  for (const f of state[other].fired) oppShot.set(f.r * SIZE + f.c, f.res);
  const myShot = new Map();
  for (const f of st.fired) myShot.set(f.r * SIZE + f.c, f.res);

  const lastTargeted = state.lastShot ? OTHER[state.lastShot.side] : null;

  const buildGrid = (title, cellInfo, onClick) => {
    const box = document.createElement('div');
    box.className = 'bs-gridbox';
    const h = document.createElement('div');
    h.className = 'bs-title';
    h.textContent = title;
    box.appendChild(h);
    const g = document.createElement('div');
    g.className = 'bs-grid';
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'bs-cell';
        const info = cellInfo(r, c);
        if (info.cls) for (const cl of info.cls) cell.classList.add(cl);
        if (onClick) {
          cell.classList.add('clickable');
          cell.addEventListener('click', () => onClick(r, c));
        }
        g.appendChild(cell);
      }
    box.appendChild(g);
    return box;
  };

  const ownClick = ph === 'placing' && interactive
    ? (r, c) => {
        const next = nextShip(st);
        if (!next) return;
        const key = `p${next.id}${r + 1}${c + 1}${orient}`;
        if (legal.has(key)) commitMove({ key, label: moveLabel({ key }) });
      }
    : null;
  const enemyClick = ph === 'combat' && interactive
    ? (r, c) => {
        const key = `f${r + 1}${c + 1}`;
        if (legal.has(key)) commitMove({ key, label: moveLabel({ key }) });
      }
    : null;

  const wrap = document.createElement('div');
  wrap.className = 'bs-root';
  wrap.appendChild(buildGrid(
    `${NAME[side]} fleet`,
    (r, c) => {
      const i = r * SIZE + c;
      const cls = [];
      if (ownHit.has(i)) cls.push('hit');
      else if (ownShip.has(i)) cls.push('ship');
      else if (oppShot.get(i) === 'miss') cls.push('miss');
      if (state.lastShot && lastTargeted === side && state.lastShot.r === r && state.lastShot.c === c) cls.push('last');
      return { cls };
    },
    ownClick,
  ));
  wrap.appendChild(buildGrid(
    `${NAME[other]} waters`,
    (r, c) => {
      const i = r * SIZE + c;
      const cls = [];
      const res = myShot.get(i);
      if (res === 'hit') cls.push('hit');
      else if (res === 'miss') cls.push('miss');
      if (state.lastShot && lastTargeted === other && state.lastShot.r === r && state.lastShot.c === c) cls.push('last');
      return { cls };
    },
    enemyClick,
  ));
  if (state.over) {
    const d = document.createElement('div');
    d.className = 'bs-over';
    d.textContent = state.over;
    wrap.appendChild(d);
  }
  mount.innerHTML = '';
  mount.appendChild(wrap);
}

export default {
  id: 'battleship',
  name: 'Battleship',
  newGame,
  legalMoves,
  applyMove,
  promptState,
  promptInstructions,
  moveLabel,
  render,
};
