// External links used by more than one content page (credentials, repos, games, blog).
const gh = (repo: string) => `https://github.com/OrbitalCodeRock/${repo}`;
const club = (slug: string) => `https://isu-game-dev-club.itch.io/${slug}`;
const blog = (path: string) => `https://schedulelearnprogram.blogspot.com/${path}`;

export const profiles = {
	github: 'https://github.com/OrbitalCodeRock',
	itch: 'https://orbitalrock.itch.io/',
	linkedin: 'https://www.linkedin.com/in/daniel-beyer00/',
	blog: blog(''),
};

export const credentials = {
	mathForMl: 'https://www.coursera.org/account/accomplishments/specialization/certificate/UKDRYYWKDVH5',
	pythonDataScience: 'https://www.coursera.org/account/accomplishments/certificate/RWGELA8MLYAE',
	toolsDataScience: 'https://www.coursera.org/account/accomplishments/certificate/TC5XRKSEBZVJ',
	django: 'https://www.coursera.org/account/accomplishments/certificate/8G56FECNUQ3K',
	djangoFeatures: 'https://www.coursera.org/account/accomplishments/certificate/TKBGN4SM6GNT',
	unity: 'https://www.credly.com/badges/0a4947ef-0829-4d05-b78f-dbe493b32ccd',
	quantum: 'https://drive.google.com/file/d/1eE_jVtWKlGhZF4aLxPDKNHEdzR7LQMgZ/view?usp=sharing',
	graphicDesign: 'https://www.coursera.org/account/accomplishments/certificate/6WYWCLR7GBHX',
	businessWriting: 'https://www.coursera.org/account/accomplishments/certificate/TELCWSGV8DXU',
};

export const repos = {
	portfolio: gh('PersonalPortfolio_DanielB'),
	chaos: gh('The-World-Tends-Toward-Chaos'),
	shadowBots: gh('ShadowBotsMod'),
	openWorld: gh('2D-Open-World-v.0.3'),
	fighting: gh('FightingGame'),
	chess: gh('ChessGame-Offline-V1.0'),
	doublePendulum: gh('DoublePendulum-Python-'),
	upfd: gh('IT299_DB_MC_MLFlowProjects'),
	dijkstra: gh('IT388_ParallelDijikstras_DB_JM_YBZ_YHZ_RF'),
	simplicial: gh('SimplicialComplexGraphing'),
	goMath: gh('simple_go_cmdl_math_game'),
};

export const papers = {
	upfd: 'https://dl.acm.org/doi/10.1145/3404835.3462990',
	spiderPoster: 'https://drive.google.com/file/d/15C8s0tFzJIOPP5c0G1qShth_mTsve0dC/view?usp=sharing',
	isuTranscript: 'https://drive.google.com/file/d/1Si6pSyko6V3LZCu--6jv6MEDEE8-NLpI/view?usp=sharing',
};

export const quantumBlog = [
	{ label: 'Part 1', href: blog('2021/04/representing-quantum-circuits-part-one.html') },
	{ label: 'Part 2', href: blog('2021/04/representing-quantum-circuits-part-two.html') },
	{ label: 'Part 3', href: blog('2021/04/representing-quantum-circuits-part.html') },
];

export const games = {
	chaos: 'https://orbitalrock.itch.io/the-world-tends-toward-chaos',
	thylla: club('thylla-and-the-old-gods'),
};

// ISU Game Development Club games beyond Thylla, with a one-word genre from the doc.
export const clubGames = [
	{ title: 'A Crooked Crown', genre: 'puzzle', href: club('a-crooked-crown') },
	{ title: 'Crustacean Quest! Claw of Destiny', genre: 'adventure', href: club('crustacean-quest') },
	{ title: 'GOBBOTRON: Neon Sins', genre: 'action', href: club('gobbotron') },
	{ title: 'The Food Pyramid', genre: 'top-down shooter', href: club('the-food-pyramid') },
	{ title: 'Puffer Putt', genre: 'pufferfish golf', href: club('puffer-putt') },
	{ title: 'Fear of Flora', genre: 'tower defense', href: club('fear-of-flora') },
];
