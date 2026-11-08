// Seed pools for the rooftop runner, one pool per time band. A segment is fully described by its seed
// and its band (see levelgen.ts), so these lists are the whole "level database". Later they can be
// curated, or replaced by seeds from a level-building model; for now they're mostly arbitrary numbers,
// with 0x0010 picked because it includes a large switchback. Adding or reweighting features in
// levelgen.ts changes what every seed produces.
import { TIERS, generateSegment, recipeSegment, type Recipe, type Segment } from './levelgen.ts';

export const SEED_POOLS: number[][] = [
	// 0–15 s
	[0x1a2b, 0x2f11, 0x3c07, 0x4d93, 0x5e21, 0x6a4f, 0x7b3d, 0x8c19, 0x9d55, 0xae0b],
	// 15–30 s
	[0x1b77, 0x2c3a, 0x3d81, 0x4e2f, 0x5f64, 0x6b12, 0x7c9e, 0x8d40, 0x9e2b, 0xaf73],
	// 30–45 s
	[0x10f3, 0x21c8, 0x32a5, 0x4317, 0x54d9, 0x6560, 0x76b4, 0x8721, 0x98ee, 0xa94a],
	// 45–60 s
	[0x11d2, 0x22e7, 0x3349, 0x44b0, 0x5526, 0x668f, 0x77c3, 0x0010, 0x99da, 0xaa6c],
	// 60 s and beyond
	[0x12a9, 0x23f4, 0x3462, 0x4518, 0x56cb, 0x673e, 0x78a0, 0x8957, 0x9ab1, 0xab0d],
];

if (SEED_POOLS.length !== TIERS) throw new Error('One seed pool per tier');

/** A pool entry: a seed, or a recipe (hand-made, found by search, or written by a model). */
export type PoolEntry = number | Recipe;

/** Extra recipe pools, one per tier, added by tools such as scripts/runner/search.ts. */
let extraPools: Recipe[][] = [];
export function setRecipePools(pools: Recipe[][]) {
	extraPools = pools;
}

const keyOf = (e: PoolEntry) => (typeof e === 'number' ? e.toString(16) : (e.id ?? JSON.stringify(e)));

/**
 * Picks an entry for this tier, avoiding the ones used recently in this run (by key). A tier with
 * recipes from the search (pools.json) uses those; otherwise it falls back to the seeds above.
 */
export function pickEntry(tier: number, recent: string[]): PoolEntry {
	const t = Math.min(tier, SEED_POOLS.length - 1);
	const pool: PoolEntry[] = extraPools[t]?.length ? extraPools[t] : SEED_POOLS[t];
	const fresh = pool.filter((e) => !recent.includes(keyOf(e)));
	const from = fresh.length ? fresh : pool;
	return from[Math.floor(Math.random() * from.length)];
}

/** The segment for a pool entry, placed at (x0, y0). */
export function entrySegment(e: PoolEntry, tier: number, x0: number, y0: number): Segment {
	return typeof e === 'number' ? generateSegment(e, tier, x0, y0) : recipeSegment(e, x0, y0);
}

export { keyOf as entryKey };
