// About → "keyboard": 30 Lives. An old game's title screen that wants a cheat code: the Konami code
// (↑ ↑ ↓ ↓ ← → ← → B A), typed on the keyboard or pressed on the little controller underneath. Each
// press lights a slot; a wrong press resets them. Hints get plainer after a few failed tries.
import { KONAMI } from '../config';
import { isSolved } from '../progress';
import { chime, openWindow, solve } from '../ui';

const ID = 'about';
const GOLD = '#ffe7a3';
const GLYPH: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', b: 'B', a: 'A' };

const HINTS = [
	'Some doors only open for players who remember the old ways.',
	'Older than the web, and famous for handing out thirty lives. It starts with up.',
	'Up, up, down, down… then a little dance, and two letters to finish.',
];

const CSS = `
.km { display: grid; gap: 14px; }
.km-screen { position: relative; aspect-ratio: 4 / 3; max-height: 46vh; margin: 0 auto; width: 100%; border-radius: 14px; overflow: hidden;
	background: radial-gradient(ellipse at 50% 45%, #13183a 0%, #070918 70%, #02030a 100%);
	box-shadow: inset 0 0 40px rgba(0, 0, 0, .9), 0 0 0 6px #1a1d2c, 0 0 0 8px #2b2f45;
	display: grid; place-items: center; text-align: center; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
.km-screen::after { content: ''; position: absolute; inset: 0; pointer-events: none;
	background: repeating-linear-gradient(transparent 0 2px, rgba(0, 0, 0, .28) 2px 4px); }
.km-title { font-size: clamp(1.3rem, 5vw, 2.2rem); font-weight: 800; letter-spacing: .12em; color: #7fe3ff;
	text-shadow: 0 0 6px rgba(127, 227, 255, .8), 3px 3px 0 #3a2a8a; margin: 0 0 .4em; }
.km-start { color: #fff; letter-spacing: .3em; font-size: .9rem; animation: km-blink 1.1s steps(2, start) infinite; }
@keyframes km-blink { to { visibility: hidden; } }
.km-slots { display: flex; gap: 6px; justify-content: center; margin-top: 1.2em; }
.km-slot { width: 1.7em; height: 1.9em; display: grid; place-items: center; border: 2px solid rgba(127, 227, 255, .25);
	border-radius: 4px; color: #7fe3ff; font-weight: 700; }
.km-slot.is-on { border-color: ${GOLD}; color: ${GOLD}; text-shadow: 0 0 6px rgba(255, 210, 120, .7); }
.km-screen.is-wrong .km-slots { animation: km-shake .35s; }
@keyframes km-shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
.km-won { display: none; }
.km-screen.is-won .km-won { display: block; }
.km-screen.is-won .km-ready { display: none; }
.km-lives { font-size: clamp(1.6rem, 7vw, 3rem); font-weight: 800; color: ${GOLD}; letter-spacing: .1em;
	text-shadow: 0 0 10px rgba(255, 200, 110, .8), 3px 3px 0 #8a3a2a; }
.km-hearts { color: #ff6b8a; letter-spacing: .15em; margin-top: .4em; font-size: 1rem; word-break: break-all; max-width: 18em; }
.km-hint { margin: 0; text-align: center; color: var(--text-muted); min-height: 1.5em; }
.km-pad { display: flex; justify-content: center; align-items: center; gap: 36px; user-select: none; }
.km-dpad { display: grid; grid-template-columns: repeat(3, 40px); grid-template-rows: repeat(3, 40px); }
.km-btn { font: inherit; font-weight: 700; cursor: pointer; border: 1px solid var(--border-strong); color: var(--text);
	background: #1b2033; touch-action: manipulation; }
.km-btn:active, .km-btn.is-down { background: #2c3555; }
.km-dpad .km-btn { border-radius: 6px; }
.km-dpad [data-k="arrowup"] { grid-area: 1 / 2; }
.km-dpad [data-k="arrowleft"] { grid-area: 2 / 1; }
.km-dpad [data-k="arrowright"] { grid-area: 2 / 3; }
.km-dpad [data-k="arrowdown"] { grid-area: 3 / 2; }
.km-ab { display: flex; gap: 12px; transform: rotate(-18deg); }
.km-ab .km-btn { width: 48px; height: 48px; border-radius: 50%; background: #5a1f2c; border-color: #8a3a4a; }
.km-ab .km-btn:active, .km-ab .km-btn.is-down { background: #7a2a3c; }
`;

function injectStyle() {
	if (document.getElementById('secret-style-konami')) return;
	const s = document.createElement('style');
	s.id = 'secret-style-konami';
	s.textContent = CSS;
	document.head.append(s);
}

export function launch() {
	injectStyle();
	const win = openWindow({ title: 'Away from the keyboard', width: 560 });
	win.body.innerHTML = `
		<div class="km">
			<div class="km-screen" aria-live="polite">
				<div class="km-ready">
					<p class="km-title">STARFALL</p>
					<div class="km-start">PRESS START</div>
					<div class="km-slots" aria-label="Code entered so far">${KONAMI.map(() => '<span class="km-slot"></span>').join('')}</div>
				</div>
				<div class="km-won">
					<div class="km-lives">30 LIVES</div>
					<div class="km-hearts">${'♥'.repeat(30)}</div>
				</div>
			</div>
			<p class="km-hint"></p>
			<div class="km-pad" aria-label="Controller">
				<div class="km-dpad">
					<button type="button" class="km-btn" data-k="arrowup" aria-label="Up">▲</button>
					<button type="button" class="km-btn" data-k="arrowleft" aria-label="Left">◀</button>
					<button type="button" class="km-btn" data-k="arrowright" aria-label="Right">▶</button>
					<button type="button" class="km-btn" data-k="arrowdown" aria-label="Down">▼</button>
				</div>
				<div class="km-ab">
					<button type="button" class="km-btn" data-k="b" aria-label="B">B</button>
					<button type="button" class="km-btn" data-k="a" aria-label="A">A</button>
				</div>
			</div>
		</div>`;
	const screen = win.body.querySelector<HTMLElement>('.km-screen')!;
	const slots = [...win.body.querySelectorAll<HTMLElement>('.km-slot')];
	const hint = win.body.querySelector<HTMLElement>('.km-hint')!;

	let pos = 0;
	let fails = 0;
	let won = false;
	const showHint = () => {
		hint.textContent = won
			? 'Some codes never stop working. (Click the screen to play again.)'
			: HINTS[Math.min(HINTS.length - 1, Math.floor(fails / 3))];
	};
	const paint = () => slots.forEach((s, i) => {
		s.textContent = i < pos ? GLYPH[KONAMI[i]] : '';
		s.classList.toggle('is-on', i < pos);
	});

	function win30() {
		won = true;
		screen.classList.add('is-won');
		chime('solve');
		showHint();
		solve(ID);
	}

	function press(k: string) {
		if (won) return;
		if (k === KONAMI[pos]) {
			pos++;
			chime('hover');
			paint();
			if (pos === KONAMI.length) win30();
			return;
		}
		if (pos > 0 || !KONAMI.includes(k)) {
			// A wrong press resets; if it's the code's first press, it starts a new attempt.
			fails++;
			screen.classList.remove('is-wrong');
			void screen.offsetWidth;
			screen.classList.add('is-wrong');
			chime('error');
		}
		pos = k === KONAMI[0] ? 1 : 0;
		paint();
		showHint();
	}

	const onKey = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey || (e.target as Element | null)?.closest?.('input, textarea')) return;
		const k = e.key.toLowerCase();
		if (!(k in GLYPH) && k !== 'enter') return;
		e.preventDefault();
		if (k === 'enter') return;
		const btn = win.body.querySelector<HTMLElement>(`[data-k="${k}"]`);
		btn?.classList.add('is-down');
		setTimeout(() => btn?.classList.remove('is-down'), 120);
		press(k);
	};
	document.addEventListener('keydown', onKey);
	win.body.querySelector('.km-pad')!.addEventListener('click', (e) => {
		const k = (e.target as Element).closest<HTMLElement>('[data-k]')?.dataset.k;
		if (k) press(k);
	});
	// Once won, clicking the screen sets it up to play again.
	screen.addEventListener('click', () => {
		if (!won) return;
		won = false;
		pos = 0;
		fails = 0;
		screen.classList.remove('is-won');
		paint();
		showHint();
	});
	win.onClose(() => document.removeEventListener('keydown', onKey));

	if (isSolved(ID)) {
		won = true;
		screen.classList.add('is-won');
	}
	showHint();
}
