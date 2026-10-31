// Supernovae and gamma-ray bursts in the sky view (cosmos.ts), each a point of
// light at its place in the sky that brightens and fades along its real light
// curve (transients.ts) as the sky's clock runs. Bright ones get a glare and four
// diffraction spikes, like the brightest stars through a telescope. A burst's gamma
// rays, invisible to the eye, show as a flickering violet glow (false color).
//
// None of them has a size anyone could see: a supernova near its peak is a fireball
// about a light-day across, a few hundred-thousandths of an arcsecond from thousands
// of light-years away, and a burst billions of light-years off is smaller still. So
// what's drawn is glare, sized by brightness and growing with the zoom the way the
// stars' does; the gamma glow, a depiction rather than anything seen, spans a
// fixed patch of sky (GAMMA_DEGREES), so it grows with the zoom like a nebula.
import * as THREE from 'three';
import { transients, type Transient } from '../data/transients';
import { transientState, type TransientState } from './transients';
import { equatorialVector } from './sky';

// The glow for a magnitude, sized as the sky view sizes stars and planets (cosmos.ts:
// 2.3 - 0.35 × magnitude, in eightieths of the screen's height), so a supernova
// as bright as Venus looks as big as Venus. Like theirs it's exaggerated: real
// glare around a bright point is under a degree. Brighter than Venus (whose glow
// tops out at 3.4) it can grow only a little more, to GLOW_MAX: SN 1006, the
// brightest ever recorded, ends up about a third bigger than Venus, not a blob.
const GLOW_MAX = 4.4;
function glowPx(mag: number, heightPx: number): number {
	return (Math.min(GLOW_MAX, Math.max(0.8, 2.3 - 0.35 * mag)) * heightPx) / 80;
}
// The gamma-ray glow at full strength: its width on the sky (degrees), and on screen
// at least GAMMA_MIN_PX (CSS pixels) so it can be seen zoomed all the way out.
const GAMMA_DEGREES = 6;
const GAMMA_MIN_PX = 60;
// Magnifications over which glare grows into a close-up, as the stars' does (cosmos.ts STAR_DETAIL_ZOOM).
const CLOSE_UP_ZOOM = [4, 16];

/** How much bigger glare is drawn at a magnification, matching the stars'. */
function closeUp(zoom: number): number {
	const t = Math.min(1, Math.max(0, (zoom - CLOSE_UP_ZOOM[0]) / (CLOSE_UP_ZOOM[1] - CLOSE_UP_ZOOM[0])));
	const detail = t * t * (3 - 2 * t);
	return (1 + 2.5 * detail) * Math.max(zoom / CLOSE_UP_ZOOM[1], 1) ** (0.45 * detail);
}

export interface SkyTransient {
	transient: Transient;
	dir: THREE.Vector3; // unit vector, celestial frame
	state: TransientState;
}

export interface SkyTransients {
	object: THREE.Group; // add it to the celestial sphere group
	events: SkyTransient[];
	/**
	 * Each frame: brightness for the moment, faded by opacity. limit is the faintest
	 * magnitude the view can show at its zoom; view gives the magnification, the
	 * screen's pixels per radian of sky, and its height (CSS pixels).
	 */
	update(date: Date, opacity: number, limit: number, view: { zoom: number; pxPerRadian: number; heightPx: number }): void;
}

function transientMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending, // light adds up on the dark sky
		uniforms: {
			uSize: { value: 0 }, // width, in the celestial sphere's units
			uColor: { value: new THREE.Color() },
			uBright: { value: 0 }, // the visible light, 0-1
			uLight: { value: 1 }, // the visible light's size, as a share of the whole (the gamma glow can be bigger)
			uSpikes: { value: 0 }, // diffraction spikes, 0-1 (only very bright ones)
			uGamma: { value: 0 }, // gamma rays, 0-1
			uTime: { value: 0 },
		},
		// A square facing the viewer, centered on the object (the mesh's position), uSize wide.
		vertexShader: /* glsl */ `
			uniform float uSize;
			varying vec2 vP;
			void main() {
				vP = position.xy * 2.0;
				vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
				gl_Position = projectionMatrix * (center + vec4(position.xy * uSize, 0.0, 0.0));
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			uniform float uBright;
			uniform float uLight;
			uniform float uSpikes;
			uniform float uGamma;
			uniform float uTime;
			varying vec2 vP;
			void main() {
				vec2 p = vP;
				float r = length(p);
				if (r > 1.0) discard;
				// The visible light: a white-hot core in a glare of its color, with spikes.
				vec2 q = p / uLight;
				float rl = length(q);
				float core = exp(-rl * rl * 260.0);
				float glare = exp(-rl * 9.0) * 0.55 + exp(-rl * 3.5) * 0.12;
				float spikes = (exp(-abs(q.x) * 70.0) + exp(-abs(q.y) * 70.0)) * max(0.0, 1.0 - rl) * uSpikes * 0.5;
				vec3 light = (vec3(core) + uColor * (glare + spikes)) * uBright * (1.0 - smoothstep(0.8, 1.0, rl));
				// The gamma rays: a flickering violet glow, in false color.
				float flicker = 0.75 + 0.25 * sin(uTime * 23.0) * sin(uTime * 7.3 + 1.0);
				float halo = exp(-r * 4.0) * 0.8 + exp(-pow((r - 0.45) / 0.12, 2.0)) * 0.25;
				vec3 gamma = vec3(0.62, 0.38, 1.0) * halo * uGamma * flicker;
				gl_FragColor = vec4((light + gamma) * (1.0 - smoothstep(0.8, 1.0, r)), 1.0);
				#include <colorspace_fragment>
			}
		`,
	});
}

export function createTransients(distance: number): SkyTransients {
	const object = new THREE.Group();
	const parts = transients.map((transient) => {
		const dir = new THREE.Vector3(...equatorialVector(transient.ra, transient.dec));
		const material = transientMaterial();
		const point = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
		point.position.copy(dir).multiplyScalar(distance);
		point.frustumCulled = false; // a billboard: sized in its shader
		point.visible = false;
		object.add(point);
		const event: SkyTransient = { transient, dir, state: transientState(transient, new Date()) };
		return { event, point, material };
	});

	return {
		object,
		events: parts.map((p) => p.event),
		update(date, opacity, limit, view) {
			const seconds = performance.now() / 1000;
			for (const { event, point, material } of parts) {
				const state = (event.state = transientState(event.transient, date));
				// Fading out over the last magnitude the view can reach.
				const bright = state.mag === null ? 0 : Math.min(1, Math.max(0, limit - state.mag));
				const gamma = state.gamma;
				point.visible = opacity > 0.01 && (bright > 0.01 || gamma > 0.01);
				if (!point.visible) continue;
				// Sizes on screen (CSS pixels), kept within a few screens.
				const lightPx = state.mag === null ? 0 : Math.min(glowPx(state.mag, view.heightPx) * closeUp(view.zoom), view.heightPx * 0.8);
				const gammaPx = Math.max(GAMMA_MIN_PX, THREE.MathUtils.degToRad(GAMMA_DEGREES) * view.pxPerRadian) * Math.sqrt(gamma);
				const size = Math.max(lightPx, Math.min(gammaPx, view.heightPx * 3));
				const u = material.uniforms;
				u.uSize.value = (size / view.pxPerRadian) * distance;
				u.uLight.value = Math.max(0.01, lightPx / size);
				u.uColor.value.setRGB(...state.color);
				// Brighter than a few points of magnitude: full strength; the glow's size carries the rest.
				u.uBright.value = bright * opacity;
				u.uSpikes.value = state.mag === null ? 0 : Math.min(1, Math.max(0, (1 - state.mag) / 4));
				u.uGamma.value = gamma * opacity;
				u.uTime.value = seconds;
			}
		},
	};
}
