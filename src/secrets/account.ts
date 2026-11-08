// Signing in to the leaderboards (the API is worker/auth.ts). A visitor asks for an emailed link, passing a
// Turnstile check; the link opens /signin, which finishes it. The browser then stays signed in for 60 days
// (a session cookie the Worker extends as it's used), so another email is rarely needed.
//
// Locally, the account's id becomes this browser's playerId and its name becomes `name`, so the rest of
// the hunt (boards.ts, runnerBoard.ts) can tell at a glance whether posting will work. Progress posted
// from another device (solved secrets) is copied in when the account is checked.
import { PUZZLES, type PuzzleId } from './config';
import { load, setData, update } from './progress';

export interface Me {
	signedIn: boolean;
	playerId?: string;
	email?: string;
	name?: string | null;
	/** Board → when this account was added to it. */
	solved?: Record<string, string>;
	/** The account has runner runs on the boards. */
	runner?: boolean;
	turnstileSiteKey: string;
}

export class AccountError extends Error {}

async function call<T>(path: string, body?: unknown): Promise<T> {
	let res: Response;
	try {
		res = await fetch(path, {
			method: body === undefined ? 'GET' : 'POST',
			headers: body === undefined ? {} : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
			credentials: 'same-origin',
		});
	} catch {
		throw new Error('offline');
	}
	const data = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) throw data.error ? new AccountError(data.error) : new Error(String(res.status));
	return data;
}

/**
 * Takes on an account in this browser. A different account than before (or a fresh sign-in) clears the
 * record of what's been posted, so every solve and best run is posted again under it; the server keeps
 * the original places.
 */
function adopt(account: { playerId: string; name?: string | null }, fresh: boolean) {
	update((p) => {
		if (fresh || p.playerId !== account.playerId) {
			p.ranks = {};
			const runs = (p.data['now-runs'] ?? {}) as Record<string, { posted?: boolean }>;
			for (const r of Object.values(runs)) if (r) r.posted = false;
		}
		p.playerId = account.playerId;
		p.name = account.name ?? undefined;
	});
}

let current: Promise<Me | null> | null = null;

/** The signed-in account (checked once per page load unless `refresh`); null when it can't be reached. */
export function getMe(refresh = false): Promise<Me | null> {
	if (current && !refresh) return current;
	current = call<Me>('/api/auth/me')
		.then((me) => {
			if (me.signedIn && me.playerId) {
				adopt({ playerId: me.playerId, name: me.name }, false);
				// Pick up progress posted from other devices.
				const solved = Object.entries(me.solved ?? {}).filter(
					([b]) => PUZZLES.some((p) => p.id === b) && !load().solved[b as PuzzleId],
				);
				if (solved.length) {
					update((p) => {
						for (const [b, at] of solved) p.solved[b as PuzzleId] = Date.parse(at) || Date.now();
					});
					document.dispatchEvent(new CustomEvent('secrets:solved', { detail: { id: solved[0][0] } }));
				}
				if (me.runner) setData('now-opened', true);
			} else if (load().name) {
				// The session ended (expired, or signed out elsewhere).
				update((p) => {
					p.name = undefined;
				});
			}
			return me;
		})
		.catch(() => null);
	return current;
}

/** Emails a sign-in link. Locally (AUTH_DEV_LINKS) the link comes back instead. */
export function startSignIn(email: string, turnstile: string): Promise<{ ok: boolean; devLink?: string }> {
	return call('/api/auth/start', { email, turnstile, playerId: load().playerId });
}

/** Finishes signing in with the token from the emailed link. */
export async function finishSignIn(token: string): Promise<{ playerId: string; email: string; name: string | null }> {
	const account = await call<{ playerId: string; email: string; name: string | null }>('/api/auth/verify', { token });
	adopt(account, true);
	current = null;
	return account;
}

export async function chooseName(name: string): Promise<string> {
	const res = await call<{ name: string }>('/api/auth/name', { name });
	update((p) => {
		p.name = res.name;
	});
	current = null;
	return res.name;
}

export async function signOut() {
	await call('/api/auth/logout', {}).catch(() => {});
	update((p) => {
		p.name = undefined;
	});
	current = null;
}

// ---- Turnstile ------------------------------------------------------------------------------

interface Turnstile {
	render(el: HTMLElement, opts: Record<string, unknown>): string;
	reset(id?: string): void;
	remove(id?: string): void;
}
let turnstileScript: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
	turnstileScript ??= new Promise<Turnstile>((resolve, reject) => {
		const w = window as unknown as { turnstile?: Turnstile };
		if (w.turnstile) return resolve(w.turnstile);
		const s = document.createElement('script');
		s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
		s.async = true;
		s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('turnstile')));
		s.onerror = () => {
			turnstileScript = null;
			reject(new Error('turnstile'));
		};
		document.head.append(s);
	});
	return turnstileScript;
}

/**
 * Puts a Turnstile check in `el`. `onToken` gets a token when it passes ('' when it expires). Returns a
 * function that resets it, for after a token has been used.
 */
export async function mountTurnstile(el: HTMLElement, siteKey: string, onToken: (token: string) => void): Promise<() => void> {
	const ts = await loadTurnstile();
	const id = ts.render(el, {
		sitekey: siteKey,
		theme: 'dark',
		size: 'flexible',
		callback: (t: string) => onToken(t),
		'expired-callback': () => onToken(''),
		'error-callback': () => onToken(''),
	});
	return () => {
		onToken('');
		ts.reset(id);
	};
}
