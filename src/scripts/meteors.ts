// When the meteor showers (src/data/meteorShowers.ts) are active, and how strong:
// plain date math, no drawing (see skyMeteors.ts).
import type { MeteorShower } from '../data/meteorShowers';
import { formatDay, fromZoned, zonedParts } from './skyTime';

const DAY_MS = 86400000;

export interface ShowerWindow {
	start: Date;
	peak: Date;
	end: Date;
}

/**
 * The shower's window around a peak in a given year (start and end may fall in the
 * year before or after), with days starting at midnight in the sky's time zone.
 */
function windowFor(s: MeteorShower, year: number): ShowerWindow {
	const at = ([m, d]: [number, number], y: number) => fromZoned(y, m, d);
	const peak = at(s.peak, year);
	let start = at(s.start, year);
	if (start > peak) start = at(s.start, year - 1);
	let end = new Date(at(s.end, year).getTime() + DAY_MS - 1); // through the end of its last day
	if (end < peak) end = new Date(at(s.end, year + 1).getTime() + DAY_MS - 1);
	return { start, peak, end };
}

export interface ShowerActivity {
	active: boolean;
	window: ShowerWindow; // the current one if active, otherwise the next
	daysFromPeak: number;
	rate: number; // meteors per hour under ideal conditions right now (0 when inactive)
}

export function showerActivity(s: MeteorShower, date: Date): ShowerActivity {
	const year = zonedParts(date).year;
	const windows = [year - 1, year, year + 1].map((y) => windowFor(s, y));
	const current = windows.find((w) => date >= w.start && date <= w.end);
	const window = current ?? windows.find((w) => w.start > date)!;
	const daysFromPeak = (date.getTime() - window.peak.getTime()) / DAY_MS;
	const rate = current ? s.zhr * Math.exp(-Math.abs(daysFromPeak) / s.width) : 0;
	return { active: !!current, window, daysFromPeak, rate: Math.max(rate, current ? 1 : 0) };
}

export const shortDate = formatDay;
