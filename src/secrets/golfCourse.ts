// The Global Minimum course (Web Development → "optimization"; drawn and played in puzzles/golf.ts).
// Each hole is a height field on a 4 × 3 map: Gaussian basins (negative) and hills (positive), seeded
// ripples and a raised rim. Gravity pulls the ball downhill; the hole sits in the global minimum. Later
// holes add water (roll in and the ball goes back where it was hit from, plus a stroke) and basins that
// move: breathing deeper and shallower, or drifting along a path. This file has no DOM, so the course
// can be checked headless.

export const W = 4;
export const H = 3;

/** [x, y, amplitude, sigma], plus optional motion over time t (seconds into the hole). */
export interface Bump {
	x: number;
	y: number;
	a: number;
	s: number;
	/** Depth multiplier over time, e.g. breathing between 0.2 and 1. */
	breathe?: { period: number; min: number; phase?: number };
	/** Drifts back and forth between (x, y) and (x + dx, y + dy). */
	drift?: { dx: number; dy: number; period: number; phase?: number };
}

export interface Pond {
	x: number;
	y: number;
	r: number;
}

export interface Hole {
	name: string;
	hint: string;
	bumps: Bump[];
	ponds: Pond[];
	start: { x: number; y: number };
	hole: { x: number; y: number };
	/** Radius of the ball's lantern. */
	light: number;
	seed: number;
}

const b = (x: number, y: number, a: number, s: number, extra: Partial<Bump> = {}): Bump => ({ x, y, a, s, ...extra });

export const HOLES: Hole[] = [
	{
		name: 'Global Minimum',
		hint: 'Somewhere in the fog is the lowest point on the map.',
		bumps: [
			b(3.35, 2.45, -1.15, 0.26), // the hole: the global minimum
			b(0.95, 2.25, -0.75, 0.24), // decoy basins
			b(2.15, 0.75, -0.7, 0.22),
			b(3.45, 0.6, -0.65, 0.2),
			b(1.75, 1.75, -0.6, 0.18),
			b(2.55, 2.55, -0.5, 0.18),
			b(2.5, 1.65, 0.9, 0.38), // hills and ridges
			b(1.25, 1.05, 0.7, 0.3),
			b(3.0, 1.45, 0.55, 0.25),
			b(0.35, 1.6, 0.45, 0.3),
			b(2.95, 2.95, 0.4, 0.3),
			b(1.6, 2.8, 0.4, 0.28),
		],
		ponds: [],
		start: { x: 0.52, y: 0.69 },
		hole: { x: 3.35, y: 2.44 },
		light: 0.6,
		seed: 1729,
	},
	{
		name: 'The Ponds',
		hint: 'Water lies in some of the low ground. Roll in and you play again from where you hit, a stroke down.',
		bumps: [
			b(3.4, 0.62, -1.15, 0.26), // the hole
			// Shallow dips, each holding a pond, either side of the straight line. Keep them shallow and off
			// the tee's exits: deep hollows funnel every missed shot into the water.
			b(1.35, 1.25, -0.2, 0.2),
			b(2.3, 2.35, -0.2, 0.2),
			b(2.95, 1.4, -0.2, 0.18),
			b(2.0, 1.65, 0.7, 0.32), // a hill across the middle, so the straight line isn't the easy line
			b(0.4, 1.3, 0.4, 0.3),
			b(1.0, 0.5, 0.35, 0.25),
			b(3.0, 2.5, 0.4, 0.3),
			b(2.6, 0.3, 0.3, 0.2),
		],
		ponds: [
			{ x: 1.35, y: 1.25, r: 0.16 },
			{ x: 2.3, y: 2.35, r: 0.16 },
			{ x: 2.95, y: 1.4, r: 0.15 },
		],
		start: { x: 0.5, y: 2.55 },
		hole: { x: 3.4, y: 0.62 },
		light: 0.58,
		seed: 2024,
	},
	{
		name: 'Breathing Room',
		hint: 'The ground here moves. Watch a basin fill and empty before you trust it.',
		bumps: [
			b(3.3, 2.4, -1.15, 0.25), // the hole
			b(2.0, 1.5, -0.95, 0.3, { breathe: { period: 7, min: 0.05 } }), // a basin that breathes
			b(0.9, 2.3, -0.6, 0.22),
			b(3.2, 0.7, -0.65, 0.22),
			b(1.25, 0.9, 0.55, 0.3),
			b(2.75, 1.0, 0.6, 0.3),
			b(2.6, 2.6, 0.5, 0.24),
			b(1.6, 2.5, 0.45, 0.25),
		],
		ponds: [],
		start: { x: 0.5, y: 0.6 },
		hole: { x: 3.3, y: 2.4 },
		light: 0.55,
		seed: 77,
	},
	{
		name: 'Drift',
		hint: 'A hollow wanders across the middle of this hole, dragging anything nearby with it.',
		bumps: [
			b(3.4, 1.5, -1.15, 0.24), // the hole
			b(1.4, 0.7, -0.9, 0.26, { drift: { dx: 0, dy: 1.6, period: 9 } }), // the wandering hollow
			b(2.55, 0.45, -0.55, 0.2),
			b(2.55, 2.55, -0.55, 0.2),
			b(2.6, 1.5, 0.6, 0.22),
			b(2.3, 0.9, 0.45, 0.22),
			b(2.3, 2.1, 0.45, 0.22),
			b(0.7, 1.5, 0.35, 0.3),
		],
		ponds: [{ x: 2.55, y: 2.55, r: 0.15 }],
		start: { x: 0.45, y: 1.5 },
		hole: { x: 3.4, y: 1.5 },
		light: 0.55,
		seed: 9001,
	},
	{
		name: 'Everything at Once',
		hint: 'Water, a breathing basin and a wandering hollow. The lowest point is still down there.',
		bumps: [
			b(3.45, 2.55, -1.15, 0.24), // the hole
			b(1.7, 1.2, -0.85, 0.28, { breathe: { period: 6, min: 0.1, phase: 1.5 } }),
			b(2.6, 0.6, -0.8, 0.24, { drift: { dx: 0, dy: 1.3, period: 10 } }),
			b(0.9, 2.3, -0.6, 0.2),
			b(3.4, 0.5, -0.6, 0.2),
			b(2.3, 2.2, -0.55, 0.2),
			b(1.1, 0.6, 0.5, 0.26),
			b(2.15, 1.75, 0.55, 0.26),
			b(3.05, 1.6, 0.5, 0.25),
			b(1.5, 2.7, 0.4, 0.25),
		],
		ponds: [
			{ x: 0.9, y: 2.3, r: 0.16 },
			{ x: 2.3, y: 2.2, r: 0.15 },
			{ x: 3.4, y: 0.5, r: 0.15 },
		],
		start: { x: 0.45, y: 0.5 },
		hole: { x: 3.45, y: 2.55 },
		light: 0.52,
		seed: 314,
	},
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

const ripplesFor = new Map<number, { a: number; fx: number; fy: number; p: number }[]>();
function ripples(seed: number) {
	let r = ripplesFor.get(seed);
	if (!r) {
		const rng = mulberry32(seed);
		r = Array.from({ length: 5 }, () => ({ a: 0.02 + rng() * 0.025, fx: (rng() * 2 - 1) * 4, fy: (rng() * 2 - 1) * 4, p: rng() * Math.PI * 2 }));
		ripplesFor.set(seed, r);
	}
	return r;
}

/** Whether a hole's terrain changes with time. */
export const moves = (h: Hole) => h.bumps.some((bp) => bp.breathe || bp.drift);

/** A bump's centre and amplitude at time t. */
export function bumpAt(bp: Bump, t: number): [number, number, number] {
	let { x, y, a } = bp;
	if (bp.breathe) {
		const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / bp.breathe.period + (bp.breathe.phase ?? 0));
		a *= bp.breathe.min + (1 - bp.breathe.min) * k;
	}
	if (bp.drift) {
		const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / bp.drift.period + (bp.drift.phase ?? 0));
		x += bp.drift.dx * k;
		y += bp.drift.dy * k;
	}
	return [x, y, a];
}

export function height(h: Hole, x: number, y: number, t: number): number {
	let v = 0;
	for (const bp of h.bumps) {
		const [bx, by, a] = bumpAt(bp, t);
		const dx = x - bx;
		const dy = y - by;
		v += a * Math.exp(-(dx * dx + dy * dy) / (2 * bp.s * bp.s));
	}
	for (const r of ripples(h.seed)) v += r.a * Math.sin(r.fx * x + r.fy * y + r.p);
	const e = 0.16;
	v += 0.55 * (Math.exp(-x / e) + Math.exp(-(W - x) / e) + Math.exp(-y / e) + Math.exp(-(H - y) / e));
	return v;
}

export function gradient(h: Hole, x: number, y: number, t: number): [number, number] {
	const d = 1e-3;
	return [(height(h, x + d, y, t) - height(h, x - d, y, t)) / (2 * d), (height(h, x, y + d, t) - height(h, x, y - d, t)) / (2 * d)];
}

export const inPond = (h: Hole, x: number, y: number) => h.ponds.some((p) => Math.hypot(x - p.x, y - p.y) < p.r);

// Physics.
export const GRAV = 6;
const DRAG = 1.1;
const ROLL = 0.35;
const STATIC = 0.35;
export const VMAX = 4.2;
export const BALL_R = 0.035;
export const HOLE_R = 0.055;
const CAPTURE_SPEED = 1.0;

export interface Ball {
	x: number;
	y: number;
	vx: number;
	vy: number;
	rest: boolean;
}

/**
 * Advances the ball by dt at hole time t. Returns what happened: 'sunk' (stopped over the hole slowly
 * enough), 'water', 'rest', or null while it's still rolling. On a moving hole a resting ball can be
 * set rolling again by the ground moving under it.
 */
export function stepBall(h: Hole, ball: Ball, t: number, dt: number): 'sunk' | 'water' | 'rest' | null {
	if (ball.rest) {
		if (!moves(h)) return null;
		const [gx, gy] = gradient(h, ball.x, ball.y, t);
		if (GRAV * Math.hypot(gx, gy) < STATIC) return null;
		ball.rest = false;
	}
	const sub = Math.max(1, Math.ceil(dt * 240));
	const step = dt / sub;
	for (let n = 0; n < sub; n++) {
		const [gx, gy] = gradient(h, ball.x, ball.y, t + n * step);
		ball.vx -= GRAV * gx * step;
		ball.vy -= GRAV * gy * step;
		let speed = Math.hypot(ball.vx, ball.vy);
		const dec = ROLL * step;
		if (speed > dec) {
			const k = ((speed - dec) / speed) * Math.exp(-DRAG * step);
			ball.vx *= k;
			ball.vy *= k;
		} else {
			ball.vx = 0;
			ball.vy = 0;
		}
		ball.x += ball.vx * step;
		ball.y += ball.vy * step;
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
		if (Math.hypot(ball.x - h.hole.x, ball.y - h.hole.y) < HOLE_R && speed < CAPTURE_SPEED) {
			ball.vx = ball.vy = 0;
			return 'sunk';
		}
		if (inPond(h, ball.x, ball.y)) {
			ball.vx = ball.vy = 0;
			return 'water';
		}
		if (speed < 0.03 && GRAV * Math.hypot(gx, gy) < STATIC) {
			ball.vx = ball.vy = 0;
			ball.rest = true;
			return 'rest';
		}
	}
	return null;
}
