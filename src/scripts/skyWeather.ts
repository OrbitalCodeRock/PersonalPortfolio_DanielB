// Live weather for the planets with the most atmospheric motion (skyBodies.ts):
// Jupiter, Saturn, Uranus, Neptune and Venus. Their real surface maps are drawn
// moving, and color graded toward how they look in photographs:
// - Jet streams: each latitude band flows around the planet at its own speed, so
//   neighboring bands shear past each other (the alternating jets of the gas giants).
// - Storms: great vortices (Jupiter's Great Red Spot, Neptune's Great Dark Spot)
//   turn in place, sheltered from the jets around them.
// - Eddies: a slowly changing swirl field (the curl of a noise "stream function")
//   curls the clouds, most strongly where bands shear.
// - The look: the maps (Solar System Scope) are paler than photographs; each planet's
//   colors, contrast and polar tint are graded toward the real thing.
// - Extras: Saturn's north-polar hexagon, Uranus's bright polar cap and storms,
//   Neptune's fast white cirrus streaks, and Venus's cloud deck racing around the
//   planet faster at the equator than near the poles.
// Moving a map along a flow forever would shear it into streaks, so the flow is
// drawn the way animated water is: two copies of the map, each carried along the
// flow for a short cycle (FLOW_CYCLE) and then reset, cross-fading so that one is
// always mid-cycle. Speeds are stylized to be watched in real time (real jets
// would look frozen at this scale), and run on the real clock, like the stars'.
import type { BodyName } from './ephemeris';

type Rgb = [number, number, number];

interface Look {
	saturation: number; // 1 = the map's own
	contrast: number; // 1 = the map's own (around mid-gray)
	gamma: Rgb; // per channel: below 1 lifts a channel, above 1 deepens it
	tint?: Rgb; // multiplies the result
	// Toward the poles, past this latitude (radians), the color shifts toward polarColor
	// (keeping the map's light and shade); northOnly for one pole.
	polarFrom?: number;
	polarColor?: Rgb;
	polarAmount?: number;
	northOnly?: boolean;
}

interface Vortex {
	at: [number, number]; // center on the map (u from the left edge, v from the bottom)
	size: [number, number]; // half-width and half-height on the map
	spin: number; // radians per second (positive = counterclockwise on the map)
	tint?: Rgb; // multiplies its clouds' color (keeping the map's own rim and core)
}

interface Weather {
	jets: number; // jet streams from pole to pole (bands of alternating flow)
	jetSpeed: number; // how fast the jets run (map widths per second)
	equatorJet: number; // an extra jet along the equator (negative = backward)
	swirlScale: number; // size of eddies (bigger = smaller eddies)
	swirl: number; // how strongly eddies curl the clouds
	evolve: number; // how fast the eddies change
	look: Look;
	vortices?: Vortex[];
	venus?: boolean; // Venus: the whole cloud deck races backward, fastest at the equator
	extras?: string; // GLSL run on the finished color (color, uv, src, lat, t in scope)
}

// Seconds each copy of the map is carried along the flow before it resets.
const FLOW_CYCLE = 6;

const WEATHER: Partial<Record<BodyName, Weather>> = {
	Jupiter: {
		jets: 14,
		jetSpeed: 0.0025,
		equatorJet: 1.5,
		swirlScale: 9,
		swirl: 0.006,
		evolve: 0.04,
		// Photographs (Cassini, Voyager): white and cream zones with blue-gray festoons,
		// soft brown belts, beige-gray poles.
		look: {
			saturation: 0.9,
			contrast: 1.12,
			gamma: [0.95, 0.94, 0.9],
			polarFrom: 0.8,
			polarColor: [0.72, 0.68, 0.64],
			polarAmount: 0.45,
		},
		// The Great Red Spot: a storm bigger than Earth, turning counterclockwise.
		// In photographs: a peach-salmon oval, darker orange at its rim, in a pale "hollow".
		vortices: [{ at: [0.365, 0.395], size: [0.024, 0.024], spin: 0.12, tint: [1.05, 0.9, 0.8] }],
	},
	Saturn: {
		jets: 9,
		jetSpeed: 0.0015,
		equatorJet: 3,
		swirlScale: 6,
		swirl: 0.004,
		evolve: 0.02,
		// Photographs (Cassini): pale butterscotch, with soft bands.
		look: { saturation: 0.95, contrast: 1.15, gamma: [0.95, 0.96, 1.0] },
		// The hexagon: a six-sided jet stream around the north pole, at about 78°N,
		// slowly turning, a little bluer inside.
		extras: /* glsl */ `
			{
				float fromPole = 1.5708 - lat;
				float angle = uv.x * 6.28318 + t * 0.02;
				float hex = 0.2 / cos(mod(angle, 1.0472) - 0.5236);
				float edge = exp(-pow((fromPole - hex) / 0.012, 2.0));
				float inside = 1.0 - smoothstep(hex - 0.01, hex + 0.01, fromPole);
				color = mix(color, color * vec3(0.82, 0.9, 1.05), inside * 0.4);
				color = mix(color, color * vec3(0.78, 0.84, 0.95), edge * 0.6);
			}
		`,
	},
	Uranus: {
		jets: 5,
		jetSpeed: 0.0012,
		equatorJet: -0.5,
		swirlScale: 4,
		swirl: 0.003,
		evolve: 0.02,
		// Photographs: pale cyan, nearly featureless, with a bright cap over the pole
		// turned toward the Sun (the north, these years).
		look: {
			saturation: 0.95,
			contrast: 1.1,
			gamma: [1.05, 1.0, 1.0],
			polarFrom: 0.9,
			polarColor: [0.93, 0.98, 0.98],
			polarAmount: 0.5,
			northOnly: true,
		},
		// Occasional bright storms drifting through the mid-latitudes.
		extras: /* glsl */ `
			{
				float belt = smoothstep(0.2, 0.35, abs(lat)) * (1.0 - smoothstep(0.65, 0.8, abs(lat)));
				float lon = uv.x * 6.28318 - t * 0.03;
				float storms = smoothstep(0.66, 0.74, fbm(vec3(cos(lon) * 2.0, sin(lon) * 2.0, lat * 8.0 + t * 0.01)));
				color += vec3(0.75, 0.95, 0.95) * storms * belt * 0.35;
			}
		`,
	},
	Neptune: {
		jets: 4,
		jetSpeed: 0.004,
		equatorJet: -1,
		swirlScale: 6,
		swirl: 0.008,
		evolve: 0.05,
		// Voyager 2's photographs: deep azure, with darker bands.
		look: { saturation: 0.85, contrast: 1.1, gamma: [1.0, 0.97, 0.95] },
		// The Great Dark Spot, turning counterclockwise with its bright companion clouds.
		vortices: [{ at: [0.555, 0.42], size: [0.055, 0.03], spin: 0.15 }],
		// Bright white cirrus: high clouds stretched out along the fastest winds in the solar system.
		extras: /* glsl */ `
			{
				float belt = smoothstep(0.25, 0.4, abs(lat)) * (1.0 - smoothstep(0.75, 0.95, abs(lat)));
				float lon = uv.x * 6.28318 - t * 0.08;
				float streaks = smoothstep(0.6, 0.72, fbm(vec3(cos(lon) * 1.5, sin(lon) * 1.5, lat * 20.0 + t * 0.02)));
				color += vec3(0.9, 0.95, 1.0) * streaks * belt * 0.6;
			}
		`,
	},
	Venus: {
		jets: 0,
		jetSpeed: 0,
		equatorJet: 0,
		swirlScale: 5,
		swirl: 0.008,
		evolve: 0.03,
		venus: true,
		// In visible light Venus is a soft, bright cream; its cloud markings (strong in
		// ultraviolet, as in the map) only faintly show.
		look: { saturation: 0.6, contrast: 0.55, gamma: [0.82, 0.85, 0.98], tint: [1.05, 1.02, 0.94] },
		// Faint darker streaks in the cloud deck.
		extras: /* glsl */ `
			color *= 0.95 + 0.07 * fbm(vec3(src.x * 12.0, lat * 6.0, t * 0.02));
		`,
	},
};

export function hasWeather(name: BodyName): boolean {
	return name in WEATHER;
}

const glslVec = ([r, g, b]: Rgb) => `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
const f = (n: number) => n.toFixed(5);

/**
 * GLSL for a planet's map: vec3 planetMap(sampler2D map, vec2 uv) reads the map
 * at uv, moving with the planet's weather and graded toward photographs. Needs
 * uniform uTime (seconds) and fbm (skyBodies.ts NOISE) in scope. Planets without
 * weather read the map as it is.
 */
export function weatherGlsl(name: BodyName): string {
	const w = WEATHER[name];
	if (!w) return /* glsl */ `vec3 planetMap(sampler2D map, vec2 uv) { return texture2D(map, uv).rgb; }`;
	const { look } = w;
	const vortices = w.vortices ?? [];

	// Each vortex: how far a map point is from its center (1 = its edge), and its flow there.
	const vortexGlsl = vortices
		.map(
			(v, i) => /* glsl */ `
		float vortexR${i}(vec2 uv) {
			vec2 q = vec2(uv.x - ${f(v.at[0])} - floor(uv.x - ${f(v.at[0])} + 0.5), uv.y - ${f(v.at[1])}) / vec2(${f(v.size[0])}, ${f(v.size[1])});
			return length(q);
		}
		vec2 vortexFlow${i}(vec2 uv) {
			vec2 q = vec2(uv.x - ${f(v.at[0])} - floor(uv.x - ${f(v.at[0])} + 0.5), uv.y - ${f(v.at[1])}) / vec2(${f(v.size[0])}, ${f(v.size[1])});
			// Turning as a solid core, slowing to nothing past its edge.
			float spin = ${f(v.spin)} * (1.0 - smoothstep(0.6, 1.4, length(q)));
			return vec2(-q.y * ${f(v.size[0])}, q.x * ${f(v.size[1])}) * spin;
		}`,
		)
		.join('\n');
	// The jets go around a vortex, not through it.
	const calm = vortices.length ? vortices.map((_, i) => `smoothstep(1.0, 2.2, vortexR${i}(uv))`).join(' * ') : '1.0';
	const vortexFlow = vortices.map((_, i) => ` + vortexFlow${i}(uv)`).join('');
	const vortexColor = vortices
		.map((v, i) =>
			v.tint ? /* glsl */ `color *= mix(vec3(1.0), ${glslVec(v.tint)}, 1.0 - smoothstep(0.7, 1.15, vortexR${i}(src)));` : '',
		)
		.join('\n');
	const polar =
		look.polarFrom !== undefined
			? /* glsl */ `
				float polar = smoothstep(${f(look.polarFrom)}, ${f(look.polarFrom + 0.35)}, ${look.northOnly ? 'lat' : 'abs(lat)'});
				color = mix(color, ${glslVec(look.polarColor!)} * (0.45 + 0.9 * luma), polar * ${f(look.polarAmount ?? 0.5)});`
			: '';

	return /* glsl */ `
		uniform float uTime;
		${vortexGlsl}
		// The stream function: its curl is the eddies' flow.
		float weatherStream(float lat, float lon, float t) {
			vec3 p = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon)) * ${f(w.swirlScale)};
			return fbm(p + vec3(0.0, 0.0, t * ${f(w.evolve)}));
		}
		// The flow at a point on the map (map widths and heights per second).
		vec2 weatherFlow(vec2 uv) {
			float lat = (uv.y - 0.5) * 3.14159;
			${
				w.venus
					? `// Venus: on top of the whole deck's turning (see planetMap), faster at the equator.
			float drift = -0.012 * (cos(lat) * cos(lat) - 0.6);`
					: `float drift = ${f(w.jetSpeed)} * (sin(lat * ${f(w.jets)}) + ${f(w.equatorJet)} * exp(-lat * lat * 30.0));`
			}
			return vec2(drift * ${calm}, 0.0)${vortexFlow};
		}
		// Eddies: where on the map the clouds curl in from (an offset that comes and goes, not a flow).
		vec2 weatherEddies(vec2 uv, float t) {
			float lat = (uv.y - 0.5) * 3.14159;
			float cl = max(cos(lat), 0.15);
			float lon = uv.x * 6.28318;
			float e = 0.01;
			float s = weatherStream(lat, lon, t);
			float dLat = (weatherStream(lat + e, lon, t) - s) / e;
			float dLon = (weatherStream(lat, lon + e / cl, t) - s) / e;
			float shear = ${w.venus ? '1.0' : `0.4 + 0.6 * abs(cos(lat * ${f(w.jets)}))`};
			return vec2(dLat / (6.28318 * cl), -dLon / 3.14159) * ${f(w.swirl)} * shear * cos(lat) * ${calm};
		}
		vec3 planetMap(sampler2D map, vec2 uv) {
			float t = uTime;
			float lat = (uv.y - 0.5) * 3.14159;
			${w.venus ? 'uv.x -= 0.007 * t; // the whole cloud deck turns backward, every few minutes here' : ''}
			// Two copies of the map carried along the flow, each for FLOW_CYCLE seconds, half a cycle apart.
			vec2 here = uv + weatherEddies(uv, t);
			vec2 flow = weatherFlow(uv);
			float phase = fract(t / ${f(FLOW_CYCLE)});
			float phase2 = fract(phase + 0.5);
			vec2 src = here - flow * phase * ${f(FLOW_CYCLE)};
			vec2 src2 = here - flow * phase2 * ${f(FLOW_CYCLE)};
			// Each fades out as it resets (phase 0), while the other is mid-cycle.
			float blend = abs(1.0 - 2.0 * phase);
			vec3 color = mix(texture2D(map, src).rgb, texture2D(map, src2).rgb, blend);
			src = mix(src, src2, blend);

			// Graded toward photographs.
			color = pow(max(color, 0.0), ${glslVec(look.gamma)});
			float luma = dot(color, vec3(0.299, 0.587, 0.114));
			color = mix(vec3(luma), color, ${f(look.saturation)});
			color = (color - 0.5) * ${f(look.contrast)} + 0.5;
			${look.tint ? `color *= ${glslVec(look.tint)};` : ''}
			color = clamp(color, 0.0, 1.0);
			luma = dot(color, vec3(0.299, 0.587, 0.114));
			${polar}
			${vortexColor}
			${w.extras ?? ''}
			return clamp(color, 0.0, 1.0);
		}
	`;
}
