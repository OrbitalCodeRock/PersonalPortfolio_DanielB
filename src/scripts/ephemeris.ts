// Where the Sun, the Moon, the planets, a few dwarf planets and asteroids, and
// Jupiter's four big moons are, seen from Earth's center, at a given moment.
// - Sun, Moon, planets, Pluto and Jupiter's moons: astronomy-engine (Don Cross,
//   MIT license): truncated VSOP87 for the planets, a full lunar theory, and
//   integrated orbits for Pluto, good to about an arcminute for thousands of years
//   either side of today. Its clock allows for Earth's slowing spin (Delta T: about
//   half an hour by the year 1000), which matters for the fast-moving Moon.
// - Ceres, Vesta, Eris: two-body orbits, their positions along the orbit fitted to
//   known oppositions (and Eris's discovery position).
// Also turns any heliocentric position (a comet's) into RA/Dec.
//
// Coordinates: ecliptic x/y/z (x toward the vernal equinox, z toward the
// ecliptic north pole) for the orbit math, then converted to equatorial RA/Dec
// for the J2000 equinox, the same frame as the star catalogs.
import * as Astronomy from 'astronomy-engine';

export type BodyName =
	| 'Sun'
	| 'Moon'
	| 'Mercury'
	| 'Venus'
	| 'Mars'
	| 'Jupiter'
	| 'Saturn'
	| 'Uranus'
	| 'Neptune'
	| 'Pluto'
	| 'Ceres'
	| 'Vesta'
	| 'Eris'
	| 'Io'
	| 'Europa'
	| 'Ganymede'
	| 'Callisto';

/** Jupiter's four big (Galilean) moons. */
export const GALILEAN_MOONS = ['Io', 'Europa', 'Ganymede', 'Callisto'] as const;

export interface BodyEphemeris {
	name: BodyName;
	ra: number; // right ascension, hours
	dec: number; // declination, degrees
	distance: number; // from Earth's center, AU
	earthRadii: number; // the same distance in Earth radii (used for the Moon's parallax)
	angularRadius: number; // apparent radius, radians
	magnitude: number; // apparent visual magnitude (smaller = brighter)
	litFraction: number; // 0 = new, 1 = full
	sunward: { ra: number; dec: number }; // direction from the body toward the Sun
}

export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
const EARTH_RADII_PER_AU = 23454.8;
const ARCSEC = Math.PI / (180 * 3600);

const KM_PER_AU = 149597870.7;

// Apparent diameter at 1 AU (arcseconds), for sizing the planets' disks.
const DIAMETER_AT_1AU: Record<'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune', number> = {
	Mercury: 6.74,
	Venus: 16.92,
	Mars: 9.36,
	Jupiter: 196.94,
	Saturn: 165.6,
	Uranus: 65.8,
	Neptune: 62.2,
};

// Radius (km) of the Sun and the smaller bodies.
const RADIUS_KM: Partial<Record<BodyName, number>> = {
	Sun: 695700,
	Pluto: 1188.3,
	Ceres: 469.7,
	Vesta: 262.7,
	Eris: 1163,
	Io: 1821.6,
	Europa: 1560.8,
	Ganymede: 2634.1,
	Callisto: 2410.3,
};

// Absolute magnitude H (brightness at 1 AU from both the Sun and Earth).
const ABSOLUTE_MAGNITUDE: Partial<Record<BodyName, number>> = {
	Pluto: -0.7,
	Ceres: 3.34,
	Vesta: 3.2,
	Eris: -1.2,
	Io: -1.68,
	Europa: -1.41,
	Ganymede: -2.09,
	Callisto: -1.05,
};

const sind = (x: number) => Math.sin(x * RAD);
const cosd = (x: number) => Math.cos(x * RAD);
const rev = (x: number) => x - Math.floor(x / 360) * 360; // wrap degrees into 0..360

interface Orbit {
	N: number; // longitude of the ascending node
	i: number; // inclination
	w: number; // argument of perihelion
	a: number; // semi-major axis (AU)
	e: number; // eccentricity
	M: number; // mean anomaly
}

/** Position in the orbit's own ecliptic frame: [x, y, z]. Angles in degrees. */
function orbitPosition(o: Orbit): Vec3 {
	const M = rev(o.M);
	// Kepler's equation, E - e·sin(E) = M, solved by Newton's method (degrees).
	let E = M + (180 / Math.PI) * o.e * sind(M) * (1 + o.e * cosd(M));
	for (let k = 0; k < 8; k++) E -= (E - (180 / Math.PI) * o.e * sind(E) - M) / (1 - o.e * cosd(E));
	const xv = o.a * (cosd(E) - o.e);
	const yv = o.a * Math.sqrt(1 - o.e * o.e) * sind(E);
	const v = Math.atan2(yv, xv) / RAD;
	const r = Math.hypot(xv, yv);
	const vw = v + o.w;
	return [
		r * (cosd(o.N) * cosd(vw) - sind(o.N) * sind(vw) * cosd(o.i)),
		r * (sind(o.N) * cosd(vw) + cosd(o.N) * sind(vw) * cosd(o.i)),
		r * sind(vw) * sind(o.i),
	];
}

interface Elements {
	a: number; // AU
	e: number;
	i: number; // degrees
	N: number; // ascending node, degrees
	w: number; // argument of perihelion, degrees
	M0: number; // mean anomaly at J2000.0 (2000 Jan 1.5), degrees
}

// Two-body orbits (J2000 ecliptic) for the asteroids and Eris; M0 fitted to known oppositions.
const SMALL_ORBITS: Record<'Ceres' | 'Vesta' | 'Eris', Elements> = {
	Ceres: { a: 2.7675, e: 0.0785, i: 10.588, N: 80.27, w: 73.73, M0: 7.26 },
	Vesta: { a: 2.3615, e: 0.0887, i: 7.142, N: 103.71, w: 151.66, M0: 338.89 },
	Eris: { a: 67.864, e: 0.437, i: 44.04, N: 35.95, w: 151.64, M0: 191.12 },
};

/** Heliocentric J2000 ecliptic position (AU) from orbital elements, `days` after J2000.0. */
function keplerPosition(el: Elements, days: number): Vec3 {
	const M = rev(el.M0 + (0.9856076686 / el.a ** 1.5) * days); // degrees per day from Kepler's third law
	return orbitPosition({ N: el.N, i: el.i, w: el.w, a: el.a, e: el.e, M });
}

const OBLIQUITY_J2000 = 23.4392911;
const LIGHT_DAYS_PER_AU = 499.004784 / 86400;

/** Ecliptic vector -> equatorial RA (hours) and Dec (degrees), J2000. */
function toRaDec(v: Vec3): { ra: number; dec: number } {
	const x = v[0];
	const y = v[1] * cosd(OBLIQUITY_J2000) - v[2] * sind(OBLIQUITY_J2000);
	const z = v[1] * sind(OBLIQUITY_J2000) + v[2] * cosd(OBLIQUITY_J2000);
	return { ra: rev(Math.atan2(y, x) / RAD) / 15, dec: Math.atan2(z, Math.hypot(x, y)) / RAD };
}

/** An astronomy-engine vector (equatorial J2000, AU) -> the J2000 ecliptic used here. */
function ecliptic(v: { x: number; y: number; z: number }): Vec3 {
	return [v.x, v.y * cosd(OBLIQUITY_J2000) + v.z * sind(OBLIQUITY_J2000), -v.y * sind(OBLIQUITY_J2000) + v.z * cosd(OBLIQUITY_J2000)];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a: Vec3) => Math.hypot(...a);
const angleBetween = (a: Vec3, b: Vec3) =>
	Math.acos(Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b))))) / RAD;

/** The Sun seen from Earth's center (J2000 ecliptic, AU). */
function sunGeocentric(time: Astronomy.AstroTime): Vec3 {
	return ecliptic(Astronomy.GeoVector(Astronomy.Body.Sun, time, false));
}

/**
 * A heliocentric ecliptic position (AU), such as a comet's, seen from Earth's
 * center: RA (hours), Dec (degrees), distance from Earth and from the Sun (AU),
 * and the direction from it straight away from the Sun (where a comet's tail points).
 */
export function fromEarth(helio: Vec3, date: Date) {
	const sunGeo = sunGeocentric(Astronomy.MakeTime(date));
	const geo = add(helio, sunGeo);
	return {
		...toRaDec(geo),
		distance: len(geo),
		sunDistance: len(helio),
		/** Where a point `ahead` AU further out from the Sun appears (for drawing tails). */
		outward: (ahead: number) => {
			const k = 1 + ahead / len(helio);
			return toRaDec([helio[0] * k + sunGeo[0], helio[1] * k + sunGeo[1], helio[2] * k + sunGeo[2]]);
		},
	};
}

/** Where the Sun is (RA hours, Dec degrees): cheaper than solarSystem when that's all that's needed. */
export function sunRaDec(date: Date): { ra: number; dec: number } {
	return toRaDec(sunGeocentric(Astronomy.MakeTime(date)));
}

// Magnitude formulas: H + 5·log10(r·R) + phase terms (r from the Sun, R from Earth, AU).
const PLANET_MAGNITUDE: Record<keyof typeof DIAMETER_AT_1AU, (phase: number) => number> = {
	Mercury: (p) => -0.36 + 0.027 * p + 2.2e-13 * p ** 6,
	Venus: (p) => -4.34 + 0.013 * p + 4.2e-7 * p ** 3,
	Mars: (p) => -1.51 + 0.016 * p,
	Jupiter: (p) => -9.25 + 0.014 * p,
	Saturn: (p) => -9.0 + 0.044 * p,
	Uranus: (p) => -7.15 + 0.001 * p,
	Neptune: (p) => -6.9 + 0.001 * p,
};

/**
 * Geocentric positions of the Sun, the Moon and the planets at a moment. only:
 * just these bodies (cheaper, for searching through time); all of them by default.
 */
export function solarSystem(date: Date, only?: readonly BodyName[]): { sun: { ra: number; dec: number }; bodies: BodyEphemeris[] } {
	const time = Astronomy.MakeTime(date);
	const sunGeo = sunGeocentric(time);
	const wanted = (name: BodyName) => !only || only.includes(name);

	const bodies: BodyEphemeris[] = [];
	const place = (name: BodyName, geo: Vec3, magnitudeAt: (r: number, R: number, phase: number) => number, radiusKm: number) => {
		const sunward = sub(sunGeo, geo);
		const phaseAngle = angleBetween(sunward, [-geo[0], -geo[1], -geo[2]]); // Sun-body-Earth angle
		const R = len(geo);
		bodies.push({
			name,
			...toRaDec(geo),
			distance: R,
			earthRadii: R * EARTH_RADII_PER_AU,
			angularRadius: radiusKm / (R * KM_PER_AU),
			magnitude: magnitudeAt(len(sunward), R, phaseAngle),
			litFraction: (1 + cosd(phaseAngle)) / 2,
			sunward: toRaDec(sunward),
		});
	};

	// The Moon, from astronomy-engine's lunar theory.
	if (wanted('Moon')) place('Moon', ecliptic(Astronomy.GeoMoon(time)), (_r, _R, phase) => -12.7 + 0.026 * phase + 4e-9 * phase ** 4, 1737.4);

	// Planets, seen where they were when their light left (corrected for light time).
	for (const name of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'] as const) {
		if (!wanted(name)) continue;
		const geo = ecliptic(Astronomy.GeoVector(Astronomy.Body[name], time, false));
		const radiusKm = (DIAMETER_AT_1AU[name] / 2) * ARCSEC * KM_PER_AU;
		place(name, geo, (r, R, phase) => PLANET_MAGNITUDE[name](phase) + 5 * Math.log10(r * R), radiusKm);
	}

	// Dwarf planets and asteroids: brightness from H plus distance and a simple phase darkening.
	const small: [BodyName, () => Vec3][] = [
		['Pluto', () => ecliptic(Astronomy.GeoVector(Astronomy.Body.Pluto, time, false))],
		['Ceres', () => add(keplerPosition(SMALL_ORBITS.Ceres, time.tt), sunGeo)],
		['Vesta', () => add(keplerPosition(SMALL_ORBITS.Vesta, time.tt), sunGeo)],
		['Eris', () => add(keplerPosition(SMALL_ORBITS.Eris, time.tt), sunGeo)],
	];
	for (const [name, geo] of small) {
		if (!wanted(name)) continue;
		place(name, geo(), (r, R, phase) => ABSOLUTE_MAGNITUDE[name]! + 5 * Math.log10(r * R) + 0.03 * phase, RADIUS_KM[name]!);
	}

	// Jupiter's moons around Jupiter, where they were when Jupiter's light left.
	if (GALILEAN_MOONS.some(wanted)) {
		const jupiter = ecliptic(Astronomy.GeoVector(Astronomy.Body.Jupiter, time, false));
		const moons = Astronomy.JupiterMoons(time.AddDays(-len(jupiter) * LIGHT_DAYS_PER_AU));
		const states = { Io: moons.io, Europa: moons.europa, Ganymede: moons.ganymede, Callisto: moons.callisto };
		for (const name of GALILEAN_MOONS) {
			if (!wanted(name)) continue;
			place(name, add(jupiter, ecliptic(states[name])), (r, R, phase) => ABSOLUTE_MAGNITUDE[name]! + 5 * Math.log10(r * R) + 0.01 * phase, RADIUS_KM[name]!);
		}
	}

	// The Sun itself, as a disk.
	if (wanted('Sun')) place('Sun', sunGeo, () => -26.74, RADIUS_KM.Sun!);
	return { sun: toRaDec(sunGeo), bodies };
}

/** For telling Jupiter's moons from Jupiter: are they in the list? */
export function isGalileanMoon(name: BodyName): boolean {
	return (GALILEAN_MOONS as readonly string[]).includes(name);
}
