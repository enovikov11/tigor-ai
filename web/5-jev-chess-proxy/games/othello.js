// Othello/Reversi game module for the Jev Chess web app.
// Pure game logic + a tiny DOM renderer. Safe to import in Node (no DOM at top level).
// State is plain JSON: board is 8x8 of 'w' | 'b' | 0 (row 0 = top), turn 'w'|'b',
// over null | 'White wins 64-0' | 'Black wins 40-24' | 'Draw 32-32', passes = consecutive passes.

const SIZE = 8;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

const otherSide = (s) => (s === 'w' ? 'b' : 'w');
const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const cellAt = (board, r, c) => (inBounds(r, c) ? board[r][c] : null);
const keyOf = (r, c) => 'r' + (r + 1) + 'c' + (c + 1);

function parseKey(key) {
  const m = /^r([1-8])c([1-8])$/.exec(String(key || ''));
  return m ? [Number(m[1]) - 1, Number(m[2]) - 1] : null;
}

// Directions from (r,c) where placing `side` flips one or more opponent discs.
function flipsFor(board, r, c, side) {
  if ((side !== 'w' && side !== 'b') || cellAt(board, r, c) !== 0) return [];
  const flips = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let rr = r + dr;
    let cc = c + dc;
    while (cellAt(board, rr, cc) === otherSide(side)) {
      line.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    if (line.length && cellAt(board, rr, cc) === side) flips.push(...line);
  }
  return flips;
}

const passMove = () => ({ key: 'pass', label: 'Pass (no flips)' });

const countDiscs = (board) => {
  let w = 0;
  let b = 0;
  for (const row of board) for (const v of row) {
    if (v === 'w') w += 1;
    else if (v === 'b') b += 1;
  }
  return { w, b };
};

const isFull = (board) => board.every((row) => row.every((v) => v !== 0));

const resultString = (board) => {
  const { w, b } = countDiscs(board);
  if (w === b) return 'Draw ' + w + '-' + b;
  return w > b ? 'White wins ' + w + '-' + b : 'Black wins ' + b + '-' + w;
};

const CSS = `
.othello-wrap { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.othello-board {
  display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px;
  width: min(100%, 520px); aspect-ratio: 1 / 1;
  background: #10141c; padding: 8px; border-radius: 10px; border: 1px solid #232b3a;
}
.othello-cell {
  position: relative; display: flex; align-items: center; justify-content: center;
  background: #1b2331; border-radius: 6px;
}
.othello-cell.legal { cursor: pointer; box-shadow: inset 0 0 0 1px #35507a; }
.othello-cell.legal::after {
  content: ''; width: 26%; height: 26%; border-radius: 50%; background: rgba(96, 165, 250, 0.35);
}
.othello-cell.legal:hover { background: #243247; }
.othello-disc { width: 78%; height: 78%; border-radius: 50%; }
.othello-disc.w { background: #e8edf4; }
.othello-disc.b { background: #11151d; border: 2px solid #39414f; }
.othello-pad {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #9aa7bd; font-size: 13px; text-align: center; min-height: 1.2em;
}
.othello-over { color: #f0c674; }
`;

function ensureStyle() {
  if (typeof document === 'undefined') return; // Node / no-DOM import
  if (document.getElementById('style-othello')) return;
  const el = document.createElement('style');
  el.id = 'style-othello';
  el.textContent = CSS;
  document.head.appendChild(el);
}

const othello = {
  id: 'othello',
  name: 'Othello',

  newGame() {
    const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    board[2][2] = 'w';
    board[3][3] = 'w';
    board[2][3] = 'b';
    board[3][2] = 'b';
    return { board, turn: 'b', over: null, passes: 0 };
  },

  legalMoves(state) {
    if (state.over) return [passMove()];
    const moves = [];
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        if (state.board[r][c] !== 0) continue;
        const flips = flipsFor(state.board, r, c, state.turn);
        if (flips.length) {
          const key = keyOf(r, c);
          moves.push({
            key,
            label: key,
            row: r,
            col: c,
            flips: flips.map(([fr, fc]) => keyOf(fr, fc)),
          });
        }
      }
    }
    moves.sort((a, b) => (a.key < b.key ? -1 : 1));
    return moves.length ? moves : [passMove()];
  },

  // Mutates state in place. Game ends after two consecutive passes or a full board;
  // more discs wins, equal = draw.
  applyMove(state, move) {
    if (!state || state.over || !move) return;
    if (move.key === 'pass') {
      state.passes = (state.passes || 0) + 1;
      state.turn = otherSide(state.turn);
      if (state.passes >= 2 || isFull(state.board)) state.over = resultString(state.board);
      return;
    }
    const rc = parseKey(move.key);
    if (!rc) return;
    const [r, c] = rc;
    const flips = flipsFor(state.board, r, c, state.turn);
    if (!flips.length) return; // illegal move: ignore
    state.board[r][c] = state.turn;
    for (const [fr, fc] of flips) state.board[fr][fc] = state.turn;
    state.passes = 0;
    state.turn = otherSide(state.turn);
    if (isFull(state.board)) state.over = resultString(state.board);
  },

  promptState(state, side) {
    const { w, b } = countDiscs(state.board);
    return {
      game: 'othello',
      side,
      turn: state.turn,
      board: state.board.map((row) => row.slice()),
      scores: { w, b },
      over: state.over,
    };
  },

  promptInstructions(state, side) {
    const who = side === 'w' ? 'White' : 'Black';
    return [
      'You are playing Othello (Reversi) as ' + who + '.',
      'The board is 8x8; row 1 is the top row, col 1 is the left column.',
      'A legal move places one of your discs on an empty cell so that it sandwiches at least one straight line (horizontal, vertical or diagonal) of opponent discs between the new disc and one of your existing discs; every sandwiched disc is flipped to your color.',
      'Starting position: white on r3c3 and r4c4, black on r3c4 and r4c3; Black moves first.',
      'If you have no legal move you must pass; if both sides pass consecutively (or the board fills up) the game ends and the player with more discs wins, equal discs is a draw.',
      'Move keys: r<1-8>c<1-8> for a cell (row, column), or "pass" to pass.',
      'answer with exactly one choice key',
    ].join('\n');
  },

  moveLabel(move) {
    if (!move) return '';
    return move.key === 'pass' ? 'Pass' : move.key;
  },

  render(view, state) {
    if (!view || !view.mount) return;
    ensureStyle();
    const { mount, pad, interactive, commitMove } = view;
    mount.innerHTML = '';

    const legal = state.over ? [] : othello.legalMoves(state);
    const legalKeys = new Set(legal.map((m) => m.key));

    const boardEl = document.createElement('div');
    boardEl.className = 'othello-board';
    for (let r = 0; r < SIZE; r += 1) {
      for (let c = 0; c < SIZE; c += 1) {
        const key = keyOf(r, c);
        const cell = document.createElement('div');
        cell.className = 'othello-cell';
        cell.dataset.key = key;
        const v = state.board[r][c];
        if (v) {
          const disc = document.createElement('div');
          disc.className = 'othello-disc ' + v;
          cell.appendChild(disc);
        } else if (!state.over && legalKeys.has(key)) {
          cell.classList.add('legal');
        }
        // !interactive -> no clicks, ever
        if (interactive && !state.over && legalKeys.has(key) && typeof commitMove === 'function') {
          cell.addEventListener('click', () => commitMove({ key, label: key }));
        }
        boardEl.appendChild(cell);
      }
    }
    mount.appendChild(boardEl);

    if (pad) {
      pad.innerHTML = '';
      const p = document.createElement('div');
      p.className = 'othello-pad';
      const { w, b } = countDiscs(state.board);
      p.textContent = state.over
        ? state.over
        : (state.turn === 'w' ? 'White' : 'Black') + ' to move — White ' + w + ' · Black ' + b;
      if (state.over) p.classList.add('othello-over');
      pad.appendChild(p);
    }
  },
};

export default othello;
