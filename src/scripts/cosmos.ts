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
import {
	BODY_POLES,
	chooseSky,
	equatorialVector,
	getObserver,
	siderealAngle,
	skyNow,
	useLocationIfAllowed,
} from './sky';
import { createBodyVisual, type BodyVisual } from './skyBodies';
import { solarSystem, type BodyName } from './ephemeris';
import { constellations, looseStars, type SkyStar } from '../data/constellations';
import { deepSky } from '../data/deepSky';
import { deepSkyTexture } from './deepSkyArt';
import { deepSkyImages, planetMaps, type ImageCredit } from '../data/skyImages';
import { fitPhoto, loadSkyImage, photoMaterial } from './skyImageLoader';
import { comets } from '../data/comets';
import { cometState, COMET_LIMIT } from './comets';
import { createCometVisual, type CometVisual } from './skyComets';
import { cometImages } from '../data/skyImages';
import { createMeteorShowers, METEOR_SPEEDUP, type MeteorShowers } from './skyMeteors';
import { shortDate } from './meteors';

// inside is the page background after diving into the planet (see reset()).
export type View = 'orbit' | 'planet' | 'surface' | 'inside';

export interface HomeBinding {
	eye: HTMLElement;
	stage: HTMLElement;
	cards: HTMLElement[];
	starTip: HTMLElement; // shows a star's name in the sky view
	zoomBox: HTMLElement; // holds the magnification and the zoom-out button; shown once zoomed in
	zoomReadout: HTMLElement; // telescope magnification in the sky view
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
// How far the scroll wheel can zoom the sky view (field of view in degrees; smaller =
// closer). 0.01° is deep enough to frame Jupiter (about 45 arcseconds across).
const SKY_ZOOM_MIN = 0.01;
const SKY_ZOOM_MAX = 90;
// The naked eye's field of view, for the telescope's magnification readout.
const NAKED_EYE_FOV = 60;
// Constellation stars swap their glow for a close-up of their type between these magnifications.
const STAR_DETAIL_ZOOM = [4, 16];
// Highest the sky view can tilt (radians; just short of straight up).
const SKY_PITCH_MAX = 1.55;
// Point-of-light color for each planet when it is too small to see as a disk.
const PLANET_GLOW: Record<Exclude<BodyName, 'Moon'>, number> = {
	Mercury: 0xe0d8cc,
	Venus: 0xfff6dc,
	Mars: 0xffa07a,
	Jupiter: 0xffeed4,
	Saturn: 0xffe6b8,
	Uranus: 0xc8f0f2,
	Neptune: 0xa8c0ff,
};
// How close (in pixels) the pointer must be to a star to show its name.
const STAR_HOVER_RADIUS = 18;
const KM_PER_AU = 149597870.7;
// How close (in pixels) a press must be to a planet or the Moon to lock the telescope onto it.
const BODY_PICK_RADIUS = 36;
// Field of view (degrees) the telescope zooms to when locking onto a star: close enough for its close-up.
const STAR_FOCUS_FOV = 0.25;
// Zooming back out on its own (a body set, or the zoom-out button): the field of view
// grows by this factor per second, up to the naked eye.
const AUTO_ZOOM_OUT_RATE = 3;
// How long (seconds) the telescope eases onto a body before following it exactly.
const TRACK_LOCK_SECONDS = 0.6;
// Sky view star colors: 0 = all white, 1 = full blackbody color. Real stars look
// only faintly tinted to the naked eye.
const STAR_COLOR_SATURATION = 0.6;
// How much the stars twinkle (brightness swing for a star on the horizon; stars
// overhead twinkle about a quarter as much). 0 turns twinkling off.
const TWINKLE_STRENGTH = 0.35;
// Starfield drift (radians per second) in each view; 0 holds the stars still.
// Try 0.003 for a barely noticeable drift. Not used in the sky (surface) view,
// where the whole sky turns with the simulated time instead (updateSky).
const STAR_DRIFT_SPEED: Record<Exclude<View, 'surface'>, number> = {
	orbit: 0.01,
	planet: 0,
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
let starAtlas: THREE.Texture; // close-up star images, one per spectral type (makeStarAtlas)
const markers = new THREE.Group();
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0 });

// The sky view. sky holds everything; celestial is the celestial sphere inside
// it (stars, planets, Moon), centered on the visitor and rotated each frame to
// match the simulated time, the way Earth's spin turns the real sky.
let sky: THREE.Group | null = null;
let celestial: THREE.Group | null = null;
// Everything in the sky view that shows a name on hover: stars, plus the planets
// and Moon (which also have a size, and can be clicked to focus the telescope).
interface SkyItem {
	key: string; // "star:Polaris", "deep:M31", "body:Mars": how the search (skyFinder.ts) names it
	name: string;
	local: THREE.Vector3; // position on the celestial sphere (celestial group's frame)
	angularRadius?: number; // radians; bodies only
	hoverable: boolean; // up, and part of what's on show
	detail?: string; // a second line under the name: a star's type, or an image credit while a real image shows
	focusFov?: number; // field of view (degrees) to frame it when locking on, for things without a disk
}

/** A short credit line for the hover tip ("Image: NASA, ESA · Public domain"); the credits page has the full text. */
function creditLine(c: ImageCredit | undefined): string | undefined {
	if (!c) return undefined;
	const artist = c.artist.length > 60 ? `${c.artist.slice(0, 57).trimEnd()}…` : c.artist;
	return `Image: ${artist} · ${c.license}`;
}
let skyItems: SkyItem[] = [];
// Each constellation fades in once fully risen and out as it starts to set.
let skyConstellations: {
	items: SkyItem[];
	stars: THREE.ShaderMaterial;
	lines: THREE.LineBasicMaterial;
	opacity: number;
}[] = [];
// Comets, placed from their orbits each frame; drawn only while bright enough to see.
let skyComets: { item: SkyItem; visual: CometVisual; comet: (typeof comets)[number] }[] = [];
// Meteor showers: radiants and falling meteors while each shower is active.
let skyMeteors: { showers: MeteorShowers; items: SkyItem[] } | null = null;
// Famous stars without a stick figure (looseStars), each shown whenever it's up.
let skyLoose: { items: SkyItem[]; stars: THREE.ShaderMaterial } | null = null;
// The planets and Moon: their visuals, and a point of light for when the disk is too small to see.
let skyBodies: {
	name: BodyName;
	item: SkyItem;
	visual: BodyVisual;
	glow: THREE.ShaderMaterial | null;
	glowPosition: THREE.BufferAttribute | null;
}[] = [];
// Galaxies, nebulae and star clusters: an image each, fixed on the celestial sphere.
let skyDeep: {
	item: SkyItem;
	mesh: THREE.Mesh;
	material: THREE.MeshBasicMaterial;
	size: [number, number]; // true major and minor axis, radians
	brightness: number;
	catalog: string;
	round: boolean; // nearly circular: keep the photo's own orientation
	photo: DeepSkyPhoto | null; // a real photo, loaded once the telescope zooms in on it
}[] = [];
let lastDeepSkyUpdate = 0;

interface DeepSkyPhoto {
	material: THREE.ShaderMaterial;
	stage: 'loading' | 'small' | 'large';
	mix: number; // 0 = painted image, 1 = photo
}
let hoveredItem: SkyItem | null = null;
let trackedItem: SkyItem | null = null; // a body the telescope is following
// 0 -> 1 over the first moments of following a body: the view eases onto it, then
// locks on exactly, so it keeps up however fast the sky is turning.
let trackLock = 0;
let pressedBody: SkyItem | null = null; // the body under the pointer when it was pressed
let autoZoomOut = false; // zooming back out at AUTO_ZOOM_OUT_RATE; any manual zoom stops it
// Shared by every star material (and the planets' points of light).
const starUniforms = {
	uTime: { value: 0 },
	uScale: { value: 1 }, // pixels per unit of point size at distance 1
	uUp: { value: new THREE.Vector3() }, // the visitor's zenith, for altitude-based twinkle
	uEye: { value: new THREE.Vector3() },
	uTwinkle: { value: TWINKLE_STRENGTH },
	uMap: { value: null as THREE.Texture | null },
	uAtlas: { value: null as THREE.Texture | null },
	uZoom: { value: 1 }, // telescope magnification, for the close-up star images
};
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
// Fingers (or the mouse) currently pressed on the stage, for two-finger pinch zoom in the sky view.
const pointers = new Map<number, { x: number; y: number }>();
let pinch: { distance: number; fov: number } | null = null; // finger spread and zoom when the pinch began
const hover = { active: false, x: 0, y: 0 }; // pointer position over the stage, for the star name tip
let suppressClick = false;
const spin = { x: 0, y: 0 };
const look = { yaw: 0, pitch: THREE.MathUtils.degToRad(4) };
// Where the sky view is easing toward (zooming toward the cursor, focusing on a planet).
// Dragging moves both together.
const lookTarget = { ...look };
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
	starAtlas = makeStarAtlas();

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
		// In the sky view the starfield turns with the celestial sphere instead (updateSky).
		if (!reduceMotion && !celestial && view !== 'surface') {
			const drift = STAR_DRIFT_SPEED[view];
			stars.rotation.y += dt * drift;
			stars.rotation.x += dt * drift * 0.4;
		}
		if (groundMaterial) groundMaterial.uniforms.uOpacity.value = skyFade.ground;
		if (celestial) updateSky(dt, t);
		if (view === 'surface' && !busy && !drag.active) {
			if (trackedItem) trackLock = Math.min(1, trackLock + dt / TRACK_LOCK_SECONDS);
			const ease = trackedItem && trackLock >= 1 ? 1 : Math.min(1, dt * 8 + trackLock * trackLock);
			look.yaw += (lookTarget.yaw - look.yaw) * ease;
			look.pitch += (lookTarget.pitch - look.pitch) * ease;
		}
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
	window.addEventListener(
		'pointercancel',
		(e) => {
			drag.active = false;
			pointers.delete(e.pointerId);
			pinch = null;
		},
		{ signal },
	);
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
	surfaceFrame = { eye: site.clone().addScaledVector(n, SURFACE_HEIGHT), n, t, r };
	skyFade.stars = skyFade.lines = 0;
	const aim = buildSky();
	skyZoom.fov = skyZoom.target; // land already zoomed to fit
	look.yaw = lookTarget.yaw = aim.yaw;
	look.pitch = lookTarget.pitch = aim.pitch;

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

	// Name tip: the star, planet or Moon nearest the pointer, if close enough (anywhere
	// on a body's disk counts). Rechecked every frame, so it stays right while
	// looking around or zooming.
	let nearest: { item: SkyItem; x: number; y: number; radius: number } | null = null;
	if (view === 'surface' && !busy && hover.active && !drag.active) {
		camera.getWorldDirection(forward);
		const pxPerRadian = h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
		let nearestDistance = Infinity;
		const world = new THREE.Vector3();
		for (const item of skyItems) {
			if (!item.hoverable) continue;
			worldOf(item, world);
			if (tmp.copy(world).sub(camera.position).dot(forward) <= 0) continue; // behind the camera
			const [x, y] = toScreen(tmp.copy(world), w, h);
			const radius = (item.angularRadius ?? 0) * pxPerRadian;
			const distance = Math.hypot(x - hover.x, y - hover.y);
			if (distance < Math.max(STAR_HOVER_RADIUS, radius) && distance < nearestDistance) {
				nearestDistance = distance;
				nearest = { item, x, y, radius };
			}
		}
	}
	hoveredItem = nearest?.item ?? null;
	binding.stage.classList.toggle('is-over-body', !!hoveredItem); // everything named can be locked onto
	const tip = binding.starTip;
	tip.classList.toggle('is-visible', !!nearest);
	if (nearest) {
		// The name, plus a smaller line underneath (a star's type, or an image credit).
		const { name, detail } = nearest.item;
		const text = detail ? `${name}\n${detail}` : name;
		if (tip.dataset.text !== text) {
			tip.dataset.text = text;
			tip.replaceChildren(name, ...(detail ? [Object.assign(document.createElement('small'), { textContent: detail })] : []));
		}
		// Above the star, or above the top of a body's disk.
		const lift = Math.max(12, nearest.radius + 8);
		tip.style.transform = `translate3d(${nearest.x}px, ${nearest.y}px, 0) translate(-50%, calc(-100% - ${lift}px))`;
	}

	// Telescope magnification, once zoomed in past the naked eye.
	const magnification = NAKED_EYE_FOV / camera.fov;
	const showReadout = view === 'surface' && !busy && magnification >= 1.5;
	binding.zoomBox.classList.toggle('is-visible', showReadout);
	if (showReadout) {
		const text = `${magnification < 10 ? magnification.toFixed(1) : Math.round(magnification).toLocaleString()}×`;
		if (binding.zoomReadout.textContent !== text) binding.zoomReadout.textContent = text;
	}
}

// ---------------------------------------------------------------------------
// Dragging and the egg

function onPointerDown(e: PointerEvent) {
	suppressClick = false;
	trackHover(e);
	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
	if (busy || view === 'orbit') return;
	// A second finger in the sky view starts a pinch instead of a drag.
	if (view === 'surface' && pointers.size === 2) {
		drag.active = false;
		pinch = { distance: pinchDistance(), fov: skyZoom.target };
		return;
	}
	drag.active = true;
	drag.x = e.clientX;
	drag.y = e.clientY;
	drag.moved = 0;
	// Pick the body now, while it's under the finger: with time running fast it may
	// have moved on by the time the pointer is released.
	pressedBody = view === 'surface' ? bodyAt(e.clientX, e.clientY) : null;
}

/**
 * The planet, Moon, galaxy, nebula, cluster or star at a screen point (whatever
 * the telescope can focus on), with a generous margin for small or moving bodies
 * and a tighter one for stars.
 */
function bodyAt(x: number, y: number): SkyItem | null {
	if (!celestial) return null;
	const w = window.innerWidth;
	const h = window.innerHeight;
	const pxPerRadian = h / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
	camera.getWorldDirection(forward);
	let best: SkyItem | null = null;
	let bestDistance = Infinity;
	for (const item of skyItems) {
		if (!item.hoverable) continue;
		const world = worldOf(item);
		if (tmp.copy(world).sub(camera.position).dot(forward) <= 0) continue; // behind the camera
		const [sx, sy] = toScreen(world, w, h);
		const distance = Math.hypot(sx - x, sy - y);
		// Bodies and comets get a generous margin; stars a tighter one.
		const reach = item.angularRadius
			? Math.max(BODY_PICK_RADIUS, item.angularRadius * pxPerRadian)
			: item.focusFov
				? BODY_PICK_RADIUS
				: STAR_HOVER_RADIUS;
		if (distance < reach && distance < bestDistance) {
			best = item;
			bestDistance = distance;
		}
	}
	return best;
}

function onPointerMove(e: PointerEvent) {
	const stage = binding?.stage;
	if (!stage) return;
	trackHover(e);
	if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
	if (pinch) {
		// Zoom by how far the fingers have spread (or closed), toward the point between them.
		const [a, b] = [...pointers.values()];
		zoomToward(clamp((pinch.fov * pinch.distance) / pinchDistance(), SKY_ZOOM_MIN, SKY_ZOOM_MAX), (a.x + b.x) / 2, (a.y + b.y) / 2);
		return;
	}
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
		if (drag.moved > DRAG_THRESHOLD) trackedItem = null; // looking around stops following a body
		look.yaw = lookTarget.yaw = look.yaw - dx * speed;
		look.pitch = lookTarget.pitch = clamp(look.pitch + dy * speed, -0.35, SKY_PITCH_MAX);
	}
}

/** Remember where the pointer is, for the star name tip (a tap counts too). */
function trackHover(e: PointerEvent) {
	hover.x = e.clientX;
	hover.y = e.clientY;
	hover.active = true;
}

/** Distance in pixels between the two fingers of a pinch. */
function pinchDistance(): number {
	const [a, b] = [...pointers.values()];
	return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
}

/** Sky view: the scroll wheel zooms in and out, toward whatever is under the cursor. */
function onWheel(e: WheelEvent) {
	if (view !== 'surface' || busy) return;
	e.preventDefault();
	zoomToward(clamp(skyZoom.target * Math.exp(e.deltaY * 0.0025), SKY_ZOOM_MIN, SKY_ZOOM_MAX), e.clientX, e.clientY);
}

/**
 * Zoom the sky view to a field of view (degrees), toward a point on screen: the
 * view shifts so that point stays roughly where it is, as with the wheel or a pinch.
 */
function zoomToward(after: number, screenX: number, screenY: number) {
	autoZoomOut = false;
	const before = skyZoom.target;
	skyZoom.target = after;
	if (trackedItem) return; // following a body: zoom on it, not toward the pointer
	// The point's angular offset from the view's center...
	const tanHalf = Math.tan(THREE.MathUtils.degToRad(before) / 2);
	const ndcX = (screenX / window.innerWidth) * 2 - 1;
	const ndcY = 1 - (screenY / window.innerHeight) * 2;
	const offYaw = Math.atan(ndcX * tanHalf * camera.aspect) / Math.max(0.2, Math.cos(lookTarget.pitch));
	const offPitch = Math.atan(ndcY * tanHalf);
	// ...of which this much needs to become the new center: all of it zoomed in infinitely, none for no change.
	const share = 1 - after / before;
	lookTarget.yaw += offYaw * share;
	lookTarget.pitch = clamp(lookTarget.pitch + offPitch * share, -0.35, SKY_PITCH_MAX);
}

/**
 * Sky view: center a body or star, zoom the telescope to frame it, and keep
 * following it as the sky turns (until the visitor drags to look elsewhere).
 */
function focusOn(item: SkyItem) {
	trackedItem = item;
	trackLock = 0;
	autoZoomOut = false;
	aimAt(item);
	// Fill about a third of the view's height; a star (a point) gets its close-up.
	const fov = item.focusFov ?? (item.angularRadius ? THREE.MathUtils.radToDeg(item.angularRadius * 2) * 3 : STAR_FOCUS_FOV);
	skyZoom.target = clamp(fov, SKY_ZOOM_MIN, SKY_ZOOM_MAX);
}

/** Sky view: ease the telescope back out to the naked eye (still following whatever it was on). */
export function zoomOutSky() {
	if (view === 'surface' && skyZoom.target < NAKED_EYE_FOV) autoZoomOut = true;
}

/**
 * Sky view: lock the telescope onto a sky item by its search key (see skyFinder.ts).
 * False if it isn't on show right now (below the horizon, or its constellation isn't fully up).
 */
export function lockOnto(key: string): boolean {
	const item = skyItems.find((i) => i.key === key);
	if (view !== 'surface' || busy || !item?.hoverable) return false;
	focusOn(item);
	return true;
}

/**
 * Sky view: turn to look toward an altitude and azimuth (radians; azimuth from
 * north through east), optionally zooming to a field of view (degrees). Stops
 * following anything.
 */
export function lookToward(alt: number, az: number, fov?: number) {
	if (view !== 'surface' || busy) return;
	trackedItem = null;
	autoZoomOut = false;
	lookTarget.yaw = az + 2 * Math.PI * Math.round((look.yaw - az) / (2 * Math.PI)); // the short way round
	lookTarget.pitch = clamp(alt, -0.35, SKY_PITCH_MAX);
	if (fov !== undefined) skyZoom.target = clamp(fov, SKY_ZOOM_MIN, SKY_ZOOM_MAX);
}

/** Sky view: where the view points (radians; heading = azimuth from north through east), or null outside it. */
export function getSkyLook(): { heading: number; pitch: number } | null {
	if (view !== 'surface' || !surfaceFrame) return null;
	return { heading: ((look.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), pitch: look.pitch };
}

/** Point the sky view (eased by the frame loop) at a sky item. */
function aimAt(item: SkyItem) {
	const { eye, n, t, r } = surfaceFrame!;
	const dir = worldOf(item).sub(eye).normalize();
	const yaw = Math.atan2(dir.dot(r), dir.dot(t));
	lookTarget.yaw = yaw + 2 * Math.PI * Math.round((look.yaw - yaw) / (2 * Math.PI)); // the short way round
	lookTarget.pitch = clamp(Math.asin(dir.dot(n)), -0.35, SKY_PITCH_MAX);
}

function onPointerUp(e: PointerEvent) {
	pointers.delete(e.pointerId);
	if (pinch) {
		if (pointers.size < 2) {
			// Pinch over. A finger still down carries on looking around from where it is,
			// and nothing here counts as a tap.
			pinch = null;
			const rest = pointers.values().next().value;
			drag.active = !!rest;
			if (rest) {
				drag.x = rest.x;
				drag.y = rest.y;
				drag.moved = DRAG_THRESHOLD + 1;
			}
		}
		return;
	}
	if (!drag.active) return;
	drag.active = false;
	if (drag.moved > DRAG_THRESHOLD) {
		// Swallow only the click this same release produces, not later keyboard clicks.
		suppressClick = true;
		setTimeout(() => (suppressClick = false));
	} else if (view === 'planet' && !busy && hitsEgg(e)) binding?.onEgg();
	else if (view === 'surface' && !busy && pressedBody) focusOn(pressedBody);
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

const BODY_NAMES: BodyName[] = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const BODY_DISTANCE = SKY_RADIUS * 0.97; // just in front of the stars, so the Moon can pass over them
const DEEP_SKY_DISTANCE = SKY_RADIUS * 1.01; // just behind the stars
const COMET_DISTANCE = SKY_RADIUS * 0.98; // in front of the stars, behind the Moon and planets
const METEOR_DISTANCE = SKY_RADIUS * 0.96; // in front of everything: meteors burn up in our own air
// Deep-sky objects smaller than this on screen (pixels) are drawn this big, and dimmer, so they can be found.
const DEEP_SKY_MIN_PX = 14;
// The images fade out toward their edges, so draw them a bit larger than the object's catalog size.
const DEEP_SKY_IMAGE_SCALE = 1.3;
// Swap in a real photo once an object is this many pixels across, and a sharper one past the second size.
const DEEP_SKY_PHOTO_PX = 120;
const DEEP_SKY_PHOTO_LARGE_PX = 500;

/** A point on the celestial sphere (celestial group's frame) from RA (hours) and Dec (degrees). */
function celestialDir(ra: number, dec: number): THREE.Vector3 {
	return new THREE.Vector3(...equatorialVector(ra, dec));
}

/**
 * Draw the sky view: every catalog constellation and the Moon and planets on a
 * celestial sphere around the visitor, plus the ground. The sphere is rotated
 * each frame for the simulated time (updateSky), so everything rises and sets
 * together. Returns the look direction that centers the featured (best placed)
 * constellation; the landing frame's t is north, r is east and n is the zenith.
 */
function buildSky(): { yaw: number; pitch: number } {
	removeSky();
	const { eye, n, t, r } = surfaceFrame!;
	const now = skyNow();
	const choice = chooseSky(getObserver(), now);
	const featured = choice.featured;
	skyInfo = { constellation: featured.constellation.name, place: choice.place };

	sky = new THREE.Group();
	celestial = new THREE.Group();
	celestial.position.copy(eye);
	sky.add(celestial);
	orientCelestial(now);
	starUniforms.uMap.value = glowTexture;
	starUniforms.uAtlas.value = starAtlas;
	starUniforms.uUp.value.copy(n);
	starUniforms.uEye.value.copy(eye);
	starUniforms.uTwinkle.value = reduceMotion ? 0 : TWINKLE_STRENGTH;

	// Every constellation; updateSky shows each one while it's fully above the horizon.
	for (const constellation of constellations) {
		const local = new Map(constellation.stars.map((s) => [s.name, celestialDir(s.ra, s.dec).multiplyScalar(SKY_RADIUS)]));
		const items: SkyItem[] = constellation.stars.map((s) => ({
			key: `star:${s.name}`,
			name: `${s.name} · ${constellation.name} · ${s.ly.toLocaleString('en-US')} light-years`, // "Star · Constellation · distance"
			local: local.get(s.name)!,
			hoverable: false,
			detail: starDetail(s),
		}));
		const stars = starMaterial();
		celestial.add(
			new THREE.Points(
				starGeometry(
					constellation.stars.map((s) => ({
						local: local.get(s.name)!,
						size: starSize(s.mag),
						color: starColor(s.bv),
						twinkle: true,
						type: starType(s.bv),
					})),
				),
				stars,
			),
		);
		const lines = new THREE.LineBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0 });
		const linePoints = constellation.lines.flatMap(([a, b]) => [local.get(a)!, local.get(b)!]);
		celestial.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePoints), lines));
		const up = constellationAltitudes(items).every((sinAlt) => sinAlt > 0);
		skyConstellations.push({ items, stars, lines, opacity: up ? 1 : 0 });
		skyItems.push(...items);
	}

	// Famous stars without a stick figure, shown whenever they're up.
	{
		const items: SkyItem[] = looseStars.map((s) => ({
			key: `star:${s.name}`,
			name: `${s.name} · ${s.constellation} · ${s.ly.toLocaleString('en-US')} light-years`,
			local: celestialDir(s.ra, s.dec).multiplyScalar(SKY_RADIUS),
			hoverable: false,
			detail: starDetail(s),
		}));
		const material = starMaterial();
		celestial.add(
			new THREE.Points(
				starGeometry(
					looseStars.map((s, i) => ({
						local: items[i].local,
						size: starSize(s.mag),
						// Stars past the naked-eye limit are drawn dim.
						color: starColor(s.bv).multiplyScalar(s.mag > NAKED_EYE_LIMIT ? 0.45 : 1),
						twinkle: true,
						type: starType(s.bv),
					})),
				),
				material,
			),
		);
		skyLoose = { items, stars: material };
		skyItems.push(...items);
	}

	// Galaxies, nebulae and star clusters, each an image at its true size and tilt.
	deepSky.forEach((o, i) => {
		const dir = celestialDir(o.ra, o.dec);
		const center = dir.clone().multiplyScalar(DEEP_SKY_DISTANCE);
		const material = new THREE.MeshBasicMaterial({
			map: deepSkyTexture(o.kind, i),
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending, // faint light adds up on the dark sky
			opacity: 0,
		});
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
		mesh.position.copy(center);
		// Face the visitor, with the image's long axis at the object's position angle
		// (measured from celestial north through east).
		const north = new THREE.Vector3(0, 0, 1).addScaledVector(dir, -dir.z);
		if (north.lengthSq() < 1e-8) north.set(1, 0, 0);
		north.normalize();
		const east = new THREE.Vector3().crossVectors(north, dir);
		const angle = THREE.MathUtils.degToRad(o.angle);
		const y = north.clone().multiplyScalar(Math.cos(angle)).addScaledVector(east, Math.sin(angle));
		const z = dir.clone().negate();
		const x = new THREE.Vector3().crossVectors(y, z);
		mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
		celestial!.add(mesh);
		const size: [number, number] = [THREE.MathUtils.degToRad(o.size[0] / 60), THREE.MathUtils.degToRad(o.size[1] / 60)];
		const item: SkyItem = {
			key: `deep:${o.catalog}`,
			name: `${o.name} · ${o.catalog} · ${o.distance}`,
			local: center,
			angularRadius: size[0] / 2,
			hoverable: false,
		};
		// Brighter objects (lower magnitude) glow more strongly.
		skyDeep.push({
			item,
			mesh,
			material,
			size,
			brightness: clamp((11 - o.mag) / 8, 0.35, 1),
			catalog: o.catalog,
			round: o.size[1] / o.size[0] > 0.8,
			photo: null,
		});
		skyItems.push(item);
	});

	// Comets; updateSky moves them along their orbits.
	for (const comet of comets) {
		const visual = createCometVisual(comet, COMET_DISTANCE);
		celestial.add(visual.object);
		const item: SkyItem = { key: `comet:${comet.id}`, name: comet.name, local: new THREE.Vector3(), hoverable: false };
		skyComets.push({ item, visual, comet });
		skyItems.push(item);
	}

	// Meteor showers, each with a hoverable radiant while active.
	{
		const showers = createMeteorShowers(METEOR_DISTANCE);
		celestial.add(showers.object);
		const items = showers.showers.map(({ shower, radiant }) => ({
			key: `shower:${shower.id}`,
			name: `${shower.name} meteor shower · radiant`,
			local: radiant.clone().multiplyScalar(METEOR_DISTANCE),
			hoverable: false,
			focusFov: NAKED_EYE_FOV,
		}));
		skyMeteors = { showers, items };
		skyItems.push(...items);
	}

	// The Moon and planets; updateSky moves them as simulated time passes.
	for (const name of BODY_NAMES) {
		const visual = createBodyVisual(name);
		celestial.add(visual.object);
		let glow: THREE.ShaderMaterial | null = null;
		let glowPosition: THREE.BufferAttribute | null = null;
		if (name !== 'Moon') {
			// A point of light for when the disk is too small to see. Unlike the stars it
			// doesn't twinkle: planets are disks, not points. Sized in updateSky by brightness.
			glow = starMaterial();
			const geometry = starGeometry([
				{ local: new THREE.Vector3(), size: 1, color: new THREE.Color(PLANET_GLOW[name]), twinkle: false },
			]);
			glowPosition = geometry.getAttribute('position') as THREE.BufferAttribute;
			celestial.add(new THREE.Points(geometry, glow));
		}
		const item: SkyItem = { key: `body:${name}`, name, local: new THREE.Vector3(), hoverable: false };
		skyBodies.push({ name, item, visual, glow, glowPosition });
		skyItems.push(item);
	}
	updateBodies(now);

	sky.add(buildGround());
	scene.add(sky);

	const dirOf = (alt: number, az: number) =>
		new THREE.Vector3()
			.addScaledVector(t, Math.cos(alt) * Math.cos(az))
			.addScaledVector(r, Math.cos(alt) * Math.sin(az))
			.addScaledVector(n, Math.sin(alt));
	// Aim at and fit the featured constellation.
	const center = featured.stars.reduce((sum, s) => sum.add(dirOf(s.alt, s.az)), new THREE.Vector3()).normalize();
	// Zoom so the constellation fills SKY_FILL of the view, measured along the narrower screen side.
	const spread = Math.max(...featured.stars.map((s) => dirOf(s.alt, s.az).angleTo(center)));
	const narrowSide = Math.min(1, camera.aspect);
	const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(spread) / (SKY_FILL * narrowSide)));
	skyZoom.target = clamp(fov, SURFACE_FOV_MIN, SURFACE_FOV_MAX);
	return { yaw: Math.atan2(center.dot(r), center.dot(t)), pitch: clamp(Math.asin(center.dot(n)), -0.35, SKY_PITCH_MAX) };
}

function removeSky() {
	if (sky) {
		scene.remove(sky);
		sky.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			mesh.geometry?.dispose();
			if (mesh.material && !Array.isArray(mesh.material)) {
				(mesh.material as THREE.MeshBasicMaterial).map?.dispose(); // the deep-sky images
				mesh.material.dispose();
			}
		});
	}
	sky = null;
	celestial = null;
	groundMaterial = null;
	skyItems = [];
	skyConstellations = [];
	skyLoose = null;
	skyBodies = [];
	skyDeep = [];
	skyComets = [];
	skyMeteors = null;
	hoveredItem = null;
	trackedItem = null;
}

/**
 * Turn the celestial sphere to match the sky at a moment, for the current
 * observer. In the landing frame (t north, r east, n up), the celestial pole sits
 * at the observer's latitude above the northern horizon, and the sphere has
 * turned by the local sidereal time; this builds that rotation from the
 * equatorial axes (x to RA 0h, y to RA 6h, z to the pole).
 */
function orientCelestial(date: Date) {
	const { n, t, r } = surfaceFrame!;
	const obs = getObserver();
	const lat = THREE.MathUtils.degToRad(obs.lat);
	const pole = t.clone().multiplyScalar(Math.cos(lat)).addScaledVector(n, Math.sin(lat));
	const meridian = t.clone().multiplyScalar(-Math.sin(lat)).addScaledVector(n, Math.cos(lat)); // equator, due south
	const west = r.clone().negate();
	const lst = siderealAngle(obs, date);
	const x = meridian.clone().multiplyScalar(Math.cos(lst)).addScaledVector(west, Math.sin(lst));
	const y = meridian.clone().multiplyScalar(Math.sin(lst)).addScaledVector(west, -Math.cos(lst));
	celestial!.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, pole));
	celestial!.updateMatrixWorld(true);
}

/** Sine of the altitude of each item (above the horizon when positive). */
function constellationAltitudes(items: SkyItem[]): number[] {
	return items.map((item) => tmp.copy(item.local).normalize().applyQuaternion(celestial!.quaternion).dot(surfaceFrame!.n));
}

/** World position of a sky item. */
function worldOf(item: SkyItem, out = new THREE.Vector3()): THREE.Vector3 {
	return out.copy(item.local).applyMatrix4(celestial!.matrixWorld);
}

/**
 * Each frame in the sky view: turn the celestial sphere to the simulated time,
 * fade constellations in and out as they finish rising or start setting, move
 * the Moon and planets, and keep the background starfield turning with the sky.
 */
function updateSky(dt: number, t: number) {
	const now = skyNow();
	orientCelestial(now);
	starUniforms.uTime.value = t;
	starUniforms.uScale.value = renderer.getPixelRatio() * window.innerHeight * 0.5;
	starUniforms.uZoom.value = NAKED_EYE_FOV / camera.fov;

	if (skyLoose) {
		skyLoose.stars.uniforms.uOpacity.value = skyFade.stars;
		const altitudes = constellationAltitudes(skyLoose.items);
		skyLoose.items.forEach((item, i) => (item.hoverable = altitudes[i] > 0));
	}
	for (const c of skyConstellations) {
		const altitudes = constellationAltitudes(c.items);
		const target = altitudes.every((sinAlt) => sinAlt > 0) ? 1 : 0;
		c.opacity += (target - c.opacity) * Math.min(1, dt * 3);
		c.stars.uniforms.uOpacity.value = c.opacity * skyFade.stars;
		c.lines.opacity = c.opacity * skyFade.lines;
		c.items.forEach((item, i) => (item.hoverable = c.opacity > 0.5 && altitudes[i] > 0));
	}
	updateDeepSky();
	updateComets(now, dt);
	if (skyMeteors) {
		const { showers, items } = skyMeteors;
		const sinAlt = (d: THREE.Vector3) => tmp.copy(d).applyQuaternion(celestial!.quaternion).dot(surfaceFrame!.n);
		// With reduced motion, no meteors fall (the radiants still show).
		showers.update(now, reduceMotion ? 0 : dt, skyFade.stars, sinAlt);
		showers.showers.forEach(({ shower, radiant, activity }, i) => {
			items[i].hoverable = activity.active && sinAlt(radiant) > 0;
			items[i].detail = `Peaks ${shortDate(activity.window.peak)} · about ${Math.round(activity.rate)} an hour now · shown ${METEOR_SPEEDUP}× faster · from ${shower.parent}`;
		});
	}
	updateBodies(now);

	// The faint background stars turn with the sky too, centered on the visitor.
	stars.position.copy(surfaceFrame!.eye);
	stars.quaternion.copy(celestial!.quaternion);

	// A focused body: keep the telescope on it as the sky turns, until it sets. Then
	// zoom back out, so the view isn't left staring into the ground.
	if (trackedItem && !trackedItem.hoverable) {
		trackedItem = null;
		autoZoomOut = true;
	}
	if (trackedItem && view === 'surface' && !busy && !drag.active) aimAt(trackedItem);
	if (autoZoomOut) {
		skyZoom.target = Math.min(NAKED_EYE_FOV, Math.max(skyZoom.target, SKY_ZOOM_MIN) * AUTO_ZOOM_OUT_RATE ** dt);
		if (skyZoom.target >= NAKED_EYE_FOV) autoZoomOut = false;
	}
}

/**
 * Each frame: fade the galaxies, nebulae and clusters with the sky, mark which are
 * up (for hovering), and keep small ones at least DEEP_SKY_MIN_PX across so they
 * can be spotted, dimming them to match, until the telescope zooms in enough to
 * show them at their true size.
 */
function updateDeepSky() {
	const pxPerRadian = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
	const now = performance.now();
	const dt = lastDeepSkyUpdate ? Math.min(0.1, (now - lastDeepSkyUpdate) / 1000) : 0;
	lastDeepSkyUpdate = now;
	for (const d of skyDeep) {
		d.item.hoverable = constellationAltitudes([d.item])[0] > 0;
		const truePx = d.size[0] * pxPerRadian;
		const enlarge = Math.max(1, DEEP_SKY_MIN_PX / truePx);
		const scale = 2 * DEEP_SKY_DISTANCE * DEEP_SKY_IMAGE_SCALE * enlarge;
		d.mesh.scale.set(scale * Math.tan(d.size[1] / 2), scale * Math.tan(d.size[0] / 2), 1);

		// Zoomed in on it: fetch the real photo (only for objects that are up and in view).
		const wanted = truePx > DEEP_SKY_PHOTO_PX && d.item.hoverable && inView(d.mesh);
		const image = deepSkyImages[d.catalog];
		if (image && wanted && !d.photo) loadDeepSkyPhoto(d, image.small);
		if (image && d.photo?.stage === 'small' && truePx > DEEP_SKY_PHOTO_LARGE_PX && inView(d.mesh)) {
			d.photo.stage = 'loading';
			const photo = d.photo;
			loadSkyImage(image.large)
				.then(({ texture }) => {
					photo.material.uniforms.uMap.value = texture;
					photo.stage = 'large';
				})
				.catch(() => (photo.stage = 'small'));
		}
		const photo = d.photo;
		const ready = photo !== null && photo.material.uniforms.uMap.value !== null;
		if (photo) {
			const target = ready && truePx > DEEP_SKY_PHOTO_PX ? 1 : 0;
			photo.mix = target > photo.mix ? Math.min(target, photo.mix + dt * 2) : Math.max(target, photo.mix - dt * 2);
			photo.material.uniforms.uOpacity.value = skyFade.stars * photo.mix;
		}
		const mix = photo?.mix ?? 0;
		d.material.opacity = skyFade.stars * d.brightness * Math.max(0.3, enlarge ** -0.6) * (1 - mix);
		d.item.detail = mix > 0.5 ? creditLine(image) : undefined;
	}
}

/** Whether an object's center is on screen, or close to it. */
function inView(object: THREE.Object3D): boolean {
	const p = object.getWorldPosition(new THREE.Vector3()).project(camera);
	return p.z < 1 && Math.abs(p.x) < 1.5 && Math.abs(p.y) < 1.5;
}

/**
 * Load a deep-sky object's photo and lay it over the painted image. Photos come
 * framed and turned every which way, so measure where the light is (its center,
 * spread and long axis) and turn and scale the photo to match the catalog: long
 * axis along the object's position angle, about four standard deviations of its
 * light spanning the catalog size.
 */
function loadDeepSkyPhoto(d: (typeof skyDeep)[number], url: string) {
	const material = photoMaterial();
	const photo: DeepSkyPhoto = { material, stage: 'loading', mix: 0 };
	d.photo = photo;
	loadSkyImage(url)
		.then(({ texture, bitmap }) => {
			const fit = fitPhoto(bitmap);
			// Size of the photo's long side on the sky, kept within sensible framing.
			const major = d.size[0];
			const longSide = clamp(major / (4 * fit.spread), major * 1.2, major * 6);
			const width = longSide * Math.min(1, fit.aspect);
			const height = longSide * Math.min(1, 1 / fit.aspect);
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
			mesh.scale.set(2 * DEEP_SKY_DISTANCE * Math.tan(width / 2), 2 * DEEP_SKY_DISTANCE * Math.tan(height / 2), 1);
			// Turn the photo's long axis onto the object's (the painted image's y axis).
			mesh.rotation.z = d.round ? 0 : Math.PI / 2 - fit.angle;
			// Move the photo so its light, not its frame, sits on the object's position.
			const offset = new THREE.Vector3(
				-clamp(fit.center[0] - 0.5, -0.25, 0.25) * mesh.scale.x,
				-clamp(fit.center[1] - 0.5, -0.25, 0.25) * mesh.scale.y,
				0,
			).applyEuler(mesh.rotation);
			mesh.position.copy(offset);
			// Shares the painted image's place and turn, without its stretch.
			const pivot = new THREE.Group();
			pivot.position.copy(d.mesh.position);
			pivot.quaternion.copy(d.mesh.quaternion);
			pivot.add(mesh);
			d.mesh.parent?.add(pivot);
			material.uniforms.uBackground.value.copy(fit.background);
			material.uniforms.uMap.value = texture;
			photo.stage = 'small';
		})
		.catch(() => (d.photo = null)); // try again next time
}

/**
 * Each frame: move the comets along their orbits, show those bright enough to
 * see, and keep their hover names (distance, brightness) current.
 */
function updateComets(now: Date, dt: number) {
	const pxPerRadian = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
	for (const { item, visual, comet } of skyComets) {
		const state = cometState(comet, now);
		visual.update(state, { opacity: skyFade.stars, pxPerRadian, dt, inView: inView(visual.object.children[0]) });
		item.local.copy(visual.head);
		const bright = state.magnitude < COMET_LIMIT;
		item.hoverable = bright && constellationAltitudes([item])[0] > 0;
		item.name = `${comet.name} · ${state.distance.toFixed(2)} AU · magnitude ${state.magnitude.toFixed(1)}`;
		item.detail = visual.showingPhoto() ? creditLine(cometImages[comet.id]) : comet.about;
		// Frame the whole tail when locking on.
		item.focusFov = clamp(THREE.MathUtils.radToDeg(visual.tailAngle()) * 1.8, 1, NAKED_EYE_FOV);
	}
}

/**
 * Place the Moon and planets for a moment: their sky positions, sizes, phases
 * (from the direction of the Sun) and orientations; spin the planets; and swap
 * each planet's point of light for its disk once the telescope zooms in far
 * enough to see it.
 */
function updateBodies(now: Date) {
	const obs = getObserver();
	const { bodies } = solarSystem(now);
	// The visitor's position on Earth, on the celestial sphere (RA = local sidereal time, Dec = latitude).
	const lst = siderealAngle(obs, now);
	const lat = THREE.MathUtils.degToRad(obs.lat);
	const zenith = new THREE.Vector3(Math.cos(lat) * Math.cos(lst), Math.cos(lat) * Math.sin(lst), Math.sin(lat));
	const pxPerRadian = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

	for (const entry of skyBodies) {
		const b = bodies.find((body) => body.name === entry.name)!;
		let dir = celestialDir(b.ra, b.dec);
		// The Moon is close enough that our spot on Earth's surface matters: seen from
		// the surface rather than Earth's center, it shifts by up to about 1°.
		if (b.name === 'Moon') dir = dir.multiplyScalar(b.earthRadii).sub(zenith).normalize();
		const center = dir.clone().multiplyScalar(BODY_DISTANCE);
		const [poleRa, poleDec] = BODY_POLES[b.name];
		entry.visual.setPose(
			center,
			BODY_DISTANCE * Math.tan(b.angularRadius),
			celestialDir(b.sunward.ra, b.sunward.dec),
			celestialDir(poleRa / 15, poleDec),
			dir.clone().negate(),
		);
		entry.visual.update(skyFade.stars, now.getTime(), 2 * b.angularRadius * pxPerRadian);

		const { item } = entry;
		item.local.copy(center);
		// Saturn's rings reach 2.27 planet radii, so frame and hover the whole system.
		item.angularRadius = b.angularRadius * (b.name === 'Saturn' ? 2.27 : 1);
		item.name =
			b.name === 'Moon'
				? `Moon · ${(Math.round((b.distance * KM_PER_AU) / 100) * 100).toLocaleString('en-US')} km · ${Math.round(b.litFraction * 100)}% lit`
				: `${b.name} · ${b.distance.toFixed(1)} AU (${Math.round((b.distance * KM_PER_AU) / 299792.458 / 60)} light-minutes)`;
		item.detail = entry.visual.showingMap() ? creditLine(planetMaps[b.name]) : undefined;
		const sinAlt = tmp.copy(dir).applyQuaternion(celestial!.quaternion).dot(surfaceFrame!.n);
		item.hoverable = sinAlt > 0;
		// Saturn's rings skip the depth test (see skyBodies.ts), so hide bodies below the horizon outright.
		entry.visual.object.visible = sinAlt > -0.02;

		if (entry.glow && entry.glowPosition) {
			entry.glowPosition.setXYZ(0, center.x, center.y, center.z);
			entry.glowPosition.needsUpdate = true;
			const size = entry.glow.uniforms.uSize;
			size.value = clamp(2.3 - 0.35 * b.magnitude, 0.8, 3.4);
			const diskPx = 2 * item.angularRadius * pxPerRadian;
			// Uranus and Neptune are at or past the naked-eye limit: just a dim point.
			const faint = clamp(1 - (b.magnitude - 4.5) * 0.2, 0.35, 1);
			entry.glow.uniforms.uOpacity.value = entry.visual.object.visible ? skyFade.stars * faint * (1 - smoothstep(3, 10, diskPx)) : 0;
		}
	}
}

/**
 * Star points: a shader so each star has its own size and color, and so the
 * twinkle runs on the GPU. Twinkling is stronger the lower a star sits (light
 * from near the horizon crosses more turbulent air), worked out from its current
 * altitude, so it stays right as the sky turns.
 */
function starMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		uniforms: { ...starUniforms, uOpacity: { value: 0 }, uSize: { value: 1 } },
		vertexShader: /* glsl */ `
			attribute float aSize;
			attribute vec3 aColor;
			attribute vec3 aTwinkle; // phase, two speeds (radians/second); speeds of 0 = no twinkle
			attribute float aType; // STAR_TYPES index; -1 = no close-up (the planets' points of light)
			uniform float uTime;
			uniform float uScale;
			uniform float uSize;
			uniform vec3 uUp;
			uniform vec3 uEye;
			uniform float uTwinkle;
			uniform float uZoom;
			varying vec3 vColor;
			varying float vTwinkle;
			varying float vType;
			varying float vDetail;
			void main() {
				vec4 world = modelMatrix * vec4(position, 1.0);
				vec4 view = viewMatrix * world;
				gl_Position = projectionMatrix * view;
				// Through the telescope, stars swap their soft glow for a close-up image of their type, drawn
				// larger, and keep growing as the zoom goes deeper so they can be seen up close.
				vDetail = aType < 0.0 ? 0.0 : smoothstep(${STAR_DETAIL_ZOOM[0].toFixed(1)}, ${STAR_DETAIL_ZOOM[1].toFixed(1)}, uZoom);
				vType = aType;
				float closeUp = (1.0 + 2.5 * vDetail) * pow(max(uZoom / ${STAR_DETAIL_ZOOM[1].toFixed(1)}, 1.0), 0.45 * vDetail);
				gl_PointSize = min(aSize * uSize * uScale / -view.z * closeUp, 480.0); // same sizing as THREE.PointsMaterial
				float sinAlt = dot(normalize(world.xyz - uEye), uUp);
				float amount = uTwinkle * (0.25 + 0.75 * (1.0 - max(sinAlt, 0.0)));
				float wave = 0.6 * sin(uTime * aTwinkle.y + aTwinkle.x) + 0.4 * sin(uTime * aTwinkle.z + aTwinkle.x * 1.7);
				vTwinkle = 1.0 + amount * wave;
				vColor = aColor * vTwinkle;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform sampler2D uMap;
			uniform sampler2D uAtlas;
			uniform float uOpacity;
			varying vec3 vColor;
			varying float vTwinkle;
			varying float vType;
			varying float vDetail;
			void main() {
				vec4 glow = texture2D(uMap, gl_PointCoord);
				vec4 color = vec4(vColor * glow.rgb, glow.a);
				if (vDetail > 0.0) {
					// The atlas is 3 tiles across and 2 down (makeStarAtlas); point coords run top down.
					float type = floor(vType + 0.5);
					vec2 tile = vec2(mod(type, 3.0), floor(type / 3.0));
					vec4 closeUp = texture2D(uAtlas, vec2((tile.x + gl_PointCoord.x) / 3.0, 1.0 - (tile.y + gl_PointCoord.y) / 2.0));
					color = mix(color, vec4(closeUp.rgb * vTwinkle, closeUp.a), vDetail);
				}
				gl_FragColor = vec4(color.rgb, color.a * uOpacity);
				#include <colorspace_fragment>
			}
		`,
	});
}

/** Geometry for starMaterial: one point per entry, with its size, color and twinkle. */
function starGeometry(
	entries: { local: THREE.Vector3; size: number; color: THREE.Color; twinkle: boolean; type?: number }[],
) {
	const geometry = new THREE.BufferGeometry().setFromPoints(entries.map((e) => e.local));
	const sizes = new Float32Array(entries.length);
	const types = new Float32Array(entries.map((e) => e.type ?? -1));
	const colors = new Float32Array(entries.length * 3);
	const twinkles = new Float32Array(entries.length * 3);
	entries.forEach((e, i) => {
		sizes[i] = e.size;
		e.color.toArray(colors, i * 3);
		if (e.twinkle) twinkles.set([Math.random() * Math.PI * 2, 4 + Math.random() * 10, 4 + Math.random() * 10], i * 3);
	});
	geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
	geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
	geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 3));
	geometry.setAttribute('aType', new THREE.BufferAttribute(types, 1));
	return geometry;
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
 * Sky view: redraw the sky for the current observer (after picking a new place,
 * see sky.ts) and turn to face its best placed constellation.
 */
export function refreshSky(): SkyInfo | null {
	if (view !== 'surface' || busy || !surfaceFrame) return null;
	// buildSky sets a new zoom target; the frame loop eases toward it.
	const aim = buildSky();
	// Turn the short way round (the frame loop eases toward it).
	lookTarget.yaw = aim.yaw + 2 * Math.PI * Math.round((look.yaw - aim.yaw) / (2 * Math.PI));
	lookTarget.pitch = aim.pitch;
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

/**
 * Spectral types by B−V color index, hottest first, with the look of each type's
 * close-up image. The boundaries are rounded; giants and dwarfs of one type differ
 * a little in color.
 */
const STAR_TYPES: { maxBv: number; label: string; core: string; halo: [number, number, number]; spikes: number }[] = [
	{ maxBv: -0.02, label: 'B-type star · hot, blue-white', core: '#eef3ff', halo: [140, 175, 255], spikes: 1 },
	{ maxBv: 0.3, label: 'A-type star · white', core: '#f6f8ff', halo: [195, 212, 255], spikes: 0.9 },
	{ maxBv: 0.62, label: 'F-type star · yellow-white', core: '#fffdf6', halo: [245, 240, 225], spikes: 0.8 },
	{ maxBv: 0.81, label: 'G-type star · yellow, like the Sun', core: '#fff8e8', halo: [255, 228, 175], spikes: 0.7 },
	{ maxBv: 1.55, label: 'K-type star · orange', core: '#fff0dc', halo: [255, 185, 115], spikes: 0.6 },
	{ maxBv: Infinity, label: 'M-type star · cool, red-orange', core: '#ffe6d2', halo: [255, 130, 85], spikes: 0.5 },
];

/** Point size for a star of a given magnitude: brighter stars get a bigger glow. */
function starSize(mag: number): number {
	return clamp(2.3 - 0.35 * mag, 0.8, 2.8);
}

// Stars fainter than this (magnitude) can't be seen without a telescope.
const NAKED_EYE_LIMIT = 6.5;

/** A star's hover line: its type, and whether it needs a telescope. */
function starDetail(s: SkyStar): string {
	const type = STAR_TYPES[starType(s.bv)].label;
	return s.mag > NAKED_EYE_LIMIT ? `${type} · too faint to see without a telescope` : type;
}

function starType(bv: number): number {
	return STAR_TYPES.findIndex((t) => bv < t.maxBv);
}

/**
 * Close-up star images, one per STAR_TYPES entry in a 3 × 2 grid: a white-hot core,
 * a halo in the type's color, and the four diffraction spikes a reflecting
 * telescope's mirror supports leave on bright stars.
 */
function makeStarAtlas(): THREE.Texture {
	const tile = 256;
	const c = tile / 2;
	const canvas = document.createElement('canvas');
	canvas.width = tile * 3;
	canvas.height = tile * 2;
	const ctx = canvas.getContext('2d')!;
	ctx.globalCompositeOperation = 'lighter';
	STAR_TYPES.forEach((type, i) => {
		ctx.save();
		ctx.translate((i % 3) * tile + c, Math.floor(i / 3) * tile + c);
		const [r, g, b] = type.halo;
		const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.7);
		halo.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
		halo.addColorStop(0.25, `rgba(${r},${g},${b},0.35)`);
		halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
		ctx.fillStyle = halo;
		ctx.fillRect(-c, -c, tile, tile);
		for (let k = 0; k < 4; k++) {
			ctx.rotate(Math.PI / 2);
			const spike = ctx.createLinearGradient(0, 0, c - 2, 0);
			spike.addColorStop(0, `rgba(${r},${g},${b},${0.9 * type.spikes})`);
			spike.addColorStop(1, `rgba(${r},${g},${b},0)`);
			ctx.fillStyle = spike;
			ctx.beginPath();
			ctx.moveTo(0, -3);
			ctx.lineTo(c - 2, 0);
			ctx.lineTo(0, 3);
			ctx.fill();
		}
		const core = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.16);
		core.addColorStop(0, type.core);
		core.addColorStop(0.6, type.core);
		core.addColorStop(1, `rgba(${r},${g},${b},0)`);
		ctx.fillStyle = core;
		ctx.fillRect(-c, -c, tile, tile);
		ctx.restore();
	});
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
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
