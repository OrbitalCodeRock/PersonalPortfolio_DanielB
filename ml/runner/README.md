# Runner level model

A learned level builder for the rooftop runner on the Now page. A small sequence model writes segment
**recipes** (see `src/secrets/runner/levelgen.ts`) one feature at a time, conditioned on the time band
and a target difficulty. The game's own bot, run headless in Node, judges what it writes.

## Setup (once)

```
cd ml/runner
python -m venv .venv
.venv/Scripts/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python -m pip install numpy
```

(macOS/Linux: `.venv/bin/python`.) The CPU build is enough: the model is small, and most of the time
goes to bot playtests in Node.

## Pipeline

Run these from the repo root unless noted.

1. **Schema**: `node scripts/runner/schema.ts` writes `ml/runner/schema.json` (feature types, the tier
   each appears from, and their parameter names). Re-run it whenever features change.
2. **Training data**: `npm run runner:search` runs the MAP-Elites search, which logs every recipe it
   playtests to `ml/runner/data/search-tier*.jsonl` (about 15,000 rows at the default budget).
3. **Pretrain** (from `ml/runner`): `.venv/Scripts/python -m runner_ml.train pretrain` imitates the
   search's valid recipes, each conditioned on its measured difficulty, weighting better ones more.
4. **Fine-tune**: `.venv/Scripts/python -m runner_ml.train finetune` uses REINFORCE against the bot.
   The model writes recipes for random tiers and target difficulties, Node scores them
   (`scripts/runner/evaluate-batch.ts`), and the reward is for clearing, hitting the target survival
   rate, the search's quality measure, and novelty. Every valid recipe it finds is logged to
   `data/finetune-found.jsonl`.
5. **Generate**: `.venv/Scripts/python -m runner_ml.generate` writes `output/pools.model.json`; add
   `--install` to copy it to `src/secrets/runner/pools.json`, the file the game plays. It only keeps
   recipes a perfect bot clears across the whole band, inside the band's difficulty range, with every
   mechanic actually needed.

`npm run runner:evaluate` playtests whatever pools are installed.

## Files

| Path | What it is |
| --- | --- |
| `runner_ml/schema.py` | Loads `schema.json`; bins, the longest recipe, each tier's difficulty range (`TARGET`, mirrors `scripts/runner/search.ts`). |
| `runner_ml/encode.py` | Recipes to tensors and back. Parameters are predicted as one of 16 bins. |
| `runner_ml/model.py` | The generator: a GRU conditioned on tier and target difficulty. Each step picks a feature type (or END), then its parameters. Types the tier doesn't allow, a second train, and ending before 3 features are masked out. |
| `runner_ml/evaluator.py` | Runs a few Node evaluators in parallel and sends recipes to them. |
| `runner_ml/train.py` | `pretrain` and `finetune`. |
| `runner_ml/generate.py` | Writes pools. |

`data/`, `checkpoints/`, `output/` and `.venv/` are git-ignored.

## Next

* **Player votes**: a thumbs up/down after a run, stored per recipe id in D1 by the leaderboard Worker.
  A small model that predicts votes from a recipe can then be added to the fine-tuning reward.
* **A learned playing agent** to replace the scripted bot as the judge.
