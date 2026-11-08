// Downloads the thumbs up/down ratings of runner segments from D1 (see worker/index.ts and
// migrations/0002_runner_votes.sql), writes them for the level model, and prints a per-recipe summary.
//
//   npm run runner:votes              # the deployed database (needs `npx wrangler login` once)
//   npm run runner:votes -- --local   # the local database `wrangler dev` uses
//
// Writes ml/runner/data/votes.jsonl: one line per rated segment,
//   { id, vote, outcome, seconds, runSeconds, cause, runId, position, poolsVersion, createdAt, recipe }
// where `recipe` is the recipe as it was when rated (ids are reused when pools are regenerated).
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { POOLS_VERSION } from '../../src/secrets/runner/poolVersion.ts';

const DB = 'portfolio-leaderboard';
const where = process.argv.includes('--local') ? '--local' : '--remote';

function query<T>(sql: string): T[] {
	const out = execSync(`npx wrangler d1 execute ${DB} ${where} --json --command "${sql.replace(/\s+/g, ' ')}"`, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'inherit'],
		maxBuffer: 256 * 1024 * 1024,
	});
	return (JSON.parse(out) as { results: T[] }[])[0].results;
}

interface Row {
	run_id: string;
	position: number;
	recipe_id: string;
	vote: number;
	outcome: 'cleared' | 'died';
	seconds: number;
	run_seconds: number;
	cause: string | null;
	pools_version: string;
	created_at: string;
	recipe: string | null;
}

const rows = query<Row>(
	`SELECT v.run_id, v.position, v.recipe_id, v.vote, v.outcome, v.seconds, v.run_seconds, v.cause, v.pools_version,
	 v.created_at, r.recipe FROM runner_votes v
	 LEFT JOIN runner_recipes r ON r.pools_version = v.pools_version AND r.recipe_id = v.recipe_id
	 ORDER BY v.id`,
);

const lines = rows.map((r) =>
	JSON.stringify({
		id: r.recipe_id,
		vote: r.vote,
		outcome: r.outcome,
		seconds: r.seconds,
		runSeconds: r.run_seconds,
		cause: r.cause,
		runId: r.run_id,
		position: r.position,
		poolsVersion: r.pools_version,
		createdAt: r.created_at,
		recipe: r.recipe ? JSON.parse(r.recipe) : null,
	}),
);
const OUT = new URL('../../ml/runner/data/', import.meta.url);
mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('votes.jsonl', OUT), lines.length ? `${lines.join('\n')}\n` : '');

// Summary for the pools deployed now.
const current = rows.filter((r) => r.pools_version === POOLS_VERSION);
const stats = new Map<string, { up: number; down: number; died: number }>();
for (const r of current) {
	const st = stats.get(r.recipe_id) ?? { up: 0, down: 0, died: 0 };
	if (r.vote > 0) st.up++;
	else st.down++;
	if (r.outcome === 'died') st.died++;
	stats.set(r.recipe_id, st);
}
console.log(`${rows.length} ratings (${current.length} on the current pools, version ${POOLS_VERSION}).`);
console.log('Wrote ml/runner/data/votes.jsonl\n');
if (stats.size) {
	console.log('recipe   up  down  ended-run  share up');
	for (const [id, st] of [...stats].sort(([a], [b]) => a.localeCompare(b))) {
		const share = st.up / (st.up + st.down);
		console.log(
			`${id.padEnd(8)} ${String(st.up).padStart(3)} ${String(st.down).padStart(5)} ${String(st.died).padStart(10)}  ${(share * 100).toFixed(0).padStart(7)}%`,
		);
	}
}
