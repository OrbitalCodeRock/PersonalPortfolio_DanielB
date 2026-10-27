// Site map from the "Website Planning" doc. Used by the home hub and nav.
export interface Section {
	href: string;
	title: string;
	blurb: string;
}

export const sections: Section[] = [
	{ href: '/about', title: 'About Me', blurb: 'Who I am and what I care about.' },
	{ href: '/education', title: 'Education', blurb: 'Glenbrook South, Illinois State, and NIU.' },
	{ href: '/employment', title: 'Employment', blurb: 'Internships, teaching, and freelance work.' },
	{ href: '/timeline', title: 'Timeline', blurb: 'My story, in order.' },
	{ href: '/portfolios', title: 'Portfolios', blurb: 'Web development, game development, and machine learning.' },
	{ href: '/projects', title: 'Projects', blurb: 'Python, C#, web, ML, and Unity projects.' },
	{ href: '/skills', title: 'Skills', blurb: 'What I know, by category.' },
	{ href: '/certifications', title: 'Certifications', blurb: 'Licenses and certifications.' },
	{ href: '/now', title: 'Now', blurb: 'What I am working on right now.' },
];

export const portfolios: Section[] = [
	{ href: '/portfolios/web', title: 'Web Development', blurb: 'Sites I have built, including NTR.' },
	{ href: '/portfolios/games', title: 'Game Development', blurb: 'Games on itch.io and GitHub.' },
	{ href: '/portfolios/ml', title: 'Machine Learning', blurb: 'Models, experiments, and demos.' },
];

export const socials = [
	{ href: 'https://www.linkedin.com/', label: 'LinkedIn' },
	{ href: 'https://itch.io/', label: 'itch.io' },
	{ href: 'https://github.com/OrbitalCodeRock', label: 'GitHub' },
];
