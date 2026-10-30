// Famous comets for the sky view, by their orbits: where each one is at any date
// comes from these elements (src/scripts/comets.ts), so the long-gone great
// comets reappear if you set the sky's clock back to their year, and Halley's
// Comet returns in 2061. Elements are J2000 ecliptic, from the orbit solutions of
// each apparition, rounded; they ignore the planets' pulls, so positions drift
// for dates far from perihelion. Brightness follows the usual comet formula,
// m = H + 5·log10(distance from Earth) + K·log10(distance from the Sun).

export interface Comet {
	id: string; // key for images (skyImages.ts) and search
	name: string;
	designation: string;
	q: number; // perihelion distance, AU
	e: number; // eccentricity
	i: number; // inclination, degrees
	node: number; // longitude of the ascending node, degrees
	peri: number; // argument of perihelion, degrees
	T: string; // time of perihelion (UTC)
	H: number; // absolute magnitude
	K: number; // how fast it brightens toward the Sun
	about: string; // shown in search
}

export const comets: Comet[] = [
	{
		id: 'halley',
		name: "Halley's Comet",
		designation: '1P/Halley',
		q: 0.5871,
		e: 0.96714,
		i: 162.26,
		node: 58.42,
		peri: 111.33,
		T: '1986-02-09T11:00Z',
		H: 5.5,
		K: 10,
		about: 'Returns every 75–76 years; next in 2061',
	},
	{
		id: 'hale-bopp',
		name: 'Comet Hale–Bopp',
		designation: 'C/1995 O1',
		q: 0.9141,
		e: 0.99509,
		i: 89.43,
		node: 282.47,
		peri: 130.59,
		T: '1997-04-01T03:00Z',
		H: -0.8,
		K: 8,
		about: 'The Great Comet of 1997, visible for 18 months',
	},
	{
		id: 'hyakutake',
		name: 'Comet Hyakutake',
		designation: 'C/1996 B2',
		q: 0.2302,
		e: 0.9999,
		i: 124.92,
		node: 188.05,
		peri: 130.17,
		T: '1996-05-01T10:00Z',
		H: 5.4,
		K: 10,
		about: 'The Great Comet of 1996, passed 0.1 AU from Earth',
	},
	{
		id: 'neowise',
		name: 'Comet NEOWISE',
		designation: 'C/2020 F3',
		q: 0.2947,
		e: 0.99918,
		i: 128.94,
		node: 61.01,
		peri: 37.28,
		T: '2020-07-03T16:00Z',
		H: 5.5,
		K: 10,
		about: 'The bright comet of July 2020',
	},
	{
		id: 'tsuchinshan-atlas',
		name: 'Comet Tsuchinshan–ATLAS',
		designation: 'C/2023 A3',
		q: 0.3914,
		e: 1,
		i: 139.11,
		node: 21.56,
		peri: 308.49,
		T: '2024-09-27T18:00Z',
		H: 4.7,
		K: 10,
		about: 'The bright comet of October 2024',
	},
	{
		id: 'pons-brooks',
		name: 'Comet Pons–Brooks',
		designation: '12P/Pons–Brooks',
		q: 0.7807,
		e: 0.9546,
		i: 74.19,
		node: 255.86,
		peri: 198.99,
		T: '2024-04-21T02:00Z',
		H: 5,
		K: 10,
		about: 'The "devil comet"; returns every 71 years',
	},
	{
		id: 'encke',
		name: "Encke's Comet",
		designation: '2P/Encke',
		q: 0.336,
		e: 0.8483,
		i: 11.78,
		node: 334.57,
		peri: 186.54,
		T: '2023-10-22T17:00Z',
		H: 12.5,
		K: 10,
		about: 'The shortest-period known comet: every 3.3 years',
	},
	{
		id: '67p',
		name: 'Comet Churyumov–Gerasimenko',
		designation: '67P',
		q: 1.2106,
		e: 0.6497,
		i: 3.87,
		node: 36.33,
		peri: 22.13,
		T: '2021-11-02T00:00Z',
		H: 10.5,
		K: 10,
		about: "Visited by ESA's Rosetta; returns every 6.4 years",
	},
];
