// Connect Four — game module for the Jev Chess web app.
//
// Contract: ES module, default export with id/newGame/legalMoves/applyMove/
// promptState/promptInstructions/moveLabel/render. State is plain JSON
// (no functions, no DOM, no cycles). All document access is guarded so the
// file imports cleanly in Node for tests.

const COLS = 7;
const ROWS = 6; // row 0 = TOP
const SIDE_NAME = { w: 'White', b: 'Black' };

function emptyGrid() {
  const grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(null));
  return grid;
}

function otherSide(side) {
  return side === 'w' ? 'b' : 'w';
}

// 'c1'..'c7' -> 0..6 (c1 = leftmost column), or null if not a column key.
function colFromKey(key) {
  if (typeof key !== 'string') return null;
  const m = /^c([1-7])$/.exec(key);
  return m ? Number(m[1]) - 1 : null;
}

// Lowest empty row of a column (bottom-up drop), or -1 if the column is full.
function dropRow(grid, c) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (grid[r][c] === null) return r;
  }
  return -1;
}

function isFull(state) {
  return state.grid[0].every((v) => v !== null);
}

// Four-in-a-row through cell (r,c)? Returns the winning side or null.
function winAt(grid, r, c) {
  const p = grid[r][c];
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && grid[rr][cc] === p) {
        count++;
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (count >= 4) return p;
  }
  return null;
}

let cssInjected = false;
const CSS = [
  '.c4-root{display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;}',
  '.c4-status{font-size:16px;font-weight:600;color:#e8e6e3;}',
  '.c4-status.over{color:#f0b34a;}',
  '.c4-board{display:flex;flex-direction:column;gap:6px;background:#1b2a4a;padding:10px;border-radius:10px;}',
  '.c4-row{display:flex;gap:6px;}',
  '.c4-cell{width:42px;height:42px;border-radius:50%;background:#0f1626;border:2px solid #2a3a5f;box-sizing:border-box;}',
  '.c4-cell.w{background:#f2f0eb;border-color:#cfcac0;}',
  '.c4-cell.b{background:#14161c;border-color:#000;}',
  '.c4-cell.drop{cursor:pointer;}',
  '.c4-cell.drop:hover{border-color:#f0b34a;}',
].join('\n');

function ensureCss() {
  if (cssInjected || typeof document === 'undefined') return;
  if (!document.getElementById('style-connect4')) {
    const st = document.createElement('style');
    st.id = 'style-connect4';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  cssInjected = true;
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function render(view, state) {
  if (typeof document === 'undefined') return;
  ensureCss();
  const { mount, interactive } = view;
  mount.textContent = '';

  const root = el('div', 'c4-root');

  const status = el('div', state.over ? 'c4-status over' : 'c4-status');
  status.textContent = state.over ? state.over : SIDE_NAME[state.turn] + ' to move';

  const board = el('div', 'c4-board');
  for (let r = 0; r < ROWS; r++) {
    const row = el('div', 'c4-row');
    for (let c = 0; c < COLS; c++) {
      const cell = el('div', 'c4-cell');
      const v = state.grid[r][c];
      if (v === 'w') cell.classList.add('w');
      else if (v === 'b') cell.classList.add('b');
      // Dropping is legal anywhere in a column that is not full.
      const playable = interactive && !state.over && state.grid[0][c] === null;
      if (playable) {
        cell.classList.add('drop');
        const move = { key: 'c' + (c + 1), label: 'Column ' + (c + 1) };
        cell.addEventListener('click', () => view.commitMove(move));
      }
      row.appendChild(cell);
    }
    board.appendChild(row);
  }

  root.appendChild(status);
  root.appendChild(board);
  mount.appendChild(root);
}

const connect4 = {
  id: 'connect4',
  name: 'Connect Four',

  newGame() {
    return { grid: emptyGrid(), turn: 'w', over: null };
  },

  legalMoves(state) {
    if (state.over) return [];
    const moves = [];
    for (let c = 0; c < COLS; c++) {
      if (state.grid[0][c] === null) {
        moves.push({ key: 'c' + (c + 1), label: 'Column ' + (c + 1), column: c });
      }
    }
    if (moves.length === 0) return [{ key: 'pass', label: 'Pass' }];
    return moves;
  },

  applyMove(state, move) {
    if (state.over || !move) return;
    if (move.key === 'pass') {
      state.turn = otherSide(state.turn);
      if (isFull(state)) state.over = 'Draw — board full';
      return;
    }
    const c = colFromKey(move.key);
    if (c === null) return;
    const r = dropRow(state.grid, c);
    if (r === -1) return;
    state.grid[r][c] = state.turn;
    const winner = winAt(state.grid, r, c);
    if (winner) {
      state.over = SIDE_NAME[winner] + ' wins — four in a row';
    } else if (isFull(state)) {
      state.over = 'Draw — board full';
    } else {
      state.turn = otherSide(state.turn);
    }
  },

  promptState(state, side) {
    return {
      game: 'connect4',
      board: '7 columns x 6 rows; row 0 of the grid is the TOP row',
      yourSide: side,
      sideToMove: state.turn,
      over: state.over || null,
      grid: state.grid.map((row) =>
        row.map((v) => (v === 'w' ? 'w' : v === 'b' ? 'b' : '.'))
      ),
    };
  },

  promptInstructions(state, side) {
    const turnText = state.over
      ? 'The game is over: ' + state.over + '.'
      : SIDE_NAME[state.turn] + ' is to move.';
    const answerNote =
      typeof side === 'string' && state.turn === side
        ? ' Answer with exactly one choice key.'
        : '';
    return (
      'Connect Four on a 7x6 board; row 0 of the grid is the TOP row. ' +
      "Grid cells are 'w' (White), 'b' (Black), or '.' (empty). " +
      "A move drops the mover's disc into the lowest empty cell of the chosen column; a full column is illegal. " +
      'Four discs in a row — horizontally, vertically, or diagonally — wins; a full board with no win is a draw. ' +
      'Legal choice keys are c1..c7, where c1 is the leftmost column and c7 is the rightmost. ' +
      turnText +
      answerNote
    );
  },

  moveLabel(move) {
    return move && move.label ? move.label : String(move ? move.key : '?');
  },

  render,
};

export default connect4;
