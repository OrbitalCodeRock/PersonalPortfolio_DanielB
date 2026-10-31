// Brief, brilliant events to witness in the sky view: the supernovae bright enough
// to have been seen with the naked eye in recorded history, and gamma-ray bursts.
// Positions (J2000) are the supernova remnants' and the bursts' afterglows'. Dates
// before 1582 were recorded in the Julian calendar; they're given here in the
// (proleptic) Gregorian calendar the sky view's clock runs on, with the recorded
// date in the description.

/** A supernova's light curve: magnitudes relative to its peak, by days from it. */
export interface SupernovaCurve {
	riseDays: number; // from nothing to its peak
	fast: number; // magnitudes a day it fades over the first fastDays after its peak
	fastDays: number;
	slow: number; // magnitudes a day it fades after that
	// SN 1987A: seen at about magnitude 4.5 from the day after it exploded, 86 days
	// before its peak, then slowly brightening to it.
	early?: { days: number; mag: number };
}

export interface Supernova {
	kind: 'supernova';
	id: string;
	name: string;
	designation: string; // "SN 1054"
	constellation: string;
	ra: number; // hours, J2000
	dec: number; // degrees
	peak: number; // ms since 1970 (UTC), at its brightest
	peakMag: number;
	curve: SupernovaCurve;
	early: [number, number, number]; // its color around its peak (linear RGB)
	late: [number, number, number]; // and months later, as it cools
	distance: string;
	about: string;
	terms?: string;
}

export interface GammaRayBurst {
	kind: 'grb';
	id: string;
	name: string;
	designation: string; // "GRB 080319B"
	constellation: string;
	ra: number;
	dec: number;
	trigger: number; // ms since 1970 (UTC): when the gamma rays arrived
	// Its gamma rays (seconds after the trigger): pulses of [start, peak, end, strength 0-1].
	// Invisible to the eye; shown as a violet glow (false color).
	gamma: [number, number, number, number][];
	// Its visible flash, if it could be seen: magnitude rising to peakMag over rise
	// seconds, holding until hold, then fading by decay magnitudes per tenfold time.
	optical?: { start: number; startMag: number; rise: number; peakMag: number; hold: number; decay: number };
	distance: string;
	about: string;
	terms?: string;
}

export type Transient = Supernova | GammaRayBurst;

// Type Ia (a white dwarf blowing apart): about three weeks to rise, three magnitudes
// down in the first month, then a slow fade powered by radioactive cobalt.
const TYPE_IA: SupernovaCurve = { riseDays: 20, fast: 0.1, fastDays: 30, slow: 0.015 };

export const transients: Transient[] = [
	{
		kind: 'supernova',
		id: 'sn1006',
		name: 'SN 1006',
		designation: 'SN 1006',
		constellation: 'Lupus',
		ra: 15.0467,
		dec: -41.94,
		peak: Date.UTC(1006, 4, 11),
		peakMag: -7.5,
		curve: TYPE_IA,
		early: [0.85, 0.9, 1.0],
		late: [1.0, 0.82, 0.6],
		distance: 'about 7,200 light-years',
		about:
			'The brightest star ever recorded: about a quarter as bright as the full Moon, casting shadows at night. Seen from April 30, 1006 (Julian calendar) in China, Egypt, Iraq, Japan and Switzerland, and for about three years.',
		terms: 'lupus brightest',
	},
	{
		kind: 'supernova',
		id: 'sn1054',
		name: 'SN 1054',
		designation: 'SN 1054',
		constellation: 'Taurus',
		ra: 5.5755,
		dec: 22.0145,
		peak: Date.UTC(1054, 6, 10),
		peakMag: -6,
		// A core-collapse supernova: visible by day for 23 days, by night for nearly two years.
		curve: { riseDays: 10, fast: 0.08, fastDays: 30, slow: 0.0145 },
		early: [0.9, 0.93, 1.0],
		late: [1.0, 0.62, 0.48],
		distance: 'about 6,500 light-years',
		about:
			"The explosion that left the Crab Nebula (M1). Chinese astronomers recorded a 'guest star' from July 4, 1054 (Julian calendar), visible in daylight for 23 days and at night for 653.",
		terms: 'crab guest star taurus m1',
	},
	{
		kind: 'supernova',
		id: 'sn1181',
		name: 'SN 1181',
		designation: 'SN 1181',
		constellation: 'Cassiopeia',
		ra: 0.8864,
		dec: 67.5006,
		peak: Date.UTC(1181, 7, 15),
		peakMag: 0,
		// A rare, faint type Iax: it faded from view in six months.
		curve: { riseDays: 15, fast: 0.08, fastDays: 30, slow: 0.025 },
		early: [0.88, 0.92, 1.0],
		late: [1.0, 0.8, 0.6],
		distance: 'about 7,500 light-years',
		about:
			"Recorded in China and Japan from August 6, 1181 (Julian calendar) for 185 days. Its remnant, Pa 30, still holds a 'zombie star' that survived the blast.",
		terms: 'cassiopeia pa 30 zombie',
	},
	{
		kind: 'supernova',
		id: 'tycho',
		name: "Tycho's Supernova",
		designation: 'SN 1572',
		constellation: 'Cassiopeia',
		ra: 0.4214,
		dec: 64.1436,
		peak: Date.UTC(1572, 10, 21),
		peakMag: -4,
		curve: TYPE_IA,
		early: [0.85, 0.9, 1.0],
		late: [1.0, 0.7, 0.5],
		distance: 'about 8,000 light-years',
		about:
			"Tycho Brahe's 'new star' of November 1572 (Julian calendar): as bright as Venus, then yellow, then red as it faded over 16 months. It showed the heavens could change.",
		terms: 'tycho brahe nova stella cassiopeia sn 1572',
	},
	{
		kind: 'supernova',
		id: 'kepler',
		name: "Kepler's Supernova",
		designation: 'SN 1604',
		constellation: 'Ophiuchus',
		ra: 17.5117,
		dec: -21.4833,
		peak: Date.UTC(1604, 9, 28),
		peakMag: -2.5,
		curve: TYPE_IA,
		early: [0.85, 0.9, 1.0],
		late: [1.0, 0.75, 0.55],
		distance: 'about 20,000 light-years',
		about:
			'First seen October 9, 1604, and studied by Johannes Kepler for a year: brighter than Jupiter at its peak. The last supernova in our galaxy seen with the naked eye.',
		terms: 'johannes kepler ophiuchus sn 1604',
	},
	{
		kind: 'supernova',
		id: 'sn1987a',
		name: 'SN 1987A',
		designation: 'SN 1987A',
		constellation: 'Dorado (Large Magellanic Cloud)',
		ra: 5.5911,
		dec: -69.2697,
		peak: Date.UTC(1987, 4, 20),
		peakMag: 2.9,
		// A blue supergiant's collapse: neutrinos arrived February 23, 1987, at 7:35 UTC;
		// it was seen at about magnitude 4.5 the next day and peaked in May.
		curve: { riseDays: 86, fast: 0.01, fastDays: 1, slow: 0.01, early: { days: 86, mag: 4.5 } },
		early: [0.85, 0.9, 1.0],
		late: [1.0, 0.6, 0.45],
		distance: 'about 168,000 light-years',
		about:
			'In the Large Magellanic Cloud, the nearest supernova seen since 1604: the first detected by its neutrinos, a few hours before its light. Only visible from the southern hemisphere.',
		terms: 'large magellanic cloud lmc dorado 1987a neutrino',
	},
	{
		kind: 'grb',
		id: 'grb080319b',
		name: 'The Naked-Eye Burst',
		designation: 'GRB 080319B',
		constellation: 'Boötes',
		ra: 14.528,
		dec: 36.3039,
		trigger: Date.UTC(2008, 2, 19, 6, 12, 49),
		gamma: [[0, 12, 57, 1]],
		// Caught by the Pi of the Sky and TORTORA cameras: magnitude 5.3 for about half a minute.
		optical: { start: 2, startMag: 9, rise: 15, peakMag: 5.3, hold: 45, decay: 3.1 },
		distance: 'about 7.5 billion light-years',
		about:
			'March 19, 2008: the most distant thing ever seen with the naked eye. For about 30 seconds a star appeared in Boötes, from light that set out before the Earth formed.',
		terms: 'naked eye burst grb gamma ray bootes 080319b',
	},
	{
		kind: 'grb',
		id: 'grb221009a',
		name: 'The BOAT',
		designation: 'GRB 221009A',
		constellation: 'Sagitta',
		ra: 19.2176,
		dec: 19.7736,
		trigger: Date.UTC(2022, 9, 9, 13, 16, 59, 990),
		// A precursor, then the main pulses minutes later, the brightest ever recorded.
		gamma: [
			[0, 2, 10, 0.25],
			[175, 225, 290, 1],
			[290, 300, 330, 0.6],
			[380, 400, 450, 0.3],
		],
		distance: 'about 2.4 billion light-years',
		about:
			'October 9, 2022: the "brightest of all time" burst, so strong it disturbed Earth\'s upper atmosphere. Its light was dimmed by dust in our galaxy and never visible to the eye; its gamma rays are shown in false color.',
		terms: 'boat brightest of all time grb gamma ray sagitta 221009a',
	},
];
