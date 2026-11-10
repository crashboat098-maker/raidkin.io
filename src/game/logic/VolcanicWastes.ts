import type { Decoration, DecorationKind } from './BattlefieldLayout';
import { regionInfluence, type BiomeMap, type BiomeRegion } from './Biomes';
import { randInt, randRange, type Rng } from './Random';
import { STRUCTURE_SPECS, structureArea, type Structure, type StructureType } from './Structures';
import type { Rect, Vec2 } from './Types';
import type { Village } from './Villages';

/**
 * The volcanic wastes in the top-right corner, around the volcano: a
 * towering gothic fortress, a ruined cathedral, ominous black spires, and
 * ash villages of dark stone houses whose hooded folk can be recruited.
 * Plus black stone, scorched shrubs, gargoyles, gothic ruins and extra lava
 * cracks. Everything keeps wide gaps between it so armies can move and
 * fight, and stone roads link it all. Pure logic.
 */

export interface WastesPlan {
    landmarks: Structure[];
    villages: Village[];
    /** Extra glowing cracks in the ground (painted with the volcano's). */
    fissures: Vec2[][];
}

interface WastesContext {
    region: BiomeRegion;
    biomes: BiomeMap;
    playArea: Rect;
    isWet: (p: Vec2) => boolean;
    /** Areas already taken (the volcano and the original map's structures). */
    taken: Rect[];
    firstStructureId: number;
    villagers: { min: number; max: number };
}

const VILLAGE_RADIUS = 80;
/** Open ground kept between big landmarks and anything else (world px). */
const LANDMARK_GAP = 56;

export function planWastes (rng: Rng, ctx: WastesContext): WastesPlan
{
    const { region, biomes, playArea } = ctx;
    const influence = (x: number, y: number) => regionInfluence(biomes, region, x, y);
    const taken: Rect[] = [...ctx.taken];
    const overlaps = (r: Rect) => taken.some((t) => r.x < t.x + t.width && r.x + r.width > t.x && r.y < t.y + t.height && r.y + r.height > t.y);
    const sx = region.origin.x === 0 ? 1 : -1;
    const sy = region.origin.y === 0 ? 1 : -1;
    const randomInRegion = () => {
        const d = randRange(rng, 0.1, 0.95) * region.radius;
        const a = randRange(rng, 0.03, 1.54);
        return { x: Math.round(region.origin.x + sx * Math.cos(a) * d), y: Math.round(region.origin.y + sy * Math.sin(a) * d) };
    };
    /** A rectangle is usable if it lies fully in the wastes, on dry land, inside the map. */
    const usable = (r: Rect) => {
        if (r.x < playArea.x || r.x + r.width > playArea.x + playArea.width || r.y < 4 || r.y + r.height > playArea.y + playArea.height) return false;
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.5, 1], [0, 0.5], [1, 0.5]];
        return pts.every(([fx, fy]) => {
            const x = r.x + r.width * fx;
            const y = r.y + r.height * fy;
            return influence(x, y) >= 0.8 && !ctx.isWet({ x, y });
        });
    };

    let nextId = ctx.firstStructureId;
    const landmarks: Structure[] = [];
    const placeLandmark = (type: StructureType, attempts = 1500): Structure | null => {
        const spec = STRUCTURE_SPECS[type];
        for (let attempt = 0; attempt < attempts; attempt++)
        {
            const p = randomInRegion();
            const s: Structure = { id: nextId, type, x: p.x, y: p.y + spec.depth / 2, variant: 0 };
            const area = structureArea(s);
            // Room in front of the gate for an approach road.
            const keepClear = { x: area.x - LANDMARK_GAP, y: area.y - LANDMARK_GAP / 2, width: area.width + LANDMARK_GAP * 2, height: area.height + LANDMARK_GAP * 1.5 };
            if (!usable({ x: area.x, y: s.y - spec.depth, width: area.width, height: spec.depth + 30 }) || area.y < 4 || overlaps(keepClear)) continue;
            taken.push(keepClear);
            landmarks.push(s);
            nextId++;
            return s;
        }
        return null;
    };

    // The biggest first.
    placeLandmark('gothicFortress');
    placeLandmark('cathedral');

    // Two ash villages.
    const villages: Village[] = [];
    for (let v = 0; v < 2; v++)
    {
        for (let attempt = 0; attempt < 1500; attempt++)
        {
            const c = randomInRegion();
            const box = { x: c.x - VILLAGE_RADIUS, y: c.y - VILLAGE_RADIUS, width: VILLAGE_RADIUS * 2, height: VILLAGE_RADIUS * 2 };
            if (!usable(box) || overlaps({ x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 })) continue;
            taken.push(box);
            const village = buildAshVillage(rng, 200 + v, c, nextId, ctx.villagers);
            nextId += village.houses.length;
            villages.push(village);
            break;
        }
    }

    // Ominous spires dotted between them.
    for (let i = 0; i < 3; i++) placeLandmark('darkSpire', 600);

    // Extra lava cracks running through the wastes (around, not under, the buildings).
    const fissures: Vec2[][] = [];
    for (let attempt = 0; attempt < 120 && fissures.length < 12; attempt++)
    {
        let p = randomInRegion();
        if (influence(p.x, p.y) < 0.9 || taken.some((t) => p.x > t.x && p.x < t.x + t.width && p.y > t.y && p.y < t.y + t.height)) continue;
        let heading = rng() * Math.PI * 2;
        const crack: Vec2[] = [p];
        for (let step = 0; step < randInt(rng, 6, 14); step++)
        {
            heading += randRange(rng, -0.55, 0.55);
            p = { x: p.x + Math.cos(heading) * 9, y: p.y + Math.sin(heading) * 9 };
            const blocked = taken.some((t) => p.x > t.x - 6 && p.x < t.x + t.width + 6 && p.y > t.y - 6 && p.y < t.y + t.height + 6);
            if (blocked || influence(p.x, p.y) < 0.7 || ctx.isWet(p)) break;
            crack.push(p);
        }
        if (crack.length > 3) fissures.push(crack);
    }

    return { landmarks, villages, fissures };
}

/** An ash village: dark stone houses with red-lit windows around a fire brazier. */
function buildAshVillage (rng: Rng, id: number, center: Vec2, firstId: number, villagers: { min: number; max: number }): Village
{
    const houses: Structure[] = [];
    const taken: Rect[] = [{ x: center.x - 30, y: center.y - 24, width: 60, height: 46 }];
    const overlaps = (r: Rect) => taken.some((t) => r.x < t.x + t.width && r.x + r.width > t.x && r.y < t.y + t.height && r.y + r.height > t.y);
    const count = randInt(rng, 4, 5);
    const start = rng() * Math.PI * 2;
    for (let i = 0; i < count; i++)
    {
        for (let attempt = 0; attempt < 60; attempt++)
        {
            const a = start + (i / count) * Math.PI * 2 + randRange(rng, -0.4, 0.4);
            const r = randRange(rng, 56, 72);
            const house: Structure = { id: firstId + houses.length, type: 'ashHouse', x: Math.round(center.x + Math.cos(a) * r), y: Math.round(center.y + Math.sin(a) * r * 0.8 + 12), variant: Math.floor(rng() * 3) };
            const area = structureArea(house, 10);
            area.height += 8;
            if (overlaps(area)) continue;
            taken.push(area);
            houses.push(house);
            break;
        }
    }
    const decorations: Decoration[] = [{ kind: 'brazier', x: center.x, y: center.y + 4, flip: false, variant: 0 }];
    // A gargoyle on a plinth and a gothic ruin fragment at the village's edge, if there's room.
    const add = (kind: DecorationKind, x: number, y: number, w: number, h: number) => {
        const rect = { x: x - w / 2 - 3, y: y - h - 3, width: w + 6, height: h + 6 };
        if (overlaps(rect)) return;
        taken.push(rect);
        decorations.push({ kind, x: Math.round(x), y: Math.round(y), flip: rng() < 0.5, variant: 0 });
    };
    for (const house of houses) add(rng() < 0.5 ? 'ashShrub' : 'gargoyle', house.x + (rng() < 0.5 ? -26 : 26), house.y + 2, 12, 12);

    const villagerHomes: Vec2[] = [];
    const folk = randInt(rng, villagers.min, villagers.max);
    for (let i = 0; i < folk; i++)
    {
        const a = (i / folk) * Math.PI * 2 + rng() * 0.3;
        villagerHomes.push({ x: Math.round(center.x + Math.cos(a) * 22), y: Math.round(center.y + Math.sin(a) * 15 + 6) });
    }
    return { id, center, radius: VILLAGE_RADIUS, houses, decorations, villagerHomes, style: 'ashen', folk: 'ashen' };
}

interface WastesDecorContext {
    biomes: BiomeMap;
    region: BiomeRegion;
    playArea: Rect;
    isFree: (p: Vec2) => boolean;
    solids: Vec2[];
}

/** Black stone, scorched shrubs, gargoyles and gothic ruins across the wastes. */
export function decorateWastes (rng: Rng, ctx: WastesDecorContext): Decoration[]
{
    const out: Decoration[] = [];
    const { playArea } = ctx;
    const influence = (p: Vec2) => regionInfluence(ctx.biomes, ctx.region, p.x, p.y);
    const place = (count: number, kind: DecorationKind, variants: number, solid: boolean, gap = 44) => {
        for (let i = 0; i < count; i++)
        {
            for (let attempt = 0; attempt < 200; attempt++)
            {
                const p = { x: randRange(rng, playArea.x + 8, playArea.x + playArea.width - 8), y: randRange(rng, playArea.y + 12, playArea.y + playArea.height - 4) };
                if (influence(p) < 0.4 || !ctx.isFree(p)) continue;
                if (solid && ctx.solids.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < gap)) continue;
                if (solid) ctx.solids.push(p);
                out.push({ kind, x: Math.round(p.x), y: Math.round(p.y), flip: rng() < 0.5, variant: variants > 1 ? randInt(rng, 0, variants - 1) : 0 });
                break;
            }
        }
    };
    place(16, 'obsidian', 2, true);
    place(7, 'gothicRuin', 2, true, 70);
    place(6, 'gargoyle', 1, true);
    place(10, 'charredTree', 2, true);
    place(45, 'ashShrub', 2, false);
    place(24, 'rockSmall', 1, false);
    place(8, 'bones', 1, false);
    place(6, 'vent', 1, false);
    return out;
}
