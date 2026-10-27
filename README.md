# Daniel Beyer — Personal Portfolio

Personal portfolio site built with [Astro](https://astro.build), [GSAP](https://gsap.com) and [Three.js](https://threejs.org).
Deployed on Cloudflare Pages from the `main` branch.

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
