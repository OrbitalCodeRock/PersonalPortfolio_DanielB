// "optimization" on the Web Development page: Global Minimum. Fog-of-war golf on a contour map.
// Drag back from anywhere on the map and release to sling the ball. Gravity pulls it downhill along
// the height field, so it rolls into basins. Several basins are decoys; the hole sits in the one
// global minimum (bottom right, around (3.35, 2.44) in map units). Only a circle around the ball is
// lit, and places the ball has been stay faintly visible.
import { openWindow, solve, chime } from '../ui';
import { isSolved, getData, setData } from '../progress';

const ID = 'web';
const GOLD = '#ffe7a3';

/** Map size in world units (4:3). */
const W = 4;
const H = 3;

// Height field: Gaussian basins (negative) and hills (positive), seeded ripples and a raised rim.
// [x, y, amplitude, sigma]
const BUMPS: [number, number, number, number][] = [
	[3.35, 2.45, -1.15, 0.26], // the hole: the global minimum
	[0.95, 2.25, -0.75, 0.24], // decoy basins
	[2.15, 0.75, -0.7, 0.22],
	[3.45, 0.6, -0.65, 0.2],
	[1.75, 1.75, -0.6, 0.18],
	[2.55, 2.55, -0.5, 0.18],
	[2.5, 1.65, 0.9, 0.38], // hills and ridges
	[1.25, 1.05, 0.7, 0.3],
	[3.0, 1.45, 0.55, 0.25],
	[0.35, 1.6, 0.45, 0.3],
	[2.95, 2.95, 0.4, 0.3],
	[1.6, 2.8, 0.4, 0.28],
];

function mulberry32(seed: number) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const rng = mulberry32(1729);
const RIPPLES = Array.from({ length: 5 }, () => ({
	a: 0.02 + rng() * 0.025,
	fx: (rng() * 2 - 1) * 4,
	fy: (rng() * 2 - 1) * 4,
	p: rng() * Math.PI * 2,
}));

function height(x: number, y: number): number {
	let v = 0;
	for (const [bx, by, a, s] of BUMPS) {
		const dx = x - bx;
		const dy = y - by;
		v += a * Math.exp(-(dx * dx + dy * dy) / (2 * s * s));
	}
	for (const r of RIPPLES) v += r.a * Math.sin(r.fx * x + r.fy * y + r.p);
	const e = 0.16;
	v += 0.55 * (Math.exp(-x / e) + Math.exp(-(W - x) / e) + Math.exp(-y / e) + Math.exp(-(H - y) / e));
	return v;
}

function gradient(x: number, y: number): [number, number] {
	const d = 1e-3;
	return [(height(x + d, y) - height(x - d, y)) / (2 * d), (height(x, y + d) - height(x, y - d)) / (2 * d)];
}

const HOLE = { x: 3.35, y: 2.44 };
const START = { x: 0.52, y: 0.69 };
const H_MIN = -1.1;
const H_MAX = 1.12;
const STEP = 0.1; // contour interval

// Physics
const GRAV = 6;
const DRAG = 1.1;
const ROLL = 0.35;
const STATIC = 0.35;
const VMAX = 4.2;
const BALL_R = 0.035;
const HOLE_R = 0.055;
const CAPTURE_SPEED = 1.0;
/** Drag distance (world units) for a full-power shot. */
const FULL_DRAG = 1.1;
const LIGHT_R = 0.6;
const MEMORY_R = 0.3;

const STYLE_ID = 'secret-style-golf';
const STYLE = `
.golf-wrap { position: relative; }
.golf-canvas { aspect-ratio: 4 / 3; cursor: crosshair; background: #02040c; }
.golf-bar { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; margin-top: 10px; }
.golf-bar .secret-hint { margin: 0; }
.golf-win { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 16px;
	background: rgba(4, 8, 20, 0.72); border-radius: 8px; }
.golf-win[hidden] { display: none; }
.golf-win strong { color: ${GOLD}; font-size: 1.15rem; display: block; margin-bottom: 6px; }
`;

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}

export function launch(): void {
	if (!document.getElementById(STYLE_ID)) {
		const s = document.createElement('style');
		s.id = STYLE_ID;
		s.textContent = STYLE;
		document.head.append(s);
	}

	const win = openWindow({ title: 'Global Minimum', width: 640 });
	const already = isSolved(ID);
	win.body.innerHTML = `
		<p class="secret-hint">Somewhere in the fog is the lowest point on the map. Pull back like a slingshot (drag anywhere, away from where you want to go) and let go.
		The contour lines are your only guide: warmer is higher, deeper blue is lower.${already ? ' <b style="color:' + GOLD + '">You’ve already solved this one; play again if you like.</b>' : ''}</p>
		<div class="golf-wrap">
			<canvas class="secret-canvas golf-canvas" aria-label="Fog-covered contour map with a golf ball"></canvas>
			<div class="golf-win" hidden><div><strong></strong><span></span><br><br><button type="button" class="secret-btn golf-again">Play again</button></div></div>
		</div>
		<div class="golf-bar">
			<p class="secret-hint golf-strokes"></p>
			<button type="button" class="secret-btn golf-reset">Restart</button>
		</div>`;

	const canvas = win.body.querySelector<HTMLCanvasElement>('.golf-canvas')!;
	const ctx = canvas.getContext('2d')!;
	const winBox = win.body.querySelector<HTMLElement>('.golf-win')!;
	const strokesEl = win.body.querySelector<HTMLElement>('.golf-strokes')!;

	const mapCv = document.createElement('canvas');
	const memCv = document.createElement('canvas');
	const fogCv = document.createElement('canvas');

	const ball = { x: START.x, y: START.y, vx: 0, vy: 0, rest: true };
	let strokes = 0;
	let won = false;
	let sinking = 0; // 0 = not sinking, otherwise seconds into the sink animation
	let memory: { x: number; y: number }[] = [{ x: START.x, y: START.y }];
	let aim: { sx: number; sy: number; cx: number; cy: number; id: number } | null = null;
	let pw = 0;
	let ph = 0;
	let raf = 0;
	let last = performance.now();
	let resizeTimer = 0;

	const best = () => getData<number | null>('web-best', null);

	const updateStrokes = () => {
		const b = best();
		strokesEl.textContent = `Strokes: ${strokes}${b ? ` · Best: ${b}` : ''}`;
	};
	updateStrokes();

	// ---- Map rendering ----------------------------------------------------------------------

	const buildMap = () => {
		const mw = Math.min(pw, 1100);
		const mh = Math.round((mw * H) / W);
		mapCv.width = mw;
		mapCv.height = mh;
		const hs = new Float32Array(mw * mh);
		for (let j = 0; j < mh; j++) {
			const y = ((j + 0.5) / mh) * H;
			for (let i = 0; i < mw; i++) hs[j * mw + i] = height(((i + 0.5) / mw) * W, y);
		}
		const mctx = mapCv.getContext('2d')!;
		const img = mctx.createImageData(mw, mh);
		const d = img.data;
		const thick = mw > 700 ? 2 : 1;
		for (let j = 0; j < mh; j++) {
			for (let i = 0; i < mw; i++) {
				const k = j * mw + i;
				const v = hs[k];
				const t = Math.min(1, Math.max(0, (v - H_MIN) / (H_MAX - H_MIN)));
				// Base tint: deep violet-navy in the lows, dusky warm in the highs.
				let r = lerp(14, 52, t);
				let g = lerp(14, 42, t);
				let b = lerp(48, 40, t);
				const band = Math.floor(v / STEP);
				let line = 0;
				for (let o = 1; o <= thick; o++) {
					const right = i + o < mw ? hs[k + o] : v;
					const down = j + o < mh ? hs[k + o * mw] : v;
					const bandR = Math.floor(right / STEP);
					const bandD = Math.floor(down / STEP);
					if (bandR !== band || bandD !== band) {
						const crossed = Math.max(band, bandR, bandD);
						const index = crossed % 5 === 0;
						if (o === 1 || index) line = Math.max(line, index ? 1 : 0.55);
					}
				}
				if (line > 0) {
					// Contour colour: blue (#6fb6ff) low, violet in the middle, gold (#ffe7a3) high.
					const lr = t < 0.5 ? lerp(111, 138, t * 2) : lerp(138, 255, (t - 0.5) * 2);
					const lg = t < 0.5 ? lerp(182, 125, t * 2) : lerp(125, 231, (t - 0.5) * 2);
					const lb = t < 0.5 ? lerp(255, 255, t * 2) : lerp(255, 163, (t - 0.5) * 2);
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
		// The hole and its flag, drawn into the map so the fog hides them.
		const s = mw / W;
		const hx = HOLE.x * s;
		const hy = HOLE.y * s;
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

	const drawMemory = () => {
		const mctx = memCv.getContext('2d')!;
		mctx.clearRect(0, 0, memCv.width, memCv.height);
		for (const p of memory) stamp(mctx, p.x, p.y);
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
		buildMap();
		drawMemory();
	};

	const ro = new ResizeObserver(() => {
		clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(resize, pw ? 120 : 0);
	});
	ro.observe(canvas);

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

	const onDown = (e: PointerEvent) => {
		if (won || sinking || !ball.rest || aim) return;
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

	const restart = () => {
		ball.x = START.x;
		ball.y = START.y;
		ball.vx = 0;
		ball.vy = 0;
		ball.rest = true;
		strokes = 0;
		won = false;
		sinking = 0;
		aim = null;
		memory = [{ x: START.x, y: START.y }];
		drawMemory();
		winBox.hidden = true;
		updateStrokes();
	};
	win.body.querySelector('.golf-reset')!.addEventListener('click', restart);
	win.body.querySelector('.golf-again')!.addEventListener('click', restart);

	const onKey = (e: KeyboardEvent) => {
		if ((e.key === 'r' || e.key === 'R') && !(e.target instanceof HTMLInputElement)) restart();
	};
	window.addEventListener('keydown', onKey);

	// ---- Physics ------------------------------------------------------------------------------

	const finish = () => {
		won = true;
		const b = best();
		if (!b || strokes < b) setData('web-best', strokes);
		updateStrokes();
		solve(ID);
		winBox.querySelector('strong')!.textContent = 'Global minimum found';
		winBox.querySelector('span')!.textContent = `Holed in ${strokes} stroke${strokes === 1 ? '' : 's'}. No gradient descent can argue with that.`;
		winBox.hidden = false;
	};

	const physics = (dt: number) => {
		if (sinking) {
			sinking += dt;
			ball.x = lerp(ball.x, HOLE.x, Math.min(1, dt * 10));
			ball.y = lerp(ball.y, HOLE.y, Math.min(1, dt * 10));
			if (sinking > 0.6 && !won) finish();
			return;
		}
		if (ball.rest) return;
		const sub = Math.max(1, Math.ceil(dt * 240));
		const h = dt / sub;
		for (let n = 0; n < sub; n++) {
			const [gx, gy] = gradient(ball.x, ball.y);
			ball.vx -= GRAV * gx * h;
			ball.vy -= GRAV * gy * h;
			let speed = Math.hypot(ball.vx, ball.vy);
			const dec = ROLL * h;
			if (speed > dec) {
				const k = ((speed - dec) / speed) * Math.exp(-DRAG * h);
				ball.vx *= k;
				ball.vy *= k;
			} else {
				ball.vx = 0;
				ball.vy = 0;
			}
			ball.x += ball.vx * h;
			ball.y += ball.vy * h;
			if (ball.x < BALL_R) {
				ball.x = BALL_R;
				ball.vx = Math.abs(ball.vx) * 0.5;
			} else if (ball.x > W - BALL_R) {
				ball.x = W - BALL_R;
				ball.vx = -Math.abs(ball.vx) * 0.5;
			}
			if (ball.y < BALL_R) {
				ball.y = BALL_R;
				ball.vy = Math.abs(ball.vy) * 0.5;
			} else if (ball.y > H - BALL_R) {
				ball.y = H - BALL_R;
				ball.vy = -Math.abs(ball.vy) * 0.5;
			}
			speed = Math.hypot(ball.vx, ball.vy);
			if (Math.hypot(ball.x - HOLE.x, ball.y - HOLE.y) < HOLE_R && speed < CAPTURE_SPEED) {
				sinking = 0.0001;
				ball.vx = ball.vy = 0;
				chime('open');
				return;
			}
			if (speed < 0.03 && GRAV * Math.hypot(gx, gy) < STATIC) {
				ball.vx = ball.vy = 0;
				ball.rest = true;
				break;
			}
		}
		const lastMem = memory[memory.length - 1];
		if (Math.hypot(ball.x - lastMem.x, ball.y - lastMem.y) > 0.06) {
			memory.push({ x: ball.x, y: ball.y });
			stamp(memCv.getContext('2d')!, ball.x, ball.y);
		}
	};

	// ---- Drawing ------------------------------------------------------------------------------

	const draw = (time: number) => {
		if (!pw) return;
		const s = pw / W;
		const fctx = fogCv.getContext('2d')!;
		fctx.globalCompositeOperation = 'source-over';
		fctx.clearRect(0, 0, pw, ph);
		fctx.globalAlpha = 0.26;
		fctx.drawImage(memCv, 0, 0);
		fctx.globalAlpha = 1;
		const flicker = 1 + Math.sin(time / 400) * 0.02;
		const lr = LIGHT_R * s * flicker;
		const g = fctx.createRadialGradient(ball.x * s, ball.y * s, lr * 0.45, ball.x * s, ball.y * s, lr);
		g.addColorStop(0, 'rgba(255,255,255,1)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		fctx.fillStyle = g;
		fctx.fillRect(0, 0, pw, ph);
		fctx.globalCompositeOperation = 'source-in';
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
			if (ball.rest && !won && !aim) {
				ctx.strokeStyle = `rgba(255,231,163,${0.35 + 0.25 * Math.sin(time / 300)})`;
				ctx.lineWidth = Math.max(1, s * 0.006);
				ctx.beginPath();
				ctx.arc(ball.x * s, ball.y * s, br * 2.2, 0, Math.PI * 2);
				ctx.stroke();
			}
		}
	};

	const loop = (time: number) => {
		const dt = Math.min(0.05, (time - last) / 1000);
		last = time;
		physics(dt);
		draw(time);
		raf = requestAnimationFrame(loop);
	};
	raf = requestAnimationFrame((t) => {
		last = t;
		resize();
		loop(t);
	});

	win.setStatus('Drag anywhere on the map, then release. The shot flies away from where you drag. R restarts.');

	win.onClose(() => {
		cancelAnimationFrame(raf);
		clearTimeout(resizeTimer);
		ro.disconnect();
		window.removeEventListener('keydown', onKey);
	});
}
