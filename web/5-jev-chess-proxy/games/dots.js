// Dots-and-Boxes game module (Jev Chess web app)
// 5x5 dots -> 4x4 boxes (16 boxes). 40 lines total: 20 horizontal h(r,c),
// 20 vertical v(r,c). Completing the 4th side of a box claims it and grants
// the SAME side another move. Most boxes wins; 8-8 is a Draw.
// ES module; must import cleanly in node without a DOM.

const H_ROWS = 5; // horizontal lines: dot row r=1..5
const H_COLS = 4; // col c=1..4
const V_ROWS = 4; // vertical lines: dot row r=1..4
const V_COLS = 5; // col c=1..5
const BOXES = 16; // 4x4

function hKey(r, c) { return 'h' + r + '-' + c; }
function vKey(r, c) { return 'v' + r + '-' + c; }

// box (br, bc) 1-based sides
function boxSides(br, bc) {
  return [hKey(br, bc), hKey(br + 1, bc), vKey(br, bc), vKey(br, bc + 1)];
}

// All line keys (deterministic order)
const ALL_KEYS = (() => {
  const keys = [];
  for (let r = 1; r <= H_ROWS; r++) for (let c = 1; c <= H_COLS; c++) keys.push(hKey(r, c));
  for (let r = 1; r <= V_ROWS; r++) for (let c = 1; c <= V_COLS; c++) keys.push(vKey(r, c));
  return keys; // 20 + 20 = 40
})();

function parseKey(key) {
  const t = key[0];
  const m = key.slice(1).split('-');
  const r = parseInt(m[0], 10);
  const c = parseInt(m[1], 10);
  if (t === 'h') {
    if (r < 1 || r > 5 || c < 1 || c > 4) throw new Error('bad h key: ' + key);
  } else if (t === 'v') {
    if (r < 1 || r > 4 || c < 1 || c > 5) throw new Error('bad v key: ' + key);
  } else {
    throw new Error('bad key: ' + key);
  }
  return { type: t, r, c };
}

function newGame() {
  return {
    turn: 'w',
    over: null,
    lines: {},   // key -> true for drawn lines
    boxes: {},   // "br-bc" -> 'w'|'b'
    score: { w: 0, b: 0 },
    moves: 0,
  };
}

function scoreOf(state) {
  return state.score.w + state.score.b;
}

function winnerString(w, b) {
  if (w === b) return 'Draw ' + w + '-' + b;
  const side = w > b ? 'White' : 'Black';
  const hi = Math.max(w, b);
  const lo = Math.min(w, b);
  return side + ' wins ' + hi + '-' + lo;
}

function moveLabel(move) {
  return move && move.label ? move.label : move && move.key ? move.key : '';
}

function legalMoves(state) {
  if (state.over) return [];
  const moves = [];
  for (const key of ALL_KEYS) {
    if (!state.lines[key]) moves.push({ key, label: moveLabel({ key }) });
  }
  return moves.slice(0, 255);
}

function boxComplete(state, br, bc) {
  return boxSides(br, bc).every((s) => !!state.lines[s]);
}

function applyMove(state, move) {
  if (!state || !move || !move.key) throw new Error('bad move');
  if (state.over) throw new Error('game over');
  const key = move.key;
  if (!ALL_KEYS.includes(key)) throw new Error('bad key: ' + key);
  if (state.lines[key]) throw new Error('line already drawn: ' + key);

  state.lines[key] = true;
  state.moves++;

  // check which box(es) this line closes
  const p = parseKey(key);
  const claimed = [];
  if (p.type === 'h') {
    const br = p.r - 1; // box above (if r >= 2)
    if (br >= 1 && boxComplete(state, br, p.c)) claimed.push([br, p.c]);
    const br2 = p.r;    // box below (if r <= 4)
    if (br2 <= 4 && boxComplete(state, br2, p.c)) claimed.push([br2, p.c]);
  } else {
    const bc = p.c - 1; // box left (if c >= 2)
    if (bc >= 1 && boxComplete(state, p.r, bc)) claimed.push([p.r, bc]);
    const bc2 = p.c;    // box right (if c <= 4)
    if (bc2 <= 4 && boxComplete(state, p.r, bc2)) claimed.push([p.r, bc2]);
  }

  if (claimed.length > 0) {
    for (const [br, bc] of claimed) {
      const bk = br + '-' + bc;
      if (state.boxes[bk] === undefined) {
        state.boxes[bk] = state.turn;
        state.score[state.turn]++;
      }
    }
    // same side moves again (extra move) — turn unchanged
  } else {
    state.turn = state.turn === 'w' ? 'b' : 'w';
  }

  if (scoreOf(state) === BOXES) {
    state.over = winnerString(state.score.w, state.score.b);
  }
  return state;
}

function promptState(state, side) {
  const mySide = side || 'w';
  const grid = [];
  for (let br = 1; br <= 4; br++) {
    const row = [];
    for (let bc = 1; bc <= 4; bc++) {
      const own = state.boxes[br + '-' + bc];
      row.push(own === 'w' ? 'w' : own === 'b' ? 'b' : '.');
    }
    grid.push(row);
  }
  return {
    game: 'dots',
    grid,
    turn: state.turn,
    you: mySide,
    over: state.over,
    score: { white: state.score.w, black: state.score.b },
    boxes: Object.keys(state.boxes)
      .sort()
      .map((bk) => {
        const [br, bc] = bk.split('-').map((x) => parseInt(x, 10));
        return { box: br + '-' + bc, owner: state.boxes[bk] === 'w' ? 'white' : 'black' };
      }),
    lines: Object.keys(state.lines)
      .sort()
      .map((k) => k),
  };
}

function promptInstructions(state, side) {
  const mySide = side || 'w';
  const you = mySide === 'w' ? 'White' : 'Black';
  const opp = mySide === 'w' ? 'Black' : 'White';
  return (
    'Dots and Boxes: a 5x5 grid of dots forms 16 squares (4x4).\n' +
    'On your turn draw ONE line between two adjacent dots.\n' +
    'Lines are encoded as h<r>-<c> (horizontal, dot row r 1-5, col c 1-4) ' +
    'or v<r>-<c> (vertical, dot row r 1-4, col c 1-5), e.g. h3-2.\n' +
    'If your line completes the 4th side of a square, you claim that square ' +
    'and get to move again (extra move).\n' +
    'The game ends when all 16 squares are claimed; the player with more ' +
    'squares wins. 8-8 is a Draw.\n' +
    'You play ' + you + '; ' + opp + ' plays the other side.\n' +
    'Current: ' + JSON.stringify(promptState(state, mySide)) + '\n' +
    'answer with exactly one choice key.'
  );
}

// Approximate which side last touched a line for the highlight tint:
// if any adjacent box is claimed, use that owner; otherwise the current turn.
function lastDrawer(state, key) {
  const p = parseKey(key);
  const candidates = [];
  if (p.type === 'h') {
    if (p.r >= 2) candidates.push((p.r - 1) + '-' + p.c);
    if (p.r <= 4) candidates.push(p.r + '-' + p.c);
  } else {
    if (p.c >= 2) candidates.push(p.r + '-' + (p.c - 1));
    if (p.c <= 4) candidates.push(p.r + '-' + p.c);
  }
  for (const bk of candidates) {
    if (state.boxes[bk]) return state.boxes[bk];
  }
  return state.turn;
}

function render(view, state) {
  const { mount, pad, interactive, commitMove } = view;
  if (!mount || typeof document === 'undefined') return;

  // guarded style block
  if (!document.getElementById('style-dots')) {
    const st = document.createElement('style');
    st.id = 'style-dots';
    st.textContent = `
      #dots-board { display: block; margin: 0 auto; }
      .dots-line { stroke: #888; stroke-width: 2; stroke-linecap: round; }
      .dots-line.drawn-w { stroke: #2b6cb0; stroke-width: 5; }
      .dots-line.drawn-b { stroke: #c53030; stroke-width: 5; }
      .dots-line.avail { cursor: pointer; }
      .dots-line.avail:hover { stroke-width: 5; }
      .dots-line.avail-h:hover { stroke: #4a90d9; }
      .dots-line.avail-v:hover { stroke: #d9534f; }
      .dots-box-claim { fill: rgba(120,120,120,0.15); }
      .dots-box-claim.w { fill: rgba(43,108,176,0.25); }
      .dots-box-claim.b { fill: rgba(197,48,48,0.25); }
      .dots-dot { fill: #555; }
    `;
    document.head.appendChild(st);
  }

  mount.innerHTML = '';

  const CELL = 60;
  const PAD = 18;
  const W = PAD * 2 + CELL * 4;
  const H = PAD * 2 + CELL * 4;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('id', 'dots-board');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

  const px = (c) => PAD + (c - 1) * CELL;
  const py = (r) => PAD + (r - 1) * CELL;

  // claimed boxes (under lines)
  for (const bk of Object.keys(state.boxes)) {
    const [br, bc] = bk.split('-').map((x) => parseInt(x, 10));
    const owner = state.boxes[bk];
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', px(bc));
    rect.setAttribute('y', py(br));
    rect.setAttribute('width', CELL);
    rect.setAttribute('height', CELL);
    rect.setAttribute('class', 'dots-box-claim ' + owner);
    svg.appendChild(rect);
  }

  // lines
  const addLine = (key, x1, y1, x2, y2) => {
    const el = document.createElementNS(svgNS, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    const drawn = !!state.lines[key];
    if (drawn) {
      el.setAttribute('class', 'dots-line drawn-' + lastDrawer(state, key));
    } else if (interactive && !state.over) {
      el.setAttribute('class', 'dots-line avail ' + (key[0] === 'h' ? 'avail-h' : 'avail-v'));
      el.addEventListener('click', () => {
        commitMove({ key, label: moveLabel({ key }) });
      });
    } else {
      el.setAttribute('class', 'dots-line');
    }
    svg.appendChild(el);
  };

  for (let r = 1; r <= 5; r++) {
    for (let c = 1; c <= 4; c++) {
      addLine(hKey(r, c), px(c), py(r), px(c + 1), py(r));
    }
  }
  for (let r = 1; r <= 4; r++) {
    for (let c = 1; c <= 5; c++) {
      addLine(vKey(r, c), px(c), py(r), px(c), py(r + 1));
    }
  }

  // dots
  for (let r = 1; r <= 5; r++) {
    for (let c = 1; c <= 5; c++) {
      const d = document.createElementNS(svgNS, 'circle');
      d.setAttribute('cx', px(c));
      d.setAttribute('cy', py(r));
      d.setAttribute('r', 4);
      d.setAttribute('class', 'dots-dot');
      svg.appendChild(d);
    }
  }

  mount.appendChild(svg);

  // pad: live score
  if (pad) {
    const score = 'boxes: W ' + state.score.w + ' - B ' + state.score.b;
    pad.textContent = state.over
      ? state.over + ' · ' + score
      : 'Dots & Boxes · ' + (state.turn === 'w' ? 'White' : 'Black') +
        ' to move · ' + score;
  }
}

const game = {
  id: 'dots',
  name: 'Dots & Boxes',
  newGame,
  legalMoves,
  applyMove,
  promptState,
  promptInstructions,
  moveLabel,
  render,
};

export default game;
