"""Turning recipes into tensors for training, and model output back into recipes."""

from __future__ import annotations

import torch

from .schema import BINS, MAX_STEPS, Schema, from_bin, to_bin


def encode(recipe: dict, schema: Schema) -> tuple[list[int], list[list[int]]] | None:
    """Type ids (ending with END) and per-step parameter bins (-1 where a slot is unused).

    Returns None for recipes with unknown types or too many features.
    """
    types: list[int] = []
    bins: list[list[int]] = []
    for f in recipe["features"]:
        if f["type"] not in schema.types:
            return None
        t = schema.types.index(f["type"])
        names = schema.params[t]
        row = [-1] * schema.max_params
        for i, name in enumerate(names):
            if name in f["p"]:
                row[i] = to_bin(float(f["p"][name]))
        types.append(t)
        bins.append(row)
    if len(types) >= MAX_STEPS:
        return None
    types.append(schema.end)
    bins.append([-1] * schema.max_params)
    return types, bins


def decode(tier: int, types: list[int], bins: list[list[int]], schema: Schema) -> dict:
    """A recipe dict the game (and the Node evaluator) understands."""
    features = []
    for t, row in zip(types, bins):
        if t == schema.end:
            break
        names = schema.params[t]
        features.append({"type": schema.types[t], "p": {n: round(from_bin(row[i]), 3) for i, n in enumerate(names)}})
    return {"tier": tier, "lead": 0.5, "features": features}


def batch(items: list[tuple[list[int], list[list[int]]]], schema: Schema) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Pads a list of encoded recipes: types [B, T], bins [B, T, P], step mask [B, T]."""
    T = max(len(t) for t, _ in items)
    P = schema.max_params
    types = torch.full((len(items), T), schema.end, dtype=torch.long)
    bins = torch.full((len(items), T, P), -1, dtype=torch.long)
    mask = torch.zeros((len(items), T), dtype=torch.bool)
    for i, (t, b) in enumerate(items):
        types[i, : len(t)] = torch.tensor(t)
        bins[i, : len(b)] = torch.tensor(b)
        mask[i, : len(t)] = True
    return types, bins, mask


__all__ = ["encode", "decode", "batch", "BINS"]
