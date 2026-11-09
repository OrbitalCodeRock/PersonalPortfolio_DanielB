// Wires up the secret trigger words (<em class="secret-word" data-secret="…">, see Secret.astro).
// Each puzzle is its own lazily loaded chunk, so visitors who never click one download none of them.
import type { PuzzleId } from './config';
import { chime, closeAllWindows } from './ui';
import { load } from './progress';

type Launcher = () => Promise<{ launch: () => void }>;

// Each puzzle module in ./puzzles, loaded on first click.
const modules = import.meta.glob<{ launch: () => void }>('./puzzles/*.ts');
const file: Partial<Record<PuzzleId, string>> = {
	about: 'konami',
	education: 'adventure',
	now: 'runner',
	games: 'chess',
	web: 'golf',
	ml: 'holbein',
	projects: 'graph',
	skills: 'mystery',
	timeline: 'simplex',
	certs: 'slits',
};
const puzzles: Partial<Record<PuzzleId, Launcher>> = Object.fromEntries(
	Object.entries(file).map(([id, name]) => [id, modules[`./puzzles/${name}.ts`]]),
);

let started = false;

export function initSecrets() {
	if (started) return;
	started = true;

	let lastHover: Element | null = null;
	document.addEventListener('pointerover', (e) => {
		const word = (e.target as Element | null)?.closest?.('.secret-word');
		if (word && word !== lastHover) chime('hover');
		lastHover = word ?? null;
	});

	/** Puzzles still loading, so a second tap while the first loads (slow on phones) doesn't open it twice. */
	const loading = new Set<PuzzleId>();
	const activate = async (word: HTMLElement) => {
		const id = word.dataset.secret as PuzzleId;
		const loader = puzzles[id];
		if (!loader || loading.has(id)) return;
		loading.add(id);
		word.classList.add('is-awake');
		chime('open');
		try {
			(await loader()).launch();
		} catch (err) {
			console.error('Secret failed to load', err);
		} finally {
			loading.delete(id);
		}
	};

	document.addEventListener('click', (e) => {
		const word = (e.target as Element | null)?.closest?.<HTMLElement>('.secret-word');
		if (!word) return;
		e.preventDefault();
		void activate(word);
	});
	document.addEventListener('keydown', (e) => {
		const word = (e.target as Element | null)?.closest?.<HTMLElement>('.secret-word');
		if (word && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			void activate(word);
		}
	});

	// Leaving a page closes any open puzzle (and stops its animation loop).
	document.addEventListener('astro:before-swap', closeAllWindows);
	document.addEventListener('astro:page-load', applyTheme);
	document.addEventListener('secrets:change', applyTheme);
	applyTheme();

	// Post any solves that couldn't reach the leaderboards last time (e.g. while offline).
	if (load().name) void import('./boards').then((m) => m.syncQuietly());
}

/** The theme unlocked by finishing the hunt (see finale.ts and secrets.css). */
export function applyTheme() {
	const p = load();
	document.documentElement.toggleAttribute('data-secret-theme', !!(p.unlocked && p.theme));
	const toggle = document.querySelector<HTMLButtonElement>('.secret-theme-toggle');
	if (toggle) {
		toggle.hidden = !p.unlocked;
		toggle.setAttribute('aria-pressed', String(!!p.theme));
		// Say which way it's set, so a tap visibly does something.
		toggle.textContent = `✦ Aurora: ${p.theme ? 'on' : 'off'}`;
	}
}
