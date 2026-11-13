import { Scene } from 'phaser';
import { DECORATION_VARIANTS } from '../logic/BattlefieldLayout';
import { createRng } from '../logic/Random';
import { Palette } from './Palette';
import { PixelPainter, textureFromPixelMap } from './PixelPainter';

/**
 * Placeholder nature art: big eerie trees, pines, boulders (painted in code
 * with a few variants each), plus small ground details as pixel maps.
 */

export const NatureTex = {
    largeTree: (variant: number) => `large-tree-${variant}`,
    pine: (variant: number) => `pine-${variant}`,
    boulder: (variant: number) => `boulder-${variant}`,
    Log: 'log',
    Stump: 'stump',
    Gravestone: 'gravestone',
    TallGrass: 'tall-grass',
    Fern: 'fern',
    Bones: 'bones',
    Fence: 'fence',
    Well: 'well',
    Hay: 'hay',
    Crates: 'crates',
    Flowers: 'flowers',
    elderTree: (variant: number) => `elder-tree-${variant}`,
    birch: (variant: number) => `birch-${variant}`,
    Willow: 'willow',
    giantShroom: (variant: number) => `giant-shroom-${variant}`,
    Sapling: 'sapling',
    shrub: (variant: number) => `shrub-${variant}`,
    shoreRock: (variant: number) => `shore-rock-${variant}`,
    Reeds: 'reeds',
    charredTree: (variant: number) => `charred-tree-${variant}`,
    basalt: (variant: number) => `basalt-${variant}`,
    Vent: 'vent',
    moonTree: (variant: number) => `moon-tree-${variant}`,
    spiralTree: (variant: number) => `spiral-tree-${variant}`,
    glowFlower: (variant: number) => `glow-flower-${variant}`,
    FairyRing: 'fairy-ring',
    LushFern: 'lush-fern',
    elvenPillar: (variant: number) => `elven-pillar-${variant}`,
    FaeFountain: 'fae-fountain',
    Lantern: 'lantern',
    FaeStatue: 'fae-statue',
    crystalCluster: (variant: number) => `crystal-cluster-${variant}`,
    giantCrystal: (variant: number) => `giant-crystal-${variant}`,
    crystalShard: (variant: number) => `crystal-shard-${variant}`,
    goldenOak: (variant: number) => `golden-oak-${variant}`,
    cypress: (variant: number) => `cypress-${variant}`,
    twistedYew: (variant: number) => `twisted-yew-${variant}`,
    pebbles: (variant: number) => `pebbles-${variant}`,
    ashShrub: (variant: number) => `ash-shrub-${variant}`,
    obsidian: (variant: number) => `obsidian-${variant}`,
    gothicRuin: (variant: number) => `gothic-ruin-${variant}`,
    Gargoyle: 'gargoyle',
    Brazier: 'brazier',
    scorchedTree: (variant: number) => `scorched-tree-${variant}`,
    SmallFire: 'small-fire',
    swampTree: (variant: number) => `swamp-tree-${variant}`,
    swampBush: (variant: number) => `swamp-bush-${variant}`,
    swampShroom: (variant: number) => `swamp-shroom-${variant}`,
    glowPlant: (variant: number) => `glow-plant-${variant}`,
    lilyPad: (variant: number) => `lily-pad-${variant}`,
    SwampTotem: 'swamp-totem',
} as const;

/** Glow colours of the swamp's plants and mushrooms: sickly lime and pale moon-teal-green (never cyan). */
export const SWAMP_GLOW_COLORS = ['#b6ff5c', '#7dffb0'];

/** Glow colours of the enchanted forest's flowers: violet, rose, gold (no cyan: that's Soul Shards). */
export const GLOW_FLOWER_COLORS = ['#c08bff', '#ff8fc8', '#ffd36a'];

/** Foliage sets for the new trees, light to dark. */
const ELDER_LEAVES = [
    ['#a684d9', '#8262b6', '#62468f', '#432e66'], // violet
    ['#eaa54c', '#c97230', '#9b4b23', '#6a3018'], // autumn
    ['#f7d7e6', '#e8a8c6', '#c47ca1', '#8e5576'], // blossom
];
const BIRCH_LEAVES = [
    ['#acca6a', '#89ab4e', '#698c3c', '#4b6b2d'],
    ['#f1d46c', '#d7b14b', '#ae8b35', '#7f6627'],
];
const WILLOW_LEAVES = ['#93b75c', '#729846', '#587a37', '#3e5c2a'];
const BASALT_ROCK = ['#6a5752', '#54443f', '#40332f', '#2e2422', '#1f1817'];
const EMBER = { hot: '#ffb347', mid: '#ef6a1d', deep: '#a8380f' };

export function createNatureTextures (scene: Scene): void
{
    for (let v = 0; v < (DECORATION_VARIANTS.largeTree ?? 1); v++)
    {
        paint(scene, NatureTex.largeTree(v), 36, 46, 900 + v, (p) => paintLargeTree(p, v));
    }
    for (let v = 0; v < (DECORATION_VARIANTS.pine ?? 1); v++)
    {
        paint(scene, NatureTex.pine(v), 24, 42, 950 + v, paintPine);
    }
    for (let v = 0; v < (DECORATION_VARIANTS.boulder ?? 1); v++)
    {
        paint(scene, NatureTex.boulder(v), 22, 16, 980 + v, (p) => paintBoulder(p, v));
    }

    const W = Palette.wood;
    const S = Palette.stone;
    const G = Palette.grassBlade;

    textureFromPixelMap(scene, NatureTex.TallGrass, TALL_GRASS, { a: G.light, b: G.mid, c: G.dark });
    textureFromPixelMap(scene, NatureTex.Fern, FERN, { a: Palette.foliage.light, b: Palette.foliage.mid, c: Palette.foliage.dark });
    textureFromPixelMap(scene, NatureTex.Stump, STUMP, { o: Palette.outline, L: '#7a6142', l: '#5b4630', M: W.mid, m: S.moss });
    textureFromPixelMap(scene, NatureTex.Log, LOG, { o: Palette.outline, M: W.mid, m: S.moss, d: W.dark, L: '#7a6142', l: '#5b4630' });
    textureFromPixelMap(scene, NatureTex.Gravestone, GRAVESTONE, { o: Palette.outline, L: S.light, S: S.mid, s: S.dark, r: S.darkest, m: S.moss });
    textureFromPixelMap(scene, NatureTex.Bones, BONES, { o: Palette.outline, W: Palette.bone.light, w: Palette.bone.shade });

    // --- Village props ---
    paint(scene, NatureTex.Fence, 24, 8, 1001, paintFence);
    paint(scene, NatureTex.Well, 14, 16, 1002, paintWell);
    paint(scene, NatureTex.Hay, 12, 10, 1003, (p) => {
        p.shadedBlob(6, 5, 5, 4, ['#f2d98a', '#dcb95c', '#b9933c', '#8e6c27']);
        for (const x of [3, 6, 9]) p.line(x, 2, x, 8, '#b9933c');
    });
    paint(scene, NatureTex.Crates, 12, 11, 1004, paintCrates);
    textureFromPixelMap(scene, NatureTex.Flowers, FLOWERS, { g: '#4a7a35', r: '#d8432f', y: '#f2c94c', w: '#f4f0e6', p: '#9a5fc4' });

    // --- Mythical trees and vegetation ---
    for (let v = 0; v < 3; v++) paint(scene, NatureTex.elderTree(v), 44, 54, 1100 + v, (p) => paintElderTree(p, v));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.birch(v), 18, 40, 1110 + v, (p) => paintBirch(p, v));
    paint(scene, NatureTex.Willow, 38, 40, 1120, paintWillow);
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.giantShroom(v), 26, 34, 1130 + v, (p) => paintGiantShroom(p, v));
    paint(scene, NatureTex.Sapling, 10, 14, 1140, (p) => {
        p.line(5, 13, 5, 6, W.mid);
        p.shadedBlob(5, 5, 4, 4, Palette.treeFoliage.slice().reverse(), 0.05);
    });
    for (let v = 0; v < 3; v++) paint(scene, NatureTex.shrub(v), 16, 11, 1150 + v, (p) => paintShrub(p, v));

    // --- River banks ---
    for (let v = 0; v < 3; v++) paint(scene, NatureTex.shoreRock(v), 14, 8, 1160 + v, (p) => paintShoreRock(p, v));
    textureFromPixelMap(scene, NatureTex.Reeds, REEDS, { a: '#8fae5a', b: '#5f7e3c', c: '#3f5a2b', t: '#6b4426', T: '#4a2e1a' });

    // --- Volcano biome ---
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.charredTree(v), 20, 28, 1170 + v, (p) => paintCharredTree(p, v));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.basalt(v), 16, 18, 1180 + v, (p) => paintBasalt(p, v));
    // --- Enchanted forest ---
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.moonTree(v), 40, 52, 1200 + v, (p) => paintMoonTree(p, v));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.spiralTree(v), 34, 46, 1210 + v, (p) => paintSpiralTree(p, v));
    for (let v = 0; v < 3; v++) paint(scene, NatureTex.glowFlower(v), 10, 8, 1220 + v, (p) => paintGlowFlower(p, v));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.elvenPillar(v), 12, 26, 1230 + v, (p) => paintElvenPillar(p, v));
    paint(scene, NatureTex.LushFern, 14, 9, 1240, (p) => {
        const F = ['#8fd07a', '#5fae5a', '#3f8a46', '#2a6534'];
        for (let i = 0; i < 7; i++)
        {
            const a = Math.PI * (1.08 + i * 0.14);
            p.line(7, 8, 7 + Math.cos(a) * 7, 8 + Math.sin(a) * 7, F[i % 2 === 0 ? 1 : 2]);
            p.set(7 + Math.cos(a) * 6, 8 + Math.sin(a) * 6, F[0]);
        }
        p.rect(5, 7, 5, 2, F[3]);
    });
    textureFromPixelMap(scene, NatureTex.FairyRing, FAIRY_RING, { r: '#e05a48', w: '#f6eedd', p: '#b783f0', s: '#cfc6b0' });
    paint(scene, NatureTex.FaeFountain, 22, 18, 1250, paintFaeFountain);
    paint(scene, NatureTex.Lantern, 6, 16, 1260, (p) => {
        p.rect(2, 4, 2, 12, W.dark);
        p.rect(0, 1, 6, 1, W.mid);
        p.rect(1, 2, 4, 4, Palette.flame[1]);
        p.rect(2, 3, 2, 2, '#fff2c8');
    });

    // --- More trees, castle grounds, riverbanks, volcanic wastes ---
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.goldenOak(v), 40, 48, 1300 + v, (p) => paintGoldenOak(p, v));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.cypress(v), 16, 44, 1310 + v, (p) => paintCypress(p, v));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.twistedYew(v), 32, 38, 1320 + v, (p) => paintTwistedYew(p, v));
    paint(scene, NatureTex.FaeStatue, 12, 24, 1330, paintFaeStatue);
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.crystalCluster(v), 14, 16, 1340 + v, (p) => paintCrystals(p, v));

    // --- Crystal biome ---
    for (let v = 0; v < 6; v++) paint(scene, NatureTex.giantCrystal(v), 26, 44, 1900 + v, (p) => paintGiantCrystal(p, v));
    for (let v = 0; v < 3; v++) paint(scene, NatureTex.crystalShard(v), 10, 10, 1910 + v, (p) => paintCrystalShard(p, v));
    for (let v = 0; v < 3; v++) paint(scene, NatureTex.pebbles(v), 14, 6, 1350 + v, (p) => paintPebbles(p));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.ashShrub(v), 14, 9, 1360 + v, (p) => paintAshShrub(p, v));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.obsidian(v), 14, 12, 1370 + v, (p) => paintObsidian(p, v));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.gothicRuin(v), 28, 30, 1380 + v, (p) => paintGothicRuin(p, v));
    paint(scene, NatureTex.Gargoyle, 12, 18, 1390, paintGargoyle);
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.scorchedTree(v), 30, 40, 1400 + v, (p) => paintScorchedTree(p, v));
    // A small ground fire: crossed charred logs on glowing embers (flames are animated separately).
    paint(scene, NatureTex.SmallFire, 12, 7, 1410, (p) => {
        p.shadedBlob(6, 5, 5, 2, ['#ffb347', '#ef6a1d', '#a8380f', '#4a1a0c']);
        p.line(1, 6, 10, 3, '#2a2020');
        p.line(1, 3, 10, 6, '#3a302c');
        p.set(4, 4, '#ffe08a');
        p.set(8, 5, '#ffe08a');
    });
    paint(scene, NatureTex.Brazier, 10, 12, 1395, (p) => {
        p.rect(4, 6, 2, 6, '#28252e');
        p.rect(2, 10, 6, 2, '#38343f');
        p.shadedBlob(5, 5, 4, 2, ['#625c68', '#4b4652', '#28252e']);
        p.rect(3, 2, 4, 3, Palette.flame[0]);
        p.rect(4, 1, 2, 2, Palette.flame[1]);
        p.set(5, 0, '#fff2c8');
    });

    // --- Swamp ---
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.swampTree(v), 38, 46, 1500 + v, (p) => paintSwampTree(p, v));
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.swampBush(v), 16, 11, 1510 + v, (p) => {
        const leaves = v === 0 ? ['#7a8a4a', '#5c6e38', '#43532a', '#2e3b1e'] : ['#6a7d5a', '#4f6245', '#3a4a34', '#273325'];
        p.shadedBlob(8, 6, 7, 4, leaves, 0.08);
        p.shadedBlob(4, 7, 3, 3, leaves, 0.05);
        p.shadedBlob(12, 7, 3, 3, leaves, 0.05);
        if (v === 1) for (let i = 0; i < 3; i++) p.set(3 + p.rng() * 10, 3 + p.rng() * 5, '#d8d0a0'); // pale swamp berries
    });
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.swampShroom(v), 12, 10, 1520 + v, (p) => {
        const caps = v === 0 ? ['#d9e6a0', '#a8c060', '#7a9040', '#4f6028'] : ['#c9b48a', '#a08860', '#7a6440', '#52422a'];
        const shroom = (x: number, y: number, r: number) => {
            p.rect(x, y, 1, 10 - y, '#d8d0b8');
            p.shadedBlob(x, y, r, Math.max(1, r - 1), caps);
            if (v === 0) p.set(x, y - 1, '#f2ffd0');
        };
        shroom(4, 4, 3);
        shroom(8, 6, 2);
        shroom(10, 8, 1);
    });
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.glowPlant(v), 10, 12, 1530 + v, (p) => {
        const glow = SWAMP_GLOW_COLORS[v];
        for (const [x0, top] of [[2, 4], [5, 1], [8, 5]] as const)
        {
            p.line(5, 11, x0, top + 2, '#3e5a2c');
            p.rect(x0 - 1, top, 2, 2, glow);
            p.set(x0 - 1, top, '#f4ffe8');
        }
        p.rect(3, 10, 5, 2, '#2f4422');
    });
    for (let v = 0; v < 2; v++) paint(scene, NatureTex.lilyPad(v), 14, 7, 1540 + v, (p) => {
        const pad = ['#7fa85a', '#5e8a42', '#456a32'];
        p.shadedBlob(5, 3, 4, 2, pad);
        p.set(5, 2, '#2a3a20');
        p.set(6, 2, '#2a3a20');
        p.shadedBlob(11, 5, 2, 1, pad);
        if (v === 0) { p.rect(4, 1, 2, 2, '#f4e6f0'); p.set(5, 1, '#e8a8c6'); } // a pale water-lily flower
    });
    paint(scene, NatureTex.SwampTotem, 10, 22, 1550, (p) => {
        const W = ['#7a6142', '#5b4630', '#3e2f20'];
        p.rect(3, 4, 4, 18, W[1]);
        p.rect(3, 4, 1, 18, W[0]);
        p.rect(6, 4, 1, 18, W[2]);
        p.shadedBlob(5, 4, 4, 3, W);              // carved head
        p.set(3, 4, '#b6ff5c');                    // glowing eyes
        p.set(6, 4, '#b6ff5c');
        p.line(0, 9, 3, 11, W[1]);                 // little arms with hanging reeds
        p.line(9, 9, 6, 11, W[1]);
        p.line(0, 10, 0, 14, '#8fae5a');
        p.line(9, 10, 9, 14, '#8fae5a');
        p.speckle(2, 16, 6, 6, '#4f6a32', 0.35);   // moss on the base
    });

    paint(scene, NatureTex.Vent, 12, 6, 1190, (p) => {
        p.shadedBlob(6, 3, 6, 3, BASALT_ROCK.slice(1));
        p.rect(4, 2, 4, 2, EMBER.deep);
        p.rect(5, 2, 2, 1, EMBER.hot);
        p.set(6, 3, EMBER.mid);
    });
}

/** 40 x 48: a broad golden oak (variant 1: deep blood-red autumn), wide round crown on a stout trunk. */
function paintGoldenOak (p: PixelPainter, variant: number): void
{
    const W = Palette.wood;
    const rng = p.rng;
    const leaves = variant === 0 ? ['#f6d36a', '#e0aa3c', '#b57c27', '#7e521a'] : ['#e8664a', '#c23a2c', '#8e2620', '#5c1916'];
    for (let y = 47; y >= 22; y--)
    {
        const half = y > 43 ? 4 : 3;
        for (let x = 20 - half; x <= 20 + half; x++) p.set(x, y, x === 20 - half ? W.light : x === 20 + half ? W.dark : rng() < 0.1 ? W.dark : W.mid);
    }
    p.line(17, 30, 9, 22, W.mid);
    p.line(23, 30, 31, 22, W.mid);
    for (let i = 0; i < 11; i++) p.shadedBlob(20 + (rng() * 2 - 1) * 13, 13 + rng() * 11, 5 + Math.floor(rng() * 4), 4 + Math.floor(rng() * 3), leaves, 0.03);
    for (let i = 0; i < 5; i++) p.set(6 + rng() * 28, 40 + rng() * 6, leaves[1]); // fallen leaves
}

/** 16 x 44: a tall, narrow cypress (variant 1 a little bluer). */
function paintCypress (p: PixelPainter, variant: number): void
{
    const leaves = variant === 0 ? ['#4f8a4a', '#3a6e3a', '#2a552d', '#1c3d21'] : ['#4a7f6a', '#356552', '#264d3e', '#18352b'];
    for (let y = 0; y < 40; y++)
    {
        const t = y / 40;
        const half = Math.round(1 + Math.sin(Math.PI * Math.min(1, t * 1.15)) * 6);
        for (let x = -half; x <= half; x++)
        {
            const shade = x < -half / 3 ? 0 : x > half / 3 ? 2 : 1;
            p.set(8 + x, y, (y + x * 2) % 7 === 0 ? leaves[3] : leaves[shade]);
        }
    }
    p.rect(7, 40, 2, 4, Palette.wood.mid);
}

/** 32 x 38: a gnarled twisted yew: dark needles in clumps, red berries, a knotted trunk. */
function paintTwistedYew (p: PixelPainter, variant: number): void
{
    const W = Palette.wood;
    const rng = p.rng;
    for (let y = 37; y >= 16; y--)
    {
        const sway = Math.round(Math.sin(y * 0.3 + variant) * 3);
        p.rect(15 + sway, y, 4, 1, W.mid);
        p.set(15 + sway, y, W.light);
        p.set(18 + sway, y, W.dark);
    }
    p.line(14, 24, 6, 18, W.mid);
    p.line(19, 22, 27, 16, W.mid);
    const leaves = ['#3f6a3a', '#2d5230', '#203d24', '#152a18'];
    for (let i = 0; i < 7; i++) p.shadedBlob(16 + (rng() * 2 - 1) * 11, 9 + rng() * 10, 4 + Math.floor(rng() * 3), 3 + Math.floor(rng() * 3), leaves, 0.05);
    for (let i = 0; i < 9; i++) p.set(5 + rng() * 22, 4 + rng() * 16, '#c8302a');
}

/** 12 x 24: an elven statue of a hooded figure on a plinth, ivy at its feet. */
function paintFaeStatue (p: PixelPainter): void
{
    const M = ['#f1ece2', '#d9d2c4', '#b9b1a2', '#8f8879'];
    p.rect(1, 19, 10, 5, M[2]);
    p.rect(1, 19, 10, 1, M[0]);
    p.shadedBlob(6, 4, 3, 3, M);            // hooded head
    for (let y = 7; y < 19; y++)
    {
        const half = 2 + Math.floor((y - 7) / 4);
        for (let x = -half; x <= half; x++) p.set(6 + x, y, x < 0 ? M[0] : x === 0 ? M[1] : M[2]);
    }
    p.line(3, 10, 1, 4, M[1]);               // a raised arm holding a light
    p.set(1, 3, '#c9a2ff');
    p.speckle(1, 18, 10, 6, '#4f8a3f', 0.3);
}

/** 14 x 16: violet crystals jutting from the ground (variant 1: rose). */
function paintCrystals (p: PixelPainter, variant: number): void
{
    const c = variant === 0 ? ['#efe0ff', '#c9a2ff', '#9a68e0', '#6a3fae'] : ['#ffe2ef', '#ff9fcd', '#d9609c', '#9a3a6a'];
    const shard = (x: number, top: number, w: number) => {
        for (let y = top; y < 15; y++)
        {
            const half = Math.min(w, Math.floor((y - top) / 2) + 1);
            for (let dx = -half; dx <= half; dx++) p.set(x + dx, y, dx < 0 ? c[0] : dx === 0 ? c[1] : c[2]);
        }
    };
    shard(7, 0, 2);
    shard(3, 5, 2);
    shard(11, 6, 1);
    p.rect(1, 14, 12, 2, c[3]);
}

/** Crystal hues, light to dark: blue, violet, green. */
const CRYSTAL_SHADES = [
    ['#e8f8ff', '#9fe0ff', '#4fa8e0', '#2a5f9a', '#1a3460'],
    ['#f4ebff', '#d6b4ff', '#9a68e0', '#6a3fae', '#3a2266'],
    ['#eafff2', '#a8ffc8', '#4fd88c', '#2a8a5a', '#174a32'],
] as const;

/**
 * 26 x 44: a towering crystal of the crystal biome (variant % 3: blue, violet,
 * green; variants 3-5 a twin-spire shape), its facets lit from the upper left.
 */
function paintGiantCrystal (p: PixelPainter, variant: number): void
{
    const c = CRYSTAL_SHADES[variant % 3];
    const spire = (cx: number, top: number, half: number, bottom: number) => {
        for (let y = top; y <= bottom; y++)
        {
            const w = Math.min(half, Math.floor((y - top) * 0.55) + 1);
            for (let dx = -w; dx <= w; dx++)
            {
                const shade = dx < -w / 2 ? c[0] : dx < 0 ? c[1] : dx === 0 ? c[2] : dx < w / 2 ? c[3] : c[4];
                p.set(cx + dx, y, shade);
            }
        }
        // A bright glint near the tip.
        p.set(cx - 1, top + 3, '#ffffff');
        p.set(cx - 1, top + 4, c[0]);
    };
    if (variant < 3)
    {
        spire(13, 0, 6, 41);
        spire(6, 16, 4, 41);
        spire(20, 22, 3, 41);
    }
    else
    {
        spire(9, 2, 5, 41);
        spire(17, 8, 5, 41);
        spire(4, 26, 2, 41);
    }
    // Rocky base it grows from.
    p.rect(2, 40, 22, 3, '#262a40');
    p.speckle(2, 40, 22, 3, '#3a3f5c', 0.4);
}

/** 10 x 10: a little crystal shard poking out of the moss (blue, violet, green). */
function paintCrystalShard (p: PixelPainter, variant: number): void
{
    const c = CRYSTAL_SHADES[variant % 3];
    for (let y = 1; y < 9; y++)
    {
        const w = Math.min(2, Math.floor((y - 1) / 2));
        for (let dx = -w; dx <= w; dx++) p.set(5 + dx, y, dx < 0 ? c[0] : dx === 0 ? c[1] : c[3]);
    }
    for (let y = 5; y < 9; y++) { p.set(2, y, c[1]); p.set(2 + (y > 6 ? 1 : 0), y, c[2]); }
    p.rect(1, 9, 8, 1, '#262a40');
}

/** 14 x 6: smooth river pebbles on the sand. */
function paintPebbles (p: PixelPainter): void
{
    const rng = p.rng;
    const shades = ['#c4bcaa', '#a39a88', '#7f776a'];
    for (let i = 0; i < 6; i++)
    {
        const x = 1 + rng() * 11;
        const y = 1 + rng() * 3;
        p.rect(x, y, 2, 1, shades[i % 3]);
        p.set(x, y + 1, shades[2]);
    }
}

/** 14 x 9: a scorched thorn shrub, a few embers still glowing (variant 1 bare). */
function paintAshShrub (p: PixelPainter, variant: number): void
{
    const rng = p.rng;
    for (let i = 0; i < 9; i++)
    {
        const a = Math.PI * (1.05 + i * 0.1);
        p.line(7, 8, 7 + Math.cos(a) * 7, 8 + Math.sin(a) * 7, i % 2 ? '#3a302c' : '#262020');
    }
    if (variant === 0) for (let i = 0; i < 3; i++) p.set(2 + rng() * 10, 2 + rng() * 5, '#ef6a1d');
}

/** 14 x 12: glassy black obsidian, sharp-edged with bright glints. */
function paintObsidian (p: PixelPainter, variant: number): void
{
    const shades = ['#4a4552', '#2a2730', '#18161c', '#0e0d11'];
    for (let y = 0; y < 12; y++)
    {
        const half = variant === 0 ? Math.min(6, Math.floor(y * 0.8) + 1) : Math.min(6, Math.floor(y / 2) + 2);
        for (let x = -half; x <= half; x++) p.set(7 + x, y, x < -1 ? shades[0] : x < 2 ? shades[1] : shades[2]);
    }
    p.set(5, 3, '#c9c3d6');
    p.set(4, 6, '#8a84a0');
}

/** 28 x 30: a fragment of gothic wall with a pointed window (variant 1 more broken). */
function paintGothicRuin (p: PixelPainter, variant: number): void
{
    const S = ['#7a747c', '#5f5a63', '#48444d', '#34313a', '#232027'];
    const rng = p.rng;
    for (let x = 0; x < 28; x++)
    {
        const top = variant === 0 ? (x < 6 || x > 22 ? 0 : 4 + Math.floor(rng() * 3)) : 6 + Math.floor(rng() * 12) * (x > 14 ? 1 : 0.3);
        for (let y = top; y < 30; y++) p.set(x, y, (y % 4 === 3 || (x + Math.floor(y / 4) * 3) % 7 === 0) ? S[3] : x < 8 ? S[1] : S[2]);
    }
    // Pointed window opening.
    for (let dy = 0; dy < 14; dy++)
    {
        const inset = dy < 4 ? 4 - dy : 0;
        for (let dx = inset; dx < 8 - inset; dx++) p.set(10 + dx, 8 + dy, '#120e10');
    }
    p.speckle(0, 22, 28, 8, Palette.stone.moss, 0.15);
}

/**
 * 30 x 40: a scorched tree at the edge of the ash: a darkened trunk with
 * a few clumps of dry brown and rust leaves left (variant 1 barer).
 */
function paintScorchedTree (p: PixelPainter, variant: number): void
{
    const rng = p.rng;
    const bark = ['#4a3a2e', '#33281f', '#211a15'];
    for (let y = 39; y >= 14; y--)
    {
        const half = y > 35 ? 2 : 1;
        const sway = Math.round(Math.sin(y * 0.25 + variant) * 1.2);
        for (let x = -half; x <= half; x++) p.set(15 + sway + x, y, x === -half ? bark[0] : x === half ? bark[2] : bark[1]);
    }
    for (let i = 0; i < 5; i++)
    {
        const side = i % 2 === 0 ? -1 : 1;
        const y0 = 14 + Math.floor(rng() * 12);
        const len = 6 + rng() * 6;
        p.line(15, y0, 15 + side * len, y0 - len * 0.8, bark[1]);
    }
    const leaves = ['#a07a42', '#7e5a2e', '#5e4122', '#3e2a16'];
    for (let i = 0; i < (variant === 0 ? 6 : 3); i++) p.shadedBlob(15 + (rng() * 2 - 1) * 10, 8 + rng() * 10, 3 + Math.floor(rng() * 2), 2 + Math.floor(rng() * 2), leaves, 0.25);
    p.set(15, 30, '#ef6a1d'); // a last ember in the bark
}

/**
 * 38 x 46: a twisted swamp tree: a gnarled leaning trunk on splayed roots,
 * a drooping crown, and long vines and moss hanging from it (variant 1:
 * a greyer, half-dead tree draped in pale moss).
 */
function paintSwampTree (p: PixelPainter, variant: number): void
{
    const rng = p.rng;
    const bark = variant === 0 ? ['#6a5a44', '#4a3e2e', '#30281e'] : ['#6e6a5e', '#4e4b42', '#33312b'];
    // Trunk: twists left then right as it rises.
    for (let y = 45; y >= 14; y--)
    {
        const t = (45 - y) / 31;
        const sway = Math.round(Math.sin(t * Math.PI * 1.4 + variant) * 4);
        const half = y > 41 ? 3 : 2;
        for (let x = -half; x <= half; x++) p.set(19 + sway + x, y, x === -half ? bark[0] : x === half ? bark[2] : rng() < 0.15 ? bark[2] : bark[1]);
    }
    // Splayed roots.
    p.line(16, 43, 10, 45, bark[1]);
    p.line(22, 43, 28, 45, bark[1]);
    p.line(18, 44, 14, 45, bark[2]);
    // Crooked branches.
    p.line(18, 22, 8, 14, bark[1]);
    p.line(21, 20, 31, 13, bark[1]);
    const leaves = variant === 0 ? ['#8a9a5a', '#6a7c44', '#4e5e32', '#344022'] : ['#7f8a72', '#626c58', '#485040', '#30362b'];
    const blobs = variant === 0 ? 8 : 5;
    for (let i = 0; i < blobs; i++) p.shadedBlob(19 + (rng() * 2 - 1) * 13, 8 + rng() * 9, 4 + Math.floor(rng() * 3), 3 + Math.floor(rng() * 2), leaves, 0.06);
    // Hanging vines and moss strands.
    const vine = variant === 0 ? ['#4e6a2e', '#6a8a3a'] : ['#a8ae8a', '#c8ccae'];
    for (let i = 0; i < 9; i++)
    {
        const x = 6 + rng() * 26;
        const top = 10 + rng() * 6;
        const len = 8 + rng() * 14;
        for (let y = 0; y < len; y++) p.set(x + Math.round(Math.sin(y * 0.5 + i) * 0.6), top + y, vine[y % 4 === 0 ? 1 : 0]);
    }
}

/** 12 x 18: a crouching gargoyle on a pedestal. */
function paintGargoyle (p: PixelPainter): void
{
    const S = ['#6a6470', '#4f4a55', '#38343f', '#24212a'];
    p.rect(1, 13, 10, 5, S[2]);
    p.rect(1, 13, 10, 1, S[0]);
    p.shadedBlob(6, 8, 4, 4, S);
    p.shadedBlob(5, 3, 3, 2, S);
    p.line(1, 6, 0, 1, S[1]);                // wings
    p.line(10, 6, 11, 1, S[2]);
    p.set(4, 3, '#ff4a3a');                   // glowing eyes
    p.set(6, 3, '#ff4a3a');
}

/** Moon-tree crowns: lavender with silver highlights, or soft teal-green. */
const MOON_LEAVES = [
    ['#e3d4ff', '#b9a0ec', '#8f72c9', '#62499a'],
    ['#b8e6c8', '#86c79e', '#5d9f7a', '#3d7358'],
];
const SPIRAL_LEAVES = [
    ['#ffc6dc', '#f293b8', '#c7678f', '#8e4466'], // rose
    ['#ffe0a3', '#f4b25c', '#c8813a', '#8a5624'], // amber
];

/**
 * 40 x 52: a tall moon tree: a smooth silver trunk, tiered crowns, and small
 * glowing lantern-fruit hanging from the branches.
 */
function paintMoonTree (p: PixelPainter, variant: number): void
{
    const rng = p.rng;
    const cx = 20;
    for (let y = 51; y >= 14; y--)
    {
        const half = y > 46 ? 3 : 2;
        for (let x = cx - half; x <= cx + half; x++) p.set(x, y, x === cx - half ? '#e6e2ea' : x === cx + half ? '#8b8796' : '#bdb8c6');
        if (rng() < 0.08) p.set(cx + (rng() < 0.5 ? -1 : 1), y, '#8b8796');
    }
    p.line(cx - 3, 50, cx - 7, 51, '#8b8796');
    p.line(cx + 3, 50, cx + 7, 51, '#8b8796');
    // Three tiers of crown, widest at the bottom.
    const tiers = [{ y: 30, rx: 17, ry: 7 }, { y: 19, rx: 14, ry: 7 }, { y: 9, rx: 9, ry: 7 }];
    for (const t of tiers) p.shadedBlob(cx, t.y, t.rx, t.ry, MOON_LEAVES[variant], 0.03);
    // Lantern-fruit.
    for (let i = 0; i < 7; i++)
    {
        const t = tiers[i % 3];
        const fx = cx + (rng() * 2 - 1) * (t.rx - 2);
        const fy = t.y + t.ry - 1;
        p.set(fx, fy, '#6b5a3a');
        p.set(fx, fy + 1, Palette.accent.amber);
    }
}

/** 34 x 46: a spiral tree: a trunk twisting like a corkscrew up to a round, blossoming crown. */
function paintSpiralTree (p: PixelPainter, variant: number): void
{
    const W = Palette.wood;
    const rng = p.rng;
    const cx = 17;
    for (let y = 45; y >= 16; y--)
    {
        const sway = Math.sin(y * 0.42) * 3;
        const half = y > 41 ? 3 : 2;
        for (let x = -half; x <= half; x++)
        {
            const twist = Math.sin(y * 0.42 + x) > 0.6;
            p.set(cx + sway + x, y, x === -half ? W.light : twist ? W.dark : W.mid);
        }
    }
    p.shadedBlob(cx, 11, 14, 10, SPIRAL_LEAVES[variant], 0.02);
    p.shadedBlob(cx - 9, 16, 6, 5, SPIRAL_LEAVES[variant], 0.04);
    p.shadedBlob(cx + 9, 15, 6, 5, SPIRAL_LEAVES[variant], 0.04);
    for (let i = 0; i < 8; i++) p.set(cx + (rng() * 2 - 1) * 12, 3 + rng() * 14, '#fff6ee');
}

/** 10 x 8: a glowing flower: violet bells, rose stars, or golden cups. */
function paintGlowFlower (p: PixelPainter, variant: number): void
{
    const glow = GLOW_FLOWER_COLORS[variant];
    const pale = ['#f2e6ff', '#ffe2ef', '#fff5d6'][variant];
    p.line(3, 7, 3, 4, '#3f7a3c');
    p.line(7, 7, 7, 3, '#3f7a3c');
    p.line(5, 7, 5, 5, '#3f7a3c');
    p.set(4, 6, '#5fae5a');
    for (const [x, y] of [[3, 3], [7, 2], [5, 4]])
    {
        p.set(x, y, glow);
        p.set(x - 1, y, glow);
        p.set(x + 1, y, glow);
        p.set(x, y - 1, pale);
    }
}

/** 12 x 26: a broken elven column, white marble with ivy (variant 1 is snapped lower and leaning). */
function paintElvenPillar (p: PixelPainter, variant: number): void
{
    const top = variant === 0 ? 2 : 10;
    p.rect(1, 22, 10, 4, '#b9b1a2');
    p.rect(1, 22, 10, 1, '#f1ece2');
    for (let y = top; y < 22; y++)
    {
        const lean = variant === 1 ? Math.round((22 - y) * 0.12) : 0;
        p.rect(3 + lean, y, 6, 1, '#d9d2c4');
        p.set(3 + lean, y, '#f1ece2');
        p.set(8 + lean, y, '#8f8879');
        if (y % 4 === 0) p.set(5 + lean, y, '#b9b1a2'); // fluting
    }
    if (variant === 0) p.rect(2, 1, 8, 2, '#f1ece2'); // capital
    p.speckle(2, top, 8, 26 - top, '#4f8a3f', 0.18);
}

/** 22 x 18: the fae fountain: a marble basin with violet-glowing water and a little spout. */
function paintFaeFountain (p: PixelPainter): void
{
    p.shadedBlob(11, 13, 10, 4, ['#f1ece2', '#d9d2c4', '#b9b1a2', '#8f8879']);
    p.shadedBlob(11, 12, 8, 2, ['#efe0ff', '#c9a2ff', '#9a68e0', '#6a3fae']);
    p.rect(10, 3, 3, 9, '#d9d2c4');
    p.rect(10, 3, 1, 9, '#f1ece2');
    p.shadedBlob(11, 3, 3, 2, ['#f1ece2', '#d9d2c4', '#b9b1a2']);
    p.set(11, 0, '#efe0ff');
    p.set(9, 1, '#c9a2ff');
    p.set(13, 1, '#c9a2ff');
}

/** 44 x 54: an ancient elder tree: a thick twisting trunk, buttress roots and a broad, colourful crown. */
function paintElderTree (p: PixelPainter, variant: number): void
{
    const W = Palette.wood;
    const rng = p.rng;
    const cx = 22;
    const base = 53;
    const leaves = ELDER_LEAVES[variant];

    // Buttress roots.
    for (const side of [-1, 1])
    {
        p.line(cx + side * 2, base - 4, cx + side * 10, base, W.dark);
        p.line(cx + side * 2, base - 3, cx + side * 7, base, W.mid);
        p.line(cx + side * 3, base - 6, cx + side * 6, base - 1, W.light);
    }
    // A thick trunk that twists as it rises.
    for (let y = base; y >= 22; y--)
    {
        const t = (base - y) / (base - 22);
        const half = Math.round(5 - t * 2);
        const sway = Math.round(Math.sin(t * 3.2) * 2);
        for (let x = cx - half; x <= cx + half; x++)
        {
            const edge = x === cx - half ? W.light : x === cx + half ? W.dark : W.mid;
            p.set(x + sway, y, rng() < 0.1 ? W.dark : edge);
        }
    }
    // Big limbs spreading wide.
    for (const side of [-1, 1])
    {
        p.line(cx, 30, cx + side * 15, 18, W.mid);
        p.line(cx + side, 31, cx + side * 15, 19, W.dark);
    }
    // A broad, flat-topped crown in layered clumps.
    for (let i = 0; i < 12; i++)
    {
        const fx = cx + (rng() * 2 - 1) * 15;
        const fy = 9 + rng() * 12;
        const r = 5 + Math.floor(rng() * 4);
        p.shadedBlob(fx, fy, r, Math.round(r * 0.75), leaves, 0.03);
    }
    // Glowing fruit (violet), falling leaves (autumn) or petals (blossom).
    const dots = variant === 0 ? Palette.accent.amber : variant === 1 ? '#f6c56a' : '#ffffff';
    for (let i = 0; i < 9; i++) p.set(cx + (rng() * 2 - 1) * 16, 6 + rng() * 16, dots);
}

/** 18 x 40: a slender birch with a white, marked trunk and a light, airy crown. */
function paintBirch (p: PixelPainter, variant: number): void
{
    const rng = p.rng;
    const cx = 9;
    for (let y = 39; y >= 10; y--)
    {
        const lean = Math.round((39 - y) * 0.05);
        p.set(cx + lean, y, '#e9e4d6');
        p.set(cx + lean + 1, y, '#bdb6a5');
        if (rng() < 0.18) p.set(cx + lean + (rng() < 0.5 ? 0 : 1), y, '#2b2724');
    }
    for (let i = 0; i < 6; i++)
    {
        p.shadedBlob(cx + 1 + (rng() * 2 - 1) * 5, 5 + rng() * 15, 3 + Math.floor(rng() * 2), 3 + Math.floor(rng() * 2), BIRCH_LEAVES[variant], 0.12);
    }
}

/** 38 x 40: a weeping willow: a rounded dome with long strands hanging almost to the ground. */
function paintWillow (p: PixelPainter): void
{
    const W = Palette.wood;
    const rng = p.rng;
    const cx = 19;
    p.rect(cx - 2, 26, 4, 14, W.mid);
    p.rect(cx - 2, 26, 1, 14, W.light);
    p.rect(cx + 1, 26, 1, 14, W.dark);
    p.shadedBlob(cx, 11, 16, 9, WILLOW_LEAVES, 0.02);
    // Hanging strands.
    for (let x = cx - 17; x <= cx + 17; x += 2)
    {
        const startY = 11 + Math.round(Math.sqrt(Math.max(0, 1 - ((x - cx) / 17) ** 2)) * 7);
        const length = 12 + Math.floor(rng() * 14) - Math.abs(x - cx) / 3;
        for (let y = startY; y < startY + length && y < 39; y++)
        {
            p.set(x + (y % 7 === 0 ? 1 : 0), y, y > startY + length - 3 ? WILLOW_LEAVES[0] : WILLOW_LEAVES[rng() < 0.5 ? 1 : 2]);
        }
    }
}

/** 26 x 34: a towering mushroom: red cap with white spots, or purple with pale spots. */
function paintGiantShroom (p: PixelPainter, variant: number): void
{
    const rng = p.rng;
    const cx = 13;
    const cap = variant === 0 ? ['#ea6a52', '#c8432f', '#97301f', '#6a2116'] : ['#b48ae0', '#8d63c0', '#6a4597', '#47306b'];
    const spot = variant === 0 ? '#f4efe1' : '#e7dcff';
    // Stem, a little wider at the foot.
    for (let y = 33; y >= 14; y--)
    {
        const half = y > 29 ? 3 : 2;
        for (let x = cx - half; x <= cx + half; x++) p.set(x, y, x === cx - half ? '#ece4cf' : x === cx + half ? '#a9a08b' : '#d1c8b1');
    }
    p.rect(cx - 2, 20, 5, 1, '#a9a08b'); // ring
    // Cap: a wide dome with dark gills underneath.
    p.shadedBlob(cx, 10, 12, 8, cap);
    for (let x = cx - 10; x <= cx + 10; x++) p.set(x, 16, '#3a2a24');
    p.rect(cx - 2, 17, 5, 1, '#a9a08b'); // shadow of the cap on the stem
    for (let i = 0; i < 8; i++)
    {
        const sx = cx + (rng() * 2 - 1) * 9;
        const sy = 4 + rng() * 8;
        p.set(sx, sy, spot);
        p.set(sx + 1, sy, spot);
    }
}

/** 16 x 11: a round shrub: berries, flowers, or dark thorns with purple berries. */
function paintShrub (p: PixelPainter, variant: number): void
{
    const rng = p.rng;
    const leaves = variant === 2 ? ['#3e5f3b', '#2f4b30', '#243b26', '#1a2c1c'] : [Palette.foliage.light, Palette.foliage.mid, Palette.foliage.dark, Palette.foliage.darkest];
    p.shadedBlob(8, 6, 7, 4, leaves, 0.02);
    p.shadedBlob(4, 7, 4, 3, leaves, 0.02);
    const dot = variant === 0 ? '#d8432f' : variant === 1 ? (rng() < 0.5 ? '#f2c94c' : '#f4f0e6') : '#9a5fc4';
    for (let i = 0; i < 6; i++) p.set(2 + rng() * 12, 3 + rng() * 6, variant === 1 ? (rng() < 0.5 ? '#f2c94c' : '#f4f0e6') : dot);
}

/** 14 x 8: wet stones at the water's edge, darker and mossy at the bottom. */
function paintShoreRock (p: PixelPainter, variant: number): void
{
    const S = Palette.stone;
    const shades = [S.pale, S.light, S.mid, S.dark];
    if (variant === 0) { p.shadedBlob(5, 4, 5, 3, shades); p.shadedBlob(11, 5, 3, 2, shades); }
    else if (variant === 1) { p.shadedBlob(7, 4, 6, 3, shades); }
    else { p.shadedBlob(3, 5, 3, 2, shades); p.shadedBlob(8, 4, 4, 3, shades); p.shadedBlob(12, 6, 2, 1, shades); }
    p.speckle(0, 0, 14, 3, S.moss, 0.25);
    p.speckle(0, 6, 14, 2, '#2f4a50', 0.6); // wet line
}

/** 20 x 28: a burnt, twisted tree with embers still glowing in its cracks. */
function paintCharredTree (p: PixelPainter, variant: number): void
{
    const rng = p.rng;
    const cx = 10;
    const bark = ['#3a302c', '#262020', '#171313'];
    for (let y = 27; y >= 9; y--)
    {
        const half = y > 23 ? 2 : 1;
        const sway = Math.round(Math.sin(y * 0.35 + variant) * 1.2);
        for (let x = cx - half; x <= cx + half; x++) p.set(x + sway, y, x === cx - half ? bark[0] : x === cx + half ? bark[2] : bark[1]);
    }
    const limbs = variant === 0 ? 5 : 3;
    for (let i = 0; i < limbs; i++)
    {
        const side = i % 2 === 0 ? -1 : 1;
        const y0 = 10 + Math.floor(rng() * 10);
        const len = 4 + rng() * 5;
        p.line(cx, y0, cx + side * len, y0 - len * 0.9, bark[1]);
        p.line(cx + side * len, y0 - len * 0.9, cx + side * (len + 2), y0 - len * 0.9 - 2, bark[0]);
    }
    // Ember cracks.
    for (let i = 0; i < 3; i++)
    {
        const y = 13 + Math.floor(rng() * 12);
        p.set(cx, y, EMBER.mid);
        p.set(cx, y + 1, EMBER.deep);
    }
}

/** 16 x 18: basalt: a cluster of hexagonal columns, or a jagged volcanic rock. */
function paintBasalt (p: PixelPainter, variant: number): void
{
    if (variant === 0)
    {
        const columns = [{ x: 2, h: 10 }, { x: 6, h: 16 }, { x: 10, h: 12 }, { x: 13, h: 8 }];
        for (const c of columns)
        {
            const topY = 17 - c.h;
            p.rect(c.x, topY + 2, 3, c.h - 2, BASALT_ROCK[2]);
            p.rect(c.x, topY + 2, 1, c.h - 2, BASALT_ROCK[1]);
            p.rect(c.x + 2, topY + 2, 1, c.h - 2, BASALT_ROCK[3]);
            p.rect(c.x, topY, 3, 2, BASALT_ROCK[0]); // flat hexagonal top
        }
    }
    else
    {
        p.shadedBlob(8, 12, 7, 5, BASALT_ROCK);
        p.shadedBlob(6, 7, 3, 5, BASALT_ROCK);
        p.line(9, 9, 11, 14, EMBER.deep);
    }
}

/** A short wooden fence: posts with two rails. */
function paintFence (p: PixelPainter): void
{
    const W = Palette.wood;
    p.rect(0, 2, 24, 1, W.light);
    p.rect(0, 5, 24, 1, W.mid);
    for (const x of [1, 8, 15, 22])
    {
        p.rect(x, 0, 2, 8, W.light);
        p.rect(x + 1, 1, 1, 7, W.mid);
    }
}

/** A stone well with a little roof and a bucket. */
function paintWell (p: PixelPainter): void
{
    const W = Palette.wood;
    p.rect(0, 0, 14, 2, '#9c4630');           // little clay roof
    p.rect(1, 2, 12, 1, '#7a3324');
    p.rect(2, 2, 1, 6, W.dark);               // posts
    p.rect(11, 2, 1, 6, W.dark);
    p.rect(3, 3, 8, 1, W.mid);                // crossbeam with rope
    p.rect(7, 4, 1, 2, '#c9b48a');
    p.rect(6, 6, 3, 2, W.light);              // bucket
    p.stoneTop(1, 8, 12, 2);
    p.rect(3, 9, 8, 1, '#2f6f8f');            // water glint inside
    p.stoneWall(1, 10, 12, 6);
}

/** Two stacked wooden crates. */
function paintCrates (p: PixelPainter): void
{
    const W = Palette.wood;
    p.planks(0, 4, 8, 7);
    p.rect(0, 4, 8, 1, W.light);
    p.line(0, 5, 7, 10, W.dark);
    p.planks(5, 0, 7, 6);
    p.rect(5, 0, 7, 1, W.light);
    p.line(5, 1, 11, 5, W.dark);
}

function paint (scene: Scene, key: string, width: number, height: number, seed: number, painter: (p: PixelPainter) => void): void
{
    const p = new PixelPainter(width, height, createRng(seed));
    painter(p);
    p.outline(Palette.outline);
    p.toTexture(scene, key);
}

/**
 * 36 x 46: a big gnarled tree. Variants 0-1 have dark, eerie foliage;
 * variant 2 is long dead, all twisted branches.
 */
function paintLargeTree (p: PixelPainter, variant: number): void
{
    const W = Palette.wood;
    const rng = p.rng;
    const cx = 18;
    const base = 45;
    const dead = variant === 2;
    const trunkTop = dead ? 12 : 20;

    // Roots spreading at the base.
    p.line(cx - 2, base - 1, cx - 7, base, W.dark);
    p.line(cx + 2, base - 1, cx + 7, base, W.dark);
    p.line(cx - 1, base - 2, cx - 5, base, W.mid);

    // Trunk: wide at the bottom, lit on the left.
    for (let y = base; y >= trunkTop; y--)
    {
        const t = (base - y) / (base - trunkTop);
        const half = Math.round(3 - t * 1.6);
        for (let x = cx - half; x <= cx + half; x++)
        {
            let color: string = x === cx - half ? W.light : x === cx + half ? W.dark : W.mid;
            if (rng() < 0.12) color = W.dark; // bark texture
            p.set(x, y, color);
        }
    }

    // Branches reaching up and out.
    const branchCount = dead ? 7 : 4;
    for (let i = 0; i < branchCount; i++)
    {
        const side = i % 2 === 0 ? -1 : 1;
        const startY = trunkTop + Math.floor(rng() * (dead ? 16 : 8));
        const length = 6 + rng() * (dead ? 10 : 8);
        const endX = cx + side * length;
        const endY = startY - length * 0.8 - rng() * 4;
        p.line(cx, startY, endX, endY, W.mid);
        p.line(endX, endY, endX + side * 2, endY - 3, W.mid);
        if (dead) p.line(endX - side * 3, endY + 2, endX - side * 4, endY - 3, W.mid);
    }

    if (dead) return;

    // Dark foliage clumps, lit from the top-left, with a few gaps.
    const leaves = Palette.treeFoliage.slice().reverse(); // light -> dark
    for (let i = 0; i < 8; i++)
    {
        const fx = cx + (rng() * 2 - 1) * 11;
        const fy = 6 + rng() * 15;
        const radius = 4 + Math.floor(rng() * 4);
        p.shadedBlob(fx, fy, radius, Math.round(radius * 0.85), leaves, 0.04);
    }
}

/** 24 x 42: a dark, layered pine. */
function paintPine (p: PixelPainter): void
{
    const F = Palette.foliage;
    const W = Palette.wood;
    const cx = 12;

    for (let tier = 0; tier < 4; tier++)
    {
        const top = 1 + tier * 7;
        const height = 11 + tier * 2;
        const maxHalf = 4 + tier * 2.5;
        for (let dy = 0; dy <= height; dy++)
        {
            const half = Math.round((dy / height) * maxHalf) + 1;
            for (let dx = -half; dx <= half; dx++)
            {
                // Ragged bottom edge of each tier.
                if (dy === height && (dx + tier) % 2 === 0) continue;
                const color = dx <= -half + 1 ? F.light : dx >= half - 1 ? F.darkest : dy > height - 3 ? F.dark : F.mid;
                p.set(cx + dx, top + dy, color);
            }
        }
    }

    p.rect(cx - 1, 38, 2, 4, W.mid);
    p.rect(cx + 1, 38, 1, 4, W.dark);
}

/** 22 x 16: a weathered boulder (variant 1 is split in two). */
function paintBoulder (p: PixelPainter, variant: number): void
{
    const S = Palette.stone;
    const shades = [S.pale, S.light, S.mid, S.dark, S.darkest];

    if (variant === 0)
    {
        p.shadedBlob(11, 9, 10, 6, shades);
        p.line(8, 6, 11, 11, S.darkest); // crack
    }
    else
    {
        p.shadedBlob(8, 9, 7, 6, shades);
        p.shadedBlob(16, 11, 5, 4, shades);
    }

    p.speckle(0, 0, 22, 7, S.moss, 0.3); // moss on top
}

// ---------------------------------------------------------------------------
// Small pixel maps
// ---------------------------------------------------------------------------

const TALL_GRASS = [
    '..a...a..',
    '.a..a..a.',
    '.ab.ab.a.',
    'abb.bb.ba',
    '.bbabbab.',
    '..cbcbc..',
];

const FERN = [
    'a....a....a',
    '.a..aba..a.',
    '..abbbbba..',
    '.abbcccbba.',
    '..bcccccb..',
    '...ccccc...',
];

const STUMP = [
    '..oooooo..',
    '.oLLLLLLo.',
    '.oLlLLlLo.',
    '.oLLllLLo.',
    '.omMMMMmo.',
    '.oMMMMMMo.',
    'oomMMMMmoo',
    'oooooooooo',
];

const LOG = [
    '.oooooooooooooooooooo.',
    'oMMMMMMMmMMMMMMMMMMoLo',
    'oMmMMMMMMMMMmMMMMMMoLl',
    'oMMMMMmMMMMMMMMMmMMolL',
    'oddddddddddddddddddoLo',
    '.oooooooooooooooooooo.',
];

const GRAVESTONE = [
    '..oooo..',
    '.oLLSso.',
    'oLLrSsso',
    'oLrrrsso',
    'oLLrSsso',
    'oLLrSsso',
    'oLSSSsso',
    'oLmSSsso',
    'ommmmmmo',
    'oooooooo',
];

const FLOWERS = [
    '.r...y...w....p..y',
    'rgr.ygy.wgw..pgpygy',
    '.g...g...g....g..g.',
    'ggg.ggg.ggg..ggg.gg',
    '.gggg.ggg.gggg.ggg.',
];

/** A ring of little mushrooms (walk-through). */
const FAIRY_RING = [
    '....r.w.p.r....',
    '..w.........p..',
    '.p...........r.',
    'r.............w',
    '.w...........p.',
    '..r.........w..',
    '....p.r.w.r....',
];

/** Cattails and reeds at the water's edge. */
const REEDS = [
    '.T.....T.',
    '.t..a..t.',
    '.a.a.a.a.',
    'a..a.ab.a',
    '.b.ab.b..',
    '.b.b..b.b',
    'b.bb.bb.b',
    '.bcb.cbb.',
    '.cbc.bcc.',
    'c.cc.cc.c',
    '.ccc.ccc.',
];

const BONES = [
    '.ooo.....',
    'oWWWo....',
    'oWoWo.oo.',
    'oWWWooWwo',
    '.owo.oWWo',
    '......oo.',
];
