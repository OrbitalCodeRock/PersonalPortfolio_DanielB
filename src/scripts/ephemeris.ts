// Where the Sun, the Moon, the planets, a few dwarf planets and asteroids, and
// Jupiter's four big moons are, seen from Earth's center, at a given moment.
// - Sun, Moon and planets: Paul Schlyter's simplified orbital elements ("How to
//   compute planetary positions"), with the largest perturbations for the Moon,
//   Jupiter, Saturn and Uranus: good to a few arcminutes.
// - Pluto: JPL's approximate elements (Standish), good for 1800–2050.
// - Ceres, Vesta, Eris: two-body orbits, their positions along the orbit fitted to
//   known oppositions (and Eris's discovery position).
// - Io, Europa, Ganymede, Callisto: Meeus's low-accuracy theory (Astronomical
//   Algorithms ch. 44), placed around Jupiter.
// Also turns any heliocentric position (a comet's) into RA/Dec.
//
// Coordinates: ecliptic x/y/z (x toward the vernal equinox, z toward the
// ecliptic north pole) for the orbit math, then converted to equatorial RA/Dec
// for the J2000 equinox, the same frame as the star catalogs. (Schlyter's
// elements give the equinox of the date, so those positions are precessed back.)

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

const JUPITER_RADIUS_AU = 71492 / KM_PER_AU;

const sind = (x: number) => Math.sin(x * RAD);
const cosd = (x: number) => Math.cos(x * RAD);
const rev = (x: number) => x - Math.floor(x / 360) * 360; // wrap degrees into 0..360

interface Orbit {
	N: number; // longitude of the ascending node
	i: number; // inclination
	w: number; // argument of perihelion
	a: number; // semi-major axis (AU; Earth radii for the Moon)
	e: number; // eccentricity
	M: number; // mean anomaly
}

/** Orbital elements on day d (days since 1999 Dec 31, 0h UT). Angles in degrees. */
type SchlyterBody = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';
function orbits(d: number): Record<SchlyterBody, Orbit> {
	return {
		Sun: { N: 0, i: 0, w: 282.9404 + 4.70935e-5 * d, a: 1, e: 0.016709 - 1.151e-9 * d, M: 356.047 + 0.9856002585 * d },
		Moon: { N: 125.1228 - 0.0529538083 * d, i: 5.1454, w: 318.0634 + 0.1643573223 * d, a: 60.2666, e: 0.0549, M: 115.3654 + 13.0649929509 * d },
		Mercury: { N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5.0e-8 * d, w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: 168.6562 + 4.0923344368 * d },
		Venus: { N: 76.6799 + 2.4659e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.891 + 1.38374e-5 * d, a: 0.72333, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d },
		Mars: { N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d },
		Jupiter: { N: 100.4542 + 2.76854e-5 * d, i: 1.303 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: 19.895 + 0.0830853001 * d },
		Saturn: { N: 113.6634 + 2.3898e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: 316.967 + 0.0334442282 * d },
		Uranus: { N: 74.0005 + 1.3978e-5 * d, i: 0.7733 + 1.9e-8 * d, w: 96.6612 + 3.0565e-5 * d, a: 19.18171 - 1.55e-8 * d, e: 0.047318 + 7.45e-9 * d, M: 142.5905 + 0.011725806 * d },
		Neptune: { N: 131.7806 + 3.0173e-5 * d, i: 1.77 - 2.55e-7 * d, w: 272.8461 - 6.027e-6 * d, a: 30.05826 + 3.313e-8 * d, e: 0.008606 + 2.15e-9 * d, M: 260.2471 + 0.005995147 * d },
	};
}

/** Position in the orbit's own ecliptic frame: [x, y, z], plus true anomaly v and distance r. */
function orbitPosition(o: Orbit): { pos: Vec3; v: number; r: number } {
	const M = rev(o.M);
	// Kepler's equation, E - e·sin(E) = M, solved by Newton's method (degrees).
	let E = M + (180 / Math.PI) * o.e * sind(M) * (1 + o.e * cosd(M));
	for (let k = 0; k < 8; k++) E -= (E - (180 / Math.PI) * o.e * sind(E) - M) / (1 - o.e * cosd(E));
	const xv = o.a * (cosd(E) - o.e);
	const yv = o.a * Math.sqrt(1 - o.e * o.e) * sind(E);
	const v = Math.atan2(yv, xv) / RAD;
	const r = Math.hypot(xv, yv);
	const vw = v + o.w;
	return {
		pos: [
			r * (cosd(o.N) * cosd(vw) - sind(o.N) * sind(vw) * cosd(o.i)),
			r * (sind(o.N) * cosd(vw) + cosd(o.N) * sind(vw) * cosd(o.i)),
			r * sind(vw) * sind(o.i),
		],
		v,
		r,
	};
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
	return orbitPosition({ N: el.N, i: el.i, w: el.w, a: el.a, e: el.e, M }).pos;
}

/** Pluto from JPL's approximate elements (with their rates per century), heliocentric J2000 ecliptic. */
function plutoPosition(days: number): Vec3 {
	const T = days / 36525;
	const a = 39.48211675 - 0.00031596 * T;
	const e = 0.2488273 + 0.0000517 * T;
	const i = 17.14001206 + 0.00004818 * T;
	const L = 238.92903833 + 145.20780515 * T; // mean longitude
	const peri = 224.06891629 - 0.04062942 * T; // longitude of perihelion
	const N = 110.30393684 - 0.01183482 * T;
	return orbitPosition({ N, i, w: peri - N, a, e, M: L - peri }).pos;
}

// General precession in ecliptic longitude: how far the equinox of date has moved
// from J2000 (degrees per day); and the J2000 obliquity of the ecliptic.
const PRECESSION_PER_DAY = 1.3969713 / 36525;
const OBLIQUITY_J2000 = 23.4392911;

/** An ecliptic vector for the equinox of date (Schlyter) turned to the J2000 equinox. d: Schlyter day number. */
function toJ2000(v: Vec3, d: number): Vec3 {
	const angle = -PRECESSION_PER_DAY * (d - 1.5) * RAD; // J2000.0 is d = 1.5
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** Adjust an ecliptic position's longitude/latitude (degrees) and distance (same units). */
function perturb(pos: Vec3, dLon: number, dLat: number, dDist = 0): Vec3 {
	const r = Math.hypot(...pos) + dDist;
	const lon = Math.atan2(pos[1], pos[0]) / RAD + dLon;
	const lat = Math.atan2(pos[2], Math.hypot(pos[0], pos[1])) / RAD + dLat;
	return [r * cosd(lon) * cosd(lat), r * sind(lon) * cosd(lat), r * sind(lat)];
}

/** Ecliptic vector -> equatorial RA (hours) and Dec (degrees). */
function toRaDec(v: Vec3, obliquity: number): { ra: number; dec: number } {
	const x = v[0];
	const y = v[1] * cosd(obliquity) - v[2] * sind(obliquity);
	const z = v[1] * sind(obliquity) + v[2] * cosd(obliquity);
	return { ra: rev(Math.atan2(y, x) / RAD) / 15, dec: Math.atan2(z, Math.hypot(x, y)) / RAD };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(...a);
const angleBetween = (a: Vec3, b: Vec3) =>
	Math.acos(Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b))))) / RAD;

/** Days since 1999 Dec 31, 0h UT: the day number Schlyter's elements use. */
function dayNumber(date: Date): number {
	return date.getTime() / 86400000 + 2440587.5 - 2451543.5;
}

/** The Sun seen from Earth's center (J2000 ecliptic, AU) at day d. */
function sunGeocentric(d: number): Vec3 {
	// Its orbit elements describe Earth's orbit seen backwards.
	const o = orbits(d).Sun;
	const sun = orbitPosition(o);
	return toJ2000([sun.r * cosd(sun.v + o.w), sun.r * sind(sun.v + o.w), 0], d);
}

/**
 * A heliocentric ecliptic position (AU), such as a comet's, seen from Earth's
 * center: RA (hours), Dec (degrees), distance from Earth and from the Sun (AU),
 * and the direction from it straight away from the Sun (where a comet's tail points).
 */
export function fromEarth(helio: Vec3, date: Date) {
	const d = dayNumber(date);
	const obliquity = OBLIQUITY_J2000;
	const sunGeo = sunGeocentric(d);
	const geo: Vec3 = [helio[0] + sunGeo[0], helio[1] + sunGeo[1], helio[2] + sunGeo[2]];
	return {
		...toRaDec(geo, obliquity),
		distance: len(geo),
		sunDistance: len(helio),
		/** Where a point `ahead` AU further out from the Sun appears (for drawing tails). */
		outward: (ahead: number) => {
			const r = len(helio);
			const k = 1 + ahead / r;
			return toRaDec([helio[0] * k + sunGeo[0], helio[1] * k + sunGeo[1], helio[2] * k + sunGeo[2]], obliquity);
		},
	};
}

/** Where the Sun is (RA hours, Dec degrees): cheaper than solarSystem when that's all that's needed. */
export function sunRaDec(date: Date): { ra: number; dec: number } {
	return toRaDec(sunGeocentric(dayNumber(date)), OBLIQUITY_J2000);
}

/** Geocentric positions of the Sun, the Moon and the planets at a moment. */
export function solarSystem(date: Date): { sun: { ra: number; dec: number }; bodies: BodyEphemeris[] } {
	const d = dayNumber(date);
	const obliquity = OBLIQUITY_J2000;
	const o = orbits(d);
	const sunGeo = sunGeocentric(d); // J2000

	const bodies: BodyEphemeris[] = [];
	const add = (name: BodyName, geo: Vec3, magnitudeAt: (r: number, R: number, phase: number) => number, radius: number) => {
		const sunward = sub(sunGeo, geo);
		const phaseAngle = angleBetween(sunward, [-geo[0], -geo[1], -geo[2]]); // Sun-body-Earth angle
		const R = len(geo);
		bodies.push({
			name,
			...toRaDec(geo, obliquity),
			distance: R,
			earthRadii: R * EARTH_RADII_PER_AU,
			angularRadius: radius,
			magnitude: magnitudeAt(len(sunward), R, phaseAngle),
			litFraction: (1 + cosd(phaseAngle)) / 2,
			sunward: toRaDec(sunward, obliquity),
		});
	};

	// Moon: geocentric already (Earth radii), plus its largest perturbations.
	{
		const moon = orbitPosition(o.Moon);
		const Ms = rev(o.Sun.M);
		const Mm = rev(o.Moon.M);
		const Ls = Ms + o.Sun.w; // Sun's mean longitude
		const Lm = Mm + o.Moon.w + o.Moon.N; // Moon's mean longitude
		const D = Lm - Ls; // mean elongation
		const F = Lm - o.Moon.N; // argument of latitude
		const dLon =
			-1.274 * sind(Mm - 2 * D) + // evection
			0.658 * sind(2 * D) + // variation
			-0.186 * sind(Ms) + // yearly equation
			-0.059 * sind(2 * Mm - 2 * D) +
			-0.057 * sind(Mm - 2 * D + Ms) +
			0.053 * sind(Mm + 2 * D) +
			0.046 * sind(2 * D - Ms) +
			0.041 * sind(Mm - Ms) +
			-0.035 * sind(D) +
			-0.031 * sind(Mm + Ms) +
			-0.015 * sind(2 * F - 2 * D) +
			0.011 * sind(Mm - 4 * D);
		const dLat =
			-0.173 * sind(F - 2 * D) +
			-0.055 * sind(Mm - F - 2 * D) +
			-0.046 * sind(Mm + F - 2 * D) +
			0.033 * sind(F + 2 * D) +
			0.017 * sind(2 * Mm + F);
		const dDist = -0.58 * cosd(Mm - 2 * D) - 0.46 * cosd(2 * D);
		const earthRadii = toJ2000(perturb(moon.pos, dLon, dLat, dDist), d);
		const geo = earthRadii.map((c) => c / EARTH_RADII_PER_AU) as Vec3;
		const radius = 1737.4 / (len(earthRadii) * 6378.14); // Moon radius over distance, both km
		add('Moon', geo, (_r, _R, phase) => -12.7 + 0.026 * phase + 4e-9 * phase ** 4, radius);
	}

	// Planets: heliocentric orbit + the Sun's geocentric position = geocentric.
	const Mj = rev(o.Jupiter.M);
	const Msat = rev(o.Saturn.M);
	const Mu = rev(o.Uranus.M);
	const perturbations: Partial<Record<SchlyterBody, [number, number]>> = {
		Jupiter: [
			-0.332 * sind(2 * Mj - 5 * Msat - 67.6) -
				0.056 * sind(2 * Mj - 2 * Msat + 21) +
				0.042 * sind(3 * Mj - 5 * Msat + 21) -
				0.036 * sind(Mj - 2 * Msat) +
				0.022 * cosd(Mj - Msat) +
				0.023 * sind(2 * Mj - 3 * Msat + 52) -
				0.016 * sind(Mj - 5 * Msat - 69),
			0,
		],
		Saturn: [
			0.812 * sind(2 * Mj - 5 * Msat - 67.6) -
				0.229 * cosd(2 * Mj - 4 * Msat - 2) +
				0.119 * sind(Mj - 2 * Msat - 3) +
				0.046 * sind(2 * Mj - 6 * Msat - 69) +
				0.014 * sind(Mj - 3 * Msat + 32),
			-0.02 * cosd(2 * Mj - 4 * Msat - 2) + 0.018 * sind(2 * Mj - 6 * Msat - 49),
		],
		Uranus: [0.04 * sind(Msat - 2 * Mu + 6) + 0.035 * sind(Msat - 3 * Mu + 33) - 0.015 * sind(Mj - Mu + 20), 0],
	};
	// Magnitude formulas: H + 5·log10(r·R) + phase terms (r from the Sun, R from Earth, AU).
	const magnitudes: Record<keyof typeof DIAMETER_AT_1AU, (phase: number) => number> = {
		Mercury: (p) => -0.36 + 0.027 * p + 2.2e-13 * p ** 6,
		Venus: (p) => -4.34 + 0.013 * p + 4.2e-7 * p ** 3,
		Mars: (p) => -1.51 + 0.016 * p,
		Jupiter: (p) => -9.25 + 0.014 * p,
		Saturn: (p) => -9.0 + 0.044 * p,
		Uranus: (p) => -7.15 + 0.001 * p,
		Neptune: (p) => -6.9 + 0.001 * p,
	};
	for (const name of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'] as const) {
		let helio = orbitPosition(o[name]).pos;
		const p = perturbations[name];
		if (p) helio = perturb(helio, p[0], p[1]);
		helio = toJ2000(helio, d);
		const geo: Vec3 = [helio[0] + sunGeo[0], helio[1] + sunGeo[1], helio[2] + sunGeo[2]];
		const radius = (DIAMETER_AT_1AU[name] / 2 / len(geo)) * ARCSEC;
		add(name, geo, (r, R, phase) => magnitudes[name](phase) + 5 * Math.log10(r * R), radius);
	}

	// Dwarf planets and asteroids: J2000 orbits, brightness from H plus distance
	// and a simple phase darkening.
	const days = d - 1.5;
	const small: [BodyName, Vec3][] = [
		['Pluto', plutoPosition(days)],
		['Ceres', keplerPosition(SMALL_ORBITS.Ceres, days)],
		['Vesta', keplerPosition(SMALL_ORBITS.Vesta, days)],
		['Eris', keplerPosition(SMALL_ORBITS.Eris, days)],
	];
	for (const [name, helio] of small) {
		const geo: Vec3 = [helio[0] + sunGeo[0], helio[1] + sunGeo[1], helio[2] + sunGeo[2]];
		const radius = RADIUS_KM[name]! / (len(geo) * KM_PER_AU);
		add(name, geo, (r, R, phase) => ABSOLUTE_MAGNITUDE[name]! + 5 * Math.log10(r * R) + 0.03 * phase, radius);
	}

	// Jupiter's moons, around Jupiter.
	const jupiter = bodies.find((b) => b.name === 'Jupiter')!;
	for (const moon of galileanMoons(date, jupiter)) {
		add(moon.name, moon.geo, (r, R, phase) => ABSOLUTE_MAGNITUDE[moon.name]! + 5 * Math.log10(r * R) + 0.01 * phase, RADIUS_KM[moon.name]! / (len(moon.geo) * KM_PER_AU));
	}

	// The Sun itself, as a disk.
	add('Sun', sunGeo, () => -26.74, RADIUS_KM.Sun! / (len(sunGeo) * KM_PER_AU));
	return { sun: toRaDec(sunGeo, obliquity), bodies };
}

const equatorial = (ra: number, dec: number): Vec3 => [cosd(dec) * cosd(ra * 15), cosd(dec) * sind(ra * 15), sind(dec)];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => scale(a, 1 / len(a));

/** Equatorial (J2000) vector back to the ecliptic, for adding to positions in the orbit math. */
function toEcliptic(v: Vec3): Vec3 {
	return [v[0], v[1] * cosd(OBLIQUITY_J2000) + v[2] * sind(OBLIQUITY_J2000), -v[1] * sind(OBLIQUITY_J2000) + v[2] * cosd(OBLIQUITY_J2000)];
}

// Jupiter's north pole (J2000 RA, Dec degrees), to turn the moons' positions onto the sky.
const JUPITER_POLE = { ra: 268.057 / 15, dec: 64.495 };

/**
 * Io, Europa, Ganymede and Callisto (Meeus's low-accuracy method): each moon's
 * offset from Jupiter in Jupiter radii, X west and Y north along Jupiter's
 * equator as seen from Earth, and whether it's on the near or far side; then
 * turned into a geocentric ecliptic position (AU) beside Jupiter.
 */
function galileanMoons(date: Date, jupiter: BodyEphemeris): { name: (typeof GALILEAN_MOONS)[number]; geo: Vec3 }[] {
	const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
	const V = 172.74 + 0.00111588 * d;
	const M = 357.529 + 0.9856003 * d;
	const N = 20.02 + 0.0830853 * d + 0.329 * sind(V);
	const J = 66.115 + 0.9025179 * d - 0.329 * sind(V);
	const A = 1.915 * sind(M) + 0.02 * sind(2 * M);
	const B = 5.555 * sind(N) + 0.168 * sind(2 * N);
	const K = J + A - B;
	const R = 1.00014 - 0.01671 * cosd(M) - 0.00014 * cosd(2 * M);
	const r = 5.20872 - 0.25208 * cosd(N) - 0.00611 * cosd(2 * N);
	const delta = Math.sqrt(r * r + R * R - 2 * r * R * cosd(K));
	const psi = Math.asin((R / delta) * sind(K)) / RAD;
	const lambda = 34.35 + 0.083091 * d + 0.329 * sind(V) + B;
	const Ds = 3.12 * sind(lambda + 42.8);
	const De = Ds - 2.22 * sind(psi) * cosd(lambda + 22) - 1.3 * ((r - delta) / delta) * sind(lambda - 100.5);
	const t = d - delta / 173; // light time
	let u1 = 163.8069 + 203.4058646 * t + psi - B;
	let u2 = 358.414 + 101.2916335 * t + psi - B;
	let u3 = 5.7176 + 50.234518 * t + psi - B;
	let u4 = 224.8092 + 21.48798 * t + psi - B;
	const G = 331.18 + 50.310482 * t;
	const H = 87.45 + 21.569231 * t;
	u1 += 0.473 * sind(2 * (u1 - u2));
	u2 += 1.065 * sind(2 * (u2 - u3));
	u3 += 0.165 * sind(G);
	u4 += 0.843 * sind(H);
	const radii = [
		5.9057 - 0.0244 * cosd(2 * (u1 - u2)),
		9.3966 - 0.0882 * cosd(2 * (u2 - u3)),
		14.9883 - 0.0216 * cosd(G),
		26.3627 - 0.1939 * cosd(H),
	];
	// Jupiter's frame on the sky: toward Earth, north along its axis, and west.
	const toJupiter = equatorial(jupiter.ra, jupiter.dec);
	const pole = equatorial(JUPITER_POLE.ra, JUPITER_POLE.dec);
	const north = unit(scale(toJupiter, -(pole[0] * toJupiter[0] + pole[1] * toJupiter[1] + pole[2] * toJupiter[2])).map((c, i) => c + pole[i]) as Vec3);
	const east = unit(cross(north, toJupiter));
	return GALILEAN_MOONS.map((name, i) => {
		const u = [u1, u2, u3, u4][i];
		const X = radii[i] * sind(u); // Jupiter radii, west
		const Y = -radii[i] * cosd(u) * sind(De); // north
		const Z = radii[i] * cosd(u); // toward Earth (in front of Jupiter when positive)
		const offset = [0, 1, 2].map((k) => (-X * east[k] + Y * north[k] - Z * toJupiter[k]) * JUPITER_RADIUS_AU) as Vec3;
		const geoEquatorial: Vec3 = [0, 1, 2].map((k) => toJupiter[k] * jupiter.distance + offset[k]) as Vec3;
		return { name, geo: toEcliptic(geoEquatorial) };
	});
}

/** For telling Jupiter's moons from Jupiter: are they in the list? */
export function isGalileanMoon(name: BodyName): boolean {
	return (GALILEAN_MOONS as readonly string[]).includes(name);
}
