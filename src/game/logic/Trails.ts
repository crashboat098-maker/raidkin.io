import { randInt, randRange, type Rng } from './Random';
import { rectContains, structureArea, type Structure } from './Structures';
import type { Rect, Vec2 } from './Types';

/**
 * Trails: worn dirt paths and old cobblestone roads linking the starting
 * point and the structures, so the battlefield feels lived-in.
 * Pure data (lists of points). Drawing happens in render/TrailView.ts.
 */

export type TrailKind = 'dirt' | 'stone';

export interface Trail {
    kind: TrailKind;
    /** Width in world pixels. */
    width: number;
    /** The centre line, a few dozen pixels between points. */
    points: Vec2[];
    /** An open village square (a dirt patch, not a road); things may stand on it, like the well. */
    plaza?: boolean;
}

/**
 * A single trail from `from` to `to` that steers around `avoid` rectangles
 * (used for little village lanes). Same routing as the main trail network.
 */
export function routeTrail (rng: Rng, from: Vec2, to: Vec2, kind: TrailKind, width: number, avoid: Rect[], playArea: Rect): Trail
{
    const trail = buildTrail(rng, from, to, kind, avoid, playArea);
    return { ...trail, width };
}

interface TrailNode {
    pos: Vec2;
    /** Keeps and the starting point get stone roads between them. */
    major: boolean;
}

const TRAIL_WIDTH: Record<TrailKind, number> = { dirt: 7, stone: 10 };
/** Trails steer around structures with this much room to spare. */
const STRUCTURE_AVOID_PADDING = 6;
/** How many trails wander off into the forest edge. */
const EXIT_TRAILS = 4;

export function generateTrails (rng: Rng, spawn: Vec2, structures: readonly Structure[], playArea: Rect, extraStops: readonly Vec2[] = []): Trail[]
{
    // Trails start/end just in front of each landmark (its "doorstep"), and at
    // extra stops such as village squares. Village houses get their own little
    // paths, but trails still steer around them.
    const nodes: TrailNode[] = [
        { pos: spawn, major: true },
        ...structures.filter((s) => s.type !== 'house').map((s) => ({ pos: { x: s.x, y: s.y + 10 }, major: s.type === 'keep' || s.type === 'castle' })),
        ...extraStops.map((pos) => ({ pos, major: false })),
    ];

    const edges = connectNodes(nodes);
    const obstacles = structures.map((s) => structureArea(s, STRUCTURE_AVOID_PADDING));

    const trails: Trail[] = edges.map(([a, b]) => {
        // Old stone roads lead out of keeps and the starting area; the rest are dirt.
        const kind: TrailKind = nodes[a].major || nodes[b].major ? 'stone' : 'dirt';
        return buildTrail(rng, nodes[a].pos, nodes[b].pos, kind, obstacles, playArea);
    });

    // A few trails leading off the map, as if to distant places.
    for (let i = 0; i < EXIT_TRAILS; i++)
    {
        const from = nodes[randInt(rng, 1, nodes.length - 1)].pos;
        trails.push(buildTrail(rng, from, nearestEdgePoint(from, playArea), 'dirt', obstacles, playArea));
    }

    return trails;
}

/**
 * Mark which map tiles a trail passes over (plus `padding` pixels either side),
 * so decorations can stay off the paths. Returns one byte per tile (1 = trail).
 */
export function trailTileMask (trails: readonly Trail[], cols: number, rows: number, tileSize: number, padding: number): Uint8Array
{
    const mask = new Uint8Array(cols * rows);

    for (const trail of trails)
    {
        const reach = trail.width / 2 + padding;
        forEachSample(trail.points, 4, (p) => {
            const c0 = Math.max(0, Math.floor((p.x - reach) / tileSize));
            const c1 = Math.min(cols - 1, Math.floor((p.x + reach) / tileSize));
            const r0 = Math.max(0, Math.floor((p.y - reach) / tileSize));
            const r1 = Math.min(rows - 1, Math.floor((p.y + reach) / tileSize));
            for (let r = r0; r <= r1; r++)
            {
                for (let c = c0; c <= c1; c++) mask[r * cols + c] = 1;
            }
        });
    }

    return mask;
}

/** Walk along a polyline, calling `fn` every `step` pixels. */
export function forEachSample (points: readonly Vec2[], step: number, fn: (p: Vec2) => void): void
{
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i];
        const b = points[i + 1];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const count = Math.max(1, Math.ceil(length / step));
        for (let s = 0; s < count; s++)
        {
            const t = s / count;
            fn({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
    }
    if (points.length > 0) fn(points[points.length - 1]);
}

// ---------------------------------------------------------------------------
// Building one trail
// ---------------------------------------------------------------------------

/**
 * Link every node with the shortest total length (a "minimum spanning tree"),
 * then add a second link from each major node for a few natural loops.
 */
function connectNodes (nodes: TrailNode[]): [number, number][]
{
    const dist = (a: number, b: number) => Math.hypot(nodes[a].pos.x - nodes[b].pos.x, nodes[a].pos.y - nodes[b].pos.y);
    const edges: [number, number][] = [];
    const connected = new Set<number>([0]);

    while (connected.size < nodes.length)
    {
        let best: [number, number] | null = null;
        let bestDistance = Infinity;
        for (const a of connected)
        {
            for (let b = 0; b < nodes.length; b++)
            {
                if (connected.has(b)) continue;
                const d = dist(a, b);
                if (d < bestDistance) { bestDistance = d; best = [a, b]; }
            }
        }
        if (!best) break;
        edges.push(best);
        connected.add(best[1]);
    }

    const hasEdge = (a: number, b: number) => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    nodes.forEach((node, a) => {
        if (!node.major) return;
        const others = nodes.map((_, b) => b).filter((b) => b !== a).sort((p, q) => dist(a, p) - dist(a, q));
        const second = others[1];
        if (second !== undefined && !hasEdge(a, second)) edges.push([a, second]);
    });

    return edges;
}

function buildTrail (rng: Rng, from: Vec2, to: Vec2, kind: TrailKind, obstacles: Rect[], playArea: Rect): Trail
{
    const waypoints = routeAround(from, to, obstacles, 4);
    let points: Vec2[] = [];

    // Winding can push a trail back into a building; if so, wind less.
    for (const windiness of [1, 0.5, 0])
    {
        points = [];
        for (let i = 0; i < waypoints.length - 1; i++)
        {
            const leg = wobble(rng, waypoints[i], waypoints[i + 1], playArea, windiness);
            points.push(...(i === 0 ? leg : leg.slice(1)));
        }

        let clear = true;
        forEachSample(points, 4, (p) => { if (clear && obstacles.some((rect) => rectContains(rect, p))) clear = false; });
        if (clear) break;
    }

    return { kind, width: TRAIL_WIDTH[kind], points };
}

/**
 * If the straight line from `a` to `b` cuts through a structure, insert a
 * detour via the structure's best corner. Repeats a few times for chains.
 */
function routeAround (a: Vec2, b: Vec2, obstacles: Rect[], depth: number): Vec2[]
{
    const blocker = obstacles.find((rect) => segmentHitsRect(a, b, rect));
    if (!blocker || depth === 0) return [a, b];

    const margin = 10;
    const corners: Vec2[] = [
        { x: blocker.x - margin, y: blocker.y - margin },
        { x: blocker.x + blocker.width + margin, y: blocker.y - margin },
        { x: blocker.x - margin, y: blocker.y + blocker.height + margin },
        { x: blocker.x + blocker.width + margin, y: blocker.y + blocker.height + margin },
    ];
    const length = (c: Vec2) => Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
    const isEndpoint = (c: Vec2) => (c.x === a.x && c.y === a.y) || (c.x === b.x && c.y === b.y);
    // Prefer corners we can reach without crossing the structure itself.
    const reachable = corners.filter((c) => !isEndpoint(c) && !segmentHitsRect(a, c, blocker));
    const options = reachable.length > 0 ? reachable : corners.filter((c) => !isEndpoint(c));
    const corner = options.sort((p, q) => length(p) - length(q))[0];

    const first = routeAround(a, corner, obstacles, depth - 1);
    const second = routeAround(corner, b, obstacles, depth - 1);
    return [...first, ...second.slice(1)];
}

/** Turn a straight leg into a gently winding one (ends stay fixed). */
function wobble (rng: Rng, a: Vec2, b: Vec2, playArea: Rect, windiness: number): Vec2[]
{
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(length / 20));
    const normalX = length > 0 ? -(b.y - a.y) / length : 0;
    const normalY = length > 0 ? (b.x - a.x) / length : 0;
    const amplitude = Math.min(26, length * 0.1) * randRange(rng, 0.5, 1) * windiness;
    const f1 = randRange(rng, 0.7, 1.6);
    const f2 = randRange(rng, 2, 3.5);
    const p1 = rng() * Math.PI * 2;
    const p2 = rng() * Math.PI * 2;

    const points: Vec2[] = [];
    for (let i = 0; i <= steps; i++)
    {
        const t = i / steps;
        const offset = amplitude * Math.sin(Math.PI * t) *
            (0.7 * Math.sin(Math.PI * 2 * f1 * t + p1) + 0.3 * Math.sin(Math.PI * 2 * f2 * t + p2));
        points.push({
            x: Math.round(clamp(a.x + (b.x - a.x) * t + normalX * offset, playArea.x, playArea.x + playArea.width)),
            y: Math.round(clamp(a.y + (b.y - a.y) * t + normalY * offset, playArea.y, playArea.y + playArea.height)),
        });
    }
    return points;
}

function segmentHitsRect (a: Vec2, b: Vec2, rect: Rect): boolean
{
    const samples = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
    for (let i = 1; i < samples; i++)
    {
        const t = i / samples;
        if (rectContains(rect, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return true;
    }
    return false;
}

function nearestEdgePoint (p: Vec2, area: Rect): Vec2
{
    const options: Vec2[] = [
        { x: area.x, y: p.y },
        { x: area.x + area.width, y: p.y },
        { x: p.x, y: area.y },
        { x: p.x, y: area.y + area.height },
    ];
    return options.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
}

function clamp (value: number, min: number, max: number): number
{
    return Math.max(min, Math.min(max, value));
}
