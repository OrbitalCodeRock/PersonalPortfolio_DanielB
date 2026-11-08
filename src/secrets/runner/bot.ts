// A playtest bot for the rooftop runner. It reads the sim's world directly (it's not a learned agent):
// it jumps at roof edges, walls and vents, plans each jump by simulating a few hold lengths and picking
// one that lands safely, wall-jumps on climbing walls, grabs hooks, and lets drones carry it.
//
// `skill` makes it human-ish: a random reaction delay before each press and sloppier hold lengths, so
// repeated runs give a survival rate rather than a plain pass/fail. Used by playtest.ts.
import { DRONE, PHYS } from './levelgen.ts';
import type { Sim } from './sim.ts';

export interface BotOptions {
	/** Random number source (0..1), so trials are repeatable. */
	rnd?: () => number;
	/** 1 = perfect timing; lower adds up to (1 - skill) * 0.15 s of reaction delay and hold jitter. */
	skill?: number;
}

const { W, H, G, JUMP_V, JUMP_CUT } = PHYS;
const HOLDS = [0.02, 0.06, 0.1, 0.16, 0.25, 1e9];

/** Returns a controller to call before each sim step. */
export function createBot(sim: Sim, opts: BotOptions = {}) {
	const rnd = opts.rnd ?? Math.random;
	const sloppiness = 1 - (opts.skill ?? 1);
	const S = sim.S;
	const P = S.P;
	let now = 0;
	let pressedAt = -1;
	let releaseAt = Infinity;
	/** A decided press waiting out the reaction delay. */
	let pending: { at: number; hold: number } | null = null;

	function groundAt(x: number, y: number): number {
		let best = -Infinity;
		for (const s of S.solids) {
			if (s.kind === 'ceiling' || s.x > x || s.x + s.w < x) continue;
			const t = s.y + s.h;
			if (t <= y + 0.5) best = Math.max(best, t);
		}
		for (const s of S.slopes) if (x >= s.x0 && x <= s.x1) best = Math.max(best, s.y0 + ((x - s.x0) / (s.x1 - s.x0)) * (s.y1 - s.y0));
		return best;
	}

	/** Simulates a jump held for `hold` seconds; where it lands, or null if it hits a wall/hazard/void. */
	function arcSafe(hold: number): { x: number } | null {
		let x = P.x;
		let y = P.y;
		let vy = JUMP_V;
		const vx = P.vx;
		let t = 0;
		const dt = 1 / 120;
		for (let i = 0; i < 300; i++) {
			t += dt;
			if (t > hold && vy > JUMP_CUT) vy = JUMP_CUT;
			vy -= G * dt;
			const ny = y + vy * dt;
			const nx = x + vx * dt;
			for (const h of [...S.hazards, ...S.signs]) if (nx < h.x + h.w && nx + W > h.x && ny < h.y + h.h && ny + H - 0.1 > h.y) return null;
			for (const s of S.solids) {
				if (!(nx < s.x + s.w && nx + W > s.x && ny < s.y + s.h && ny + H > s.y)) continue;
				const top = s.y + s.h;
				if (vy <= 0 && y >= top - 0.25) return { x: nx };
				if (vy > 0 && y + H <= s.y + 0.25) {
					vy = 0;
					continue;
				}
				if (top - ny <= 0.45 && vy <= 2) return { x: nx };
				return null;
			}
			for (const d of S.drones) {
				const bx = d.home.x - DRONE.W / 2;
				if (nx < bx + DRONE.W && nx + W > bx && ny < d.home.y + DRONE.H && ny + H > d.home.y) {
					if (vy <= 0 && y >= d.home.y + DRONE.H - 0.3) return { x: nx };
					return null;
				}
			}
			for (const s of S.slopes) {
				const c = nx + W / 2;
				if (c < s.x0 || c > s.x1) continue;
				const sy = s.y0 + ((c - s.x0) / (s.x1 - s.x0)) * (s.y1 - s.y0);
				if (vy <= 0 && ny <= sy && y >= sy - 0.3) return { x: nx };
			}
			x = nx;
			y = ny;
			if (y < P.y - 12) return null;
		}
		return null;
	}

	function plan(): number | null {
		for (const h of HOLDS) {
			const r = arcSafe(h);
			if (r && (r.x - P.x) * P.dir > 1.2) return h;
		}
		return null;
	}

	function tap(hold = 1e9) {
		if (now - pressedAt < 0.06 || pending) return;
		const delay = sloppiness * rnd() * 0.15;
		const jitter = hold < 1e8 ? hold * (1 + (rnd() - 0.5) * sloppiness) : hold;
		pending = { at: now + delay, hold: jitter };
	}

	return function control(dt: number) {
		now += dt;
		if (S.mode !== 'running') return;
		if (pending && now >= pending.at) {
			pressedAt = now;
			sim.release();
			sim.press();
			releaseAt = now + pending.hold;
			pending = null;
		}
		if (now > releaseAt) {
			sim.release();
			releaseAt = Infinity;
		}
		if (P.drone) {
			sim.release();
			releaseAt = Infinity;
			return;
		}
		const d = P.dir;
		const cx = P.x + W / 2;
		const v = Math.max(Math.abs(P.vx), 4);
		if (P.grounded && P.train) {
			// Riding a train: no roof ahead is normal. Jump a sign when it's about a third of a second
			// away (to be at the top of the jump as it passes), or onto the far building as it nears.
			const speed = Math.abs(P.vx);
			const sign = S.signs.some((z) => z.x > P.x + W && z.x - (P.x + W) < speed * 0.34);
			const farWall = S.solids.some(
				(s) => s.kind === 'roof' && s.x > P.x + W && s.x < P.x + W + speed * 0.25 && s.y + s.h > P.y + 0.45,
			);
			if (sign || farWall) tap();
			return;
		}
		if (P.grounded) {
			const ax = cx + d * (v * 0.09 + 0.35);
			const onSlope = S.slopes.some((s) => ax >= s.x0 && ax <= s.x1);
			const g = onSlope ? P.y : groundAt(ax, P.y);
			const wall = S.solids.find(
				(s) =>
					s.kind !== 'ceiling' &&
					s.y + s.h > P.y + 0.45 &&
					s.y < P.y + H &&
					(d > 0 ? s.x > P.x + 0.5 && s.x < P.x + W + v * 0.12 : s.x + s.w < P.x + 0.1 && s.x + s.w > P.x - v * 0.12 - 0.1),
			);
			const stopped =
				Math.abs(P.vx) < 1 &&
				S.solids.some(
					(s) =>
						s.climb &&
						s.y + s.h > P.y + 0.45 &&
						s.y < P.y + H &&
						(d > 0 ? Math.abs(s.x - P.x - W) < 0.05 : Math.abs(s.x + s.w - P.x) < 0.05),
				);
			const hazard = [...S.hazards, ...S.signs].some((h) =>
				d > 0 ? h.x > P.x + W && h.x < P.x + W + v * 0.2 : h.x + h.w < P.x && h.x + h.w > P.x - v * 0.2,
			);
			const ventAhead = S.vents.some((z) => (z.x - P.x) * d > -0.6 && Math.abs(z.x - P.x) < v * 0.6 && Math.abs(z.y - P.y) < 0.3);
			const ceilingAhead = S.solids.some((s) => s.kind === 'ceiling' && (s.x - P.x) * d > 0 && Math.abs(s.x - P.x) < v * 0.7 && s.y < P.y + 4);
			const inCorridor = S.solids.some((s) => s.kind === 'ceiling' && s.x <= P.x + W && s.x + s.w >= P.x);
			if (stopped) tap();
			else if (wall && (wall.climb || wall.kind === 'crate')) {
				// Run into it: then climb it, vault it, or get turned around.
			} else if (ventAhead && !hazard) {
				// Run over the vent.
			} else if (g < P.y - 0.6 || wall || hazard) {
				const hold = plan();
				const edge = groundAt(cx + d * (0.35 + v * 0.02), P.y) < P.y - 0.6;
				if (hold !== null) tap(hold);
				else if (edge || wall) tap(ceilingAhead || inCorridor ? 0.05 : 1e9);
			}
		} else if (P.wall && P.vy < 1 && groundAt(cx, P.y) < P.y - 1.2) {
			tap();
		} else if (!P.grapple && P.vy < 0 && S.grapples.some((g) => (g.x - cx) * d > -1 && Math.hypot(g.x - cx, g.y - P.y - 0.8) < 7)) {
			tap();
		}
	};
}

