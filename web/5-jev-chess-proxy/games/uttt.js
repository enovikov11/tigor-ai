// Ultimate Tic-Tac-Toe — game module for the Jev Chess web app (TypeSafe
// constrained-move-selector contract). Pure ES module, no DOM at import time.
//
// Contract: default-exports an object with id/name/newGame/legalMoves/
// applyMove/promptState/promptInstructions/moveLabel/render.
// Sides are 'w' (first) and 'b'. All state is plain JSON.
//
// Rules: 9 boards in a 3x3 macro grid, each board 3x3. First move: any cell
// anywhere. Afterward, playing board b cell (r,c) sends the opponent to board
// r*3+c (1-based: top-left board = 1 ... bottom-right = 9). If that
// destination board is finished or full, the player may play anywhere. A board
// is finished with a winner (3-in-a-row) or a draw (full). Overall winner:
// first to win 3 boards in a line. All 9 boards finished with no overall
// winner: draw.

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],            // diagonals
];

const LINE_NAMES = {
  "0,1,2": "top row",
  "3,4,5": "middle row",
  "6,7,8": "bottom row",
  "0,3,6": "left column",
  "1,4,7": "middle column",
  "2,5,8": "right column",
  "0,4,8": "diagonal",
  "2,4,6": "anti-diagonal",
};

// index (0-based cell in a 3x3 board) -> human "rNcM"
function cellName(r, c) {
  return "r" + (r + 1) + "c" + (c + 1);
}

// 81 unique move keys, in a stable order: board ascending, row ascending, col
// ascending. Each move object: { key, label, b, r, c }.
const ALL_CELLS = [];
for (let b = 0; b < 9; b++) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      ALL_CELLS.push({
        key: "b" + (b + 1) + "r" + (r + 1) + "c" + (c + 1),
        label: "B" + (b + 1) + " " + cellName(r, c),
        b,
        r,
        c,
      });
    }
  }
}
const KEY_TO_CELL = new Map(ALL_CELLS.map((m) => [m.key, m]));

function newGame() {
  const boards = [];
  for (let b = 0; b < 9; b++) boards.push([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return {
    boards,
    boardWin: [null, null, null, null, null, null, null, null, null],
    boardDraw: [false, false, false, false, false, false, false, false, false],
    forcedBoard: -1, // -1 means "play anywhere"
    turn: "w",
    moveCount: 0,
    over: null,
  };
}

function boardWinner(cells) {
  for (const [a, c, d] of WIN_LINES) {
    if (cells[a] && cells[a] === cells[c] && cells[a] === cells[d]) {
      return cells[a];
    }
  }
  return null;
}

function boardFull(cells) {
  for (let i = 0; i < 9; i++) if (!cells[i]) return false;
  return true;
}

function boardFinished(state, b) {
  return state.boardWin[b] !== null || state.boardDraw[b];
}

function macroWinner(state) {
  const m = new Array(9);
  for (let i = 0; i < 9; i++) m[i] = state.boardWin[i];
  for (const [a, c, d] of WIN_LINES) {
    if (m[a] && m[a] === m[c] && m[a] === m[d]) {
      return { side: m[a], line: [a, c, d], name: LINE_NAMES[a + "," + c + "," + d] };
    }
  }
  return null;
}

function sideName(s) {
  return s === "w" ? "White" : "Black";
}

function legalMoves(state) {
  if (state.over) return [];
  if (state.forcedBoard >= 0 && !boardFinished(state, state.forcedBoard)) {
    const res = [];
    const cells = state.boards[state.forcedBoard];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (!cells[r * 3 + c]) {
          const k = "b" + (state.forcedBoard + 1) + "r" + (r + 1) + "c" + (c + 1);
          const t = KEY_TO_CELL.get(k);
          res.push({ key: k, label: t.label, b: t.b, r: t.r, c: t.c });
        }
      }
    }
    if (res.length) return res;
  }
  const res = [];
  for (const m of ALL_CELLS) {
    if (!state.boards[m.b][m.r * 3 + m.c]) {
      res.push({ key: m.key, label: m.label, b: m.b, r: m.r, c: m.c });
    }
  }
  if (!res.length) return [{ key: "pass", label: "Pass" }];
  return res;
}

function applyMove(state, move) {
  if (state.over) throw new Error("game is over: " + state.over);
  if (move.key === "pass") {
    state.turn = state.turn === "w" ? "b" : "w";
    state.over = "Draw — all boards finished";
    return;
  }
  const b = move.b, r = move.r, c = move.c;
  if (b < 0 || b > 8 || r < 0 || r > 2 || c < 0 || c > 2) {
    throw new Error("move out of range: " + move.key);
  }
  const cells = state.boards[b];
  const idx = r * 3 + c;
  if (cells[idx]) throw new Error("cell already occupied: " + move.key);
  if (state.forcedBoard >= 0 && !boardFinished(state, state.forcedBoard)) {
    if (b !== state.forcedBoard) {
      throw new Error(
        "must play in board " + (state.forcedBoard + 1) + ", not " + (b + 1)
      );
    }
  }

  const side = state.turn;
  cells[idx] = side;
  state.moveCount++;

  if (!boardFinished(state, b)) {
    const w = boardWinner(cells);
    if (w) {
      state.boardWin[b] = w;
    } else if (boardFull(cells)) {
      state.boardDraw[b] = true;
    }
  }

  const dest = r * 3 + c;
  state.forcedBoard = boardFinished(state, dest) ? -1 : dest;

  const mw = macroWinner(state);
  if (mw) {
    state.over = sideName(mw.side) + " wins — " + mw.name + " of boards";
    return;
  }
  let allDone = true;
  for (let i = 0; i < 9; i++) {
    if (!boardFinished(state, i)) { allDone = false; break; }
  }
  if (allDone) {
    state.over = "Draw — all boards finished";
    return;
  }

  state.turn = state.turn === "w" ? "b" : "w";
}

function promptState(state, side) {
  const boards = [];
  for (let b = 0; b < 9; b++) {
    boards.push([
      [state.boards[b][0], state.boards[b][1], state.boards[b][2]],
      [state.boards[b][3], state.boards[b][4], state.boards[b][5]],
      [state.boards[b][6], state.boards[b][7], state.boards[b][8]],
    ]);
  }
  return {
    game: 'uttt',
    turn: state.turn,
    forcedBoard: state.forcedBoard >= 0 ? state.forcedBoard + 1 : null,
    boards,
    grid: state.boards.map((cells) =>
      cells.map((v) => (v === 'w' ? 'w' : v === 'b' ? 'b' : '.'))
    ),
    over: state.over,
    moveCount: state.moveCount,
  };
}

function promptInstructions(state, side) {
  const turnName = sideName(state.turn);
  let s =
    "Ultimate Tic-Tac-Toe. 9 boards in a 3x3 grid, each board 3x3. " +
    "Side to move: " + turnName + ". Sides: 'w'=White, 'b'=Black, 0=empty.\n";
  if (state.over) {
    s += "Game over: " + state.over + "\n";
  }
  if (state.forcedBoard >= 0) {
    s +=
      "You must play in board " + (state.forcedBoard + 1) +
      " (destination from the opponent's last move).\n";
  } else {
    s +=
      "You may play in any unfinished board (your destination board is finished or full).\n";
  }
  s +=
    "Each move places your mark in one empty cell and sends the opponent to " +
    "the board at that cell's position: playing row r, col c (1-based) sends the " +
    "opponent to board (r-1)*3+(c-1)+1, so top-left cell -> board 1, bottom-right " +
    "cell -> board 9. If that board is already finished " +
    "or full, the opponent may play anywhere.\n" +
    "A board is won with 3-in-a-row and drawn when full. First to win 3 boards " +
    "in a line (row/column/diagonal) wins the game; if all boards finish with " +
    "no overall winner, it is a draw.\n" +
    "Key encoding: 'b<board 1-9>r<row 1-3>c<col 1-3>', e.g. 'b4r2c3' = board 4, " +
    "row 2, col 3. Board <board> is the sub-board, r/c index its 3x3 cells.\n" +
    "answer with exactly one choice key.";
  return s;
}

function moveLabel(move) {
  if (move.key === "pass") return "Pass";
  const t = KEY_TO_CELL.get(move.key);
  return t ? t.label : move.key;
}

const STYLE_ID = "style-uttt";
const CSS =
  "#style-uttt-host { --uttt-bg:#0e1116; --uttt-ink:#e8edf3; --uttt-mut:#8a93a3;" +
  " --uttt-w:#ffd23f; --uttt-b:#4f8cff; --uttt-line:#2a3038; --uttt-acc:#39d98a; }" +
  ".uttt-root { font-family: ui-sans-serif, system-ui, sans-serif; color:var(--uttt-ink);" +
  " background:var(--uttt-bg); padding:12px; border-radius:12px; user-select:none; }" +
  ".uttt-mac { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; max-width:480px; }" +
  ".uttt-board { position:relative; border:2px solid var(--uttt-line); border-radius:8px;" +
  " padding:5px; background:#0a0d12; aspect-ratio:1/1; display:grid;" +
  " grid-template-columns:repeat(3,1fr); gap:4px; transition:border-color .15s, opacity .15s; }" +
  ".uttt-board.target { border-color:var(--uttt-acc); box-shadow:0 0 0 2px rgba(57,217,138,.25); }" +
  ".uttt-board.won-w { border-color:var(--uttt-w); }" +
  ".uttt-board.won-b { border-color:var(--uttt-b); }" +
  ".uttt-board.dim { opacity:.45; }" +
  ".uttt-board .uttt-tag { position:absolute; top:3px; right:5px; font-size:10px; color:var(--uttt-mut); }" +
  ".uttt-board .uttt-winner { position:absolute; top:3px; left:5px; font-size:10px; font-weight:700; }" +
  ".uttt-cell { border:1px solid var(--uttt-line); border-radius:5px; display:flex;" +
  " align-items:center; justify-content:center; font-weight:800; cursor:pointer; background:#12161c; }" +
  ".uttt-cell:hover { background:#1a212b; }" +
  ".uttt-cell.w { color:var(--uttt-w); }" +
  ".uttt-cell.b { color:var(--uttt-b); }" +
  ".uttt-cell.disabled { cursor:default; }" +
  ".uttt-cell.disabled:hover { background:#12161c; }" +
  ".uttt-meta { max-width:480px; font-size:12px; color:var(--uttt-mut); margin-top:8px; }";

function ensureStyle() {
  if (typeof document === "undefined") return;
  if (!document.getElementById(STYLE_ID)) {
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }
}

function render(view, state) {
  if (typeof document === "undefined") return;
  ensureStyle();
  const { mount, interactive = true, commitMove } = view;
  if (!mount) return;
  mount.innerHTML = "";

  const root = document.createElement("div");
  root.className = "uttt-root";
  root.id = "style-uttt-host";

  const mac = document.createElement("div");
  mac.className = "uttt-mac";

  const moves =
    interactive && !state.over
      ? new Set(legalMoves(state).map((m) => m.key))
      : new Set();

  for (let b = 0; b < 9; b++) {
    const boardEl = document.createElement("div");
    boardEl.className = "uttt-board";
    const wonBy = state.boardWin[b];
    if (wonBy === "w") boardEl.classList.add("won-w");
    else if (wonBy === "b") boardEl.classList.add("won-b");
    if (boardFinished(state, b)) boardEl.classList.add("dim");
    if (!state.over && b === state.forcedBoard) boardEl.classList.add("target");

    const tag = document.createElement("span");
    tag.className = "uttt-tag";
    tag.textContent = "B" + (b + 1);
    boardEl.appendChild(tag);

    if (wonBy) {
      const wm = document.createElement("span");
      wm.className = "uttt-winner";
      wm.textContent = wonBy === "w" ? "W" : "B";
      wm.style.color = wonBy === "w" ? "var(--uttt-w)" : "var(--uttt-b)";
      boardEl.appendChild(wm);
    } else if (state.boardDraw[b]) {
      const wd = document.createElement("span");
      wd.className = "uttt-winner";
      wd.textContent = "draw";
      boardEl.appendChild(wd);
    }

    const cells = state.boards[b];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const v = cells[r * 3 + c];
        const key = "b" + (b + 1) + "r" + (r + 1) + "c" + (c + 1);
        const cellEl = document.createElement("div");
        cellEl.className = "uttt-cell";
        if (v) {
          cellEl.classList.add(v === "w" ? "w" : "b");
          cellEl.textContent = v === "w" ? "O" : "X";
          cellEl.classList.add("disabled");
        } else if (moves.has(key)) {
          cellEl.addEventListener("click", () => {
            const mv = KEY_TO_CELL.get(key);
            if (mv) commitMove(mv);
          });
        } else {
          cellEl.classList.add("disabled");
        }
        boardEl.appendChild(cellEl);
      }
    }
    mac.appendChild(boardEl);
  }
  root.appendChild(mac);

  const meta = document.createElement("div");
  meta.className = "uttt-meta";
  if (state.over) {
    meta.textContent = state.over;
  } else {
    meta.textContent =
      (state.turn === "w" ? "White" : "Black") + " to move" +
      (state.forcedBoard >= 0 ? " — play in board " + (state.forcedBoard + 1) : "");
  }
  root.appendChild(meta);

  mount.appendChild(root);
}

export default {
  id: "uttt",
  name: "Ultimate Tic-Tac-Toe",
  newGame,
  legalMoves,
  applyMove,
  promptState,
  promptInstructions,
  moveLabel,
  render,
};
