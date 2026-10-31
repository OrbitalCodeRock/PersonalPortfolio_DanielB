// Stars up close in the sky view: a live simulation rather than a picture, for the
// Sun (skyBodies.ts) and for any star the telescope zooms in on (cosmos.ts). The
// surface churns with granulation (convection cells of hot gas welling up, with
// darker lanes where cooler gas sinks), slowly drifting and reshaping; starspots
// (dark umbrae ringed by lighter penumbrae) gather in mid-latitude bands, with bright
// faculae around them toward the limb; and flares flash now and then in those active
// regions. Around the edge, a corona with streamers, the thin chromosphere, and
// prominences: arcs of glowing plasma that rise off the limb, flicker, and fade.
//
// How each of those shows is set by a StarLook: hot blue-white stars have no
// convection near the surface to speak of (so barely any granulation, no spots) and
// strong winds (a wide, streaming halo); cool red ones have a few huge convection
// cells, big starspots and frequent flares. STAR_LOOKS has one per spectral type
// (cosmos.ts STAR_TYPES order), and SUN_LOOK is the Sun's.
//
// Everything moves in real time, so it's alive even with the sky's clock paused.
// Drawn in view space for precision, like the other bodies.
import * as THREE from 'three';

type RGB = [number, number, number];

export interface StarLook {
	core: RGB; // color at the center of the disk (linear; shown brighter on screen)
	limb: RGB; // color at the edge, where we see cooler, higher layers
	brightness: number;
	limbDarkening: number; // 0 = none, 1 = black at the edge
	cells: number; // granulation cells across a unit of the star (more = smaller cells)
	boil: number; // how strongly the granulation shows (0 = smooth)
	mottle: number; // large, slow brightness patches (0 = none)
	spots: number; // starspot coverage (0 = none, 1 = like the Sun)
	flares: number; // how often and bright flares are (1 = like the Sun)
	corona: RGB;
	coronaStrength: number;
	coronaFalloff: number; // how fast the corona fades with height (smaller = wider)
	streamers: number; // how streaky the corona is (0 = smooth)
	rim: RGB; // the chromosphere and prominences
	prominences: number; // 0 = none, 1 = like the Sun
}

export const SUN_LOOK: StarLook = {
	core: [1.0, 0.6, 0.12],
	limb: [0.9, 0.14, 0.0],
	brightness: 1.6,
	limbDarkening: 0.72,
	cells: 90,
	boil: 1,
	mottle: 1,
	spots: 1,
	flares: 1,
	corona: [1.0, 0.7, 0.4],
	coronaStrength: 1,
	coronaFalloff: 3.2,
	streamers: 0.65,
	rim: [1.0, 0.2, 0.06],
	prominences: 1,
};

/** One per spectral type, hottest first: B, A, F, G, K, M. */
export const STAR_LOOKS: StarLook[] = [
	// B: blue-white and very hot. Radiative surface (no granulation), no spots; a strong
	// wind streams off it as a wide, bright, streaky halo.
	{
		...SUN_LOOK,
		core: [0.6, 0.75, 1.0],
		limb: [0.25, 0.38, 0.95],
		brightness: 1.7,
		limbDarkening: 0.35,
		cells: 30,
		boil: 0.08,
		mottle: 0.35,
		spots: 0,
		flares: 0,
		corona: [0.45, 0.6, 1.0],
		coronaStrength: 1.6,
		coronaFalloff: 1.7,
		streamers: 1,
		rim: [0.55, 0.65, 1.0],
		prominences: 0,
	},
	// A: white, like Sirius and Vega. Almost smooth, a soft bluish-white halo.
	{
		...SUN_LOOK,
		core: [0.9, 0.92, 1.0],
		limb: [0.55, 0.6, 0.9],
		brightness: 1.5,
		limbDarkening: 0.45,
		cells: 40,
		boil: 0.15,
		mottle: 0.5,
		spots: 0,
		flares: 0,
		corona: [0.75, 0.82, 1.0],
		coronaStrength: 1.2,
		coronaFalloff: 2.3,
		streamers: 0.8,
		rim: [0.8, 0.85, 1.0],
		prominences: 0,
	},
	// F: yellow-white (Polaris, Procyon). Finer, gentler granulation; a few spots.
	{
		...SUN_LOOK,
		core: [1.0, 0.8, 0.45],
		limb: [0.95, 0.38, 0.08],
		brightness: 1.55,
		limbDarkening: 0.62,
		cells: 110,
		boil: 0.7,
		spots: 0.45,
		flares: 0.5,
		corona: [1.0, 0.85, 0.65],
		coronaFalloff: 2.9,
		prominences: 0.6,
	},
	// G: like the Sun.
	SUN_LOOK,
	// K: orange (Arcturus, Aldebaran). Deeper colors, more and bigger spots, busy prominences.
	{
		...SUN_LOOK,
		core: [1.0, 0.36, 0.05],
		limb: [0.7, 0.06, 0.0],
		brightness: 1.65,
		limbDarkening: 0.8,
		cells: 70,
		spots: 1.4,
		flares: 1.2,
		corona: [1.0, 0.5, 0.25],
		rim: [1.0, 0.16, 0.04],
		prominences: 1.15,
	},
	// M: red (Betelgeuse, Antares, Proxima). A few huge convection cells, big starspots,
	// frequent strong flares, red prominences.
	{
		...SUN_LOOK,
		core: [1.0, 0.2, 0.03],
		limb: [0.45, 0.02, 0.0],
		brightness: 1.75,
		limbDarkening: 0.85,
		cells: 13,
		boil: 1.2,
		mottle: 1.3,
		spots: 1.8,
		flares: 1.8,
		corona: [1.0, 0.3, 0.12],
		coronaStrength: 0.9,
		rim: [1.0, 0.1, 0.02],
		prominences: 1.3,
	},
];

const color = (c: RGB) => new THREE.Vector3(...c);

/** Set a star's look on its surface and corona materials. */
export function applyStarLook(surface: THREE.ShaderMaterial, corona: THREE.ShaderMaterial, look: StarLook) {
	const u = surface.uniforms;
	u.uCore.value.copy(color(look.core));
	u.uLimbColor.value.copy(color(look.limb));
	u.uBrightness.value = look.brightness;
	u.uLimbDarkening.value = look.limbDarkening;
	u.uCells.value = look.cells;
	u.uBoil.value = look.boil;
	u.uMottle.value = look.mottle;
	u.uSpots.value = look.spots;
	u.uFlares.value = look.flares;
	const c = corona.uniforms;
	c.uCoronaColor.value.copy(color(look.corona));
	c.uCoronaStrength.value = look.coronaStrength;
	c.uCoronaFalloff.value = look.coronaFalloff;
	c.uStreamers.value = look.streamers;
	c.uRimColor.value.copy(color(look.rim));
	c.uProminences.value = look.prominences;
}

// Shared noise: a value-noise fbm and Worley (cellular) noise, all 3D.
const NOISE = /* glsl */ `
	float sunHash(vec3 p) {
		p = fract(p * 0.3183099 + 0.1);
		p *= 17.0;
		return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
	}
	vec3 sunHash3(vec3 p) {
		return fract(sin(vec3(
			dot(p, vec3(127.1, 311.7, 74.7)),
			dot(p, vec3(269.5, 183.3, 246.1)),
			dot(p, vec3(113.5, 271.9, 124.6))
		)) * 43758.5453);
	}
	float sunNoise(vec3 x) {
		vec3 i = floor(x);
		vec3 f = fract(x);
		f = f * f * (3.0 - 2.0 * f);
		return mix(
			mix(mix(sunHash(i), sunHash(i + vec3(1, 0, 0)), f.x), mix(sunHash(i + vec3(0, 1, 0)), sunHash(i + vec3(1, 1, 0)), f.x), f.y),
			mix(mix(sunHash(i + vec3(0, 0, 1)), sunHash(i + vec3(1, 0, 1)), f.x), mix(sunHash(i + vec3(0, 1, 1)), sunHash(i + vec3(1, 1, 1)), f.x), f.y),
			f.z);
	}
	float sunFbm(vec3 p) {
		float v = 0.0;
		float a = 0.5;
		for (int i = 0; i < 5; i++) {
			v += a * sunNoise(p);
			p *= 2.03;
			a *= 0.5;
		}
		return v;
	}
	// Distances to the nearest and second-nearest cell centers (Worley F1, F2), and a
	// random value for the nearest cell (each granule is a little brighter or dimmer).
	vec3 sunCells(vec3 p) {
		vec3 i = floor(p);
		vec3 f = fract(p);
		float f1 = 8.0;
		float f2 = 8.0;
		float id = 0.0;
		for (int z = -1; z <= 1; z++) {
			for (int y = -1; y <= 1; y++) {
				for (int x = -1; x <= 1; x++) {
					vec3 o = vec3(float(x), float(y), float(z));
					vec3 r = o + sunHash3(i + o) - f;
					float d = dot(r, r);
					if (d < f1) {
						f2 = f1;
						f1 = d;
						id = sunHash(i + o + 0.5);
					} else if (d < f2) {
						f2 = d;
					}
				}
			}
		}
		return vec3(sqrt(vec2(f1, f2)), id);
	}
`;

/** A star's surface, on its sphere (local position = direction on the star, y = north). Set its look with applyStarLook. */
export function starSurfaceMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		uniforms: {
			uTime: { value: 0 },
			uOpacity: { value: 0 },
			uCore: { value: new THREE.Vector3() },
			uLimbColor: { value: new THREE.Vector3() },
			uBrightness: { value: 1 },
			uLimbDarkening: { value: 0.7 },
			uCells: { value: 90 },
			uBoil: { value: 1 },
			uMottle: { value: 1 },
			uSpots: { value: 1 },
			uFlares: { value: 1 },
			// Unused here; kept so the Sun's material answers like the other bodies' (skyBodies.ts).
			uSun: { value: new THREE.Vector3() },
			uMap: { value: null },
			uMapMix: { value: 0 },
		},
		vertexShader: /* glsl */ `
			varying vec3 vLocal;
			varying vec3 vNormalV;
			varying vec3 vViewPos;
			void main() {
				vLocal = normalize(position);
				vNormalV = normalize(normalMatrix * normal);
				vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
				vViewPos = viewPos.xyz;
				gl_Position = projectionMatrix * viewPos;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uTime;
			uniform float uOpacity;
			uniform vec3 uCore;
			uniform vec3 uLimbColor;
			uniform float uBrightness;
			uniform float uLimbDarkening;
			uniform float uCells;
			uniform float uBoil;
			uniform float uMottle;
			uniform float uSpots;
			uniform float uFlares;
			varying vec3 vLocal;
			varying vec3 vNormalV;
			varying vec3 vViewPos;
			${NOISE}
			void main() {
				vec3 p = normalize(vLocal);
				float t = uTime;

				// Slow currents carry the surface pattern along, so granules drift and reshape.
				vec3 flow = vec3(
					sunFbm(p * 3.0 + vec3(0.0, 0.0, t * 0.03)),
					sunFbm(p * 3.0 + vec3(5.2, 1.3, t * 0.03)),
					sunFbm(p * 3.0 + vec3(2.1, 7.7, t * 0.03))
				) - 0.5;
				vec3 q = p + flow * 0.12;

				// Granulation: bright cells of rising gas, dark lanes between them; two layers
				// drifting past each other keep it churning. Each cell is tiny next to the whole
				// Sun, so from afar it blurs into an even glow: it only shows once its cells are a
				// few pixels across (detail), instead of turning into grain.
				vec3 g = q * uCells;
				float detail = 1.0 - smoothstep(0.12, 0.35, length(fwidth(g)));
				// Bend the cell walls, so close up they curve like flowing gas instead of meeting in straight lines.
				g += (vec3(sunNoise(g * 0.45), sunNoise(g * 0.45 + 7.1), sunNoise(g * 0.45 + 3.3)) - 0.5) * 0.9;
				vec3 a = sunCells(g + vec3(0.0, t * 0.08, 0.0));
				vec3 b = sunCells(q * uCells * 1.55 - vec3(t * 0.05, 0.0, t * 0.04));
				float lanes = smoothstep(0.0, 0.3, a.y - a.x) * (0.75 + 0.25 * smoothstep(0.0, 0.3, b.y - b.x));
				float cores = 1.0 - smoothstep(0.0, 0.7, a.x);
				// Each granule brightens and dims as it rises and spreads.
				float glow = 0.8 + 0.35 * fract(a.z + t * 0.05 * (0.5 + a.z));
				float granules = mix(0.82, mix(0.82, (0.38 + 0.45 * lanes + 0.2 * cores) * glow, uBoil), detail);
				// Seen closer still, finer churning texture within the cells (again only once it's
				// big enough on screen to show).
				vec3 fine = g * 7.0;
				float fineDetail = 1.0 - smoothstep(0.12, 0.35, length(fwidth(fine)));
				if (fineDetail > 0.0) {
					vec3 f = sunCells(fine - vec3(t * 0.2, t * 0.12, 0.0));
					float texture = 0.86 + 0.2 * smoothstep(0.0, 0.3, f.y - f.x) + 0.12 * (sunFbm(fine * 0.5 + t * 0.1) - 0.5);
					granules *= mix(1.0, texture, fineDetail * min(1.0, uBoil));
				}
				// Larger, slower mottling (supergranulation), always visible.
				float mottling = mix(1.0, 0.82 + 0.36 * sunFbm(q * 7.0 + vec3(0.0, t * 0.01, 0.0)), uMottle);
				float surface = granules * mottling;

				// Active regions in the sunspot belts (about 5° to 35° from the equator).
				float lat = abs(p.y);
				float belt = smoothstep(0.08, 0.18, lat) * (1.0 - smoothstep(0.45, 0.6, lat));
				float activity = sunFbm(p * 2.3 + vec3(3.0, 1.0, t * 0.004)) * belt;
				float spots = sunFbm(p * 9.0 + vec3(1.7, 4.2, t * 0.006));
				// More spot coverage = active regions start at a lower threshold.
				float region = smoothstep(0.6 - 0.08 * uSpots, 0.68 - 0.08 * uSpots, activity) * step(0.01, uSpots);
				float penumbra = smoothstep(0.58, 0.63, spots) * region;
				float umbra = smoothstep(0.65, 0.69, spots) * region;
				// Faculae: bright patches around active regions, standing out toward the limb.
				float faculae = smoothstep(0.45, 0.55, activity) * (1.0 - penumbra) * min(1.0, uSpots);
				// Flares: sudden, brief brightenings in active regions, each patch on its own schedule.
				vec3 cell = floor(p * 7.0);
				float phase = sunHash(cell + 11.0);
				float pulse = pow(max(0.0, sin(t * (0.25 + 0.2 * phase) + phase * 40.0)), 80.0);
				float flare = uFlares * pulse * region * (1.0 - umbra) * smoothstep(0.62, 0.8, sunFbm(p * 14.0 + phase * 10.0));

				// Limb darkening: the edge is cooler, dimmer and redder (we see less deep there).
				vec3 n = normalize(vNormalV);
				float mu = clamp(dot(n, normalize(-vViewPos)), 0.0, 1.0);
				float limb = 1.0 - uLimbDarkening * (1.0 - pow(mu, 0.55));
				vec3 color = mix(uLimbColor, uCore, pow(mu, 0.5)) * surface * limb * uBrightness;
				// Penumbra filaments, then the dark umbra.
				color *= 1.0 - penumbra * (0.5 + 0.1 * sunFbm(p * 80.0));
				color = mix(color, vec3(0.08, 0.02, 0.0) * limb, umbra * 0.85);
				color += vec3(1.0, 0.7, 0.35) * faculae * 0.35 * (1.0 - mu);
				color += vec3(1.0, 0.92, 0.75) * flare * 1.8;
				gl_FragColor = vec4(color, uOpacity);
				#include <colorspace_fragment>
			}
		`,
	});
}

/**
 * The corona, chromosphere and prominences: a square facing the viewer, centered on
 * the Sun, reaching CORONA_EXTENT solar radii out; the disk itself is left clear for
 * the surface. Added light (additive), and it sits at the Sun's depth, so the Moon
 * covers it: a total eclipse shows the corona around the Moon.
 */
export const CORONA_EXTENT = 4;
// How far behind its star the corona is drawn (scene units; see the corona's vertex shader).
const CORONA_DEPTH_OFFSET = 0.5;

export function starCoronaMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		uniforms: {
			uTime: { value: 0 },
			uOpacity: { value: 0 },
			uCoronaColor: { value: new THREE.Vector3() },
			uCoronaStrength: { value: 1 },
			uCoronaFalloff: { value: 3.2 },
			uStreamers: { value: 0.65 },
			uRimColor: { value: new THREE.Vector3() },
			uProminences: { value: 1 },
			uRadius: { value: 1 }, // the Sun's radius, scene units
		},
		vertexShader: /* glsl */ `
			uniform float uRadius;
			varying vec2 vPlane; // position around the Sun, in solar radii
			void main() {
				vPlane = position.xy * ${CORONA_EXTENT.toFixed(2)};
				// A billboard: the star's center in view space, offset across the screen. Set a
				// little behind the star (scaled up to match, so it looks the same size): zoomed
				// far in, the whole star spans less depth than the depth buffer can tell apart,
				// and level with its center the halo would flicker against the star's edge. Still
				// well behind the Moon, which covers it in an eclipse.
				vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
				float distance = -center.z;
				center.z -= ${CORONA_DEPTH_OFFSET.toFixed(2)};
				center.xy += vPlane * uRadius * (distance + ${CORONA_DEPTH_OFFSET.toFixed(2)}) / distance;
				gl_Position = projectionMatrix * center;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uTime;
			uniform float uOpacity;
			uniform vec3 uCoronaColor;
			uniform float uCoronaStrength;
			uniform float uCoronaFalloff;
			uniform float uStreamers;
			uniform vec3 uRimColor;
			uniform float uProminences;
			varying vec2 vPlane;
			${NOISE}
			void main() {
				float r = length(vPlane);
				if (r < 0.995) discard; // the disk is the surface's
				float angle = atan(vPlane.y, vPlane.x);
				float h = r - 1.0; // height above the surface, solar radii
				vec2 around = vec2(cos(angle), sin(angle));
				float t = uTime;

				// Corona: a soft glow with faint streamers that slowly shift.
				float streamers = mix(1.0, 0.3 + 0.7 * sunFbm(vec3(around * 3.0, t * 0.02 + h * 0.6)), uStreamers);
				float corona = (exp(-h * uCoronaFalloff) * 0.5 * streamers + exp(-h * 14.0) * 0.55) * uCoronaStrength;
				// Chromosphere: a thin red rim right at the edge.
				float rim = exp(-h * 70.0);

				// Prominences: arcs of plasma standing off the limb. Each lives about 40 s,
				// rising and fading, then reappears somewhere else.
				float prominence = 0.0;
				for (int i = 0; i < 7; i++) {
					if (uProminences <= 0.0) break;
					float fi = float(i);
					float age = t / 40.0 + fi * 0.37;
					float life = sin(3.14159 * fract(age));
					float id = floor(age);
					float where = sunHash(vec3(fi, id, 3.0)) * 6.28318;
					float width = 0.1 + 0.22 * sunHash(vec3(fi, id, 7.0));
					float tall = (0.06 + 0.22 * sunHash(vec3(fi, id, 9.0))) * (0.5 + 0.7 * life);
					float da = atan(sin(angle - where), cos(angle - where)) / width;
					// Fade out softly toward the ends: a hard cutoff would show as a straight line
					// pointing at the Sun's center.
					float ends = 1.0 - smoothstep(0.6, 1.0, abs(da));
					if (ends > 0.0) {
						// An arch (a half ellipse), its plasma lumpy and flickering.
						float arch = tall * sqrt(max(0.0, 1.0 - da * da));
						float lumpy = 0.5 + 0.5 * sunFbm(vec3(da * 4.0 + fi, h * 30.0, t * 0.4));
						float thick = 0.01 + 0.025 * lumpy;
						prominence += exp(-abs(h - arch) / thick) * life * lumpy * smoothstep(0.0, 0.004, h) * ends;
						// Some spray straight up off the limb, like an eruption.
						prominence += 0.35 * exp(-h / max(0.001, tall)) * exp(-abs(da) * 6.0) * life * lumpy * ends;
					}
				}

				vec3 color = uCoronaColor * corona + uRimColor * (rim * 1.1 + prominence * 1.3 * uProminences);
				// Fade to exactly nothing well before the square's edge: even a faint glow, brightened
				// on its way to the screen, would otherwise show the square's outline.
				float edge = 1.0 - smoothstep(${(CORONA_EXTENT * 0.55).toFixed(2)}, ${(CORONA_EXTENT * 0.95).toFixed(2)}, r);
				gl_FragColor = vec4(color * uOpacity * edge, 1.0);
				#include <colorspace_fragment>
			}
		`,
	});
}
