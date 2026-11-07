// About → "keyboard": the finale puzzle. A hangman-style phrase whose letters are also handed out by
// every other puzzle, so it doubles as the hunt's progress tracker. Wrong guesses put out the stars
// of a little constellation instead of drawing a gallows.
import { PHRASE, PUZZLES } from '../config';
import { allSolved, isSolved, revealedLetters } from '../progress';
import { chime, openWindow, solve } from '../ui';

const MAX_MISSES = 6;
const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
// A seven-star dipper-like constellation; one star goes out per miss (the last one never does).
const STARS: [number, number][] = [
	[18, 62],
	[44, 52],
	[70, 56],
	[92, 44],
	[128, 40],
	[136, 70],
	[100, 76],
];

const CSS = `
.hm { display: grid; gap: 16px; }
.hm-boards { justify-self: start; }
.hm-sky { display: block; width: 100%; max-width: 260px; margin: 0 auto; }
.hm-phrase { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px 22px; font-family: var(--font-display); }
.hm-word { display: flex; gap: 6px; }
.hm-slot { width: 1.6em; height: 2em; display: grid; place-items: end center; font-size: 1.3rem; font-weight: 700;
  border-bottom: 2px solid var(--text-muted); color: var(--text); }
.hm-slot.is-gift { color: #ffe7a3; border-color: #ffe7a3; text-shadow: 0 0 8px rgba(255, 200, 110, .6); }
.hm-keys { display: grid; gap: 6px; justify-items: center; }
.hm-row { display: flex; gap: 5px; }
.hm-key { font: inherit; font-weight: 600; width: 2.2em; height: 2.4em; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--border-strong); background: rgba(111, 182, 255, .1); color: var(--text); padding: 0; }
.hm-key:hover:not([disabled]) { background: rgba(111, 182, 255, .25); }
.hm-key[disabled] { cursor: default; opacity: .35; }
.hm-key.is-hit { opacity: 1; background: rgba(255, 210, 120, .22); border-color: #ffe7a3; color: #ffe7a3; }
.hm-msg { text-align: center; min-height: 1.5em; margin: 0; }
.hm-progress { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 4px 12px; font-size: .85rem; color: var(--text-muted); }
.hm-progress li.is-done { color: var(--text); }
.hm-progress b { color: #ffe7a3; }
.hm details summary { cursor: pointer; color: var(--text-muted); font-size: .9rem; }
@media (max-width: 420px) { .hm-key { width: 1.75em; height: 2.2em; font-size: .85rem; } .hm-row { gap: 3px; } }
`;

function injectStyle() {
	if (document.getElementById('secret-style-hangman')) return;
	const s = document.createElement('style');
	s.id = 'secret-style-hangman';
	s.textContent = CSS;
	document.head.append(s);
}

export function launch() {
	injectStyle();
	const win = openWindow({ title: 'Away from the keyboard', width: 600 });
	const gifts = revealedLetters();
	const guessed = new Set<string>();
	let misses = 0;
	let over = isSolved('about');

	win.body.innerHTML = `
		<div class="hm">
			<svg class="hm-sky" viewBox="0 0 154 96" aria-hidden="true"></svg>
			<div class="hm-phrase" aria-label="The phrase"></div>
			<p class="hm-msg" aria-live="polite"></p>
			<div class="hm-keys"></div>
			<details>
				<summary>Letters found elsewhere</summary>
				<ul class="hm-progress"></ul>
			</details>
			<button type="button" class="secret-btn hm-boards">Leaderboards</button>
		</div>`;
	const sky = win.body.querySelector('svg')!;
	const phraseEl = win.body.querySelector<HTMLElement>('.hm-phrase')!;
	const msg = win.body.querySelector<HTMLElement>('.hm-msg')!;
	const keys = win.body.querySelector<HTMLElement>('.hm-keys')!;
	const progress = win.body.querySelector<HTMLElement>('.hm-progress')!;
	win.body
		.querySelector('.hm-boards')!
		.addEventListener('click', () => import('../boards').then((m) => m.showBoards()));

	const letters = new Set(PHRASE.replace(/[^A-Z]/g, ''));
	const known = (c: string) => gifts.has(c) || guessed.has(c) || over;

	// Progress list: one line per other puzzle, with its letter once solved.
	progress.innerHTML = PUZZLES.filter((p) => p.letter)
		.map((p) =>
			isSolved(p.id)
				? `<li class="is-done">✦ ${p.page}: <b>${p.letter}</b></li>`
				: `<li>· ${p.page}: ?</li>`,
		)
		.join('');

	for (const row of ROWS) {
		const r = document.createElement('div');
		r.className = 'hm-row';
		for (const c of row) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'hm-key';
			b.textContent = c;
			b.dataset.key = c;
			b.addEventListener('click', () => guess(c));
			r.append(b);
		}
		keys.append(r);
	}

	function render() {
		phraseEl.innerHTML = PHRASE.split(' ')
			.map(
				(w) =>
					`<span class="hm-word">${[...w]
						.map((c) => `<span class="hm-slot${gifts.has(c) ? ' is-gift' : ''}">${known(c) ? c : ''}</span>`)
						.join('')}</span>`,
			)
			.join('');
		keys.querySelectorAll<HTMLButtonElement>('.hm-key').forEach((b) => {
			const c = b.dataset.key!;
			const used = guessed.has(c) || gifts.has(c);
			b.disabled = used || over || misses >= MAX_MISSES;
			b.classList.toggle('is-hit', used && letters.has(c));
		});
		const lit = STARS.length - Math.min(misses, MAX_MISSES);
		sky.innerHTML =
			STARS.slice(0, -1)
				.map(([x, y], i) => {
					const [x2, y2] = STARS[i + 1];
					const on = i + 1 < lit;
					return `<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}" stroke="${on ? 'rgba(255,231,163,.5)' : 'rgba(147,161,196,.15)'}" stroke-width="1"/>`;
				})
				.join('') +
			STARS.map(([x, y], i) => {
				const on = i < lit;
				return `<circle cx="${x}" cy="${y}" r="${on ? 3.4 : 2}" fill="${on ? '#ffe7a3' : '#2a3350'}"${on ? ' style="filter:drop-shadow(0 0 4px #ffcf7a)"' : ''}/>`;
			}).join('');
	}

	function guess(c: string) {
		if (over || misses >= MAX_MISSES || guessed.has(c) || gifts.has(c)) return;
		guessed.add(c);
		if (letters.has(c)) {
			chime('open');
			if ([...letters].every(known)) {
				over = true;
				render();
				msg.innerHTML = '<strong style="color:#ffe7a3">Keep looking up.</strong>';
				solve('about');
				if (!allSolved()) {
					const left = PUZZLES.filter((p) => !isSolved(p.id)).length;
					win.setStatus(`The phrase is yours. ${left} secret${left === 1 ? '' : 's'} still hide around the site.`);
				}
				return;
			}
			msg.textContent = '';
		} else {
			misses++;
			chime('error');
			msg.textContent =
				misses >= MAX_MISSES ? 'The last star holds on. Try again when the sky clears.' : 'A star goes out.';
		}
		render();
		if (misses >= MAX_MISSES) {
			const again = document.createElement('button');
			again.className = 'secret-btn';
			again.textContent = 'Try again';
			again.addEventListener('click', () => {
				guessed.clear();
				misses = 0;
				msg.textContent = '';
				again.remove();
				render();
			});
			msg.after(again);
		}
	}

	const onKey = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const c = e.key.toUpperCase();
		if (/^[A-Z]$/.test(c)) guess(c);
	};
	document.addEventListener('keydown', onKey);
	win.onClose(() => document.removeEventListener('keydown', onKey));

	if (over) {
		msg.innerHTML = '<strong style="color:#ffe7a3">Keep looking up.</strong>';
		if (allSolved()) {
			const b = document.createElement('button');
			b.className = 'secret-btn';
			b.textContent = 'To be continued…';
			b.addEventListener('click', () => import('../finale').then((m) => m.showFinale()));
			msg.after(b);
		}
	} else {
		win.setStatus(
			gifts.size
				? `${gifts.size} letter${gifts.size === 1 ? '' : 's'} came from secrets you found elsewhere.`
				: 'Every secret on this site gives up a letter. Guess the rest.',
		);
	}
	render();
}
