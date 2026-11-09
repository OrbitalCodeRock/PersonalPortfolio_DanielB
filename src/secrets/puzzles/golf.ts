// "optimization" on the Web Development page: Global Minimum. Fog-of-war golf on a contour map.
// Drag back from anywhere on the map and release to sling the ball. Gravity pulls it downhill along
// the height field, so it rolls into basins; the hole sits in the one global minimum. Only a circle
// around the ball is lit, and places the ball has been stay faintly visible.
//
// Sinking hole 1 solves the secret. After it, the rest of the course opens (src/secrets/golfCourse.ts):
// holes with water (roll in and play again from where you hit, a stroke down) and ground that moves.
import { openWindow, solve, chime } from '../ui';
import { isSolved, getData, setData } from '../progress';
import { BALL_R, HOLES, HOLE_R, H, VMAX, W, bumpAt, height, moves, stepBall, type Ball, type Hole } from '../golfCourse';

const ID = 'web';
const GOLD = '#ffe7a3';
const H_MIN = -1.1;
const H_MAX = 1.12;
const STEP = 0.1; // contour interval
/** Drag distance (world units) for a full-power shot. */
const FULL_DRAG = 1.1;
const MEMORY_R = 0.3;
/** Seconds between contour redraws on a hole whose ground moves. */
const REDRAW = 0.12;

const STYLE_ID = 'secret-style-golf';
const STYLE = `
.golf-wrap { position: relative; }
.golf-canvas { aspect-ratio: 4 / 3; cursor: crosshair; background: #02040c; }
.golf-bar { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; margin-top: 10px; }
.golf-bar .secret-hint { margin: 0; }
.golf-holes { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; font-size: .85rem; color: var(--text-muted); }
.golf-hole { font: inherit; font-size: .82rem; cursor: pointer; min-width: 2.2em; padding: 3px 8px; border-radius: 999px;
	border: 1px solid var(--border); background: transparent; color: var(--text-muted); }
.golf-hole[aria-pressed="true"] { border-color: rgba(255, 210, 120, .6); color: ${GOLD}; background: rgba(255, 210, 120, .12); }
.golf-hole[disabled] { opacity: .35; cursor: default; }
.golf-win { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 16px;
	background: rgba(4, 8, 20, 0.72); border-radius: 8px; }
.golf-win[hidden] { display: none; }
.golf-win strong { color: ${GOLD}; font-size: 1.15rem; display: block; margin-bottom: 6px; }
.golf-win .golf-actions { display: flex; gap: 8px; justify-content: center; margin-top: 14px; flex-wrap: wrap; }
`;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Best strokes per hole; hole 1 keeps its original key. */
const bestKey = (i: number) => (i === 0 ? 'web-best' : `web-best-${i + 1}`);

export function launch(): void {
	if (!document.getElementById(STYLE_ID)) {
		const s = document.createElement('style');
		s.id = STYLE_ID;
		s.textContent = STYLE;
		document.head.append(s);
	}

	const win = openWindow({ title: 'Global Minimum', width: 640 });
	win.body.innerHTML = `
		<div class="golf-holes" role="group" aria-label="Holes">Hole</div>
		<p class="secret-hint golf-intro"></p>
		<div class="golf-wrap">
			<canvas class="secret-canvas golf-canvas" aria-label="Fog-covered contour map with a golf ball"></canvas>
			<div class="golf-win" hidden><div><strong></strong><span></span><div class="golf-actions"></div></div></div>
		</div>
		<div class="golf-bar">
			<p class="secret-hint golf-strokes"></p>
			<button type="button" class="secret-btn golf-reset">Restart hole</button>
		</div>`;

	const canvas = win.body.querySelector<HTMLCanvasElement>('.golf-canvas')!;
	const ctx = canvas.getContext('2d')!;
	const winBox = win.body.querySelector<HTMLElement>('.golf-win')!;
	const strokesEl = win.body.querySelector<HTMLElement>('.golf-strokes')!;
	const intro = win.body.querySelector<HTMLElement>('.golf-intro')!;
	const holesEl = win.body.querySelector<HTMLElement>('.golf-holes')!;

	const mapCv = document.createElement('canvas');
	const memCv = document.createElement('canvas');
	const fogCv = document.createElement('canvas');

	let index = 0;
	let hole: Hole = HOLES[0];
	const ball: Ball = { x: hole.start.x, y: hole.start.y, vx: 0, vy: 0, rest: true };
	/** Where the last shot was hit from (water sends the ball back here). */
	let shotFrom = { x: ball.x, y: ball.y };
	let strokes = 0;
	let won = false;
	let sinking = 0; // seconds into the sink animation (0 = not sinking)
	let splash: { x: number; y: number; t: number } | null = null;
	let notice = '';
	let noticeT = 0;
	let time = 0; // seconds into the hole (moving ground)
	let redrawIn = 0;
	let memory: { x: number; y: number }[] = [];
	let aim: { sx: number; sy: number; cx: number; cy: number; id: number } | null = null;
	let pw = 0;
	let ph = 0;
	let raf = 0;
	let last = performance.now();
	let resizeTimer = 0;

	const unlocked = () => (isSolved(ID) ? Math.max(2, getData<number>('web-holes', 2)) : 1);
	const best = (i = index) => getData<number | null>(bestKey(i), null);

	const updateStrokes = () => {
		const b = best();
		strokesEl.textContent = `Hole ${index + 1} · Strokes: ${strokes}${b ? ` · Best: ${b}` : ''}${noticeT > 0 ? ` · ${notice}` : ''}`;
	};
	const renderHoles = () => {
		const open = unlocked();
		holesEl.innerHTML =
			'Hole ' +
			HOLES.map(
				(h, i) =>
					`<button type="button" class="golf-hole" data-i="${i}" aria-pressed="${i === index}" ${i < open ? '' : 'disabled'} title="${h.name}">${i + 1}</button>`,
			).join('');
		holesEl.hidden = open < 2;
	};
	holesEl.addEventListener('click', (e) => {
		const i = Number((e.target as Element).closest<HTMLElement>('[data-i]')?.dataset.i);
		if (Number.isInteger(i) && i !== index && i < unlocked()) loadHole(i);
	});

	// ---- Map rendering ----------------------------------------------------------------------

	let mapW = 0;
	let mapH = 0;
	/** Height of everything that doesn't move, per map pixel; moving bumps are added on each redraw. */
	let still = new Float32Array(0);
	let hs = new Float32Array(0);

	const prepareMap = () => {
		// A moving hole redraws often, so it uses a coarser map.
		mapW = Math.min(pw, moves(hole) ? 520 : 1100);
		mapH = Math.round((mapW * H) / W);
		mapCv.width = mapW;
		mapCv.height = mapH;
		still = new Float32Array(mapW * mapH);
		hs = new Float32Array(mapW * mapH);
		const fixed: Hole = { ...hole, bumps: hole.bumps.filter((bp) => !bp.breathe && !bp.drift) };
		for (let j = 0; j < mapH; j++) {
			const y = ((j + 0.5) / mapH) * H;
			for (let i = 0; i < mapW; i++) still[j * mapW + i] = height(fixed, ((i + 0.5) / mapW) * W, y, 0);
		}
		buildMap();
	};

	const buildMap = () => {
		hs.set(still);
		for (const bp of hole.bumps) {
			if (!bp.breathe && !bp.drift) continue;
			const [bx, by, a] = bumpAt(bp, time);
			const r = bp.s * 4;
			const i0 = Math.max(0, Math.floor(((bx - r) / W) * mapW));
			const i1 = Math.min(mapW - 1, Math.ceil(((bx + r) / W) * mapW));
			const j0 = Math.max(0, Math.floor(((by - r) / H) * mapH));
			const j1 = Math.min(mapH - 1, Math.ceil(((by + r) / H) * mapH));
			for (let j = j0; j <= j1; j++) {
				const dy = ((j + 0.5) / mapH) * H - by;
				for (let i = i0; i <= i1; i++) {
					const dx = ((i + 0.5) / mapW) * W - bx;
					hs[j * mapW + i] += a * Math.exp(-(dx * dx + dy * dy) / (2 * bp.s * bp.s));
				}
			}
		}
		const mctx = mapCv.getContext('2d')!;
		const img = mctx.createImageData(mapW, mapH);
		const d = img.data;
		const thick = mapW > 700 ? 2 : 1;
		for (let j = 0; j < mapH; j++) {
			for (let i = 0; i < mapW; i++) {
				const k = j * mapW + i;
				const v = hs[k];
				const t = Math.min(1, Math.max(0, (v - H_MIN) / (H_MAX - H_MIN)));
				// Base tint: deep violet-navy in the lows, dusky warm in the highs.
				let r = lerp(14, 52, t);
				let g = lerp(14, 42, t);
				let b = lerp(48, 40, t);
				const band = Math.floor(v / STEP);
				let line = 0;
				for (let o = 1; o <= thick; o++) {
					const right = i + o < mapW ? hs[k + o] : v;
					const down = j + o < mapH ? hs[k + o * mapW] : v;
					const bandR = Math.floor(right / STEP);
					const bandD = Math.floor(down / STEP);
					if (bandR !== band || bandD !== band) {
						const crossed = Math.max(band, bandR, bandD);
						const index5 = crossed % 5 === 0;
						if (o === 1 || index5) line = Math.max(line, index5 ? 1 : 0.55);
					}
				}
				if (line > 0) {
					// Contour colour: blue (#6fb6ff) low, violet in the middle, gold (#ffe7a3) high.
					const lr = t < 0.5 ? lerp(111, 138, t * 2) : lerp(138, 255, (t - 0.5) * 2);
					const lg = t < 0.5 ? lerp(182, 125, t * 2) : lerp(125, 231, (t - 0.5) * 2);
					const lb = t < 0.5 ? 255 : lerp(255, 163, (t - 0.5) * 2);
					r = lerp(r, lr, line);
					g = lerp(g, lg, line);
					b = lerp(b, lb, line);
				}
				d[k * 4] = r;
				d[k * 4 + 1] = g;
				d[k * 4 + 2] = b;
				d[k * 4 + 3] = 255;
			}
		}
		mctx.putImageData(img, 0, 0);
		const s = mapW / W;
		// Ponds, under the fog like everything else.
		for (const p of hole.ponds) {
			const g = mctx.createRadialGradient(p.x * s, p.y * s, 0, p.x * s, p.y * s, p.r * s);
			g.addColorStop(0, '#0b3a52');
			g.addColorStop(0.8, '#14587a');
			g.addColorStop(1, '#3a8fb5');
			mctx.fillStyle = g;
			mctx.beginPath();
			mctx.arc(p.x * s, p.y * s, p.r * s, 0, Math.PI * 2);
			mctx.fill();
			mctx.strokeStyle = 'rgba(160, 220, 255, 0.35)';
			mctx.lineWidth = Math.max(1, s * 0.006);
			for (const k of [0.45, 0.7]) {
				mctx.beginPath();
				mctx.arc(p.x * s, p.y * s, p.r * s * k, 0.3, 1.6);
				mctx.stroke();
			}
		}
		// The hole and its flag.
		const hx = hole.hole.x * s;
		const hy = hole.hole.y * s;
		mctx.fillStyle = '#01020a';
		mctx.beginPath();
		mctx.arc(hx, hy, HOLE_R * s, 0, Math.PI * 2);
		mctx.fill();
		mctx.strokeStyle = GOLD;
		mctx.lineWidth = Math.max(1, s * 0.008);
		mctx.stroke();
		mctx.beginPath();
		mctx.moveTo(hx, hy);
		mctx.lineTo(hx, hy - s * 0.22);
		mctx.stroke();
		mctx.fillStyle = GOLD;
		mctx.beginPath();
		mctx.moveTo(hx, hy - s * 0.22);
		mctx.lineTo(hx + s * 0.12, hy - s * 0.18);
		mctx.lineTo(hx, hy - s * 0.14);
		mctx.closePath();
		mctx.fill();
	};

	const stamp = (mctx: CanvasRenderingContext2D, x: number, y: number) => {
		const s = pw / W;
		const r = MEMORY_R * s;
		const g = mctx.createRadialGradient(x * s, y * s, r * 0.3, x * s, y * s, r);
		g.addColorStop(0, 'rgba(255,255,255,1)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		mctx.fillStyle = g;
		mctx.fillRect(x * s - r, y * s - r, r * 2, r * 2);
	};
	const drawMemory = () => {
		const mctx = memCv.getContext('2d')!;
		mctx.clearRect(0, 0, memCv.width, memCv.height);
		for (const p of memory) stamp(mctx, p.x, p.y);
	};

	const resize = () => {
		const cssW = canvas.clientWidth || 600;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const nw = Math.round(cssW * dpr);
		const nh = Math.round((nw * H) / W);
		if (nw === pw && nh === ph) return;
		pw = nw;
		ph = nh;
		for (const c of [canvas, memCv, fogCv]) {
			c.width = pw;
			c.height = ph;
		}
		prepareMap();
		drawMemory();
	};
	const ro = new ResizeObserver(() => {
		clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(resize, pw ? 120 : 0);
	});
	ro.observe(canvas);

	// ---- Holes --------------------------------------------------------------------------------

	function loadHole(i: number) {
		index = i;
		hole = HOLES[i];
		time = 0;
		Object.assign(ball, { x: hole.start.x, y: hole.start.y, vx: 0, vy: 0, rest: true });
		shotFrom = { ...hole.start };
		strokes = 0;
		won = false;
		sinking = 0;
		splash = null;
		noticeT = 0;
		aim = null;
		memory = [{ ...hole.start }];
		winBox.hidden = true;
		const solvedNote = i === 0 && isSolved(ID) ? ` <b style="color:${GOLD}">You’ve solved this one; play again, or try the rest of the course.</b>` : '';
		intro.innerHTML = `<b>${hole.name}.</b> ${hole.hint} Pull back like a slingshot (drag anywhere, away from where you want to go) and let go. Warmer contours are higher, deeper blue is lower.${solvedNote}`;
		if (pw) {
			prepareMap();
			drawMemory();
		}
		renderHoles();
		updateStrokes();
	}

	// ---- Input --------------------------------------------------------------------------------

	const toWorld = (e: PointerEvent): [number, number] => {
		const rect = canvas.getBoundingClientRect();
		return [((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H];
	};
	const shotFromAim = (): { vx: number; vy: number; power: number } | null => {
		if (!aim) return null;
		const dx = aim.sx - aim.cx;
		const dy = aim.sy - aim.cy;
		const len = Math.hypot(dx, dy);
		const power = Math.min(1, len / FULL_DRAG);
		if (power < 0.03) return null;
		return { vx: (dx / len) * power * VMAX, vy: (dy / len) * power * VMAX, power };
	};
	// A ball can be hit once it's at rest. On a moving hole the ground keeps nudging the ball, so it may never
	// fully stop: there it can be hit whenever it's only creeping along.
	const CREEP = 1.0;
	const canShoot = () => !won && !sinking && !splash && (ball.rest || (moves(hole) && Math.hypot(ball.vx, ball.vy) < CREEP));
	const onDown = (e: PointerEvent) => {
		// Aiming can start any time (even mid-roll); the shot is taken on release if the ball can be hit then.
		if (won || sinking || splash || aim) return;
		e.preventDefault();
		const [x, y] = toWorld(e);
		aim = { sx: x, sy: y, cx: x, cy: y, id: e.pointerId };
		canvas.setPointerCapture(e.pointerId);
	};
	const onMove = (e: PointerEvent) => {
		if (!aim || e.pointerId !== aim.id) return;
		const [x, y] = toWorld(e);
		aim.cx = x;
		aim.cy = y;
	};
	const onUp = (e: PointerEvent) => {
		if (!aim || e.pointerId !== aim.id) return;
		const shot = shotFromAim();
		aim = null;
		if (!shot || e.type === 'pointercancel') return;
		if (!canShoot()) {
			notice = 'Wait for the ball to slow down';
			noticeT = 1.5;
			updateStrokes();
			return;
		}
		shotFrom = { x: ball.x, y: ball.y };
		ball.vx = shot.vx;
		ball.vy = shot.vy;
		ball.rest = false;
		strokes++;
		updateStrokes();
	};
	canvas.addEventListener('pointerdown', onDown);
	canvas.addEventListener('pointermove', onMove);
	canvas.addEventListener('pointerup', onUp);
	canvas.addEventListener('pointercancel', onUp);

	win.body.querySelector('.golf-reset')!.addEventListener('click', () => loadHole(index));
	const onKey = (e: KeyboardEvent) => {
		if ((e.key === 'r' || e.key === 'R') && !(e.target instanceof HTMLInputElement)) loadHole(index);
	};
	window.addEventListener('keydown', onKey);
	winBox.addEventListener('click', (e) => {
		const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
		if (act === 'again') loadHole(index);
		else if (act === 'next') loadHole(index + 1);
		else if (act === 'first') loadHole(0);
	});

	// ---- Physics ------------------------------------------------------------------------------

	const finish = () => {
		won = true;
		const b = best();
		if (!b || strokes < b) setData(bestKey(index), strokes);
		if (index === 0) solve(ID);
		if (index + 2 > getData<number>('web-holes', 2)) setData('web-holes', Math.min(HOLES.length, index + 2));
		renderHoles();
		updateStrokes();
		const last = index === HOLES.length - 1;
		const total = HOLES.reduce((sum, _, i) => sum + (best(i) ?? 0), 0);
		const allPlayed = HOLES.every((_, i) => best(i));
		winBox.querySelector('strong')!.textContent = index === 0 ? 'Global minimum found' : last ? 'Course complete' : `Hole ${index + 1}: ${hole.name}`;
		winBox.querySelector('span')!.textContent =
			`Holed in ${strokes} stroke${strokes === 1 ? '' : 's'}.` +
			(index === 0 ? ' No gradient descent can argue with that.' : '') +
			(last && allPlayed ? ` Your best round: ${total} strokes over ${HOLES.length} holes.` : '');
		winBox.querySelector('.golf-actions')!.innerHTML = `${
			last
				? '<button type="button" class="secret-btn" data-act="first">Back to hole 1</button>'
				: `<button type="button" class="secret-btn" data-act="next">Next hole</button>`
		}<button type="button" class="secret-btn" data-act="again">Play again</button>`;
		winBox.hidden = false;
	};

	const physics = (dt: number) => {
		time += dt;
		if (noticeT > 0) {
			noticeT = Math.max(0, noticeT - dt);
			if (noticeT === 0) updateStrokes();
		}
		if (sinking) {
			sinking += dt;
			ball.x = lerp(ball.x, hole.hole.x, Math.min(1, dt * 10));
			ball.y = lerp(ball.y, hole.hole.y, Math.min(1, dt * 10));
			if (sinking > 0.6 && !won) finish();
			return;
		}
		if (splash) {
			splash.t += dt;
			if (splash.t > 0.8) {
				// Back where the shot was hit from, a stroke down.
				splash = null;
				Object.assign(ball, { x: shotFrom.x, y: shotFrom.y, vx: 0, vy: 0, rest: true });
				strokes++;
				notice = 'Splash! +1 stroke';
				noticeT = 3;
				updateStrokes();
			}
			return;
		}
		const r = stepBall(hole, ball, time, dt);
		if (r === 'sunk') {
			sinking = 0.0001;
			chime('open');
			return;
		}
		if (r === 'water') {
			splash = { x: ball.x, y: ball.y, t: 0 };
			chime('error');
			return;
		}
		const lastMem = memory[memory.length - 1];
		if (Math.hypot(ball.x - lastMem.x, ball.y - lastMem.y) > 0.06) {
			memory.push({ x: ball.x, y: ball.y });
			stamp(memCv.getContext('2d')!, ball.x, ball.y);
		}
	};

	// ---- Drawing ------------------------------------------------------------------------------

	const draw = (now: number, dt: number) => {
		if (!pw) return;
		if (moves(hole)) {
			redrawIn -= dt;
			if (redrawIn <= 0) {
				buildMap();
				redrawIn = REDRAW;
			}
		}
		const s = pw / W;
		const fctx = fogCv.getContext('2d')!;
		fctx.globalCompositeOperation = 'source-over';
		fctx.clearRect(0, 0, pw, ph);
		fctx.globalAlpha = 0.26;
		fctx.drawImage(memCv, 0, 0);
		fctx.globalAlpha = 1;
		const flicker = 1 + Math.sin(now / 400) * 0.02;
		const lr = hole.light * s * flicker;
		const g = fctx.createRadialGradient(ball.x * s, ball.y * s, lr * 0.45, ball.x * s, ball.y * s, lr);
		g.addColorStop(0, 'rgba(255,255,255,1)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		fctx.fillStyle = g;
		fctx.fillRect(0, 0, pw, ph);
		fctx.globalCompositeOperation = 'source-in';
		fctx.imageSmoothingEnabled = true;
		fctx.drawImage(mapCv, 0, 0, pw, ph);
		fctx.globalCompositeOperation = 'source-over';

		ctx.fillStyle = '#02040c';
		ctx.fillRect(0, 0, pw, ph);
		ctx.drawImage(fogCv, 0, 0);

		// Aim: a rubber band back to the pointer and a dotted line showing the shot.
		const shot = shotFromAim();
		if (aim && shot) {
			ctx.save();
			ctx.lineCap = 'round';
			ctx.strokeStyle = 'rgba(255,255,255,0.25)';
			ctx.lineWidth = Math.max(1, s * 0.006);
			ctx.beginPath();
			ctx.moveTo(ball.x * s, ball.y * s);
			ctx.lineTo((ball.x - (aim.sx - aim.cx)) * s, (ball.y - (aim.sy - aim.cy)) * s);
			ctx.stroke();
			const len = 0.15 + shot.power * 0.75;
			const ux = shot.vx / (shot.power * VMAX);
			const uy = shot.vy / (shot.power * VMAX);
			ctx.strokeStyle = shot.power >= 1 ? '#ff9b7a' : GOLD;
			ctx.lineWidth = Math.max(1.5, s * 0.012);
			ctx.setLineDash([s * 0.025, s * 0.03]);
			ctx.beginPath();
			ctx.moveTo(ball.x * s, ball.y * s);
			ctx.lineTo((ball.x + ux * len) * s, (ball.y + uy * len) * s);
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = 'rgba(255,231,163,0.85)';
			ctx.font = `${Math.round(s * 0.07)}px system-ui, sans-serif`;
			ctx.fillText(`${Math.round(shot.power * 100)}%`, (ball.x + 0.08) * s, (ball.y - 0.08) * s);
			ctx.restore();
		}

		// A splash: rings spreading where the ball went in.
		if (splash) {
			ctx.strokeStyle = `rgba(170, 225, 255, ${Math.max(0, 0.9 - splash.t)})`;
			ctx.lineWidth = Math.max(1, s * 0.008);
			for (const k of [1, 0.6]) {
				ctx.beginPath();
				ctx.arc(splash.x * s, splash.y * s, (0.03 + splash.t * 0.18 * k) * s, 0, Math.PI * 2);
				ctx.stroke();
			}
			return;
		}

		// Ball
		const scale = sinking ? Math.max(0, 1 - sinking / 0.6) : 1;
		if (scale > 0) {
			const br = BALL_R * s * scale;
			ctx.save();
			ctx.shadowColor = 'rgba(200,225,255,0.9)';
			ctx.shadowBlur = s * 0.05;
			ctx.fillStyle = '#f4f8ff';
			ctx.beginPath();
			ctx.arc(ball.x * s, ball.y * s, br, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
			if (canShoot() && !aim) {
				ctx.strokeStyle = `rgba(255,231,163,${0.35 + 0.25 * Math.sin(now / 300)})`;
				ctx.lineWidth = Math.max(1, s * 0.006);
				ctx.beginPath();
				ctx.arc(ball.x * s, ball.y * s, br * 2.2, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
	};

	const loop = (now: number) => {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		physics(dt);
		draw(now, dt);
		raf = requestAnimationFrame(loop);
	};
	loadHole(0);
	raf = requestAnimationFrame((t) => {
		last = t;
		resize();
		loop(t);
	});

	win.setStatus('Drag anywhere on the map, then release. The shot flies away from where you drag. R restarts the hole.');

	win.onClose(() => {
		cancelAnimationFrame(raf);
		clearTimeout(resizeTimer);
		ro.disconnect();
		window.removeEventListener('keydown', onKey);
	});

	if (import.meta.env.DEV) {
		(window as unknown as { __golf: unknown }).__golf = { loadHole, ball, step: (dt: number) => physics(dt), get index() { return index; }, get won() { return won; }, get strokes() { return strokes; } };
	}
}
