// "The Librarian's Ledger": a paper mystery for the Skills page ("libraries").
// The player reads six documents on a desk and names who took what, and where it is now.
//
// SPOILERS. The answer: Barnaby Fitch took the Halloway Star Atlas; it is back in the library,
// rebound as the "Drainage Reports" in Stack C. Each part needs several documents:
//  - WHAT: the Courier says the drawer was "lifted, not levered"; the Guide says only drawer 4 must be
//    lifted; the Ledger shows the atlas was moved into drawer 4 that night (its cipher manuscript was out).
//  - WHO: everyone else is alibied (letter + timetable, sports page, society column); Fitch claimed the
//    6.40 to Marlow, which the timetable says runs on Saturdays only (the theft was a Tuesday).
//  - WHERE: the Letter and Ledger describe Fitch's heavy calf-bound "gift" shelved in Stack C; the Guide
//    gives the atlas as a twenty-inch folio in plain calf.
import { chime, openWindow, solve } from '../ui';
import { getData, isSolved, setData } from '../progress';

type Kind = 'news' | 'letter' | 'ledger' | 'book' | 'timetable';

interface PaperDoc {
	id: string;
	kind: Kind;
	label: string;
	sub: string;
	html: string;
}

interface Choice {
	value: string;
	label: string;
}

const WHO: Choice[] = [
	{ value: 'marchbank', label: 'Miss Odile Marchbank, assistant librarian' },
	{ value: 'quell', label: 'Professor Silas Quell, astronomer' },
	{ value: 'vance', label: 'Mrs. Henrietta Vance, trustee' },
	{ value: 'fitch', label: 'Mr. Barnaby Fitch, bookbinder' },
	{ value: 'wren', label: 'Master Tobias Wren, page' },
];
const WHAT: Choice[] = [
	{ value: 'key', label: 'The brass orrery key' },
	{ value: 'atlas', label: 'The Halloway Star Atlas' },
	{ value: 'chronometer', label: 'The pocket chronometer' },
	{ value: 'cipher', label: 'The Pellow cipher manuscript' },
	{ value: 'charter', label: 'The town charter of 1702' },
];
const WHERE: Choice[] = [
	{ value: 'luggage', label: 'The left-luggage office at Lantern Street Halt' },
	{ value: 'cardew', label: 'Mr. Cardew’s book shop in Marlow' },
	{ value: 'bindery', label: 'Under the floor of Fitch’s bindery' },
	{ value: 'stackc', label: 'Back in the library, on a shelf in Stack C' },
	{ value: 'guildhall', label: 'Behind the Guildhall lectern' },
];

/** The answer key. Never written into the DOM. */
const ANSWER = { who: 'fitch', what: 'atlas', where: 'stackc' } as const;

const READ_KEY = 'skills-read';

const DOCS: PaperDoc[] = [
	{
		id: 'courier1',
		kind: 'news',
		label: 'The Courier',
		sub: 'Wednesday, 13 October',
		html: `
			<div class="mys-mast">The Fenwick Hollow Courier</div>
			<div class="mys-dateline"><span>Vol. LXI · No. 41</span><span>Wednesday, 13 October 1926</span><span>Twopence</span></div>
			<h3 class="mys-head">Rare Room Rifled at Lantern Street</h3>
			<p class="mys-deck">Treasure Taken Between Closing and Supper · Librarian Silent on Loss · “Lifted, Not Levered,” Says Constable</p>
			<div class="mys-cols">
				<p class="mys-drop">The Lantern Street Public Library was the scene of a most audacious theft on Tuesday evening. The building closed as usual at six o’clock. When the head librarian, Mr. Ambrose Pell, returned from his supper at half past seven, he found the Rare Room unlocked and one of its five oak drawers standing open.</p>
				<p>Mr. Pell declined to tell this newspaper what was taken, saying only that it was “irreplaceable” and that the thief “knew exactly what he was about.” Constable Hobb, who examined the room, agreed. “Nothing forced,” said he. “That drawer was lifted, not levered, by somebody who’d done it before.”</p>
				<p>Five persons had business in the Rare Room on Tuesday. <b>Miss Odile Marchbank</b>, the assistant librarian, locked up at six and left at once for the railway. <b>Professor Silas Quell</b>, the astronomer, returned a volume shortly before closing and went directly to the Guildhall, where he dined with the Mayor before his seven o’clock lecture. <b>Mrs. Henrietta Vance</b>, a trustee, had earlier collected a document for the Founders’ Dinner. <b>Mr. Barnaby Fitch</b>, bookbinder, spent the afternoon mending a drawer lock in the Rare Room and states that he caught the 6.40 to Marlow to deliver an order. The page, <b>Master Tobias Wren</b>, was “otherwise engaged,” and the <i>Courier</i> will say no more of him until the sports page.</p>
				<p>It is understood that a Mr. Cardew, a dealer in old books at Marlow, has lately written to the library asking after its “older holdings.” Mr. Pell called the inquiry “vulgar.”</p>
			</div>`,
	},
	{
		id: 'courier2',
		kind: 'news',
		label: 'Sport & Society',
		sub: 'Thursday, 14 October',
		html: `
			<div class="mys-mast">The Fenwick Hollow Courier</div>
			<div class="mys-dateline"><span>Sport &amp; Society</span><span>Thursday, 14 October 1926</span><span>Page 6</span></div>
			<div class="mys-cols">
				<h3 class="mys-head mys-small">Rovers Triumph Under the Lamps</h3>
				<p class="mys-deck">Hollow Rovers 3 · Ashby Wanderers 1</p>
				<p class="mys-drop">Tuesday’s evening fixture at Mill Field kicked off at six o’clock sharp and was played to the final whistle at half past seven by the light of the new gas lamps. Young <b>Tobias Wren</b>, whom readers will know from the library desk, scored twice and was carried from the field at the finish by persons who ought to have known better.</p>
				<h3 class="mys-head mys-small">The Founders Dine</h3>
				<p><b>Mrs. Henrietta Vance</b>, who had been at the Guildhall since five o’clock seeing to the flowers and the place cards, opened Tuesday’s Founders’ Dinner by reading aloud from the town’s charter, lent for the evening by the Lantern Street Library. <b>Professor Quell</b>, seated at the Mayor’s right hand, left the table at ten to seven for his lecture in the upper hall, and did not, he assured the company, mention the planet Uranus more than four times.</p>
				<p class="mys-small-ad"><b>LOST</b>, at Lantern Street Halt, one umbrella, green, answering to nothing. Reward.</p>
			</div>`,
	},
	{
		id: 'letter',
		kind: 'letter',
		label: 'A Letter',
		sub: '“Dearest Winnie…”',
		html: `
			<p class="mys-letter-head">Lantern Street, Wednesday night</p>
			<p>Dearest Winnie,</p>
			<p>What a week. You will have seen the <i>Courier</i>, so I shan’t pretend nothing has happened. I am sworn not to say what was taken (Mr. Pell has gone grey round the edges and speaks only in whispers), but I can tell you it had nothing to do with me, for I was on the 6.05 to Kestrel Bay before the dust had settled on the reading-room chairs. Clem met me off the train and we were eating kippers before seven. The constable has written it all down twice.</p>
			<p>Now here is the odd thing. This morning Mr. Fitch came in with a gift “for the library, gratis”: the old Drainage Reports, 1898 to 1903, rebound in calf. <u>In calf</u>, Winnie! A great flat thing, as tall as my arm from elbow to fingertip and heavy as a gravestone. Who binds drainage reports in calf? I put it in Stack C, where nobody has looked since the old King died, and I shall be astonished if anyone opens it before I’m a grandmother.</p>
			<p>Tobias has been insufferable since his two goals.</p>
			<p>Burn this, or at least don’t leave it on the piano.</p>
			<p class="mys-sign">Your loving O.</p>`,
	},
	{
		id: 'ledger',
		kind: 'ledger',
		label: 'Rare Room Register',
		sub: 'October 1926',
		html: `
			<h3 class="mys-ledger-title">Lantern Street Library · Rare Room Register</h3>
			<p class="mys-ledger-sub">October 1926 · Every item leaving or returning to a drawer to be entered here. A.P.</p>
			<div class="mys-scroll">
			<table class="mys-table">
				<thead><tr><th>Date</th><th>Item</th><th>Drawer</th><th>By</th><th>Out</th><th>In</th><th>Remarks</th></tr></thead>
				<tbody>
					<tr><td>4 Oct</td><td>Pellow Cipher Manuscript</td><td>4</td><td>County Records Office</td><td>10.00</td><td>—</td><td class="mys-ink">Sent for photographing. Due back 20th.</td></tr>
					<tr><td>9 Oct</td><td>Brass Orrery Key</td><td>1</td><td>Prof. S. Quell</td><td>11.00</td><td>11.40</td><td class="mys-ink">Wound the orrery. Again.</td></tr>
					<tr><td>11 Oct</td><td>Town Charter, 1702</td><td>5</td><td>Mrs. H. Vance</td><td>10.15</td><td>—</td><td class="mys-ink">For the Founders’ Dinner. Due Thurs.</td></tr>
					<tr><td>12 Oct</td><td>Halloway Star Atlas</td><td>2</td><td>Prof. S. Quell</td><td>2.05</td><td>5.40</td><td class="mys-ink">Lock of Drawer 2 jammed on return. Placed in Drawer 4 for the night. A.P.</td></tr>
					<tr><td>12 Oct</td><td>Drawer 2 lock</td><td>—</td><td>B. Fitch (repair)</td><td>5.45</td><td>—</td><td class="mys-ink">Taken away for mending. Refit Thurs.</td></tr>
					<tr><td>12 Oct</td><td>Pocket Chronometer</td><td>3</td><td>A. Pell</td><td>5.55</td><td>5.58</td><td class="mys-ink">Wound &amp; checked.</td></tr>
					<tr><td>13 Oct</td><td><i>Gift:</i> Fenwick Drainage Reports, 1898–1903</td><td>—</td><td>from B. Fitch</td><td>—</td><td>9.20</td><td class="mys-ink">Folio, rebound in calf. Stack C, shelf 9.</td></tr>
					<tr><td>13 Oct</td><td class="mys-blot" colspan="5"></td><td class="mys-ink">Constable Hobb called. Heaven help us. A.P.</td></tr>
				</tbody>
			</table>
			</div>`,
	},
	{
		id: 'book',
		kind: 'book',
		label: 'A Visitor’s Guide',
		sub: 'p. 34, pencilled',
		html: `
			<div class="mys-runhead"><span>34</span><span>A Visitor’s Guide to the Lantern Street Library</span><span></span></div>
			<h3 class="mys-chapter">VII. The Rare Room</h3>
			<p class="mys-drop">The Rare Room, though small, repays the visitor’s patience. Its treasures are kept in five oak drawers, numbered from the door: the first three along the east wall, the fourth beneath the west window, and the fifth, which is the deepest, beside the fireplace.</p>
			<p>Visitors invariably ask after the <span class="mys-sc">Halloway Star Atlas</span>, a folio of thirty-one hand-coloured plates, some twenty inches tall and bound in plain brown calf, which ordinarily rests in the second drawer. Nearly as admired are the town’s <span class="mys-sc">Charter</span> of 1702 and the curious <span class="mys-sc">Pellow Manuscript</span>, whose cipher has defeated three generations of clergymen.</p>
			<p><span class="mys-margin">Rehung by Fitch, spring of ’24. Still sticks. <u>He</u> showed the boy the trick, not the other way round. A.P.</span>The visitor should not attempt the drawers himself. The fourth in particular swells in damp weather and will open only if it is lifted as it is drawn: a knack every page-boy learns in his first week, and which the rest of us are content to leave to him.</p>
			<p class="mys-folio">— 1911 —</p>`,
	},
	{
		id: 'timetable',
		kind: 'timetable',
		label: 'Railway Timetable',
		sub: 'Lantern Street Halt',
		html: `
			<h3 class="mys-tt-title">Fenwick Hollow &amp; District Railway</h3>
			<p class="mys-tt-sub">Lantern Street Halt · Down Trains · Winter Service from 1st October 1926</p>
			<div class="mys-scroll">
			<table class="mys-table mys-tt">
				<thead><tr><th>Departs</th><th>For</th><th>Arrives</th><th>Runs</th></tr></thead>
				<tbody>
					<tr><td>4.50</td><td>Kestrel Bay</td><td>5.33</td><td>Daily</td></tr>
					<tr><td>5.15</td><td>Marlow</td><td>6.02</td><td>Mon. to Fri.</td></tr>
					<tr><td>5.40</td><td>Ashby</td><td>6.05</td><td>Daily</td></tr>
					<tr><td>6.05</td><td>Kestrel Bay</td><td>6.48</td><td>Daily</td></tr>
					<tr><td>6.40</td><td>Marlow</td><td>7.27</td><td>Saturdays only</td></tr>
					<tr><td>7.10</td><td>Ashby</td><td>7.35</td><td>Daily</td></tr>
					<tr><td>7.55</td><td>Kestrel Bay</td><td>8.38</td><td>Daily</td></tr>
				</tbody>
			</table>
			</div>
			<p class="mys-tt-foot">Left Luggage Office open 7 a.m. to 9 p.m. Parcels are carried at the owner’s risk. Passengers are requested not to lean from the windows, sing, or bring livestock into First Class.</p>`,
	},
];

const EPILOGUE: PaperDoc = {
	id: 'epilogue',
	kind: 'news',
	label: 'Late Edition',
	sub: 'Saturday, 16 October',
	html: `
		<div class="mys-mast">The Fenwick Hollow Courier</div>
		<div class="mys-dateline"><span>Late Edition</span><span>Saturday, 16 October 1926</span><span>Twopence</span></div>
		<h3 class="mys-head">Stars Found in the Drains</h3>
		<p class="mys-deck">Missing Atlas Hid Three Days in Plain Sight · Bookbinder Confesses · Drawer to Be Planed</p>
		<div class="mys-cols">
			<p class="mys-drop">The Halloway Star Atlas, missing from the Lantern Street Library since Tuesday, was recovered yesterday from Stack C of that same library, where it had spent three days disguised as the Fenwick Drainage Reports, 1898–1903.</p>
			<p>Mr. Barnaby Fitch, bookbinder, admitted to Constable Hobb that he had watched Mr. Pell place the atlas in the fourth drawer, returned after closing with a key “left over from the lock work of ’24,” and by morning had sewn all thirty-one plates into a new calf cover. He meant, he said, to “borrow it back for re-sewing” in a month and carry it to a buyer in Marlow.</p>
			<p>He had not reckoned on the 6.40 running only on Saturdays.</p>
			<p>Mr. Pell has had the fourth drawer planed. Miss Marchbank has been heard to say she “always thought the drainage was suspicious.”</p>
		</div>`,
};

const STYLE_ID = 'secret-style-mystery';
const CSS = `
.mys { --ink: #2b2419; font-size: 0.95rem; }
.mys-intro { margin: 0 0 12px; color: var(--text-muted); font-size: 0.9rem; }
.mys-desk {
	display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 14px;
	padding: 16px; border-radius: 10px;
	background: radial-gradient(120% 90% at 30% 20%, #4a3322, #2a1c12 70%, #1c120b);
	box-shadow: inset 0 0 40px rgba(0,0,0,0.6);
}
.mys-card {
	all: unset; box-sizing: border-box; cursor: pointer; position: relative;
	min-height: 112px; padding: 12px 10px 10px; border-radius: 2px;
	background: #efe5cc; color: var(--ink);
	font-family: Georgia, 'Times New Roman', serif;
	box-shadow: 0 6px 14px rgba(0,0,0,0.45);
	transform: rotate(var(--tilt, 0deg));
	transition: transform 0.2s, box-shadow 0.2s;
	display: flex; flex-direction: column; gap: 4px;
}
.mys-card:hover, .mys-card:focus-visible {
	transform: rotate(0deg) translateY(-3px) scale(1.03);
	box-shadow: 0 10px 22px rgba(0,0,0,0.55), 0 0 0 2px #ffe7a3;
}
.mys-card[data-kind='letter'] { background: #f6efdf; }
.mys-card[data-kind='ledger'] { background: #dfe6d2; }
.mys-card[data-kind='timetable'] { background: #ece6d6; }
.mys-card[data-kind='book'] { background: #f2e9d3; }
.mys-card-kind { font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.6; }
.mys-card-label { font-weight: 700; font-size: 1rem; line-height: 1.15; }
.mys-card-sub { font-style: italic; font-size: 0.82rem; opacity: 0.75; }
.mys-card-lines { margin-top: auto; height: 22px;
	background: repeating-linear-gradient(transparent 0 5px, rgba(43,36,25,0.22) 5px 6px); }
.mys-card.is-read::after {
	content: '✓ read'; position: absolute; top: 6px; right: 8px;
	font-size: 0.68rem; font-family: var(--font); color: #7a5b2e; opacity: 0.8;
}
.mys-card.is-epilogue { box-shadow: 0 6px 14px rgba(0,0,0,0.45), 0 0 0 2px #ffe7a3; }

.mys-case { margin-top: 16px; padding: 14px; border: 1px solid var(--border); border-radius: 10px;
	background: rgba(255,231,163,0.04); }
.mys-case h3 { margin: 0 0 4px; font-size: 1rem; color: #ffe7a3; }
.mys-case-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); margin: 10px 0 12px; }
.mys-case label { display: grid; gap: 4px; font-size: 0.8rem; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase; }
.mys-case select { width: 100%; text-transform: none; letter-spacing: 0; }
.mys-case select option { background: #0a1022; color: var(--text); }
.mys-feedback { margin: 10px 0 0 !important; min-height: 1.3em; font-style: italic; }
.mys-feedback.is-good { color: #ffe7a3; font-style: normal; }
.mys-feedback.is-shake { animation: mys-shake 0.35s; }
@keyframes mys-shake { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }

.mys-reader-bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; }
.mys-paper {
	color: var(--ink); background: #f1e8d2; padding: 18px 20px 20px; border-radius: 3px;
	font-family: Georgia, 'Times New Roman', serif; line-height: 1.5;
	box-shadow: 0 8px 30px rgba(0,0,0,0.5);
	background-image: radial-gradient(130% 100% at 50% 0%, rgba(255,255,255,0.35), transparent 60%),
		radial-gradient(90% 70% at 100% 100%, rgba(120,80,30,0.12), transparent 70%);
	animation: mys-unfold 0.25s ease-out;
}
@keyframes mys-unfold { from { transform: translateY(8px) rotate(-0.6deg); opacity: 0; } }
.mys-paper p { margin: 0 0 0.75em; }
.mys-paper b { font-weight: 700; }

.mys-mast { text-align: center; font-family: 'Old English Text MT', 'Engravers Old English', Georgia, serif;
	font-size: clamp(1.35rem, 5vw, 2rem); line-height: 1.1; font-weight: 700; }
.mys-dateline { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 10px;
	margin: 6px 0 12px; padding: 3px 0; border-top: 3px double var(--ink); border-bottom: 1px solid var(--ink);
	font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; }
.mys-head { margin: 0; text-align: center; text-transform: uppercase; font-weight: 900;
	font-size: clamp(1.15rem, 4.2vw, 1.6rem); line-height: 1.08; letter-spacing: 0.02em; }
.mys-head.mys-small { font-size: 1.05rem; margin-top: 4px; break-after: avoid; }
.mys-deck { text-align: center; font-style: italic; font-size: 0.85rem; margin: 6px 0 12px !important;
	padding-bottom: 8px; border-bottom: 1px solid rgba(43,36,25,0.4); }
.mys-cols { columns: 2 220px; column-gap: 22px; column-rule: 1px solid rgba(43,36,25,0.3);
	text-align: justify; hyphens: auto; font-size: 0.9rem; }
.mys-cols .mys-deck { break-after: avoid; }
.mys-drop::first-letter { float: left; font-size: 2.9em; line-height: 0.85; padding: 4px 6px 0 0; font-weight: 700; }
.mys-small-ad { font-size: 0.8rem; border: 1px solid rgba(43,36,25,0.5); padding: 4px 6px; text-align: left; }

.mys-paper.is-letter { --ink: #20325a; background-color: #f7f1e3;
	/* Ruled every 28px, the same as the line height, with each rule just under the text's baseline. The
	   padding and paragraph gaps are whole lines so the writing never drifts off the rules. */
	background-image: repeating-linear-gradient(transparent 0 22px, rgba(32,50,90,0.14) 22px 23px, transparent 23px 28px);
	font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif; font-style: italic;
	line-height: 28px; font-size: 1.02rem; padding: 28px 24px; }
.mys-paper.is-letter p { margin: 0 0 28px; }
.mys-paper.is-letter p:last-child { margin-bottom: 0; }
.mys-letter-head { text-align: right; }
.mys-sign { text-align: right; padding-right: 10%; font-size: 1.15rem; }

.mys-paper.is-ledger { background-color: #e3e9d6; font-family: Georgia, serif; }
.mys-ledger-title { margin: 0; text-align: center; font-size: 1.05rem; letter-spacing: 0.06em; text-transform: uppercase; }
.mys-ledger-sub { text-align: center; font-style: italic; font-size: 0.82rem; margin-bottom: 10px !important; }
.mys-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.mys-table { border-collapse: collapse; width: 100%; min-width: 560px; font-size: 0.82rem; }
.mys-table th { text-align: left; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase;
	border-bottom: 3px double rgba(43,36,25,0.7); padding: 4px 6px; }
.mys-table td { border-bottom: 1px solid rgba(60,90,60,0.35); padding: 5px 6px; vertical-align: top; }
.mys-table td + td, .mys-table th + th { border-left: 1px solid rgba(160,60,60,0.35); }
.mys-ink { font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif; font-style: italic; color: #4a2c14; }
.mys-blot { background: radial-gradient(closest-side, rgba(20,20,40,0.8), rgba(20,20,40,0.45) 55%, transparent 75%) center / 70px 26px no-repeat; }

.mys-paper.is-book { background-color: #f4ecd8; padding: 18px 22px 22px; text-align: justify; hyphens: auto; }
.mys-runhead { display: flex; justify-content: space-between; font-size: 0.72rem; letter-spacing: 0.1em;
	text-transform: uppercase; opacity: 0.7; margin-bottom: 14px; }
.mys-chapter { text-align: center; font-weight: 400; font-size: 1.05rem; letter-spacing: 0.14em; text-transform: uppercase; margin: 0 0 14px; }
.mys-sc { font-variant: small-caps; letter-spacing: 0.04em; }
.mys-margin { float: right; width: min(40%, 180px); margin: 4px -6px 8px 14px; padding: 4px 2px;
	font-family: 'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive; font-size: 0.82rem; line-height: 1.3;
	color: #55586a; transform: rotate(-3deg); text-align: left; hyphens: none;
	border-left: 2px solid rgba(85,88,106,0.35); padding-left: 8px; }
.mys-folio { text-align: center; font-size: 0.8rem; opacity: 0.6; clear: both; margin: 12px 0 0 !important; }

.mys-paper.is-timetable { background-color: #efe9da; font-family: Georgia, serif; }
.mys-tt-title { margin: 0; text-align: center; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.08em;
	border-bottom: 2px solid var(--ink); padding-bottom: 4px; }
.mys-tt-sub { text-align: center; font-size: 0.8rem; font-style: italic; margin: 6px 0 10px !important; }
.mys-tt { min-width: 300px; font-variant-numeric: tabular-nums; font-size: 0.9rem; }
.mys-tt td { border-bottom: 1px dotted rgba(43,36,25,0.5); }
.mys-tt td + td, .mys-tt th + th { border-left: none; }
.mys-tt-foot { font-size: 0.76rem; margin-top: 10px !important; opacity: 0.8; }
@media (prefers-reduced-motion: reduce) { .mys-paper, .mys-card { animation: none; transition: none; } }
`;

function injectStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const s = document.createElement('style');
	s.id = STYLE_ID;
	s.textContent = CSS;
	document.head.append(s);
}

const KIND_NAME: Record<Kind, string> = {
	news: 'Newspaper',
	letter: 'Letter',
	ledger: 'Ledger',
	book: 'Book',
	timetable: 'Timetable',
};

function selectHTML(name: string, label: string, choices: Choice[]) {
	const opts = choices.map((c) => `<option value="${c.value}">${c.label}</option>`).join('');
	return `<label>${label}<select class="secret-input" name="${name}"><option value="">Choose…</option>${opts}</select></label>`;
}

export function launch(): void {
	injectStyle();
	const win = openWindow({ title: 'The Librarian’s Ledger', width: 760 });
	const already = isSolved('skills');
	let solvedNow = already;
	const read = new Set<string>(getData<string[]>(READ_KEY, []));

	const root = document.createElement('div');
	root.className = 'mys';
	win.body.append(root);

	const desk = document.createElement('div');
	const reader = document.createElement('div');
	reader.hidden = true;
	root.append(desk, reader);

	desk.innerHTML = `
		<p class="mys-intro">${
			already
				? 'You closed this case once already. The papers are still on the desk if you’d like to reread them.'
				: 'Fenwick Hollow, October 1926. Something precious has left the Rare Room of the Lantern Street Library. These papers have found their way to your desk. Read them closely; no single one tells the whole story.'
		}</p>
		<div class="mys-desk" role="list"></div>
		<form class="mys-case" novalidate>
			<h3>Close the case</h3>
			<p class="secret-hint" style="margin:0">Name the culprit, what they took, and where it is now.</p>
			<div class="mys-case-grid">
				${selectHTML('who', 'Who', WHO)}
				${selectHTML('what', 'What', WHAT)}
				${selectHTML('where', 'Where now', WHERE)}
			</div>
			<button type="submit" class="secret-btn">Make the accusation</button>
			<p class="mys-feedback" aria-live="polite"></p>
		</form>`;

	const deskGrid = desk.querySelector<HTMLElement>('.mys-desk')!;
	const form = desk.querySelector<HTMLFormElement>('form')!;
	const feedback = desk.querySelector<HTMLElement>('.mys-feedback')!;
	let deskScroll = 0;

	function renderDesk() {
		deskGrid.innerHTML = '';
		const docs = solvedNow ? [...DOCS, EPILOGUE] : DOCS;
		docs.forEach((d, i) => {
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'mys-card';
			card.setAttribute('role', 'listitem');
			card.dataset.kind = d.kind;
			card.style.setProperty('--tilt', `${[-2.2, 1.6, -0.8, 2.4, -1.4, 0.9, -1.9][i % 7]}deg`);
			if (read.has(d.id)) card.classList.add('is-read');
			if (d === EPILOGUE) card.classList.add('is-epilogue');
			card.innerHTML = `<span class="mys-card-kind"></span><span class="mys-card-label"></span><span class="mys-card-sub"></span><span class="mys-card-lines" aria-hidden="true"></span>`;
			card.querySelector('.mys-card-kind')!.textContent = KIND_NAME[d.kind];
			card.querySelector('.mys-card-label')!.textContent = d.label;
			card.querySelector('.mys-card-sub')!.textContent = d.sub;
			card.addEventListener('click', () => openDoc(d));
			deskGrid.append(card);
		});
	}

	function openDoc(d: PaperDoc) {
		deskScroll = win.body.scrollTop;
		if (!read.has(d.id)) {
			read.add(d.id);
			setData(READ_KEY, [...read]);
		}
		reader.innerHTML = `
			<div class="mys-reader-bar">
				<button type="button" class="secret-btn mys-back">← Back to the desk</button>
				<span class="secret-hint"></span>
			</div>
			<article class="mys-paper is-${d.kind}">${d.html}</article>`;
		reader.querySelector('.secret-hint')!.textContent = `${KIND_NAME[d.kind]} · ${d.sub}`;
		reader.querySelector('.mys-back')!.addEventListener('click', closeDoc);
		desk.hidden = true;
		reader.hidden = false;
		win.body.scrollTop = 0;
		reader.querySelector<HTMLElement>('.mys-back')!.focus({ preventScroll: true });
	}

	function closeDoc() {
		reader.hidden = true;
		reader.innerHTML = '';
		desk.hidden = false;
		renderDesk();
		win.body.scrollTop = deskScroll;
	}

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const data = new FormData(form);
		const who = String(data.get('who') ?? '');
		const what = String(data.get('what') ?? '');
		const where = String(data.get('where') ?? '');
		feedback.classList.remove('is-good', 'is-shake');
		if (!who || !what || !where) {
			feedback.textContent = 'An accusation needs all three: who, what and where.';
			return;
		}
		const right = Number(who === ANSWER.who) + Number(what === ANSWER.what) + Number(where === ANSWER.where);
		if (right === 3) {
			feedback.classList.add('is-good');
			feedback.textContent = already
				? 'Case closed, again. Constable Hobb tips his helmet. (You had already solved this one.)'
				: 'Case closed. Constable Hobb tips his helmet. A late edition has landed on your desk.';
			if (!solvedNow) {
				solvedNow = true;
				solve('skills');
			}
			renderDesk();
			setTimeout(() => {
				if (!reader.hidden || !desk.isConnected) return;
				openDoc(EPILOGUE);
			}, 1400);
			return;
		}
		chime('error');
		void feedback.offsetWidth;
		feedback.classList.add('is-shake');
		feedback.textContent =
			right === 2
				? 'Two of these are right. One thread is still loose.'
				: right === 1
					? 'One of these is right. Go back over the papers.'
					: 'None of these quite holds up. Try comparing the papers against each other.';
	});

	renderDesk();
}
