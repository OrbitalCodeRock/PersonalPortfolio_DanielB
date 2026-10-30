// The major annual meteor showers, from the International Meteor Organization's
// calendar (rounded). Each happens when Earth crosses the trail of dust left by a
// comet (or, for two, a rocky asteroid); the meteors all seem to fly out of one
// spot, the radiant. Dates are month and day; zhr is the zenithal hourly rate,
// how many meteors one observer would see per hour at the peak under a perfectly
// dark sky with the radiant overhead. width is roughly how many days the rate
// takes to fall to about a third of its peak. Radiants drift a little each day;
// these are their positions at the peak.

export interface MeteorShower {
	id: string;
	name: string;
	start: [number, number]; // month, day
	peak: [number, number];
	end: [number, number];
	ra: number; // radiant, hours
	dec: number; // radiant, degrees
	zhr: number;
	speed: number; // km/s as the meteors hit the atmosphere
	parent: string;
	width: number; // days
}

export const meteorShowers: MeteorShower[] = [
	{ id: 'quadrantids', name: 'Quadrantids', start: [12, 28], peak: [1, 3], end: [1, 12], ra: 15.33, dec: 49.5, zhr: 110, speed: 41, parent: 'asteroid 2003 EH1', width: 0.6 },
	{ id: 'lyrids', name: 'Lyrids', start: [4, 14], peak: [4, 22], end: [4, 30], ra: 18.07, dec: 33.3, zhr: 18, speed: 49, parent: 'Comet Thatcher', width: 1.5 },
	{ id: 'eta-aquariids', name: 'Eta Aquariids', start: [4, 19], peak: [5, 6], end: [5, 28], ra: 22.53, dec: -1, zhr: 50, speed: 66, parent: "Halley's Comet", width: 5 },
	{ id: 'delta-aquariids', name: 'Southern Delta Aquariids', start: [7, 12], peak: [7, 30], end: [8, 23], ra: 22.67, dec: -16.4, zhr: 25, speed: 41, parent: 'Comet Machholz', width: 6 },
	{ id: 'perseids', name: 'Perseids', start: [7, 17], peak: [8, 12], end: [8, 24], ra: 3.2, dec: 58, zhr: 100, speed: 59, parent: 'Comet Swift–Tuttle', width: 3 },
	{ id: 'draconids', name: 'Draconids', start: [10, 6], peak: [10, 8], end: [10, 10], ra: 17.47, dec: 54, zhr: 10, speed: 20, parent: 'Comet Giacobini–Zinner', width: 0.6 },
	{ id: 'southern-taurids', name: 'Southern Taurids', start: [9, 10], peak: [10, 10], end: [11, 20], ra: 2.13, dec: 8.7, zhr: 5, speed: 27, parent: "Encke's Comet", width: 15 },
	{ id: 'orionids', name: 'Orionids', start: [10, 2], peak: [10, 21], end: [11, 7], ra: 6.33, dec: 15.6, zhr: 20, speed: 66, parent: "Halley's Comet", width: 4 },
	{ id: 'northern-taurids', name: 'Northern Taurids', start: [10, 20], peak: [11, 12], end: [12, 10], ra: 3.87, dec: 22.4, zhr: 5, speed: 29, parent: "Encke's Comet", width: 12 },
	{ id: 'leonids', name: 'Leonids', start: [11, 6], peak: [11, 17], end: [11, 30], ra: 10.27, dec: 21.6, zhr: 15, speed: 71, parent: 'Comet Tempel–Tuttle', width: 1.5 },
	{ id: 'geminids', name: 'Geminids', start: [12, 4], peak: [12, 14], end: [12, 20], ra: 7.47, dec: 32.3, zhr: 150, speed: 35, parent: 'asteroid 3200 Phaethon', width: 1.5 },
	{ id: 'ursids', name: 'Ursids', start: [12, 17], peak: [12, 22], end: [12, 26], ra: 14.47, dec: 75.3, zhr: 10, speed: 33, parent: 'Comet Tuttle', width: 0.8 },
];
