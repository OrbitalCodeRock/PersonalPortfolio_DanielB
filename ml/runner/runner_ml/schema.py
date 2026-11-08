"""The recipe format, as seen by the model.

A recipe (see src/secrets/runner/levelgen.ts) is a tier plus a list of features; each feature has a
type and named parameters in 0..1. schema.json (written by scripts/runner/schema.ts) lists the types,
the tier each is allowed from, and the parameter names each reads. The model gives every type a fixed
set of parameter slots (in the schema's order) and predicts each parameter as one of BINS bins.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # ml/runner
REPO = ROOT.parents[1]
SCHEMA_FILE = ROOT / "schema.json"

#: Parameters are predicted as one of this many bins (bin centres are sent to the game).
BINS = 16
#: Longest recipe the model writes (search recipes are 4-12 features).
MAX_STEPS = 14
#: Survival-rate range (sloppy bot) each tier's pool is drawn from; mirrors TARGET in scripts/runner/search.ts.
TARGET = [
    (0.75, 1.0),  # 0-15 s
    (0.6, 1.0),  # 15-30 s
    (0.45, 0.95),  # 30-45 s
    (0.3, 0.85),  # 45-60 s
    (0.3, 0.8),  # 1-2 min
    (0.25, 0.65),  # 2-3 min
    (0.2, 0.55),  # 3-4 min
    (0.15, 0.45),  # 4-5 min
    (0.1, 0.35),  # 5-6 min
    (0.05, 0.3),  # 6 min and on
]


@dataclass(frozen=True)
class Schema:
    types: list[str]
    min_tier: list[int]
    params: list[list[str]]
    tiers: int

    @property
    def n_types(self) -> int:
        return len(self.types)

    @property
    def end(self) -> int:
        """Token id meaning "no more features"."""
        return len(self.types)

    @property
    def max_params(self) -> int:
        return max(len(p) for p in self.params)

    def allowed(self, tier: int) -> list[bool]:
        """Which type ids may appear at this tier (plus END, always allowed)."""
        return [t <= tier for t in self.min_tier] + [True]


def load_schema(path: Path = SCHEMA_FILE) -> Schema:
    raw = json.loads(path.read_text(encoding="utf8"))
    feats = raw["features"]
    return Schema(
        types=[f["name"] for f in feats],
        min_tier=[f["minTier"] for f in feats],
        params=[f["params"] for f in feats],
        tiers=raw["tiers"],
    )


def to_bin(v: float) -> int:
    return min(BINS - 1, max(0, int(v * BINS)))


def from_bin(b: int) -> float:
    return (b + 0.5) / BINS
