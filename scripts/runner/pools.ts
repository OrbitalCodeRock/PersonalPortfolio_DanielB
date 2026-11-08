// Reading and writing the recipe pools file the game loads (src/secrets/runner/pools.json).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Recipe } from '../../src/secrets/runner/levelgen.ts';

export const POOLS_FILE = new URL('../../src/secrets/runner/pools.json', import.meta.url);

/** One array of recipes per tier (empty arrays if the file doesn't exist yet). */
export function loadRecipePools(): Recipe[][] {
	if (!existsSync(POOLS_FILE)) return [];
	return (JSON.parse(readFileSync(POOLS_FILE, 'utf8')) as { pools: Recipe[][] }).pools;
}

export function saveRecipePools(pools: Recipe[][], note: string) {
	// Round parameters so the file stays readable and diffs stay small.
	const round = (r: Recipe): Recipe => ({
		...r,
		lead: r.lead === undefined ? undefined : +r.lead.toFixed(3),
		features: r.features.map((f) => ({
			type: f.type,
			p: Object.fromEntries(Object.entries(f.p).map(([k, v]) => [k, +v.toFixed(3)])),
		})),
	});
	writeFileSync(POOLS_FILE, `${JSON.stringify({ note, pools: pools.map((p) => p.map(round)) }, null, '\t')}\n`);
}
