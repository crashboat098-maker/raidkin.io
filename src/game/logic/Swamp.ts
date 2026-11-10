import type { Decoration, DecorationKind } from './BattlefieldLayout';
import { regionInfluence, type BiomeMap, type BiomeRegion } from './Biomes';
import { randInt, randRange, type Rng } from './Random';
import { structureArea, type Structure } from './Structures';
import type { Rect, Vec2 } from './Types';
import type { Village } from './Villages';
import { addWaterBody, isWater, type WaterBody, type WaterLayout } from './Water';

/**
 * The swamp in the bottom-right corner: murky pools linked by winding
 * waterways, wooden boardwalks across the bigger pools, and villages of
 * stilt huts whose bog folk can be recruited. Scenery: twisted vine-hung
 * trees, reeds, bushes, mushrooms, glowing plants and lily pads. Water
 * stays sparse and well apart, so there are wide dry paths and clearings
 * to march and fight on. Pure logic.
 */

export interface SwampPlan {
    villages: Village[];
    /** Murky pools (already added to the water layout). */
    pools: WaterBody[];
    /** Wooden walkways across pools (laid as trails; their decks become bridges). */
    boardwalks: Vec2[][];
}

interface SwampContext {
    region: BiomeRegion;
    biomes: BiomeMap;
    playArea: Rect;
    water: WaterLayout;
    isWet: (p: Vec2) => boolean;
    /** Areas already taken. */
    taken: Rect[];
    firstStructureId: number;
    villagers: { min: number; max: number };
}

const VILLAGE_RADIUS = 78;
const POOLS = 9;
/** Dry ground kept between two pools (beyond their edges), so the swamp stays open. */
const POOL_GAP = 80;

export function planSwamp (rng: Rng, ctx: SwampContext): SwampPlan
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
    const inside = (x: number, y: number, margin: number) =>
        x > playArea.x + margin && x < playArea.x + playArea.width - margin && y > playArea.y + margin && y < playArea.y + playArea.height - margin;
    const usable = (r: Rect) => {
        if (!inside(r.x, r.y, 0) || !inside(r.x + r.width, r.y + r.height, 0)) return false;
        return [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.5, 1], [0, 0.5], [1, 0.5]].every(([fx, fy]) => {
            const x = r.x + r.width * fx;
            const y = r.y + r.height * fy;
            return influence(x, y) >= 0.8 && !ctx.isWet({ x, y });
        });
    };

    // 1. Two stilt-hut villages, well apart.
    let nextId = ctx.firstStructureId;
    const villages: Village[] = [];
    for (let v = 0; v < 2; v++)
    {
        for (let attempt = 0; attempt < 1500; attempt++)
        {
            const c = randomInRegion();
            const box = { x: c.x - VILLAGE_RADIUS, y: c.y - VILLAGE_RADIUS, width: VILLAGE_RADIUS * 2, height: VILLAGE_RADIUS * 2 };
            if (!usable(box) || overlaps({ x: box.x - 60, y: box.y - 60, width: box.width + 120, height: box.height + 120 })) continue;
            taken.push(box);
            const village = buildSwampVillage(rng, 300 + v, c, nextId, ctx.villagers);
            nextId += village.houses.length;
            villages.push(village);
            break;
        }
    }

    // 2. Murky pools, spaced so wide dry lanes run between them.
    const dryKeep = taken.map((t) => ({ x: t.x - 26, y: t.y - 26, width: t.width + 52, height: t.height + 52 }));
    const hitsDry = (p: Vec2, r: number) => dryKeep.some((t) => p.x > t.x - r && p.x < t.x + t.width + r && p.y > t.y - r && p.y < t.y + t.height + r);
    const nearOldWater = (p: Vec2, r: number) => {
        for (let k = 0; k < 12; k++)
        {
            const a = (k / 12) * Math.PI * 2;
            if (ctx.isWet({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r })) return true;
        }
        return ctx.isWet(p);
    };
    const pools: WaterBody[] = [];
    for (let attempt = 0; attempt < 900 && pools.length < POOLS; attempt++)
    {
        const c = randomInRegion();
        const width = Math.round(randRange(rng, 48, 100));
        const r = width / 2;
        if (influence(c.x, c.y) < 0.7 || !inside(c.x, c.y, r + 40) || hitsDry(c, r + 6) || nearOldWater(c, r + 40)) continue;
        if (pools.some((o) => Math.hypot(o.points[0].x - c.x, o.points[0].y - c.y) < r + o.width / 2 + POOL_GAP)) continue;
        const pool: WaterBody = { kind: 'pond', points: [c], width };
        addWaterBody(ctx.water, pool, rng);
        pools.push(pool);
    }

    // 3. Narrow waterways winding between some neighbouring pools.
    let links = 0;
    const linked = new Set<string>();
    for (const a of pools)
    {
        if (links >= 4) break;
        const b = pools
            .filter((o) => o !== a)
            .sort((x, y) => Math.hypot(x.points[0].x - a.points[0].x, x.points[0].y - a.points[0].y) - Math.hypot(y.points[0].x - a.points[0].x, y.points[0].y - a.points[0].y))[0];
        if (!b) continue;
        const key = [pools.indexOf(a), pools.indexOf(b)].sort().join('-');
        const from = a.points[0];
        const to = b.points[0];
        if (linked.has(key) || Math.hypot(to.x - from.x, to.y - from.y) > 380) continue;
        const line = meander(rng, from, to, 26);
        if (line.some((p) => hitsDry(p, 10) || influence(p.x, p.y) < 0.5)) continue;
        linked.add(key);
        addWaterBody(ctx.water, { kind: 'stream', points: line, width: Math.round(randRange(rng, 12, 18)) }, rng);
        links++;
    }

    // 4. Boardwalks straight across the three biggest pools.
    const boardwalks: Vec2[][] = [];
    for (const pool of [...pools].sort((x, y) => y.width - x.width).slice(0, 3))
    {
        const c = pool.points[0];
        const reach = pool.width / 2 + 14;
        for (let attempt = 0; attempt < 6; attempt++)
        {
            const a = randRange(rng, -0.5, 0.5) + (rng() < 0.5 ? 0 : Math.PI / 2);
            const dx = Math.cos(a) * reach;
            const dy = Math.sin(a) * reach;
            const ends = [{ x: c.x - dx, y: c.y - dy }, { x: c.x + dx, y: c.y + dy }];
            if (ends.some((e) => ctx.isWet(e) || isWater(ctx.water, e.x, e.y) || hitsDry(e, 4))) continue;
            boardwalks.push([ends[0], { x: c.x, y: c.y }, ends[1]]);
            break;
        }
    }

    return { villages, pools, boardwalks };
}

/** A gently meandering line from a to b. */
function meander (rng: Rng, a: Vec2, b: Vec2, amplitude: number): Vec2[]
{
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / length;
    const ny = (b.x - a.x) / length;
    const steps = Math.max(4, Math.ceil(length / 30));
    const phase = rng() * Math.PI * 2;
    const turns = randRange(rng, 1, 1.8);
    const out: Vec2[] = [];
    for (let s = 0; s <= steps; s++)
    {
        const t = s / steps;
        const off = amplitude * Math.sin(Math.PI * t) * Math.sin(Math.PI * 2 * turns * t + phase);
        out.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
    }
    return out;
}

/** A swamp village: reed-thatched stilt huts around a carved totem, glowing plants about. */
function buildSwampVillage (rng: Rng, id: number, center: Vec2, firstId: number, villagers: { min: number; max: number }): Village
{
    const houses: Structure[] = [];
    const taken: Rect[] = [{ x: center.x - 30, y: center.y - 24, width: 60, height: 46 }];
    const overlaps = (r: Rect) => taken.some((t) => r.x < t.x + t.width && r.x + r.width > t.x && r.y < t.y + t.height && r.y + r.height > t.y);
    const count = randInt(rng, 4, 5);
    const start = rng() * Math.PI * 2;
    for (let i = 0; i < count; i++)
    {
        for (let attempt = 0; attempt < 120; attempt++)
        {
            const a = start + (i / count) * Math.PI * 2 + randRange(rng, -0.5, 0.5);
            const r = randRange(rng, 56, 76);
            const hut: Structure = { id: firstId + houses.length, type: 'stiltHut', x: Math.round(center.x + Math.cos(a) * r), y: Math.round(center.y + Math.sin(a) * r * 0.8 + 12), variant: Math.floor(rng() * 3) };
            const area = structureArea(hut, 6);
            area.height += 6;
            if (overlaps(area)) continue;
            taken.push(area);
            houses.push(hut);
            break;
        }
    }
    const decorations: Decoration[] = [{ kind: 'swampTotem', x: center.x, y: center.y + 2, flip: false, variant: 0 }];
    const add = (kind: DecorationKind, x: number, y: number, w: number, h: number, variant = 0) => {
        const rect = { x: x - w / 2 - 3, y: y - h - 3, width: w + 6, height: h + 6 };
        if (overlaps(rect)) return;
        taken.push(rect);
        decorations.push({ kind, x: Math.round(x), y: Math.round(y), flip: rng() < 0.5, variant });
    };
    for (const hut of houses)
    {
        const side = rng() < 0.5 ? -1 : 1;
        add(rng() < 0.5 ? 'glowPlant' : 'swampShroom', hut.x + side * 25, hut.y + 2, 12, 12, randInt(rng, 0, 1));
        add('reeds', hut.x - side * 24, hut.y + 4, 10, 10);
    }

    const villagerHomes: Vec2[] = [];
    const folk = randInt(rng, villagers.min, villagers.max);
    for (let i = 0; i < folk; i++)
    {
        const a = (i / folk) * Math.PI * 2 + rng() * 0.3;
        villagerHomes.push({ x: Math.round(center.x + Math.cos(a) * 24), y: Math.round(center.y + Math.sin(a) * 16 + 6) });
    }
    return { id, center, radius: VILLAGE_RADIUS, houses, decorations, villagerHomes, style: 'swamp', folk: 'bogfolk' };
}

interface SwampDecorContext {
    biomes: BiomeMap;
    region: BiomeRegion;
    playArea: Rect;
    water: WaterLayout;
    isFree: (p: Vec2) => boolean;
    /** Dry ground right at the water's edge (for reeds). */
    atShore: (p: Vec2) => boolean;
    solids: Vec2[];
}

/** Twisted trees, bushes, mushrooms, glowing plants, reeds at the water, lily pads on it. */
export function decorateSwamp (rng: Rng, ctx: SwampDecorContext): Decoration[]
{
    const out: Decoration[] = [];
    const { playArea, water } = ctx;
    const influence = (p: Vec2) => regionInfluence(ctx.biomes, ctx.region, p.x, p.y);
    const randomPoint = () => ({ x: randRange(rng, playArea.x + 8, playArea.x + playArea.width - 8), y: randRange(rng, playArea.y + 12, playArea.y + playArea.height - 4) });
    const place = (count: number, kind: DecorationKind, variants: number, ok: (p: Vec2) => boolean, solid: boolean, gap = 44) => {
        for (let i = 0; i < count; i++)
        {
            for (let attempt = 0; attempt < 200; attempt++)
            {
                const p = randomPoint();
                if (!ok(p)) continue;
                if (solid && ctx.solids.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < gap)) continue;
                if (solid) ctx.solids.push(p);
                out.push({ kind, x: Math.round(p.x), y: Math.round(p.y), flip: rng() < 0.5, variant: variants > 1 ? randInt(rng, 0, variants - 1) : 0 });
                break;
            }
        }
    };
    const land = (min: number) => (p: Vec2) => influence(p) >= min && ctx.isFree(p);
    // Open water (not under a boardwalk), a little in from the bank.
    const openWater = (p: Vec2) => influence(p) >= 0.5 && [[0, 0], [7, 0], [-7, 0], [0, 5], [0, -5]].every(([dx, dy]) => isWater(water, p.x + dx, p.y + dy));

    place(34, 'swampTree', 2, land(0.4), true, 50);
    place(40, 'swampBush', 2, land(0.35), false);
    place(26, 'swampShroom', 2, land(0.45), false);
    place(30, 'glowPlant', 2, land(0.5), false);
    place(60, 'reeds', 1, (p) => influence(p) >= 0.4 && ctx.atShore(p), false);
    place(46, 'lilyPad', 2, openWater, false);
    place(6, 'log', 1, land(0.5), true, 40);
    place(7, 'stump', 1, land(0.4), false);
    return out;
}
