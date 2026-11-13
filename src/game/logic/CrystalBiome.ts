import { arenaFootprint, arenaSite, type ArenaSite } from './Arena';
import type { BattlefieldLayout, Decoration } from './BattlefieldLayout';
import { crystalAt, type BiomeMap, type BiomeRegion } from './Biomes';
import { randInt, randRange, type Rng } from './Random';
import type { Rect, Vec2 } from './Types';

/**
 * The crystal biome (bottom-left corner): blue-violet moss, towering glowing
 * crystals in blue, violet and green, and the 1v1 arena at its heart.
 * Pure logic (map generation only).
 */

/** Radius of the arena's open floor (world px): room for two big armies. */
export const ARENA_RADIUS = 200;

/**
 * The arena's spot: as deep in the corner as fits, with both gates facing the
 * middle of the map, on the driest ground (rivers may run through the corner).
 * Nothing of it (walls, zones, wheels) may touch the preserved centre or the map edge.
 */
export function planArena (region: BiomeRegion, core: Rect, playArea: Rect, wet: (p: Vec2) => boolean): ArenaSite | null
{
    const inward = { x: region.origin.x < core.x ? 1 : -1, y: region.origin.y > core.y ? -1 : 1 };
    const dirs: [Vec2, Vec2] = [{ x: 0, y: inward.y }, { x: inward.x, y: 0 }];
    const ideal = { x: region.origin.x + inward.x * 300, y: region.origin.y + inward.y * 300 };
    const fits = (site: ArenaSite) => arenaFootprint(site).every(({ center: c, radius: r }) => {
        const inside = c.x - r >= playArea.x + 8 && c.x + r <= playArea.x + playArea.width - 8 && c.y - r >= playArea.y + 8 && c.y + r <= playArea.y + playArea.height - 8;
        const dx = Math.max(core.x - c.x, 0, c.x - (core.x + core.width));
        const dy = Math.max(core.y - c.y, 0, c.y - (core.y + core.height));
        return inside && Math.hypot(dx, dy) > r + 16;
    });
    let best: { site: ArenaSite; score: number } | null = null;
    for (let dy = -260; dy <= 260; dy += 20)
    {
        for (let dx = -260; dx <= 260; dx += 20)
        {
            const site = arenaSite({ x: ideal.x + dx, y: ideal.y + dy }, ARENA_RADIUS, dirs);
            if (!fits(site)) continue;
            // Wet samples across the footprint, then distance from the ideal spot.
            let wetCount = 0;
            for (const { center, radius } of arenaFootprint(site))
            {
                for (let r = 0; r <= radius; r += 24) for (let k = 0; k < 12; k++)
                {
                    const a = (k / 12) * Math.PI * 2;
                    if (wet({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r })) wetCount++;
                }
            }
            const score = wetCount * 1000 + Math.hypot(dx, dy);
            if (!best || score < best.score) best = { site, score };
        }
    }
    return best?.site ?? null;
}

interface CrystalContext {
    biomes: BiomeMap;
    playArea: Rect;
    /** Solid things already placed (kept apart from). */
    solids: Vec2[];
    isFree: (p: Vec2) => boolean;
}

/** Groves of giant crystals (blue, violet, green) and shards scattered between them. */
export function decorateCrystals (rng: Rng, ctx: CrystalContext): Decoration[]
{
    const out: Decoration[] = [];
    const { biomes, playArea, solids } = ctx;
    const strength = (p: Vec2) => crystalAt(biomes, p.x, p.y);
    const random = () => ({ x: randRange(rng, playArea.x, playArea.x + playArea.width), y: randRange(rng, playArea.y, playArea.y + playArea.height) });
    const clear = (p: Vec2, gap: number) => solids.every((s) => Math.abs(s.x - p.x) > gap || Math.abs(s.y - p.y) > gap * 0.7);

    // Groves: a few big crystals around a centre, mostly one colour per grove.
    let groves = 0;
    for (let attempt = 0; attempt < 3000 && groves < 26; attempt++)
    {
        const c = random();
        if (strength(c) < 0.6 || !ctx.isFree(c)) continue;
        groves++;
        const color = randInt(rng, 0, 2);
        const count = randInt(rng, 2, 4);
        for (let i = 0; i < count; i++)
        {
            const p = { x: Math.round(c.x + randRange(rng, -34, 34)), y: Math.round(c.y + randRange(rng, -22, 22)) };
            if (strength(p) < 0.5 || !ctx.isFree(p) || !clear(p, 20)) continue;
            const hue = rng() < 0.75 ? color : randInt(rng, 0, 2);
            out.push({ kind: 'giantCrystal', x: p.x, y: p.y, flip: rng() < 0.5, variant: hue + 3 * randInt(rng, 0, 1) });
            solids.push(p);
        }
    }
    // Shards: small crystals sprinkled through the biome (walk-over).
    let shards = 0;
    for (let attempt = 0; attempt < 4000 && shards < 140; attempt++)
    {
        const p = random();
        if (strength(p) < 0.45 || !ctx.isFree(p) || !clear(p, 8)) continue;
        shards++;
        out.push({ kind: 'crystalShard', x: Math.round(p.x), y: Math.round(p.y), flip: rng() < 0.5, variant: randInt(rng, 0, 2) });
    }
    return out;
}

/** The glow colours of the three crystal hues (blue, violet, green). */
export const CRYSTAL_GLOW = ['#7fd4ff', '#c79bff', '#8dffb5'] as const;

/** Every giant crystal of the biome (for its glows). */
export function giantCrystals (layout: BattlefieldLayout): Decoration[]
{
    return layout.decorations.filter((d) => d.kind === 'giantCrystal');
}
