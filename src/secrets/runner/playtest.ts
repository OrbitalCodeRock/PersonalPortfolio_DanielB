// Headless playtesting for the rooftop runner: runs the bot through one segment and reports what
// happened. Used by the Node tools in scripts/runner/ (evaluate, search). Nothing here touches the DOM.
//
// Each trial: the intro roof (to get up to speed), then the segment under test, then flat roof. The
// clock starts inside the segment's time band, so the speed cap matches what it was built for.
import { createBot } from './bot.ts';
import { type FeatureName, type Recipe } from './levelgen.ts';
import type { PoolEntry } from './seeds.ts';
import { createSim } from './sim.ts';

/** A segment that's just one flat roof, used after the segment under test. */
const FLAT: Recipe = { tier: 0, features: [], lead: 1, id: 'flat' };
const DT = 1 / 120;

export type Mechanic = 'grapple' | 'wallrun' | 'drone' | 'train' | 'walljump' | 'vent' | 'slope';

export interface TrialResult {
	survived: boolean;
	/** The feature it died on (or got stuck on). */
	failedOn?: FeatureName | 'lead';
	cause?: 'fell' | 'hazard' | 'stuck';
	/** Seconds spent in the segment. */
	seconds: number;
	used: Mechanic[];
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

/** One run of the bot through one segment. */
export function trial(
	entry: PoolEntry,
	tier: number,
	opts: { skill?: number; seed?: number; entryTime?: number; boost?: number } = {},
): TrialResult {
	let cause: TrialResult['cause'];
	const sim = createSim({
		pick: () => FLAT,
		goal: Infinity,
		onEvent: (e) => {
			if (e.type === 'die') cause = e.cause.includes('fell') ? 'fell' : 'hazard';
		},
	});
	sim.S.forced = [[entry, tier]];
	sim.reset();
	sim.S.time = opts.entryTime ?? tier * 15 + 2;
	sim.start();
	const seg = sim.S.segments[1];
	const P = sim.S.P;
	const bot = createBot(sim, { rnd: mulberry32(opts.seed ?? 1), skill: opts.skill ?? 1 });
	const used = new Set<Mechanic>();
	let enteredAt = -1;
	let bestX = P.x;
	let bestAt = 0;
	let lastDir = P.dir;
	for (let i = 0; i < 120 * 60; i++) {
		bot(DT);
		sim.step(DT);
		if (enteredAt < 0 && P.x >= seg.x0) {
			enteredAt = sim.S.time;
			// Arriving boosted (off a ramp or slope at the end of the previous segment).
			if (opts.boost) P.vx += opts.boost * P.dir;
		}
		if (P.grapple) used.add('grapple');
		if (P.wallRun) used.add('wallrun');
		if (P.drone) used.add('drone');
		if (P.train) used.add('train');
		if (P.launched) used.add('vent');
		if (P.slope) used.add('slope');
		if (P.dir !== lastDir && !P.grounded) used.add('walljump');
		lastDir = P.dir;
		if (sim.S.mode === 'dead') break;
		if (P.x > seg.x1 + 4 && P.grounded) {
			return { survived: true, seconds: sim.S.time - Math.max(0, enteredAt), used: [...used] };
		}
		if (P.maxX > bestX + 0.5) {
			bestX = P.maxX;
			bestAt = i;
		} else if (i - bestAt > 120 * 8) {
			cause = 'stuck';
			break;
		}
	}
	const where = seg.spans.find((s) => P.maxX >= s.x0 - 0.5 && P.maxX < s.x1 + 0.5) ?? seg.spans.find((s) => P.x < s.x1);
	return {
		survived: false,
		failedOn: where?.type ?? 'lead',
		cause: cause ?? 'stuck',
		seconds: sim.S.time - Math.max(0, enteredAt),
		used: [...used],
	};
}

export interface Evaluation {
	/** A perfect-timing bot gets through, entering at the start, middle and end of the time band. */
	clears: boolean;
	/** Share of runs a sloppier bot survives (0..1): the difficulty signal. */
	rate: number;
	/** Where the sloppy runs failed, by feature. */
	failures: Partial<Record<FeatureName | 'lead', number>>;
	/** Mechanics the perfect run actually used. */
	used: Mechanic[];
	/** Seconds the perfect run spent in the segment. */
	seconds: number;
}

/**
 * Perfect runs entering at the start, middle and end of the band, and one arriving boosted (the game can place a segment
 * anywhere in it, and the speed cap rises about 1 m/s across it), plus `trials` sloppy runs at `skill`.
 */
export function evaluate(entry: PoolEntry, tier: number, opts: { trials?: number; skill?: number } = {}): Evaluation {
	const trials = opts.trials ?? 8;
	const edges = [
		...[1, 14.5].map((t) => trial(entry, tier, { skill: 1, entryTime: tier * 15 + t })),
		// The segment before can end with a ramp or slope, so it must cope with arriving 4 m/s fast.
		trial(entry, tier, { skill: 1, entryTime: tier * 15 + 7, boost: 4 }),
	];
	const perfect = trial(entry, tier, { skill: 1, entryTime: tier * 15 + 7 });
	if (!perfect.survived || edges.some((r) => !r.survived)) {
		const failed = [perfect, ...edges].find((r) => !r.survived)!;
		return { clears: false, rate: 0, failures: { [failed.failedOn!]: 1 }, used: perfect.used, seconds: perfect.seconds };
	}
	const failures: Evaluation['failures'] = {};
	let ok = 0;
	for (let i = 0; i < trials; i++) {
		const r = trial(entry, tier, { skill: opts.skill ?? 0.55, seed: i + 1, entryTime: tier * 15 + 1 + (12 * i) / Math.max(1, trials - 1) });
		if (r.survived) ok++;
		else failures[r.failedOn!] = (failures[r.failedOn!] ?? 0) + 1;
	}
	return { clears: perfect.survived, rate: ok / trials, failures, used: perfect.used, seconds: perfect.seconds };
}
