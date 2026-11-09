// Shared UI for the secret puzzles: a floating window, a "solved" toast and small sound cues.
// Styles are in src/styles/secrets.css.
import { PUZZLES, type PuzzleId } from './config';
import { allSolved, markSolved } from './progress';

export interface SecretWindow {
	/** The outer window element. */
	root: HTMLElement;
	/** Put the puzzle's content in here. */
	body: HTMLElement;
	/** A one-line status strip at the bottom (hidden while empty). */
	setStatus(text: string): void;
	close(): void;
	/** Runs when the window closes for any reason (button, Escape, leaving the page). Stop loops here. */
	onClose(fn: () => void): void;
}

export interface WindowOptions {
	title: string;
	/** Preferred content width in px (the window shrinks on small screens). */
	width?: number;
	/** 'terminal' gives a black monospace body. */
	variant?: 'default' | 'terminal';
	/** Escape closes the window unless this is false (e.g. a game that uses Escape). */
	closeOnEscape?: boolean;
}

const open = new Set<SecretWindow>();

export function openWindow(opts: WindowOptions): SecretWindow {
	const lastFocus = document.activeElement as HTMLElement | null;
	const backdrop = document.createElement('div');
	backdrop.className = 'secret-backdrop';
	const root = document.createElement('section');
	root.className = `secret-window${opts.variant === 'terminal' ? ' is-terminal' : ''}`;
	root.setAttribute('role', 'dialog');
	root.setAttribute('aria-modal', 'true');
	root.setAttribute('aria-label', opts.title);
	root.tabIndex = -1;
	if (opts.width) root.style.setProperty('--secret-w', `${opts.width}px`);
	root.innerHTML = `
		<header class="secret-titlebar">
			<h2 class="secret-title"></h2>
			<button type="button" class="secret-close" aria-label="Close">✕</button>
		</header>
		<div class="secret-body"></div>
		<p class="secret-status" aria-live="polite" hidden></p>`;
	root.querySelector('.secret-title')!.textContent = opts.title;
	backdrop.append(root);
	document.body.append(backdrop);

	const body = root.querySelector<HTMLElement>('.secret-body')!;
	const status = root.querySelector<HTMLElement>('.secret-status')!;
	const closers: (() => void)[] = [];
	let closed = false;

	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && opts.closeOnEscape !== false && topWindow() === win) {
			e.preventDefault();
			win.close();
		}
	};

	const win: SecretWindow = {
		root,
		body,
		setStatus(text) {
			status.textContent = text;
			status.hidden = !text;
		},
		close() {
			if (closed) return;
			closed = true;
			open.delete(win);
			document.removeEventListener('keydown', onKey, true);
			for (const fn of closers) {
				try {
					fn();
				} catch (err) {
					console.error(err);
				}
			}
			backdrop.classList.add('is-closing');
			setTimeout(() => backdrop.remove(), 180);
			lastFocus?.focus?.();
		},
		onClose(fn) {
			closers.push(fn);
		},
	};

	root.querySelector('.secret-close')!.addEventListener('click', () => win.close());
	backdrop.addEventListener('pointerdown', (e) => {
		if (e.target === backdrop) win.close();
	});
	// Capture phase, so Escape closes the window before the page (e.g. the sky view) sees it.
	document.addEventListener('keydown', onKey, true);
	open.add(win);
	requestAnimationFrame(() => root.focus({ preventScroll: true }));
	return win;
}

function topWindow(): SecretWindow | undefined {
	return [...open].at(-1);
}

export function closeAllWindows() {
	for (const w of [...open]) w.close();
}

/** A small message in the corner. */
export function toast(html: string, ms = 5200): HTMLElement {
	let shelf = document.querySelector<HTMLElement>('.secret-toasts');
	if (!shelf) {
		shelf = document.createElement('div');
		shelf.className = 'secret-toasts';
		shelf.setAttribute('aria-live', 'polite');
		document.body.append(shelf);
	}
	const t = document.createElement('div');
	t.className = 'secret-toast';
	t.innerHTML = html;
	shelf.append(t);
	setTimeout(() => {
		t.classList.add('is-leaving');
		setTimeout(() => t.remove(), 400);
	}, ms);
	return t;
}

/**
 * Call when a puzzle is solved. Records it, plays a chime and offers the leaderboard.
 * Safe to call more than once.
 */
export function solve(id: PuzzleId) {
	if (!markSolved(id)) return;
	const info = PUZZLES.find((p) => p.id === id);
	chime('solve');
	const t = toast(
		`<strong>✦ Secret solved: ${info?.title ?? id}</strong><br><button type="button" class="secret-toast-link">See who else found it</button>`,
		8000,
	);
	const boards = import('./boards');
	t.querySelector('button')!.addEventListener('click', () => boards.then((m) => m.showBoards(id)));
	void boards.then((m) => m.announceSolve(id));
	if (allSolved()) {
		setTimeout(() => {
			import('./finale').then((m) => m.showFinale());
		}, 900);
	}
}

// ---- Sound ----------------------------------------------------------------------------------
// Tiny synthesized cues. Browsers only allow audio after the visitor has clicked or typed on the
// page, so a hover before any click is silent; that's fine, the visual cue carries it.

let audio: AudioContext | null = null;

function ctx(): AudioContext | null {
	try {
		audio ??= new AudioContext();
		if (audio.state === 'suspended') void audio.resume();
		return audio.state === 'running' ? audio : null;
	} catch {
		return null;
	}
}

export function chime(kind: 'hover' | 'open' | 'solve' | 'error' = 'hover') {
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches && kind === 'hover') return;
	const a = ctx();
	if (!a) return;
	const notes: Record<typeof kind, number[]> = {
		hover: [1318.5],
		open: [659.3, 987.8],
		solve: [523.3, 659.3, 784, 1046.5],
		error: [196, 185],
	};
	const vol = kind === 'hover' ? 0.025 : 0.06;
	notes[kind].forEach((f, i) => {
		const t = a.currentTime + i * 0.09;
		const osc = a.createOscillator();
		const gain = a.createGain();
		osc.type = kind === 'error' ? 'square' : 'sine';
		osc.frequency.value = f;
		gain.gain.setValueAtTime(0, t);
		gain.gain.linearRampToValueAtTime(vol, t + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'hover' ? 0.35 : 0.6));
		osc.connect(gain).connect(a.destination);
		osc.start(t);
		osc.stop(t + 0.7);
	});
}
