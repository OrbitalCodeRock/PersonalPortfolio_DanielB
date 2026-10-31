// Where a comet (src/data/comets.ts) is at a moment: its orbit solved for the
// date, turned into RA/Dec as seen from Earth (ephemeris.ts), with its brightness
// and how long its tail is. Plain math, no drawing (see skyComets.ts).
import type { Comet } from '../data/comets';
import { fromEarth, type Vec3 } from './ephemeris';

const RAD = Math.PI / 180;
const GAUSS = 0.01720209895; // Gaussian gravitational constant: the Sun's pull, radians per day at 1 AU
const DAY_MS = 86400000;
// Fainter than this (magnitude), a comet isn't drawn: a small telescope at best.
export const COMET_LIMIT = 10;

/** Position relative to the Sun (ecliptic, AU) at `days` after perihelion. */
function heliocentric(c: Comet, days: number): Vec3 {
	let v: number; // true anomaly: angle from perihelion, radians
	let r: number; // distance from the Sun, AU
	if (c.e < 0.98) {
		// Ellipse: Kepler's equation, M = E - e·sin(E), by Newton's method.
		const a = c.q / (1 - c.e);
		let M = ((GAUSS / a ** 1.5) * days) % (2 * Math.PI);
		if (M > Math.PI) M -= 2 * Math.PI;
		if (M < -Math.PI) M += 2 * Math.PI;
		let E = c.e > 0.8 ? Math.sign(M) * Math.PI * 0.5 + M * 0.5 : M;
		for (let k = 0; k < 50; k++) {
			const step = (E - c.e * Math.sin(E) - M) / (1 - c.e * Math.cos(E));
			E -= step;
			if (Math.abs(step) < 1e-12) break;
		}
		const x = a * (Math.cos(E) - c.e);
		const y = a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
		v = Math.atan2(y, x);
		r = Math.hypot(x, y);
	} else {
		// Nearly parabolic (the great comets from the far Oort cloud): Barker's equation.
		const W = (3 * GAUSS * days) / Math.sqrt(2 * c.q ** 3);
		const Y = Math.cbrt(W / 2 + Math.sqrt((W * W) / 4 + 1));
		const s = Y - 1 / Y;
		v = 2 * Math.atan(s);
		r = c.q * (1 + s * s);
	}
	// Rotate from the orbit's plane into the ecliptic.
	const u = v + c.peri * RAD;
	const N = c.node * RAD;
	const i = c.i * RAD;
	return [
		r * (Math.cos(N) * Math.cos(u) - Math.sin(N) * Math.sin(u) * Math.cos(i)),
		r * (Math.sin(N) * Math.cos(u) + Math.cos(N) * Math.sin(u) * Math.cos(i)),
		r * Math.sin(u) * Math.sin(i),
	];
}

/** Orbital period in days, or null for comets that come by only once in recorded history. */
function periodDays(c: Comet): number | null {
	return c.e < 0.98 ? (2 * Math.PI) / (GAUSS / (c.q / (1 - c.e)) ** 1.5) : null;
}

export interface CometState {
	ra: number;
	dec: number;
	distance: number; // from Earth, AU
	sunDistance: number; // AU
	magnitude: number;
	tailLength: number; // AU, pointing straight away from the Sun
	tailEnd: { ra: number; dec: number };
}

// Absolute magnitude past which a comet's tail falls off with its light (see cometState).
const FAINT_COMET_H = 6.5;

export function cometState(c: Comet, date: Date): CometState {
	const perihelion = Date.parse(c.T);
	let days = (date.getTime() - perihelion) / DAY_MS;
	const period = periodDays(c);
	// Periodic comets: the nearest return (elements ignore the planets, so this is approximate).
	if (period) days -= Math.round(days / period) * period;
	const seen = fromEarth(heliocentric(c, days), date);
	const r = seen.sunDistance;
	const magnitude = c.H + 5 * Math.log10(seen.distance) + c.K * Math.log10(r);
	// Tails grow as the Sun heats the comet: tens of millions of km near the Sun,
	// none out past Jupiter. Brighter (bigger, more active) comets grow longer ones;
	// faint ones (absolute magnitude past about 6.5) shed dust in proportion to their
	// light, so their tails fall off with it: 67P's is a few hundred thousand km.
	const activity = c.H <= FAINT_COMET_H ? Math.min(1, (12 - c.H) / 10) : ((12 - FAINT_COMET_H) / 10) * 10 ** (-0.4 * (c.H - FAINT_COMET_H));
	const tailLength = r > 4 ? 0 : Math.min(0.6, 0.2 / r ** 1.5) * activity;
	return { ...seen, magnitude, tailLength, tailEnd: seen.outward(tailLength) };
}

export interface CometWindow {
	start: Date; // first day bright enough to see (brighter than COMET_LIMIT)
	end: Date;
	best: Date; // brightest day
	past: boolean; // true: no visit in the next few returns (or ever, for one-time visitors); this was the last
}

const windowCache = new Map<string, CometWindow | null>();

/**
 * The comet's next stretch of days bright enough to see (the current one, if it's
 * bright now), or its last one if it won't be back within a few returns.
 */
export function visibleWindow(c: Comet, from: Date): CometWindow | null {
	const cacheKey = `${c.id}|${Math.floor(from.getTime() / DAY_MS)}`;
	if (windowCache.has(cacheKey)) return windowCache.get(cacheKey)!;
	const period = periodDays(c);
	const next = perihelionNear(c, from).getTime();
	// The perihelia to look around: one-time visitors have just one; periodic comets
	// the last one and the next few (some returns are poorly placed and stay faint).
	const perihelia = period ? [-1, 0, 1, 2, 3].map((k) => next + k * period * DAY_MS) : [Date.parse(c.T)];
	let last: CometWindow | null = null;
	let found: CometWindow | null = null;
	for (const p of perihelia) {
		let run: CometWindow | null = null;
		let bestMagnitude = Infinity;
		for (let day = -450; day <= 450 && !found; day++) {
			const date = new Date(p + day * DAY_MS);
			const m = cometState(c, date).magnitude;
			if (m < COMET_LIMIT) {
				run ??= { start: date, end: date, best: date, past: false };
				run.end = date;
				if (m < bestMagnitude) {
					bestMagnitude = m;
					run.best = date;
				}
			} else if (run) {
				if (run.end.getTime() + DAY_MS > from.getTime()) found = run;
				else last = run;
				run = null;
				bestMagnitude = Infinity;
			}
		}
		if (run && !found) {
			if (run.end.getTime() + DAY_MS > from.getTime()) found = run;
			else last = run;
		}
		if (found) break;
	}
	const result = found ?? (last ? { ...last, past: true } : null);
	windowCache.set(cacheKey, result);
	return result;
}

/** When the comet is next (or was last, for one-time visitors) nearest the Sun. */
export function perihelionNear(c: Comet, date: Date): Date {
	const perihelion = Date.parse(c.T);
	const period = periodDays(c);
	if (!period) return new Date(perihelion);
	const periodMs = period * DAY_MS;
	return new Date(perihelion + Math.ceil((date.getTime() - perihelion) / periodMs) * periodMs);
}
