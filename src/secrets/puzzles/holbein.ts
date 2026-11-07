// Machine Learning → "linear algebra": Holbein's The Ambassadors (1533). The smear across the floor is
// an anamorphic skull. Enter a 2×2 matrix; it's applied to the painting around the skull, and any matrix
// that undoes the stretch (a horizontal shear does it) wins. Success gives the sky view coordinates.
import { SKY_TARGET } from '../config';
import { isSolved } from '../progress';
import { chime, openWindow, solve } from '../ui';

const SRC = '/secrets/ambassadors.jpg';
const IMG_W = 1280;
const IMG_H = 1261;
// The skull in image pixels (y down): its centre, and half-axes along and across the smear.
const SKULL = { cx: 612, cy: 1110 };
const LONG: [number, number] = [318, -140];
const SHORT: [number, number] = [26, 59];

const CSS = `
.hb { display: grid; gap: 14px; }
.hb-stage { position: relative; }
.hb-caption { margin: 6px 0 0; font-size: .8rem; color: var(--text-muted); font-style: italic; }
.hb-form { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px; }
.hb-matrix { display: inline-grid; grid-template-columns: repeat(2, 5.2em); gap: 6px 8px; padding: 6px 12px; position: relative; }
.hb-matrix::before, .hb-matrix::after { content: ''; position: absolute; top: 0; bottom: 0; width: 8px;
  border: 2px solid var(--text-muted); }
.hb-matrix::before { left: 0; border-right: 0; }
.hb-matrix::after { right: 0; border-left: 0; }
.hb-matrix input { width: 100%; text-align: center; }
.hb-label { font-family: var(--font-display); color: var(--text-muted); }
`;

function injectStyle() {
	if (document.getElementById('secret-style-holbein')) return;
	const s = document.createElement('style');
	s.id = 'secret-style-holbein';
	s.textContent = CSS;
	document.head.append(s);
}

type Mat = [number, number, number, number]; // [a, b, c, d] for [[a, b], [c, d]], math axes (y up)

/** The matrix in image pixel axes (y down): F·A·F with F = diag(1, −1). */
function toPixel([a, b, c, d]: Mat): Mat {
	return [a, -b, -c, d];
}

function apply([a, b, c, d]: Mat, [x, y]: [number, number]): [number, number] {
	return [a * x + b * y, c * x + d * y];
}

/** Does this matrix make the skull read as a skull? Its axes must come out comparable and not collapsed. */
export function recognizable(m: Mat): boolean {
	const p = toPixel(m);
	const det = m[0] * m[3] - m[1] * m[2];
	if (!Number.isFinite(det) || Math.abs(det) < 0.25 || Math.abs(det) > 4) return false;
	const L = apply(p, LONG);
	const S = apply(p, SHORT);
	const l = Math.hypot(...L);
	const s = Math.hypot(...S);
	const ratio = l / s;
	const angle = Math.acos(Math.abs(L[0] * S[0] + L[1] * S[1]) / (l * s)) * (180 / Math.PI);
	// A real skull is roughly 1–1.5× as long as it is wide; allow a generous band either way.
	return ratio > 0.55 && ratio < 1.9 && angle > 45 && l > 60 && l < 900;
}

export function launch() {
	injectStyle();
	const win = openWindow({ title: 'The Ambassadors', width: 760 });
	win.body.innerHTML = `
		<div class="hb">
			<p>Two ambassadors, their instruments, and something on the floor that doesn’t want to be seen head-on.
			Change how you look at it.</p>
			<div class="hb-stage">
				<canvas class="secret-canvas" width="760" height="520" aria-label="The Ambassadors, transformed by your matrix"></canvas>
				<p class="hb-caption">Hans Holbein the Younger, <cite>The Ambassadors</cite>. Oil on oak. National Gallery, London.</p>
			</div>
			<form class="hb-form">
				<span class="hb-label">x′ =</span>
				<div class="hb-matrix">
					<input class="secret-input" name="a" inputmode="decimal" value="1" aria-label="Row 1, column 1">
					<input class="secret-input" name="b" inputmode="decimal" value="0" aria-label="Row 1, column 2">
					<input class="secret-input" name="c" inputmode="decimal" value="0" aria-label="Row 2, column 1">
					<input class="secret-input" name="d" inputmode="decimal" value="1" aria-label="Row 2, column 2">
				</div>
				<span class="hb-label">x</span>
				<button class="secret-btn" type="submit">Look again</button>
				<button class="secret-btn" type="button" data-reset>Reset</button>
			</form>
			<p class="secret-hint">The matrix acts on the painting around the smear, with x to the right and y up.</p>
		</div>`;

	const canvas = win.body.querySelector('canvas')!;
	const g = canvas.getContext('2d')!;
	const form = win.body.querySelector('form')!;
	const img = new Image();
	img.src = SRC;
	let current: Mat = [1, 0, 0, 1];
	let shown: Mat = [1, 0, 0, 1];
	let raf = 0;

	const read = (): Mat | null => {
		const f = new FormData(form);
		const vals = (['a', 'b', 'c', 'd'] as const).map((k) => Number(String(f.get(k)).trim().replace('−', '-')));
		return vals.every(Number.isFinite) ? (vals as Mat) : null;
	};

	function draw() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = canvas.clientWidth || 760;
		const h = Math.round(w * 0.68);
		if (canvas.width !== Math.round(w * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.fillStyle = '#05070f';
		g.fillRect(0, 0, canvas.width, canvas.height);
		if (!img.complete || !img.naturalWidth) return;
		// Fit the untransformed painting, then apply the matrix around the skull.
		// The further the matrix is from the identity, the more the view closes in on the skull.
		const away = Math.min(1, Math.hypot(shown[0] - 1, shown[1], shown[2], shown[3] - 1) / 1.5);
		const fit = Math.min(canvas.width / IMG_W, canvas.height / IMG_H) * (1 + 1.4 * away);
		const [a, b, c, d] = toPixel(shown);
		const sx = canvas.width / 2 + (SKULL.cx - IMG_W / 2) * fit * (1 - away);
		const sy = canvas.height / 2 + (SKULL.cy - IMG_H / 2) * fit * (1 - away);
		g.setTransform(fit * a, fit * c, fit * b, fit * d, sx, sy);
		g.imageSmoothingQuality = 'high';
		g.drawImage(img, -SKULL.cx, -SKULL.cy, IMG_W, IMG_H);
	}

	// Ease from the shown matrix to the entered one, so the change reads as a transformation.
	function animateTo(target: Mat, done?: () => void) {
		cancelAnimationFrame(raf);
		const from = [...shown] as Mat;
		const t0 = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - t0) / 900);
			const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
			shown = from.map((v, i) => v + (target[i] - v) * e) as Mat;
			draw();
			if (t < 1) raf = requestAnimationFrame(step);
			else done?.();
		};
		raf = requestAnimationFrame(step);
	}

	img.addEventListener('load', draw);
	const ro = new ResizeObserver(draw);
	ro.observe(canvas);
	win.onClose(() => {
		cancelAnimationFrame(raf);
		ro.disconnect();
	});

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const m = read();
		if (!m) {
			win.setStatus('Each entry needs to be a number.');
			chime('error');
			return;
		}
		const det = m[0] * m[3] - m[1] * m[2];
		if (Math.abs(det) < 0.05 || Math.abs(det) > 20) {
			win.setStatus('That would crush or blow up the painting. Try something gentler.');
			chime('error');
			return;
		}
		current = m;
		win.setStatus('');
		animateTo(current, () => {
			if (recognizable(current)) reveal();
			else win.setStatus('Hmm. Still a smear.');
		});
	});
	form.querySelector('[data-reset]')!.addEventListener('click', () => {
		form.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.value = i.name === 'a' || i.name === 'd' ? '1' : '0'));
		current = [1, 0, 0, 1];
		win.setStatus('');
		animateTo(current);
	});

	if (isSolved('ml')) {
		win.setStatus('You’ve already met the skull.');
		const again = document.createElement('button');
		again.type = 'button';
		again.className = 'secret-btn';
		again.textContent = 'See the coordinates again';
		again.addEventListener('click', showCoordinates);
		form.append(again);
	}

	function reveal() {
		win.setStatus('Memento mori.');
		solve('ml');
		setTimeout(showCoordinates, 900);
	}
}

export function showCoordinates() {
	const { lat, lon } = SKY_TARGET;
	const fmt = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
	const win = openWindow({ title: 'Scratched on the back of the panel', width: 440 });
	win.body.innerHTML = `
		<p>Beneath the skull, someone has scratched a place:</p>
		<code class="secret-code" style="text-align:center;font-size:1.15rem">${fmt}</code>
		<p style="margin-top:1em">Stand there and look up, in the year this was painted.</p>`;
}
