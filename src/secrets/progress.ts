// Puzzle progress, kept in this browser's localStorage. Every read and write is guarded:
// storage can be blocked (private windows, strict settings), and the hunt must still run.
import { PUZZLES, type PuzzleId } from './config';

const KEY = 'db-secrets-v1';

export interface Progress {
	/** Puzzle id → time it was solved (ms). */
	solved: Partial<Record<PuzzleId, number>>;
	/** Random id for this browser, so the leaderboard takes one entry per player. */
	playerId: string;
	/** Set once the finale is reached and the special theme is unlocked. */
	unlocked?: boolean;
	/** The unlocked theme is switched on. */
	theme?: boolean;
	/** Name on the leaderboards, once the visitor has signed. Solves are posted automatically after that. */
	name?: string;
	/** Board id ('all' or a puzzle id) → rank returned by the leaderboard, once posted. */
	ranks?: Partial<Record<string, number>>;
	/** Free-form per-puzzle state (e.g. hints found), owned by each puzzle. */
	data: Record<string, unknown>;
}

let memory: Progress | null = null;

function fresh(): Progress {
	const id =
		typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return { solved: {}, playerId: id, data: {} };
}

export function load(): Progress {
	if (memory) return memory;
	let stored: Progress | null = null;
	try {
		const raw = localStorage.getItem(KEY);
		if (raw) stored = JSON.parse(raw) as Progress;
	} catch {
		/* storage unavailable or corrupt: start fresh */
	}
	memory = stored && stored.playerId ? { ...fresh(), ...stored, data: stored.data ?? {} } : fresh();
	return memory;
}

function save(p: Progress) {
	memory = p;
	try {
		localStorage.setItem(KEY, JSON.stringify(p));
	} catch {
		/* keep it in memory for this page view */
	}
	document.dispatchEvent(new CustomEvent('secrets:change', { detail: p }));
}

export function update(fn: (p: Progress) => void) {
	const p = load();
	fn(p);
	save(p);
}

export function isSolved(id: PuzzleId): boolean {
	return !!load().solved[id];
}

/** Marks a puzzle solved. Returns true the first time. Fires `secrets:solved`. */
export function markSolved(id: PuzzleId): boolean {
	if (isSolved(id)) return false;
	update((p) => {
		p.solved[id] = Date.now();
	});
	document.dispatchEvent(new CustomEvent('secrets:solved', { detail: { id } }));
	return true;
}

export function solvedCount(): number {
	return PUZZLES.filter((p) => isSolved(p.id)).length;
}

export function allSolved(): boolean {
	return solvedCount() === PUZZLES.length;
}

/** Letters of the hangman phrase revealed by solved puzzles. */
export function revealedLetters(): Set<string> {
	return new Set(PUZZLES.filter((p) => p.letter && isSolved(p.id)).map((p) => p.letter!));
}

export function getData<T>(key: string, fallback: T): T {
	const v = load().data[key];
	return v === undefined ? fallback : (v as T);
}

export function setData(key: string, value: unknown) {
	update((p) => {
		p.data[key] = value;
	});
}
