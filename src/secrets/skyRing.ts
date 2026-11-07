// Sky view secret: stand at the coordinates from the Holbein puzzle (London) in the year the painting
// was made (1533), and a ring-shaped habitat appears in the sky; the view zooms to it and a note gives
// the chess puzzle's moves. Checked from PlanetExplorer's clock ticker while the sky view is open.
import * as THREE from 'three';
import { getObserver, skyNow } from '../scripts/sky';
import { getSkyLook, isInSky, placeInSky } from '../scripts/cosmos';
import { CHESS_HINT, SKY_TARGET } from './config';
import { openWindow, solve } from './ui';

let ring: THREE.Group | null = null;
let matched = false;
let spinFrame = 0;
let since = 0;
const SETTLE_MS = 1600;

function matches(): boolean {
	const obs = getObserver();
	const { lat, lon, year, tolerance } = SKY_TARGET;
	return (
		skyNow().getUTCFullYear() === year && Math.abs(obs.lat - lat) <= tolerance && Math.abs(obs.lon - lon) <= tolerance
	);
}

/** A ring habitat: a wide, thin band with land, sea and cloud on its inner face and dark hull outside. */
function buildRing(): THREE.Group {
	const R = 0.62;
	const W = 0.07;
	const inner = document.createElement('canvas');
	inner.width = 2048;
	inner.height = 64;
	const g = inner.getContext('2d')!;
	g.fillStyle = '#1d4e7a';
	g.fillRect(0, 0, inner.width, inner.height);
	// Continents and cloud bands, seeded so the ring looks the same every time.
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
	for (let i = 0; i < 70; i++) {
		const x = rnd() * inner.width;
		const w = 30 + rnd() * 160;
		g.fillStyle = rnd() < 0.7 ? `hsl(${95 + rnd() * 40}, 38%, ${26 + rnd() * 14}%)` : `hsl(38, 30%, ${44 + rnd() * 12}%)`;
		g.beginPath();
		g.ellipse(x, 18 + rnd() * 28, w / 2, 8 + rnd() * 14, 0, 0, Math.PI * 2);
		g.fill();
	}
	g.globalAlpha = 0.5;
	for (let i = 0; i < 50; i++) {
		g.fillStyle = '#f2f6ff';
		g.beginPath();
		g.ellipse(rnd() * inner.width, rnd() * 64, 20 + rnd() * 70, 2 + rnd() * 4, 0, 0, Math.PI * 2);
		g.fill();
	}
	g.globalAlpha = 1;
	// Walls along both rims.
	g.fillStyle = '#b8c0cc';
	g.fillRect(0, 0, inner.width, 5);
	g.fillRect(0, inner.height - 5, inner.width, 5);
	const texture = new THREE.CanvasTexture(inner);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.anisotropy = 4;

	const band = new THREE.CylinderGeometry(R, R, W, 256, 1, true);
	const group = new THREE.Group();
	const innerFace = new THREE.Mesh(
		band,
		new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, transparent: true, depthWrite: false }),
	);
	const hull = new THREE.Mesh(
		band,
		new THREE.MeshBasicMaterial({ color: 0x5b6577, side: THREE.FrontSide, transparent: true, depthWrite: false }),
	);
	// A soft glint along the hull's lit edge.
	const rim = new THREE.Mesh(
		new THREE.TorusGeometry(R, 0.004, 6, 256),
		new THREE.MeshBasicMaterial({ color: 0xffe7a3, transparent: true, opacity: 0.55, depthWrite: false }),
	);
	rim.rotation.x = Math.PI / 2;
	rim.position.y = W / 2;
	const spinner = new THREE.Group();
	spinner.add(hull, innerFace, rim);
	// Tilt the band so its inner face shows, like a ring seen from slightly above.
	spinner.rotation.set(0.62, 0, 0.35);
	group.add(spinner);
	group.userData.spinner = spinner;
	group.renderOrder = 5;
	return group;
}

function spin() {
	const spinner = ring?.userData.spinner as THREE.Object3D | undefined;
	if (!spinner || !ring || !isInSky(ring)) {
		spinFrame = 0;
		return;
	}
	spinner.rotateY(0.0009);
	spinFrame = requestAnimationFrame(spin);
}

/** Called a few times a second while the sky view is open. */
export function checkSkySecret() {
	if (!matches()) {
		matched = false;
		since = 0;
		return;
	}
	if (ring && isInSky(ring)) return;
	// Wait for the sky to settle: picking a place redraws it and eases the view back out,
	// which would undo the zoom.
	since ||= performance.now();
	if (performance.now() - since < SETTLE_MS) return;
	const look = getSkyLook();
	if (!look) return;
	const first = !matched;
	matched = true;
	ring = buildRing();
	// Put it a little above wherever the visitor is facing, and zoom in the first time.
	const alt = Math.min(Math.max(look.pitch + 0.15, 0.6), 1.2);
	if (!placeInSky(ring, alt, look.heading, first ? 4 : undefined)) {
		ring = null;
		matched = false;
		return;
	}
	if (!spinFrame) spinFrame = requestAnimationFrame(spin);
	if (first) setTimeout(showChessHint, 3200);
}

function showChessHint() {
	solve('sky');
	const win = openWindow({ title: 'A signal from the ring', width: 420 });
	win.body.innerHTML = `
		<p>Something out there is playing a very old game. It sends only its own moves:</p>
		<code class="secret-code" style="text-align:center;font-size:1.05rem;white-space:normal">${CHESS_HINT.map(
			(m, i) => `${i + 1}. ${m}`,
		).join('&nbsp;&nbsp; ')}</code>
		<p style="margin-top:1em" class="secret-hint">Some games were written in the stars. Others were played here, once.</p>`;
}
