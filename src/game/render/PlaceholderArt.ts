import { Scene } from 'phaser';
import { ACCENTS, GROUND_TILE_COUNT, GroundTile, type Accent } from '../logic/BattlefieldLayout';
import { createRng } from '../logic/Random';
import { createNatureTextures } from './NatureArt';
import { Palette } from './Palette';
import { textureFromPixelMap } from './PixelPainter';
import { createStructureTextures } from './StructureArt';

/**
 * Placeholder pixel art, generated in code. No image files needed.
 *
 * Sprites are written as text "pixel maps": each character is one pixel,
 * looked up in a colour key ('.' = transparent). To replace any of these
 * with real art later, load a PNG under the same texture key instead.
 */

export const Tex = {
    Ground: 'ground-tiles',
    Commander: 'commander',
    Shadow: 'shadow',
    Glow: 'glow',
    Vignette: 'vignette',
    Rock: 'rock',
    RockSmall: 'rock-small',
    Pillar: 'pillar',
    RuinWall: 'ruin-wall',
    DeadTree: 'dead-tree',
    Bush: 'bush',
    SoulShard: 'soul-shard',
    /** Rare green crystal (recruits Archers). */
    SoulShardGreen: 'soul-shard-green',
    /** An arrow in flight (points right; rotated toward the target). */
    FxArrow: 'fx-arrow',
    /** Archer sprite in an army's colour, and its bow-drawn attack frame. */
    archer: (colorId: string) => `archer-${colorId}`,
    archerDraw: (colorId: string) => `archer-draw-${colorId}`,
    /** Guardian sprite in an army's colour: great helm, heavy plate, a big shield. */
    guardian: (colorId: string) => `guardian-${colorId}`,
    /** Banner planted at a castle nobody holds. */
    CastleBannerNeutral: 'castle-banner-neutral',
    FxBlade: 'fx-blade',
    FxSlash: 'fx-slash',
    FxWind: 'fx-wind',
    FxSpark: 'fx-spark',
    FxGlint: 'fx-glint',
    FxSplash: 'fx-splash',
    FxRipple: 'fx-ripple',
    FxWading: 'fx-wading',
    Warrior: 'warrior-player',
    /** Warrior sprite in an army's colour (see Palette.armies). */
    warrior: (colorId: string) => `warrior-${colorId}`,
    NeutralWarrior: 'warrior-neutral',
    /** Hooded forest folk of the enchanted forest (recruitable neutrals). */
    Sylvan: 'warrior-sylvan',
    /** A firefly: a tiny warm light. */
    Firefly: 'firefly',
    /** Hooded ash folk of the volcanic wastes (recruitable neutrals). */
    Ashen: 'warrior-ashen',
    /** Hooded bog folk of the swamp villages (recruitable neutrals). */
    Bogfolk: 'warrior-bogfolk',
    /** Torch flame, three shapes to flicker between. */
    flame: (frame: number) => `torch-flame-${frame}`,
    CommanderMarker: 'commander-marker',
    TeamBanner: 'team-banner',
    /** War banner in an army's colour. */
    banner: (colorId: string) => `banner-${colorId}`,
    /** A fallen Warrior lying on the ground, in its army's (faded) colour. */
    fallen: (colorId: string) => `fallen-${colorId}`,
    /** Small golden crown over the leading army (and on the leaderboard). */
    Crown: 'crown',
    runestone: (accent: Accent) => `runestone-${accent}`,
    shroom: (accent: Accent) => `shroom-${accent}`,
    wisp: (accent: Accent) => `wisp-${accent}`,
} as const;

type ColorKey = Record<string, string>;

// ---------------------------------------------------------------------------
// Pixel maps
// ---------------------------------------------------------------------------

const COMMANDER = [
    '......oooo....o.',
    '.....oHHHho..owo',
    '....oHHHHhho.owo',
    '....ohveevho.owo',
    '....oohhhhoo.owo',
    '...oCaAAAAaCoowo',
    '..oCCaAggAaCCowo',
    '..oCcaAAAAacCowo',
    '..oCcoaAAaocCggg',
    '..oCcCoaaoCcCoko',
    '..oCcCCooCCcCo..',
    '...oCcCCCCcCo...',
    '...oCCcCCcCCo...',
    '....oCCooCCo....',
    '....okko.okko...',
    '....oooo.oooo...',
];

const ROCK = [
    '...oooo.....',
    '..oLLSSoo...',
    '.oLLSSSssoo.',
    'oLLSSSSsssso',
    'oSSSSSsssddo',
    'oSmmSSssdddo',
    '.ommmsssddo.',
    '..oooooooo..',
];

const ROCK_SMALL = [
    '..ooo..',
    '.oLSso.',
    'oLSSsdo',
    'omSsddo',
    '.ooooo.',
];

const PILLAR = [
    '...o........',
    '..oLo.oo....',
    '..oLSoSso...',
    '..oLSSSsdo..',
    '..oLSSssdo..',
    '..oLSdssdo..',
    '..oLSSssdo..',
    '..oLSSsddo..',
    '..oLSSssdo..',
    '..oLmSssdo..',
    '..oLSSssdo..',
    '..oLSSsdso..',
    '..oLSSssdo..',
    '..oLSSssdo..',
    '..oLSdssdo..',
    '..oLSSssdo..',
    '..oLmSssdo..',
    '..omSSssdo..',
    '.ooLLSSsddoo',
    '.oLLSSSssddo',
    '.omSSSmssddo',
    '.oommmmmmdo.',
    '..oooooooo..',
];

const RUIN_WALL = [
    '...oooo.......oo........',
    '..oLLSSo.....oLSo.......',
    '..oSSssdo...oLSSso......',
    '.oLLSSsdoooooSSsdoooo...',
    '.oSSssddoLLSSoSsdoLLSo..',
    '.oddddddoSSssoddddSSsdo.',
    '.oLSSsoLLSSsdoLLSSsoddo.',
    '.oSssdoSSssddoSSssdoLSo.',
    '.oddddddddddddddddddSso.',
    '.oLLSSsoLLSSsdoLLSSsddo.',
    '.omSssdoSSssddoSmmsdddo.',
    '.ommmmddmmdddddmmmmmddo.',
    '..oooooooooooooooooooo..',
];

const DEAD_TREE = [
    '..o..........o....',
    '.owo....o...owo...',
    '..owo..owo.owo....',
    '...owo.owoowo..o..',
    '.o..owoowwwo..owo.',
    'owo..owwwwo..owo..',
    '.owo..owWwoooowo..',
    '..owoooWWwwwwwo...',
    '...owwwwWwoooo....',
    '....oooowWwo......',
    '.......owWwo......',
    '.......owWwo......',
    '.......owWwwo.....',
    '......owwWwwo.....',
    '......owWwwwo.....',
    '.....owwWwwwwo....',
    '....owwoWwwowwo...',
    '...owo.owWwo.owo..',
    '...oo..oooooo.oo..',
];

const BUSH = [
    '.....oooooo.....',
    '...ooFFlFFfoo...',
    '..oFlFFFFFffffo.',
    '.oFFFlFFfFFfffo.',
    'oFlFFFFFFfffffdo',
    'oFFFfFFFFffffddo',
    'ofFFFFfFFffffddo',
    '.offfffffffdddo.',
    '..odddddddddoo..',
    '...oooooooooo...',
];

const RUNESTONE = [
    '...oooo...',
    '..oLSSso..',
    '.oLSSSsdo.',
    '.oLSrSsdo.',
    '.oLrrrsdo.',
    '.oLSrSsdo.',
    '.oLSSSsdo.',
    '.oLSrSsdo.',
    '.oLrSrsdo.',
    '.oLSrSsdo.',
    '.oLSSSsdo.',
    '.omSSssdo.',
    'oommSsmddo',
    'ommmmmmmdo',
    'oooooooooo',
];

const SHROOM = [
    '.ooooo.',
    'oRRpRRo',
    'opRRRpo',
    '.ooSoo.',
    '..oSo..',
    '..ooo..',
];

const WISP = [
    '.R.',
    'RpR',
    '.R.',
];

/** 12 x 13 Archer: a hood in the army's colour, a quiver on the back, a longbow held upright. */
const ARCHER = [
    '...oooo..ob.',
    '..oHHHHo.ob.',
    '..oHffho..ob',
    '.qoHffHo..ob',
    '.qooffoo..ob',
    '.qoTLLTooSob',
    '.qoTTLToo.ob',
    '..oTtTLto.ob',
    '..otTTTto.b.',
    '...oTTTo....',
    '...okook....',
    '...okook....',
    '...oo..oo...',
];

/** The same Archer at full draw: the bow bent, an arrow nocked and aimed. */
const ARCHER_DRAW = [
    '...oooo...b.',
    '..oHHHHo..ob',
    '..oHffho...b',
    '.qoHffHo...b',
    '.qooffoo...b',
    '.qoTLLTSwwwW',
    '.qoTTLToo..b',
    '..oTtTLto..b',
    '..otTTTto.ob',
    '...oTTTo..b.',
    '...okook....',
    '...okook....',
    '...oo..oo...',
];

/**
 * 13 x 14 Guardian: a closed great helm, broad pauldrons, heavy plate over a
 * tabard, and a big shield (the army's colour, gold cross) held in front.
 */
const GUARDIAN = [
    '....ooooo....',
    '...oHHHHho...',
    '...oHvvvho..o',
    '...ohhhhho.ow',
    '..oAAoooAAoow',
    'ooooAAaaaAAow',
    'oSSSoTTTaaAgg',
    'oSCCSoTtTaok.',
    'oSCgCSoTTao..',
    'oSgggSoTtao..',
    'oSCgCSoTTao..',
    'oSCCCSoaao...',
    '.oSCSoakoko..',
    '..oSo.oo.oo..',
];

/** 18 x 7 fallen Warrior lying on its side, helm to the left, sword dropped beside it. */
const FALLEN = [
    '.oooo.............',
    'oHHhhoooooooooo...',
    'ohvvhoaTTTTTTaokko',
    'ohhhhoaTtTTtTaokko',
    '.ooooooooooooooooo',
    '..owwwwwwwwwwggo..',
    '...oooooooooooo...',
];

/** 12 x 13 forest folk: a deep green hood, leaf cloak, and a short blade. */
const SYLVAN = [
    '....oooo..o.',
    '...oHHhho.w.',
    '..oHHffhHow.',
    '..oHfeefHow.',
    '..oCHhhHCow.',
    '.oCCcLLcCCgg',
    '.oCcLLLLcCk.',
    '..oCcLLcCo..',
    '..ocCCCCco..',
    '...oCCCCo...',
    '...okooko...',
    '...okooko...',
    '...oo..oo...',
];

/** 11 x 7 golden crown with two jewels. */
const CROWN = [
    '.o...o...o.',
    'oWo.oWo.oWo',
    'oYYoYrYoYYo',
    'oYYYYYYYYYo',
    'oyYbYYYbYyo',
    'oyyyyyyyyyo',
    'ooooooooooo',
];

/** 12 x 13 foot soldier: helm, armour, tabard, sword. Smaller than the commander. */
const WARRIOR = [
    '....oooo..o.',
    '...oHHhho.w.',
    '...ohvvho.w.',
    '...oohhoo.w.',
    '..oTaAAaTow.',
    '.oTTaTTaTTgg',
    '.oTtaTTatTk.',
    '..oTtTTtTo..',
    '..otTTTTto..',
    '...oTTTTo...',
    '...oaooao...',
    '...okooko...',
    '...oo..oo...',
];

/**
 * Crimson war banner planted where a detached cluster holds its ground.
 * The pole is tall so the flag flies above the soldiers' heads.
 */
const TEAM_BANNER = [
    '.o......',
    'oWoooo..',
    'oWCCCCo.',
    'oWCgCCCo',
    'oWCCCCo.',
    'oWCcCo..',
    'oWooo...',
    ...Array.from({ length: 18 }, () => 'oWo.....'),
    'ooo.....',
];

/** Small amber chevron floating above the army's representative soldier. */
const COMMANDER_MARKER = [
    'ooooooo',
    'oAAAAAo',
    '.oAAAo.',
    '..oAo..',
    '...o...',
];

const SOUL_SHARD = [
    '...o...',
    '..oPo..',
    '.oPMdo.',
    '.oPMdo.',
    'oPMMddo',
    'oPMdDDo',
    '.oMdDo.',
    '.oMdDo.',
    '..odo..',
    '...o...',
];

const SHADOW = [
    '...oooooooo...',
    '.oooooooooooo.',
    'oooooooooooooo',
    '.oooooooooooo.',
    '...oooooooo...',
];

const STONE_COLORS: ColorKey = {
    o: Palette.outline,
    L: Palette.stone.light,
    S: Palette.stone.mid,
    s: Palette.stone.dark,
    d: Palette.stone.darkest,
    m: Palette.stone.moss,
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Create every placeholder texture. Safe to call more than once. */
export function createPlaceholderTextures (scene: Scene, tileSize: number): void
{
    const c = Palette.commander;

    textureFromPixelMap(scene, Tex.Commander, COMMANDER, {
        o: Palette.outline,
        H: c.helmLight,
        h: c.helm,
        v: c.visor,
        e: c.eye,
        A: c.armorLight,
        a: c.armor,
        C: c.cloak,
        c: c.cloakDark,
        g: c.gold,
        w: c.blade,
        k: c.leather,
    });

    // Player Warriors share the commander's steel and crimson.
    textureFromPixelMap(scene, Tex.Warrior, WARRIOR, {
        o: Palette.outline,
        H: c.helmLight, h: c.helm, v: c.visor,
        A: c.armorLight, a: c.armor,
        T: c.cloak, t: c.cloakDark,
        g: c.gold, w: c.blade, k: c.leather,
    });

    // One Warrior sprite (and banner) per army colour: same steel armour, different tabard.
    for (const [colorId, colors] of Object.entries(Palette.armies))
    {
        textureFromPixelMap(scene, Tex.banner(colorId), TEAM_BANNER, {
            o: Palette.outline, W: Palette.wood.light, C: colors.main, c: colors.dark, g: c.gold,
        });
        textureFromPixelMap(scene, Tex.warrior(colorId), WARRIOR, {
            o: Palette.outline,
            H: c.helmLight, h: c.helm, v: c.visor,
            A: c.armorLight, a: c.armor,
            T: colors.main, t: colors.dark,
            g: c.gold, w: c.blade, k: c.leather,
        });
        // Archers: hooded, in the army's colour, with a longbow (rest and full-draw frames).
        const archerColors = {
            o: Palette.outline, H: colors.main, h: colors.dark, f: '#e0b48a', S: '#e0b48a',
            T: colors.main, t: colors.dark, L: c.leather, q: '#5a3a1e', k: c.leather,
            b: '#9a6a34', w: '#d8c8a0', W: c.blade,
        };
        textureFromPixelMap(scene, Tex.archer(colorId), ARCHER, archerColors);
        textureFromPixelMap(scene, Tex.archerDraw(colorId), ARCHER_DRAW, archerColors);
        // Guardians: darker, heavier plate than a Warrior, and a shield in the army's colour.
        textureFromPixelMap(scene, Tex.guardian(colorId), GUARDIAN, {
            o: Palette.outline,
            H: c.armorLight, h: c.helm, v: c.visor,
            A: c.armorLight, a: c.armor,
            S: '#9aa1a6', C: colors.main, g: c.gold,
            T: colors.main, t: colors.dark,
            w: c.blade, k: c.leather,
        });
        // The fallen: dulled steel, a darkened tabard.
        textureFromPixelMap(scene, Tex.fallen(colorId), FALLEN, {
            o: Palette.outline,
            H: '#8d949a', h: '#5f666c', v: c.visor,
            a: '#4e555b', T: colors.dark, t: '#1c1714',
            g: '#9a7a3a', w: '#9aa1a6', k: c.leather,
        });
    }

    // A free castle's banner: pale cloth with a gold mark.
    textureFromPixelMap(scene, Tex.CastleBannerNeutral, TEAM_BANNER, {
        o: Palette.outline, W: Palette.wood.light, C: '#e8dcb8', c: '#a89a70', g: c.gold,
    });

    textureFromPixelMap(scene, Tex.Sylvan, SYLVAN, {
        o: Palette.outline, H: '#4f8f4a', h: '#356a37', f: '#e6c49a', e: '#2a2a1e',
        C: '#5d7a3a', c: '#3e5528', L: '#c9a64a', g: c.gold, w: c.blade, k: c.leather,
    });
    textureFromPixelMap(scene, Tex.Firefly, ['.a.', 'aYa', '.a.'], { a: '#e9ff9a', Y: '#fffbe0' });
    // Ash folk: the same hooded shape, in soot grey with ember trim.
    textureFromPixelMap(scene, Tex.Ashen, SYLVAN, {
        o: Palette.outline, H: '#4b4652', h: '#33303a', f: '#c9a07a', e: '#2a1a14',
        C: '#3a3540', c: '#24212a', L: '#d4481a', g: c.gold, w: c.blade, k: c.leather,
    });
    // Bog folk: the hooded shape in murky olive and reed brown, with lime trim.
    textureFromPixelMap(scene, Tex.Bogfolk, SYLVAN, {
        o: Palette.outline, H: '#6a7444', h: '#4a5430', f: '#b8a888', e: '#2a2a1e',
        C: '#5e4e34', c: '#3e3222', L: '#b6ff5c', g: c.gold, w: c.blade, k: c.leather,
    });
    // Torch flames: three flickering shapes (a hot core in an orange tongue).
    const flameColors = { r: '#d4481a', o: Palette.flame[0], y: Palette.flame[1], w: '#fff2c8' };
    textureFromPixelMap(scene, Tex.flame(0), ['.r.', '.o.', 'oyo', 'ywy', '.y.'], flameColors);
    textureFromPixelMap(scene, Tex.flame(1), ['r..', '.o.', 'oyo', 'ywy', '.y.'], flameColors);
    textureFromPixelMap(scene, Tex.flame(2), ['...', '..r', '.oo', 'oyy', '.w.'], flameColors);

    textureFromPixelMap(scene, Tex.Crown, CROWN, {
        o: '#3a2a10', W: '#fff2b8', Y: '#f2c64c', y: '#b8862a', r: '#d8432f', b: '#9a5fc4',
    });

    // Neutral Warriors: same shape, dull unaligned colours.
    const n = Palette.neutral;
    textureFromPixelMap(scene, Tex.NeutralWarrior, WARRIOR, {
        o: Palette.outline,
        H: n.helmLight, h: n.helm, v: c.visor,
        A: n.armorLight, a: n.armor,
        T: n.tabard, t: n.tabardDark,
        g: n.trim, w: n.blade, k: c.leather,
    });

    textureFromPixelMap(scene, Tex.CommanderMarker, COMMANDER_MARKER, { o: Palette.outline, A: Palette.accent.amber });
    textureFromPixelMap(scene, Tex.TeamBanner, TEAM_BANNER, {
        o: Palette.outline, W: Palette.wood.light, C: c.cloak, c: c.cloakDark, g: c.gold,
    });

    textureFromPixelMap(scene, Tex.Shadow, SHADOW, { o: Palette.shadow });
    textureFromPixelMap(scene, Tex.Rock, ROCK, STONE_COLORS);
    textureFromPixelMap(scene, Tex.RockSmall, ROCK_SMALL, STONE_COLORS);
    textureFromPixelMap(scene, Tex.Pillar, PILLAR, STONE_COLORS);
    textureFromPixelMap(scene, Tex.RuinWall, RUIN_WALL, STONE_COLORS);

    textureFromPixelMap(scene, Tex.DeadTree, DEAD_TREE, {
        o: Palette.outline,
        w: Palette.wood.mid,
        W: Palette.wood.light,
    });

    textureFromPixelMap(scene, Tex.Bush, BUSH, {
        o: Palette.outline,
        l: Palette.foliage.light,
        F: Palette.foliage.mid,
        f: Palette.foliage.dark,
        d: Palette.foliage.darkest,
    });

    textureFromPixelMap(scene, Tex.SoulShard, SOUL_SHARD, {
        o: Palette.shard.outline,
        P: Palette.shard.pale,
        M: Palette.shard.mid,
        d: Palette.shard.dark,
        D: Palette.shard.deep,
    });
    // The rare green crystal (recruits Archers): same cut, emerald glow.
    textureFromPixelMap(scene, Tex.SoulShardGreen, SOUL_SHARD, {
        o: '#06200f', P: '#d8ffe2', M: '#5dff8a', d: '#22c55e', D: '#0f6b34',
    });
    textureFromPixelMap(scene, Tex.FxArrow, ['o.......ww', 'kkkkkkkkWw', 'o.......ww'], { k: '#6b4a2a', W: '#e4edf4', w: '#b9c2c9', o: '#c8302a' });

    for (const accent of ACCENTS)
    {
        const glow = Palette.accent[accent];
        const pale = Palette.accentPale[accent];
        textureFromPixelMap(scene, Tex.runestone(accent), RUNESTONE, { ...STONE_COLORS, r: glow });
        textureFromPixelMap(scene, Tex.shroom(accent), SHROOM, {
            o: Palette.outline, R: glow, p: pale, S: Palette.mushroomStem,
        });
        textureFromPixelMap(scene, Tex.wisp(accent), WISP, { R: glow, p: pale });
    }

    createGroundTileset(scene, tileSize);
    createGlowTexture(scene);
    createCombatTextures(scene);
    createVignetteTexture(scene);
    createStructureTextures(scene);
    createNatureTextures(scene);
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** All ground tiles side by side in one image (a "tileset"). */
function createGroundTileset (scene: Scene, size: number): void
{
    if (scene.textures.exists(Tex.Ground)) return;

    const texture = scene.textures.createCanvas(Tex.Ground, size * GROUND_TILE_COUNT, size);
    if (!texture) return;

    const ctx = texture.getContext();
    const rng = createRng(777);

    /** Set one pixel inside a tile, wrapping around the edges so tiles join seamlessly. */
    const px = (tile: number, x: number, y: number, color: string) => {
        const wx = ((Math.round(x) % size) + size) % size;
        const wy = ((Math.round(y) % size) + size) % size;
        ctx.fillStyle = color;
        ctx.fillRect(tile * size + wx, wy, 1, 1);
    };

    /** Fill a tile with a base colour plus random speckles. */
    const speckle = (tile: number, base: string, specks: [string, number][]) => {
        ctx.fillStyle = base;
        ctx.fillRect(tile * size, 0, size, size);
        for (let y = 0; y < size; y++)
        {
            for (let x = 0; x < size; x++)
            {
                let r = rng();
                for (const [color, chance] of specks)
                {
                    if (r < chance) { px(tile, x, y, color); break; }
                    r -= chance;
                }
            }
        }
    };

    /** A tiny grass tuft. */
    const tufts = (tile: number, count: number, color: string, shade: string) => {
        for (let i = 0; i < count; i++)
        {
            const x = rng() * size;
            const y = rng() * size;
            px(tile, x, y, color);
            px(tile, x - 1, y - 1, color);
            px(tile, x + 1, y - 1, color);
            px(tile, x, y + 1, shade);
        }
    };

    /** A round clump of leaves, for the forest canopy. */
    const leafClump = (tile: number, cx: number, cy: number, radius: number, color: string, highlight: string) => {
        for (let dy = -radius; dy <= radius; dy++)
        {
            for (let dx = -radius; dx <= radius; dx++)
            {
                if (dx * dx + dy * dy <= radius * radius + radius * 0.8) px(tile, cx + dx, cy + dy, color);
            }
        }
        px(tile, cx - 1, cy - 1, highlight);
    };

    const g = Palette.grass;
    const dg = Palette.darkGrass;
    const dirt = Palette.dirt;
    const canopy = Palette.canopy;

    speckle(GroundTile.Grass, g[1], [[g[0], 0.12], [g[2], 0.1], [g[3], 0.02]]);

    speckle(GroundTile.GrassAlt, g[1], [[g[0], 0.18], [g[2], 0.06]]);
    tufts(GroundTile.GrassAlt, 2, g[3], g[0]);

    speckle(GroundTile.GrassTufts, g[1], [[g[0], 0.12], [g[2], 0.1]]);
    tufts(GroundTile.GrassTufts, 5, g[3], g[0]);

    speckle(GroundTile.DarkGrass, dg[1], [[dg[0], 0.15], [dg[2], 0.08]]);

    speckle(GroundTile.DarkGrassAlt, dg[1], [[dg[0], 0.15], [dg[2], 0.08]]);
    tufts(GroundTile.DarkGrassAlt, 3, dg[2], dg[0]);

    speckle(GroundTile.Dirt, dirt[1], [[dirt[0], 0.15], [dirt[2], 0.08], [Palette.stone.mid, 0.01]]);

    for (const tile of [GroundTile.Canopy, GroundTile.CanopyAlt])
    {
        speckle(tile, canopy[0], [[canopy[1], 0.2]]);
        for (let i = 0; i < 6; i++)
        {
            leafClump(tile, rng() * size, rng() * size, 2 + Math.floor(rng() * 2), canopy[2], canopy[3]);
        }
    }

    // --- Volcano biome ---
    // Grey-brown ash with soot and the odd cinder.
    speckle(GroundTile.Ash, '#4f4743', [['#5d5550', 0.16], ['#3f3835', 0.14], ['#7a3a1c', 0.006]]);
    speckle(GroundTile.AshAlt, '#463f3b', [['#544b46', 0.14], ['#332d2a', 0.18], ['#2a2422', 0.05]]);
    // Cracked dark slabs in the alternate ash tile.
    for (let i = 0; i < 3; i++)
    {
        const x = rng() * size;
        const y = rng() * size;
        for (let k = 0; k < 4; k++) px(GroundTile.AshAlt, x + k, y + (k % 2), '#2a2422');
    }
    // Scorched grass: dry, burnt olive and brown.
    speckle(GroundTile.Scorched, '#4a4a2c', [['#57552f', 0.16], ['#3b3a24', 0.16], ['#5c4a32', 0.08], ['#2f2a20', 0.03]]);
    tufts(GroundTile.Scorched, 2, '#6b6538', '#3b3a24');
    // Dark rock cliffs where the forest would be.
    speckle(GroundTile.Cliff, '#2b2422', [['#3a302d', 0.25], ['#1c1716', 0.15]]);
    for (let i = 0; i < 5; i++) leafClump(GroundTile.Cliff, rng() * size, rng() * size, 2, '#40342f', '#5a4a44');

    // --- Enchanted forest ---
    // Deep, soft moss with a hint of blue, flecked with tiny lights and petals.
    speckle(GroundTile.FaeMoss, '#2f5a3c', [['#376843', 0.18], ['#284e35', 0.14], ['#4c7d4f', 0.04]]);
    speckle(GroundTile.FaeMossAlt, '#2b5338', [['#33603f', 0.16], ['#244630', 0.18], ['#e9ff9a', 0.004]]);
    tufts(GroundTile.FaeMossAlt, 3, '#5c9455', '#244630');
    speckle(GroundTile.FaeBloom, '#2f5a3c', [['#376843', 0.16], ['#284e35', 0.12]]);
    for (let i = 0; i < 3; i++)
    {
        const x = rng() * size;
        const y = rng() * size;
        const petal = ['#c08bff', '#ff8fc8', '#ffd36a', '#f4f0e6'][i % 4];
        px(GroundTile.FaeBloom, x, y, petal);
        px(GroundTile.FaeBloom, x + 1, y, petal);
        px(GroundTile.FaeBloom, x, y + 1, '#5c9455');
    }
    // The fae canopy at the map edge: violet and teal leaves.
    speckle(GroundTile.FaeCanopy, '#1f3a32', [['#294a3e', 0.2]]);
    for (let i = 0; i < 6; i++) leafClump(GroundTile.FaeCanopy, rng() * size, rng() * size, 2 + Math.floor(rng() * 2), i % 2 ? '#4d3d78' : '#2f6a55', i % 2 ? '#8f72c9' : '#5d9f7a');

    // --- Swamp ---
    // Wet dark-brown mud with puddle glints.
    speckle(GroundTile.Mud, '#4a3f2c', [['#56492f', 0.16], ['#3a3122', 0.16], ['#5f6b4a', 0.03], ['#6e7a62', 0.008]]);
    // Murky olive moss, and a darker, tufted variant.
    speckle(GroundTile.SwampMoss, '#3f4a2c', [['#4a5633', 0.16], ['#343d24', 0.16], ['#55603a', 0.04]]);
    speckle(GroundTile.SwampMossAlt, '#384228', [['#434e2f', 0.14], ['#2d3520', 0.2], ['#4a3f2c', 0.05]]);
    tufts(GroundTile.SwampMossAlt, 3, '#5c6a3a', '#2d3520');
    // Swamp canopy at the map edge: drooping olive and grey-green leaves.
    speckle(GroundTile.SwampCanopy, '#232a1a', [['#2c3420', 0.2]]);
    for (let i = 0; i < 6; i++) leafClump(GroundTile.SwampCanopy, rng() * size, rng() * size, 2 + Math.floor(rng() * 2), i % 2 ? '#4e5e32' : '#485040', i % 2 ? '#6a7c44' : '#626c58');

    // --- Crystal biome ---
    // Deep blue-violet moss glinting with crystal grit.
    speckle(GroundTile.CrystalMoss, '#2a3358', [['#323d66', 0.18], ['#232b4a', 0.14], ['#7fd4ff', 0.006], ['#c79bff', 0.006]]);
    speckle(GroundTile.CrystalMossAlt, '#2c3050', [['#36395e', 0.16], ['#22263f', 0.18], ['#8dffb5', 0.005]]);
    tufts(GroundTile.CrystalMossAlt, 3, '#5a6aa8', '#22263f');
    speckle(GroundTile.CrystalGlow, '#2a3358', [['#323d66', 0.16], ['#232b4a', 0.12]]);
    for (let i = 0; i < 3; i++)
    {
        const x = rng() * size;
        const y = rng() * size;
        const glint = ['#7fd4ff', '#c79bff', '#8dffb5'][i % 3];
        px(GroundTile.CrystalGlow, x, y, glint);
        px(GroundTile.CrystalGlow, x, y + 1, '#e8f6ff');
        px(GroundTile.CrystalGlow, x + 1, y + 1, glint);
    }
    // Crystal canopy at the map edge: dark blue rock with crystal tips.
    speckle(GroundTile.CrystalCanopy, '#181c33', [['#20253f', 0.2]]);
    for (let i = 0; i < 6; i++) leafClump(GroundTile.CrystalCanopy, rng() * size, rng() * size, 2, i % 3 === 0 ? '#3c5c8c' : i % 3 === 1 ? '#5a3f8c' : '#2f7a64', i % 3 === 0 ? '#7fd4ff' : i % 3 === 1 ? '#c79bff' : '#8dffb5');

    texture.refresh();
}

/** Soft white circle, tinted per use for magical glows. */
/**
 * Combat effect sprites, all pointing RIGHT (rotated toward the enemy at runtime):
 *  - a sword blade (hilt at the left),
 *  - a crisp crescent slash trail,
 *  - a wispy wind gust (three thin, broken arcs),
 *  - a tiny spark.
 */
function createCombatTextures (scene: Scene): void
{
    textureFromPixelMap(scene, Tex.FxBlade, [
        '.o..........',
        'ogWWWWWWWWWo',
        'ogWHHHHHHHHp',
        'ogWWWWWWWWo.',
        '.o..........',
    ], { o: Palette.outline, g: Palette.commander.gold, W: '#c9d6e2', H: '#ffffff', p: '#eaf6ff' });

    textureFromPixelMap(scene, Tex.FxSpark, [
        '.y.',
        'yWy',
        '.y.',
    ], { W: '#ffffff', y: '#ffe9a8' });

    // --- Water ---
    textureFromPixelMap(scene, Tex.FxGlint, ['.w.', 'www', '.w.'], { w: '#ffffff' });
    textureFromPixelMap(scene, Tex.FxSplash, [
        '.b.....b.',
        'b.w.b.w.b',
        '.wbwwwbw.',
        '..bwwwb..',
    ], { w: '#ffffff', b: '#bfe6ee' });
    textureFromPixelMap(scene, Tex.FxRipple, [
        '...bbbbb...',
        '.bb.....bb.',
        'b.........b',
        '.bb.....bb.',
        '...bbbbb...',
    ], { b: '#e3f4f6' });
    // Ring of disturbed water around a wading soldier's legs (replaces its shadow).
    textureFromPixelMap(scene, Tex.FxWading, [
        '..wwwwwwww..',
        'ww.bbbbbb.ww',
        '..wwwwwwww..',
    ], { w: '#e3f4f6', b: '#5aa6bf' });

    // Crisp slash: a thick crescent that tapers at both ends.
    arcTexture(scene, Tex.FxSlash, 13, 120, (thickness, edge) => {
        if (thickness < 0.5) return null;
        return edge ? '#bfe6ff' : '#ffffff';
    }, 3.5);

    // Wind gust: three thin, broken arcs, pale and airy.
    arcTexture(scene, Tex.FxWind, 18, 110, (_thickness, _edge, radius, x, y) => {
        const band = [17, 14, 11].find((r) => Math.abs(radius - r) < 0.75);
        if (band === undefined) return null;
        if ((x * 3 + y * 5 + band) % 7 === 0) return null; // little gaps so it reads as air
        return band === 14 ? '#ffffff' : '#cdeef5';
    }, 0);
}

/**
 * Paint a crescent (part of a circle) bulging to the right. The circle's
 * centre sits at the texture's left-middle, so rotating the sprite around
 * that point (origin 0, 0.5) sweeps the arc around a soldier's hand.
 *
 * `pick` chooses each pixel's colour (null = transparent) from how thick the
 * stroke is at that angle (tapering to the ends), whether it's on the outer
 * edge, and the pixel's distance from the centre.
 */
function arcTexture (
    scene: Scene, key: string, radius: number, spanDeg: number,
    pick: (thickness: number, edge: boolean, distance: number, x: number, y: number) => string | null,
    maxThickness: number,
): void
{
    if (scene.textures.exists(key)) return;
    const halfSpan = (spanDeg / 2) * Math.PI / 180;
    const width = radius + 2;
    const height = Math.ceil(radius * Math.sin(halfSpan)) * 2 + 3;
    const cy = (height - 1) / 2;
    const texture = scene.textures.createCanvas(key, width, height);
    if (!texture) return;
    const ctx = texture.getContext();

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const dx = x + 0.5;
            const dy = y - cy;
            const distance = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);
            if (Math.abs(angle) > halfSpan) continue;
            // Thickest in the middle of the arc, tapering to points at the ends.
            const taper = Math.pow(1 - Math.abs(angle) / halfSpan, 0.7);
            const thickness = maxThickness * taper;
            if (maxThickness > 0 && (distance > radius || distance < radius - thickness)) continue;
            const color = pick(thickness, distance > radius - 1, distance, x, y);
            if (!color) continue;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    texture.refresh();
}

function createGlowTexture (scene: Scene): void
{
    if (scene.textures.exists(Tex.Glow)) return;

    const size = 32;
    const texture = scene.textures.createCanvas(Tex.Glow, size, size);
    if (!texture) return;

    const ctx = texture.getContext();
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    texture.refresh();
}

/** Dark edges around the screen for a gloomy, focused mood. */
function createVignetteTexture (scene: Scene): void
{
    if (scene.textures.exists(Tex.Vignette)) return;

    // 16:9, matching the widescreen view (it's stretched to fill the screen).
    const width = 640;
    const height = 360;
    const texture = scene.textures.createCanvas(Tex.Vignette, width, height);
    if (!texture) return;

    const ctx = texture.getContext();
    const gradient = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.hypot(width / 2, height / 2),
    );
    // Daytime: only a light darkening at the very edges.
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.7, 'rgba(10, 12, 18, 0.04)');
    gradient.addColorStop(1, 'rgba(8, 10, 16, 0.32)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    texture.refresh();
}
