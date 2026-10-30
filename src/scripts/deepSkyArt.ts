// Images for the sky view's galaxies, nebulae and star clusters (see
// src/data/deepSky.ts), drawn once on a canvas in the browser: no image files to
// download. Each kind has its own look (spiral arms, glowing gas, a ring, a
// sprinkle of stars), varied per object by a seed. Shown with additive blending
// over the dark sky, so black means "nothing here" and the edges fade out.
import * as THREE from 'three';
import type { DeepSkyKind } from '../data/deepSky';

const SIZE = 256;
const C = SIZE / 2; // center
const R = SIZE / 2 - 4; // usable radius

type RGB = [number, number, number];

/** Small deterministic PRNG (mulberry32), returning numbers in [0, 1). */
function seeded(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A soft round glow. */
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, [r, g, b]: RGB, alpha: number) {
	const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
	gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
	gradient.addColorStop(0.4, `rgba(${r},${g},${b},${alpha * 0.45})`);
	gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
	ctx.fillStyle = gradient;
	ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** A gaussian-ish random offset (sum of uniforms). */
function spread(random: () => number, scale: number): number {
	return (random() + random() + random() - 1.5) * scale;
}

const DRAW: Record<DeepSkyKind, (ctx: CanvasRenderingContext2D, random: () => number) => void> = {
	spiral(ctx, random) {
		glow(ctx, C, C, R * 0.95, [170, 185, 235], 0.22); // the disk
		// Two logarithmic spiral arms, studded with blue young stars and pink star-forming knots.
		const twist = 0.28 + random() * 0.1;
		for (let arm = 0; arm < 2; arm++) {
			for (let i = 0; i < 260; i++) {
				const theta = (i / 260) * Math.PI * 3.2;
				const r = R * 0.1 * Math.exp(twist * theta);
				if (r > R * 0.92) break;
				const a = theta + arm * Math.PI;
				const x = C + Math.cos(a) * r + spread(random, 10);
				const y = C + Math.sin(a) * r + spread(random, 10);
				const pink = random() < 0.08;
				glow(ctx, x, y, 3 + random() * 7, pink ? [255, 140, 175] : [175, 200, 255], pink ? 0.35 : 0.16);
			}
		}
		glow(ctx, C, C, R * 0.32, [255, 228, 185], 0.9); // the bulge
		glow(ctx, C, C, R * 0.08, [255, 245, 225], 1);
	},
	'edge-on'(ctx, random) {
		// A disk seen side on: a long thin glow, a bright bulge, and a dark dust lane.
		ctx.save();
		ctx.translate(C, C);
		ctx.scale(1, 0.32);
		glow(ctx, 0, 0, R * 0.95, [200, 205, 235], 0.45);
		glow(ctx, 0, 0, R * 0.45, [255, 225, 185], 0.85);
		ctx.restore();
		for (let i = 0; i < 40; i++) glow(ctx, C + spread(random, R * 0.7), C + spread(random, 6), 4, [175, 200, 255], 0.12);
		ctx.globalCompositeOperation = 'destination-out';
		const lane = ctx.createLinearGradient(0, C - 9, 0, C + 9);
		lane.addColorStop(0, 'rgba(0,0,0,0)');
		lane.addColorStop(0.5, 'rgba(0,0,0,0.85)');
		lane.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = lane;
		ctx.fillRect(C - R * 0.85, C - 9, R * 1.7, 18);
		ctx.globalCompositeOperation = 'lighter';
	},
	elliptical(ctx) {
		glow(ctx, C, C, R, [255, 222, 185], 0.55);
		glow(ctx, C, C, R * 0.4, [255, 232, 200], 0.8);
		glow(ctx, C, C, R * 0.1, [255, 245, 230], 1);
	},
	irregular(ctx, random) {
		// Patchy star clouds with bright pink nebulae scattered through them.
		for (let i = 0; i < 70; i++) {
			const x = C + spread(random, R * 0.9);
			const y = C + spread(random, R * 0.55);
			glow(ctx, x, y, 12 + random() * 30, random() < 0.15 ? [255, 140, 175] : [185, 200, 245], 0.12 + random() * 0.1);
		}
		for (let i = 0; i < 160; i++) glow(ctx, C + spread(random, R * 0.9), C + spread(random, R * 0.6), 2, [225, 232, 255], 0.5);
	},
	emission(ctx, random) {
		// Glowing hydrogen (pink-red) and oxygen (teal) gas, carved by dark dust, lit by a few hot stars.
		for (let i = 0; i < 90; i++) {
			const x = C + spread(random, R * 0.75);
			const y = C + spread(random, R * 0.75);
			const teal = random() < 0.18;
			glow(ctx, x, y, 14 + random() * 38, teal ? [110, 205, 215] : [255, 95, 135], 0.1 + random() * 0.1);
		}
		ctx.globalCompositeOperation = 'destination-out';
		for (let i = 0; i < 10; i++) glow(ctx, C + spread(random, R * 0.8), C + spread(random, R * 0.8), 10 + random() * 26, [0, 0, 0], 0.6);
		ctx.globalCompositeOperation = 'lighter';
		for (let i = 0; i < 6; i++) glow(ctx, C + spread(random, R * 0.25), C + spread(random, R * 0.25), 5, [235, 240, 255], 0.9);
	},
	planetary(ctx, random) {
		// A glowing shell: red outer rim, teal inner ring, a faint middle and the dying star at its heart.
		const ring = (radius: number, width: number, [r, g, b]: RGB, alpha: number) => {
			const gradient = ctx.createRadialGradient(C, C, Math.max(0, radius - width), C, C, radius + width);
			gradient.addColorStop(0, `rgba(${r},${g},${b},0)`);
			gradient.addColorStop(0.5, `rgba(${r},${g},${b},${alpha})`);
			gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, SIZE, SIZE);
		};
		glow(ctx, C, C, R * 0.6, [90, 190, 200], 0.25);
		ring(R * 0.5, R * 0.18, [110, 225, 205], 0.75);
		ring(R * 0.72, R * 0.14, [255, 110, 110], 0.6);
		for (let i = 0; i < 30; i++) {
			const a = random() * Math.PI * 2;
			glow(ctx, C + Math.cos(a) * R * 0.62, C + Math.sin(a) * R * 0.62, 8, [255, 160, 140], 0.15);
		}
		glow(ctx, C, C, 4, [235, 245, 255], 1);
	},
	remnant(ctx, random) {
		// Tangled glowing filaments from an exploded star.
		ctx.lineCap = 'round';
		for (let i = 0; i < 70; i++) {
			const a = random() * Math.PI * 2;
			const r = R * (0.45 + random() * 0.45);
			const x = C + Math.cos(a) * r;
			const y = C + Math.sin(a) * r;
			const bend = random() * 40 - 20;
			const teal = random() < 0.35;
			ctx.strokeStyle = teal ? 'rgba(110,210,225,0.35)' : 'rgba(255,120,95,0.4)';
			ctx.lineWidth = 1 + random() * 2.5;
			ctx.beginPath();
			ctx.moveTo(x, y);
			const tangent = a + Math.PI / 2;
			const len = 15 + random() * 35;
			ctx.quadraticCurveTo(
				x + Math.cos(tangent) * len * 0.5 + bend,
				y + Math.sin(tangent) * len * 0.5 + bend,
				x + Math.cos(tangent) * len,
				y + Math.sin(tangent) * len,
			);
			ctx.stroke();
		}
		glow(ctx, C, C, R * 0.5, [255, 150, 110], 0.15);
	},
	'open-cluster'(ctx, random) {
		// A loose scatter of young blue-white stars, with a faint blue haze.
		glow(ctx, C, C, R * 0.9, [140, 170, 255], 0.08);
		const count = 30 + Math.floor(random() * 30);
		for (let i = 0; i < count; i++) {
			const x = C + spread(random, R * 0.8);
			const y = C + spread(random, R * 0.8);
			const bright = random();
			glow(ctx, x, y, 3 + bright * 9, [205, 222, 255], 0.5 + bright * 0.5);
		}
	},
	globular(ctx, random) {
		// Hundreds of thousands of old stars, packed densely toward the center.
		glow(ctx, C, C, R * 0.7, [255, 225, 185], 0.35);
		for (let i = 0; i < 1500; i++) {
			const r = R * 0.28 * Math.sqrt(-2 * Math.log(1 - random() * 0.999));
			const a = random() * Math.PI * 2;
			glow(ctx, C + Math.cos(a) * r, C + Math.sin(a) * r, 1.6, [255, 235, 205], 0.55);
		}
		glow(ctx, C, C, R * 0.18, [255, 240, 220], 0.7);
	},
};

/** The image for one deep-sky object (seed varies it between objects of the same kind). */
export function deepSkyTexture(kind: DeepSkyKind, seed: number): THREE.Texture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = SIZE;
	const ctx = canvas.getContext('2d')!;
	ctx.globalCompositeOperation = 'lighter';
	DRAW[kind](ctx, seeded(seed * 7919 + 17));
	// Fade everything out toward the edges, so no square outline ever shows.
	ctx.globalCompositeOperation = 'destination-in';
	const mask = ctx.createRadialGradient(C, C, R * 0.55, C, C, R);
	mask.addColorStop(0, 'rgba(0,0,0,1)');
	mask.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.fillStyle = mask;
	ctx.fillRect(0, 0, SIZE, SIZE);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}
