import type { Decoration, DecorationKind } from './BattlefieldLayout';
import { forestAt, type BiomeMap, type BiomeRegion } from './Biomes';
import { pick, randInt, randRange, type Rng } from './Random';
import { structureArea, type Structure } from './Structures';
import type { Rect, Vec2 } from './Types';
import type { Village } from './Villages';

/**
 * The enchanted forest in the top-left corner.
 *
 *  - At its heart, a giant fae castle in landscaped grounds (lanterns,
 *    statues, crystals, flower beds, a marble forecourt).
 *  - A fae village of mushroom and stump cottages around a glowing fountain,
 *    with forest folk to recruit; more folk roam the woods.
 *  - Elven shrines and a ruined moon gate.
 *  - Trees are NOT spread everywhere: they form a belt along the forest's
 *    edges, line its paths, and gather in a few themed scenic groves. In
 *    between are open glades of glowing flowers, ferns, mushrooms and ruins,
 *    with room for big battles.
 *
 * Pure logic. Fireflies are added by the renderer.
 */

export interface ForestPlan {
    village: Village;
    /** The giant castle at the heart of the forest. */
    castle: Structure;
    /** Centre of the castle's grounds (kept open: no trees). */
    grounds: { center: Vec2; radius: number };
    /** Shrines and the moon gate. */
    landmarks: Structure[];
    /** Lanterns, statues, crystals and flower beds around the castle. */
    groundsDecor: Decoration[];
    /** Where forest folk roam (recruitable neutrals outside the village). */
    folkHomes: Vec2[];
}

interface ForestContext {
    region: BiomeRegion;
    biomes: BiomeMap;
    playArea: Rect;
    isWet: (p: Vec2) => boolean;
    firstStructureId: number;
    villagers: { min: number; max: number };
    folk: number;
}

const VILLAGE_RADIUS = 112;
const GROUNDS_RADIUS = 150;

/** Lay out the castle, village, landmarks and folk (scenery comes later, once trails exist). */
export function planForest (rng: Rng, ctx: ForestContext): ForestPlan
{
    const { region, biomes, playArea } = ctx;
    const inside = (p: Vec2, margin: number) => p.x > playArea.x + margin && p.x < playArea.x + playArea.width - margin && p.y > playArea.y + margin && p.y < playArea.y + playArea.height - margin;
    const deep = (p: Vec2) => forestAt(biomes, p.x, p.y) >= 1;
    const dry = (p: Vec2, r: number) => !ctx.isWet(p) && [0, 1, 2, 3, 4, 5, 6, 7].every((k) => !ctx.isWet({ x: p.x + Math.cos(k * Math.PI / 4) * r, y: p.y + Math.sin(k * Math.PI / 4) * r }));
    // Directions from the corner into the forest.
    const sx = region.origin.x === 0 ? 1 : -1;
    const sy = region.origin.y === 0 ? 1 : -1;
    const along = (d: number, a: number) => ({ x: Math.round(region.origin.x + sx * Math.cos(a) * d), y: Math.round(region.origin.y + sy * Math.sin(a) * d) });
    let nextId = ctx.firstStructureId;

    // 1. The giant castle, at the heart of the forest.
    let heart = along(region.radius * 0.5, Math.PI / 4);
    for (let attempt = 0; attempt < 200; attempt++)
    {
        const p = along(region.radius * randRange(rng, 0.42, 0.56), Math.PI / 4 + randRange(rng, -0.25, 0.25));
        if (inside(p, GROUNDS_RADIUS) && deep(p) && dry(p, GROUNDS_RADIUS)) { heart = p; break; }
    }
    // The castle stands a little behind the middle of its grounds, its forecourt in front.
    const castle: Structure = { id: nextId++, type: 'faeCastle', x: heart.x, y: heart.y + 20, variant: 0 };
    const grounds = { center: heart, radius: GROUNDS_RADIUS };

    // 2. The fae village, in its own glade away from the castle.
    let center: Vec2 = along(region.radius * 0.7, 0.2);
    for (let attempt = 0; attempt < 400; attempt++)
    {
        const p = along(region.radius * randRange(rng, 0.45, 0.78), randRange(rng, 0.12, 1.45));
        if (!inside(p, VILLAGE_RADIUS + 30) || !deep(p) || !dry(p, VILLAGE_RADIUS + 20)) continue;
        if (Math.hypot(p.x - heart.x, p.y - heart.y) < GROUNDS_RADIUS + VILLAGE_RADIUS + 70) continue;
        center = p;
        break;
    }
    const village = buildFaeVillage(rng, center, nextId, ctx.villagers);
    nextId += village.houses.length;

    // 3. Landmarks: two elven shrines and a ruined moon gate, out in the woods.
    const landmarks: Structure[] = [];
    const taken = [{ p: heart, r: GROUNDS_RADIUS + 70 }, { p: center, r: VILLAGE_RADIUS + 90 }];
    for (const type of ['moonGate', 'shrine', 'shrine'] as const)
    {
        for (let attempt = 0; attempt < 500; attempt++)
        {
            const p = along(randRange(rng, 0.2, 0.88) * region.radius, randRange(rng, 0.08, 1.49));
            if (!inside(p, 70) || !deep(p) || !dry(p, 50)) continue;
            if (taken.some((t) => Math.hypot(t.p.x - p.x, t.p.y - p.y) < t.r)) continue;
            landmarks.push({ id: nextId++, type, x: p.x, y: p.y, variant: 0 });
            taken.push({ p, r: 170 });
            break;
        }
    }

    // 4. Forest folk roam the woods.
    const folkHomes: Vec2[] = [];
    for (let attempt = 0; attempt < 800 && folkHomes.length < ctx.folk; attempt++)
    {
        const p = along(randRange(rng, 0.15, 0.9) * region.radius, randRange(rng, 0.05, 1.52));
        if (!inside(p, 40) || forestAt(biomes, p.x, p.y) < 0.7 || !dry(p, 16)) continue;
        if (Math.hypot(p.x - center.x, p.y - center.y) < VILLAGE_RADIUS + 50) continue;
        if (Math.hypot(p.x - heart.x, p.y - heart.y) < GROUNDS_RADIUS + 20) continue;
        if (landmarks.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 60)) continue;
        if (folkHomes.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 110)) continue;
        folkHomes.push(p);
    }

    return { village, castle, grounds, landmarks, groundsDecor: decorateGrounds(rng, castle, heart), folkHomes };
}

/**
 * The castle grounds: a ring of lanterns, statues flanking the approach,
 * crystal clusters at the corners and beds of glowing flowers. The space in
 * front of the gate stays open (room for armies to gather and fight).
 */
function decorateGrounds (rng: Rng, castle: Structure, heart: Vec2): Decoration[]
{
    const out: Decoration[] = [];
    const add = (kind: DecorationKind, x: number, y: number, variant = 0, flip = false) =>
        out.push({ kind, x: Math.round(x), y: Math.round(y), flip, variant });
    const front = castle.y; // the castle's front wall

    // Statues flanking the approach to the gate.
    for (const side of [-1, 1])
    {
        add('faeStatue', castle.x + side * 34, front + 40, 0, side > 0);
        add('faeStatue', castle.x + side * 34, front + 92, 0, side > 0);
    }
    // Lanterns around the grounds (front half, where armies come and go).
    for (let k = 0; k < 9; k++)
    {
        const a = Math.PI * (0.05 + k * 0.1125);
        add('lantern', heart.x + Math.cos(a) * 140, heart.y + Math.sin(a) * 118 + 20);
    }
    // Crystals at the castle's corners and elven pillars at the grounds' edge.
    add('crystalCluster', castle.x - 116, front - 6, 0);
    add('crystalCluster', castle.x + 116, front - 6, 1, true);
    add('elvenPillar', heart.x - 146, heart.y - 30, 0);
    add('elvenPillar', heart.x + 146, heart.y - 30, 0, true);
    // Flower beds along the castle walls and around the forecourt.
    for (let i = 0; i < 26; i++)
    {
        const side = i % 2 === 0 ? -1 : 1;
        const x = castle.x + side * randRange(rng, 60, 128);
        const y = front + randRange(rng, 8, 110);
        if (Math.abs(x - castle.x) < 48 && y < front + 120) continue; // keep the approach clear
        add('glowFlower', x, y, randInt(rng, 0, 2), rng() < 0.5);
    }
    return out;
}

/**
 * The fae village: cottages in a loose ring around a glade with a glowing
 * fountain, lanterns along the square, gardens of glowing flowers, and
 * plenty of forest folk to recruit.
 */
function buildFaeVillage (rng: Rng, center: Vec2, firstId: number, villagers: { min: number; max: number }): Village
{
    const houses: Structure[] = [];
    const taken: Rect[] = [];
    const overlaps = (r: Rect) => taken.some((t) => r.x < t.x + t.width && r.x + r.width > t.x && r.y < t.y + t.height && r.y + r.height > t.y);
    taken.push({ x: center.x - 38, y: center.y - 30, width: 76, height: 56 }); // the glade

    const count = randInt(rng, 5, 6);
    const start = rng() * Math.PI * 2;
    for (let i = 0; i < count; i++)
    {
        for (let attempt = 0; attempt < 40; attempt++)
        {
            const angle = start + (i / count) * Math.PI * 2 + randRange(rng, -0.35, 0.35);
            const r = randRange(rng, 64, 96);
            const house: Structure = {
                id: firstId + houses.length, type: 'faeHouse',
                x: Math.round(center.x + Math.cos(angle) * r),
                y: Math.round(center.y + Math.sin(angle) * r * 0.78 + 14),
                variant: Math.floor(rng() * 3),
            };
            const area = structureArea(house, 10);
            area.height += 8;
            if (overlaps(area)) continue;
            taken.push(area);
            houses.push(house);
            break;
        }
    }

    const decorations: Decoration[] = [];
    const add = (kind: DecorationKind, x: number, y: number, width: number, height: number, variant = 0) => {
        const rect = { x: x - width / 2 - 3, y: y - height - 3, width: width + 6, height: height + 6 };
        if (overlaps(rect)) return false;
        taken.push(rect);
        decorations.push({ kind, x: Math.round(x), y: Math.round(y), flip: rng() < 0.5, variant });
        return true;
    };

    // The fountain in the middle of the glade, lanterns at its corners.
    decorations.push({ kind: 'faeFountain', x: center.x, y: center.y + 4, flip: false, variant: 0 });
    // (The bottom pair sits beside the square, clear of the roads leaving the village gate.)
    for (const [dx, dy] of [[-34, -16], [34, -16], [-42, 8], [42, 8]])
    {
        decorations.push({ kind: 'lantern', x: center.x + dx, y: center.y + dy, flip: false, variant: 0 });
    }
    // Gardens of glowing flowers beside the cottages.
    for (const house of houses)
    {
        for (const side of rng() < 0.5 ? [-1, 1] : [1, -1])
        {
            if (add('glowFlower', house.x + side * 30, house.y + 2, 10, 8, Math.floor(rng() * 3))) break;
        }
    }

    const villagerHomes: Vec2[] = [];
    const folk = randInt(rng, villagers.min, villagers.max);
    for (let i = 0; i < folk; i++)
    {
        const angle = (i / folk) * Math.PI * 2 + rng() * 0.3;
        villagerHomes.push({ x: Math.round(center.x + Math.cos(angle) * 26), y: Math.round(center.y + Math.sin(angle) * 17 + 6) });
    }

    return { id: 100, center, radius: VILLAGE_RADIUS, houses, decorations, villagerHomes, style: 'fae', folk: 'sylvan' };
}

interface ForestDecorContext {
    biomes: BiomeMap;
    playArea: Rect;
    /** Spot is free of structures, trails, water and villages. */
    isFree: (p: Vec2) => boolean;
    /** Other solid scenery already placed nearby (to keep gaps between trunks). */
    solids: Vec2[];
    /** The forest's paths (trees line them). */
    paths: readonly (readonly Vec2[])[];
    /** Open areas trees stay out of (castle grounds, around landmarks). */
    clearings: readonly { center: Vec2; radius: number }[];
}

/**
 * The forest's scenery: trees at the edges, along the paths and in a few
 * scenic groves; open glades everywhere else. Every tree keeps at least
 * `TRUNK_GAP` px from the next solid thing, so armies always find a way through.
 */
export function decorateForest (rng: Rng, ctx: ForestDecorContext): Decoration[]
{
    const out: Decoration[] = [];
    const { playArea } = ctx;
    const TRUNK_GAP = 30;
    const randomSpot = () => ({
        x: randRange(rng, playArea.x + 6, playArea.x + playArea.width - 6),
        y: randRange(rng, playArea.y + 10, playArea.y + playArea.height - 2),
    });
    const fae = (p: Vec2) => forestAt(ctx.biomes, p.x, p.y);
    const inClearing = (p: Vec2) => ctx.clearings.some((c) => Math.hypot(p.x - c.center.x, p.y - c.center.y) < c.radius);
    const add = (kind: DecorationKind, p: Vec2, variant = 0) => out.push({ kind, x: Math.round(p.x), y: Math.round(p.y), flip: rng() < 0.5, variant });
    const spaced = (p: Vec2, gap: number) => !ctx.solids.some((q) => Math.abs(q.x - p.x) < gap && Math.abs(q.y - p.y) < gap && Math.hypot(q.x - p.x, q.y - p.y) < gap);
    /** Plant a tree here if the spot is free, open and well spaced. */
    const tree = (p: Vec2, kind: DecorationKind, variant: number, gap = TRUNK_GAP) => {
        if (fae(p) < 0.35 || !ctx.isFree(p) || inClearing(p) || !spaced(p, gap)) return false;
        ctx.solids.push(p);
        add(kind, p, variant);
        return true;
    };
    const anyTree = (): [DecorationKind, number] => {
        const r = rng();
        return r < 0.34 ? ['moonTree', randInt(rng, 0, 1)] : r < 0.64 ? ['spiralTree', randInt(rng, 0, 1)] : r < 0.8 ? ['birch', randInt(rng, 0, 1)] : ['elderTree', rng() < 0.5 ? 0 : 2];
    };

    // 1. The forest's edges: a belt of trees where the forest meets the grassland...
    for (let i = 0; i < 160; i++)
    {
        const p = randomSpot();
        const f = fae(p);
        if (f < 0.35 || f > 0.8) continue;
        const [kind, variant] = anyTree();
        tree(p, kind, variant, 34);
    }
    // ...and a dense wall at the map border.
    const left = playArea.x;
    const top = playArea.y;
    const border = (x: number, y: number) => {
        const p = { x, y };
        if (fae(p) < 0.5 || !ctx.isFree(p)) return;
        add(rng() < 0.5 ? 'moonTree' : 'spiralTree', p, randInt(rng, 0, 1));
    };
    for (let x = left; x <= left + playArea.width; x += randRange(rng, 18, 28)) border(x, top + randRange(rng, -6, 2));
    for (let y = top; y <= top + playArea.height; y += randRange(rng, 18, 28)) border(left + randRange(rng, -6, 0), y);

    // 2. Trees lining the paths, now and then, on either side.
    for (const path of ctx.paths)
    {
        for (let i = 0; i < path.length - 1; i++)
        {
            const a = path[i];
            const b = path[i + 1];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            if (length < 1) continue;
            const nx = -(b.y - a.y) / length;
            const ny = (b.x - a.x) / length;
            for (let t = 0; t < length; t += 46)
            {
                if (rng() > 0.55) continue;
                const side = rng() < 0.5 ? -1 : 1;
                const off = randRange(rng, 22, 30) * side;
                const p = { x: a.x + ((b.x - a.x) * t) / length + nx * off, y: a.y + ((b.y - a.y) * t) / length + ny * off };
                const [kind, variant] = rng() < 0.5 ? ['moonTree', randInt(rng, 0, 1)] as [DecorationKind, number] : ['spiralTree', randInt(rng, 0, 1)] as [DecorationKind, number];
                tree(p, kind, variant);
            }
        }
    }

    // 3. Scenic groves, each with its own character, ringed by a flower meadow.
    const groves: ((n: number) => [DecorationKind, number])[] = [
        () => ['moonTree', 0],                                         // a silver moon grove
        () => ['spiralTree', 0],                                       // a rose blossom grove
        () => ['giantShroom', randInt(rng, 0, 1)],                     // a giant mushroom grove
        (n) => (n === 0 ? ['elderTree', 0] : ['birch', randInt(rng, 0, 1)]), // an ancient elder among birches
        () => ['spiralTree', 1],                                       // an amber grove
    ];
    for (const theme of groves)
    {
        let centre: Vec2 | null = null;
        for (let attempt = 0; attempt < 120 && !centre; attempt++)
        {
            const p = randomSpot();
            if (fae(p) >= 0.8 && ctx.isFree(p) && !inClearing(p) && spaced(p, 90)) centre = p;
        }
        if (!centre) continue;
        let planted = 0;
        for (let attempt = 0; attempt < 40 && planted < 6; attempt++)
        {
            const a = rng() * Math.PI * 2;
            const r = planted === 0 ? 0 : randRange(rng, 26, 56);
            const [kind, variant] = theme(planted);
            if (tree({ x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r * 0.75 }, kind, variant, 26)) planted++;
        }
        // Meadow around the grove.
        for (let k = 0; k < 14; k++)
        {
            const a = rng() * Math.PI * 2;
            const r = randRange(rng, 30, 80);
            const p = { x: centre.x + Math.cos(a) * r, y: centre.y + Math.sin(a) * r * 0.75 };
            if (ctx.isFree(p)) add(rng() < 0.6 ? 'glowFlower' : 'lushFern', p, randInt(rng, 0, 2));
        }
    }

    // 4. The glades: open, colourful ground with ruins here and there.
    const place = (count: number, minFae: number, make: () => [DecorationKind, number], solid = false) => {
        for (let i = 0; i < count; i++)
        {
            for (let attempt = 0; attempt < 40; attempt++)
            {
                const p = randomSpot();
                if (fae(p) < minFae || !ctx.isFree(p)) continue;
                if (solid && (inClearing(p) || !spaced(p, 40))) continue;
                if (solid) ctx.solids.push(p);
                const [kind, variant] = make();
                add(kind, p, variant);
                break;
            }
        }
    };
    place(150, 0.25, () => ['glowFlower', randInt(rng, 0, 2)]);
    place(120, 0.25, () => ['lushFern', 0]);
    place(40, 0.3, () => ['shrub', randInt(rng, 0, 2)]);
    place(30, 0.35, () => ['sapling', 0]);
    place(80, 0.2, () => ['tallGrass', 0]);
    place(40, 0.3, () => ['flowers', 0]);
    place(14, 0.5, () => ['fairyRing', 0]);
    // Mystical ruins and crystals.
    place(7, 0.55, () => ['elvenPillar', randInt(rng, 0, 1)], true);
    place(3, 0.6, () => ['faeStatue', 0], true);
    place(5, 0.5, () => ['crystalCluster', randInt(rng, 0, 1)], true);
    place(3, 0.6, () => ['runestone', 0], true);
    // Clusters of glowing mushrooms.
    for (let i = 0; i < 34; i++)
    {
        let c: Vec2 | null = null;
        for (let attempt = 0; attempt < 40 && !c; attempt++) { const p = randomSpot(); if (fae(p) >= 0.4 && ctx.isFree(p)) c = p; }
        if (!c) continue;
        const accent = pick(rng, ['purple', 'green', 'amber'] as const);
        for (let k = randInt(rng, 3, 6); k > 0; k--)
        {
            const p = { x: c.x + randRange(rng, -14, 14), y: c.y + randRange(rng, -9, 9) };
            if (ctx.isFree(p)) out.push({ kind: 'glowShroom', x: Math.round(p.x), y: Math.round(p.y), flip: rng() < 0.5, variant: 0, accent });
        }
    }

    return out;
}
