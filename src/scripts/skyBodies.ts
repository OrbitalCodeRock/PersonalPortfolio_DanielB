// Telescope-ready visuals for the Moon and planets in the sky view (cosmos.ts).
// Each body is a small sphere at its true apparent size, lit from the real
// direction of the Sun, so phases (the Moon's, Venus's crescent) come out right
// by themselves. Surfaces are painted procedurally in the shader: Jupiter's cloud
// bands and Great Red Spot, Saturn's bands and rings, Mars's dark regions and
// polar caps, the Moon's seas. Planets spin at their real rotation rates.
//
// Bodies live on the rotating celestial sphere (cosmos.ts), so setPose takes
// directions in that frame, and update() converts the lighting to world space.
//
// Zoomed in far enough, each body swaps its painted surface for a real map
// (Solar System Scope textures, see src/data/skyImages.ts), loaded on demand.
import * as THREE from 'three';
import type { BodyName } from './ephemeris';
import { planetMaps } from '../data/skyImages';
import { loadSkyImage } from './skyImageLoader';

export interface BodyVisual {
	object: THREE.Group; // add it to the celestial sphere group
	/** Place the body. All vectors are in the parent (celestial) frame. */
	setPose(center: THREE.Vector3, radius: number, sun: THREE.Vector3, pole: THREE.Vector3, toViewer: THREE.Vector3): void;
	/**
	 * Each frame: fade, spin to the simulated time, and light it in world space.
	 * diskPx is its size on screen; once that's big enough, the real map loads in.
	 */
	update(opacity: number, simMs: number, diskPx: number): void;
	/** Whether the real map is showing (so its credit can be shown). */
	showingMap(): boolean;
}

// Load a body's real map once its disk is this many pixels across.
const MAP_LOAD_PX = 48;

// Rotation period in hours (negative = retrograde); 0 = keep the same face toward
// us, like the Moon. Flattening squashes the gas giants at the poles.
const SPIN_HOURS: Record<BodyName, number> = {
	Moon: 0,
	Mercury: 1407.6,
	Venus: -5832.5,
	Mars: 24.62,
	Jupiter: 9.925,
	Saturn: 10.656,
};
const FLATTENING: Partial<Record<BodyName, number>> = { Jupiter: 0.065, Saturn: 0.098 };

const NOISE = /* glsl */ `
	float hash(vec3 p) {
		p = fract(p * 0.3183099 + 0.1);
		p *= 17.0;
		return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
	}
	float noise(vec3 x) {
		vec3 i = floor(x);
		vec3 f = fract(x);
		f = f * f * (3.0 - 2.0 * f);
		return mix(
			mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
			mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
			f.z);
	}
	float fbm(vec3 p) {
		float v = 0.0;
		float a = 0.5;
		for (int i = 0; i < 5; i++) {
			v += a * noise(p);
			p *= 2.03;
			a *= 0.5;
		}
		return v;
	}
`;

// Surface color at a point p on the unit sphere (y = north pole, +z = side facing us at rest).
const SURFACES: Record<BodyName, string> = {
	Moon: /* glsl */ `
		float maria = smoothstep(0.5, 0.58, fbm(p * 1.8 + vec3(3.1, 1.7, 0.4))) * smoothstep(-0.3, 0.4, p.z);
		vec3 col = mix(vec3(0.78, 0.77, 0.74), vec3(0.4, 0.4, 0.42), maria);
		return col * (0.82 + 0.36 * fbm(p * 22.0));
	`,
	Mercury: /* glsl */ `
		return vec3(0.62, 0.58, 0.54) * (0.72 + 0.5 * fbm(p * 10.0));
	`,
	Venus: /* glsl */ `
		return vec3(0.97, 0.92, 0.8) * (0.9 + 0.14 * fbm(vec3(p.x * 2.0, p.y * 8.0, p.z * 2.0)));
	`,
	Mars: /* glsl */ `
		float dark = smoothstep(0.5, 0.62, fbm(p * 3.0 + 7.0));
		vec3 col = mix(vec3(0.8, 0.42, 0.22), vec3(0.45, 0.24, 0.14), dark);
		return mix(col, vec3(0.95, 0.95, 0.97), smoothstep(0.86, 0.92, abs(p.y))); // polar caps
	`,
	Jupiter: /* glsl */ `
		float lat = asin(clamp(p.y, -1.0, 1.0));
		float lon = atan(p.z, p.x);
		float band = sin(lat * 16.0 + fbm(vec3(p.x * 4.0, p.y * 14.0, p.z * 4.0)) * 1.6);
		vec3 col = mix(vec3(0.7, 0.52, 0.38), vec3(0.93, 0.88, 0.78), smoothstep(-0.25, 0.35, band));
		col = mix(col, vec3(0.62, 0.6, 0.58), smoothstep(0.75, 0.95, abs(p.y)));
		// Great Red Spot, about 22° south.
		float spot = 1.0 - smoothstep(0.1, 0.14, length(vec2(lon * cos(lat), (lat + 0.384) * 2.2)));
		return mix(col, vec3(0.78, 0.42, 0.3), spot);
	`,
	Saturn: /* glsl */ `
		float lat = asin(clamp(p.y, -1.0, 1.0));
		float band = sin(lat * 12.0 + fbm(vec3(p.x * 3.0, p.y * 10.0, p.z * 3.0)));
		vec3 col = mix(vec3(0.8, 0.68, 0.46), vec3(0.93, 0.84, 0.62), smoothstep(-0.3, 0.4, band));
		return mix(col, vec3(0.7, 0.72, 0.7), smoothstep(0.8, 0.97, abs(p.y)));
	`,
};

function bodyMaterial(name: BodyName): THREE.ShaderMaterial {
	const gasGiant = name === 'Jupiter' || name === 'Saturn';
	return new THREE.ShaderMaterial({
		transparent: true,
		uniforms: {
			uSun: { value: new THREE.Vector3() },
			uOpacity: { value: 0 },
			uMap: { value: null as THREE.Texture | null },
			uMapMix: { value: 0 }, // 0 = painted surface, 1 = real map
		},
		defines: {
			LIMB_DARKENING: gasGiant ? '0.6' : '0.2',
			EARTHSHINE: name === 'Moon' ? '0.04' : '0.0', // the Moon's night side glows faintly
		},
		vertexShader: /* glsl */ `
			varying vec3 vLocal;
			varying vec3 vNormalW;
			varying vec3 vPosW;
			varying vec2 vUv;
			void main() {
				vUv = uv;
				vLocal = normalize(position);
				vNormalW = normalize(mat3(modelMatrix) * normal);
				vec4 world = modelMatrix * vec4(position, 1.0);
				vPosW = world.xyz;
				gl_Position = projectionMatrix * viewMatrix * world;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 uSun;
			uniform float uOpacity;
			uniform sampler2D uMap;
			uniform float uMapMix;
			varying vec3 vLocal;
			varying vec3 vNormalW;
			varying vec3 vPosW;
			varying vec2 vUv;
			${NOISE}
			vec3 surface(vec3 p) {
				${SURFACES[name]}
			}
			void main() {
				vec3 n = normalize(vNormalW);
				vec3 toViewer = normalize(cameraPosition - vPosW);
				float light = dot(n, uSun);
				float day = smoothstep(-0.06, 0.1, light); // soft terminator
				float shade = day * (0.45 + 0.55 * max(light, 0.0));
				float limb = mix(1.0, pow(max(dot(n, toViewer), 0.0), 0.35), LIMB_DARKENING);
				vec3 base = surface(vLocal);
				if (uMapMix > 0.0) base = mix(base, texture2D(uMap, vUv).rgb, uMapMix);
				gl_FragColor = vec4(base * (shade * limb + EARTHSHINE), uOpacity);
				#include <colorspace_fragment>
			}
		`,
	});
}

/**
 * Saturn's rings: C, B and A rings with the Cassini division. Whether the planet
 * hides a bit of ring, and whether its shadow falls on it, is worked out exactly
 * per pixel rather than with the depth buffer, which can't resolve something
 * this small this far away and would leave flecks where the rings cross the
 * planet. Each test traces a ray from the ring point (toward the viewer, or
 * toward the Sun) against the planet, in "planet space" where Saturn is a unit
 * sphere: the ring point is only a couple of radii from the center there, so the
 * numbers stay small and precise.
 */
function ringMaterial(flattening: number): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		side: THREE.DoubleSide,
		depthTest: false,
		depthWrite: false,
		uniforms: {
			uSun: { value: new THREE.Vector3() },
			uOpacity: { value: 0 },
			uNormal: { value: new THREE.Vector3() },
			uToLocal: { value: new THREE.Matrix3() }, // world directions -> the planet's frame
			uSquash: { value: new THREE.Vector3(1, 1 / (1 - flattening), 1) }, // planet's frame -> unit-sphere space
		},
		vertexShader: /* glsl */ `
			varying vec2 vRing; // position in the ring plane, in planet radii
			varying vec3 vPosW;
			void main() {
				vRing = position.xy;
				vec4 world = modelMatrix * vec4(position, 1.0);
				vPosW = world.xyz;
				gl_Position = projectionMatrix * viewMatrix * world;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 uSun;
			uniform float uOpacity;
			uniform vec3 uNormal;
			uniform mat3 uToLocal;
			uniform vec3 uSquash;
			varying vec2 vRing;
			varying vec3 vPosW;
			// Does a ray from a (in unit-sphere space) along direction d hit the planet?
			bool hitsPlanet(vec3 a, vec3 d) {
				float qa = dot(d, d);
				float qb = 2.0 * dot(a, d);
				float qc = dot(a, a) - 1.0;
				float disc = qb * qb - 4.0 * qa * qc;
				if (disc < 0.0) return false;
				return (-qb - sqrt(disc)) / (2.0 * qa) > 0.0;
			}
			void main() {
				// This ring point in unit-sphere space: the ring lies in the planet's equator (y = 0).
				vec3 here = vec3(vRing.x, 0.0, -vRing.y);
				vec3 toViewer = (uToLocal * normalize(cameraPosition - vPosW)) * uSquash;
				if (hitsPlanet(here, toViewer)) discard; // the planet is between us and this bit of ring
				float r = length(vRing);
				float density =
					0.25 * step(1.24, r) * step(r, 1.53) + // C ring
					0.9 * step(1.53, r) * step(r, 1.95) + // B ring (then the Cassini division, 1.95-2.03)
					0.6 * step(2.03, r) * step(r, 2.27); // A ring
				density *= 0.85 + 0.15 * sin(r * 90.0); // ringlets
				// Lit face toward us, or seeing the rings' shadowed side.
				float sameSide = sign(dot(uNormal, uSun)) * sign(dot(uNormal, cameraPosition - vPosW));
				float lit = sameSide > 0.0 ? 1.0 : 0.35;
				// The planet's shadow falling across the rings.
				float shadow = hitsPlanet(here, (uToLocal * uSun) * uSquash) ? 0.2 : 1.0;
				gl_FragColor = vec4(vec3(0.9, 0.82, 0.66) * lit * shadow, density * uOpacity);
				#include <colorspace_fragment>
			}
		`,
	});
}

export function createBodyVisual(name: BodyName): BodyVisual {
	const object = new THREE.Group();
	const material = bodyMaterial(name);
	const geometry = new THREE.SphereGeometry(1, 64, 32);
	// Map longitude 0 (the middle of the map) to +z, the side facing us: for the Moon,
	// that's its near side, which always faces Earth.
	geometry.rotateY(-Math.PI / 2);
	const sphere = new THREE.Mesh(geometry, material);
	sphere.renderOrder = 1;
	object.add(sphere);

	let rings: THREE.ShaderMaterial | null = null;
	let ring: THREE.Mesh | null = null;
	if (name === 'Saturn') {
		rings = ringMaterial(FLATTENING.Saturn!);
		ring = new THREE.Mesh(new THREE.RingGeometry(1.24, 2.27, 256, 1), rings);
		ring.rotation.x = -Math.PI / 2; // RingGeometry lies in XY; the rings lie in the equator (XZ)
		ring.renderOrder = 2;
		object.add(ring);
	}

	const sunLocal = new THREE.Vector3();
	const poleLocal = new THREE.Vector3();
	const parentRotation = new THREE.Quaternion();
	const objectRotation = new THREE.Quaternion();
	const toLocal = new THREE.Matrix4();
	const spinHours = SPIN_HOURS[name];
	const flattening = FLATTENING[name] ?? 0;
	// The real map: requested once the disk is big enough, then faded in.
	const mapUrl = planetMaps[name]?.map;
	let mapRequested = false;
	let mapLoaded = false;
	let lastUpdate = 0;

	return {
		object,
		setPose(center, radius, sun, pole, toViewer) {
			object.position.copy(center);
			// Local frame: y = north pole, z = toward the viewer (as far as the pole allows).
			const y = pole.clone().normalize();
			const z = toViewer.clone().addScaledVector(y, -toViewer.dot(y));
			if (z.lengthSq() < 1e-8) z.set(1, 0, 0).addScaledVector(y, -y.x);
			z.normalize();
			const x = new THREE.Vector3().crossVectors(y, z);
			object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
			sphere.scale.set(radius, radius * (1 - flattening), radius);
			ring?.scale.setScalar(radius);
			sunLocal.copy(sun).normalize();
			poleLocal.copy(y);
		},
		update(opacity, simMs, diskPx) {
			material.uniforms.uOpacity.value = opacity;
			if (mapUrl && !mapRequested && diskPx >= MAP_LOAD_PX) {
				mapRequested = true;
				loadSkyImage(mapUrl)
					.then(({ texture }) => {
						material.uniforms.uMap.value = texture;
						mapLoaded = true;
					})
					.catch(() => (mapRequested = false)); // try again next time
			}
			// Fade the real map in over about half a second once it arrives.
			const now = performance.now();
			const dt = lastUpdate ? Math.min(0.1, (now - lastUpdate) / 1000) : 0;
			lastUpdate = now;
			if (mapLoaded) material.uniforms.uMapMix.value = Math.min(1, material.uniforms.uMapMix.value + dt * 2);
			if (spinHours) sphere.rotation.y = ((simMs / 3.6e6 / spinHours) % 1) * Math.PI * 2;
			object.parent?.getWorldQuaternion(parentRotation);
			const sunWorld = sunLocal.clone().applyQuaternion(parentRotation);
			material.uniforms.uSun.value.copy(sunWorld);
			if (rings) {
				rings.uniforms.uOpacity.value = opacity;
				rings.uniforms.uSun.value.copy(sunWorld);
				rings.uniforms.uNormal.value.copy(poleLocal).applyQuaternion(parentRotation);
				// The planet's frame (y = pole) doesn't spin with the surface, so the object's rotation will do.
				object.getWorldQuaternion(objectRotation).invert();
				rings.uniforms.uToLocal.value.setFromMatrix4(toLocal.makeRotationFromQuaternion(objectRotation));
			}
		},
		showingMap() {
			return material.uniforms.uMapMix.value > 0.5;
		},
	};
}
