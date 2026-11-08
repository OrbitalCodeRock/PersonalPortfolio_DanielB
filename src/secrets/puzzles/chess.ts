// "Written in the Stars": the chess puzzle for the Game Development page ("moves").
// The player is White and must replay CHESS_LINE (Légal's mate) from the opening position. The sky
// view shows White's moves (CHESS_HINT); the board answers each correct move with Black's reply.
// Moves only need the right shape for their piece (no check rules); a well-shaped move that isn't
// the next one in the line slides back.
import { CHESS_HINT, CHESS_LINE } from '../config';
import { chime, openWindow, solve } from '../ui';
import { isSolved } from '../progress';

type Color = 'w' | 'b';
type Type = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
interface Piece {
	color: Color;
	type: Type;
}
type Board = (Piece | null)[];

const GLYPH: Record<Type, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
const NAME: Record<Type, string> = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
const FILES = 'abcdefgh';

/** Square index: file + rank * 8, rank 0 is White's back rank. */
function sq(name: string): number {
	return FILES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
}
function sqName(i: number): string {
	return `${FILES[i % 8]}${Math.floor(i / 8) + 1}`;
}

function startBoard(): Board {
	const b: Board = new Array(64).fill(null);
	const back: Type[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
	for (let f = 0; f < 8; f++) {
		b[f] = { color: 'w', type: back[f] };
		b[8 + f] = { color: 'w', type: 'P' };
		b[48 + f] = { color: 'b', type: 'P' };
		b[56 + f] = { color: 'b', type: back[f] };
	}
	return b;
}

/** Does this move have the right shape for the piece (ignoring check)? */
function shapeOK(b: Board, from: number, to: number): boolean {
	const p = b[from];
	if (!p || from === to) return false;
	const target = b[to];
	if (target && target.color === p.color) return false;
	const fx = from % 8,
		fy = Math.floor(from / 8),
		tx = to % 8,
		ty = Math.floor(to / 8);
	const dx = tx - fx,
		dy = ty - fy;
	const adx = Math.abs(dx),
		ady = Math.abs(dy);
	const clear = () => {
		const sx = Math.sign(dx),
			sy = Math.sign(dy);
		for (let x = fx + sx, y = fy + sy; x !== tx || y !== ty; x += sx, y += sy) {
			if (b[x + y * 8]) return false;
		}
		return true;
	};
	switch (p.type) {
		case 'N':
			return (adx === 1 && ady === 2) || (adx === 2 && ady === 1);
		case 'B':
			return adx === ady && clear();
		case 'R':
			return (dx === 0 || dy === 0) && clear();
		case 'Q':
			return (adx === ady || dx === 0 || dy === 0) && clear();
		case 'K': {
			if (adx <= 1 && ady <= 1) return true;
			// Castling shape: two squares sideways from the home square, rook in its corner, path empty.
			const home = p.color === 'w' ? 0 : 7;
			if (dy !== 0 || adx !== 2 || fy !== home || fx !== 4 || target) return false;
			const rook = b[(dx > 0 ? 7 : 0) + home * 8];
			if (!rook || rook.type !== 'R' || rook.color !== p.color) return false;
			const end = dx > 0 ? 7 : 0;
			for (let x = Math.min(fx, end) + 1; x < Math.max(fx, end); x++) if (b[x + home * 8]) return false;
			return true;
		}
		case 'P': {
			const dir = p.color === 'w' ? 1 : -1;
			const startRank = p.color === 'w' ? 1 : 6;
			if (dx === 0 && !target) {
				if (dy === dir) return true;
				if (dy === 2 * dir && fy === startRank && !b[from + 8 * dir]) return true;
				return false;
			}
			return adx === 1 && dy === dir && !!target;
		}
	}
	return false;
}

const STYLE_ID = 'secret-style-chess';
const CSS = `
.chs { display: grid; gap: 12px; justify-items: center; }
.chs-wrap { width: min(100%, 440px); }
.chs-board {
	position: relative; width: 100%; aspect-ratio: 1; display: grid;
	grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr);
	border-radius: 6px; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none;
	container-type: inline-size;
	box-shadow: 0 0 0 1px rgba(255,231,163,0.35), 0 10px 30px rgba(0,0,0,0.5), 0 0 30px rgba(120,150,255,0.12);
}
.chs-sq {
	all: unset; box-sizing: border-box; position: relative; display: grid; place-items: center; cursor: pointer;
	background: #2a3557;
}
.chs-sq.is-light { background: #8d9cc4; }
.chs-sq:focus-visible { outline: 2px solid #ffe7a3; outline-offset: -2px; z-index: 1; }
.chs-sq.is-last::before { content: ''; position: absolute; inset: 0; background: rgba(255,231,163,0.28); }
.chs-sq.is-sel::before { content: ''; position: absolute; inset: 0; background: rgba(111,182,255,0.45); }
.chs-sq.is-mated::before { content: ''; position: absolute; inset: 0;
	background: radial-gradient(closest-side, rgba(255,120,90,0.9), rgba(255,200,110,0.55) 60%, transparent);
	animation: chs-pulse 1.2s ease-in-out infinite; }
@keyframes chs-pulse { 50% { opacity: 0.55; } }
.chs-coord { position: absolute; font-size: max(8px, 2.2cqw); line-height: 1; opacity: 0.7; pointer-events: none;
	font-family: var(--font); color: #0d1430; }
.chs-sq:not(.is-light) .chs-coord { color: #c3cdee; }
.chs-coord.f { right: 3px; bottom: 2px; }
.chs-coord.r { left: 3px; top: 2px; }
.chs-pc, .chs-ghost {
	position: relative; font-size: 9.6cqw; line-height: 1; pointer-events: none;
	font-family: 'Segoe UI Symbol', 'Noto Sans Symbols 2', 'DejaVu Sans', 'Apple Symbols', serif;
}
.chs-pc.w, .chs-ghost.w { color: #fff6dc;
	text-shadow: 0 0 1px #1a1406, 0 1px 0 #1a1406, 1px 0 0 #1a1406, -1px 0 0 #1a1406, 0 -1px 0 #1a1406, 0 2px 4px rgba(0,0,0,0.5); }
.chs-pc.b, .chs-ghost.b { color: #10131f;
	text-shadow: 0 0 1px #c9d4ff, 0 1px 0 rgba(201,212,255,0.6), 0 0 6px rgba(160,180,255,0.35); }
.chs-sq.is-lifted .chs-pc { visibility: hidden; }
.chs-ghost { position: absolute; left: 0; top: 0; display: grid; place-items: center; z-index: 5; }
.chs-ghost.is-drag { transform-origin: center; filter: drop-shadow(0 6px 6px rgba(0,0,0,0.5)); }
.chs-msg { min-height: 1.4em; margin: 0 !important; text-align: center; font-style: italic; color: var(--text-muted); }
.chs-msg.is-good { color: #ffe7a3; font-style: normal; font-weight: 600; }
.chs-moves { width: min(100%, 440px); min-height: 1.6em; margin: 0; padding: 0; list-style: none;
	display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 0.88rem; }
.chs-moves li span { color: var(--text-muted); margin-right: 4px; }
.chs-moves:empty::before { content: 'No moves yet.'; color: var(--text-muted); font-family: var(--font); font-style: italic; }
.chs-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; width: min(100%, 440px); }
.chs-tag { margin: 0 !important; }
.chs-memory { width: min(100%, 440px); margin: 0 !important; padding: 8px 12px; border-left: 2px solid #ffe7a3;
	background: rgba(255,231,163,0.06); border-radius: 0 8px 8px 0; font-size: 0.9rem; }
.chs-memory b { color: #ffe7a3; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-weight: 500; }
`;

function injectStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const s = document.createElement('style');
	s.id = STYLE_ID;
	s.textContent = CSS;
	document.head.append(s);
}

export function launch(): void {
	injectStyle();
	const win = openWindow({ title: 'Written in the Stars', width: 520 });
	const already = isSolved('games');
	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	let board = startBoard();
	let ply = 0;
	let selected: number | null = null;
	let busy = false;
	let won = false;
	let last: [number, number] | null = null;
	/** Bumped on reset/close so pending timers and animations from an older game do nothing. */
	let gen = 0;
	const timers = new Set<number>();

	const root = document.createElement('div');
	root.className = 'chs';
	const memory = isSolved('sky')
		? `<p class="chs-memory">Remembered from the night sky: ${CHESS_HINT.map((m) => `<b>${m}</b>`).join(' · ')}</p>`
		: '';
	root.innerHTML = `
		${already ? '<p class="secret-hint chs-tag">You’ve played this game to its end before. The board is yours to replay.</p>' : ''}
		<div class="chs-wrap"><div class="chs-board" role="grid" aria-label="Chess board, you play White"></div></div>
		<p class="chs-msg" aria-live="polite"></p>
		<ol class="chs-moves" aria-label="Moves"></ol>
		<div class="chs-bar">
			<p class="secret-hint chs-tag">Some games were written in the stars.</p>
			<button type="button" class="secret-btn chs-reset">Reset</button>
		</div>
		${memory}`;
	win.body.append(root);

	const boardEl = root.querySelector<HTMLElement>('.chs-board')!;
	const msg = root.querySelector<HTMLElement>('.chs-msg')!;
	const movesEl = root.querySelector<HTMLElement>('.chs-moves')!;

	// Build the 64 squares once, rank 8 at the top.
	const squares: HTMLButtonElement[] = new Array(64);
	for (let row = 0; row < 8; row++) {
		for (let f = 0; f < 8; f++) {
			const i = f + (7 - row) * 8;
			const el = document.createElement('button');
			el.type = 'button';
			el.className = `chs-sq${(f + row) % 2 === 0 ? ' is-light' : ''}`;
			el.dataset.i = String(i);
			let coords = '';
			if (row === 7) coords += `<span class="chs-coord f">${FILES[f]}</span>`;
			if (f === 0) coords += `<span class="chs-coord r">${8 - row}</span>`;
			el.innerHTML = `${coords}<span class="chs-pc"></span>`;
			squares[i] = el;
			boardEl.append(el);
		}
	}

	function render() {
		for (let i = 0; i < 64; i++) {
			const el = squares[i];
			const p = board[i];
			const pc = el.querySelector<HTMLElement>('.chs-pc')!;
			pc.textContent = p ? `${GLYPH[p.type]}︎` : '';
			pc.className = `chs-pc${p ? ` ${p.color}` : ''}`;
			el.classList.toggle('is-sel', selected === i);
			el.classList.toggle('is-last', !!last && (last[0] === i || last[1] === i));
			el.classList.remove('is-lifted');
			el.setAttribute(
				'aria-label',
				`${sqName(i)}${p ? `, ${p.color === 'w' ? 'white' : 'black'} ${NAME[p.type]}` : ''}`,
			);
		}
		movesEl.innerHTML = '';
		for (let k = 0; k < ply; k += 2) {
			const li = document.createElement('li');
			li.innerHTML = `<span>${k / 2 + 1}.</span>`;
			li.append(`${CHESS_LINE[k].san}${k + 1 < ply ? ` ${CHESS_LINE[k + 1].san}` : ''}`);
			movesEl.append(li);
		}
	}

	function setMsg(text: string, good = false) {
		msg.textContent = text;
		msg.classList.toggle('is-good', good);
	}

	function later(fn: () => void, ms: number) {
		const g = gen;
		const id = window.setTimeout(() => {
			timers.delete(id);
			if (g === gen) fn();
		}, ms);
		timers.add(id);
	}

	/** Centre of a square relative to the board, plus the square size. */
	function geom(i: number) {
		const size = boardEl.clientWidth / 8;
		return { x: (i % 8) * size, y: (7 - Math.floor(i / 8)) * size, size };
	}

	function makeGhost(i: number): HTMLElement {
		const p = board[i]!;
		const g = document.createElement('span');
		const { x, y, size } = geom(i);
		g.className = `chs-ghost ${p.color}`;
		g.textContent = `${GLYPH[p.type]}︎`;
		g.style.width = g.style.height = `${size}px`;
		g.style.transform = `translate(${x}px, ${y}px)`;
		boardEl.append(g);
		squares[i].classList.add('is-lifted');
		return g;
	}

	/** Slides the piece along the given squares (or from a pixel point first), then removes the ghost. */
	function slide(from: number, path: number[], ms: number, startAt?: { x: number; y: number }): Promise<void> {
		if (reduced) return Promise.resolve();
		const g = makeGhost(from);
		const frames = [startAt ?? geom(from), ...path.map(geom)].map((p) => ({
			transform: `translate(${p.x}px, ${p.y}px)`,
		}));
		return new Promise((resolve) => {
			const anim = g.animate(frames, { duration: ms, easing: 'cubic-bezier(.3,.7,.3,1)' });
			const done = () => {
				g.remove();
				resolve();
			};
			anim.onfinish = done;
			anim.oncancel = done;
		});
	}

	function apply(from: number, to: number) {
		board[to] = board[from];
		board[from] = null;
		last = [from, to];
		ply++;
	}

	async function attempt(from: number, to: number, dropAt?: { x: number; y: number }) {
		if (busy || won || ply % 2 === 1) return;
		selected = null;
		if (!shapeOK(board, from, to)) {
			render();
			return;
		}
		const expected = CHESS_LINE[ply];
		const g = gen;
		busy = true;
		if (sqName(from) !== expected.from || sqName(to) !== expected.to) {
			chime('error');
			setMsg('The stars don’t remember that move.');
			if (dropAt) await slide(from, [from], 280, dropAt);
			else await slide(from, [to, from], 620);
			if (g !== gen) return;
			busy = false;
			render();
			return;
		}
		setMsg('');
		await slide(from, [to], dropAt ? 1 : 220, dropAt);
		if (g !== gen) return;
		apply(from, to);
		render();
		if (ply >= CHESS_LINE.length) {
			win_();
			return;
		}
		later(async () => {
			const reply = CHESS_LINE[ply];
			const rf = sq(reply.from),
				rt = sq(reply.to);
			await slide(rf, [rt], 320);
			if (g !== gen) return;
			apply(rf, rt);
			busy = false;
			render();
		}, 550);
	}

	function win_() {
		won = true;
		busy = false;
		const king = board.findIndex((p) => p?.color === 'b' && p.type === 'K');
		if (king >= 0) squares[king].classList.add('is-mated');
		setMsg(
			already
				? 'Checkmate, exactly as the stars wrote it. (You had already solved this one.)'
				: 'Checkmate. The stars remembered every move.',
			true,
		);
		solve('games');
	}

	function reset() {
		gen++;
		for (const id of timers) clearTimeout(id);
		timers.clear();
		boardEl.querySelectorAll('.chs-ghost').forEach((g) => g.remove());
		boardEl.querySelectorAll('.is-mated').forEach((el) => el.classList.remove('is-mated'));
		board = startBoard();
		ply = 0;
		selected = null;
		busy = false;
		won = false;
		last = null;
		setMsg('');
		render();
	}

	/** Click (or tap, or Enter) on a square. */
	function tap(i: number) {
		if (busy || won) return;
		const p = board[i];
		if (p?.color === 'w') {
			selected = selected === i ? null : i;
			render();
			return;
		}
		if (selected !== null) void attempt(selected, i);
	}

	// ---- Pointer input: tap-to-select, tap-to-move, or drag ----
	let drag: {
		id: number;
		from: number;
		sx: number;
		sy: number;
		ghost: HTMLElement | null;
	} | null = null;

	function squareAt(clientX: number, clientY: number): number | null {
		const r = boardEl.getBoundingClientRect();
		const fx = Math.floor(((clientX - r.left) / r.width) * 8);
		const fy = Math.floor(((clientY - r.top) / r.height) * 8);
		if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
		return fx + (7 - fy) * 8;
	}

	function onDown(e: PointerEvent) {
		if (e.button !== 0 || drag) return;
		const i = squareAt(e.clientX, e.clientY);
		if (i === null) return;
		e.preventDefault();
		drag = { id: e.pointerId, from: i, sx: e.clientX, sy: e.clientY, ghost: null };
		try {
			boardEl.setPointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
	}

	function ghostPos(clientX: number, clientY: number) {
		const r = boardEl.getBoundingClientRect();
		const size = r.width / 8;
		return { x: clientX - r.left - size / 2, y: clientY - r.top - size / 2 };
	}

	function onMove(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.id) return;
		if (!drag.ghost) {
			if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
			const p = board[drag.from];
			if (busy || won || p?.color !== 'w') return;
			selected = drag.from;
			render();
			drag.ghost = makeGhost(drag.from);
			drag.ghost.classList.add('is-drag');
		}
		const { x, y } = ghostPos(e.clientX, e.clientY);
		drag.ghost.style.transform = `translate(${x}px, ${y}px) scale(1.12)`;
	}

	function onUp(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.id) return;
		const d = drag;
		drag = null;
		const to = squareAt(e.clientX, e.clientY);
		if (!d.ghost) {
			if (to !== null) tap(to);
			return;
		}
		const at = ghostPos(e.clientX, e.clientY);
		d.ghost.remove();
		if (to === null || to === d.from) {
			squares[d.from].classList.remove('is-lifted');
			return;
		}
		void attempt(d.from, to, at);
	}

	function onCancel(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.id) return;
		drag.ghost?.remove();
		drag = null;
		render();
	}

	boardEl.addEventListener('pointerdown', onDown);
	boardEl.addEventListener('pointermove', onMove);
	boardEl.addEventListener('pointerup', onUp);
	boardEl.addEventListener('pointercancel', onCancel);
	// Keyboard: buttons fire click with detail 0 on Enter/Space; pointer clicks are handled above.
	boardEl.addEventListener('click', (e) => {
		if (e.detail !== 0) return;
		const el = (e.target as Element).closest<HTMLElement>('.chs-sq');
		if (el?.dataset.i) tap(Number(el.dataset.i));
	});

	root.querySelector('.chs-reset')!.addEventListener('click', reset);

	win.onClose(() => {
		gen++;
		for (const id of timers) clearTimeout(id);
		timers.clear();
	});

	render();
}
