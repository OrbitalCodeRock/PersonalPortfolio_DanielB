// Where real stars are in the visitor's sky: converts catalog positions to
// altitude/azimuth for an observer and time, and picks the constellation that
// is best placed right now. Accurate to well under a degree, which is plenty
// for drawing (precession since J2000 and refraction are ignored).
//
// Two coordinate systems are involved:
//   Catalog (fixed on the sky, from constellations.ts)
//     ra  - right ascension: east-west position on the sky, in hours (0-24; 1 hour = 15°)
//     dec - declination: north-south position on the sky, in degrees (+90 = above the North Pole)
//   Local (what an observer sees right now; changes as Earth turns)
//     alt - altitude: angle above the horizon (0 = horizon, 90° = straight overhead)
//     az  - azimuth: compass direction (0 = north, 90° = east, 180° = south, 270° = west)
import { constellations, type Constellation, type SkyStar } from '../data/constellations';

/** Someone standing somewhere on Earth. */
export interface Observer {
	lat: number; // latitude in degrees, north positive
	lon: number; // longitude in degrees, east positive (so the Americas are negative)
	place: string; // shown in the sky view's caption
}

/** A catalog star plus where it currently is in the observer's sky. */
export interface PlacedStar extends SkyStar {
	alt: number; // radians above the horizon
	az: number; // radians from north toward east
}

/** A constellation with every one of its stars placed in the observer's sky. */
export interface PlacedConstellation {
	constellation: Constellation;
	stars: PlacedStar[];
}

/** What the sky view shows: every constellation that is at least partly up. */
export interface SkyChoice {
	featured: PlacedConstellation; // the best placed one; the camera lands facing it
	visible: PlacedConstellation[]; // all entirely above the horizon (always includes featured)
	place: string; // the observer's place name
}

export const GLENVIEW: Observer = { lat: 42.0698, lon: -87.7878, place: 'Glenview, Illinois' };

// The current observer: Glenview until the visitor's location is known.
let observer: Observer = GLENVIEW;

export function getObserver(): Observer {
	return observer;
}

/** Use the visitor's location if the browser already allows it; never prompts. */
export async function useLocationIfAllowed(): Promise<boolean> {
	try {
		// status.state is 'granted', 'denied' or 'prompt' (not asked yet).
		const status = await navigator.permissions?.query({ name: 'geolocation' });
		if (status?.state !== 'granted') return false;
		return await locate();
	} catch {
		return false;
	}
}

/** Ask for the visitor's location (the browser prompts). Resolves true on success. */
export function requestLocation(): Promise<boolean> {
	return locate();
}

/** Ask the browser for a position fix and make it the observer. */
function locate(): Promise<boolean> {
	if (!navigator.geolocation) return Promise.resolve(false);
	return new Promise((resolve) => {
		navigator.geolocation.getCurrentPosition(
			// pos.coords holds latitude/longitude in degrees, the same convention as Observer.
			(pos) => {
				observer = { lat: pos.coords.latitude, lon: pos.coords.longitude, place: 'your location' };
				resolve(true);
			},
			() => resolve(false), // declined, timed out, or no fix: keep the current observer
			// timeout: give up after 10s. maximumAge: a fix up to an hour old is fine.
			{ timeout: 10000, maximumAge: 60 * 60 * 1000 },
		);
	});
}

/** Altitude and azimuth of a star (RA in hours, Dec in degrees) for an observer at a moment. */
export function altAz(ra: number, dec: number, obs: Observer, date: Date): { alt: number; az: number } {
	// rad: multiply degrees by this to get radians (Math.sin/cos work in radians).
	const rad = Math.PI / 180;

	// daysSinceJ2000: days (with fractions) since noon UTC on Jan 1, 2000, the
	// reference moment for the GMST formula. getTime() is milliseconds since
	// 1970; / 86400000 turns that into days; 2440587.5 is the Julian Day number
	// of Jan 1, 1970 and 2451545.0 that of J2000.
	const daysSinceJ2000 = date.getTime() / 86400000 + 2440587.5 - 2451545.0;

	// gmst: Greenwich Mean Sidereal Time in degrees, i.e. which right ascension is
	// due south at Greenwich right now. 280.46… is its value at J2000; 360.9856…
	// is how far Earth turns against the stars per day (a bit more than 360°,
	// since Earth also moves along its orbit). Not wrapped to 0-360: sin/cos don't mind.
	const gmst = 280.46061837 + 360.98564736629 * daysSinceJ2000;

	// hourAngle: how far the star has turned past the observer's north-south line
	// (gmst + lon is the local sidereal time; ra * 15 converts hours to degrees).
	// 0 = due south and highest, positive = past it and heading west.
	const hourAngle = (gmst + obs.lon - ra * 15) * rad;

	// lat and d: the observer's latitude and the star's declination, in radians.
	const lat = obs.lat * rad;
	const d = dec * rad;

	// Spherical trigonometry on the triangle zenith - celestial pole - star.
	// sinAlt: sine of the altitude (spherical law of cosines).
	const sinAlt = Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(hourAngle);
	const alt = Math.asin(sinAlt);
	// az: atan2(east-west component, north-south component). atan2 keeps the
	// quadrant right; the minus makes a westward hour angle give a westward azimuth.
	const az = Math.atan2(
		-Math.cos(d) * Math.sin(hourAngle),
		Math.sin(d) * Math.cos(lat) - Math.cos(d) * Math.cos(hourAngle) * Math.sin(lat),
	);
	// atan2 returns -π..π; wrap into 0..2π so it reads as a compass bearing.
	return { alt, az: (az + 2 * Math.PI) % (2 * Math.PI) };
}

/**
 * Place every catalog constellation in the observer's sky. Featured is the one
 * whose lowest star is highest above the horizon right now; visible is every
 * constellation whose stars are all above the horizon, so each one shown is
 * complete (a rising or setting one appears once it is fully up).
 */
export function chooseSky(obs: Observer = observer, date = new Date()): SkyChoice {
	// placed: each constellation with its stars merged with their current alt/az.
	const placed: PlacedConstellation[] = constellations.map((constellation) => ({
		constellation,
		stars: constellation.stars.map((s) => ({ ...s, ...altAz(s.ra, s.dec, obs, date) })),
	}));
	// lowest: altitude of a constellation's lowest star. The featured one is the
	// constellation that is entirely well above the horizon, not just partly.
	const lowest = (c: PlacedConstellation) => Math.min(...c.stars.map((s) => s.alt));
	const featured = placed.reduce((best, c) => (lowest(c) > lowest(best) ? c : best));
	const visible = placed.filter((c) => lowest(c) > 0);
	// The featured one is shown even in the rare case none is fully up.
	if (!visible.includes(featured)) visible.push(featured);
	return { featured, visible, place: obs.place };
}
