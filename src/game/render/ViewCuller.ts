import type { GameObjects } from 'phaser';

/**
 * Hides the battlefield's static scenery (trees, rocks, glows, terrain bits...)
 * while it is off-screen. Phaser draws every visible object each frame even
 * when it's outside the camera, and the map has ~12,000 of them, so this is
 * the difference between a smooth game and a slideshow on phones.
 *
 * Objects are bucketed into a coarse grid once; each frame only the cells
 * that came into or left view are touched (usually none).
 */

const CELL = 64;
/** Extra room around the view, so tall sprites and gently drifting ones never pop. */
const MARGIN = 96;
/** Objects bigger than this (half-size, px) are always drawn. */
const MAX_HALF_EXTENT = 160;

type Cullable = GameObjects.GameObject & GameObjects.Components.Visible & { getBounds?: () => { centerX: number; centerY: number; width: number; height: number }; x: number; y: number };

interface Range { c0: number; c1: number; r0: number; r1: number }

export class ViewCuller
{
    private readonly cells: Cullable[][];
    private readonly cols: number;
    private readonly rows: number;
    private range: Range | null = null;

    constructor (objects: readonly GameObjects.GameObject[], worldWidth: number, worldHeight: number)
    {
        this.cols = Math.ceil(worldWidth / CELL) + 1;
        this.rows = Math.ceil(worldHeight / CELL) + 1;
        this.cells = Array.from({ length: this.cols * this.rows }, () => []);

        for (const object of objects)
        {
            const o = object as Cullable;
            if (typeof o.getBounds !== 'function' || typeof o.setVisible !== 'function') continue;
            // Pooled effects parked at the origin get moved around later: leave them alone.
            if (o.x === 0 && o.y === 0) continue;
            if (!o.visible) continue;
            const b = o.getBounds();
            if (b.width / 2 > MAX_HALF_EXTENT || b.height / 2 > MAX_HALF_EXTENT) continue;
            const c = clamp(Math.floor(b.centerX / CELL), 0, this.cols - 1);
            const r = clamp(Math.floor(b.centerY / CELL), 0, this.rows - 1);
            this.cells[r * this.cols + c].push(o);
            o.setVisible(false);
        }
    }

    /** Show what's near the camera's view, hide what isn't. Call every frame. */
    update (view: { x: number; y: number; width: number; height: number }): void
    {
        const next: Range = {
            c0: clamp(Math.floor((view.x - MARGIN) / CELL), 0, this.cols - 1),
            c1: clamp(Math.floor((view.x + view.width + MARGIN) / CELL), 0, this.cols - 1),
            r0: clamp(Math.floor((view.y - MARGIN) / CELL), 0, this.rows - 1),
            r1: clamp(Math.floor((view.y + view.height + MARGIN) / CELL), 0, this.rows - 1),
        };
        const prev = this.range;
        if (prev && prev.c0 === next.c0 && prev.c1 === next.c1 && prev.r0 === next.r0 && prev.r1 === next.r1) return;
        this.range = next;

        const inside = (range: Range | null, c: number, r: number) => range !== null && c >= range.c0 && c <= range.c1 && r >= range.r0 && r <= range.r1;
        const c0 = prev ? Math.min(prev.c0, next.c0) : next.c0;
        const c1 = prev ? Math.max(prev.c1, next.c1) : next.c1;
        const r0 = prev ? Math.min(prev.r0, next.r0) : next.r0;
        const r1 = prev ? Math.max(prev.r1, next.r1) : next.r1;
        for (let r = r0; r <= r1; r++)
        {
            for (let c = c0; c <= c1; c++)
            {
                const now = inside(next, c, r);
                if (now === inside(prev, c, r)) continue;
                for (const o of this.cells[r * this.cols + c]) o.setVisible(now);
            }
        }
    }
}

function clamp (value: number, min: number, max: number): number
{
    return Math.max(min, Math.min(max, value));
}
