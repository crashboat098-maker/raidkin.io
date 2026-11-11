import { randRange, type Rng } from './Random';
import type { Rect, Vec2 } from './Types';

/**
 * Structures are gameplay landmarks (barracks, towers, keeps...).
 * They are kept separate from purely decorative terrain (bushes, rocks)
 * because later they will have owners, defenders and recruitment.
 *
 * This file only holds data and placement rules. How a structure LOOKS
 * lives in render/StructureArt.ts, so the artwork can be replaced freely.
 */

export type StructureType = 'barracks' | 'watchtower' | 'fortification' | 'keep' | 'castle' | 'house' | 'volcano'
    // Enchanted forest
    | 'faeHouse' | 'shrine' | 'moonGate' | 'faeCastle'
    // Volcanic wastes
    | 'gothicFortress' | 'cathedral' | 'darkSpire' | 'ashHouse'
    // Swamp
    | 'stiltHut' | 'swampCastle';

/** Structure types that only appear in a corner biome (placed by the biome generator). */
export const BIOME_STRUCTURES: readonly StructureType[] = [
    'volcano', 'faeHouse', 'shrine', 'moonGate', 'faeCastle', 'gothicFortress', 'cathedral', 'darkSpire', 'ashHouse', 'stiltHut', 'swampCastle',
];

export interface Structure {
    /** Unique id, so future systems (ownership, capture) can refer to it. */
    id: number;
    type: StructureType;
    /** Bottom-centre of the structure (the front edge, where it meets the ground). */
    x: number;
    y: number;
    /** Art variant (e.g. house roof style). */
    variant?: number;
}

export interface StructureSpec {
    /** Width on the ground, in world pixels. */
    width: number;
    /** Ground depth (front-to-back), in world pixels. */
    depth: number;
    /** How tall it stands on screen; used to keep things from hiding behind it. */
    height: number;
    /** Personal space. Two structures stay at least (clearance A + clearance B) apart. */
    clearance: number;
    /** How many to place on the map. */
    count: number;
    /**
     * Which parts of the width are solid walls, measured from the left edge.
     * Gaps between spans are breaches you can walk through.
     * Omitted = the whole footprint is solid.
     */
    solidSpans?: { from: number; to: number }[];
}

export const STRUCTURE_SPECS: Record<StructureType, StructureSpec> = {
    keep:          { width: 80, depth: 40, height: 64, clearance: 160, count: 3 },
    barracks:      { width: 48, depth: 22, height: 36, clearance: 100, count: 6 },
    watchtower:    { width: 22, depth: 14, height: 52, clearance: 85,  count: 8 },
    fortification: {
        width: 72, depth: 16, height: 28, clearance: 100, count: 6,
        // Ruined tower + wall, then two collapsed breaches (14px and 12px wide).
        solidSpans: [{ from: 0, to: 22 }, { from: 36, to: 52 }, { from: 64, to: 72 }],
    },
    // Milestone 5.5: large landmark castles, placed after the older structures so those keep their spots.
    castle:        { width: 128, depth: 56, height: 100, clearance: 190, count: 2 },
    // Village houses are placed by the village generator, not here.
    house:         { width: 30, depth: 16, height: 30, clearance: 0, count: 0 },
    // The volcano is placed by the volcano biome generator; its big clearance keeps other landmarks out of the biome.
    volcano:       { width: 150, depth: 46, height: 118, clearance: 240, count: 0 },
    // Enchanted forest (placed by the forest generator): mushroom and stump cottages, elven shrines,
    // and a ruined moon gate whose archway you can walk through.
    faeHouse:      { width: 32, depth: 16, height: 36, clearance: 0, count: 0 },
    shrine:        { width: 40, depth: 18, height: 46, clearance: 0, count: 0 },
    moonGate:      {
        width: 60, depth: 12, height: 56, clearance: 0, count: 0,
        solidSpans: [{ from: 0, to: 14 }, { from: 46, to: 60 }],
    },
    // The giant fae castle at the heart of the enchanted forest.
    faeCastle:     { width: 200, depth: 64, height: 184, clearance: 0, count: 0 },
    // Volcanic wastes: a towering black fortress, a ruined cathedral, ominous spires, and ash-village houses.
    gothicFortress: { width: 224, depth: 72, height: 200, clearance: 0, count: 0 },
    cathedral:     { width: 160, depth: 60, height: 168, clearance: 0, count: 0 },
    darkSpire:     { width: 34, depth: 18, height: 128, clearance: 0, count: 0 },
    ashHouse:      { width: 32, depth: 16, height: 40, clearance: 0, count: 0 },
    // Swamp villages: reed-thatched huts raised on wooden stilts.
    stiltHut:      { width: 34, depth: 16, height: 46, clearance: 0, count: 0 },
    // The swamp's capturable castle: mossy stone, twisted roots and wooden walkways.
    swampCastle:   { width: 176, depth: 56, height: 156, clearance: 0, count: 0 },
};

/** The solid ground rectangles of a structure, for collision. */
export function structureColliders (structure: Structure): Rect[]
{
    const spec = STRUCTURE_SPECS[structure.type];
    const left = structure.x - spec.width / 2;
    const spans = spec.solidSpans ?? [{ from: 0, to: spec.width }];

    return spans.map((span) => ({
        x: left + span.from,
        y: structure.y - spec.depth,
        width: span.to - span.from,
        height: spec.depth,
    }));
}

/** Biggest first, so rare large structures always find room. */
const PLACEMENT_ORDER: StructureType[] = ['castle', 'keep', 'barracks', 'watchtower', 'fortification'];

/** Keep structures this far from the starting point. */
const SPAWN_CLEARANCE = 260;
/** Keep structures this far inside the walkable area's edge. */
const EDGE_MARGIN = 48;

/**
 * The full rectangle a structure takes up on screen (its ground plus its height),
 * optionally grown by `padding` on every side.
 */
export function structureArea (structure: Structure, padding = 0): Rect
{
    const spec = STRUCTURE_SPECS[structure.type];
    return {
        x: structure.x - spec.width / 2 - padding,
        y: structure.y - spec.height - padding,
        width: spec.width + padding * 2,
        height: spec.height + padding * 2,
    };
}

export function rectContains (rect: Rect, p: Vec2): boolean
{
    return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

/** Scatter structures with plenty of open ground between them. */
export function placeStructures (rng: Rng, area: Rect, spawn: Vec2, reserved: readonly Structure[] = []): Structure[]
{
    // `reserved` structures (the volcano) are already in place: keep clear of them.
    const placed: Structure[] = [...reserved];
    let nextId = 1 + reserved.length;

    for (const type of PLACEMENT_ORDER)
    {
        const spec = STRUCTURE_SPECS[type];

        for (let n = 0; n < spec.count; n++)
        {
            // Castles are big and placed last, so give them more tries to find room.
            const attempts = type === 'castle' ? 800 : 80;
            for (let attempt = 0; attempt < attempts; attempt++)
            {
                const x = randRange(rng, area.x + EDGE_MARGIN + spec.width / 2, area.x + area.width - EDGE_MARGIN - spec.width / 2);
                const y = randRange(rng, area.y + EDGE_MARGIN + spec.height, area.y + area.height - EDGE_MARGIN);

                if (Math.hypot(x - spawn.x, y - spawn.y) < SPAWN_CLEARANCE + spec.clearance / 2) continue;

                const tooClose = placed.some((other) => {
                    const minDistance = spec.clearance + STRUCTURE_SPECS[other.type].clearance;
                    return Math.hypot(x - other.x, y - other.y) < minDistance;
                });
                if (tooClose) continue;

                placed.push({ id: nextId++, type, x: Math.round(x), y: Math.round(y) });
                break;
            }
        }
    }

    return placed.slice(reserved.length);
}
