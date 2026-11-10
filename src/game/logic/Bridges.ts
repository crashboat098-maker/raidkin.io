import type { Trail } from './Trails';
import type { Vec2 } from './Types';
/** Any fine grid of 'something to bridge over' (water or lava), with an optional deck mask. */
export interface BridgeGrid {
    cell: number;
    cols: number;
    rows: number;
    mask: Uint8Array;
    deck?: Uint8Array;
}

function isSurface (grid: BridgeGrid, x: number, y: number): boolean
{
    const c = Math.floor(x / grid.cell);
    const r = Math.floor(y / grid.cell);
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return false;
    return grid.mask[r * grid.cols + c] === 1;
}

/**
 * Where a trail or road crosses water, that stretch becomes a bridge:
 * wooden planks for dirt paths, stone for the old roads. Bridge decks are
 * dry land for the game rules (normal speed, no splashing); the water is
 * still drawn underneath.
 */

export interface Bridge {
    /** Wooden planks, old stone, or (over lava) wide dark basalt. */
    kind: 'wood' | 'stone' | 'basalt';
    /** Centre line, from bank to bank. */
    points: Vec2[];
    /** Full deck width (world px). */
    width: number;
    /**
     * True where a path only brushes the water's edge without crossing it:
     * no bridge is drawn (the path itself shows), but it is dry to walk on,
     * matching what you see.
     */
    edgeOnly?: boolean;
    /**
     * Lava bridges are squared-off structures: the deck's exact footprint
     * (also exactly the safe ground), which way it spans, and a look variant.
     */
    rect?: { x: number; y: number; width: number; height: number };
    axis?: 'ns' | 'ew';
    variant?: number;
}

/** Bridges reach this far onto dry land at each end (world px). */
const LANDING = 5;
/** Two wet stretches closer than this along a trail become one bridge. */
const MERGE_GAP = 12;
const STEP = 2;

export function findBridges (trails: readonly Trail[], water: BridgeGrid): Bridge[]
{
    const bridges: Bridge[] = [];

    for (const trail of trails)
    {
        if (trail.plaza) continue;
        const pts = densify(trail.points, STEP);
        const half = trail.width / 2;

        // A point is "wet" if water touches the path anywhere across its width.
        const wet = pts.map((p, i) => {
            const q = pts[Math.min(i + 1, pts.length - 1)];
            const o = pts[Math.max(i - 1, 0)];
            const dx = q.x - o.x;
            const dy = q.y - o.y;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            return isSurface(water, p.x, p.y) ||
                isSurface(water, p.x + nx * half, p.y + ny * half) ||
                isSurface(water, p.x - nx * half, p.y - ny * half);
        });

        // Group wet points into stretches (merging tiny dry gaps).
        const runs: [number, number][] = [];
        for (let i = 0; i < wet.length; i++)
        {
            if (!wet[i]) continue;
            let j = i;
            while (j + 1 < wet.length && wet[j + 1]) j++;
            const last = runs[runs.length - 1];
            if (last && (i - last[1]) * STEP <= MERGE_GAP) last[1] = j;
            else runs.push([i, j]);
            i = j;
        }

        for (const [from, to] of runs)
        {
            const a = Math.max(0, from - LANDING / STEP);
            const b = Math.min(pts.length - 1, to + LANDING / STEP);
            const points = thin(pts.slice(a, b + 1), 6);
            if (points.length < 2) continue;
            const crosses = pts.slice(from, to + 1).some((p) => isSurface(water, p.x, p.y));
            bridges.push({ kind: trail.kind === 'stone' ? 'stone' : 'wood', points, width: trail.width + 6, edgeOnly: !crosses || undefined });
        }
    }
    return bridges;
}

/** Mark bridge decks as dry in the water layout (the game rules then treat them as land). */
export function applyBridges (water: BridgeGrid, bridges: readonly Bridge[]): void
{
    const deck = water.deck ?? new Uint8Array(water.mask.length);
    for (const bridge of bridges)
    {
        const half = bridge.width / 2;
        for (let i = 0; i < bridge.points.length - 1; i++)
        {
            const a = bridge.points[i];
            const b = bridge.points[i + 1];
            const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - half) / water.cell));
            const c1 = Math.min(water.cols - 1, Math.ceil((Math.max(a.x, b.x) + half) / water.cell));
            const r0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - half) / water.cell));
            const r1 = Math.min(water.rows - 1, Math.ceil((Math.max(a.y, b.y) + half) / water.cell));
            for (let r = r0; r <= r1; r++)
            {
                for (let c = c0; c <= c1; c++)
                {
                    const x = c * water.cell + water.cell / 2;
                    const y = r * water.cell + water.cell / 2;
                    if (distanceToSegment(x, y, a, b) <= half) deck[r * water.cols + c] = 1;
                }
            }
        }
    }
    water.deck = deck;
}

/** Is (x, y) on a bridge deck? */
export function onBridge (water: BridgeGrid | null | undefined, x: number, y: number): boolean
{
    if (!water?.deck) return false;
    const c = Math.floor(x / water.cell);
    const r = Math.floor(y / water.cell);
    if (c < 0 || r < 0 || c >= water.cols || r >= water.rows) return false;
    return water.deck[r * water.cols + c] === 1;
}

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

/** Keep roughly one point every `spacing` px (always keeping both ends). */
function thin (points: readonly Vec2[], spacing: number): Vec2[]
{
    if (points.length <= 2) return points.slice();
    const out: Vec2[] = [points[0]];
    let last = points[0];
    for (let i = 1; i < points.length - 1; i++)
    {
        if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= spacing) { out.push(points[i]); last = points[i]; }
    }
    out.push(points[points.length - 1]);
    return out;
}

function distanceToSegment (px: number, py: number, a: Vec2, b: Vec2): number
{
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
    return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}
