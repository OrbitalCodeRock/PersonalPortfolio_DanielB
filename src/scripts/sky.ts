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
import type { BodyName } from './ephemeris';

/** Someone standing somewhere on Earth. */
export interface Observer {
	lat: number; // latitude in degrees, north positive
	lon: number; // longitude in degrees, east positive (so the Americas are negative)
	place: string; // shown in the sky view's caption
	timeZone?: string; // IANA time zone, when known (skyTime.ts estimates one otherwise)
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

export const GLENVIEW: Observer = { lat: 42.0698, lon: -87.7878, place: 'Glenview, Illinois', timeZone: 'America/Chicago' };

// The current observer: Glenview until the visitor's location is known.
let observer: Observer = GLENVIEW;

export function getObserver(): Observer {
	return observer;
}

/** View the sky from somewhere else (a preset place or typed coordinates). */
export function setObserver(next: Observer) {
	observer = next;
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
				// The visitor is there, so this device's time zone is the place's.
				const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
				observer = { lat: pos.coords.latitude, lon: pos.coords.longitude, place: 'your location', timeZone };
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
 * Local sidereal time as an angle (radians): the right ascension crossing the
 * observer's north-south line right now. This is how far Earth has turned
 * under the stars; rotating the whole celestial sphere by it moves every star
 * at once (see cosmos.ts).
 */
export function siderealAngle(obs: Observer, date: Date): number {
	const daysSinceJ2000 = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
	const gmst = 280.46061837 + 360.98564736629 * daysSinceJ2000; // degrees, as in altAz
	return ((gmst + obs.lon) * Math.PI) / 180;
}

/** Unit vector on the celestial sphere: x toward RA 0h, y toward RA 6h, z toward the north celestial pole. */
export function equatorialVector(ra: number, dec: number): [number, number, number] {
	const a = (ra * 15 * Math.PI) / 180;
	const d = (dec * Math.PI) / 180;
	return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

// North pole directions of the Moon and planets (J2000 RA, Dec in degrees), from
// the IAU rotation models; they orient bands, rings and caps. The Moon's is near
// the ecliptic pole.
export const BODY_POLES: Record<BodyName, [number, number]> = {
	Moon: [270.0, 66.54],
	Mercury: [281.01, 61.42],
	Venus: [272.76, 67.16],
	Mars: [317.68, 52.89],
	Jupiter: [268.06, 64.5],
	Saturn: [40.59, 83.54],
	Uranus: [257.31, -15.18],
	Neptune: [299.36, 43.46],
	Sun: [286.13, 63.87],
	Pluto: [132.99, -6.16],
	Ceres: [291.42, 66.76],
	Vesta: [309.03, 42.23],
	Eris: [270.0, 66.56], // unknown: assume upright to the ecliptic
	// Jupiter's moons orbit in its equator, so share its pole.
	Io: [268.05, 64.5],
	Europa: [268.08, 64.51],
	Ganymede: [268.2, 64.57],
	Callisto: [268.72, 64.83],
};

// ---------------------------------------------------------------------------
// The sky view's clock: real time by default, or sped up, slowed, paused or run
// backward. Speeds are simulated seconds per real second.

const SPEEDS = [-604800, -86400, -21600, -3600, -600, -60, -1, 1, 60, 600, 3600, 21600, 86400, 604800];
const REAL_TIME = SPEEDS.indexOf(1);
let speedIndex = REAL_TIME;
let paused = false;
// The real clock, smooth and sub-millisecond (performance.now), held at one reading per
// animation frame (holdClock) so everything drawn in a frame is at the same moment and
// the sky moves by even steps: at a week per second, a millisecond is ten minutes.
let frameClock: number | null = null;
const realNow = () => frameClock ?? performance.now();
// The simulated time was clockSim when the real clock read clockReal.
let clockReal = realNow();
let clockSim = Date.now();

function simulatedMs(): number {
	return paused ? clockSim : clockSim + (realNow() - clockReal) * SPEEDS[speedIndex];
}

/** Restart the clock's reference point from the current simulated time (before changing speed). */
function rebase() {
	clockSim = simulatedMs();
	clockReal = realNow();
}

/** Called at the start of each animation frame with performance.now(): the sky's time for that frame. */
export function holdClock(now: number) {
	frameClock = now;
}

/** The sky view's current (simulated) moment. */
export function skyNow(): Date {
	return new Date(simulatedMs());
}

/** Step one notch faster forward (+1) or faster backward (-1); unpauses. */
export function changeSpeed(step: 1 | -1) {
	rebase();
	speedIndex = Math.min(SPEEDS.length - 1, Math.max(0, speedIndex + step));
	paused = false;
}

export function togglePause() {
	rebase();
	paused = !paused;
}

/** Jump to a moment (ms since 1970), keeping the current speed and pause state. */
export function setSkyTime(ms: number) {
	clockSim = ms;
	clockReal = realNow();
}

/** Run the clock forward at real time from where it is (to watch something brief). */
export function playRealTime() {
	rebase();
	speedIndex = REAL_TIME;
	paused = false;
}

/** Back to the present, at real-time speed. */
export function resetClock() {
	clockSim = Date.now();
	clockReal = realNow();
	speedIndex = REAL_TIME;
	paused = false;
}

/** What the time controls show: the speed in words, and whether we're at the live present. */
/** How fast simulated time runs: simulated seconds per real second (negative = backward, 0 = paused). */
export function clockRate(): number {
	return paused ? 0 : SPEEDS[speedIndex];
}

export function clockState(): { speed: string; backward: boolean; paused: boolean; live: boolean } {
	const speed = SPEEDS[speedIndex];
	const size = Math.abs(speed);
	const names: Record<number, string> = {
		1: 'Real time',
		60: '1 min/s',
		600: '10 min/s',
		3600: '1 hr/s',
		21600: '6 hr/s',
		86400: '1 day/s',
		604800: '1 week/s',
	};
	return {
		speed: names[size],
		backward: speed < 0,
		paused,
		live: !paused && speed === 1 && Math.abs(simulatedMs() - Date.now()) < 60000,
	};
}

/**
 * Place every catalog constellation in the observer's sky. Featured is the one
 * whose lowest star is highest above the horizon right now; visible is every
 * constellation whose stars are all above the horizon, so each one shown is
 * complete (a rising or setting one appears once it is fully up).
 */
export function chooseSky(obs: Observer = observer, date = skyNow()): SkyChoice {
	// placed: each constellation with its stars merged with their current alt/az.
	const placed: PlacedConstellation[] = constellations.map((constellation) => ({
		constellation,
		stars: constellation.stars.map((s) => ({ ...s, ...altAz(s.ra, s.dec, obs, date) })),
	}));
	// lowest: altitude of a constellation's lowest star. The featured one is the
	// constellation that is entirely well above the horizon, not just partly.
	const lowest = (c: PlacedConstellation) => Math.min(...c.stars.map((s) => s.alt));
	const featured = placed
		.filter((c) => c.constellation.feature !== false)
		.reduce((best, c) => (lowest(c) > lowest(best) ? c : best));
	const visible = placed.filter((c) => lowest(c) > 0);
	// The featured one is shown even in the rare case none is fully up.
	if (!visible.includes(featured)) visible.push(featured);
	return { featured, visible, place: obs.place };
}
