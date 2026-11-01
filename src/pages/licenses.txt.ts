// /licenses.txt: the license notices for the third-party code bundled into the site's
// scripts. Their licenses ask for the notices to travel with the code, and the build's
// minifier drops them from the bundles, so they're served here instead (linked from
// /credits). Read from the installed packages at build time, so versions and years
// stay current.
import type { APIRoute } from 'astro';

const files = import.meta.glob<string>(
	[
		'/node_modules/three/LICENSE',
		'/node_modules/three/package.json',
		'/node_modules/astro/LICENSE',
		'/node_modules/astro/package.json',
		'/node_modules/gsap/package.json',
		'/node_modules/astronomy-engine/package.json',
		'/node_modules/astronomy-engine/esm/astronomy.js',
	],
	{ query: '?raw', import: 'default', eager: true },
);
const read = (path: string) => files[`/node_modules/${path}`];
const version = (pkg: string) => JSON.parse(read(`${pkg}/package.json`)).version as string;

/** astronomy-engine ships its MIT notice only in the header comment of its source. */
function astronomyEngineLicense(): string {
	const source = read('astronomy-engine/esm/astronomy.js');
	const start = source.indexOf('MIT License');
	const end = source.indexOf('SOFTWARE.', source.lastIndexOf('IN THE', source.indexOf('*/', start))) + 'SOFTWARE.'.length;
	return source
		.slice(start, end)
		.split('\n')
		.map((line) => line.trim())
		.join('\n');
}

const packages = [
	{ name: 'three.js', pkg: 'three', url: 'https://threejs.org', notice: () => read('three/LICENSE') },
	{ name: 'Astronomy Engine', pkg: 'astronomy-engine', url: 'https://github.com/cosinekitty/astronomy', notice: astronomyEngineLicense },
	{ name: 'Astro (client scripts)', pkg: 'astro', url: 'https://astro.build', notice: () => read('astro/LICENSE') },
	{
		name: 'GSAP',
		pkg: 'gsap',
		url: 'https://gsap.com',
		notice: () => 'Copyright GreenSock, Inc. Used under GSAP\'s Standard "No Charge" License:\nhttps://gsap.com/standard-license',
	},
];

export const GET: APIRoute = () => {
	const sections = packages.map(({ name, pkg, url, notice }) => `${name} ${version(pkg)} (${url})\n\n${notice().trim()}`);
	const text = [
		'Third-party software in this site',
		'',
		'The scripts on this site include the libraries below. Each is used under its own license, reproduced here. Image credits are at /credits.',
		...sections.map((s) => `\n${'-'.repeat(72)}\n\n${s}`),
		'',
	].join('\n');
	return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
