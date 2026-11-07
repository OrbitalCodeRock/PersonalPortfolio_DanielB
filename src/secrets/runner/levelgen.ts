// Level generation for the Now page's rooftop runner (src/secrets/puzzles/runner.ts).
//
// The run is a chain of segments. Each segment is about 15 seconds long at the starting speed, and is
// built entirely from (seed, tier): the same pair always gives the same rooftops. The tier is the time
// band the segment is meant for (0 = first 15 s, 1 = 15–30 s, …), because the runner keeps speeding up
// and gaps that suit 15 s would be too short at 60 s. The seeds come from the pools in seeds.ts.
//
// World units are metres, y up. Buildings stand on a street far below the screen.

export const PHYS = {
	G: 40,
	JUMP_V: 15,
	/** Releasing jump early cuts upward speed to this. */
	JUMP_CUT: 4.5,
	W: 0.6,
	H: 1.6,
};

/** Speed at the start of a run, and how the cap rises with time. */
export const START_SPEED = 8;
export const maxSpeedAt = (t: number) => Math.min(22, 9 + 0.07 * t);
export const tierAt = (t: number) => Math.min(TIERS - 1, Math.floor(t / 15));
export const TIERS = 5;
/** 15 seconds at the starting speed. */
export const SEGMENT_LENGTH = START_SPEED * 15;
export const STREET = -80;

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}
export interface Solid extends Box {
	kind: 'roof' | 'ceiling' | 'slab' | 'ledge' | 'crate' | 'deck';
	/** Walls you can wall-slide on and jump off (only the climbing walls; anything else, you fall). */
	climb?: boolean;
}
export interface Slope {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** How far over the speed cap sliding down it can take you (m/s). */
	boost?: number;
}
export interface Facade {
	x: number;
	w: number;
	top: number;
	style: number;
	seed: number;
	/** A corridor through the building at roof level, drawn as an open, lit interior. */
	opening?: { y0: number; y1: number };
	/** A rail tunnel mouth on this side of the building, from y0 to y1. */
	tunnel?: { side: 'left' | 'right'; y0: number; y1: number };
}
export interface Grapple {
	x: number;
	y: number;
}
export interface Train {
	/** The runner's x that sets it moving, and where its nose starts (just inside the left tunnel). */
	triggerX: number;
	startX: number;
	len: number;
	top: number;
	/** Speed added to the runner's speed when it sets off. */
	boost: number;
	/** Tunnel mouth on the far side; the train disappears into it. */
	endX: number;
	/** Rail viaduct span, for drawing. */
	x0: number;
	x1: number;
}
/** A drone's hover spot: x is its centre, y the underside of its body. */
export interface Drone {
	x: number;
	y: number;
}
/** Launch speed of an air vent (a normal jump is PHYS.JUMP_V). */
export const VENT_V = 21;
/** Drone size, how fast it sinks gliding or diving, and the steady speed it flies you forward at. */
export const DRONE = { W: 1.8, H: 0.45, GLIDE: 1.6, DIVE: 9, SPEED: 9 };

export interface Hint {
	key: string;
	text: string;
	x: number;
	y: number;
}

export interface Segment {
	seed: number;
	tier: number;
	x0: number;
	x1: number;
	endY: number;
	solids: Solid[];
	slopes: Slope[];
	facades: Facade[];
	hazards: Box[];
	grapples: Grapple[];
	wallRuns: Box[];
	trains: Train[];
	/** Air vents that launch you upward. */
	vents: Box[];
	drones: Drone[];
	hints: Hint[];
	/** The features it was built from, in order (for testing and judging seeds). */
	features: string[];
}

function mulberry32(a: number) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Horizontal distance of a full jump that lands `dh` above where it started, at speed v. */
export function jumpReach(v: number, dh: number): number {
	const disc = PHYS.JUMP_V ** 2 - 2 * PHYS.G * dh;
	if (disc < 0) return 0;
	return (v * (PHYS.JUMP_V + Math.sqrt(disc))) / PHYS.G;
}

type FeatureName =
	| 'gap'
	| 'hazard'
	| 'slope'
	| 'opening'
	| 'ledges'
	| 'drop'
	| 'grapple'
	| 'wallrun'
	| 'chimney'
	| 'train'
	| 'ramp'
	| 'chain'
	| 'switchback'
	| 'updraft'
	| 'drone'
	| 'dronestep';

/** Minimum tier and base weight for each feature. */
const FEATURES: Record<FeatureName, [number, number]> = {
	gap: [0, 5],
	hazard: [1, 2],
	slope: [0, 2],
	opening: [0, 1.4],
	ledges: [0, 1.4],
	drop: [0, 1.1],
	grapple: [1, 1.6],
	wallrun: [1, 1.6],
	chimney: [2, 1.3],
	train: [2, 0.9],
	ramp: [1, 1.2],
	chain: [2, 1.1],
	switchback: [2, 1.1],
	updraft: [1, 1.3],
	drone: [1, 1.3],
	dronestep: [2, 1],
};

/** The speed a tier's gaps are sized for: the top speed halfway through its 15-second band. */
export const tierSpeed = (tier: number) => maxSpeedAt(tier * 15 + 7.5);

/**
 * Builds one segment starting at (x0, y0): x0 is where the previous segment's last roof ended and y0 its
 * height. The layout depends only on (seed, tier); x0 and y0 just place it, so a seed always means the
 * same stretch of rooftops.
 */
export function generateSegment(seed: number, tier: number, x0: number, y0: number): Segment {
	const seg = buildSegment(seed, tier);
	const dx = x0;
	const dy = y0;
	const move = <T extends { x: number; y: number }>(o: T) => ({ ...o, x: o.x + dx, y: o.y + dy });
	return {
		...seg,
		x0: seg.x0 + dx,
		x1: seg.x1 + dx,
		endY: seg.endY + dy,
		solids: seg.solids.map(move),
		slopes: seg.slopes.map((o) => ({ ...o, x0: o.x0 + dx, x1: o.x1 + dx, y0: o.y0 + dy, y1: o.y1 + dy })),
		facades: seg.facades.map((f) => ({
			...f,
			x: f.x + dx,
			top: f.top + dy,
			opening: f.opening && { y0: f.opening.y0 + dy, y1: f.opening.y1 + dy },
			tunnel: f.tunnel && { ...f.tunnel, y0: f.tunnel.y0 + dy, y1: f.tunnel.y1 + dy },
		})),
		hazards: seg.hazards.map(move),
		grapples: seg.grapples.map(move),
		wallRuns: seg.wallRuns.map(move),
		trains: seg.trains.map((t) => ({
			...t,
			triggerX: t.triggerX + dx,
			startX: t.startX + dx,
			endX: t.endX + dx,
			x0: t.x0 + dx,
			x1: t.x1 + dx,
			top: t.top + dy,
		})),
		vents: seg.vents.map(move),
		drones: seg.drones.map(move),
		hints: seg.hints.map(move),
	};
}

/** The segment's layout at x = 0, starting at height 0. */
function buildSegment(seed: number, tier: number): Segment {
	const x0 = 0;
	const y0 = 0;
	const speed = tierSpeed(tier);
	const rnd = mulberry32(seed * 7919 + tier * 104729);
	const range = (a: number, b: number) => a + (b - a) * rnd();
	const chance = (p: number) => rnd() < p;
	const seg: Segment = {
		seed,
		tier,
		x0,
		x1: x0,
		endY: y0,
		solids: [],
		slopes: [],
		facades: [],
		hazards: [],
		grapples: [],
		wallRuns: [],
		trains: [],
		vents: [],
		drones: [],
		hints: [],
		features: [],
	};
	const v = speed * 0.85;
	let x = x0;
	let h = y0;
	let trains = 0;

	const building = (bx: number, w: number, top: number, extra: Partial<Facade> = {}, climb = false) => {
		seg.solids.push({ x: bx, y: STREET, w, h: top - STREET, kind: 'roof', ...(climb ? { climb } : {}) });
		seg.facades.push({ x: bx, w, top, style: Math.floor(rnd() * 4), seed: Math.floor(rnd() * 1e9), ...extra });
	};
	const hint = (key: string, text: string, hx: number, hy: number) => seg.hints.push({ key, text, x: hx, y: hy });
	/** A low crate: going forward you vault it; running into its back face turns you around. */
	const crate = (cx: number, cy: number) => seg.solids.push({ x: cx, y: cy, w: 0.6, h: 0.9, kind: 'crate' });
	/** Largest gap worth generating for a landing dh above. */
	const maxGap = (dh: number) => Math.max(1.6, jumpReach(v, dh) - 0.9);
	const gapFor = (dh: number, lo = 1.4, scale = 1) => {
		const hi = maxGap(dh) * Math.min(0.9, 0.5 + 0.1 * tier) * scale;
		return range(Math.min(lo + tier * 0.35, hi * 0.8), hi);
	};
	const roofLen = (a = 5, b = 11) => Math.max(3.5, range(a, b) - tier * 0.5);

	const features: Record<FeatureName, () => void> = {
		gap() {
			// Lean upward when the roofline has drifted low (drops and slopes only go down).
			let dh = Math.max(-3, Math.min(1.9, range(-2.6, 1.9) - h * 0.12));
			if (h + dh > 14) dh = -Math.abs(dh);
			const g = gapFor(dh);
			x += g;
			h += dh;
			const L = roofLen();
			building(x, L, h);
			x += L;
		},
		hazard() {
			// Long enough that hopping the vent doesn't carry you off the end at this speed.
			const L = Math.max(range(11, 15), v * 1.5);
			building(x, L, h);
			const two = tier >= 3 && chance(0.45);
			const hw = range(0.8, 1.2);
			const hh = range(0.55, 0.85);
			const hx = x + L * 0.42;
			seg.hazards.push({ x: hx, y: h, w: hw, h: hh });
			// A pair is close enough to clear in one jump.
			if (two) seg.hazards.push({ x: hx + hw + range(1.2, 1.8), y: h, w: hw, h: hh });
			hint('hazard', 'Jump the sparking vents', hx + hw / 2, h + 2.4);
			x += L;
		},
		slope() {
			const d = range(2, 3.4 + tier * 0.5);
			const w = d * range(1.4, 2);
			const L2 = range(6, 10);
			building(x, w + L2, h - d);
			seg.slopes.push({ x0: x, y0: h, x1: x + w, y1: h - d });
			hint('slope', 'Slopes give you a burst of speed', x + w / 2, h + 1.6);
			x += w + L2;
			h -= d;
		},
		opening() {
			// From the second band, sometimes a short gap first: hop it low or bump the wall above the door.
			if (tier >= 1 && chance(0.5)) x += range(1.4, Math.min(3.2, maxGap(0) * 0.6));
			const W = range(9, 15);
			// Headroom for a short hop, not a full jump.
			const ceil = h + 3.4;
			const top = ceil + range(4, 9);
			building(x, W, h, { top, opening: { y0: h, y1: ceil } });
			seg.solids.push({ x, y: ceil, w: W, h: top - ceil, kind: 'ceiling' });
			if (tier >= 2 && chance(0.35)) seg.hazards.push({ x: x + W * 0.55, y: h, w: 0.8, h: 0.42 });
			x += W;
			// Open roof after the corridor, so the next jump isn't capped by the ceiling.
			const exit = range(3, 5);
			building(x, exit, h);
			x += exit;
		},
		ledges() {
			const n = tier === 0 ? 1 : chance(0.5) ? 2 : 1;
			for (let i = 0; i < n; i++) {
				const dh = range(-1.2, 0.8);
				x += gapFor(dh, 1.4, 0.75);
				h += dh;
				// Wide enough to land and jump again at this speed (about a fifth of a second underfoot).
				const w = Math.max(speed * 0.2, range(1.3, 2.1) - tier * 0.12);
				seg.solids.push({ x, y: h - 0.3, w, h: 0.3, kind: 'ledge' });
				x += w;
			}
			const dh = range(-1.5, 0.6);
			x += gapFor(dh, 1.4, 0.8);
			h += dh;
			const L = roofLen();
			building(x, L, h);
			x += L;
		},
		drop() {
			const d = range(5, 9);
			const g = range(1.5, Math.max(2, maxGap(-d) * 0.55));
			x += g;
			h -= d;
			// Long enough to land on even if you hit the edge fast and just run off it.
			const fall = speed * 1.15 * Math.sqrt((2 * d) / PHYS.G);
			const L = Math.max(roofLen(7, 12), fall - g + 4);
			building(x, L, h);
			x += L;
		},
		grapple() {
			const dh = range(-1.5, 0.4);
			const g = range(9, 12.5 + tier);
			seg.grapples.push({ x: x + g * range(0.42, 0.55), y: h + range(4.2, 5.4) });
			hint('grapple', 'In the air, press jump near a hook', x + g * 0.48, h + 7);
			x += g;
			h += dh;
			const L = roofLen(6, 10);
			building(x, L, h);
			x += L;
		},
		wallrun() {
			const g = range(10, 13.5 + tier * 1.5);
			const dh = range(-1, 0.4);
			seg.wallRuns.push({ x: x + 0.5, y: h + 0.5, w: g - 1, h: 5 });
			hint('wallrun', 'Hold jump to run along the panel', x + g / 2, h + 5.2);
			x += g;
			h += dh;
			// Dropping off the end of the panel carries you a way; leave room to land.
			const L = Math.max(roofLen(6, 10), v * 0.8);
			building(x, L, h);
			x += L;
		},
		chimney() {
			const L1 = range(7.5, 10);
			building(x, L1, h);
			// Kick off the wall too high and you sail back over the slab; the crate turns you around.
			crate(x + 1.8, h);
			x += L1;
			const top = h + range(5, 6.8 + tier * 0.3);
			const slabW = 0.5;
			const slabX = x - 2.7 - slabW;
			const slabY = h + 2.3;
			// The slab reaches above the wall's top, so a high kick off the wall hits it instead of sailing over.
			seg.solids.push({ x: slabX, y: slabY, w: slabW, h: top + 1.6 - slabY, kind: 'slab', climb: true });
			hint('chimney', 'Jump off the walls to climb', x - 1.4, top + 1.6);
			// A long roof on top, to get back up to speed after the climb.
			const LB = Math.max(10, roofLen(10, 13));
			building(x, LB, top, {}, true);
			x += LB;
			h = top;
		},
		train() {
			trains++;
			const G = range(30, 36);
			const top = h - 1.4;
			const far = top + range(1.6, 2.2);
			const tunnel = { y0: top - 3, y1: top + 0.35 };
			const left = seg.facades.at(-1);
			if (left) left.tunnel = { side: 'right', ...tunnel };
			seg.trains.push({
				// Sets off a little before you reach the edge, its nose starting just inside the entrance
				// tunnel, so it rolls out into view rather than popping in.
				triggerX: x - 4,
				startX: x - 0.5,
				len: 24,
				top,
				boost: 3 + tier * 0.4,
				endX: x + G,
				x0: x,
				x1: x + G,
			});
			hint('train', 'Ride the train; jump off before the tunnel', x + G * 0.55, far + 2.4);
			x += G;
			h = far;
			// Long enough to shed the train's extra speed before whatever comes next.
			const L = Math.max(roofLen(8, 12), (speed + 4 + tier * 0.4) * 0.9);
			building(x, L, h, { tunnel: { side: 'left', ...tunnel } });
			x += L;
		},
		ramp() {
			// A long slanted roof that ends at a gap too wide to clear without the speed it gives you.
			const d = range(4.5, 7);
			const w = d * range(2, 2.6);
			const boost = 6;
			building(x, w, h - d);
			seg.slopes.push({ x0: x, y0: h, x1: x + w, y1: h - d, boost });
			hint('ramp', 'Big slanted roofs launch you over long gaps', x + w * 0.4, h + 1.8);
			x += w;
			h -= d;
			const dh = range(-2, 0.4);
			const fast = (speed + boost) * 0.85;
			const hi = jumpReach(fast, dh) * 0.78;
			x += range(Math.min(hi * 0.9, Math.max(6, maxGap(dh) * 1.1)), hi);
			h += dh;
			const L = roofLen(8, 12);
			building(x, L, h);
			x += L;
		},
		chain() {
			// Two or three hooks across one wide gap: swing from one to the next.
			const n = tier >= 3 && chance(0.4) ? 3 : 2;
			const spacing = range(7, 8.5);
			const first = range(4.5, 5.5);
			const hy = h + range(4.2, 5.2);
			for (let i = 0; i < n; i++) seg.grapples.push({ x: x + first + i * spacing, y: hy + range(-0.5, 0.5) });
			hint('chain', 'Swing from hook to hook', x + first + spacing / 2, hy + 2.4);
			const dh = range(-1.5, 0.3);
			x += first + (n - 1) * spacing + range(5, 6.5);
			h += dh;
			const L = roofLen(7, 11);
			building(x, L, h);
			x += L;
		},
		switchback() {
			// A scaffold climbed in a zigzag. Each wall jump turns you around:
			//   run right to the tall wall, kick off it onto the lower deck (now running left),
			//   run the deck to the hanging wall at its far end and kick off that onto the upper deck
			//   (running right again), then jump up the tall wall and pull yourself onto its roof.
			// Small ones are tight; medium and large ones have long decks to run between the walls, with a
			// vent to hop (medium) or a gap to jump in each deck (large). Fall through a gap and you land on
			// the level below to try again.
			const roll = rnd();
			const size = roll < (tier >= 3 ? 0.3 : 0.5) ? 'small' : tier >= 3 && roll > 0.65 ? 'large' : 'medium';
			const D = size === 'small' ? range(7, 9) : size === 'medium' ? range(11, 15) : range(16, 22);
			const spacing = size === 'large' ? 4.2 : 3.7;
			const entry = range(4.5, 6);
			building(x, entry + D, h);
			crate(x + 2.6, h);
			const xR = x + entry + D;
			const xL = xR - D;
			const deck1 = h + 3.2;
			const deck2 = deck1 + spacing;
			const top = deck2 + 3;
			/** A deck from x0 to x1 with its top at y, split by a jumpable gap if asked. */
			const deck = (x0: number, x1: number, y: number, gap: boolean) => {
				if (!gap) {
					seg.solids.push({ x: x0, y: y - 0.5, w: x1 - x0, h: 0.5, kind: 'deck' });
					return;
				}
				const g = range(2, 2.8);
				const at = range(x0 + 4, x1 - 4 - g);
				seg.solids.push({ x: x0, y: y - 0.5, w: at - x0, h: 0.5, kind: 'deck' });
				seg.solids.push({ x: at + g, y: y - 0.5, w: x1 - at - g, h: 0.5, kind: 'deck' });
			};
			deck(xL, xR - 2.4, deck1, size === 'large');
			deck(xL + 2.4, xR, deck2, size === 'large');
			if (size === 'medium' && chance(0.6)) {
				seg.hazards.push({ x: xL + 2.4 + (D - 2.4) * range(0.4, 0.6), y: deck2, w: 0.9, h: 0.7 });
			}
			seg.solids.push({ x: xL - 0.6, y: deck1 - 0.5, w: 0.6, h: deck2 + 2.6 - (deck1 - 0.5), kind: 'slab', climb: true });
			hint('switchback', 'Wall jumps turn you around', xR - Math.min(D, 9) / 2, top + 1.4);
			const LR = Math.max(10, roofLen(10, 13));
			building(xR, LR, top, {}, true);
			x = xR + LR;
			h = top;
		},
		updraft() {
			// An air vent near the end of a roof launches you onto a much taller building, sometimes across
			// a short gap. Jump before it and you sail over it.
			const L = Math.max(range(8, 12), v * 0.9);
			building(x, L, h);
			const ventX = x + L - range(1.6, 2.4);
			seg.vents.push({ x: ventX, y: h, w: 1.2, h: 0.25 });
			hint('updraft', 'Run over the air vent to get launched', ventX + 0.6, h + 3);
			x += L;
			const dh = range(3, 4.5);
			if (chance(0.6)) {
				// Flight time up to that height on the way down, at this speed, less a margin.
				const t = (VENT_V + Math.sqrt(VENT_V ** 2 - 2 * PHYS.G * dh)) / PHYS.G;
				x += range(1.5, Math.max(2, v * t - (x - ventX) - 1.5));
			}
			h += dh;
			const L2 = roofLen(8, 12);
			building(x, L2, h);
			x += L2;
		},
		drone() {
			// A drone hovers just past the edge of a wide gap. Jump up into it to grab it and glide across;
			// the far roof is lower. Hold jump to drop faster.
			const g = range(12, 17 + tier);
			const dx = range(2.5, 4);
			const dy = range(2.6, 3.1);
			seg.drones.push({ x: x + dx, y: h + dy });
			hint('drone', 'Jump into a drone to hang on. Hold jump to drop faster', x + dx, h + dy + 2.2);
			// Hanging, your feet are about 2 m under the drone; it flies you forward at DRONE.SPEED and sinks
			// DRONE.GLIDE m/s.
			// The far roof sits a little under that path, and is long enough that just gliding touches down
			// on it; diving lands you sooner.
			const glideDrop = (DRONE.GLIDE * (g - dx)) / DRONE.SPEED;
			const under = range(0.3, 1.2);
			const dh = -(glideDrop - dy + 2.1 + under);
			x += g;
			h += dh;
			const L = Math.max(roofLen(10, 14), ((under + 0.6) / DRONE.GLIDE) * DRONE.SPEED + 3);
			building(x, L, h);
			x += L;
		},
		dronestep() {
			// A drone hovering mid-gap as a stepping stone: land on top and jump again. Grab it from below by
			// mistake and you'll likely glide short.
			const dh1 = range(-0.6, 0.6);
			const g1 = gapFor(dh1 + DRONE.H, 2.4, 0.8);
			seg.drones.push({ x: x + g1 + DRONE.W / 2, y: h + dh1 });
			hint('dronestep', 'Land on top of the drone and jump again', x + g1, h + dh1 + 2.6);
			x += g1 + DRONE.W;
			const dh2 = range(-1.2, 0.6);
			// Wide enough overall that one long jump can't clear it all, so you need the drone; each half
			// still clears from a standing jump.
			const solo = jumpReach(speed * 1.15, dh2) + 1;
			const hop = maxGap(dh2 - dh1 - DRONE.H) * 0.95;
			x += Math.min(hop, Math.max(gapFor(dh2 - dh1 - DRONE.H, 2, 0.8), solo - g1 - DRONE.W));
			h += dh2;
			const L = roofLen(7, 11);
			building(x, L, h);
			x += L;
		},
	};

	// Every segment opens with a short roof joined to the previous segment's last one.
	const L0 = range(3, 5);
	building(x, L0, h);
	x += L0;

	let first = true;
	while (x - x0 < SEGMENT_LENGTH) {
		const weights = (Object.keys(FEATURES) as FeatureName[]).map((name) => {
			const [minTier, w] = FEATURES[name];
			if (tier < minTier) return 0;
			let weight = w;
			if (name === 'train' && trains > 0) return 0;
			// Keep heights in a sensible band, and sometimes open with a big climb or drop so the camera
			// starts the segment low or high on the screen.
			if (h < -6 && (name === 'drop' || name === 'slope')) weight *= 0.1;
			if (h < -6 && name === 'chimney') weight *= 3;
			if (h > 12 && (name === 'drop' || name === 'slope')) weight *= 3;
			if (h > 12 && (name === 'chimney' || name === 'switchback')) weight = 0;
			if (h < -6 && (name === 'ramp')) weight *= 0.2;
			if (first && (name === 'chimney' || name === 'drop')) weight *= 2;
			return weight;
		});
		const total = weights.reduce((a, b) => a + b, 0);
		let pick = rnd() * total;
		let i = 0;
		while (pick > weights[i]) pick -= weights[i++];
		const name = (Object.keys(FEATURES) as FeatureName[])[i];
		seg.features.push(name);
		features[name]();
		first = false;
	}

	seg.x1 = x;
	seg.endY = h;
	return seg;
}

/** The first stretch of every run: one long, safe roof. */
export function introSegment(): Segment {
	const seg = generateSegment(1, 0, 0, 0);
	const len = 26;
	return {
		...seg,
		x1: len,
		endY: 0,
		solids: [{ x: -20, y: STREET, w: len + 20, h: -STREET, kind: 'roof' }],
		slopes: [],
		facades: [{ x: -20, w: len + 20, top: 0, style: 1, seed: 42 }],
		hazards: [],
		grapples: [],
		wallRuns: [],
		trains: [],
		vents: [],
		drones: [],
		features: [],
		hints: [{ key: 'jump', text: 'Space, ↑ or tap to jump. Hold it to jump higher.', x: 10, y: 3.4 }],
	};
}
