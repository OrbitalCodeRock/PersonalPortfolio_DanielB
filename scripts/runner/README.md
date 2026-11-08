# Runner level tools

Tools for building and judging segments of the rooftop runner (the Now page's secret). They run in
Node 24+ directly on the game's TypeScript, with no build step.

```
npm run runner:evaluate            # playtest every pool entry with the bot, print a table
npm run runner:evaluate -- 2 3     # only tiers 2 and 3
npm run runner:search              # MAP-Elites search; rewrites src/secrets/runner/pools.json
npm run runner:search -- --evals 4000 --tiers 2,3 --pool 12 --seed 3
npm run runner:votes               # download players' thumbs up/down segment ratings (add -- --local for wrangler dev)
```

## How the pieces fit

| File | What it is |
| --- | --- |
| `src/secrets/runner/levelgen.ts` | Recipes and the builder. A recipe is a tier plus a list of features, each with named parameters from 0 to 1. The builder maps each parameter to metres within the range that's physically sensible for that tier, so any recipe gives rooftops a runner can in principle clear. `sampleRecipe(seed, tier)` makes a random one; seeds are just a shorthand for these. |
| `src/secrets/runner/sim.ts` | The world and physics, with no drawing or sound. The game draws it; these tools run it headless. |
| `src/secrets/runner/bot.ts` | A scripted playtest bot (not learned). `skill` adds reaction delay and sloppier jumps, so repeated runs give a survival rate. |
| `src/secrets/runner/playtest.ts` | Runs the bot through one segment: `trial` (one run) and `evaluate` (a perfect run plus several sloppy runs across the time band). |
| `src/secrets/runner/pools.json` | The recipe pools the game plays, one per tier, written by the search or the model (`ml/runner`). A tier with recipes here uses them; otherwise the game falls back to the seed pools in `seeds.ts`. |
| `scripts/runner/score.ts` | Shared scoring (validity, survival rate, quality), plus `strictClears`, the full-band check used before a recipe enters a pool. |
| `scripts/runner/evaluate-batch.ts` | A line-by-line JSON evaluator the Python model talks to. |
| `src/secrets/runner/poolVersion.ts` | The pools plus a short hash of them. Ratings record it, since ids like `m2-07` are reused when the pools are regenerated. |
| `scripts/runner/votes.ts` | Downloads the segment ratings from D1 to `ml/runner/data/votes.jsonl` (each with the recipe as it was) and prints a per-recipe tally. |
| `scripts/runner/search.ts` | MAP-Elites: mutates recipes, playtests each, and keeps the best per cell of a difficulty × variety grid. Each tier's pool comes from the difficulty range in `TARGET`. |

### What the search scores

* **Difficulty** is the share of sloppy-bot runs that survive. `TARGET` sets the range each tier's pool
  is drawn from: forgiving in the first band, harder later.
* **Variety** is how many different feature types the recipe has; each grid cell keeps its best few.
* **Quality**, within a cell: features that exist to teach a mechanic (grapples, drones, trains,
  climbs, vents, ramps…) must actually be needed, so the perfect run has to use them. Then a mix of
  feature types, and a length close to 15 s.
* Recipes a perfect-timing bot can't clear are thrown out.

Adding or reweighting features in `levelgen.ts` changes what seeds produce, and can change how a
recipe plays. Re-run the search afterwards.

## Next steps

1. **Player ratings** are built: after each pool segment, a faint prompt at the top of the game offers
   thumbs up/down on it for a few seconds (keys 1 and 2, or a tap); when a run ends it asks about the
   segment that ended it. The Worker (`worker/index.ts`, `POST /api/runner/vote`) stores one rating per
   segment of a run in D1, with whether it was cleared or ended the run, and the time spent in it
   (`migrations/0002_runner_votes.sql`). Once there are enough, a model of ratings can join the
   generator's reward.
2. **The generative model** is built: see `ml/runner/README.md`. It's pretrained on the search's logs,
   fine-tuned against the bot, and its pools are what the game currently plays. A model of player
   votes can be added to its reward once votes exist.
3. **A learned playing agent** to replace `bot.ts` as the judge (same `trial`/`evaluate` interface).
