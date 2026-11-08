-- The rooftop runner's leaderboard (the Now page's secret). Each row is a run a signed player posted
-- (only when it beat their own best in that category), with the segments it played, so anyone can
-- replay it. Rows are never replaced, so a replay link keeps working after its owner improves.
--
-- category: 'random' for ordinary runs; 'chosen' for runs that started from segments the player picked
-- or from a replay. The board shows each player's best run per category.
--
-- segments: JSON [{ "v": pools version, "id": recipe id }, ...] in play order. Each (v, id) is in
-- runner_recipes (migrations/0002), so a run can be rebuilt after the pools are regenerated.
CREATE TABLE IF NOT EXISTS runner_runs (
	id TEXT PRIMARY KEY,
	player_id TEXT NOT NULL REFERENCES players (player_id),
	category TEXT NOT NULL CHECK (category IN ('random', 'chosen')),
	seconds REAL NOT NULL,
	distance INTEGER NOT NULL,
	segments TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS runner_runs_best ON runner_runs (category, player_id, seconds DESC);
CREATE INDEX IF NOT EXISTS runner_runs_by_player ON runner_runs (player_id, created_at);
