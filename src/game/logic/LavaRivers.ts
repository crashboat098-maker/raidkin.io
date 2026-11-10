import { randRange, type Rng } from './Random';
import type { Bridge } from './Bridges';
import type { Rect, Vec2 } from './Types';

/**
 * Lava rivers of the volcanic wastes. Unlike lava pools (solid), rivers can
 * be crossed on foot, but every soldier standing in molten lava slowly
 * burns (see `World`). Wide stone bridges cross them safely.
 *
 * Pure data, like the water: a fine grid (2 px cells) says where lava is,
 * and `deck` marks bridge decks (safe). What you see is exactly what burns.
 */

export interface LavaRiver {
    points: Vec2[];
    width: number;
}

export interface LavaLayout {
    rivers: LavaRiver[];
    cell: number;
    cols: number;
    rows: number;
    /** 1 = molten lava. */
    mask: Uint8Array;
    /** 1 = covered by a bridge (safe to stand on). */
    deck?: Uint8Array;
}

export interface LavaRiverContext {
    worldWidth: number;
    worldHeight: number;
    playArea: Rect;
    /** Where the rivers start: around the volcano's foot. */
    source: Vec2;
    /** Which way is "out" toward the corner (unit-ish vector). */
    outward: Vec2;
    /** Areas rivers must not run through (buildings, villages, pools, water, the start). */
    avoid: readonly Rect[];
    isWet: (p: Vec2) => boolean;
    /** Only flow where this is true (the volcanic biome). */
    inBiome: (p: Vec2) => boolean;
    count: number;
}

const CELL = 2;

/** Is there molten lava (not a bridge) at (x, y)? */
export function isLava (lava: LavaLayout | null | undefined, x: number, y: number): boolean
{
    if (!lava) return false;
    const c = Math.floor(x / lava.cell);
    const r = Math.floor(y / lava.cell);
    if (c < 0 || r < 0 || c >= lava.cols || r >= lava.rows) return false;
    const i = r * lava.cols + c;
    return lava.mask[i] === 1 && !(lava.deck && lava.deck[i] === 1);
}

/** Lava at (x, y), bridged or not (for drawing and placement). */
export function isLavaSurface (lava: LavaLayout | null | undefined, x: number, y: number): boolean
{
    if (!lava) return false;
    const c = Math.floor(x / lava.cell);
    const r = Math.floor(y / lava.cell);
    if (c < 0 || r < 0 || c >= lava.cols || r >= lava.rows) return false;
    return lava.mask[r * lava.cols + c] === 1;
}

/**
 * Wind a few lava rivers from the volcano's foot out to the map edge,
 * steering clear of buildings, villages, water and the lava pools.
 */
export function generateLavaRivers (rng: Rng, ctx: LavaRiverContext): LavaLayout
{
    const cols = Math.ceil(ctx.worldWidth / CELL);
    const rows = Math.ceil(ctx.worldHeight / CELL);
    const mask = new Uint8Array(cols * rows);
    const rivers: LavaRiver[] = [];
    const baseAngle = Math.atan2(ctx.outward.y, ctx.outward.x);

    for (let attempt = 0; attempt < 400 && rivers.length < ctx.count; attempt++)
    {
        // Broad enough that the bridges clearly span something.
        const width = randRange(rng, 30, 36);
        // Fan the rivers out across the corner.
        const angle = baseAngle + randRange(rng, -1.5, 1.5);
        // Rising from just beyond the volcano's foot (clear of the cone itself).
        const start = { x: ctx.source.x + Math.cos(angle) * randRange(rng, 115, 150), y: ctx.source.y + Math.sin(angle) * randRange(rng, 95, 125) };
        const points = meander(rng, start, angle, ctx);
        if (!points) continue;
        // Keep rivers apart from each other.
        if (rivers.some((r) => r.points.some((p) => points.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 100)))) continue;
        rivers.push({ points, width });
        rasterize(points, width, mask, cols, rows);
    }
    return { rivers, cell: CELL, cols, rows, mask };
}

/** A winding course from `start` heading roughly along `angle`, until it leaves the biome or the map. */
function meander (rng: Rng, start: Vec2, angle: number, ctx: LavaRiverContext): Vec2[] | null
{
    const { playArea } = ctx;
    const points: Vec2[] = [start];
    let p = start;
    let heading = angle;
    const blocked = (q: Vec2) => ctx.isWet(q) || ctx.avoid.some((r) => q.x > r.x - 16 && q.x < r.x + r.width + 16 && q.y > r.y - 16 && q.y < r.y + r.height + 16);
    if (blocked(start)) return null;
    for (let step = 0; step < 140; step++)
    {
        // Wander, but look ahead: if the next step is blocked, try bending left or right around it.
        heading += randRange(rng, -0.35, 0.35);
        heading = angle + Math.max(-1.3, Math.min(1.3, heading - angle)); // keep flowing outward
        let next = { x: p.x + Math.cos(heading) * 22, y: p.y + Math.sin(heading) * 22 };
        for (const turn of [0.5, -0.5, 1.0, -1.0])
        {
            if (!blocked(next) && ctx.inBiome(next)) break;
            const h = angle + Math.max(-1.3, Math.min(1.3, heading + turn - angle));
            const alt = { x: p.x + Math.cos(h) * 22, y: p.y + Math.sin(h) * 22 };
            if (!blocked(alt) && ctx.inBiome(alt)) { heading = h; next = alt; break; }
        }
        p = next;
        const outside = p.x < playArea.x - 10 || p.y < playArea.y - 10 || p.x > playArea.x + playArea.width + 10 || p.y > playArea.y + playArea.height + 10;
        if (outside) { points.push(p); return points.length >= 8 ? points : null; }
        if (blocked(p) || !ctx.inBiome(p)) return null;
        points.push(p);
    }
    return null;
}

function rasterize (points: readonly Vec2[], width: number, mask: Uint8Array, cols: number, rows: number): void
{
    const half = width / 2;
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i];
        const b = points[i + 1];
        const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - half - 3) / CELL));
        const c1 = Math.min(cols - 1, Math.ceil((Math.max(a.x, b.x) + half + 3) / CELL));
        const r0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - half - 3) / CELL));
        const r1 = Math.min(rows - 1, Math.ceil((Math.max(a.y, b.y) + half + 3) / CELL));
        for (let r = r0; r <= r1; r++)
        {
            for (let c = c0; c <= c1; c++)
            {
                const x = c * CELL + 1;
                const y = r * CELL + 1;
                // A slightly irregular bank.
                const wobble = Math.sin(x * 0.13 + y * 0.07) * 0.9 + Math.sin(y * 0.11 - x * 0.05) * 0.7;
                if (segmentDistance(x, y, a, b) <= half + wobble) mask[r * cols + c] = 1;
            }
        }
    }
}

/**
 * Wide safe crossings spaced along each river (beyond the ones roads get):
 * a straight deck across the river at a point, `width` wide.
 */
export function wideCrossings (rng: Rng, lava: LavaLayout, existing: readonly Vec2[], spacing: number): { points: Vec2[]; width: number }[]
{
    const out: { points: Vec2[]; width: number }[] = [];
    const taken = [...existing];
    for (const river of lava.rivers)
    {
        const pts = river.points;
        for (let i = 3; i < pts.length - 3; i++)
        {
            const p = pts[i];
            if (taken.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < spacing)) continue;
            if (rng() < 0.35) continue;
            const a = pts[i - 1];
            const b = pts[i + 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const nx = -(b.y - a.y) / len;
            const ny = (b.x - a.x) / len;
            const reach = river.width / 2 + 14;
            // Wide enough for a large army (or several split clusters) to cross in formation.
            out.push({ points: [{ x: p.x - nx * reach, y: p.y - ny * reach }, { x: p.x + nx * reach, y: p.y + ny * reach }], width: 72 });
            taken.push(p);
        }
    }
    return out;
}

/** How far a bridge's deck runs onto solid ground at each end (world px). */
const BRIDGE_LANDING = 40;

/**
 * Plan stone bridges over the lava at the given crossing points. Each bridge
 * is squared to the map (spanning north-south or east-west, whichever crosses
 * the river more directly) and long enough to cover every bit of lava inside
 * its width, plus a landing on solid ground at each end. Its footprint is
 * exactly the safe deck.
 */
export function planLavaBridges (
    rng: Rng, lava: LavaLayout, sites: readonly Vec2[],
    ctx: {
        avoid: readonly Rect[]; isWet: (p: Vec2) => boolean; playArea: Rect;
        /** How slanted (radians) the river may run across the bridge. */
        maxSkew?: number;
        /** Also try spanning the other way if the natural direction doesn't fit (road crossings). */
        eitherWay?: boolean;
        /** Accept shorter ramps where full-length ones don't fit. */
        shortRampsOk?: boolean;
        /** Collects why sites were rejected (debugging). */
        why?: string[];
    },
): Bridge[]
{
    const out: Bridge[] = [];
    const lavaAt = (x: number, y: number) => isLavaSurface(lava, x, y);

    /** One attempt to bridge the river at `centre`, spanning along `axis`. */
    const attempt = (centre: Vec2, axis: 'ns' | 'ew', width: number, landing = BRIDGE_LANDING): Bridge | null => {
        // Walk outward along the span until no lava is left anywhere across the deck's width.
        const across = (t: number) => {
            for (let s = -width / 2; s <= width / 2; s += 2)
            {
                if (axis === 'ns' ? lavaAt(centre.x + s, centre.y + t) : lavaAt(centre.x + t, centre.y + s)) return true;
            }
            return false;
        };
        let lo = 0;
        let hi = 0;
        while (lo > -100 && across(lo - 2)) lo -= 2;
        while (hi < 100 && across(hi + 2)) hi += 2;
        if (hi - lo > MAX_LAVA_SPAN) { ctx.why?.push(`${axis}: too much lava along the span`); return null; }
        lo -= landing;
        hi += landing;
        const rect = axis === 'ns'
            ? { x: Math.round(centre.x - width / 2), y: Math.round(centre.y + lo), width, height: Math.round(hi - lo) }
            : { x: Math.round(centre.x + lo), y: Math.round(centre.y - width / 2), width: Math.round(hi - lo), height: width };
        // Both landings on dry, open ground inside the map.
        const ends = axis === 'ns'
            ? [{ x: centre.x, y: rect.y + 4 }, { x: centre.x, y: rect.y + rect.height - 4 }]
            : [{ x: rect.x + 4, y: centre.y }, { x: rect.x + rect.width - 4, y: centre.y }];
        if (ends.some((e) => lavaAt(e.x, e.y) || ctx.isWet(e))) { ctx.why?.push(`${axis}: an end lands in lava or water`); return null; }
        const inside = rect.x > ctx.playArea.x && rect.y > ctx.playArea.y + 8 && rect.x + rect.width < ctx.playArea.x + ctx.playArea.width && rect.y + rect.height < ctx.playArea.y + ctx.playArea.height;
        const hits = (r: Rect) => rect.x < r.x + r.width + 8 && rect.x + rect.width > r.x - 8 && rect.y < r.y + r.height + 8 && rect.y + rect.height > r.y - 8;
        if (!inside) { ctx.why?.push(`${axis}: outside the map`); return null; }
        const blocker = ctx.avoid.find(hits) ?? out.find((o) => hits(o.rect!))?.rect;
        if (blocker) { ctx.why?.push(`${axis}: hits ${JSON.stringify(blocker)}`); return null; }
        const points = axis === 'ns'
            ? [{ x: centre.x, y: rect.y }, { x: centre.x, y: rect.y + rect.height }]
            : [{ x: rect.x, y: centre.y }, { x: rect.x + rect.width, y: centre.y }];
        return { kind: 'basalt', points, width, rect, axis, variant: out.length % 4 };
    };

    for (const site of sites)
    {
        // The river's direction near this point.
        let best: { river: LavaRiver; i: number } | null = null;
        let bestD = Infinity;
        for (const river of lava.rivers) river.points.forEach((q, i) => { const d = Math.hypot(q.x - site.x, q.y - site.y); if (d < bestD) { bestD = d; best = { river, i }; } });
        if (!best || bestD > 30) { ctx.why?.push('far from river'); continue; }
        const { river, i } = best as { river: LavaRiver; i: number };
        const a = river.points[Math.max(0, i - 1)];
        const b = river.points[Math.min(river.points.length - 1, i + 1)];
        // Bridges look (and work) best where the river runs straight across them.
        if (riverSkew(a, b) > (ctx.maxSkew ?? 0.45)) { ctx.why?.push('skewed'); continue; }
        const natural: 'ns' | 'ew' = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'ns' : 'ew';
        const width = 2 * Math.round(randRange(rng, 28, 32)); // 56..64 px: room for big armies
        const centre = river.points[i];
        const other = natural === 'ns' ? 'ew' : 'ns';
        let bridge = attempt(centre, natural, width) ?? (ctx.shortRampsOk ? attempt(centre, natural, width, 24) : null);
        // Road crossings must get a bridge if at all possible: try shorter ramps, the other
        // direction, then the river a little up- or downstream.
        if (!bridge && ctx.eitherWay)
        {
            const tries: (() => Bridge | null)[] = [
                () => attempt(centre, natural, width, 18),
                () => attempt(centre, other, width),
                () => attempt(centre, other, width, 18),
                ...[-1, 1, -2, 2].map((k) => () => { const q = river.points[i + k]; return q ? attempt(q, natural, width, 18) : null; }),
            ];
            for (const t of tries) { bridge = t(); if (bridge) break; }
        }
        if (bridge) out.push(bridge);
    }
    return out;
}

/** The most lava a single bridge may span (beyond that, the river runs along it rather than across). */
const MAX_LAVA_SPAN = 104;

/** How far (radians) a river's direction from a to b is from running straight along an axis. */
export function riverSkew (a: Vec2, b: Vec2): number
{
    const angle = Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) % (Math.PI / 2);
    return Math.min(angle, Math.PI / 2 - angle);
}

/** Mark lava bridge decks safe: exactly their footprints. */
export function applyDeckRects (lava: LavaLayout, bridges: readonly Bridge[]): void
{
    const deck = lava.deck ?? new Uint8Array(lava.mask.length);
    for (const b of bridges)
    {
        const r = b.rect;
        if (!r) continue;
        const c0 = Math.max(0, Math.floor(r.x / lava.cell));
        const c1 = Math.min(lava.cols - 1, Math.floor((r.x + r.width - 1) / lava.cell));
        const r0 = Math.max(0, Math.floor(r.y / lava.cell));
        const r1 = Math.min(lava.rows - 1, Math.floor((r.y + r.height - 1) / lava.cell));
        for (let row = r0; row <= r1; row++) for (let c = c0; c <= c1; c++) deck[row * lava.cols + c] = 1;
    }
    lava.deck = deck;
}

function segmentDistance (px: number, py: number, a: Vec2, b: Vec2): number
{
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
    return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}
