import { findFreeSpotNear, hasClearPath, hasDryPath, WARRIOR_BODY } from './Army';
import { bodyRect, type ObstacleMap } from './Obstacles';
import type { Rect, Vec2 } from './Types';

/**
 * Finding a way to where the player is pointing.
 *
 * The army's steering point used to walk in a straight line and slide along
 * whatever was in the way, so pointing across a river or behind a wall just
 * pinned the army against it. Now it plans a route: straight there when the
 * way is clear and dry, otherwise a path search on a coarse grid (around the
 * wall, along the bank to a bridge). Water and lava stay walkable, they just
 * cost more, so a nearby bridge wins but a far one doesn't. If the spot can't
 * be reached at all, the route ends at
 * the closest reachable point and the army waits there instead of grinding
 * into the obstacle.
 */

/** Steering input. `reach` = how far away the target is (world px); without it, the army keeps going. */
export interface SteerInput extends Vec2 {
    reach?: number;
}

/** How far ahead to aim when steering by direction only (keys, joystick, bots). */
const LOOKAHEAD = 360;
/** Targets further than this are treated as this far (keeps path searches small). */
const MAX_REACH = 700;
/** Re-plan this often, or straight away when the steering direction turns a lot. */
const REPLAN_MS = 300;
const REPLAN_TURN_DOT = 0.94; // ~20 degrees
/** Close enough to a waypoint to move on to the next one. */
const WAYPOINT_REACHED = 10;

/** Path search grid cell (world px), how far around the start/goal it may look, and work limits. */
const CELL = 12;
const MARGIN = 320;
const MAX_CELLS = 40_000;
const MAX_EXPANSIONS = 7_000;

export interface Navigator {
    /** Waypoints toward the goal (empty = walk straight). */
    path: Vec2[];
    index: number;
    /** The route ends short of the goal (it can't be reached): stop at the end instead of pushing on. */
    partial: boolean;
    nextPlanAt: number;
    lastDir: Vec2;
}

export function createNavigator (): Navigator
{
    return { path: [], index: 0, partial: false, nextPlanAt: 0, lastDir: { x: 0, y: 0 } };
}

/**
 * Turn the player's steering into a direction that walks a route around
 * obstacles. Same strength as the input; only the direction changes.
 */
export function steerAround (nav: Navigator, from: Vec2, input: SteerInput, now: number, obstacles: ObstacleMap, bounds: Rect): Vec2
{
    const strength = Math.min(1, Math.hypot(input.x, input.y));
    if (strength < 0.01)
    {
        nav.path = [];
        nav.partial = false;
        return { x: 0, y: 0 };
    }
    const length = Math.hypot(input.x, input.y);
    const dir = { x: input.x / length, y: input.y / length };
    const reach = Math.min(MAX_REACH, input.reach ?? LOOKAHEAD);

    const turned = dir.x * nav.lastDir.x + dir.y * nav.lastDir.y < REPLAN_TURN_DOT;
    if (now >= nav.nextPlanAt || turned)
    {
        const goal = clampTo(bounds, { x: from.x + dir.x * reach, y: from.y + dir.y * reach });
        plan(nav, from, goal, obstacles, bounds);
        nav.lastDir = dir;
        nav.nextPlanAt = now + REPLAN_MS;
    }

    if (nav.path.length === 0) return { x: dir.x * strength, y: dir.y * strength };

    // Move on past waypoints we've reached, or can already see past.
    while (nav.index < nav.path.length && distance(from, nav.path[nav.index]) < WAYPOINT_REACHED) nav.index++;
    if (nav.index + 1 < nav.path.length && hasDryPath(obstacles, from, nav.path[nav.index + 1])) nav.index++;

    const point = nav.path[nav.index];
    if (!point)
    {
        // At the end of the route. Partial: as close as it gets, so wait here.
        if (nav.partial) return { x: 0, y: 0 };
        return { x: dir.x * strength, y: dir.y * strength };
    }
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: (dx / d) * strength, y: (dy / d) * strength };
}

function plan (nav: Navigator, from: Vec2, goal: Vec2, obstacles: ObstacleMap, bounds: Rect): void
{
    nav.index = 0;
    nav.partial = false;
    if (hasDryPath(obstacles, from, goal))
    {
        nav.path = [];
        return;
    }
    const found = findPath(obstacles, bounds, from, goal);
    if (!found)
    {
        // No search possible (e.g. boxed in): fall back to sliding along.
        nav.path = [];
        return;
    }
    nav.path = found.points;
    nav.partial = !found.complete;
}

export interface FoundPath {
    points: Vec2[];
    /** False when the goal can't be reached and the path ends at the closest point that can. */
    complete: boolean;
}

/**
 * A* on a coarse grid between two points, limited to a window around them.
 * Returns corner waypoints (the first one walkable straight from `from`), or
 * null if nothing better than standing still was found.
 */
export function findPath (obstacles: ObstacleMap, bounds: Rect, from: Vec2, to: Vec2): FoundPath | null
{
    // Aim at a free spot: a goal inside a tree or a river would never be reached.
    const goalPoint = findFreeSpotNear(obstacles, bounds, to, WARRIOR_BODY, 48) ?? to;

    const minX = Math.max(bounds.x, Math.min(from.x, goalPoint.x) - MARGIN);
    const minY = Math.max(bounds.y, Math.min(from.y, goalPoint.y) - MARGIN);
    const maxX = Math.min(bounds.x + bounds.width, Math.max(from.x, goalPoint.x) + MARGIN);
    const maxY = Math.min(bounds.y + bounds.height, Math.max(from.y, goalPoint.y) + MARGIN);
    const cols = Math.floor((maxX - minX) / CELL) + 1;
    const rows = Math.floor((maxY - minY) / CELL) + 1;
    if (cols <= 0 || rows <= 0 || cols * rows > MAX_CELLS) return null;

    const px = (c: number) => minX + c * CELL;
    const py = (r: number) => minY + r * CELL;
    const cellCol = (x: number) => Math.max(0, Math.min(cols - 1, Math.round((x - minX) / CELL)));
    const cellRow = (y: number) => Math.max(0, Math.min(rows - 1, Math.round((y - minY) / CELL)));

    // 0 = unknown, 1 = free, 2 = blocked (checked only where the search goes).
    const state = new Uint8Array(cols * rows);
    const free = (c: number, r: number): boolean => {
        const i = r * cols + c;
        if (state[i] === 0) state[i] = obstacles.overlaps(bodyRect(px(c), py(r), WARRIOR_BODY)) ? 2 : 1;
        return state[i] === 1;
    };

    const sc = cellCol(from.x);
    const sr = cellRow(from.y);
    const gc = cellCol(goalPoint.x);
    const gr = cellRow(goalPoint.y);
    const start = sr * cols + sc;
    const goal = gr * cols + gc;

    const heuristic = (c: number, r: number) => {
        const dx = Math.abs(c - gc);
        const dy = Math.abs(r - gr);
        return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy));
    };

    const cost = new Float32Array(cols * rows).fill(Infinity);
    const came = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    const heap = new MinHeap();
    cost[start] = 0;
    came[start] = start;
    heap.push(start, heuristic(sc, sr));

    let best = start;
    let bestH = heuristic(sc, sr);
    let found = false;
    let expansions = 0;

    while (heap.size > 0 && expansions < MAX_EXPANSIONS)
    {
        const index = heap.pop();
        if (closed[index]) continue;
        closed[index] = 1;
        expansions++;
        const c = index % cols;
        const r = (index - c) / cols;
        const h = heuristic(c, r);
        if (h < bestH) { bestH = h; best = index; }
        if (index === goal) { found = true; break; }

        for (let dr = -1; dr <= 1; dr++)
        {
            for (let dc = -1; dc <= 1; dc++)
            {
                if (dc === 0 && dr === 0) continue;
                const nc = c + dc;
                const nr = r + dr;
                if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
                const n = nr * cols + nc;
                if (closed[n] || !free(nc, nr)) continue;
                // No cutting corners past an obstacle.
                if (dc !== 0 && dr !== 0 && (!free(c + dc, r) || !free(c, r + dr))) continue;
                const step = (dc !== 0 && dr !== 0 ? 1.414 : 1) * obstacles.travelCost(px(nc), py(nr));
                const next = cost[index] + step;
                if (next >= cost[n]) continue;
                cost[n] = next;
                came[n] = index;
                heap.push(n, next + heuristic(nc, nr));
            }
        }
    }

    const end = found ? goal : best;
    if (end === start) return null;

    // Walk back from the end, then keep only the corners actually needed.
    const cells: Vec2[] = [];
    for (let i = end; i !== start; i = came[i]) cells.push({ x: px(i % cols), y: py(Math.floor(i / cols)) });
    cells.reverse();
    if (found) cells[cells.length - 1] = { ...goalPoint };

    // A shortcut may not cross worse ground than the cells it skips (no
    // cutting across the river when the route goes over the bridge).
    const points: Vec2[] = [];
    let anchor = from;
    let spanCost = obstacles.travelCost(from.x, from.y);
    for (let i = 0; i < cells.length; i++)
    {
        spanCost = Math.max(spanCost, obstacles.travelCost(cells[i].x, cells[i].y));
        const next = cells[i + 1];
        const nextSpan = next ? Math.max(spanCost, obstacles.travelCost(next.x, next.y)) : spanCost;
        if (!next || !hasClearPath(obstacles, anchor, next) || worstCostAlong(obstacles, anchor, next) > nextSpan)
        {
            points.push(cells[i]);
            anchor = cells[i];
            spanCost = obstacles.travelCost(anchor.x, anchor.y);
        }
    }
    return { points, complete: found };
}

/** The highest travel cost met walking straight from a to b. */
function worstCostAlong (obstacles: ObstacleMap, a: Vec2, b: Vec2): number
{
    const steps = Math.max(1, Math.ceil(distance(a, b) / 4));
    let worst = 1;
    for (let i = 0; i <= steps; i++)
    {
        const t = i / steps;
        worst = Math.max(worst, obstacles.travelCost(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
    return worst;
}

/** A small binary min-heap of grid indices keyed by priority. */
class MinHeap
{
    private readonly items: number[] = [];
    private readonly keys: number[] = [];

    get size (): number { return this.items.length; }

    push (item: number, key: number): void
    {
        const items = this.items;
        const keys = this.keys;
        let i = items.length;
        items.push(item);
        keys.push(key);
        while (i > 0)
        {
            const parent = (i - 1) >> 1;
            if (keys[parent] <= key) break;
            items[i] = items[parent];
            keys[i] = keys[parent];
            i = parent;
        }
        items[i] = item;
        keys[i] = key;
    }

    pop (): number
    {
        const items = this.items;
        const keys = this.keys;
        const top = items[0];
        const lastItem = items.pop()!;
        const lastKey = keys.pop()!;
        if (items.length === 0) return top;
        let i = 0;
        const n = items.length;
        while (true)
        {
            let child = 2 * i + 1;
            if (child >= n) break;
            if (child + 1 < n && keys[child + 1] < keys[child]) child++;
            if (keys[child] >= lastKey) break;
            items[i] = items[child];
            keys[i] = keys[child];
            i = child;
        }
        items[i] = lastItem;
        keys[i] = lastKey;
        return top;
    }
}

function clampTo (bounds: Rect, p: Vec2): Vec2
{
    return {
        x: Math.max(bounds.x, Math.min(bounds.x + bounds.width, p.x)),
        y: Math.max(bounds.y, Math.min(bounds.y + bounds.height, p.y)),
    };
}

function distance (a: Vec2, b: Vec2): number
{
    return Math.hypot(a.x - b.x, a.y - b.y);
}
