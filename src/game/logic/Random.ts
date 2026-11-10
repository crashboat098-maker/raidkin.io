/**
 * A tiny seeded random number generator.
 * Unlike Math.random(), the same seed always produces the same sequence,
 * so the same map can be rebuilt identically on any computer.
 */
export type Rng = () => number;

export function createRng (seed: number): Rng
{
    // "mulberry32" — a well-known, very small PRNG.
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function randRange (rng: Rng, min: number, max: number): number
{
    return min + rng() * (max - min);
}

/** Whole number between min and max, inclusive. */
export function randInt (rng: Rng, min: number, max: number): number
{
    return Math.floor(randRange(rng, min, max + 1));
}

export function pick<T> (rng: Rng, items: readonly T[]): T
{
    return items[Math.floor(rng() * items.length)];
}
