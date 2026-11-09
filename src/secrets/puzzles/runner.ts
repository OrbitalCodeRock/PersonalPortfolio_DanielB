// "momentum" on the Now page: an endless rooftop runner. You run on your own and only control jumping;
// speed builds the longer you survive. Falling off the bottom of the screen or touching a sparking vent
// ends the run. Surviving one minute solves the secret; the run carries on for as long as you last.
//
// Mechanics: variable jump (release early for a short hop), slopes (a burst of speed), corridors
// through buildings, drops and climbs, wall jumps, grapple hooks
// (press jump in the air near one; press again to let go), trains you can ride, narrow ledges, and
// wall-run panels (hold jump), air vents that launch you upward, and drones you can grab (glide
// down; hold jump to dive) or stand on. The world and physics are in src/secrets/runner/sim.ts and the
// levels in levelgen.ts; this file draws, plays sound and handles input.
import { openWindow, solve, chime } from '../ui';
import { getData, isSolved, load, setData } from '../progress';
import {
	PHYS,
	START_SPEED,
	STREET,
	maxSpeedAt,
	type Box,
	type Facade,
	type Grapple,
	type Hint,
	type Segment,
	type Slope,
	type Solid,
	type Train,
	DRONE,
	bandName,
} from '../runner/levelgen';
import { createSim, overlaps, FLOOR_MARGIN, type DroneState, type TrainState } from '../runner/sim';
import { createRunnerSound } from '../runner/sound';
import { setRecipePools } from '../runner/seeds';
import { POOLS, POOLS_VERSION, findRecipe } from '../runner/poolVersion';
import type { Recipe } from '../runner/levelgen';
import { renderRunStrip, segmentThumb } from '../runner/preview';
import { recordRun, type RunCategory } from '../runnerBoard';
import { ordinal } from '../boards';

// Level pools written by the level model or the search (src/secrets/runner/pools.json).
setRecipePools(POOLS);

const ID = 'now';
/** Seconds a run has to last to solve the secret. */
const GOAL = 60;

const CW = 960;
const CH = 540;
const SCALE = 30; // px per metre
const VIEW_W = CW / SCALE;
const VIEW_H = CH / SCALE;

const GOLD = '#ffe7a3';
const CYAN = '#7fe3ff';
const { W, H } = PHYS;

const STYLES = [
	{ wall: '#283152', edge: '#56639a', lit: '#ffd98a' },
	{ wall: '#352b4a', edge: '#7a62a0', lit: '#ffc7a0' },
	{ wall: '#22363f', edge: '#4f8191', lit: '#bff0ff' },
	{ wall: '#3b3238', edge: '#8a6d74', lit: '#ffe2b0' },
];

const CSS = `
.run-wrap { position: relative; }
.run-turn { display: none; }
/* Phones held upright: suggest turning sideways. */
@media (orientation: portrait) and (max-width: 600px) {
	.run-turn { display: block; margin: 8px 0 0; font-size: 0.85rem; color: var(--text-muted); }
}
/*
 * Phones and small tablets held sideways (and full screen anywhere): the window fills the screen, the game
 * is as big as the height allows, and the controls sit in a column beside it instead of underneath.
 */
@media (orientation: landscape) and (max-height: 560px) {
	.secret-backdrop:has(.run-window) { padding: 0; align-items: stretch; }
	.secret-backdrop:has(.run-window) { justify-items: stretch; overflow: hidden; }
	.run-window { width: 100%; max-width: none; height: 100%; max-height: none; border-radius: 0; border: 0; }
}
@media (orientation: landscape) and (max-height: 560px) {
	.run-window .secret-titlebar { padding: 2px 6px 2px 12px; }
	.run-window .secret-title { font-size: 0.85rem; }
	.run-window .secret-body { flex: 1; display: flex; gap: 10px; padding: 6px 8px; overflow: hidden; }
	.run-window .run-wrap { flex: none; align-self: flex-start; }
	.run-window .secret-canvas { width: min(calc(100vw - 214px), calc((100dvh - 64px) * 16 / 9)); height: auto; }
	.run-window .run-bar { flex: 1; min-width: 150px; margin: 0; flex-direction: column; align-items: stretch; justify-content: flex-start; overflow: auto; }
	.run-window .run-bar > .secret-hint { display: none; }
	.run-window .run-tools { flex-direction: column; align-items: stretch; gap: 6px; }
	.run-window .run-tools .secret-btn { font-size: 0.8rem; padding: 6px 8px; }
	.run-window .run-mode { font-size: 0.75rem; }
	.run-window .secret-status { padding: 3px 10px; font-size: 0.75rem; }
}
.run-window:fullscreen { width: 100vw; height: 100vh; max-height: none; border-radius: 0; border: 0; }
.run-window:fullscreen .secret-body { flex: 1; display: flex; gap: 10px; padding: 6px 8px; overflow: hidden; }
.run-window:fullscreen .run-wrap { flex: none; align-self: flex-start; }
.run-window:fullscreen .secret-canvas { width: min(calc(100vw - 214px), calc((100vh - 64px) * 16 / 9)); height: auto; }
.run-window:fullscreen .run-bar { flex: 1; min-width: 150px; margin: 0; flex-direction: column; align-items: stretch; justify-content: flex-start; }
.run-window:fullscreen .run-bar > .secret-hint { display: none; }
.run-window:fullscreen .run-tools { flex-direction: column; align-items: stretch; }
.run-bar { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.run-bar p { margin: 0; }
.run-vote { position: absolute; left: 50%; top: 10px; transform: translate(-50%, -6px); display: flex; gap: 6px;
	align-items: center; padding: 3px 4px 3px 12px; border-radius: 999px; background: rgba(8, 10, 28, 0.55);
	border: 1px solid rgba(255, 255, 255, 0.12); color: #eef0ff; font-size: 0.78rem; white-space: nowrap;
	opacity: 0; visibility: hidden; transition: opacity .25s, transform .25s, visibility 0s .25s; }
.run-vote.is-on { opacity: 0.62; visibility: visible; transform: translate(-50%, 0); transition: opacity .25s, transform .25s; }
.run-vote.is-on:hover, .run-vote.is-on:focus-within { opacity: 1; }
.run-vote button { font: inherit; line-height: 1; cursor: pointer; padding: 3px 8px; border-radius: 999px; display: inline-flex;
	gap: 5px; align-items: center; border: 1px solid rgba(255, 255, 255, 0.14); background: transparent; color: inherit; }
.run-vote button[hidden] { display: none; }
.run-vote button:hover, .run-vote button:focus-visible { background: rgba(255, 231, 163, 0.16); border-color: rgba(255, 231, 163, 0.55); }
.run-vote kbd { font: 600 0.68rem ui-monospace, Consolas, monospace; opacity: 0.7; }
.run-replay { position: absolute; left: 50%; bottom: 9%; transform: translateX(-50%); }
.run-replay kbd { font: 600 0.72rem ui-monospace, Consolas, monospace; opacity: 0.7; margin-left: 4px; }
.run-tools { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.run-mode { color: var(--text-muted); font-size: 0.85rem; }
.run-pick { position: absolute; inset: 0; overflow: auto; padding: 14px 16px; border-radius: 10px;
	background: rgba(8, 10, 28, 0.96); color: #eef0ff; font-size: 0.88rem; display: grid; gap: 10px; align-content: start;
	/* Rows keep their full height and the panel scrolls; otherwise the scrolling card row gets squashed to fit. */
	grid-auto-rows: max-content; }
.run-pick[hidden] { display: none; }
.run-pick h3 { margin: 0; font-size: 1.05rem; color: #ffe7a3; }
.run-pick h4 { margin: 6px 0 2px; font-size: 0.85rem; color: var(--text-muted); font-weight: 600; }
.run-pick p { margin: 0; color: var(--text-muted); }
.run-pick-chosen { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; align-items: center; margin: 0; padding: 0; list-style: none; }
.run-pick-chosen li button { font: 600 0.8rem ui-monospace, Consolas, monospace; cursor: pointer; padding: 3px 8px; border-radius: 999px;
	border: 1px solid rgba(255, 231, 163, 0.5); background: rgba(255, 231, 163, 0.12); color: #ffe7a3; }
.run-pick-bands { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 4px 18px; }
.run-pick-row { display: flex; gap: 8px; align-items: baseline; }
.run-pick-row button { font: 600 0.8rem ui-monospace, Consolas, monospace; cursor: pointer; padding: 2px 8px; border-radius: 6px; flex: none;
	border: 1px solid rgba(255, 255, 255, 0.18); background: transparent; color: inherit; }
.run-pick-row button:hover, .run-pick-row button:focus-visible, .run-pick-chosen li button:hover { border-color: rgba(255, 231, 163, 0.7); }
.run-pick-row span { color: var(--text-muted); font-size: 0.8rem; }
.run-pick-preview { display: flex; gap: 8px; overflow-x: auto; margin: 0; padding: 2px 2px 8px; list-style: none;
	min-height: 40px; align-items: stretch; scroll-snap-type: x proximity; }
.run-pick-preview li { flex: none; scroll-snap-align: start; }
.run-pick-preview figure { margin: 0; display: grid; gap: 3px; width: 172px; padding: 5px; border-radius: 8px;
	border: 1px solid rgba(255, 231, 163, 0.35); background: rgba(255, 231, 163, 0.05); }
.run-pick-preview img { display: block; width: 100%; height: auto; aspect-ratio: 200 / 96; border-radius: 4px; }
.run-pick-preview figcaption { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 2px 6px;
	font: 600 0.78rem ui-monospace, Consolas, monospace; color: #ffe7a3; }
.run-pick-preview figcaption span { flex-basis: 100%; color: var(--text-muted); font-weight: 400; font-size: 0.72rem; }
.run-pick-preview button { font: inherit; cursor: pointer; padding: 1px 7px; border-radius: 999px;
	border: 1px solid rgba(255, 231, 163, 0.4); background: transparent; color: #ffe7a3; }
.run-pick-preview button:hover, .run-pick-preview button:focus-visible { background: rgba(255, 231, 163, 0.16); }
.run-pick-preview .is-new figure { animation: run-pick-in 0.35s ease-out; }
@keyframes run-pick-in { from { transform: translateY(6px); opacity: 0; } }
.run-peek { position: absolute; z-index: 5; pointer-events: none; width: 220px; padding: 6px; border-radius: 8px;
	background: rgba(8, 10, 28, 0.98); border: 1px solid rgba(255, 231, 163, 0.45); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	opacity: 0; transform: translateY(4px); transition: opacity 0.12s, transform 0.12s; }
.run-peek.is-on { opacity: 1; transform: none; }
.run-peek img { display: block; width: 100%; height: auto; aspect-ratio: 200 / 96; border-radius: 4px; }
.run-peek p { margin: 5px 0 0; font: 600 0.75rem ui-monospace, Consolas, monospace; color: #ffe7a3; }
.run-peek p span { color: var(--text-muted); font-weight: 400; }
@media (hover: none) { .run-peek { display: none; } }
.run-strip { display: flex; overflow-x: auto; gap: 0; padding-bottom: 8px; }
.run-strip-seg { margin: 0; flex: none; display: grid; gap: 4px; }
.run-strip-seg figcaption { font: 600 0.75rem ui-monospace, Consolas, monospace; color: #ffe7a3; padding-left: 4px;
	border-left: 1px dashed rgba(255, 231, 163, 0.5); white-space: nowrap; }
.run-strip-seg canvas { display: block; }
.run-strip-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 8px 0 0; font-size: 0.8rem; color: var(--text-muted); }
.run-strip-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.run-pick-actions { display: flex; gap: 8px; flex-wrap: wrap; position: sticky; bottom: -14px; padding: 8px 0; background: rgba(8, 10, 28, 0.96); }
`;

const hash = (a: number, b: number, c = 0) => {
	let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/**
 * A run that starts from set segments (picked by the player, or a replay); after them it carries on with
 * random ones. Runs like this go on the 'chosen' board.
 */
export interface RunPlan {
	label: string;
	segments: { v: string; recipe: Recipe }[];
	/** A time to beat (the replayed run's), shown in the corner. */
	target?: { name: string; seconds: number };
}

export interface LaunchOptions {
	plan?: RunPlan;
}

export function launch(opts: LaunchOptions = {}): void {
	setData('now-opened', true);
	if (!document.getElementById('secret-style-runner')) {
		const s = document.createElement('style');
		s.id = 'secret-style-runner';
		s.textContent = CSS;
		document.head.append(s);
	}
	const win = openWindow({ title: 'Conservation of Momentum', width: 900 });
	win.body.innerHTML = `
		<div class="run-wrap">
			<canvas class="secret-canvas" aria-label="Rooftop runner. Press space or tap to jump."></canvas>
			<div class="run-vote" role="group" aria-label="Rate the last segment" aria-live="polite">
				<span class="run-vote-q"></span>
				<button type="button" data-vote="1" aria-label="Thumbs up (key 1)" title="Thumbs up (1)">👍<kbd>1</kbd></button>
				<button type="button" data-vote="-1" aria-label="Thumbs down (key 2)" title="Thumbs down (2)">👎<kbd>2</kbd></button>
			</div>
			<button type="button" class="secret-btn run-replay" hidden>↻ Replay this run <kbd>F</kbd></button>
			<div class="run-pick" hidden role="dialog" aria-label="Choose segments"></div>
			<div class="run-peek" aria-hidden="true"><img alt=""><p></p></div>
		</div>
		<div class="run-bar">
			<p class="secret-hint">Jump: Space, ↑, W, or tap/click the game. Hold for a higher jump. R restarts. Rate a segment with 1 (👍) or 2 (👎).</p>
			<div class="run-tools">
				<span class="run-mode"></span>
				<button type="button" class="secret-btn run-random" hidden>Random runs</button>
				<button type="button" class="secret-btn run-choose">Choose segments</button>
				<button type="button" class="secret-btn run-sound" aria-pressed="true">Sound: on</button>
				<button type="button" class="secret-btn run-full" hidden>Full screen</button>
			</div>
		</div>
		<p class="run-turn">Turn your phone sideways for a bigger view.</p>`;
	win.root.classList.add('run-window');
	// Full screen, where the browser allows it on an element (not iPhone Safari).
	const fullBtn = win.body.querySelector<HTMLButtonElement>('.run-full')!;
	fullBtn.hidden = !document.fullscreenEnabled;
	const showFull = () => (fullBtn.textContent = document.fullscreenElement === win.root ? 'Exit full screen' : 'Full screen');
	fullBtn.addEventListener('click', () => {
		if (document.fullscreenElement) void document.exitFullscreen();
		else void win.root.requestFullscreen?.().catch(() => {});
	});
	document.addEventListener('fullscreenchange', showFull);
	win.onClose(() => {
		document.removeEventListener('fullscreenchange', showFull);
		if (document.fullscreenElement === win.root) void document.exitFullscreen();
	});
	const canvas = win.body.querySelector('canvas')!;
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	canvas.width = CW * dpr;
	canvas.height = CH * dpr;
	const ctx = canvas.getContext('2d')!;

	// Sound (footsteps, jumps, wind); the toggle is remembered.
	let muted = getData<boolean>('now-muted', false);
	const sound = createRunnerSound(muted);
	const soundBtn = win.body.querySelector<HTMLButtonElement>('.run-sound')!;
	const showSound = () => {
		soundBtn.textContent = muted ? 'Sound: off' : 'Sound: on';
		soundBtn.setAttribute('aria-pressed', String(!muted));
	};
	showSound();
	soundBtn.addEventListener('click', () => {
		muted = !muted;
		sound.wake();
		sound.setMuted(muted);
		setData('now-muted', muted);
		showSound();
	});
	// ---- World and physics: src/secrets/runner/sim.ts ------------------------------------------
	let deadFor = 0;
	let goalFlash = 0;
	let best = getData<number>('now-best', 0);
	const seenHints = getData<Record<string, number>>('now-hints', {});
	let showHint: Record<string, boolean> = {};
	const sim = createSim({
		goal: GOAL,
		onEvent(e) {
			switch (e.type) {
				case 'jump':
					sound.jump(e.kind);
					break;
				case 'land':
					sound.land(e.strength);
					break;
				case 'footstep':
					sound.footstep(e.surface, e.loudness);
					break;
				case 'clunk':
					sound.trainClunk(e.level);
					break;
				case 'hint':
					seenHints[e.key] = (seenHints[e.key] ?? 0) + 1;
					break;
				case 'goal':
					goalFlash = 3;
					if (!isSolved(ID)) solve(ID);
					break;
				case 'die':
					deadFor = 0;
					onRunOver();
					chime('error');
					if (sim.S.time > best) {
						best = sim.S.time;
						setData('now-best', best);
					}
					setData('now-hints', seenHints);
					break;
			}
		},
	});
	const P = sim.S.P;
	// The drawing code reads the world through these, refreshed from the sim before each frame.
	let segments: Segment[] = [];
	let solids: Solid[] = [];
	let slopes: Slope[] = [];
	let facades: Facade[] = [];
	let hazards: Box[] = [];
	let grapples: Grapple[] = [];
	let wallRuns: Box[] = [];
	let trainDefs: Train[] = [];
	let hints: Hint[] = [];
	let trains: TrainState[] = [];
	let vents: Box[] = [];
	let signs: Box[] = [];
	let drones: DroneState[] = [];
	let mode: 'ready' | 'running' | 'dead' = 'ready';
	let time = 0;
	let deathCause = '';
	function sync() {
		({ segments, solids, slopes, facades, hazards, grapples, wallRuns, trainDefs, hints, trains, vents, signs, drones, mode, time, deathCause } =
			sim.S);
	}
	const cam = { x: 0, cy: 0 };
	/** When the runner last landed on a train (sim time), for the balance animation. */
	let rideStart = 0;
	let wasRiding = false;
	const HINT_KEYS = ['jump', 'hazard', 'slope', 'grapple', 'wallrun', 'chimney', 'train', 'ramp', 'chain', 'switchback', 'updraft', 'drone', 'dronestep', 'longtrain'];

	// ---- Ratings: thumbs up/down on each segment, sent to the Worker for training the level model ---
	// After leaving a pool segment, a faint prompt at the top offers a rating of it for a few seconds (keys
	// 1 and 2, or a tap). When the run ends, it asks about the segment the run ended in and stays up.
	/** The run's pool segments in order, with their pools version, and when each was entered (run clock). */
	let played: { seg: Segment; recipe: Recipe; id: string; v: string; enteredAt: number }[] = [];
	/** Pools version of recipes from elsewhere (a replay of a run on older pools); the rest are current. */
	const versionOf = new WeakMap<Recipe, string>();
	/** Rated only when the recipe is in the deployed pools (the Worker can't match it otherwise). */
	const rateable = (e: { id: string; v: string }) => e.v === POOLS_VERSION && !!findRecipe(e.id);
	let runId = '';
	interface Prompt {
		position: number;
		id: string;
		outcome: 'cleared' | 'died';
		seconds: number;
		runSeconds: number;
		cause?: string;
	}
	let prompt: Prompt | null = null;
	/** Seconds the prompt has left on screen (Infinity while the run is over). */
	let promptLeft = 0;
	let promptVoted = false;
	const RATE_FOR = 6;
	const voteBox = win.body.querySelector<HTMLElement>('.run-vote')!;
	const voteQ = voteBox.querySelector<HTMLElement>('.run-vote-q')!;
	const voteBtns = [...voteBox.querySelectorAll<HTMLButtonElement>('button')];
	const newRunId = () =>
		typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

	function ask(p: Prompt) {
		prompt = p;
		promptVoted = false;
		promptLeft = p.outcome === 'died' ? Infinity : RATE_FOR;
		voteQ.textContent = p.outcome === 'died' ? 'Rate the segment that ended the run' : 'Rate that segment';
		voteBtns.forEach((b) => (b.hidden = false));
		voteBox.classList.add('is-on');
	}
	function hidePrompt() {
		prompt = null;
		promptLeft = 0;
		voteBox.classList.remove('is-on');
	}

	/** Notes the segment underfoot when it's a new pool recipe, and offers a rating of the one before. */
	function trackSegment() {
		if (mode !== 'running') return;
		const seg = segments.find((s) => P.x >= s.x0 && P.x < s.x1);
		if (!seg?.recipe || !seg.label) return;
		const prev = played[played.length - 1];
		if (prev?.seg === seg) return;
		// Pool recipes, or ones from a plan; not the intro roof or a seed fallback.
		if (!versionOf.has(seg.recipe) && findRecipe(seg.label) !== seg.recipe) return;
		played.push({ seg, recipe: seg.recipe, id: seg.label, v: versionOf.get(seg.recipe) ?? POOLS_VERSION, enteredAt: time });
		if (prev && rateable(prev)) {
			const position = played.length - 2;
			ask({ position, id: prev.id, outcome: 'cleared', seconds: time - prev.enteredAt, runSeconds: time });
		}
	}

	/** On the sim's 'die' event, which arrives mid-step: reads the sim directly, not the synced copies. */
	function onRunOver() {
		saveRun();
		const last = played[played.length - 1];
		if (!last || !rateable(last)) return hidePrompt();
		ask({
			position: played.length - 1,
			id: last.id,
			outcome: 'died',
			seconds: sim.S.time - last.enteredAt,
			runSeconds: sim.S.time,
			cause: sim.S.deathCause,
		});
	}

	function rate(value: 1 | -1) {
		const p = prompt;
		if (!p || promptVoted) return;
		promptVoted = true;
		voteBtns.forEach((b) => (b.hidden = true));
		voteQ.textContent = value > 0 ? '👍 Thanks!' : '👎 Thanks, noted.';
		if (p.outcome !== 'died') promptLeft = 1.2;
		void fetch('/api/runner/vote', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				playerId: load().playerId,
				runId,
				position: p.position,
				id: p.id,
				vote: value,
				poolsVersion: POOLS_VERSION,
				outcome: p.outcome,
				seconds: +p.seconds.toFixed(2),
				runSeconds: +p.runSeconds.toFixed(2),
				cause: p.cause,
			}),
		})
			.then((res) => {
				if (!res.ok) throw new Error(String(res.status));
			})
			.catch(() => {
				// Mid-run a lost rating isn't worth interrupting for; at the end, say so.
				if (prompt === p && p.outcome === 'died') voteQ.textContent = 'Couldn’t send that rating right now.';
			});
	}
	voteBox.addEventListener('click', (e) => {
		const btn = (e.target as Element).closest<HTMLButtonElement>('[data-vote]');
		if (btn) rate(btn.dataset.vote === '1' ? 1 : -1);
	});
	// Taps on the prompt shouldn't reach the game underneath.
	voteBox.addEventListener('pointerdown', (e) => e.stopPropagation());

	// ---- Runs: posting bests, replays, and runs from chosen segments ------------------------------
	let plan: RunPlan | null = null;
	/** The run that just ended, for "Replay this run". */
	let lastRun: { segments: { v: string; recipe: Recipe }[]; seconds: number } | null = null;
	const modeEl = win.body.querySelector<HTMLElement>('.run-mode')!;
	const randomBtn = win.body.querySelector<HTMLButtonElement>('.run-random')!;
	const chooseBtn = win.body.querySelector<HTMLButtonElement>('.run-choose')!;
	const replayBtn = win.body.querySelector<HTMLButtonElement>('.run-replay')!;
	const picker = win.body.querySelector<HTMLElement>('.run-pick')!;

	function setPlan(next: RunPlan | null) {
		plan = next;
		for (const e of plan?.segments ?? []) versionOf.set(e.recipe, e.v);
		const n = plan?.segments.length ?? 0;
		modeEl.textContent = plan ? `${plan.label}: ${n} segment${n === 1 ? '' : 's'}, then random` : 'Random runs';
		randomBtn.hidden = !plan;
		win.setStatus('');
		reset();
	}

	/** On the sim's 'die' event: keeps the run for replaying, and posts it if it's a new best. */
	function saveRun() {
		if (!played.length) {
			lastRun = null;
			return;
		}
		const seconds = sim.S.time;
		lastRun = { segments: played.map((e) => ({ v: e.v, recipe: e.recipe })), seconds };
		const category: RunCategory = plan ? 'chosen' : 'random';
		const board = category === 'random' ? 'random runs' : 'chosen runs';
		void recordRun({
			category,
			seconds: +seconds.toFixed(2),
			distance: Math.max(0, Math.floor(P.maxX - 4)),
			segments: played.map((e) => ({ v: e.v, id: e.id })),
		}).then((r) => {
			if (!r.best) return;
			const t = fmtTime(seconds);
			win.setStatus(
				!r.signed
					? `New best in ${board}: ${t}. Sign in to the leaderboards to post it.`
					: r.offline
						? `New best in ${board}: ${t}. The leaderboard can’t be reached; it’ll be posted later.`
						: r.rank
							? `New best in ${board}: ${t}. You’re ${ordinal(r.rank)} on that board.`
							: `New best in ${board}: ${t}.`,
			);
		});
	}

	function replayLast() {
		if (!lastRun || mode !== 'dead') return;
		const run = lastRun;
		setPlan({ label: 'Replaying your run', segments: run.segments, target: { name: 'your run', seconds: run.seconds } });
	}
	replayBtn.addEventListener('click', replayLast);
	replayBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
	randomBtn.addEventListener('click', () => setPlan(null));

	// The picker: segments from every band, in the order picked; they play after the intro roof.
	let picking = false;
	let picks: string[] = [];
	/** Index of the card just added, so it slides in and the row scrolls to it. */
	let justAdded = -1;
	function renderPicker() {
		picker.innerHTML = `
			<h3>Choose segments</h3>
			<p>Pick segments in the order you want them. They play after the first roof, then the run carries on with
			random ones. Runs that start this way go on the leaderboard’s <b>Chosen</b> board.</p>
			<ol class="run-pick-preview" aria-label="Your segments, in order">${
				picks.length
					? picks
							.map((id, i) => {
								const r = findRecipe(id)!;
								return `<li${i === justAdded ? ' class="is-new"' : ''}><figure><img src="${segmentThumb(r)}" alt="Segment ${id}: ${r.features
									.map((f) => f.type)
									.join(', ')}"><figcaption><b>${i + 1}. ${id}</b><button type="button" data-remove="${i}" title="Remove ${id}" aria-label="Remove ${id}">✕</button><span>${bandName(r.tier)}</span></figcaption></figure></li>`;
							})
							.join('')
					: '<li><p>None yet. Add segments below and they’ll appear here.</p></li>'
			}</ol>
			<div class="run-pick-bands">${POOLS.map(
				(pool, t) =>
					`<div><h4>${bandName(t)}</h4>${pool
						.map(
							(r) =>
								`<div class="run-pick-row"><button type="button" data-add="${r.id}" title="Add ${r.id}">+ ${r.id}</button><span>${r.features
									.map((f) => f.type)
									.join(' · ')}</span></div>`,
						)
						.join('')}</div>`,
			).join('')}</div>
			<div class="run-pick-actions">
				<button type="button" class="secret-btn" data-act="play" ${picks.length ? '' : 'disabled'}>Play these</button>
				<button type="button" class="secret-btn" data-act="full" ${picks.length ? '' : 'disabled'}>View the whole run</button>
				<button type="button" class="secret-btn" data-act="clear" ${picks.length ? '' : 'disabled'}>Clear</button>
				<button type="button" class="secret-btn" data-act="close">Cancel</button>
			</div>`;
	}
	function openPicker() {
		picking = true;
		reset();
		picks = getData<string[]>('now-picks', []).filter((id) => findRecipe(id));
		renderPicker();
		picker.hidden = false;
		picker.querySelector<HTMLElement>('[data-add]')?.focus();
	}
	function closePicker() {
		hidePeek();
		picking = false;
		picker.hidden = true;
		chooseBtn.focus();
	}
	chooseBtn.addEventListener('click', openPicker);
	picker.addEventListener('click', (e) => {
		const el = (e.target as Element).closest<HTMLElement>('button');
		if (!el) return;
		justAdded = -1;
		if (el.dataset.add) {
			if (picks.length < 60) {
				picks.push(el.dataset.add);
				justAdded = picks.length - 1;
			}
		} else if (el.dataset.remove) {
			picks.splice(Number(el.dataset.remove), 1);
		} else if (el.dataset.act === 'clear') {
			picks = [];
		} else if (el.dataset.act === 'close') {
			return closePicker();
		} else if (el.dataset.act === 'full') {
			return showWholeRun();
		} else if (el.dataset.act === 'play') {
			setData('now-picks', picks);
			closePicker();
			setPlan({ label: 'Your segments', segments: picks.map((id) => ({ v: POOLS_VERSION, recipe: findRecipe(id)! })) });
			return;
		}
		hidePeek();
		const scroll = picker.scrollTop;
		const row = picker.querySelector<HTMLElement>('.run-pick-preview');
		const rowScroll = row?.scrollLeft ?? 0;
		renderPicker();
		picker.scrollTop = scroll;
		const newRow = picker.querySelector<HTMLElement>('.run-pick-preview')!;
		newRow.scrollLeft = rowScroll;
		if (justAdded >= 0) newRow.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
	});

	// Hovering (or tabbing to) a segment's add button shows a picture of it beside the button.
	const peekArea = win.body.querySelector<HTMLElement>('.run-wrap')!;
	const peek = win.body.querySelector<HTMLElement>('.run-peek')!;
	const peekImg = peek.querySelector('img')!;
	const peekText = peek.querySelector('p')!;
	let peekFor: HTMLElement | null = null;
	function showPeek(btn: HTMLElement) {
		const r = findRecipe(btn.dataset.add!);
		if (!r) return;
		peekFor = btn;
		peekImg.src = segmentThumb(r);
		peekText.innerHTML = `${btn.dataset.add} <span>${bandName(r.tier)}</span>`;
		// Beside the button, flipped to the other side or above it when it would run off the game.
		const box = peekArea.getBoundingClientRect();
		const b = btn.getBoundingClientRect();
		const w = peek.offsetWidth || 220;
		const h = peek.offsetHeight || 130;
		let x = b.right - box.left + 10;
		if (x + w > box.width - 4) x = b.left - box.left - w - 10;
		if (x < 4) x = Math.min(Math.max(4, b.left - box.left), box.width - w - 4);
		let y = b.top - box.top + b.height / 2 - h / 2;
		y = Math.min(Math.max(4, y), box.height - h - 4);
		peek.style.left = `${x}px`;
		peek.style.top = `${y}px`;
		peek.classList.add('is-on');
	}
	function hidePeek() {
		peekFor = null;
		peek.classList.remove('is-on');
	}
	picker.addEventListener('pointerover', (e) => {
		if (e.pointerType !== 'mouse') return;
		const btn = (e.target as Element).closest<HTMLElement>('[data-add]');
		if (btn && btn !== peekFor) showPeek(btn);
		else if (!btn && peekFor) hidePeek();
	});
	picker.addEventListener('pointerleave', hidePeek);
	picker.addEventListener('focusin', (e) => {
		const btn = (e.target as Element).closest<HTMLElement>('[data-add]');
		if (btn && btn.matches(':focus-visible')) showPeek(btn);
		else hidePeek();
	});
	picker.addEventListener('focusout', hidePeek);
	picker.addEventListener('scroll', hidePeek);

	/** The planned run drawn end to end, in its own window over the game. */
	function showWholeRun() {
		const recipes = picks.map((id) => findRecipe(id)!);
		const total = recipes.length;
		const view = openWindow({ title: 'Your run, end to end', width: 900 });
		view.body.innerHTML = `
			<p class="secret-hint" style="margin-top:0">The first roof, then your ${total} segment${total === 1 ? '' : 's'} in order. Scroll sideways to follow the run.</p>
			<div class="run-strip" tabindex="0" aria-label="The whole run, drawn end to end"></div>
			<p class="run-strip-legend">
				<span><i style="background:#ff6b5c"></i>hazard</span><span><i style="background:#7fe3ff"></i>vent, climbing wall, grapple</span>
				<span><i style="background:#9fb0d0"></i>drone</span><span><i style="background:#c9cfdc"></i>train</span>
				<span><i style="background:#56607d"></i>ledge or deck</span><span><i style="background:#6b5a45"></i>crate</span>
			</p>`;
		renderRunStrip(view.body.querySelector<HTMLElement>('.run-strip')!, recipes, picks);
	}

	function reset() {
		// A plan's segments are queued again on every restart; otherwise the run is all random.
		sim.force(plan ? plan.segments.map((e) => [e.recipe, e.recipe.tier] as [Recipe, number]) : []);
		sync();
		played = [];
		runId = newRunId();
		hidePrompt();
		deadFor = 0;
		showHint = Object.fromEntries(HINT_KEYS.map((k) => [k, (seenHints[k] ?? 0) < 3]));
		cam.x = P.x - VIEW_W * 0.28;
		cam.cy = P.y + 3;
	}
	const floorAt = () => sim.floorAt();
	const nearestGrapple = () => sim.nearestGrapple();

	function updateCamera(dt: number) {
		// Look ahead in the running direction, easing across when it flips.
		const ahead = Math.min(5, Math.max(0, (Math.abs(P.vx) - START_SPEED) * 0.35));
		// Riding a train, sit near the left edge so most of the view is ahead (signs, the far building).
		const lead = P.train ? VIEW_W * 0.15 : VIEW_W * 0.28 + ahead;
		const tx = P.dir === 1 ? P.x - lead : P.x - VIEW_W + lead;
		cam.x += (tx - cam.x) * Math.min(1, dt * 3);
		const floor = floorAt();
		let target = P.y + 2.6;
		target = Math.max(target, floor - FLOOR_MARGIN + VIEW_H / 2);
		const rate = target < cam.cy ? 7 : 4;
		if (mode !== 'dead') cam.cy += (target - cam.cy) * Math.min(1, dt * rate);
	}

	// ---- Drawing -------------------------------------------------------------------------------
	const stars = Array.from({ length: 70 }, (_, i) => ({ x: hash(i, 1) * CW, y: hash(i, 2) * CH * 0.6, r: hash(i, 3) }));
	const camB = () => cam.cy - VIEW_H / 2;
	const sx = (x: number) => (x - cam.x) * SCALE;
	const sy = (y: number) => CH - (y - camB()) * SCALE;

	function drawSky() {
		const g = ctx.createLinearGradient(0, 0, 0, CH);
		g.addColorStop(0, '#070a1e');
		g.addColorStop(0.55, '#1d1840');
		g.addColorStop(1, '#43264e');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, CW, CH);
		for (const s of stars) {
			ctx.globalAlpha = 0.25 + s.r * 0.6;
			ctx.fillStyle = '#fff';
			ctx.fillRect(s.x, s.y, s.r > 0.8 ? 2 : 1, s.r > 0.8 ? 2 : 1);
		}
		ctx.globalAlpha = 1;
		ctx.fillStyle = '#fff3d6';
		ctx.shadowColor = '#fff3d6';
		ctx.shadowBlur = 30;
		ctx.beginPath();
		ctx.arc(CW * 0.78, CH * 0.18, 26, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;
	}

	const LAYERS = [
		{ f: 0.1, cell: 5, min: 4, max: 13, color: '#171535', lit: 0 },
		{ f: 0.22, cell: 4, min: 3, max: 11, color: '#1f1b40', lit: 0.05 },
		{ f: 0.42, cell: 3.4, min: 2, max: 9, color: '#29224a', lit: 0.1 },
	];
	/** How far (px) the skyline may rise as the run climbs; past this it stays put, so it never fills the sky. */
	const SKYLINE_RISE = CH * 0.12;
	function drawParallax() {
		LAYERS.forEach((L, li) => {
			const off = cam.x * L.f;
			// The skyline drifts up a little as the run climbs (and down as it falls), easing to a stop.
			const rise = camB() * L.f * 0.3 * SCALE;
			const base = CH + 40 - SKYLINE_RISE * Math.tanh(rise / SKYLINE_RISE);
			const unit = SCALE * (0.55 + li * 0.15);
			const first = Math.floor(off / L.cell) - 1;
			const count = Math.ceil(VIEW_W / L.cell / (0.55 + li * 0.15)) + 3;
			ctx.fillStyle = L.color;
			for (let i = first; i < first + count; i++) {
				const h = L.min + hash(i, li + 10) * (L.max - L.min);
				const w = L.cell * (0.6 + 0.4 * hash(i, li + 20));
				const x = (i * L.cell - off) * unit;
				const top = base - h * unit;
				ctx.fillRect(x, top, w * unit, CH - top + 50);
				if (L.lit) {
					ctx.fillStyle = 'rgba(255, 214, 150, 0.55)';
					for (let r = 0; r < h * 1.5; r++)
						for (let c = 0; c < w * 1.5; c++)
							if (hash(i * 31 + c, r, li) < L.lit) ctx.fillRect(x + c * unit * 0.66 + 2, top + r * unit * 0.66 + 3, 2, 2);
					ctx.fillStyle = L.color;
				}
			}
		});
		// Haze where the street would be.
		const g = ctx.createLinearGradient(0, CH * 0.6, 0, CH);
		g.addColorStop(0, 'rgba(67, 38, 78, 0)');
		g.addColorStop(1, 'rgba(67, 38, 78, 0.55)');
		ctx.fillStyle = g;
		ctx.fillRect(0, CH * 0.6, CW, CH * 0.4);
	}

	function visible(x0: number, x1: number) {
		return x1 > cam.x - 1 && x0 < cam.x + VIEW_W + 1;
	}

	function drawTrains() {
		for (const def of trainDefs) {
			if (!visible(def.x0, def.x1)) continue;
			const deck = def.top - 2.8;
			ctx.fillStyle = '#1a1730';
			ctx.fillRect(sx(def.x0), sy(deck), (def.x1 - def.x0) * SCALE, 0.5 * SCALE);
			for (let px = def.x0 + 3; px < def.x1 - 1; px += 7) ctx.fillRect(sx(px), sy(deck - 0.5), 0.8 * SCALE, CH);
			ctx.strokeStyle = '#6d6a8a';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(sx(def.x0), sy(deck));
			ctx.lineTo(sx(def.x1), sy(deck));
			ctx.stroke();
		}
		// Railway sign poles stand beside the track, behind the train.
		ctx.fillStyle = '#4b4f63';
		for (const z of signs) {
			if (!visible(z.x - 1, z.x + 1)) continue;
			ctx.fillRect(sx(z.x + z.w / 2 - 0.06), sy(z.y), 0.12 * SCALE, 3.1 * SCALE);
		}
		for (const t of trains) {
			if (t.done) continue;
			// Only ever drawn between the two tunnel mouths: it rolls out of one and is gone into the other.
			ctx.save();
			ctx.beginPath();
			ctx.rect(sx(t.def.x0), 0, (t.def.x1 - t.def.x0) * SCALE, CH);
			ctx.clip();
			const rear = t.nose - t.def.len;
			const top = t.def.top;
			ctx.fillStyle = '#c9cfdc';
			ctx.beginPath();
			ctx.moveTo(sx(rear), sy(top));
			ctx.lineTo(sx(t.nose - 1.6), sy(top));
			ctx.lineTo(sx(t.nose), sy(top - 1.4));
			ctx.lineTo(sx(t.nose), sy(top - 2.6));
			ctx.lineTo(sx(rear), sy(top - 2.6));
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = '#2d3a5c';
			ctx.fillRect(sx(rear + 0.5), sy(top - 0.5), (t.def.len - 2.6) * SCALE, 0.7 * SCALE);
			ctx.fillStyle = 'rgba(255, 228, 160, 0.8)';
			for (let wx = rear + 1; wx < t.nose - 2.5; wx += 1.6) ctx.fillRect(sx(wx), sy(top - 0.6), 0.9 * SCALE, 0.45 * SCALE);
			ctx.fillStyle = '#e25c5c';
			ctx.fillRect(sx(rear + 0.3), sy(top - 1.9), (t.def.len - 1.8) * SCALE, 0.18 * SCALE);
			ctx.fillStyle = '#fff6c8';
			ctx.fillRect(sx(t.nose - 0.35), sy(top - 1.9), 0.3 * SCALE, 0.3 * SCALE);
			ctx.restore();
		}
		// The sign boards, in front of the train: red and white stripes at body height.
		for (const z of signs) {
			if (!visible(z.x - 1, z.x + 1)) continue;
			const x0 = sx(z.x);
			const y0 = sy(z.y + z.h);
			const w = z.w * SCALE;
			const hgt = z.h * SCALE;
			ctx.save();
			ctx.beginPath();
			ctx.rect(x0, y0, w, hgt);
			ctx.clip();
			ctx.fillStyle = '#f2f2f5';
			ctx.fillRect(x0, y0, w, hgt);
			ctx.fillStyle = '#d83a3a';
			for (let k = -2; k < 8; k++) {
				ctx.beginPath();
				ctx.moveTo(x0, y0 + k * 9);
				ctx.lineTo(x0 + w, y0 + k * 9 - 9);
				ctx.lineTo(x0 + w, y0 + k * 9 - 4);
				ctx.lineTo(x0, y0 + k * 9 + 5);
				ctx.closePath();
				ctx.fill();
			}
			ctx.restore();
			ctx.strokeStyle = '#1b1b24';
			ctx.lineWidth = 2;
			ctx.strokeRect(x0, y0, w, hgt);
			ctx.fillStyle = '#ffcf5a';
			ctx.beginPath();
			ctx.arc(x0 + w / 2, y0 - 4, 3, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function drawFacades() {
		for (const f of facades) {
			if (!visible(f.x, f.x + f.w)) continue;
			const st = STYLES[f.style % STYLES.length];
			const bottom = Math.min(camB() - 1, STREET);
			if (f.opening) {
				// The corridor's interior, always visible.
				ctx.fillStyle = '#100d1c';
				ctx.fillRect(sx(f.x), sy(f.opening.y1), f.w * SCALE, (f.opening.y1 - f.opening.y0) * SCALE);
				ctx.fillStyle = 'rgba(255, 220, 160, 0.5)';
				for (let lx = f.x + 1.5; lx < f.x + f.w - 1; lx += 3) ctx.fillRect(sx(lx), sy(f.opening.y1 - 0.05), 0.8 * SCALE, 3);
			}
			const parts = f.opening
				? [
						[f.opening.y1, f.top],
						[Math.max(bottom, camB() - 2), f.opening.y0],
					]
				: [[Math.max(bottom, camB() - 2), f.top]];
			for (const [y0, y1] of parts) {
				if (y1 <= y0) continue;
				ctx.fillStyle = st.wall;
				ctx.fillRect(sx(f.x), sy(y1), f.w * SCALE, (y1 - y0) * SCALE);
				// Windows.
				for (let r = 0; ; r++) {
					const wy = y1 - 1.1 - r * 1.7;
					// The whole window (0.75 m tall, hanging down from wy) stays inside this part of the wall,
					// clear of a corridor cut through the building below it.
					if (wy - 0.75 < y0 + 0.2 || wy < camB() - 1) break;
					if (wy > camB() + VIEW_H + 1) continue;
					for (let c = 0; ; c++) {
						const wx = f.x + 0.7 + c * 1.35;
						if (wx + 0.6 > f.x + f.w - 0.4) break;
						const lit = hash(f.seed, c, r) < 0.33;
						ctx.fillStyle = lit ? st.lit : 'rgba(10, 12, 30, 0.55)';
						ctx.globalAlpha = lit ? 0.85 : 1;
						ctx.fillRect(sx(wx), sy(wy), 0.55 * SCALE, 0.75 * SCALE);
						ctx.globalAlpha = 1;
					}
				}
			}
			// Roof edge.
			ctx.fillStyle = st.edge;
			ctx.fillRect(sx(f.x), sy(f.top), f.w * SCALE, 0.22 * SCALE);
			if (f.opening) ctx.fillRect(sx(f.x), sy(f.opening.y0), f.w * SCALE, 0.22 * SCALE);
			ctx.globalAlpha = 1;
			if (f.tunnel) {
				const tx = f.tunnel.side === 'left' ? f.x : f.x + f.w - 1.4;
				ctx.fillStyle = '#07060e';
				ctx.fillRect(sx(tx), sy(f.tunnel.y1), 1.4 * SCALE, (f.tunnel.y1 - f.tunnel.y0) * SCALE);
				ctx.strokeStyle = st.edge;
				ctx.lineWidth = 3;
				ctx.strokeRect(sx(tx), sy(f.tunnel.y1), 1.4 * SCALE, (f.tunnel.y1 - f.tunnel.y0) * SCALE);
			}
		}
	}

	function drawProps(now: number) {
		for (const s of slopes) {
			if (!visible(s.x0, s.x1)) continue;
			// Painted like the building it sits on (the one whose roof is at the slope's foot).
			const base = facades.find((f) => f.x <= s.x0 + 0.01 && f.x + f.w >= s.x1 - 0.01 && Math.abs(f.top - s.y1) < 0.01);
			const st = STYLES[(base?.style ?? 0) % STYLES.length];
			ctx.fillStyle = st.wall;
			ctx.beginPath();
			ctx.moveTo(sx(s.x0), sy(s.y0));
			ctx.lineTo(sx(s.x1), sy(s.y1));
			// Down past the building's roofline stripe, so it doesn't show as a seam under the slope.
			ctx.lineTo(sx(s.x1), sy(s.y1 - 0.25));
			ctx.lineTo(sx(s.x0), sy(s.y1 - 0.25));
			ctx.closePath();
			ctx.fill();
			// The surface: the same 0.22 m band as a flat roof's edge.
			ctx.fillStyle = st.edge;
			ctx.beginPath();
			ctx.moveTo(sx(s.x0), sy(s.y0));
			ctx.lineTo(sx(s.x1), sy(s.y1));
			ctx.lineTo(sx(s.x1), sy(s.y1 - 0.22));
			ctx.lineTo(sx(s.x0), sy(s.y0 - 0.22));
			ctx.closePath();
			ctx.fill();
			// Roof tiles.
			ctx.strokeStyle = st.edge;
			ctx.globalAlpha = 0.35;
			ctx.lineWidth = 1;
			for (let k = 1; k < 4; k++) {
				const o = k * 0.45;
				ctx.beginPath();
				ctx.moveTo(sx(s.x0), sy(s.y0 - o));
				ctx.lineTo(sx(s.x1 - (o * (s.x1 - s.x0)) / (s.y0 - s.y1)), sy(s.y1));
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
		}
		for (const s of solids) {
			if (!visible(s.x, s.x + s.w)) continue;
			if (s.kind === 'deck') {
				// A scaffold deck: planks over a truss.
				ctx.strokeStyle = '#5c6684';
				ctx.lineWidth = 2;
				ctx.beginPath();
				// A whole number of truss bays, so the last one ends at the deck's end.
				const bays = Math.max(1, Math.round(s.w / 1.2));
				const bay = s.w / bays;
				for (let i = 0; i < bays; i++) {
					const tx = s.x + i * bay;
					ctx.moveTo(sx(tx), sy(s.y));
					ctx.lineTo(sx(tx + bay / 2), sy(s.y - 0.5));
					ctx.lineTo(sx(tx + bay), sy(s.y));
				}
				ctx.stroke();
				ctx.fillStyle = '#a7adc8';
				ctx.fillRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
			} else if (s.kind === 'ledge') {
				ctx.fillStyle = '#4a4f6a';
				ctx.fillRect(sx(s.x + s.w / 2 - 0.08), sy(s.y), 0.16 * SCALE, CH);
				ctx.fillStyle = '#a7adc8';
				ctx.fillRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
			} else if (s.kind === 'crate') {
				ctx.fillStyle = '#6b5a45';
				ctx.fillRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
				ctx.strokeStyle = '#a88a62';
				ctx.lineWidth = 2;
				ctx.strokeRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
				ctx.beginPath();
				ctx.moveTo(sx(s.x), sy(s.y + s.h));
				ctx.lineTo(sx(s.x + s.w), sy(s.y));
				ctx.stroke();
			} else if (s.kind === 'slab') {
				ctx.fillStyle = '#56607d';
				ctx.fillRect(sx(s.x), sy(s.y + s.h), s.w * SCALE, s.h * SCALE);
				ctx.fillStyle = 'rgba(255, 210, 120, 0.5)';
				for (let yy = s.y + 0.4; yy < s.y + s.h; yy += 0.9) ctx.fillRect(sx(s.x), sy(yy), s.w * SCALE, 3);
			}
		}
		for (const z of wallRuns) {
			if (!visible(z.x, z.x + z.w)) continue;
			const active = P.wallRun && overlaps(P.x, P.y, W, H, z);
			ctx.fillStyle = active ? 'rgba(127, 227, 255, 0.22)' : 'rgba(127, 227, 255, 0.1)';
			ctx.fillRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.strokeStyle = 'rgba(127, 227, 255, 0.55)';
			ctx.lineWidth = 2;
			ctx.strokeRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.fillStyle = `rgba(127, 227, 255, ${active ? 0.7 : 0.35})`;
			ctx.font = `bold ${Math.round(SCALE * 0.9)}px ui-sans-serif, system-ui, sans-serif`;
			ctx.textAlign = 'center';
			for (let cx = z.x + 1.5; cx < z.x + z.w - 0.5; cx += 2.5) ctx.fillText('›', sx(cx), sy(z.y + z.h / 2 - 0.3));
			// Support legs down to the street.
			ctx.fillStyle = '#3c4560';
			ctx.fillRect(sx(z.x + 0.3), sy(z.y), 0.15 * SCALE, CH);
			ctx.fillRect(sx(z.x + z.w - 0.45), sy(z.y), 0.15 * SCALE, CH);
		}
		for (const z of hazards) {
			if (!visible(z.x, z.x + z.w)) continue;
			ctx.fillStyle = '#2b2a36';
			ctx.fillRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.shadowColor = '#ff4d4d';
			ctx.shadowBlur = 14;
			ctx.strokeStyle = '#ff6b5c';
			ctx.lineWidth = 2;
			ctx.strokeRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.strokeStyle = '#fff0a8';
			ctx.beginPath();
			for (let k = 0; k < 3; k++) {
				const t = Math.floor(now / 70) + k * 17;
				const bx = z.x + hash(t, k, 5) * z.w;
				ctx.moveTo(sx(bx), sy(z.y + z.h));
				ctx.lineTo(sx(bx + (hash(t, k, 6) - 0.5) * 0.6), sy(z.y + z.h + 0.25 + hash(t, k, 7) * 0.4));
				ctx.lineTo(sx(bx + (hash(t, k, 8) - 0.5) * 0.8), sy(z.y + z.h + 0.5 + hash(t, k, 9) * 0.4));
			}
			ctx.stroke();
			ctx.shadowBlur = 0;
		}
		for (const z of vents) {
			if (!visible(z.x, z.x + z.w)) continue;
			// Air vent: a cyan grate with air rising off it (the red ones are the dangerous kind).
			ctx.fillStyle = '#2a3a48';
			ctx.fillRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			ctx.strokeStyle = CYAN;
			ctx.lineWidth = 2;
			ctx.strokeRect(sx(z.x), sy(z.y + z.h), z.w * SCALE, z.h * SCALE);
			for (let k = 1; k < 4; k++) ctx.fillRect(sx(z.x + (k * z.w) / 4) - 1, sy(z.y + z.h), 2, z.h * SCALE);
			ctx.lineWidth = 1.5;
			for (let k = 0; k < 3; k++) {
				const rise = ((now / 600 + k / 3) % 1) * 2.4;
				ctx.globalAlpha = 0.55 * (1 - rise / 2.4);
				const bx = z.x + 0.2 + k * 0.4;
				ctx.beginPath();
				ctx.moveTo(sx(bx), sy(z.y + z.h + rise));
				ctx.quadraticCurveTo(sx(bx + 0.15), sy(z.y + z.h + rise + 0.3), sx(bx), sy(z.y + z.h + rise + 0.6));
				ctx.stroke();
			}
			ctx.globalAlpha = 1;
		}
		for (const d of drones) {
			if (!visible(d.x - 2, d.x + 2)) continue;
			const bx = d.x - DRONE.W / 2;
			// A gentle bob while hovering, for looks only (the sim keeps it still); it settles as you come close,
			// so the drone you land on or grab is where it's drawn.
			const near = Math.min(1, Math.abs(d.x - (P.x + W / 2)) / 4);
			const dy = d.y + (d.mode === 'hover' ? Math.sin(time * 2.2 + d.phase) * 0.18 * near : 0);
			// Arms and spinning rotors.
			ctx.strokeStyle = '#7d8aa8';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(sx(bx - 0.1), sy(dy + DRONE.H + 0.15));
			ctx.lineTo(sx(bx + DRONE.W + 0.1), sy(dy + DRONE.H + 0.15));
			ctx.stroke();
			const spin = Math.abs(Math.sin(now / 35));
			ctx.fillStyle = 'rgba(200, 220, 255, 0.45)';
			for (const rx of [bx - 0.1, bx + DRONE.W + 0.1]) {
				ctx.beginPath();
				ctx.ellipse(sx(rx), sy(dy + DRONE.H + 0.22), (0.15 + 0.4 * spin) * SCALE, 0.06 * SCALE, 0, 0, Math.PI * 2);
				ctx.fill();
			}
			// Body.
			ctx.fillStyle = '#2c3448';
			ctx.fillRect(sx(bx), sy(dy + DRONE.H), DRONE.W * SCALE, DRONE.H * SCALE);
			ctx.fillStyle = '#9fb0d0';
			ctx.fillRect(sx(bx), sy(dy + DRONE.H), DRONE.W * SCALE, 0.08 * SCALE);
			ctx.fillStyle = Math.floor(now / 400 + d.phase) % 2 ? '#ff5d5d' : '#5dff9a';
			ctx.fillRect(sx(bx + 0.12), sy(dy + 0.3), 0.14 * SCALE, 0.14 * SCALE);
			// The handlebar underneath, glowing when it's yours to grab.
			ctx.strokeStyle = d.mode === 'carry' ? '#d8f7ff' : CYAN;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(sx(d.x - 0.35), sy(dy));
			ctx.lineTo(sx(d.x - 0.35), sy(dy - 0.12));
			ctx.lineTo(sx(d.x + 0.35), sy(dy - 0.12));
			ctx.lineTo(sx(d.x + 0.35), sy(dy));
			ctx.stroke();
		}
		const target = mode === 'running' && !P.grounded && !P.grapple ? nearestGrapple() : null;
		for (const g of grapples) {
			if (!visible(g.x - 1, g.x + 1)) continue;
			const hot = g === target || g === P.grapple;
			ctx.strokeStyle = '#5c6684';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(sx(g.x), sy(g.y + 0.35));
			ctx.lineTo(sx(g.x), 0);
			ctx.stroke();
			ctx.shadowColor = CYAN;
			ctx.shadowBlur = hot ? 18 : 6;
			ctx.strokeStyle = hot ? '#d8f7ff' : CYAN;
			ctx.lineWidth = hot ? 4 : 3;
			ctx.beginPath();
			ctx.arc(sx(g.x), sy(g.y), 0.35 * SCALE, 0, Math.PI * 2);
			ctx.stroke();
			ctx.shadowBlur = 0;
			if (g === target) {
				ctx.setLineDash([4, 6]);
				ctx.strokeStyle = 'rgba(127, 227, 255, 0.5)';
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.moveTo(sx(P.x + W / 2), sy(P.y + H * 0.8));
				ctx.lineTo(sx(g.x), sy(g.y));
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}
	}

	/** Overlay text is scaled up when the canvas is shown small (phones), so it stays readable. */
	let uiScale = 1;
	function drawHints() {
		ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
		ctx.textAlign = 'center';
		for (const h of hints) {
			if (!showHint[h.key] || !visible(h.x - 6, h.x + 6)) continue;
			const tw = ctx.measureText(h.text).width + 18;
			ctx.save();
			ctx.translate(sx(h.x), sy(h.y));
			ctx.scale(uiScale, uiScale);
			ctx.fillStyle = 'rgba(8, 10, 28, 0.78)';
			ctx.fillRect(-tw / 2, -18, tw, 26);
			ctx.strokeStyle = 'rgba(255, 231, 163, 0.45)';
			ctx.lineWidth = 1;
			ctx.strokeRect(-tw / 2, -18, tw, 26);
			ctx.fillStyle = GOLD;
			ctx.fillText(h.text, 0, 0);
			ctx.restore();
		}
	}

	function drawRunner() {
		const fx = sx(P.x + W / 2);
		const fy = sy(P.y);
		const u = SCALE;
		ctx.save();
		ctx.translate(fx, fy);
		// Drawn facing right; mirrored when running left.
		ctx.scale(P.dir, 1);
		const wallSide = P.wall * P.dir;
		ctx.strokeStyle = '#f4f1ff';
		ctx.fillStyle = '#f4f1ff';
		ctx.lineWidth = 0.13 * u;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.shadowColor = 'rgba(180, 200, 255, 0.6)';
		ctx.shadowBlur = 8;
		const sliding = P.slope && P.vx > maxSpeedAt(time) + 0.5;
		const air = !P.grounded && !P.wallRun && !P.drone;
		const hanging = !!P.drone;
		const legSpeed = P.train ? Math.abs(P.vx - P.train.vx) : Math.abs(P.vx);
		// 0 = walking, 1 = running, blended between about 2 and 6 m/s of leg speed.
		const gait = Math.max(0, Math.min(1, (legSpeed - 2) / 4));
		const mix = (walk: number, run: number) => walk + (run - walk) * gait;
		const riding = !!P.train && P.grounded;
		// Boarding a train: land in a crouch with arms flung out, catch your balance, then settle with
		// arms at your sides. `settle` runs 0 → 1 over about 0.6 s after landing; `crouch` over 0.35 s.
		if (riding && !wasRiding) rideStart = time;
		wasRiding = riding;
		const rideT = riding ? time - rideStart : 0;
		const ease = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
		const settle = ease((rideT - 0.15) / 0.6);
		const crouch = ease(rideT / 0.35);
		const lean = sliding ? -0.35 : hanging || riding ? 0.04 : mix(0.04, Math.min(0.45, 0.12 + legSpeed * 0.018));
		const hipY = sliding ? -0.38 * u : riding ? (-0.62 - 0.18 * crouch) * u : -0.85 * u;
		const neck = { x: Math.sin(lean) * 0.5 * u, y: hipY - Math.cos(lean) * 0.5 * u };
		const ph = P.anim * 1.1;
		const limb = (ox: number, oy: number, a1: number, l1: number, a2: number, l2: number) => {
			const kx = ox + Math.sin(a1) * l1 * u;
			const ky = oy + Math.cos(a1) * l1 * u;
			ctx.beginPath();
			ctx.moveTo(ox, oy);
			ctx.lineTo(kx, ky);
			const hx = kx + Math.sin(a2) * l2 * u;
			const hy = ky + Math.cos(a2) * l2 * u;
			ctx.lineTo(hx, hy);
			ctx.stroke();
			return { x: hx, y: hy };
		};
		// Legs.
		if (riding) {
			// Feet apart; knees deeply bent on landing, straightening as you settle; a slight sway.
			const sway = Math.sin(time * 3) * 0.04 * settle;
			const knee = 0.55 * (1 - crouch);
			limb(0, hipY, 0.4 + knee * 0.6 + sway, 0.43, 0.1 - knee + sway, 0.43);
			limb(0, hipY, -0.3 + knee * 0.3 + sway, 0.43, -0.06 - knee + sway, 0.43);
		} else if (hanging) {
			const sway = Math.sin(time * 4) * 0.12;
			limb(0, hipY, 0.25 + sway, 0.43, 0.05 + sway, 0.43);
			limb(0, hipY, -0.1 + sway, 0.43, -0.25 + sway, 0.43);
		} else if (sliding) {
			// A baseball slide: legs nearly straight, stretched out ahead and down onto the slope.
			const s = P.slope!;
			const fall = Math.atan2(s.y0 - s.y1, s.x1 - s.x0);
			const leg = Math.PI / 2 - fall - 0.32;
			limb(0, hipY, leg, 0.45, leg + 0.05, 0.45);
			limb(0, hipY, leg - 0.18, 0.43, leg - 0.1, 0.43);
		} else if (wallSide) {
			limb(0, hipY, 0.6 * wallSide, 0.42, -0.1 * wallSide, 0.42);
			limb(0, hipY, 0.2 * wallSide, 0.42, 0.3 * wallSide, 0.42);
		} else if (air) {
			limb(0, hipY, 0.9, 0.42, -0.4, 0.42);
			limb(0, hipY, -0.3, 0.42, 0.5, 0.42);
		} else {
			// Walking: short strides on nearly straight legs. Running: long strides, knees lifting high.
			// Strides shorten further at a crawl (creeping along a train roof).
			const a = Math.sin(ph) * mix(0.42, 0.8) * Math.min(1, 0.45 + legSpeed / 3);
			const bend = mix(0.12, 0.7);
			const lift = mix(0.35, 0.6);
			limb(0, hipY, a, 0.43, a - bend - Math.max(0, Math.cos(ph)) * lift, 0.43);
			limb(0, hipY, -a, 0.43, -a - bend - Math.max(0, -Math.cos(ph)) * lift, 0.43);
		}
		// Body and head.
		ctx.beginPath();
		ctx.moveTo(0, hipY);
		ctx.lineTo(neck.x, neck.y);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(neck.x + Math.sin(lean) * 0.2 * u, neck.y - 0.22 * u, 0.17 * u, 0, Math.PI * 2);
		ctx.fill();
		// Arms.
		if (riding) {
			// Flung out wide on landing, wobbling as you catch your balance, then down at your sides.
			const wobble = Math.sin(rideT * 16) * 0.3 * (1 - settle);
			const out = 1.55 + (0.1 - 1.55) * settle;
			// Elbows bend naturally: out wide the forearms droop toward the ground; hanging, they bend a
			// little forward.
			limb(neck.x, neck.y, out + wobble, 0.33, out - 0.3 + 0.5 * settle + wobble * 1.5, 0.3);
			limb(neck.x, neck.y, -out + wobble, 0.33, -out + 0.3 - 0.1 * settle + wobble * 1.5, 0.3);
		} else if (hanging) {
			// Both hands up on the drone's handlebar.
			const barY = -(H + 0.02) * u;
			for (const hx of [-0.14, 0.14]) {
				ctx.beginPath();
				ctx.moveTo(neck.x, neck.y);
				ctx.lineTo(hx * u, barY);
				ctx.stroke();
			}
		} else if (P.grapple) {
			const gx = (sx(P.grapple.x) - fx) * P.dir;
			const gy = sy(P.grapple.y) - fy;
			ctx.save();
			ctx.shadowBlur = 0;
			ctx.strokeStyle = 'rgba(127, 227, 255, 0.85)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(neck.x, neck.y);
			ctx.lineTo(gx, gy);
			ctx.stroke();
			ctx.restore();
			const ang = Math.atan2(gx - neck.x, gy - neck.y);
			limb(neck.x, neck.y, ang, 0.35, ang, 0.35);
		} else if (P.wallRun) {
			// One hand pressed flat to the panel behind the shoulder, the other hanging at the side.
			const hand = limb(neck.x, neck.y, -2.1, 0.33, -1.75, 0.3);
			limb(neck.x, neck.y, 0.12, 0.33, 0.3, 0.3);
			ctx.save();
			ctx.shadowColor = CYAN;
			ctx.shadowBlur = 12;
			ctx.fillStyle = 'rgba(190, 240, 255, 0.95)';
			ctx.beginPath();
			ctx.arc(hand.x, hand.y, 0.09 * u, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		} else if (sliding) {
			// One arm back for balance, the other forward.
			limb(neck.x, neck.y, -1.0, 0.33, -0.7, 0.3);
			limb(neck.x, neck.y, 1.3, 0.33, 1.7, 0.3);
		} else if (air) {
			limb(neck.x, neck.y, -2.4, 0.33, -2.9, 0.3);
			limb(neck.x, neck.y, 2.2, 0.33, 2.8, 0.3);
		} else {
			// Walking: arms hang and swing gently. Running: elbows bent, pumping.
			const a = Math.sin(ph) * mix(0.4, 0.9) * Math.min(1, 0.45 + legSpeed / 3);
			const up = mix(0.05, 0.2);
			const elbow = mix(0.25, 1.4);
			limb(neck.x, neck.y, -a + up, 0.33, -a + up + elbow, 0.3);
			limb(neck.x, neck.y, a + up, 0.33, a + up + elbow, 0.3);
		}
		ctx.restore();
	}

	/** Draws `fn` scaled by uiScale around the point (ax, ay). */
	function scaled(ax: number, ay: number, fn: () => void) {
		ctx.save();
		ctx.translate(ax, ay);
		ctx.scale(uiScale, uiScale);
		ctx.translate(-ax, -ay);
		fn();
		ctx.restore();
	}

	/** Splits text into lines no wider than `max` (in the current font). */
	function wrap(text: string, max: number): string[] {
		const lines: string[] = [];
		let line = '';
		for (const word of text.split(' ')) {
			const next = line ? `${line} ${word}` : word;
			if (line && ctx.measureText(next).width > max) {
				lines.push(line);
				line = word;
			} else line = next;
		}
		if (line) lines.push(line);
		return lines;
	}

	function drawHud() {
		const done = isSolved(ID);
		scaled(0, 0, () => {
			ctx.font = '600 17px ui-monospace, Consolas, monospace';
			ctx.textAlign = 'left';
			ctx.fillStyle = 'rgba(8, 10, 28, 0.6)';
			ctx.fillRect(10, 10, 300, 52);
			ctx.fillStyle = '#eef0ff';
			ctx.fillText(`${fmtTime(time)}  ${Math.max(0, Math.floor(P.maxX - 4))} m  ${Math.abs(P.vx).toFixed(1)} m/s`, 20, 33);
			// Progress toward the one-minute mark.
			ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
			ctx.fillRect(20, 44, 280, 6);
			ctx.fillStyle = done ? GOLD : CYAN;
			ctx.fillRect(20, 44, 280 * Math.min(1, time / GOAL), 6);
		});
		// On a small screen the best time sits under the main readout instead of in the corner.
		const corner = uiScale < 1.4;
		scaled(corner ? CW : 0, 0, () => {
			ctx.font = '600 17px ui-monospace, Consolas, monospace';
			ctx.textAlign = corner ? 'right' : 'left';
			ctx.fillStyle = 'rgba(8, 10, 28, 0.6)';
			if (corner) ctx.fillRect(CW - 190, 10, 180, 30);
			else ctx.fillRect(10, 66, 180, 30);
			ctx.fillStyle = done ? GOLD : '#eef0ff';
			ctx.fillText(`${done ? '✦ ' : ''}Best ${fmtTime(best)}`, corner ? CW - 20 : 20, corner ? 31 : 87);
		});
		// Replaying a run: the time to beat.
		if (plan?.target) {
			const beat = time > plan.target.seconds;
			ctx.font = '600 13px ui-monospace, Consolas, monospace';
			ctx.textAlign = 'right';
			ctx.fillStyle = beat ? GOLD : 'rgba(238, 240, 255, 0.7)';
			ctx.fillText(`${beat ? '✦ Beat ' : 'vs '}${plan.target.name} ${fmtTime(plan.target.seconds)}`, CW - 12, CH - 12);
		}
		// The segment underfoot (useful when judging seeds).
		const seg = segments.find((s) => P.x >= s.x0 && P.x < s.x1);
		if (seg && seg.label) {
			ctx.font = '12px ui-monospace, Consolas, monospace';
			ctx.textAlign = 'left';
			ctx.fillStyle = 'rgba(238, 240, 255, 0.45)';
			ctx.fillText(`segment ${seg.label} · ${bandName(seg.tier)}`, 12, CH - 12);
		}
		if (goalFlash > 0) {
			scaled(CW / 2, 130, () => {
				ctx.globalAlpha = Math.min(1, goalFlash);
				ctx.font = '600 26px Georgia, serif';
				ctx.textAlign = 'center';
				ctx.fillStyle = GOLD;
				ctx.fillText('One minute. Keep running.', CW / 2, 130);
				ctx.globalAlpha = 1;
			});
		}
	}

	function drawOverlay() {
		if (mode === 'running') return;
		ctx.fillStyle = 'rgba(4, 6, 18, 0.55)';
		ctx.fillRect(0, 0, CW, CH);
		const title = mode === 'ready' ? 'Rooftops' : deathCause;
		const body =
			mode === 'ready'
				? [
						'You run on your own and speed up as you go. Jump to stay on the roofs.',
						plan
							? plan.target
								? `${plan.label}: beat ${fmtTime(plan.target.seconds)}.`
								: `${plan.label} come first, then random ones.`
							: '',
						isSolved(ID) ? 'Press Space or tap to run.' : 'Last one minute. Press Space or tap to run.',
					]
				: [
						`${fmtTime(time)} · ${Math.max(0, Math.floor(P.maxX - 4))} m`,
						plan?.target
							? time > plan.target.seconds
								? `You beat ${plan.target.name} (${fmtTime(plan.target.seconds)}).`
								: `${fmtTime(plan.target.seconds - time)} short of ${plan.target.name}.`
							: '',
						deadFor > 0.6 ? 'Press Space or tap to run again.' : '',
					];
		scaled(CW / 2, CH / 2, () => {
			ctx.textAlign = 'center';
			ctx.fillStyle = GOLD;
			ctx.font = 'italic 34px Georgia, serif';
			ctx.fillText(title, CW / 2, CH / 2 - 30);
			ctx.font = '17px ui-sans-serif, system-ui, sans-serif';
			ctx.fillStyle = '#eef0ff';
			const lines = body.flatMap((t) => (t ? wrap(t, (CW * 0.9) / uiScale) : []));
			lines.forEach((t, i) => ctx.fillText(t, CW / 2, CH / 2 + 8 + i * 26));
		});
	}

	function draw(now: number) {
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		uiScale = Math.min(2.4, Math.max(1, 640 / (canvas.clientWidth || CW)));
		drawSky();
		drawParallax();
		drawTrains();
		drawFacades();
		drawProps(now);
		drawHints();
		drawRunner();
		if (P.vx > 14 && mode === 'running') {
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
			ctx.lineWidth = 1;
			for (let i = 0; i < 8; i++) {
				const y = hash(i, Math.floor(now / 90)) * CH;
				const x = hash(i, Math.floor(now / 90), 3) * CW;
				ctx.beginPath();
				ctx.moveTo(x, y);
				ctx.lineTo(x - (P.vx - 12) * 12, y);
				ctx.stroke();
			}
		}
		drawHud();
		drawOverlay();
	}

	// ---- Input and loop ------------------------------------------------------------------------
	function press() {
		sync();
		if (mode === 'ready') {
			sim.start();
		} else if (mode === 'dead') {
			if (deadFor > 0.6) {
				reset();
				sim.start();
			}
			sync();
			return;
		}
		sim.press();
		sync();
	}
	function release() {
		sim.release();
	}
	const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
	const onKeyDown = (e: KeyboardEvent) => {
		if (picking) return;
		if (JUMP_KEYS.has(e.code)) {
			e.preventDefault();
			sound.wake();
			if (!e.repeat) press();
		} else if (e.code === 'KeyR') {
			reset();
		} else if (e.code === 'Digit1' || e.code === 'Numpad1') {
			rate(1);
		} else if (e.code === 'Digit2' || e.code === 'Numpad2') {
			rate(-1);
		} else if (e.code === 'KeyF') {
			replayLast();
		}
	};
	const onKeyUp = (e: KeyboardEvent) => {
		if (picking) return;
		if (JUMP_KEYS.has(e.code)) release();
	};
	document.addEventListener('keydown', onKeyDown);
	document.addEventListener('keyup', onKeyUp);
	canvas.addEventListener('pointerdown', (e) => {
		e.preventDefault();
		canvas.setPointerCapture(e.pointerId);
		sound.wake();
		press();
	});
	canvas.addEventListener('pointerup', release);
	canvas.addEventListener('pointercancel', release);

	let raf = 0;
	let last = performance.now();
	let acc = 0;
	const STEP = 1 / 120;
	function frame(now: number) {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		acc += dt;
		while (acc >= STEP) {
			sim.step(STEP);
			acc -= STEP;
		}
		sync();
		trackSegment();
		if (mode === 'dead') deadFor += dt;
		if (prompt) {
			promptLeft -= dt;
			if (promptLeft <= 0) hidePrompt();
		}
		const canReplay = mode === 'dead' && deadFor > 0.6 && !!lastRun && !picking;
		if (replayBtn.hidden === canReplay) replayBtn.hidden = !canReplay;
		goalFlash = Math.max(0, goalFlash - dt * 0.6);
		// Wind rises with speed, swells during a boost (over the speed cap) and while falling fast.
		if (mode === 'running') {
			const speed = Math.abs(P.vx);
			// Riding a train isn't a boost you feel as wind, and near one the wind ducks so its clunks and
			// rumble come through.
			const over = P.train ? 0 : Math.max(0, speed - maxSpeedAt(time));
			const wind = Math.max(0, (speed - 11) / 20) + Math.min(0.6, over / 6) + Math.max(0, (-P.vy - 12) / 40);
			sound.setWind(wind * (1 - 0.75 * sim.S.trainLevel));
			sound.setScrape(P.wallRun);
			sound.setRumble(sim.S.trainLevel);
		} else {
			sound.setWind(0);
			sound.setScrape(false);
			sound.setRumble(0);
		}
		updateCamera(dt);
		draw(now);
		raf = requestAnimationFrame(frame);
	}

	win.onClose(() => {
		cancelAnimationFrame(raf);
		sound.close();
		document.removeEventListener('keydown', onKeyDown);
		document.removeEventListener('keyup', onKeyUp);
		if (mode === 'running' && time > best) setData('now-best', time);
		setData('now-hints', seenHints);
	});

	setPlan(opts.plan ?? null);
	raf = requestAnimationFrame(frame);

	// Test hooks for the dev console: jump straight to a time band, or inspect the run.
	if (import.meta.env.DEV) {
		(window as unknown as { __runner: unknown }).__runner = {
			P,
			core: sim,
			get time() {
				return sim.S.time;
			},
			set time(t: number) {
				sim.S.time = t;
			},
			get mode() {
				return sim.S.mode;
			},
			get segments() {
				return sim.S.segments;
			},
			press,
			release,
			reset,
			/** Restart with these [seed or recipe, tier] segments right after the intro roof. */
			force(list: [number, number][]) {
				sim.S.forced = [...list];
				reset();
			},
			set frozen(v: boolean) {
				sim.S.frozen = v;
			},
			cam,
			/** Draw one frame now (the loop pauses while the tab is hidden). */
			render() {
				sync();
				for (let i = 0; i < 30; i++) updateCamera(1 / 30);
				draw(performance.now());
			},
			/** Step the simulation directly (works while the tab is hidden), calling `control` each step. */
			sim(seconds: number, control: (dt: number) => void) {
				for (let i = 0; i < seconds * 120; i++) {
					control(1 / 120);
					sim.step(1 / 120);
					sync();
					if (mode === 'dead') deadFor += 1 / 120;
				}
			},
		};
	}
}
