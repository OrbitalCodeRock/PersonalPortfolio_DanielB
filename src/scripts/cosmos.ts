// The Three.js scene behind every page: a starfield and a wireframe planet.
//
// The home page can bind its overlay UI to it (bindHome) and switch between views:
//   orbit   - default background; the planet drifts off to the side
//   planet  - camera flies in, the planet is centered and draggable, and the
//             section cards are pinned to points on its surface
//   surface - easter egg: the visitor stands on the planet and the section
//             cards become a constellation in the sky
//   inside  - page background after diving into the planet at a card
//   distant - page background after flying through a constellation star
import * as THREE from 'three';
import { gsap } from 'gsap';

// inside and distant are page backgrounds after a trip (see reset()).
export type View = 'orbit' | 'planet' | 'surface' | 'inside' | 'distant';

export interface HomeBinding {
	eye: HTMLElement;
	stage: HTMLElement;
	cards: HTMLElement[];
	labels: HTMLElement[];
	onEgg: () => void;
}

interface Pose {
	pos: THREE.Vector3;
	quat: THREE.Quaternion;
	fov: number;
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
const DRAG_THRESHOLD = 6;
const ORBIT_FOV = 60;
const PLANET_FOV = 55;
const SURFACE_FOV = 80;
// Starfield drift (radians per second) in each view; 0 holds the stars still.
// Try 0.003 for a barely noticeable drift. In the surface view this is the
// planet's rotation instead: the background sky turns around the planet's axis,
// while the constellation stays fixed for the viewer.
const STAR_DRIFT_SPEED: Record<View, number> = {
	orbit: 0.01,
	planet: 0,
	surface: 0.01,
	inside: 0,
	distant: 0,
};

// Idle planet spin (radians per second) behind pages reached by a trip.
// Inside the planet the walls move around you, so keep that one slow; 0 stops it.
const INSIDE_SPIN_SPEED = 0.01;
const DISTANT_SPIN_SPEED = 0.04;
const FAR_DISTANCE = 26;
const FAR_FOV = 45;
const ORBIT_EDGE_OPACITY = 0.12;
const PLANET_EDGE_OPACITY = 0.32;

// Constellation layout as [azimuth, elevation] in degrees, relative to the
// direction the visitor faces after landing. Links draw the constellation lines.
const CONSTELLATION: [number, number][] = [
	[-34, 14],
	[-24, 25],
	[-13, 18],
	[-3, 30],
	[7, 21],
	[17, 29],
	[26, 16],
	[35, 25],
	[9, 9],
];
const CONSTELLATION_LINKS: [number, number][] = [
	[0, 1],
	[1, 2],
	[2, 3],
	[3, 4],
	[4, 5],
	[5, 6],
	[6, 7],
	[4, 8],
];

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
let skyPoints: THREE.Vector3[] = [];
let skyStarMaterial: THREE.PointsMaterial | null = null;
let skyLineMaterial: THREE.LineBasicMaterial | null = null;
let surfaceFrame: SurfaceFrame | null = null;

let view: View = 'orbit';
let busy = false;
// Set when the camera finishes a trip to a card or star; the next page opens there.
let arrival: 'planet' | 'star' | null = null;
// Set by the eye on a faraway page: the home page should fly from here into the planet view.
let planetRequested = false;
let awayEye: HTMLElement | null = null;
let binding: HomeBinding | null = null;
let bindingAbort: AbortController | null = null;

const pointer = { x: 0, y: 0 };
const drag = { active: false, x: 0, y: 0, moved: 0 };
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

	// Stars, in a thick shell so none end up right next to the camera when it flies in
	const STAR_COUNT = 1800;
	const positions = new Float32Array(STAR_COUNT * 3);
	const star = new THREE.Vector3();
	for (let i = 0; i < STAR_COUNT; i++) {
		star.randomDirection().multiplyScalar(THREE.MathUtils.randFloat(16, 34));
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
		egg.rotation.y = t * 1.5;
		egg.scale.setScalar(1 + 0.25 * Math.sin(t * 3));

		if (!busy) {
			if (view === 'orbit') updateOrbit(dt);
			else if (view === 'planet') updatePlanet();
			else if (view === 'surface') applyPose(surfacePose());
			else if (!reduceMotion) planet.rotateY(dt * (view === 'inside' ? INSIDE_SPIN_SPEED : DISTANT_SPIN_SPEED));
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
 * Called before navigating away. After a trip into the planet or through a
 * star, the new page keeps a background that shows where you went (inside the
 * planet, or far away from it); otherwise snap back to the default background.
 */
export function reset() {
	if (planetRequested) {
		// Hold the camera where it is (busy blocks the orbit updates) until the
		// home page takes the request and flies into the planet view.
		unbindHome();
		view = 'orbit';
		busy = true;
		return;
	}
	if (arrival) {
		const from = arrival;
		arrival = null;
		unbindHome();
		if (from === 'planet') {
			view = 'inside';
			busy = false;
		} else {
			void settleFarAway();
		}
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

/** The eye shown over the faraway planet; null when the page has none. */
export function bindAwayEye(el: HTMLElement | null) {
	awayEye = el;
}

/** Ask the next page (home) to fly from the current camera position into the planet view. */
export function requestPlanetView() {
	planetRequested = true;
}

/** Home page: true (once) if it should open straight into the planet view. */
export function takePlanetRequest(): boolean {
	if (!planetRequested) return false;
	planetRequested = false;
	busy = false;
	return true;
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
	arrival = 'planet';
}

/**
 * Surface view: turn toward a constellation star and fly through it. The
 * starfield travels along at half the camera's speed, so the camera crosses it
 * and stars stream past. Stays busy afterwards; the page navigation that
 * follows calls reset().
 */
export async function flyToStar(index: number) {
	const star = skyPoints[index];
	if (busy || view !== 'surface' || !star || !surfaceFrame) return;
	busy = true;
	const dir = star.clone().sub(camera.position).normalize();
	const beyond = star.clone().addScaledVector(dir, 2.5);
	const starfieldEnd = stars.position.clone().lerp(beyond, 0.5);
	await Promise.all([
		flyTo(poseLookingAt(beyond, beyond.clone().add(dir), surfaceFrame.n, SURFACE_FOV), 1.9, 20, 'power3.in'),
		tween(stars.position, { ...xyz(starfieldEnd), duration: 1.9, ease: 'power3.in' }),
		tween(skyLineMaterial!, { opacity: 0, duration: 0.5, delay: 1.1 }),
		tween(skyStarMaterial!, { opacity: 0, duration: 0.4, delay: 1.5 }),
	]);
	arrival = 'star';
}

/**
 * After flying through a star: turn around to face the planet and settle at a
 * distance where it looks small, off to the side of the page content.
 */
async function settleFarAway() {
	busy = true;
	view = 'distant';
	const away = camera.position.clone().sub(planet.position).normalize();
	const up = Math.abs(away.dot(WORLD_UP)) > 0.95 ? new THREE.Vector3(0, 0, 1) : WORLD_UP;
	const eye = planet.position.clone().addScaledVector(away, FAR_DISTANCE);
	// Aim a little to the planet's left so it sits on the right side of the screen.
	const right = new THREE.Vector3().crossVectors(away.clone().negate(), up).normalize();
	const target = planet.position.clone().addScaledVector(right, -FAR_DISTANCE * 0.22);
	// Settle the starfield halfway between the planet and the camera, so both sit inside it.
	const starfieldEnd = planet.position.clone().addScaledVector(away, FAR_DISTANCE * 0.5);
	await Promise.all([
		flyTo(poseLookingAt(eye, target, up, FAR_FOV), 3),
		tween(stars.position, { ...xyz(starfieldEnd), duration: 3, ease: 'power2.inOut' }),
	]);
	removeSky();
	surfaceFrame = null;
	busy = false;
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
	look.yaw = 0;
	look.pitch = THREE.MathUtils.degToRad(4);
	buildSky();

	// Dive toward the landing site, then touch down and tilt up to the sky.
	await Promise.all([
		flyTo(poseLookingAt(site.clone().addScaledVector(n, 3), site, t, 50), 1.3),
		tween(markerMaterial, { opacity: 0, duration: 0.6 }),
	]);
	await Promise.all([
		flyTo(surfacePose(), 1.6, 10),
		tween(eggMaterial, { opacity: 0, duration: 0.6 }),
		tween(skyStarMaterial!, { opacity: 1, duration: 1.2, delay: 0.9 }),
		tween(skyLineMaterial!, { opacity: 0.35, duration: 1.2, delay: 1.1 }),
	]);
}

async function surfaceToPlanet() {
	const { n, t, eye } = surfaceFrame!;
	const site = eye.clone().addScaledVector(n, -SURFACE_HEIGHT);
	await Promise.all([
		flyTo(poseLookingAt(site.clone().addScaledVector(n, 3), site, t, 50), 1.4),
		tween(skyStarMaterial!, { opacity: 0, duration: 0.6 }),
		tween(skyLineMaterial!, { opacity: 0, duration: 0.6 }),
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
		planet.rotateX(dt * 0.05);
		planet.rotateY(dt * 0.07);
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

	// Eye button over the faraway planet, on pages reached through a star.
	if (awayEye) {
		const showAwayEye = view === 'distant' && !busy;
		awayEye.classList.toggle('is-hidden', !showAwayEye);
		if (showAwayEye) placeOver(awayEye, planet.position, w, h);
	}
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

	// Constellation labels, just below their stars.
	camera.getWorldDirection(forward);
	binding.labels.forEach((label, i) => {
		const point = skyPoints[i];
		const inFront = point && tmp.copy(point).sub(camera.position).dot(forward) > 0;
		label.style.visibility = inFront ? 'visible' : 'hidden';
		if (!inFront) return;
		const [x, y] = toScreen(tmp.copy(point), w, h);
		label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, 14px)`;
	});
}

// ---------------------------------------------------------------------------
// Dragging and the egg

function onPointerDown(e: PointerEvent) {
	suppressClick = false;
	if (busy || view === 'orbit') return;
	drag.active = true;
	drag.x = e.clientX;
	drag.y = e.clientY;
	drag.moved = 0;
}

function onPointerMove(e: PointerEvent) {
	const stage = binding?.stage;
	if (!stage) return;
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
		look.yaw -= dx * 0.004;
		look.pitch = clamp(look.pitch + dy * 0.004, -0.35, 1.3);
	}
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

function buildSky() {
	removeSky();
	const { eye, n, t, r } = surfaceFrame!;
	// The sky's rotation depends on the visitor's local time of day (up to ±9°).
	const now = new Date();
	const azOffset = (now.getHours() + now.getMinutes() / 60 - 12) * 0.75;

	skyPoints = CONSTELLATION.map(([az, el]) => {
		const a = THREE.MathUtils.degToRad(az + azOffset);
		const e = THREE.MathUtils.degToRad(el);
		const dir = new THREE.Vector3()
			.addScaledVector(t, Math.cos(e) * Math.cos(a))
			.addScaledVector(r, Math.cos(e) * Math.sin(a))
			.addScaledVector(n, Math.sin(e));
		return eye.clone().addScaledVector(dir, SKY_RADIUS);
	});

	skyStarMaterial = new THREE.PointsMaterial({
		color: 0xd6e6ff,
		size: 1.6,
		map: glowTexture,
		transparent: true,
		opacity: 0,
		depthWrite: false,
	});
	skyLineMaterial = new THREE.LineBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0 });

	sky = new THREE.Group();
	sky.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(skyPoints), skyStarMaterial));
	const linePoints = CONSTELLATION_LINKS.flatMap(([a, b]) => [skyPoints[a], skyPoints[b]]);
	sky.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePoints), skyLineMaterial));
	scene.add(sky);
}

function removeSky() {
	if (sky) {
		scene.remove(sky);
		sky.traverse((obj) => (obj as THREE.Mesh).geometry?.dispose());
		skyStarMaterial?.dispose();
		skyLineMaterial?.dispose();
	}
	sky = null;
	skyStarMaterial = null;
	skyLineMaterial = null;
	skyPoints = [];
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
	return poseLookingAt(eye, eye.clone().add(dir), n, SURFACE_FOV);
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
// Helpers

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
