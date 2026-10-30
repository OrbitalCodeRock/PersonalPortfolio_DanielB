// The Three.js scene behind every page: a starfield and a wireframe planet.
//
// The home page can bind its overlay UI to it (bindHome) and switch between views:
//   orbit   - default background; the planet drifts off to the side
//   planet  - camera flies in, the planet is centered and draggable, and the
//             section cards are pinned to points on its surface
//   surface - easter egg: the visitor stands on the planet and sees the real
//             constellation over Glenview (or their location) in the sky
//   inside  - page background after diving into the planet at a card
import * as THREE from 'three';
import { gsap } from 'gsap';
import { chooseSky, requestLocation, useLocationIfAllowed } from './sky';

// inside is the page background after diving into the planet (see reset()).
export type View = 'orbit' | 'planet' | 'surface' | 'inside';

export interface HomeBinding {
	eye: HTMLElement;
	stage: HTMLElement;
	cards: HTMLElement[];
	starTip: HTMLElement; // shows a star's name in the sky view
	onEgg: () => void;
}

interface Pose {
	pos: THREE.Vector3;
	quat: THREE.Quaternion;
	fov: number;
}

export interface SkyInfo {
	constellation: string;
	place: string;
}

interface SurfaceFrame {
	eye: THREE.Vector3;
	n: THREE.Vector3; // up, away from the planet
	t: THREE.Vector3; // forward along the ground
	r: THREE.Vector3; // right
	axis: THREE.Vector3; // the planet's spin axis, which the sky turns around
}

const RADIUS = 2.2;
const CORE_RADIUS = RADIUS * 0.93; // inside the flat faces so it never pokes through the wireframe
const MARKER_RADIUS = RADIUS * 1.03;
const SURFACE_HEIGHT = 0.3;
const SKY_RADIUS = 40;
// The sky view's ground: a stand-in for a much bigger planet under the visitor, so
// the horizon sits at true level (the real planet is so small its horizon would be
// ~28° below eye level). Up close a very large planet looks flat, so it's a flat
// square on the plane touching the landing site; from SURFACE_HEIGHT its edge is a
// few hundredths of a degree below level. Corners stay inside the camera's far plane.
const GROUND_SIZE = 1400;
const GROUND_CELL = 1; // grid square size, in scene units
const GROUND_GRID_OPACITY = 0.35;
const DRAG_THRESHOLD = 6;
const ORBIT_FOV = 60;
const PLANET_FOV = 55;
// Sky view zoom: fitted to the constellation on show (see buildSky), within these bounds.
const SURFACE_FOV_MIN = 35;
const SURFACE_FOV_MAX = 80;
// How much of the view's height the constellation should fill.
const SKY_FILL = 0.6;
// How far the scroll wheel can zoom the sky view (field of view in degrees; smaller = closer).
const SKY_ZOOM_MIN = 10;
const SKY_ZOOM_MAX = 90;
// How close (in pixels) the pointer must be to a star to show its name.
const STAR_HOVER_RADIUS = 18;
// Sky view star colors: 0 = all white, 1 = full blackbody color. Real stars look
// only faintly tinted to the naked eye.
const STAR_COLOR_SATURATION = 0.6;
// How much the stars twinkle (brightness swing for a star on the horizon; stars
// overhead twinkle about a quarter as much). 0 turns twinkling off.
const TWINKLE_STRENGTH = 0.35;
// Starfield drift (radians per second) in each view; 0 holds the stars still.
// Try 0.003 for a barely noticeable drift. In the surface view this is the
// planet's rotation instead: the background sky turns around the planet's axis,
// while the constellation stays fixed for the viewer.
const STAR_DRIFT_SPEED: Record<View, number> = {
	orbit: 0.01,
	planet: 0,
	surface: 0.01,
	inside: 0,
};

// Idle planet spin (radians per second) in the default background.
const ORBIT_SPIN_X = 0.05;
const ORBIT_SPIN_Y = 0.07;

// The background resumes from its last saved state on a new page load if the
// visitor was on the site within this window; after that it starts fresh.
const RESUME_WINDOW_MS = 30 * 60 * 1000;
const SAVE_KEY = 'cosmos-state';
const STAR_SEED = 20261029;

// Idle planet spin (radians per second) behind a page reached by diving into the
// planet. The walls move around you, so keep it slow; 0 stops it.
const INSIDE_SPIN_SPEED = 0.01;
const ORBIT_EDGE_OPACITY = 0.12;
const PLANET_EDGE_OPACITY = 0.32;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let stars: THREE.Points;
let planet: THREE.Group;
let edgesMaterial: THREE.LineBasicMaterial;
let core: THREE.Mesh;
let coreMaterial: THREE.MeshBasicMaterial;
let egg: THREE.Mesh;
let eggHit: THREE.Mesh;
let eggMaterial: THREE.MeshBasicMaterial;
let glowTexture: THREE.Texture;
const markers = new THREE.Group();
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0 });

let sky: THREE.Group | null = null;
let skyStars: { name: string; pos: THREE.Vector3 }[] = []; // the constellation's stars, as drawn
let skyStarMaterials: THREE.PointsMaterial[] = []; // one per star size
// Per star size group: the live color buffer, each star's true color, and its twinkle settings.
let skyTwinkle: {
	colors: THREE.BufferAttribute;
	base: Float32Array; // true colors, 3 per star
	amount: Float32Array; // how strongly each star twinkles
	phase: Float32Array; // 2 per star
	speed: Float32Array; // 2 per star, radians per second
}[] = [];
let skyLineMaterial: THREE.LineBasicMaterial | null = null;
const skyFade = { stars: 0, lines: 0, ground: 0 }; // tweened; applied to the sky materials each frame
let groundMaterial: THREE.ShaderMaterial | null = null;
let skyInfo: SkyInfo | null = null;
// Sky view zoom: fov is what's shown, eased each frame toward target (set by
// fitting the constellation, and by the scroll wheel).
const skyZoom = { fov: SURFACE_FOV_MAX, target: SURFACE_FOV_MAX };
let surfaceFrame: SurfaceFrame | null = null;

let view: View = 'orbit';
let busy = false;
// Set when the camera finishes diving into the planet; the next page opens there.
let arrived = false;
let binding: HomeBinding | null = null;
let bindingAbort: AbortController | null = null;

const pointer = { x: 0, y: 0 };
const drag = { active: false, x: 0, y: 0, moved: 0 };
const hover = { active: false, x: 0, y: 0 }; // pointer position over the stage, for the star name tip
let suppressClick = false;
const spin = { x: 0, y: 0 };
const look = { yaw: 0, pitch: THREE.MathUtils.degToRad(4) };
const activeTweens = new Set<gsap.core.Tween>();
const raycaster = new THREE.Raycaster();

export function getView(): View {
	return view;
}

export function isBusy(): boolean {
	return busy;
}

export function initCosmos(canvas: HTMLCanvasElement) {
	if (renderer) return;

	renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.05, 1000);
	camera.position.z = 5;
	glowTexture = makeGlowTexture();

	// Stars, in a thick shell so none end up right next to the camera when it flies in.
	// Seeded, so every page load gets the same sky.
	const STAR_COUNT = 1800;
	const positions = new Float32Array(STAR_COUNT * 3);
	const random = seededRandom(STAR_SEED);
	const star = new THREE.Vector3();
	for (let i = 0; i < STAR_COUNT; i++) {
		const z = random() * 2 - 1;
		const phi = random() * Math.PI * 2;
		const ring = Math.sqrt(1 - z * z);
		star.set(Math.cos(phi) * ring, z, Math.sin(phi) * ring).multiplyScalar(16 + random() * 18);
		star.toArray(positions, i * 3);
	}
	const starGeometry = new THREE.BufferGeometry();
	starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	stars = new THREE.Points(
		starGeometry,
		new THREE.PointsMaterial({
			color: 0xbcd4ff,
			size: 0.14,
			map: glowTexture,
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
		}),
	);
	scene.add(stars);

	// Planet: wireframe shell, a dark core that hides the far side, surface markers, and the egg
	planet = new THREE.Group();
	edgesMaterial = new THREE.LineBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: ORBIT_EDGE_OPACITY });
	planet.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(RADIUS, 1)), edgesMaterial));

	coreMaterial = new THREE.MeshBasicMaterial({ color: 0x070b18, transparent: true, opacity: 0 });
	core = new THREE.Mesh(new THREE.SphereGeometry(CORE_RADIUS, 48, 32), coreMaterial);
	core.renderOrder = -1;
	core.visible = false;
	planet.add(core);

	planet.add(markers);

	eggMaterial = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
	egg = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), eggMaterial);
	eggHit = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
	planet.add(egg, eggHit);

	planet.position.copy(orbitPlanetPosition());
	scene.add(planet);

	// The sky view shows the visitor's own sky if their browser already shares their location.
	void useLocationIfAllowed();

	// Pick up where the last page load left off, and save on the way out.
	restoreState();
	window.addEventListener('pagehide', saveState);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') saveState();
	});

	window.addEventListener('pointermove', (e) => {
		pointer.x = e.clientX / window.innerWidth - 0.5;
		pointer.y = e.clientY / window.innerHeight - 0.5;
	});
	window.addEventListener('resize', resize);
	resize();

	const clock = new THREE.Clock();
	const frame = () => {
		const dt = Math.min(clock.getDelta(), 0.05);
		const t = clock.elapsedTime;
		if (!reduceMotion) {
			const drift = STAR_DRIFT_SPEED[view];
			if (view === 'surface' && surfaceFrame && !busy) {
				// Turn the starfield around the planet's axis (through the planet's center).
				const angle = -dt * drift;
				stars.position.sub(planet.position).applyAxisAngle(surfaceFrame.axis, angle).add(planet.position);
				stars.rotateOnWorldAxis(surfaceFrame.axis, angle);
			} else if (view !== 'surface') {
				stars.rotation.y += dt * drift;
				stars.rotation.x += dt * drift * 0.4;
			}
		}
		for (const material of skyStarMaterials) material.opacity = skyFade.stars;
		if (skyLineMaterial) skyLineMaterial.opacity = skyFade.lines;
		if (groundMaterial) groundMaterial.uniforms.uOpacity.value = skyFade.ground;
		if (!reduceMotion) twinkle(t);
		if (view === 'surface' && !busy) skyZoom.fov += (skyZoom.target - skyZoom.fov) * Math.min(1, dt * 10);
		egg.rotation.y = t * 1.5;
		egg.scale.setScalar(1 + 0.25 * Math.sin(t * 3));

		if (!busy) {
			if (view === 'orbit') updateOrbit(dt);
			else if (view === 'planet') updatePlanet();
			else if (view === 'surface') applyPose(surfacePose());
			else if (!reduceMotion) planet.rotateY(dt * INSIDE_SPIN_SPEED); // inside
		}

		camera.updateMatrixWorld();
		updateOverlay();
		renderer.render(scene, camera);
		requestAnimationFrame(frame);
	};
	frame();
}

// ---------------------------------------------------------------------------
// Home page binding

export function bindHome(next: HomeBinding) {
	unbindHome();
	binding = next;
	bindingAbort = new AbortController();
	const { signal } = bindingAbort;

	// Spread the cards evenly over the planet, and hide the egg in the biggest gap.
	const cardDirs = next.cards.map((_, i) => fibonacciPoint(i, next.cards.length));
	for (const dir of cardDirs) {
		const marker = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), markerMaterial);
		marker.position.copy(dir).multiplyScalar(MARKER_RADIUS);
		markers.add(marker);
	}
	const eggDir = farthestPoint(cardDirs);
	egg.position.copy(eggDir).multiplyScalar(MARKER_RADIUS);
	eggHit.position.copy(egg.position);

	const { stage } = next;
	stage.addEventListener('pointerdown', onPointerDown, { signal });
	stage.addEventListener('pointermove', onPointerMove, { signal });
	stage.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && (hover.active = false), { signal });
	stage.addEventListener('wheel', onWheel, { passive: false, signal });
	// On window, so a drag that ends outside the stage still ends.
	window.addEventListener('pointerup', onPointerUp, { signal });
	window.addEventListener('pointercancel', () => (drag.active = false), { signal });
	stage.addEventListener(
		'click',
		(e) => {
			if (suppressClick) {
				e.preventDefault();
				e.stopPropagation();
			}
		},
		{ capture: true, signal },
	);
}

function unbindHome() {
	bindingAbort?.abort();
	bindingAbort = null;
	binding = null;
	for (const marker of [...markers.children]) {
		(marker as THREE.Mesh).geometry.dispose();
		markers.remove(marker);
	}
}

/**
 * Called before navigating away. After diving into the planet, the new page
 * keeps the inside of the planet as its background; otherwise snap back to the
 * default background.
 */
export function reset() {
	if (arrived) {
		arrived = false;
		unbindHome();
		view = 'inside';
		busy = false;
		return;
	}
	if (view === 'orbit' && !busy) {
		// Already the default background: leave the camera where the mouse
		// parallax has it, or it snaps to center and glides back (a visible jerk).
		unbindHome();
		return;
	}
	for (const tween of activeTweens) tween.kill();
	activeTweens.clear();
	busy = false;
	view = 'orbit';
	drag.active = false;
	spin.x = spin.y = 0;
	planet.position.copy(orbitPlanetPosition());
	stars.position.set(0, 0, 0);
	edgesMaterial.opacity = ORBIT_EDGE_OPACITY;
	coreMaterial.opacity = 0;
	core.visible = false;
	markerMaterial.opacity = 0;
	eggMaterial.opacity = 0;
	removeSky();
	surfaceFrame = null;
	applyPose(orbitPose());
	unbindHome();
}

export async function setView(target: View) {
	if (busy || !binding || target === view) return;
	const from = view;
	busy = true;
	try {
		if (from === 'orbit' && target === 'planet') await orbitToPlanet();
		else if (from === 'planet' && target === 'orbit') await planetToOrbit();
		else if (from === 'planet' && target === 'surface') await planetToSurface();
		else if (from === 'surface' && target === 'planet') await surfaceToPlanet();
		else return;
		view = target;
	} finally {
		busy = false;
	}
}

/**
 * Planet view: swoop down to a card's marker, then plunge inside the planet.
 * Stays busy afterwards; the page navigation that follows calls reset().
 */
export async function diveToCard(index: number) {
	const marker = markers.children[index];
	if (busy || view !== 'planet' || !marker) return;
	busy = true;
	spin.x = spin.y = 0;
	const site = marker.getWorldPosition(new THREE.Vector3());
	const n = site.clone().sub(planet.position).normalize();
	const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
	await flyTo(poseLookingAt(site.clone().addScaledVector(n, 1.4), site, up, 50), 0.9);
	await Promise.all([
		flyTo(poseLookingAt(site.clone().addScaledVector(n, -0.6), planet.position, up, 50), 0.7, 25, 'power2.in'),
		tween(markerMaterial, { opacity: 0, duration: 0.5 }),
		tween(eggMaterial, { opacity: 0, duration: 0.5 }),
	]);
	arrived = true;
}

// ---------------------------------------------------------------------------
// View transitions

async function orbitToPlanet() {
	spin.x = spin.y = 0;
	core.visible = true;
	await Promise.all([
		flyTo(planetPose(), 1.8, 22),
		tween(planet.position, { x: 0, y: 0, z: 0, duration: 1.8, ease: 'power2.inOut' }),
		// Pushing the starfield past the camera sells the "flying through space" feel.
		tween(stars.position, { x: 0, y: 0, z: 14, duration: 1.8, ease: 'power2.inOut' }),
		tween(edgesMaterial, { opacity: PLANET_EDGE_OPACITY, duration: 1.8 }),
		tween(coreMaterial, { opacity: 1, duration: 1.2, delay: 0.4 }),
		tween(markerMaterial, { opacity: 1, duration: 0.8, delay: 1.1 }),
		tween(eggMaterial, { opacity: 0.85, duration: 0.8, delay: 1.3 }),
	]);
}

async function planetToOrbit() {
	await Promise.all([
		flyTo(orbitPose(), 1.6, 18),
		tween(planet.position, { ...xyz(orbitPlanetPosition()), duration: 1.6, ease: 'power2.inOut' }),
		tween(stars.position, { x: 0, y: 0, z: 0, duration: 1.6, ease: 'power2.inOut' }),
		tween(edgesMaterial, { opacity: ORBIT_EDGE_OPACITY, duration: 1.6 }),
		tween(coreMaterial, { opacity: 0, duration: 1 }),
		tween(markerMaterial, { opacity: 0, duration: 0.4 }),
		tween(eggMaterial, { opacity: 0, duration: 0.4 }),
	]);
	core.visible = false;
}

async function planetToSurface() {
	spin.x = spin.y = 0;
	const site = egg.getWorldPosition(new THREE.Vector3());
	const n = site.clone().sub(planet.position).normalize();
	const t = WORLD_UP.clone().addScaledVector(n, -n.dot(WORLD_UP));
	if (t.lengthSq() < 1e-4) t.set(1, 0, 0).addScaledVector(n, -n.x);
	t.normalize();
	const r = new THREE.Vector3().crossVectors(t, n).normalize();
	const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(planet.quaternion);
	surfaceFrame = { eye: site.clone().addScaledVector(n, SURFACE_HEIGHT), n, t, r, axis };
	skyFade.stars = skyFade.lines = 0;
	const aim = buildSky();
	skyZoom.fov = skyZoom.target; // land already zoomed to fit
	look.yaw = aim.yaw;
	look.pitch = aim.pitch;

	// Dive toward the landing site, then touch down and tilt up to the sky.
	await Promise.all([
		flyTo(poseLookingAt(site.clone().addScaledVector(n, 3), site, t, 50), 1.3),
		tween(markerMaterial, { opacity: 0, duration: 0.6 }),
	]);
	await Promise.all([
		flyTo(surfacePose(), 1.6, 10),
		tween(eggMaterial, { opacity: 0, duration: 0.6 }),
		tween(skyFade, { stars: 1, duration: 1.2, delay: 0.9 }),
		tween(skyFade, { lines: 0.35, duration: 1.2, delay: 1.1 }),
		// The big ground fades in only near touchdown, so the small planet looks right on approach.
		tween(skyFade, { ground: 1, duration: 0.8, delay: 0.9 }),
	]);
}

async function surfaceToPlanet() {
	const { n, t, eye } = surfaceFrame!;
	const site = eye.clone().addScaledVector(n, -SURFACE_HEIGHT);
	await Promise.all([
		flyTo(poseLookingAt(site.clone().addScaledVector(n, 3), site, t, 50), 1.4),
		tween(skyFade, { stars: 0, lines: 0, duration: 0.6 }),
		tween(skyFade, { ground: 0, duration: 0.35 }),
	]);
	removeSky();
	await Promise.all([
		flyTo(planetPose(), 1.3),
		tween(markerMaterial, { opacity: 1, duration: 0.8, delay: 0.5 }),
		tween(eggMaterial, { opacity: 0.85, duration: 0.8, delay: 0.7 }),
	]);
}

// ---------------------------------------------------------------------------
// Per-frame updates

function updateOrbit(dt: number) {
	if (!reduceMotion) {
		planet.rotateX(dt * ORBIT_SPIN_X);
		planet.rotateY(dt * ORBIT_SPIN_Y);
	}
	camera.position.x += (pointer.x * 0.6 - camera.position.x) * 0.03;
	camera.position.y += (-pointer.y * 0.6 - camera.position.y) * 0.03;
	camera.lookAt(ORIGIN);
}

function updatePlanet() {
	if (drag.active) return;
	rotatePlanet(spin.x, spin.y);
	spin.x *= 0.94;
	spin.y *= 0.94;
	if (!reduceMotion) rotatePlanet(0.0015, 0);
}

const tmp = new THREE.Vector3();
const normal = new THREE.Vector3();
const forward = new THREE.Vector3();

function updateOverlay() {
	const w = window.innerWidth;
	const h = window.innerHeight;
	if (!binding) return;

	// Eye button sits on the planet in orbit view, while the hero is on screen.
	const showEye = view === 'orbit' && !busy && window.scrollY < 80;
	binding.eye.classList.toggle('is-hidden', !showEye);
	if (showEye) placeOver(binding.eye, planet.position, w, h);
	if (view === 'orbit' && !busy) return;

	// Planet cards: pinned above their markers, larger the closer they are to the camera.
	const planetDistance = camera.position.distanceTo(planet.position);
	binding.cards.forEach((card, i) => {
		const marker = markers.children[i];
		if (!marker) return;
		marker.getWorldPosition(tmp);
		normal.copy(tmp).sub(planet.position).normalize();
		const facing = normal.dot(forward.copy(camera.position).sub(tmp).normalize());
		const nearness = clamp((planetDistance + MARKER_RADIUS - camera.position.distanceTo(tmp)) / (2 * MARKER_RADIUS), 0, 1);
		// Cards near the planet's edge stay visible (small and faded) until they turn away.
		const opacity = smoothstep(-0.15, 0.2, facing);
		const scale = 0.5 + 0.65 * nearness;
		const [x, y] = toScreen(tmp, w, h);
		card.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, calc(-100% - 6px)) scale(${scale.toFixed(3)})`;
		card.style.opacity = opacity.toFixed(3);
		card.style.zIndex = String(Math.round(nearness * 100));
		card.style.pointerEvents = opacity > 0.4 ? 'auto' : 'none';
		card.classList.toggle('is-near', facing > 0.85);
	});

	// Star name tip: the constellation star nearest the pointer, if close enough.
	// Rechecked every frame, so it stays right while looking around or zooming.
	let nearest: { name: string; x: number; y: number } | null = null;
	if (view === 'surface' && !busy && hover.active && !drag.active) {
		camera.getWorldDirection(forward);
		let nearestDistance = STAR_HOVER_RADIUS;
		for (const star of skyStars) {
			if (tmp.copy(star.pos).sub(camera.position).dot(forward) <= 0) continue; // behind the camera
			const [x, y] = toScreen(tmp.copy(star.pos), w, h);
			const distance = Math.hypot(x - hover.x, y - hover.y);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearest = { name: star.name, x, y };
			}
		}
	}
	const tip = binding.starTip;
	tip.classList.toggle('is-visible', !!nearest);
	if (nearest) {
		if (tip.textContent !== nearest.name) tip.textContent = nearest.name;
		tip.style.transform = `translate3d(${nearest.x}px, ${nearest.y}px, 0) translate(-50%, calc(-100% - 12px))`;
	}
}

// ---------------------------------------------------------------------------
// Dragging and the egg

function onPointerDown(e: PointerEvent) {
	suppressClick = false;
	trackHover(e);
	if (busy || view === 'orbit') return;
	drag.active = true;
	drag.x = e.clientX;
	drag.y = e.clientY;
	drag.moved = 0;
}

function onPointerMove(e: PointerEvent) {
	const stage = binding?.stage;
	if (!stage) return;
	trackHover(e);
	// A missed pointerup (e.g. released over another window) must not leave the drag stuck on.
	if (drag.active && e.pointerType === 'mouse' && e.buttons === 0) drag.active = false;
	if (!drag.active) {
		stage.classList.toggle('is-over-egg', view === 'planet' && !busy && hitsEgg(e));
		return;
	}
	const dx = e.clientX - drag.x;
	const dy = e.clientY - drag.y;
	drag.x = e.clientX;
	drag.y = e.clientY;
	drag.moved += Math.abs(dx) + Math.abs(dy);
	// Capture only once it is clearly a drag, so plain clicks still reach the cards.
	if (drag.moved > DRAG_THRESHOLD && !stage.hasPointerCapture(e.pointerId)) stage.setPointerCapture(e.pointerId);

	if (view === 'planet') {
		spin.x = dx * 0.006;
		spin.y = dy * 0.006;
		rotatePlanet(spin.x, spin.y);
	} else if (view === 'surface') {
		// Slower when zoomed in, so the sky still follows the pointer.
		const speed = 0.004 * (skyZoom.fov / SURFACE_FOV_MAX);
		look.yaw -= dx * speed;
		look.pitch = clamp(look.pitch + dy * speed, -0.35, 1.3);
	}
}

/** Remember where the pointer is, for the star name tip (a tap counts too). */
function trackHover(e: PointerEvent) {
	hover.x = e.clientX;
	hover.y = e.clientY;
	hover.active = true;
}

/** Sky view: the scroll wheel zooms in and out. */
function onWheel(e: WheelEvent) {
	if (view !== 'surface' || busy) return;
	e.preventDefault();
	skyZoom.target = clamp(skyZoom.target * Math.exp(e.deltaY * 0.0015), SKY_ZOOM_MIN, SKY_ZOOM_MAX);
}

function onPointerUp(e: PointerEvent) {
	if (!drag.active) return;
	drag.active = false;
	if (drag.moved > DRAG_THRESHOLD) {
		// Swallow only the click this same release produces, not later keyboard clicks.
		suppressClick = true;
		setTimeout(() => (suppressClick = false));
	} else if (view === 'planet' && !busy && hitsEgg(e)) binding?.onEgg();
}

function hitsEgg(e: PointerEvent): boolean {
	const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
	raycaster.setFromCamera(ndc, camera);
	// The core is included so the egg can't be clicked through the planet.
	const [first] = raycaster.intersectObjects([core, eggHit], false);
	return first?.object === eggHit;
}

const xAxis = new THREE.Vector3(1, 0, 0);
const qx = new THREE.Quaternion();
const qy = new THREE.Quaternion();

/** Rotate around the screen's axes so the planet follows the pointer. */
function rotatePlanet(alongX: number, alongY: number) {
	qy.setFromAxisAngle(WORLD_UP, alongX);
	qx.setFromAxisAngle(xAxis, alongY);
	planet.quaternion.premultiply(qy).premultiply(qx);
}

// ---------------------------------------------------------------------------
// Sky

/**
 * Draw every catalog constellation that is up in the visitor's sky right now
 * (see sky.ts), at its true altitude and azimuth from the landing site: the
 * landing frame's t is north, r is east and n is the zenith. Stars below the
 * horizon, and lines that reach them, are left out. Returns the look direction
 * that centers the featured (best placed) constellation.
 */
function buildSky(): { yaw: number; pitch: number } {
	removeSky();
	const { eye, n, t, r } = surfaceFrame!;
	const choice = chooseSky();
	const featured = choice.featured;
	skyInfo = { constellation: featured.constellation.name, place: choice.place };

	const dirOf = (alt: number, az: number) =>
		new THREE.Vector3()
			.addScaledVector(t, Math.cos(alt) * Math.cos(az))
			.addScaledVector(r, Math.cos(alt) * Math.sin(az))
			.addScaledVector(n, Math.sin(alt));

	// Star positions keyed "Constellation/Star", for the stars above the horizon.
	const position = new Map<string, THREE.Vector3>();
	const upStars: { constellation: string; name: string; mag: number; bv: number; alt: number }[] = [];
	for (const { constellation, stars: placedStars } of choice.visible) {
		for (const s of placedStars) {
			if (s.alt <= 0) continue;
			position.set(`${constellation.name}/${s.name}`, eye.clone().addScaledVector(dirOf(s.alt, s.az), SKY_RADIUS));
			upStars.push({ constellation: constellation.name, name: s.name, mag: s.mag, bv: s.bv, alt: s.alt });
		}
	}

	// Hover names read "Star · Constellation".
	skyStars = upStars.map((s) => ({ name: `${s.name} · ${s.constellation}`, pos: position.get(`${s.constellation}/${s.name}`)! }));

	sky = new THREE.Group();
	// Brighter stars (lower magnitude) get a bigger glow, in quarter-unit size steps.
	const bySize = new Map<number, typeof upStars>();
	for (const s of upStars) {
		const size = Math.round(clamp(2.3 - 0.35 * s.mag, 0.8, 2.3) * 4) / 4;
		bySize.set(size, [...(bySize.get(size) ?? []), s]);
	}
	for (const [size, group] of bySize) {
		const geometry = new THREE.BufferGeometry().setFromPoints(group.map((s) => position.get(`${s.constellation}/${s.name}`)!));
		// Each star gets its true color, and a twinkle that is stronger the lower it sits
		// (light from near the horizon passes through more turbulent air).
		const base = new Float32Array(group.length * 3);
		const amount = new Float32Array(group.length);
		const phase = new Float32Array(group.length * 2);
		const speed = new Float32Array(group.length * 2);
		group.forEach((s, i) => {
			starColor(s.bv).toArray(base, i * 3);
			amount[i] = TWINKLE_STRENGTH * (0.25 + 0.75 * (1 - Math.sin(s.alt)));
			for (let k = 0; k < 2; k++) {
				phase[i * 2 + k] = Math.random() * Math.PI * 2;
				speed[i * 2 + k] = 4 + Math.random() * 10; // radians per second
			}
		});
		const colors = new THREE.BufferAttribute(base.slice(), 3);
		geometry.setAttribute('color', colors);
		skyTwinkle.push({ colors, base, amount, phase, speed });

		const material = new THREE.PointsMaterial({
			vertexColors: true,
			size,
			map: glowTexture,
			transparent: true,
			opacity: skyFade.stars,
			depthWrite: false,
		});
		skyStarMaterials.push(material);
		sky.add(new THREE.Points(geometry, material));
	}
	skyLineMaterial = new THREE.LineBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: skyFade.lines });
	const linePoints: THREE.Vector3[] = [];
	for (const { constellation } of choice.visible) {
		for (const [a, b] of constellation.lines) {
			const from = position.get(`${constellation.name}/${a}`);
			const to = position.get(`${constellation.name}/${b}`);
			if (from && to) linePoints.push(from, to); // both ends above the horizon
		}
	}
	sky.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePoints), skyLineMaterial));
	sky.add(buildGround());
	scene.add(sky);

	// Aim at and fit the featured constellation.
	const center = featured.stars.reduce((sum, s) => sum.add(dirOf(s.alt, s.az)), new THREE.Vector3()).normalize();
	// Zoom so the constellation fills SKY_FILL of the view, measured along the narrower screen side.
	const spread = Math.max(...featured.stars.map((s) => dirOf(s.alt, s.az).angleTo(center)));
	const narrowSide = Math.min(1, camera.aspect);
	const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(spread) / (SKY_FILL * narrowSide)));
	skyZoom.target = clamp(fov, SURFACE_FOV_MIN, SURFACE_FOV_MAX);
	return { yaw: Math.atan2(center.dot(r), center.dot(t)), pitch: clamp(Math.asin(center.dot(n)), -0.35, 1.3) };
}

function removeSky() {
	if (sky) {
		scene.remove(sky);
		sky.traverse((obj) => (obj as THREE.Mesh).geometry?.dispose());
		for (const material of skyStarMaterials) material.dispose();
		skyLineMaterial?.dispose();
		groundMaterial?.dispose();
	}
	sky = null;
	skyStarMaterials = [];
	skyTwinkle = [];
	skyLineMaterial = null;
	groundMaterial = null;
	skyStars = [];
}

/**
 * The ground under the visitor in the sky view: one large flat square on the
 * plane touching the landing site (two triangles), so the horizon sits at true
 * level and anything below it (the small planet, stars below the horizon) is
 * hidden. A shader draws a square grid on it, GROUND_CELL units per square,
 * aligned north-south; perspective shrinks the squares with distance, and lines
 * fade out where squares get smaller than a pixel, so the horizon stays clean.
 */
function buildGround(): THREE.Mesh {
	const { eye, n, t, r } = surfaceFrame!;
	const site = eye.clone().addScaledVector(n, -SURFACE_HEIGHT);

	groundMaterial = new THREE.ShaderMaterial({
		transparent: true,
		side: THREE.DoubleSide,
		uniforms: {
			uOpacity: { value: skyFade.ground },
			uCell: { value: GROUND_CELL },
			uGridOpacity: { value: GROUND_GRID_OPACITY },
			uGround: { value: new THREE.Color(0x070b18) },
			uLine: { value: new THREE.Color(0x6fb6ff) },
		},
		vertexShader: /* glsl */ `
			varying vec2 vPlane; // position on the ground plane, in units from the landing site
			void main() {
				vPlane = position.xy;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uOpacity;
			uniform float uCell;
			uniform float uGridOpacity;
			uniform vec3 uGround;
			uniform vec3 uLine;
			varying vec2 vPlane;
			void main() {
				vec2 coord = vPlane / uCell;
				vec2 width = fwidth(coord); // how much of a square one pixel covers
				// Distance to the nearest grid line, in pixels; under 1 means on a line.
				vec2 toLine = abs(fract(coord - 0.5) - 0.5) / width;
				float line = 1.0 - min(min(toLine.x, toLine.y), 1.0);
				// Fade lines out as squares shrink toward a pixel, before they shimmer.
				float detail = 1.0 - smoothstep(0.15, 0.5, max(width.x, width.y));
				vec3 color = mix(uGround, uLine, line * detail * uGridOpacity);
				gl_FragColor = vec4(color, uOpacity);
				#include <colorspace_fragment>
			}
		`,
	});
	const plane = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), groundMaterial);
	plane.position.copy(site);
	// PlaneGeometry lies in its local XY plane facing +Z: map x to east (r), y to north (t), z to up (n).
	plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, t, n));
	return plane;
}

/** Twinkle the sky view's stars: flicker each one's brightness around its true color. */
function twinkle(t: number) {
	for (const { colors, base, amount, phase, speed } of skyTwinkle) {
		const out = colors.array as Float32Array;
		for (let i = 0; i < amount.length; i++) {
			// Two sine waves at unrelated speeds make an irregular flicker.
			const wave =
				0.6 * Math.sin(t * speed[i * 2] + phase[i * 2]) + 0.4 * Math.sin(t * speed[i * 2 + 1] + phase[i * 2 + 1]);
			const brightness = 1 + amount[i] * wave;
			for (let c = 0; c < 3; c++) out[i * 3 + c] = base[i * 3 + c] * brightness;
		}
		colors.needsUpdate = true;
	}
}

/**
 * The color a star appears from its B−V color index: B−V gives the surface
 * temperature (Ballesteros' formula), the temperature gives a blackbody color
 * (Tanner Helland's fit), and that is softened toward white, since to the
 * naked eye star colors are much subtler than in photographs.
 */
function starColor(bv: number): THREE.Color {
	const kelvin = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
	const t = kelvin / 100;
	let r: number;
	let g: number;
	let b: number;
	if (t <= 66) {
		r = 255;
		g = 99.4708025861 * Math.log(t) - 161.1195681661;
		b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
	} else {
		r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
		g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
		b = 255;
	}
	const color = new THREE.Color().setRGB(
		clamp(r, 0, 255) / 255,
		clamp(g, 0, 255) / 255,
		clamp(b, 0, 255) / 255,
		THREE.SRGBColorSpace,
	);
	return color.lerp(new THREE.Color(1, 1, 1), 1 - STAR_COLOR_SATURATION);
}

/** The constellation on show in the sky view and where it is seen from. */
export function getSkyInfo(): SkyInfo | null {
	return skyInfo;
}

/**
 * Sky view: ask for the visitor's location (the browser prompts), then redraw
 * their sky and turn to face its constellation. Resolves null if declined.
 */
export async function useVisitorLocation(): Promise<SkyInfo | null> {
	if (!(await requestLocation()) || view !== 'surface' || busy || !surfaceFrame) return null;
	// buildSky sets a new zoom target; the frame loop eases toward it.
	const aim = buildSky();
	// Turn the short way round.
	const yaw = aim.yaw + 2 * Math.PI * Math.round((look.yaw - aim.yaw) / (2 * Math.PI));
	void tween(look, { yaw, pitch: aim.pitch, duration: 1.6, ease: 'power2.inOut' });
	return skyInfo;
}

// ---------------------------------------------------------------------------
// Camera poses

function orbitPlanetPosition(): THREE.Vector3 {
	// On portrait screens, tuck the planet up behind the heading instead of off to the right.
	return camera && camera.aspect < 1 ? new THREE.Vector3(0.6, 2.4, -3) : new THREE.Vector3(2.5, 0.5, -2);
}

function orbitPose(): Pose {
	return poseLookingAt(new THREE.Vector3(0, 0, 5), ORIGIN, WORLD_UP, ORBIT_FOV);
}

function planetPose(): Pose {
	// Back off far enough that the whole planet fits on narrow screens too.
	const halfFov = THREE.MathUtils.degToRad(PLANET_FOV / 2);
	const distance = Math.max(6.4, (RADIUS * 1.45) / (Math.tan(halfFov) * Math.min(1, camera.aspect)));
	return poseLookingAt(new THREE.Vector3(0, 0, distance), ORIGIN, WORLD_UP, PLANET_FOV);
}

function surfacePose(): Pose {
	const { eye, n, t } = surfaceFrame!;
	const dir = t
		.clone()
		.applyAxisAngle(n, -look.yaw)
		.multiplyScalar(Math.cos(look.pitch))
		.addScaledVector(n, Math.sin(look.pitch));
	return poseLookingAt(eye, eye.clone().add(dir), n, skyZoom.fov);
}

function poseLookingAt(pos: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3, fov: number): Pose {
	const m = new THREE.Matrix4().lookAt(pos, target, up);
	return { pos: pos.clone(), quat: new THREE.Quaternion().setFromRotationMatrix(m), fov };
}

function applyPose(pose: Pose) {
	camera.position.copy(pose.pos);
	camera.quaternion.copy(pose.quat);
	if (camera.fov !== pose.fov) {
		camera.fov = pose.fov;
		camera.updateProjectionMatrix();
	}
}

/** Fly the camera to a pose. fovBump widens the lens mid-flight for a sense of speed. */
function flyTo(to: Pose, duration: number, fovBump = 0, ease = 'power2.inOut'): Promise<void> {
	const from: Pose = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
	const progress = { t: 0 };
	const apply = () => {
		const t = progress.t;
		camera.position.lerpVectors(from.pos, to.pos, t);
		camera.quaternion.slerpQuaternions(from.quat, to.quat, t);
		camera.fov = THREE.MathUtils.lerp(from.fov, to.fov, t) + Math.sin(Math.PI * t) * fovBump;
		camera.updateProjectionMatrix();
	};
	return tween(progress, { t: 1, duration, ease, onUpdate: apply }).then(apply);
}

function resize() {
	const { innerWidth: w, innerHeight: h } = window;
	renderer.setSize(w, h, false);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	if (busy) return;
	if (view === 'orbit') planet.position.copy(orbitPlanetPosition());
	else if (view === 'planet') applyPose(planetPose());
}

// ---------------------------------------------------------------------------
// Continuity across page loads

interface SavedState {
	savedAt: number;
	stars: number[]; // quaternion
	planet: number[]; // quaternion
}

function saveState() {
	const state: SavedState = { savedAt: Date.now(), stars: stars.quaternion.toArray(), planet: planet.quaternion.toArray() };
	try {
		localStorage.setItem(SAVE_KEY, JSON.stringify(state));
	} catch {
		// Storage can be unavailable (private mode, blocked); the background just starts fresh.
	}
}

/** Restore the saved orientation, then advance it by the time since it was saved. */
function restoreState() {
	let saved: SavedState | null = null;
	try {
		saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
	} catch {
		return;
	}
	if (!saved || saved.stars?.length !== 4 || saved.planet?.length !== 4) return;
	const elapsed = (Date.now() - saved.savedAt) / 1000;
	if (!(elapsed >= 0) || elapsed * 1000 > RESUME_WINDOW_MS) return;

	stars.quaternion.fromArray(saved.stars);
	planet.quaternion.fromArray(saved.planet);
	if (reduceMotion) return;
	stars.rotation.y += elapsed * STAR_DRIFT_SPEED.orbit;
	stars.rotation.x += elapsed * STAR_DRIFT_SPEED.orbit * 0.4;
	planet.rotateX(elapsed * ORBIT_SPIN_X);
	planet.rotateY(elapsed * ORBIT_SPIN_Y);
}

// ---------------------------------------------------------------------------
// Helpers

/** Small deterministic PRNG (mulberry32), returning numbers in [0, 1). */
function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function tween(target: object, vars: gsap.TweenVars): Promise<void> {
	return new Promise((resolve) => {
		const t = gsap.to(target, {
			...vars,
			duration: reduceMotion ? 0 : vars.duration,
			delay: reduceMotion ? 0 : vars.delay,
			onComplete: () => {
				activeTweens.delete(t);
				resolve();
			},
		});
		activeTweens.add(t);
	});
}

/** Center an element on a point in the scene, kept a little inside the viewport. */
function placeOver(el: HTMLElement, point: THREE.Vector3, w: number, h: number) {
	const [x, y] = toScreen(tmp.copy(point), w, h);
	el.style.transform = `translate3d(${clamp(x, 40, w - 40)}px, ${clamp(y, 40, h - 40)}px, 0) translate(-50%, -50%)`;
}

function toScreen(v: THREE.Vector3, w: number, h: number): [number, number] {
	v.project(camera);
	return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
}

function fibonacciPoint(i: number, count: number): THREE.Vector3 {
	const y = 1 - (2 * (i + 0.5)) / count;
	const ring = Math.sqrt(1 - y * y);
	const phi = i * Math.PI * (3 - Math.sqrt(5));
	return new THREE.Vector3(Math.cos(phi) * ring, y, Math.sin(phi) * ring);
}

/** The direction farthest from every given direction (sampled, deterministic). */
function farthestPoint(dirs: THREE.Vector3[]): THREE.Vector3 {
	let best = new THREE.Vector3(0, -1, 0);
	let bestScore = -Infinity;
	for (let i = 0; i < 300; i++) {
		const candidate = fibonacciPoint(i, 300);
		const score = Math.min(...dirs.map((d) => -d.dot(candidate)));
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}
	return best;
}

function makeGlowTexture(): THREE.Texture {
	const size = 64;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
	gradient.addColorStop(0, 'rgba(255,255,255,1)');
	gradient.addColorStop(0.2, 'rgba(210,228,255,0.9)');
	gradient.addColorStop(0.5, 'rgba(120,170,255,0.25)');
	gradient.addColorStop(1, 'rgba(120,170,255,0)');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size, size);
	return new THREE.CanvasTexture(canvas);
}

function xyz(v: THREE.Vector3) {
	return { x: v.x, y: v.y, z: v.z };
}

function clamp(v: number, min: number, max: number) {
	return Math.min(max, Math.max(min, v));
}

function smoothstep(edge0: number, edge1: number, x: number) {
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}
