// Loading the sky view's real images (planet maps, deep-sky and comet photos) on demand,
// and fitting photos onto the sky.
// Nothing is fetched until the telescope zooms in on something; each image is then
// downloaded once, decoded off the main thread (ImageBitmap) so the animation
// doesn't stutter, and cached for the rest of the visit.
import * as THREE from 'three';

const loader = new THREE.ImageBitmapLoader();
// Flip while decoding, so the bitmap matches WebGL's bottom-up texture rows.
loader.setOptions({ imageOrientation: 'flipY' });

const cache = new Map<string, Promise<{ texture: THREE.Texture; bitmap: ImageBitmap }>>();

/** A texture for an image in public/, loaded once. */
export function loadSkyImage(url: string): Promise<{ texture: THREE.Texture; bitmap: ImageBitmap }> {
	let pending = cache.get(url);
	if (!pending) {
		pending = loader.loadAsync(url).then((bitmap) => {
			const texture = new THREE.Texture(bitmap as ImageBitmap);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.flipY = false; // already flipped while decoding
			texture.anisotropy = 4;
			texture.needsUpdate = true;
			return { texture, bitmap: bitmap as ImageBitmap };
		});
		pending.catch(() => cache.delete(url)); // allow a retry after a failed download
		cache.set(url, pending);
	}
	return pending;
}

/**
 * Material for a photo laid over the dark sky: the photo's own sky glow is taken
 * out (uBackground, per color channel) so only the object adds light, and the
 * edges fade: the square frame's edges, or (uRound = 1) out to an ellipse, for
 * photos whose subject runs off the frame, like a comet's tail.
 */
export function photoMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			uMap: { value: null },
			uOpacity: { value: 0 },
			uBackground: { value: new THREE.Vector3() },
			uRound: { value: 0 },
		},
		vertexShader: /* glsl */ `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform sampler2D uMap;
			uniform float uOpacity;
			uniform vec3 uBackground;
			uniform float uRound;
			varying vec2 vUv;
			void main() {
				// Take out the photo's sky glow, so only the object adds light, and fade the square edges.
				vec3 color = max(texture2D(uMap, vUv).rgb - uBackground, 0.0) / (1.0 - uBackground);
				vec2 edge = min(vUv, 1.0 - vUv);
				float square = smoothstep(0.0, 0.15, edge.x) * smoothstep(0.0, 0.15, edge.y);
				float oval = 1.0 - smoothstep(0.25, 0.5, length(vUv - 0.5));
				float fade = mix(square, oval, uRound);
				gl_FragColor = vec4(color * fade * uOpacity, 1.0);
				#include <colorspace_fragment>
			}
		`,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
	});
}

/**
 * Where a photo's light is: its center (0–1 across the image), the tip of its brightest light
 * (a comet's head), the angle of its long axis (radians from the image's x axis),
 * the standard deviation of the light along that axis (as a fraction of the image's
 * long side), and the photo's sky background (linear red, green and blue).
 */
export function fitPhoto(bitmap: ImageBitmap) {
	const aspect = bitmap.width / bitmap.height;
	const w = Math.max(8, Math.round(64 * Math.min(1, aspect)));
	const h = Math.max(8, Math.round(64 * Math.min(1, 1 / aspect)));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	// The bitmap was decoded upside down for WebGL, so canvas rows run up the photo, like texture v.
	ctx.drawImage(bitmap, 0, 0, w, h);
	const pixels = ctx.getImageData(0, 0, w, h).data;
	const light = new Float32Array(w * h);
	for (let i = 0; i < w * h; i++) {
		light[i] = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255;
	}
	const background = Float32Array.from(light).sort()[Math.floor(w * h * 0.1)];
	// The sky's own color, channel by channel (a photo's sky is often tinted blue or purple).
	const level = (channel: number) => {
		const values = new Float32Array(w * h);
		for (let i = 0; i < w * h; i++) values[i] = pixels[i * 4 + channel] / 255;
		// Subtract a little less than the measured sky, so faint outer light survives.
		return 0.8 * Math.pow(values.sort()[Math.floor(w * h * 0.1)], 2.2);
	};
	const sky = new THREE.Vector3(level(0), level(1), level(2));
	let total = 0;
	let sx = 0;
	let sy = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const weight = Math.max(0, light[y * w + x] - background);
			total += weight;
			sx += weight * x;
			sy += weight * y;
		}
	}
	// The brightest spot, smoothed over 3 × 3 pixels so a single star doesn't win.
	let peak: [number, number] = [0.5, 0.5];
	let peakLight = -1;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			let sum = 0;
			for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += light[(y + dy) * w + x + dx];
			if (sum > peakLight) {
				peakLight = sum;
				peak = [(x + 0.5) / w, (y + 0.5) / h];
			}
		}
	}
	if (total <= 0) return { aspect, center: [0.5, 0.5] as [number, number], peak, angle: Math.PI / 2, spread: 0.25, background: sky };
	// A comet's head: bright light saturates a patch reaching up the tail, so take the
	// tip of the bright patch around the brightest spot, on the side away from the
	// center of light (staying near the spot, so a bright star can't be taken instead).
	const [px, py] = [peak[0] * w - 0.5, peak[1] * h - 0.5];
	const towardX = px - sx / total;
	const towardY = py - sy / total;
	let tipReach = -Infinity;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (Math.hypot(x - px, y - py) > 12 || light[y * w + x] < (peakLight / 9) * 0.85) continue;
			const reach = (x - sx / total) * towardX + (y - sy / total) * towardY;
			if (reach > tipReach) {
				tipReach = reach;
				peak = [(x + 0.5) / w, (y + 0.5) / h];
			}
		}
	}
	const cx = sx / total;
	const cy = sy / total;
	let xx = 0;
	let yy = 0;
	let xy = 0;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const weight = Math.max(0, light[y * w + x] - background);
			xx += weight * (x - cx) ** 2;
			yy += weight * (y - cy) ** 2;
			xy += weight * (x - cx) * (y - cy);
		}
	}
	xx /= total;
	yy /= total;
	xy /= total;
	const major = (xx + yy) / 2 + Math.sqrt(((xx - yy) / 2) ** 2 + xy ** 2);
	return {
		aspect,
		center: [(cx + 0.5) / w, (cy + 0.5) / h] as [number, number],
		peak,
		angle: 0.5 * Math.atan2(2 * xy, xx - yy),
		spread: Math.max(0.02, Math.sqrt(major) / 64),
		background: sky,
	};
}
