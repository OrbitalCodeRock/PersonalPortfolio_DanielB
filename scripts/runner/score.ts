// Scoring a runner recipe: playtest it with the bot and judge it. Shared by the MAP-Elites search
// (search.ts) and the batch evaluator the Python model trains against (evaluate-batch.ts).
import { SEGMENT_LENGTH, buildRecipe, type FeatureName, type Recipe } from '../../src/secrets/runner/levelgen.ts';
import { evaluate, trial, type Mechanic } from '../../src/secrets/runner/playtest.ts';

/** Mechanics a feature exists to teach; if the perfect run never used it, the feature was skippable. */
export const NEEDS: Partial<Record<FeatureName, Mechanic | 'any'>> = {
	grapple: 'grapple',
	chain: 'grapple',
	wallrun: 'wallrun',
	drone: 'drone',
	dronestep: 'any',
	train: 'train',
	longtrain: 'train',
	chimney: 'walljump',
	switchback: 'walljump',
	updraft: 'vent',
	ramp: 'slope',
	slope: 'slope',
};

export interface Score {
	/** Usable at all: a sensible length, at most one train, and a perfect bot clears it across the band. */
	valid: boolean;
	/** Why it isn't valid, if it isn't. */
	reason?: 'length' | 'trains' | 'unclearable';
	/** Share of sloppy-bot runs that survive (0..1). */
	rate: number;
	used: Mechanic[];
	/** Share of mechanic-teaching features the perfect run actually needed. */
	usedRatio: number;
	/** Distinct feature types / feature count. */
	distinct: number;
	/** 1 at exactly 15 s of length, falling off either side. */
	lengthFit: number;
	length: number;
	/** The search's quality measure (0..1). */
	fitness: number;
	failures: Record<string, number>;
}

export function scoreRecipe(recipe: Recipe, trials = 8): Score {
	const seg = buildRecipe(recipe);
	const length = seg.x1 - seg.x0;
	const distinct = recipe.features.length ? new Set(recipe.features.map((f) => f.type)).size / recipe.features.length : 0;
	const lengthFit = 1 - Math.min(1, Math.abs(length / SEGMENT_LENGTH - 1));
	const base = { rate: 0, used: [] as Mechanic[], usedRatio: 0, distinct, lengthFit, length, fitness: 0, failures: {} };
	if (length < SEGMENT_LENGTH * 0.7 || length > SEGMENT_LENGTH * 1.6) return { ...base, valid: false, reason: 'length' };
	if (recipe.features.filter((f) => f.type === 'train' || f.type === 'longtrain').length > 1) {
		return { ...base, valid: false, reason: 'trains' };
	}
	const ev = evaluate(recipe, recipe.tier, { trials });
	if (!ev.clears) return { ...base, used: ev.used, failures: ev.failures as Record<string, number>, valid: false, reason: 'unclearable' };
	const used = new Set<string>(ev.used);
	const teaching = recipe.features.filter((f) => NEEDS[f.type]);
	const needed = teaching.filter((f) => NEEDS[f.type] === 'any' || used.has(NEEDS[f.type]!)).length;
	const usedRatio = teaching.length ? needed / teaching.length : 1;
	const fitness = 0.55 * usedRatio + 0.25 * distinct + 0.2 * lengthFit;
	return {
		valid: true,
		rate: ev.rate,
		used: ev.used,
		usedRatio,
		distinct,
		lengthFit,
		length,
		fitness,
		failures: ev.failures as Record<string, number>,
	};
}

/**
 * The strictest check, for recipes about to go into a pool: a perfect bot clears it entering at every
 * second of its band, both at normal speed and arriving 4 m/s fast (off a ramp in the segment before).
 */
export function strictClears(recipe: Recipe): boolean {
	for (let t = recipe.tier * 15; t <= recipe.tier * 15 + 15; t += 1) {
		for (const boost of [0, 4]) if (!trial(recipe, recipe.tier, { skill: 1, entryTime: t, boost }).survived) return false;
	}
	return true;
}
