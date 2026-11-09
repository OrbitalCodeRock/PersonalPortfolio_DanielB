// Every answer and hint in the secret puzzle hunt lives here, so they can be changed in one place.
// Spoilers below: this file is the answer key.

export type PuzzleId =
	| 'about' // "keyboard": enter the Konami code
	| 'education' // "text": console-launched text adventure
	| 'now' // "momentum": endless rooftop runner (last one minute)
	| 'games' // "moves": the chess puzzle (needs the sky view hint)
	| 'web' // "optimization": fog-of-war contour golf
	| 'ml' // "linear algebra": shear The Ambassadors (gives the sky view hint)
	| 'projects' // "graph": graph puzzle
	| 'skills' // "libraries": paper mystery
	| 'timeline' // "simplicial": simplicial complex viewer
	| 'sky' // sky view: coordinates + year reveal the ring (gives the chess hint)
	| 'certs'; // "interference": the double-slit experiment in a dark room

export interface PuzzleInfo {
	id: PuzzleId;
	/** Where the trigger word lives. */
	page: string;
	/** Name shown once solved. */
	title: string;
}

/** Puzzles that count toward finishing: solving every one opens the finale and the "Every secret" board. Employment is still being designed. */
export const PUZZLES: PuzzleInfo[] = [
	{ id: 'education', page: 'Education', title: 'The Dungeon Below' },
	{ id: 'now', page: 'Now', title: 'Conservation of Momentum' },
	{ id: 'web', page: 'Web Development', title: 'Global Minimum' },
	{ id: 'ml', page: 'Machine Learning', title: 'Memento Mori' },
	{ id: 'sky', page: 'Sky View', title: 'The Ring' },
	{ id: 'games', page: 'Game Development', title: 'Written in the Stars' },
	{ id: 'projects', page: 'Projects', title: 'Every Bridge Once' },
	{ id: 'skills', page: 'Skills', title: 'The Librarian’s Ledger' },
	{ id: 'timeline', page: 'Timeline', title: 'Higher Dimensions' },
	{ id: 'about', page: 'About Me', title: '30 Lives' },
	{ id: 'certs', page: 'Certifications', title: 'Both Slits at Once' },
];

/** The Konami code (About → "keyboard"), as KeyboardEvent.key values, lower-cased. */
export const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];

/** The Ambassadors (1533) was painted in London. Solving the matrix puzzle shows these. */
export const SKY_TARGET = {
	lat: 51.5045,
	lon: -0.1263,
	year: 1533,
	/** How close (degrees) the entered location has to be. */
	tolerance: 0.5,
};

/**
 * The chess puzzle: Légal's mate from the opening position. The sky view hint gives White's
 * opening and a riddle for the rest; the board plays Black's replies itself. Each ply is [from, to] in square names.
 */
export const CHESS_LINE: { san: string; from: string; to: string }[] = [
	{ san: 'e4', from: 'e2', to: 'e4' },
	{ san: 'e5', from: 'e7', to: 'e5' },
	{ san: 'Nf3', from: 'g1', to: 'f3' },
	{ san: 'd6', from: 'd7', to: 'd6' },
	{ san: 'Bc4', from: 'f1', to: 'c4' },
	{ san: 'Bg4', from: 'c8', to: 'g4' },
	{ san: 'Nc3', from: 'b1', to: 'c3' },
	{ san: 'g6', from: 'g7', to: 'g6' },
	{ san: 'Nxe5', from: 'f3', to: 'e5' },
	{ san: 'Bxd1', from: 'g4', to: 'd1' },
	{ san: 'Bxf7+', from: 'c4', to: 'f7' },
	{ san: 'Ke7', from: 'e8', to: 'e7' },
	{ san: 'Nd5#', from: 'c3', to: 'd5' },
];

/** The hint shown in the sky view: White's first four moves, then the riddle below for the finish. */
export const CHESS_HINT = CHESS_LINE.filter((_, i) => i % 2 === 0).map((m) => m.san).slice(0, 4);

/** The rest of Légal's mate, as a riddle: Nxe5 (giving up the queen), Bxf7+, Nd5#. */
export const CHESS_RIDDLE = ['Let them take the queen. A bishop checks,', 'a knight closes the door.'];
