// Accounts for the leaderboards: sign in with an emailed link (no passwords), guarded by Turnstile. A
// signed-in browser keeps a session cookie for 60 days, extended as it's used, so a regular visitor
// rarely needs another email. Tables: migrations/0004_accounts.sql.
//
//   GET  /api/auth/me                         → { signedIn, playerId?, email?, name?, solved?, runner?, turnstileSiteKey }
//   POST /api/auth/start  { email, turnstile, playerId? }  → { ok } (emails a sign-in link)
//   POST /api/auth/verify { token }           → { playerId, email, name } and the session cookie
//   POST /api/auth/name   { name }            → { name }  (unique, ignoring case)
//   POST /api/auth/logout                     → { ok }
//
// The emailed link opens /signin, which asks for one click before using the token, so email scanners
// that fetch links can't use it up.
import { ID_RE, cleanName, json, type Env } from './shared';

const COOKIE = 'sid';
const SESSION_DAYS = 60;
/** A session with less than this left is extended (and its cookie re-sent) when it's next checked. */
const RENEW_BELOW_DAYS = 45;
const LINK_MINUTES = 20;
const LINKS_PER_EMAIL = 3; // per 15 minutes
const LINKS_PER_IP = 10; // per hour
/** Cloudflare's documented Turnstile test keys: always pass. Used when no real keys are configured. */
const TEST_SITE_KEY = '1x00000000000000000000AA';

const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000);

function randomToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request: Request, name: string): string | null {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const [k, ...v] = part.trim().split('=');
		if (k === name) return v.join('=');
	}
	return null;
}

const sessionCookie = (token: string, days = SESSION_DAYS) =>
	`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86_400}`;
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export interface Account {
	id: string;
	email: string;
	name: string | null;
	/** Set when the session was extended: send this Set-Cookie with the response. */
	renewCookie?: string;
}

/** The signed-in account for this request, or null. Extends the session when it's getting old. */
export async function getAccount(request: Request, env: Env): Promise<Account | null> {
	const token = readCookie(request, COOKIE);
	if (!token || token.length > 100) return null;
	const hash = await sha256(token);
	const row = await env.DB.prepare(
		`SELECT s.expires_at, a.id, a.email, p.name FROM sessions s JOIN accounts a ON a.id = s.account_id
		 LEFT JOIN players p ON p.player_id = a.id WHERE s.token_hash = ?`,
	)
		.bind(hash)
		.first<{ expires_at: string; id: string; email: string; name: string | null }>();
	if (!row) return null;
	const expires = new Date(row.expires_at);
	if (expires <= now()) {
		await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
		return null;
	}
	const account: Account = { id: row.id, email: row.email, name: row.name };
	if (expires < plusDays(RENEW_BELOW_DAYS)) {
		await env.DB.batch([
			env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(iso(plusDays(SESSION_DAYS)), hash),
			env.DB.prepare('UPDATE accounts SET last_seen = ? WHERE id = ?').bind(iso(now()), row.id),
		]);
		account.renewCookie = sessionCookie(token);
	}
	return account;
}

async function turnstileOk(env: Env, token: string, ip: string | null): Promise<boolean> {
	// Local testing and preview deployments (AUTH_DEV_LINKS) use Turnstile's test keys, whatever secret is
	// set; production needs the real secret.
	const secret = env.AUTH_DEV_LINKS === '1' ? '1x0000000000000000000000000000000AA' : (env.TURNSTILE_SECRET ?? null);
	if (!secret) throw new Error('TURNSTILE_SECRET is not set');
	const form = new FormData();
	form.append('secret', secret);
	form.append('response', token);
	if (ip) form.append('remoteip', ip);
	const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
	const data = (await res.json().catch(() => ({}))) as { success?: boolean };
	return !!data.success;
}

async function sendSignInEmail(env: Env, to: string, link: string): Promise<void> {
	const subject = 'Your sign-in link';
	const text = `Here's your link to sign in to the leaderboards on Daniel Beyer's site:\n\n${link}\n\nIt works once, for ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`;
	const html = `<p>Here's your link to sign in to the leaderboards on Daniel Beyer's site:</p>
<p><a href="${link}">Sign in</a></p>
<p>It works once, for ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p>`;
	// Local testing: the link is shown on the page (and logged) instead of sent.
	if (env.AUTH_DEV_LINKS === '1') {
		console.log(`Sign-in link for ${to}: ${link}`);
		return;
	}
	if (env.EMAIL) {
		if (!env.EMAIL_FROM) throw new Error('EMAIL_FROM is not set');
		await env.EMAIL.send({ to, from: env.EMAIL_FROM, subject, text, html });
		return;
	}
	if (env.RESEND_API_KEY) {
		if (!env.EMAIL_FROM) throw new Error('EMAIL_FROM is not set');
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
			body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html }),
		});
		if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
		return;
	}
	throw new Error('No email sender is configured (EMAIL binding or RESEND_API_KEY)');
}

async function start(request: Request, url: URL, env: Env): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Bad request.' }, 400);
	}
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	const turnstile = typeof body.turnstile === 'string' ? body.turnstile : '';
	const playerId = typeof body.playerId === 'string' && ID_RE.test(body.playerId) ? body.playerId : null;
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'That doesn’t look like an email address.' }, 400);
	if (!turnstile) return json({ error: 'Please complete the check first.' }, 400);
	const ip = request.headers.get('cf-connecting-ip');
	if (!(await turnstileOk(env, turnstile, ip))) return json({ error: 'The check didn’t pass. Please try again.' }, 403);

	const counts = await env.DB.prepare(
		`SELECT
			(SELECT COUNT(*) FROM login_tokens WHERE email = ?1 AND created_at > ?2) AS byEmail,
			(SELECT COUNT(*) FROM login_tokens WHERE ip = ?3 AND created_at > ?4) AS byIp`,
	)
		.bind(email, iso(new Date(Date.now() - 15 * 60_000)), ip ?? '', iso(new Date(Date.now() - 60 * 60_000)))
		.first<{ byEmail: number; byIp: number }>();
	if ((counts?.byEmail ?? 0) >= LINKS_PER_EMAIL || (ip && (counts?.byIp ?? 0) >= LINKS_PER_IP)) {
		return json({ error: 'Too many sign-in emails; please wait a few minutes.' }, 429);
	}

	const token = randomToken();
	await env.DB.prepare('INSERT INTO login_tokens (token_hash, email, player_id, ip, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(await sha256(token), email, playerId, ip, iso(new Date(Date.now() + LINK_MINUTES * 60_000)), iso(now()))
		.run();
	const link = `${url.origin}/signin?token=${token}`;
	await sendSignInEmail(env, email, link);
	return json(env.AUTH_DEV_LINKS === '1' ? { ok: true, devLink: link } : { ok: true });
}

async function verify(request: Request, env: Env): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Bad request.' }, 400);
	}
	const token = typeof body.token === 'string' ? body.token : '';
	if (!token || token.length > 100) return json({ error: 'That link isn’t valid.' }, 400);
	const hash = await sha256(token);
	// Claims the token in one statement, so the same link can't sign in twice.
	const claimed = await env.DB.prepare('UPDATE login_tokens SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1')
		.bind(iso(now()), hash)
		.run();
	if (!claimed.meta?.changes) return json({ error: 'That link has expired or was already used. Ask for a new one.' }, 410);
	const row = await env.DB.prepare('SELECT email, player_id FROM login_tokens WHERE token_hash = ?')
		.bind(hash)
		.first<{ email: string; player_id: string | null }>();
	if (!row) return json({ error: 'That link isn’t valid.' }, 400);

	let account = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(row.email).first<{ id: string }>();
	if (!account) {
		// A new account takes the browser's anonymous id unless another account already has it.
		const taken = row.player_id
			? await env.DB.prepare('SELECT 1 AS t FROM accounts WHERE id = ?').bind(row.player_id).first<{ t: number }>()
			: null;
		const id = row.player_id && !taken ? row.player_id : crypto.randomUUID();
		await env.DB.prepare('INSERT INTO accounts (id, email, last_seen) VALUES (?, ?, ?)').bind(id, row.email, iso(now())).run();
		account = { id };
	}
	const session = randomToken();
	await env.DB.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
		.bind(await sha256(session), account.id, iso(plusDays(SESSION_DAYS)))
		.run();
	const player = await env.DB.prepare('SELECT name FROM players WHERE player_id = ?').bind(account.id).first<{ name: string }>();
	return json({ playerId: account.id, email: row.email, name: player?.name ?? null }, 200, { 'set-cookie': sessionCookie(session) });
}

async function me(request: Request, env: Env): Promise<Response> {
	const turnstileSiteKey = env.TURNSTILE_SITE_KEY || TEST_SITE_KEY;
	const account = await getAccount(request, env);
	if (!account) return json({ signedIn: false, turnstileSiteKey });
	// What this account has posted, so a new device can pick up its progress.
	const { results } = await env.DB.prepare('SELECT board, solved_at FROM solves WHERE player_id = ?')
		.bind(account.id)
		.all<{ board: string; solved_at: string }>();
	const runner = await env.DB.prepare('SELECT 1 AS r FROM runner_runs WHERE player_id = ? LIMIT 1').bind(account.id).first<{ r: number }>();
	return json(
		{
			signedIn: true,
			playerId: account.id,
			email: account.email,
			name: account.name,
			solved: Object.fromEntries(results.map((r) => [r.board, r.solved_at])),
			runner: !!runner,
			turnstileSiteKey,
		},
		200,
		account.renewCookie ? { 'set-cookie': account.renewCookie } : {},
	);
}

async function setName(request: Request, env: Env): Promise<Response> {
	const account = await getAccount(request, env);
	if (!account) return json({ error: 'Please sign in first.' }, 401);
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Bad request.' }, 400);
	}
	const name = cleanName(body.name);
	if (!name || name.length > 24) return json({ error: 'Names are 1–24 characters.' }, 400);
	const taken = await env.DB.prepare('SELECT 1 AS t FROM players WHERE name = ? COLLATE NOCASE AND player_id != ?')
		.bind(name, account.id)
		.first<{ t: number }>();
	if (taken) return json({ error: 'That name is taken. Try another.' }, 409);
	try {
		await env.DB.prepare('INSERT INTO players (player_id, name) VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET name = excluded.name')
			.bind(account.id, name)
			.run();
	} catch (err) {
		// Someone took it in the moment between the check and the write.
		if (String(err).includes('UNIQUE')) return json({ error: 'That name is taken. Try another.' }, 409);
		throw err;
	}
	return json({ name });
}

async function logout(request: Request, env: Env): Promise<Response> {
	const token = readCookie(request, COOKIE);
	if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
	return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
}

/** Handles /api/auth/*; null for other paths. */
export async function handleAuth(request: Request, url: URL, env: Env): Promise<Response | null> {
	if (!url.pathname.startsWith('/api/auth/')) return null;
	const route = `${request.method} ${url.pathname}`;
	try {
		switch (route) {
			case 'GET /api/auth/me':
				return await me(request, env);
			case 'POST /api/auth/start':
				return await start(request, url, env);
			case 'POST /api/auth/verify':
				return await verify(request, env);
			case 'POST /api/auth/name':
				return await setName(request, env);
			case 'POST /api/auth/logout':
				return await logout(request, env);
			default:
				return json({ error: 'Not found.' }, 404);
		}
	} catch (err) {
		console.error(err);
		return json({ error: 'Signing in isn’t working right now. Please try again later.' }, 500);
	}
}
