// The sky view's time zone: every time it shows or takes in (the time bar, search
// results, meteor shower dates) is in this zone. By default it's this device's
// zone; it can also follow the viewing location (preset places carry their zones;
// typed coordinates get one estimated from longitude), be UTC, or any zone picked
// from the list. The choice is remembered in this browser.
import { getObserver, type Observer } from './sky';

/** 'location' (the viewing location's zone), 'device' (this browser's), or an IANA zone name. */
export type ZoneSetting = 'location' | 'device' | string;

const STORAGE_KEY = 'sky-time-zone';
const listeners = new Set<() => void>();

function loadSetting(): ZoneSetting {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === 'location' || saved === 'device' || (saved && isZone(saved))) return saved;
	} catch {
		// Storage unavailable: use the default.
	}
	return 'device';
}

let setting: ZoneSetting = loadSetting();

function isZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

export function deviceZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * A location's time zone: its own if known, otherwise the whole-hour zone its
 * longitude falls in (15° per hour), which can be off near borders and for places
 * on half-hour offsets.
 */
export function locationZone(obs: Observer): { zone: string; estimated: boolean } {
	if (obs.timeZone) return { zone: obs.timeZone, estimated: false };
	const hours = Math.round(obs.lon / 15);
	// The Etc zones' signs are reversed: Etc/GMT-10 is ten hours ahead of UTC.
	return { zone: hours === 0 ? 'UTC' : `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`, estimated: true };
}

export function getZoneSetting(): ZoneSetting {
	return setting;
}

export function setZoneSetting(next: ZoneSetting) {
	setting = next;
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		// Not remembered past this visit.
	}
	for (const listener of listeners) listener();
}

/** Call back whenever the zone setting changes (returns an unsubscribe). */
export function onZoneChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The zone sky times are shown in right now. */
export function skyZone(): string {
	if (setting === 'location') return locationZone(getObserver()).zone;
	if (setting === 'device') return deviceZone();
	return setting;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${zone}|${JSON.stringify(options)}`;
	let f = formatters.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat(undefined, { ...options, timeZone: zone });
		formatters.set(key, f);
	}
	return f;
}

export interface ZonedParts {
	year: number;
	month: number; // 1–12
	day: number;
	hour: number; // 0–23
	minute: number;
}

/** A moment's calendar date and clock time in a zone. */
export function zonedParts(date: Date, zone = skyZone()): ZonedParts {
	const parts = Object.fromEntries(
		formatter(zone, {
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			hourCycle: 'h23',
		})
			.formatToParts(date)
			.map((p) => [p.type, p.value]),
	);
	return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** How far ahead of UTC a zone's clocks are at a moment (ms). */
function offsetAt(t: number, zone: string): number {
	const p = zonedParts(new Date(t), zone);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / 60000) * 60000;
}

/** The moment when a zone's clocks read this date and time (month 1–12; minutes may overflow). */
export function fromZoned(year: number, month: number, day: number, hour = 0, minute = 0, zone = skyZone()): Date {
	const wall = Date.UTC(year, month - 1, day, hour, minute);
	// Guess with the offset at the wall time, then correct once (offsets change at DST switches).
	let t = wall - offsetAt(wall, zone);
	const corrected = wall - offsetAt(t, zone);
	if (corrected !== t) t = corrected;
	return new Date(t);
}

/** "9:20 PM" */
export function formatClock(date: Date): string {
	return formatter(skyZone(), { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** "Aug 12" */
export function formatDay(date: Date): string {
	return formatter(skyZone(), { month: 'short', day: 'numeric' }).format(date);
}

/** "Mar 1997" */
export function formatMonthYear(date: Date): string {
	return formatter(skyZone(), { month: 'short', year: 'numeric' }).format(date);
}

/** "Oct 31, 1:40 AM", with the year when it isn't the same year as `now`. */
export function formatMoment(date: Date, now: Date): string {
	const sameYear = zonedParts(date).year === zonedParts(now).year;
	return formatter(skyZone(), {
		month: 'short',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' }),
		hour: 'numeric',
		minute: '2-digit',
	}).format(date);
}

/** A zone's short name at a moment, like "AEDT" or "GMT+10". */
export function zoneAbbreviation(date: Date, zone = skyZone()): string {
	const part = formatter(zone, { timeZoneName: 'short' })
		.formatToParts(date)
		.find((p) => p.type === 'timeZoneName');
	return part?.value ?? zone;
}

/** Every zone this browser knows, for the picker. */
export function allZones(): string[] {
	try {
		return Intl.supportedValuesOf('timeZone');
	} catch {
		return ['UTC', deviceZone()];
	}
}
