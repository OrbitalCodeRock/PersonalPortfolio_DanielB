# Daniel Beyer — Personal Portfolio

Personal portfolio site built with [Astro](https://astro.build), [GSAP](https://gsap.com) and [Three.js](https://threejs.org).
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
