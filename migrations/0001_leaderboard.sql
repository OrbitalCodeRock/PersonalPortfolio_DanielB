-- Leaderboards for the secret puzzle hunt (worker/index.ts): one board per puzzle, plus "all" for
-- people who found every secret. A board's ranks are its rows in the order they were added.
CREATE TABLE IF NOT EXISTS players (
	player_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS solves (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	player_id TEXT NOT NULL REFERENCES players (player_id),
	board TEXT NOT NULL,
	solved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	UNIQUE (player_id, board)
);

CREATE INDEX IF NOT EXISTS solves_by_board ON solves (board, id);
