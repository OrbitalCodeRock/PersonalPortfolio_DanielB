// Types and helpers shared by the Worker's modules (index.ts, auth.ts).

export interface D1Result<T> {
	results: T[];
}
export interface D1Prepared {
	bind(...values: unknown[]): D1Prepared;
	first<T>(): Promise<T | null>;
	all<T>(): Promise<D1Result<T>>;
	run(): Promise<{ meta?: { changes?: number } }>;
}

export interface Env {
	ASSETS: { fetch(request: Request): Promise<Response> };
	DB: { prepare(sql: string): D1Prepared; batch(statements: D1Prepared[]): Promise<unknown[]> };
	/** Turnstile's public site key (a var in wrangler.jsonc). Cloudflare's always-pass test key if unset. */
	TURNSTILE_SITE_KEY?: string;
	/** Turnstile's secret key (`wrangler secret put TURNSTILE_SECRET`). */
	TURNSTILE_SECRET?: string;
	/** Cloudflare Email Service send binding ("send_email" in wrangler.jsonc), if used. */
	EMAIL?: { send(message: { to: string; from: string; subject: string; text: string; html: string }): Promise<unknown> };
	/** Or a Resend API key (`wrangler secret put RESEND_API_KEY`). */
	RESEND_API_KEY?: string;
	/** The sender for sign-in emails, e.g. "Daniel Beyer <signin@example.com>". */
	EMAIL_FROM?: string;
	/** Local testing only ("1" in .dev.vars): sign-in links are returned to the page instead of emailed. */
	AUTH_DEV_LINKS?: string;
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
	});

export const ID_RE = /^[\w-]{8,64}$/;

/** Visible characters only, trimmed. */
export const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '');
