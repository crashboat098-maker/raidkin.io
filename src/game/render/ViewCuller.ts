import type { GameObjects, Scene, Tweens } from 'phaser';

/**
 * Takes the battlefield's scenery (trees, grass, glows, terrain bits...) out of
 * the game while it is off-screen. Phaser loops over (and depth-sorts) every
 * object in the scene each frame, even hidden ones, and the map has ~10,000 of
 * them, so this is the difference between a smooth game and a slideshow on
 * phones.
 *
 * Off-screen pieces are hidden, removed from the scene's draw list, and their
 * looping animations (glows pulsing, fireflies drifting...) are paused.
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

/** A looping animation, and how many of the things it moves are on screen. */
interface TweenUse { tween: Tweens.Tween; shown: number }

export class ViewCuller
{
    private readonly cells: Cullable[][];
    private readonly cols: number;
    private readonly rows: number;
    private range: Range | null = null;
    private readonly tweensOf = new Map<Cullable, TweenUse[]>();
    /** Everything this culler manages, so the pieces off the draw list still get cleaned up. */
    private readonly all: Cullable[] = [];

    constructor (private readonly scene: Scene, objects: readonly GameObjects.GameObject[], worldWidth: number, worldHeight: number)
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
            this.all.push(o);
        }

        // Every managed thing starts off-screen; the first update brings back what's in view.
        const managed = new Set<GameObjects.GameObject>(this.all);
        for (const tween of scene.tweens.getTweens())
        {
            const targets = tween.targets as Cullable[];
            if (!targets.some((t) => managed.has(t))) continue;
            // An animation that also moves something we don't manage keeps running.
            if (!targets.every((t) => managed.has(t))) continue;
            const use: TweenUse = { tween, shown: 0 };
            for (const t of targets)
            {
                const list = this.tweensOf.get(t);
                if (list) list.push(use); else this.tweensOf.set(t, [use]);
            }
            tween.pause();
        }
        for (const o of this.all) o.setVisible(false);
        // Pull them all off the draw list in one pass (one by one would be slow at this size).
        const list = scene.children.list;
        let kept = 0;
        for (const o of list) if (!managed.has(o)) list[kept++] = o;
        list.length = kept;
        for (const o of this.all) offList(o);

        // Pieces off the draw list aren't destroyed with the scene: do it here.
        scene.events.once('shutdown', () =>
        {
            for (const o of this.all) if (!o.displayList) o.destroy();
            this.all.length = 0;
        });
    }

    /** Show what's near the camera's view, take away what isn't. Call every frame. */
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
        const leaving = new Set<GameObjects.GameObject>();
        for (let r = r0; r <= r1; r++)
        {
            for (let c = c0; c <= c1; c++)
            {
                const now = inside(next, c, r);
                if (now === inside(prev, c, r)) continue;
                for (const o of this.cells[r * this.cols + c])
                {
                    if (now) this.show(o);
                    else { this.hide(o); leaving.add(o); }
                }
            }
        }
        if (leaving.size > 0)
        {
            const list = this.scene.children.list;
            let kept = 0;
            for (const o of list) if (!leaving.has(o)) list[kept++] = o;
            list.length = kept;
        }
    }

    private show (o: Cullable): void
    {
        o.setVisible(true);
        o.displayList = this.scene.children;
        this.scene.children.list.push(o);
        this.scene.children.queueDepthSort();
        for (const use of this.tweensOf.get(o) ?? []) if (use.shown++ === 0) use.tween.resume();
    }

    private hide (o: Cullable): void
    {
        o.setVisible(false);
        offList(o);
        for (const use of this.tweensOf.get(o) ?? []) if (--use.shown === 0) use.tween.pause();
    }
}

/** Mark an object as not on any draw list (what Phaser itself does when removing one). */
function offList (o: Cullable): void
{
    (o as { displayList: unknown }).displayList = null;
}

function clamp (value: number, min: number, max: number): number
{
    return Math.max(min, Math.min(max, value));
}
