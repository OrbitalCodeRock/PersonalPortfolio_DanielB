// Where the Moon and the naked-eye planets are, seen from Earth's center, at a
// given moment. Uses Paul Schlyter's simplified orbital elements ("How to compute
// planetary positions"), including the largest perturbations for the Moon,
// Jupiter and Saturn: good to a few arcminutes, far finer than the sky view shows.
//
// Coordinates: ecliptic x/y/z (x toward the vernal equinox, z toward the
// ecliptic north pole) for the orbit math, then converted to equatorial RA/Dec.

export type BodyName = 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn';

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

type Vec3 = [number, number, number];

const RAD = Math.PI / 180;
const EARTH_RADII_PER_AU = 23454.8;
const ARCSEC = Math.PI / (180 * 3600);

// Apparent diameter at 1 AU (arcseconds), for sizing the planets' disks.
const DIAMETER_AT_1AU: Record<Exclude<BodyName, 'Moon'>, number> = {
	Mercury: 6.74,
	Venus: 16.92,
	Mars: 9.36,
	Jupiter: 196.94,
	Saturn: 165.6,
};

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
function orbits(d: number): Record<BodyName | 'Sun', Orbit> {
	return {
		Sun: { N: 0, i: 0, w: 282.9404 + 4.70935e-5 * d, a: 1, e: 0.016709 - 1.151e-9 * d, M: 356.047 + 0.9856002585 * d },
		Moon: { N: 125.1228 - 0.0529538083 * d, i: 5.1454, w: 318.0634 + 0.1643573223 * d, a: 60.2666, e: 0.0549, M: 115.3654 + 13.0649929509 * d },
		Mercury: { N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5.0e-8 * d, w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: 168.6562 + 4.0923344368 * d },
		Venus: { N: 76.6799 + 2.4659e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.891 + 1.38374e-5 * d, a: 0.72333, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d },
		Mars: { N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d },
		Jupiter: { N: 100.4542 + 2.76854e-5 * d, i: 1.303 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: 19.895 + 0.0830853001 * d },
		Saturn: { N: 113.6634 + 2.3898e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: 316.967 + 0.0334442282 * d },
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

/** Geocentric positions of the Sun, the Moon and the five naked-eye planets at a moment. */
export function solarSystem(date: Date): { sun: { ra: number; dec: number }; bodies: BodyEphemeris[] } {
	const d = date.getTime() / 86400000 + 2440587.5 - 2451543.5;
	const obliquity = 23.4393 - 3.563e-7 * d;
	const o = orbits(d);

	// The Sun, seen from Earth (its orbit elements describe Earth's orbit seen backwards).
	const sun = orbitPosition(o.Sun);
	const sunGeo: Vec3 = [sun.r * cosd(sun.v + o.Sun.w), sun.r * sind(sun.v + o.Sun.w), 0];

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
		const earthRadii = perturb(moon.pos, dLon, dLat, dDist);
		const geo = earthRadii.map((c) => c / EARTH_RADII_PER_AU) as Vec3;
		const radius = 1737.4 / (len(earthRadii) * 6378.14); // Moon radius over distance, both km
		add('Moon', geo, (_r, _R, phase) => -12.7 + 0.026 * phase + 4e-9 * phase ** 4, radius);
	}

	// Planets: heliocentric orbit + the Sun's geocentric position = geocentric.
	const Mj = rev(o.Jupiter.M);
	const Msat = rev(o.Saturn.M);
	const perturbations: Partial<Record<BodyName, [number, number]>> = {
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
	};
	// Magnitude formulas: H + 5·log10(r·R) + phase terms (r from the Sun, R from Earth, AU).
	const magnitudes: Record<Exclude<BodyName, 'Moon'>, (phase: number) => number> = {
		Mercury: (p) => -0.36 + 0.027 * p + 2.2e-13 * p ** 6,
		Venus: (p) => -4.34 + 0.013 * p + 4.2e-7 * p ** 3,
		Mars: (p) => -1.51 + 0.016 * p,
		Jupiter: (p) => -9.25 + 0.014 * p,
		Saturn: (p) => -9.0 + 0.044 * p,
	};
	for (const name of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'] as const) {
		let helio = orbitPosition(o[name]).pos;
		const p = perturbations[name];
		if (p) helio = perturb(helio, p[0], p[1]);
		const geo: Vec3 = [helio[0] + sunGeo[0], helio[1] + sunGeo[1], helio[2] + sunGeo[2]];
		const radius = (DIAMETER_AT_1AU[name] / 2 / len(geo)) * ARCSEC;
		add(name, geo, (r, R, phase) => magnitudes[name](phase) + 5 * Math.log10(r * R), radius);
	}
	return { sun: toRaDec(sunGeo, obliquity), bodies };
}
