// Level generation for the Now page's rooftop runner (src/secrets/puzzles/runner.ts).
//
// The run is a chain of segments, each about 15 seconds long at the starting speed. A segment is
// described by a Recipe: its tier (the time band it's meant for: 0 = first 15 s, 1 = 15–30 s, …, since
// the runner keeps speeding up and gaps that suit 15 s would be too short at 60 s) and a list of
// features, each with named parameters between 0 and 1. The builder turns a parameter into metres within
// the range that's physically sensible for that tier (using the jump physics below), so any recipe makes
// rooftops a runner can in principle clear. Recipes can be written by hand, by a search, or by a model.
//
// A seed is one way to get a recipe: sampleRecipe(seed, tier) picks features and parameters at random,
// deterministically. Pools of seeds and recipes live in seeds.ts.
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
/**
 * When each time band (tier) starts, in seconds: 15-second bands through the first minute, then a band per
 * minute, each meant to be harder than the last. The last band runs on for as long as the run lasts.
 */
export const BAND_STARTS = [0, 15, 30, 45, 60, 120, 180, 240, 300, 360];
export const TIERS = BAND_STARTS.length;
export const bandStart = (tier: number) => BAND_STARTS[Math.min(tier, TIERS - 1)];
/** A band's length in seconds; the open-ended last band counts as a minute. */
export const bandLength = (tier: number) => (tier < TIERS - 1 ? BAND_STARTS[tier + 1] - BAND_STARTS[tier] : 60);
export const tierAt = (t: number) => {
	let tier = 0;
	while (tier < TIERS - 1 && t >= BAND_STARTS[tier + 1]) tier++;
	return tier;
};
/** "0–15 s", "1–2 min", "6 min and on". */
export function bandName(tier: number): string {
	const a = bandStart(tier);
	if (tier >= TIERS - 1) return a >= 60 ? `${a / 60} min and on` : `${a} s and on`;
	const b = a + bandLength(tier);
	return b <= 60 ? `${a}–${b} s` : `${a / 60}–${b / 60} min`;
}
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
	/** Shown in the corner of the game: the seed in hex, or the recipe's id. */
	label: string;
	tier: number;
	/** The recipe it was built from (the intro segment has none). */
	recipe?: Recipe;
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
	/** Railway signs beside the track at body height: hit one riding a train and the run ends. */
	signs: Box[];
	drones: Drone[];
	hints: Hint[];
	/** The features it was built from, in order (for testing and judging seeds). */
	features: string[];
	/** Where each feature starts and ends along x (for telling which one a runner died on). */
	spans: { type: FeatureName; x0: number; x1: number }[];
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

export type FeatureName =
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
	| 'dronestep'
	| 'longtrain';

/** Minimum tier and base weight for each feature (used when sampling from a seed). */
export const FEATURES: Record<FeatureName, [number, number]> = {
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
	longtrain: [3, 0.7],
};

export const FEATURE_NAMES = Object.keys(FEATURES) as FeatureName[];

/** One feature of a segment, with its parameters (each 0..1; missing ones read as 0.5). */
export interface FeatureSpec {
	type: FeatureName;
	p: Record<string, number>;
}
export interface Recipe {
	tier: number;
	features: FeatureSpec[];
	/** Length of the short roof every segment opens with (0..1). */
	lead?: number;
	/** A name for it, shown in the game and used to log feedback. */
	id?: string;
}

/** The speed a tier's gaps are sized for: the top speed 7.5 s into its band. Later in a long band runs are faster; the strict check (scripts/runner/score.ts) makes sure pooled segments still clear. */
export const tierSpeed = (tier: number) => maxSpeedAt(bandStart(tier) + 7.5);

/**
 * The segment for (seed, tier), placed at (x0, y0): x0 is where the previous segment's last roof ended
 * and y0 its height. The layout depends only on (seed, tier); x0 and y0 just place it.
 */
export function generateSegment(seed: number, tier: number, x0: number, y0: number): Segment {
	return placeSegment(sample(seed, tier).seg, x0, y0);
}

/** The segment a recipe describes, placed at (x0, y0). */
export function recipeSegment(recipe: Recipe, x0: number, y0: number): Segment {
	return placeSegment(buildRecipe(recipe), x0, y0);
}

/** A random recipe for this tier, the same every time for the same seed. */
export function sampleRecipe(seed: number, tier: number): Recipe {
	return sample(seed, tier).recipe;
}

/** Builds a recipe at x = 0, height 0. Parameters it doesn't give read as 0.5. */
export function buildRecipe(recipe: Recipe): Segment {
	const features = recipe.features.map((f) => ({ type: f.type, p: { ...f.p } }));
	let i = 0;
	const { seg } = construct(recipe.tier, () => features[i++] ?? null, null, recipe.lead);
	seg.recipe = recipe;
	seg.label = recipe.id ?? 'recipe';
	return seg;
}

function sample(seed: number, tier: number): { seg: Segment; recipe: Recipe } {
	const rnd = mulberry32(seed * 7919 + tier * 104729);
	const { seg, recipe } = construct(
		tier,
		(st) => {
			if (st.length >= SEGMENT_LENGTH) return null;
			const weights = FEATURE_NAMES.map((name) => {
				const [minTier, w] = FEATURES[name];
				if (tier < minTier) return 0;
				let weight = w;
				if ((name === 'train' || name === 'longtrain') && st.trains > 0) return 0;
				// Keep heights in a sensible band, and sometimes open with a big climb or drop so the camera
				// starts the segment low or high on the screen.
				if (st.h < -6 && (name === 'drop' || name === 'slope')) weight *= 0.1;
				if (st.h < -6 && name === 'chimney') weight *= 3;
				if (st.h > 12 && (name === 'drop' || name === 'slope')) weight *= 3;
				if (st.h > 12 && (name === 'chimney' || name === 'switchback')) weight = 0;
				if (st.h < -6 && name === 'ramp') weight *= 0.2;
				if (st.first && (name === 'chimney' || name === 'drop')) weight *= 2;
				return weight;
			});
			const total = weights.reduce((a, b) => a + b, 0);
			let pick = rnd() * total;
			let i = 0;
			while (pick > weights[i]) pick -= weights[i++];
			return { type: FEATURE_NAMES[i], p: {} };
		},
		rnd,
	);
	seg.label = seed.toString(16);
	seg.recipe = recipe;
	return { seg, recipe };
}

/** Moves a segment built at the origin to (x0, y0). */
export function placeSegment(seg: Segment, x0: number, y0: number): Segment {
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
		signs: seg.signs.map(move),
		drones: seg.drones.map(move),
		hints: seg.hints.map(move),
		spans: seg.spans.map((o) => ({ ...o, x0: o.x0 + dx, x1: o.x1 + dx })),
	};
}

/** Where the builder is, for a chooser deciding the next feature. */
interface BuildState {
	length: number;
	h: number;
	first: boolean;
	trains: number;
}

const hashInt = (n: number) => {
	let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
};

/**
 * Builds a segment at the origin, asking `next` for each feature in turn until it returns null. Each
 * feature reads its parameters by name; a missing one is drawn from `fill` (and recorded) when sampling,
 * or reads as 0.5 when replaying a recipe.
 */
function construct(
	tier: number,
	next: (st: BuildState) => FeatureSpec | null,
	fill: (() => number) | null,
	lead?: number,
): { seg: Segment; recipe: Recipe } {
	const x0 = 0;
	const y0 = 0;
	const speed = tierSpeed(tier);
	// How much the layout tightens with the band: one step per band through the first minute, then
	// 0.4 per minute-long band, so the late bands get harder without becoming impossible to build.
	const lvl = Math.min(tier, 4) + Math.max(0, tier - 4) * 0.4;
	let spec: FeatureSpec = { type: 'gap', p: {} };
	/** The current feature's parameter `name`, 0..1. */
	const u = (name: string) => {
		let val = spec.p[name];
		if (val === undefined) {
			val = fill ? fill() : 0.5;
			spec.p[name] = val;
		}
		return Math.max(0, Math.min(1, val));
	};
	const range = (name: string, a: number, b: number) => a + (b - a) * u(name);
	const chance = (name: string, prob: number) => u(name) < prob;
	const seg: Segment = {
		label: '',
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
		signs: [],
		drones: [],
		hints: [],
		features: [],
		spans: [],
	};
	const v = speed * 0.85;
	let x = x0;
	let h = y0;
	let trains = 0;

	// Colours and window patterns come from position, so the parameters alone define the segment.
	const building = (bx: number, w: number, top: number, extra: Partial<Facade> = {}, climb = false) => {
		seg.solids.push({ x: bx, y: STREET, w, h: top - STREET, kind: 'roof', ...(climb ? { climb } : {}) });
		const look = hashInt(Math.round(bx * 10) * 31 + Math.round(top * 10) + tier * 7);
		seg.facades.push({ x: bx, w, top, style: look % 4, seed: look % 1000000007, ...extra });
	};
	const hint = (key: string, text: string, hx: number, hy: number) => seg.hints.push({ key, text, x: hx, y: hy });
	/** A low crate: going forward you vault it; running into its back face turns you around. */
	const crate = (cx: number, cy: number) => seg.solids.push({ x: cx, y: cy, w: 0.6, h: 0.9, kind: 'crate' });
	/** Largest gap worth generating for a landing dh above. */
	const maxGap = (dh: number) => Math.max(1.6, jumpReach(v, dh) - 0.9);
	const gapFor = (name: string, dh: number, lo = 1.4, scale = 1) => {
		const hi = maxGap(dh) * Math.min(0.9, 0.5 + 0.1 * tier) * scale;
		return range(name, Math.min(lo + lvl * 0.35, hi * 0.8), hi);
	};
	const roofLen = (a = 5, b = 11, name = 'roof') => Math.max(3.5, range(name, a, b) - lvl * 0.5);

	/**
	 * A train across a viaduct between two tunnels. A long one is a ride of 55–80 m on a longer train,
	 * with railway signs beside the track at body height to jump as it carries you past them.
	 */
	const rideTrain = (long: boolean) => {
		trains++;
		const G = long ? range('len', 55, 80) : range('len', 30, 36);
		const top = h - 1.4;
		const far = top + range('far', 1.6, 2.2);
		const tunnel = { y0: top - 3, y1: top + 0.35 };
		const left = seg.facades.at(-1);
		if (left) left.tunnel = { side: 'right', ...tunnel };
		seg.trains.push({
			// Sets off a little before you reach the edge, its nose starting just inside the entrance
			// tunnel, so it rolls out into view rather than popping in. A long train sets off earlier, so
			// you board well behind its nose.
			triggerX: x - (long ? 12 : 4),
			startX: x - 0.5,
			len: long ? 40 : 24,
			top,
			boost: 3 + lvl * 0.4,
			endX: x + G,
			x0: x,
			x1: x + G,
		});
		if (long) {
			// Signs from 15 m in (once you've settled) to 14 m before the far wall (time to jump off),
			// 18–26 m apart.
			let sx = x + 15 + range('first', 0, 6);
			for (let i = 0; sx < x + G - 14; i++) {
				seg.signs.push({ x: sx, y: top + 0.25, w: 0.5, h: 1.2 });
				sx += range(`gap${i}`, 18, 26);
			}
			hint('longtrain', 'Jump the railway signs', x + 15, top + 3.6);
		} else hint('train', 'Ride the train; jump off before the tunnel', x + G * 0.55, far + 2.4);
		x += G;
		h = far;
		// Long enough to shed the train's extra speed before whatever comes next.
		const L = Math.max(roofLen(8, 12), (speed + 4 + lvl * 0.4) * 0.9);
		building(x, L, h, { tunnel: { side: 'left', ...tunnel } });
		x += L;
	};

	const features: Record<FeatureName, () => void> = {
		gap() {
			// Lean upward when the roofline has drifted low (drops and slopes only go down).
			let dh = Math.max(-3, Math.min(1.9, range('dh', -2.6, 1.9) - h * 0.12));
			if (h + dh > 14) dh = -Math.abs(dh);
			const g = gapFor('width', dh);
			x += g;
			h += dh;
			const L = roofLen();
			building(x, L, h);
			x += L;
		},
		hazard() {
			// Long enough that hopping the vent doesn't carry you off the end at this speed.
			const L = Math.max(range('len', 11, 15), v * 1.5);
			building(x, L, h);
			const two = tier >= 3 && chance('pair', 0.45);
			const hw = range('w', 0.8, 1.2);
			const hh = range('h', 0.55, 0.85);
			const hx = x + L * 0.42;
			seg.hazards.push({ x: hx, y: h, w: hw, h: hh });
			// A pair is close enough to clear in one jump.
			if (two) seg.hazards.push({ x: hx + hw + range('spacing', 1.2, 1.8), y: h, w: hw, h: hh });
			hint('hazard', 'Jump the sparking vents', hx + hw / 2, h + 2.4);
			x += L;
		},
		slope() {
			const d = range('drop', 2, 3.4 + lvl * 0.5);
			const w = d * range('steep', 1.4, 2);
			const L2 = range('roof', 6, 10);
			building(x, w + L2, h - d);
			seg.slopes.push({ x0: x, y0: h, x1: x + w, y1: h - d });
			hint('slope', 'Slopes give you a burst of speed', x + w / 2, h + 1.6);
			x += w + L2;
			h -= d;
		},
		opening() {
			// From the second band, sometimes a short gap first: hop it low or bump the wall above the door.
			if (tier >= 1 && chance('hasGap', 0.5)) x += range('gap', 1.4, Math.min(3.2, maxGap(0) * 0.6));
			const W = range('len', 9, 15);
			// Headroom for a short hop, not a full jump.
			const ceil = h + 3.4;
			const top = ceil + range('height', 4, 9);
			building(x, W, h, { top, opening: { y0: h, y1: ceil } });
			seg.solids.push({ x, y: ceil, w: W, h: top - ceil, kind: 'ceiling' });
			if (tier >= 2 && chance('inner', 0.35)) seg.hazards.push({ x: x + W * 0.55, y: h, w: 0.8, h: 0.42 });
			x += W;
			// Open roof after the corridor, so the next jump isn't capped by the ceiling.
			const exit = range('exit', 3, 5);
			building(x, exit, h);
			x += exit;
		},
		ledges() {
			const n = tier === 0 ? 1 : chance('two', 0.5) ? 2 : 1;
			for (let i = 0; i < n; i++) {
				const dh = range(`dh${i}`, -1.2, 0.8);
				x += gapFor(`gap${i}`, dh, 1.4, 0.75);
				h += dh;
				// Wide enough to land and jump again at this speed (about a fifth of a second underfoot).
				const w = Math.max(speed * 0.2, range(`w${i}`, 1.3, 2.1) - lvl * 0.12);
				seg.solids.push({ x, y: h - 0.3, w, h: 0.3, kind: 'ledge' });
				x += w;
			}
			const dh = range('dh', -1.5, 0.6);
			x += gapFor('gap', dh, 1.4, 0.8);
			h += dh;
			const L = roofLen();
			building(x, L, h);
			x += L;
		},
		drop() {
			const d = range('drop', 5, 9);
			const g = range('gap', 1.5, Math.max(2, maxGap(-d) * 0.55));
			x += g;
			h -= d;
			// Long enough to land on even if you hit the edge fast and just run off it.
			const fall = speed * 1.15 * Math.sqrt((2 * d) / PHYS.G);
			const L = Math.max(roofLen(7, 12), fall - g + 4);
			building(x, L, h);
			x += L;
		},
		grapple() {
			const dh = range('dh', -1.5, 0.4);
			const g = range('width', 9, 12.5 + lvl);
			seg.grapples.push({ x: x + g * range('hookAt', 0.42, 0.55), y: h + range('hookH', 4.2, 5.4) });
			hint('grapple', 'In the air, press jump near a hook', x + g * 0.48, h + 7);
			x += g;
			h += dh;
			// The swing throws you forward at full speed; leave room to come down.
			const L = Math.max(roofLen(6, 10), speed * 0.9);
			building(x, L, h);
			x += L;
		},
		wallrun() {
			const g = range('width', 10, 13.5 + lvl * 1.5);
			const dh = range('dh', -1, 0.4);
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
			const L1 = range('low', 7.5, 10);
			building(x, L1, h);
			// Kick off the wall too high and you sail back over the slab; the crate turns you around.
			crate(x + 1.8, h);
			x += L1;
			const top = h + range('rise', 5, 6.8 + lvl * 0.3);
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
			rideTrain(false);
		},
		longtrain() {
			rideTrain(true);
		},
		ramp() {
			// A long slanted roof that ends at a gap too wide to clear without the speed it gives you.
			const d = range('drop', 4.5, 7);
			const w = d * range('steep', 2, 2.6);
			const boost = 6;
			building(x, w, h - d);
			seg.slopes.push({ x0: x, y0: h, x1: x + w, y1: h - d, boost });
			hint('ramp', 'Big slanted roofs launch you over long gaps', x + w * 0.4, h + 1.8);
			x += w;
			h -= d;
			const dh = range('dh', -2, 0.4);
			const fast = (speed + boost) * 0.85;
			const hi = jumpReach(fast, dh) * 0.78;
			x += range('gap', Math.min(hi * 0.9, Math.max(6, maxGap(dh) * 1.1)), hi);
			h += dh;
			// Room to shed some of the ramp's speed before whatever comes next.
			const L = Math.max(roofLen(8, 12), (speed + boost) * 0.9);
			building(x, L, h);
			x += L;
		},
		chain() {
			// Two or three hooks across one wide gap: swing from one to the next.
			const n = tier >= 3 && chance('three', 0.4) ? 3 : 2;
			const spacing = range('spacing', 7, 8.5);
			const first = range('first', 4.5, 5.5);
			const hy = h + range('hookH', 4.2, 5.2);
			for (let i = 0; i < n; i++) seg.grapples.push({ x: x + first + i * spacing, y: hy + range(`j${i}`, -0.5, 0.5) });
			hint('chain', 'Swing from hook to hook', x + first + spacing / 2, hy + 2.4);
			const dh = range('dh', -1.5, 0.3);
			x += first + (n - 1) * spacing + range('tail', 5, 6.5);
			h += dh;
			const L = Math.max(roofLen(7, 11), speed * 0.9);
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
			const roll = u('size');
			const size = roll < (tier >= 3 ? 0.3 : 0.5) ? 'small' : tier >= 3 && roll > 0.65 ? 'large' : 'medium';
			const D = size === 'small' ? range('width', 7, 9) : size === 'medium' ? range('width', 11, 15) : range('width', 16, 22);
			const spacing = size === 'large' ? 4.2 : 3.7;
			const entry = range('entry', 4.5, 6);
			building(x, entry + D, h);
			crate(x + 2.6, h);
			const xR = x + entry + D;
			const xL = xR - D;
			const deck1 = h + 3.2;
			const deck2 = deck1 + spacing;
			const top = deck2 + 3;
			/** A deck from x0 to x1 with its top at y, split by a jumpable gap if asked. */
			const deck = (name: string, x0: number, x1: number, y: number, gap: boolean) => {
				if (!gap) {
					seg.solids.push({ x: x0, y: y - 0.5, w: x1 - x0, h: 0.5, kind: 'deck' });
					return;
				}
				const g = range(`${name}Gap`, 2, 2.8);
				const at = range(`${name}At`, x0 + 4, x1 - 4 - g);
				seg.solids.push({ x: x0, y: y - 0.5, w: at - x0, h: 0.5, kind: 'deck' });
				seg.solids.push({ x: at + g, y: y - 0.5, w: x1 - at - g, h: 0.5, kind: 'deck' });
			};
			deck('low', xL, xR - 2.4, deck1, size === 'large');
			deck('high', xL + 2.4, xR, deck2, size === 'large');
			if (size === 'medium' && chance('vent', 0.6)) {
				seg.hazards.push({ x: xL + 2.4 + (D - 2.4) * range('ventAt', 0.4, 0.6), y: deck2, w: 0.9, h: 0.7 });
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
			const L = Math.max(range('len', 8, 12), v * 0.9);
			building(x, L, h);
			const ventX = x + L - range('ventAt', 1.6, 2.4);
			seg.vents.push({ x: ventX, y: h, w: 1.2, h: 0.25 });
			hint('updraft', 'Run over the air vent to get launched', ventX + 0.6, h + 3);
			x += L;
			const dh = range('rise', 3, 4.5);
			if (chance('hasGap', 0.6)) {
				// Flight time up to that height on the way down, at this speed, less a margin.
				const t = (VENT_V + Math.sqrt(VENT_V ** 2 - 2 * PHYS.G * dh)) / PHYS.G;
				x += range('gap', 1.5, Math.max(2, v * t - (x - ventX) - 1.5));
			}
			h += dh;
			const L2 = roofLen(8, 12);
			building(x, L2, h);
			x += L2;
		},
		drone() {
			// A drone hovers just past the edge of a wide gap. Jump up into it to grab it and glide across;
			// the far roof is lower. Hold jump to drop faster.
			const g = range('width', 12, 17 + lvl);
			const dx = range('dx', 2.5, 4);
			const dy = range('dy', 2.6, 3.1);
			seg.drones.push({ x: x + dx, y: h + dy });
			hint('drone', 'Jump into a drone to hang on. Hold jump to drop faster', x + dx, h + dy + 2.2);
			// Hanging, your feet are about 2 m under the drone; it flies you forward at DRONE.SPEED and sinks
			// DRONE.GLIDE m/s. The far roof sits a little under that path, and is long enough that just
			// gliding touches down on it; diving lands you sooner.
			const glideDrop = (DRONE.GLIDE * (g - dx)) / DRONE.SPEED;
			const under = range('under', 0.3, 1.2);
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
			const dh1 = range('dh1', -0.6, 0.6);
			const g1 = gapFor('gap1', dh1 + DRONE.H, 2.4, 0.8);
			seg.drones.push({ x: x + g1 + DRONE.W / 2, y: h + dh1 });
			hint('dronestep', 'Land on top of the drone and jump again', x + g1, h + dh1 + 2.6);
			x += g1 + DRONE.W;
			const dh2 = range('dh2', -1.2, 0.6);
			// Wide enough overall that one long jump can't clear it all, so you need the drone; each half
			// still clears from a standing jump.
			const solo = jumpReach(speed * 1.15, dh2) + 1;
			// Sized for a jump from where you land on it, not its far edge (the jump buffer fires on landing).
			const hop = maxGap(dh2 - dh1 - DRONE.H) * 0.95 - DRONE.W;
			x += Math.min(hop, Math.max(gapFor('gap2', dh2 - dh1 - DRONE.H, 2, 0.8), solo - g1 - DRONE.W));
			h += dh2;
			const L = roofLen(7, 11);
			building(x, L, h);
			x += L;
		},
	};

	// Every segment opens with a short roof joined to the previous segment's last one.
	const leadU = lead ?? (fill ? fill() : 0.5);
	const L0 = 3 + 2 * Math.max(0, Math.min(1, leadU));
	building(x, L0, h);
	x += L0;

	const specs: FeatureSpec[] = [];
	let first = true;
	for (;;) {
		const nextSpec = next({ length: x - x0, h, first, trains });
		if (!nextSpec) break;
		spec = nextSpec;
		specs.push(spec);
		seg.features.push(spec.type);
		const from = x;
		features[spec.type]();
		seg.spans.push({ type: spec.type, x0: from, x1: x });
		first = false;
	}

	seg.x1 = x;
	seg.endY = h;
	return { seg, recipe: { tier, lead: leadU, features: specs } };
}

/** The first stretch of every run: one long, safe roof. */
export function introSegment(): Segment {
	const len = 26;
	return {
		label: '',
		tier: 0,
		x0: 0,
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
		signs: [],
		drones: [],
		features: [],
		spans: [],
		hints: [{ key: 'jump', text: 'Space, ↑ or tap to jump. Hold it to jump higher.', x: 10, y: 3.4 }],
	};
}
