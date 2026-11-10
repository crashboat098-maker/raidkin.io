import type { Rect, Vec2 } from './Types';
import { isWater, type WaterLayout } from './Water';

/**
 * Solid things that block movement (walls, tree trunks, boulders...).
 *
 * Each obstacle is a rectangle on the ground. They're sorted into a coarse
 * grid of "buckets", so a moving body only checks the few obstacles near it
 * instead of all of them. That keeps collision cheap with many players.
 */

/** The solid part of a moving body: a box around its feet. */
export interface Body {
    halfWidth: number;
    /** How far the box extends up (north) from the feet. */
    height: number;
}

export interface MoveResult {
    x: number;
    y: number;
    blockedX: boolean;
    blockedY: boolean;
}

const CELL_SIZE = 64;
/** Tiny gap left between a body and a wall after being pushed out. */
const EPSILON = 0.01;

export class ObstacleMap
{
    private readonly cells = new Map<number, Rect[]>();

    /**
     * @param water Optional shallow water: walkable, but anything standing in it
     *   moves at `waterSlowdown` of its normal speed.
     */
    constructor (readonly obstacles: readonly Rect[], readonly water: WaterLayout | null = null, readonly waterSlowdown = 1)
    {
        for (const rect of obstacles)
        {
            this.forEachCell(rect, (key) => {
                const bucket = this.cells.get(key);
                if (bucket) bucket.push(rect);
                else this.cells.set(key, [rect]);
            });
        }
    }

    /** Speed multiplier for something standing at (x, y): slower in water, normal elsewhere. */
    speedFactorAt (x: number, y: number): number
    {
        return this.water && isWater(this.water, x, y) ? this.waterSlowdown : 1;
    }

    /** Is (x, y) in water? */
    inWater (x: number, y: number): boolean
    {
        return isWater(this.water, x, y);
    }

    /** True if `rect` overlaps any obstacle. */
    overlaps (rect: Rect): boolean
    {
        let hit = false;
        this.forEachCell(rect, (key) => {
            if (hit) return;
            for (const o of this.cells.get(key) ?? [])
            {
                if (intersects(rect, o)) { hit = true; return; }
            }
        });
        return hit;
    }

    /**
     * Move a body by (dx, dy), stopping at obstacles. X and Y are handled
     * separately, so bumping a wall at an angle slides along it.
     */
    move (position: Vec2, body: Body, dx: number, dy: number): MoveResult
    {
        let x = position.x + dx;
        let y = position.y;
        let blockedX = false;
        let blockedY = false;

        if (dx !== 0)
        {
            for (const o of this.nearby(bodyRect(x, y, body)))
            {
                if (!intersects(bodyRect(x, y, body), o)) continue;
                x = dx > 0 ? o.x - body.halfWidth - EPSILON : o.x + o.width + body.halfWidth + EPSILON;
                blockedX = true;
            }
        }

        y += dy;
        if (dy !== 0)
        {
            for (const o of this.nearby(bodyRect(x, y, body)))
            {
                if (!intersects(bodyRect(x, y, body), o)) continue;
                y = dy > 0 ? o.y - EPSILON : o.y + o.height + body.height + EPSILON;
                blockedY = true;
            }
        }

        return { x, y, blockedX, blockedY };
    }

    private nearby (rect: Rect): Rect[]
    {
        const found: Rect[] = [];
        this.forEachCell(rect, (key) => {
            for (const o of this.cells.get(key) ?? []) found.push(o);
        });
        return found;
    }

    private forEachCell (rect: Rect, fn: (key: number) => void): void
    {
        const c0 = Math.floor(rect.x / CELL_SIZE);
        const c1 = Math.floor((rect.x + rect.width) / CELL_SIZE);
        const r0 = Math.floor(rect.y / CELL_SIZE);
        const r1 = Math.floor((rect.y + rect.height) / CELL_SIZE);
        for (let r = r0; r <= r1; r++)
        {
            for (let c = c0; c <= c1; c++) fn(r * 10_000 + c);
        }
    }
}

export function bodyRect (x: number, y: number, body: Body): Rect
{
    return { x: x - body.halfWidth, y: y - body.height, width: body.halfWidth * 2, height: body.height };
}

function intersects (a: Rect, b: Rect): boolean
{
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
