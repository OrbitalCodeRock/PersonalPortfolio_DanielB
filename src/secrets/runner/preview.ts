// Still pictures of runner segments, for the segment picker: a thumbnail of each chosen segment, and the
// whole planned run laid end to end. Drawn straight from the level geometry (no sim, no camera), in the
// game's colours, so what you see is the layout you'll run.
import { introSegment, recipeSegment, type Recipe, type Segment } from './levelgen';

/** The picture's window onto the world: x0 and yTop in metres at its top-left, and pixels per metre. */
interface View {
	x0: number;
	yTop: number;
	scale: number;
	w: number;
	h: number;
}

const hash = (a: number, b: number) => {
	let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** The intro roof plus the recipes, placed one after another the way a run lays them out. */
export function layoutRun(recipes: Recipe[]): Segment[] {
	const segs: Segment[] = [introSegment()];
	for (const r of recipes) {
		const prev = segs[segs.length - 1];
		segs.push(recipeSegment(r, prev.x1, prev.endY));
	}
	return segs;
}

/** Lowest roof and highest thing worth showing, in metres. */
function heightRange(segs: Segment[]): [number, number] {
	let lo = Infinity;
	let hi = -Infinity;
	const see = (y: number) => {
		lo = Math.min(lo, y);
		hi = Math.max(hi, y);
	};
	for (const s of segs) {
		for (const f of s.facades) see(f.top);
		for (const o of s.solids) if (o.kind !== 'roof') see(o.y + o.h);
		for (const o of s.slopes) {
			see(o.y0);
			see(o.y1);
		}
		for (const g of s.grapples) see(g.y);
		for (const d of s.drones) see(d.y + 0.5);
		for (const v of s.vents) see(v.y + v.h);
		for (const t of s.trains) see(t.top);
	}
	if (!Number.isFinite(lo)) [lo, hi] = [0, 0];
	// Room above for jumps and grapples, and a stretch of wall below the lowest roof.
	return [lo - 7, hi + 6];
}

function draw(ctx: CanvasRenderingContext2D, segs: Segment[], v: View, bounds?: { x0: number; x1: number }) {
	const X = (x: number) => (x - v.x0) * v.scale;
	const Y = (y: number) => (v.yTop - y) * v.scale;
	const m = (d: number) => d * v.scale;
	const bottom = v.h + 2;

	const sky = ctx.createLinearGradient(0, 0, 0, v.h);
	sky.addColorStop(0, '#070a1e');
	sky.addColorStop(0.6, '#1d1840');
	sky.addColorStop(1, '#43264e');
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, v.w, v.h);

	for (const s of segs) {
		// Buildings: wall down to the street, a pale roof edge, a few lit windows, and corridors cut through.
		for (const f of s.facades) {
			const x = X(f.x);
			const w = m(f.w);
			const top = Y(f.top);
			ctx.fillStyle = f.style % 2 ? '#2c2547' : '#272240';
			ctx.fillRect(x, top, w, bottom - top);
			ctx.fillStyle = 'rgba(255, 214, 150, 0.5)';
			const cell = 1.6;
			for (let r = 1; r < 12; r++)
				for (let c = 0; c < f.w / cell - 1; c++)
					if (hash(f.seed * 31 + c, r) < 0.12) ctx.fillRect(x + m(0.6 + c * cell), Y(f.top - r * 1.8), Math.max(1, m(0.5)), Math.max(1, m(0.6)));
			if (f.opening) {
				ctx.fillStyle = '#100d1c';
				ctx.fillRect(x, Y(f.opening.y1), w, m(f.opening.y1 - f.opening.y0));
				ctx.fillStyle = 'rgba(255, 220, 160, 0.45)';
				ctx.fillRect(x, Y(f.opening.y1), w, Math.max(1, m(0.15)));
			}
			ctx.fillStyle = '#8f86c0';
			ctx.fillRect(x, top, w, Math.max(1, m(0.22)));
		}
		// Slopes: the roof surface running down (or up) between two heights.
		for (const sl of s.slopes) {
			ctx.fillStyle = '#2c2547';
			ctx.beginPath();
			ctx.moveTo(X(sl.x0), Y(sl.y0));
			ctx.lineTo(X(sl.x1), Y(sl.y1));
			ctx.lineTo(X(sl.x1), bottom);
			ctx.lineTo(X(sl.x0), bottom);
			ctx.closePath();
			ctx.fill();
			ctx.strokeStyle = sl.boost ? '#7fe3ff' : '#8f86c0';
			ctx.lineWidth = Math.max(1.2, m(0.22));
			ctx.beginPath();
			ctx.moveTo(X(sl.x0), Y(sl.y0));
			ctx.lineTo(X(sl.x1), Y(sl.y1));
			ctx.stroke();
		}
		// Ledges, crates and decks stand out; ceilings and slabs are building (the roof over a corridor).
		for (const o of s.solids) {
			if (o.kind === 'roof') continue;
			const building = o.kind === 'ceiling' || o.kind === 'slab';
			ctx.fillStyle = building ? '#2c2547' : o.kind === 'crate' ? '#6b5a45' : '#56607d';
			ctx.fillRect(X(o.x), Y(o.y + o.h), m(o.w), m(o.h));
			ctx.fillStyle = building ? '#8f86c0' : '#a7adc8';
			ctx.fillRect(X(o.x), Y(o.y + o.h), m(o.w), Math.max(1, m(building ? 0.22 : 0.15)));
		}
		// Climbing walls.
		ctx.fillStyle = 'rgba(127, 227, 255, 0.55)';
		for (const wr of s.wallRuns) ctx.fillRect(X(wr.x), Y(wr.y + wr.h), Math.max(2, m(wr.w)), m(wr.h));
		// Hazards.
		ctx.fillStyle = '#ff6b5c';
		for (const hz of s.hazards) ctx.fillRect(X(hz.x), Y(hz.y + hz.h), m(hz.w), Math.max(2, m(hz.h)));
		// Air vents, with air rising off them.
		for (const vt of s.vents) {
			ctx.fillStyle = '#7fe3ff';
			ctx.fillRect(X(vt.x), Y(vt.y + vt.h), m(vt.w), Math.max(2, m(vt.h)));
			ctx.strokeStyle = 'rgba(127, 227, 255, 0.35)';
			ctx.lineWidth = 1;
			for (let i = 1; i < 4; i++) {
				const ax = X(vt.x + (vt.w * i) / 4);
				ctx.beginPath();
				ctx.moveTo(ax, Y(vt.y + vt.h + 0.4));
				ctx.lineTo(ax, Y(vt.y + vt.h + 5));
				ctx.stroke();
			}
		}
		// Rail viaducts with their train parked mid-span, and the signs beside the track.
		for (const t of s.trains) {
			const deck = t.top - 2.8;
			ctx.fillStyle = '#1a1730';
			ctx.fillRect(X(t.x0), Y(deck), m(t.x1 - t.x0), Math.max(2, m(0.5)));
			for (let px = t.x0 + 3; px < t.x1 - 1; px += 7) ctx.fillRect(X(px), Y(deck), Math.max(1, m(0.8)), bottom);
			const nose = Math.min(t.x1, t.startX + t.len);
			const rear = nose - t.len;
			ctx.fillStyle = '#c9cfdc';
			ctx.fillRect(X(Math.max(rear, t.x0)), Y(t.top), m(nose - Math.max(rear, t.x0)), m(2.6));
			ctx.fillStyle = '#e25c5c';
			ctx.fillRect(X(Math.max(rear, t.x0)), Y(t.top - 0.9), m(nose - Math.max(rear, t.x0)), Math.max(1, m(0.2)));
		}
		for (const z of s.signs) {
			ctx.fillStyle = '#e25c5c';
			ctx.fillRect(X(z.x), Y(z.y + z.h), Math.max(2, m(z.w)), Math.max(2, m(z.h)));
		}
		// Grapple points and drones.
		for (const g of s.grapples) {
			ctx.strokeStyle = '#7fe3ff';
			ctx.lineWidth = Math.max(1, m(0.15));
			ctx.beginPath();
			ctx.arc(X(g.x), Y(g.y), Math.max(2.5, m(0.45)), 0, Math.PI * 2);
			ctx.stroke();
		}
		for (const d of s.drones) {
			ctx.fillStyle = '#9fb0d0';
			ctx.fillRect(X(d.x - 0.9), Y(d.y + 0.45), Math.max(4, m(1.8)), Math.max(2, m(0.45)));
			ctx.strokeStyle = '#7d8aa8';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(X(d.x - 1.2), Y(d.y + 0.75));
			ctx.lineTo(X(d.x + 1.2), Y(d.y + 0.75));
			ctx.stroke();
		}
	}
	// Dim anything outside the segment(s) being shown (neighbouring roofs that overhang the edges).
	if (bounds) {
		ctx.fillStyle = 'rgba(7, 10, 30, 0.55)';
		ctx.fillRect(0, 0, Math.max(0, X(bounds.x0)), v.h);
		ctx.fillRect(X(bounds.x1), 0, v.w, v.h);
	}
}

const thumbs = new Map<Recipe, string>();

/** A small picture of one segment, as an image URL (cached per recipe). */
export function segmentThumb(recipe: Recipe, w = 200, h = 96): string {
	const hit = thumbs.get(recipe);
	if (hit) return hit;
	const seg = recipeSegment(recipe, 0, 0);
	const [lo, hi] = heightRange([seg]);
	const span = seg.x1 - seg.x0;
	const scale = Math.min(w / span, h / (hi - lo));
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	const c = document.createElement('canvas');
	c.width = Math.round(w * dpr);
	c.height = Math.round(h * dpr);
	const ctx = c.getContext('2d')!;
	ctx.scale(dpr, dpr);
	// Centred on the segment, with the lowest roof towards the bottom.
	const x0 = seg.x0 - (w / scale - span) / 2;
	const yTop = hi + (h / scale - (hi - lo)) * 0.35;
	draw(ctx, [seg], { x0, yTop, scale, w, h }, { x0: seg.x0, x1: seg.x1 });
	const url = c.toDataURL('image/png');
	thumbs.set(recipe, url);
	return url;
}

/**
 * The whole run drawn end to end into `root`: one canvas per segment at a shared scale and height, so
 * there's no giant canvas (phones cap their size), with each segment's name over it.
 */
export function renderRunStrip(root: HTMLElement, recipes: Recipe[], labels: string[]) {
	const segs = layoutRun(recipes);
	const [lo, hi] = heightRange(segs);
	const scale = Math.max(2.5, Math.min(6, 420 / (hi - lo)));
	const h = Math.ceil((hi - lo) * scale);
	const dpr = Math.min(2, window.devicePixelRatio || 1);
	root.innerHTML = '';
	segs.forEach((seg, i) => {
		const w = Math.ceil((seg.x1 - seg.x0) * scale);
		const fig = document.createElement('figure');
		fig.className = 'run-strip-seg';
		const c = document.createElement('canvas');
		c.width = Math.round(w * dpr);
		c.height = Math.round(h * dpr);
		c.style.width = `${w}px`;
		c.style.height = `${h}px`;
		const ctx = c.getContext('2d')!;
		ctx.scale(dpr, dpr);
		// Its neighbours too, for roofs that reach across the join.
		draw(ctx, segs.slice(Math.max(0, i - 1), i + 2), { x0: seg.x0, yTop: hi, scale, w, h });
		const cap = document.createElement('figcaption');
		cap.textContent = i === 0 ? 'start' : `${i}. ${labels[i - 1] ?? ''}`;
		fig.append(cap, c);
		root.append(fig);
	});
}
