// Looking around the sky view by moving the phone (cosmos.ts setDeviceLook): wherever
// the back of the phone points, the view points. Read from the device's orientation
// sensors: the direction out of the back of the screen, as a compass heading and an
// altitude. Headings are true to the compass where the device reports one (Android's
// absolute orientation, iOS's compass heading); elsewhere the view starts from
// wherever it was facing and turns with the phone from there.

export interface DeviceLook {
	heading: number; // radians from north through east
	pitch: number; // radians above the horizon
}

/** Does this device have orientation sensors to steer by (a phone or tablet)? */
export function deviceLookSupported(): boolean {
	return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches;
}

// How much of each new reading goes into the smoothed direction (the rest is the last
// one's): sensors jitter, and the view shouldn't.
const SMOOTHING = 0.25;
const RAD = Math.PI / 180;

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };

let listener: ((e: Event) => void) | null = null;
let eventName = '';
let smoothed: [number, number, number] | null = null;
let headingOffset = 0; // added to headings that aren't true to the compass
let compassKnown = false;

/**
 * Start following the device's orientation. Asks permission first where the browser
 * requires it (iOS), so call it from a tap. startHeading: where the view faces now,
 * to start from on devices that can't tell north. False if it can't (no sensors, or
 * permission refused).
 */
export async function startDeviceLook(startHeading: number): Promise<boolean> {
	if (!deviceLookSupported()) return false;
	const request = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
	if (request) {
		try {
			if ((await request()) !== 'granted') return false;
		} catch {
			return false;
		}
	}
	stopDeviceLook();
	smoothed = null;
	compassKnown = false;
	let first = true;
	listener = (e: Event) => {
		const o = e as OrientationEventWithCompass;
		if (o.alpha === null || o.beta === null || o.gamma === null) return;
		// iOS gives the compass heading separately; Android's absolute event, or one flagged absolute, is already true.
		let alpha = o.alpha;
		if (typeof o.webkitCompassHeading === 'number') alpha = 360 - o.webkitCompassHeading;
		const absolute = typeof o.webkitCompassHeading === 'number' || e.type === 'deviceorientationabsolute' || o.absolute;
		const d = backDirection(alpha * RAD, o.beta * RAD, o.gamma * RAD);
		smoothed = smoothed ? (smoothed.map((v, i) => v + (d[i] - v) * SMOOTHING) as [number, number, number]) : d;
		if (first) {
			first = false;
			compassKnown = absolute;
			// No compass: start from where the view already faces.
			headingOffset = absolute ? 0 : startHeading - Math.atan2(d[0], d[1]);
		}
	};
	// Prefer Android's absolute (compass) orientation where it's offered.
	eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
	window.addEventListener(eventName, listener);
	return true;
}

export function stopDeviceLook() {
	if (listener) window.removeEventListener(eventName, listener);
	listener = null;
	smoothed = null;
}

/** Where the phone points now, or null before the first reading (or when stopped). */
export function deviceLook(): DeviceLook | null {
	if (!smoothed) return null;
	const [x, y, z] = smoothed;
	const length = Math.hypot(x, y, z) || 1;
	return { heading: Math.atan2(x, y) + headingOffset, pitch: Math.asin(Math.max(-1, Math.min(1, z / length))) };
}

/** Whether headings are true to the compass (false: relative to where it started). */
export function deviceLookHasCompass(): boolean {
	return compassKnown;
}

/**
 * The direction out of the back of the screen, in the Earth's frame (x east, y north,
 * z up), for the W3C device orientation angles: the device's frame turned by alpha
 * about z, then beta about x, then gamma about y.
 */
function backDirection(alpha: number, beta: number, gamma: number): [number, number, number] {
	const [ca, sa, cb, sb, cg, sg] = [Math.cos(alpha), Math.sin(alpha), Math.cos(beta), Math.sin(beta), Math.cos(gamma), Math.sin(gamma)];
	// Minus the rotation matrix's third column (the screen's outward normal).
	return [-(ca * sg + sa * sb * cg), -(sa * sg - ca * sb * cg), -(cb * cg)];
}
