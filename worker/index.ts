// Cloudflare Worker: serves the static Astro build, plus the leaderboards for the secret puzzle hunt.
// Only /api/* reaches this code (run_worker_first in wrangler.jsonc); everything else is a static asset.
//
// There is one board per puzzle, plus "all" for people who found every secret.
//
//   GET  /api/leaderboard                → { counts: { [board]: number } }
//   GET  /api/leaderboard?board=<board>  → { board, total, entries: [{ rank, name, solvedAt }] } (first 100)
//   POST /api/leaderboard  { boards: string[], phrase? } → { ranks: { [board]: rank } }   (signed in)
//
// POST adds the signed-in player to each listed board they
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
//
// And the runner's own leaderboard: each player's best run per category ('random', or 'chosen' for runs
// built from picked segments or replays), stored with its segments so anyone can replay it:
//
//   GET  /api/runner/board?category=random|chosen[&player=<id>]
//   GET  /api/runner/run?id=<runId>            → the run, with its recipes
//   POST /api/runner/run { category, seconds, distance, segments: [{ v, id }] }   (signed in)
//
// Posting to a leaderboard needs a signed-in account with a name (worker/auth.ts); the player is the
// account, whatever the request body says. Reading the boards is public.
import { PHRASE, PUZZLES } from '../src/secrets/config';
import { POOLS_VERSION, findRecipe } from '../src/secrets/runner/poolVersion';
import { getAccount, handleAuth, type Account } from './auth';
import { ID_RE, json, type D1Prepared, type Env } from './shared';

const BOARDS = new Set<string>(['all', ...PUZZLES.map((p) => p.id)]);

/** The signed-in account with a name, or the response to send instead. */
async function poster(request: Request, env: Env): Promise<Account | Response> {
	const account = await getAccount(request, env);
	if (!account) return json({ error: 'Please sign in to post to the leaderboards.', signIn: true }, 401);
	if (!account.name) return json({ error: 'Choose a name for the leaderboards first.', chooseName: true }, 403);
	return account;
}

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
	const account = await poster(request, env);
	if (account instanceof Response) return account;
	let body: { boards?: unknown; phrase?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Bad request.' }, 400);
	}
	const playerId = account.id;
	const boards = Array.isArray(body.boards) ? [...new Set(body.boards.filter((b) => typeof b === 'string'))] : [];
	const phrase = typeof body.phrase === 'string' ? body.phrase.trim().toUpperCase() : '';
	if (boards.some((b) => !BOARDS.has(b))) return json({ error: 'No such board.' }, 400);
	if (boards.includes('all') && phrase !== PHRASE) return json({ error: 'That isn’t the phrase.' }, 403);

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

// ---- The rooftop runner's leaderboard ---------------------------------------------------------

const CATEGORIES = new Set(['random', 'chosen']);
/** Most runs one player can post in an hour (only new personal bests are posted). */
const RUNS_PER_HOUR = 60;

interface SegmentRef {
	v: string;
	id: string;
}

/** Rank of a best time in a category: 1 + the players whose best beats it. */
async function runnerRank(env: Env, category: string, best: number): Promise<number> {
	const ahead = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM (SELECT player_id, MAX(seconds) AS s FROM runner_runs WHERE category = ? GROUP BY player_id) WHERE s > ?`,
	)
		.bind(category, best)
		.first<{ n: number }>();
	return (ahead?.n ?? 0) + 1;
}

/**
 * Each player's best run in a category, best first (first 100).
 *   GET /api/runner/board?category=random|chosen[&player=<id>]
 *   → { category, total, entries: [{ rank, name, seconds, distance, segments, runId, at }], me?: { rank, seconds, runId } }
 */
async function runnerBoard(url: URL, env: Env): Promise<Response> {
	const category = url.searchParams.get('category') ?? 'random';
	if (!CATEGORIES.has(category)) return json({ error: 'No such category.' }, 404);
	const { results } = await env.DB.prepare(
		`SELECT r.id, p.name, r.seconds, r.distance, r.segments, r.created_at FROM runner_runs r JOIN players p USING (player_id)
		 WHERE r.category = ?1 AND r.id = (
			SELECT r2.id FROM runner_runs r2 WHERE r2.category = r.category AND r2.player_id = r.player_id
			ORDER BY r2.seconds DESC, r2.created_at LIMIT 1
		 )
		 ORDER BY r.seconds DESC, r.created_at LIMIT 100`,
	)
		.bind(category)
		.all<{ id: string; name: string; seconds: number; distance: number; segments: string; created_at: string }>();
	const total = await env.DB.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM runner_runs WHERE category = ?')
		.bind(category)
		.first<{ n: number }>();
	const entries = results.map((r, i) => ({
		rank: i + 1,
		name: r.name,
		seconds: r.seconds,
		distance: r.distance,
		segments: (JSON.parse(r.segments) as unknown[]).length,
		runId: r.id,
		at: r.created_at,
	}));
	const player = url.searchParams.get('player');
	let me: { rank: number; seconds: number; runId: string } | undefined;
	if (player && ID_RE.test(player)) {
		const mine = await env.DB.prepare(
			'SELECT id, seconds FROM runner_runs WHERE category = ? AND player_id = ? ORDER BY seconds DESC, created_at LIMIT 1',
		)
			.bind(category, player)
			.first<{ id: string; seconds: number }>();
		if (mine) me = { rank: await runnerRank(env, category, mine.seconds), seconds: mine.seconds, runId: mine.id };
	}
	return json({ category, total: total?.n ?? 0, entries, me });
}

/**
 * One run, with its recipes, for replaying.
 *   GET /api/runner/run?id=<runId> → { id, name, category, seconds, distance, segments: [{ v, id, recipe }] }
 */
async function runnerRun(url: URL, env: Env): Promise<Response> {
	const id = url.searchParams.get('id') ?? '';
	if (!ID_RE.test(id)) return json({ error: 'No such run.' }, 404);
	const run = await env.DB.prepare(
		`SELECT r.id, p.name, r.category, r.seconds, r.distance, r.segments FROM runner_runs r JOIN players p USING (player_id)
		 WHERE r.id = ?`,
	)
		.bind(id)
		.first<{ id: string; name: string; category: string; seconds: number; distance: number; segments: string }>();
	if (!run) return json({ error: 'No such run.' }, 404);
	const refs = JSON.parse(run.segments) as SegmentRef[];
	const recipes = new Map<string, unknown>();
	for (const key of new Set(refs.map((r) => `${r.v}/${r.id}`))) {
		const [v, rid] = key.split('/');
		const row = await env.DB.prepare('SELECT recipe FROM runner_recipes WHERE pools_version = ? AND recipe_id = ?')
			.bind(v, rid)
			.first<{ recipe: string }>();
		recipes.set(key, row ? JSON.parse(row.recipe) : v === POOLS_VERSION ? (findRecipe(rid) ?? null) : null);
	}
	return json({
		id: run.id,
		name: run.name,
		category: run.category,
		seconds: run.seconds,
		distance: run.distance,
		segments: refs.map((r) => ({ v: r.v, id: r.id, recipe: recipes.get(`${r.v}/${r.id}`) })),
	});
}

/**
 * Posts a run. It's kept if it beats the player's best in its category; either way the reply says where
 * their best stands.
 *   POST /api/runner/run { playerId, name, category, seconds, distance, segments: [{ v, id }] }
 *   → { kept, runId?, rank, best }
 */
async function postRun(request: Request, env: Env): Promise<Response> {
	const account = await poster(request, env);
	if (account instanceof Response) return account;
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Bad request.' }, 400);
	}
	const playerId = account.id;
	const { category } = body;
	const secs = seconds(body.seconds);
	const distance = Number(body.distance);
	const segments = Array.isArray(body.segments) ? (body.segments as Record<string, unknown>[]) : null;
	if (
		typeof category !== 'string' ||
		!CATEGORIES.has(category) ||
		secs === null ||
		!Number.isInteger(distance) ||
		distance < 0 ||
		distance > 1_000_000 ||
		!segments ||
		!segments.length ||
		segments.length > 500
	) {
		return json({ error: 'Bad request.' }, 400);
	}
	const refs: SegmentRef[] = [];
	for (const s of segments) {
		if (typeof s?.v !== 'string' || !/^[0-9a-f]{8}$/.test(s.v) || typeof s?.id !== 'string' || !/^[\w-]{1,40}$/.test(s.id)) {
			return json({ error: 'Bad request.' }, 400);
		}
		refs.push({ v: s.v, id: s.id });
	}
	// Every segment must be one the game could have played: from the deployed pools, or already on file
	// from an earlier version (which is how replays of older runs get here).
	const statements: D1Prepared[] = [];
	for (const key of new Set(refs.map((r) => `${r.v}/${r.id}`))) {
		const [v, id] = key.split('/');
		const current = v === POOLS_VERSION ? findRecipe(id) : undefined;
		if (current) {
			statements.push(
				env.DB.prepare(
					'INSERT INTO runner_recipes (pools_version, recipe_id, tier, recipe) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
				).bind(v, id, current.tier, JSON.stringify(current)),
			);
			continue;
		}
		const known = await env.DB.prepare('SELECT 1 AS ok FROM runner_recipes WHERE pools_version = ? AND recipe_id = ?')
			.bind(v, id)
			.first<{ ok: number }>();
		if (!known) return json({ error: 'Those segments aren’t available any more.' }, 409);
	}
	const recent = await env.DB.prepare(
		`SELECT COUNT(*) AS n FROM runner_runs WHERE player_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')`,
	)
		.bind(playerId)
		.first<{ n: number }>();
	if ((recent?.n ?? 0) >= RUNS_PER_HOUR) return json({ error: 'Too many runs posted; try again later.' }, 429);

	const prev = await env.DB.prepare('SELECT MAX(seconds) AS s FROM runner_runs WHERE category = ? AND player_id = ?')
		.bind(category, playerId)
		.first<{ s: number | null }>();
	let runId: string | undefined;
	if (prev?.s == null || secs > prev.s) {
		runId = crypto.randomUUID();
		statements.push(
			env.DB.prepare(
				'INSERT INTO runner_runs (id, player_id, category, seconds, distance, segments) VALUES (?, ?, ?, ?, ?, ?)',
			).bind(runId, playerId, category, secs, distance, JSON.stringify(refs)),
		);
	}
	if (statements.length) await env.DB.batch(statements);
	const best = Math.max(secs, prev?.s ?? 0);
	return json({ kept: !!runId, runId, rank: await runnerRank(env, category, best), best });
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const auth = await handleAuth(request, url, env);
		if (auth) return auth;
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
		if (url.pathname.startsWith('/api/runner/')) {
			try {
				if (url.pathname === '/api/runner/board' && request.method === 'GET') return await runnerBoard(url, env);
				if (url.pathname === '/api/runner/run' && request.method === 'GET') return await runnerRun(url, env);
				if (url.pathname === '/api/runner/run' && request.method === 'POST') return await postRun(request, env);
			} catch (err) {
				console.error(err);
				return json({ error: 'The runner leaderboard is unavailable.' }, 500);
			}
		}
		if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
		return env.ASSETS.fetch(request);
	},
};
