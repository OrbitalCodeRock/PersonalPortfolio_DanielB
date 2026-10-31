// Comets in the sky view (cosmos.ts): a glowing head (the coma) and two tails,
// both pointing straight away from the Sun: a narrow blue ion tail and a broader,
// paler dust tail. Placed each frame from the comet's orbit (comets.ts), so they
// move against the stars and grow as they near the Sun. Zoomed in on the tail,
// a real photo of the comet (skyImages.ts) fades in, turned and scaled so its
// head sits on the comet and its tail lies along the drawn one.
import * as THREE from 'three';
import type { Comet } from '../data/comets';
import { cometImages } from '../data/skyImages';
import { COMET_LIMIT, type CometState } from './comets';
import { equatorialVector } from './sky';
import { fitPhoto, loadSkyImage, photoMaterial } from './skyImageLoader';

// Swap in the photo once the tail is this long on screen (pixels), and a sharper one past the second.
const PHOTO_PX = 220;
const PHOTO_LARGE_PX = 900;
// Past this (pixels of tail on screen) the photo would be blown up blurry; the drawn comet takes over again.
const PHOTO_MAX_PX = 3000;
// The head is drawn at least this many pixels across, so it can be found.
const COMA_MIN_PX = 10;
const COMA_KM = 1.5e5; // a typical bright comet's visible coma
const KM_PER_AU = 1.496e8;

export interface CometVisual {
	object: THREE.Group; // add it to the celestial sphere group
	/** Each frame: place the comet for its current state (hidden while too faint to see). */
	update(state: CometState, opts: { opacity: number; pxPerRadian: number; dt: number; inView: boolean }): void;
	/** Where the head is (celestial frame). */
	head: THREE.Vector3;
	/** Length of the tail on the sky (radians). */
	tailAngle(): number;
	/** Whether the photo is showing (so its credit can be shown). */
	showingPhoto(): boolean;
}

function glowTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	draw(canvas.getContext('2d')!, w, h);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

// Shared by every comet.
let textures: { coma: THREE.Texture; ion: THREE.Texture; dust: THREE.Texture } | null = null;
function cometTextures() {
	textures ??= {
		coma: glowTexture(
			(ctx, w) => {
				const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
				g.addColorStop(0, 'rgba(255,255,255,1)');
				g.addColorStop(0.12, 'rgba(215,255,235,0.9)');
				g.addColorStop(0.45, 'rgba(120,220,190,0.25)');
				g.addColorStop(1, 'rgba(120,220,190,0)');
				ctx.fillStyle = g;
				ctx.fillRect(0, 0, w, w);
			},
			128,
			128,
		),
		// Tails: the head end is at the bottom of the canvas (texture v = 0), fading toward the top.
		ion: tailTexture([150, 195, 255], 0.18),
		dust: tailTexture([255, 245, 220], 0.42),
	};
	return textures;
}

function tailTexture([r, g, b]: [number, number, number], spread: number) {
	return glowTexture(
		(ctx, w, h) => {
			const image = ctx.createImageData(w, h);
			for (let y = 0; y < h; y++) {
				const along = 1 - y / (h - 1); // 0 at the head (bottom), 1 at the far end (top)
				const fade = Math.pow(1 - along, 1.6) * Math.min(1, along * 25);
				const width = spread * (0.35 + 0.65 * along); // tails fan out away from the head
				for (let x = 0; x < w; x++) {
					const across = (x / (w - 1) - 0.5) / (width / 2);
					const a = fade * Math.exp(-across * across * 2);
					const i = (y * w + x) * 4;
					image.data[i] = r;
					image.data[i + 1] = g;
					image.data[i + 2] = b;
					image.data[i + 3] = Math.round(a * 255);
				}
			}
			ctx.putImageData(image, 0, 0);
		},
		64,
		256,
	);
}

function glowMaterial(map: THREE.Texture) {
	return new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
}

interface CometPhoto {
	material: THREE.ShaderMaterial;
	stage: 'loading' | 'small' | 'large';
	mix: number; // 0 = drawn comet, 1 = photo
	mesh?: THREE.Mesh; // once loaded
}

const dir = (ra: number, dec: number) => new THREE.Vector3(...equatorialVector(ra, dec));

export function createCometVisual(comet: Comet, distance: number): CometVisual {
	const { coma, ion, dust } = cometTextures();
	const object = new THREE.Group();
	const plane = new THREE.PlaneGeometry(1, 1);
	// Tails hang from a frame at the head: y along the tail, z facing the viewer.
	const frame = new THREE.Group();
	const comaMesh = new THREE.Mesh(plane, glowMaterial(coma));
	const ionMesh = new THREE.Mesh(plane, glowMaterial(ion));
	const dustMesh = new THREE.Mesh(plane, glowMaterial(dust));
	frame.add(dustMesh, ionMesh, comaMesh);
	object.add(frame);

	const image = cometImages[comet.id];
	let photo: CometPhoto | null = null;
	let tailLength = 0; // chord length in scene units
	let tailAngle = 0;
	const head = new THREE.Vector3();

	function loadPhoto(url: string) {
		const material = photoMaterial();
		const entry: CometPhoto = { material, stage: 'loading', mix: 0 };
		photo = entry;
		loadSkyImage(url)
			.then(({ texture, bitmap }) => {
				const fit = fitPhoto(bitmap);
				// In units of the photo's long side: from the head (brightest spot) toward the
				// middle of its light, which runs down the tail.
				const w = Math.min(1, fit.aspect);
				const h = Math.min(1, 1 / fit.aspect);
				let dx = (fit.center[0] - fit.peak[0]) * w;
				let dy = (fit.center[1] - fit.peak[1]) * h;
				let reach = Math.hypot(dx, dy);
				if (reach < 0.05) {
					// Light centered on the head (a tail pointing at us): use the long axis instead.
					dx = Math.cos(fit.angle);
					dy = Math.sin(fit.angle);
					reach = 2 * fit.spread;
				}
				const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
				mesh.userData.fit = { angle: Math.atan2(dy, dx), reach, w, h, peak: fit.peak };
				// Comet photos are mostly sky full of stars: take the sky out fully, plus a little
				// more to drop the faint stars, and fade to an ellipse rather than the frame.
				material.uniforms.uBackground.value.copy(fit.background).multiplyScalar(1.25).addScalar(0.02);
				material.uniforms.uRound.value = 1;
				material.uniforms.uMap.value = texture;
				frame.add(mesh);
				entry.mesh = mesh;
				entry.stage = 'small';
			})
			.catch(() => (photo = null)); // try again next time
	}

	/**
	 * Lay the photo along the current tail: head on the comet, tail along +y. At its
	 * true scale if its field of view is known, or else sized to the drawn tail.
	 */
	function placePhoto(mesh: THREE.Mesh) {
		const { angle, reach, w, h, peak } = mesh.userData.fit;
		// The head-to-middle distance is about half the visible tail.
		const longSide = image?.fov
			? 2 * distance * Math.tan(THREE.MathUtils.degToRad(image.fov / 60) / 2)
			: THREE.MathUtils.clamp((0.5 * tailLength) / reach, tailLength * 0.6, tailLength * 6);
		mesh.scale.set(longSide * w, longSide * h, 1);
		mesh.rotation.z = Math.PI / 2 - angle;
		mesh.position
			.set(-(peak[0] - 0.5) * mesh.scale.x, -(peak[1] - 0.5) * mesh.scale.y, 0)
			.applyEuler(mesh.rotation);
	}

	const basis = new THREE.Matrix4();
	const x = new THREE.Vector3();
	const y = new THREE.Vector3();
	const z = new THREE.Vector3();

	return {
		object,
		head,
		tailAngle: () => tailAngle,
		showingPhoto: () => (photo?.mix ?? 0) > 0.5,
		update(state, { opacity, pxPerRadian, dt, inView }) {
			head.copy(dir(state.ra, state.dec)).multiplyScalar(distance);
			const brightness = THREE.MathUtils.clamp((COMET_LIMIT - state.magnitude) / 7, 0, 1);
			object.visible = brightness > 0 && opacity > 0;
			if (!object.visible) return;
			const end = dir(state.tailEnd.ra, state.tailEnd.dec).multiplyScalar(distance);
			tailAngle = head.angleTo(end);
			tailLength = head.distanceTo(end);
			// Frame at the head: y along the tail (north if there's no tail), z toward the viewer.
			if (tailLength > distance * 1e-5) y.copy(end).sub(head).normalize();
			else y.set(0, 0, 1);
			z.copy(head).normalize().negate();
			z.addScaledVector(y, -z.dot(y)).normalize();
			x.crossVectors(y, z);
			frame.position.copy(head);
			frame.quaternion.setFromRotationMatrix(basis.makeBasis(x, y, z));

			// The coma: its true size, or at least COMA_MIN_PX across.
			const comaAngle = Math.max(COMA_KM / (state.distance * KM_PER_AU), COMA_MIN_PX / pxPerRadian);
			const comaSize = 2 * distance * Math.tan(comaAngle / 2);
			comaMesh.scale.set(comaSize, comaSize, 1);
			const mix = photo?.mix ?? 0;
			const glow = opacity * (0.25 + 0.75 * brightness);
			(comaMesh.material as THREE.MeshBasicMaterial).opacity = glow * (1 - mix * 0.7);
			// Tails: the ion tail full length and narrow, the dust tail shorter and broad.
			const hasTail = tailLength > comaSize * 0.5;
			ionMesh.visible = dustMesh.visible = hasTail;
			if (hasTail) {
				ionMesh.scale.set(tailLength * 0.08 + comaSize * 0.4, tailLength, 1);
				ionMesh.position.set(0, tailLength / 2, 0);
				dustMesh.scale.set(tailLength * 0.32 + comaSize, tailLength * 0.75, 1);
				dustMesh.position.set(0, tailLength * 0.375, 0);
				(ionMesh.material as THREE.MeshBasicMaterial).opacity = glow * 0.8 * (1 - mix);
				(dustMesh.material as THREE.MeshBasicMaterial).opacity = glow * (1 - mix);
			}

			// Zoomed in on the tail: the real photo.
			const tailPx = tailAngle * pxPerRadian;
			if (image && hasTail && inView && tailPx > PHOTO_PX && !photo) loadPhoto(image.small);
			const current: CometPhoto | null = photo;
			if (image && current?.stage === 'small' && tailPx > PHOTO_LARGE_PX && inView) {
				current.stage = 'loading';
				loadSkyImage(image.large)
					.then(({ texture }) => {
						current.material.uniforms.uMap.value = texture;
						current.stage = 'large';
					})
					.catch(() => (current.stage = 'small'));
			}
			if (current?.mesh) {
				placePhoto(current.mesh);
				const target = hasTail && tailPx > PHOTO_PX && tailPx < PHOTO_MAX_PX ? 1 : 0;
				current.mix = target > current.mix ? Math.min(target, current.mix + dt * 2) : Math.max(target, current.mix - dt * 2);
				current.material.uniforms.uOpacity.value = opacity * current.mix;
			}
		},
	};
}
