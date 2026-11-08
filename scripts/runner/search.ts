// Quality-diversity search (MAP-Elites) for runner segments. For each tier it mutates recipes, playtests
// each with the bot (src/secrets/runner/playtest.ts), and keeps the best recipe found in each cell of a
// grid: difficulty (how often a sloppy bot survives) × variety (how many different feature types it
// has), keeping the best few per cell. Then it fills each tier's pool from the difficulty range that suits it and writes
// src/secrets/runner/pools.json, which the game loads.
//
//   npm run runner:search                      all tiers, default budget
//   npm run runner:search -- --evals 4000      more evaluations per tier
//   npm run runner:search -- --tiers 2,3       only some tiers (others keep their current pool)
import {
	FEATURES,
	FEATURE_NAMES,
	SEGMENT_LENGTH,
	TIERS,
	buildRecipe,
	sampleRecipe,
	type FeatureName,
	type FeatureSpec,
	type Recipe,
} from '../../src/secrets/runner/levelgen.ts';
import { loadRecipePools, saveRecipePools } from './pools.ts';
import { scoreRecipe, type Score } from './score.ts';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const EVALS = Number(flag('evals', '1500'));
const POOL_SIZE = Number(flag('pool', '10'));
const ONLY = flag('tiers', '')
	.split(',')
	.filter(Boolean)
	.map(Number);
const SEED = Number(flag('seed', '7'));

/** Survival rate (sloppy bot) each tier's pool should come from: forgiving early, harder later. */
const TARGET: [number, number][] = [
	[0.75, 1.01],
	[0.6, 1.01],
	[0.45, 0.95],
	[0.3, 0.85],
	// 1–2 min, then a band per minute, each harder than the last; the last runs on from 6 min.
	[0.3, 0.8],
	[0.25, 0.65],
	[0.2, 0.55],
	[0.15, 0.45],
	[0.1, 0.35],
	[0.05, 0.3],
];
const DIFF_BINS = 5;
const VAR_BINS = 5;
/** Elites kept per cell. */
const PER_CELL = 4;

function mulberry32(a: number) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rnd = mulberry32(SEED);
const randInt = (n: number) => Math.floor(rnd() * n);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const allowed = (tier: number) => FEATURE_NAMES.filter((n) => FEATURES[n][1] > 0 && FEATURES[n][0] <= tier);

/** A feature of a random allowed type, its parameters filled in by building it once. */
function randomFeature(tier: number): FeatureSpec {
	const types = allowed(tier);
	const type = types[randInt(types.length)];
	// Borrow a full parameter set from a sampled recipe that has this type, else start empty (0.5s).
	for (let tries = 0; tries < 20; tries++) {
		const r = sampleRecipe(1 + randInt(1e6), tier);
		const f = r.features.find((x) => x.type === type);
		if (f) return { type, p: { ...f.p } };
	}
	return { type, p: {} };
}

function mutate(parent: Recipe): Recipe {
	const child: Recipe = { tier: parent.tier, lead: parent.lead, features: parent.features.map((f) => ({ type: f.type, p: { ...f.p } })) };
	const ops = 1 + randInt(2);
	for (let k = 0; k < ops; k++) {
		const fs = child.features;
		const roll = rnd();
		if (roll < 0.5 && fs.length) {
			// Nudge a few parameters.
			const f = fs[randInt(fs.length)];
			const keys = Object.keys(f.p);
			for (let j = 0; j < 1 + randInt(3) && keys.length; j++) {
				const key = keys[randInt(keys.length)];
				f.p[key] = clamp01(f.p[key] + gauss() * 0.15);
			}
		} else if (roll < 0.65 && fs.length) {
			fs[randInt(fs.length)] = randomFeature(child.tier);
		} else if (roll < 0.78) {
			fs.splice(randInt(fs.length + 1), 0, randomFeature(child.tier));
		} else if (roll < 0.9 && fs.length > 3) {
			fs.splice(randInt(fs.length), 1);
		} else if (fs.length > 1) {
			const i = randInt(fs.length - 1);
			[fs[i], fs[i + 1]] = [fs[i + 1], fs[i]];
		}
	}
	return child;
}

interface Elite {
	recipe: Recipe;
	ev: Score;
	fitness: number;
	cell: number;
}

/** Every recipe the search evaluates is logged here, as training data for the model in ml/runner/. */
const DATA_DIR = new URL('../../ml/runner/data/', import.meta.url);
mkdirSync(DATA_DIR, { recursive: true });
const logFor = (tier: number) => new URL(`search-tier${tier}.jsonl`, DATA_DIR);

const signature = (r: Recipe) => r.features.map((f) => f.type).join(',');

/** Scores a recipe and logs it; null if it's unusable (wrong length, two trains, or unclearable). */
function assess(recipe: Recipe): { ev: Score; fitness: number; cell: number } | null {
	const ev = scoreRecipe(recipe, 8);
	appendFileSync(logFor(recipe.tier), `${JSON.stringify({ recipe, score: ev })}\n`);
	if (!ev.valid) return null;
	const diffBin = Math.min(DIFF_BINS - 1, Math.floor(ev.rate * DIFF_BINS));
	const types = new Set(recipe.features.map((f) => f.type)).size;
	const varBin = Math.max(0, Math.min(VAR_BINS - 1, types - 2));
	return { ev, fitness: ev.fitness, cell: diffBin * VAR_BINS + varBin };
}

function searchTier(tier: number): Elite[] {
	writeFileSync(logFor(tier), '');
	const archive = new Map<number, Elite[]>();
	const consider = (recipe: Recipe) => {
		const a = assess(recipe);
		if (!a) return;
		const cell = archive.get(a.cell) ?? [];
		// One per sequence of feature types, so a cell doesn't fill up with near-copies.
		const sig = signature(recipe);
		const twin = cell.findIndex((e) => signature(e.recipe) === sig);
		if (twin >= 0) {
			if (cell[twin].fitness >= a.fitness) return;
			cell.splice(twin, 1);
		}
		cell.push({ recipe, ev: a.ev, fitness: a.fitness, cell: a.cell });
		cell.sort((x, y) => y.fitness - x.fitness);
		archive.set(a.cell, cell.slice(0, PER_CELL));
	};
	const start = Date.now();
	const initial = Math.min(150, Math.floor(EVALS * 0.1));
	for (let i = 0; i < initial; i++) consider(sampleRecipe(1 + randInt(1e7), tier));
	for (let i = initial; i < EVALS; i++) {
		const elites = [...archive.values()].flat();
		if (!elites.length) {
			consider(sampleRecipe(1 + randInt(1e7), tier));
			continue;
		}
		consider(mutate(elites[randInt(elites.length)].recipe));
		if ((i + 1) % 500 === 0) process.stdout.write(`  tier ${tier}: ${i + 1}/${EVALS} evals, ${archive.size} cells filled\n`);
	}
	console.log(`  tier ${tier}: ${archive.size}/${DIFF_BINS * VAR_BINS} cells filled in ${((Date.now() - start) / 1000).toFixed(0)} s`);
	return [...archive.values()].flat();
}

/** The tier's pool: elites in its target difficulty range, best first, spread across variety. */
function choosePool(tier: number, elites: Elite[]): Recipe[] {
	const [lo, hi] = TARGET[tier];
	let fit = elites.filter((e) => e.ev.rate >= lo && e.ev.rate < hi);
	if (fit.length < POOL_SIZE) {
		// Not enough in range: take the closest others too.
		const mid = (lo + hi) / 2;
		fit = [...elites].sort((a, b) => Math.abs(a.ev.rate - mid) - Math.abs(b.ev.rate - mid)).slice(0, POOL_SIZE);
	}
	// Best first, but at most one per cell and per sequence of feature types until each has had a turn.
	fit.sort((a, b) => b.fitness - a.fitness);
	const chosen: Elite[] = [];
	const cells = new Set<number>();
	const sigs = new Set<string>();
	for (const pass of [0, 1]) {
		for (const e of fit) {
			if (chosen.length >= POOL_SIZE) break;
			if (chosen.includes(e) || sigs.has(signature(e.recipe))) continue;
			if (pass === 0 && cells.has(e.cell)) continue;
			chosen.push(e);
			cells.add(e.cell);
			sigs.add(signature(e.recipe));
		}
	}
	return chosen.map((e, i) => ({ ...e.recipe, id: `s${tier}-${String(i + 1).padStart(2, '0')}` }));
}

const pools = loadRecipePools();
while (pools.length < TIERS) pools.push([]);
console.log(`MAP-Elites: ${EVALS} evaluations per tier, pools of ${POOL_SIZE}`);
for (let tier = 0; tier < TIERS; tier++) {
	if (ONLY.length && !ONLY.includes(tier)) continue;
	const elites = searchTier(tier);
	pools[tier] = choosePool(tier, elites);
	const rates = pools[tier].map((r) => elites.find((e) => e.recipe === r || e.recipe.features === r.features)?.ev.rate ?? 0);
	console.log(
		`  tier ${tier} pool: ${pools[tier].length} recipes, survival rates ${rates.map((r) => `${(r * 100).toFixed(0)}%`).join(' ')}`,
	);
}
saveRecipePools(pools, `Written by scripts/runner/search.ts (MAP-Elites, ${EVALS} evals per tier, search seed ${SEED}).`);
console.log('Saved src/secrets/runner/pools.json');
