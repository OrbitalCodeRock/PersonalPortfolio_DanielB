# Daniel Beyer — Personal Portfolio

Personal portfolio site built with [Astro](https://astro.build), [GSAP](https://gsap.com) and [Three.js](https://threejs.org),
with positions in the sky view from [Astronomy Engine](https://github.com/cosinekitty/astronomy).
Deployed on Cloudflare Workers (static assets, see `wrangler.jsonc`) from the `main` branch.

## Commands

| Command           | Action                                    |
| :---------------- | :---------------------------------------- |
| `npm install`     | Install dependencies                      |
| `npm run dev`     | Start the dev server at `localhost:4321`  |
| `npm run build`   | Build the static site to `./dist/`        |
| `npm run preview` | Preview the production build locally      |

## Structure

- `src/pages/` — one file per route (home hub, About, Education, Portfolios, …)
- `src/layouts/` — `BaseLayout` (nav, page transitions, starfield) and `PlaceholderPage`
- `src/components/` — `Starfield` (Three.js background), `HubGrid` (GSAP-animated link cards)
- `src/data/sections.ts` — the site map used by the nav and hub pages

## Image credits

The sky view shows real planet maps, deep-sky photos and comet photos once you zoom in. They live in `public/sky/`,
resized and recompressed for the web, and are used under their own licenses (CC BY, CC BY-SA, CC0 or
public domain; NASA, ESA, ESO, USGS, Solar System Scope and individual astrophotographers via Wikimedia Commons).
Each image's author, license and source link is in `src/data/skyImages.ts` and listed on the site at
`/credits`, which the sky view links to from its location menu. Any image added there needs the same.

## Code and data credits

The site's scripts bundle these libraries, each used under its own license:

| Library | Author | License |
| :------ | :----- | :------ |
| [Three.js](https://github.com/mrdoob/three.js) | three.js authors | MIT |
| [GSAP](https://gsap.com) | GreenSock | [Standard "No Charge" License](https://gsap.com/standard-license) |
| [Astronomy Engine](https://github.com/cosinekitty/astronomy) | Don Cross | MIT |
| [Astro](https://github.com/withastro/astro) (client scripts) | Astro contributors | MIT |

The build's minifier strips license comments from the bundles, so the full notices are served at `/licenses.txt`
instead, generated from the installed packages by `src/pages/licenses.txt.ts` (linked from `/credits`). A new
library that ends up in the site's scripts needs adding there and here.

The sky view's own math follows published methods, cited in the code: IAU 1976 precession (Lieske 1979) and
mean sidereal time (Meeus, *Astronomical Algorithms*); star proper motions are Hipparcos and Gaia values.

## License

Copyright (c) 2026 Daniel Beyer. All rights reserved: see `LICENSE`. The images in `public/sky/` and the npm
libraries above keep their own licenses.
