// The leaderboards: one per puzzle, plus "all" for people who found every secret, plus the rooftop
// runner's board of run times (runnerBoard.ts) for visitors who have found the runner. They live on the
// Leaderboards page (src/pages/leaderboard.astro), whose nav tab appears once a secret is solved. The API
// is the Cloudflare Worker in worker/index.ts (absent under `astro dev`, where the boards show as
// unreachable).
//
// A visitor signs in once (an emailed link; see account.ts) and picks a unique name. After that, every
// puzzle they solve is posted automatically; solves from before signing in, or made while offline, are
// posted the next time a sync runs. So are their best runs.
import { PHRASE, PUZZLES, type PuzzleId } from './config';
import { allSolved, isSolved, load, update } from './progress';
import { toast } from './ui';
import { AccountError, chooseName, getMe, mountTurnstile, signOut, startSignIn } from './account';
import {
	RUN_CATEGORIES,
	fetchRunBoard,
	fmtRunTime,
	hasFoundRunner,
	localBests,
	playRun,
	postPendingRuns,
	type RunCategory,
} from './runnerBoard';

export type BoardId = PuzzleId | 'all';
/** A tab on the page: a puzzle board, or the runner's. */
type TabId = BoardId | 'runner';

/** Where the boards report errors (a window's status strip, or a line on the page). */
export interface StatusLine {
	setStatus(text: string): void;
}

const API = '/api/leaderboard';

interface Entry {
	rank: number;
	name: string;
	solvedAt: string;
}

const BOARDS: BoardId[] = ['all', ...PUZZLES.map((p) => p.id)];

const CSS = `
.lb { display: grid; gap: 12px; }
.lb-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.lb-tab { font: inherit; font-size: .82rem; cursor: pointer; padding: 4px 10px; border-radius: 999px;
	border: 1px solid var(--border); background: transparent; color: var(--text-muted); }
.lb-tab:hover, .lb-tab:focus-visible { color: var(--text); border-color: var(--border-strong); }
.lb-tab[aria-selected="true"] { background: rgba(255, 210, 120, .14); border-color: rgba(255, 210, 120, .55); color: #ffe7a3; }
.lb-tab .lb-mine { color: #ffe7a3; }
.lb-head h4 { margin: 0 0 2px; font-size: 1.05rem; color: #ffe7a3; }
.lb-head p { margin: 0; color: var(--text-muted); font-size: .9rem; }
.lb ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 260px; overflow: auto; }
.lb li { display: grid; grid-template-columns: 3em 1fr auto; gap: 8px; padding: 4px 8px; border-radius: 6px; }
.lb li.is-me { background: rgba(255, 210, 120, .14); color: #ffe7a3; }
.lb li span:last-child { color: var(--text-muted); font-size: .85rem; }
.lb-sign { border-top: 1px solid var(--border); padding-top: 12px; font-size: .92rem; }
.lb-sign form { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.lb-sign .secret-input { flex: 1 1 180px; }
.lb-sign .lb-ts { flex: 1 1 100%; min-height: 65px; }
.lb-sign p { margin: 0 0 4px; }
.lb-sign .lb-dev { word-break: break-all; font-size: .8rem; }
.lb-link { all: unset; cursor: pointer; color: #ffe7a3; text-decoration: underline; text-underline-offset: 3px; }
.lb-cats { display: flex; gap: 6px; margin-top: 8px; }
.lb ol.lb-runs li { grid-template-columns: 3em 1fr auto auto auto; align-items: center; }
.lb-play { font: inherit; font-size: .8rem; cursor: pointer; padding: 2px 10px; border-radius: 999px;
	border: 1px solid var(--border); background: transparent; color: var(--text); }
.lb-play:hover, .lb-play:focus-visible { border-color: rgba(255, 210, 120, .55); color: #ffe7a3; }
`;

function injectStyle() {
	if (document.getElementById('secret-style-boards')) return;
	const s = document.createElement('style');
	s.id = 'secret-style-boards';
	s.textContent = CSS;
	document.head.append(s);
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const ordinal = (n: number) => {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const hasSolved = (board: BoardId) => (board === 'all' ? allSolved() : isSolved(board));

/** Boards this visitor has earned a place on but hasn't been posted to yet, oldest solve first. */
function pendingBoards(): BoardId[] {
	const p = load();
	const out: BoardId[] = PUZZLES.filter((x) => p.solved[x.id] && !p.ranks?.[x.id])
		.sort((a, b) => (p.solved[a.id] ?? 0) - (p.solved[b.id] ?? 0))
		.map((x) => x.id);
	if (allSolved() && !p.ranks?.all) out.push('all');
	return out;
}

class BoardError extends Error {}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Posts the visitor's name and any pending boards. Returns the new ranks. Runs one at a time, so a
 * solve and a page load can't post the same board twice. Throws BoardError with the server's message,
 * or a plain Error when the API can't be reached.
 */
export function sync(): Promise<Partial<Record<BoardId, number>>> {
	const run = async () => {
		const p = load();
		const boards = pendingBoards();
		// `name` is set only while signed in with a name (account.ts), so posting can work.
		if (!p.name) return {};
		if (!boards.length) {
			await postPendingRuns().catch(() => {});
			return {};
		}
		let res: Response;
		try {
			res = await fetch(API, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ boards, phrase: boards.includes('all') ? PHRASE : undefined }),
				credentials: 'same-origin',
			});
		} catch {
			throw new Error('offline');
		}
		const data = (await res.json().catch(() => ({}))) as { ranks?: Record<string, number>; error?: string };
		if (res.status === 401) {
			// Signed out since (the session expired): post again after the next sign-in.
			update((q) => {
				q.name = undefined;
			});
		}
		if (!res.ok || !data.ranks) throw data.error ? new BoardError(data.error) : new Error(String(res.status));
		const ranks = data.ranks;
		update((q) => {
			q.ranks = { ...q.ranks, ...ranks };
		});
		await postPendingRuns().catch(() => {});
		return ranks as Partial<Record<BoardId, number>>;
	};
	const next = chain.then(run, run);
	chain = next.catch(() => {});
	return next;
}

/** Posts in the background; offline or not signed is fine, it'll be retried later. */
export function syncQuietly(): Promise<Partial<Record<BoardId, number>>> {
	return sync().catch(() => ({}));
}

/** After a solve: post it, and say where the visitor placed. */
export async function announceSolve(id: PuzzleId) {
	if (!load().name) return;
	const ranks = await syncQuietly();
	const title = PUZZLES.find((p) => p.id === id)?.title ?? id;
	if (ranks[id]) toast(`You were the <b>${ordinal(ranks[id]!)}</b> to solve <i>${esc(title)}</i>.`, 6000);
}

/** Fills `root` with the board tabs, the chosen board and the sign-in form. */
export function renderBoards(root: HTMLElement, win: StatusLine, initial: TabId = 'all') {
	injectStyle();
	const tabsShown = (): TabId[] => (hasFoundRunner() ? [...BOARDS, 'runner'] : BOARDS);
	let current: TabId = tabsShown().includes(initial) ? initial : 'all';
	let category: RunCategory = 'random';
	let counts: Partial<Record<TabId, number>> = {};
	root.innerHTML = `
		<div class="lb">
			<div class="lb-tabs" role="tablist" aria-label="Leaderboards"></div>
			<div class="lb-head" aria-live="polite"></div>
			<div class="lb-list"></div>
			<div class="lb-sign"></div>
		</div>`;
	const tabs = root.querySelector<HTMLElement>('.lb-tabs')!;
	const head = root.querySelector<HTMLElement>('.lb-head')!;
	const list = root.querySelector<HTMLElement>('.lb-list')!;
	const sign = root.querySelector<HTMLElement>('.lb-sign')!;

	const label = (b: TabId) => (b === 'all' ? 'Every secret' : b === 'runner' ? 'Rooftops' : PUZZLES.find((p) => p.id === b)!.page);
	const title = (b: BoardId) => {
		if (b === 'all') return 'Found every secret';
		const info = PUZZLES.find((p) => p.id === b)!;
		return isSolved(b) ? info.title : `Something on the ${info.page} page`;
	};

	function renderTabs() {
		tabs.innerHTML = tabsShown()
			.map(
				(b) =>
					`<button type="button" role="tab" class="lb-tab" data-board="${b}" aria-selected="${b === current}">${
						b !== 'runner' && hasSolved(b) ? '<span class="lb-mine">✦</span> ' : ''
					}${label(b)}${counts[b] ? ` · ${counts[b]}` : ''}</button>`,
			)
			.join('');
	}
	tabs.addEventListener('click', (e) => {
		const b = (e.target as Element).closest<HTMLElement>('[data-board]')?.dataset.board as TabId | undefined;
		if (b && b !== current) {
			current = b;
			renderTabs();
			void showBoard();
		}
	});

	async function showRunner() {
		const me = localBests();
		const cat = category;
		const catName = (c: RunCategory) => (c === 'random' ? 'Random runs' : 'Chosen segments');
		head.innerHTML = `<h4>Rooftops</h4><p></p><div class="lb-cats" role="tablist" aria-label="Run categories">${RUN_CATEGORIES.map(
			(c) => `<button type="button" role="tab" class="lb-tab" data-cat="${c}" aria-selected="${c === cat}">${catName(c)}</button>`,
		).join('')}</div>`;
		const note = head.querySelector('p')!;
		head.querySelector('.lb-cats')!.addEventListener('click', (e) => {
			const c = (e.target as Element).closest<HTMLElement>('[data-cat]')?.dataset.cat as RunCategory | undefined;
			if (c && c !== category) {
				category = c;
				void showRunner();
			}
		});
		list.innerHTML = '<p class="secret-hint">Loading…</p>';
		const mine = me[cat];
		try {
			const board = await fetchRunBoard(cat);
			if (current !== 'runner' || cat !== category) return;
			note.innerHTML =
				(cat === 'random'
					? 'Each player’s longest ordinary run. '
					: 'Runs that start from picked segments or a replay. ') +
				(board.me
					? `Your best is <b>${fmtRunTime(board.me.seconds)}</b>, <b>${ordinal(board.me.rank)}</b> of ${board.total}.`
					: mine
						? load().name
							? `Your best, ${fmtRunTime(mine.seconds)}, will be added shortly.`
							: `Your best is ${fmtRunTime(mine.seconds)}. Sign below to post it.`
						: board.total
							? ''
							: 'Nobody is on this board yet.');
			list.innerHTML = board.entries.length
				? `<ol class="lb-runs">${board.entries
						.map(
							(e) =>
								`<li class="${board.me?.runId === e.runId ? 'is-me' : ''}"><span>${ordinal(e.rank)}</span><span>${esc(e.name)}</span><span>${fmtRunTime(e.seconds)}</span><span>${e.distance} m</span><button type="button" class="lb-play" data-run="${e.runId}" title="Play the same segments">Play</button></li>`,
						)
						.join('')}</ol>`
				: '';
		} catch {
			if (current !== 'runner' || cat !== category) return;
			note.textContent = mine ? `Your best is ${fmtRunTime(mine.seconds)}.` : '';
			list.innerHTML = '<p class="secret-hint">The leaderboards can’t be reached right now. Your best runs are saved here.</p>';
		}
	}
	list.addEventListener('click', async (e) => {
		const btn = (e.target as Element).closest<HTMLButtonElement>('[data-run]');
		if (!btn) return;
		btn.disabled = true;
		try {
			await playRun(btn.dataset.run!);
		} catch (err) {
			win.setStatus(err instanceof Error && err.message.includes('rebuilt') ? err.message : 'That run can’t be loaded right now.');
		}
		btn.disabled = false;
	});

	async function showBoard() {
		if (current === 'runner') return showRunner();
		const board = current;
		const me = load();
		const mine = me.ranks?.[board];
		head.innerHTML = `<h4>${esc(title(board))}</h4><p></p>`;
		const note = head.querySelector('p')!;
		list.innerHTML = '<p class="secret-hint">Loading…</p>';
		try {
			const res = await fetch(`${API}?board=${board}`);
			if (!res.ok) throw new Error(String(res.status));
			const { entries, total } = (await res.json()) as { entries: Entry[]; total: number };
			if (board !== current) return;
			counts[board] = total;
			renderTabs();
			note.innerHTML = mine
				? `You were <b>${ordinal(mine)}</b> of ${total}.`
				: hasSolved(board)
					? me.name
						? 'You solved this one; your place will be added shortly.'
						: 'You solved this one. Sign below to take your place.'
					: total
						? `${total} ${total === 1 ? 'person has' : 'people have'} found this one.`
						: 'Nobody has found this one yet.';
			list.innerHTML = entries.length
				? `<ol>${entries
						.map(
							(e) =>
								`<li class="${e.rank === mine ? 'is-me' : ''}"><span>${ordinal(e.rank)}</span><span>${esc(e.name)}</span><span>${new Date(e.solvedAt).toLocaleDateString()}</span></li>`,
						)
						.join('')}</ol>`
				: '';
		} catch {
			if (board !== current) return;
			note.textContent = mine ? `You were ${ordinal(mine)}.` : '';
			list.innerHTML = '<p class="secret-hint">The leaderboards can’t be reached right now. Your progress is saved here.</p>';
		}
	}

	let removeTurnstile: (() => void) | null = null;
	/** The sign-in area: ask for an email link, pick a name, or show who's signed in. */
	async function renderSign(editing = false) {
		removeTurnstile = null;
		sign.innerHTML = '<p class="secret-hint">Checking whether you’re signed in…</p>';
		const me = await getMe();
		if (!me) {
			sign.innerHTML = '<p class="secret-hint">Signing in isn’t available right now.</p>';
			return;
		}
		if (!me.signedIn) return renderEmailForm(me.turnstileSiteKey);
		if (!me.name || editing) return renderNameForm(me.name ?? '', !!me.name);
		sign.innerHTML = `<p>Signed in as <b>${esc(me.name)}</b> (${esc(me.email ?? '')}). Puzzles you solve and your best runs are added for you.</p>
			<button type="button" class="lb-link" data-act="rename">Change name</button> · <button type="button" class="lb-link" data-act="out">Sign out</button>`;
		sign.querySelector('[data-act="rename"]')!.addEventListener('click', () => void renderSign(true));
		sign.querySelector('[data-act="out"]')!.addEventListener('click', async () => {
			await signOut();
			await getMe(true);
			void renderSign();
		});
	}

	function renderEmailForm(siteKey: string) {
		sign.innerHTML = `
			<p>Sign in to put your name on the boards: every puzzle you’ve solved and your best runs. We’ll email you a link, no
			password needed, and this browser stays signed in for 60 days. Your email is only used for signing in and is
			never shown.</p>
			<form>
				<input class="secret-input" name="email" type="email" maxlength="254" required placeholder="you@example.com" autocomplete="email">
				<button class="secret-btn" type="submit" disabled>Email me a link</button>
				<div class="lb-ts"></div>
			</form>`;
		const form = sign.querySelector('form')!;
		const input = form.querySelector('input')!;
		const button = form.querySelector('button')!;
		let token = '';
		mountTurnstile(form.querySelector<HTMLElement>('.lb-ts')!, siteKey, (t) => {
			token = t;
			button.disabled = !t;
		})
			.then((reset) => (removeTurnstile = reset))
			.catch(() => win.setStatus('The human check couldn’t load. Check your connection, or allow challenges.cloudflare.com.'));
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			if (!token) return;
			button.disabled = true;
			win.setStatus('');
			try {
				const res = await startSignIn(input.value.trim(), token);
				sign.innerHTML = `<p>Check <b>${esc(input.value.trim())}</b> for a sign-in link. It works once, for 20 minutes.
					You can close this page; the link brings you back.</p>${
						res.devLink ? `<p class="lb-dev">Local testing: <a href="${esc(res.devLink)}">${esc(res.devLink)}</a></p>` : ''
					}<button type="button" class="lb-link">Use a different email</button>`;
				sign.querySelector('button')!.addEventListener('click', () => void renderSign());
			} catch (err) {
				win.setStatus(err instanceof AccountError ? err.message : 'Signing in isn’t available right now. Please try again later.');
				removeTurnstile?.();
			}
		});
	}

	function renderNameForm(name: string, renaming: boolean) {
		sign.innerHTML = `
			<p>${renaming ? 'Change the name shown on the boards.' : 'You’re signed in. Pick the name to show on the boards; each name belongs to one person.'}</p>
			<form>
				<input class="secret-input" name="name" maxlength="24" required placeholder="Your name or handle" autocomplete="nickname">
				<button class="secret-btn" type="submit">Save</button>
				${renaming ? '<button class="secret-btn" type="button" data-act="cancel">Cancel</button>' : ''}
			</form>`;
		const form = sign.querySelector('form')!;
		const input = form.querySelector('input')!;
		input.value = name;
		form.querySelector('[data-act="cancel"]')?.addEventListener('click', () => void renderSign());
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			const next = input.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
			if (!next) return;
			form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = true;
			win.setStatus('');
			try {
				await chooseName(next);
				await getMe(true);
				await sync().catch(() => {});
				void renderSign();
				renderTabs();
				await showBoard();
			} catch (err) {
				win.setStatus(err instanceof AccountError ? err.message : 'The leaderboards can’t be reached right now.');
				form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = false;
				input.focus();
			}
		});
		input.focus();
	}

	renderTabs();
	void renderSign();
	// Check the account (picking up progress from other devices), then post anything pending, so the
	// board shows this visitor's place.
	void getMe()
		.then(() => syncQuietly())
		.then(async () => {
		renderTabs();
		await showBoard();
		try {
			const res = await fetch(API);
			if (res.ok) {
				counts = { ...((await res.json()) as { counts: typeof counts }).counts, ...counts };
				renderTabs();
			}
		} catch {
			/* counts are optional */
		}
	});
}

/** Goes to the Leaderboards page, on this board. */
export function showBoards(initial: BoardId = 'all') {
	const url = `/leaderboard?board=${initial}`;
	void import('astro:transitions/client').then((m) => m.navigate(url)).catch(() => (location.href = url));
}
