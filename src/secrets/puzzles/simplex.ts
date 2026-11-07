// "simplicial" on the Timeline page: build simplices of dimension 0–4 and slice the 4-simplex.
// Win: make one simplex of every dimension 0–4, and find a 3D slice of the 4-simplex with 6 corners
// (the triangular prism you get when the hyperplane separates its vertices 2 | 3).
import * as THREE from 'three';
import { openWindow, solve, chime } from '../ui';
import { isSolved } from '../progress';

const ID = 'timeline';

const STYLE = `
.sx-stage { position: relative; width: 100%; height: min(52vh, 380px); min-height: 230px; border-radius: 8px;
	overflow: hidden; background: radial-gradient(circle at 50% 40%, #0d1838, #02040b 75%); touch-action: none;
	cursor: grab; }
.sx-stage.is-dragging { cursor: grabbing; }
.sx-stage canvas { display: block; width: 100%; height: 100%; }
.sx-name { position: absolute; left: 10px; top: 8px; margin: 0; font-size: 0.85rem; color: #ffe7a3; pointer-events: none;
	text-shadow: 0 0 6px rgba(0,0,0,0.8); }
.sx-keys { display: flex; gap: 6px; margin: 10px 0 4px; flex-wrap: wrap; }
.sx-keys .secret-btn { flex: 1 1 0; min-width: 52px; padding: 6px 4px; line-height: 1.15; }
.sx-keys .secret-btn small { display: block; font-size: 0.68rem; color: var(--text-muted); }
.sx-keys .secret-btn.is-on { border-color: #ffe7a3; box-shadow: 0 0 10px rgba(255, 220, 140, 0.35); }
.sx-sliders { display: grid; gap: 4px; margin: 8px 0 2px; }
.sx-sliders[hidden] { display: none; }
.sx-sliders label { display: grid; grid-template-columns: 7.5em 1fr 3.4em; align-items: center; gap: 8px;
	font-size: 0.85rem; color: var(--text-muted); }
.sx-sliders input { width: 100%; accent-color: #ffe7a3; }
.sx-sliders output { font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; text-align: right; }
.sx-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
@media (max-width: 520px) { .sx-cols { grid-template-columns: 1fr; } }
.sx-euler { font-size: 0.85rem; white-space: pre-wrap; margin: 0; }
.sx-goals { list-style: none; margin: 0; padding: 0; font-size: 0.86rem; }
.sx-goals li { padding: 1px 0; color: var(--text-muted); }
.sx-goals li::before { content: '○ '; }
.sx-goals li.is-done { color: #ffe7a3; }
.sx-goals li.is-done::before { content: '● '; }
.sx-win { margin: 10px 0 0; padding: 10px 12px; border: 1px solid rgba(255, 210, 120, 0.45); border-radius: 8px;
	background: rgba(255, 210, 120, 0.08); }
`;

function injectStyle() {
	if (document.getElementById('secret-style-simplex')) return;
	const s = document.createElement('style');
	s.id = 'secret-style-simplex';
	s.textContent = STYLE;
	document.head.append(s);
}

type V3 = [number, number, number];
type V4 = [number, number, number, number];

const NAMES = ['0-simplex: a point', '1-simplex: a segment', '2-simplex: a triangle', '3-simplex: a tetrahedron', '4-simplex: a 3D slice'];
const SHORT = ['point', 'segment', 'triangle', 'tetra', '4-simplex'];

const T = 0.75;
const SIMPLICES: V3[][] = [
	[[0, 0, 0]],
	[
		[-1.2, 0, 0],
		[1.2, 0, 0],
	],
	[90, 210, 330].map((a) => [1.25 * Math.cos((a * Math.PI) / 180), 1.25 * Math.sin((a * Math.PI) / 180) - 0.15, 0] as V3),
	[
		[T, T, T],
		[T, -T, -T],
		[-T, T, -T],
		[-T, -T, T],
	],
];

/** The 4-simplex. Two vertices sit at low w, three at high w, all at different heights. */
const FOUR: V4[] = [
	[0, -1.15, 0, -1],
	[0.15, 1.15, 0.1, -0.55],
	[1.25, 0, 0, 0.35],
	[-0.62, 0.1, 1.08, 0.7],
	[-0.62, -0.1, -1.08, 1.0],
];
const FOUR_EDGES: [number, number][] = [];
for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) FOUR_EDGES.push([i, j]);

function binom(n: number, k: number): number {
	if (k < 0 || k > n) return 0;
	let r = 1;
	for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
	return r;
}

interface Slice {
	points: V3[];
	/** Which simplex edge each point came from. */
	from: [number, number][];
	edges: [number, number][];
	faces: number[][];
}

/** Intersect the 4-simplex (after a twist in the x–w plane) with the hyperplane w = h. */
function sliceFour(h: number, twist: number): Slice {
	const c = Math.cos(twist);
	const s = Math.sin(twist);
	const verts = FOUR.map(([x, y, z, w]) => [x * c - w * s, y, z, x * s + w * c] as V4);
	const points: V3[] = [];
	const from: [number, number][] = [];
	for (const [a, b] of FOUR_EDGES) {
		const wa = verts[a][3];
		const wb = verts[b][3];
		if ((wa - h) * (wb - h) < 0) {
			const t = (h - wa) / (wb - wa);
			points.push([0, 1, 2].map((k) => verts[a][k] + t * (verts[b][k] - verts[a][k])) as V3);
			from.push([a, b]);
		}
	}
	const share = (i: number, j: number) => new Set([...from[i], ...from[j]]).size === 3;
	// Two slice corners are joined when their simplex edges lie in a common triangle.
	const edges: [number, number][] = [];
	for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) if (share(i, j)) edges.push([i, j]);
	// Each tetrahedral facet of the 4-simplex that the hyperplane crosses gives one polygon face.
	const faces: number[][] = [];
	for (let omit = 0; omit < 5; omit++) {
		const ids = points.map((_, i) => i).filter((i) => !from[i].includes(omit));
		if (ids.length < 3) continue;
		const ring = [ids[0]];
		const left = ids.slice(1);
		while (left.length) {
			const last = ring[ring.length - 1];
			const k = left.findIndex((i) => share(i, last));
			ring.push(left.splice(k < 0 ? 0 : k, 1)[0]);
		}
		faces.push(ring);
	}
	return { points, from, edges, faces };
}

function twistedRange(twist: number): [number, number] {
	const c = Math.cos(twist);
	const s = Math.sin(twist);
	const ws = FOUR.map(([x, , , w]) => x * s + w * c);
	return [Math.min(...ws), Math.max(...ws)];
}

function glowTexture(): THREE.CanvasTexture {
	const c = document.createElement('canvas');
	c.width = c.height = 64;
	const g = c.getContext('2d')!;
	const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	grad.addColorStop(0, 'rgba(255,240,200,1)');
	grad.addColorStop(0.25, 'rgba(255,215,130,0.55)');
	grad.addColorStop(1, 'rgba(255,200,100,0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, 64, 64);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

export function launch(): void {
	injectStyle();
	const already = isSolved(ID);
	const win = openWindow({ title: 'Higher Dimensions', width: 640 });
	const body = win.body;
	body.innerHTML = `
		<p class="secret-hint">${
			already
				? 'You have already solved this one. Play on.'
				: 'Press <b>0</b>–<b>4</b> (or tap below) to build a simplex. Drag to spin it.'
		}</p>
		<div class="sx-stage"><p class="sx-name"></p></div>
		<div class="sx-keys" role="group" aria-label="Simplex dimension"></div>
		<div class="sx-sliders" hidden>
			<label>Slice height w<input type="range" class="sx-w" min="0" max="1000" value="80" aria-label="Slice height"><output class="sx-wout"></output></label>
			<label>Twist in 4D<input type="range" class="sx-twist" min="-500" max="500" value="0" aria-label="Rotate in the x–w plane"><output class="sx-tout"></output></label>
		</div>
		<div class="sx-cols">
			<div><p class="sx-euler secret-code"></p></div>
			<ul class="sx-goals"></ul>
		</div>
		<div class="sx-winbox"></div>`;
	const stage = body.querySelector<HTMLElement>('.sx-stage')!;
	const nameEl = body.querySelector<HTMLElement>('.sx-name')!;
	const keys = body.querySelector<HTMLElement>('.sx-keys')!;
	const sliders = body.querySelector<HTMLElement>('.sx-sliders')!;
	const wInput = body.querySelector<HTMLInputElement>('.sx-w')!;
	const tInput = body.querySelector<HTMLInputElement>('.sx-twist')!;
	const wOut = body.querySelector<HTMLOutputElement>('.sx-wout')!;
	const tOut = body.querySelector<HTMLOutputElement>('.sx-tout')!;
	const eulerEl = body.querySelector<HTMLElement>('.sx-euler')!;
	const goalsEl = body.querySelector<HTMLUListElement>('.sx-goals')!;
	const winBox = body.querySelector<HTMLElement>('.sx-winbox')!;

	const buttons: HTMLButtonElement[] = [];
	for (let d = 0; d <= 4; d++) {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'secret-btn';
		b.innerHTML = `${d}<small>${SHORT[d]}</small>`;
		b.setAttribute('aria-label', NAMES[d]);
		b.addEventListener('click', () => show(d));
		keys.append(b);
		buttons.push(b);
	}

	// ---- Goals -----------------------------------------------------------------------------
	const made = [false, false, false, false, false];
	let foundPrism = false;
	let won = false;
	const renderGoals = () => {
		const items = made.map((m, d) => ({ text: `Build a ${d}-simplex`, done: m }));
		items.push({
			text: foundPrism ? 'Found the triangular prism: 6 corners' : 'Find the slice with the most corners',
			done: foundPrism,
		});
		goalsEl.innerHTML = '';
		for (const it of items) {
			const li = document.createElement('li');
			li.textContent = it.text;
			li.classList.toggle('is-done', it.done);
			goalsEl.append(li);
		}
		if (!won && made.every(Boolean) && foundPrism) {
			won = true;
			solve(ID);
			winBox.innerHTML = `<p class="sx-win"><b style="color:#ffe7a3">Every dimension, accounted for.</b>
				The middle slice of a 4-simplex is a triangular prism: two of its corners on one side of the cut, three on the other,
				and 2 × 3 = 6 edges pierced. And through it all, V − E + F − C never budged from 1.</p>`;
		}
	};

	// ---- Three.js ----------------------------------------------------------------------------
	let renderer: THREE.WebGLRenderer;
	try {
		renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	} catch {
		stage.innerHTML = '<p class="secret-hint" style="padding:16px">This puzzle needs WebGL, which this browser has switched off.</p>';
		return;
	}
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setClearColor(0x000000, 0);
	stage.prepend(renderer.domElement);

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
	camera.position.set(0, 0, 5.2);
	const pivot = new THREE.Group();
	scene.add(pivot);
	pivot.quaternion.setFromEuler(new THREE.Euler(0.35, -0.5, 0));

	const glow = glowTexture();
	const sphereGeo = new THREE.SphereGeometry(0.07, 16, 12);
	const vertexMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8 });
	const haloMat = new THREE.SpriteMaterial({
		map: glow,
		color: 0xffd98a,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		transparent: true,
	});
	const edgeMat = new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.9 });
	const shadowMat = new THREE.LineDashedMaterial({
		color: 0x8a7dff,
		transparent: true,
		opacity: 0.35,
		dashSize: 0.08,
		gapSize: 0.07,
	});
	const faceMat = new THREE.MeshBasicMaterial({
		color: 0x6fb6ff,
		transparent: true,
		opacity: 0.16,
		side: THREE.DoubleSide,
		depthWrite: false,
	});
	const sliceFaceMat = new THREE.MeshBasicMaterial({
		color: 0xffc670,
		transparent: true,
		opacity: 0.2,
		side: THREE.DoubleSide,
		depthWrite: false,
	});
	const shared: { dispose(): void }[] = [glow, sphereGeo, vertexMat, haloMat, edgeMat, shadowMat, faceMat, sliceFaceMat];

	let shape: THREE.Group | null = null;
	let ownGeos: THREE.BufferGeometry[] = [];
	const halos: THREE.Sprite[] = [];

	function clearShape() {
		if (shape) pivot.remove(shape);
		for (const g of ownGeos) g.dispose();
		ownGeos = [];
		halos.length = 0;
		shape = null;
	}

	function build(points: V3[], edges: [number, number][], faces: number[][], fmat: THREE.Material, shadow?: V3[]) {
		clearShape();
		const g = new THREE.Group();
		for (const p of points) {
			const m = new THREE.Mesh(sphereGeo, vertexMat);
			m.position.set(...p);
			g.add(m);
			const h = new THREE.Sprite(haloMat);
			h.position.set(...p);
			h.scale.setScalar(points.length === 1 ? 0.9 : 0.5);
			g.add(h);
			halos.push(h);
		}
		if (edges.length) {
			const pos: number[] = [];
			for (const [a, b] of edges) pos.push(...points[a], ...points[b]);
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
			ownGeos.push(geo);
			g.add(new THREE.LineSegments(geo, edgeMat));
		}
		if (faces.length) {
			const pos: number[] = [];
			for (const f of faces) for (let i = 1; i + 1 < f.length; i++) pos.push(...points[f[0]], ...points[f[i]], ...points[f[i + 1]]);
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
			ownGeos.push(geo);
			g.add(new THREE.Mesh(geo, fmat));
		}
		if (shadow) {
			const pos: number[] = [];
			for (const [a, b] of FOUR_EDGES) pos.push(...shadow[a], ...shadow[b]);
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
			ownGeos.push(geo);
			const ls = new THREE.LineSegments(geo, shadowMat);
			ls.computeLineDistances();
			g.add(ls);
		}
		pivot.add(g);
		shape = g;
	}

	// ---- Shapes ------------------------------------------------------------------------------
	let dim = -1;

	function show(d: number) {
		dim = d;
		made[d] = true;
		buttons.forEach((b, i) => {
			b.classList.toggle('is-on', i === d);
			b.setAttribute('aria-pressed', String(i === d));
		});
		sliders.hidden = d !== 4;
		nameEl.textContent = NAMES[d];
		if (d < 4) {
			const pts = SIMPLICES[d];
			const edges: [number, number][] = [];
			const faces: number[][] = [];
			for (let i = 0; i < pts.length; i++)
				for (let j = i + 1; j < pts.length; j++) {
					edges.push([i, j]);
					for (let k = j + 1; k < pts.length; k++) faces.push([i, j, k]);
				}
			build(pts, edges, faces, faceMat);
			const n = d + 1;
			const counts = [binom(n, 1), binom(n, 2), binom(n, 3), binom(n, 4)];
			eulerEl.textContent =
				`${NAMES[d]}\nV − E + F − C\n= ${counts[0]} − ${counts[1]} + ${counts[2]} − ${counts[3]} = ${
					counts[0] - counts[1] + counts[2] - counts[3]
				}\n\nA simplex can be shrunk to a point,\nso its Euler characteristic is 1.`;
		} else {
			updateSlice();
		}
		renderGoals();
	}

	function updateSlice() {
		const twist = (Number(tInput.value) / 500) * 0.6;
		const [lo, hi] = twistedRange(twist);
		const f = 0.015 + 0.97 * (Number(wInput.value) / 1000);
		const h = lo + (hi - lo) * f;
		wOut.textContent = h.toFixed(2);
		tOut.textContent = `${Math.round((twist * 180) / Math.PI)}°`;
		const sl = sliceFour(h, twist);
		const c = Math.cos(twist);
		const s = Math.sin(twist);
		const shadow = FOUR.map(([x, y, z, w]) => [x * c - w * s, y, z] as V3);
		build(sl.points, sl.edges, sl.faces, sliceFaceMat, shadow);
		const V = sl.points.length;
		const E = sl.edges.length;
		const F = sl.faces.length;
		const C = V >= 4 ? 1 : 0;
		if (V === 6 && !foundPrism) {
			foundPrism = true;
			chime('open');
		}
		const kind = V === 4 ? 'a tetrahedron' : V === 6 ? 'a triangular prism' : `${V} corners`;
		eulerEl.textContent =
			`Slice at w = ${h.toFixed(2)}: ${kind}\nV − E + F − C\n= ${V} − ${E} + ${F} − ${C} = ${V - E + F - C}` +
			`\n\nThe whole 4-simplex:\n5 − 10 + 10 − 5 + 1 = 1\n(dashed: its shadow in 3D)`;
		renderGoals();
	}
	wInput.addEventListener('input', () => dim === 4 && updateSlice());
	tInput.addEventListener('input', () => dim === 4 && updateSlice());

	// ---- Input: keys and orbit drag with inertia --------------------------------------------------
	const onKey = (e: KeyboardEvent) => {
		if (!win.root.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'))) return;
		if (/^[0-4]$/.test(e.key)) {
			e.preventDefault();
			show(Number(e.key));
		}
	};
	document.addEventListener('keydown', onKey);

	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	let lastT = 0;
	let vx = 0;
	let vy = 0;
	let touched = false;
	const SPEED = 0.008;
	const axisY = new THREE.Vector3(0, 1, 0);
	const axisX = new THREE.Vector3(1, 0, 0);
	const q = new THREE.Quaternion();
	function spin(dx: number, dy: number) {
		q.setFromAxisAngle(axisY, dx * SPEED);
		pivot.quaternion.premultiply(q);
		q.setFromAxisAngle(axisX, dy * SPEED);
		pivot.quaternion.premultiply(q);
	}
	stage.addEventListener('pointerdown', (e) => {
		dragging = true;
		touched = true;
		lastX = e.clientX;
		lastY = e.clientY;
		lastT = performance.now();
		vx = vy = 0;
		stage.setPointerCapture(e.pointerId);
		stage.classList.add('is-dragging');
	});
	stage.addEventListener('pointermove', (e) => {
		if (!dragging) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		const now = performance.now();
		const dt = Math.max(now - lastT, 1);
		spin(dx, dy);
		// Velocity in px per 16 ms frame, smoothed.
		vx = vx * 0.5 + ((dx * 16) / dt) * 0.5;
		vy = vy * 0.5 + ((dy * 16) / dt) * 0.5;
		lastX = e.clientX;
		lastY = e.clientY;
		lastT = now;
	});
	const endDrag = () => {
		if (!dragging) return;
		dragging = false;
		stage.classList.remove('is-dragging');
		if (performance.now() - lastT > 80) vx = vy = 0;
	};
	stage.addEventListener('pointerup', endDrag);
	stage.addEventListener('pointercancel', endDrag);

	// ---- Sizing and the loop ---------------------------------------------------------------
	const resize = () => {
		const w = stage.clientWidth || 300;
		const h = stage.clientHeight || 240;
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.fov = w < h * 1.1 ? 52 : 42;
		camera.updateProjectionMatrix();
	};
	const ro = new ResizeObserver(resize);
	ro.observe(stage);
	window.addEventListener('resize', resize);
	resize();

	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	let raf = 0;
	const loop = (t: number) => {
		raf = requestAnimationFrame(loop);
		if (!dragging) {
			if (Math.abs(vx) + Math.abs(vy) > 0.01) {
				spin(vx, vy);
				vx *= 0.95;
				vy *= 0.95;
			} else if (!touched && !reduced) {
				spin(0.25, 0);
			}
		}
		const pulse = 1 + 0.08 * Math.sin(t / 400);
		for (const h of halos) h.scale.setScalar((dim === 0 ? 0.9 : 0.5) * pulse);
		renderer.render(scene, camera);
	};
	raf = requestAnimationFrame(loop);

	win.onClose(() => {
		cancelAnimationFrame(raf);
		document.removeEventListener('keydown', onKey);
		window.removeEventListener('resize', resize);
		ro.disconnect();
		clearShape();
		for (const s of shared) s.dispose();
		renderer.dispose();
		renderer.forceContextLoss();
	});

	renderGoals();
	show(3);
	made[3] = false; // the opening view is a demo; it doesn't count until the player asks for it
	renderGoals();
}
