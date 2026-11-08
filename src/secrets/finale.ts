// Shown once every puzzle is solved: "To be continued…", the unlocked theme, and the leaderboards
// (opened on the "Every secret" board; see boards.ts).
import { PUZZLES } from './config';
import { renderBoards } from './boards';
import { allSolved, update } from './progress';
import { openWindow } from './ui';

const CSS = `
.fin { display: grid; gap: 14px; }
.fin-intro { text-align: center; }
.fin h3 { margin: 0 0 8px; font-family: Georgia, serif; font-size: 1.8rem; font-weight: 400; font-style: italic; color: #ffe7a3; }
`;

function injectStyle() {
	if (document.getElementById('secret-style-finale')) return;
	const s = document.createElement('style');
	s.id = 'secret-style-finale';
	s.textContent = CSS;
	document.head.append(s);
}

export function showFinale() {
	if (!allSolved()) return;
	injectStyle();
	update((p) => {
		if (!p.unlocked) p.theme = true;
		p.unlocked = true;
	});
	const win = openWindow({ title: 'Every secret, found', width: 560 });
	win.body.innerHTML = `
		<div class="fin">
			<div class="fin-intro">
				<h3>To be continued…</h3>
				<p>You found all ${PUZZLES.length} secrets. The site has a new look as a thank-you: the <b>✦ Aurora</b>
				switch in the footer turns it on and off. More puzzles will arrive with future themes.</p>
			</div>
			<div class="fin-board"></div>
		</div>`;
	renderBoards(win.body.querySelector<HTMLElement>('.fin-board')!, win, 'all');
}
