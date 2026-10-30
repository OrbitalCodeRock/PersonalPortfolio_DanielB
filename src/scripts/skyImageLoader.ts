// Loading the sky view's real images (planet maps, deep-sky photos) on demand.
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
