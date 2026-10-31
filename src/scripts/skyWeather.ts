// Live weather for the planets with the most atmospheric motion (skyBodies.ts):
// Jupiter, Saturn, Uranus, Neptune and Venus. Their real surface maps are drawn
// moving, not still:
// - Jet streams: each latitude band slides around the planet at its own speed, so
//   neighboring bands shear past each other (the alternating jets of the gas giants).
// - Eddies: a slowly changing swirl field (the curl of a noise "stream function")
//   curls the clouds, most strongly where bands shear.
// - Extras: Saturn's north-polar hexagon, Uranus's bright storms, Neptune's fast
//   white cirrus streaks, and Venus's cloud deck racing around the planet faster at
//   the equator than near the poles, shearing into sideways V shapes.
// Speeds are stylized to be watched in real time (real jets would look frozen at
// this scale), and run on the real clock, like the stars' simulations.
import type { BodyName } from './ephemeris';

interface Weather {
	jets: number; // jet streams from pole to pole (bands of alternating flow)
	jetSpeed: number; // how fast the jets run (map widths per second)
	equatorJet: number; // an extra jet along the equator (negative = backward)
	swirlScale: number; // size of eddies (bigger = smaller eddies)
	swirl: number; // how strongly eddies curl the clouds
	evolve: number; // how fast the eddies change
	venus?: boolean; // Venus: the whole cloud deck races backward, fastest at the equator
	extras?: string; // GLSL added after the map is drawn (color, uv, lat, t in scope)
}

const WEATHER: Partial<Record<BodyName, Weather>> = {
	Jupiter: { jets: 14, jetSpeed: 0.0025, equatorJet: 1.5, swirlScale: 9, swirl: 0.006, evolve: 0.04 },
	Saturn: {
		jets: 9,
		jetSpeed: 0.0015,
		equatorJet: 3,
		swirlScale: 6,
		swirl: 0.004,
		evolve: 0.02,
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
		// Bright white cirrus: high clouds stretched out along the fastest winds in the solar system.
		extras: /* glsl */ `
			{
				float belt = smoothstep(0.25, 0.4, abs(lat)) * (1.0 - smoothstep(0.75, 0.95, abs(lat)));
				float lon = uv.x * 6.28318 - t * 0.08;
				float streaks = smoothstep(0.6, 0.72, fbm(vec3(cos(lon) * 1.5, sin(lon) * 1.5, lat * 20.0 + t * 0.02)));
				color += vec3(0.9, 0.95, 1.0) * streaks * belt * 0.7;
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
		// Faint darker streaks in the cloud deck (seen strongly in ultraviolet).
		extras: /* glsl */ `
			color *= 0.9 + 0.12 * fbm(vec3(uv.x * 12.0, lat * 6.0, t * 0.02));
		`,
	},
};

export function hasWeather(name: BodyName): boolean {
	return name in WEATHER;
}

/**
 * GLSL for a planet's weather: weatherUv(uv) moves where the map is read from, and
 * weatherColor(color, uv) adds the extras. Needs uniform uTime (seconds) and fbm
 * (skyBodies.ts NOISE) in scope. Planets without weather get pass-throughs.
 */
export function weatherGlsl(name: BodyName): string {
	const w = WEATHER[name];
	if (!w) {
		return /* glsl */ `
			vec2 weatherUv(vec2 uv) { return uv; }
			vec3 weatherColor(vec3 color, vec2 uv) { return color; }
		`;
	}
	const f = (n: number) => n.toFixed(5);
	return /* glsl */ `
		uniform float uTime;
		// The stream function: its curl is the eddies' flow.
		float weatherStream(float lat, float lon, float t) {
			vec3 p = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon)) * ${f(w.swirlScale)};
			return fbm(p + vec3(0.0, 0.0, t * ${f(w.evolve)}));
		}
		vec2 weatherUv(vec2 uv) {
			float t = uTime;
			float lat = (uv.y - 0.5) * 3.14159;
			float cl = max(cos(lat), 0.15);
			// Jet streams: each latitude drifts at its own speed.
			${
				w.venus
					? `float drift = -0.012 * cos(lat) * cos(lat); // Venus: the whole deck, fastest at the equator`
					: `float drift = ${f(w.jetSpeed)} * (sin(lat * ${f(w.jets)}) + ${f(w.equatorJet)} * exp(-lat * lat * 30.0));`
			}
			uv.x += drift * t;
			// Eddies: swirl along the curl of the stream function, strongest where bands shear.
			float lon = uv.x * 6.28318;
			float e = 0.01;
			float s = weatherStream(lat, lon, t);
			float dLat = (weatherStream(lat + e, lon, t) - s) / e;
			float dLon = (weatherStream(lat, lon + e / cl, t) - s) / e;
			float shear = ${w.venus ? '1.0' : `0.4 + 0.6 * abs(cos(lat * ${f(w.jets)}))`};
			uv += vec2(dLat / (6.28318 * cl), -dLon / 3.14159) * ${f(w.swirl)} * shear * cos(lat);
			return uv;
		}
		vec3 weatherColor(vec3 color, vec2 uv) {
			float t = uTime;
			float lat = (uv.y - 0.5) * 3.14159;
			${w.extras ?? ''}
			return color;
		}
	`;
}
