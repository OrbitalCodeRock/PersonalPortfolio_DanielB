"""Training the level generator.

  python -m runner_ml.train pretrain [--epochs 40]
      Imitate the good recipes the MAP-Elites search found (ml/runner/data/search-tier*.jsonl), each
      conditioned on its tier and measured difficulty. Better recipes (higher fitness) count more.

  python -m runner_ml.train finetune [--steps 150] [--batch 48]
      Reinforcement learning (REINFORCE) against the game's bot: the model writes recipes for random
      tiers and target difficulties, Node playtests them, and the reward is for clearing, landing on
      the target difficulty, the search's quality measure, and novelty.

Run from ml/runner with the venv's Python (see ml/runner/README.md).
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import torch

from .encode import batch, decode, encode
from .evaluator import NodeEvaluator
from .model import Generator, load, save
from .schema import ROOT, TARGET, load_schema

DATA = ROOT / "data"
CKPT = ROOT / "checkpoints"


def load_search_data(schema):
    items = []
    for path in sorted(DATA.glob("search-tier*.jsonl")):
        for line in path.read_text(encoding="utf8").splitlines():
            if not line:
                continue
            row = json.loads(line)
            if not row["score"]["valid"]:
                continue
            enc = encode(row["recipe"], schema)
            if enc:
                items.append((enc, row["recipe"]["tier"], row["score"]["rate"], row["score"]["fitness"]))
    return items


def pretrain(args) -> None:
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    schema = load_schema()
    data = load_search_data(schema)
    if not data:
        raise SystemExit("No training data: run `npm run runner:search` first (it logs to ml/runner/data/).")
    random.shuffle(data)
    n_val = max(1, len(data) // 10)
    val, train = data[:n_val], data[n_val:]
    print(f"pretrain: {len(train)} recipes to learn from, {len(val)} held out")
    model = Generator(schema)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    def run(rows, learn: bool) -> float:
        total, weight = 0.0, 0.0
        for i in range(0, len(rows), args.batch):
            chunk = rows[i : i + args.batch]
            types, bins, mask = batch([r[0] for r in chunk], schema)
            tier = torch.tensor([r[1] for r in chunk])
            diff = torch.tensor([r[2] for r in chunk], dtype=torch.float)
            w = torch.tensor([0.2 + r[3] ** 2 for r in chunk])
            nll = model.loss(types, bins, mask, tier, diff)
            loss = (nll * w).sum() / w.sum()
            if learn:
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
            total += float((nll * w).sum().detach())
            weight += float(w.sum())
        return total / weight

    CKPT.mkdir(exist_ok=True)
    best = float("inf")
    for epoch in range(1, args.epochs + 1):
        random.shuffle(train)
        model.train()
        tr = run(train, True)
        model.eval()
        with torch.no_grad():
            va = run(val, False)
        mark = ""
        if va < best:
            best = va
            save(model, CKPT / "pretrained.pt")
            mark = "  (saved)"
        print(f"  epoch {epoch:3d}  train nll {tr:7.2f}  held-out nll {va:7.2f}{mark}")
    print(f"Saved {CKPT / 'pretrained.pt'}")


def reward(score: dict, target: float, novel: bool) -> float:
    if not score["valid"]:
        return -0.3 if score.get("reason") == "unclearable" else -0.5
    on_target = max(0.0, 1.0 - 2.5 * abs(score["rate"] - target))
    return 0.6 * score["fitness"] + on_target + (0.3 if novel else 0.0)


def finetune(args) -> None:
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    schema = load_schema()
    src = CKPT / ("finetuned.pt" if args.resume else "pretrained.pt")
    model = load(schema, src)
    print(f"finetune: starting from {src.name}, {args.steps} steps of {args.batch}")
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    baseline = [0.0] * schema.tiers
    seen: set[str] = set()
    found = (DATA / "finetune-found.jsonl").open("a", encoding="utf8")
    with NodeEvaluator(args.workers) as ev:
        for step in range(1, args.steps + 1):
            t0 = time.time()
            tiers = [random.randrange(schema.tiers) for _ in range(args.batch)]
            targets = [random.uniform(*TARGET[t]) for t in tiers]
            model.train()
            types, bins, logp, ent = model.sample(torch.tensor(tiers), torch.tensor(targets, dtype=torch.float))
            recipes = [decode(t, types[i].tolist(), bins[i].tolist(), schema) for i, t in enumerate(tiers)]
            scores = ev.score(recipes, trials=args.trials)
            rewards, gaps, valid = [], [], 0
            for r, s, tgt in zip(recipes, scores, targets):
                sig = f"{r['tier']}:" + ",".join(f["type"] for f in r["features"])
                novel = sig not in seen
                rewards.append(reward(s, tgt, novel))
                if s["valid"]:
                    valid += 1
                    seen.add(sig)
                    gaps.append(abs(s["rate"] - tgt))
                    found.write(json.dumps({"recipe": r, "score": s, "target": tgt}) + "\n")
            rw = torch.tensor(rewards)
            adv = torch.tensor([rewards[i] - baseline[t] for i, t in enumerate(tiers)])
            for i, t in enumerate(tiers):
                baseline[t] = 0.9 * baseline[t] + 0.1 * rewards[i]
            loss = -(adv * logp).mean() - args.entropy * ent.mean()
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            found.flush()
            gap = sum(gaps) / len(gaps) if gaps else float("nan")
            print(
                f"  step {step:4d}  valid {valid:2d}/{args.batch}  reward {float(rw.mean()):5.2f}  "
                f"off-target {gap:4.2f}  ({time.time() - t0:4.1f} s)"
            )
            if step % 10 == 0 or step == args.steps:
                save(model, CKPT / "finetuned.pt")
    found.close()
    print(f"Saved {CKPT / 'finetuned.pt'}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="runner_ml.train")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pretrain")
    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--batch", type=int, default=128)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--seed", type=int, default=1)
    f = sub.add_parser("finetune")
    f.add_argument("--steps", type=int, default=150)
    f.add_argument("--batch", type=int, default=48)
    f.add_argument("--lr", type=float, default=3e-4)
    f.add_argument("--trials", type=int, default=6)
    f.add_argument("--entropy", type=float, default=0.003)
    f.add_argument("--workers", type=int, default=6)
    f.add_argument("--resume", action="store_true", help="continue from checkpoints/finetuned.pt")
    f.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    {"pretrain": pretrain, "finetune": finetune}[args.cmd](args)


if __name__ == "__main__":
    main()
