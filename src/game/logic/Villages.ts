import type { Decoration, DecorationKind } from './BattlefieldLayout';
import { randInt, randRange, type Rng } from './Random';
import { STRUCTURE_SPECS, structureArea, type Structure } from './Structures';
import type { Rect, Vec2 } from './Types';

/**
 * Small medieval villages: a ring of houses around a dirt square with a
 * well, plus fences, gardens, hay and crates, and several villager Warriors
 * waiting to be recruited (more than a lone wilderness wanderer).
 * Pure data; drawn by the normal structure/decoration renderers.
 */

export interface Village {
    id: number;
    center: Vec2;
    /** Rough radius of the whole village (houses included). */
    radius: number;
    houses: Structure[];
    decorations: Decoration[];
    /** Where recruitable villagers stand. */
    villagerHomes: Vec2[];
    /** Village style and who lives there (default: a medieval village of villagers). */
    style?: 'medieval' | 'fae' | 'ashen' | 'swamp';
    folk?: 'villager' | 'sylvan' | 'ashen' | 'bogfolk';
}

export interface VillageSettings {
    count: number;
    villagers: { min: number; max: number };
}

interface VillageContext {
    playArea: Rect;
    spawn: Vec2;
    structures: readonly Structure[];
    firstStructureId: number;
}

const VILLAGE_RADIUS = 92;
const SPAWN_CLEARANCE = 330;
const VILLAGE_SPACING = 420;
/** Walking room kept around each house. */
const HOUSE_PADDING = 10;

export function placeVillages (rng: Rng, settings: VillageSettings, ctx: VillageContext): Village[]
{
    const villages: Village[] = [];
    let nextStructureId = ctx.firstStructureId;
    const margin = VILLAGE_RADIUS + 40;

    for (let v = 0; v < settings.count; v++)
    {
        for (let attempt = 0; attempt < 1500; attempt++)
        {
            const center = {
                x: Math.round(randRange(rng, ctx.playArea.x + margin, ctx.playArea.x + ctx.playArea.width - margin)),
                y: Math.round(randRange(rng, ctx.playArea.y + margin, ctx.playArea.y + ctx.playArea.height - margin)),
            };
            if (Math.hypot(center.x - ctx.spawn.x, center.y - ctx.spawn.y) < SPAWN_CLEARANCE) continue;
            // Prefer villages well apart; accept a little closer if the map is crowded.
            const relaxed = attempt >= 800;
            const spacing = relaxed ? VILLAGE_SPACING * 0.8 : VILLAGE_SPACING;
            if (villages.some((o) => Math.hypot(o.center.x - center.x, o.center.y - center.y) < spacing)) continue;
            // The volcano's ash spreads well beyond its own clearance, so villages keep extra distance.
            const clearance = (s: Structure) => s.type === 'volcano'
                ? STRUCTURE_SPECS.volcano.clearance + 140
                : STRUCTURE_SPECS[s.type].clearance * (relaxed ? 0.7 : 1);
            if (ctx.structures.some((s) => Math.hypot(s.x - center.x, s.y - center.y) < VILLAGE_RADIUS + clearance(s) + 40)) continue;

            const village = buildVillage(rng, villages.length + 1, center, nextStructureId, settings);
            nextStructureId += village.houses.length;
            villages.push(village);
            break;
        }
    }
    return villages;
}

function buildVillage (rng: Rng, id: number, center: Vec2, firstId: number, settings: VillageSettings): Village
{
    const houses: Structure[] = [];
    const taken: Rect[] = [];
    const overlaps = (r: Rect) => taken.some((t) => r.x < t.x + t.width && r.x + r.width > t.x && r.y < t.y + t.height && r.y + r.height > t.y);
    const reserve = (r: Rect) => taken.push(r);

    // Keep the village square clear (well + villagers + walking room).
    reserve({ x: center.x - 30, y: center.y - 26, width: 60, height: 48 });

    // Houses in a loose ring, doors facing outward-ish (all doors face down/south in this view).
    const houseCount = randInt(rng, 4, 6);
    const start = rng() * Math.PI * 2;
    for (let i = 0; i < houseCount; i++)
    {
        for (let attempt = 0; attempt < 12; attempt++)
        {
            const angle = start + (i / houseCount) * Math.PI * 2 + randRange(rng, -0.3, 0.3);
            const r = randRange(rng, 54, 74);
            const house: Structure = {
                id: firstId + houses.length,
                type: 'house',
                x: Math.round(center.x + Math.cos(angle) * r),
                y: Math.round(center.y + Math.sin(angle) * r * 0.8 + 12),
                variant: Math.floor(rng() * 3),
            };
            // A little room around each house (and in front of its door) so paths stay open.
            const area = structureArea(house, HOUSE_PADDING);
            area.height += 8;
            if (overlaps(area)) continue;
            reserve(area);
            houses.push(house);
            break;
        }
    }

    const decorations: Decoration[] = [];
    const add = (kind: DecorationKind, x: number, y: number, width: number, height: number) => {
        const rect = { x: x - width / 2 - 3, y: y - height - 3, width: width + 6, height: height + 6 };
        if (overlaps(rect)) return false;
        reserve(rect);
        decorations.push({ kind, x: Math.round(x), y: Math.round(y), flip: rng() < 0.5, variant: 0 });
        return true;
    };

    // The well in the middle of the square (placed directly; the square is reserved).
    decorations.push({ kind: 'well', x: center.x, y: center.y + 2, flip: false, variant: 0 });

    // Gardens and clutter beside the houses: a fence with flowers, hay, crates.
    // Props sit just outside each house's reserved space, on whichever side has room,
    // and stay within the village footprint.
    const houseHalf = STRUCTURE_SPECS.house.width / 2 + HOUSE_PADDING;
    const inside = (x: number, y: number) => Math.hypot(x - center.x, y - center.y) < VILLAGE_RADIUS + 8;
    for (const house of houses)
    {
        const first = rng() < 0.5 ? -1 : 1;
        const roll = rng();
        const gy = house.y + 2;
        for (const side of [first, -first])
        {
            if (roll < 0.45)
            {
                const gx = house.x + side * (houseHalf + 12 + 4);
                if (inside(gx, gy) && add('fence', gx, gy + 10, 24, 8)) { add('flowers', gx, gy - 2, 18, 6); break; }
            }
            else
            {
                const gx = house.x + side * (houseHalf + 6 + 4);
                if (inside(gx, gy) && (roll < 0.75 ? add('hay', gx, gy, 12, 10) : add('crates', gx, gy, 12, 11))) break;
            }
        }
    }

    // A little market clutter around the square.
    let extra = 0;
    for (let attempt = 0; attempt < 60 && extra < 2; attempt++)
    {
        const angle = rng() * Math.PI * 2;
        const gx = center.x + Math.cos(angle) * randRange(rng, 36, 80);
        const gy = center.y + Math.sin(angle) * randRange(rng, 30, 64) + 6;
        if (Math.hypot(gx - center.x, gy - center.y) > VILLAGE_RADIUS) continue;
        if (rng() < 0.5 ? add('crates', gx, gy, 12, 11) : add('hay', gx, gy, 12, 10)) extra++;
    }

    // Villagers stand around the square.
    const villagerHomes: Vec2[] = [];
    const villagers = randInt(rng, settings.villagers.min, settings.villagers.max);
    for (let i = 0; i < villagers; i++)
    {
        const angle = (i / villagers) * Math.PI * 2 + rng() * 0.4;
        villagerHomes.push({ x: Math.round(center.x + Math.cos(angle) * 22), y: Math.round(center.y + Math.sin(angle) * 16 + 6) });
    }

    return { id, center, radius: VILLAGE_RADIUS, houses, decorations, villagerHomes };
}
