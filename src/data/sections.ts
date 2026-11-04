// Site map from the "Website Planning" doc. Used by the home hub and nav.
import { profiles } from './links';

export interface Section {
	href: string;
	title: string;
	blurb: string;
}

// Hub cards and nav links are listed alphabetically by title.
const byTitle = (a: Section, b: Section) => a.title.localeCompare(b.title);

export const sections: Section[] = [
	{ href: '/about', title: 'About Me', blurb: 'Who I am and what I care about.' },
	{ href: '/education', title: 'Education', blurb: 'B.S. in Computer Science, Illinois State University.' },
	{ href: '/employment', title: 'Employment', blurb: 'Contract engineering, teaching, and more.' },
	{ href: '/timeline', title: 'Timeline', blurb: 'My story, in order.' },
	{ href: '/portfolios', title: 'Portfolios', blurb: 'Web development, game development, and machine learning.' },
	{ href: '/projects', title: 'Projects', blurb: 'Research, algorithms, web, and games.' },
	{ href: '/skills', title: 'Skills', blurb: 'What I know, by category.' },
	{ href: '/certifications', title: 'Certifications', blurb: 'Licenses and certifications.' },
	{ href: '/now', title: 'Now', blurb: 'What I am working on right now.' },
].sort(byTitle);

export const portfolios: Section[] = [
	{ href: '/portfolios/web', title: 'Web Development', blurb: 'Full-stack web apps and client sites.' },
	{ href: '/portfolios/games', title: 'Game Development', blurb: 'Games on itch.io and GitHub.' },
	{ href: '/portfolios/ml', title: 'Machine Learning', blurb: 'Research with GNNs and reinforcement learning.' },
].sort(byTitle);

export const socials = [
	{ href: profiles.linkedin, label: 'LinkedIn' },
	{ href: profiles.itch, label: 'itch.io' },
	{ href: profiles.github, label: 'GitHub' },
];
