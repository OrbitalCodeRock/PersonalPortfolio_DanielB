"""Scoring recipes with the game's own bot, via Node (scripts/runner/evaluate-batch.ts).

Starts a few long-running Node processes and spreads recipes across them, one JSON line each way.
"""

from __future__ import annotations

import json
import subprocess
import threading

from .schema import REPO


class NodeEvaluator:
    def __init__(self, workers: int = 6):
        self.procs = [
            subprocess.Popen(
                ["node", "scripts/runner/evaluate-batch.ts"],
                cwd=REPO,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                text=True,
                encoding="utf8",
                bufsize=1,
            )
            for _ in range(workers)
        ]

    def strict(self, recipes: list[dict]) -> list[bool]:
        """Whether each clears at every second of its band, at normal speed and arriving boosted."""
        return [s["strict"] for s in self.score(recipes, strict=True)]

    def score(self, recipes: list[dict], trials: int = 8, strict: bool = False) -> list[dict]:
        """One score per recipe (see scripts/runner/score.ts for the fields)."""
        results: list[dict | None] = [None] * len(recipes)

        def run(proc: subprocess.Popen, idx: list[int]) -> None:
            # One request, one reply: never lets either pipe fill up.
            for i in idx:
                proc.stdin.write(json.dumps({"id": i, "recipe": recipes[i], "trials": trials, "strict": strict}) + "\n")
                proc.stdin.flush()
                msg = json.loads(proc.stdout.readline())
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                results[msg["id"]] = msg["score"]

        chunks = [list(range(len(recipes)))[k :: len(self.procs)] for k in range(len(self.procs))]
        threads = [threading.Thread(target=run, args=(p, c)) for p, c in zip(self.procs, chunks) if c]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        return results  # type: ignore[return-value]

    def close(self) -> None:
        for p in self.procs:
            p.stdin.close()
            p.wait(timeout=10)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
