// "momentum" on the Now page: an endless rooftop runner. You run on your own and only control jumping;
// speed builds the longer you survive. Falling off the bottom of the screen or touching a sparking vent
// ends the run. Surviving one minute solves the secret; the run carries on for as long as you last.
//
// Mechanics: variable jump (release early for a short hop), slopes (a burst of speed), corridors
// through buildings, drops and climbs, wall jumps, grapple hooks
// (press jump in the air near one; press again to let go), trains you can ride, narrow ledges, and
// wall-run panels (hold jump), air vents that launch you upward, and drones you can grab (glide
// down; hold jump to dive) or stand on. The level is made of seeded segments: see src/secrets/runner/.
import { openWindow, solve, chime } from '../ui';
import { getData, isSolved, setData } from '../progress';
import {
	PHYS,
	START_SPEED,
	STREET,
	generateSegment,
	introSegment,
	maxSpeedAt,
	tierAt,
	type Box,
	type Facade,
	type Grapple,
	type Hint,
	type Segment,
	type Slope,
	type Solid,
	type Train,
	type Drone,
	DRONE,
	VENT_V,
} from '../runner/levelgen';
import { pickSeed } from '../runner/seeds';
import { createRunnerSound, type Surface } from '../runner/sound';

const ID = 'now';
/** Seconds a run has to last to solve the secret. */
const GOAL = 60;

const CW = 960;
const CH = 540;
const SCALE = 30; // px per metre
const VIEW_W = CW / SCALE;
const VIEW_H = CH / SCALE;

const GOLD = '#ffe7a3';
const CYAN = '#7fe3ff';
const { G, JUMP_V, JUMP_CUT, W, H } = PHYS;
const WALL_JUMP = { vx: 8.5, vy: 13 };
const GRAPPLE_RANGE = 7.5;
/** The rope reels in at this rate (m/s) down to ROPE_MIN, which speeds up the swing. */
const REEL = 4;
const ROPE_MIN = 1.6;
const STEP_UP = 0.45;
/** How far below the lowest nearby roof the screen reaches; dropping past it ends the run. */
const FLOOR_MARGIN = 4.5;
/** Metres of track between rail joints (one "ka-chunk" each). */
const RAIL_JOINT = 7;

const STYLES = [
	{ wall: '#283152', edge: '#56639a', lit: '#ffd98a' },
	{ wall: '#352b4a', edge: '#7a62a0', lit: '#ffc7a0' },
	{ wall: '#22363f', edge: '#4f8191', lit: '#bff0ff' },
	{ wall: '#3b3238', edge: '#8a6d74', lit: '#ffe2b0' },
];

const CSS = `
.run-wrap { position: relative; }
.run-bar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.run-bar p { margin: 0; }
`;

interface DroneState {
	home: Drone;
	/** Centre x and underside y, like Drone. */
	x: number;
	y: number;
	/** Hovering in place, carrying the runner down, or flying back to its spot. */
	mode: 'hover' | 'carry' | 'return';
	phase: number;
}

interface TrainState {
	def: Train;
	/** Metres since the wheels last crossed a rail joint (for the clunk sound). */
	joint: number;
	nose: number;
	vx: number;
	done: boolean;
}

const hash = (a: number, b: number, c = 0) => {
	let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const overlaps = (ax: number, ay: number, aw: number, ah: number, b: Box) =>
	ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

export function launch(): void {
	if (!document.getElementById('secret-style-runner')) {
		const s = document.createElement('style');
		s.id = 'secret-style-runner';
		s.textContent = CSS;
		document.head.append(s);
	}
	const win = openWindow({ title: 'Conservation of Momentum', width: 900 });
	win.body.innerHTML = `
		<div class="run-wrap">
			<canvas class="secret-canvas" aria-label="Rooftop runner. Press space or tap to jump."></canvas>
		</div>
		<div class="run-bar">
			<p class="secret-hint">Jump: Space, ↑, W, or tap/click the game. Hold for a higher jump. R restarts.</p>
			<button type="button" class="secret-btn run-sound" aria-pressed="true">Sound: on</button>
		</div>`;
	const canvas = win.body.querySelector('canvas')!;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	canvas.width = CW * dpr;
	canvas.height = CH * dpr;
	const ctx = canvas.getContext('2d')!;

	// Sound (footsteps, jumps, wind); the toggle is remembered.
	let muted = getData<boolean>('now-muted', false);
	const sound = createRunnerSound(muted);
	const soundBtn = win.body.querySelector<HTMLButtonElement>('.run-sound')!;
	const showSound = () => {
		soundBtn.textContent = muted ? 'Sound: off' : 'Sound: on';
		soundBtn.setAttribute('aria-pressed', String(!muted));
	};
	showSound();
	soundBtn.addEventListener('click', () => {
		muted = !muted;
		sound.wake();
		sound.setMuted(muted);
		setData('now-muted', muted);
		showSound();
	});
	/** What you're standing on, for the footstep sound. */
	let surface: Surface = 'roof';
	/** How loud the nearest train is (0..1), for its rumble. */
	let trainLevel = 0;
	let lastStep = 0;

	// ---- World ---------------------------------------------------------------------------------
	let segments: Segment[] = [];
	let solids: Solid[] = [];
	let slopes: Slope[] = [];
	let facades: Facade[] = [];
	let hazards: Box[] = [];
	let grapples: Grapple[] = [];
	let wallRuns: Box[] = [];
	let trainDefs: Train[] = [];
	let hints: Hint[] = [];
	let trains: TrainState[] = [];
	let vents: Box[] = [];
	let drones: DroneState[] = [];
	let frontier = { x: 0, y: 0 };
	let recentSeeds: number[] = [];

	function addSegment(seg: Segment) {
		segments.push(seg);
		solids.push(...seg.solids);
		slopes.push(...seg.slopes);
		facades.push(...seg.facades);
		hazards.push(...seg.hazards);
		grapples.push(...seg.grapples);
		wallRuns.push(...seg.wallRuns);
		trainDefs.push(...seg.trains);
		hints.push(...seg.hints);
		vents.push(...seg.vents);
		drones.push(...seg.drones.map((d, i) => ({ home: d, x: d.x, y: d.y, mode: 'hover' as const, phase: i * 1.7 + d.x })));
		frontier = { x: seg.x1, y: seg.endY };
	}

	function prune(beforeX: number) {
		if (!segments.length || segments[0].x1 > beforeX) return;
		segments = segments.filter((s) => s.x1 > beforeX);
		const keep = <T extends { x: number; w?: number }>(list: T[]) => list.filter((o) => o.x + (o.w ?? 0) > beforeX);
		solids = keep(solids);
		facades = keep(facades);
		hazards = keep(hazards);
		grapples = keep(grapples);
		wallRuns = keep(wallRuns);
		hints = keep(hints);
		slopes = slopes.filter((s) => s.x1 > beforeX);
		trainDefs = trainDefs.filter((t) => t.x1 > beforeX);
		trains = trains.filter((t) => !t.done);
		vents = keep(vents);
		drones = drones.filter((d) => d.home.x + DRONE.W > beforeX);
	}

	// ---- Run state -----------------------------------------------------------------------------
	type Mode = 'ready' | 'running' | 'dead';
	let mode: Mode = 'ready';
	let time = 0;
	let deadFor = 0;
	let deathCause = '';
	let goalFlash = 0;
	let best = getData<number>('now-best', 0);
	const seenHints = getData<Record<string, number>>('now-hints', {});
	let showHint: Record<string, boolean> = {};
	const passedHints = new Set<Hint>();

	const P = {
		x: 0,
		y: 0,
		vx: 0,
		vy: 0,
		grounded: true,
		coyote: 0,
		buffer: 0,
		slope: null as Slope | null,
		train: null as TrainState | null,
		wall: 0,
		grapple: null as Grapple | null,
		grappleT: 0,
		rope: 0,
		wallRun: false,
		anim: 0,
		/** Running direction: 1 = right, -1 = left. Wall jumps flip it. */
		dir: 1,
		/** Furthest right reached this run (the distance shown). */
		maxX: 0,
		/** Set when you jump off a train: its extra speed bleeds off faster than a slope's. */
		trainBoost: false,
		/** The drone you're hanging from, its forward speed, and whether holding jump dives yet. */
		drone: null as DroneState | null,
		droneVx: 0,
		diveArmed: false,
		/** Launched by an air vent: letting go of jump doesn't cut the climb short. */
		launched: false,
	};
	const cam = { x: 0, cy: 0 };
	let held = false;
	let pressed = false;
	// Dev testing: force the segments generated next, or freeze the clock.
	let forced: [number, number][] = [];
	let frozen = false;

	function reset() {
		segments = [];
		solids = [];
		slopes = [];
		facades = [];
		hazards = [];
		grapples = [];
		wallRuns = [];
		trainDefs = [];
		hints = [];
		trains = [];
		vents = [];
		drones = [];
		recentSeeds = [];
		addSegment(introSegment());
		Object.assign(P, {
			x: 4,
			y: 0,
			vx: 0,
			vy: 0,
			grounded: true,
			coyote: 0,
			buffer: 0,
			slope: null,
			train: null,
			wall: 0,
			grapple: null,
			grappleT: 0,
			wallRun: false,
			dir: 1,
			maxX: 4,
			trainBoost: false,
			drone: null,
			droneVx: 0,
			diveArmed: false,
			launched: false,
		});
		time = 0;
		deadFor = 0;
		mode = 'ready';
		showHint = Object.fromEntries(
			['jump', 'hazard', 'slope', 'grapple', 'wallrun', 'chimney', 'train', 'ramp', 'chain', 'switchback', 'updraft', 'drone', 'dronestep'].map((k) => [k, (seenHints[k] ?? 0) < 3]),
		);
		passedHints.clear();
		cam.x = P.x - VIEW_W * 0.28;
		cam.cy = P.y + 3;
		ensureAhead();
	}

	function ensureAhead() {
		while (frontier.x < P.x + 110) {
			const eta = time + Math.max(0, frontier.x - P.x) / Math.max(P.vx, START_SPEED);
			const f = forced.shift();
			const tier = f ? f[1] : tierAt(eta);
			const seed = f ? f[0] : pickSeed(tier, recentSeeds);
			recentSeeds = [...recentSeeds.slice(-6), seed];
			addSegment(generateSegment(seed, tier, frontier.x, frontier.y));
		}
	}

	// ---- Physics -------------------------------------------------------------------------------
	const near = (list: Solid[], x0: number, x1: number) => list.filter((s) => s.x < x1 && s.x + s.w > x0);

	function touchingWall(local: Solid[]): number {
		for (const s of local) {
			if (!s.climb || s.y + s.h <= P.y + 0.3 || s.y >= P.y + H) continue;
			// The hanging slab only grips on the side facing the tall building.
			if (s.kind !== 'slab' && overlaps(P.x + 0.06, P.y + 0.05, W, H - 0.1, s) && s.x >= P.x + W - 0.1) return 1;
			if (overlaps(P.x - 0.06, P.y + 0.05, W, H - 0.1, s) && s.x + s.w <= P.x + 0.1) return -1;
		}
		return 0;
	}

	function nearestGrapple(): Grapple | null {
		let bestG: Grapple | null = null;
		let bestD = GRAPPLE_RANGE;
		const cx = P.x + W / 2;
		const cy = P.y + H / 2;
		for (const g of grapples) {
			if ((g.x - cx) * P.dir < -1.5) continue;
			const d = Math.hypot(g.x - cx, g.y - cy);
			if (d < bestD) {
				bestD = d;
				bestG = g;
			}
		}
		return bestG;
	}

	function die(cause: string) {
		if (mode !== 'running') return;
		mode = 'dead';
		deathCause = cause;
		deadFor = 0;
		chime('error');
		if (time > best) {
			best = time;
			setData('now-best', best);
		}
		setData('now-hints', seenHints);
	}

	function tryJump(local: Solid[]) {
		// Hanging from a drone, jump only matters held down (to dive); see step().
		if (P.drone) {
			P.buffer = 0;
			return;
		}
		if (P.grapple) {
			P.grapple = null;
			P.buffer = 0;
			return;
		}
		if (P.grounded || P.coyote > 0) {
			if (P.train) P.trainBoost = true;
			sound.jump();
			P.vy = JUMP_V;
			P.grounded = false;
			P.coyote = 0;
			P.buffer = 0;
			P.slope = null;
			P.train = null;
			return;
		}
		const wall = touchingWall(local);
		if (wall) {
			// Kicking off a wall sends you, and your running direction, the other way.
			P.vx = -wall * WALL_JUMP.vx;
			P.vy = WALL_JUMP.vy;
			sound.jump('kick');
			P.dir = -wall;
			P.buffer = 0;
			return;
		}
		const g = nearestGrapple();
		if (g) {
			P.grapple = g;
			P.grappleT = 0;
			P.rope = Math.hypot(g.x - (P.x + W / 2), g.y - (P.y + H / 2));
			P.buffer = 0;
		}
		// Otherwise the press stays buffered briefly, so a jump just before landing still counts.
	}

	function step(dt: number) {
		if (mode !== 'running' || frozen) return;
		time += dt;
		const cap = maxSpeedAt(time);
		const local = near(solids, P.x - 6, P.x + 6);

		// Trains set off as the runner reaches the viaduct, and vanish into the far tunnel.
		for (const def of trainDefs) {
			if (P.x + W / 2 >= def.triggerX && !trains.some((t) => t.def === def)) {
				trains.push({ def, nose: def.startX, vx: Math.max(P.vx, START_SPEED) + def.boost, done: false, joint: 0 });
			}
		}
		trainLevel = 0;
		for (const t of trains) {
			t.nose += t.vx * dt;
			if (t.nose - t.def.len > t.def.endX) t.done = true;
			if (t.done) continue;
			// How loud it is here: full on top of it, fading with distance from the part that's out of the
			// tunnels (and silent once it's gone into the far one).
			const rear = Math.max(t.nose - t.def.len, t.def.x0);
			const front = Math.min(t.nose, t.def.endX);
			if (front <= rear) continue;
			const cx = P.x + W / 2;
			const dist = Math.max(0, rear - cx, cx - front) + Math.max(0, Math.abs(P.y - t.def.top) - 2);
			const level = P.train === t ? 1 : Math.max(0, 1 - dist / 28) * Math.min(1, (front - rear) / 6);
			trainLevel = Math.max(trainLevel, level);
			t.joint += t.vx * dt;
			if (t.joint > RAIL_JOINT) {
				t.joint -= RAIL_JOINT;
				sound.trainClunk(level);
			}
		}
		// Drones bob in place, or fly back to their spot after carrying you down.
		for (const d of drones) {
			if (d.mode === 'hover') {
				d.x = d.home.x;
				d.y = d.home.y + Math.sin(time * 2.2 + d.phase) * 0.22;
			} else if (d.mode === 'return') {
				const dx = d.home.x - d.x;
				const dy = d.home.y - d.y;
				const dist = Math.hypot(dx, dy);
				if (dist < 0.15) d.mode = 'hover';
				else {
					d.x += (dx / dist) * Math.min(dist, 6 * dt);
					d.y += (dy / dist) * Math.min(dist, 6 * dt);
				}
			}
		}

		P.coyote = P.grounded ? 0.1 : Math.max(0, P.coyote - dt);
		P.buffer = Math.max(0, P.buffer - dt);
		if (pressed) {
			pressed = false;
			P.buffer = 0.13;
		}
		if (P.buffer > 0) tryJump(local);

		// Horizontal speed.
		if (P.drone) {
			// Hanging from a drone: it flies you forward at its own steady speed.
			P.vx = P.droneVx;
		} else if (P.grapple) {
			// Swinging: gravity and the rope do the work (see below).
		} else if (!P.grounded && !P.wallRun && P.vx * P.dir >= 0 && P.vx * P.dir < 4) {
			// Nearly stopped in the air (e.g. jumping up beside a wall): drift forward so you can get onto it.
			P.vx += 10 * P.dir * dt;
		} else if (P.train) {
			P.vx += (P.train.vx + P.dir - P.vx) * Math.min(1, dt * 8);
		} else if (P.grounded || P.wallRun) {
			// Speed along the running direction. Back up to speed quickly after a stop; the cap itself
			// rises slowly with time.
			let v = P.vx * P.dir;
			if (v < 0) v += 30 * dt;
			else if (v < cap) v = Math.min(cap, v + (v < cap - 3 ? 8 : 2) * dt);
			else {
				// Over the cap: a slope's burst fades over a second or two, a train's within about half a second.
				v = Math.max(cap, v - (P.trainBoost ? 9 : 3) * dt);
			}
			if (v <= cap) P.trainBoost = false;
			P.vx = v * P.dir;
			if (P.slope) {
				// Sliding downhill (slopes fall to the right): a burst of speed over the cap that fades once
				// you're off. Running up one slows you.
				const s = P.slope;
				const sin = (s.y0 - s.y1) / Math.hypot(s.x1 - s.x0, s.y0 - s.y1);
				P.vx += G * sin * 0.6 * dt;
				if (P.dir === 1) P.vx = Math.min(cap + (s.boost ?? 4), P.vx);
			}
		}

		// Vertical speed.
		P.wallRun =
			!P.grounded &&
			held &&
			!P.grapple &&
			P.vy <= 2 &&
			wallRuns.some((z) => overlaps(P.x, P.y, W, H, z));
		if (P.drone) {
			// Gliding down with the drone; hold jump (pressed after you grabbed it) to dive.
			if (!held) P.diveArmed = true;
			P.vy = P.diveArmed && held ? -DRONE.DIVE : -DRONE.GLIDE;
		} else if (P.wallRun) P.vy = 0;
		else P.vy -= G * dt;
		if (P.vy <= 0) P.launched = false;
		if (!held && P.vy > JUMP_CUT && !P.grapple && !P.launched) P.vy = JUMP_CUT;
		// Air vents launch you when you run (or drop) onto them.
		if (!P.drone && P.vy <= 3) {
			for (const z of vents) {
				if (P.x < z.x + z.w && P.x + W > z.x && P.y >= z.y - 0.1 && P.y <= z.y + 1.2) {
					P.vy = VENT_V;
					sound.jump('vent');
					P.launched = true;
					P.grounded = false;
					P.coyote = 0;
					P.slope = null;
					chime('hover');
					break;
				}
			}
		}
		P.wall = P.grounded || P.drone ? 0 : touchingWall(local);
		if (P.wall && P.vy < -2.5) P.vy = -2.5;
		// Ledge grab: on a climbing wall with your feet within a metre of its top, pull yourself up.
		if (P.wall) {
			const w = P.wall;
			const ledge = local.find(
				(s) =>
					s.climb &&
					s.kind === 'roof' &&
					Math.abs((w === 1 ? s.x : s.x + s.w) - (w === 1 ? P.x + W : P.x)) < 0.12 &&
					s.y + s.h - P.y <= 1.1 &&
					s.y + s.h > P.y,
			);
			if (ledge && P.vy <= 4) {
				P.y = ledge.y + ledge.h;
				P.x = w === 1 ? ledge.x + 0.05 : ledge.x + ledge.w - W - 0.05;
				P.vy = 0;
				P.dir = w;
				P.vx = w * Math.max(P.vx * w, START_SPEED * 0.6);
				P.wall = 0;
			}
		}
		P.vy = Math.max(P.vy, -32);

		// The grapple is a rope that reels in: it keeps you on a circle around the hook, so you swing under
		// it and get thrown up and forward. It lets go once you've swung past the hook and up near its
		// height (or on a second press of jump, or after a while).
		if (P.grapple) {
			P.grappleT += dt;
			const dx = P.x + W / 2 - P.grapple.x;
			const dy = P.y + H / 2 - P.grapple.y;
			const d = Math.hypot(dx, dy);
			// The rope never goes slack (no jolt when it catches); it only shortens.
			P.rope = Math.max(ROPE_MIN, Math.min(P.rope - REEL * dt, d));
			const ahead = dx * P.dir;
			const swungUp = ahead > 0 && P.vy > 0 && (ahead > 0.6 * d || dy > -1.2);
			if (swungUp) {
				// Thrown off the top of the swing.
				P.grapple = null;
				P.vx = P.dir * Math.max(P.vx * P.dir, cap);
				P.vy = Math.max(P.vy, 7);
			} else if (P.grappleT > 1.8) P.grapple = null;
			else if (d > P.rope) {
				const nx = dx / d;
				const ny = dy / d;
				P.x -= nx * (d - P.rope);
				P.y -= ny * (d - P.rope);
				const out = P.vx * nx + P.vy * ny;
				if (out > 0) {
					P.vx -= out * nx;
					P.vy -= out * ny;
				}
				const sp = Math.hypot(P.vx, P.vy);
				if (sp > 26) {
					P.vx *= 26 / sp;
					P.vy *= 26 / sp;
				}
			}
		}

		// Move along x, then y, resolving against solids.
		const prevY = P.y;
		const wasGrounded = P.grounded;
		const wasSlope = P.slope;
		let hitWall = false;
		P.x += P.vx * dt;
		for (const s of local) {
			if (!overlaps(P.x, P.y, W, H, s)) continue;
			const top = s.y + s.h;
			if (s.kind !== 'ceiling' && top - P.y <= STEP_UP && (wasGrounded || P.vy <= 2)) {
				P.y = top;
				P.vy = 0;
				continue;
			}
			const fromLeft = P.x + W / 2 < s.x + s.w / 2;
			if (s.kind === 'crate' && fromLeft && wasGrounded) {
				// Running forward into a crate, you vault onto it (losing a little speed). Only its back face,
				// the one you meet running the wrong way, turns you around.
				P.y = top;
				P.vy = 0;
				P.vx *= 0.85;
				continue;
			}
			if (fromLeft) P.x = s.x - W;
			else P.x = s.x + s.w;
			P.vx = 0;
			hitWall = true;
			// Running into an ordinary wall turns you around; at a climbing wall you stop so you can climb.
			if (wasGrounded && !s.climb && (fromLeft ? 1 : -1) === P.dir) P.dir = -P.dir;
		}
		const fallV = P.vy;
		P.y += P.vy * dt;
		P.grounded = false;
		P.slope = null;
		P.train = null;
		for (const s of local) {
			if (!overlaps(P.x, P.y, W, H, s)) continue;
			const top = s.y + s.h;
			if (P.vy <= 0 && prevY >= top - 0.25) {
				P.y = top;
				P.vy = 0;
				P.grounded = true;
				surface = s.kind === 'roof' || s.kind === 'ceiling' ? 'roof' : 'metal';
			} else if (P.vy > 0 && prevY + H <= s.y + 0.25) {
				// A hair below the underside, so you don't snag on its edge as you move away.
				P.y = s.y - H - 0.002;
				P.vy = 0;
				P.grapple = null;
			} else if (top - P.y < 0.5) {
				P.y = top;
				P.vy = 0;
				P.grounded = true;
				surface = s.kind === 'roof' || s.kind === 'ceiling' ? 'roof' : 'metal';
			}
		}
		const cx = P.x + W / 2;
		for (const s of slopes) {
			if (cx < s.x0 || cx > s.x1) continue;
			const sy = s.y0 + ((cx - s.x0) / (s.x1 - s.x0)) * (s.y1 - s.y0);
			const snap = wasSlope === s || wasGrounded ? 0.6 : 0.05;
			if (P.vy <= 0 && P.y <= sy + snap && prevY >= sy - 0.6) {
				P.y = sy;
				P.vy = 0;
				P.grounded = true;
				P.slope = s;
				surface = 'roof';
			}
		}
		for (const t of trains) {
			if (t.done) continue;
			const rear = Math.max(t.nose - t.def.len, t.def.x0);
			const front = Math.min(t.nose, t.def.endX);
			if (P.x + W <= rear || P.x >= front) continue;
			if (P.vy <= 0 && prevY >= t.def.top - 0.25 && P.y <= t.def.top) {
				P.y = t.def.top;
				P.vy = 0;
				P.grounded = true;
				P.train = t;
				surface = 'train';
				if (!wasGrounded) P.vx = t.vx + P.dir;
			}
		}
		// Drones: land on top and it's a small platform; meet it from below or the side and you grab on.
		if (P.drone) {
			const d = P.drone;
			if (P.grounded || hitWall) {
				// Let go on touching down (and run on), or on hitting a wall.
				d.mode = 'return';
				P.drone = null;
			} else {
				d.x = P.x + W / 2;
				d.y = P.y + H + 0.1;
			}
		} else {
			for (const d of drones) {
				if (d.mode === 'carry') continue;
				const box = { x: d.x - DRONE.W / 2, y: d.y, w: DRONE.W, h: DRONE.H };
				if (!overlaps(P.x, P.y, W, H, box)) continue;
				const top = d.y + DRONE.H;
				if (P.vy <= 0 && prevY >= top - 0.35) {
					P.y = top;
					P.vy = 0;
					P.grounded = true;
					surface = 'metal';
				} else {
					P.drone = d;
					d.mode = 'carry';
					P.droneVx = P.dir * DRONE.SPEED;
					P.diveArmed = !held;
					P.grapple = null;
					P.launched = false;
					P.x = d.x - W / 2;
					P.y = d.y - 0.1 - H;
					P.vy = 0;
				}
				break;
			}
		}
		if (P.grounded) P.grapple = null;
		if (!wasGrounded && P.grounded && fallV < -9) sound.land((-fallV - 9) / 18);
		P.anim += Math.abs(P.vx) * dt * (P.grounded || P.wallRun ? 1.5 : 0.4);
		// A footstep each time a foot comes down (the run cycle is drawn from P.anim; see drawRunner).
		const stepIndex = Math.floor((P.anim * 1.1) / Math.PI);
		if (stepIndex !== lastStep) {
			lastStep = stepIndex;
			if (P.grounded && Math.abs(P.vx) > 1) sound.footstep(surface, Math.min(1, 0.6 + Math.abs(P.vx) / 30));
			else if (P.wallRun) sound.footstep('metal', 0.5);
		}
		P.maxX = Math.max(P.maxX, P.x);

		// Dangers.
		for (const z of hazards) if (overlaps(P.x + 0.08, P.y, W - 0.16, H - 0.1, z)) die('A sparking vent got you.');
		if (P.y + H < floorAt() - FLOOR_MARGIN) die('You fell.');

		// Hints count as seen once you pass them.
		for (const hnt of hints) {
			if (!passedHints.has(hnt) && P.x > hnt.x) {
				passedHints.add(hnt);
				seenHints[hnt.key] = (seenHints[hnt.key] ?? 0) + 1;
			}
		}

		if (time >= GOAL && !isSolved(ID)) {
			goalFlash = 3;
			solve(ID);
		} else if (time >= GOAL && time - dt < GOAL) goalFlash = 3;

		ensureAhead();
		prune(Math.min(P.x, P.maxX - 20) - 50);
	}

	/** The lowest surface just around and ahead of the runner; dropping well below it is a fall. */
	function floorAt(): number {
		const x0 = P.x - (P.dir === 1 ? 2 : VIEW_W * 0.7);
		const x1 = P.x + (P.dir === 1 ? VIEW_W * 0.7 : 2);
		let lo = Infinity;
		for (const s of solids) if (s.kind !== 'ceiling' && s.x < x1 && s.x + s.w > x0) lo = Math.min(lo, s.y + s.h);
		for (const t of trains) {
			if (t.done) continue;
			const rear = Math.max(t.nose - t.def.len, t.def.x0);
			const front = Math.min(t.nose, t.def.endX);
			if (front > rear && front > x0 && rear < x1) lo = Math.min(lo, t.def.top);
		}
		return lo === Infinity ? P.y : lo;
	}

	function updateCamera(dt: number) {
		// Look ahead in the running direction, easing across when it flips.
		const ahead = Math.min(5, Math.max(0, (Math.abs(P.vx) - START_SPEED) * 0.35));
		const tx = P.dir === 1 ? P.x - VIEW_W * 0.28 - ahead : P.x - VIEW_W * 0.72 + ahead;
		cam.x += (tx - cam.x) * Math.min(1, dt * 3);
		const floor = floorAt();
		let target = P.y + 2.6;
		target = Math.max(target, floor - FLOOR_MARGIN + VIEW_H / 2);
		const rate = target < cam.cy ? 7 : 4;
		if (mode !== 'dead') cam.cy += (target - cam.cy) * Math.min(1, dt * rate);
	}

	// ---- Drawing -------------------------------------------------------------------------------
	const stars = Array.from({ length: 70 }, (_, i) => ({ x: hash(i, 1) * CW, y: hash(i, 2) * CH * 0.6, r: hash(i, 3) }));
	const camB = () => cam.cy - VIEW_H / 2;
	const sx = (x: number) => (x - cam.x) * SCALE;
	const sy = (y: number) => CH - (y - camB()) * SCALE;

	function drawSky() {
		const g = ctx.createLinearGradient(0, 0, 0, CH);
		g.addColorStop(0, '#070a1e');
		g.addColorStop(0.55, '#1d1840');
		g.addColorStop(1, '#43264e');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, CW, CH);
		for (const s of stars) {
			ctx.globalAlpha = 0.25 + s.r * 0.6;
			ctx.fillStyle = '#fff';
			ctx.fillRect(s.x, s.y, s.r > 0.8 ? 2 : 1, s.r > 0.8 ? 2 : 1);
		}
		ctx.globalAlpha = 1;
		ctx.fillStyle = '#fff3d6';
		ctx.shadowColor = '#fff3d6';
		ctx.shadowBlur = 30;
		ctx.beginPath();
		ctx.arc(CW * 0.78, CH * 0.18, 26, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;
	}

	const LAYERS = [
		{ f: 0.1, cell: 5, min: 4, max: 13, color: '#171535', lit: 0 },
		{ f: 0.22, cell: 4, min: 3, max: 11, color: '#1f1b40', lit: 0.05 },
		{ f: 0.42, cell: 3.4, min: 2, max: 9, color: '#29224a', lit: 0.1 },
	];
	function drawParallax() {
		LAYERS.forEach((L, li) => {
			const off = cam.x * L.f;
			const base = CH + 40 - (camB() * L.f * 0.6 - 0) * SCALE * 0.5;
			const unit = SCALE * (0.55 + li * 0.15);
			const first = Math.floor(off / L.cell) - 1;
			const count = Math.ceil(VIEW_W / L.cell / (0.55 + li * 0.15)) + 3;
			ctx.fillStyle = L.color;
			for (let i = first; i < first + count; i++) {
				const h = L.min + hash(i, li + 10) * (L.max - L.min);
				const w = L.cell * (0.6 + 0.4 * hash(i, li + 20));
				const x = (i * L.cell - off) * unit;
				const top = base - h * unit;
				ctx.fillRect(x, top, w * unit, CH - top + 50);
				if (L.lit) {
					ctx.fillStyle = 'rgba(255, 214, 150, 0.55)';
					for (let r = 0; r < h * 1.5; r++)
						for (let c = 0; c < w * 1.5; c++)
							if (hash(i * 31 + c, r, li) < L.lit) ctx.fillRect(x + c * unit * 0.66 + 2, top + r * unit * 0.66 + 3, 2, 2);
					ctx.fillStyle = L.color;
				}
			}
		});
		// Haze where the street would be.
		const g = ctx.createLinearGradient(0, CH * 0.6, 0, CH);
		g.addColorStop(0, 'rgba(67, 38, 78, 0)');
		g.addColorStop(1, 'rgba(67, 38, 78, 0.55)');
		ctx.fillStyle = g;
		ctx.fillRect(0, CH * 0.6, CW, CH * 0.4);
	}

	function visible(x0: number, x1: number) {
		return x1 > cam.x - 1 && x0 < cam.x + VIEW_W + 1;
	}

	function drawTrains() {
		for (const def of trainDefs) {
			if (!visible(def.x0, def.x1)) continue;
			const deck = def.top - 2.8;
			ctx.fillStyle = '#1a1730';
			ctx.fillRect(sx(def.x0), sy(deck), (def.x1 - def.x0) * SCALE, 0.5 * SCALE);
			for (let px = def.x0 + 3; px < def.x1 - 1; px += 7) ctx.fillRect(sx(px), sy(deck - 0.5), 0.8 * SCALE, CH);
			ctx.strokeStyle = '#6d6a8a';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(sx(def.x0), sy(deck));
			ctx.lineTo(sx(def.x1), sy(deck));
			ctx.stroke();
		}
		for (const t of trains) {
			if (t.done) continue;
			// Only ever drawn between the two tunnel mouths: it rolls out of one and is gone into the other.
			ctx.save();
			ctx.beginPath();
			ctx.rect(sx(t.def.x0), 0, (t.def.x1 - t.def.x0) * SCALE, CH);
			ctx.clip();
			const rear = t.nose - t.def.len;
			const top = t.def.top;
			ctx.fillStyle = '#c9cfdc';
			ctx.beginPath();
			ctx.moveTo(sx(rear), sy(top));
			ctx.lineTo(sx(t.nose - 1.6), sy(top));
			ctx.lineTo(sx(t.nose), sy(top - 1.4));
			ctx.lineTo(sx(t.nose), sy(top - 2.6));
			ctx.lineTo(sx(rear), sy(top - 2.6));
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#2d3a5c';
			ctx.fillRect(sx(rear + 0.5), sy(top - 0.5), (t.def.len - 2.6) * SCALE, 0.7 * SCALE);
			ctx.fillStyle = 'rgba(255, 228, 160, 0.8)';
			for (let wx = rear + 1; wx < t.nose - 2.5; wx += 1.6) ctx.fillRect(sx(wx), sy(top - 0.6), 0.9 * SCALE, 0.45 * SCALE);
			ctx.fillStyle = '#e25c5c';
			ctx.fillRect(sx(rear + 0.3), sy(top - 1.9), (t.def.len - 1.8) * SCALE, 0.18 * SCALE);
			ctx.fillStyle = '#fff6c8';
			ctx.fillRect(sx(t.nose - 0.35), sy(top - 1.9), 0.3 * SCALE, 0.3 * SCALE);
			ctx.restore();
		}
	}

	function drawFacades() {
		for (const f of facades) {
			if (!visible(f.x, f.x + f.w)) continue;
			const st = STYLES[f.style % STYLES.length];
			const bottom = Math.min(camB() - 1, STREET);
			if (f.opening) {
				// The corridor's interior, always visible.
				ctx.fillStyle = '#100d1c';
				ctx.fillRect(sx(f.x), sy(f.opening.y1), f.w * SCALE, (f.opening.y1 - f.opening.y0) * SCALE);
				ctx.fillStyle = 'rgba(255, 220, 160, 0.5)';
				for (let lx = f.x + 1.5; lx < f.x + f.w - 1; lx += 3) ctx.fillRect(sx(lx), sy(f.opening.y1 - 0.05), 0.8 * SCALE, 3);
			}
			const parts = f.opening
				? [
						[f.opening.y1, f.top],
						[Math.max(bottom, camB() - 2), f.opening.y0],
					]
				: [[Math.max(bottom, camB() - 2), f.top]];
			for (const [y0, y1] of parts) {
				if (y1 <= y0) continue;
				ctx.fillStyle = st.wall;
				ctx.fillRect(sx(f.x), sy(y1), f.w * SCALE, (y1 - y0) * SCALE);
				// Windows.
				for (let r = 0; ; r++) {
					const wy = y1 - 1.1 - r * 1.7;
					if (wy < y0 + 0.2 || wy < camB() - 1) break;
					if (wy > camB() + VIEW_H + 1) continue;
					for (let c = 0; ; c++) {
						const wx = f.x + 0.7 + c * 1.35;
						if (wx + 0.6 > f.x + f.w - 0.4) break;
						const lit = hash(f.seed, c, r) < 0.33;
						ctx.fillStyle = lit ? st.lit : 'rgba(10, 12, 30, 0.55)';
						ctx.globalAlpha = lit ? 0.85 : 1;
						ctx.fillRect(sx(wx), sy(wy), 0.55 * SCALE, 0.75 * SCALE);
						ctx.globalAlpha = 1;
					}
				}
			}
			// Roof edge.
			ctx.fillStyle = st.edge;
			ctx.fillRect(sx(f.x), sy(f.top), f.w * SCALE, 0.22 * SCALE);
			if (f.opening) ctx.fillRect(sx(f.x), sy(f.opening.y0), f.w * SCALE, 0.22 * SCALE);
			ctx.globalAlpha = 1;
			if (f.tunnel) {
				const tx = f.tunnel.side === 'left' ? f.x : f.x + f.w - 1.4;
				ctx.fillStyle = '#07060e';
				ctx.fillRect(sx(tx), sy(f.tunnel.y1), 1.4 * SCALE, (f.tunnel.y1 - f.tunnel.y0) * SCALE);
				ctx.strokeStyle = st.edge;
				ctx.lineWidth = 3;
				ctx.strokeRect(sx(tx), sy(f.tunnel.y1), 1.4 * SCALE, (f.tunnel.y1 - f.tunnel.y0) * SCALE);
			}
		}
	}

	function drawProps(now: number) {
		for (const s of slopes) {
			if (!visible(s.x0, s.x1)) continue;
			// Painted like the building it sits on (the one whose roof is at the slope's foot).
			const base = facades.find((f) => f.x <= s.x0 + 0.01 && f.x + f.w >= s.x1 - 0.01 && Math.abs(f.top - s.y1) < 0.01);
			const st = STYLES[(base?.style ?? 0) % STYLES.length];
			ctx.fillStyle = st.wall;
			ctx.beginPath();
			ctx.moveTo(sx(s.x0), sy(s.y0));
			ctx.lineTo(sx(s.x1), sy(s.y1));
			// Down past the building's roofline stripe, so it doesn't show as a seam under the slope.
			ctx.lineTo(sx(s.x1), sy(s.y1 - 0.25));
			ctx.lineTo(sx(s.x0), sy(s.y1 - 0.25));
			ctx.closePath();
			ctx.fill();
			// The surface: the same 0.22 m band as a flat roof's edge.
			ctx.fillStyle = st.edge;
			ctx.beginPath();
			ctx.moveTo(sx(s.x0), sy(s.y0));
			ctx.lineTo(sx(s.x1), sy(s.y1));
			ctx.lineTo(sx(s.x1), sy(s.y1 - 0.22));
			ctx.lineTo(sx(s.x0), sy(s.y0 - 0.22));
			ctx.closePath();
			ctx.fill();
			// Roof tiles.
			ctx.strokeStyle = st.edge;
			ctx.globalAlpha = 0.35;
			ctx.lineWidth = 1;
			for (let k = 1; k < 4; k++) {
				const o = k * 0.45;
				ctx.beginPath();
				ctx.moveTo(sx(s.x0), sy(s.y0 - o));
				ctx.lineTo(sx(s.x1 - (o * (s.x1 - s.x0)) / (s.y0 - s.y1)), sy(s.y1));
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
		}
		for (const s of solids) {
			if (!visible(s.x, s.x + s.w)) continue;
			if (s.kind === 'deck') {
				// A scaffold deck: planks over a truss.
				ctx.strokeStyle = '#5c6684';
				ctx.lineWidth = 2;
				ctx.beginPath();
				// A whole number of truss bays, so the last one ends at the deck's end.
				const bays = Math.max(1, Math.round(s.w / 1.2));
				const bay = s.w / bays;
				for (let i = 0; i < bays; i++) {
					const tx = s.x + i * bay;
					ctx.moveTo(sx(tx), sy(s.y));
					ctx.lineTo(sx(tx + bay / 2), sy(s.y - 0.5));
					ctx.lineTo(sx(tx + bay), sy(s.y));
				}
				ctx.stroke();
				ctx.fillStyle = '#a7adc8';
				ctx.fillRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
			} else if (s.kind === 'ledge') {
				ctx.fillStyle = '#4a4f6a';
				ctx.fillRect(sx(s.x + s.w / 2 - 0.08), sy(s.y), 0.16 * SCALE, CH);
				ctx.fillStyle = '#a7adc8';
				ctx.fillRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
			} else if (s.kind === 'crate') {
				ctx.fillStyle = '#6b5a45';
				ctx.fillRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
				ctx.strokeStyle = '#a88a62';
				ctx.lineWidth = 2;
				ctx.strokeRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
				ctx.beginPath();
				ctx.moveTo(sx(s.x), sy(s.y + s.h));
				ctx.lineTo(sx(s.x + s.w), sy(s.y));
				ctx.stroke();
			} else if (s.kind === 'slab') {
				ctx.fillStyle = '#56607d';
				ctx.fillRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
				ctx.fillStyle = 'rgba(255, 210, 120, 0.5)';
				for (let yy = s.y + 0.4; yy < s.y + s.h; yy += 0.9) ctx.fillRect(sx(s.x), sy(yy), s.w * SCALE, 3);
			}
		}
		for (const z of wallRuns) {
			if (!visible(z.x, z.x + z.w)) continue;
			const active = P.wallRun && overlaps(P.x, P.y, W, H, z);
			ctx.fillStyle = active ? 'rgba(127, 227, 255, 0.22)' : 'rgba(127, 227, 255, 0.1)';
			ctx.fillRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.strokeStyle = 'rgba(127, 227, 255, 0.55)';
			ctx.lineWidth = 2;
			ctx.strokeRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.fillStyle = `rgba(127, 227, 255, ${active ? 0.7 : 0.35})`;
			ctx.font = `bold ${Math.round(SCALE * 0.9)}px ui-sans-serif, system-ui, sans-serif`;
			ctx.textAlign = 'center';
			for (let cx = z.x + 1.5; cx < z.x + z.w - 0.5; cx += 2.5) ctx.fillText('›', sx(cx), sy(z.y + z.h / 2 - 0.3));
			// Support legs down to the street.
			ctx.fillStyle = '#3c4560';
			ctx.fillRect(sx(z.x + 0.3), sy(z.y), 0.15 * SCALE, CH);
			ctx.fillRect(sx(z.x + z.w - 0.45), sy(z.y), 0.15 * SCALE, CH);
		}
		for (const z of hazards) {
			if (!visible(z.x, z.x + z.w)) continue;
			ctx.fillStyle = '#2b2a36';
			ctx.fillRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.shadowColor = '#ff4d4d';
			ctx.shadowBlur = 14;
			ctx.strokeStyle = '#ff6b5c';
			ctx.lineWidth = 2;
			ctx.strokeRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.strokeStyle = '#fff0a8';
			ctx.beginPath();
			for (let k = 0; k < 3; k++) {
				const t = Math.floor(now / 70) + k * 17;
				const bx = z.x + hash(t, k, 5) * z.w;
				ctx.moveTo(sx(bx), sy(z.y + z.h));
				ctx.lineTo(sx(bx + (hash(t, k, 6) - 0.5) * 0.6), sy(z.y + z.h + 0.25 + hash(t, k, 7) * 0.4));
				ctx.lineTo(sx(bx + (hash(t, k, 8) - 0.5) * 0.8), sy(z.y + z.h + 0.5 + hash(t, k, 9) * 0.4));
			}
			ctx.stroke();
			ctx.shadowBlur = 0;
		}
		for (const z of vents) {
			if (!visible(z.x, z.x + z.w)) continue;
			// Air vent: a cyan grate with air rising off it (the red ones are the dangerous kind).
			ctx.fillStyle = '#2a3a48';
			ctx.fillRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.strokeStyle = CYAN;
			ctx.lineWidth = 2;
			ctx.strokeRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			for (let k = 1; k < 4; k++) ctx.fillRect(sx(z.x + (k * z.w) / 4) - 1, sy(z.y + z.h), 2, z.h * SCALE);
			ctx.lineWidth = 1.5;
			for (let k = 0; k < 3; k++) {
				const rise = ((now / 600 + k / 3) % 1) * 2.4;
				ctx.globalAlpha = 0.55 * (1 - rise / 2.4);
				const bx = z.x + 0.2 + k * 0.4;
				ctx.beginPath();
				ctx.moveTo(sx(bx), sy(z.y + z.h + rise));
				ctx.quadraticCurveTo(sx(bx + 0.15), sy(z.y + z.h + rise + 0.3), sx(bx), sy(z.y + z.h + rise + 0.6));
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
		}
		for (const d of drones) {
			if (!visible(d.x - 2, d.x + 2)) continue;
			const bx = d.x - DRONE.W / 2;
			// Arms and spinning rotors.
			ctx.strokeStyle = '#7d8aa8';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(sx(bx - 0.1), sy(d.y + DRONE.H + 0.15));
			ctx.lineTo(sx(bx + DRONE.W + 0.1), sy(d.y + DRONE.H + 0.15));
			ctx.stroke();
			const spin = Math.abs(Math.sin(now / 35));
			ctx.fillStyle = 'rgba(200, 220, 255, 0.45)';
			for (const rx of [bx - 0.1, bx + DRONE.W + 0.1]) {
				ctx.beginPath();
				ctx.ellipse(sx(rx), sy(d.y + DRONE.H + 0.22), (0.15 + 0.4 * spin) * SCALE, 0.06 * SCALE, 0, 0, Math.PI * 2);
				ctx.fill();
			}
			// Body.
			ctx.fillStyle = '#2c3448';
			ctx.fillRect(sx(bx), sy(d.y + DRONE.H), DRONE.W * SCALE, DRONE.H * SCALE);
			ctx.fillStyle = '#9fb0d0';
			ctx.fillRect(sx(bx), sy(d.y + DRONE.H), DRONE.W * SCALE, 0.08 * SCALE);
			ctx.fillStyle = Math.floor(now / 400 + d.phase) % 2 ? '#ff5d5d' : '#5dff9a';
			ctx.fillRect(sx(bx + 0.12), sy(d.y + 0.3), 0.14 * SCALE, 0.14 * SCALE);
			// The handlebar underneath, glowing when it's yours to grab.
			ctx.strokeStyle = d.mode === 'carry' ? '#d8f7ff' : CYAN;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(sx(d.x - 0.35), sy(d.y));
			ctx.lineTo(sx(d.x - 0.35), sy(d.y - 0.12));
			ctx.lineTo(sx(d.x + 0.35), sy(d.y - 0.12));
			ctx.lineTo(sx(d.x + 0.35), sy(d.y));
			ctx.stroke();
		}
		const target = mode === 'running' && !P.grounded && !P.grapple ? nearestGrapple() : null;
		for (const g of grapples) {
			if (!visible(g.x - 1, g.x + 1)) continue;
			const hot = g === target || g === P.grapple;
			ctx.strokeStyle = '#5c6684';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(sx(g.x), sy(g.y + 0.35));
			ctx.lineTo(sx(g.x), 0);
			ctx.stroke();
			ctx.shadowColor = CYAN;
			ctx.shadowBlur = hot ? 18 : 6;
			ctx.strokeStyle = hot ? '#d8f7ff' : CYAN;
			ctx.lineWidth = hot ? 4 : 3;
			ctx.beginPath();
			ctx.arc(sx(g.x), sy(g.y), 0.35 * SCALE, 0, Math.PI * 2);
			ctx.stroke();
			ctx.shadowBlur = 0;
			if (g === target) {
				ctx.setLineDash([4, 6]);
				ctx.strokeStyle = 'rgba(127, 227, 255, 0.5)';
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.moveTo(sx(P.x + W / 2), sy(P.y + H * 0.8));
				ctx.lineTo(sx(g.x), sy(g.y));
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}
	}

	/** Overlay text is scaled up when the canvas is shown small (phones), so it stays readable. */
	let uiScale = 1;
	function drawHints() {
		ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
		ctx.textAlign = 'center';
		for (const h of hints) {
			if (!showHint[h.key] || !visible(h.x - 6, h.x + 6)) continue;
			const tw = ctx.measureText(h.text).width + 18;
			ctx.save();
			ctx.translate(sx(h.x), sy(h.y));
			ctx.scale(uiScale, uiScale);
			ctx.fillStyle = 'rgba(8, 10, 28, 0.78)';
			ctx.fillRect(-tw / 2, -18, tw, 26);
			ctx.strokeStyle = 'rgba(255, 231, 163, 0.45)';
			ctx.lineWidth = 1;
			ctx.strokeRect(-tw / 2, -18, tw, 26);
			ctx.fillStyle = GOLD;
			ctx.fillText(h.text, 0, 0);
			ctx.restore();
		}
	}

	function drawRunner() {
		const fx = sx(P.x + W / 2);
		const fy = sy(P.y);
		const u = SCALE;
		ctx.save();
		ctx.translate(fx, fy);
		// Drawn facing right; mirrored when running left.
		ctx.scale(P.dir, 1);
		const wallSide = P.wall * P.dir;
		ctx.strokeStyle = '#f4f1ff';
		ctx.fillStyle = '#f4f1ff';
		ctx.lineWidth = 0.13 * u;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.shadowColor = 'rgba(180, 200, 255, 0.6)';
		ctx.shadowBlur = 8;
		const sliding = P.slope && P.vx > maxSpeedAt(time) + 0.5;
		const air = !P.grounded && !P.wallRun && !P.drone;
		const hanging = !!P.drone;
		const lean = sliding ? 0.15 : hanging ? 0.04 : Math.min(0.45, 0.12 + Math.abs(P.vx) * 0.018);
		const hipY = sliding ? -0.6 * u : -0.85 * u;
		const neck = { x: Math.sin(lean) * 0.5 * u, y: hipY - Math.cos(lean) * 0.5 * u };
		const ph = P.anim * 1.1;
		const limb = (ox: number, oy: number, a1: number, l1: number, a2: number, l2: number) => {
			const kx = ox + Math.sin(a1) * l1 * u;
			const ky = oy + Math.cos(a1) * l1 * u;
			ctx.beginPath();
			ctx.moveTo(ox, oy);
			ctx.lineTo(kx, ky);
			const hx = kx + Math.sin(a2) * l2 * u;
			const hy = ky + Math.cos(a2) * l2 * u;
			ctx.lineTo(hx, hy);
			ctx.stroke();
			return { x: hx, y: hy };
		};
		// Legs.
		if (hanging) {
			const sway = Math.sin(time * 4) * 0.12;
			limb(0, hipY, 0.25 + sway, 0.43, 0.05 + sway, 0.43);
			limb(0, hipY, -0.1 + sway, 0.43, -0.25 + sway, 0.43);
		} else if (sliding) {
			limb(0, hipY, 1.2, 0.45, 1.5, 0.45);
			limb(0, hipY, 0.5, 0.42, 0.2, 0.42);
		} else if (wallSide) {
			limb(0, hipY, 0.6 * wallSide, 0.42, -0.1 * wallSide, 0.42);
			limb(0, hipY, 0.2 * wallSide, 0.42, 0.3 * wallSide, 0.42);
		} else if (air) {
			limb(0, hipY, 0.9, 0.42, -0.4, 0.42);
			limb(0, hipY, -0.3, 0.42, 0.5, 0.42);
		} else {
			const a = Math.sin(ph) * 0.8;
			limb(0, hipY, a, 0.43, a - 0.7 - Math.max(0, Math.cos(ph)) * 0.6, 0.43);
			limb(0, hipY, -a, 0.43, -a - 0.7 - Math.max(0, -Math.cos(ph)) * 0.6, 0.43);
		}
		// Body and head.
		ctx.beginPath();
		ctx.moveTo(0, hipY);
		ctx.lineTo(neck.x, neck.y);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(neck.x + Math.sin(lean) * 0.2 * u, neck.y - 0.22 * u, 0.17 * u, 0, Math.PI * 2);
		ctx.fill();
		// Arms.
		if (hanging) {
			// Both hands up on the drone's handlebar.
			const barY = -(H + 0.02) * u;
			for (const hx of [-0.14, 0.14]) {
				ctx.beginPath();
				ctx.moveTo(neck.x, neck.y);
				ctx.lineTo(hx * u, barY);
				ctx.stroke();
			}
		} else if (P.grapple) {
			const gx = (sx(P.grapple.x) - fx) * P.dir;
			const gy = sy(P.grapple.y) - fy;
			ctx.save();
			ctx.shadowBlur = 0;
			ctx.strokeStyle = 'rgba(127, 227, 255, 0.85)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(neck.x, neck.y);
			ctx.lineTo(gx, gy);
			ctx.stroke();
			ctx.restore();
			const ang = Math.atan2(gx - neck.x, gy - neck.y);
			limb(neck.x, neck.y, ang, 0.35, ang, 0.35);
		} else if (P.wallRun) {
			// One hand pressed flat to the panel behind the shoulder, the other hanging at the side.
			const hand = limb(neck.x, neck.y, -2.1, 0.33, -1.75, 0.3);
			limb(neck.x, neck.y, 0.12, 0.33, 0.3, 0.3);
			ctx.save();
			ctx.shadowColor = CYAN;
			ctx.shadowBlur = 12;
			ctx.fillStyle = 'rgba(190, 240, 255, 0.95)';
			ctx.beginPath();
			ctx.arc(hand.x, hand.y, 0.09 * u, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		} else if (air) {
			limb(neck.x, neck.y, -2.4, 0.33, -2.9, 0.3);
			limb(neck.x, neck.y, 2.2, 0.33, 2.8, 0.3);
		} else {
			const a = Math.sin(ph) * 0.9;
			limb(neck.x, neck.y, -a + 0.2, 0.33, -a + 1.6, 0.3);
			limb(neck.x, neck.y, a + 0.2, 0.33, a + 1.6, 0.3);
		}
		ctx.restore();
	}

	/** Draws `fn` scaled by uiScale around the point (ax, ay). */
	function scaled(ax: number, ay: number, fn: () => void) {
		ctx.save();
		ctx.translate(ax, ay);
		ctx.scale(uiScale, uiScale);
		ctx.translate(-ax, -ay);
		fn();
		ctx.restore();
	}

	/** Splits text into lines no wider than `max` (in the current font). */
	function wrap(text: string, max: number): string[] {
		const lines: string[] = [];
		let line = '';
		for (const word of text.split(' ')) {
			const next = line ? `${line} ${word}` : word;
			if (line && ctx.measureText(next).width > max) {
				lines.push(line);
				line = word;
			} else line = next;
		}
		if (line) lines.push(line);
		return lines;
	}

	function drawHud() {
		const done = isSolved(ID);
		scaled(0, 0, () => {
			ctx.font = '600 17px ui-monospace, Consolas, monospace';
			ctx.textAlign = 'left';
			ctx.fillStyle = 'rgba(8, 10, 28, 0.6)';
			ctx.fillRect(10, 10, 300, 52);
			ctx.fillStyle = '#eef0ff';
			ctx.fillText(`${fmtTime(time)}  ${Math.max(0, Math.floor(P.maxX - 4))} m  ${Math.abs(P.vx).toFixed(1)} m/s`, 20, 33);
			// Progress toward the one-minute mark.
			ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
			ctx.fillRect(20, 44, 280, 6);
			ctx.fillStyle = done ? GOLD : CYAN;
			ctx.fillRect(20, 44, 280 * Math.min(1, time / GOAL), 6);
		});
		// On a small screen the best time sits under the main readout instead of in the corner.
		const corner = uiScale < 1.4;
		scaled(corner ? CW : 0, 0, () => {
			ctx.font = '600 17px ui-monospace, Consolas, monospace';
			ctx.textAlign = corner ? 'right' : 'left';
			ctx.fillStyle = 'rgba(8, 10, 28, 0.6)';
			if (corner) ctx.fillRect(CW - 190, 10, 180, 30);
			else ctx.fillRect(10, 66, 180, 30);
			ctx.fillStyle = done ? GOLD : '#eef0ff';
			ctx.fillText(`${done ? '✦ ' : ''}Best ${fmtTime(best)}`, corner ? CW - 20 : 20, corner ? 31 : 87);
		});
		// The segment underfoot (useful when judging seeds).
		const seg = segments.find((s) => P.x >= s.x0 && P.x < s.x1);
		if (seg && seg.seed !== 1) {
			ctx.font = '12px ui-monospace, Consolas, monospace';
			ctx.textAlign = 'left';
			ctx.fillStyle = 'rgba(238, 240, 255, 0.45)';
			ctx.fillText(`segment ${seg.seed.toString(16)} · ${seg.tier * 15}s band`, 12, CH - 12);
		}
		if (goalFlash > 0) {
			scaled(CW / 2, 130, () => {
				ctx.globalAlpha = Math.min(1, goalFlash);
				ctx.font = '600 26px Georgia, serif';
				ctx.textAlign = 'center';
				ctx.fillStyle = GOLD;
				ctx.fillText('One minute. Keep running.', CW / 2, 130);
				ctx.globalAlpha = 1;
			});
		}
	}

	function drawOverlay() {
		if (mode === 'running') return;
		ctx.fillStyle = 'rgba(4, 6, 18, 0.55)';
		ctx.fillRect(0, 0, CW, CH);
		const title = mode === 'ready' ? 'Rooftops' : deathCause;
		const body =
			mode === 'ready'
				? [
						'You run on your own and speed up as you go. Jump to stay on the roofs.',
						isSolved(ID) ? 'Press Space or tap to run.' : 'Last one minute. Press Space or tap to run.',
					]
				: [
						`${fmtTime(time)} · ${Math.max(0, Math.floor(P.maxX - 4))} m`,
						deadFor > 0.6 ? 'Press Space or tap to run again.' : '',
					];
		scaled(CW / 2, CH / 2, () => {
			ctx.textAlign = 'center';
			ctx.fillStyle = GOLD;
			ctx.font = 'italic 34px Georgia, serif';
			ctx.fillText(title, CW / 2, CH / 2 - 30);
			ctx.font = '17px ui-sans-serif, system-ui, sans-serif';
			ctx.fillStyle = '#eef0ff';
			const lines = body.flatMap((t) => (t ? wrap(t, (CW * 0.9) / uiScale) : []));
			lines.forEach((t, i) => ctx.fillText(t, CW / 2, CH / 2 + 8 + i * 26));
		});
	}

	function draw(now: number) {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		uiScale = Math.min(2.4, Math.max(1, 640 / (canvas.clientWidth || CW)));
		drawSky();
		drawParallax();
		drawTrains();
		drawFacades();
		drawProps(now);
		drawHints();
		drawRunner();
		if (P.vx > 14 && mode === 'running') {
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
			ctx.lineWidth = 1;
			for (let i = 0; i < 8; i++) {
				const y = hash(i, Math.floor(now / 90)) * CH;
				const x = hash(i, Math.floor(now / 90), 3) * CW;
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.lineTo(x - (P.vx - 12) * 12, y);
				ctx.stroke();
			}
		}
		drawHud();
		drawOverlay();
	}

	// ---- Input and loop ------------------------------------------------------------------------
	function press() {
		if (mode === 'ready') {
			mode = 'running';
		} else if (mode === 'dead') {
			if (deadFor > 0.6) {
				reset();
				mode = 'running';
			}
			return;
		}
		held = true;
		pressed = true;
	}
	function release() {
		held = false;
	}
	const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
	const onKeyDown = (e: KeyboardEvent) => {
		if (JUMP_KEYS.has(e.code)) {
			e.preventDefault();
			sound.wake();
			if (!e.repeat) press();
		} else if (e.code === 'KeyR') {
			reset();
		}
	};
	const onKeyUp = (e: KeyboardEvent) => {
		if (JUMP_KEYS.has(e.code)) release();
	};
	document.addEventListener('keydown', onKeyDown);
	document.addEventListener('keyup', onKeyUp);
	canvas.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		canvas.setPointerCapture(e.pointerId);
		sound.wake();
		press();
	});
	canvas.addEventListener('pointerup', release);
	canvas.addEventListener('pointercancel', release);

	let raf = 0;
	let last = performance.now();
	let acc = 0;
	const STEP = 1 / 120;
	function frame(now: number) {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		acc += dt;
		while (acc >= STEP) {
			step(STEP);
			acc -= STEP;
		}
		if (mode === 'dead') deadFor += dt;
		goalFlash = Math.max(0, goalFlash - dt * 0.6);
		// Wind rises with speed, swells during a boost (over the speed cap) and while falling fast.
		if (mode === 'running') {
			const speed = Math.abs(P.vx);
			// Riding a train isn't a boost you feel as wind, and near one the wind ducks so its clunks and
			// rumble come through.
			const over = P.train ? 0 : Math.max(0, speed - maxSpeedAt(time));
			const wind = Math.max(0, (speed - 11) / 20) + Math.min(0.6, over / 6) + Math.max(0, (-P.vy - 12) / 40);
			sound.setWind(wind * (1 - 0.75 * trainLevel));
			sound.setScrape(P.wallRun);
			sound.setRumble(trainLevel);
		} else {
			sound.setWind(0);
			sound.setScrape(false);
			sound.setRumble(0);
		}
		updateCamera(dt);
		draw(now);
		raf = requestAnimationFrame(frame);
	}

	win.onClose(() => {
		cancelAnimationFrame(raf);
		sound.close();
		document.removeEventListener('keydown', onKeyDown);
		document.removeEventListener('keyup', onKeyUp);
		if (mode === 'running' && time > best) setData('now-best', time);
		setData('now-hints', seenHints);
	});

	reset();
	raf = requestAnimationFrame(frame);

	// Test hooks for the dev console: jump straight to a time band, or inspect the run.
	if (import.meta.env.DEV) {
		(window as unknown as { __runner: unknown }).__runner = {
			P,
			get time() {
				return time;
			},
			set time(t: number) {
				time = t;
			},
			get mode() {
				return mode;
			},
			get segments() {
				return segments;
			},
			press,
			release,
			reset,
			/** Restart with these [seed, tier] segments right after the intro roof. */
			force(list: [number, number][]) {
				forced = [...list];
				reset();
			},
			set frozen(v: boolean) {
				frozen = v;
			},
			/** Draw one frame now (the loop pauses while the tab is hidden). */
			render() {
				for (let i = 0; i < 30; i++) updateCamera(1 / 30);
				draw(performance.now());
			},
			/** Step the simulation directly (works while the tab is hidden), calling `control` each step. */
			sim(seconds: number, control: (dt: number) => void) {
				for (let i = 0; i < seconds * 120; i++) {
					control(1 / 120);
					step(1 / 120);
					if (mode === 'dead') deadFor += 1 / 120;
				}
			},
			cam,
		};
	}
}
