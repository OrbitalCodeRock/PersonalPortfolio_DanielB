// The rooftop runner's leaderboard (the Now page's secret): each signed player's best run per category,
// saved with the segments it played so anyone can replay it. The API is in worker/index.ts.
//
// Categories: 'random' for ordinary runs; 'chosen' for runs that start from segments the player picked,
// or from a replay (of their own run or someone else's).
//
// The visitor's best run in each category is kept here too. It's posted when they're signed in with a
// name (account.ts), now or the next time a sync runs, so a best set before signing in isn't lost.
import type { Recipe } from './runner/levelgen';
import { getData, load, setData, update } from './progress';

export type RunCategory = 'random' | 'chosen';
export const RUN_CATEGORIES: RunCategory[] = ['random', 'chosen'];

/** A segment of a run: its pools version and recipe id (see runner/poolVersion.ts). */
export interface SegmentRef {
	v: string;
	id: string;
}

export interface RunRecord {
	category: RunCategory;
	seconds: number;
	distance: number;
	segments: SegmentRef[];
	/** Set once the server has it. */
	runId?: string;
	posted?: boolean;
	rank?: number;
}

export interface BoardEntry {
	rank: number;
	name: string;
	seconds: number;
	distance: number;
	segments: number;
	runId: string;
	at: string;
}

/** A run fetched for replaying: its segments come with their recipes. */
export interface ReplayRun {
	id: string;
	name: string;
	category: RunCategory;
	seconds: number;
	distance: number;
	segments: (SegmentRef & { recipe: Recipe | null })[];
}

const KEY = 'now-runs';

export const localBests = () => getData<Partial<Record<RunCategory, RunRecord>>>(KEY, {});

/** Whether the visitor has opened the runner (the leaderboard keeps it hidden from those who haven't). */
export const hasFoundRunner = () => getData<boolean>('now-opened', false);

export const fmtRunTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

let chain: Promise<unknown> = Promise.resolve();

/**
 * Posts any local bests the server doesn't have yet (only when signed). Runs one at a time. Returns the
 * categories that were posted, with their ranks.
 */
export function postPendingRuns(): Promise<Partial<Record<RunCategory, number>>> {
	const run = async () => {
		const p = load();
		if (!p.name) return {};
		const out: Partial<Record<RunCategory, number>> = {};
		for (const cat of RUN_CATEGORIES) {
			const best = localBests()[cat];
			if (!best || best.posted) continue;
			const res = await fetch('/api/runner/run', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({
					category: cat,
					seconds: best.seconds,
					distance: best.distance,
					segments: best.segments,
				}),
			});
			const data = (await res.json().catch(() => ({}))) as { runId?: string; rank?: number; error?: string };
			if (res.status === 409) {
				// Its segments are gone from the server (pools changed before it was posted): drop it.
				const all = localBests();
				delete all[cat];
				setData(KEY, all);
				continue;
			}
			if (res.status === 401) {
				// Signed out since: posted after the next sign-in.
				update((q) => {
					q.name = undefined;
				});
			}
			if (!res.ok) throw new Error(data.error ?? String(res.status));
			const all = localBests();
			if (all[cat] && all[cat]!.seconds === best.seconds) {
				all[cat] = { ...best, posted: true, runId: data.runId ?? best.runId, rank: data.rank };
				setData(KEY, all);
			}
			if (data.rank) out[cat] = data.rank;
		}
		return out;
	};
	const next = chain.then(run, run);
	chain = next.catch(() => {});
	return next;
}

/**
 * After a run ends: keeps it if it's the visitor's best in its category, and posts it if they're signed.
 * Says what happened, for the game to show.
 */
export async function recordRun(run: RunRecord): Promise<{ best: boolean; rank?: number; signed: boolean; offline?: boolean }> {
	const signed = !!load().name;
	const all = localBests();
	if (!run.segments.length || (all[run.category] && all[run.category]!.seconds >= run.seconds)) return { best: false, signed };
	all[run.category] = { ...run, posted: false, runId: undefined, rank: undefined };
	setData(KEY, all);
	if (!signed) return { best: true, signed };
	try {
		const ranks = await postPendingRuns();
		return { best: true, signed, rank: ranks[run.category] };
	} catch {
		return { best: true, signed, offline: true };
	}
}

export async function fetchRunBoard(
	category: RunCategory,
): Promise<{ total: number; entries: BoardEntry[]; me?: { rank: number; seconds: number; runId: string } }> {
	const res = await fetch(`/api/runner/board?category=${category}&player=${encodeURIComponent(load().playerId)}`);
	if (!res.ok) throw new Error(String(res.status));
	return res.json();
}

export async function fetchRun(id: string): Promise<ReplayRun> {
	const res = await fetch(`/api/runner/run?id=${encodeURIComponent(id)}`);
	if (!res.ok) throw new Error(String(res.status));
	return res.json();
}

/** Opens the runner on a leaderboard run. */
export async function playRun(id: string) {
	const run = await fetchRun(id);
	const segments = run.segments.filter((s) => s.recipe);
	if (!segments.length) throw new Error('That run can’t be rebuilt.');
	const { launch } = await import('./puzzles/runner');
	launch({
		plan: {
			label: `${run.name}’s run`,
			segments: segments.map((s) => ({ v: s.v, recipe: { ...s.recipe!, id: s.id } })),
			target: { name: run.name, seconds: run.seconds },
		},
	});
}
