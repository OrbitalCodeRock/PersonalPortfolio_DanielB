// Cloudflare Worker: serves the static Astro build, plus the leaderboards for the secret puzzle hunt.
// Only /api/* reaches this code (run_worker_first in wrangler.jsonc); everything else is a static asset.
//
// There is one board per puzzle, plus "all" for people who found every secret.
//
//   GET  /api/leaderboard                → { counts: { [board]: number } }
//   GET  /api/leaderboard?board=<board>  → { board, total, entries: [{ rank, name, solvedAt }] } (first 100)
//   POST /api/leaderboard  { playerId, name, boards: string[], phrase? } → { ranks: { [board]: rank } }
//
// POST sets the player's name (renaming them on every board) and adds them to each listed board they
// aren't on yet. Rank = number of people on that board before you + 1, and posting a board again returns
// the same rank. The "all" board also needs the hangman phrase. None of this is real anti-cheat: the site
// is static, so a determined player could read every answer from the page's JavaScript.
//
// It also takes thumbs up/down ratings of rooftop runner segments (the Now page), for the level model:
//
//   POST /api/runner/vote  { playerId, runId, position, id, vote: 1 | -1, poolsVersion,
//                            outcome: 'cleared' | 'died', seconds, runSeconds, cause? }  → { ok: true }
//
// One rating per segment of a run (sending again changes it). Ratings for pools other than the ones
// deployed are dropped. Read them back with `npm run runner:votes` (scripts/runner/votes.ts).
import { PHRASE, PUZZLES } from '../src/secrets/config';
import { POOLS_VERSION, findRecipe } from '../src/secrets/runner/poolVersion';

interface D1Result<T> {
	results: T[];
}
interface D1Prepared {
	bind(...values: unknown[]): D1Prepared;
	first<T>(): Promise<T | null>;
	all<T>(): Promise<D1Result<T>>;
	run(): Promise<unknown>;
}
interface Env {
	ASSETS: { fetch(request: Request): Promise<Response> };
	DB: { prepare(sql: string): D1Prepared; batch(statements: D1Prepared[]): Promise<unknown[]> };
}

const BOARDS = new Set<string>(['all', ...PUZZLES.map((p) => p.id)]);

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	});

async function rankOf(env: Env, board: string, playerId: string): Promise<number | null> {
	const row = await env.DB.prepare(
		`SELECT (SELECT COUNT(*) FROM solves b WHERE b.board = a.board AND b.id <= a.id) AS rank
		 FROM solves a WHERE a.board = ? AND a.player_id = ?`,
	)
		.bind(board, playerId)
		.first<{ rank: number }>();
	return row?.rank ?? null;
}

async function read(url: URL, env: Env): Promise<Response> {
	const board = url.searchParams.get('board');
	if (!board) {
		const { results } = await env.DB.prepare('SELECT board, COUNT(*) AS n FROM solves GROUP BY board').all<{
			board: string;
			n: number;
		}>();
		return json({ counts: Object.fromEntries(results.map((r) => [r.board, r.n])) });
	}
	if (!BOARDS.has(board)) return json({ error: 'No such board.' }, 404);
	const { results } = await env.DB.prepare(
		`SELECT p.name AS name, s.solved_at AS solvedAt FROM solves s JOIN players p USING (player_id)
		 WHERE s.board = ? ORDER BY s.id LIMIT 100`,
	)
		.bind(board)
		.all<{ name: string; solvedAt: string }>();
	const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM solves WHERE board = ?')
		.bind(board)
		.first<{ n: number }>();
	return json({ board, total: total?.n ?? 0, entries: results.map((r, i) => ({ rank: i + 1, ...r })) });
}

async function write(request: Request, env: Env): Promise<Response> {
	let body: { playerId?: unknown; name?: unknown; boards?: unknown; phrase?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Bad request.' }, 400);
	}
	const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
	const name = typeof body.name === 'string' ? body.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
	const boards = Array.isArray(body.boards) ? [...new Set(body.boards.filter((b) => typeof b === 'string'))] : [];
	const phrase = typeof body.phrase === 'string' ? body.phrase.trim().toUpperCase() : '';
	if (!/^[\w-]{8,64}$/.test(playerId)) return json({ error: 'Bad request.' }, 400);
	if (!name || name.length > 24) return json({ error: 'Names are 1–24 characters.' }, 400);
	if (boards.some((b) => !BOARDS.has(b))) return json({ error: 'No such board.' }, 400);
	if (boards.includes('all') && phrase !== PHRASE) return json({ error: 'That isn’t the phrase.' }, 403);

	await env.DB.prepare(
		'INSERT INTO players (player_id, name) VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET name = excluded.name',
	)
		.bind(playerId, name)
		.run();
	const ranks: Record<string, number> = {};
	for (const board of boards) {
		await env.DB.prepare('INSERT INTO solves (player_id, board) VALUES (?, ?) ON CONFLICT DO NOTHING')
			.bind(playerId, board)
			.run();
		const rank = await rankOf(env, board, playerId);
		if (rank) ranks[board] = rank;
	}
	return json({ ranks });
}

/** Most ratings one visitor can send in an hour (a segment takes about 10 s); the rest are ignored. */
const VOTES_PER_HOUR = 400;

const ID_RE = /^[\w-]{8,64}$/;
const seconds = (v: unknown) => {
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 && n <= 3600 ? n : null;
};

async function vote(request: Request, env: Env): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Bad request.' }, 400);
	}
	const { playerId, runId, poolsVersion, id, outcome, cause } = body;
	const value = body.vote;
	const position = Number(body.position);
	const segSeconds = seconds(body.seconds);
	const runSeconds = seconds(body.runSeconds);
	if (
		typeof playerId !== 'string' ||
		!ID_RE.test(playerId) ||
		typeof runId !== 'string' ||
		!ID_RE.test(runId) ||
		(value !== 1 && value !== -1) ||
		typeof poolsVersion !== 'string' ||
		typeof id !== 'string' ||
		(outcome !== 'cleared' && outcome !== 'died') ||
		!Number.isInteger(position) ||
		position < 0 ||
		position > 1000 ||
		segSeconds === null ||
		runSeconds === null ||
		(cause !== undefined && typeof cause !== 'string')
	) {
		return json({ error: 'Bad request.' }, 400);
	}
	// From pools that are no longer deployed (a tab left open across a deploy): dropped, quietly.
	if (poolsVersion !== POOLS_VERSION) return json({ ok: true, dropped: 'stale pools' });
	const recipe = findRecipe(id);
	if (!recipe) return json({ error: 'Bad request.' }, 400);

	const recent = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM runner_votes WHERE player_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')`,
	)
		.bind(playerId)
		.first<{ n: number }>();
	if ((recent?.n ?? 0) >= VOTES_PER_HOUR) return json({ ok: true, dropped: 'rate' });

	await env.DB.batch([
		env.DB.prepare(
			'INSERT INTO runner_recipes (pools_version, recipe_id, tier, recipe) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
		).bind(poolsVersion, id, recipe.tier, JSON.stringify(recipe)),
		// Changing your mind on the same segment replaces the vote; a different player can't overwrite it.
		env.DB.prepare(
			`INSERT INTO runner_votes (run_id, position, player_id, pools_version, recipe_id, vote, outcome, seconds, run_seconds, cause)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (run_id, position) DO UPDATE SET vote = excluded.vote WHERE runner_votes.player_id = excluded.player_id`,
		).bind(
			runId,
			position,
			playerId,
			poolsVersion,
			id,
			value,
			outcome,
			segSeconds,
			runSeconds,
			outcome === 'died' && typeof cause === 'string' ? cause.slice(0, 80) : null,
		),
	]);
	return json({ ok: true });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/api/leaderboard') {
			try {
				if (request.method === 'GET') return await read(url, env);
				if (request.method === 'POST') return await write(request, env);
				return json({ error: 'Method not allowed.' }, 405);
			} catch (err) {
				console.error(err);
				return json({ error: 'The leaderboard is unavailable.' }, 500);
			}
		}
		if (url.pathname === '/api/runner/vote') {
			if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
			try {
				return await vote(request, env);
			} catch (err) {
				console.error(err);
				return json({ error: 'Votes are unavailable.' }, 500);
			}
		}
		if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
		return env.ASSETS.fetch(request);
	},
};
