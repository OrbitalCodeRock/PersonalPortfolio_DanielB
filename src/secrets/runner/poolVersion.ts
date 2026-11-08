// The recipe pools the game plays (pools.json), plus a short version string for them. Pool ids such as
// "m2-07" are reused each time the pools are regenerated, so a vote records the version alongside the id;
// the game and the Worker (worker/index.ts) both import this file, so they always agree on it.
import type { Recipe } from './levelgen.ts';
import pools from './pools.json' with { type: 'json' };

export const POOLS = (pools as { pools: Recipe[][] }).pools;

/** FNV-1a over the pools' JSON, as 8 hex digits. Changes whenever any recipe changes. */
export const POOLS_VERSION = (() => {
	const text = JSON.stringify(POOLS);
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
})();

/** The recipe with this id in the current pools, if there is one. */
export function findRecipe(id: string): Recipe | undefined {
	for (const pool of POOLS) for (const r of pool) if (r.id === id) return r;
	return undefined;
}
