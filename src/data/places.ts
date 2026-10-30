// Places to view the sky from (the sky view's location menu). Picked to show how
// different the sky looks around the world: far north, the tropics, the southern
// hemisphere, Antarctica. Latitude and longitude in degrees (north and east positive).

export interface Place {
	name: string;
	lat: number;
	lon: number;
}

export const places: Place[] = [
	{ name: 'Glenview, Illinois', lat: 42.0698, lon: -87.7878 },
	{ name: 'New York', lat: 40.7128, lon: -74.006 },
	{ name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
	{ name: 'Reykjavík, Iceland', lat: 64.1466, lon: -21.9426 },
	{ name: 'Tromsø, Norway', lat: 69.6492, lon: 18.9553 },
	{ name: 'London', lat: 51.5074, lon: -0.1278 },
	{ name: 'Cairo', lat: 30.0444, lon: 31.2357 },
	{ name: 'Nairobi, Kenya', lat: -1.2921, lon: 36.8219 },
	{ name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
	{ name: 'Sydney', lat: -33.8688, lon: 151.2093 },
	{ name: 'Santiago, Chile', lat: -33.4489, lon: -70.6693 },
	{ name: 'McMurdo Station, Antarctica', lat: -77.846, lon: 166.676 },
];
