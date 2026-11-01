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
	precessionMatrix,
	siderealAngle,
	skyNow,
	starAt,
	clockRate,
	holdClock,
	useLocationIfAllowed,
} from './sky';
import { bodySphere, createBodyVisual, prewarmBodies, type BodyVisual } from './skyBodies';
import { hasWeather } from './skyWeather';
import { isGalileanMoon, solarSystem, type BodyName } from './ephemeris';
import { constellations, looseStars, type SkyStar } from '../data/constellations';
import { deepSky } from '../data/deepSky';
import { deepSkyPainted, deepSkyTexture } from './deepSkyArt';
import { deepSkyImages, planetMaps, type ImageCredit } from '../data/skyImages';
import { fitPhoto, loadSkyImage, photoMaterial } from './skyImageLoader';
import { comets } from '../data/comets';
import { cometState, COMET_LIMIT } from './comets';
import { createCometVisual, PHOTO_PX as COMET_PHOTO_PX, type CometVisual } from './skyComets';
import { cometImages } from '../data/skyImages';
import { createMeteorShowers, METEOR_SPEEDUP, type MeteorShowers } from './skyMeteors';
import { createTransients, type SkyTransients } from './skyTransients';
import { deviceLook, startDeviceLook, stopDeviceLook } from './skyMotion';
import { burstCountdown, transientAge } from './transients';
import { entryAltAz, findEntry } from './skyFinder';
import { applyStarLook, starCoronaMaterial, starSurfaceMaterial, STAR_LOOKS } from './skySun';
import { shortDate } from './meteors';

// inside is the page background after diving into the planet (see reset()).
export type View = 'orbit' | 'planet' | 'surface' | 'inside';

export interface HomeBinding {
	eye: HTMLElement;
	stage: HTMLElement;
	cards: HTMLElement[];
	starTip: HTMLElement; // shows a star's name in the sky view
	zoomBox: HTMLElement; // holds the magnification and the zoom-out button; shown once zoomed in
	followNote: HTMLElement; // "Tracking X" note (and "below the horizon"); its [data-follow-name] gets filled in
	countdown: HTMLElement; // a gamma-ray burst's countdown; its [data-countdown-name] and [data-countdown-text] get filled in
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
// Sky view zoom on arrival: fitted to the constellation on show (see buildSky), within
// these bounds, before easing all the way out (easeOutToWideView).
const SURFACE_FOV_MIN = 35;
const SURFACE_FOV_MAX = 80;
// How much of the view's height the constellation should fill.
const SKY_FILL = 0.6;
// How far the scroll wheel can zoom the sky view (field of view in degrees; smaller =
// closer). 0.01° is deep enough to frame Jupiter (about 45 arcseconds across).
const SKY_ZOOM_MIN = 0.01;
// Locked onto something with a disk, the telescope can zoom much further, until the
// disk is about twice the height of the view (degrees; small enough for Eris). Only
// then: drawn in view space, disks stay sharp at that scale, but points (stars) are
// placed in 32-bit world coordinates, good to about 0.02 arcseconds, and would
// visibly wander in a view that narrow.
const SKY_ZOOM_DEEP = 1e-5;
const SKY_ZOOM_MAX = 90;
// The naked eye's field of view, for the telescope's magnification readout.
const NAKED_EYE_FOV = 60;
// Constellation stars swap their glow for a close-up of their type between these magnifications.
const STAR_DETAIL_ZOOM = [4, 16];
// Highest the sky view can tilt (radians; just short of straight up).
const SKY_PITCH_MAX = 1.55;
// Telescope drive: zoomed in past the first of these fields of view (degrees), the view
// starts turning with the stars, as a telescope's motor drive does, and fully by the
// second; wider views stay put with the ground while the sky wheels past.
const DRIVE_FOV = [25, 10];
// Zoomed in on a star, its point gives way to a live simulation of a star of its type
// (skySun.ts) between these magnifications; it's the star locked onto, or else the
// one nearest the middle of the view (within STAR_SIM_PICK_PX).
const STAR_SIM_ZOOM = [10, 24];
const STAR_SIM_PICK_PX = 90;
// Past this magnification the simulation grows in step with the zoom (see starSimRadiusPx);
// locked onto a star, the telescope can zoom until it's this many screens tall.
const STAR_SIM_LINEAR = 1000;
const STAR_SIM_MAX_SCREENS = 20;
// Star-field motion on screen per frame (pixels) at which the background (stars,
// constellation lines, galaxies, comets) starts to fade, and is gone: past that it
// only strobes. Measured from the clock's motion, not from looking around.
const STROBE_PX = [30, 140];
// Lowest the sky view tilts (radians): all the way down. Below the horizon the ground
// vanishes (see groundHidden), showing the sky underfoot.
const SKY_PITCH_MIN = -SKY_PITCH_MAX;
// Point-of-light color for each body when it is too small to see as a disk.
const PLANET_GLOW: Record<Exclude<BodyName, 'Moon'>, number> = {
	Sun: 0xfff4d6,
	Pluto: 0xe8d8c8,
	Ceres: 0xd8d8d8,
	Vesta: 0xe4e0d8,
	Eris: 0xf2f2f2,
	Io: 0xfff0b8,
	Europa: 0xf4efe6,
	Ganymede: 0xe6e0d8,
	Callisto: 0xd4ccc0,
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
	// Things with a real photo: it shows once angle (radians) is px across on screen, so
	// locking on zooms at least that far in.
	photo?: { angle: number; px: number };
	starType?: number; // stars: STAR_TYPES index
	point?: { sizes: THREE.BufferAttribute; index: number; size: number }; // stars: their point of light, to hide behind the simulation
}

/**
 * A short credit line for the hover tip ("Image: NASA, ESA · Public domain"); the
 * credits page has the full text. kind names what's shown ("Image", "Map"); an
 * adapted one (a planet map that's graded and animated) says so.
 */
function creditLine(c: ImageCredit | undefined, kind = 'Image', adapted = false): string | undefined {
	if (!c) return undefined;
	const artist = c.artist.length > 60 ? `${c.artist.slice(0, 57).trimEnd()}…` : c.artist;
	return `${kind}: ${artist}${adapted ? ', adapted' : ''} · ${c.license}`;
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
// Supernovae and gamma-ray bursts, each shown while it's bright (or its gamma rays arrive).
let skyTransients: { events: SkyTransients; items: SkyItem[] } | null = null;
// Famous stars without a stick figure (looseStars), each shown whenever it's up.
let skyLoose: { items: SkyItem[]; stars: THREE.ShaderMaterial } | null = null;
// Stars that drift across the sky over the centuries (proper motion), and where each
// is drawn (its point and line ends): moveStars re-places them as the clock runs.
interface MovingStar {
	star: SkyStar;
	item: SkyItem;
	spots: { attribute: THREE.BufferAttribute; index: number }[];
}
let movingStars: MovingStar[] = [];
let starsPlacedAt = 0; // the sky time (ms) they were last placed for
// How far the clock moves before they're re-placed: a month moves the fastest, Barnard's Star, under 1″.
const STAR_MOVE_MS = 30 * 24 * 3600 * 1000;
// The star simulation shown on the star being zoomed into (one at a time).
let starSim: {
	group: THREE.Group;
	sphere: THREE.Mesh;
	surface: THREE.ShaderMaterial;
	corona: THREE.ShaderMaterial;
	item: SkyItem | null;
	mix: number; // 0 = the star's point of light, 1 = the simulation
} | null = null;
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
	born?: number; // supernova remnants: not there before this (ms since 1970)
	ovalPhoto?: boolean; // fade its photo out to an oval, not the frame's edges
}[] = [];
let lastDeepSkyUpdate = 0;

interface DeepSkyPhoto {
	material: THREE.ShaderMaterial;
	stage: 'loading' | 'small' | 'large';
	mix: number; // 0 = painted image, 1 = photo
	span: number; // the photo's long side on the sky (radians), once placed
}
let hoveredItem: SkyItem | null = null;
let trackedItem: SkyItem | null = null; // a body the telescope is following
// 0 -> 1 over the first moments of following a body: the view eases onto it, then
// locks on exactly, so it keeps up however fast the sky is turning.
let trackLock = 0;
let pressedBody: SkyItem | null = null; // the body under the pointer when it was pressed
// Panning while tracking: how far the view sits from the tracked object (radians), kept as it moves.
const trackOffset = { yaw: 0, pitch: 0 };
let autoZoomOut = false; // zooming back out at AUTO_ZOOM_OUT_RATE; any manual zoom stops it
// 1 while the view looks below the horizon, or follows something whose path would bring
// the horizon into view (see groundWouldShow): the ground isn't drawn at all, hidden at
// once rather than faded, and what's below the horizon can be hovered and locked onto.
// Back toward 0 (the ground fading back in, out of view) once that stops.
let groundHidden = 0;
// The view's center on the celestial sphere at the end of the last frame (celestial frame),
// for the telescope drive, and the camera's, for measuring how far the stars move.
let driveCenter: THREE.Vector3 | null = null;
let motionCenter: THREE.Vector3 | null = null;
// 1, or less while the star field moves too fast on screen to follow (see STROBE_PX).
let motionFade = 1;
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
let groundMesh: THREE.Mesh | null = null;
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
const drag = { active: false, x: 0, y: 0, moved: 0, vx: 0, vy: 0, at: 0 }; // vx, vy: pointer speed (px/s); at: last move
// Sky view momentum: a flick keeps the view gliding (px/s on screen), slowing by PAN_FRICTION per second.
let panGlide: { vx: number; vy: number } | null = null;
const PAN_FRICTION = 4;
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
// Steering the sky view by moving the phone (skyMotion.ts), and who to tell when it stops.
let deviceLookOn = false;
let deviceLookListener: ((on: boolean) => void) | null = null;
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
	prewarmSky();

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
		// One reading of the sky's clock per frame, so it moves in even steps.
		holdClock(performance.now());
		const dt = Math.min(clock.getDelta(), 0.05);
		const t = clock.elapsedTime;
		// In the sky view the starfield turns with the celestial sphere instead (updateSky).
		if (!reduceMotion && !celestial && view !== 'surface') {
			const drift = STAR_DRIFT_SPEED[view];
			stars.rotation.y += dt * drift;
			stars.rotation.x += dt * drift * 0.4;
		}
		if (celestial) updateSky(dt, t);
		// After updateSky, so this frame's decision applies this frame. Following something
		// whose path brings the horizon into view, neither the ground nor the little planet
		// under it is drawn (the planet stays hidden until the ground has faded back in, so
		// it never shows through); otherwise the planet always shows.
		planet.visible = !(view === 'surface' && groundHidden > 0.01);
		if (groundMaterial && groundMesh) {
			groundMesh.visible = groundHidden < 1;
			groundMaterial.uniforms.uOpacity.value = skyFade.ground * (1 - groundHidden);
			// The ground hides what's below the horizon through the depth buffer, once it's
			// mostly there (not while fading in on arrival or back in after following).
			groundMaterial.depthWrite = skyFade.ground > 0.5 && groundHidden < 0.5;
		}
		glidePan(dt);
		if (view === 'surface' && !busy && celestial) driveTelescope();
		followDevice();
		// Tracking keeps easing onto the object even mid-drag (the drag pans around it).
		if (view === 'surface' && !busy && (!drag.active || trackedItem)) {
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
		if (view === 'surface' && celestial) measureSkyMotion(dt);
		(stars.material as THREE.PointsMaterial).opacity = 0.9 * (view === 'surface' ? motionFade : 1);
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
	endDeviceLook();
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
	easeOutToWideView();
}

// How long the sky view takes to ease from the constellation out to its widest view (seconds).
const WIDE_VIEW_SECONDS = 2.5;

/**
 * After arriving (or moving to another location), widen the view from the
 * constellation it's framing to take in as much sky as possible. Any zoom or
 * lock-on by the visitor cancels it (stopWideningView).
 */
function easeOutToWideView(delay = 0) {
	stopWideningView();
	widening = gsap.to(skyZoom, { target: SKY_ZOOM_MAX, duration: WIDE_VIEW_SECONDS, delay, ease: 'power2.inOut' });
}

function stopWideningView() {
	widening?.kill();
	widening = null;
}
let widening: gsap.core.Tween | null = null;

async function surfaceToPlanet() {
	endDeviceLook();
	stopWideningView();
	trackedItem = null; // stop following, so the ground and the planet come back for the flight up
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
	panGlide = null; // a press stops any glide
	drag.vx = drag.vy = 0;
	drag.at = performance.now();
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
		zoomToward(clamp((pinch.fov * pinch.distance) / pinchDistance(), zoomFloor(), SKY_ZOOM_MAX), (a.x + b.x) / 2, (a.y + b.y) / 2);
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
	// The pointer's speed, smoothed, for a flick's glide when it's let go.
	const now = performance.now();
	const seconds = Math.max(0.004, (now - drag.at) / 1000);
	drag.vx = drag.vx * 0.5 + (dx / seconds) * 0.5;
	drag.vy = drag.vy * 0.5 + (dy / seconds) * 0.5;
	drag.at = now;
	// Capture only once it is clearly a drag, so plain clicks still reach the cards.
	if (drag.moved > DRAG_THRESHOLD && !stage.hasPointerCapture(e.pointerId)) stage.setPointerCapture(e.pointerId);

	if (view === 'planet') {
		spin.x = dx * 0.006;
		spin.y = dy * 0.006;
		rotatePlanet(spin.x, spin.y);
	} else if (view === 'surface') panSky(dx, dy);
}

/**
 * Sky view: move the view by a drag of (dx, dy) pixels, one to one: what's under the
 * pointer stays under it, at any zoom. Tracking something, this pans around it (the
 * offset is kept as it moves).
 */
function panSky(dx: number, dy: number) {
	if (deviceLookOn) return; // the phone steers
	// Radians per pixel at the current zoom; turning sideways covers less sky the
	// higher the view is tilted, so it turns faster there to keep up.
	const speed = THREE.MathUtils.degToRad(camera.fov) / window.innerHeight;
	const sideways = speed / Math.max(0.25, Math.cos(look.pitch));
	if (trackedItem) {
		trackOffset.yaw -= dx * sideways;
		trackOffset.pitch = clamp(trackOffset.pitch + dy * speed, -Math.PI / 2, Math.PI / 2);
		aimAt(trackedItem);
		look.yaw = lookTarget.yaw;
		look.pitch = lookTarget.pitch;
		return;
	}
	look.yaw = lookTarget.yaw = look.yaw - dx * sideways;
	look.pitch = lookTarget.pitch = clamp(look.pitch + dy * speed, SKY_PITCH_MIN, SKY_PITCH_MAX);
}

/**
 * Sky view: steer by moving the phone (on), or stop (off). Turning it on stops
 * tracking. Resolves to whether it's on: false if the device can't (no sensors, or
 * permission refused). Asks for permission where needed, so call it from a tap.
 */
export async function setDeviceLook(on: boolean): Promise<boolean> {
	if (!on || view !== 'surface' || busy) {
		endDeviceLook();
		return false;
	}
	trackedItem = null;
	autoZoomOut = false;
	panGlide = null;
	stopWideningView();
	const heading = ((look.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
	deviceLookOn = await startDeviceLook(heading);
	deviceLookListener?.(deviceLookOn);
	return deviceLookOn;
}

/** Be told when steering by the phone starts or stops (it stops when locking onto something, for one). */
export function watchDeviceLook(listener: ((on: boolean) => void) | null) {
	deviceLookListener = listener;
}

function endDeviceLook() {
	if (!deviceLookOn) return;
	stopDeviceLook();
	deviceLookOn = false;
	deviceLookListener?.(false);
}

/** Each frame, while the phone steers: point the view where it points (the frame loop eases toward it). */
function followDevice() {
	if (!deviceLookOn || view !== 'surface' || busy) return;
	const d = deviceLook();
	if (!d) return;
	lookTarget.yaw = d.heading + 2 * Math.PI * Math.round((look.yaw - d.heading) / (2 * Math.PI)); // the short way round
	lookTarget.pitch = clamp(d.pitch, SKY_PITCH_MIN, SKY_PITCH_MAX);
}

/** Each frame: carry on a flick's glide, slowing to a stop. */
function glidePan(dt: number) {
	if (!panGlide || drag.active || busy || view !== 'surface') return;
	panSky(panGlide.vx * dt, panGlide.vy * dt);
	const slow = Math.exp(-PAN_FRICTION * dt);
	panGlide.vx *= slow;
	panGlide.vy *= slow;
	if (Math.hypot(panGlide.vx, panGlide.vy) < 15) panGlide = null;
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

/**
 * The narrowest field of view (degrees) allowed right now: the usual limit, or
 * locked onto a disk, down to where that disk is about twice the view's height.
 */
function zoomFloor(): number {
	// Locked onto a star: deep enough for its simulation to be STAR_SIM_MAX_SCREENS tall.
	if (trackedItem?.starType !== undefined) {
		const deepest = (STAR_SIM_LINEAR * (STAR_SIM_MAX_SCREENS * window.innerHeight)) / (2 * starSimRadiusPx(STAR_SIM_LINEAR));
		return Math.max(SKY_ZOOM_DEEP, NAKED_EYE_FOV / deepest);
	}
	const radius = trackedItem?.angularRadius;
	return radius ? Math.max(SKY_ZOOM_DEEP, Math.min(SKY_ZOOM_MIN, THREE.MathUtils.radToDeg(radius))) : SKY_ZOOM_MIN;
}

/**
 * How big (radius, pixels) the star simulation is drawn at a magnification: growing
 * gently at first, like the stars' close-up images, then from STAR_SIM_LINEAR on in
 * step with the zoom, like a real disk, so the telescope can dive into its surface.
 */
function starSimRadiusPx(magnification: number): number {
	const gentle = 18 * Math.sqrt(Math.min(magnification, STAR_SIM_LINEAR) / STAR_DETAIL_ZOOM[1]);
	return Math.max(10, magnification > STAR_SIM_LINEAR ? gentle * (magnification / STAR_SIM_LINEAR) : gentle);
}

/** Sky view: the scroll wheel zooms in and out, toward whatever is under the cursor. */
function onWheel(e: WheelEvent) {
	if (view !== 'surface' || busy) return;
	e.preventDefault();
	zoomToward(clamp(skyZoom.target * Math.exp(e.deltaY * 0.0025), zoomFloor(), SKY_ZOOM_MAX), e.clientX, e.clientY);
}

/**
 * Zoom the sky view to a field of view (degrees), toward a point on screen: the
 * view shifts so that point stays roughly where it is, as with the wheel or a pinch.
 */
function zoomToward(after: number, screenX: number, screenY: number) {
	autoZoomOut = false;
	panGlide = null;
	stopWideningView();
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
	lookTarget.pitch = clamp(lookTarget.pitch + offPitch * share, SKY_PITCH_MIN, SKY_PITCH_MAX);
}

/**
 * Sky view: center a body or star, zoom the telescope to frame it, and keep
 * following it as the sky turns (until the visitor drags to look elsewhere).
 */
function focusOn(item: SkyItem) {
	endDeviceLook();
	panGlide = null;
	trackedItem = item;
	trackLock = 0;
	trackOffset.yaw = trackOffset.pitch = 0;
	autoZoomOut = false;
	stopWideningView();
	aimAt(item);
	// Fill about a third of the view's height; a star (a point) gets its close-up.
	let fov = item.focusFov ?? (item.angularRadius ? THREE.MathUtils.radToDeg(item.angularRadius * 2) * 3 : STAR_FOCUS_FOV);
	// Close enough for its photo, with some room to spare: tan(fov / 2) = height × angle / (2 × px).
	if (item.photo) {
		const px = item.photo.px * PHOTO_ZOOM_MARGIN;
		fov = Math.min(fov, THREE.MathUtils.radToDeg(2 * Math.atan((window.innerHeight * item.photo.angle) / (2 * px))));
	}
	skyZoom.target = clamp(fov, zoomFloor(), SKY_ZOOM_MAX);
}

// Extra room (radians) kept between the horizon and the edge of the view before the ground is hidden.
const HORIZON_MARGIN = 0.005;
// Wide views show the ground anyway: there it's only hidden once the followed object is this low (radians, ~15°).
const WIDE_VIEW_HIDE_BELOW = 0.26;

/**
 * Following something with its center at (or headed down to) this altitude
 * (radians), would the horizon be in view? The view's lowest point is about its
 * half-diagonal below the center (using the widest the field of view is or is
 * zooming to). In wide views the horizon is in view already, so there the ground
 * stays until the object is within WIDE_VIEW_HIDE_BELOW of it.
 */
function groundWouldShow(lowest: number): boolean {
	const halfHeight = THREE.MathUtils.degToRad(Math.max(camera.fov, skyZoom.fov, skyZoom.target)) / 2;
	const halfDiagonal = Math.atan(Math.tan(halfHeight) * Math.hypot(1, camera.aspect));
	return lowest - halfDiagonal < HORIZON_MARGIN && lowest < WIDE_VIEW_HIDE_BELOW;
}

// How far ahead (real seconds) the ground looks at the followed object's path, and in how many steps.
const GROUND_LEAD_SECONDS = 1.5;
const GROUND_LEAD_STEPS = 6;

/**
 * The lowest altitude (radians) a sky item reaches by the next frame (dt from now)
 * and over the next GROUND_LEAD_SECONDS of real time, at the clock's current speed
 * (in whichever direction it runs). Fast clocks look hours or days ahead; paused,
 * it doesn't look ahead at all.
 */
function lowestAltitudeAhead(item: SkyItem, now: Date, dt: number): number {
	const rate = clockRate();
	const entry = findEntry(item.key);
	if (!rate || !entry) return Infinity;
	const obs = getObserver();
	const at = (realSeconds: number) => entryAltAz(entry, obs, new Date(now.getTime() + rate * realSeconds * 1000))?.alt ?? Infinity;
	let lowest = at(Math.max(dt, 1 / 60)); // the next frame
	for (let k = 1; k <= GROUND_LEAD_STEPS; k++) lowest = Math.min(lowest, at((GROUND_LEAD_SECONDS * k) / GROUND_LEAD_STEPS));
	return lowest;
}

let followNoteText = '';

/**
 * Show (or with null, hide) the tracking note: what's being tracked, with a button to
 * stop, saying so when it's below the horizon.
 */
function showFollowNote(item: SkyItem | null, below = false) {
	const note = binding?.followNote;
	if (!note) return;
	note.classList.toggle('is-visible', !!item);
	note.classList.toggle('is-below', below);
	if (!item) return;
	const name = item.name.split(' · ')[0];
	if (name !== followNoteText) {
		followNoteText = name;
		for (const el of note.querySelectorAll('[data-follow-name]')) el.textContent = name;
	}
}

/** Sky view: stop following whatever the telescope is locked onto (the view stays where it is). */
export function stopFollowing() {
	trackedItem = null;
}

/** Sky view: ease the telescope back out to the naked eye (still following whatever it was on). */
export function zoomOutSky() {
	stopWideningView();
	if (view === 'surface' && skyZoom.target < NAKED_EYE_FOV) autoZoomOut = true;
}

/**
 * Sky view: lock the telescope onto a sky item by its search key (see skyFinder.ts),
 * above or below the horizon (below, the ground vanishes to show it). Whether it's
 * on show otherwise (a shower that's active, a comet bright enough) is the caller's
 * to check. False outside the sky view.
 */
export function lockOnto(key: string): boolean {
	const item = skyItems.find((i) => i.key === key);
	if (view !== 'surface' || busy || !item) return false;
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
	endDeviceLook();
	trackedItem = null;
	autoZoomOut = false;
	panGlide = null;
	driveCenter = null; // or the telescope drive, zoomed in, would carry the view back to where it was
	if (fov !== undefined) stopWideningView();
	lookTarget.yaw = az + 2 * Math.PI * Math.round((look.yaw - az) / (2 * Math.PI)); // the short way round
	lookTarget.pitch = clamp(alt, SKY_PITCH_MIN, SKY_PITCH_MAX);
	if (fov !== undefined) skyZoom.target = clamp(fov, SKY_ZOOM_MIN, SKY_ZOOM_MAX);
}

/** Sky view: where the view points (radians; heading = azimuth from north through east), or null outside it. */
export function getSkyLook(): { heading: number; pitch: number } | null {
	if (view !== 'surface' || !surfaceFrame) return null;
	return { heading: ((look.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), pitch: look.pitch };
}

/** The sky view's look direction (world) for a yaw and pitch. */
function lookDirection(yaw: number, pitch: number): THREE.Vector3 {
	const { n, t } = surfaceFrame!;
	return t.clone().applyAxisAngle(n, -yaw).multiplyScalar(Math.cos(pitch)).addScaledVector(n, Math.sin(pitch));
}

/** The celestial sphere's rotation in the world (directions, celestial frame -> world). */
function celestialRotation(): THREE.Quaternion {
	return celestial!.getWorldQuaternion(new THREE.Quaternion());
}

/**
 * The telescope drive: zoomed in, and not locked onto anything, turn the view with
 * the stars (as the sky turned this frame), so they hold still however fast the
 * clock runs. Partly between the DRIVE_FOV fields of view; not at all wider. Stars
 * setting take the view below the horizon with them, and the ground vanishes.
 */
function driveTelescope() {
	const { n, t, r } = surfaceFrame!;
	const turn = celestialRotation();
	const weight = trackedItem || drag.active || pinch || deviceLookOn ? 0 : smoothstep(DRIVE_FOV[0], DRIVE_FOV[1], skyZoom.fov);
	if (driveCenter && weight > 0) {
		// Where last frame's center has been carried by the sky's turning.
		const dir = driveCenter.clone().applyQuaternion(turn);
		const yaw = Math.atan2(dir.dot(r), dir.dot(t));
		const pitch = Math.asin(clamp(dir.dot(n), -1, 1));
		const dYaw = weight * (yaw - lookTarget.yaw - 2 * Math.PI * Math.round((yaw - lookTarget.yaw) / (2 * Math.PI)));
		const dPitch = weight * (pitch - lookTarget.pitch);
		// Move the view and its target together, so the turn isn't eased (and lagged).
		lookTarget.yaw += dYaw;
		look.yaw += dYaw;
		lookTarget.pitch = clamp(lookTarget.pitch + dPitch, SKY_PITCH_MIN, SKY_PITCH_MAX);
		look.pitch = clamp(look.pitch + dPitch, SKY_PITCH_MIN, SKY_PITCH_MAX);
	}
	driveCenter = lookDirection(lookTarget.yaw, lookTarget.pitch).applyQuaternion(turn.invert());
}

/**
 * How far the star field moved on screen this frame because of the clock (the sky
 * turning, or the view following something across it), and the background's fade to
 * match. While the visitor is looking around (dragging or gliding) or zooming, the fade holds where it is.
 */
function measureSkyMotion(dt: number) {
	const turn = celestialRotation();
	const forward = camera.getWorldDirection(new THREE.Vector3());
	const zooming = Math.abs(skyZoom.target - skyZoom.fov) > skyZoom.fov * 0.02;
	if (motionCenter && !drag.active && !panGlide && !pinch && !zooming && !busy) {
		const pxPerRadian = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
		const moved = motionCenter.clone().applyQuaternion(turn).angleTo(forward) * pxPerRadian;
		const target = 1 - smoothstep(STROBE_PX[0], STROBE_PX[1], moved);
		motionFade += (target - motionFade) * Math.min(1, dt * 6);
	}
	motionCenter = forward.applyQuaternion(turn.invert());
}

/** Point the sky view (eased by the frame loop) at a sky item. */
function aimAt(item: SkyItem) {
	const { eye, n, t, r } = surfaceFrame!;
	const dir = worldOf(item).sub(eye).normalize();
	// Tracking, plus however far the visitor has panned from it.
	const yaw = Math.atan2(dir.dot(r), dir.dot(t)) + (trackedItem === item ? trackOffset.yaw : 0);
	lookTarget.yaw = yaw + 2 * Math.PI * Math.round((look.yaw - yaw) / (2 * Math.PI)); // the short way round
	// Following it, the view tilts as far down as it takes, even below the horizon.
	const pitch = Math.asin(dir.dot(n)) + (trackedItem === item ? trackOffset.pitch : 0);
	lookTarget.pitch = clamp(pitch, -SKY_PITCH_MAX, SKY_PITCH_MAX);
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
		// A flick (still moving when let go) glides on; a drag that stopped first doesn't.
		const flicked = performance.now() - drag.at < 80 && Math.hypot(drag.vx, drag.vy) > 120;
		if (view === 'surface' && flicked) panGlide = { vx: drag.vx, vy: drag.vy };
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

const BODY_NAMES: BodyName[] = [
	'Sun',
	'Moon',
	'Mercury',
	'Venus',
	'Mars',
	'Jupiter',
	'Saturn',
	'Uranus',
	'Neptune',
	'Pluto',
	'Ceres',
	'Vesta',
	'Eris',
	'Io',
	'Europa',
	'Ganymede',
	'Callisto',
];
const BODY_DISTANCE = SKY_RADIUS * 0.97; // just in front of the stars, so the Moon can pass over them
// The Sun sits behind the Moon and planets, so eclipses and transits come out right.
const SUN_DISTANCE = SKY_RADIUS * 0.985;
// Fainter than the naked eye can see, a body only shows through the telescope: the
// faintest magnitude visible goes up by this much for each tenfold magnification.
const MAGNITUDE_PER_DECADE = 4;
// Jupiter's moons show (and can be hovered) once at least this far from Jupiter on screen (pixels).
const MOON_SEPARATION_PX = 14;
// A body's point of light gives way to its globe as the disk grows across these sizes (pixels).
const DISK_FADE_PX = [6, 16];
const DEEP_SKY_DISTANCE = SKY_RADIUS * 1.01; // just behind the stars
const COMET_DISTANCE = SKY_RADIUS * 0.98; // in front of the stars, behind the Moon and planets
const STAR_SIM_DISTANCE = SKY_RADIUS * 0.99; // just in front of the star it stands in for
const METEOR_DISTANCE = SKY_RADIUS * 0.96; // in front of everything: meteors burn up in our own air
const TRANSIENT_DISTANCE = SKY_RADIUS * 0.985; // just in front of the stars
// Deep-sky objects smaller than this on screen are drawn this big, and dimmer, so they can be
// found: a share of the screen's height (14 pixels on an 800-pixel screen), so it keeps pace
// with the stars, which scale with the screen too.
const DEEP_SKY_MIN_SHARE = 14 / 800;
// The images fade out toward their edges, so draw them a bit larger than the object's catalog size.
const DEEP_SKY_IMAGE_SCALE = 1.3;
// Zoomed past an image's resolution, it fades away (photos and painted images alike)
// between these many screen pixels per image pixel, rather than turning into a blur.
const IMAGE_SHARP_LIMIT = [3, 5];
// Swap in a real photo once an object is this many pixels across, and a sharper one past the second size.
const DEEP_SKY_PHOTO_PX = 120;
// Locking onto something with a photo zooms in this much past where its photo appears.
const PHOTO_ZOOM_MARGIN = 1.3;
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
	removeSky(true);
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
		const local = new Map(constellation.stars.map((s) => [s.name, starLocal(s, now)]));
		const items: SkyItem[] = constellation.stars.map((s) => ({
			key: `star:${s.name}`,
			name: `${s.name} · ${constellation.name} · ${s.ly.toLocaleString('en-US')} light-years`, // "Star · Constellation · distance"
			local: local.get(s.name)!,
			hoverable: false,
			detail: starDetail(s),
		}));
		const stars = starMaterial();
		const geometry = starGeometry(
			constellation.stars.map((s) => ({
				local: local.get(s.name)!,
				size: starSize(s.mag),
				color: starColor(s.bv),
				twinkle: true,
				type: starType(s.bv),
			})),
		);
		celestial.add(new THREE.Points(geometry, stars));
		markStars(items, constellation.stars, geometry);
		const lines = new THREE.LineBasicMaterial({ color: 0x8fb8ff, transparent: true, opacity: 0 });
		const linePoints = constellation.lines.flatMap(([a, b]) => [local.get(a)!, local.get(b)!]);
		const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
		celestial.add(new THREE.LineSegments(lineGeometry, lines));
		constellation.stars.forEach((s, i) => {
			if (!s.pm) return;
			const ends = linePoints.flatMap((p, k) => (p === items[i].local ? [k] : []));
			const spot = (geometryOf: THREE.BufferGeometry, index: number) => ({ attribute: geometryOf.getAttribute('position') as THREE.BufferAttribute, index });
			movingStars.push({ star: s, item: items[i], spots: [spot(geometry, i), ...ends.map((k) => spot(lineGeometry, k))] });
		});
		const up = constellationAltitudes(items).every((sinAlt) => sinAlt > 0);
		skyConstellations.push({ items, stars, lines, opacity: up ? 1 : 0 });
		skyItems.push(...items);
	}

	// Famous stars without a stick figure, shown whenever they're up.
	{
		const items: SkyItem[] = looseStars.map((s) => ({
			key: `star:${s.name}`,
			name: `${s.name} · ${s.constellation} · ${s.ly.toLocaleString('en-US')} light-years`,
			local: starLocal(s, now),
			hoverable: false,
			detail: starDetail(s),
		}));
		const material = starMaterial();
		const geometry = starGeometry(
			looseStars.map((s, i) => ({
				local: items[i].local,
				size: starSize(s.mag),
				// Stars past the naked-eye limit are drawn dim.
				color: starColor(s.bv).multiplyScalar(s.mag > NAKED_EYE_LIMIT ? 0.45 : 1),
				twinkle: true,
				type: starType(s.bv),
			})),
		);
		celestial.add(new THREE.Points(geometry, material));
		markStars(items, looseStars, geometry);
		looseStars.forEach((s, i) => {
			if (s.pm) movingStars.push({ star: s, item: items[i], spots: [{ attribute: geometry.getAttribute('position') as THREE.BufferAttribute, index: i }] });
		});
		starsPlacedAt = now.getTime();
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
			photo: deepSkyImages[o.catalog] ? { angle: size[0], px: DEEP_SKY_PHOTO_PX } : undefined,
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
			born: o.born,
			ovalPhoto: o.ovalPhoto,
		});
		skyItems.push(item);
	});

	// The star simulation, shown on whichever star is being zoomed into.
	{
		const surface = starSurfaceMaterial();
		const corona = starCoronaMaterial();
		const sphere = new THREE.Mesh(bodySphere(192, 96), surface);
		sphere.renderOrder = 1;
		const halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), corona);
		halo.renderOrder = 2;
		halo.frustumCulled = false; // a billboard: sized in its shader
		const group = new THREE.Group();
		group.add(sphere, halo);
		group.visible = false;
		celestial.add(group);
		starSim = { group, sphere, surface, corona, item: null, mix: 0 };
	}

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

	// Supernovae and gamma-ray bursts; updateSky brightens and fades them with the clock.
	{
		const events = createTransients(TRANSIENT_DISTANCE);
		celestial.add(events.object);
		const items = events.events.map(({ transient, dir }) => ({
			key: `event:${transient.id}`,
			name: transient.name,
			local: dir.clone().multiplyScalar(TRANSIENT_DISTANCE),
			hoverable: false,
			focusFov: NAKED_EYE_FOV / 4,
		}));
		skyTransients = { events, items };
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
			const point = new THREE.Points(geometry, glow);
			// The point moves every frame, so its bounding sphere (made at the origin) would be
			// wrong: without this a narrow telescope view culls it as off screen.
			point.frustumCulled = false;
			celestial.add(point);
		}
		const item: SkyItem = { key: `body:${name}`, name, local: new THREE.Vector3(), hoverable: false };
		skyBodies.push({ name, item, visual, glow, glowPosition });
		skyItems.push(item);
	}
	updateBodies(now);

	sky.add(buildGround());
	scene.add(sky);
	precompileSky(sky);

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
	return { yaw: Math.atan2(center.dot(r), center.dot(t)), pitch: clamp(Math.asin(center.dot(n)), SKY_PITCH_MIN, SKY_PITCH_MAX) };
}

// Time per frame (ms) spent compiling the sky's shaders ahead of time (precompileSky).
const PRECOMPILE_MS_PER_FRAME = 4;
// Longest a first sky stays hidden waiting for its shaders (ms): about when its stars start to fade in.
const PRECOMPILE_MAX_WAIT_MS = 2500;
// A replaced sky, kept until its replacement has compiled (see removeSky).
let retiredSky: THREE.Group | null = null;

/** Free a sky's geometry, materials and images, except those kept for every sky (userData.shared). */
function disposeSky(root: THREE.Group | null) {
	root?.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.geometry?.userData.shared) mesh.geometry?.dispose();
		if (mesh.material && !Array.isArray(mesh.material)) {
			const map = (mesh.material as THREE.MeshBasicMaterial).map; // the deep-sky images
			if (!map?.userData.shared) map?.dispose();
			mesh.material.dispose();
		}
	});
}

// Idle time (ms) to leave free, once prewarmSky has done a piece of its work.
const PREWARM_IDLE_MARGIN_MS = 2;

/**
 * While the page sits idle, build the sky view's slowest parts ahead of time, a
 * piece at a time: the bodies' spheres and the deep-sky images. Entering the sky
 * view then only has to put them in place.
 */
function prewarmSky() {
	const idle = (work: (deadline?: IdleDeadline) => void) =>
		'requestIdleCallback' in window ? requestIdleCallback(work, { timeout: 2000 }) : setTimeout(work, 50);
	let next = 0; // the next deep-sky image to paint
	const step = (deadline?: IdleDeadline) => {
		do {
			if (!prewarmBodies()) continue;
			while (next < deepSky.length && deepSkyPainted(deepSky[next].kind, next)) next++;
			if (next >= deepSky.length) return;
			deepSkyTexture(deepSky[next].kind, next);
		} while (deadline && !deadline.didTimeout && deadline.timeRemaining() > PREWARM_IDLE_MARGIN_MS);
		idle(step);
	};
	idle(step);
}

/**
 * Compile a newly built sky's shaders a few at a time, one frame after another,
 * rather than all at once on the sky's first frame, or, for things hidden until
 * zoomed in (the planets' disks, the star simulation), in the middle of a zoom
 * (compile() covers hidden things too). A first sky (arriving) stays hidden until
 * they're all ready, during the flight down; one replacing another (a new place) shows at
 * once, reusing the old one's shaders, which are let go of once it's done.
 */
function precompileSky(root: THREE.Group) {
	const queue: THREE.Object3D[] = [];
	const materials = new Set<THREE.Material>();
	root.traverse((obj) => {
		const material = (obj as THREE.Mesh).material;
		if (!material) return;
		const list = Array.isArray(material) ? material : [material];
		if (list.every((m) => materials.has(m))) return;
		list.forEach((m) => materials.add(m));
		queue.push(obj);
	});
	const replacing = retiredSky !== null;
	// Shown (and the old sky let go of) once every shader is ready, or after
	// PRECOMPILE_MAX_WAIT_MS at the latest, whichever comes first.
	const done = () => {
		if (sky !== root || root.visible && !retiredSky) return;
		root.visible = true;
		disposeSky(retiredSky);
		retiredSky = null;
	};
	if (!replacing) {
		root.visible = false;
		setTimeout(done, PRECOMPILE_MAX_WAIT_MS);
	}
	const step = () => {
		if (sky !== root) return; // replaced or removed meanwhile
		const start = performance.now();
		while (queue.length && performance.now() - start < PRECOMPILE_MS_PER_FRAME) {
			const obj = queue.shift()!;
			renderer.compile(obj, camera, scene);
			// Its image onto the GPU too (the deep-sky images), rather than on first sight.
			const map = ((obj as THREE.Mesh).material as THREE.MeshBasicMaterial).map;
			if (map) renderer.initTexture(map);
		}
		if (queue.length) return requestAnimationFrame(step);
		// compile() only starts the shaders building; drawing one before it's done waits
		// for it. compileAsync waits (without blocking) until they all are.
		renderer.compileAsync(root, camera, scene).then(done);
	};
	requestAnimationFrame(step);
}

/**
 * Take down the sky view's sky. Replacing it with another (keepShaders), its
 * materials are kept until the new sky has compiled, so their shaders carry over
 * instead of being freed and compiled again.
 */
function removeSky(keepShaders = false) {
	if (sky) {
		scene.remove(sky);
		disposeSky(retiredSky);
		retiredSky = null;
		if (keepShaders) retiredSky = sky;
		else disposeSky(sky);
	}
	sky = null;
	celestial = null;
	groundMaterial = null;
	groundMesh = null;
	skyItems = [];
	skyConstellations = [];
	skyLoose = null;
	movingStars = [];
	skyBodies = [];
	skyDeep = [];
	skyComets = [];
	skyMeteors = null;
	skyTransients = null;
	showCountdown(null, null);
	starSim = null;
	groundHidden = 0;
	driveCenter = motionCenter = null;
	motionFade = 1;
	showFollowNote(null);
	trackOffset.yaw = trackOffset.pitch = 0;
	hoveredItem = null;
	trackedItem = null;
}

/**
 * Turn the celestial sphere to match the sky at a moment, for the current
 * observer. In the landing frame (t north, r east, n up), the celestial pole sits
 * at the observer's latitude above the northern horizon, and the sphere has
 * turned by the local sidereal time; this builds that rotation from the
 * equatorial axes (x to RA 0h, y to RA 6h, z to the pole). Everything on the
 * sphere is placed in J2000 coordinates, so it's precessed to the date's first.
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
	const precession = new THREE.Matrix4().setFromMatrix3(precessionAt(date));
	celestial!.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, pole).multiply(precession));
	celestial!.updateMatrixWorld(true);
}

/** Precession from J2000 to a date's equator (sky.ts precessionMatrix) as a Three.js matrix. */
function precessionAt(date: Date): THREE.Matrix3 {
	return new THREE.Matrix3().fromArray(precessionMatrix(date)).transpose(); // fromArray reads columns; it's given rows
}

/** Sine of the altitude of each item (above the horizon when positive). */
function constellationAltitudes(items: SkyItem[]): number[] {
	return items.map((item) => tmp.copy(item.local).normalize().applyQuaternion(celestial!.quaternion).dot(surfaceFrame!.n));
}

/**
 * Is a point at this altitude (its sine) on show to hover? Above the horizon, or
 * anywhere while the ground is hidden.
 */
function aboveGround(sinAlt: number): boolean {
	return sinAlt > 0 || groundHidden >= 1;
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
	moveStars(now);
	starUniforms.uTime.value = t;
	starUniforms.uScale.value = renderer.getPixelRatio() * window.innerHeight * 0.5;
	starUniforms.uZoom.value = NAKED_EYE_FOV / camera.fov;

	if (skyLoose) {
		skyLoose.stars.uniforms.uOpacity.value = skyFade.stars * motionFade;
		const altitudes = constellationAltitudes(skyLoose.items);
		skyLoose.items.forEach((item, i) => (item.hoverable = aboveGround(altitudes[i])));
	}
	for (const c of skyConstellations) {
		const altitudes = constellationAltitudes(c.items);
		// Shown once fully risen, while one of its stars is being followed, or while the
		// ground is hidden (following something below the horizon), when nothing is below it.
		const target =
			altitudes.every((sinAlt) => sinAlt > 0) || (trackedItem !== null && c.items.includes(trackedItem)) || groundHidden >= 1 ? 1 : 0;
		c.opacity += (target - c.opacity) * Math.min(1, dt * 3);
		c.stars.uniforms.uOpacity.value = c.opacity * skyFade.stars * motionFade;
		// Lines step aside while a star simulation is showing: at that zoom they only cross its glow.
		c.lines.opacity = c.opacity * skyFade.lines * motionFade * (1 - (starSim?.mix ?? 0));
		c.items.forEach((item, i) => (item.hoverable = c.opacity > 0.5 && aboveGround(altitudes[i])));
	}
	updateDeepSky(now);
	updateComets(now, dt);
	if (skyMeteors) {
		const { showers, items } = skyMeteors;
		const sinAlt = (d: THREE.Vector3) => tmp.copy(d).applyQuaternion(celestial!.quaternion).dot(surfaceFrame!.n);
		// With reduced motion, no meteors fall (the radiants still show).
		showers.update(now, dt, reduceMotion ? 0 : clockRate(), skyFade.stars, sinAlt);
		showers.showers.forEach(({ shower, radiant, activity }, i) => {
			items[i].hoverable = activity.active && aboveGround(sinAlt(radiant));
			items[i].detail = `Peaks ${shortDate(activity.window.peak)} · about ${Math.round(activity.rate)} an hour now · shown ${METEOR_SPEEDUP}× as often, more with the clock sped up · from ${shower.parent}`;
		});
	}
	updateTransients(now);
	updateBodies(now);
	updateStarSim(dt);

	// The faint background stars turn with the sky too, centered on the visitor.
	stars.position.copy(surfaceFrame!.eye);
	stars.quaternion.copy(celestial!.quaternion);

	// A focused body: keep the telescope on it as the sky turns, even after it sets:
	// the ground fades away as it nears the horizon, and a note says it's being followed below.
	const altitude = trackedItem && view === 'surface' ? Math.asin(clamp(constellationAltitudes([trackedItem])[0], -1, 1)) : null;
	const following = altitude !== null && altitude < 0;
	// Checked against the lowest the object gets over the next frame and the next moments
	// of the sky's clock (and where the view points now), so however fast time runs the
	// ground is gone before the horizon could come into view: hidden at once, not faded.
	// Where the view's center goes: the object's path, shifted by any panning.
	const lowest =
		altitude === null
			? null
			: Math.min(altitude + trackOffset.pitch, look.pitch, lowestAltitudeAhead(trackedItem!, now, dt) + trackOffset.pitch);
	// Looking around: hidden as soon as the view's center heads below the horizon.
	const lookingDown = view === 'surface' && Math.min(look.pitch, lookTarget.pitch) < 0;
	groundHidden = lookingDown || (lowest !== null && groundWouldShow(lowest)) ? 1 : groundHidden * Math.max(0, 1 - dt * 3);
	showFollowNote(view === 'surface' ? trackedItem : null, following);
	// Past the usual limit only while locked onto a disk: let go, and ease back out to it.
	if (skyZoom.target < zoomFloor()) skyZoom.target = zoomFloor();
	if (trackedItem && view === 'surface' && !busy) aimAt(trackedItem);
	if (autoZoomOut) {
		skyZoom.target = Math.min(NAKED_EYE_FOV, Math.max(skyZoom.target, SKY_ZOOM_MIN) * AUTO_ZOOM_OUT_RATE ** dt);
		if (skyZoom.target >= NAKED_EYE_FOV) autoZoomOut = false;
	}
}

let countdownText = '';

/** Show (or with nulls, hide) a gamma-ray burst's countdown. */
function showCountdown(name: string | null, countdown: string | null) {
	const box = binding?.countdown;
	if (!box) return;
	box.classList.toggle('is-visible', !!name && !!countdown);
	if (!name || !countdown || `${name}|${countdown}` === countdownText) return;
	countdownText = `${name}|${countdown}`;
	box.querySelector('[data-countdown-name]')!.textContent = name;
	box.querySelector('[data-countdown-text]')!.textContent = countdown;
}

/** Each frame: brighten and fade the supernovae and gamma-ray bursts, and keep their hover text current. */
function updateTransients(now: Date) {
	if (!skyTransients) return showCountdown(null, null);
	const { events, items } = skyTransients;
	const limit = NAKED_EYE_LIMIT + MAGNITUDE_PER_DECADE * Math.log10(Math.max(1, NAKED_EYE_FOV / camera.fov));
	const pxPerRadian = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
	events.update(now, skyFade.stars, limit, { zoom: NAKED_EYE_FOV / camera.fov, pxPerRadian, heightPx: window.innerHeight });
	events.events.forEach(({ transient: t, state }, i) => {
		const item = items[i];
		const showing = state.gamma > 0.02 || (state.mag !== null && state.mag < limit);
		item.hoverable = showing && aboveGround(constellationAltitudes([item])[0]);
		const brightness = state.mag !== null ? `magnitude ${state.mag.toFixed(1)}` : 'gamma rays only (false color)';
		item.name = `${t.name} · ${brightness}`;
		const kind = t.kind === 'supernova' ? 'Supernova' : 'Gamma-ray burst';
		item.detail = `${kind} ${t.name === t.designation ? '' : `${t.designation} `}in ${t.constellation} · ${transientAge(t, state.since)} · ${t.distance} away`;
	});
	// A burst about to go off: count down to it.
	let countdown: { name: string; text: string } | null = null;
	for (const { transient: t, state } of events.events) {
		if (t.kind !== 'grb' || view !== 'surface') continue;
		const text = burstCountdown(t, state.since);
		if (text) countdown = { name: t.designation, text };
	}
	showCountdown(countdown?.name ?? null, countdown?.text ?? null);
}

/**
 * Each frame: fade the galaxies, nebulae and clusters with the sky, mark which are
 * up (for hovering), and keep small ones at least DEEP_SKY_MIN_SHARE across so they
 * can be spotted, dimming them to match, until the telescope zooms in enough to
 * show them at their true size.
 */
function updateDeepSky(date: Date) {
	const pxPerRadian = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
	const now = performance.now();
	const dt = lastDeepSkyUpdate ? Math.min(0.1, (now - lastDeepSkyUpdate) / 1000) : 0;
	lastDeepSkyUpdate = now;
	for (const d of skyDeep) {
		// A supernova remnant shows once its supernova has faded.
		const formed = d.born === undefined || date.getTime() >= d.born;
		d.mesh.visible = formed;
		d.item.hoverable = formed && aboveGround(constellationAltitudes([d.item])[0]);
		const truePx = d.size[0] * pxPerRadian;
		const enlarge = Math.max(1, (DEEP_SKY_MIN_SHARE * window.innerHeight) / truePx);
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
		const map = photo?.material.uniforms.uMap.value as THREE.Texture | null | undefined;
		let photoSharp = 1;
		if (photo && map) {
			const target = truePx > DEEP_SKY_PHOTO_PX ? 1 : 0;
			photo.mix = target > photo.mix ? Math.min(target, photo.mix + dt * 2) : Math.max(target, photo.mix - dt * 2);
			const image = map.image as { width: number; height: number };
			photoSharp = sharpness((photo.span * pxPerRadian) / Math.max(image.width, image.height));
			photo.material.uniforms.uOpacity.value = formed ? skyFade.stars * motionFade * photo.mix * photoSharp : 0;
		}
		const mix = photo?.mix ?? 0;
		// The painted image: its DEEP_SKY_ART_PX pixels span the object's size, enlarged.
		const artSharp = sharpness((truePx * DEEP_SKY_IMAGE_SCALE * enlarge) / DEEP_SKY_ART_PX);
		d.material.opacity = skyFade.stars * motionFade * d.brightness * Math.max(0.3, enlarge ** -0.6) * (1 - mix) * artSharp;
		d.item.detail = mix * photoSharp > 0.5 ? creditLine(image) : undefined;
	}
}

// The painted deep-sky images' size (pixels; deepSkyArt.ts).
const DEEP_SKY_ART_PX = 256;

/** How much of an image to show at this many screen pixels per image pixel: all of it while sharp, none once blurry. */
function sharpness(screenPerImagePx: number): number {
	return 1 - smoothstep(IMAGE_SHARP_LIMIT[0], IMAGE_SHARP_LIMIT[1], screenPerImagePx);
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
	const photo: DeepSkyPhoto = { material, stage: 'loading', mix: 0, span: 0 };
	d.photo = photo;
	loadSkyImage(url)
		.then(({ texture, bitmap }) => {
			const fit = fitPhoto(bitmap);
			// Size of the photo's long side on the sky, kept within sensible framing.
			const major = d.size[0];
			const longSide = clamp(major / (4 * fit.spread), major * 1.2, major * 6);
			const width = longSide * Math.min(1, fit.aspect);
			const height = longSide * Math.min(1, 1 / fit.aspect);
			photo.span = longSide;
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
			if (d.ovalPhoto) material.uniforms.uRound.value = 1;
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
		// The comet being followed stays; others fade with the background when it streams by.
		const opacity = skyFade.stars * (item === trackedItem ? 1 : motionFade);
		visual.update(state, { opacity, pxPerRadian, dt, inView: inView(visual.object.children[0]) });
		item.local.copy(visual.head);
		const bright = state.magnitude < COMET_LIMIT;
		item.hoverable = bright && aboveGround(constellationAltitudes([item])[0]);
		item.name = `${comet.name} · ${state.distance.toFixed(2)} AU · magnitude ${state.magnitude.toFixed(1)}`;
		item.detail = visual.showingPhoto() ? creditLine(cometImages[comet.id]) : comet.about;
		// Frame the whole tail when locking on (close enough for its photo, if it has one).
		item.focusFov = clamp(THREE.MathUtils.radToDeg(visual.tailAngle()) * 1.8, 1, NAKED_EYE_FOV);
		item.photo = cometImages[comet.id] ? { angle: visual.tailAngle(), px: COMET_PHOTO_PX } : undefined;
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
	// The visitor's position on Earth, on the celestial sphere (RA = local sidereal time, Dec = latitude,
	// for the date's equator), turned back to J2000 like everything else placed on it.
	const lst = siderealAngle(obs, now);
	const lat = THREE.MathUtils.degToRad(obs.lat);
	const zenith = new THREE.Vector3(Math.cos(lat) * Math.cos(lst), Math.cos(lat) * Math.sin(lst), Math.sin(lat)).applyMatrix3(
		precessionAt(now).transpose(),
	);
	const pxPerRadian = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
	// The faintest magnitude the telescope shows at this magnification.
	const limit = NAKED_EYE_LIMIT + MAGNITUDE_PER_DECADE * Math.log10(Math.max(1, NAKED_EYE_FOV / camera.fov));
	const jupiter = bodies.find((body) => body.name === 'Jupiter')!;
	const jupiterDir = celestialDir(jupiter.ra, jupiter.dec);

	for (const entry of skyBodies) {
		const b = bodies.find((body) => body.name === entry.name)!;
		let dir = celestialDir(b.ra, b.dec);
		// The Moon is close enough that our spot on Earth's surface matters: seen from
		// the surface rather than Earth's center, it shifts by up to about 1°.
		if (b.name === 'Moon') dir = dir.multiplyScalar(b.earthRadii).sub(zenith).normalize();
		// Jupiter's moons sit nearer or farther than Jupiter, so they pass in front of it or behind.
		const moon = isGalileanMoon(b.name);
		const distance = b.name === 'Sun' ? SUN_DISTANCE : moon ? BODY_DISTANCE * (b.distance / jupiter.distance) : BODY_DISTANCE;
		const center = dir.clone().multiplyScalar(distance);
		const [poleRa, poleDec] = BODY_POLES[b.name];
		entry.visual.setPose(
			center,
			distance * Math.tan(b.angularRadius),
			celestialDir(b.sunward.ra, b.sunward.dec),
			celestialDir(poleRa / 15, poleDec),
			dir.clone().negate(),
		);
		// Too small to read as a globe, a body is just its point of light; the globe fades
		// in as the telescope zooms in (the Moon is always big enough to show its phase).
		const diskPx = 2 * b.angularRadius * pxPerRadian;
		const disk = b.name === 'Moon' ? 1 : smoothstep(DISK_FADE_PX[0], DISK_FADE_PX[1], diskPx);
		entry.visual.update(skyFade.stars * disk, now.getTime(), diskPx);

		const { item } = entry;
		item.local.copy(center);
		// Saturn's rings reach 2.27 planet radii, so frame and hover the whole system.
		item.angularRadius = b.angularRadius * (b.name === 'Saturn' ? 2.27 : 1);
		item.name =
			b.name === 'Moon'
				? `Moon · ${(Math.round((b.distance * KM_PER_AU) / 100) * 100).toLocaleString('en-US')} km · ${Math.round(b.litFraction * 100)}% lit`
				: `${b.name} · ${b.distance.toFixed(b.distance < 2 ? 2 : 1)} AU (${lightTime(b.distance)})`;
		item.detail = entry.visual.showingMap()
			? creditLine(planetMaps[b.name], 'Map', hasWeather(b.name))
			: b.magnitude > NAKED_EYE_LIMIT
				? `magnitude ${b.magnitude.toFixed(1)} · zoom in to see it`
				: undefined;
		const sinAlt = tmp.copy(dir).applyQuaternion(celestial!.quaternion).dot(surfaceFrame!.n);
		// Too faint for this magnification, or a moon still lost in Jupiter's glare: not hoverable (yet).
		const separationPx = moon ? dir.angleTo(jupiterDir) * pxPerRadian : Infinity;
		const seen = smoothstep(limit + 1, limit - 1, b.magnitude) * (moon ? smoothstep(MOON_SEPARATION_PX * 0.6, MOON_SEPARATION_PX, separationPx) : 1);
		item.hoverable = aboveGround(sinAlt) && seen > 0.5;
		// Saturn's rings skip the depth test (see skyBodies.ts), so the ground can't hide them:
		// hide bodies below the horizon outright. Not while the ground itself is hidden
		// (following something below the horizon): then neighbors, like Jupiter's moons,
		// stay in view with it.
		entry.visual.object.visible = sinAlt > -0.02 || item === trackedItem || groundHidden >= 1;

		if (entry.glow && entry.glowPosition) {
			entry.glowPosition.setXYZ(0, center.x, center.y, center.z);
			entry.glowPosition.needsUpdate = true;
			const size = entry.glow.uniforms.uSize;
			// Through the telescope a body looks as much brighter as its reach goes deeper.
			const apparent = b.magnitude - (limit - NAKED_EYE_LIMIT);
			// The Sun outshines everything: a bigger glow.
			size.value = clamp(2.3 - 0.35 * apparent, 0.8, b.name === 'Sun' ? 7 : 3.4);
			// Faint bodies are dim points, and those past the telescope's reach don't show at all.
			const faint = clamp(1 - (apparent - 4.5) * 0.2, 0.35, 1) * seen;
			entry.glow.uniforms.uOpacity.value = entry.visual.object.visible ? skyFade.stars * faint * (1 - disk) : 0;
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
				vec4 world = modelMatrix * vec4(position, 1.0); // for the altitude-based twinkle
				vec4 view = modelViewMatrix * vec4(position, 1.0);
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
	// Drawn before everything else, so it hides what's below the horizon by depth rather than
	// by painting over it.
	plane.renderOrder = -1;
	groundMesh = plane;
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
	// buildSky frames the new featured constellation; the frame loop eases toward it,
	// then the view widens out again.
	stopWideningView();
	const aim = buildSky();
	easeOutToWideView(0.8);
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

/** Give each star's item its spectral type and its point of light in the geometry. */
/** Where a catalog star sits on the celestial sphere at a date (with its proper motion). */
function starLocal(s: SkyStar, date: Date): THREE.Vector3 {
	const at = starAt(s, date);
	return celestialDir(at.ra, at.dec).multiplyScalar(SKY_RADIUS);
}

/** Re-place the stars with proper motion once the clock has moved far enough. */
function moveStars(date: Date) {
	if (Math.abs(date.getTime() - starsPlacedAt) < STAR_MOVE_MS) return;
	starsPlacedAt = date.getTime();
	for (const { star, item, spots } of movingStars) {
		item.local.copy(starLocal(star, date));
		for (const { attribute, index } of spots) {
			attribute.setXYZ(index, item.local.x, item.local.y, item.local.z);
			attribute.needsUpdate = true;
		}
	}
}

function markStars(items: SkyItem[], stars: SkyStar[], geometry: THREE.BufferGeometry) {
	const sizes = geometry.getAttribute('aSize') as THREE.BufferAttribute;
	items.forEach((item, i) => {
		item.starType = starType(stars[i].bv);
		item.point = { sizes, index: i, size: sizes.getX(i) };
	});
}

/** The star the simulation should be on: the one locked onto, or else the one nearest the middle when zoomed in. */
function starSimTarget(magnification: number): SkyItem | null {
	if (trackedItem?.starType !== undefined) return trackedItem;
	if (trackedItem || magnification < STAR_SIM_ZOOM[0]) return null;
	const w = window.innerWidth;
	const h = window.innerHeight;
	camera.getWorldDirection(forward);
	let best: SkyItem | null = null;
	let bestDistance = STAR_SIM_PICK_PX;
	for (const item of [...skyConstellations.flatMap((c) => c.items), ...(skyLoose?.items ?? [])]) {
		if (!item.hoverable) continue;
		const world = worldOf(item);
		if (tmp.copy(world).sub(camera.position).dot(forward) <= 0) continue;
		const [x, y] = toScreen(world, w, h);
		const distance = Math.hypot(x - w / 2, y - h / 2);
		if (distance < bestDistance) {
			best = item;
			bestDistance = distance;
		}
	}
	return best;
}

/** Hide (amount 1) or restore (0) a star's point of light. */
function dimStarPoint(item: SkyItem | null, amount: number) {
	if (!item?.point) return;
	const { sizes, index, size } = item.point;
	sizes.setX(index, size * (1 - amount));
	sizes.needsUpdate = true;
}

/**
 * Each frame: the star simulation on the star being zoomed into. It fades in over its
 * point of light as the magnification rises past STAR_SIM_ZOOM, sized like the star's
 * close-up image would be; switching stars fades the old one out first.
 */
function updateStarSim(dt: number) {
	const sim = starSim;
	if (!sim) return;
	const magnification = NAKED_EYE_FOV / camera.fov;
	const want = starSimTarget(magnification);
	if (want !== sim.item) {
		if (sim.item && sim.mix > 0.02) sim.mix = Math.max(0, sim.mix - dt * 5);
		else {
			dimStarPoint(sim.item, 0);
			sim.item = want;
			sim.mix = 0;
			if (want) applyStarLook(sim.surface, sim.corona, STAR_LOOKS[want.starType!]);
		}
	} else if (want) {
		const target = smoothstep(STAR_SIM_ZOOM[0], STAR_SIM_ZOOM[1], magnification);
		sim.mix += (target - sim.mix) * Math.min(1, dt * 4);
	}
	const item = sim.item;
	sim.group.visible = !!item && sim.mix > 0.002;
	if (!item) return;
	dimStarPoint(item, sim.mix);
	if (!sim.group.visible) return;

	// Sized on screen like the star's close-up image, growing with the zoom.
	const pxPerRadian = window.innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
	const radiusPx = starSimRadiusPx(magnification);
	const dir = item.local.clone().normalize();
	const radius = (radiusPx / pxPerRadian) * STAR_SIM_DISTANCE;
	sim.group.position.copy(dir).multiplyScalar(STAR_SIM_DISTANCE);
	// Facing us, with its pole toward the celestial north.
	const z = dir.clone().negate();
	const y = new THREE.Vector3(0, 0, 1).addScaledVector(z, -z.z);
	if (y.lengthSq() < 1e-8) y.set(1, 0, 0);
	y.normalize();
	const x = new THREE.Vector3().crossVectors(y, z);
	sim.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
	sim.sphere.scale.setScalar(radius);
	const seconds = performance.now() / 1000;
	sim.sphere.rotation.y = seconds * 0.03;
	const opacity = sim.mix * skyFade.stars;
	sim.surface.uniforms.uTime.value = seconds;
	sim.surface.uniforms.uOpacity.value = opacity;
	sim.corona.uniforms.uTime.value = seconds;
	sim.corona.uniforms.uOpacity.value = opacity;
	sim.corona.uniforms.uRadius.value = radius;
}

/** Light travel time for a distance in AU: "8 light-minutes", "4.6 light-hours". */
function lightTime(au: number): string {
	const minutes = (au * KM_PER_AU) / 299792.458 / 60;
	return minutes < 120 ? `${Math.round(minutes)} light-minutes` : `${(minutes / 60).toFixed(1)} light-hours`;
}

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
