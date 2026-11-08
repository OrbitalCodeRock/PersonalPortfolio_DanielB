-- Accounts for the leaderboards: a visitor signs in with an emailed link (no passwords), and the browser
-- stays signed in for 60 days with a session cookie. Posting to a leaderboard needs an account and a name;
-- names are unique, ignoring case. Reading the boards stays public. See worker/auth.ts.
--
-- An account's id is its player_id in players/solves/runner_runs, so everything a player posted belongs
-- to their account on every device.
--
-- Before accounts, anyone could post under any name. Those entries are dropped here so that every name on
-- the boards belongs to a signed-in account.
DELETE FROM runner_runs;
DELETE FROM solves;
DELETE FROM players;

CREATE TABLE IF NOT EXISTS accounts (
	id TEXT PRIMARY KEY,
	-- Lower-cased.
	email TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	last_seen TEXT
);

-- One player per account, so one name; no two players share a name, whatever the capitals.
CREATE UNIQUE INDEX IF NOT EXISTS players_name_unique ON players (name COLLATE NOCASE);

-- Emailed sign-in links. Only a SHA-256 of the token is stored; a link works once, for 20 minutes.
CREATE TABLE IF NOT EXISTS login_tokens (
	token_hash TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	-- The browser's anonymous id when the link was asked for; a new account takes it, so progress posted
	-- from that browser carries over.
	player_id TEXT,
	ip TEXT,
	expires_at TEXT NOT NULL,
	used_at TEXT,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS login_tokens_by_email ON login_tokens (email, created_at);
CREATE INDEX IF NOT EXISTS login_tokens_by_ip ON login_tokens (ip, created_at);

-- Signed-in browsers. The cookie holds a random token; only its SHA-256 is stored. Sessions last 60 days
-- and are extended when used, so a regular visitor rarely signs in again.
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	account_id TEXT NOT NULL REFERENCES accounts (id),
	expires_at TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS sessions_by_account ON sessions (account_id);
