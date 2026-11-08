// "graph" on the Projects page: Every Bridge Once. Trace a path that uses every edge exactly once.
// Stage 3 is the river town with 7 bridges: every shore has an odd number of bridges, so no path
// exists until the player builds one extra bridge (any pair of land masses works), leaving 2 odd shores.
import { openWindow, solve, chime } from '../ui';
import { isSolved, getData, setData } from '../progress';

const ID = 'projects';
const NS = 'http://www.w3.org/2000/svg';
const W = 400;
const H = 300;
const GOLD = '#ffe7a3';

type Pt = [number, number];

interface Edge {
	a: number;
	b: number;
	/** The curve passes through this point (used for bridges). */
	via?: Pt;
	/** Sideways bulge for a curved edge, in viewBox units. */
	bend?: number;
	built?: boolean;
}

interface Stage {
	key: string;
	title: string;
	intro: string;
	nodes: Pt[];
	labels?: string[];
	edges: Edge[];
	river?: boolean;
}

const STAGES: Stage[] = [
	{
		key: 'envelope',
		title: 'I. The Envelope',
		intro: 'Tap a corner to start, then tap (or drag to) its neighbours. Use every line exactly once.',
		nodes: [
			[110, 250],
			[290, 250],
			[290, 130],
			[110, 130],
			[200, 45],
		],
		edges: [
			{ a: 0, b: 1 },
			{ a: 1, b: 2 },
			{ a: 2, b: 3 },
			{ a: 3, b: 0 },
			{ a: 0, b: 2 },
			{ a: 1, b: 3 },
			{ a: 3, b: 4 },
			{ a: 4, b: 2 },
		],
	},
	{
		key: 'wheel',
		title: 'II. The Broken Wheel',
		intro: 'Bigger, and less forgiving. Where you start matters.',
		nodes: [
			[200, 40],
			[310, 100],
			[310, 210],
			[200, 268],
			[90, 210],
			[90, 100],
			[200, 152],
		],
		edges: [
			{ a: 0, b: 1 },
			{ a: 1, b: 2 },
			{ a: 2, b: 3 },
			{ a: 3, b: 4 },
			{ a: 4, b: 5 },
			{ a: 5, b: 0 },
			{ a: 6, b: 0 },
			{ a: 6, b: 1 },
			{ a: 6, b: 2 },
			{ a: 6, b: 4 },
			{ a: 0, b: 2, bend: -95 },
		],
	},
	{
		key: 'river',
		title: 'III. The River Town',
		intro: 'Walk the town crossing every bridge exactly once. You may build one new bridge, if you need it.',
		river: true,
		nodes: [
			[180, 36],
			[180, 264],
			[168, 150],
			[338, 150],
		],
		labels: ['North shore', 'South shore', 'Island', 'East bank'],
		edges: [
			{ a: 0, b: 2, via: [118, 95] },
			{ a: 0, b: 2, via: [208, 95] },
			{ a: 1, b: 2, via: [118, 205] },
			{ a: 1, b: 2, via: [208, 205] },
			{ a: 2, b: 3, via: [262, 150] },
			{ a: 0, b: 3, via: [330, 95] },
			{ a: 1, b: 3, via: [330, 205] },
		],
	},
];

/** Where a newly built bridge goes, by the pair of land masses it joins. */
const NEW_BRIDGE_VIA: Record<string, Pt> = {
	'0-1': [42, 150],
	'0-2': [163, 95],
	'1-2': [163, 205],
	'2-3': [262, 112],
	'0-3': [382, 95],
	'1-3': [382, 205],
};

const STYLE = `
.gr-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.gr-tabs .secret-btn { padding: 5px 10px; font-size: 0.82rem; }
.gr-tabs .secret-btn.is-on { border-color: ${GOLD}; color: ${GOLD}; }
.gr-svg { display: block; width: 100%; height: auto; max-height: 58vh; border-radius: 8px; background: #050a1a;
	touch-action: none; user-select: none; -webkit-user-select: none; }
.gr-controls { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.gr-controls .secret-btn.is-on { border-color: ${GOLD}; background: rgba(255, 210, 120, 0.18); }
.gr-intro { margin: 0 0 8px; }
.gr-meta { margin: 8px 0 0; font-size: 0.86rem; color: var(--text-muted); }
.gr-hint { margin: 8px 0 0; padding: 8px 10px; border-left: 3px solid ${GOLD}; background: rgba(255, 210, 120, 0.06);
	font-size: 0.88rem; }
.gr-win { margin: 10px 0 0; padding: 10px 12px; border: 1px solid rgba(255, 210, 120, 0.45); border-radius: 8px;
	background: rgba(255, 210, 120, 0.08); }
@keyframes gr-pulse { 50% { opacity: 0.25; } }
.gr-ring { animation: gr-pulse 1.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .gr-ring { animation: none; } }
`;

function injectStyle() {
	if (document.getElementById('secret-style-graph')) return;
	const s = document.createElement('style');
	s.id = 'secret-style-graph';
	s.textContent = STYLE;
	document.head.append(s);
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
	const e = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
	parent?.append(e);
	return e;
}

/** Quadratic control point for an edge. */
function control(p: Pt, q: Pt, e: Edge): Pt | null {
	const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
	if (e.via) return [2 * e.via[0] - mid[0], 2 * e.via[1] - mid[1]];
	if (e.bend) {
		const dx = q[0] - p[0];
		const dy = q[1] - p[1];
		const len = Math.hypot(dx, dy) || 1;
		// The curve's midpoint sits `bend` units off the chord, so the control point sits twice that.
		return [mid[0] - (dy / len) * e.bend * 2, mid[1] + (dx / len) * e.bend * 2];
	}
	return null;
}

function pointOn(p: Pt, q: Pt, c: Pt | null, t: number): Pt {
	if (!c) return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
	const u = 1 - t;
	return [u * u * p[0] + 2 * u * t * c[0] + t * t * q[0], u * u * p[1] + 2 * u * t * c[1] + t * t * q[1]];
}

function pathD(p: Pt, q: Pt, c: Pt | null): string {
	return c ? `M${p[0]},${p[1]} Q${c[0]},${c[1]} ${q[0]},${q[1]}` : `M${p[0]},${p[1]} L${q[0]},${q[1]}`;
}

export function launch(): void {
	injectStyle();
	const already = isSolved(ID);
	const win = openWindow({ title: 'Every Bridge Once', width: 600 });
	const body = win.body;
	body.innerHTML = `
		${already ? '<p class="secret-hint">You have already solved this one. Walk it again any time.</p>' : ''}
		<div class="gr-tabs" role="group" aria-label="Stage"></div>
		<p class="gr-intro secret-hint"></p>
		<svg class="gr-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Graph to trace"></svg>
		<div class="gr-controls">
			<button type="button" class="secret-btn gr-undo">Undo</button>
			<button type="button" class="secret-btn gr-reset">Reset</button>
			<button type="button" class="secret-btn gr-build" hidden>Build a bridge</button>
			<button type="button" class="secret-btn gr-next" hidden>Next stage →</button>
		</div>
		<p class="gr-meta"></p>
		<div class="gr-extra"></div>`;
	const tabs = body.querySelector<HTMLElement>('.gr-tabs')!;
	const intro = body.querySelector<HTMLElement>('.gr-intro')!;
	const svg = body.querySelector<SVGSVGElement>('.gr-svg')!;
	const undoBtn = body.querySelector<HTMLButtonElement>('.gr-undo')!;
	const resetBtn = body.querySelector<HTMLButtonElement>('.gr-reset')!;
	const buildBtn = body.querySelector<HTMLButtonElement>('.gr-build')!;
	const nextBtn = body.querySelector<HTMLButtonElement>('.gr-next')!;
	const meta = body.querySelector<HTMLElement>('.gr-meta')!;
	const extra = body.querySelector<HTMLElement>('.gr-extra')!;

	let reached = Math.max(0, Math.min(2, getData<number>(`${ID}-stage`, 0)));
	if (already) reached = 2;
	let stageIdx = reached;
	let edges: Edge[] = [];
	let start = -1;
	let path: number[] = []; // edge indices in order
	let cur = -1;
	let building = false;
	let buildFrom = -1;
	let fails = 0;
	let complete = false;
	let flash: { kind: 'node' | 'edge'; i: number } | null = null;
	let flashTimer = 0;

	const stage = () => STAGES[stageIdx];

	function loadStage(i: number) {
		stageIdx = i;
		edges = STAGES[i].edges.map((e) => ({ ...e }));
		building = false;
		buildFrom = -1;
		fails = 0;
		resetPath();
		renderTabs();
		intro.textContent = STAGES[i].intro;
		extra.innerHTML = '';
		win.setStatus('');
		render();
	}

	function resetPath() {
		start = -1;
		cur = -1;
		path = [];
		complete = false;
		nextBtn.hidden = true;
	}

	function renderTabs() {
		tabs.innerHTML = '';
		STAGES.forEach((s, i) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'secret-btn';
			b.textContent = i <= reached ? s.title : `${['I', 'II', 'III'][i]}. ?`;
			b.disabled = i > reached;
			b.classList.toggle('is-on', i === stageIdx);
			b.setAttribute('aria-pressed', String(i === stageIdx));
			b.addEventListener('click', () => loadStage(i));
			tabs.append(b);
		});
	}

	const degree = (v: number) => edges.reduce((n, e) => n + (e.a === v ? 1 : 0) + (e.b === v ? 1 : 0), 0);
	const used = (i: number) => path.includes(i);
	const showDegrees = () => stageIdx === 2 && fails >= 3;

	// ---- Drawing ---------------------------------------------------------------------------------
	function drawRiver() {
		el('rect', { x: 0, y: 0, width: W, height: H, fill: '#0e1a16' }, svg);
		const river = { fill: 'none', stroke: '#1d4f86', 'stroke-width': 36, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
		const shine = { fill: 'none', stroke: '#2f6fb0', 'stroke-width': 2, 'stroke-dasharray': '10 14', opacity: 0.7 };
		const ds = [
			'M-20,150 C40,150 60,95 120,95 L420,95',
			'M-20,150 C40,150 60,205 120,205 L420,205',
			'M262,95 C250,130 274,170 262,205',
		];
		for (const d of ds) el('path', { d, ...river }, svg);
		for (const d of ds) el('path', { d, ...shine }, svg);
	}

	function render() {
		svg.replaceChildren();
		const s = stage();
		const nodes = s.nodes;
		const defs = el('defs', {}, svg);
		// User-space region: a bounding-box region is empty for perfectly horizontal or vertical
		// lines (zero height or width), which would make them vanish.
		const f = el(
			'filter',
			{ id: 'gr-glow', filterUnits: 'userSpaceOnUse', x: '-20', y: '-20', width: '440', height: '340' },
			defs,
		);
		el('feGaussianBlur', { stdDeviation: 3, result: 'b' }, f);
		const m = el('feMerge', {}, f);
		el('feMergeNode', { in: 'b' }, m);
		el('feMergeNode', { in: 'SourceGraphic' }, m);

		if (s.river) drawRiver();
		else {
			// faint star field, fixed pattern
			for (let i = 0; i < 40; i++) {
				el('circle', { cx: (i * 97) % W, cy: (i * 61 + 13) % H, r: i % 3 === 0 ? 1.1 : 0.6, fill: '#9fb4ff', opacity: 0.35 }, svg);
			}
		}

		// Edges
		edges.forEach((e, i) => {
			const p = nodes[e.a];
			const q = nodes[e.b];
			const c = control(p, q, e);
			const d = pathD(p, q, c);
			const isUsed = used(i);
			const flashing = flash?.kind === 'edge' && flash.i === i;
			if (s.river) {
				// a bridge: dark outline, stone deck
				el('path', { d, fill: 'none', stroke: '#0a0f0c', 'stroke-width': 12, 'stroke-linecap': 'round' }, svg);
				el(
					'path',
					{
						d,
						fill: 'none',
						stroke: isUsed ? GOLD : e.built ? '#d7c3ff' : '#b9a782',
						'stroke-width': 7,
						'stroke-linecap': 'round',
						'stroke-dasharray': e.built && !isUsed ? '10 4' : 'none',
						filter: isUsed ? 'url(#gr-glow)' : 'none',
					},
					svg,
				);
			} else {
				el(
					'path',
					{
						d,
						fill: 'none',
						stroke: isUsed ? GOLD : 'rgba(200,215,255,0.5)',
						'stroke-width': isUsed ? 5 : 4,
						'stroke-linecap': 'round',
						filter: isUsed ? 'url(#gr-glow)' : 'none',
					},
					svg,
				);
			}
			if (flashing) el('path', { d, fill: 'none', stroke: '#ff6b6b', 'stroke-width': 6, opacity: 0.8 }, svg);
			if (isUsed) {
				const mid = pointOn(p, q, c, 0.5);
				const g = el('g', {}, svg);
				el('circle', { cx: mid[0], cy: mid[1], r: 8, fill: '#1a1406', stroke: GOLD, 'stroke-width': 1 }, g);
				const t = el('text', { x: mid[0], y: mid[1] + 3.5, 'text-anchor': 'middle', 'font-size': 10, fill: GOLD }, g);
				t.textContent = String(path.indexOf(i) + 1);
			}
		});

		// Nodes
		nodes.forEach((p, i) => {
			const isCur = i === cur;
			const isStart = i === start;
			const picked = building && i === buildFrom;
			const flashing = flash?.kind === 'node' && flash.i === i;
			const r = s.river ? 15 : 11;
			if (isCur || picked) el('circle', { cx: p[0], cy: p[1], r: r + 7, fill: 'none', stroke: GOLD, 'stroke-width': 2, class: 'gr-ring' }, svg);
			el(
				'circle',
				{
					cx: p[0],
					cy: p[1],
					r,
					fill: isCur ? GOLD : flashing ? '#ff6b6b' : s.river ? '#27402f' : '#0b1430',
					stroke: isStart ? GOLD : building ? '#d7c3ff' : '#6fb6ff',
					'stroke-width': isStart ? 3 : 2,
					filter: isCur ? 'url(#gr-glow)' : 'none',
				},
				svg,
			);
			if (showDegrees()) {
				const t = el(
					'text',
					{ x: p[0], y: p[1] + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: isCur ? '#1a1406' : '#e6ecff' },
					svg,
				);
				t.textContent = String(degree(i));
			}
			if (s.labels) {
				const below = p[1] < 60 || (p[1] > 100 && p[1] < 200);
				const t = el(
					'text',
					{
						x: p[0],
						y: below ? p[1] + r + 13 : p[1] - r - 6,
						'text-anchor': 'middle',
						'font-size': 11,
						fill: '#cfe3d6',
						'paint-order': 'stroke',
						stroke: '#0e1a16',
						'stroke-width': 3,
					},
					svg,
				);
				t.textContent = s.labels[i];
			}
		});

		// Controls and readout
		undoBtn.disabled = start < 0 || complete;
		resetBtn.disabled = start < 0;
		const isRiver = !!s.river;
		buildBtn.hidden = !isRiver;
		const hasBuilt = edges.some((e) => e.built);
		buildBtn.textContent = building ? 'Cancel building' : hasBuilt ? 'Demolish the new bridge' : 'Build a bridge';
		buildBtn.classList.toggle('is-on', building);
		const noun = isRiver ? 'bridges' : 'lines';
		meta.textContent = building
			? buildFrom < 0
				? 'Building: tap the first land mass.'
				: 'Building: now tap the land mass on the other side.'
			: `${path.length} / ${edges.length} ${noun} used` + (start < 0 ? ' · tap anywhere to begin' : '');
	}

	function doFlash(kind: 'node' | 'edge', i: number) {
		flash = { kind, i };
		clearTimeout(flashTimer);
		flashTimer = window.setTimeout(() => {
			flash = null;
			render();
		}, 350);
	}

	// ---- Moves ------------------------------------------------------------------------------
	/** Try to walk from the current node to `to`. Returns true if a move happened. */
	function step(to: number, viaEdge = -1, loud = true): boolean {
		if (complete) return false;
		if (start < 0) {
			start = cur = to;
			render();
			return true;
		}
		if (to === cur) return false;
		const ok = (i: number) => !used(i) && ((edges[i].a === cur && edges[i].b === to) || (edges[i].b === cur && edges[i].a === to));
		let ei = viaEdge >= 0 && ok(viaEdge) ? viaEdge : -1;
		if (ei < 0) ei = edges.findIndex((_, i) => ok(i));
		if (ei < 0) {
			if (loud) {
				chime('error');
				doFlash('node', to);
				const already = edges.some((e, i) => used(i) && ((e.a === cur && e.b === to) || (e.b === cur && e.a === to)));
				win.setStatus(already ? 'You have already used every way across to there.' : 'Those two are not connected.');
				render();
			}
			return false;
		}
		path.push(ei);
		cur = to;
		win.setStatus('');
		afterMove();
		return true;
	}

	function afterMove() {
		if (path.length === edges.length) {
			complete = true;
			render();
			onComplete();
			return;
		}
		const left = edges.some((e, i) => !used(i) && (e.a === cur || e.b === cur));
		if (!left) {
			fails++;
			chime('error');
			const n = edges.length - path.length;
			win.setStatus(`Stuck: nowhere left to go from here, and ${n} ${n === 1 ? 'is' : 'are'} still unused. Undo or reset.`);
			if (stageIdx === 2) updateHints();
		}
		render();
	}

	function updateHints() {
		if (fails < 3) return;
		const lines = ['Euler counted the bridges at each shore…'];
		if (fails >= 6)
			lines.push(
				'Every time you pass through a shore you use two of its bridges, one in and one out. Only where you start and where you finish can be different. How many shores have an odd count?',
			);
		extra.innerHTML = lines.map((l) => `<p class="gr-hint">${l}</p>`).join('');
	}

	function onComplete() {
		if (stageIdx < 2) {
			chime('open');
			win.setStatus('Every line, exactly once.');
			if (reached < stageIdx + 1) {
				reached = stageIdx + 1;
				setData(`${ID}-stage`, reached);
				renderTabs();
			}
			nextBtn.hidden = false;
			nextBtn.focus();
			return;
		}
		solve(ID);
		win.setStatus('Every bridge, exactly once.');
		extra.innerHTML = `<p class="gr-win"><b style="color:${GOLD}">You walked the whole town.</b> With seven bridges every shore had an
			odd count, and a walk can only have two odd ends, so it couldn't be done. One new bridge fixes two shores at once.
			That's the argument that started graph theory.</p>`;
	}

	function undo() {
		if (complete || start < 0) return;
		if (path.length === 0) {
			start = cur = -1;
		} else {
			const ei = path.pop()!;
			const e = edges[ei];
			cur = e.a === cur ? e.b : e.a;
		}
		win.setStatus('');
		render();
	}

	function toggleBuild() {
		const builtIdx = edges.findIndex((e) => e.built);
		if (builtIdx >= 0) {
			edges.splice(builtIdx, 1);
			resetPath();
			win.setStatus('The new bridge is gone. You may build another.');
		} else {
			building = !building;
			buildFrom = -1;
			if (building) resetPath();
			win.setStatus('');
		}
		render();
	}

	function buildTap(v: number) {
		if (buildFrom < 0) {
			buildFrom = v;
		} else if (v === buildFrom) {
			buildFrom = -1;
		} else {
			const a = Math.min(v, buildFrom);
			const b = Math.max(v, buildFrom);
			edges.push({ a, b, via: NEW_BRIDGE_VIA[`${a}-${b}`], built: true });
			building = false;
			buildFrom = -1;
			chime('open');
			const names = stage().labels!;
			win.setStatus(`New bridge: ${names[a]} to ${names[b]}. Now cross all eight.`);
		}
		render();
	}

	undoBtn.addEventListener('click', undo);
	resetBtn.addEventListener('click', () => {
		resetPath();
		win.setStatus('');
		render();
	});
	buildBtn.addEventListener('click', toggleBuild);
	nextBtn.addEventListener('click', () => loadStage(Math.min(2, stageIdx + 1)));

	// ---- Pointer --------------------------------------------------------------------------------
	function toSvg(e: PointerEvent): Pt {
		const m = svg.getScreenCTM();
		if (!m) return [0, 0];
		const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
		return [p.x, p.y];
	}
	function nearestNode(p: Pt, max: number): number {
		let best = -1;
		let bd = max;
		stage().nodes.forEach((n, i) => {
			const d = Math.hypot(n[0] - p[0], n[1] - p[1]);
			if (d < bd) {
				bd = d;
				best = i;
			}
		});
		return best;
	}
	/** The unused edge touching the current node that passes nearest to p. */
	function nearestEdge(p: Pt, max: number): number {
		let best = -1;
		let bd = max;
		const nodes = stage().nodes;
		edges.forEach((e, i) => {
			if (used(i) || (e.a !== cur && e.b !== cur)) return;
			const c = control(nodes[e.a], nodes[e.b], e);
			for (let k = 1; k < 20; k++) {
				const q = pointOn(nodes[e.a], nodes[e.b], c, k / 20);
				const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
				if (d < bd) {
					bd = d;
					best = i;
				}
			}
		});
		return best;
	}

	let down = false;
	const touchR = () => (svg.clientWidth < 420 ? 30 : 24);
	svg.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		const p = toSvg(e);
		const v = nearestNode(p, touchR());
		if (building) {
			if (v >= 0) buildTap(v);
			return;
		}
		if (v >= 0) {
			step(v);
		} else if (cur >= 0) {
			// Tapping a bridge or line next to you crosses that specific one.
			const ei = nearestEdge(p, 14);
			if (ei >= 0) {
				const e2 = edges[ei];
				step(e2.a === cur ? e2.b : e2.a, ei);
			}
		}
		down = true;
		svg.setPointerCapture(e.pointerId);
	});
	svg.addEventListener('pointermove', (e) => {
		if (!down || building || cur < 0) return;
		const v = nearestNode(toSvg(e), touchR() * 0.75);
		if (v >= 0 && v !== cur) step(v, -1, false);
	});
	const up = () => {
		down = false;
	};
	svg.addEventListener('pointerup', up);
	svg.addEventListener('pointercancel', up);

	const onKey = (e: KeyboardEvent) => {
		if (!win.root.isConnected) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			undo();
		}
	};
	document.addEventListener('keydown', onKey);
	win.onClose(() => {
		clearTimeout(flashTimer);
		document.removeEventListener('keydown', onKey);
	});

	loadStage(stageIdx);
}
