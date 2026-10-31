// Supernovae and gamma-ray bursts (src/data/transients.ts) at a moment: how bright,
// what color, and when each one can be seen. Used by the sky view (skyTransients.ts)
// and its search (skyFinder.ts).
import type { GammaRayBurst, Supernova, Transient } from '../data/transients';

const DAY_MS = 24 * 60 * 60 * 1000;
// Fainter than this (magnitude), a supernova is past what the naked eye can see.
export const TRANSIENT_NAKED_EYE = 6.5;
// Seconds before a gamma-ray burst that it counts as about to happen (for locking on to watch it).
export const GRB_LEAD_SECONDS = 60;

export interface TransientState {
	mag: number | null; // visible brightness; null = nothing to see
	gamma: number; // gamma-ray strength, 0-1 (shown in false color)
	color: [number, number, number];
	since: number; // supernovae: days from the peak; bursts: seconds from the trigger
}

const smooth = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

function supernovaMag(s: Supernova, days: number): number | null {
	const { riseDays, fast, fastDays, slow, early } = s.curve;
	if (days < -riseDays) return null;
	if (days < 0) {
		if (early) {
			// The first day: flaring up to early.mag, then brightening to the peak.
			const since = days + riseDays;
			if (since < 1) return early.mag + 3 * (1 - since);
			return early.mag + (s.peakMag - early.mag) * ((since - 1) / (riseDays - 1));
		}
		return s.peakMag + 5 * (days / riseDays) ** 2;
	}
	if (days < fastDays) return s.peakMag + fast * days;
	return s.peakMag + fast * fastDays + slow * (days - fastDays);
}

function gammaStrength(g: GammaRayBurst, seconds: number): number {
	let strength = 0;
	for (const [start, peak, end, value] of g.gamma) {
		if (seconds < start || seconds > end) continue;
		const v = seconds < peak ? (seconds - start) / Math.max(0.1, peak - start) : 1 - (seconds - peak) / Math.max(0.1, end - peak);
		strength = Math.max(strength, value * v);
	}
	return strength;
}

function burstMag(g: GammaRayBurst, seconds: number): number | null {
	const o = g.optical;
	if (!o || seconds < o.start) return null;
	let mag: number;
	if (seconds < o.rise) mag = o.startMag + (o.peakMag - o.startMag) * ((seconds - o.start) / (o.rise - o.start));
	else if (seconds < o.hold) mag = o.peakMag + 0.3 * ((seconds - o.rise) / (o.hold - o.rise));
	else mag = o.peakMag + 0.3 + o.decay * Math.log10(seconds / o.hold);
	return mag < 16 ? mag : null;
}

export function transientState(t: Transient, date: Date): TransientState {
	if (t.kind === 'supernova') {
		const days = (date.getTime() - t.peak) / DAY_MS;
		const mag = supernovaMag(t, days);
		const k = smooth(0, 120, days);
		const color = t.early.map((c, i) => c + (t.late[i] - c) * k) as [number, number, number];
		return { mag, gamma: 0, color, since: days };
	}
	const seconds = (date.getTime() - t.trigger) / 1000;
	return { mag: burstMag(t, seconds), gamma: gammaStrength(t, seconds), color: [0.85, 0.92, 1.0], since: seconds };
}

/** When it's worth looking: a supernova while it's bright enough to see, a burst from just before it to its end. */
export function transientWindow(t: Transient): { start: Date; end: Date } {
	if (t.kind === 'supernova') {
		const { riseDays, fast, fastDays, slow } = t.curve;
		const days = fastDays + (TRANSIENT_NAKED_EYE - t.peakMag - fast * fastDays) / slow;
		return { start: new Date(t.peak - riseDays * DAY_MS), end: new Date(t.peak + days * DAY_MS) };
	}
	const gammaEnd = Math.max(...t.gamma.map((p) => p[2]));
	// The visible flash until it's faded to magnitude 9.
	const o = t.optical;
	const flashEnd = o ? o.hold * 10 ** ((9 - o.peakMag - 0.3) / o.decay) : 0;
	return { start: new Date(t.trigger - GRB_LEAD_SECONDS * 1000), end: new Date(t.trigger + Math.max(gammaEnd, flashEnd) * 1000) };
}

/** Is there something to see now (bright enough, or its gamma rays arriving)? */
export function transientShowing(t: Transient, date: Date): boolean {
	const s = transientState(t, date);
	return s.gamma > 0.02 || (s.mag !== null && s.mag < (t.kind === 'supernova' ? TRANSIENT_NAKED_EYE : 12));
}

/**
 * A gamma-ray burst's countdown at a moment (seconds from its trigger): to its gamma
 * rays from GRB_LEAD_SECONDS before, and between pulses to the next (the BOAT's main
 * burst came minutes after its first flicker). Null while they're arriving (they
 * speak for themselves) and outside all that.
 */
export function burstCountdown(g: GammaRayBurst, seconds: number): string | null {
	if (seconds < -GRB_LEAD_SECONDS) return null;
	const strongest = Math.max(...g.gamma.map((p) => p[3]));
	for (const [i, [start, , end, strength]] of g.gamma.entries()) {
		if (seconds < start) {
			const label = i === 0 ? 'gamma rays arrive' : strength === strongest ? 'main burst' : 'next pulse';
			return `${label} in ${Math.ceil(start - seconds)} s`;
		}
		if (seconds <= end) return null;
	}
	return null;
}

/** "12 days after its peak", "40 seconds after the gamma rays arrived". */
export function transientAge(t: Transient, since: number): string {
	if (t.kind === 'supernova') {
		const days = Math.round(Math.abs(since));
		if (days < 1) return 'at its peak';
		return `${days} day${days === 1 ? '' : 's'} ${since < 0 ? 'before' : 'after'} its peak`;
	}
	const s = Math.round(Math.abs(since));
	if (since < 0) return `gamma rays arrive in ${s} s`;
	return s < 120 ? `${s} s after the gamma rays arrived` : `${Math.round(s / 60)} min after the gamma rays arrived`;
}
