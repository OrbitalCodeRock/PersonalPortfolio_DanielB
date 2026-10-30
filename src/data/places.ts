// Places to view the sky from (the sky view's location menu). Picked to show how
// different the sky looks around the world: far north, the tropics, the southern
// hemisphere, Antarctica. Latitude and longitude in degrees (north and east positive);
// timeZone is the place's IANA time zone, for showing sky times in local time.

export interface Place {
	name: string;
	lat: number;
	lon: number;
	timeZone: string;
}

export const places: Place[] = [
	{ name: 'Glenview, Illinois', lat: 42.0698, lon: -87.7878, timeZone: 'America/Chicago' },
	{ name: 'New York', lat: 40.7128, lon: -74.006, timeZone: 'America/New_York' },
	{ name: 'Los Angeles', lat: 34.0522, lon: -118.2437, timeZone: 'America/Los_Angeles' },
	{ name: 'Reykjavík, Iceland', lat: 64.1466, lon: -21.9426, timeZone: 'Atlantic/Reykjavik' },
	{ name: 'Tromsø, Norway', lat: 69.6492, lon: 18.9553, timeZone: 'Europe/Oslo' },
	{ name: 'London', lat: 51.5074, lon: -0.1278, timeZone: 'Europe/London' },
	{ name: 'Cairo', lat: 30.0444, lon: 31.2357, timeZone: 'Africa/Cairo' },
	{ name: 'Nairobi, Kenya', lat: -1.2921, lon: 36.8219, timeZone: 'Africa/Nairobi' },
	{ name: 'Tokyo', lat: 35.6762, lon: 139.6503, timeZone: 'Asia/Tokyo' },
	{ name: 'Sydney', lat: -33.8688, lon: 151.2093, timeZone: 'Australia/Sydney' },
	{ name: 'Santiago, Chile', lat: -33.4489, lon: -70.6693, timeZone: 'America/Santiago' },
	{ name: 'McMurdo Station, Antarctica', lat: -77.846, lon: 166.676, timeZone: 'Antarctica/McMurdo' },
];
