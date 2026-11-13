import { BlendModes, GameObjects, Scene } from 'phaser';
import { addWater } from './WaterView';
import { addTerrain } from './TerrainView';
import { addForestLife } from './ForestView';
import { addSwampLife } from './SwampView';
import { addCrystalLife, buildArenaScenery } from './CrystalView';
import { swampAt } from '../logic/Biomes';
import { addLavaRivers } from './LavaView';
import { addLavaBridges } from './LavaBridgeView';
import type { Accent, BattlefieldLayout, Decoration, DecorationKind } from '../logic/BattlefieldLayout';
import { addGlow } from './Glow';
import { NatureTex } from './NatureArt';
import { hexToInt, Palette } from './Palette';
import { Tex } from './PlaceholderArt';
import type { SeeThroughGroup } from './SeeThrough';
import { addTrails } from './TrailView';
import { bakeFlatDecorations } from './GroundBake';

/**
 * Draws the battlefield described by a BattlefieldLayout.
 * Objects are layered by their y position ("depth = y"), so things lower
 * on screen appear in front, which gives a top-down sense of depth.
 */

export const Depth = {
    Ground: -1_000_000,
    /** Sandy banks, ash, fissures and lava pools painted on the ground. */
    Terrain: -999_999.75,
    /** Lava rivers: above the ground, below the trails (so the basalt bridges cross over them). */
    Lava: -999_999.6,
    /** Water sits under the trails, so the bridges drawn with them cross over it. */
    Water: -999_999.5,
    Trails: -999_999,
    /** Flat decorations baked into the ground (pebbles, flowers, tree shadows...). */
    FlatDecorations: -999_998,
    Wisps: 900_000,
    Overlay: 1_000_000,
} as const;

/** Texture for each plain decoration kind. */
const TEXTURE_FOR: Record<Exclude<DecorationKind, 'runestone' | 'glowShroom' | 'wisp'>, (variant: number) => string> = {
    rock: () => Tex.Rock,
    rockSmall: () => Tex.RockSmall,
    boulder: NatureTex.boulder,
    pillar: () => Tex.Pillar,
    ruinWall: () => Tex.RuinWall,
    gravestone: () => NatureTex.Gravestone,
    deadTree: () => Tex.DeadTree,
    largeTree: NatureTex.largeTree,
    pine: NatureTex.pine,
    bush: () => Tex.Bush,
    fern: () => NatureTex.Fern,
    tallGrass: () => NatureTex.TallGrass,
    stump: () => NatureTex.Stump,
    log: () => NatureTex.Log,
    bones: () => NatureTex.Bones,
    fence: () => NatureTex.Fence,
    well: () => NatureTex.Well,
    hay: () => NatureTex.Hay,
    crates: () => NatureTex.Crates,
    flowers: () => NatureTex.Flowers,
    elderTree: NatureTex.elderTree,
    birch: NatureTex.birch,
    willow: () => NatureTex.Willow,
    giantShroom: NatureTex.giantShroom,
    sapling: () => NatureTex.Sapling,
    shrub: NatureTex.shrub,
    shoreRock: NatureTex.shoreRock,
    reeds: () => NatureTex.Reeds,
    charredTree: NatureTex.charredTree,
    basalt: NatureTex.basalt,
    vent: () => NatureTex.Vent,
    moonTree: NatureTex.moonTree,
    spiralTree: NatureTex.spiralTree,
    glowFlower: NatureTex.glowFlower,
    fairyRing: () => NatureTex.FairyRing,
    lushFern: () => NatureTex.LushFern,
    elvenPillar: NatureTex.elvenPillar,
    faeFountain: () => NatureTex.FaeFountain,
    lantern: () => NatureTex.Lantern,
    faeStatue: () => NatureTex.FaeStatue,
    crystalCluster: NatureTex.crystalCluster,
    goldenOak: NatureTex.goldenOak,
    cypress: NatureTex.cypress,
    twistedYew: NatureTex.twistedYew,
    pebbles: NatureTex.pebbles,
    ashShrub: NatureTex.ashShrub,
    obsidian: NatureTex.obsidian,
    gothicRuin: NatureTex.gothicRuin,
    gargoyle: () => NatureTex.Gargoyle,
    brazier: () => NatureTex.Brazier,
    scorchedTree: NatureTex.scorchedTree,
    smallFire: () => NatureTex.SmallFire,
    swampTree: NatureTex.swampTree,
    swampBush: NatureTex.swampBush,
    swampShroom: NatureTex.swampShroom,
    glowPlant: NatureTex.glowPlant,
    lilyPad: NatureTex.lilyPad,
    swampTotem: () => NatureTex.SwampTotem,
    giantCrystal: NatureTex.giantCrystal,
    crystalShard: NatureTex.crystalShard,
};

/** Big things that get a ground shadow (shadow width in world pixels). */
const SHADOW_WIDTH: Partial<Record<DecorationKind, number>> = {
    largeTree: 22,
    pine: 18,
    boulder: 22,
    deadTree: 12,
    log: 22,
    elderTree: 30,
    birch: 10,
    willow: 26,
    giantShroom: 16,
    charredTree: 12,
    basalt: 16,
    shoreRock: 12,
    moonTree: 26,
    spiralTree: 20,
    elvenPillar: 12,
    faeFountain: 22,
    goldenOak: 28,
    cypress: 10,
    twistedYew: 22,
    gothicRuin: 26,
    obsidian: 12,
    scorchedTree: 14,
    swampTree: 24,
    giantCrystal: 18,
};

/** Tall things that turn see-through when your soldiers walk behind them. */
const SEE_THROUGH_KINDS = new Set<DecorationKind>(['largeTree', 'pine', 'deadTree', 'elderTree', 'birch', 'willow', 'giantShroom', 'charredTree', 'moonTree', 'spiralTree', 'goldenOak', 'cypress', 'twistedYew', 'gothicRuin', 'scorchedTree', 'swampTree', 'giantCrystal']);

/** Things lying flat on the ground: soldiers walk over them, never behind them, so they're baked into the ground. */
const FLAT_KINDS = new Set<DecorationKind>(['rockSmall', 'pebbles', 'flowers', 'bones', 'fairyRing', 'lilyPad']);

export function buildBattlefieldView (scene: Scene, layout: BattlefieldLayout, seeThrough: SeeThroughGroup): void
{
    buildGround(scene, layout);
    addTerrain(scene, layout, Depth.Terrain);
    addLavaRivers(scene, layout, Depth.Lava);
    addLavaBridges(scene, layout);
    addForestLife(scene, layout);
    addSwampLife(scene, layout);
    addCrystalLife(scene, layout);
    const biomes = layout.biomes;
    addWater(scene, layout.water, layout.worldWidth, layout.worldHeight, Depth.Water, biomes ? (x, y) => swampAt(biomes, x, y) : undefined);
    addTrails(scene, layout, Depth.Trails);

    const flat: GameObjects.Image[] = [];
    for (const decoration of layout.decorations)
    {
        addDecoration(scene, decoration, seeThrough, flat);
    }
    bakeFlatDecorations(scene, flat, layout.worldWidth, layout.worldHeight, Depth.FlatDecorations);
    buildArenaScenery(scene, layout);
}

/**
 * Dark edges around the screen. Fixed to the camera, not the world.
 * Call `fitVignette` whenever the camera zoom changes.
 */
export function addVignette (scene: Scene): GameObjects.Image
{
    const camera = scene.cameras.main;
    const vignette = scene.add.image(camera.width / 2, camera.height / 2, Tex.Vignette)
        .setScrollFactor(0)
        .setDepth(Depth.Overlay);
    fitVignette(vignette, camera.width, camera.height, camera.zoom);
    return vignette;
}

/** Keep the vignette covering exactly the screen at the current zoom. */
export function fitVignette (vignette: GameObjects.Image, width: number, height: number, zoom: number): void
{
    vignette.setDisplaySize(width / zoom, height / zoom);
}

function buildGround (scene: Scene, layout: BattlefieldLayout): void
{
    const map = scene.make.tilemap({
        data: layout.ground,
        tileWidth: layout.tileSize,
        tileHeight: layout.tileSize,
    });

    const tileset = map.addTilesetImage(Tex.Ground, Tex.Ground, layout.tileSize, layout.tileSize, 0, 0);
    if (!tileset)
    {
        throw new Error('Could not create the ground tileset.');
    }

    map.createLayer(0, tileset, 0, 0)?.setDepth(Depth.Ground);
}

function addDecoration (scene: Scene, d: Decoration, seeThrough: SeeThroughGroup, flat: GameObjects.Image[]): void
{
    const accent: Accent = d.accent ?? 'green';

    switch (d.kind)
    {
        case 'runestone':
            addSprite(scene, Tex.runestone(accent), d);
            addGlow(scene, d.x, d.y - 8, Palette.accent[accent], { scale: 1.1, depth: d.y + 1 });
            break;

        case 'glowShroom':
            addSprite(scene, Tex.shroom(accent), d);
            addGlow(scene, d.x, d.y - 4, Palette.accent[accent], { scale: 0.45, depth: d.y + 1 });
            break;

        case 'wisp':
            addWisp(scene, d, accent);
            break;

        default:
        {
            const shadowWidth = SHADOW_WIDTH[d.kind];
            if (shadowWidth)
            {
                flat.push(scene.add.image(d.x, d.y - 1, Tex.Shadow)
                    .setDisplaySize(shadowWidth, 6)
                    .setAlpha(0.7)
                    .setDepth(d.y - 0.5));
            }

            const sprite = addSprite(scene, TEXTURE_FOR[d.kind](d.variant), d);
            if (FLAT_KINDS.has(d.kind)) flat.push(sprite);
            else if (SEE_THROUGH_KINDS.has(d.kind))
            {
                seeThrough.add(sprite, d.x, d.y, sprite.width, sprite.height);
            }
        }
    }
}

function addSprite (scene: Scene, texture: string, d: Decoration)
{
    return scene.add.image(d.x, d.y, texture)
        .setOrigin(0.5, 1)
        .setFlipX(d.flip)
        .setDepth(d.y);
}

/** A small floating light that drifts and flickers. */
function addWisp (scene: Scene, d: Decoration, accent: Accent): void
{
    const core = scene.add.image(d.x, d.y, Tex.wisp(accent)).setDepth(Depth.Wisps);
    const glow = scene.add.image(d.x, d.y, Tex.Glow)
        .setTint(hexToInt(Palette.accent[accent]))
        .setBlendMode(BlendModes.ADD)
        .setScale(0.6)
        .setAlpha(0.5)
        // Over its core as before; all wisp glows together, so they batch (see Glow.ts).
        .setDepth(Depth.Wisps + 0.5);

    scene.tweens.add({
        targets: [core, glow],
        x: d.x + (Math.random() * 20 - 10),
        y: d.y - (6 + Math.random() * 8),
        alpha: { from: 0.3, to: 0.8 },
        duration: 2000 + Math.random() * 2000,
        delay: Math.random() * 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
    });
}
