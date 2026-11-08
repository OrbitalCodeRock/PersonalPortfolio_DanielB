// Playtests every entry in the runner's level pools with the bot and prints a table.
//
//   npm run runner:evaluate            all tiers
//   npm run runner:evaluate -- 2 3     only tiers 2 and 3
//
// "clears" = a perfect-timing bot gets through; "rate" = share of sloppier runs that survive (how
// forgiving it is); "fails on" = which features the sloppy runs died on.
import { evaluate } from '../../src/secrets/runner/playtest.ts';
import { SEED_POOLS, entryKey, entrySegment } from '../../src/secrets/runner/seeds.ts';
import { loadRecipePools } from './pools.ts';

const tiers = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const recipePools = loadRecipePools();

for (let tier = 0; tier < SEED_POOLS.length; tier++) {
	if (tiers.length && !tiers.includes(tier)) continue;
	console.log(`\nTier ${tier} (${tier * 15}–${tier * 15 + 15} s)`);
	const entries = [...SEED_POOLS[tier], ...(recipePools[tier] ?? [])];
	let clear = 0;
	let rateSum = 0;
	for (const entry of entries) {
		const e = evaluate(entry, tier);
		const seg = entrySegment(entry, tier, 0, 0);
		if (e.clears) clear++;
		rateSum += e.rate;
		const fails = Object.entries(e.failures)
			.map(([k, n]) => `${k}×${n}`)
			.join(' ');
		console.log(
			`  ${entryKey(entry).padEnd(10)} ${e.clears ? 'clears' : 'FAILS '}  rate ${(e.rate * 100).toFixed(0).padStart(3)}%  ` +
				`${e.seconds.toFixed(1).padStart(5)} s  ${seg.features.join(' ')}${fails ? `  | fails on: ${fails}` : ''}`,
		);
	}
	console.log(`  → ${clear}/${entries.length} clear, mean rate ${((rateSum / entries.length) * 100).toFixed(0)}%`);
}
