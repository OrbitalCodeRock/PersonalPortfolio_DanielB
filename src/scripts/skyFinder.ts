// Search for the sky view: everything the simulation draws (stars, constellations,
// galaxies, nebulae, clusters, the Moon and planets, comets, meteor showers,
// supernovae and gamma-ray bursts),
// where each one is for the current observer and simulated time, and when it
// rises or sets. Well-known
// objects the simulation leaves out are listed too, so a search for them says
// so instead of coming up empty. Nothing here downloads anything.
import { comets } from '../data/comets';
import { constellations, looseStars } from '../data/constellations';
import { deepSky } from '../data/deepSky';
import { meteorShowers } from '../data/meteorShowers';
import { transients } from '../data/transients';
import { COMET_LIMIT, cometState, visibleWindow } from './comets';
import { solarSystem, type BodyName } from './ephemeris';
import { showerActivity } from './meteors';
import { GRB_LEAD_SECONDS, transientAge, transientShowing, transientState, transientWindow } from './transients';
import { formatClock, formatDay, formatMoment, formatMonthYear, skyZone } from './skyTime';
import { altAz, type Observer } from './sky';

export interface FinderEntry {
	key: string; // matches the sky item's key in cosmos.ts ('' for objects not included)
	name: string;
	kind: string; // "Star in Orion", "Spiral galaxy", ...
	terms: string; // lowercase text searched: name, catalog numbers, other names
	included: boolean;
	/** Where it is at a moment (J2000 RA hours, Dec degrees); null for objects not included. */
	position: (date: Date) => { ra: number; dec: number } | null;
	group?: string; // constellation, for stars and constellations: shown only while all of it is up
	/**
	 * For things that come and go (comets, meteor showers): whether it's on show at a
	 * moment, as well as being up, and a note on why or why not.
	 */
	condition?: (date: Date) => { ok: boolean; note: string };
	/**
	 * For those: the stretch of time to look in for its next sighting (from, to),
	 * or its last one if it isn't coming back soon (past, with a note saying so).
	 */
	season?: (date: Date) => { from: Date; to: Date; past?: string } | null;
	/** For picking the best of past nights: lower is better (a comet's magnitude). */
	rank?: (date: Date) => number;
	/**
	 * For events over in moments (gamma-ray bursts): the moment to jump to, to watch
	 * it from the start at real time, wherever it is in the sky, and what it was.
	 */
	moment?: { at: Date; note: string };
	/** If it's never above the horizon from here when it can be seen: a moment to show it anyway, below the horizon. */
	fallback?: Date;
}

const KIND_NAMES: Record<string, string> = {
	spiral: 'Spiral galaxy',
	'edge-on': 'Spiral galaxy (edge-on)',
	elliptical: 'Elliptical galaxy',
	irregular: 'Irregular galaxy',
	emission: 'Emission nebula',
	planetary: 'Planetary nebula',
	remnant: 'Supernova remnant',
	'open-cluster': 'Open star cluster',
	globular: 'Globular star cluster',
};

// Other names people search for.
const ALIASES: Record<string, string> = {
	Polaris: 'north star pole star',
	'Ursa Major': 'big dipper great bear plough plow',
	'Ursa Minor': 'little dipper little bear',
	Pegasus: 'great square',
	Cygnus: 'northern cross swan',
	Orion: 'hunter',
	Mizar: 'alcor',
	M45: 'seven sisters subaru',
	LMC: 'magellanic',
	SMC: 'magellanic',
	Moon: 'luna',
	Sun: 'sol star',
	Ceres: 'asteroid',
	Vesta: 'asteroid 4',
	Io: 'galilean jupiter moon',
	Europa: 'galilean jupiter moon',
	Ganymede: 'galilean jupiter moon',
	Callisto: 'galilean jupiter moon',
	Sirius: 'dog star',
	Crux: 'southern cross',
	Sagittarius: 'teapot',
	Cassiopeia: 'w queen',
	'Alpha Centauri': 'rigil kentaurus toliman',
	Algol: 'demon star',
	halley: 'halley 1p',
	perseids: 'perseus august',
	geminids: 'gemini december',
	leonids: 'leo november',
	orionids: 'orion october',
	lyrids: 'lyra april',
	quadrantids: 'january',
	'eta-aquariids': 'aquarius may',
	'delta-aquariids': 'aquarius july',
	draconids: 'draco giacobinids',
	'southern-taurids': 'taurus halloween fireballs',
	'northern-taurids': 'taurus',
	ursids: 'ursa minor',
};

// Well-known objects the simulation doesn't include, so searching for them explains why nothing shows.
const NOT_INCLUDED: [string, string][] = [
	['Charon', "Pluto's moon"],
	['Titan', "Saturn's moon"],
	['Haumea', 'Dwarf planet'],
	['Makemake', 'Dwarf planet'],
	['International Space Station', 'Satellite'],
	['Hubble Space Telescope', 'Satellite'],
	['Comet Shoemaker–Levy 9', 'Comet (hit Jupiter in 1994)'],
	['Comet West', 'Comet (1976)'],
	['Comet McNaught', 'Comet (2007)'],
	['Comet ISON', 'Comet (broke up in 2013)'],
	["Barnard's Galaxy", 'Galaxy'],
	['Horsehead Nebula', 'Dark nebula'],
	['Pillars of Creation', 'Part of the Eagle Nebula (M16), which is included'],
	['Perseus', 'Constellation'],
	['Draco', 'Constellation'],
	['Centaurus', 'Constellation'],
	['Carina', 'Constellation'],
	['Ophiuchus', 'Constellation'],
	['Capricornus', 'Constellation'],
	['Aquarius', 'Constellation'],
	['Pisces', 'Constellation'],
	['Aries', 'Constellation'],
	['Cancer', 'Constellation'],
	['Libra', 'Constellation'],
];

const BODY_KINDS: Record<BodyName, string> = {
	Moon: "Earth's moon",
	Mercury: 'Planet',
	Venus: 'Planet',
	Mars: 'Planet',
	Jupiter: 'Planet',
	Saturn: 'Planet',
	Uranus: 'Planet',
	Neptune: 'Planet',
	Sun: 'Our star',
	Pluto: 'Dwarf planet',
	Ceres: 'Dwarf planet, the largest asteroid',
	Vesta: 'Asteroid',
	Eris: 'Dwarf planet',
	Io: 'Moon of Jupiter',
	Europa: 'Moon of Jupiter',
	Ganymede: 'Moon of Jupiter',
	Callisto: 'Moon of Jupiter',
};

/** The center of a group of stars on the sky (average of their directions). */
function centroid(stars: { ra: number; dec: number }[]): { ra: number; dec: number } {
	let x = 0;
	let y = 0;
	let z = 0;
	for (const s of stars) {
		const ra = (s.ra * 15 * Math.PI) / 180;
		const dec = (s.dec * Math.PI) / 180;
		x += Math.cos(dec) * Math.cos(ra);
		y += Math.cos(dec) * Math.sin(ra);
		z += Math.sin(dec);
	}
	const ra = (((Math.atan2(y, x) * 180) / Math.PI / 15) % 24 + 24) % 24;
	return { ra, dec: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI };
}

export const finderEntries: FinderEntry[] = [
	...(Object.keys(BODY_KINDS) as BodyName[]).map((name) => ({
		key: `body:${name}`,
		name,
		kind: BODY_KINDS[name],
		terms: `${name} ${ALIASES[name] ?? ''}`.toLowerCase(),
		included: true,
		position: (date: Date) => solarSystem(date).bodies.find((b) => b.name === name)!,
	})),
	...constellations.map((c) => ({
		key: `constellation:${c.name}`,
		name: c.name,
		kind: 'Constellation',
		terms: `${c.name} ${ALIASES[c.name] ?? ''} constellation`.toLowerCase(),
		included: true,
		position: () => centroid(c.stars),
		group: c.name,
	})),
	...constellations.flatMap((c) =>
		c.stars.map((s) => ({
			key: `star:${s.name}`,
			name: s.name,
			kind: `Star in ${c.name}`,
			terms: `${s.name} ${ALIASES[s.name] ?? ''}`.toLowerCase(),
			included: true,
			position: () => ({ ra: s.ra, dec: s.dec }),
			group: c.name,
		})),
	),
	...looseStars.map((s) => ({
		key: `star:${s.name}`,
		name: s.name,
		kind: `Star in ${s.constellation}`,
		terms: `${s.name} ${s.constellation} ${ALIASES[s.name] ?? ''}`.toLowerCase(),
		included: true,
		position: () => ({ ra: s.ra, dec: s.dec }),
	})),
	...comets.map((c) => ({
		key: `comet:${c.id}`,
		name: c.name,
		kind: `Comet · ${c.designation}`,
		terms: `${c.name} ${c.designation} comet ${ALIASES[c.id] ?? ''}`.toLowerCase(),
		included: true,
		position: (date: Date) => cometState(c, date),
		condition: (date: Date) => {
			const m = cometState(c, date).magnitude;
			return m < COMET_LIMIT
				? { ok: true, note: `magnitude ${m.toFixed(1)} · ${c.about}` }
				: { ok: false, note: `Too faint to see now (magnitude ${Math.round(m)})` };
		},
		season: (date: Date) => {
			const w = visibleWindow(c, date);
			if (!w) return null;
			if (!w.past) return { from: new Date(Math.max(date.getTime(), w.start.getTime())), to: w.end };
			// Not back soon: its last visit (visibility() picks its best night).
			const span = `${formatMonthYear(w.start)} – ${formatMonthYear(w.end)}`;
			const back = c.e < 0.98 ? 'not bright enough again for decades' : "won't return for thousands of years";
			return { from: w.start, to: w.end, past: `last seen ${span}; ${back}` };
		},
		rank: (date: Date) => cometState(c, date).magnitude,
	})),
	...meteorShowers.map((m) => ({
		key: `shower:${m.id}`,
		name: m.name,
		kind: 'Meteor shower',
		terms: `${m.name} meteor shower ${ALIASES[m.id] ?? ''}`.toLowerCase(),
		included: true,
		position: () => ({ ra: m.ra, dec: m.dec }),
		condition: (date: Date) => {
			const a = showerActivity(m, date);
			const w = a.window;
			return a.active
				? { ok: true, note: `active, peaks ${formatDay(w.peak)} · about ${Math.round(a.rate)} meteors an hour now` }
				: {
						ok: false,
						note: `Not active now · next ${formatDay(w.start)} – ${formatDay(w.end)}, peak ${formatDay(w.peak)} · up to ${m.zhr} an hour · from ${m.parent}`,
					};
		},
		// Not active yet: aim for the peak night, when there are the most meteors.
		season: (date: Date) => {
			const a = showerActivity(m, date);
			const peakEve = new Date(a.window.peak.getTime() - DAY_MS / 2);
			return { from: a.active || peakEve < date ? date : peakEve, to: a.window.end };
		},
	})),
	...transients.map((t): FinderEntry => {
		const w = transientWindow(t);
		const supernova = t.kind === 'supernova';
		const span = `${formatMonthYear(w.start)} – ${formatMonthYear(w.end)}`;
		return {
			key: `event:${t.id}`,
			name: t.name,
			kind: supernova ? `Supernova in ${t.constellation}` : `Gamma-ray burst · ${t.designation}`,
			terms: `${t.name} ${t.designation} ${t.designation.replace(/\s+/g, '')} ${supernova ? 'supernova' : 'gamma ray burst grb'} ${t.constellation} ${t.terms ?? ''}`.toLowerCase(),
			included: true,
			position: () => ({ ra: t.ra, dec: t.dec }),
			condition: (date: Date) => {
				const s = transientState(t, date);
				// A burst counts from a moment before it, to be watching when it goes off.
				const ok = transientShowing(t, date) || (!supernova && s.since > -GRB_LEAD_SECONDS && s.since < 0);
				if (ok) return { ok, note: `${s.mag !== null ? `magnitude ${s.mag.toFixed(1)} · ` : ''}${transientAge(t, s.since)} · ${t.about}` };
				if (supernova) return { ok, note: date > w.end ? 'Faded long ago' : 'Not yet exploded' };
				return { ok, note: `A flash that lasted moments, ${formatMoment(new Date(t.trigger), date)}` };
			},
			...(supernova
				? {
						season: (date: Date) =>
							date > w.end
								? { from: w.start, to: w.end, past: `seen ${span}` }
								: { from: new Date(Math.max(date.getTime(), w.start.getTime())), to: w.end },
						rank: (date: Date) => transientState(t, date).mag ?? Infinity,
						fallback: new Date(t.peak),
					}
				: { moment: { at: new Date(t.trigger - 15000), note: t.about } }),
		};
	}),
	...deepSky.map((o) => ({
		key: `deep:${o.catalog}`,
		name: o.name,
		kind: `${KIND_NAMES[o.kind]} · ${o.catalog}`,
		terms: `${o.name} ${o.catalog} ${o.catalog.replace(/\s+/g, '')} ${ALIASES[o.catalog] ?? ''}`.toLowerCase(),
		included: true,
		position: () => ({ ra: o.ra, dec: o.dec }),
		// A supernova remnant: shown once its supernova has faded.
		...(o.born !== undefined
			? {
					condition: (date: Date) =>
						date.getTime() >= o.born!
							? { ok: true, note: 'left by a supernova' }
							: { ok: false, note: `Not shown until its supernova fades, in ${new Date(o.born!).getUTCFullYear()}` },
					// Its next sighting: from when it appears.
					season: (date: Date) => {
						const from = Math.max(date.getTime(), o.born!);
						return { from: new Date(from), to: new Date(from + 400 * DAY_MS) };
					},
				}
			: {}),
	})),
	...NOT_INCLUDED.map(([name, kind]) => ({
		key: '',
		name,
		kind,
		terms: name.toLowerCase(),
		included: false,
		position: () => null,
	})),
];

/** Entries matching a search, best first: names starting with it, then words starting with it, then anywhere. */
export function searchSky(query: string, limit = 8): FinderEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const scored: { entry: FinderEntry; score: number }[] = [];
	for (const entry of finderEntries) {
		const name = entry.name.toLowerCase();
		let score = -1;
		if (name === q) score = 0;
		else if (name.startsWith(q)) score = 1;
		else if (entry.terms.split(/\s+/).some((word) => word.startsWith(q))) score = 2;
		else if (entry.terms.includes(q)) score = 3;
		if (score >= 0) scored.push({ entry, score: score + (entry.included ? 0 : 0.5) });
	}
	return scored.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name)).slice(0, limit).map((s) => s.entry);
}

export function findEntry(key: string): FinderEntry | undefined {
	return finderEntries.find((e) => e.key === key);
}

/** Altitude and azimuth (radians; azimuth from north through east) of an entry, or null if not included. */
export function entryAltAz(entry: FinderEntry, obs: Observer, date: Date): { alt: number; az: number } | null {
	const p = entry.position(date);
	return p ? altAz(p.ra, p.dec, obs, date) : null;
}

/**
 * Whether the simulation shows an entry right now, matching cosmos.ts: stars and
 * constellations once every star of the constellation is above the horizon,
 * everything else once its center is.
 */
function shownAt(entry: FinderEntry, obs: Observer, date: Date): boolean {
	if (entry.condition && !entry.condition(date).ok) return false;
	if (entry.group) {
		const c = constellations.find((k) => k.name === entry.group)!;
		return c.stars.every((s) => altAz(s.ra, s.dec, obs, date).alt > 0);
	}
	return (entryAltAz(entry, obs, date)?.alt ?? -1) > 0;
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** A compass point ("NE") for an azimuth in radians. */
export function compassPoint(az: number): string {
	const sector = Math.round(az / (Math.PI / 4));
	return COMPASS_POINTS[((sector % 8) + 8) % 8];
}

export interface Visibility {
	shown: boolean; // drawn in the sky view right now
	alt: number;
	az: number;
	text: string; // "Visible now · 34° up in the SE · sets around 3:10 AM"
	/** When not in view: a good moment to see it (up high), to jump the clock to. */
	goTo?: Date;
	goToPast?: boolean; // that moment is in the past (a comet that isn't coming back soon)
	realTime?: boolean; // watch it at real time from there (an event over in moments)
}

const STEP_MS = 10 * 60 * 1000; // rise and set times to the nearest ten minutes
const DAY_MS = 24 * 60 * 60 * 1000;
const SIGHTING_STEP_MS = 20 * 60 * 1000;

const sightingCache = new Map<string, Sighting | null>();

interface Sighting {
	first: Date;
	best: Date;
	bestAlt: number; // radians
}

/**
 * The first moment from `from` (until `to`) when the entry is on show, and the
 * best moment while it stays up (when it's highest). The sky view has no
 * atmosphere: the Sun doesn't light up the sky and nothing is lost in haze, so
 * anything above the horizon can be seen, day or night.
 */
function nextSighting(entry: FinderEntry, obs: Observer, from: Date, to: Date): Sighting | null {
	// The zone matters for meteor showers, whose dates start at local midnight.
	const cacheKey = `${entry.key}|${obs.lat},${obs.lon}|${skyZone()}|${Math.floor(from.getTime() / SIGHTING_STEP_MS)}|${Math.floor(to.getTime() / DAY_MS)}`;
	if (sightingCache.has(cacheKey)) return sightingCache.get(cacheKey)!;
	const visible = (t: number) => {
		const date = new Date(t);
		const place = entryAltAz(entry, obs, date);
		// Cheapest check first: above the horizon, then everything else.
		return !!place && place.alt > 0 && shownAt(entry, obs, date) ? place.alt : null;
	};
	let result: Sighting | null = null;
	for (let t = from.getTime(); t <= to.getTime(); t += SIGHTING_STEP_MS) {
		if (visible(t) === null) continue;
		// Found: now the highest point while it stays up.
		let best = t;
		let bestAlt = -Infinity;
		for (let u = t; u < t + 14 * 3600 * 1000; u += SIGHTING_STEP_MS) {
			const alt = visible(u);
			if (alt === null) break;
			if (alt > bestAlt) {
				bestAlt = alt;
				best = u;
			}
		}
		result = { first: new Date(t), best: new Date(best), bestAlt };
		break;
	}
	if (sightingCache.size > 500) sightingCache.clear();
	sightingCache.set(cacheKey, result);
	return result;
}

/**
 * Whether an included entry is in view now, where, and when that next changes:
 * setting within the day if it's up, or its next sighting (above the horizon, and
 * bright or active enough to see) if not.
 */
export function visibility(entry: FinderEntry, obs: Observer, date: Date): Visibility | null {
	const place = entryAltAz(entry, obs, date);
	if (!place) return null;
	const condition = entry.condition?.(date);
	const shown = shownAt(entry, obs, date);
	const up = place.alt > 0;
	const where = `${Math.round((Math.abs(place.alt) * 180) / Math.PI)}° ${up ? 'up' : 'below the horizon'} in the ${compassPoint(place.az)}`;
	const base = { shown, alt: place.alt, az: place.az };

	if (shown) {
		// When it sets: step forward through the next day.
		let change: number | null = null;
		for (let t = date.getTime() + STEP_MS; t <= date.getTime() + DAY_MS; t += STEP_MS) {
			if (!shownAt(entry, obs, new Date(t))) {
				change = t;
				break;
			}
		}
		const note = condition ? ` · ${condition.note}` : '';
		return { ...base, text: `Visible now · ${where} · ${change === null ? 'never sets from here' : `sets around ${formatClock(new Date(change))}`}${note}` };
	}

	// Not in view: why, and the next good chance to see it.
	let reason: string;
	if (condition && !condition.ok) reason = `${condition.note} · ${where}`;
	else if (up) {
		const group = entry.group && entry.kind !== 'Constellation' ? `all of ${entry.group}` : 'it';
		reason = `Not shown yet · ${where} · appears once ${group} is above the horizon`;
	} else reason = `Not visible now · ${where}`;
	// Over in moments: jump to just before it, wherever it is in the sky (unless it's happening now).
	if (entry.moment) {
		if (condition?.ok) return { ...base, text: `Happening now · ${where} · ${condition.note}` };
		const { at, note } = entry.moment;
		return { ...base, text: `${reason} · ${note}`, goTo: at, goToPast: at < date, realTime: true };
	}
	type Season = { from: Date; to: Date; past?: string };
	const first: Season | null = entry.season ? entry.season(date) : { from: date, to: new Date(date.getTime() + 400 * DAY_MS) };
	if (!first) return { ...base, text: `${reason} · not bright enough to see in the coming years` };
	let season: Season = first;
	const sightingIn = (s: Season) => nextSighting(entry, obs, s.from, s.to);
	let sighting = sightingIn(season);
	// A comet visit or shower that can't be seen from here (below the horizon the
	// whole time): try the next ones.
	for (let tries = 0; !sighting && entry.season && !season.past && tries < 3; tries++) {
		const next = entry.season(new Date(season.to.getTime() + DAY_MS));
		if (!next || next.past) break;
		season = next;
		sighting = sightingIn(season);
	}
	if (!sighting) {
		if (entry.fallback) {
			const when = season.past ?? `${formatMonthYear(season.from)} – ${formatMonthYear(season.to)}`;
			return { ...base, text: `${reason} · ${when} · below the horizon from here`, goTo: entry.fallback, goToPast: entry.fallback < date };
		}
		const never = up || entry.season ? "can't be seen from here then" : 'never rises from here';
		return { ...base, text: `${reason} · ${season.past ?? never}` };
	}
	if (season.past) {
		// A past visit: rather than its first day up, the day it was brightest.
		let best = sighting.best;
		if (entry.rank) {
			let bestRank = entry.rank(best);
			for (let t = sighting.first.getTime() + DAY_MS; t <= season.to.getTime(); t += 2 * DAY_MS) {
				const day = nextSighting(entry, obs, new Date(t - DAY_MS / 2), new Date(t + DAY_MS / 2));
				if (!day) continue;
				const rank = entry.rank(day.best);
				if (rank < bestRank) {
					bestRank = rank;
					best = day.best;
				}
			}
		}
		return { ...base, text: `${reason} · ${season.past}`, goTo: best, goToPast: true };
	}
	return { ...base, text: `${reason} · next visible ${formatMoment(sighting.first, date)}`, goTo: sighting.best };
}
