import type { Rect, Vec2 } from './Types';
import { volcanoInfluence, type VolcanoLayout } from './Volcano';

/**
 * The biome-corner system. The middle of the map is the original grassland
 * (rivers, villages, castles); each of the four corners of the expanded map
 * is a biome region:
 *   top-left     enchanted forest   (fully built)
 *   top-right    volcanic wastes    (the existing volcano, its ash spreading into the corner)
 *   bottom-left  crystal biome      (giant glowing crystals, the 1v1 arena)
 *   bottom-right swamp              (murky pools, stilt-hut villages, mist)
 *
 * A region is a wobbly quarter-disc around its world corner. It never
 * reaches into the preserved centre (`core`), so the original map stays
 * exactly as it was. Pure logic.
 */

export type BiomeKind = 'enchanted' | 'volcanic' | 'swamp' | 'crystal';
export type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export interface BiomeRegion {
    kind: BiomeKind;
    corner: Corner;
    /** The world corner the region grows from. */
    origin: Vec2;
    /** Reach from the corner (world px), before the soft edge. */
    radius: number;
}

export interface BiomeMap {
    regions: BiomeRegion[];
    /** The preserved original map (its walkable area), which biomes never cover. */
    core: Rect;
}

/** Width of the soft edge where a biome fades into the grassland (world px). */
export const BIOME_EDGE = 90;

export function createBiomeMap (worldWidth: number, worldHeight: number, core: Rect, radius: number): BiomeMap
{
    const region = (kind: BiomeKind, corner: Corner, x: number, y: number): BiomeRegion => ({ kind, corner, origin: { x, y }, radius });
    return {
        core,
        regions: [
            region('enchanted', 'topLeft', 0, 0),
            region('volcanic', 'topRight', worldWidth, 0),
            region('crystal', 'bottomLeft', 0, worldHeight),
            region('swamp', 'bottomRight', worldWidth, worldHeight),
        ],
    };
}

export function regionOf (biomes: BiomeMap | null | undefined, kind: BiomeKind): BiomeRegion | undefined
{
    return biomes?.regions.find((r) => r.kind === kind);
}

/**
 * 0..1: how far into a region's biome a spot is (1 well inside, fading to 0
 * across the soft edge). Always 0 inside the preserved centre.
 */
export function regionInfluence (biomes: BiomeMap | null | undefined, region: BiomeRegion | undefined, x: number, y: number): number
{
    if (!biomes || !region) return 0;
    const c = biomes.core;
    // Fade out as the preserved centre gets near, so there's no straight seam along its edge.
    const outside = Math.hypot(Math.max(c.x - x, 0, x - (c.x + c.width)), Math.max(c.y - y, 0, y - (c.y + c.height)));
    if (outside <= 0) return 0;
    const fade = Math.min(1, outside / CORE_FADE);
    return fade * cornerInfluence(region, x, y);
}

/** Biomes fade out over this distance before the preserved centre (world px). */
const CORE_FADE = 100;

function cornerInfluence (region: BiomeRegion, x: number, y: number): number
{
    const dx = x - region.origin.x;
    const dy = y - region.origin.y;
    const d = Math.hypot(dx, dy);
    const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
    // A gently wobbling edge, so the biome doesn't look like a perfect circle.
    const edge = region.radius * (1 + 0.07 * Math.sin(angle * 7 + region.origin.x * 0.01) + 0.05 * Math.sin(angle * 13 + 1.1));
    if (d <= edge) return 1;
    if (d >= edge + BIOME_EDGE) return 0;
    return 1 - (d - edge) / BIOME_EDGE;
}

/** Enchanted-forest strength at a spot. */
export function forestAt (biomes: BiomeMap | null | undefined, x: number, y: number): number
{
    return regionInfluence(biomes, regionOf(biomes, 'enchanted'), x, y);
}

/** Swamp strength at a spot. */
export function swampAt (biomes: BiomeMap | null | undefined, x: number, y: number): number
{
    return regionInfluence(biomes, regionOf(biomes, 'swamp'), x, y);
}

/**
 * Volcanic strength at a spot: the volcano's own ash field (which is part of
 * the original map) merged with the volcanic corner region around it.
 */
export function volcanicAt (biomes: BiomeMap | null | undefined, volcano: VolcanoLayout | null | undefined, x: number, y: number): number
{
    return Math.max(volcanoInfluence(volcano, x, y), regionInfluence(biomes, regionOf(biomes, 'volcanic'), x, y));
}

/** Crystal-biome strength at a spot. */
export function crystalAt (biomes: BiomeMap | null | undefined, x: number, y: number): number
{
    return regionInfluence(biomes, regionOf(biomes, 'crystal'), x, y);
}
