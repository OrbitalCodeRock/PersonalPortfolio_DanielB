"""The level generator: a small GRU that writes a recipe one feature at a time.

Conditioned on the tier (time band) and a target difficulty (the sloppy bot's survival rate, 0..1).
At each step it picks the next feature type (or END), then that feature's parameters, each as one of
BINS bins. Types not allowed at the tier are masked out, as are a second train and an early END.
"""

from __future__ import annotations

import torch
from torch import nn

from .schema import BINS, MAX_STEPS, Schema, from_bin

MIN_STEPS = 3


class Generator(nn.Module):
    def __init__(self, schema: Schema, hidden: int = 192, emb: int = 48):
        super().__init__()
        self.schema = schema
        n, P = schema.n_types, schema.max_params
        self.start = n + 1
        self.type_emb = nn.Embedding(n + 2, emb)  # types, END, START
        self.tier_emb = nn.Embedding(schema.tiers, 16)
        cond = 16 + 1
        self.h0 = nn.Linear(cond, hidden)
        self.param_in = nn.Linear(P, emb)
        self.gru = nn.GRU(emb * 2, hidden, batch_first=True)
        self.type_head = nn.Sequential(nn.Linear(hidden + cond, hidden), nn.ReLU(), nn.Linear(hidden, n + 1))
        self.param_head = nn.Sequential(nn.Linear(hidden + emb + cond, hidden), nn.ReLU(), nn.Linear(hidden, P * BINS))
        allowed = torch.tensor([schema.allowed(t) for t in range(schema.tiers)])
        self.register_buffer("allowed", allowed)  # [tiers, n+1]
        slots = torch.zeros(n + 1, P, dtype=torch.bool)
        for t, names in enumerate(schema.params):
            slots[t, : len(names)] = True
        self.register_buffer("slots", slots)  # [n+1, P]
        self.trains = [schema.types.index(x) for x in ("train", "longtrain") if x in schema.types]
        centres = torch.tensor([from_bin(b) for b in range(BINS)])
        self.register_buffer("centres", centres)

    # ---- helpers ------------------------------------------------------------------------------
    def _cond(self, tier: torch.Tensor, diff: torch.Tensor) -> torch.Tensor:
        return torch.cat([self.tier_emb(tier), diff.unsqueeze(-1)], dim=-1)

    def _param_vec(self, bins: torch.Tensor) -> torch.Tensor:
        """Bin indices [..., P] (-1 = unused) to values in 0..1 (0 where unused)."""
        vals = self.centres[bins.clamp(min=0)]
        return torch.where(bins >= 0, vals, torch.zeros_like(vals))

    def _type_mask(self, tier: torch.Tensor, step: int, has_train: torch.Tensor) -> torch.Tensor:
        mask = self.allowed[tier].clone()  # [B, n+1]
        if step < MIN_STEPS:
            mask[:, self.schema.end] = False
        if step >= MAX_STEPS - 1:
            mask[:, : self.schema.end] = False
            mask[:, self.schema.end] = True
        for t in self.trains:
            mask[:, t] &= ~has_train
        return mask

    # ---- training (teacher forcing) -------------------------------------------------------------
    def loss(self, types: torch.Tensor, bins: torch.Tensor, mask: torch.Tensor, tier: torch.Tensor, diff: torch.Tensor) -> torch.Tensor:
        """Negative log-likelihood of each recipe [B]."""
        B, T = types.shape
        c = self._cond(tier, diff)
        prev_t = torch.cat([torch.full((B, 1), self.start, dtype=torch.long), types[:, :-1]], dim=1)
        prev_p = torch.cat([torch.zeros(B, 1, self.schema.max_params), self._param_vec(bins[:, :-1])], dim=1)
        x = torch.cat([self.type_emb(prev_t), self.param_in(prev_p)], dim=-1)
        h, _ = self.gru(x, self.h0(c).unsqueeze(0))
        cT = c.unsqueeze(1).expand(B, T, c.shape[-1])
        logits = self.type_head(torch.cat([h, cT], dim=-1))
        # Mask types the tier doesn't allow (the data only has allowed ones; this keeps the softmax honest).
        allow = self.allowed[tier].unsqueeze(1).expand(B, T, -1)
        logits = logits.masked_fill(~allow, -1e9)
        type_nll = nn.functional.cross_entropy(logits.reshape(B * T, -1), types.reshape(-1), reduction="none").view(B, T)
        p_logits = self.param_head(torch.cat([h, self.type_emb(types), cT], dim=-1)).view(B, T, self.schema.max_params, BINS)
        p_nll = nn.functional.cross_entropy(p_logits.reshape(-1, BINS), bins.clamp(min=0).reshape(-1), reduction="none")
        p_nll = p_nll.view(B, T, -1) * (bins >= 0)
        return ((type_nll + p_nll.sum(-1)) * mask).sum(-1)

    # ---- sampling -------------------------------------------------------------------------------
    def sample(self, tier: torch.Tensor, diff: torch.Tensor, temperature: float = 1.0):
        """Writes a batch of recipes. Returns (types [B, T], bins [B, T, P], log_prob [B], entropy [B])."""
        B, P = tier.shape[0], self.schema.max_params
        c = self._cond(tier, diff)
        h = self.h0(c).unsqueeze(0)
        prev_t = torch.full((B,), self.start, dtype=torch.long)
        prev_p = torch.zeros(B, P)
        done = torch.zeros(B, dtype=torch.bool)
        has_train = torch.zeros(B, dtype=torch.bool)
        out_t, out_b = [], []
        logp = torch.zeros(B)
        ent = torch.zeros(B)
        for step in range(MAX_STEPS):
            x = torch.cat([self.type_emb(prev_t), self.param_in(prev_p)], dim=-1).unsqueeze(1)
            o, h = self.gru(x, h)
            o = o.squeeze(1)
            logits = self.type_head(torch.cat([o, c], dim=-1)) / temperature
            logits = logits.masked_fill(~self._type_mask(tier, step, has_train), -1e9)
            dist = torch.distributions.Categorical(logits=logits)
            t = dist.sample()
            t = torch.where(done, torch.full_like(t, self.schema.end), t)
            live = ~done
            logp = logp + dist.log_prob(t) * live
            ent = ent + dist.entropy() * live
            p_logits = self.param_head(torch.cat([o, self.type_emb(t), c], dim=-1)).view(B, P, BINS) / temperature
            pdist = torch.distributions.Categorical(logits=p_logits)
            b = pdist.sample()
            slot = self.slots[t] & live.unsqueeze(-1) & (t != self.schema.end).unsqueeze(-1)
            logp = logp + (pdist.log_prob(b) * slot).sum(-1)
            ent = ent + (pdist.entropy() * slot).sum(-1)
            b = torch.where(slot, b, torch.full_like(b, -1))
            out_t.append(t)
            out_b.append(b)
            for tr in self.trains:
                has_train |= t == tr
            done = done | (t == self.schema.end)
            prev_t, prev_p = t, self._param_vec(b)
            if bool(done.all()):
                break
        return torch.stack(out_t, 1), torch.stack(out_b, 1), logp, ent


def save(model: Generator, path) -> None:
    torch.save({"state": model.state_dict(), "types": model.schema.types}, path)


def load(schema: Schema, path) -> Generator:
    ckpt = torch.load(path, weights_only=False)
    if ckpt["types"] != schema.types:
        raise SystemExit("The schema changed since this model was trained; re-run pretraining.")
    model = Generator(schema)
    model.load_state_dict(ckpt["state"])
    return model
