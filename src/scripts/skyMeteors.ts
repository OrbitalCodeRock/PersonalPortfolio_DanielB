// Meteor showers in the sky view (cosmos.ts): while a shower is active, a faint
// ring marks its radiant and meteors streak out of it, each a short bright line
// that runs away from the radiant and fades. Real rates are low (a few to about a
// hundred an hour at best), so at real time they're shown METEOR_SPEEDUP times as
// often, to be seen in a short visit. They follow the sky's clock: run it faster
// and more fall (up to MAX_PER_SECOND), pause it and none do (any in flight hold
// still). Stronger showers show more, and fewer fall while the radiant is low, as
// in the real sky.
import * as THREE from 'three';
import { meteorShowers, type MeteorShower } from '../data/meteorShowers';
import { showerActivity, type ShowerActivity } from './meteors';
import { equatorialVector } from './sky';

export const METEOR_SPEEDUP = 100;
// However fast the clock runs, at most this many new meteors a second, so the sky stays readable.
const MAX_PER_SECOND = 6;
const POOL = 32; // meteors on screen at once, at most
const RAD = Math.PI / 180;

interface Meteor {
	start: THREE.Vector3; // unit vectors, celestial frame
	end: THREE.Vector3;
	age: number; // seconds
	duration: number;
	brightness: number;
}

export interface MeteorShowers {
	object: THREE.Group; // add it to the celestial sphere group
	showers: { shower: MeteorShower; radiant: THREE.Vector3; activity: ShowerActivity }[];
	/**
	 * Each frame: update which showers are active and move the meteors. dt is real
	 * seconds; rate is how fast the sky's clock runs (simulated seconds per real
	 * second, 0 = paused). sinAlt gives how high a celestial-frame direction is.
	 */
	update(date: Date, dt: number, rate: number, opacity: number, sinAlt: (dir: THREE.Vector3) => number): void;
}

function ringTexture(): THREE.Texture {
	const size = 64;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	ctx.strokeStyle = 'rgba(255,214,150,0.9)';
	ctx.lineWidth = 3;
	ctx.setLineDash([6, 5]);
	ctx.beginPath();
	ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
	ctx.stroke();
	return new THREE.CanvasTexture(canvas);
}

/** A point `angle` radians from `from`, heading in direction `along` (perpendicular to from). */
function away(from: THREE.Vector3, along: THREE.Vector3, angle: number): THREE.Vector3 {
	return from.clone().multiplyScalar(Math.cos(angle)).addScaledVector(along, Math.sin(angle));
}

export function createMeteorShowers(distance: number): MeteorShowers {
	const object = new THREE.Group();
	const ring = ringTexture();
	const showers = meteorShowers.map((shower) => {
		const radiant = new THREE.Vector3(...equatorialVector(shower.ra, shower.dec));
		const marker = new THREE.Points(
			new THREE.BufferGeometry().setFromPoints([radiant.clone().multiplyScalar(distance)]),
			new THREE.PointsMaterial({ map: ring, size: 26, sizeAttenuation: false, transparent: true, depthWrite: false, opacity: 0 }),
		);
		object.add(marker);
		return { shower, radiant, marker, activity: showerActivity(shower, new Date()), spawn: 0 };
	});

	// The meteors: one line segment each, head bright, tail fading to nothing (additive, so black = invisible).
	const positions = new Float32Array(POOL * 6);
	const colors = new Float32Array(POOL * 6);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	const lines = new THREE.LineSegments(
		geometry,
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
	);
	lines.frustumCulled = false;
	object.add(lines);
	const meteors: (Meteor | null)[] = new Array(POOL).fill(null);
	const head = new THREE.Vector3();
	const tail = new THREE.Vector3();
	let lastCheck = -Infinity;

	function launch(radiant: THREE.Vector3, speed: number, sinAlt: (dir: THREE.Vector3) => number) {
		const slot = meteors.indexOf(null);
		if (slot < 0) return;
		// A random heading out of the radiant, starting some way from it.
		const u = new THREE.Vector3().crossVectors(radiant, Math.abs(radiant.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
		const v = new THREE.Vector3().crossVectors(radiant, u);
		const heading = Math.random() * Math.PI * 2;
		const along = u.multiplyScalar(Math.cos(heading)).addScaledVector(v, Math.sin(heading));
		const from = (5 + Math.random() * 45) * RAD;
		const length = (4 + Math.random() * 12) * RAD;
		const start = away(radiant, along, from);
		if (sinAlt(start) < 0.05) return; // below (or right at) the horizon
		meteors[slot] = {
			start,
			end: away(radiant, along, from + length),
			age: 0,
			// Faster meteors cross the sky faster: about 0.6° a second per km/s.
			duration: length / (speed * 0.6 * RAD),
			brightness: 0.4 + Math.random() * 0.6,
		};
	}

	return {
		object,
		showers,
		update(date, dt, rate, opacity, sinAlt) {
			// Activity changes slowly: recheck about once a second.
			if (performance.now() - lastCheck > 1000) {
				lastCheck = performance.now();
				for (const s of showers) s.activity = showerActivity(s.shower, date);
			}
			for (const s of showers) {
				const height = sinAlt(s.radiant);
				const up = s.activity.active && height > 0;
				(s.marker.material as THREE.PointsMaterial).opacity = up ? opacity * 0.5 : 0;
				if (!up || opacity <= 0) continue;
				// Fewer meteors while the radiant is low (half of them would come from below the horizon).
				const simulated = (s.activity.rate / 3600) * height * Math.abs(rate); // meteors per real second, for real
				const perSecond = Math.min(MAX_PER_SECOND, simulated * METEOR_SPEEDUP);
				if (Math.random() < perSecond * dt) launch(s.radiant, s.shower.speed, sinAlt);
			}
			meteors.forEach((m, i) => {
				let fade = 0;
				if (m) {
					if (rate !== 0) m.age += dt; // paused: hold still
					const p = m.age / m.duration;
					if (p >= 1) meteors[i] = null;
					else {
						head.copy(m.start).lerp(m.end, p).normalize().multiplyScalar(distance);
						tail.copy(m.start).lerp(m.end, Math.max(0, p - 0.35)).normalize().multiplyScalar(distance);
						head.toArray(positions, i * 6);
						tail.toArray(positions, i * 6 + 3);
						// Flares up, then burns out.
						fade = m.brightness * Math.sin(Math.PI * Math.min(1, p * 1.2)) * opacity;
					}
				}
				colors.set([fade, fade * 0.97, fade * 0.88, 0, 0, 0], i * 6);
			});
			geometry.attributes.position.needsUpdate = true;
			geometry.attributes.color.needsUpdate = true;
		},
	};
}
