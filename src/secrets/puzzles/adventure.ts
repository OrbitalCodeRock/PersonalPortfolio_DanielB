// "text" on the Education page. The first window tells the visitor to run a command in the
// browser's developer console (touch-only devices get an input box instead); that command opens a
// small text adventure. Win: find the hidden cellar under the standing stones, reach the vault three
// levels down, take the Sunstone and get back out to the stones before the dungeon caves in.
import { openWindow, solve, chime, type SecretWindow } from '../ui';
import { isSolved } from '../progress';

declare global {
	interface Window {
		enterTheForest?: () => void;
	}
}

const ID = 'education';
const COMMAND = 'enterTheForest()';
const COLLAPSE_MOVES = 12;
const TORCH_MOVES = 10;
const POTION_HEAL = 12;

// ---- Data ------------------------------------------------------------------------------------

type ClassId = 'warrior' | 'mage' | 'rogue' | 'ranger';
type Dir = 'n' | 's' | 'e' | 'w' | 'u' | 'd';

interface ClassDef {
	label: string;
	hp: number;
	atk: [number, number];
	special: string;
	uses: number;
	armor: number;
	blurb: string;
	/** The companion of this class who waits in the tavern. */
	ally: string;
	allyBlurb: string;
	join: string;
}

const CLASSES: Record<ClassId, ClassDef> = {
	warrior: {
		label: 'Warrior', hp: 34, atk: [4, 7], special: 'cleave', uses: 3, armor: 1,
		blurb: 'Tough and armored. CLEAVE hits twice as hard. Can FORCE a stuck gate.',
		ally: 'Bryn',
		allyBlurb: 'Bryn, a broad-shouldered warrior honing a notched axe. "Gates are just doors that need persuading."',
		join: '"About time someone asked." Bryn shoulders her axe.',
	},
	mage: {
		label: 'Mage', hp: 18, atk: [2, 4], special: 'firebolt', uses: 4, armor: 0,
		blurb: 'Fragile. FIREBOLT scorches. Their staff lights any darkness.',
		ally: 'Ithel',
		allyBlurb: 'Ithel, a young mage whose staff glows softly. "Dark places? I bring my own light."',
		join: 'Ithel\'s staff brightens. "Lead on. I\'ll keep the dark off you."',
	},
	rogue: {
		label: 'Rogue', hp: 22, atk: [3, 6], special: 'backstab', uses: 3, armor: 0,
		blurb: 'Quick. BACKSTAB strikes deep. Can PICK locks.',
		ally: 'Sable',
		allyBlurb: 'Sable, a rogue twirling a lockpick. "No lock has ever told me no."',
		join: 'Sable pockets her picks and grins. "Treasure, you said?"',
	},
	ranger: {
		label: 'Ranger', hp: 24, atk: [3, 6], special: 'volley', uses: 3, armor: 0,
		blurb: 'Steady. VOLLEY looses two arrows. Can TRACK hidden trails.',
		ally: 'Wren',
		allyBlurb: 'Wren, a quiet ranger with mud on his boots. "Everything leaves a trail."',
		join: 'Wren strings his bow without a word and follows you out.',
	},
};
const CLASS_ORDER: ClassId[] = ['warrior', 'mage', 'rogue', 'ranger'];

interface EnemyDef {
	name: string;
	hp: number;
	atk: [number, number];
	intro: string;
	death: string;
}

/** Keyed by the room the enemy guards. Damage dealt to them persists, so fleeing and resting works. */
const ENEMIES: Record<string, EnemyDef> = {
	guardroom: {
		name: 'Bone Sentry', hp: 12, atk: [1, 3],
		intro: 'A skeleton in a rusted helm clatters up from the dice table and levels a spear.',
		death: 'The Bone Sentry collapses into a heap of ribs and dice.',
	},
	crypt: {
		name: 'Crypt Ghoul', hp: 20, atk: [2, 5],
		intro: 'Something gaunt unfolds from an empty niche, sniffing at you.',
		death: 'The ghoul folds back into its niche and stays there.',
	},
	flooded: {
		name: 'Rat Swarm', hp: 14, atk: [1, 3],
		intro: 'The black water boils with rats, hundreds of them, all heading for your ankles.',
		death: 'The swarm breaks apart and vanishes into the cracks.',
	},
	bridge: {
		name: 'Pale Weaver', hp: 18, atk: [2, 4],
		intro: 'The bridge lurches. A spider the size of a cart hauls itself up over the ropes.',
		death: 'The Pale Weaver loses its grip and drops silently into the chasm.',
	},
	warden: {
		name: 'Hollow Warden', hp: 34, atk: [3, 6],
		intro: 'An empty suit of armor, blue fire where a face should be, steps off its pedestal. "NONE. PASS."',
		death: 'The Warden\'s fire gutters out. Its armor crashes down, and a bone key rolls across the floor.',
	},
};

interface Lock {
	flag: string;
	/** Hidden exits aren't listed until opened. */
	hidden?: boolean;
	label: string;
	msg: string;
}

interface Room {
	name: string;
	area: 'forest' | 'village' | 'dungeon';
	desc: string;
	exits: Partial<Record<Dir, string>>;
	locks?: Partial<Record<Dir, Lock>>;
	dark?: boolean;
	art?: string;
	items?: string[];
	/** 'word|synonym' → text shown by examine/read. */
	features?: Record<string, string>;
	track?: string;
}

const ART = {
	title: String.raw`
          .        *         .
     *        /\        .
       /\    /  \   /\      *
      /  \  /    \ /  \  /\
     /    \/  /\  \    \/  \
    /  /\  \ /  \  \  /\    \
   /__/  \__/____\__\/  \____\
      ||     ||      ||   ||
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
     T H E   D U N G E O N
           B E L O W`,
	forest: String.raw`
   ^     ^    ^^     ^     ^
  /|\   /|\  /||\   /|\   /|\
 //|\\ //|\\//||\\ //|\\ //|\\
   |     |    ||     |     |
 ,,|,,,,,|,,,,||,,,,,|,,,,,|,,`,
	stones: String.raw`
     _      _      _      _
    | |    ( )    | |    ( )
  _ | |  _ | | _  | |  _ | |
 | ||_| | ||_|| | |_| | ||_|
 |_|    |_|    |_|    |_|
 ,,,,,,,,,,,,,,,,,,,,,,,,,,,,`,
	village: String.raw`
        _    ~ ~
   /\  | |_  ~        /\
  /  \ |  _|_/\____  /  \
 /____\|_|  /  \   |/____\
 | [] |    /____\  || [] |
 |  _ |    | () |  ||  _ |
 |_| ||____|____|__||_| ||`,
	entrance: String.raw`
   _______________________
  |  ___________________  |
  | |  _______________  | |
  | | |  ___________  | | |
  | | | |  _______  | | | |
  | | | | |  ___  | | | | |
  |_|_|_|_|_|   |_|_|_|_|_|
        steps going down`,
	gate: String.raw`
   ____________________
  | || || || || || || |
  | || || || || || || |
  | || || |[]|| || || |
  | || || || || || || |
  |_||_||_||_||_||_||_|`,
	warden: String.raw`
         .-"""-.
        /  ~ ~  \
        | (o o) |   blue fire
     ___|__---__|___
    |   |  ===  |   |
        |   |   |
        |___|___|
        /__/ \__\
`,
	treasure: String.raw`
          .   *   .
       *   _.---._   *
         .'  /\  '.
        /   /  \   \
       |   < () >   |
        \   \  /   /
         '.  \/  .'
           '-----'
        THE  SUNSTONE`,
	escape: String.raw`
        \   |   /
      -- .-"""-. --      ^   ^
    --  (       )  --   /|\ /|\
      -- '-...-' --    //|\\|\\
        /   |   \        |   |
   ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
        D A Y L I G H T`,
	skull: String.raw`
        _______
       /       \
      |  () ()  |
       \   ^   /
        |||||||
        '-----'`,
};

const ROOMS: Record<string, Room> = {
	clearing: {
		name: 'Forest Clearing', area: 'forest', art: ART.forest,
		desc: 'Pines crowd a quiet clearing; moss swallows your footsteps. A trail runs north to an enormous oak, a smoke-stained hut leans to the west, a stream murmurs to the east, and a cart road winds south toward chimney smoke.',
		exits: { n: 'oak', w: 'hut', e: 'brook', s: 'road' },
		track: 'Old hunters\' bootprints, years deep, wear a path between the hut and the north-east.',
	},
	oak: {
		name: 'The Hollow Oak', area: 'forest',
		desc: 'An oak older than the village, split by lightning and somehow still alive. Words are carved into the scar. Through the trees to the east, grey shapes stand in a ring.',
		exits: { s: 'clearing', e: 'stones' },
		features: { 'carving|words|scar|oak|tree': 'Carved deep, long ago: "WHAT THE HUNTERS HID, THE HUNTERS WROTE DOWN."' },
		track: 'A badger came through. Nothing else.',
	},
	stones: {
		name: 'The Standing Stones', area: 'forest', art: ART.stones,
		desc: 'Seven grey stones stand in a ring, leaning inward as if listening to the ground. They face every way the wind can blow.',
		exits: { w: 'oak', s: 'brook', d: 'entrance' },
		locks: { d: { flag: 'entrance', hidden: true, label: 'steps', msg: '' } },
		features: {
			'stone|stones|ring':
				'Seven stones, mossy and cold, set at the points of the compass and between. Heavy, but a stone could be pushed, if you knew which one.',
		},
		track: 'Bootprints circle the ring and end at the EASTERN stone. Its base is scraped smooth, as if it has been moved many times.',
	},
	brook: {
		name: 'Babbling Brook', area: 'forest',
		desc: 'Cold water chatters over pebbles. Upstream, to the north, a ring of grey stones shows between the trunks.',
		exits: { w: 'clearing', n: 'stones' },
		features: { 'water|brook|stream': 'Clear and cold. You drink. Refreshing, if not magical.' },
		track: 'Deer, mostly. And one set of boots heading north, upstream.',
	},
	hut: {
		name: 'Hunter\'s Hut', area: 'forest',
		desc: 'A one-room hut, empty for years: a cot, a cold hearth, a dusty shelf, and a leather journal on the table.',
		exits: { e: 'clearing' },
		items: ['torch', 'potion'],
		features: {
			'journal|book|table':
				'Most pages are tallies of deer. The last entry reads: "We sealed the old cellar under the ring of stones. Push the stone that greets the morning sun. The Warden still walks below; whatever it guards, let it guard it." A shakier hand adds: "Do not go down alone."',
			'shelf|hearth|cot': 'Dust, ash, and the smell of pine.',
		},
		track: 'The prints here are all the same boots, coming and going.',
	},
	road: {
		name: 'Old Road', area: 'forest',
		desc: 'A rutted road between the pines. A signpost leans at the crossing.',
		exits: { n: 'clearing', s: 'square' },
		features: { 'sign|signpost|post': 'North: "FOREST - KEEP TO THE PATH". South: "ASHFORD".' },
	},
	square: {
		name: 'Ashford', area: 'village', art: ART.village,
		desc: 'A small village gathered around a well. Warm light and noise spill from a tavern to the east; bundles of herbs hang outside a shop to the west. The road leads north into the forest.',
		exits: { n: 'road', e: 'tavern', w: 'herbalist' },
		features: { well: 'Deep. A coin glints at the bottom, well out of reach.' },
	},
	tavern: {
		name: 'The Lantern & Lamb', area: 'village',
		desc: 'Low beams, a crackling fire, the smell of stew. The innkeeper nods at you: "A bed\'s free for anyone brave or daft enough to go into those woods." (You can REST here.)',
		exits: { w: 'square' },
	},
	herbalist: {
		name: 'Herbalist', area: 'village',
		desc: 'Jars, roots and drying flowers. An old woman studies you for a long moment. "Going under the stones, are you? Take what\'s on the counter. Bring yourself back."',
		exits: { e: 'square' },
		items: ['potion', 'potion'],
	},
	entrance: {
		name: 'Hunters\' Cellar', area: 'dungeon', art: ART.entrance,
		desc: 'Worn steps climb to daylight. The cellar was dug long before the hunters found it: the far wall opens onto older stonework carved with sleeping faces. A passage runs south.',
		exits: { u: 'stones', s: 'guardroom' },
		features: { 'face|faces|wall|carving': 'Dozens of carved faces, eyes closed. One of them, you\'d swear, has just shut its eyes.' },
	},
	guardroom: {
		name: 'Guardroom', area: 'dungeon',
		desc: 'Rotten weapon racks and a table of dice no one will finish rolling. Passages lead east and south; the cellar is north.',
		exits: { n: 'entrance', e: 'crypt', s: 'gatehall' },
		items: ['potion'],
	},
	crypt: {
		name: 'Crypt', area: 'dungeon',
		desc: 'Niches full of bones line the walls. A hook beside one empty niche looks made to hold a key.',
		exits: { w: 'guardroom' },
		items: ['iron key'],
	},
	gatehall: {
		name: 'Gate Hall', area: 'dungeon', art: ART.gate,
		desc: 'Stairs descend into darkness behind a heavy iron gate. The guardroom is back north.',
		exits: { n: 'guardroom', d: 'landing' },
		locks: { d: { flag: 'gate', label: 'iron gate, locked', msg: 'The iron gate is locked.' } },
		features: {
			'gate|lock|bars': 'Bars thick as your wrist and a big old lock. A key would do it. So would clever fingers, or a great deal of muscle.',
		},
	},
	landing: {
		name: 'Lower Landing', area: 'dungeon', dark: true,
		desc: 'Stairs climb back up to the gate. Cold, wet air flows from a passage to the east.',
		exits: { u: 'gatehall', e: 'flooded' },
	},
	flooded: {
		name: 'Flooded Hall', area: 'dungeon', dark: true,
		desc: 'Knee-deep black water and a stink of wet fur. A passage leads south; the landing is west.',
		exits: { w: 'landing', s: 'bridge' },
	},
	bridge: {
		name: 'Rope Bridge', area: 'dungeon', dark: true,
		desc: 'A bridge of rope and rotten planks sways over a chasm. On the far side, stairs go down toward a cold blue glow. The flooded hall is back north.',
		exits: { n: 'flooded', d: 'warden' },
	},
	warden: {
		name: 'Warden\'s Hall', area: 'dungeon', art: ART.warden,
		desc: 'Blue fire burns in iron bowls with nothing to feed it. A round door to the east is carved with a rising sun. Stairs lead back up to the bridge.',
		exits: { u: 'bridge', e: 'vault' },
		locks: { e: { flag: 'vault', label: 'sun-door, locked', msg: 'The sun-door is locked. The keyhole is shaped like a knuckle bone.' } },
		features: { 'door|sun|keyhole': 'A round stone door with a sun carved in it. The keyhole is shaped like a knuckle bone.' },
	},
	vault: {
		name: 'The Vault', area: 'dungeon', art: ART.treasure,
		desc: 'A small round room. On a plinth, wrapped in its own light, lies the Sunstone.',
		exits: { w: 'warden' },
		items: ['sunstone'],
	},
};

const ITEM_TEXT: Record<string, string> = {
	torch: 'A pitch-soaked torch. It lights dark places while you carry it, until it burns out.',
	potion: `A small red vial. Restores ${POTION_HEAL} HP, or gets a fallen friend back on their feet.`,
	'iron key': 'A heavy iron key, cold as the crypt.',
	'bone key': 'A key carved from a single knuckle bone.',
	sunstone: 'Warm as a summer afternoon. It wants to go up, toward the daylight.',
};

const DIR_NAMES: Record<Dir, string> = { n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down' };
const DIR_WORDS: Record<string, Dir> = {
	n: 'n', north: 'n', s: 's', south: 's', e: 'e', east: 'e', w: 'w', west: 'w',
	u: 'u', up: 'u', upstairs: 'u', ascend: 'u', d: 'd', down: 'd', downstairs: 'd', descend: 'd',
};
const dirOf = (w: string): Dir | undefined => (Object.hasOwn(DIR_WORDS, w) ? DIR_WORDS[w] : undefined);
const FILLER = new Set(['the', 'a', 'an', 'at', 'to', 'with', 'into', 'around']);

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

// ---- Game state ------------------------------------------------------------------------------

interface Member {
	name: string;
	cls: ClassId;
	hp: number;
	max: number;
	uses: number;
	you: boolean;
}

interface State {
	phase: 'class' | 'play' | 'over';
	room: string;
	prev: string;
	party: Member[];
	active: number;
	inv: Map<string, number>;
	items: Record<string, string[]>;
	foes: Record<string, number>;
	flags: Set<string>;
	torch: number;
	collapse: number;
	fight: string | null;
	seen: Set<string>;
}

function freshState(): State {
	const items: Record<string, string[]> = {};
	for (const [id, r] of Object.entries(ROOMS)) items[id] = [...(r.items ?? [])];
	const foes: Record<string, number> = {};
	for (const [id, e] of Object.entries(ENEMIES)) foes[id] = e.hp;
	return {
		phase: 'class', room: 'clearing', prev: 'clearing', party: [], active: 0, inv: new Map(), items, foes,
		flags: new Set(), torch: 0, collapse: 0, fight: null, seen: new Set(),
	};
}

// ---- Styles ----------------------------------------------------------------------------------

function injectStyle() {
	if (document.getElementById('secret-style-adventure')) return;
	const s = document.createElement('style');
	s.id = 'secret-style-adventure';
	s.textContent = `
.adv-out { height: min(56dvh, 460px); overflow-y: auto; font-size: clamp(11.5px, 2.9vw, 13.5px); line-height: 1.45;
	white-space: pre-wrap; overflow-wrap: anywhere; padding-right: 4px; }
.adv-out .adv-l { margin: 0 0 3px; }
.adv-out pre.adv-art { margin: 2px 0 6px; font: inherit; line-height: 1.12; white-space: pre; overflow-x: auto; color: #8dffb0; }
.adv-out .is-echo { color: #5f9c6f; margin-top: 8px; }
.adv-out .is-title { color: #ffe7a3; font-weight: 700; margin-top: 6px; }
.adv-out .is-warn { color: #ff9f8a; }
.adv-out .is-good { color: #ffe7a3; }
.adv-out .is-dim { color: #74a582; }
.adv-form { display: flex; gap: 8px; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(120, 255, 160, 0.25); }
.adv-form label { color: #8dffb0; white-space: nowrap; font-size: 14px; }
.adv-form input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: #d8ffe2; font: inherit; font-size: 16px; caret-color: #8dffb0; }
.adv-keys { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.adv-keys button { font: inherit; font-size: 12px; padding: 6px 9px; border-radius: 6px; cursor: pointer;
	background: rgba(120, 255, 160, 0.08); color: #b9ffcb; border: 1px solid rgba(120, 255, 160, 0.3); }
.adv-row { display: flex; gap: 8px; align-items: stretch; margin: 0.4em 0 0.9em; }
.adv-row .secret-code { flex: 1; min-width: 0; }
.adv-row .secret-input { flex: 1; min-width: 0; }
`;
	document.head.append(s);
}

const touchOnly = () => matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

// ---- The first window: the whisper -----------------------------------------------------------

let launcher: SecretWindow | null = null;
let term: { win: SecretWindow; input: HTMLInputElement } | null = null;

function enterTheForest(): void {
	console.log(
		'%c the pines lean closer... ',
		'color:#8dffb0;background:#030603;font:600 14px ui-monospace,monospace;padding:6px 10px;border:1px solid #2f7a45;border-radius:4px',
	);
	console.log('%cSomething opened on the page. Look back at it.', 'color:#9fb8a8;font-style:italic');
	launcher?.close();
	openTerminal();
}

export function launch(): void {
	injectStyle();
	window.enterTheForest = enterTheForest;
	if (term) {
		term.input.focus();
		return;
	}
	launcher?.close();
	const win = openWindow({ title: 'Between the Lines', width: 470 });
	launcher = win;
	win.onClose(() => {
		if (launcher === win) launcher = null;
	});
	const solved = isSolved(ID);
	win.body.innerHTML = `
		<p>The word shivers, as if something under the page is listening.</p>
		<p><em>Text</em> is only the surface. The rest of the story is written in your browser's own margins,
		where pages keep their secrets.</p>
		<p class="secret-hint">Open the developer console (<b>F12</b>, or <b>Ctrl+Shift+I</b>; <b>Cmd+Opt+I</b> on a Mac),
		then type these words and press Enter:</p>
		<div class="adv-row"><code class="secret-code"></code><button type="button" class="secret-btn adv-copy">Copy</button></div>
		<p class="secret-hint">Some browsers make you type <code>allow pasting</code> before they let you paste into the console.</p>
		${solved ? '<p class="secret-hint">You have already walked this road. The forest will let you in again.</p>' : ''}`;
	const code = win.body.querySelector<HTMLElement>('.secret-code')!;
	code.textContent = COMMAND;
	const copy = win.body.querySelector<HTMLButtonElement>('.adv-copy')!;
	copy.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(COMMAND);
			copy.textContent = 'Copied';
		} catch {
			const range = document.createRange();
			range.selectNodeContents(code);
			getSelection()?.removeAllRanges();
			getSelection()?.addRange(range);
			copy.textContent = 'Selected';
		}
		setTimeout(() => (copy.textContent = 'Copy'), 1600);
	});

	if (touchOnly()) {
		const p = document.createElement('p');
		p.className = 'secret-hint';
		p.textContent = 'No console on this device? Speak the words here instead:';
		const row = document.createElement('form');
		row.className = 'adv-row';
		row.innerHTML = `<input class="secret-input" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Command"><button class="secret-btn">Speak</button>`;
		const input = row.querySelector('input')!;
		row.addEventListener('submit', (e) => {
			e.preventDefault();
			const said = input.value.replace(/\s+/g, '').replace(/;$/, '').toLowerCase();
			if (said === 'entertheforest()' || said === 'entertheforest') enterTheForest();
			else {
				chime('error');
				input.value = '';
				input.placeholder = 'Nothing stirs...';
			}
		});
		win.body.append(p, row);
	}
}

// ---- The terminal ----------------------------------------------------------------------------

function openTerminal() {
	if (term) {
		term.input.focus();
		return;
	}
	injectStyle();
	const win = openWindow({ title: 'beneath-the-stones : tty1', width: 680, variant: 'terminal', closeOnEscape: false });
	win.body.innerHTML = `
		<div class="adv-out" aria-live="polite"></div>
		<form class="adv-form"><label for="adv-in">&gt;</label>
		<input id="adv-in" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send"></form>`;
	const out = win.body.querySelector<HTMLElement>('.adv-out')!;
	const form = win.body.querySelector<HTMLFormElement>('.adv-form')!;
	const prompt = form.querySelector('label')!;
	const input = form.querySelector('input')!;
	term = { win, input };
	win.onClose(() => {
		term = null;
	});
	setTimeout(() => input.focus({ preventScroll: true }), 60);

	// -- Output --
	const line = (text: string, kind = '') => {
		const d = document.createElement('div');
		d.className = `adv-l${kind ? ` is-${kind}` : ''}`;
		d.textContent = text;
		out.append(d);
		while (out.childElementCount > 500) out.firstElementChild!.remove();
		out.scrollTop = out.scrollHeight;
	};
	const art = (s: string) => {
		const p = document.createElement('pre');
		p.className = 'adv-art';
		p.textContent = s.replace(/^\n|\n$/g, '');
		out.append(p);
		out.scrollTop = out.scrollHeight;
	};

	// -- State helpers --
	let S = freshState();
	const me = () => S.party[S.active];
	const alive = () => S.party.filter((m) => m.hp > 0);
	const who = (m: Member) => (m.you ? 'You' : m.name);
	const v = (m: Member, verb: string) => (m.you ? verb : verb.endsWith('h') ? `${verb}es` : `${verb}s`);
	const label = (m: Member) => (m.you ? `you (${CLASSES[m.cls].label})` : `${m.name} the ${CLASSES[m.cls].label}`);
	const has = (item: string) => (S.inv.get(item) ?? 0) > 0;
	const mage = () => S.party.find((m) => m.cls === 'mage' && m.hp > 0);
	const hasLight = () => !!mage() || (has('torch') && S.torch > 0);
	const blind = () => !!ROOMS[S.room].dark && !hasLight();
	const addItem = (item: string, n = 1) => S.inv.set(item, (S.inv.get(item) ?? 0) + n);
	const setPrompt = () => {
		prompt.textContent = S.phase === 'play' ? `${me().you ? 'you' : me().name.toLowerCase()} >` : '>';
	};

	function findMember(word: string): Member | undefined {
		if (['me', 'you', 'self', 'myself'].includes(word)) return S.party.find((m) => m.you);
		return S.party.find(
			(m) => (!m.you && m.name.toLowerCase().startsWith(word)) || m.cls === word || CLASSES[m.cls].label.toLowerCase() === word,
		);
	}

	// -- Describing --
	function exitsText(r: Room): string {
		const list = (Object.keys(r.exits) as Dir[])
			.filter((d) => {
				const l = r.locks?.[d];
				return !(l?.hidden && !S.flags.has(l.flag));
			})
			.map((d) => {
				const l = r.locks?.[d];
				return l && !S.flags.has(l.flag) ? `${DIR_NAMES[d]} (${l.label})` : DIR_NAMES[d];
			});
		return `Exits: ${list.join(', ')}`;
	}

	function describe(withArt: boolean) {
		const r = ROOMS[S.room];
		line(r.name, 'title');
		if (blind()) {
			line('It is pitch black. Water drips somewhere close. You could feel your way onward, carefully, or bring a light.');
			return;
		}
		if (withArt && r.art) art(r.art);
		line(r.desc);
		if (S.room === 'stones' && S.flags.has('entrance')) line('The eastern stone stands aside. Steps lead down into the earth.');
		if (S.room === 'gatehall' && S.flags.has('gate')) line('The gate hangs open.');
		if (S.room === 'warden' && S.flags.has('vault')) line('The sun-door stands open.');
		if (S.room === 'warden' && S.foes.warden <= 0) line('The Warden\'s empty armor lies scattered on the floor.');
		if (S.room === 'tavern') {
			const waiting = CLASS_ORDER.filter((c) => !S.party.some((m) => m.cls === c));
			if (waiting.length) {
				line('At a corner table, adventurers nurse their drinks:');
				for (const c of waiting) line(`  - ${CLASSES[c].allyBlurb}`, 'dim');
				line('(RECRUIT <name> to bring one along; your party can hold two companions.)', 'dim');
			}
		}
		const items = S.items[S.room];
		if (items.length) line(`You see: ${items.join(', ')}.`);
		line(exitsText(r), 'dim');
	}

	function partyStatus(): string {
		const parts = S.party.map((m) => `${m.you ? 'you' : m.name} ${m.hp}/${m.max}`);
		const foe = S.fight ? `${ENEMIES[S.fight].name} ${S.foes[S.fight]} HP | ` : '';
		return `[ ${foe}${parts.join(', ')} ]`;
	}

	// -- Flow --
	function start() {
		art(ART.title);
		line('A text adventure. Type HELP at any time.', 'dim');
		if (isSolved(ID)) line('(You have carried the Sunstone out once already. This mystery is solved, but the forest is open.)', 'good');
		line('');
		line('Who are you, traveller? Choose your class:');
		CLASS_ORDER.forEach((c, i) => line(`  ${i + 1}. ${CLASSES[c].label} - ${CLASSES[c].blurb}`));
		line('Type a number or a name.', 'dim');
		setPrompt();
	}

	function chooseClass(text: string) {
		const n = Number.parseInt(text, 10);
		const cls = n >= 1 && n <= 4 ? CLASS_ORDER[n - 1] : CLASS_ORDER.find((c) => text.length >= 2 && c.startsWith(text));
		if (!cls) return line('Choose 1-4: warrior, mage, rogue or ranger.', 'warn');
		const c = CLASSES[cls];
		S.party = [{ name: 'You', cls, hp: c.hp, max: c.hp, uses: c.uses, you: true }];
		S.phase = 'play';
		line('');
		line(`You are a ${c.label}.`, 'good');
		line(
			'The rumor brought you here: somewhere under these pines lies a dungeon older than the kingdom, and in it a stone that holds a sunrise. Many went looking. None came back with it. None of them, the villagers say, went with friends.',
		);
		S.seen.add('clearing');
		describe(true);
		setPrompt();
	}

	function restart() {
		S = freshState();
		out.textContent = '';
		start();
	}

	function die(msg: string) {
		S.phase = 'over';
		S.fight = null;
		chime('error');
		line(msg, 'warn');
		art(ART.skull);
		line('Your tale ends here. Type RESTART to begin again.', 'good');
		setPrompt();
	}

	function victory() {
		S.phase = 'over';
		art(ART.escape);
		line('You burst up the cellar steps into the ring of stones. Behind you the earth groans, and the cellar folds shut for good.', 'good');
		line('The Sunstone blazes in your hands. For a moment the whole forest is lit like a summer morning.', 'good');
		const friends = S.party.filter((m) => !m.you).map((m) => m.name);
		line(friends.length ? `${friends.join(' and ')} cheer${friends.length === 1 ? 's' : ''} beside you.` : 'You did it alone. Ashford will be telling this one for a hundred years.');
		line('*** YOU HAVE WON ***', 'title');
		line('Type RESTART to play again, or QUIT to close the terminal.', 'dim');
		solve(ID);
		setPrompt();
	}

	function enter(id: string) {
		S.prev = S.room;
		S.room = id;
		const r = ROOMS[id];
		if (r.dark) {
			const m = mage();
			if (m) {
				if (!S.seen.has(id)) line(`${m.you ? 'Your' : `${m.name}'s`} staff kindles a pale light.`, 'dim');
			} else if (has('torch') && S.torch > 0) {
				S.torch--;
				if (S.torch === 0) {
					S.inv.delete('torch');
					line('Your torch sputters and dies.', 'warn');
				} else if (S.torch <= 3) line(`(Your torch is burning low.)`, 'dim');
			}
		}
		if (id === 'stones' && has('sunstone')) return victory();
		if (S.collapse > 0 && r.area === 'dungeon') {
			S.collapse--;
			if (S.collapse === 0) return die('With a roar, the ceiling comes down. The Sunstone\'s light is the last thing you see.');
		}
		describe(!S.seen.has(id));
		S.seen.add(id);
		if (S.collapse > 0) {
			line(
				S.collapse <= 3 ? `The walls are coming apart! (${S.collapse} moves left)` : `The dungeon shudders. Dust rains down. (${S.collapse} moves left)`,
				'warn',
			);
		}
		if (ENEMIES[id] && S.foes[id] > 0) {
			S.fight = id;
			line(ENEMIES[id].intro, 'warn');
			line(`-- ${ENEMIES[id].name}: ${S.foes[id]} HP --  attack | special | use potion | switch | flee`, 'dim');
		}
	}

	function go(d: Dir | undefined) {
		if (!d) return line('Go where? (north, south, east, west, up, down)');
		if (S.fight) return line(`The ${ENEMIES[S.fight].name} blocks the way. Fight, or FLEE back the way you came.`, 'warn');
		const r = ROOMS[S.room];
		const dest = r.exits[d];
		const lock = r.locks?.[d];
		if (!dest || (lock?.hidden && !S.flags.has(lock.flag))) {
			return line(blind() ? 'You grope forward and meet cold, wet stone.' : 'You can\'t go that way.');
		}
		if (lock && !S.flags.has(lock.flag)) return line(lock.msg);
		if (blind() && Math.random() < 0.5) {
			const m = me();
			const dmg = rand(1, 3);
			m.hp = Math.max(1, m.hp - dmg);
			line(`${who(m)} ${v(m, 'stumble')} in the dark and ${v(m, 'crack')} a shin. (-${dmg} HP)`, 'warn');
		}
		enter(dest);
	}

	// -- Fighting --
	function strike(m: Member, special: boolean): number {
		const c = CLASSES[m.cls];
		if (!special) return rand(...c.atk);
		if (m.cls === 'warrior') return rand(...c.atk) * 2;
		if (m.cls === 'mage') return rand(9, 14);
		if (m.cls === 'rogue') return rand(7, 13);
		return rand(...c.atk) + rand(...c.atk);
	}

	const SPECIAL_TEXT: Record<ClassId, (m: Member) => string> = {
		warrior: (m) => `${v(m, 'cleave')} with everything ${m.you ? 'you have' : 'she has'}`,
		mage: (m) => `${v(m, 'hurl')} a firebolt`,
		rogue: (m) => `${v(m, 'slip')} behind it and ${v(m, 'stab')}`,
		ranger: (m) => `${v(m, 'loose')} two arrows`,
	};

	/** Returns true when the enemy dies. */
	function hurtFoe(dmg: number): boolean {
		const f = S.fight!;
		S.foes[f] = Math.max(0, S.foes[f] - dmg);
		if (S.foes[f] > 0) return false;
		S.fight = null;
		line(ENEMIES[f].death, 'good');
		if (f === 'warden') S.items.warden.push('bone key');
		const r = ROOMS[S.room];
		if (S.items[S.room].length) line(`You see: ${S.items[S.room].join(', ')}.`);
		line(exitsText(r), 'dim');
		return true;
	}

	function foeAttacks() {
		const e = ENEMIES[S.fight!];
		const targets = alive();
		const t = targets[rand(0, targets.length - 1)];
		const dmg = Math.max(1, rand(...e.atk) - CLASSES[t.cls].armor);
		t.hp = Math.max(0, t.hp - dmg);
		line(`The ${e.name} hits ${t.you ? 'you' : t.name} for ${dmg}.`, 'warn');
		if (t.hp === 0) {
			line(t.you ? 'You fall!' : `${t.name} falls!`, 'warn');
			if (!alive().length) return die('Your whole party lies still in the dark.');
			if (me().hp === 0) {
				S.active = S.party.indexOf(alive()[0]);
				line(`You now act as ${label(me())}.`, 'dim');
				setPrompt();
			}
		}
	}

	function round() {
		for (const a of S.party) {
			if (a === me() || a.hp <= 0) continue;
			const d = strike(a, false);
			line(`${a.name} ${v(a, 'strike')} for ${d}.`);
			if (hurtFoe(d)) return;
		}
		foeAttacks();
		if (S.phase === 'play' && S.fight) line(partyStatus(), 'dim');
	}

	function attack(special: boolean) {
		if (!S.fight) return line(special ? 'Save your strength for a fight.' : 'There is nothing here to fight.');
		const m = me();
		if (special && m.uses <= 0) {
			return line(`${who(m)} ${m.you ? 'are' : 'is'} too spent for that. Rest at the tavern to recover. (ATTACK still works.)`, 'warn');
		}
		const dmg = strike(m, special);
		if (special) m.uses--;
		const foe = ENEMIES[S.fight].name;
		line(special ? `${who(m)} ${SPECIAL_TEXT[m.cls](m)}: ${dmg} damage!` : `${who(m)} ${v(m, 'strike')} the ${foe} for ${dmg}.`);
		if (!hurtFoe(dmg)) round();
	}

	function flee() {
		if (!S.fight) return line('There is nothing to flee from.');
		if (Math.random() < 0.5) foeAttacks();
		if (S.phase !== 'play') return;
		S.fight = null;
		line('You scramble back the way you came.', 'dim');
		enter(S.prev);
	}

	// -- Things --
	function matchItem(list: string[], words: string): string | undefined {
		const ws = words.split(' ');
		return list.find((it) => it === words || it.includes(words) || it.split(' ').some((p) => ws.includes(p)));
	}

	function takeOne(item: string) {
		const list = S.items[S.room];
		list.splice(list.indexOf(item), 1);
		addItem(item);
		line(`Taken: ${item}.`);
		if (item === 'torch') S.torch = TORCH_MOVES;
		if (item === 'sunstone') {
			S.collapse = COLLAPSE_MOVES;
			line('You lift the Sunstone. Warmth floods up your arms... and the whole dungeon lurches. Stone grinds on stone, far above.', 'warn');
			line(`It's coming down. Get back to the surface! (${S.collapse} moves)`, 'warn');
		}
	}

	function take(what: string) {
		if (!what) return line('Take what?');
		if (blind()) return line('You pat around in the dark and find only wet stone.');
		const list = S.items[S.room];
		if (what === 'all' || what === 'everything') {
			if (!list.length) return line('There is nothing here to take.');
			for (const it of [...list]) takeOne(it);
			return;
		}
		const it = matchItem(list, what);
		if (it) return takeOne(it);
		line(featureText(what) ? 'That isn\'t something you can carry.' : 'You don\'t see that here.');
	}

	function featureText(what: string): string | undefined {
		const f = ROOMS[S.room].features ?? {};
		const key = Object.keys(f).find((k) => k.split('|').some((w) => what.split(' ').includes(w)));
		return key ? f[key] : undefined;
	}

	function examine(what: string) {
		if (!what || what === 'room' || what === 'around') return describe(true);
		if (blind()) return line('You can\'t see a thing.');
		const f = featureText(what);
		if (f) return line(f);
		const owned = matchItem([...S.inv.keys()], what) ?? matchItem(S.items[S.room], what);
		if (owned) return line(ITEM_TEXT[owned] ?? 'Nothing special.');
		const m = findMember(what);
		if (m) return line(`${label(m)}: ${m.hp}/${m.max} HP. ${CLASSES[m.cls].blurb}`);
		line('You see nothing special about that.');
	}

	function usePotion(target: string | undefined) {
		if (!has('potion')) return line('You have no potions.');
		const m = target ? findMember(target) : me();
		if (!m) return line('Use it on whom?');
		if (m.hp === m.max) return line(`${who(m)} ${m.you ? 'are' : 'is'} already unhurt.`);
		const was = m.hp;
		m.hp = Math.min(m.max, m.hp + POTION_HEAL);
		S.inv.set('potion', S.inv.get('potion')! - 1);
		if (!has('potion')) S.inv.delete('potion');
		line(was === 0 ? `${who(m)} ${v(m, 'gasp')} and ${m.you ? 'are' : 'is'} back on ${m.you ? 'your' : 'their'} feet. (${m.hp}/${m.max})` : `${who(m)} ${v(m, 'drink')} a potion. (${m.hp}/${m.max} HP)`, 'good');
		if (S.fight) round();
	}

	function use(what: string) {
		const [item, target] = what.split(/\s+on\s+/);
		if (!item) return line('Use what?');
		if (/potion|vial|flask/.test(item)) return usePotion(target);
		if (/key/.test(item)) return unlock();
		if (/torch/.test(item)) return line(has('torch') ? 'It burns while you carry it.' : 'You have no torch.');
		if (/sunstone/.test(item)) return line(has('sunstone') ? ITEM_TEXT.sunstone : 'If only.');
		line('You can\'t use that.');
	}

	function open(flag: 'gate' | 'vault', text: string) {
		S.flags.add(flag);
		line(text, 'good');
	}

	function unlock() {
		if (S.room === 'gatehall' && !S.flags.has('gate')) {
			if (has('iron key')) return open('gate', 'The iron key turns with a shriek of rust. The gate swings open.');
			return line('The gate is locked, and you have no key that fits.');
		}
		if (S.room === 'warden' && !S.flags.has('vault')) {
			if (S.fight) return line('Not with the Warden breathing down your neck.');
			if (has('bone key')) return open('vault', 'The bone key slides in. The sun-door rolls aside on a hidden track.');
			return line('The sun-door is locked, and you have no key that fits.');
		}
		line('There is nothing here to unlock.');
	}

	function pick(what: string) {
		if (what.startsWith('up')) return take(what.slice(2).trim());
		const m = me();
		const target = (S.room === 'gatehall' && !S.flags.has('gate')) || (S.room === 'warden' && !S.flags.has('vault'));
		if (!target) return line('There is no lock here to pick.');
		if (m.cls !== 'rogue') return line(`${who(m)} ${v(m, 'fiddle')} with the lock and get${m.you ? '' : 's'} nowhere. (A rogue could do this.)`);
		if (S.fight) return line('Not in the middle of a fight!');
		if (S.room === 'gatehall') open('gate', `${who(m)} ${v(m, 'kneel')} at the lock. Click, click... clunk. The gate swings open.`);
		else open('vault', `${who(m)} ${v(m, 'work')} the strange lock for a long minute. The sun-door rolls aside.`);
	}

	function force() {
		const m = me();
		if (S.room === 'gatehall' && !S.flags.has('gate')) {
			if (m.cls !== 'warrior') return line(`${who(m)} ${v(m, 'heave')} at the bars. They don't budge. (A warrior might manage.)`);
			m.hp = Math.max(1, m.hp - 2);
			return open('gate', `${who(m)} ${v(m, 'wrench')} the gate until the lock tears out of the stone. (-2 HP, worth it.)`);
		}
		if (S.room === 'warden' && !S.flags.has('vault')) return line('The sun-door doesn\'t even notice.');
		line('Nothing here needs forcing.');
	}

	function push(what: string) {
		if (S.room !== 'stones') return line(what ? 'Nothing happens.' : 'Push what?');
		if (S.flags.has('entrance')) return line('The eastern stone already stands aside.');
		if (/east|morning|sun|dawn|sunrise/.test(what)) {
			S.flags.add('entrance');
			line('You set your shoulder to the eastern stone and push. It grinds aside on an old groove, and cold air sighs up from below.', 'good');
			art(ART.entrance);
			return line(exitsText(ROOMS.stones), 'dim');
		}
		line('You heave against a stone until your boots slip. Nothing. Seven stones; you would need to know which.');
	}

	function track() {
		const m = me();
		if (m.cls !== 'ranger') return line(`${who(m)} ${v(m, 'squint')} at the ground. Dirt. (A ranger would see more.)`);
		if (blind()) return line('Too dark to read any trail.');
		line(ROOMS[S.room].track ?? 'No trail worth following here.');
	}

	function recruit(name: string) {
		if (S.room !== 'tavern') return line('No one here is looking for an adventure.');
		const waiting = CLASS_ORDER.filter((c) => !S.party.some((m) => m.cls === c));
		if (!name) return line(`Recruit whom? (${waiting.map((c) => CLASSES[c].ally).join(', ')})`);
		const cls = CLASS_ORDER.find((c) => CLASSES[c].ally.toLowerCase().startsWith(name) || c === name);
		if (!cls || !waiting.includes(cls)) return line(cls ? 'They are already with you.' : 'No one here by that name.');
		if (S.party.length >= 3) return line('Your party is full: you and two companions.');
		const c = CLASSES[cls];
		S.party.push({ name: c.ally, cls, hp: c.hp, max: c.hp, uses: c.uses, you: false });
		line(c.join, 'good');
		line(`${c.ally} the ${c.label} joins your party. (SWITCH ${c.ally.toUpperCase()} to act as them.)`, 'dim');
	}

	function switchTo(name: string) {
		if (!name) return line('Switch to whom? (see PARTY)');
		const m = findMember(name);
		if (!m) return line('No one in your party by that name.');
		if (m.hp === 0) return line(`${who(m)} ${m.you ? 'are' : 'is'} down. A potion would help.`);
		S.active = S.party.indexOf(m);
		line(`You now act as ${label(m)}.`, 'dim');
		setPrompt();
	}

	function rest() {
		if (S.room !== 'tavern') return line('Not here. The only safe bed for miles is at the tavern in Ashford.');
		for (const m of S.party) {
			m.hp = m.max;
			m.uses = CLASSES[m.cls].uses;
		}
		S.torch = TORCH_MOVES;
		if (!has('torch')) {
			addItem('torch');
			line('The innkeeper presses a fresh torch into your hands. "You\'ll want this."');
		}
		line('You eat, sleep by the fire, and wake mended. Strength and spells restored.', 'good');
	}

	function inventory() {
		if (!S.inv.size) return line('You carry nothing but your wits.');
		for (const [it, n] of S.inv) {
			line(`  ${it}${n > 1 ? ` x${n}` : ''}${it === 'torch' ? ` (${S.torch} dark rooms of light left)` : ''}`);
		}
	}

	function party() {
		for (const m of S.party) {
			const c = CLASSES[m.cls];
			const filled = Math.round((m.hp / m.max) * 10);
			const bar = `[${'#'.repeat(filled)}${'-'.repeat(10 - filled)}]`;
			line(`${m === me() ? '>' : ' '} ${label(m)}  ${bar} ${m.hp}/${m.max}  ${c.special} x${m.uses}${m.hp === 0 ? '  (down)' : ''}`);
		}
		if (S.party.length < 3) line('(More companions wait at the tavern in Ashford.)', 'dim');
	}

	function help() {
		[
			'Move:   n, s, e, w, up, down  (or GO NORTH)',
			'Look:   look, examine <thing>, read <thing>',
			'Things: take <item>, take all, use <item> [on <name>], inventory',
			'Party:  party, recruit <name>, switch <name>, rest',
			'Skills: push <thing>, pick (lock), force (gate), track',
			'Fight:  attack, special, use potion, flee',
			'Other:  clear, restart, quit.  Arrow keys recall commands.',
		].forEach((t) => line(t, 'dim'));
	}

	const COMBAT_OK = new Set(['attack', 'a', 'hit', 'fight', 'kill', 'special', 'ability', 'cleave', 'firebolt', 'backstab', 'volley',
		'use', 'drink', 'quaff', 'switch', 'party', 'stats', 'status', 'inventory', 'inv', 'i', 'look', 'l', 'flee', 'retreat', 'run', 'examine', 'x']);

	function run(raw: string) {
		const text = raw.trim().toLowerCase().replace(/[.!?]+$/, '');
		if (!text) return;
		const words = text.split(/\s+/).filter((w) => !FILLER.has(w));
		const verb = words[0] ?? '';
		const rest = words.slice(1).join(' ');
		if (verb === 'clear' || verb === 'cls') return void (out.textContent = '');
		if (verb === 'quit') return win.close();
		if (verb === 'exit') return line('Type QUIT to close the terminal (or a direction to leave the room).', 'dim');
		if (verb === 'restart') return restart();
		if (verb === 'help' || verb === '?' || verb === 'commands') return help();
		if (S.phase === 'class') return chooseClass(text);
		if (S.phase === 'over') return line('This tale is told. Type RESTART to begin again.', 'dim');
		if (S.fight && !COMBAT_OK.has(verb) && !dirOf(verb) && verb !== 'go') {
			return line(`The ${ENEMIES[S.fight].name} won't give you the chance. (attack, special, use potion, switch, flee)`, 'warn');
		}
		if (dirOf(verb)) return go(dirOf(verb));
		switch (verb) {
			case 'go': case 'walk': case 'move': case 'head': case 'climb':
				return go(dirOf(words[1] ?? '') ?? (verb === 'climb' ? 'u' : undefined));
			case 'enter':
				return S.room === 'stones' ? go('d') : line('Enter where? Try a direction.');
			case 'look': case 'l':
				return rest ? examine(rest) : describe(true);
			case 'examine': case 'x': case 'inspect': case 'read': case 'search':
				return examine(rest);
			case 'take': case 'get': case 'grab':
				return take(words[1] === 'up' ? words.slice(2).join(' ') : rest);
			case 'pick':
				return pick(rest);
			case 'use': case 'drink': case 'quaff':
				return use(verb === 'use' ? rest : `potion${rest.includes(' on ') ? rest.slice(rest.indexOf(' on ')) : ''}`);
			case 'unlock': case 'open':
				return unlock();
			case 'force': case 'break': case 'bash': case 'smash':
				return force();
			case 'push': case 'press': case 'shove':
				return push(rest);
			case 'track': case 'follow':
				return track();
			case 'light': case 'cast':
				if (mage()) return line('The mage\'s staff already glows. Wherever you go, there is light.');
				return line(has('torch') ? 'Your torch is burning.' : 'You have nothing to light.');
			case 'inventory': case 'inv': case 'i':
				return inventory();
			case 'party': case 'stats': case 'status':
				return party();
			case 'switch': case 'become': case 'control':
				return switchTo(rest.replace(/^as\s+/, ''));
			case 'recruit': case 'hire': case 'invite':
				return recruit(rest);
			case 'rest': case 'sleep':
				return rest_();
			case 'attack': case 'a': case 'hit': case 'fight': case 'kill':
				return attack(false);
			case 'special': case 'ability': case 'cleave': case 'firebolt': case 'backstab': case 'volley':
				if (verb !== 'special' && verb !== 'ability' && verb !== CLASSES[me().cls].special) {
					return line(`That's not ${me().you ? 'your' : `${me().name}'s`} trick. (SPECIAL uses ${CLASSES[me().cls].special}.)`);
				}
				return attack(true);
			case 'flee': case 'retreat': case 'run':
				return flee();
			case 'talk': case 'ask':
				return line(S.room === 'tavern' ? 'Everyone here talks about the forest. Some of them would go, with the right company.' : 'No one answers.');
			default:
				line('You can\'t do that here. (Type HELP for commands.)');
		}
	}
	const rest_ = rest;

	// -- Input --
	const history: string[] = [];
	let hIdx = 0;
	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const cmd = input.value;
		input.value = '';
		if (!cmd.trim()) return;
		line(`> ${cmd}`, 'echo');
		if (history.at(-1) !== cmd) history.push(cmd);
		hIdx = history.length;
		run(cmd);
	});
	input.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowUp' && history.length) {
			e.preventDefault();
			hIdx = Math.max(0, hIdx - 1);
			input.value = history[hIdx];
		} else if (e.key === 'ArrowDown' && history.length) {
			e.preventDefault();
			hIdx = Math.min(history.length, hIdx + 1);
			input.value = history[hIdx] ?? '';
		} else if (e.key === 'Escape') {
			input.value = '';
		}
	});
	out.addEventListener('click', () => {
		if (!getSelection()?.toString()) input.focus({ preventScroll: true });
	});

	if (touchOnly()) {
		const keys = document.createElement('div');
		keys.className = 'adv-keys';
		for (const k of ['look', 'n', 's', 'e', 'w', 'up', 'down', 'take all', 'attack', 'special', 'party', 'inventory']) {
			const b = document.createElement('button');
			b.type = 'button';
			b.textContent = k;
			b.addEventListener('click', () => {
				line(`> ${k}`, 'echo');
				run(k);
			});
			keys.append(b);
		}
		win.body.append(keys);
	}

	start();
}
