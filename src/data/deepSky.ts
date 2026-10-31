// Galaxies, nebulae and star clusters for the sky view: a selection of the
// best-known deep-sky objects, spread around the sky so some are always up.
// Positions are J2000 right ascension (hours) and declination (degrees); size is
// the apparent major and minor axis in arcminutes; angle is the position angle of
// the major axis (degrees from north through east); mag is total visual magnitude.
// Values are rounded catalog figures, plenty for drawing.

export type DeepSkyKind =
	| 'spiral' // spiral galaxy (tilt comes from the minor/major ratio)
	| 'edge-on' // spiral seen edge-on, with a dust lane
	| 'elliptical' // elliptical galaxy
	| 'irregular' // irregular galaxy, like the Magellanic Clouds
	| 'emission' // glowing gas cloud where stars form
	| 'planetary' // shell blown off by a dying star
	| 'remnant' // supernova remnant
	| 'open-cluster' // loose group of young stars
	| 'globular'; // dense ball of old stars

export interface DeepSkyObject {
	name: string;
	catalog: string; // Messier / NGC designation
	kind: DeepSkyKind;
	ra: number;
	dec: number;
	size: [number, number]; // arcminutes
	angle: number;
	mag: number;
	distance: string; // shown on hover
	born?: number; // supernova remnants: when its supernova faded from naked-eye view (ms since 1970); not shown before
	ovalPhoto?: boolean; // its photo is cropped close, with light to the frame's edges: fade it out to an oval instead
}

export const deepSky: DeepSkyObject[] = [
	// Galaxies
	{ name: 'Andromeda Galaxy', catalog: 'M31', kind: 'spiral', ra: 0.712, dec: 41.27, size: [178, 63], angle: 35, mag: 3.4, distance: '2.5 million light-years' },
	{ name: 'Triangulum Galaxy', catalog: 'M33', kind: 'spiral', ra: 1.564, dec: 30.66, size: [73, 45], angle: 23, mag: 5.7, distance: '2.7 million light-years' },
	{ name: 'Whirlpool Galaxy', catalog: 'M51', kind: 'spiral', ra: 13.498, dec: 47.2, size: [11, 7], angle: 163, mag: 8.4, distance: '23 million light-years' },
	{ name: 'Pinwheel Galaxy', catalog: 'M101', kind: 'spiral', ra: 14.053, dec: 54.35, size: [29, 27], angle: 0, mag: 7.9, distance: '21 million light-years' },
	{ name: "Bode's Galaxy", catalog: 'M81', kind: 'spiral', ra: 9.926, dec: 69.07, size: [27, 14], angle: 157, mag: 6.9, distance: '12 million light-years' },
	{ name: 'Cigar Galaxy', catalog: 'M82', kind: 'edge-on', ra: 9.931, dec: 69.68, size: [11, 4.6], angle: 65, mag: 8.4, distance: '12 million light-years' },
	{ name: 'Sombrero Galaxy', catalog: 'M104', kind: 'edge-on', ra: 12.666, dec: -11.62, size: [9, 4], angle: 90, mag: 8.0, distance: '31 million light-years' },
	{ name: 'Sculptor Galaxy', catalog: 'NGC 253', kind: 'spiral', ra: 0.793, dec: -25.29, size: [27, 7], angle: 52, mag: 7.1, distance: '11 million light-years' },
	{ name: 'Virgo A', catalog: 'M87', kind: 'elliptical', ra: 12.514, dec: 12.39, size: [7, 7], angle: 0, mag: 8.6, distance: '53 million light-years' },
	{ name: 'Large Magellanic Cloud', catalog: 'LMC', kind: 'irregular', ra: 5.392, dec: -69.76, size: [645, 550], angle: 170, mag: 0.9, distance: '160,000 light-years' },
	{ name: 'Small Magellanic Cloud', catalog: 'SMC', kind: 'irregular', ra: 0.877, dec: -72.83, size: [320, 185], angle: 45, mag: 2.7, distance: '200,000 light-years' },
	// Nebulae
	{ name: 'Orion Nebula', catalog: 'M42', kind: 'emission', ra: 5.588, dec: -5.39, size: [85, 60], angle: 0, mag: 4.0, distance: '1,340 light-years' },
	{ name: 'Lagoon Nebula', catalog: 'M8', kind: 'emission', ra: 18.063, dec: -24.38, size: [90, 40], angle: 90, mag: 6.0, distance: '4,100 light-years' },
	{ name: 'Trifid Nebula', catalog: 'M20', kind: 'emission', ra: 18.045, dec: -23.03, size: [28, 28], angle: 0, mag: 6.3, distance: '4,100 light-years' },
	{ name: 'Eagle Nebula', catalog: 'M16', kind: 'emission', ra: 18.313, dec: -13.79, size: [35, 28], angle: 0, mag: 6.0, distance: '5,700 light-years' },
	{ name: 'Omega Nebula', catalog: 'M17', kind: 'emission', ra: 18.346, dec: -16.17, size: [11, 11], angle: 0, mag: 6.0, distance: '5,500 light-years' },
	{ name: 'Carina Nebula', catalog: 'NGC 3372', kind: 'emission', ra: 10.75, dec: -59.87, size: [120, 120], angle: 0, mag: 1.0, distance: '8,500 light-years' },
	{ name: 'North America Nebula', catalog: 'NGC 7000', kind: 'emission', ra: 20.98, dec: 44.33, size: [120, 100], angle: 0, mag: 4.0, distance: '2,600 light-years' },
	{ name: 'Ring Nebula', catalog: 'M57', kind: 'planetary', ra: 18.893, dec: 33.03, size: [1.4, 1.0], angle: 60, mag: 8.8, distance: '2,300 light-years' },
	{ name: 'Dumbbell Nebula', catalog: 'M27', kind: 'planetary', ra: 19.994, dec: 22.72, size: [8, 5.6], angle: 30, mag: 7.5, distance: '1,360 light-years' },
	{ name: 'Helix Nebula', catalog: 'NGC 7293', kind: 'planetary', ra: 22.494, dec: -20.84, size: [16, 16], angle: 0, mag: 7.6, distance: '650 light-years' },
	{ name: 'Crab Nebula', catalog: 'M1', kind: 'remnant', ra: 5.575, dec: 22.01, size: [7, 5], angle: 125, mag: 8.4, distance: '6,500 light-years', born: Date.UTC(1056, 6, 1) },
	// The remnants of the other supernovae in src/data/transients.ts.
	{ name: 'SN 1006 Remnant', catalog: 'SNR G327.6+14.6', kind: 'remnant', ra: 15.0467, dec: -41.94, size: [30, 30], angle: 0, mag: 12, distance: '7,200 light-years', born: Date.UTC(1008, 5, 1) },
	{ name: "Tycho's Supernova Remnant", catalog: '3C 10', kind: 'remnant', ra: 0.4214, dec: 64.1436, size: [8, 8], angle: 0, mag: 12, distance: '8,000 light-years', born: Date.UTC(1574, 4, 1) },
	{ name: "Kepler's Supernova Remnant", catalog: '3C 358', kind: 'remnant', ra: 17.5117, dec: -21.4833, size: [3.5, 3.5], angle: 0, mag: 12, distance: '20,000 light-years', born: Date.UTC(1605, 11, 1) },
	{ name: 'Pa 30', catalog: 'Pa 30', kind: 'remnant', ra: 0.8864, dec: 67.5006, size: [3, 3], angle: 0, mag: 13, distance: '7,500 light-years', born: Date.UTC(1182, 1, 1) },
	// Its ring of gas lit up by the blast is under 2 arcseconds across: it takes the telescope's deepest zoom.
	{ name: 'SN 1987A Remnant', catalog: 'SNR 1987A', kind: 'remnant', ra: 5.5911, dec: -69.2697, size: [0.028, 0.02], angle: 85, mag: 14, distance: '168,000 light-years', born: Date.UTC(1988, 4, 1), ovalPhoto: true },
	{ name: 'Veil Nebula', catalog: 'NGC 6960/6992', kind: 'remnant', ra: 20.85, dec: 30.7, size: [180, 180], angle: 0, mag: 7.0, distance: '2,400 light-years' },
	// Star clusters
	{ name: 'Pleiades', catalog: 'M45', kind: 'open-cluster', ra: 3.783, dec: 24.12, size: [110, 110], angle: 0, mag: 1.6, distance: '444 light-years' },
	{ name: 'Beehive Cluster', catalog: 'M44', kind: 'open-cluster', ra: 8.667, dec: 19.67, size: [95, 95], angle: 0, mag: 3.7, distance: '577 light-years' },
	{ name: 'Double Cluster', catalog: 'NGC 869/884', kind: 'open-cluster', ra: 2.333, dec: 57.13, size: [60, 30], angle: 90, mag: 3.7, distance: '7,500 light-years' },
	{ name: 'Hercules Cluster', catalog: 'M13', kind: 'globular', ra: 16.695, dec: 36.46, size: [20, 20], angle: 0, mag: 5.8, distance: '22,000 light-years' },
	{ name: 'Sagittarius Cluster', catalog: 'M22', kind: 'globular', ra: 18.607, dec: -23.9, size: [32, 32], angle: 0, mag: 5.1, distance: '10,600 light-years' },
	{ name: 'Omega Centauri', catalog: 'NGC 5139', kind: 'globular', ra: 13.447, dec: -47.48, size: [36, 36], angle: 0, mag: 3.9, distance: '17,000 light-years' },
	{ name: '47 Tucanae', catalog: 'NGC 104', kind: 'globular', ra: 0.401, dec: -72.08, size: [31, 31], angle: 0, mag: 4.1, distance: '15,000 light-years' },
];
