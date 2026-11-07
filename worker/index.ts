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
import { PHRASE, PUZZLES } from '../src/secrets/config';

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
	DB: { prepare(sql: string): D1Prepared };
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
		if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
		return env.ASSETS.fetch(request);
	},
};
