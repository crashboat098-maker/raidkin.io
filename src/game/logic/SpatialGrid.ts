import type { Vec2 } from './Types';

/**
 * A simple uniform grid for "who is near this point?" questions.
 * Instead of checking every soldier against every other soldier (which gets
 * slow fast as armies grow), each query only looks at the few cells around
 * the point. Buckets are reused between frames to avoid garbage.
 */
export class SpatialGrid<T extends { position: Vec2 }>
{
    private readonly buckets = new Map<number, T[]>();
    private readonly used: T[][] = [];

    constructor (private readonly cellSize: number) {}

    clear (): void
    {
        for (const bucket of this.used) bucket.length = 0;
        this.used.length = 0;
    }

    insert (item: T): void
    {
        const key = this.key(Math.floor(item.position.x / this.cellSize), Math.floor(item.position.y / this.cellSize));
        let bucket = this.buckets.get(key);
        if (!bucket) { bucket = []; this.buckets.set(key, bucket); }
        if (bucket.length === 0) this.used.push(bucket);
        bucket.push(item);
    }

    /** Call `fn` for every item that might be within `radius` of `p` (caller checks exact distance). */
    forEachNear (p: Vec2, radius: number, fn: (item: T) => void): void
    {
        const c0 = Math.floor((p.x - radius) / this.cellSize);
        const c1 = Math.floor((p.x + radius) / this.cellSize);
        const r0 = Math.floor((p.y - radius) / this.cellSize);
        const r1 = Math.floor((p.y + radius) / this.cellSize);
        for (let r = r0; r <= r1; r++)
        {
            for (let c = c0; c <= c1; c++)
            {
                const bucket = this.buckets.get(this.key(c, r));
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
            }
        }
    }

    private key (c: number, r: number): number
    {
        return r * 100_003 + c;
    }
}
