"""Writing level pools with the trained generator.

  python -m runner_ml.generate [--per-tier 10] [--candidates 80] [--install]

For each tier, the model writes candidates at target difficulties across that tier's range; Node
playtests each one (more trials than in training, for a steadier survival rate). Valid candidates in
range are kept, best first, one per sequence of feature types, if they also pass the strict check: a
perfect bot clears them entering at every second of the band, normally and arriving boosted. The result goes to
ml/runner/output/pools.model.json; --install also copies it to src/secrets/runner/pools.json, the
file the game plays.
"""

from __future__ import annotations

import argparse
import json
import random

import torch

from .encode import decode
from .evaluator import NodeEvaluator
from .model import load
from .schema import REPO, ROOT, TARGET, load_schema

CKPT = ROOT / "checkpoints"
OUT = ROOT / "output"


def main() -> None:
    ap = argparse.ArgumentParser(prog="runner_ml.generate")
    ap.add_argument("--per-tier", type=int, default=10)
    ap.add_argument("--candidates", type=int, default=80)
    ap.add_argument("--temperature", type=float, default=0.85)
    ap.add_argument("--trials", type=int, default=16)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--model", default=None, help="checkpoint (default: finetuned.pt, else pretrained.pt)")
    ap.add_argument("--install", action="store_true", help="also write src/secrets/runner/pools.json")
    ap.add_argument("--seed", type=int, default=3)
    args = ap.parse_args()
    torch.manual_seed(args.seed)
    random.seed(args.seed)

    schema = load_schema()
    path = CKPT / args.model if args.model else (CKPT / "finetuned.pt" if (CKPT / "finetuned.pt").exists() else CKPT / "pretrained.pt")
    model = load(schema, path)
    model.eval()
    print(f"generate: {path.name}, {args.candidates} candidates per tier")

    pools = []
    with NodeEvaluator(args.workers) as ev, torch.no_grad():
        for tier in range(schema.tiers):
            lo, hi = TARGET[tier]
            targets = [lo + (hi - lo) * (i + 0.5) / args.candidates for i in range(args.candidates)]
            types, bins, _, _ = model.sample(
                torch.full((args.candidates,), tier), torch.tensor(targets, dtype=torch.float), args.temperature
            )
            recipes = [decode(tier, types[i].tolist(), bins[i].tolist(), schema) for i in range(args.candidates)]
            scores = ev.score(recipes, trials=args.trials)
            good = [
                (r, s)
                for r, s in zip(recipes, scores)
                if s["valid"] and lo <= s["rate"] <= hi and s["usedRatio"] >= 0.99
            ]
            good.sort(key=lambda rs: -rs[1]["fitness"])
            # Best first, one per sequence of feature types, and each must pass the strict full-band check.
            unique, sigs = [], set()
            for r, s in good:
                sig = ",".join(f["type"] for f in r["features"])
                if sig not in sigs:
                    sigs.add(sig)
                    unique.append(r)
            chosen = []
            for i in range(0, len(unique), args.per_tier):
                chunk = unique[i : i + args.per_tier]
                for r, ok in zip(chunk, ev.strict(chunk)):
                    if ok and len(chosen) < args.per_tier:
                        chosen.append({**r, "id": f"m{tier}-{len(chosen) + 1:02d}"})
                if len(chosen) >= args.per_tier:
                    break
            valid = sum(1 for s in scores if s["valid"])
            print(
                f"  tier {tier}: {valid}/{args.candidates} valid, {len(good)} in range, {len(unique)} distinct, "
                f"kept {len(chosen)} that pass the strict check"
            )
            pools.append(chosen)

    OUT.mkdir(exist_ok=True)
    doc = {"note": f"Written by ml/runner (runner_ml.generate, {path.name}).", "pools": pools}
    text = json.dumps(doc, indent="\t") + "\n"
    (OUT / "pools.model.json").write_text(text, encoding="utf8")
    print(f"Saved {OUT / 'pools.model.json'}")
    if args.install:
        if any(len(p) < 3 for p in pools):
            raise SystemExit("Some tier got fewer than 3 recipes; not installing. Train more or raise --candidates.")
        (REPO / "src/secrets/runner/pools.json").write_text(text, encoding="utf8")
        print("Installed to src/secrets/runner/pools.json")


if __name__ == "__main__":
    main()
