import { randInt, randRange, type Rng } from './Random';
import type { Rect, Vec2 } from './Types';

/**
 * Rivers, streams and ponds. All water is shallow: everyone can wade through
 * it, just more slowly. Pure data:
 *  - `bodies` describe the shapes (for drawing and debugging),
 *  - `mask` is a fine grid (2 world px per cell) saying where water is.
 * Gameplay and rendering both read the same mask, so what you see is
 * exactly what slows you down.
 */

export type WaterKind = 'river' | 'stream' | 'pond';

export interface WaterBody {
    kind: WaterKind;
    /** Centre line (a pond is a single point). */
    points: Vec2[];
    /** Full width of a river/stream, or the diameter of a pond. */
    width: number;
}

export interface WaterLayout {
    bodies: WaterBody[];
    /** World px per mask cell. */
    cell: number;
    cols: number;
    rows: number;
    /** 1 = water. Index: row * cols + col. */
    mask: Uint8Array;
    /** 1 = covered by a bridge deck (dry to walk on, though water is drawn underneath). */
    deck?: Uint8Array;
}

export interface WaterSettings {
    rivers: number;
    streams: number;
    ponds: number;
}

interface WaterContext {
    worldWidth: number;
    worldHeight: number;
    playArea: Rect;
    spawn: Vec2;
    /** Areas water must keep clear of (structures, villages...). */
    avoid: readonly Rect[];
}

const CELL = 2;
const SPAWN_CLEARANCE = 170;
/** Extra clearance between water and the things it avoids (world px). */
const AVOID_MARGIN = 14;

/** Is (x, y) wadeable water (not on a bridge)? This is what slows you down. */
export function isWater (water: WaterLayout | null | undefined, x: number, y: number): boolean
{
    if (!water) return false;
    const c = Math.floor(x / water.cell);
    const r = Math.floor(y / water.cell);
    if (c < 0 || r < 0 || c >= water.cols || r >= water.rows) return false;
    const i = r * water.cols + c;
    return water.mask[i] === 1 && !(water.deck && water.deck[i] === 1);
}

/** Is there water at (x, y), bridges or not? (For drawing and shoreline art.) */
export function isWaterSurface (water: WaterLayout | null | undefined, x: number, y: number): boolean
{
    if (!water) return false;
    const c = Math.floor(x / water.cell);
    const r = Math.floor(y / water.cell);
    if (c < 0 || r < 0 || c >= water.cols || r >= water.rows) return false;
    return water.mask[r * water.cols + c] === 1;
}

export function generateWater (rng: Rng, settings: WaterSettings, ctx: WaterContext): WaterLayout
{
    const bodies: WaterBody[] = [];
    const cols = Math.ceil(ctx.worldWidth / CELL);
    const rows = Math.ceil(ctx.worldHeight / CELL);

    /** Is this shape clear of everything it must avoid? */
    const clear = (points: Vec2[], halfWidth: number) => points.every((p) =>
        Math.hypot(p.x - ctx.spawn.x, p.y - ctx.spawn.y) > SPAWN_CLEARANCE + halfWidth &&
        ctx.avoid.every((r) => !(p.x > r.x - halfWidth - AVOID_MARGIN && p.x < r.x + r.width + halfWidth + AVOID_MARGIN &&
                                 p.y > r.y - halfWidth - AVOID_MARGIN && p.y < r.y + r.height + halfWidth + AVOID_MARGIN)));

    // Rivers: cross the whole map from one side to the other, winding, and
    // bending around structures, villages and the start instead of through them.
    const spawnBox: Rect = { x: ctx.spawn.x - SPAWN_CLEARANCE, y: ctx.spawn.y - SPAWN_CLEARANCE, width: SPAWN_CLEARANCE * 2, height: SPAWN_CLEARANCE * 2 };
    for (let i = 0; i < settings.rivers; i++)
    {
        for (let attempt = 0; attempt < 200; attempt++)
        {
            const width = randRange(rng, 18, 26);
            const horizontal = (i + attempt) % 2 === 0;
            const line = densify(windingLine(rng, ctx.playArea, horizontal ? 'horizontal' : 'vertical', 110, 150), 16);
            const points = bendAround(line, [...ctx.avoid, spawnBox], width / 2 + AVOID_MARGIN + 4, horizontal, ctx.playArea);
            if (!clear(densify(points, 6), width / 2)) continue;
            bodies.push({ kind: 'river', points, width });
            break;
        }
    }

    // Streams: shorter and narrower, flowing toward the nearest river (or wandering).
    const rivers = bodies.filter((b) => b.kind === 'river');
    for (let i = 0; i < settings.streams; i++)
    {
        for (let attempt = 0; attempt < 60; attempt++)
        {
            const width = randRange(rng, 8, 11);
            const start = randomPoint(rng, ctx.playArea, 60);
            const goal = nearestOn(rivers, start) ?? randomPoint(rng, ctx.playArea, 60);
            const length = Math.hypot(goal.x - start.x, goal.y - start.y);
            if (length < 180 || length > 520) continue;
            const points = wobble(rng, start, goal, 28);
            // The last stretch joins the river; only check the part before it.
            if (!clear(densify(points.slice(0, -1), 6), width / 2)) continue;
            bodies.push({ kind: 'stream', points, width });
            break;
        }
    }

    // Ponds: small, roundish.
    for (let i = 0; i < settings.ponds; i++)
    {
        for (let attempt = 0; attempt < 60; attempt++)
        {
            const diameter = randRange(rng, 34, 62);
            const centre = randomPoint(rng, ctx.playArea, 80);
            const ring = Array.from({ length: 12 }, (_, k) => ({
                x: centre.x + Math.cos((k / 12) * Math.PI * 2) * diameter / 2,
                y: centre.y + Math.sin((k / 12) * Math.PI * 2) * diameter / 2,
            }));
            if (!clear([centre, ...ring], 4)) continue;
            bodies.push({ kind: 'pond', points: [centre], width: diameter });
            break;
        }
    }

    const mask = new Uint8Array(cols * rows);
    for (const body of bodies) rasterize(body, mask, cols, rows, rng);
    return { bodies, cell: CELL, cols, rows, mask };
}

// ---------------------------------------------------------------------------
// Expanded maps
// ---------------------------------------------------------------------------

/**
 * Move a water layout into a bigger world, `offset` world px right and down
 * (the original map's water, unchanged, now sitting in the middle).
 */
export function shiftWater (water: WaterLayout, offset: number, worldWidth: number, worldHeight: number): WaterLayout
{
    const cols = Math.ceil(worldWidth / CELL);
    const rows = Math.ceil(worldHeight / CELL);
    const shift = Math.round(offset / CELL);
    const mask = new Uint8Array(cols * rows);
    for (let r = 0; r < water.rows; r++)
    {
        for (let c = 0; c < water.cols; c++)
        {
            if (water.mask[r * water.cols + c]) mask[(r + shift) * cols + (c + shift)] = 1;
        }
    }
    const bodies = water.bodies.map((b) => ({ ...b, points: b.points.map((p) => ({ x: p.x + offset, y: p.y + offset })) }));
    return { bodies, cell: CELL, cols, rows, mask };
}

/**
 * Rivers used to run off the edge of the original map. In the bigger world
 * they carry on, winding gently, out to the new map edge.
 * Returns the new stretches (as points) that were added.
 */
export function extendRivers (water: WaterLayout, rng: Rng, core: Rect, playArea: Rect): Vec2[][]
{
    const added: Vec2[][] = [];
    for (const body of water.bodies)
    {
        if (body.kind !== 'river') continue;
        for (const atStart of [true, false])
        {
            const end = atStart ? body.points[0] : body.points[body.points.length - 1];
            // Which edge of the original map this end runs off.
            const gaps = [
                { d: Math.abs(end.x - core.x), dir: { x: -1, y: 0 } },
                { d: Math.abs(core.x + core.width - end.x), dir: { x: 1, y: 0 } },
                { d: Math.abs(end.y - core.y), dir: { x: 0, y: -1 } },
                { d: Math.abs(core.y + core.height - end.y), dir: { x: 0, y: 1 } },
            ].sort((a, b) => a.d - b.d);
            const { dir } = gaps[0];
            if (gaps[0].d > 60) continue;
            // Out to just past the new map edge.
            const target = {
                x: dir.x === 0 ? end.x : dir.x < 0 ? playArea.x - 24 : playArea.x + playArea.width + 24,
                y: dir.y === 0 ? end.y : dir.y < 0 ? playArea.y - 24 : playArea.y + playArea.height + 24,
            };
            const stretch = wobble(rng, end, target, 36);
            added.push(stretch);
            if (atStart) body.points = [...stretch.slice(1).reverse(), ...body.points];
            else body.points = [...body.points, ...stretch.slice(1)];
            rasterize({ kind: 'river', points: stretch, width: body.width }, water.mask, water.cols, water.rows, rng);
        }
    }
    return added;
}

/** Add one more body (a swamp pool or waterway) to an existing layout. */
export function addWaterBody (water: WaterLayout, body: WaterBody, rng: Rng): void
{
    water.bodies.push(body);
    rasterize(body, water.mask, water.cols, water.rows, rng);
}

/** A gently winding line across the play area. */
function windingLine (rng: Rng, area: Rect, direction: 'horizontal' | 'vertical', stepSize: number, amplitude: number): Vec2[]
{
    const horizontal = direction === 'horizontal';
    const length = horizontal ? area.width : area.height;
    const across = horizontal ? area.height : area.width;
    const base = randRange(rng, across * 0.2, across * 0.8);
    const f1 = randRange(rng, 0.6, 1.4);
    const f2 = randRange(rng, 1.6, 2.8);
    const p1 = rng() * Math.PI * 2;
    const p2 = rng() * Math.PI * 2;
    const points: Vec2[] = [];
    const steps = Math.ceil(length / stepSize);
    for (let s = 0; s <= steps; s++)
    {
        const t = s / steps;
        const offset = amplitude * (0.7 * Math.sin(Math.PI * 2 * f1 * t + p1) + 0.3 * Math.sin(Math.PI * 2 * f2 * t + p2));
        const along = (horizontal ? area.x : area.y) - 20 + t * (length + 40);
        const side = Math.max(30, Math.min(across - 30, base + offset)) + (horizontal ? area.y : area.x);
        points.push(horizontal ? { x: along, y: side } : { x: side, y: along });
    }
    return points;
}

/**
 * Push a river's points sideways (across its direction of flow) out of any
 * area it must avoid, then smooth the result so the bends look natural.
 * Repeats a few times because one push can land in a neighbouring area.
 */
function bendAround (points: Vec2[], avoid: readonly Rect[], clearance: number, horizontal: boolean, area: Rect): Vec2[]
{
    let pts = points.map((p) => ({ ...p }));
    for (let pass = 0; pass < 6; pass++)
    {
        let moved = false;
        for (const p of pts)
        {
            for (const r of avoid)
            {
                const x0 = r.x - clearance;
                const x1 = r.x + r.width + clearance;
                const y0 = r.y - clearance;
                const y1 = r.y + r.height + clearance;
                if (p.x <= x0 || p.x >= x1 || p.y <= y0 || p.y >= y1) continue;
                moved = true;
                if (horizontal)
                {
                    const up = y0 - 1;
                    const down = y1 + 1;
                    p.y = (Math.abs(p.y - up) < Math.abs(p.y - down) && up > area.y + 20) || down > area.y + area.height - 20 ? up : down;
                }
                else
                {
                    const left = x0 - 1;
                    const right = x1 + 1;
                    p.x = (Math.abs(p.x - left) < Math.abs(p.x - right) && left > area.x + 20) || right > area.x + area.width - 20 ? left : right;
                }
            }
        }
        // Smooth, keeping the ends in place.
        pts = pts.map((p, i) => (i === 0 || i === pts.length - 1) ? p : {
            x: horizontal ? p.x : (pts[i - 1].x + p.x * 2 + pts[i + 1].x) / 4,
            y: horizontal ? (pts[i - 1].y + p.y * 2 + pts[i + 1].y) / 4 : p.y,
        });
        if (!moved) break;
    }
    return pts;
}

function wobble (rng: Rng, a: Vec2, b: Vec2, amplitude: number): Vec2[]
{
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / length;
    const ny = (b.x - a.x) / length;
    const steps = Math.max(3, Math.ceil(length / 50));
    const phase = rng() * Math.PI * 2;
    const points: Vec2[] = [];
    for (let s = 0; s <= steps; s++)
    {
        const t = s / steps;
        const off = amplitude * Math.sin(Math.PI * t) * Math.sin(Math.PI * 2 * 1.3 * t + phase);
        points.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
    }
    return points;
}

/** Points every `step` px along a polyline. */
function densify (points: readonly Vec2[], step: number): Vec2[]
{
    const out: Vec2[] = [];
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i];
        const b = points[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
        for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * (k / n), y: a.y + (b.y - a.y) * (k / n) });
    }
    if (points.length) out.push(points[points.length - 1]);
    return out;
}

function nearestOn (bodies: readonly WaterBody[], p: Vec2): Vec2 | null
{
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const body of bodies)
    {
        for (const q of densify(body.points, 20))
        {
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d < bestD) { bestD = d; best = q; }
        }
    }
    return best;
}

function randomPoint (rng: Rng, area: Rect, margin: number): Vec2
{
    return { x: randRange(rng, area.x + margin, area.x + area.width - margin), y: randRange(rng, area.y + margin, area.y + area.height - margin) };
}

/** Mark the mask cells a body covers, with a slightly irregular, natural edge. */
function rasterize (body: WaterBody, mask: Uint8Array, cols: number, rows: number, rng: Rng): void
{
    const seed = randInt(rng, 0, 10_000);
    const edge = (x: number, y: number) => {
        // Small deterministic wobble so banks aren't perfectly smooth.
        const n = Math.sin(x * 0.11 + seed) * 0.6 + Math.sin(y * 0.13 + seed * 0.7) * 0.6 + Math.sin((x + y) * 0.05 + seed * 1.3) * 0.8;
        return n; // about -2..2 world px
    };

    if (body.kind === 'pond')
    {
        const c = body.points[0];
        const r = body.width / 2;
        fillBox(c.x - r - 4, c.y - r - 4, c.x + r + 4, c.y + r + 4, mask, cols, rows, (x, y) => {
            const angle = Math.atan2(y - c.y, x - c.x);
            const radius = r * (1 + 0.12 * Math.sin(3 * angle + seed) + 0.07 * Math.sin(5 * angle + seed * 2));
            return Math.hypot((x - c.x), (y - c.y) * 1.15) <= radius + edge(x, y);
        });
        return;
    }

    const half = body.width / 2;
    const pts = densify(body.points, 6);
    for (let i = 0; i < pts.length - 1; i++)
    {
        const a = pts[i];
        const b = pts[i + 1];
        fillBox(Math.min(a.x, b.x) - half - 3, Math.min(a.y, b.y) - half - 3, Math.max(a.x, b.x) + half + 3, Math.max(a.y, b.y) + half + 3, mask, cols, rows,
            (x, y) => distanceToSegment(x, y, a, b) <= half + edge(x, y));
    }
}

function fillBox (x0: number, y0: number, x1: number, y1: number, mask: Uint8Array, cols: number, rows: number, inside: (x: number, y: number) => boolean): void
{
    const c0 = Math.max(0, Math.floor(x0 / CELL));
    const c1 = Math.min(cols - 1, Math.ceil(x1 / CELL));
    const r0 = Math.max(0, Math.floor(y0 / CELL));
    const r1 = Math.min(rows - 1, Math.ceil(y1 / CELL));
    for (let r = r0; r <= r1; r++)
    {
        for (let c = c0; c <= c1; c++)
        {
            const i = r * cols + c;
            if (mask[i]) continue;
            if (inside(c * CELL + CELL / 2, r * CELL + CELL / 2)) mask[i] = 1;
        }
    }
}

function distanceToSegment (px: number, py: number, a: Vec2, b: Vec2): number
{
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
    return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}
