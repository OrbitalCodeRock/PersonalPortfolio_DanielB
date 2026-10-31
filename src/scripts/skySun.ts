// The Sun up close in the sky view (skyBodies.ts): a live simulation rather than a
// picture. Its surface churns with granulation (convection cells of hot gas welling
// up, with darker lanes where cooler gas sinks), slowly drifting and reshaping;
// sunspots (dark umbrae ringed by lighter penumbrae) gather in the mid-latitude bands
// where real ones appear, with bright faculae around them toward the limb; and flares
// flash now and then in those active regions. Around the edge, a corona with faint
// streamers, the thin red chromosphere, and prominences: arcs of glowing plasma that
// rise off the limb, flicker, and fade. Everything moves in real time, so it's alive
// even with the sky's clock paused. Drawn in view space for precision, like the
// other bodies.
import * as THREE from 'three';

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

/** The Sun's surface, on its sphere (local position = direction on the Sun, y = north). */
export function sunSurfaceMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		uniforms: {
			uTime: { value: 0 },
			uOpacity: { value: 0 },
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
				vec3 g = q * 90.0;
				float detail = 1.0 - smoothstep(0.12, 0.35, length(fwidth(g)));
				vec3 a = sunCells(g + vec3(0.0, t * 0.08, 0.0));
				vec3 b = sunCells(q * 140.0 - vec3(t * 0.05, 0.0, t * 0.04));
				float lanes = smoothstep(0.0, 0.3, a.y - a.x) * (0.75 + 0.25 * smoothstep(0.0, 0.3, b.y - b.x));
				float cores = 1.0 - smoothstep(0.0, 0.7, a.x);
				// Each granule brightens and dims as it rises and spreads.
				float glow = 0.8 + 0.35 * fract(a.z + t * 0.05 * (0.5 + a.z));
				float granules = mix(0.82, (0.38 + 0.45 * lanes + 0.2 * cores) * glow, detail);
				// Larger, slower mottling (supergranulation), always visible.
				float mottling = 0.82 + 0.36 * sunFbm(q * 7.0 + vec3(0.0, t * 0.01, 0.0));
				float surface = granules * mottling;

				// Active regions in the sunspot belts (about 5° to 35° from the equator).
				float lat = abs(p.y);
				float belt = smoothstep(0.08, 0.18, lat) * (1.0 - smoothstep(0.45, 0.6, lat));
				float activity = sunFbm(p * 2.3 + vec3(3.0, 1.0, t * 0.004)) * belt;
				float spots = sunFbm(p * 9.0 + vec3(1.7, 4.2, t * 0.006));
				float region = smoothstep(0.52, 0.6, activity);
				float penumbra = smoothstep(0.58, 0.63, spots) * region;
				float umbra = smoothstep(0.65, 0.69, spots) * region;
				// Faculae: bright patches around active regions, standing out toward the limb.
				float faculae = smoothstep(0.45, 0.55, activity) * (1.0 - penumbra);
				// Flares: sudden, brief brightenings in active regions, each patch on its own schedule.
				vec3 cell = floor(p * 7.0);
				float phase = sunHash(cell + 11.0);
				float pulse = pow(max(0.0, sin(t * (0.25 + 0.2 * phase) + phase * 40.0)), 80.0);
				float flare = pulse * region * (1.0 - umbra) * smoothstep(0.62, 0.8, sunFbm(p * 14.0 + phase * 10.0));

				// Limb darkening: the edge is cooler, dimmer and redder (we see less deep there).
				vec3 n = normalize(vNormalV);
				float mu = clamp(dot(n, normalize(-vViewPos)), 0.0, 1.0);
				float limb = 1.0 - 0.72 * (1.0 - pow(mu, 0.55));
				// Colors are linear (shown brighter on screen): a yellow-white core shading to deep orange-red.
				vec3 color = mix(vec3(0.9, 0.14, 0.0), vec3(1.0, 0.6, 0.12), pow(mu, 0.5)) * surface * limb * 1.6;
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

export function sunCoronaMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		uniforms: {
			uTime: { value: 0 },
			uOpacity: { value: 0 },
			uRadius: { value: 1 }, // the Sun's radius, scene units
		},
		vertexShader: /* glsl */ `
			uniform float uRadius;
			varying vec2 vPlane; // position around the Sun, in solar radii
			void main() {
				vPlane = position.xy * ${CORONA_EXTENT.toFixed(2)};
				// A billboard: the Sun's center in view space, offset across the screen.
				vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
				center.xy += vPlane * uRadius;
				gl_Position = projectionMatrix * center;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uTime;
			uniform float uOpacity;
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
				float streamers = 0.55 + 0.45 * sunFbm(vec3(around * 3.0, t * 0.02 + h * 0.6));
				float corona = exp(-h * 3.2) * 0.5 * streamers + exp(-h * 14.0) * 0.55;
				// Chromosphere: a thin red rim right at the edge.
				float rim = exp(-h * 70.0);

				// Prominences: arcs of plasma standing off the limb. Each lives about 40 s,
				// rising and fading, then reappears somewhere else.
				float prominence = 0.0;
				for (int i = 0; i < 7; i++) {
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

				vec3 color = vec3(1.0, 0.7, 0.4) * corona + vec3(1.0, 0.2, 0.06) * (rim * 1.1 + prominence * 1.3);
				// Fade to exactly nothing well before the square's edge: even a faint glow, brightened
				// on its way to the screen, would otherwise show the square's outline.
				float edge = 1.0 - smoothstep(${(CORONA_EXTENT * 0.55).toFixed(2)}, ${(CORONA_EXTENT * 0.95).toFixed(2)}, r);
				gl_FragColor = vec4(color * uOpacity * edge, 1.0);
				#include <colorspace_fragment>
			}
		`,
	});
}
