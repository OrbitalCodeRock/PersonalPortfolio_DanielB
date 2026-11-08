// The rooftop runner's world and physics, with no drawing, sound or DOM: the game
// (src/secrets/puzzles/runner.ts) draws it and plays sounds from its events, and Node tools
// (scripts/runner/) run it headless to playtest segments with a bot.
//
// Imports use explicit .ts extensions so Node can load this file directly.
import {
	PHYS,
	START_SPEED,
	introSegment,
	maxSpeedAt,
	tierAt,
	type Box,
	type Drone,
	type Facade,
	type Grapple,
	type Hint,
	type Segment,
	type Slope,
	type Solid,
	type Train,
	DRONE,
	VENT_V,
} from './levelgen.ts';
import { entryKey, entrySegment, pickEntry, type PoolEntry } from './seeds.ts';
import type { Surface } from './sound.ts';

const { G, JUMP_V, JUMP_CUT, W, H } = PHYS;
const WALL_JUMP = { vx: 8.5, vy: 13 };
export const GRAPPLE_RANGE = 7.5;
/** The rope reels in at this rate (m/s) down to ROPE_MIN, which speeds up the swing. */
const REEL = 4;
const ROPE_MIN = 1.6;
const STEP_UP = 0.45;
/** How far below the lowest nearby roof the screen reaches; dropping past it ends the run. */
export const FLOOR_MARGIN = 4.5;
/** Metres of track between rail joints (one "ka-chunk" each). */
const RAIL_JOINT = 7;
/** How far ahead (m) counts as "nearby" when judging a fall; about 70% of the game's view width. */
const LOOK = 22.4;

export interface DroneState {
	home: Drone;
	/** Centre x and underside y, like Drone. */
	x: number;
	y: number;
	/** Hovering in place, carrying the runner down, or flying back to its spot. */
	mode: 'hover' | 'carry' | 'return';
	phase: number;
}

export interface TrainState {
	def: Train;
	/** Metres since the wheels last crossed a rail joint (for the clunk sound). */
	joint: number;
	nose: number;
	vx: number;
	done: boolean;
}

export type SimEvent =
	| { type: 'jump'; kind: 'jump' | 'kick' | 'vent' }
	| { type: 'land'; strength: number }
	| { type: 'footstep'; surface: Surface; loudness: number }
	| { type: 'clunk'; level: number }
	| { type: 'hint'; key: string }
	| { type: 'goal' }
	| { type: 'die'; cause: string };

export interface SimOptions {
	/** Called for things the game shows or plays (jumps, footsteps, dying…). */
	onEvent?: (e: SimEvent) => void;
	/** Chooses the next segment for a tier; defaults to the pools in seeds.ts. */
	pick?: (tier: number, recent: string[]) => PoolEntry;
	/** Seconds that count as "lasting" (fires a 'goal' event once). */
	goal?: number;
	/** The first stretch of the run; defaults to the long, safe intro roof. */
	intro?: () => Segment;
}

export const overlaps = (ax: number, ay: number, aw: number, ah: number, b: Box) =>
	ax < b.x + b.w && ax + aw > b.x && ay < b.y + b.h && ay + ah > b.y;

export type Sim = ReturnType<typeof createSim>;

export function createSim(opts: SimOptions = {}) {
	const emit = opts.onEvent ?? (() => {});
	const pick = opts.pick ?? pickEntry;
	const goal = opts.goal ?? 60;

	/** Everything that changes during a run. The game reads it to draw; tools read it to judge. */
	const S = {
		segments: [] as Segment[],
		solids: [] as Solid[],
		slopes: [] as Slope[],
		facades: [] as Facade[],
		hazards: [] as Box[],
		grapples: [] as Grapple[],
		wallRuns: [] as Box[],
		trainDefs: [] as Train[],
		hints: [] as Hint[],
		trains: [] as TrainState[],
		vents: [] as Box[],
		signs: [] as Box[],
		drones: [] as DroneState[],
		frontier: { x: 0, y: 0 },
		recent: [] as string[],
		mode: 'ready' as 'ready' | 'running' | 'dead',
		time: 0,
		deathCause: '',
		/** How loud the nearest train is (0..1), for its rumble. */
		trainLevel: 0,
		/** What the runner is standing on, for the footstep sound. */
		surface: 'roof' as Surface,
		lastStep: 0,
		held: false,
		pressed: false,
		frozen: false,
		/** Testing: [entry, tier] pairs to use for the next segments instead of the pools. */
		forced: [] as [PoolEntry, number][],
		passedHints: new Set<Hint>(),
		P: {
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
		},
	};
	const P = S.P;

	function addSegment(seg: Segment) {
		S.segments.push(seg);
		S.solids.push(...seg.solids);
		S.slopes.push(...seg.slopes);
		S.facades.push(...seg.facades);
		S.hazards.push(...seg.hazards);
		S.grapples.push(...seg.grapples);
		S.wallRuns.push(...seg.wallRuns);
		S.trainDefs.push(...seg.trains);
		S.hints.push(...seg.hints);
		S.vents.push(...seg.vents);
		S.signs.push(...seg.signs);
		S.drones.push(...seg.drones.map((d, i) => ({ home: d, x: d.x, y: d.y, mode: 'hover' as const, phase: i * 1.7 + d.x })));
		S.frontier = { x: seg.x1, y: seg.endY };
	}

	function prune(beforeX: number) {
		if (!S.segments.length || S.segments[0].x1 > beforeX) return;
		S.segments = S.segments.filter((s) => s.x1 > beforeX);
		const keep = <T extends { x: number; w?: number }>(list: T[]) => list.filter((o) => o.x + (o.w ?? 0) > beforeX);
		S.solids = keep(S.solids);
		S.facades = keep(S.facades);
		S.hazards = keep(S.hazards);
		S.grapples = keep(S.grapples);
		S.wallRuns = keep(S.wallRuns);
		S.hints = keep(S.hints);
		S.slopes = S.slopes.filter((s) => s.x1 > beforeX);
		S.trainDefs = S.trainDefs.filter((t) => t.x1 > beforeX);
		S.trains = S.trains.filter((t) => !t.done);
		S.vents = keep(S.vents);
		S.signs = keep(S.signs);
		S.drones = S.drones.filter((d) => d.home.x + DRONE.W > beforeX);
	}

	function ensureAhead() {
		while (S.frontier.x < P.x + 110) {
			const eta = S.time + Math.max(0, S.frontier.x - P.x) / Math.max(P.vx, START_SPEED);
			const f = S.forced.shift();
			const tier = f ? f[1] : tierAt(eta);
			const entry = f ? f[0] : pick(tier, S.recent);
			S.recent = [...S.recent.slice(-6), entryKey(entry)];
			addSegment(entrySegment(entry, tier, S.frontier.x, S.frontier.y));
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
		for (const g of S.grapples) {
			if ((g.x - cx) * P.dir < -1.5) continue;
			const d = Math.hypot(g.x - cx, g.y - cy);
			if (d < bestD) {
				bestD = d;
				bestG = g;
			}
		}
		return bestG;
	}

	function tryJump(local: Solid[]) {
		// Hanging from a drone, jump only matters S.held down (to dive); see step().
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
			emit({ type: 'jump', kind: 'jump' });
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
			emit({ type: 'jump', kind: 'kick' });
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
		if (S.mode !== 'running' || S.frozen) return;
		S.time += dt;
		const cap = maxSpeedAt(S.time);
		const local = near(S.solids, P.x - 6, P.x + 6);

		// Trains set off as the runner reaches the viaduct, and vanish into the far tunnel.
		for (const def of S.trainDefs) {
			if (P.x + W / 2 >= def.triggerX && !S.trains.some((t) => t.def === def)) {
				S.trains.push({ def, nose: def.startX, vx: Math.max(P.vx, START_SPEED) + def.boost, done: false, joint: 0 });
			}
		}
		S.trainLevel = 0;
		for (const t of S.trains) {
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
			S.trainLevel = Math.max(S.trainLevel, level);
			t.joint += t.vx * dt;
			if (t.joint > RAIL_JOINT) {
				t.joint -= RAIL_JOINT;
				emit({ type: 'clunk', level });
			}
		}
		// Drones hold their spot (the bob you see is drawn only, so where one is when you arrive never
		// depends on the moment), or fly back to it after carrying you down.
		for (const d of S.drones) {
			if (d.mode === 'hover') {
				d.x = d.home.x;
				d.y = d.home.y;
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
		if (S.pressed) {
			S.pressed = false;
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
			// You creep along the roof, not run: a long ride shouldn't carry you off the front.
			P.vx += (P.train.vx + P.dir * 0.4 - P.vx) * Math.min(1, dt * 8);
		} else if (P.grounded || P.wallRun) {
			// Speed along the running direction. Back up to speed quickly after a stop; the cap itself
			// rises slowly with S.time.
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
				// Sliding downhill (S.slopes fall to the right): a burst of speed over the cap that fades once
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
			S.held &&
			!P.grapple &&
			P.vy <= 2 &&
			S.wallRuns.some((z) => overlaps(P.x, P.y, W, H, z));
		if (P.drone) {
			// Gliding down with the drone; hold jump (S.pressed after you grabbed it) to dive.
			if (!S.held) P.diveArmed = true;
			P.vy = P.diveArmed && S.held ? -DRONE.DIVE : -DRONE.GLIDE;
		} else if (P.wallRun) P.vy = 0;
		else P.vy -= G * dt;
		if (P.vy <= 0) P.launched = false;
		if (!S.held && P.vy > JUMP_CUT && !P.grapple && !P.launched) P.vy = JUMP_CUT;
		// Air S.vents launch you when you run (or drop) onto them.
		if (!P.drone && P.vy <= 3) {
			for (const z of S.vents) {
				if (P.x < z.x + z.w && P.x + W > z.x && P.y >= z.y - 0.1 && P.y <= z.y + 1.2) {
					P.vy = VENT_V;
					emit({ type: 'jump', kind: 'vent' });
					P.launched = true;
					P.grounded = false;
					P.coyote = 0;
					P.slope = null;
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

		// Move along x, then y, resolving against S.solids.
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
				S.surface = s.kind === 'roof' || s.kind === 'ceiling' ? 'roof' : 'metal';
			} else if (P.vy > 0 && prevY + H <= s.y + 0.25) {
				// A hair below the underside, so you don't snag on its edge as you move away.
				P.y = s.y - H - 0.002;
				P.vy = 0;
				P.grapple = null;
			} else if (top - P.y < 0.5) {
				P.y = top;
				P.vy = 0;
				P.grounded = true;
				S.surface = s.kind === 'roof' || s.kind === 'ceiling' ? 'roof' : 'metal';
			}
		}
		const cx = P.x + W / 2;
		for (const s of S.slopes) {
			if (cx < s.x0 || cx > s.x1) continue;
			const sy = s.y0 + ((cx - s.x0) / (s.x1 - s.x0)) * (s.y1 - s.y0);
			const snap = wasSlope === s || wasGrounded ? 0.6 : 0.05;
			if (P.vy <= 0 && P.y <= sy + snap && prevY >= sy - 0.6) {
				P.y = sy;
				P.vy = 0;
				P.grounded = true;
				P.slope = s;
				S.surface = 'roof';
			}
		}
		for (const t of S.trains) {
			if (t.done) continue;
			const rear = Math.max(t.nose - t.def.len, t.def.x0);
			const front = Math.min(t.nose, t.def.endX);
			if (P.x + W <= rear || P.x >= front) continue;
			if (P.vy <= 0 && prevY >= t.def.top - 0.25 && P.y <= t.def.top) {
				P.y = t.def.top;
				P.vy = 0;
				P.grounded = true;
				P.train = t;
				S.surface = 'train';
				if (!wasGrounded) {
					// Landing on a train faces you the way it's going (even if a wall had turned you around),
					// so you get another go at jumping off.
					P.dir = Math.sign(t.vx) || 1;
					P.vx = t.vx + P.dir * 0.4;
				}
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
			for (const d of S.drones) {
				if (d.mode === 'carry') continue;
				const box = { x: d.x - DRONE.W / 2, y: d.y, w: DRONE.W, h: DRONE.H };
				if (!overlaps(P.x, P.y, W, H, box)) continue;
				const top = d.y + DRONE.H;
				if (P.vy <= 0 && prevY >= top - 0.35) {
					P.y = top;
					P.vy = 0;
					P.grounded = true;
					S.surface = 'metal';
				} else {
					P.drone = d;
					d.mode = 'carry';
					P.droneVx = P.dir * DRONE.SPEED;
					P.diveArmed = !S.held;
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
		if (!wasGrounded && P.grounded && fallV < -9) emit({ type: 'land', strength: (-fallV - 9) / 18 });
		// The run cycle follows your speed over what you're standing on: riding a train, your legs only
		// carry you along its roof, not at the train's speed.
		const legSpeed = P.train ? Math.abs(P.vx - P.train.vx) : Math.abs(P.vx);
		// A walk keeps a natural cadence (about 1.8 steps a second) with shorter steps, rather than
		// slowing the legs down to a crawl.
		// Riding a train you stand braced (see drawRunner), so the cycle holds still.
		const cadence = P.train ? 0 : P.grounded && legSpeed > 0.15 ? Math.max(legSpeed, 3.4) : legSpeed;
		P.anim += cadence * dt * (P.grounded || P.wallRun ? 1.5 : 0.4);
		// A footstep each S.time a foot comes down (the run cycle is drawn from P.anim; see drawRunner).
		const stepIndex = Math.floor((P.anim * 1.1) / Math.PI);
		if (stepIndex !== S.lastStep) {
			S.lastStep = stepIndex;
			if (P.grounded && Math.abs(P.vx) > 1) emit({ type: 'footstep', surface: S.surface, loudness: Math.min(1, 0.6 + Math.abs(P.vx) / 30) });
			else if (P.wallRun) emit({ type: 'footstep', surface: 'metal', loudness: 0.5 });
		}
		P.maxX = Math.max(P.maxX, P.x);

		// Dangers.
		for (const z of S.hazards) if (overlaps(P.x + 0.08, P.y, W - 0.16, H - 0.1, z)) die('A sparking vent got you.');
		for (const z of S.signs) if (overlaps(P.x + 0.08, P.y, W - 0.16, H - 0.1, z)) die('A railway sign got you.');
		if (P.y + H < floorAt() - FLOOR_MARGIN) die('You fell.');

		// Hints count as seen once you pass them.
		for (const hnt of S.hints) {
			if (!S.passedHints.has(hnt) && P.x > hnt.x) {
				S.passedHints.add(hnt);
				emit({ type: 'hint', key: hnt.key });
			}
		}
		if (S.time >= goal && S.time - dt < goal) emit({ type: 'goal' });

		ensureAhead();
		prune(Math.min(P.x, P.maxX - 20) - 50);
	}

	/** The lowest S.surface just around and ahead of the runner; dropping well below it is a fall. */
	function floorAt(): number {
		const x0 = P.x - (P.dir === 1 ? 2 : LOOK);
		const x1 = P.x + (P.dir === 1 ? LOOK : 2);
		let lo = Infinity;
		for (const s of S.solids) if (s.kind !== 'ceiling' && s.x < x1 && s.x + s.w > x0) lo = Math.min(lo, s.y + s.h);
		for (const t of S.trains) {
			if (t.done) continue;
			const rear = Math.max(t.nose - t.def.len, t.def.x0);
			const front = Math.min(t.nose, t.def.endX);
			if (front > rear && front > x0 && rear < x1) lo = Math.min(lo, t.def.top);
		}
		return lo === Infinity ? P.y : lo;
	}


	function die(cause: string) {
		if (S.mode !== 'running') return;
		S.mode = 'dead';
		S.deathCause = cause;
		emit({ type: 'die', cause });
	}

	/** Back to the start of a run, waiting for the first press. */
	function reset() {
		S.segments = [];
		S.solids = [];
		S.slopes = [];
		S.facades = [];
		S.hazards = [];
		S.grapples = [];
		S.wallRuns = [];
		S.trainDefs = [];
		S.hints = [];
		S.trains = [];
		S.vents = [];
		S.signs = [];
		S.drones = [];
		S.recent = [];
		S.passedHints.clear();
		addSegment((opts.intro ?? introSegment)());
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
		S.time = 0;
		S.mode = 'ready';
		S.held = false;
		S.pressed = false;
		ensureAhead();
	}

	return {
		S,
		reset,
		/** Starts the run (from 'ready'). */
		start() {
			if (S.mode === 'ready') S.mode = 'running';
		},
		/** Jump pressed (buffered briefly) and held. */
		press() {
			S.held = true;
			S.pressed = true;
		},
		release() {
			S.held = false;
		},
		step,
		floorAt,
		nearestGrapple,
		/** Testing: restart with these [entry, tier] segments right after the intro roof. */
		force(list: [PoolEntry, number][]) {
			S.forced = [...list];
			reset();
		},
	};
}
