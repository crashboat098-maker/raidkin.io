import { createRng, pick, randInt, randRange, type Rng } from './Random';
import { placeStructures, rectContains, STRUCTURE_SPECS, structureArea, structureColliders, type Structure } from './Structures';
import { generateTrails, routeTrail, trailTileMask, type Trail } from './Trails';
import type { Rect, Vec2 } from './Types';
import { placeVillages, type Village } from './Villages';
import { extendRivers, generateWater, isWater, isWaterSurface, shiftWater, type WaterBody, type WaterLayout, type WaterSettings } from './Water';
import { createBiomeMap, forestAt, regionOf, swampAt, volcanicAt, type BiomeMap } from './Biomes';
import { decorateForest, planForest } from './EnchantedForest';
import { decorateWastes, planWastes } from './VolcanicWastes';
import { decorateSwamp, planSwamp } from './Swamp';
import { applyDeckRects, generateLavaRivers, isLava, isLavaSurface, planLavaBridges, riverSkew, type LavaLayout } from './LavaRivers';
import { applyBridges, findBridges, type Bridge } from './Bridges';
import { lavaPoolCollider, planVolcano, volcanoInfluence, volcanoZone, type VolcanoLayout } from './Volcano';
import { castleSite, type CastleSite } from './Castles';

/**
 * Builds the battlefield as plain data: ground tiles, trails, structures,
 * decorations, and which areas are solid. No Phaser and no drawing here.
 * The render code turns this data into visuals.
 */

/** Ground tile types. The numbers are positions in the ground tileset image. */
export const GroundTile = {
    Grass: 0,
    GrassAlt: 1,
    GrassTufts: 2,
    DarkGrass: 3,
    DarkGrassAlt: 4,
    Dirt: 5,
    Canopy: 6,
    CanopyAlt: 7,
    // Volcano biome
    Ash: 8,
    AshAlt: 9,
    Scorched: 10,
    Cliff: 11,
    // Enchanted forest
    FaeMoss: 12,
    FaeMossAlt: 13,
    FaeBloom: 14,
    FaeCanopy: 15,
    // Swamp
    Mud: 16,
    SwampMoss: 17,
    SwampMossAlt: 18,
    SwampCanopy: 19,
} as const;

export const GROUND_TILE_COUNT = 20;

/** Decorative glow colours. Cyan is deliberately absent: it's reserved for Soul Shards. */
export type Accent = 'green' | 'purple' | 'amber';
export const ACCENTS: readonly Accent[] = ['green', 'purple', 'amber'];

export type DecorationKind =
    // Rocks and ruins
    | 'rock' | 'rockSmall' | 'boulder' | 'pillar' | 'ruinWall' | 'runestone' | 'gravestone'
    // Trees and plants
    | 'deadTree' | 'largeTree' | 'pine' | 'bush' | 'fern' | 'tallGrass' | 'stump' | 'log'
    // Small details and magic
    | 'bones' | 'glowShroom' | 'wisp'
    // Village props
    | 'fence' | 'well' | 'hay' | 'crates' | 'flowers'
    // Mythical trees and vegetation
    | 'elderTree' | 'birch' | 'willow' | 'giantShroom' | 'sapling' | 'shrub'
    // River banks
    | 'shoreRock' | 'reeds'
    // Volcano biome
    | 'charredTree' | 'basalt' | 'vent'
    // Enchanted forest
    | 'moonTree' | 'spiralTree' | 'glowFlower' | 'fairyRing' | 'lushFern' | 'elvenPillar' | 'faeFountain' | 'lantern'
    | 'faeStatue' | 'crystalCluster'
    // More tree species for the whole world
    | 'goldenOak' | 'cypress' | 'twistedYew'
    // Riverbanks
    | 'pebbles'
    // Volcanic wastes
    | 'ashShrub' | 'obsidian' | 'gothicRuin' | 'gargoyle' | 'brazier'
    // Volcano surroundings: half-burnt trees where grass meets ash, small ground fires
    | 'scorchedTree' | 'smallFire'
    // Swamp: twisted vine-hung trees, bushes, mushrooms, glowing plants, lily pads, a village totem
    | 'swampTree' | 'swampBush' | 'swampShroom' | 'glowPlant' | 'lilyPad' | 'swampTotem';

export interface Decoration {
    kind: DecorationKind;
    /** Bottom-centre of the decoration, in world pixels. */
    x: number;
    y: number;
    /** Mirror horizontally, for variety. */
    flip: boolean;
    /** Which art variant to use (0 if the kind has only one). */
    variant: number;
    /** Glow colour, for glowing decorations. */
    accent?: Accent;
}

/** How many art variants each kind has (default 1). */
export const DECORATION_VARIANTS: Partial<Record<DecorationKind, number>> = {
    largeTree: 3,
    pine: 2,
    boulder: 2,
    elderTree: 3,
    birch: 2,
    giantShroom: 2,
    shrub: 3,
    shoreRock: 3,
    charredTree: 2,
    basalt: 2,
    moonTree: 2,
    spiralTree: 2,
    glowFlower: 3,
    elvenPillar: 2,
    // (New tree species have 2 variants each, like the trees they sometimes replace,
    // so the original map's random layout comes out exactly the same.)
    goldenOak: 2,
    cypress: 2,
    twistedYew: 2,
    crystalCluster: 2,
    pebbles: 3,
    ashShrub: 2,
    obsidian: 2,
    gothicRuin: 2,
    scorchedTree: 2,
    swampTree: 2,
    swampBush: 2,
    swampShroom: 2,
    glowPlant: 2,
    lilyPad: 2,
};

/**
 * Solid base of decorations that block movement: width x depth, centred on
 * the decoration's x and ending at its y. Everything else is walk-over.
 */
export const DECORATION_COLLIDERS: Partial<Record<DecorationKind, { width: number; depth: number }>> = {
    largeTree: { width: 8, depth: 5 },
    pine: { width: 6, depth: 4 },
    deadTree: { width: 5, depth: 4 },
    boulder: { width: 18, depth: 8 },
    ruinWall: { width: 22, depth: 5 },
    pillar: { width: 8, depth: 4 },
    log: { width: 20, depth: 5 },
    runestone: { width: 8, depth: 4 },
    fence: { width: 24, depth: 3 },
    well: { width: 12, depth: 5 },
    hay: { width: 10, depth: 4 },
    crates: { width: 10, depth: 4 },
    elderTree: { width: 10, depth: 6 },
    birch: { width: 4, depth: 3 },
    willow: { width: 8, depth: 5 },
    giantShroom: { width: 6, depth: 4 },
    shoreRock: { width: 8, depth: 3 },
    charredTree: { width: 5, depth: 4 },
    basalt: { width: 12, depth: 5 },
    moonTree: { width: 8, depth: 5 },
    spiralTree: { width: 7, depth: 5 },
    elvenPillar: { width: 8, depth: 4 },
    faeFountain: { width: 18, depth: 7 },
    lantern: { width: 3, depth: 3 },
    faeStatue: { width: 8, depth: 4 },
    crystalCluster: { width: 9, depth: 4 },
    goldenOak: { width: 9, depth: 5 },
    cypress: { width: 5, depth: 4 },
    twistedYew: { width: 7, depth: 5 },
    obsidian: { width: 10, depth: 4 },
    gothicRuin: { width: 26, depth: 5 },
    gargoyle: { width: 8, depth: 4 },
    brazier: { width: 8, depth: 4 },
    scorchedTree: { width: 6, depth: 4 },
    swampTree: { width: 8, depth: 5 },
    swampTotem: { width: 6, depth: 4 },
};

/**
 * Decorations that have a solid base for map generation (spacing, roads)
 * but that armies can walk straight through: trees and giant mushrooms. Bushes and other
 * plants have no collider at all. Rocks, logs, ruins and buildings stay solid.
 */
const WALK_THROUGH_DECORATIONS: ReadonlySet<DecorationKind> = new Set<DecorationKind>([
    'largeTree', 'pine', 'deadTree', 'elderTree', 'birch', 'willow', 'charredTree', 'moonTree', 'spiralTree',
    'goldenOak', 'cypress', 'twistedYew', 'scorchedTree', 'swampTree',
    'giantShroom',
]);

/** The collider that blocks movement in play (null if armies can walk through it). */
function movementCollider (d: Decoration): Rect | null
{
    return WALK_THROUGH_DECORATIONS.has(d.kind) ? null : decorationCollider(d);
}

export interface BattlefieldLayout {
    tileSize: number;
    widthInTiles: number;
    heightInTiles: number;
    worldWidth: number;
    worldHeight: number;
    /** ground[row][column] = GroundTile value */
    ground: number[][];
    /** Paths and roads drawn over the ground. */
    trails: Trail[];
    /** Shallow water: rivers, streams, ponds (walkable but slow; bridges are dry). */
    water: WaterLayout;
    /** Where trails cross water. */
    bridges: Bridge[];
    /** The volcano biome in one corner (null if disabled). */
    volcano: VolcanoLayout | null;
    /** Corner biome regions of the expanded map (null for the original-size map). */
    biomes: BiomeMap | null;
    /** Homes of forest folk roaming the enchanted forest (recruitable neutrals). */
    folkHomes: Vec2[];
    /** Lava rivers of the volcanic wastes: walkable, but they burn (null = none). */
    lava: LavaLayout | null;
    /** Wide basalt bridges over the lava rivers (safe crossings). */
    lavaBridges: Bridge[];
    /** Medieval villages (their houses are also in `structures`). */
    villages: Village[];
    /** Gameplay landmarks (barracks, towers, keeps...). */
    structures: Structure[];
    /** The three Lucky Spin castles and their circles (none on the original-size map). */
    castles: CastleSite[];
    /** Visual terrain objects (some are solid, see DECORATION_COLLIDERS). */
    decorations: Decoration[];
    /** Every solid rectangle on the map (structures + solid decorations). */
    obstacles: Rect[];
    /**
     * Tiles where items (Soul Shards) may appear: open ground, away from
     * the map edge, structures and decorations. Stored as row * widthInTiles + col.
     */
    itemSpawnTiles: number[];
    /** Where the commander is allowed to walk. */
    playArea: Rect;
    spawn: Vec2;
}

export interface LayoutSettings {
    seed: number;
    tileSize: number;
    widthInTiles: number;
    heightInTiles: number;
    borderTiles: number;
    spawnClearRadius: number;
    villages?: number;
    villagersPerVillage?: { min: number; max: number };
    water?: WaterSettings;
    /** Add the volcano biome (default true). */
    volcano?: boolean;
    /** Grow the map by this many tiles on every side, keeping the original map in the middle. */
    expandTiles?: number;
    /** How far each corner biome reaches from its corner (world px). */
    biomeRadius?: number;
    /** Recruitable folk in the enchanted forest's village, and roaming its woods. */
    faeVillagers?: { min: number; max: number };
    forestFolk?: number;
    /** Recruitable folk in each ash village of the volcanic wastes. */
    ashVillagers?: { min: number; max: number };
    /** Recruitable bog folk in each swamp village. */
    bogVillagers?: { min: number; max: number };
    /** How many lava rivers flow from the volcano, and how far apart their extra wide bridges are. */
    lavaRivers?: number;
    lavaBridgeSpacing?: number;
}

/**
 * Build the whole battlefield. With `expandTiles`, the original map (the
 * "core": grassland, rivers, villages, castles, volcano) is generated
 * exactly as before and placed in the middle of a larger world, whose
 * corners are biome regions (see Biomes.ts).
 */
export function generateBattlefield (settings: LayoutSettings): BattlefieldLayout
{
    const expand = settings.expandTiles ?? 0;
    const core = generateCore(settings, expand > 0);
    return expand > 0 ? expandBattlefield(core, settings, expand) : core;
}

function generateCore (settings: LayoutSettings, openEdges: boolean): BattlefieldLayout
{
    const rng = createRng(settings.seed);
    const { tileSize, widthInTiles: cols, heightInTiles: rows } = settings;
    const worldWidth = cols * tileSize;
    const worldHeight = rows * tileSize;
    const inset = settings.borderTiles * tileSize;

    const playArea: Rect = {
        x: inset,
        y: inset,
        width: worldWidth - inset * 2,
        height: worldHeight - inset * 2,
    };
    const spawn: Vec2 = { x: worldWidth / 2, y: worldHeight / 2 };

    // Smooth noise maps decide where dark grass, dirt, and forest edge go.
    const darkness = valueNoise(rng, cols, rows, 10);
    const dirtiness = valueNoise(rng, cols, rows, 7);
    const edgeWobble = valueNoise(rng, cols, rows, 3);

    // The volcano biome claims one corner first; everything else keeps clear of it.
    const volcano = settings.volcano === false ? null : planVolcano(createRng(settings.seed ^ 0x701c), playArea, 1);
    const biomeAt = (p: Vec2) => volcanoInfluence(volcano, p.x, p.y);

    const ground = buildGround(rng, cols, rows, darkness, dirtiness, edgeWobble,
        (col, row) => biomeAt({ x: (col + 0.5) * tileSize, y: (row + 0.5) * tileSize }));

    // Structures and trails use their own random streams, so changing them
    // doesn't reshuffle the ground.
    const landmarks = [
        ...(volcano ? [volcano.cone] : []),
        ...placeStructures(createRng(settings.seed ^ 0x5157), playArea, spawn, volcano ? [volcano.cone] : []),
    ];

    // Villages (their houses join the structure list for drawing and collision).
    const villages = placeVillages(createRng(settings.seed ^ 0x0b11), {
        count: settings.villages ?? 0,
        villagers: settings.villagersPerVillage ?? { min: 4, max: 6 },
    }, { playArea, spawn, structures: landmarks, firstStructureId: landmarks.length + 1 });
    const structures = [...landmarks, ...villages.flatMap((v) => v.houses)];
    const villageZones: Rect[] = villages.map((v) => {
        const r = v.radius + 16; // a little extra so garden props never touch a shore
        return { x: v.center.x - r, y: v.center.y - r, width: r * 2, height: r * 2 };
    });

    // Water keeps clear of structures, villages and the start.
    const water = generateWater(createRng(settings.seed ^ 0x3a7e), settings.water ?? { rivers: 0, streams: 0, ponds: 0 }, {
        worldWidth, worldHeight, playArea, spawn,
        avoid: [...landmarks.filter((s) => s.type !== 'volcano').map((s) => structureArea(s, 6)), ...villageZones, ...(volcano ? [volcanoZone(volcano)] : [])],
    });

    // Trails link the start, the landmarks and the villages; villages get little paths to each door.
    const trails = [
        ...generateTrails(createRng(settings.seed ^ 0x7a11), spawn, structures, playArea, villages.map((v) => ({ x: v.center.x, y: v.center.y + 24 }))),
        ...villages.flatMap((v) => villagePaths(v, createRng(settings.seed ^ (0x1a2e + v.id)), playArea)),
    ];
    // A main road running through a village garden wins: drop that prop.
    const roads = trails.filter((t) => !t.plaza && t.width !== 6);
    for (const v of villages)
    {
        v.decorations = v.decorations.filter((d) => {
            const r = decorationCollider(d);
            if (!r || d.kind === 'well') return true;
            return !roads.some((t) => t.points.some((p, i) => {
                const q = t.points[i + 1];
                if (!q) return false;
                const steps = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 3);
                for (let k = 0; k <= steps; k++)
                {
                    const x = p.x + ((q.x - p.x) * k) / steps;
                    const y = p.y + ((q.y - p.y) * k) / steps;
                    const reach = t.width / 2 + 2;
                    if (x > r.x - reach && x < r.x + r.width + reach && y > r.y - reach && y < r.y + r.height + reach) return true;
                }
                return false;
            }));
        });
    }

    const trailMask = trailTileMask(trails, cols, rows, tileSize, 4);
    const onTrail =(p: Vec2) => trailMask[clampIndex(p.y / tileSize, rows) * cols + clampIndex(p.x / tileSize, cols)] === 1;

    // Where a trail crosses water, it becomes a bridge (dry to walk on).
    const bridges = findBridges(trails, water);
    applyBridges(water, bridges);

    // Lava pools never sit on a trail.
    if (volcano)
    {
        volcano.pools = volcano.pools.filter((pool) => {
            for (let dx = -pool.rx - 8; dx <= pool.rx + 8; dx += 4)
            {
                for (let dy = -pool.ry - 8; dy <= pool.ry + 8; dy += 4) if (onTrail({ x: pool.x + dx, y: pool.y + dy })) return false;
            }
            return true;
        });
    }
    const pools = volcano?.pools ?? [];
    const inPool = (p: Vec2, margin: number) => pools.some((pool) => ((p.x - pool.x) / (pool.rx + margin)) ** 2 + ((p.y - pool.y) / (pool.ry + margin)) ** 2 <= 1);

    const inVillage = (p: Vec2) => villages.some((v) => Math.hypot(p.x - v.center.x, p.y - v.center.y) < v.radius + 12);
    // A small margin: decorations are stored at rounded pixels, which can nudge them over a shoreline.
    const nearWater = (p: Vec2) => isWaterSurface(water, p.x - 3, p.y + 2) || isWaterSurface(water, p.x + 3, p.y + 2) || isWaterSurface(water, p.x, p.y - 6);
    const decorations = placeDecorations(rng, {
        tileSize, worldWidth, worldHeight, playArea, spawn, structures,
        spawnClearRadius: settings.spawnClearRadius,
        darknessAt: (p) => darkness[clampIndex(p.y / tileSize, rows)][clampIndex(p.x / tileSize, cols)],
        onTrail,
        // Ordinary vegetation stays out of villages, water and the volcano's ash.
        blocked: (p) => inVillage(p) || isWaterSurface(water, p.x, p.y) || nearWater(p) || biomeAt(p) > 0.3,
        biomeAt,
        nearWater,
        waterSurface: (p) => isWaterSurface(water, p.x, p.y),
        waterBodies: water.bodies,
        inVillage,
        inPool,
        // In an expanded map the old edge opens onto new land: no treeline wall around it.
        skipTreeline: openEdges,
    });
    decorations.push(...villages.flatMap((v) => v.decorations));

    const obstacles: Rect[] = [
        ...structures.flatMap(structureColliders),
        ...decorations.flatMap((d) => {
            const collider = movementCollider(d);
            return collider ? [collider] : [];
        }),
        ...pools.map(lavaPoolCollider),
    ];

    const itemSpawnTiles = findItemSpawnTiles(cols, rows, tileSize, playArea, structures, decorations)
        .filter((tile) => {
            // No shards or wandering homes in the water or in lava.
            const x = (tile % cols) * tileSize;
            const y = Math.floor(tile / cols) * tileSize;
            return ![[2, 2], [14, 2], [2, 14], [14, 14], [8, 8]].some(([dx, dy]) => isWater(water, x + dx, y + dy) || inPool({ x: x + dx, y: y + dy }, 10));
        });

    return {
        tileSize,
        widthInTiles: cols,
        heightInTiles: rows,
        worldWidth,
        worldHeight,
        ground,
        trails,
        water,
        bridges,
        volcano,
        biomes: null,
        folkHomes: [],
        lava: null,
        lavaBridges: [],
        villages,
        structures,
        castles: [],
        decorations,
        obstacles,
        itemSpawnTiles,
        playArea,
        spawn,
    };
}

// ---------------------------------------------------------------------------
// The expanded map: the original map in the middle, biome corners around it
// ---------------------------------------------------------------------------

function expandBattlefield (core: BattlefieldLayout, settings: LayoutSettings, expand: number): BattlefieldLayout
{
    const T = settings.tileSize;
    const off = expand * T;
    const cols = core.widthInTiles + expand * 2;
    const rows = core.heightInTiles + expand * 2;
    const worldWidth = cols * T;
    const worldHeight = rows * T;
    const inset = settings.borderTiles * T;
    const playArea: Rect = { x: inset, y: inset, width: worldWidth - inset * 2, height: worldHeight - inset * 2 };
    const seed = settings.seed;

    // 1. The original map, moved unchanged into the middle. Points can be shared
    //    (a trail starts at a structure's doorstep...), so each moves exactly once.
    const spawn = { x: core.spawn.x + off, y: core.spawn.y + off };
    const coreArea: Rect = { ...core.playArea, x: core.playArea.x + off, y: core.playArea.y + off };
    const moved = new Set<Vec2>();
    const move = (p: Vec2) => { if (moved.has(p)) return; moved.add(p); p.x += off; p.y += off; };
    core.structures.forEach(move);
    core.decorations.forEach(move);
    for (const v of core.villages) { move(v.center); v.villagerHomes.forEach(move); v.houses.forEach(move); v.decorations.forEach(move); }
    for (const t of core.trails) t.points.forEach(move);
    const volcano = core.volcano;
    if (volcano)
    {
        move(volcano.cone); move(volcano.center); volcano.pools.forEach(move);
        for (const crack of volcano.fissures) crack.forEach(move);
    }

    // 2. Biome corners around it.
    const biomes = createBiomeMap(worldWidth, worldHeight, coreArea, settings.biomeRadius ?? 860);
    const heatAt = (p: Vec2) => volcanicAt(biomes, volcano, p.x, p.y);
    const faeAt = (p: Vec2) => forestAt(biomes, p.x, p.y);

    // 3. Ground: new land all around, the original ground pasted in the middle
    //    (minus its old forest border, which now opens onto the new land).
    const rng = createRng(seed ^ 0x0e9a);
    const darkness = valueNoise(rng, cols, rows, 10);
    const dirtiness = valueNoise(rng, cols, rows, 7);
    const edgeWobble = valueNoise(rng, cols, rows, 3);
    const tileCentre = (col: number, row: number) => ({ x: (col + 0.5) * T, y: (row + 0.5) * T });
    const ground = buildGround(rng, cols, rows, darkness, dirtiness, edgeWobble,
        (c, r) => heatAt(tileCentre(c, r)), (c, r) => faeAt(tileCentre(c, r)), (c, r) => swampAt(biomes, (c + 0.5) * T, (r + 0.5) * T));
    const oldBorder = new Set<number>([GroundTile.Canopy, GroundTile.CanopyAlt, GroundTile.Cliff]);
    core.ground.forEach((line, r) => line.forEach((tile, c) => { if (!oldBorder.has(tile)) ground[r + expand][c + expand] = tile; }));

    // 4. Water: the same rivers, streams and ponds; rivers now run on to the new map edge.
    const water = shiftWater(core.water, off, worldWidth, worldHeight);
    extendRivers(water, createRng(seed ^ 0x51ee), coreArea, playArea);
    const wet = (p: Vec2) => isWaterSurface(water, p.x, p.y);

    // 5. The enchanted forest (top-left): the giant castle, the fae village, landmarks, folk.
    const forest = planForest(createRng(seed ^ 0xfae5), {
        region: regionOf(biomes, 'enchanted')!, biomes, playArea, isWet: wet,
        firstStructureId: Math.max(...core.structures.map((s) => s.id)) + 1,
        villagers: settings.faeVillagers ?? { min: 8, max: 10 },
        folk: settings.forestFolk ?? 6,
    });
    const forestStructures = [forest.castle, ...forest.village.houses, ...forest.landmarks];

    // 5b. The volcanic wastes (top-right): gothic fortress, ruined cathedral, spires, ash villages.
    const wastes = planWastes(createRng(seed ^ 0xa5e5), {
        region: regionOf(biomes, 'volcanic')!, biomes, playArea, isWet: wet,
        taken: volcano ? [structureArea(volcano.cone, 40)] : [],
        firstStructureId: Math.max(...forestStructures.map((s) => s.id)) + 1,
        villagers: settings.ashVillagers ?? { min: 5, max: 7 },
    });
    if (volcano) volcano.fissures.push(...wastes.fissures);

    // 5d. The swamp (bottom-right): stilt-hut villages, murky pools and waterways, boardwalks.
    const swampRegion = regionOf(biomes, 'swamp')!;
    const swamp = planSwamp(createRng(seed ^ 0x5a3b), {
        region: swampRegion, biomes, playArea, water, isWet: wet,
        taken: core.structures.map((s) => structureArea(s, 20)),
        firstStructureId: Math.max(...[...forestStructures, ...wastes.landmarks, ...wastes.villages.flatMap((v) => v.houses)].map((s) => s.id)) + 1,
        villagers: settings.bogVillagers ?? { min: 5, max: 7 },
    });
    const bogAt = (p: Vec2) => swampAt(biomes, p.x, p.y);
    // Muddy banks around the pools.
    for (const pool of swamp.pools)
    {
        const c = pool.points[0];
        const reach = pool.width / 2 + 20;
        for (let r = Math.floor((c.y - reach) / T); r <= Math.floor((c.y + reach) / T); r++)
        {
            for (let col = Math.floor((c.x - reach) / T); col <= Math.floor((c.x + reach) / T); col++)
            {
                if (r < 0 || col < 0 || r >= rows || col >= cols) continue;
                const p = tileCentre(col, r);
                if (Math.hypot(p.x - c.x, p.y - c.y) <= reach && !rectContains(coreArea, p) && bogAt(p) > 0.4) ground[r][col] = GroundTile.Mud;
            }
        }
    }

    const villages = [...core.villages, forest.village, ...wastes.villages, ...swamp.villages];
    const structures = [
        ...core.structures, ...forestStructures, ...wastes.landmarks, ...wastes.villages.flatMap((v) => v.houses), ...swamp.villages.flatMap((v) => v.houses),
        ...(swamp.castle ? [swamp.castle] : []),
    ];
    // The three Lucky Spin castles: the fae castle, the gothic fortress, the swamp castle.
    const fortress = wastes.landmarks.find((s) => s.type === 'gothicFortress');
    const castles: CastleSite[] = [];
    for (const [structure, biome] of [[forest.castle, 'enchanted'], [fortress, 'volcanic'], [swamp.castle, 'swamp']] as const)
    {
        if (structure) castles.push(castleSite(castles.length, structure, biome));
    }

    // 5c. Lava rivers flowing from the volcano's foot out through the wastes,
    //     around every building, village, lava pool and stretch of water.
    const lava = volcano ? generateLavaRivers(createRng(seed ^ 0x1a7a), {
        worldWidth, worldHeight, playArea,
        source: volcano.center,
        outward: { x: worldWidth - volcano.center.x, y: -volcano.center.y },
        avoid: [
            ...structures.map((s) => structureArea(s, 10)),
            ...villages.map((v) => ({ x: v.center.x - v.radius, y: v.center.y - v.radius, width: v.radius * 2, height: v.radius * 2 })),
            ...volcano.pools.map((p) => ({ x: p.x - p.rx - 16, y: p.y - p.ry - 16, width: p.rx * 2 + 32, height: p.ry * 2 + 32 })),
        ],
        isWet: (p) => wet(p) || wet({ x: p.x + 20, y: p.y }) || wet({ x: p.x - 20, y: p.y }) || wet({ x: p.x, y: p.y + 20 }) || wet({ x: p.x, y: p.y - 20 }),
        inBiome: (p) => heatAt(p) > 0.2,
        count: settings.lavaRivers ?? 3,
    }) : null;
    /** Lava (bridged or not) within `margin` px: keep scenery off the rivers and their banks (LAVA_BANK px clear). */
    const nearLava = (p: Vec2, margin: number) => {
        if (!lava) return false;
        if (isLavaSurface(lava, p.x, p.y)) return true;
        // Eight directions, at the margin and halfway, so nothing slips in between samples.
        for (let k = 0; k < 8; k++)
        {
            const a = (k / 8) * Math.PI * 2;
            for (const r of [margin, margin / 2])
            {
                if (isLavaSurface(lava, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r)) return true;
            }
        }
        return false;
    };
    // The original map's own volcano scenery standing where a river now flows makes way for it.
    if (lava) core.decorations = core.decorations.filter((d) => !nearLava({ x: d.x, y: d.y - 2 }, 8));

    // 6. Trails: the old roads that ran off the map carry on to the new edge; the
    //    fae village gets its lanes, a road to the nearest old road, and paths to its landmarks.
    const trng = createRng(seed ^ 0x7e11);
    // New roads steer around buildings and around the original map's solid scenery
    // (rocks, trees), which stays exactly where it was.
    const avoid = [
        ...structures.map((s) => structureArea(s, 6)),
        ...[...core.decorations, ...forest.village.decorations, ...forest.groundsDecor, ...wastes.villages.flatMap((v) => v.decorations), ...swamp.villages.flatMap((v) => v.decorations)].flatMap((d) => {
            const r = decorationCollider(d);
            return r ? [{ x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 }] : [];
        }),
    ];
    const newTrails: Trail[] = [];
    for (const t of core.trails)
    {
        if (t.plaza || t.points.length < 2) continue;
        const end = t.points[t.points.length - 1];
        const onEdge = (a: number, b: number) => Math.abs(a - b) < 3;
        let target: Vec2 | null = null;
        if (onEdge(end.x, coreArea.x)) target = { x: playArea.x + 2, y: end.y };
        else if (onEdge(end.x, coreArea.x + coreArea.width)) target = { x: playArea.x + playArea.width - 2, y: end.y };
        else if (onEdge(end.y, coreArea.y)) target = { x: end.x, y: playArea.y + 2 };
        else if (onEdge(end.y, coreArea.y + coreArea.height)) target = { x: end.x, y: playArea.y + playArea.height - 2 };
        if (target) newTrails.push(routeTrail(trng, end, target, t.kind, t.width, avoid, playArea));
    }
    const roadPoints = core.trails.filter((t) => !t.plaza && t.width !== 6).flatMap((t) => t.points);
    const nearest = (from: Vec2, points: readonly Vec2[]) =>
        points.reduce((best, p) => (Math.hypot(p.x - from.x, p.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y) ? p : best), points[0] ?? spawn);

    // The forest: a marble forecourt before the castle; a road from it to the old roads;
    // the village and the landmarks joined to it by forest paths.
    const castle = forest.castle;
    const forecourt = { x: castle.x, y: castle.y + 96 };
    newTrails.push({ kind: 'stone', width: 56, plaza: true, points: [{ x: castle.x, y: castle.y + 22 }, { x: castle.x, y: castle.y + 84 }] });
    newTrails.push(routeTrail(trng, forecourt, nearest(forecourt, roadPoints), 'stone', 9, avoid, playArea));
    const fv = forest.village;
    const gate = { x: fv.center.x, y: fv.center.y + 26 };
    newTrails.push(routeTrail(trng, gate, forecourt, 'dirt', 7, avoid, playArea));
    for (const s of forest.landmarks)
    {
        const door = { x: s.x, y: s.y + 10 };
        newTrails.push(routeTrail(trng, nearest(door, [gate, forecourt]), door, 'dirt', 6, avoid, playArea));
    }
    newTrails.push(...villagePaths(fv, createRng(seed ^ 0x1a2e ^ fv.id), playArea));
    const forestPaths = newTrails.filter((t) => !t.plaza && t.width >= 6 && faeAt(t.points[0]) > 0.3).map((t) => t.points);

    // The wastes: stone roads from the fortress and cathedral gates to the old roads,
    // and from each ash village to the nearest of them.
    const gates: Vec2[] = [];
    for (const s of wastes.landmarks.filter((l) => l.type !== 'darkSpire'))
    {
        const door = { x: s.x, y: s.y + 12 };
        newTrails.push(routeTrail(trng, door, nearest(door, [...gates, ...roadPoints]), 'stone', 9, avoid, playArea));
        gates.push(door);
    }
    for (const v of wastes.villages)
    {
        const door = { x: v.center.x, y: v.center.y + 26 };
        newTrails.push(routeTrail(trng, door, nearest(door, [...gates, ...roadPoints]), 'stone', 7, avoid, playArea));
        newTrails.push(...villagePaths(v, createRng(seed ^ 0x1a2e ^ v.id), playArea));
    }

    // The swamp: a muddy track from each village to the old roads (wooden walkways
    // wherever it crosses water), and boardwalks across the big pools.
    for (const v of swamp.villages)
    {
        const door = { x: v.center.x, y: v.center.y + 26 };
        newTrails.push(routeTrail(trng, door, nearest(door, roadPoints), 'dirt', 8, avoid, playArea));
        newTrails.push(...villagePaths(v, createRng(seed ^ 0x1a2e ^ v.id), playArea));
    }
    for (const walk of swamp.boardwalks) newTrails.push({ kind: 'dirt', width: 10, points: walk });
    const trails = [...core.trails, ...newTrails];

    // 7. Bridges wherever a trail crosses water (old ones included). Where a new
    //    bridge lands on a bank, any rocks or reeds right on its deck are cleared away.
    const bridges = findBridges(trails, water);
    applyBridges(water, bridges);
    const onDeck = (r: Rect) => bridges.some((b) => !b.edgeOnly && b.points.some((p, i) => {
        const q = b.points[i + 1] ?? p;
        const reach = b.width / 2 + 3;
        for (let t = 0; t <= 1; t += 0.25)
        {
            const x = p.x + (q.x - p.x) * t;
            const y = p.y + (q.y - p.y) * t;
            if (x > r.x - reach && x < r.x + r.width + reach && y > r.y - reach && y < r.y + r.height + reach) return true;
        }
        return false;
    }));
    const bankKinds = new Set<DecorationKind>(['shoreRock', 'reeds', 'willow']);
    core.decorations = core.decorations.filter((d) => {
        if (!bankKinds.has(d.kind)) return true;
        const r = decorationCollider(d) ?? { x: d.x - 4, y: d.y - 3, width: 8, height: 3 };
        return !onDeck(r);
    });
    // 7b. Lava bridges: every road crossing a lava river gets a wide basalt bridge,
    //     and a few more wide crossings are spaced along each river (all perfectly safe).
    // (Each is a squared-off stone structure whose footprint is exactly the safe deck.)
    const lavaBridges: Bridge[] = [];
    if (lava)
    {
        const mid = (pts: readonly Vec2[]) => pts[Math.floor(pts.length / 2)];
        const bctx = {
            avoid: [...structures.map((s) => structureArea(s, 6)), ...(volcano?.pools ?? []).map((p) => ({ x: p.x - p.rx - 6, y: p.y - p.ry - 6, width: p.rx * 2 + 12, height: p.ry * 2 + 12 }))],
            isWet: wet,
            playArea,
        };
        const brng = createRng(seed ^ 0xb21e);
        // First, wherever a road crosses a river.
        const roadSites = findBridges(trails, lava).filter((b) => !b.edgeOnly).map((b) => mid(b.points));
        // (Roads cross where they cross, so a more slanted river is accepted there.)
        for (const site of roadSites) lavaBridges.push(...planLavaBridges(brng, lava, [site], { ...bctx, maxSkew: 0.8, eitherWay: true, avoid: [...bctx.avoid, ...lavaBridges.map((b) => b.rect!)] }));
        // Then up to two more per river, well apart, so every river has crossings
        // but long open stretches remain between them.
        const spacing = settings.lavaBridgeSpacing ?? 260;
        const centreOf = (b: Bridge) => ({ x: b.rect!.x + b.rect!.width / 2, y: b.rect!.y + b.rect!.height / 2 });
        for (const river of lava.rivers)
        {
            // Straightest-running stretches first (a little randomness breaks ties).
            const pts = river.points;
            const candidates = pts.slice(3, -3)
                .map((p, k) => ({ p, skew: riverSkew(pts[k + 2], pts[k + 4]) + brng() * 0.1 }))
                .sort((x, y) => x.skew - y.skew)
                .map((c) => c.p);
            let added = 0;
            const onThisRiver = () => lavaBridges.some((b) => river.points.some((p) => p.x >= b.rect!.x - 4 && p.x <= b.rect!.x + b.rect!.width + 4 && p.y >= b.rect!.y - 4 && p.y <= b.rect!.y + b.rect!.height + 4));
            // A second, looser pass makes sure no river is left without a crossing.
            for (const loose of [false, true])
            {
                if (loose && onThisRiver()) break;
                for (const site of candidates)
                {
                    if (added >= 2) break;
                    if (lavaBridges.some((b) => Math.hypot(centreOf(b).x - site.x, centreOf(b).y - site.y) < spacing)) continue;
                    const planned = planLavaBridges(brng, lava, [site], {
                        ...bctx, shortRampsOk: true, ...(loose ? { maxSkew: 0.8, eitherWay: true } : {}),
                        avoid: [...bctx.avoid, ...lavaBridges.map((b) => b.rect!)],
                    });
                    if (planned.length === 0) continue;
                    lavaBridges.push(...planned);
                    added++;
                    if (loose) break;
                }
            }
        }
        applyDeckRects(lava, lavaBridges);
        // Roads always cross by a bridge: a road that would cross bare lava is led over the
        // nearest one; any road still crossing bare lava gets a bridge of its own right there.
        rerouteOverBridges(trails, lava, lavaBridges);
        for (const t of trails)
        {
            if (t.plaza) continue;
            const site = densifyPoints(t.points, 4).find((p) => isLava(lava, p.x, p.y));
            if (!site) continue;
            const own = planLavaBridges(brng, lava, [site], { ...bctx, maxSkew: 1.6, eitherWay: true, shortRampsOk: true, avoid: [...bctx.avoid, ...lavaBridges.map((b) => b.rect!)] });
            if (own.length === 0) { skirtLava(t, lava); continue; }
            lavaBridges.push(...own);
            applyDeckRects(lava, own);
            rerouteOverBridges([t], lava, lavaBridges);
        }
        lavaBridges.forEach((b, i) => { b.variant = i % 4; });
    }

    const trailMask = trailTileMask(trails, cols, rows, T, 4);
    const onTrail = (p: Vec2) => trailMask[clampIndex(p.y / T, rows) * cols + clampIndex(p.x / T, cols)] === 1;

    const pools = volcano?.pools ?? [];
    // (Scenery treats lava rivers and their banks like the pools: it stays off them.)
    const inPool = (p: Vec2, margin: number) => pools.some((pool) => ((p.x - pool.x) / (pool.rx + margin)) ** 2 + ((p.y - pool.y) / (pool.ry + margin)) ** 2 <= 1) || nearLava(p, LAVA_BANK);
    const inVillage = (p: Vec2) => villages.some((v) => Math.hypot(p.x - v.center.x, p.y - v.center.y) < v.radius + 12);
    const nearWater = (p: Vec2) => wet({ x: p.x - 3, y: p.y + 2 }) || wet({ x: p.x + 3, y: p.y + 2 }) || wet({ x: p.x, y: p.y - 6 });
    const inCore = (p: Vec2) => rectContains(coreArea, p);

    // 8. Scenery for the new grassland (and the volcanic corner), at the original map's density.
    const outer = placeDecorations(createRng(seed ^ 0x0dec), {
        tileSize: T, worldWidth, worldHeight, playArea, spawn, structures,
        spawnClearRadius: settings.spawnClearRadius,
        darknessAt: (p) => darkness[clampIndex(p.y / T, rows)][clampIndex(p.x / T, cols)],
        onTrail,
        blocked: (p) => inCore(p) || inVillage(p) || wet(p) || nearWater(p) || heatAt(p) > 0.3 || faeAt(p) > 0.15 || bogAt(p) > 0.3 || nearLava(p, LAVA_BANK),
        biomeAt: heatAt,
        nearWater,
        waterSurface: wet,
        waterBodies: water.bodies,
        inVillage,
        inPool,
        exclude: coreArea,
        density: 0.9,
    });

    // 9. The biomes' own scenery: the castle grounds and forest; the wastes.
    const allSoFar = [...core.decorations, ...outer, ...fv.decorations, ...forest.groundsDecor, ...wastes.villages.flatMap((v) => v.decorations), ...swamp.villages.flatMap((v) => v.decorations)];
    const solids = allSoFar.filter((d) => DECORATION_COLLIDERS[d.kind]).map((d) => ({ x: d.x, y: d.y }));
    const structureAreas = structures.map((s) => structureArea(s, 12));
    const isFree = (p: Vec2) => rectContains(playArea, p) && !inCore(p) && !structureAreas.some((a) => rectContains(a, p)) &&
        !onTrail(p) && !inVillage(p) && !wet(p) && !nearWater(p) && !inPool(p, 12);
    const forestDecor = decorateForest(createRng(seed ^ 0xf0e5), {
        biomes, playArea, solids, isFree,
        paths: forestPaths,
        clearings: [forest.grounds, ...forest.landmarks.map((s) => ({ center: { x: s.x, y: s.y - 10 }, radius: 50 }))],
    });
    const wastesDecor = decorateWastes(createRng(seed ^ 0xa5ed), { biomes, region: regionOf(biomes, 'volcanic')!, playArea, solids, isFree });
    // The swamp castle's grounds stay open (its capture circle is a battleground).
    const swampGrounds = swamp.castleGrounds;
    const swampFree = swampGrounds ? (p: Vec2) => isFree(p) && !rectContains(swampGrounds, p) : isFree;
    const swampDecor = decorateSwamp(createRng(seed ^ 0x5ade), {
        biomes, region: swampRegion, playArea, water, solids, isFree: swampFree,
        atShore: (p) => !wet(p) && nearWater(p) && !onTrail(p) && !inVillage(p) && !structureAreas.some((a) => rectContains(a, p)),
    });

    // 10. Livelier riverbanks everywhere (the original map's too): pebbles, reeds,
    //     bank flowers and the odd boulder, kept clear of paths and bridges.
    const bankDecor = placeBankDetails(createRng(seed ^ 0xba2c), {
        bodies: water.bodies, wet, solids, spawn,
        isFree: (p) => rectContains(playArea, p) && !structureAreas.some((a) => rectContains(a, p)) && !onTrail(p) &&
            !inVillage(p) && !wet(p) && heatAt(p) < 0.3 && bogAt(p) < 0.3 && !inPool(p, 12),
        nearTrail: (p) => onTrail(p) || onTrail({ x: p.x + 24, y: p.y }) || onTrail({ x: p.x - 24, y: p.y }) || onTrail({ x: p.x, y: p.y + 24 }) || onTrail({ x: p.x, y: p.y - 24 }),
    });
    // 11. Around the volcano: a belt of scorched, then charred, trees where the grass
    //     gives way to ash, and small fires burning here and there.
    const volcanoEdge = placeVolcanoSurroundings(createRng(seed ^ 0xf17e), {
        heatAt, solids, spawn,
        isFree: (p) => rectContains(playArea, p) && !structureAreas.some((a) => rectContains(a, p)) && !onTrail(p) &&
            !inVillage(p) && !wet(p) && !nearWater(p) && !inPool(p, 12) && !nearLava(p, 22),
        playArea,
    });
    const decorations = [...allSoFar, ...forestDecor, ...wastesDecor, ...swampDecor, ...bankDecor, ...volcanoEdge];

    const obstacles: Rect[] = [
        ...structures.flatMap(structureColliders),
        ...decorations.flatMap((d) => {
            const collider = movementCollider(d);
            return collider ? [collider] : [];
        }),
        ...pools.map(lavaPoolCollider),
    ];
    const itemSpawnTiles = findItemSpawnTiles(cols, rows, T, playArea, structures, decorations)
        .filter((tile) => {
            const x = (tile % cols) * T;
            const y = Math.floor(tile / cols) * T;
            return ![[2, 2], [14, 2], [2, 14], [14, 14], [8, 8]].some(([dx, dy]) => isWater(water, x + dx, y + dy) || inPool({ x: x + dx, y: y + dy }, 10));
        });

    return {
        tileSize: T,
        widthInTiles: cols,
        heightInTiles: rows,
        worldWidth,
        worldHeight,
        ground,
        trails,
        water,
        bridges,
        volcano,
        biomes,
        folkHomes: forest.folkHomes,
        lava,
        lavaBridges,
        villages,
        structures,
        castles,
        decorations,
        obstacles,
        itemSpawnTiles,
        playArea,
        spawn,
    };
}

/**
 * A dirt square in the middle of a village plus a little lane from each
 * house door to the square, winding around the houses, fences and crates.
 */
function villagePaths (village: Village, rng: Rng, playArea: Rect): Trail[]
{
    const c = village.center;
    // Ash villages are paved with dark stone; the others have packed-earth squares and lanes.
    const kind: Trail['kind'] = village.style === 'ashen' ? 'stone' : 'dirt';
    const square: Trail = { kind, width: 46, plaza: true, points: [{ x: c.x - 4, y: c.y + 2 }, { x: c.x + 4, y: c.y + 2 }] };
    const avoid: Rect[] = [
        ...village.houses.map((h) => structureArea(h, 4)),
        ...village.decorations.filter((d) => d.kind !== 'flowers').flatMap((d) => {
            const r = decorationCollider(d);
            return r ? [{ x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8 }] : [];
        }),
    ];
    const end = { x: c.x, y: c.y + 14 };
    const lanes: Trail[] = [];
    for (const h of village.houses)
    {
        const door = { x: h.x + 4, y: h.y + 9 };
        // Tight villages can confuse the general router, so check its lane and
        // fall back to simple bent lanes; a house with no clear lane gets none.
        const step = door.y + 10;
        const candidates: Vec2[][] = [
            routeTrail(rng, door, end, kind, 6, avoid, playArea).points,
            [door, { x: door.x, y: end.y }, end],
            [door, { x: end.x, y: door.y }, end],
            [door, { x: door.x, y: step }, { x: end.x, y: step }, end],
        ];
        const lane = candidates.find((points) => laneIsClear(points, avoid));
        if (lane) lanes.push({ kind, width: 6, points: lane });
    }
    return [square, ...lanes];
}

/** A lane is clear if it never touches a house or prop and never doubles back on itself. */
function laneIsClear (points: readonly Vec2[], avoid: readonly Rect[]): boolean
{
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i];
        const b = points[i + 1];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        for (let t = 0; t <= length; t += 2)
        {
            const p = { x: a.x + ((b.x - a.x) * t) / (length || 1), y: a.y + ((b.y - a.y) * t) / (length || 1) };
            if (avoid.some((r) => p.x > r.x - 3 && p.x < r.x + r.width + 3 && p.y > r.y - 3 && p.y < r.y + r.height + 3)) return false;
        }
        // Sharp reversals (the lane folding back on itself).
        if (i > 0)
        {
            const p = points[i - 1];
            const ux = a.x - p.x, uy = a.y - p.y, vx = b.x - a.x, vy = b.y - a.y;
            const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1);
            if (cos < -0.5) return false;
        }
    }
    return true;
}

export function decorationCollider (d: Decoration): Rect | null
{
    const size = DECORATION_COLLIDERS[d.kind];
    if (!size) return null;
    return { x: d.x - size.width / 2, y: d.y - size.depth, width: size.width, height: size.depth };
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

function buildGround (
    rng: Rng, cols: number, rows: number,
    darkness: number[][], dirtiness: number[][], edgeWobble: number[][],
    biome: (col: number, row: number) => number = () => 0,
    forest?: (col: number, row: number) => number,
    swamp?: (col: number, row: number) => number,
): number[][]
{
    const ground: number[][] = [];

    for (let row = 0; row < rows; row++)
    {
        const line: number[] = [];

        for (let col = 0; col < cols; col++)
        {
            const distanceToEdge = Math.min(col, row, cols - 1 - col, rows - 1 - row);
            // Dense forest canopy 2..4 tiles deep, with a wobbly inner edge.
            const canopyDepth = 2 + Math.round(edgeWobble[row][col] * 2);
            // Volcano biome: ash in the middle, scorched grass around it, dark cliffs at the map edge.
            const heat = biome(col, row) + jitter(rng, 0.12);
            // Enchanted forest: deep moss, bright flowering moss, and a fae canopy at the map edge.
            // (Only rolled when there is a forest, so the original map's ground is unchanged.)
            const fae = forest ? forest(col, row) + jitter(rng, 0.14) : 0;
            // Swamp: dark wet moss with mud patches, fading into the grass through dark grass and moss.
            const bog = swamp ? swamp(col, row) + jitter(rng, 0.14) : 0;

            if (distanceToEdge < canopyDepth)
            {
                line.push(heat > 0.5 ? GroundTile.Cliff : fae > 0.5 ? GroundTile.FaeCanopy : bog > 0.5 ? GroundTile.SwampCanopy : rng() < 0.5 ? GroundTile.Canopy : GroundTile.CanopyAlt);
            }
            else if (bog > 0.5)
            {
                const r = rng();
                line.push(dirtiness[row][col] > 0.62 ? (r < 0.7 ? GroundTile.Mud : GroundTile.SwampMossAlt) : r < 0.6 ? GroundTile.SwampMoss : GroundTile.SwampMossAlt);
            }
            else if (bog > 0.3)
            {
                const r = rng();
                line.push(r < 0.45 ? GroundTile.SwampMossAlt : r < 0.75 ? GroundTile.DarkGrass : GroundTile.DarkGrassAlt);
            }
            else if (fae > 0.45)
            {
                const r = rng();
                line.push(r < 0.55 ? GroundTile.FaeMoss : r < 0.93 ? GroundTile.FaeMossAlt : GroundTile.FaeBloom);
            }
            else if (heat > 0.72)
            {
                line.push(rng() < 0.6 ? GroundTile.Ash : GroundTile.AshAlt);
            }
            else if (heat > 0.3)
            {
                line.push(heat > 0.55 && rng() < 0.35 ? GroundTile.AshAlt : GroundTile.Scorched);
            }
            // A little randomness at the thresholds roughens patch edges,
            // so they don't look like neat squares.
            else if (dirtiness[row][col] + jitter(rng, 0.06) > 0.72)
            {
                line.push(GroundTile.Dirt);
            }
            else if (darkness[row][col] + jitter(rng, 0.08) > 0.58)
            {
                line.push(rng() < 0.6 ? GroundTile.DarkGrass : GroundTile.DarkGrassAlt);
            }
            else
            {
                const r = rng();
                line.push(r < 0.65 ? GroundTile.Grass : r < 0.9 ? GroundTile.GrassAlt : GroundTile.GrassTufts);
            }
        }

        ground.push(line);
    }

    return ground;
}

// ---------------------------------------------------------------------------
// Decorations
// ---------------------------------------------------------------------------

interface PlacementContext {
    tileSize: number;
    worldWidth: number;
    worldHeight: number;
    playArea: Rect;
    spawn: Vec2;
    structures: Structure[];
    spawnClearRadius: number;
    darknessAt: (p: Vec2) => number;
    onTrail: (p: Vec2) => boolean;
    /** Extra places decorations must avoid (water, villages). */
    blocked?: (p: Vec2) => boolean;
    /** 0..1: how deep into the volcano biome a spot is. */
    biomeAt?: (p: Vec2) => number;
    /** Water (bridged or not) at or right next to a spot. */
    nearWater?: (p: Vec2) => boolean;
    waterSurface?: (p: Vec2) => boolean;
    waterBodies?: readonly WaterBody[];
    inVillage?: (p: Vec2) => boolean;
    /** Inside (or within `margin` px of) a lava pool. */
    inPool?: (p: Vec2, margin: number) => boolean;
    /** Roll the map-edge treeline but don't keep it (the edge opens onto more land). */
    skipTreeline?: boolean;
    /** Area already decorated (the preserved centre): shore and volcano scenery skip it. */
    exclude?: Rect;
    /** Scales how many of each scenery item are placed (1 = the original map's amounts). */
    density?: number;
}

/** Decorations stay this far away from any structure. */
const STRUCTURE_DECOR_PADDING = 10;
/** Solid cover (groves, boulders) keeps this far from the starting point. */
const COVER_SPAWN_CLEARANCE = 240;
/** Any other solid object keeps at least this far from the starting point. */
const SOLID_SPAWN_CLEARANCE = 210;
/** Lava riverbanks are kept this clear of scenery (world px), leaving room to move along them. */
const LAVA_BANK = 18;

function placeDecorations (rng: Rng, ctx: PlacementContext): Decoration[]
{
    const decorations: Decoration[] = [];
    const { playArea, spawn } = ctx;
    /** How many of something to place, scaled for the area being decorated. */
    const n = (count: number) => Math.round(count * (ctx.density ?? 1));

    const add = (kind: DecorationKind, x: number, y: number, accent?: Accent) => {
        const variants = DECORATION_VARIANTS[kind] ?? 1;
        decorations.push({
            kind, x: Math.round(x), y: Math.round(y),
            flip: rng() < 0.5,
            variant: variants > 1 ? Math.floor(rng() * variants) : 0,
            accent,
        });
    };

    const randomPoint = (): Vec2 => ({
        x: randRange(rng, playArea.x + 6, playArea.x + playArea.width - 6),
        y: randRange(rng, playArea.y + 10, playArea.y + playArea.height - 2),
    });

    const structureAreas = ctx.structures.map((s) => structureArea(s, STRUCTURE_DECOR_PADDING));
    const touchesStructure = (p: Vec2) => structureAreas.some((area) => rectContains(area, p));
    const insidePlayArea = (p: Vec2) => rectContains(playArea, p);
    const farFromSpawn = (p: Vec2, distance: number) => Math.hypot(p.x - spawn.x, p.y - spawn.y) >= distance;

    /** Is this a good free spot (not on a structure, not on a trail)? */
    const isFree = (p: Vec2) => insidePlayArea(p) && !touchesStructure(p) && !ctx.onTrail(p) && !ctx.blocked?.(p);

    /**
     * Try a few random spots; return the first that is far enough from spawn,
     * free, and passes `accept`.
     */
    const findPoint = (minSpawnDistance: number, accept: (p: Vec2) => boolean = () => true): Vec2 | null => {
        for (let attempt = 0; attempt < 30; attempt++)
        {
            const p = randomPoint();
            if (farFromSpawn(p, minSpawnDistance) && isFree(p) && accept(p)) return p;
        }
        return null;
    };

    /** Add a decoration only if its spot is free. */
    const addClear = (kind: DecorationKind, x: number, y: number, accent?: Accent) => {
        if (isFree({ x, y })) add(kind, x, y, accent);
    };

    /** Scatter `count` of something across the map. */
    const scatter = (count: number, kind: DecorationKind | (() => DecorationKind), minSpawnDistance: number, accept?: (p: Vec2) => boolean) => {
        for (let i = 0; i < count; i++)
        {
            const p = findPoint(minSpawnDistance, accept);
            if (p) add(typeof kind === 'function' ? kind() : kind, p.x, p.y);
        }
    };

    const isDark = (threshold: number) => (p: Vec2) => ctx.darknessAt(p) > threshold;

    // --- Edges and structures -------------------------------------------

    // Treeline: bushes and dead trees between the canopy and the walkable area.
    // (When skipped it is still "rolled", so everything placed after it stays the same.)
    const beforeTreeline = decorations.length;
    placeTreeline(rng, ctx, add);
    if (ctx.skipTreeline) decorations.length = beforeTreeline;

    // Rubble scattered in front of fortifications and keeps.
    for (const structure of ctx.structures)
    {
        if (structure.type !== 'fortification' && structure.type !== 'keep') continue;
        const halfWidth = STRUCTURE_SPECS[structure.type].width / 2;
        const rubbleCount = randInt(rng, 4, 7);
        for (let r = 0; r < rubbleCount; r++)
        {
            addClear('rockSmall', structure.x + randRange(rng, -halfWidth - 16, halfWidth + 16), structure.y + randRange(rng, 13, 24));
        }
    }

    // --- Cover: groves, boulders, ruins (solid, good hiding spots) -------

    // Groves of large eerie trees and pines, with gaps to slip through.
    for (let g = 0; g < n(16); g++)
    {
        const center = findPoint(COVER_SPAWN_CLEARANCE + 40, isDark(0.42));
        if (!center) continue;

        const trees: Vec2[] = [];
        const treeCount = randInt(rng, 4, 8);
        for (let attempt = 0; attempt < treeCount * 4 && trees.length < treeCount; attempt++)
        {
            const angle = rng() * Math.PI * 2;
            const radius = randRange(rng, 6, 58);
            const p = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius * 0.75 };
            // At least 20px between trunks, so armies can still squeeze through.
            if (!isFree(p) || !farFromSpawn(p, COVER_SPAWN_CLEARANCE) || trees.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < 20)) continue;
            trees.push(p);
            // Mostly old trees and pines, with the odd ancient elder or birch for a varied silhouette.
            const r = rng();
            add(r < 0.34 ? 'largeTree' : r < 0.58 ? 'pine' : r < 0.68 ? 'elderTree' : r < 0.76 ? 'birch'
                : r < 0.86 ? 'goldenOak' : r < 0.93 ? 'twistedYew' : 'cypress', p.x, p.y);
        }

        // Undergrowth around the grove.
        for (let u = 0; u < randInt(rng, 4, 8); u++)
        {
            addClear(rng() < 0.5 ? 'bush' : 'fern', center.x + randRange(rng, -72, 72), center.y + randRange(rng, -50, 50));
        }
    }

    // Lone large trees and pines.
    scatter(n(28), () => {
        const r = rng();
        return r < 0.42 ? 'largeTree' : r < 0.66 ? 'pine' : r < 0.8 ? 'goldenOak' : r < 0.9 ? 'twistedYew' : 'cypress';
    }, COVER_SPAWN_CLEARANCE);

    // Boulder clusters.
    for (let b = 0; b < n(14); b++)
    {
        const center = findPoint(COVER_SPAWN_CLEARANCE);
        if (!center) continue;
        const placed: Vec2[] = [];
        for (let attempt = 0; attempt < 12 && placed.length < randInt(rng, 2, 4); attempt++)
        {
            const p = { x: center.x + randRange(rng, -26, 26), y: center.y + randRange(rng, -16, 16) };
            if (!isFree(p) || placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 18)) continue;
            placed.push(p);
            add('boulder', p.x, p.y);
        }
        for (let r = 0; r < randInt(rng, 2, 4); r++)
        {
            addClear(rng() < 0.5 ? 'rock' : 'rockSmall', center.x + randRange(rng, -40, 40), center.y + randRange(rng, -26, 26));
        }
    }

    // Small ruin sites: broken pillars and walls, rubble, sometimes a runestone.
    for (let i = 0; i < n(10); i++)
    {
        const center = findPoint(SOLID_SPAWN_CLEARANCE + 70);
        if (!center) continue;

        const pillarCount = randInt(rng, 2, 4);
        for (let p = 0; p < pillarCount; p++)
        {
            const angle = rng() * Math.PI * 2;
            const radius = randRange(rng, 28, 56);
            addClear('pillar', center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius * 0.7);
        }

        const wallCount = randInt(rng, 1, 3);
        for (let w = 0; w < wallCount; w++)
        {
            addClear('ruinWall', center.x + randRange(rng, -50, 50), center.y + randRange(rng, -36, 36));
        }

        const rubbleCount = randInt(rng, 3, 6);
        for (let r = 0; r < rubbleCount; r++)
        {
            addClear('rockSmall', center.x + randRange(rng, -60, 60), center.y + randRange(rng, -40, 40));
        }

        if (rng() < 0.6)
        {
            addClear('runestone', center.x, center.y, pick(rng, ACCENTS));
        }
    }

    // Forgotten graveyards: small rows of tilted gravestones.
    for (let g = 0; g < n(6); g++)
    {
        const corner = findPoint(260);
        if (!corner) continue;
        const columns = randInt(rng, 2, 3);
        const rowsOfGraves = randInt(rng, 1, 2);
        for (let r = 0; r < rowsOfGraves; r++)
        {
            for (let c = 0; c < columns; c++)
            {
                if (rng() < 0.2) continue; // a missing grave here and there
                addClear('gravestone', corner.x + c * 14 + randRange(rng, -2, 2), corner.y + r * 14 + randRange(rng, -2, 2));
            }
        }
        addClear('bones', corner.x + randRange(rng, -10, 40), corner.y + randRange(rng, 18, 30));
        if (rng() < 0.5) addClear('deadTree', corner.x - 18, corner.y + randRange(rng, -6, 6));
    }

    // --- Mythical woods ----------------------------------------------------

    /** Place up to `count` solid things around a centre, at least `spacing` apart (so armies fit between). */
    const stand = (center: Vec2, count: number, spread: number, spacing: number, kind: () => DecorationKind, minSpawn: number) => {
        const placed: Vec2[] = [];
        for (let attempt = 0; attempt < count * 5 && placed.length < count; attempt++)
        {
            const angle = rng() * Math.PI * 2;
            const radius = randRange(rng, 0, spread);
            const p = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius * 0.75 };
            if (!isFree(p) || !farFromSpawn(p, minSpawn) || placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < spacing)) continue;
            placed.push(p);
            add(kind(), p.x, p.y);
        }
        return placed;
    };

    // Birch stands in the brighter meadows, with tall grass and flowers.
    for (let i = 0; i < n(7); i++)
    {
        const center = findPoint(COVER_SPAWN_CLEARANCE, (q) => ctx.darknessAt(q) < 0.5);
        if (!center) continue;
        stand(center, randInt(rng, 3, 6), 40, 16, () => 'birch', COVER_SPAWN_CLEARANCE);
        for (let u = 0; u < 5; u++) addClear(rng() < 0.6 ? 'tallGrass' : 'flowers', center.x + randRange(rng, -46, 46), center.y + randRange(rng, -30, 30));
    }

    // Giant mushroom groves in the deepest shade, ringed by glowing caps.
    for (let i = 0; i < n(6); i++)
    {
        const center = findPoint(COVER_SPAWN_CLEARANCE, isDark(0.55));
        if (!center) continue;
        stand(center, randInt(rng, 2, 4), 34, 20, () => 'giantShroom', COVER_SPAWN_CLEARANCE);
        const accent = pick(rng, ACCENTS);
        for (let u = 0; u < 6; u++) addClear('glowShroom', center.x + randRange(rng, -40, 40), center.y + randRange(rng, -26, 26), accent);
    }

    // Lone ancient elder trees: big landmarks with saplings and ferns around them.
    for (let i = 0; i < n(9); i++)
    {
        const center = findPoint(COVER_SPAWN_CLEARANCE + 30);
        if (!center) continue;
        add('elderTree', center.x, center.y);
        for (let u = 0; u < 4; u++)
        {
            const angle = rng() * Math.PI * 2;
            addClear(rng() < 0.5 ? 'sapling' : 'fern', center.x + Math.cos(angle) * randRange(rng, 22, 40), center.y + Math.sin(angle) * randRange(rng, 14, 26));
        }
    }

    // Thickets: walk-through clusters of shrubs, ferns, grass and saplings.
    for (let i = 0; i < n(36); i++)
    {
        const center = findPoint(ctx.spawnClearRadius);
        if (!center) continue;
        const kinds: DecorationKind[] = ['shrub', 'shrub', 'bush', 'fern', 'tallGrass', 'sapling'];
        for (let u = randInt(rng, 5, 10); u > 0; u--)
        {
            addClear(pick(rng, kinds), center.x + randRange(rng, -30, 30), center.y + randRange(rng, -18, 18));
        }
    }

    // Wildflower patches.
    scatter(n(30), 'flowers', ctx.spawnClearRadius, (q) => ctx.darknessAt(q) < 0.55);

    placeShore(rng, ctx, add, touchesStructure);
    // (Edge trees are rolled but dropped when the map edge has opened up.)
    placeVolcanoDecor(rng, ctx, add, touchesStructure, ctx.skipTreeline ? (k, x, y) => { add(k, x, y); decorations.pop(); } : add);

    // --- Scattered terrain ------------------------------------------------

    scatter(n(110), () => (rng() < 0.5 ? 'rock' : 'rockSmall'), ctx.spawnClearRadius);
    // Solid things stay out of the open area around the start.
    scatter(n(55), 'deadTree', SOLID_SPAWN_CLEARANCE);
    scatter(n(22), 'log', SOLID_SPAWN_CLEARANCE);
    scatter(n(40), 'stump', ctx.spawnClearRadius);
    scatter(n(35), 'bones', ctx.spawnClearRadius);
    scatter(n(380), 'bush', ctx.spawnClearRadius, (q) => ctx.darknessAt(q) > 0.45 || rng() < 0.25);
    scatter(n(220), 'fern', ctx.spawnClearRadius, (q) => ctx.darknessAt(q) > 0.4 || rng() < 0.2);
    // Tall grass is low ground detail, fine near spawn.
    scatter(n(520), 'tallGrass', 24);

    // Small clusters of glowing mushrooms in the shadows.
    for (let i = 0; i < n(60); i++)
    {
        const p = findPoint(ctx.spawnClearRadius, isDark(0.5));
        if (!p) continue;
        const accent = pick(rng, ACCENTS);
        const count = randInt(rng, 2, 5);
        for (let s = 0; s < count; s++)
        {
            addClear('glowShroom', p.x + randRange(rng, -12, 12), p.y + randRange(rng, -8, 8), accent);
        }
    }

    // Floating wisps of light.
    for (let i = 0; i < n(45); i++)
    {
        const p = findPoint(ctx.spawnClearRadius);
        if (p) add('wisp', p.x, p.y, pick(rng, ACCENTS));
    }

    return decorations;
}

function placeTreeline (
    rng: Rng,
    ctx: PlacementContext,
    addAny: (kind: DecorationKind, x: number, y: number) => void,
): void
{
    // Rivers run off the map edge: leave a gap in the treeline where they do.
    // Roads that run off the map pass through it too. (The trail check only applies to
    // expanded maps, so the original map's treeline rolls out exactly as before.)
    const add = (kind: DecorationKind, x: number, y: number) => {
        const p = { x: Math.round(x), y: Math.round(y) };
        if (ctx.blocked?.(p)) return;
        if (ctx.exclude && ctx.onTrail(p)) return;
        addAny(kind, x, y);
    };
    const { playArea, worldWidth, tileSize } = ctx;
    const strip = tileSize * 2;
    const left = playArea.x;
    const right = playArea.x + playArea.width;
    const top = playArea.y;
    const bottom = playArea.y + playArea.height;
    const kind = (): DecorationKind => {
        const r = rng();
        return r < 0.1 ? 'deadTree' : r < 0.22 ? 'pine' : 'bush';
    };

    for (let x = 0; x <= worldWidth; x += randRange(rng, 8, 16))
    {
        add(kind(), x, randRange(rng, top - strip + 8, top + 4));
        add(kind(), x, randRange(rng, bottom + 6, bottom + strip));
    }

    for (let y = top; y <= bottom; y += randRange(rng, 8, 16))
    {
        add(kind(), randRange(rng, left - strip + 4, left + 2), y);
        add(kind(), randRange(rng, right - 2, right + strip - 4), y);
    }
}

type AddDecoration = (kind: DecorationKind, x: number, y: number) => void;

/**
 * River banks and pond shores: wet rocks, reeds and the odd willow leaning
 * over the water. (Sand is painted on the ground by the renderer.) Spaced
 * out so the banks never become walls, and kept off trails and bridges.
 */
function placeShore (rng: Rng, ctx: PlacementContext, add: AddDecoration, touchesStructure: (p: Vec2) => boolean): void
{
    const water = ctx.waterSurface;
    if (!water || !ctx.waterBodies) return;
    const solids: Vec2[] = [];

    /** A dry spot right on the bank, not on a trail, structure or village. */
    const bankSpotOk = (p: Vec2) =>
        rectContains(ctx.playArea, p) && !(ctx.exclude && rectContains(ctx.exclude, p)) && !touchesStructure(p) && !ctx.onTrail(p) && !ctx.inVillage?.(p) &&
        !water(p) && !water({ x: p.x - 5, y: p.y }) && !water({ x: p.x + 5, y: p.y }) && !water({ x: p.x, y: p.y - 5 }) &&
        (ctx.biomeAt?.(p) ?? 0) < 0.3 && Math.hypot(p.x - ctx.spawn.x, p.y - ctx.spawn.y) > 120;

    /** Walk out from a point in the water until we reach the bank. */
    const bankFrom = (from: Vec2, nx: number, ny: number, maxDistance: number): Vec2 | null => {
        for (let d = 0; d < maxDistance; d += 1)
        {
            const p = { x: from.x + nx * d, y: from.y + ny * d };
            if (!water(p)) return { x: p.x + nx * randRange(rng, 3, 6), y: p.y + ny * randRange(rng, 3, 6) };
        }
        return null;
    };

    const decorateBank = (bank: Vec2, nx: number, ny: number) => {
        const roll = rng();
        // Along the bank (perpendicular to the way out of the water).
        const tx = -ny;
        const ty = nx;
        if (roll < 0.45)
        {
            for (let k = randInt(rng, 1, 3); k > 0; k--)
            {
                const s = randRange(rng, -12, 12);
                const p = { x: bank.x + tx * s, y: bank.y + ty * s };
                if (!bankSpotOk(p) || Math.hypot(p.x - ctx.spawn.x, p.y - ctx.spawn.y) < SOLID_SPAWN_CLEARANCE || solids.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 14)) continue;
                solids.push(p);
                add('shoreRock', p.x, p.y);
            }
        }
        else if (roll < 0.85)
        {
            for (let k = randInt(rng, 2, 4); k > 0; k--)
            {
                const s = randRange(rng, -14, 14);
                const p = { x: bank.x + tx * s, y: bank.y + ty * s };
                if (bankSpotOk(p)) add('reeds', p.x, p.y);
            }
        }
        else
        {
            // A willow a little further back, leaning over the water.
            const p = { x: bank.x + nx * 8, y: bank.y + ny * 8 };
            if (bankSpotOk(p) && Math.hypot(p.x - ctx.spawn.x, p.y - ctx.spawn.y) > COVER_SPAWN_CLEARANCE && !solids.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 22))
            {
                solids.push(p);
                add('willow', p.x, p.y);
            }
        }
    };

    for (const body of ctx.waterBodies)
    {
        if (body.kind === 'pond')
        {
            const c = body.points[0];
            for (let k = 0; k < 10; k++)
            {
                if (rng() > 0.55) continue;
                const angle = (k / 10) * Math.PI * 2 + randRange(rng, -0.2, 0.2);
                const nx = Math.cos(angle);
                const ny = Math.sin(angle);
                const bank = bankFrom(c, nx, ny, body.width);
                if (bank) decorateBank(bank, nx, ny);
            }
            continue;
        }

        // Rivers and streams: every ~40px, maybe decorate one bank.
        const pts = body.points;
        for (let i = 0; i < pts.length - 1; i++)
        {
            const a = pts[i];
            const b = pts[i + 1];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            if (length === 0) continue;
            const nx0 = -(b.y - a.y) / length;
            const ny0 = (b.x - a.x) / length;
            for (let t = 0; t < length; t += 40)
            {
                if (rng() > (body.kind === 'river' ? 0.55 : 0.35)) continue;
                const side = rng() < 0.5 ? -1 : 1;
                const from = { x: a.x + ((b.x - a.x) * t) / length, y: a.y + ((b.y - a.y) * t) / length };
                const bank = bankFrom(from, nx0 * side, ny0 * side, body.width + 10);
                if (bank) decorateBank(bank, nx0 * side, ny0 * side);
            }
        }
    }
}

/**
 * Where a road runs into molten lava, bend it over the nearest bridge
 * instead: up to the bridge's near end, across the deck, and back onto the
 * road beyond the river. Roads then never ask anyone to wade through lava.
 */
function rerouteOverBridges (trails: Trail[], lava: LavaLayout, bridges: readonly Bridge[]): void
{
    const molten = (p: Vec2) => isLava(lava, p.x, p.y);
    for (const trail of trails)
    {
        if (trail.plaza) continue;
        for (let guard = 0; guard < 4; guard++)
        {
            const pts = densifyPoints(trail.points, 4);
            const first = pts.findIndex(molten);
            if (first < 0) break;
            let last = first;
            while (last + 1 < pts.length && (molten(pts[last + 1]) || pts.slice(last + 1, last + 4).some(molten))) last++;
            const mid = pts[Math.floor((first + last) / 2)];
            const bridge = [...bridges].filter((b) => b.rect).sort((a, b) => distToRect(mid, a.rect!) - distToRect(mid, b.rect!))[0];
            if (!bridge || distToRect(mid, bridge.rect!) > 120) break;
            const [e0, e1] = bridge.points;
            const before = pts[Math.max(0, first - 3)];
            const [entry, exit] = Math.hypot(e0.x - before.x, e0.y - before.y) <= Math.hypot(e1.x - before.x, e1.y - before.y) ? [e0, e1] : [e1, e0];
            // Rejoin the road at its first point past the river that isn't in lava.
            const rejoin = Math.min(pts.length - 1, last + 4);
            const inset = (p: Vec2, toward: Vec2) => { const d = Math.hypot(toward.x - p.x, toward.y - p.y) || 1; return { x: p.x + ((toward.x - p.x) / d) * 3, y: p.y + ((toward.y - p.y) / d) * 3 }; };
            trail.points = [...pts.slice(0, Math.max(1, first - 3)), inset(entry, exit), inset(exit, entry), ...pts.slice(rejoin)];
        }
    }
}

/** A road that only clips the tip of a lava river (no room for a bridge) bends around it. */
function skirtLava (trail: Trail, lava: LavaLayout): void
{
    const molten = (p: Vec2) => isLava(lava, p.x, p.y);
    const pts = densifyPoints(trail.points, 4);
    const first = pts.findIndex(molten);
    if (first < 0) return;
    let last = first;
    while (last + 1 < pts.length && molten(pts[last + 1])) last++;
    const a = pts[Math.max(0, first - 1)];
    const b = pts[Math.min(pts.length - 1, last + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const lo = Math.max(0, first - 12);
    const hi = Math.min(pts.length - 1, last + 12);
    for (let off = 8; off <= 90; off += 6)
    {
        for (const side of [1, -1])
        {
            const bent = pts.map((p, i) => {
                if (i < lo || i > hi) return p;
                // Smooth bump: full offset over the clipped run, easing back to the road either side.
                const w = i < first ? (i - lo) / Math.max(1, first - lo) : i > last ? (hi - i) / Math.max(1, hi - last) : 1;
                const e = w * w * (3 - 2 * w);
                return { x: p.x + n.x * off * side * e, y: p.y + n.y * off * side * e };
            });
            if (!densifyPoints(bent.slice(lo, hi + 1), 2).some(molten)) { trail.points = bent; return; }
        }
    }
}

function densifyPoints (points: readonly Vec2[], step: number): Vec2[]
{
    const out: Vec2[] = [];
    for (let i = 0; i < points.length - 1; i++)
    {
        const a = points[i];
        const b = points[i + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
        for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    if (points.length) out.push(points[points.length - 1]);
    return out;
}

function distToRect (p: Vec2, r: Rect): number
{
    const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
    const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
    return Math.hypot(dx, dy);
}

interface VolcanoSurroundingsContext {
    heatAt: (p: Vec2) => number;
    isFree: (p: Vec2) => boolean;
    solids: Vec2[];
    spawn: Vec2;
    playArea: Rect;
}

/**
 * The volcano's surroundings: where green grass turns to ash, a belt of
 * trees goes from scorched (a few dry leaves left) to fully charred, spaced
 * well apart with clear openings; plus small ground fires burning in the ash.
 */
function placeVolcanoSurroundings (rng: Rng, ctx: VolcanoSurroundingsContext): Decoration[]
{
    const out: Decoration[] = [];
    const { playArea } = ctx;
    const spot = () => ({ x: randRange(rng, playArea.x + 8, playArea.x + playArea.width - 8), y: randRange(rng, playArea.y + 12, playArea.y + playArea.height - 4) });
    const spaced = (p: Vec2, gap: number) => !ctx.solids.some((q) => Math.abs(q.x - p.x) < gap && Math.abs(q.y - p.y) < gap && Math.hypot(q.x - p.x, q.y - p.y) < gap);

    // The transition belt. On the grass side within ~70px of the ash: scorched trees
    // (dry, a few brown leaves left); at the ash's edge: charred trees.
    const nearAsh = (p: Vec2) => {
        let most = 0;
        for (let k = 0; k < 8; k++)
        {
            const a = (k / 8) * Math.PI * 2;
            most = Math.max(most, ctx.heatAt({ x: p.x + Math.cos(a) * 70, y: p.y + Math.sin(a) * 70 }));
        }
        return most;
    };
    let scorched = 0;
    let charred = 0;
    for (let attempt = 0; attempt < 6000 && (scorched < 40 || charred < 24); attempt++)
    {
        const p = spot();
        const heat = ctx.heatAt(p);
        const grassSide = heat < 0.3 && nearAsh(p) > 0.4;
        const ashEdge = heat >= 0.3 && heat < 0.7;
        if ((!grassSide || scorched >= 40) && (!ashEdge || charred >= 24)) continue;
        if (!ctx.isFree(p) || !spaced(p, 42) || Math.hypot(p.x - ctx.spawn.x, p.y - ctx.spawn.y) < SOLID_SPAWN_CLEARANCE) continue;
        ctx.solids.push(p);
        out.push({ kind: grassSide ? 'scorchedTree' : 'charredTree', x: Math.round(p.x), y: Math.round(p.y), flip: rng() < 0.5, variant: randInt(rng, 0, 1) });
        if (grassSide) scorched++;
        else charred++;
    }

    // Small fires burning in the ash (walk-through), well apart.
    const fires: Vec2[] = [];
    for (let attempt = 0; attempt < 2000 && fires.length < 16; attempt++)
    {
        const p = spot();
        if (ctx.heatAt(p) < 0.55 || !ctx.isFree(p) || fires.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 130)) continue;
        fires.push(p);
        out.push({ kind: 'smallFire', x: Math.round(p.x), y: Math.round(p.y), flip: rng() < 0.5, variant: 0 });
    }
    return out;
}

interface BankContext {
    bodies: readonly WaterBody[];
    wet: (p: Vec2) => boolean;
    /** Spot is open, dry ground (not on a path, building or village). */
    isFree: (p: Vec2) => boolean;
    /** Near a path or bridge (no solid rocks there, so crossings stay open). */
    nearTrail: (p: Vec2) => boolean;
    solids: Vec2[];
    spawn: Vec2;
}

/**
 * Livelier riverbanks: pebbles and bank flowers all along the shore, clumps
 * of reeds, and now and then a boulder or a pile of wet rocks. Solid pieces
 * stay well away from paths, bridges, the start and each other, so every
 * crossing stays open. (The sand itself is painted by the renderer.)
 */
function placeBankDetails (rng: Rng, ctx: BankContext): Decoration[]
{
    const out: Decoration[] = [];
    const add = (kind: DecorationKind, p: Vec2, variant = 0) => out.push({ kind, x: Math.round(p.x), y: Math.round(p.y), flip: rng() < 0.5, variant });
    /** From a point in the water, walk out to the bank. */
    const bankFrom = (from: Vec2, nx: number, ny: number, max: number): Vec2 | null => {
        for (let d = 0; d < max; d++)
        {
            const p = { x: from.x + nx * d, y: from.y + ny * d };
            if (!ctx.wet(p)) return p;
        }
        return null;
    };
    const dryAround = (p: Vec2) => !ctx.wet({ x: p.x - 5, y: p.y }) && !ctx.wet({ x: p.x + 5, y: p.y }) && !ctx.wet({ x: p.x, y: p.y - 5 });

    const decorate = (bank: Vec2, nx: number, ny: number) => {
        const at = (out: number, along: number) => ({ x: bank.x + nx * out - ny * along, y: bank.y + ny * out + nx * along });
        const roll = rng();
        if (roll < 0.4)
        {
            // Pebbles scattered on the sand right by the water.
            const p = at(randRange(rng, 3, 7), randRange(rng, -6, 6));
            if (ctx.isFree(p) && dryAround(p)) add('pebbles', p, randInt(rng, 0, 2));
        }
        else if (roll < 0.65)
        {
            for (let k = randInt(rng, 2, 4); k > 0; k--)
            {
                const p = at(randRange(rng, 2, 6), randRange(rng, -14, 14));
                if (ctx.isFree(p) && dryAround(p)) add('reeds', p);
            }
        }
        else if (roll < 0.88)
        {
            // Bank vegetation a little further from the water.
            for (let k = randInt(rng, 1, 3); k > 0; k--)
            {
                const p = at(randRange(rng, 9, 18), randRange(rng, -16, 16));
                if (ctx.isFree(p) && dryAround(p)) add(pick(rng, ['tallGrass', 'flowers', 'fern', 'shrub'] as DecorationKind[]), p, randInt(rng, 0, 2));
            }
        }
        else
        {
            // A boulder or a pile of wet rocks: solid, so kept away from crossings.
            const p = at(randRange(rng, 6, 12), 0);
            if (!ctx.isFree(p) || !dryAround(p) || ctx.nearTrail(p)) return;
            if (Math.hypot(p.x - ctx.spawn.x, p.y - ctx.spawn.y) < SOLID_SPAWN_CLEARANCE) return;
            if (ctx.solids.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 46)) return;
            ctx.solids.push(p);
            if (rng() < 0.45) add('boulder', p, randInt(rng, 0, 1));
            else add('shoreRock', p, randInt(rng, 0, 2));
        }
    };

    for (const body of ctx.bodies)
    {
        if (body.kind === 'pond')
        {
            const c = body.points[0];
            for (let k = 0; k < 16; k++)
            {
                const a = (k / 16) * Math.PI * 2 + randRange(rng, -0.15, 0.15);
                const bank = bankFrom(c, Math.cos(a), Math.sin(a), body.width);
                if (bank) decorate(bank, Math.cos(a), Math.sin(a));
            }
            continue;
        }
        const pts = body.points;
        for (let i = 0; i < pts.length - 1; i++)
        {
            const a = pts[i];
            const b = pts[i + 1];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            if (length === 0) continue;
            const nx = -(b.y - a.y) / length;
            const ny = (b.x - a.x) / length;
            for (let t = 0; t < length; t += 22)
            {
                const from = { x: a.x + ((b.x - a.x) * t) / length, y: a.y + ((b.y - a.y) * t) / length };
                for (const side of [-1, 1])
                {
                    if (rng() > 0.62) continue;
                    const bank = bankFrom(from, nx * side, ny * side, body.width + 12);
                    if (bank) decorate(bank, nx * side, ny * side);
                }
            }
        }
    }
    return out;
}

/**
 * The volcano biome's own scenery: charred trees, basalt columns, dark
 * rocks, steaming vents and old bones. Solid pieces keep well apart, so the
 * biome is as easy to cross and fight in as anywhere else.
 */
function placeVolcanoDecor (rng: Rng, ctx: PlacementContext, add: AddDecoration, touchesStructure: (p: Vec2) => boolean, edgeAdd: AddDecoration = add): void
{
    const biomeAt = ctx.biomeAt;
    if (!biomeAt) return;
    const solids: Vec2[] = [];
    const { playArea } = ctx;

    const find = (minHeat: number, solid: boolean): Vec2 | null => {
        for (let attempt = 0; attempt < 120; attempt++)
        {
            const p = {
                x: randRange(rng, playArea.x + 8, playArea.x + playArea.width - 8),
                y: randRange(rng, playArea.y + 12, playArea.y + playArea.height - 4),
            };
            if (biomeAt(p) < minHeat) continue;
            if (ctx.exclude && rectContains(ctx.exclude, p)) continue;
            if (touchesStructure(p) || ctx.onTrail(p) || ctx.inPool?.(p, 10) || ctx.nearWater?.(p) || ctx.inVillage?.(p)) continue;
            if (solid && solids.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 26)) continue;
            if (solid) solids.push(p);
            return p;
        }
        return null;
    };
    const place = (count: number, kind: DecorationKind, minHeat: number, solid: boolean) => {
        for (let i = 0; i < count; i++)
        {
            const p = find(minHeat, solid);
            if (p) add(kind, p.x, p.y);
        }
    };

    place(28, 'charredTree', 0.25, true);
    place(16, 'basalt', 0.55, true);
    place(30, 'rock', 0.4, false);
    place(30, 'rockSmall', 0.3, false);
    place(10, 'vent', 0.6, false);
    place(8, 'bones', 0.5, false);

    // The map edge beside the volcano: charred trees instead of green bushes.
    const left = playArea.x;
    const right = playArea.x + playArea.width;
    const top = playArea.y;
    const bottom = playArea.y + playArea.height;
    const edge = (x: number, y: number) => {
        const p = { x, y };
        if (biomeAt(p) > 0.3 && !ctx.onTrail(p) && !touchesStructure(p) && !ctx.nearWater?.(p) && !(ctx.exclude && ctx.inPool?.(p, 12))) edgeAdd(rng() < 0.6 ? 'charredTree' : 'rockSmall', x, y);
    };
    for (let x = left; x <= right; x += randRange(rng, 14, 24))
    {
        edge(x, top + randRange(rng, -8, 2));
        edge(x, bottom + randRange(rng, 6, 16));
    }
    for (let y = top; y <= bottom; y += randRange(rng, 14, 24))
    {
        edge(left + randRange(rng, -10, 0), y);
        edge(right + randRange(rng, 0, 10), y);
    }
}

// ---------------------------------------------------------------------------
// Item spawn area
// ---------------------------------------------------------------------------

/**
 * Rough space each decoration covers on screen (width x height above its
 * base), so items don't appear hidden behind or under it. Low ground
 * details (grass, ferns, bones, mushrooms, wisps) don't count.
 */
const DECORATION_COVER: Partial<Record<DecorationKind, { width: number; height: number }>> = {
    rock: { width: 12, height: 8 },
    rockSmall: { width: 7, height: 5 },
    boulder: { width: 22, height: 16 },
    pillar: { width: 12, height: 23 },
    ruinWall: { width: 24, height: 13 },
    deadTree: { width: 18, height: 19 },
    largeTree: { width: 36, height: 46 },
    pine: { width: 24, height: 42 },
    bush: { width: 16, height: 10 },
    runestone: { width: 10, height: 15 },
    gravestone: { width: 8, height: 11 },
    stump: { width: 10, height: 8 },
    log: { width: 22, height: 7 },
    fence: { width: 24, height: 8 },
    well: { width: 14, height: 16 },
    hay: { width: 12, height: 10 },
    crates: { width: 12, height: 11 },
    elderTree: { width: 44, height: 54 },
    birch: { width: 18, height: 40 },
    willow: { width: 38, height: 40 },
    giantShroom: { width: 26, height: 32 },
    sapling: { width: 10, height: 14 },
    shrub: { width: 16, height: 11 },
    shoreRock: { width: 14, height: 8 },
    charredTree: { width: 20, height: 28 },
    basalt: { width: 16, height: 18 },
    moonTree: { width: 40, height: 52 },
    spiralTree: { width: 34, height: 46 },
    lushFern: { width: 14, height: 9 },
    elvenPillar: { width: 12, height: 26 },
    faeFountain: { width: 22, height: 18 },
    lantern: { width: 6, height: 16 },
    faeStatue: { width: 12, height: 24 },
    crystalCluster: { width: 14, height: 16 },
    goldenOak: { width: 40, height: 48 },
    cypress: { width: 16, height: 44 },
    twistedYew: { width: 32, height: 38 },
    ashShrub: { width: 14, height: 9 },
    obsidian: { width: 14, height: 12 },
    gothicRuin: { width: 28, height: 30 },
    gargoyle: { width: 12, height: 18 },
    brazier: { width: 10, height: 12 },
    scorchedTree: { width: 30, height: 40 },
    smallFire: { width: 12, height: 12 },
    swampTree: { width: 38, height: 46 },
    swampTotem: { width: 10, height: 22 },
};

/** Extra empty space kept around structures, and from the map edge, for items. */
const ITEM_STRUCTURE_PADDING = 20;
const ITEM_EDGE_MARGIN_TILES = 2;

function findItemSpawnTiles (
    cols: number, rows: number, tileSize: number, playArea: Rect,
    structures: Structure[], decorations: Decoration[],
): number[]
{
    const blocked = new Uint8Array(cols * rows);

    /** Mark every tile that overlaps a world-pixel rectangle. */
    const blockRect = (rect: Rect) => {
        const c0 = clampIndex(rect.x / tileSize, cols);
        const c1 = clampIndex((rect.x + rect.width) / tileSize, cols);
        const r0 = clampIndex(rect.y / tileSize, rows);
        const r1 = clampIndex((rect.y + rect.height) / tileSize, rows);
        for (let r = r0; r <= r1; r++)
        {
            for (let c = c0; c <= c1; c++) blocked[r * cols + c] = 1;
        }
    };

    for (const structure of structures)
    {
        blockRect(structureArea(structure, ITEM_STRUCTURE_PADDING));
    }

    for (const d of decorations)
    {
        const cover = DECORATION_COVER[d.kind];
        if (cover) blockRect({ x: d.x - cover.width / 2, y: d.y - cover.height, width: cover.width, height: cover.height });
    }

    const margin = ITEM_EDGE_MARGIN_TILES * tileSize;
    const open: number[] = [];

    for (let r = 0; r < rows; r++)
    {
        for (let c = 0; c < cols; c++)
        {
            const left = c * tileSize;
            const top = r * tileSize;
            const insideSafeArea =
                left >= playArea.x + margin &&
                top >= playArea.y + margin &&
                left + tileSize <= playArea.x + playArea.width - margin &&
                top + tileSize <= playArea.y + playArea.height - margin;

            if (insideSafeArea && !blocked[r * cols + c]) open.push(r * cols + c);
        }
    }

    return open;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Random number between -amount and +amount. */
function jitter (rng: Rng, amount: number): number
{
    return (rng() * 2 - 1) * amount;
}

function clampIndex (value: number, length: number): number
{
    return Math.max(0, Math.min(length - 1, Math.floor(value)));
}

/**
 * Smooth "value noise": random values on a coarse grid, blended together.
 * Produces soft blobs (0..1), good for natural-looking patches.
 */
function valueNoise (rng: Rng, cols: number, rows: number, cellSize: number): number[][]
{
    const gridWidth = Math.ceil(cols / cellSize) + 2;
    const gridHeight = Math.ceil(rows / cellSize) + 2;
    const grid = Array.from({ length: gridHeight }, () => Array.from({ length: gridWidth }, () => rng()));

    const smooth = (t: number) => t * t * (3 - 2 * t);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const result: number[][] = [];
    for (let y = 0; y < rows; y++)
    {
        const gy = y / cellSize;
        const y0 = Math.floor(gy);
        const ty = smooth(gy - y0);
        const line: number[] = [];

        for (let x = 0; x < cols; x++)
        {
            const gx = x / cellSize;
            const x0 = Math.floor(gx);
            const tx = smooth(gx - x0);
            const topBlend = lerp(grid[y0][x0], grid[y0][x0 + 1], tx);
            const bottomBlend = lerp(grid[y0 + 1][x0], grid[y0 + 1][x0 + 1], tx);
            line.push(lerp(topBlend, bottomBlend, ty));
        }

        result.push(line);
    }

    return result;
}
