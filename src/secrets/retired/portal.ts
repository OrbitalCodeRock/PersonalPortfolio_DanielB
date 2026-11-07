// "momentum" on the Now page: Conservation of Momentum. A small side-view platformer with two
// linked rifts (blue and amber). Rifts open only on pale panel tiles; entering one keeps your speed
// and sends it out of the other rift's face.
//   Room 1: walk into a wall rift, drop out of a ceiling rift on the far side of the barrier.
//   Room 2: fall from the grate shelf into a floor rift, fling out of a HIGH left-wall rift across
//           the hazard (the upper wall panels; low ones don't carry far enough).
//   Room 3: fall into the pit-floor rift, come out of the far right floor rift, rise and steer right
//           onto the exit ledge.
// Grates (':') block the player but let rift shots through.
import { openWindow, solve, chime } from '../ui'; // retired: no longer launched by any trigger
import { isSolved, getData, setData } from '../progress';

const ID = 'now';
const GOLD = '#ffe7a3';
const BLUE = '#6fb6ff';
const AMBER = '#ffb35c';

const COLS = 32;
const ROWS = 18;

// Physics, in tiles and seconds.
const GRAV = 40;
const RUN = 7;
const GROUND_ACCEL = 70;
const GROUND_SLIDE = 60;
const AIR_ACCEL = 30;
const AIR_ACCEL_FAST = 12;
const JUMP_V = 14.5;
const MAX_V = 36;
const PW = 0.75;
const PH = 1.5;
const MIN_EXIT = 3;

type Vec = { x: number; y: number };

interface Room {
	grid: string[][];
	spawn: Vec; // feet position
	title: string;
	hint: string;
}

interface Rift {
	/** First tile (smallest x or y) of the two it covers. */
	tx: number;
	ty: number;
	/** Outward normal. */
	n: Vec;
}

function makeRoom(title: string, hint: string, spawn: Vec, build: (fill: (x0: number, y0: number, x1: number, y1: number, ch: string) => void) => void): Room {
	const grid: string[][] = [];
	for (let y = 0; y < ROWS; y++) {
		const row: string[] = [];
		for (let x = 0; x < COLS; x++) row.push(x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? '#' : '.');
		grid.push(row);
	}
	build((x0, y0, x1, y1, ch) => {
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = ch;
	});
	return { grid, spawn, title, hint };
}

// Tiles: '#' wall, 'P' rift panel, ':' grate, 'x' hazard, 'E' exit, '.' air.
const ROOMS: Room[] = [
	makeRoom('Room 1 · Two Doors', 'Rifts only open on pale panels. Walk into one, step out of the other.', { x: 3, y: 17 }, (f) => {
		f(0, 12, 0, 16, 'P');
		f(14, 8, 16, 16, '#');
		f(19, 0, 28, 0, 'P');
		f(29, 15, 29, 16, 'E');
	}),
	makeRoom('Room 2 · The Long Drop', 'Speed in, speed out. Grates stop you, not your rifts.', { x: 4, y: 3 }, (f) => {
		f(0, 5, 0, 10, 'P');
		f(2, 3, 6, 3, ':');
		f(1, 17, 9, 17, 'P');
		f(10, 17, 17, 17, 'x');
		f(18, 15, 30, 16, '#');
		f(29, 13, 29, 14, 'E');
	}),
	makeRoom('Room 3 · What Falls Must Rise', 'Everything that goes down comes back up.', { x: 4, y: 3 }, (f) => {
		f(2, 3, 6, 3, ':');
		f(1, 17, 8, 17, 'P');
		f(9, 17, 22, 17, 'x');
		f(23, 17, 25, 17, 'P');
		f(15, 1, 16, 7, '#');
		f(27, 8, 30, 8, '#');
		f(27, 9, 27, 16, '#');
		f(29, 6, 29, 7, 'E');
	}),
];

const STYLE_ID = 'secret-style-portal';
const STYLE = `
.rift-canvas { aspect-ratio: 32 / 18; background: #070b1d; cursor: crosshair; }
.rift-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.rift-top .secret-hint { margin: 0; }
.rift-room { color: ${GOLD}; font-weight: 600; font-size: 0.92rem; }
.rift-wrap { position: relative; }
.rift-win { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 16px;
	background: rgba(4, 8, 20, 0.75); border-radius: 8px; }
.rift-win[hidden] { display: none; }
.rift-win strong { color: ${GOLD}; font-size: 1.15rem; display: block; margin-bottom: 6px; }
.rift-pad { display: none; margin-top: 10px; gap: 8px; justify-content: space-between; user-select: none; -webkit-user-select: none; }
.rift-pad.is-on { display: flex; }
.rift-pad > div { display: flex; gap: 8px; }
.rift-pad .secret-btn { min-width: 46px; min-height: 44px; padding: 6px 10px; touch-action: none; }
.rift-pad .secret-btn.is-held { background: rgba(111, 182, 255, 0.35); }
.rift-pick-blue.is-picked { border-color: ${BLUE}; box-shadow: 0 0 0 2px ${BLUE} inset; }
.rift-pick-amber.is-picked { border-color: ${AMBER}; box-shadow: 0 0 0 2px ${AMBER} inset; }
.rift-bar { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.rift-bar .secret-hint { margin: 0; }
`;

const isSolidCh = (c: string) => c === '#' || c === 'P' || c === ':' || c === 'x';

export function launch(): void {
	if (!document.getElementById(STYLE_ID)) {
		const s = document.createElement('style');
		s.id = STYLE_ID;
		s.textContent = STYLE;
		document.head.append(s);
	}

	const win = openWindow({ title: 'Conservation of Momentum', width: 720 });
	const already = isSolved(ID);
	const solvedNote = already ? ` · <b style="color:${GOLD}">Already solved; play again freely.</b>` : '';
	win.body.innerHTML = `
		<div class="rift-top"><span class="rift-room"></span><p class="secret-hint rift-hint"></p></div>
		<div class="rift-wrap">
			<canvas class="secret-canvas rift-canvas" aria-label="Side-view platformer with two linked rifts"></canvas>
			<div class="rift-win" hidden><div><strong>Momentum conserved</strong><span>You made it through all three rooms.</span><br><br><button type="button" class="secret-btn rift-again">Play again</button></div></div>
		</div>
		<div class="rift-pad">
			<div>
				<button type="button" class="secret-btn" data-hold="left" aria-label="Move left">◀</button>
				<button type="button" class="secret-btn" data-hold="right" aria-label="Move right">▶</button>
			</div>
			<div>
				<button type="button" class="secret-btn rift-pick-blue is-picked" aria-label="Aim blue rift">Blue</button>
				<button type="button" class="secret-btn rift-pick-amber" aria-label="Aim amber rift">Amber</button>
			</div>
			<div>
				<button type="button" class="secret-btn" data-hold="jump" aria-label="Jump">Jump</button>
			</div>
		</div>
		<div class="rift-bar">
			<p class="secret-hint rift-keys">Move: arrows / WASD · Jump: Space / W / ↑ · Rifts: left click (or Q) blue, right click (or E) amber · R resets the room${solvedNote}</p>
			<button type="button" class="secret-btn rift-reset">Reset room</button>
		</div>`;

	const canvas = win.body.querySelector<HTMLCanvasElement>('.rift-canvas')!;
	const ctx = canvas.getContext('2d')!;
	const roomEl = win.body.querySelector<HTMLElement>('.rift-room')!;
	const hintEl = win.body.querySelector<HTMLElement>('.rift-hint')!;
	const winBox = win.body.querySelector<HTMLElement>('.rift-win')!;
	const pad = win.body.querySelector<HTMLElement>('.rift-pad')!;
	const keysEl = win.body.querySelector<HTMLElement>('.rift-keys')!;
	const pickBlue = win.body.querySelector<HTMLButtonElement>('.rift-pick-blue')!;
	const pickAmber = win.body.querySelector<HTMLButtonElement>('.rift-pick-amber')!;

	// ---- State --------------------------------------------------------------------------------

	let roomIndex = Math.min(ROOMS.length - 1, Math.max(0, getData<number>('now-room', 0)));
	let room = ROOMS[roomIndex];
	const player = { x: 0, y: 0, vx: 0, vy: 0, grounded: false, face: 1 };
	let rifts: [Rift | null, Rift | null] = [null, null];
	let coyote = 0;
	let jumpBuffer = 0;
	let flash = 0; // death flash
	let banner = 0; // room title banner
	let won = false;
	let shot: { x0: number; y0: number; x1: number; y1: number; color: string; t: number } | null = null;
	let aimPt: Vec | null = null;
	let picked: 0 | 1 = 0;
	const held = { left: false, right: false, jump: false };
	const keys = { left: false, right: false, jump: false };
	let jumpWasDown = false;
	let jumping = false;

	let raf = 0;
	let last = performance.now();
	let cw = 0;
	let ch = 0;

	const tileAt = (x: number, y: number): string => {
		if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return '#';
		return room.grid[y][x];
	};

	const respawn = () => {
		player.x = room.spawn.x;
		player.y = room.spawn.y - PH / 2;
		player.vx = 0;
		player.vy = 0;
		player.grounded = false;
		player.face = 1;
	};

	const loadRoom = (i: number) => {
		roomIndex = i;
		room = ROOMS[i];
		rifts = [null, null];
		shot = null;
		respawn();
		roomEl.textContent = room.title;
		hintEl.textContent = room.hint;
		banner = 1.6;
		win.setStatus(`Room ${i + 1} of ${ROOMS.length}`);
	};

	// ---- Rifts --------------------------------------------------------------------------------

	const tangentOf = (n: Vec): Vec => ({ x: Math.abs(n.y), y: Math.abs(n.x) });

	/** Covered tiles of a rift. */
	const riftTiles = (r: Rift): Vec[] => {
		const t = tangentOf(r.n);
		return [
			{ x: r.tx, y: r.ty },
			{ x: r.tx + t.x, y: r.ty + t.y },
		];
	};

	/** Centre of the rift's opening, on the tile face. */
	const riftCenter = (r: Rift): Vec => {
		const t = tangentOf(r.n);
		// Tile centre of the pair, pushed to the face.
		const cx = r.tx + 0.5 + t.x * 0.5 + r.n.x * 0.5;
		const cy = r.ty + 0.5 + t.y * 0.5 + r.n.y * 0.5;
		return { x: cx, y: cy };
	};

	interface Hit {
		tx: number;
		ty: number;
		n: Vec;
		hx: number;
		hy: number;
	}

	const raycast = (ox: number, oy: number, dx: number, dy: number): Hit | null => {
		const len = Math.hypot(dx, dy);
		if (len < 1e-9) return null;
		dx /= len;
		dy /= len;
		let tx = Math.floor(ox);
		let ty = Math.floor(oy);
		const sx = dx > 0 ? 1 : -1;
		const sy = dy > 0 ? 1 : -1;
		const tdx = Math.abs(1 / (dx || 1e-12));
		const tdy = Math.abs(1 / (dy || 1e-12));
		let tmx = (dx > 0 ? tx + 1 - ox : ox - tx) * tdx;
		let tmy = (dy > 0 ? ty + 1 - oy : oy - ty) * tdy;
		for (let i = 0; i < 200; i++) {
			let n: Vec;
			let t: number;
			if (tmx < tmy) {
				t = tmx;
				tmx += tdx;
				tx += sx;
				n = { x: -sx, y: 0 };
			} else {
				t = tmy;
				tmy += tdy;
				ty += sy;
				n = { x: 0, y: -sy };
			}
			if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return null;
			const c = room.grid[ty][tx];
			if (isSolidCh(c) && c !== ':') return { tx, ty, n, hx: ox + dx * t, hy: oy + dy * t };
		}
		return null;
	};

	const fire = (which: 0 | 1, target: Vec) => {
		if (won) return;
		const ox = player.x;
		const oy = player.y - 0.2;
		const hit = raycast(ox, oy, target.x - ox, target.y - oy);
		const color = which === 0 ? BLUE : AMBER;
		if (!hit) return;
		const placed = tryPlace(which, hit);
		shot = { x0: ox, y0: oy, x1: hit.hx, y1: hit.hy, color: placed ? color : 'rgba(255,255,255,0.35)', t: 0.18 };
		if (!placed) chime('error');
	};

	const tryPlace = (which: 0 | 1, hit: Hit): boolean => {
		if (tileAt(hit.tx, hit.ty) !== 'P') return false;
		const t = tangentOf(hit.n);
		const frac = t.x ? hit.hx - hit.tx : hit.hy - hit.ty;
		const order = frac < 0.5 ? [-1, 1] : [1, -1];
		const other = rifts[which === 0 ? 1 : 0];
		for (const dir of order) {
			const bx = hit.tx + t.x * dir;
			const by = hit.ty + t.y * dir;
			const cand: Rift = { tx: Math.min(hit.tx, bx), ty: Math.min(hit.ty, by), n: hit.n };
			const tiles = riftTiles(cand);
			const ok = tiles.every((p) => tileAt(p.x, p.y) === 'P' && !isSolidCh(tileAt(p.x + hit.n.x, p.y + hit.n.y)));
			if (!ok) continue;
			if (other && other.n.x === cand.n.x && other.n.y === cand.n.y) {
				const ot = riftTiles(other);
				if (tiles.some((p) => ot.some((q) => q.x === p.x && q.y === p.y))) continue;
			}
			rifts[which] = cand;
			return true;
		}
		return false;
	};

	/** If the face the player just bumped into carries a linked rift, go through it. */
	const tryRift = (tile: number, n: Vec): boolean => {
		const [a, b] = rifts;
		if (!a || !b) return false;
		for (const [from, to] of [
			[a, b],
			[b, a],
		] as [Rift, Rift][]) {
			if (from.n.x !== n.x || from.n.y !== n.y) continue;
			if (n.x !== 0) {
				if (from.tx !== tile) continue;
				if (player.y < from.ty || player.y > from.ty + 2) continue;
			} else {
				if (from.ty !== tile) continue;
				if (player.x < from.tx || player.x > from.tx + 2) continue;
			}
			teleport(from, to);
			return true;
		}
		return false;
	};

	const teleport = (from: Rift, to: Rift) => {
		// Rotate velocity so that "into from" becomes "out of to".
		const angIn = Math.atan2(-from.n.y, -from.n.x);
		const angOut = Math.atan2(to.n.y, to.n.x);
		const a = angOut - angIn;
		const c = Math.round(Math.cos(a));
		const s = Math.round(Math.sin(a));
		let vx = player.vx * c - player.vy * s;
		let vy = player.vx * s + player.vy * c;
		const along = vx * to.n.x + vy * to.n.y;
		if (along < MIN_EXIT) {
			vx += to.n.x * (MIN_EXIT - along);
			vy += to.n.y * (MIN_EXIT - along);
		}
		const ctr = riftCenter(to);
		const half = to.n.x !== 0 ? PW / 2 : PH / 2;
		player.x = ctr.x + to.n.x * (half + 0.02);
		player.y = ctr.y + to.n.y * (half + 0.02);
		player.vx = vx;
		player.vy = vy;
		player.grounded = false;
		jumping = false;
		if (to.n.x) player.face = to.n.x;
	};

	const die = () => {
		flash = 0.35;
		chime('error');
		respawn();
	};

	// ---- Movement -----------------------------------------------------------------------------

	/** Moves along one axis; returns false if the move was cut short by a rift or death. */
	const moveX = (dx: number): boolean => {
		player.x += dx;
		const top = Math.floor(player.y - PH / 2);
		const bot = Math.floor(player.y + PH / 2 - 1e-6);
		if (dx > 0) {
			const c = Math.floor(player.x + PW / 2);
			let hazard = false;
			let hit = false;
			for (let r = top; r <= bot; r++) {
				const t = tileAt(c, r);
				if (isSolidCh(t)) {
					hit = true;
					if (t === 'x') hazard = true;
				}
			}
			if (!hit) return true;
			if (tryRift(c, { x: -1, y: 0 })) return false;
			if (hazard) {
				die();
				return false;
			}
			player.x = c - PW / 2 - 1e-4;
			player.vx = 0;
		} else if (dx < 0) {
			const c = Math.floor(player.x - PW / 2);
			let hazard = false;
			let hit = false;
			for (let r = top; r <= bot; r++) {
				const t = tileAt(c, r);
				if (isSolidCh(t)) {
					hit = true;
					if (t === 'x') hazard = true;
				}
			}
			if (!hit) return true;
			if (tryRift(c, { x: 1, y: 0 })) return false;
			if (hazard) {
				die();
				return false;
			}
			player.x = c + 1 + PW / 2 + 1e-4;
			player.vx = 0;
		}
		return true;
	};

	const moveY = (dy: number): boolean => {
		player.y += dy;
		const left = Math.floor(player.x - PW / 2);
		const right = Math.floor(player.x + PW / 2 - 1e-6);
		if (dy > 0) {
			const r = Math.floor(player.y + PH / 2);
			let hazard = false;
			let hit = false;
			for (let c = left; c <= right; c++) {
				const t = tileAt(c, r);
				if (isSolidCh(t)) {
					hit = true;
					if (t === 'x') hazard = true;
				}
			}
			if (!hit) return true;
			if (tryRift(r, { x: 0, y: -1 })) return false;
			if (hazard) {
				die();
				return false;
			}
			player.y = r - PH / 2 - 1e-4;
			player.vy = 0;
			player.grounded = true;
		} else if (dy < 0) {
			const r = Math.floor(player.y - PH / 2);
			let hit = false;
			let hazard = false;
			for (let c = left; c <= right; c++) {
				const t = tileAt(c, r);
				if (isSolidCh(t)) {
					hit = true;
					if (t === 'x') hazard = true;
				}
			}
			if (!hit) return true;
			if (tryRift(r, { x: 0, y: 1 })) return false;
			if (hazard) {
				die();
				return false;
			}
			player.y = r + 1 + PH / 2 + 1e-4;
			player.vy = 0;
		}
		return true;
	};

	const touchingExit = (): boolean => {
		const x0 = Math.floor(player.x - PW / 2);
		const x1 = Math.floor(player.x + PW / 2);
		const y0 = Math.floor(player.y - PH / 2);
		const y1 = Math.floor(player.y + PH / 2 - 1e-6);
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (tileAt(x, y) === 'E') return true;
		return false;
	};

	const step = (dt: number) => {
		const left = keys.left || held.left;
		const right = keys.right || held.right;
		const jumpDown = keys.jump || held.jump;
		const input = (right ? 1 : 0) - (left ? 1 : 0);
		if (input) player.face = input;

		if (jumpDown && !jumpWasDown) jumpBuffer = 0.12;
		jumpWasDown = jumpDown;
		jumpBuffer = Math.max(0, jumpBuffer - dt);
		coyote = player.grounded ? 0.1 : Math.max(0, coyote - dt);

		// Horizontal control: never bleeds momentum in the air unless you push against it.
		if (player.grounded) {
			const target = input * RUN;
			const rate = Math.abs(player.vx) > RUN ? GROUND_SLIDE : GROUND_ACCEL;
			if (player.vx < target) player.vx = Math.min(target, player.vx + rate * dt);
			else if (player.vx > target) player.vx = Math.max(target, player.vx - rate * dt);
		} else if (input) {
			const fast = Math.abs(player.vx) > RUN;
			const rate = fast ? AIR_ACCEL_FAST : AIR_ACCEL;
			if (input * player.vx < RUN) {
				player.vx += input * rate * dt;
				if (!fast && input * player.vx > RUN) player.vx = input * RUN;
			}
		}

		if (jumpBuffer > 0 && coyote > 0) {
			player.vy = -JUMP_V;
			jumpBuffer = 0;
			coyote = 0;
			player.grounded = false;
			jumping = true;
		}
		if (player.vy >= 0) jumping = false;
		if (jumping && !jumpDown && player.vy < -JUMP_V * 0.45) player.vy = -JUMP_V * 0.45; // short hop

		player.vy = Math.min(MAX_V, player.vy + GRAV * dt);
		player.vx = Math.max(-MAX_V, Math.min(MAX_V, player.vx));
		player.vy = Math.max(-MAX_V, player.vy);

		player.grounded = false;
		const dist = Math.max(Math.abs(player.vx), Math.abs(player.vy)) * dt;
		const n = Math.max(1, Math.ceil(dist / 0.3));
		for (let i = 0; i < n; i++) {
			if (!moveX((player.vx * dt) / n)) break;
			if (!moveY((player.vy * dt) / n)) break;
		}

		if (player.y > ROWS + 4 || player.y < -4 || player.x < -4 || player.x > COLS + 4) die();

		if (touchingExit()) {
			if (roomIndex < ROOMS.length - 1) {
				chime('open');
				loadRoom(roomIndex + 1);
				setData('now-room', roomIndex);
			} else {
				won = true;
				setData('now-room', 0);
				solve(ID);
				winBox.hidden = false;
				win.setStatus('All rooms cleared');
			}
		}
	};

	// ---- Input --------------------------------------------------------------------------------

	const toWorld = (clientX: number, clientY: number): Vec => {
		const rect = canvas.getBoundingClientRect();
		return { x: ((clientX - rect.left) / rect.width) * COLS, y: ((clientY - rect.top) / rect.height) * ROWS };
	};

	const showPad = () => {
		if (pad.classList.contains('is-on')) return;
		pad.classList.add('is-on');
		keysEl.innerHTML = `Pick Blue or Amber, then tap a pale panel. Hold the arrows to run.${solvedNote}`;
	};
	if (window.matchMedia('(pointer: coarse)').matches) showPad();

	const onCanvasDown = (e: PointerEvent) => {
		e.preventDefault();
		const p = toWorld(e.clientX, e.clientY);
		aimPt = p;
		if (e.pointerType === 'mouse') {
			if (e.button === 0) fire(0, p);
			else if (e.button === 2) fire(1, p);
		} else {
			showPad();
			fire(picked, p);
		}
	};
	const onCanvasMove = (e: PointerEvent) => {
		if (e.pointerType === 'mouse') aimPt = toWorld(e.clientX, e.clientY);
	};
	const onCanvasLeave = () => {
		aimPt = null;
	};
	const onContext = (e: Event) => e.preventDefault();
	canvas.addEventListener('pointerdown', onCanvasDown);
	canvas.addEventListener('pointermove', onCanvasMove);
	canvas.addEventListener('pointerleave', onCanvasLeave);
	canvas.addEventListener('contextmenu', onContext);

	for (const btn of pad.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
		const k = btn.dataset.hold as keyof typeof held;
		const down = (e: PointerEvent) => {
			e.preventDefault();
			held[k] = true;
			btn.classList.add('is-held');
			try {
				btn.setPointerCapture(e.pointerId);
			} catch {
				/* fine */
			}
		};
		const up = () => {
			held[k] = false;
			btn.classList.remove('is-held');
		};
		btn.addEventListener('pointerdown', down);
		btn.addEventListener('pointerup', up);
		btn.addEventListener('pointercancel', up);
		btn.addEventListener('lostpointercapture', up);
		btn.addEventListener('contextmenu', onContext);
	}
	const setPick = (w: 0 | 1) => {
		picked = w;
		pickBlue.classList.toggle('is-picked', w === 0);
		pickAmber.classList.toggle('is-picked', w === 1);
	};
	pickBlue.addEventListener('click', () => setPick(0));
	pickAmber.addEventListener('click', () => setPick(1));

	const resetRoom = () => {
		if (won) return;
		loadRoom(roomIndex);
	};
	win.body.querySelector('.rift-reset')!.addEventListener('click', resetRoom);
	win.body.querySelector('.rift-again')!.addEventListener('click', () => {
		won = false;
		winBox.hidden = true;
		loadRoom(0);
	});

	const fireByKey = (which: 0 | 1) => {
		const target = aimPt ?? { x: player.x + player.face * 10, y: player.y - 0.2 };
		fire(which, target);
	};

	const keyMap = (e: KeyboardEvent, down: boolean): boolean => {
		switch (e.key) {
			case 'ArrowLeft':
			case 'a':
			case 'A':
				keys.left = down;
				return true;
			case 'ArrowRight':
			case 'd':
			case 'D':
				keys.right = down;
				return true;
			case 'ArrowUp':
			case 'w':
			case 'W':
			case ' ':
				keys.jump = down;
				return true;
			case 'ArrowDown':
			case 's':
			case 'S':
				return true;
		}
		return false;
	};
	const onKeyDown = (e: KeyboardEvent) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		if (keyMap(e, true)) {
			e.preventDefault();
			return;
		}
		if (e.repeat) return;
		if (e.key === 'q' || e.key === 'Q') fireByKey(0);
		else if (e.key === 'e' || e.key === 'E') fireByKey(1);
		else if (e.key === 'r' || e.key === 'R') resetRoom();
	};
	const onKeyUp = (e: KeyboardEvent) => {
		keyMap(e, false);
	};
	const onBlur = () => {
		keys.left = keys.right = keys.jump = false;
	};
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
	window.addEventListener('blur', onBlur);

	// ---- Drawing ------------------------------------------------------------------------------

	const resize = () => {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = Math.round((canvas.clientWidth || 640) * dpr);
		const h = Math.round((w * ROWS) / COLS);
		if (w === cw && h === ch) return;
		cw = canvas.width = w;
		ch = canvas.height = h;
	};
	const ro = new ResizeObserver(resize);
	ro.observe(canvas);

	const drawTile = (c: string, x: number, y: number, s: number, time: number) => {
		const px = x * s;
		const py = y * s;
		if (c === '#') {
			ctx.fillStyle = '#121a35';
			ctx.fillRect(px, py, s + 0.5, s + 0.5);
			ctx.fillStyle = 'rgba(138,125,255,0.10)';
			ctx.fillRect(px, py, s, Math.max(1, s * 0.06));
		} else if (c === 'P') {
			const g = s * 0.06;
			ctx.fillStyle = '#1c2a52';
			ctx.fillRect(px, py, s + 0.5, s + 0.5);
			ctx.fillStyle = '#a9c4ef';
			ctx.globalAlpha = 0.85;
			ctx.fillRect(px + g, py + g, s - 2 * g, s - 2 * g);
			ctx.globalAlpha = 1;
			ctx.fillStyle = 'rgba(255,255,255,0.55)';
			ctx.fillRect(px + g, py + g, s - 2 * g, Math.max(1, s * 0.05));
		} else if (c === ':') {
			ctx.strokeStyle = '#6b78a8';
			ctx.lineWidth = Math.max(1, s * 0.06);
			ctx.strokeRect(px + s * 0.05, py + s * 0.1, s * 0.9, s * 0.8);
			ctx.beginPath();
			for (let i = 1; i < 4; i++) {
				ctx.moveTo(px + (s * i) / 4, py + s * 0.1);
				ctx.lineTo(px + (s * i) / 4, py + s * 0.9);
			}
			ctx.stroke();
		} else if (c === 'x') {
			const pulse = 0.55 + 0.25 * Math.sin(time / 180 + x);
			const g = ctx.createLinearGradient(0, py, 0, py + s);
			g.addColorStop(0, `rgba(138,125,255,${pulse})`);
			g.addColorStop(1, 'rgba(60,20,90,0.9)');
			ctx.fillStyle = g;
			ctx.fillRect(px, py, s + 0.5, s + 0.5);
			ctx.strokeStyle = `rgba(230,200,255,${pulse})`;
			ctx.lineWidth = Math.max(1, s * 0.05);
			ctx.beginPath();
			for (let i = 0; i <= 8; i++) {
				const xx = px + (s * i) / 8;
				const yy = py + s * 0.25 + Math.sin(time / 120 + x * 2 + i) * s * 0.1;
				if (i === 0) ctx.moveTo(xx, yy);
				else ctx.lineTo(xx, yy);
			}
			ctx.stroke();
		}
	};

	const drawExit = (s: number, time: number) => {
		// Group exit tiles by column: draw one arch per column run.
		for (let x = 0; x < COLS; x++) {
			let y0 = -1;
			for (let y = 0; y <= ROWS; y++) {
				const isE = y < ROWS && room.grid[y][x] === 'E';
				if (isE && y0 < 0) y0 = y;
				if (!isE && y0 >= 0) {
					const top = y0 * s;
					const bot = y * s;
					const l = (x - 0.15) * s;
					const r = (x + 1.15) * s;
					ctx.save();
					ctx.shadowColor = GOLD;
					ctx.shadowBlur = s * (0.6 + 0.2 * Math.sin(time / 300));
					ctx.strokeStyle = GOLD;
					ctx.lineWidth = Math.max(1.5, s * 0.12);
					ctx.beginPath();
					ctx.moveTo(l, bot);
					ctx.lineTo(l, top + (r - l) / 2);
					ctx.arc((l + r) / 2, top + (r - l) / 2, (r - l) / 2, Math.PI, 0);
					ctx.lineTo(r, bot);
					ctx.stroke();
					ctx.fillStyle = 'rgba(255,231,163,0.14)';
					ctx.fill();
					ctx.restore();
					y0 = -1;
				}
			}
		}
	};

	const drawRift = (r: Rift, color: string, time: number, s: number) => {
		const c = riftCenter(r);
		const horiz = r.n.y !== 0;
		const cx = (c.x + r.n.x * 0.12) * s;
		const cy = (c.y + r.n.y * 0.12) * s;
		const rx = (horiz ? 0.98 : 0.24) * s;
		const ry = (horiz ? 0.24 : 0.98) * s;
		ctx.save();
		ctx.shadowColor = color;
		ctx.shadowBlur = s * 0.8;
		ctx.fillStyle = '#050816';
		ctx.beginPath();
		ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.lineWidth = Math.max(2, s * 0.14);
		ctx.strokeStyle = color;
		ctx.stroke();
		ctx.restore();
		// swirling inner ring
		ctx.save();
		ctx.strokeStyle = color;
		ctx.globalAlpha = 0.6;
		ctx.lineWidth = Math.max(1, s * 0.05);
		ctx.setLineDash([s * 0.2, s * 0.18]);
		ctx.lineDashOffset = -time / 30;
		ctx.beginPath();
		ctx.ellipse(cx, cy, rx * 0.65, ry * 0.65, 0, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	};

	const drawPlayer = (s: number) => {
		const x = (player.x - PW / 2) * s;
		const y = (player.y - PH / 2) * s;
		const w = PW * s;
		const h = PH * s;
		ctx.save();
		ctx.shadowColor = 'rgba(111,182,255,0.6)';
		ctx.shadowBlur = s * 0.4;
		ctx.fillStyle = '#d6e6ff';
		ctx.beginPath();
		ctx.roundRect(x, y, w, h, s * 0.25);
		ctx.fill();
		ctx.restore();
		// visor
		ctx.fillStyle = GOLD;
		const vw = w * 0.55;
		const vx = player.face > 0 ? x + w - vw - w * 0.08 : x + w * 0.08;
		ctx.beginPath();
		ctx.roundRect(vx, y + h * 0.16, vw, h * 0.16, s * 0.06);
		ctx.fill();
		// pack in the colour of the selected rift
		ctx.fillStyle = picked === 0 ? BLUE : AMBER;
		const bx = player.face > 0 ? x - w * 0.12 : x + w * 0.82;
		ctx.fillRect(bx, y + h * 0.42, w * 0.3, h * 0.3);
	};

	const draw = (time: number, dt: number) => {
		if (!cw) return;
		const s = cw / COLS;
		const bg = ctx.createLinearGradient(0, 0, 0, ch);
		bg.addColorStop(0, '#070b1d');
		bg.addColorStop(1, '#0f1736');
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, cw, ch);
		// faint backdrop grid
		ctx.strokeStyle = 'rgba(138,125,255,0.05)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let x = 0; x <= COLS; x += 2) {
			ctx.moveTo(x * s, 0);
			ctx.lineTo(x * s, ch);
		}
		for (let y = 0; y <= ROWS; y += 2) {
			ctx.moveTo(0, y * s);
			ctx.lineTo(cw, y * s);
		}
		ctx.stroke();

		for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) drawTile(room.grid[y][x], x, y, s, time);
		drawExit(s, time);

		// aim line (mouse)
		if (aimPt && !won) {
			ctx.save();
			ctx.strokeStyle = 'rgba(255,255,255,0.12)';
			ctx.setLineDash([s * 0.15, s * 0.25]);
			ctx.lineWidth = Math.max(1, s * 0.05);
			ctx.beginPath();
			ctx.moveTo(player.x * s, (player.y - 0.2) * s);
			ctx.lineTo(aimPt.x * s, aimPt.y * s);
			ctx.stroke();
			ctx.restore();
		}

		if (rifts[0]) drawRift(rifts[0], BLUE, time, s);
		if (rifts[1]) drawRift(rifts[1], AMBER, time, s);

		if (shot) {
			ctx.save();
			ctx.globalAlpha = Math.max(0, shot.t / 0.18);
			ctx.strokeStyle = shot.color;
			ctx.lineWidth = Math.max(1.5, s * 0.1);
			ctx.beginPath();
			ctx.moveTo(shot.x0 * s, shot.y0 * s);
			ctx.lineTo(shot.x1 * s, shot.y1 * s);
			ctx.stroke();
			ctx.restore();
			shot.t -= dt;
			if (shot.t <= 0) shot = null;
		}

		drawPlayer(s);

		if (flash > 0) {
			ctx.fillStyle = `rgba(138,125,255,${flash})`;
			ctx.fillRect(0, 0, cw, ch);
		}
		if (banner > 0) {
			ctx.save();
			ctx.globalAlpha = Math.min(1, banner);
			ctx.fillStyle = GOLD;
			ctx.font = `600 ${Math.round(s * 1.1)}px system-ui, sans-serif`;
			ctx.textAlign = 'center';
			ctx.fillText(room.title, cw / 2, s * 3);
			ctx.restore();
		}
	};

	const loop = (time: number) => {
		const dt = Math.min(1 / 30, (time - last) / 1000);
		last = time;
		if (!won) step(dt);
		flash = Math.max(0, flash - dt);
		banner = Math.max(0, banner - dt);
		draw(time, dt);
		raf = requestAnimationFrame(loop);
	};

	loadRoom(roomIndex);
	raf = requestAnimationFrame((t) => {
		last = t;
		resize();
		loop(t);
	});

	win.onClose(() => {
		cancelAnimationFrame(raf);
		ro.disconnect();
		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);
		window.removeEventListener('blur', onBlur);
	});
}
