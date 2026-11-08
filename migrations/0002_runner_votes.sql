-- Thumbs up/down on rooftop runner segments (the Now page's secret), for training the level model.
-- After each segment the game offers a quick rating of it; one row per rated segment of a run (a player
-- can change their mind while the prompt is up). Recipe ids ("m2-07") are reused when the pools are
-- regenerated, so rows are keyed by pools_version as well, and runner_recipes keeps a copy of each
-- recipe as it was when rated.
CREATE TABLE IF NOT EXISTS runner_recipes (
	pools_version TEXT NOT NULL,
	recipe_id TEXT NOT NULL,
	tier INTEGER NOT NULL,
	recipe TEXT NOT NULL,
	first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	PRIMARY KEY (pools_version, recipe_id)
);

CREATE TABLE IF NOT EXISTS runner_votes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id TEXT NOT NULL,
	-- The segment's place in the run: 0 is the first segment after the intro roof.
	position INTEGER NOT NULL,
	player_id TEXT NOT NULL,
	pools_version TEXT NOT NULL,
	recipe_id TEXT NOT NULL,
	vote INTEGER NOT NULL CHECK (vote IN (-1, 1)),
	-- 'cleared' (ran through it) or 'died' (the run ended in it).
	outcome TEXT NOT NULL CHECK (outcome IN ('cleared', 'died')),
	-- Seconds spent in the segment, and the run's clock when it was left (or the run ended).
	seconds REAL NOT NULL,
	run_seconds REAL NOT NULL,
	-- How the run ended, for 'died'.
	cause TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	UNIQUE (run_id, position)
);

CREATE INDEX IF NOT EXISTS runner_votes_by_player ON runner_votes (player_id, created_at);
CREATE INDEX IF NOT EXISTS runner_votes_by_recipe ON runner_votes (pools_version, recipe_id);
