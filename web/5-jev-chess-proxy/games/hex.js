// Hex — 7x7, offset odd-r layout.
// White (w) connects the TOP edge (row 1) to the BOTTOM edge (row 7).
// Black (b) connects the LEFT edge (col 1) to the RIGHT edge (col 7).
// Cell keys: 'r<1-7>c<1-7>'. Grid values: 'w' | 'b' | 0.
//
// Odd-r adjacency (rows 1-indexed). For cell (r, c):
//   horizontal: (r, c-1), (r, c+1)
//   r odd:      (r-1, c), (r-1, c+1), (r+1, c), (r+1, c+1)
//   r even:     (r-1, c-1), (r-1, c), (r+1, c-1), (r+1, c)

const SIZE = 7;
const WIN_W = 'White wins — connected top to bottom';
const WIN_B = 'Black wins — connected left to right';

function cellKey(r, c) {
  return `r${r}c${c}`;
}

function parseKey(key) {
  // 'r3c5' -> {r:3, c:5}; anything else -> null
  if (typeof key !== 'string') return null;
  const m = /^r(\d+)c(\d+)$/.exec(key);
  if (!m) return null;
  const r = Number(m[1]);
  const c = Number(m[2]);
  if (r < 1 || r > SIZE || c < 1 || c > SIZE) return null;
  return { r, c };
}

function neighborsOf(r, c) {
  const out = [
    { r, c: c - 1 },
    { r, c: c + 1 },
  ];
  if (r % 2 === 1) {
    out.push({ r: r - 1, c }, { r: r - 1, c: c + 1 }, { r: r + 1, c }, { r: r + 1, c: c + 1 });
  } else {
    out.push({ r: r - 1, c: c - 1 }, { r: r - 1, c }, { r: r + 1, c: c - 1 }, { r: r + 1, c });
  }
  return out.filter((n) => n.r >= 1 && n.r <= SIZE && n.c >= 1 && n.c <= SIZE);
}

// Flood fill over player's own cells; returns the set of cell keys reachable
// from `startKey`.
function connectedRegion(grid, startKey, player) {
  const seen = new Set([startKey]);
  const queue = [startKey];
  while (queue.length) {
    const cur = queue.pop();
    const { r, c } = parseKey(cur);
    for (const n of neighborsOf(r, c)) {
      const nk = cellKey(n.r, n.c);
      if (!seen.has(nk) && grid[nk] === player) {
        seen.add(nk);
        queue.push(nk);
      }
    }
  }
  return seen;
}

// True if `player` has a region touching both of its target edges.
function isWinning(grid, player) {
  if (player === 'w') {
    const topKeys = [];
    for (let c = 1; c <= SIZE; c++) if (grid[cellKey(1, c)] === 'w') topKeys.push(cellKey(1, c));
    if (!topKeys.length) return false;
    for (const k of topKeys) {
      const region = connectedRegion(grid, k, 'w');
      for (let c = 1; c <= SIZE; c++) if (region.has(cellKey(SIZE, c))) return true;
    }
    return false;
  }
  const leftKeys = [];
  for (let r = 1; r <= SIZE; r++) if (grid[cellKey(r, 1)] === 'b') leftKeys.push(cellKey(r, 1));
  if (!leftKeys.length) return false;
  for (const k of leftKeys) {
    const region = connectedRegion(grid, k, 'b');
    for (let r = 1; r <= SIZE; r++) if (region.has(cellKey(r, SIZE))) return true;
  }
  return false;
}

function emptyKeys(state) {
  const out = [];
  for (const key of Object.keys(state.grid)) {
    if (state.grid[key] === 0) out.push(key);
  }
  return out;
}

const CSS = `
.hex-wrap { display: inline-block; user-select: none; }
.hex-row { display: flex; margin: 2px 0; }
.hex-row.hex-odd { margin-left: 28px; }
.hex-cell {
  width: 52px; height: 48px; margin: 0 2px;
  clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
  background: #1b2334;
  display: flex; align-items: center; justify-content: center;
  font: 700 18px/1 monospace; color: transparent;
  box-sizing: border-box;
}
.hex-cell.hex-empty.hex-clickable { cursor: pointer; }
.hex-cell.hex-empty.hex-clickable:hover { background: #2c3a5c; }
.hex-cell.hex-w { background: #f2f2f2; color: #111; }
.hex-cell.hex-b { background: #262a33; color: #e8e8e8; }
.hex-status { margin-top: 10px; font-size: 13px; color: #9aa4b8; }
`;

function ensureStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('style-hex')) return;
  const el = document.createElement('style');
  el.id = 'style-hex';
  el.textContent = CSS;
  document.head.appendChild(el);
}

const hex = {
  id: 'hex',
  name: 'Hex',

  newGame() {
    const grid = {};
    for (let r = 1; r <= SIZE; r++) {
      for (let c = 1; c <= SIZE; c++) grid[cellKey(r, c)] = 0;
    }
    return { turn: 'w', grid, over: null };
  },

  legalMoves(state) {
    if (state.over) return [];
    const keys = emptyKeys(state);
    if (keys.length) {
      return keys.map((key) => ({ key, label: key }));
    }
    // Board full with no winner — cannot happen on a finite Hex board,
    // but guard per contract.
    return [{ key: 'pass', label: 'Pass' }];
  },

  applyMove(state, move) {
    if (state.over || !move) return;
    if (move.key === 'pass') {
      state.turn = state.turn === 'w' ? 'b' : 'w';
      return;
    }
    const parsed = parseKey(move.key);
    if (!parsed || state.grid[move.key] !== 0) return;
    const mover = state.turn;
    state.grid[move.key] = mover;
    state.turn = mover === 'w' ? 'b' : 'w';
    if (isWinning(state.grid, mover)) {
      state.over = mover === 'w' ? WIN_W : WIN_B;
    }
  },

  promptState(state, side) {
    const grid = [];
    for (let r = 1; r <= SIZE; r++) {
      const row = [];
      for (let c = 1; c <= SIZE; c++) row.push(state.grid[cellKey(r, c)]);
      grid.push(row);
    }
    return {
      game: 'hex',
      size: SIZE,
      turn: state.turn,
      your_side: side,
      grid, // row 0 = top row
      over: state.over,
    };
  },

  promptInstructions(state, side) {
    return [
      'Hex on a 7x7 board (odd-r offset rows: odd rows are shifted half a cell to the right).',
      `It is ${state.turn === 'w' ? 'White (w)' : 'Black (b)'}'s turn; you are ${side}.`,
      'Grid values: 0 = empty, w = White stone, b = Black stone. Grid row 0 is the TOP row.',
      "Keys: 'r<row>c<col>' with row 1..7 top-to-bottom and col 1..7 left-to-right, e.g. r3c5.",
      'White (w) wins by connecting the TOP row to the BOTTOM row.',
      'Black (b) wins by connecting the LEFT column to the RIGHT column.',
      'A move is placing your stone on any empty cell; a completed connection wins immediately.',
      'answer with exactly one choice key',
    ].join(' ');
  },

  moveLabel(move) {
    return move && move.label ? move.label : move ? move.key : '';
  },

  render(view, state) {
    ensureStyle();
    const { mount, pad, interactive, commitMove } = view;
    mount.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'hex-wrap' + (pad ? ' hex-padded' : '');
    for (let r = 1; r <= SIZE; r++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'hex-row' + (r % 2 === 1 ? ' hex-odd' : '');
      for (let c = 1; c <= SIZE; c++) {
        const key = cellKey(r, c);
        const v = state.grid[key];
        const cellEl = document.createElement('div');
        const cls = v === 'w' ? 'hex-w' : v === 'b' ? 'hex-b' : 'hex-empty';
        cellEl.className = 'hex-cell ' + cls;
        cellEl.dataset.key = key;
        cellEl.title = key;
        cellEl.textContent = v === 'w' ? 'W' : v === 'b' ? 'B' : '';
        if (interactive && !state.over && v === 0) {
          cellEl.classList.add('hex-clickable');
          cellEl.addEventListener('click', () => commitMove({ key, label: key }));
        }
        rowEl.appendChild(cellEl);
      }
      wrap.appendChild(rowEl);
    }
    const status = document.createElement('div');
    status.className = 'hex-status';
    status.textContent = state.over
      ? state.over
      : state.turn === 'w'
        ? 'White to move (connect top to bottom)'
        : 'Black to move (connect left to right)';
    wrap.appendChild(status);
    mount.appendChild(wrap);
  },
};

export default hex;
