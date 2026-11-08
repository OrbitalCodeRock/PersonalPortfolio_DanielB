// Writes ml/runner/schema.json: the feature types, the tier each appears from, and the parameter names
// each one reads (collected by sampling many recipes). The Python model uses it to encode recipes.
//
// Run: node scripts/runner/schema.ts   (again whenever features change in levelgen.ts)
import { mkdirSync, writeFileSync } from 'node:fs';
import { FEATURES, FEATURE_NAMES, TIERS, sampleRecipe } from '../../src/secrets/runner/levelgen.ts';

const params: Record<string, Set<string>> = Object.fromEntries(FEATURE_NAMES.map((n) => [n, new Set<string>()]));
for (let tier = 0; tier < TIERS; tier++) {
	for (let seed = 1; seed <= 4000; seed++) {
		for (const f of sampleRecipe(seed, tier).features) for (const k of Object.keys(f.p)) params[f.type].add(k);
	}
}
const schema = {
	note: 'Written by scripts/runner/schema.ts. Each parameter is 0..1; missing ones read as 0.5.',
	tiers: TIERS,
	features: FEATURE_NAMES.map((name) => ({ name, minTier: FEATURES[name][0], params: [...params[name]].sort() })),
};
const dir = new URL('../../ml/runner/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('schema.json', dir), `${JSON.stringify(schema, null, '\t')}\n`);
const max = Math.max(...schema.features.map((f) => f.params.length));
console.log(`schema: ${schema.features.length} feature types, up to ${max} parameters each`);
for (const f of schema.features) console.log(`  ${f.name.padEnd(11)} tier ${f.minTier}+  ${f.params.join(' ')}`);
