// Certifications → "interference": Both Slits at Once. A dark room with a matchbox, a candle, a wall with
// two thin slits on a floor track, and a far wall. Strike a match (drag it quickly across the box's
// striker), light the candle with it before it burns down, then slide the slit wall along the floor
// until the close-up of the far wall shows interference fringes; hold them there to solve.
//
// The physics is the real double-slit experiment, with made-up but sensible numbers:
//  - A candle flame is a wide source, so the light reaching the two slits is only coherent enough to
//    interfere when the slits are far from it: fringe visibility V = |sinc(s·d / (λ·L1))|.
//  - The fringes are λ·L2 / d apart on the far wall, so they need room (L2) to spread wide enough to see.
// Both hold only in a narrow stretch of the floor: far enough from the candle, not too close to the wall.
import { isSolved } from '../progress';
import { chime, openWindow, solve } from '../ui';

const ID = 'certs';
const GOLD = '#ffe7a3';

// Canvas (CSS px of the drawing; scaled to fit).
const CW = 800;
const CH = 450;
const FLOOR = 392;
const TABLE_TOP = 300;
const CANDLE_X = 150;
const BACK_X = 748;
const TRACK = [205, 726] as const;
const ROOM_CM = 300; // candle to far wall

// Optics (cm).
const LAMBDA = 5.8e-5; // 580 nm, candle yellow
const SOURCE = 0.3; // flame width
const SLIT_D = 0.015; // slit separation
const SLIT_A = 0.005; // slit width
const CLOSEUP_CM = 4; // width of the far-wall close-up
const RESOLVE_CM = 0.15; // fringes closer than this blur together
const WIN_CONTRAST = 0.76;
const HOLD = 1.3;
const MATCH_LIFE = 10;

const CSS = `
.ds { display: grid; gap: 10px; }
.ds-canvas { display: block; width: 100%; height: auto; aspect-ratio: ${CW} / ${CH}; border-radius: 8px; background: #030208;
	touch-action: none; cursor: default; }
.ds-hint { margin: 0; color: var(--text-muted); font-size: .9rem; }
.ds-bar { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: center; }
`;

function injectStyle() {
	if (document.getElementById('secret-style-slits')) return;
	const s = document.createElement('style');
	s.id = 'secret-style-slits';
	s.textContent = CSS;
	document.head.append(s);
}

const sinc = (x: number) => (Math.abs(x) < 1e-6 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Distances (cm) for a slit wall at canvas x. */
function geometry(wallX: number) {
	const L1 = ((wallX - CANDLE_X) / (BACK_X - CANDLE_X)) * ROOM_CM;
	const L2 = ROOM_CM - L1;
	const visibility = Math.abs(sinc((SOURCE * SLIT_D) / (LAMBDA * L1)));
	const spacing = (LAMBDA * L2) / SLIT_D;
	const resolved = clamp((spacing - RESOLVE_CM) / RESOLVE_CM, 0, 1);
	return { L1, L2, spacing, contrast: visibility * resolved, envelope: (LAMBDA * L2) / SLIT_A };
}

export function launch(): void {
	injectStyle();
	const win = openWindow({ title: 'Both Slits at Once', width: 820 });
	win.body.innerHTML = `
		<div class="ds">
			<canvas class="ds-canvas" aria-label="A dark room with a matchbox, a candle, a wall with two slits and a far wall"></canvas>
			<div class="ds-bar">
				<p class="ds-hint"></p>
				<button type="button" class="secret-btn ds-reset">Start over</button>
			</div>
		</div>`;
	const canvas = win.body.querySelector('canvas')!;
	const ctx = canvas.getContext('2d')!;
	const hint = win.body.querySelector<HTMLElement>('.ds-hint')!;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	canvas.width = CW * dpr;
	canvas.height = CH * dpr;

	// Scene state.
	const box = { x: 44, y: TABLE_TOP - 22, w: 74, h: 22 };
	const striker = { x: box.x + 6, y: box.y - 4, w: box.w - 12, h: 6 };
	const wick = { x: CANDLE_X, y: TABLE_TOP - 64 };
	let held = false;
	let matchLit = 0; // seconds of flame left (0 = not lit)
	let match = { x: box.x + box.w + 18, y: TABLE_TOP - 3 }; // head position
	let lastPt = { x: 0, y: 0, t: 0 };
	let scraped = 0; // px scraped fast along the striker since the last strike
	let sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
	let candle = false;
	let candleHeat = 0;
	let wallX = 700;
	let dragWall: number | null = null;
	let holdT = 0;
	let won = isSolved(ID);
	let wonFlash = 0;

	function reset() {
		held = false;
		matchLit = 0;
		match = { x: box.x + box.w + 18, y: TABLE_TOP - 3 };
		sparks = [];
		candle = false;
		candleHeat = 0;
		wallX = 700;
		holdT = 0;
		won = isSolved(ID);
		wonFlash = 0;
		updateHint();
	}

	function updateHint() {
		hint.textContent = !candle
			? matchLit
				? 'Quick, hold the flame to the candle’s wick.'
				: 'It’s dark. Drag the match quickly across the strip on top of the matchbox to light it.'
			: won
				? 'Light went through both slits at once and interfered with itself.'
				: 'Slide the slit wall along the floor (drag it, or use ← →) and watch the close-up of the far wall.';
	}

	// ---- Input ------------------------------------------------------------------------------------
	const pt = (e: PointerEvent) => {
		const r = canvas.getBoundingClientRect();
		return { x: ((e.clientX - r.left) / r.width) * CW, y: ((e.clientY - r.top) / r.height) * CH };
	};
	const near = (a: { x: number; y: number }, b: { x: number; y: number }, d: number) => Math.hypot(a.x - b.x, a.y - b.y) < d;
	const onWall = (p: { x: number; y: number }) => Math.abs(p.x - wallX) < 18 && p.y > FLOOR - 175 && p.y < FLOOR + 6;
	const onMatch = (p: { x: number; y: number }) =>
		near(p, match, 22) || (p.x > match.x - 46 && p.x < match.x + 6 && Math.abs(p.y - match.y) < 12);

	canvas.addEventListener('pointerdown', (e) => {
		const p = pt(e);
		canvas.setPointerCapture(e.pointerId);
		if (candle && onWall(p)) {
			dragWall = p.x - wallX;
		} else if (!candle && (onMatch(p) || (p.x > box.x && p.x < box.x + box.w && p.y > box.y - 10 && p.y < box.y + box.h))) {
			held = true;
			match = { x: p.x, y: p.y };
			lastPt = { ...p, t: performance.now() };
		}
	});
	canvas.addEventListener('pointermove', (e) => {
		const p = pt(e);
		if (dragWall !== null) {
			wallX = clamp(p.x - dragWall, TRACK[0], TRACK[1]);
			return;
		}
		canvas.style.cursor = (candle && onWall(p)) || (!candle && onMatch(p)) ? 'grab' : 'default';
		if (!held) return;
		const now = performance.now();
		const dt = Math.max(1, now - lastPt.t) / 1000;
		const moved = Math.hypot(p.x - lastPt.x, p.y - lastPt.y);
		const speed = moved / dt;
		lastPt = { ...p, t: now };
		match = { x: p.x, y: p.y };
		// Striking: every fast 35 px scraped along the strip (a swipe across it, or scrubbing back and
		// forth) is one strike, which catches half the time.
		const inside = p.x > striker.x && p.x < striker.x + striker.w && p.y > striker.y - 8 && p.y < striker.y + striker.h + 8;
		if (inside && !matchLit) {
			scraped = speed > 650 ? scraped + moved : 0;
			if (scraped >= 35) {
				scraped = 0;
				if (Math.random() < 0.5) {
					matchLit = MATCH_LIFE;
					chime('open');
					updateHint();
				} else {
					for (let i = 0; i < 6; i++)
						sparks.push({ x: p.x, y: p.y, vx: (Math.random() - 0.3) * 160, vy: -Math.random() * 120, life: 0.3 + Math.random() * 0.3 });
				}
			}
		} else scraped = 0;
	});
	const up = () => {
		dragWall = null;
		if (held) {
			held = false;
			// Put down, a match goes out and a fresh one is laid by the box.
			matchLit = 0;
			match = { x: box.x + box.w + 18, y: TABLE_TOP - 3 };
			updateHint();
		}
	};
	canvas.addEventListener('pointerup', up);
	canvas.addEventListener('pointercancel', up);
	const onKey = (e: KeyboardEvent) => {
		if (!candle || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
		e.preventDefault();
		wallX = clamp(wallX + (e.key === 'ArrowLeft' ? -2 : 2) * (e.shiftKey ? 5 : 1), TRACK[0], TRACK[1]);
	};
	document.addEventListener('keydown', onKey);
	win.body.querySelector('.ds-reset')!.addEventListener('click', reset);

	// ---- Simulation -------------------------------------------------------------------------------
	function step(dt: number) {
		if (matchLit > 0) {
			matchLit -= dt;
			if (matchLit <= 0) {
				// Burnt down to the fingers: dropped, and a fresh one is laid by the box.
				matchLit = 0;
				held = false;
				match = { x: box.x + box.w + 18, y: TABLE_TOP - 3 };
				updateHint();
			} else if (!candle && near(match, wick, 16)) {
				candleHeat += dt;
				if (candleHeat > 0.5) {
					candle = true;
					chime('open');
					updateHint();
				}
			} else candleHeat = Math.max(0, candleHeat - dt);
		}
		for (const s of sparks) {
			s.x += s.vx * dt;
			s.y += s.vy * dt;
			s.vy += 400 * dt;
			s.life -= dt;
		}
		sparks = sparks.filter((s) => s.life > 0);
		if (candle && !won) {
			const g = geometry(wallX);
			holdT = g.contrast > WIN_CONTRAST && dragWall === null ? holdT + dt : 0;
			if (holdT > HOLD) {
				won = true;
				wonFlash = 1;
				solve(ID);
				updateHint();
			}
		}
		wonFlash = Math.max(0, wonFlash - dt * 0.4);
	}

	// ---- Drawing ----------------------------------------------------------------------------------
	const lights = document.createElement('canvas');
	lights.width = CW;
	lights.height = CH;
	const lctx = lights.getContext('2d')!;

	function flame(x: number, y: number, size: number, t: number) {
		const f = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06;
		const g = ctx.createRadialGradient(x, y - size * 0.4, 0, x, y - size * 0.4, size * 1.4 * f);
		g.addColorStop(0, 'rgba(255, 250, 220, 1)');
		g.addColorStop(0.35, 'rgba(255, 196, 90, 0.9)');
		g.addColorStop(1, 'rgba(255, 120, 30, 0)');
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.ellipse(x, y - size * 0.6, size * 0.45, size * f, 0, 0, Math.PI * 2);
		ctx.fill();
	}

	function drawScene(t: number) {
		// Room.
		ctx.fillStyle = '#17131f';
		ctx.fillRect(0, 0, CW, CH);
		ctx.fillStyle = '#211a2a';
		ctx.fillRect(0, FLOOR, CW, CH - FLOOR);
		// Far wall.
		ctx.fillStyle = '#2a2433';
		ctx.fillRect(BACK_X, 40, CW - BACK_X, FLOOR - 40);
		// Note pinned by the door.
		ctx.save();
		ctx.translate(236, 96);
		ctx.rotate(-0.03);
		ctx.fillStyle = '#d9cfb8';
		ctx.fillRect(0, 0, 196, 64);
		ctx.fillStyle = '#3a3226';
		ctx.font = 'italic 11px Georgia, serif';
		['A big flame argues with itself.', 'Give its light room to settle,', 'but leave the pattern room to spread.'].forEach((l, i) =>
			ctx.fillText(l, 10, 20 + i * 15),
		);
		ctx.restore();
		// Track.
		ctx.fillStyle = '#3b3346';
		ctx.fillRect(TRACK[0] - 10, FLOOR - 4, TRACK[1] - TRACK[0] + 20, 5);
		for (let x = TRACK[0]; x <= TRACK[1]; x += 26) ctx.fillRect(x, FLOOR - 7, 2, 3);
		// Table.
		ctx.fillStyle = '#4a3528';
		ctx.fillRect(20, TABLE_TOP, 200, 10);
		ctx.fillRect(34, TABLE_TOP + 10, 8, FLOOR - TABLE_TOP - 10);
		ctx.fillRect(198, TABLE_TOP + 10, 8, FLOOR - TABLE_TOP - 10);
		// Matchbox and striker.
		ctx.fillStyle = '#b83b2e';
		ctx.fillRect(box.x, box.y, box.w, box.h);
		ctx.fillStyle = '#e7d6a6';
		ctx.fillRect(box.x + 8, box.y + 5, box.w - 16, box.h - 10);
		ctx.fillStyle = '#4a2a1c';
		ctx.fillRect(striker.x, striker.y, striker.w, striker.h);
		// Candle.
		ctx.fillStyle = '#7d6a55';
		ctx.fillRect(CANDLE_X - 22, TABLE_TOP - 6, 44, 6);
		ctx.fillStyle = '#efe6d2';
		ctx.fillRect(CANDLE_X - 9, TABLE_TOP - 60, 18, 54);
		ctx.strokeStyle = '#222';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(wick.x, wick.y + 4);
		ctx.lineTo(wick.x, wick.y - 2);
		ctx.stroke();
		// Slit wall: a panel on a foot, with two thin slits at flame height.
		const slitY = wick.y - 6;
		ctx.fillStyle = '#5b5568';
		ctx.fillRect(wallX - 12, FLOOR - 6, 24, 6);
		ctx.fillStyle = '#6d677c';
		ctx.fillRect(wallX - 4, FLOOR - 170, 8, 164);
		ctx.fillStyle = '#0a0810';
		ctx.fillRect(wallX - 4, slitY - 5, 8, 2);
		ctx.fillRect(wallX - 4, slitY + 3, 8, 2);
		// Match.
		const angle = held ? -0.5 : 0;
		ctx.save();
		ctx.translate(match.x, match.y);
		ctx.rotate(angle);
		ctx.fillStyle = '#d8b67a';
		ctx.fillRect(-44, -2, 42, 4);
		ctx.fillStyle = matchLit ? '#3a1d10' : '#a8322a';
		ctx.beginPath();
		ctx.ellipse(0, 0, 5, 3.5, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
		if (matchLit) flame(match.x, match.y - 2, 9 * clamp(matchLit / 2, 0.4, 1), t);
		if (candle) flame(wick.x, wick.y - 2, 15, t);
		for (const s of sparks) {
			ctx.fillStyle = `rgba(255, 200, 120, ${s.life * 2})`;
			ctx.fillRect(s.x, s.y, 2, 2);
		}
	}

	function drawLight(t: number) {
		// Darkness, with light where the flames are.
		lctx.globalCompositeOperation = 'source-over';
		lctx.clearRect(0, 0, CW, CH);
		lctx.fillStyle = 'rgba(2, 1, 6, 0.94)';
		lctx.fillRect(0, 0, CW, CH);
		lctx.globalCompositeOperation = 'destination-out';
		const glow = (x: number, y: number, r: number) => {
			const g = lctx.createRadialGradient(x, y, 0, x, y, r);
			g.addColorStop(0, 'rgba(0,0,0,1)');
			g.addColorStop(1, 'rgba(0,0,0,0)');
			lctx.fillStyle = g;
			lctx.fillRect(x - r, y - r, r * 2, r * 2);
		};
		const flick = 1 + Math.sin(t * 9) * 0.03;
		if (matchLit) glow(match.x, match.y, 120 * flick);
		if (candle) {
			// Lights the room up to the slit wall; beyond it, only what comes through the slits.
			lctx.save();
			lctx.beginPath();
			lctx.rect(0, 0, wallX + 4, CH);
			lctx.clip();
			glow(wick.x, wick.y, 330 * flick);
			lctx.restore();
			glow(wallX, wick.y - 6, 60);
		}
		ctx.drawImage(lights, 0, 0);
		if (!candle) return;
		// Light through the slits, fanning out to the far wall.
		const slitY = wick.y - 6;
		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		for (const sy of [slitY - 4, slitY + 4]) {
			const g = ctx.createLinearGradient(wallX, 0, BACK_X, 0);
			g.addColorStop(0, 'rgba(255, 200, 110, 0.16)');
			g.addColorStop(1, 'rgba(255, 200, 110, 0.04)');
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.moveTo(wallX + 4, sy);
			ctx.lineTo(BACK_X, sy - 120);
			ctx.lineTo(BACK_X, sy + 120);
			ctx.closePath();
			ctx.fill();
		}
		// The lit patch on the far wall (seen edge-on).
		const g2 = ctx.createLinearGradient(0, slitY - 130, 0, slitY + 130);
		g2.addColorStop(0, 'rgba(255, 210, 130, 0)');
		g2.addColorStop(0.5, 'rgba(255, 210, 130, 0.5)');
		g2.addColorStop(1, 'rgba(255, 210, 130, 0)');
		ctx.fillStyle = g2;
		ctx.fillRect(BACK_X, slitY - 130, 6, 260);
		ctx.restore();
	}

	/** The far wall, seen face on and close up: what the light through both slits paints. */
	function drawCloseup() {
		const x0 = 470;
		const y0 = 16;
		const w = 300;
		const h = 120;
		ctx.fillStyle = 'rgba(8, 6, 14, 0.92)';
		ctx.fillRect(x0 - 8, y0 - 8, w + 16, h + 34);
		ctx.strokeStyle = 'rgba(255, 231, 163, 0.35)';
		ctx.lineWidth = 1;
		ctx.strokeRect(x0 - 8.5, y0 - 8.5, w + 17, h + 35);
		ctx.fillStyle = '#000';
		ctx.fillRect(x0, y0, w, h);
		if (candle) {
			const g = geometry(wallX);
			const img = ctx.createImageData(Math.round(w * dpr), 1);
			for (let i = 0; i < img.width; i++) {
				const ycm = ((i / img.width) - 0.5) * CLOSEUP_CM;
				const env = sinc(ycm / g.envelope) ** 2;
				const I = env * (1 + g.contrast * Math.cos((2 * Math.PI * ycm) / g.spacing)) * 0.5;
				const v = clamp(I * 1.1, 0, 1);
				img.data[i * 4] = 255 * v;
				img.data[i * 4 + 1] = 205 * v;
				img.data[i * 4 + 2] = 120 * v;
				img.data[i * 4 + 3] = 255;
			}
			const strip = document.createElement('canvas');
			strip.width = img.width;
			strip.height = 1;
			strip.getContext('2d')!.putImageData(img, 0, 0);
			ctx.imageSmoothingEnabled = true;
			ctx.drawImage(strip, x0, y0, w, h);
			// Soft top and bottom edges.
			const fade = ctx.createLinearGradient(0, y0, 0, y0 + h);
			fade.addColorStop(0, 'rgba(0,0,0,0.85)');
			fade.addColorStop(0.3, 'rgba(0,0,0,0)');
			fade.addColorStop(0.7, 'rgba(0,0,0,0)');
			fade.addColorStop(1, 'rgba(0,0,0,0.85)');
			ctx.fillStyle = fade;
			ctx.fillRect(x0, y0, w, h);
			if (holdT > 0 && !won) {
				ctx.fillStyle = GOLD;
				ctx.fillRect(x0, y0 + h - 3, (w * holdT) / HOLD, 3);
			}
		}
		ctx.fillStyle = 'rgba(238, 240, 255, 0.6)';
		ctx.font = '11px ui-monospace, Consolas, monospace';
		ctx.fillText('far wall, close up', x0, y0 + h + 18);
	}

	function draw(t: number) {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		drawScene(t);
		drawLight(t);
		drawCloseup();
		if (won) {
			ctx.fillStyle = `rgba(255, 231, 163, ${0.25 + wonFlash * 0.5})`;
			ctx.font = 'italic 22px Georgia, serif';
			ctx.fillText('Interference.', 300, 200);
		}
	}

	let raf = 0;
	let last = performance.now();
	const frame = (now: number) => {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		step(dt);
		draw(now / 1000);
		raf = requestAnimationFrame(frame);
	};
	raf = requestAnimationFrame(frame);
	win.onClose(() => {
		cancelAnimationFrame(raf);
		document.removeEventListener('keydown', onKey);
	});
	updateHint();

	if (import.meta.env.DEV) {
		(window as unknown as { __slits: unknown }).__slits = {
			geometry,
			setWall: (x: number) => (wallX = x),
			lightCandle: () => {
				candle = true;
				updateHint();
			},
			step,
			get won() {
				return won;
			},
			get state() {
				return { match, matchLit, candle, candleHeat, held, wallX, holdT };
			},
		};
	}
}
