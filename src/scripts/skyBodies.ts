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
import { applyStarLook, starCoronaMaterial, starSurfaceMaterial, SUN_LOOK } from './skySun';

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

// A globe visibly turns at most this many times a second (real time). With the clock
// sped up, Jupiter would otherwise spin many times a frame and its surface would only
// strobe; past this it turns at this steady rate (the right way round) instead.
const MAX_SPIN_PER_SECOND = 0.25;

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
	Uranus: -17.24,
	Neptune: 16.11,
	Sun: 609.12,
	Pluto: -153.29,
	Ceres: 9.074,
	Vesta: 5.342,
	Eris: 378.9,
	// Jupiter's moons keep one face toward Jupiter: they turn once per orbit.
	Io: 42.459,
	Europa: 85.228,
	Ganymede: 171.709,
	Callisto: 400.536,
};
const FLATTENING: Partial<Record<BodyName, number>> = { Jupiter: 0.065, Saturn: 0.098, Uranus: 0.023, Neptune: 0.017 };

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
	Uranus: /* glsl */ `
		// A nearly featureless pale cyan haze, a little brighter toward the poles.
		return vec3(0.68, 0.88, 0.9) * (0.94 + 0.08 * abs(p.y) + 0.03 * fbm(vec3(p.x * 2.0, p.y * 9.0, p.z * 2.0)));
	`,
	Neptune: /* glsl */ `
		// Deep blue with faint bands and a dark storm, like Voyager 2's Great Dark Spot.
		float lat = asin(clamp(p.y, -1.0, 1.0));
		float band = sin(lat * 10.0 + fbm(vec3(p.x * 3.0, p.y * 10.0, p.z * 3.0)) * 1.2);
		vec3 col = mix(vec3(0.24, 0.4, 0.82), vec3(0.36, 0.52, 0.92), smoothstep(-0.4, 0.6, band));
		float spot = 1.0 - smoothstep(0.08, 0.12, length(vec2(atan(p.z, p.x) * cos(lat) - 0.6, (lat + 0.35) * 2.0)));
		return mix(col, vec3(0.14, 0.24, 0.55), spot);
	`,
	Sun: /* glsl */ `
		// Granulation, and a few dark sunspots near the equator.
		vec3 col = vec3(1.0, 0.8, 0.45) * (0.82 + 0.3 * fbm(p * 40.0));
		float spots = smoothstep(0.72, 0.76, fbm(p * 6.0 + 11.0)) * (1.0 - smoothstep(0.2, 0.5, abs(p.y)));
		return mix(col, vec3(0.35, 0.18, 0.06), spots);
	`,
	Pluto: /* glsl */ `
		// Tan and peach, a bright nitrogen-ice plain, and dark reddish equatorial patches.
		vec3 col = mix(vec3(0.72, 0.58, 0.48), vec3(0.93, 0.88, 0.83), smoothstep(0.55, 0.65, fbm(p * 2.5 + 3.0)));
		float dark = smoothstep(0.5, 0.6, fbm(p * 3.0 + 9.0)) * (1.0 - smoothstep(0.1, 0.4, abs(p.y)));
		return mix(col, vec3(0.35, 0.18, 0.12), dark);
	`,
	Ceres: /* glsl */ `
		return vec3(0.42) * (0.78 + 0.4 * fbm(p * 12.0));
	`,
	Vesta: /* glsl */ `
		return vec3(0.56, 0.53, 0.49) * (0.72 + 0.5 * fbm(p * 8.0));
	`,
	Eris: /* glsl */ `
		// One of the most reflective bodies known: frost all over.
		return vec3(0.95, 0.94, 0.92) * (0.93 + 0.1 * fbm(p * 5.0));
	`,
	Io: /* glsl */ `
		// Sulfur yellows and oranges, dark volcanic spots, white frost.
		vec3 col = mix(vec3(0.93, 0.83, 0.45), vec3(0.85, 0.55, 0.28), smoothstep(0.4, 0.65, fbm(p * 4.0)));
		col = mix(col, vec3(0.95, 0.93, 0.85), smoothstep(0.62, 0.7, fbm(p * 6.0 + 5.0)));
		return mix(col, vec3(0.25, 0.14, 0.08), smoothstep(0.7, 0.74, fbm(p * 12.0 + 2.0)));
	`,
	Europa: /* glsl */ `
		// Bright ice crossed by reddish-brown cracks.
		float cracks = 1.0 - smoothstep(0.0, 0.05, abs(sin(dot(p, vec3(9.0, 5.0, 3.0)) + fbm(p * 3.0) * 6.0)));
		return mix(vec3(0.88, 0.86, 0.8), vec3(0.6, 0.42, 0.3), cracks * 0.7);
	`,
	Ganymede: /* glsl */ `
		// Dark old terrain and lighter grooved terrain.
		return mix(vec3(0.42, 0.39, 0.35), vec3(0.76, 0.73, 0.68), smoothstep(0.45, 0.6, fbm(p * 4.0)));
	`,
	Callisto: /* glsl */ `
		// Dark and heavily cratered, peppered with bright crater rims.
		return vec3(0.34, 0.31, 0.27) * (0.85 + 0.3 * fbm(p * 10.0)) + vec3(0.45) * smoothstep(0.76, 0.8, fbm(p * 24.0));
	`,
};

function bodyMaterial(name: BodyName): THREE.ShaderMaterial {
	const gasGiant = name === 'Jupiter' || name === 'Saturn' || name === 'Uranus' || name === 'Neptune';
	const sun = name === 'Sun';
	return new THREE.ShaderMaterial({
		transparent: true,
		uniforms: {
			uSun: { value: new THREE.Vector3() },
			uOpacity: { value: 0 },
			uMap: { value: null as THREE.Texture | null },
			uMapMix: { value: 0 }, // 0 = painted surface, 1 = real map
		},
		defines: {
			LIMB_DARKENING: sun ? '0.85' : gasGiant ? '0.6' : '0.2',
			EARTHSHINE: name === 'Moon' ? '0.04' : '0.0', // the Moon's night side glows faintly
			EMISSIVE: sun ? '1' : '0', // the Sun makes its own light: no phases or night side
		},
		// Everything in view space (modelViewMatrix is worked out on the CPU in double
		// precision): world coordinates in 32-bit floats can't resolve a disk a fraction
		// of an arcsecond across, which the telescope can zoom to.
		vertexShader: /* glsl */ `
			uniform vec3 uSun;
			varying vec3 vLocal;
			varying vec3 vNormalV;
			varying vec3 vViewPos;
			varying vec3 vSunV;
			varying vec2 vUv;
			void main() {
				vUv = uv;
				vLocal = normalize(position);
				vNormalV = normalize(normalMatrix * normal);
				vSunV = normalize(mat3(viewMatrix) * uSun);
				vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
				vViewPos = viewPos.xyz;
				gl_Position = projectionMatrix * viewPos;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uOpacity;
			uniform sampler2D uMap;
			uniform float uMapMix;
			varying vec3 vLocal;
			varying vec3 vNormalV;
			varying vec3 vViewPos;
			varying vec3 vSunV;
			varying vec2 vUv;
			${NOISE}
			vec3 surface(vec3 p) {
				${SURFACES[name]}
			}
			void main() {
				vec3 n = normalize(vNormalV);
				vec3 toViewer = normalize(-vViewPos);
				float light = dot(n, normalize(vSunV));
				float day = smoothstep(-0.06, 0.1, light); // soft terminator
				float shade = day * (0.45 + 0.55 * max(light, 0.0));
				float limb = mix(1.0, pow(max(dot(n, toViewer), 0.0), 0.35), LIMB_DARKENING);
				vec3 base = surface(vLocal);
				if (uMapMix > 0.0) base = mix(base, texture2D(uMap, vUv).rgb, uMapMix);
				if (EMISSIVE > 0) shade = 1.0;
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
			varying vec3 vToViewer; // world direction toward the viewer
			void main() {
				vRing = position.xy;
				// In view space, for precision (see bodyMaterial).
				vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
				vToViewer = normalize((vec4(-viewPos.xyz, 0.0) * viewMatrix).xyz); // view -> world (inverse rotation)
				gl_Position = projectionMatrix * viewPos;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 uSun;
			uniform float uOpacity;
			uniform vec3 uNormal;
			uniform mat3 uToLocal;
			uniform vec3 uSquash;
			varying vec2 vRing;
			varying vec3 vToViewer;
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
				vec3 toViewer = (uToLocal * normalize(vToViewer)) * uSquash;
				if (hitsPlanet(here, toViewer)) discard; // the planet is between us and this bit of ring
				float r = length(vRing);
				float density =
					0.25 * step(1.24, r) * step(r, 1.53) + // C ring
					0.9 * step(1.53, r) * step(r, 1.95) + // B ring (then the Cassini division, 1.95-2.03)
					0.6 * step(2.03, r) * step(r, 2.27); // A ring
				density *= 0.85 + 0.15 * sin(r * 90.0); // ringlets
				// Lit face toward us, or seeing the rings' shadowed side.
				float sameSide = sign(dot(uNormal, uSun)) * sign(dot(uNormal, vToViewer));
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
	// The Sun is a live simulation (skySun.ts) rather than a painted or mapped globe.
	const material = name === 'Sun' ? starSurfaceMaterial() : bodyMaterial(name);
	// Enough segments that the edge stays round even filling the screen at the deepest
	// zoom (and, for the Sun, meets its round corona without slivers).
	const geometry = name === 'Sun' ? new THREE.SphereGeometry(1, 384, 192) : new THREE.SphereGeometry(1, 160, 80);
	// Map longitude 0 (the middle of the map) to +z, the side facing us: for the Moon,
	// that's its near side, which always faces Earth.
	geometry.rotateY(-Math.PI / 2);
	const sphere = new THREE.Mesh(geometry, material);
	sphere.renderOrder = 1;
	object.add(sphere);

	// The Sun's corona, chromosphere and prominences, around the disk.
	let corona: THREE.ShaderMaterial | null = null;
	if (name === 'Sun') {
		corona = starCoronaMaterial();
		applyStarLook(material, corona, SUN_LOOK);
		const halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), corona);
		halo.renderOrder = 2;
		halo.frustumCulled = false; // a billboard: sized in its shader, not by its geometry
		object.add(halo);
	}

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
	let lastSimMs: number | null = null;
	let spin = 0; // the globe's shown turn (radians): the true one, unless that's spinning too fast to see

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
			if (corona) corona.uniforms.uRadius.value = radius;
			sunLocal.copy(sun).normalize();
			poleLocal.copy(y);
		},
		update(opacity, simMs, diskPx) {
			material.uniforms.uOpacity.value = opacity;
			if (corona) {
				// The Sun's surface and corona move in real time, whatever the sky's clock does.
				const seconds = performance.now() / 1000;
				material.uniforms.uTime.value = seconds;
				corona.uniforms.uTime.value = seconds;
				corona.uniforms.uOpacity.value = opacity;
			}
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
			if (spinHours) {
				const trueSpin = ((simMs / 3.6e6 / spinHours) % 1) * Math.PI * 2;
				// Turns per real second at the clock's current speed.
				const rate = lastSimMs !== null && dt > 0 ? (simMs - lastSimMs) / 3.6e6 / spinHours / dt : 0;
				if (Math.abs(rate) <= MAX_SPIN_PER_SECOND) spin = trueSpin;
				else spin += Math.sign(rate) * MAX_SPIN_PER_SECOND * Math.PI * 2 * dt;
				sphere.rotation.y = spin;
			}
			lastSimMs = simMs;
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
