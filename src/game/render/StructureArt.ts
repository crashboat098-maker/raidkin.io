import { Scene } from 'phaser';
import { createRng } from '../logic/Random';
import { STRUCTURE_SPECS, type StructureType } from '../logic/Structures';
import { Palette } from './Palette';
import { PixelPainter } from './PixelPainter';

/**
 * Placeholder artwork for structures, painted in code with simple "brushes"
 * (see PixelPainter).
 *
 * Everything here is visual only. To swap in hand-made art later, load a PNG
 * under the same texture key (`structure-<type>`) and list its light positions.
 *
 * Perspective: top-down with a slight tilt, like the rest of the battlefield.
 * Front walls face the viewer; roofs and wall-walks are seen from above.
 */

export interface StructureLight {
    /** Position relative to the structure's bottom-centre, in world pixels. */
    x: number;
    y: number;
    color: string;
    scale: number;
    kind: 'torch' | 'window' | 'rune' | 'lava';
}

export interface StructureArtInfo {
    key: string;
    lights: StructureLight[];
}

const artByType = new Map<string, StructureArtInfo>();

export function getStructureArt (type: StructureType, variant = 0): StructureArtInfo
{
    const info = artByType.get(`${type}:${variant}`) ?? artByType.get(`${type}:0`);
    if (!info)
    {
        throw new Error(`Structure art for "${type}" has not been created yet.`);
    }
    return info;
}

type Painter = (p: PixelPainter, lights: StructureLight[], variant: number) => void;

const PAINTERS: Record<StructureType, Painter> = {
    barracks: paintBarracks,
    watchtower: paintWatchtower,
    fortification: paintFortification,
    keep: paintKeep,
    castle: paintCastle,
    house: paintHouse,
    volcano: paintVolcano,
    faeHouse: paintFaeHouse,
    shrine: paintShrine,
    moonGate: paintMoonGate,
    faeCastle: paintFaeCastle,
    gothicFortress: paintGothicFortress,
    cathedral: paintCathedral,
    darkSpire: paintDarkSpire,
    ashHouse: paintAshHouse,
    stiltHut: paintStiltHut,
    swampCastle: paintSwampCastle,
};

// ---------------------------------------------------------------------------
// Grand structures (biome landmarks)
// ---------------------------------------------------------------------------

/** Violet and mint roof tiles for the fae castle (light to dark). */
const FAE_ROOF = ['#a98ae6', '#8a6ad6', '#6a4aae', '#4a3282'];
const MINT_ROOF = ['#8fd6b2', '#6fbf9a', '#4f9f7d', '#357a5c'];
/** Black gothic stone (light to dark) and ember-red light. */
const BLACK = ['#625c68', '#4b4652', '#38343f', '#28252e', '#1a181f'];
const EMBER = ['#ffd27a', '#ff8a2a', '#d4481a', '#7a1f10'];

/** Ashlar masonry: courses of blocks, lit on the left, in a given palette (light to dark). */
function masonry (p: PixelPainter, x: number, y: number, w: number, h: number, shades: readonly string[], light = 0.25): void
{
    for (let dy = 0; dy < h; dy++)
    {
        for (let dx = 0; dx < w; dx++)
        {
            const ax = x + dx;
            const ay = y + dy;
            const course = Math.floor(ay / 4);
            const joint = ay % 4 === 3 || (ax + (course % 2) * 4) % 8 === 7;
            const lit = dx / Math.max(1, w - 1);
            let shade = lit < light ? 0 : lit > 0.8 ? 2 : 1;
            if (joint) shade = Math.min(shades.length - 1, shade + 2);
            p.set(ax, ay, shades[shade]);
        }
    }
}

/** A round tower: shaded body, a conical roof with a gold finial, and optional banner. */
function roundTower (p: PixelPainter, cx: number, half: number, top: number, bottom: number, wall: readonly string[], roof: readonly string[], roofHeight: number): void
{
    for (let y = top; y < bottom; y++)
    {
        for (let x = -half; x <= half; x++)
        {
            const t = (x + half) / (half * 2);
            const ring = y % 5 === 4;
            const shade = t < 0.25 ? 0 : t < 0.65 ? 1 : t < 0.88 ? 2 : 3;
            p.set(cx + x, y, ring ? wall[Math.min(wall.length - 1, shade + 1)] : wall[shade]);
        }
    }
    // Conical roof, overhanging a little.
    for (let row = 0; row < roofHeight; row++)
    {
        const w = Math.round(((row + 1) / roofHeight) * (half + 2));
        for (let x = -w; x <= w; x++)
        {
            const t = (x + w) / Math.max(1, w * 2);
            const tile = (row + (x & 1)) % 3 === 0;
            p.set(cx + x, top - roofHeight + row, roof[Math.min(roof.length - 1, (t < 0.35 ? 0 : t < 0.7 ? 1 : 2) + (tile ? 1 : 0))]);
        }
    }
    p.rect(cx, top - roofHeight - 4, 1, 4, Palette.commander.gold);
    p.set(cx, top - roofHeight - 5, '#fff2b8');
}

/** A tall pointed-arch window, glowing. */
function archWindow (p: PixelPainter, lights: StructureLight[], x: number, y: number, w: number, h: number, glow: string, frame: string, lightScale = 0.4, kind: StructureLight['kind'] = 'window'): void
{
    for (let dy = 0; dy < h; dy++)
    {
        const inset = dy < w / 2 ? Math.ceil(w / 2 - dy) - 1 : 0; // pointed top
        for (let dx = inset; dx < w - inset; dx++) p.set(x + dx, y + dy, (dx === inset || dx === w - 1 - inset || dy === h - 1) ? frame : glow);
    }
    lights.push({ x: x + w / 2, y: y + h / 2, color: glow, scale: lightScale, kind });
}

/**
 * 200 x 184: the giant fae castle. White marble walls, slender round towers
 * with violet and mint cones and gold finials, a central keep with a great
 * glowing rose window, a tall arched gate, banners, ivy and flowers.
 */
function paintFaeCastle (p: PixelPainter, lights: StructureLight[]): void
{
    const rng = p.rng;
    const W = 200;
    const H = 184;
    // Back: two very tall slender spires and the keep.
    roundTower(p, 70, 8, 30, 140, MARBLE, MINT_ROOF, 26);
    roundTower(p, 130, 8, 30, 140, MARBLE, MINT_ROOF, 26);
    masonry(p, 84, 62, 32, 80, MARBLE);
    // Keep roof: a steep violet gable with a gold spire.
    for (let row = 0; row < 26; row++)
    {
        const w = Math.round((row / 26) * 19);
        for (let x = -w; x <= w; x++) p.set(100 + x, 36 + row, FAE_ROOF[(x < -w / 3 ? 0 : x > w / 3 ? 2 : 1) + (row % 4 === 3 ? 1 : 0)]);
    }
    p.rect(100, 24, 1, 12, Palette.commander.gold);
    p.set(100, 23, '#fff2b8');
    // The great rose window.
    for (let dy = -9; dy <= 9; dy++)
    {
        for (let dx = -9; dx <= 9; dx++)
        {
            const d = Math.hypot(dx, dy);
            if (d > 9.5) continue;
            const spoke = Math.abs(Math.atan2(dy, dx) * 4 / Math.PI % 1) < 0.18;
            p.set(100 + dx, 82 + dy, d > 8.3 ? MARBLE[3] : d < 2 ? FAE_GLOW.pale : spoke ? FAE_GLOW.deep : (dx + dy) % 3 === 0 ? FAE_GLOW.light : FAE_GLOW.mid);
        }
    }
    lights.push({ x: 100, y: 82, color: FAE_GLOW.light, scale: 1.3, kind: 'rune' });

    // Front: the curtain wall with battlements and the gate.
    masonry(p, 26, 128, 148, 56, MARBLE);
    p.crenellations(26, 125, 148);
    for (let x = 26; x < 174; x += 4) p.rect(x, 125, 2, 3, MARBLE[(x / 4) % 2 === 0 ? 0 : 1]);
    // The gate: a tall pointed arch, glowing faintly, with a gold-trimmed door.
    for (let dy = 0; dy < 40; dy++)
    {
        const inset = dy < 10 ? 10 - dy : 0;
        for (let dx = inset; dx < 22 - inset; dx++) p.set(89 + dx, 144 + dy, dy > 30 ? '#2b2440' : dx === inset || dx === 21 - inset ? Palette.commander.gold : '#3a2f58');
    }
    p.rect(99, 156, 2, 28, '#2b2440');
    lights.push({ x: 100, y: 168, color: FAE_GLOW.mid, scale: 0.9, kind: 'rune' });
    // Windows along the wall.
    for (const x of [44, 60, 132, 148]) archWindow(p, lights, x, 146, 6, 12, Palette.windowLit, MARBLE[3], 0.3);

    // Front towers, the biggest, at the corners.
    roundTower(p, 22, 16, 64, H, MARBLE, FAE_ROOF, 34);
    roundTower(p, W - 23, 16, 64, H, MARBLE, FAE_ROOF, 34);
    for (const cx of [22, W - 23])
    {
        archWindow(p, lights, cx - 3, 90, 7, 14, FAE_GLOW.light, MARBLE[3], 0.35, 'rune');
        archWindow(p, lights, cx - 3, 130, 7, 14, Palette.windowLit, MARBLE[3], 0.3);
        // Banners hanging from the towers.
        p.rect(cx - 5, 112, 10, 2, Palette.commander.gold);
        for (let y = 114; y < 128; y++) p.rect(cx - 4, y, 8, 1, y > 124 && (y + cx) % 2 ? '#3a2468' : '#6a3fae');
        p.set(cx, 120, Palette.commander.gold);
    }
    // Torches either side of the gate.
    torch(p, lights, 84, 160);
    torch(p, lights, 115, 160);

    // Ivy and flowers climbing the walls.
    p.speckle(4, 150, 192, 34, '#4f8a3f', 0.12);
    for (let i = 0; i < 40; i++) p.set(4 + rng() * 192, 156 + rng() * 26, ['#ff8fc8', '#c08bff', '#ffd36a'][i % 3]);
}

/**
 * 224 x 200: a towering gothic fortress of black stone. Pointed spires, a
 * great buttressed hall with ember-lit lancet windows, a huge pointed gate
 * glowing like a furnace, spiked battlements and tattered red banners.
 */
function paintGothicFortress (p: PixelPainter, lights: StructureLight[]): void
{
    const rng = p.rng;
    const W = 224;
    const H = 200;
    const spire = (cx: number, half: number, top: number, bottom: number, spireH: number) => {
        masonry(p, cx - half, top, half * 2, bottom - top, BLACK, 0.2);
        // Needle spire with crockets.
        for (let row = 0; row < spireH; row++)
        {
            const w = Math.round((row / spireH) * (half + 1));
            for (let x = -w; x <= w; x++) p.set(cx + x, top - spireH + row, x < 0 ? BLACK[1] : BLACK[3]);
            if (row % 6 === 5) { p.set(cx - w - 1, top - spireH + row, BLACK[0]); p.set(cx + w + 1, top - spireH + row, BLACK[2]); }
        }
        // Spiked parapet.
        for (let x = -half; x <= half; x += 3) { p.set(cx + x, top - 1, BLACK[0]); p.set(cx + x, top - 2, BLACK[1]); }
    };
    // Back: two very tall spires and the great hall.
    spire(78, 11, 46, 150, 44);
    spire(146, 11, 46, 150, 44);
    masonry(p, 90, 70, 44, 80, BLACK, 0.2);
    for (let row = 0; row < 30; row++)
    {
        const w = Math.round((row / 30) * 24);
        for (let x = -w; x <= w; x++) p.set(112 + x, 40 + row, Palette.slate[x < 0 ? 2 : 1]);
    }
    // Lancet windows of the hall, ember-lit.
    for (const x of [96, 108, 120]) archWindow(p, lights, x, 84, 7, 22, EMBER[1], BLACK[4], 0.45, 'torch');

    // Front wall with buttresses and spiked battlements.
    masonry(p, 20, 124, 184, 76, BLACK, 0.2);
    for (let x = 20; x < 204; x += 4) { p.set(x, 123, BLACK[0]); p.set(x, 122, BLACK[1]); p.set(x + 1, 123, BLACK[2]); }
    for (const x of [48, 76, 148, 176])
    {
        // Buttresses stepping out from the wall.
        for (let y = 140; y < H; y++) p.rect(x, y, 6 + Math.floor((y - 140) / 12), 1, y % 4 === 3 ? BLACK[3] : BLACK[1]);
    }
    // The great gate: a pointed arch glowing like a furnace, portcullis bars.
    for (let dy = 0; dy < 52; dy++)
    {
        const inset = dy < 14 ? 14 - dy : 0;
        for (let dx = inset; dx < 30 - inset; dx++)
        {
            const edge = dx === inset || dx === 29 - inset;
            const bar = dx % 4 === 1 || dy % 6 === 2;
            p.set(97 + dx, 148 + dy, edge ? BLACK[0] : bar ? '#1a0d0a' : dy > 34 ? EMBER[2] : EMBER[3]);
        }
    }
    lights.push({ x: 112, y: 180, color: EMBER[1], scale: 1.4, kind: 'lava' });
    // Front towers with spires.
    spire(18, 17, 70, H, 48);
    spire(W - 19, 17, 70, H, 48);
    for (const cx of [18, W - 19])
    {
        for (const y of [96, 136]) archWindow(p, lights, cx - 3, y, 6, 14, EMBER[1], BLACK[4], 0.3, 'torch');
        // Tattered red banners.
        for (let y = 158; y < 184; y++)
        {
            const ragged = y > 178 && (y + cx) % 2 === 0;
            if (!ragged) p.rect(cx - 6, y, 12, 1, y % 5 === 0 ? '#5a1010' : '#8a1a1a');
        }
        p.rect(cx - 7, 157, 14, 1, Palette.commander.gold);
    }
    // Torches flanking the gate.
    torch(p, lights, 90, 164);
    torch(p, lights, 133, 164);
    // Soot and cracks.
    for (let i = 0; i < 60; i++) p.set(20 + rng() * 184, 126 + rng() * 72, BLACK[4]);
}

/** Moss-grown swamp stone (light to dark), mossy slate, old wood, roots and the swamp's green light. */
const MIRE_STONE = ['#7d8a6a', '#626e52', '#4a553e', '#343c2c', '#22281c'];
const MIRE_ROOF = ['#5e7046', '#46563a', '#33402a', '#222c1c'];
const MIRE_WOOD = ['#8a7050', '#6a5238', '#4c3a28', '#33271b'];
const MIRE_ROOT = ['#5a4430', '#3e2e20', '#2a1f15'];
const MIRE_GLOW = { light: '#d6ff9a', mid: '#b6ff5c', deep: '#5a8a2a' };
const MOSS = ['#6f8a3a', '#4f6a32', '#3f5a2a'];

/**
 * 176 x 156: the swamp castle. Weathered, moss-covered stone: a crooked
 * back tower and a keep under mossy slate, a curtain wall whose battlements
 * have half crumbled, one front tower still roofed and one broken open.
 * Twisted roots climb the walls, vines hang from them, a wooden walkway
 * runs along the wall on rickety struts, and the windows glow sickly green.
 */
function paintSwampCastle (p: PixelPainter, lights: StructureLight[]): void
{
    const rng = p.rng;
    const W = 176;
    const H = 156;

    // Back: a tall, slightly crooked tower and the keep.
    roundTower(p, 48, 9, 34, 112, MIRE_STONE, MIRE_ROOF, 24);
    p.line(48, 6, 51, 2, MIRE_ROOT[1]); // its finial bent askew
    masonry(p, 64, 46, 50, 70, MIRE_STONE, 0.25);
    for (let row = 0; row < 28; row++)
    {
        // Steep mossy gable over the keep, a few slates missing.
        const w = Math.round((row / 28) * 28);
        for (let x = -w; x <= w; x++)
        {
            if (rng() < 0.03) continue;
            p.set(89 + x, 18 + row, MIRE_ROOF[(x < -w / 3 ? 0 : x > w / 3 ? 2 : 1) + (row % 4 === 3 ? 1 : 0)]);
        }
    }
    for (const x of [74, 98]) archWindow(p, lights, x, 60, 6, 13, MIRE_GLOW.mid, MIRE_STONE[4], 0.32);
    archWindow(p, lights, 86, 52, 6, 11, MIRE_GLOW.light, MIRE_STONE[4], 0.3);

    // Front: the curtain wall, battlements crumbled in places.
    masonry(p, 22, 96, 132, 60, MIRE_STONE, 0.25);
    for (let x = 22; x < 154; x += 4)
    {
        if (rng() < 0.3) continue; // fallen merlons
        p.rect(x, 92, 2, 4, MIRE_STONE[x % 8 === 2 ? 0 : 1]);
    }
    // The gate: a pointed arch with rotting plank doors, half open.
    for (let dy = 0; dy < 38; dy++)
    {
        const inset = dy < 11 ? 11 - dy : 0;
        for (let dx = inset; dx < 24 - inset; dx++)
        {
            const edge = dx === inset || dx === 23 - inset;
            const plank = (dx % 4 === 0 ? MIRE_WOOD[3] : MIRE_WOOD[(dx + Math.floor(dy / 7)) % 2 === 0 ? 1 : 2]);
            p.set(76 + dx, 118 + dy, edge ? MIRE_STONE[0] : dx > 13 && dy > 8 ? '#141a10' : plank);
        }
    }
    p.rect(77, 134, 12, 1, MIRE_WOOD[0]); // iron-less cross-brace
    lights.push({ x: 88, y: 146, color: MIRE_GLOW.deep, scale: 0.7, kind: 'rune' });
    for (const x of [36, 54, 116, 134]) archWindow(p, lights, x, 106, 5, 10, MIRE_GLOW.mid, MIRE_STONE[4], 0.26);

    // A wooden walkway along the wall, on crooked struts, with a rope railing.
    for (const [from, to] of [[24, 72], [104, 152]])
    {
        p.rect(from, 122, to - from, 3, MIRE_WOOD[1]);
        p.rect(from, 122, to - from, 1, MIRE_WOOD[0]);
        for (let x = from; x < to; x += 3) p.set(x, 124, MIRE_WOOD[3]);
        for (let x = from + 2; x < to; x += 9)
        {
            p.rect(x, 117, 1, 5, MIRE_WOOD[2]);                       // railing post
            p.line(x, 125, x + (rng() < 0.5 ? -4 : 4), 133, MIRE_WOOD[2]); // strut
        }
        for (let x = from; x < to; x++) p.set(x, 118 + Math.round(Math.sin(x / 3) * 0.6), MIRE_ROOT[0]); // sagging rope
    }

    // Front towers: one still roofed, one broken open at the top.
    roundTower(p, 18, 15, 62, H, MIRE_STONE, MIRE_ROOF, 26);
    roundTower(p, W - 19, 15, 74, H, MIRE_STONE, MIRE_ROOF, 1);
    for (let x = -15; x <= 15; x++)
    {
        // Jagged, broken rim (overpaints the stub of a roof).
        const bite = Math.abs(Math.sin(x * 1.7)) * 9 + (rng() < 0.3 ? 3 : 0);
        for (let y = 68; y < 74 + bite; y++) p.clear(W - 19 + x, y);
        p.set(W - 19 + x, Math.round(74 + bite), MIRE_STONE[0]);
    }
    for (const cx of [18, W - 19])
    {
        archWindow(p, lights, cx - 3, 100, 6, 12, MIRE_GLOW.mid, MIRE_STONE[4], 0.3);
        archWindow(p, lights, cx - 2, 128, 5, 9, MIRE_GLOW.light, MIRE_STONE[4], 0.24);
    }

    // Twisted roots climbing out of the bog, up the towers and walls.
    for (const start of [6, 26, 44, 66, 110, 128, 150, 168])
    {
        let x = start;
        const height = 18 + rng() * 34;
        for (let y = H - 1; y > H - height; y--)
        {
            x += Math.round((rng() - 0.5) * 2);
            p.set(x, y, MIRE_ROOT[1]);
            if (y > H - 12) { p.set(x + 1, y, MIRE_ROOT[2]); p.set(x - 1, y, MIRE_ROOT[0]); }
            if (rng() < 0.08) p.line(x, y, x + (rng() < 0.5 ? -3 : 3), y - 3, MIRE_ROOT[0]);
        }
    }
    // Moss: thick at the foot of every wall, patchy higher up; vines hanging from the parapets.
    p.speckle(0, H - 26, W, 26, MOSS[1], 0.3);
    p.speckle(0, 60, W, 70, MOSS[0], 0.08);
    p.speckle(60, 40, 56, 40, MOSS[2], 0.1);
    for (let i = 0; i < 26; i++)
    {
        const x = 22 + Math.floor(rng() * 132);
        const length = 4 + Math.floor(rng() * 14);
        if (x > 74 && x < 102) continue; // keep the gate clear
        for (let y = 96; y < 96 + length; y++) if (p.has(x, y)) p.set(x, y, y % 3 === 0 ? MOSS[0] : MOSS[2]);
    }
    // Swamp lanterns either side of the gate.
    for (const x of [70, 106])
    {
        p.rect(x, 128, 1, 6, MIRE_WOOD[3]);
        p.rect(x - 1, 125, 3, 3, MIRE_GLOW.mid);
        p.set(x, 126, MIRE_GLOW.light);
        lights.push({ x, y: 126, color: MIRE_GLOW.mid, scale: 0.5, kind: 'window' });
    }
}

/**
 * 160 x 168: a ruined cathedral. A broken bell tower, a jagged collapsed
 * roof, flying buttresses and a great rose window still glowing red and gold.
 */
function paintCathedral (p: PixelPainter, lights: StructureLight[]): void
{
    const rng = p.rng;
    const STONE = ['#7a747c', '#5f5a63', '#48444d', '#34313a', '#232027'];
    // Nave with a jagged, broken roofline.
    let roof = 52;
    for (let x = 40; x < 156; x++)
    {
        if (x % 5 === 0) roof = 48 + Math.floor(rng() * 16) + (x > 120 ? 18 : 0);
        masonry(p, x, roof, 1, 168 - roof, STONE, 0.2);
        p.set(x, roof, STONE[0]);
    }
    // Flying buttresses.
    for (const x of [58, 92, 126])
    {
        for (let i = 0; i < 26; i++) p.set(x - 10 + i * 0.5, 96 + i, STONE[3]);
        p.rect(x - 12, 120, 5, 48, STONE[2]);
    }
    // The great rose window.
    for (let dy = -16; dy <= 16; dy++)
    {
        for (let dx = -16; dx <= 16; dx++)
        {
            const d = Math.hypot(dx, dy);
            if (d > 16.5) continue;
            const petal = Math.cos(Math.atan2(dy, dx) * 8) > 0.6;
            p.set(98 + dx, 92 + dy, d > 15 ? STONE[4] : d < 3 ? EMBER[0] : petal ? '#b0201c' : (dx + dy) % 4 === 0 ? EMBER[0] : EMBER[1]);
        }
    }
    lights.push({ x: 98, y: 92, color: EMBER[1], scale: 1.4, kind: 'rune' });
    // Lancet windows and a great doorway.
    for (const x of [64, 124]) archWindow(p, lights, x, 118, 7, 22, '#c2410c', STONE[4], 0.3);
    for (let dy = 0; dy < 34; dy++)
    {
        const inset = dy < 9 ? 9 - dy : 0;
        for (let dx = inset; dx < 18 - inset; dx++) p.set(89 + dx, 134 + dy, dx === inset || dx === 17 - inset ? STONE[0] : '#120e10');
    }
    // The bell tower, its spire snapped off.
    masonry(p, 6, 26, 34, 142, STONE, 0.2);
    for (let x = 6; x < 40; x++) { const h = 26 - Math.floor(rng() * 10) * (x > 22 ? 1 : 0.3); p.rect(x, h, 1, 26 - h + 1, STONE[x < 22 ? 1 : 2]); }
    archWindow(p, lights, 18, 44, 10, 20, '#2a1a1a', STONE[4], 0.1);
    archWindow(p, lights, 19, 92, 8, 16, EMBER[2], STONE[4], 0.3, 'torch');
    // Rubble along the foot, moss and soot.
    for (let i = 0; i < 18; i++) p.shadedBlob(42 + rng() * 116, 164 + rng() * 3, 2 + Math.floor(rng() * 3), 2, STONE.slice(1));
    p.speckle(0, 140, 160, 28, Palette.stone.moss, 0.08);
}

/** 34 x 128: an ominous black spire with ember-lit slits and a red rune glowing near its tip. */
function paintDarkSpire (p: PixelPainter, lights: StructureLight[]): void
{
    for (let y = 24; y < 128; y++)
    {
        const half = y > 112 ? 15 - Math.floor((128 - y) / 4) : y > 40 ? 9 : 9 - Math.floor((40 - y) / 3);
        masonry(p, 17 - half, y, half * 2, 1, BLACK, 0.25);
    }
    for (let row = 0; row < 24; row++)
    {
        const w = Math.round((row / 24) * 6);
        for (let x = -w; x <= w; x++) p.set(17 + x, row, x < 0 ? BLACK[1] : BLACK[3]);
    }
    for (const y of [52, 72, 92]) { p.rect(16, y, 2, 6, EMBER[2]); p.set(16, y, EMBER[1]); }
    lights.push({ x: 17, y: 72, color: EMBER[1], scale: 0.3, kind: 'torch' });
    rune(p, 16, 30, '#ff4a3a');
    lights.push({ x: 17, y: 32, color: '#ff4a3a', scale: 0.6, kind: 'rune' });
}

/**
 * 32 x 40: an ash-village house. Dark stone walls, a steep roof (black slate,
 * rusted iron, or charred thatch), red-lit windows, a chimney trailing embers.
 */
function paintAshHouse (p: PixelPainter, lights: StructureLight[], variant: number): void
{
    const roofs = [['#4a4a5c', '#363645', '#272733', '#1a1a22'], ['#8a4a2a', '#6e3a20', '#522a16', '#3a1d10'], ['#4a3a2a', '#3a2c20', '#2a2018', '#1c1610']];
    const roof = roofs[variant];
    masonry(p, 3, 20, 26, 20, BLACK, 0.25);
    for (let row = 0; row < 18; row++)
    {
        const w = Math.round(((row + 1) / 18) * 15);
        for (let x = -w; x <= w; x++) p.set(16 + x, 3 + row, roof[(x < -w / 3 ? 0 : x > w / 3 ? 2 : 1) + (row % 3 === 2 ? 1 : 0)]);
    }
    // Chimney with a glowing ember.
    p.rect(22, 2, 4, 9, BLACK[2]);
    p.set(23, 1, EMBER[1]);
    // Red-lit windows and a heavy door.
    for (const x of [7, 22])
    {
        p.rect(x, 25, 4, 5, BLACK[4]);
        p.rect(x + 1, 26, 2, 3, EMBER[1]);
        lights.push({ x: x + 2, y: 27, color: EMBER[1], scale: 0.3, kind: 'window' });
    }
    p.rect(14, 29, 5, 11, '#24170f');
    p.rect(15, 30, 3, 10, '#3a2618');
    p.set(17, 35, Palette.commander.gold);
}

/**
 * 34 x 46: a swamp stilt hut. A plank cabin on a deck raised on crooked
 * wooden stilts, a shaggy reed-thatch roof (olive, dark reed, or moss-grown),
 * a lantern-lit window glowing swamp-green, and a ladder down to the mud.
 */
function paintStiltHut (p: PixelPainter, lights: StructureLight[], variant: number): void
{
    const rng = p.rng;
    const wood = ['#8a7050', '#6a5238', '#4c3a28', '#33271b'];
    const roofs = [['#b4a868', '#948a4e', '#736a38', '#504a26'], ['#7a6a48', '#5e5036', '#443a26', '#2e2718'], ['#7c9050', '#5e7238', '#465628', '#30401c']];
    const roof = roofs[variant];
    // Stilts, slightly crooked, with dark wet bottoms.
    for (const x of [5, 13, 21, 29])
    {
        const lean = rng() < 0.5 ? 0 : 1;
        for (let y = 33; y < 46; y++) p.set(x + (y > 40 ? lean : 0), y, y > 42 ? '#2a2a1e' : wood[y % 3 === 0 ? 2 : 1]);
    }
    p.line(5, 36, 13, 42, wood[2]); // cross-bracing
    p.line(21, 42, 29, 36, wood[2]);
    // The deck.
    p.rect(1, 30, 32, 3, wood[1]);
    p.rect(1, 30, 32, 1, wood[0]);
    // Plank walls.
    for (let x = 4; x < 30; x++)
    {
        for (let y = 15; y < 30; y++) p.set(x, y, x % 4 === 0 ? wood[3] : x < 10 ? wood[0] : wood[1]);
    }
    p.speckle(4, 24, 26, 6, '#4f6a32', 0.18); // damp moss creeping up
    // Shaggy reed thatch, with ragged hanging ends.
    for (let row = 0; row < 15; row++)
    {
        const w = Math.round(((row + 1) / 15) * 16) + 1;
        for (let x = -w; x <= w; x++) p.set(17 + x, 1 + row, roof[(x < -w / 3 ? 0 : x > w / 3 ? 2 : 1) + (rng() < 0.18 ? 1 : 0)]);
    }
    for (let x = 0; x < 34; x += 2) p.rect(x, 16, 1, 1 + Math.floor(rng() * 3), roof[2]);
    // A round window lit green, a low door and a ladder.
    p.shadedBlob(10, 21, 2, 2, [wood[3]]);
    p.rect(9, 20, 3, 3, '#b6ff5c');
    p.set(9, 20, '#f2ffd0');
    lights.push({ x: 10, y: 21, color: '#b6ff5c', scale: 0.32, kind: 'window' });
    p.rect(19, 21, 6, 9, '#241a10');
    p.rect(20, 22, 4, 8, '#3a2a1a');
    for (let y = 33; y < 46; y += 3) p.rect(19, y, 6, 1, wood[0]);
    p.line(19, 32, 19, 45, wood[2]);
    p.line(24, 32, 24, 45, wood[2]);
}

/** Pale elven marble, light to dark. */
const MARBLE = ['#f1ece2', '#d9d2c4', '#b9b1a2', '#8f8879'];
/** Soft violet magic (never cyan: cyan means Soul Shards). */
const FAE_GLOW = { pale: '#efe0ff', light: '#c9a2ff', mid: '#9a68e0', deep: '#6a3fae' };

/**
 * 32 x 36: a fae cottage. Variant 0: red-capped mushroom house; 1: violet
 * mushroom house; 2: a hollow tree stump with a leafy roof. Round doors,
 * warm round windows, lanterns.
 */
function paintFaeHouse (p: PixelPainter, lights: StructureLight[], variant: number): void
{
    const W = Palette.wood;
    const rng = p.rng;
    const cx = 16;

    if (variant === 2)
    {
        // Stump walls with bark ridges.
        for (let y = 14; y < 36; y++)
        {
            const half = y > 32 ? 13 : 11;
            for (let x = cx - half; x <= cx + half; x++)
            {
                const ridge = (x + Math.floor(y / 5)) % 4 === 0;
                p.set(x, y, x <= cx - half + 1 ? '#7a5a3c' : x >= cx + half - 1 ? '#3e2a1b' : ridge ? '#4f3a26' : '#634830');
            }
        }
        // Leafy, mossy roof with little flowers.
        p.shadedBlob(cx, 10, 15, 8, ['#7fb35a', '#5f9444', '#467536', '#2f5426'], 0.02);
        for (let i = 0; i < 6; i++) p.set(cx - 12 + rng() * 24, 4 + rng() * 9, rng() < 0.5 ? '#f2c94c' : '#f4b6d2');
    }
    else
    {
        const cap = variant === 0 ? ['#f07a5e', '#d4492f', '#a33322', '#6e2116'] : ['#c39af0', '#9a6ad6', '#7449ab', '#4e2f7a'];
        // Pale stem walls, plaster-smooth.
        for (let y = 16; y < 36; y++)
        {
            const half = y > 32 ? 11 : 10;
            for (let x = cx - half; x <= cx + half; x++) p.set(x, y, x <= cx - half + 1 ? '#f4ecd8' : x >= cx + half - 1 ? '#b8ab8e' : '#e2d6bb');
        }
        // A wide dome cap with pale spots and a dark rim.
        p.shadedBlob(cx, 11, 16, 10, cap);
        for (let x = cx - 14; x <= cx + 14; x++) p.set(x, 18, cap[3]);
        for (let i = 0; i < 7; i++)
        {
            const sx = cx + (rng() * 2 - 1) * 11;
            const sy = 4 + rng() * 9;
            p.rect(sx, sy, 2, 1, '#fbf3e4');
        }
    }

    // Round wooden door with a brass knob, and a glowing round window.
    p.shadedBlob(cx + 3, 31, 3, 4, [W.light, W.mid, W.mid, W.dark]);
    p.rect(cx + 1, 33, 5, 3, W.mid);
    p.set(cx + 5, 31, Palette.flame[1]);
    p.shadedBlob(cx - 6, 25, 2, 2, [Palette.flame[1], Palette.windowLit, Palette.windowLit, '#8a5a20']);
    lights.push({ x: cx - 6, y: 25, color: Palette.windowLit, scale: 0.3, kind: 'window' });
    // A lantern hanging by the door.
    p.rect(cx + 9, 26, 1, 3, W.dark);
    p.rect(cx + 8, 29, 3, 3, Palette.flame[1]);
    lights.push({ x: cx + 9, y: 30, color: Palette.accent.amber, scale: 0.35, kind: 'torch' });
}

/** 40 x 46: an elven shrine: white marble steps and slender columns under a curved roof, a violet crystal glowing inside. */
function paintShrine (p: PixelPainter, lights: StructureLight[]): void
{
    const cx = 20;
    // Steps.
    for (let i = 0; i < 3; i++) p.rect(2 + i * 2, 44 - i * 3, 36 - i * 4, 3, MARBLE[i === 0 ? 2 : 1]);
    p.rect(8, 36, 24, 1, MARBLE[0]);
    // Columns.
    for (const x of [8, 15, 23, 30])
    {
        p.rect(x, 14, 3, 22, MARBLE[1]);
        p.rect(x, 14, 1, 22, MARBLE[0]);
        p.rect(x + 2, 14, 1, 22, MARBLE[2]);
        p.rect(x - 1, 13, 5, 1, MARBLE[0]); // capital
    }
    // Shadowed interior and the crystal on its pedestal.
    p.rect(11, 15, 4, 21, '#3a3348');
    p.rect(18, 15, 5, 21, '#3a3348');
    p.rect(26, 15, 4, 21, '#3a3348');
    p.rect(18, 30, 5, 6, MARBLE[2]);
    for (let y = 0; y < 9; y++)
    {
        const half = y < 4 ? Math.floor(y / 2) + 1 : Math.floor((9 - y) / 2) + 1;
        for (let x = -half; x <= half; x++) p.set(cx + x, 20 + y, x < 0 ? FAE_GLOW.pale : x === 0 ? FAE_GLOW.light : FAE_GLOW.mid);
    }
    lights.push({ x: cx, y: 24, color: FAE_GLOW.light, scale: 0.9, kind: 'rune' });
    // Curved, leaf-shaped roof with a gold finial.
    for (let y = 2; y < 13; y++)
    {
        const half = Math.round(4 + (y - 2) * 1.6);
        for (let x = cx - half; x <= cx + half; x++) p.set(x, y, y > 10 ? MARBLE[2] : x < cx - half / 3 ? '#7fae8e' : x > cx + half / 3 ? '#3f6a55' : '#5a8f72');
    }
    p.rect(cx - 1, 0, 2, 3, Palette.commander.gold);
    // Ivy on a column.
    p.speckle(6, 18, 6, 18, '#4f8a3f', 0.25);
}

/**
 * 60 x 56: a ruined moon gate: a broken stone ring on two pillars, runes
 * glowing along it. The archway in the middle is open to walk through.
 */
function paintMoonGate (p: PixelPainter, lights: StructureLight[]): void
{
    const cx = 30;
    const cy = 26;
    // The ring, with a chunk missing at the top right.
    for (let y = 0; y < 56; y++)
    {
        for (let x = 0; x < 60; x++)
        {
            const d = Math.hypot((x - cx) / 1.0, (y - cy) / 1.05);
            if (d < 19 || d > 26) continue;
            const angle = Math.atan2(y - cy, x - cx);
            if (angle > -1.2 && angle < -0.75) continue; // broken section
            if (y > 44) continue;
            const t = (d - 19) / 7;
            p.set(x, y, t < 0.25 ? MARBLE[0] : t > 0.8 ? MARBLE[3] : x < cx ? MARBLE[1] : MARBLE[2]);
        }
    }
    // Pillars carrying the ring.
    for (const x of [1, 46])
    {
        p.rect(x, 40, 13, 16, MARBLE[2]);
        p.rect(x, 40, 13, 2, MARBLE[0]);
        p.rect(x + 11, 42, 2, 14, MARBLE[3]);
        p.speckle(x, 48, 13, 8, '#4f8a3f', 0.3);
    }
    // Glowing runes around the ring.
    for (let k = 0; k < 9; k++)
    {
        const a = Math.PI * (0.95 + k * 0.14);
        const x = Math.round(cx + Math.cos(a) * 22.5);
        const y = Math.round(cy + Math.sin(a) * 22.5);
        if (y > 42) continue;
        p.set(x, y, FAE_GLOW.light);
        p.set(x, y + 1, FAE_GLOW.mid);
    }
    lights.push({ x: cx, y: cy - 2, color: FAE_GLOW.mid, scale: 1.4, kind: 'rune' });
    // Rubble from the broken section.
    p.shadedBlob(43, 53, 3, 2, MARBLE.slice(1));
}

/** Volcanic rock, lit to shadow. */
const BASALT = ['#6a5752', '#54443f', '#40332f', '#2e2422', '#1f1817'];
/** Lava: crust, deep, hot, bright, white-hot. */
const LAVA = ['#6e240c', '#c2410c', '#ef6a1d', '#ffa63d', '#ffe08a'];

/**
 * 150 x 118: a smoking volcano. A broad basalt cone flaring at the base,
 * a glowing crater, and lava streams running down the front.
 */
function paintVolcano (p: PixelPainter, lights: StructureLight[]): void
{
    const rng = p.rng;
    const H = 118;
    const cx = 75;
    const top = 16;
    const halfAt = (y: number) => {
        const t = (y - top) / (H - 1 - top);
        return 21 + 53 * Math.pow(Math.max(0, t), 1.45);
    };

    // The cone, shaded from the lit left flank to the dark right flank, with gullies.
    for (let y = top; y < H; y++)
    {
        const half = halfAt(y) + (rng() - 0.5) * 1.2;
        for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++)
        {
            const across = (x - cx) / half; // -1 left .. 1 right
            let shade = across < -0.55 ? 0 : across < -0.1 ? 1 : across < 0.45 ? 2 : 3;
            // Gullies: curved darker grooves running down the slope.
            const groove = Math.abs(((x - cx) / half) * 7 + Math.sin(y * 0.09) * 0.6) % 1;
            if (groove < 0.12 && y > top + 6) shade = Math.min(4, shade + 1);
            if (rng() < 0.05) shade = Math.min(4, shade + 1);
            p.set(x, y, BASALT[shade]);
        }
    }

    // Rubble and scree along the foot of the volcano.
    for (let i = 0; i < 26; i++)
    {
        const x = cx + (rng() * 2 - 1) * 72;
        p.shadedBlob(x, H - 2 - rng() * 4, 2 + Math.floor(rng() * 3), 2, BASALT.slice(1));
    }

    // Crater: a lit rim around a pool of lava.
    const craterY = top + 1;
    p.shadedBlob(cx, craterY, 24, 7, [BASALT[0], BASALT[0], BASALT[1], BASALT[2]]);
    for (let dy = -4; dy <= 4; dy++)
    {
        for (let dx = -18; dx <= 18; dx++)
        {
            const n = (dx / 18) ** 2 + (dy / 4.5) ** 2;
            if (n > 1) continue;
            const hot = n < 0.25 ? 4 : n < 0.55 ? 3 : n < 0.85 ? 2 : 1;
            p.set(cx + dx, craterY + dy, LAVA[rng() < 0.12 ? Math.max(1, hot - 1) : hot]);
        }
    }
    lights.push({ x: cx, y: craterY, color: LAVA[3], scale: 2.2, kind: 'lava' });

    // Lava streams spilling over the rim and down the front.
    const streams = [{ x: cx - 9, end: 92 }, { x: cx + 6, end: 108 }, { x: cx + 15, end: 70 }];
    for (const s of streams)
    {
        let x = s.x;
        for (let y = craterY + 4; y < s.end; y++)
        {
            x += (rng() - 0.5) * 1.4 + (x - cx) * 0.012; // fan out as it runs down
            const width = 1 + (y < s.end - 10 ? 1 : 0);
            for (let w = -width; w <= width; w++)
            {
                const core = Math.abs(w) < width;
                p.set(x + w, y, core ? LAVA[rng() < 0.15 ? 4 : 3] : LAVA[rng() < 0.3 ? 0 : 1]);
            }
        }
        // A cooling pool where the stream ends.
        p.shadedBlob(x, s.end, 4, 2, [LAVA[3], LAVA[2], LAVA[1], LAVA[0]]);
        lights.push({ x: Math.round(x), y: s.end, color: LAVA[2], scale: 0.7, kind: 'lava' });
    }

    // Glowing cracks on the flanks.
    for (let i = 0; i < 7; i++)
    {
        const y = top + 20 + rng() * (H - top - 30);
        const half = halfAt(y);
        const x = cx + (rng() * 2 - 1) * half * 0.8;
        p.line(x, y, x + (rng() - 0.5) * 6, y + 3 + rng() * 3, LAVA[1]);
    }
}

/** How many looks each structure type has. */
const VARIANTS: Partial<Record<StructureType, number>> = { house: 3, faeHouse: 3, ashHouse: 3, stiltHut: 3 };

export function createStructureTextures (scene: Scene): void
{
    let seed = 4100;

    for (const type of Object.keys(PAINTERS) as StructureType[])
    {
        for (let variant = 0; variant < (VARIANTS[type] ?? 1); variant++)
        {
            const key = variant === 0 ? `structure-${type}` : `structure-${type}-${variant}`;
            const { width, height } = STRUCTURE_SPECS[type];
            const painter = new PixelPainter(width, height, createRng(seed++));
            const lights: StructureLight[] = [];

            PAINTERS[type](painter, lights, variant);
            painter.outline(Palette.outline);
            painter.toTexture(scene, key);

            // Convert painter pixel coords to offsets from the bottom-centre.
            artByType.set(`${type}:${variant}`, {
                key,
                lights: lights.map((l) => ({ ...l, x: l.x + 0.5 - width / 2, y: l.y + 0.5 - height })),
            });
        }
    }
}

// ---------------------------------------------------------------------------
// The four structures
// ---------------------------------------------------------------------------

/** 48 x 36: stone foundation, dark timber walls, slate roof, torch-lit door. */
function paintBarracks (p: PixelPainter, lights: StructureLight[]): void
{
    const W = Palette.wood;
    const slate = Palette.slate;

    p.slateRoof(1, 2, 46, 12);
    p.rect(2, 1, 44, 1, slate[3]);          // ridge
    p.rect(0, 14, 48, 2, slate[0]);         // overhanging eaves

    p.planks(3, 16, 42, 10);
    p.rect(3, 16, 42, 1, Palette.void);     // shadow under the eaves
    for (const postX of [3, 13, 34, 44]) p.rect(postX, 17, 1, 9, W.dark);

    p.stoneWall(2, 26, 44, 10);

    for (const windowX of [7, 38])
    {
        p.rect(windowX, 19, 3, 4, Palette.void);
        p.rect(windowX + 1, 20, 1, 2, Palette.windowLit);
        lights.push({ x: windowX + 1, y: 21, color: Palette.windowLit, scale: 0.3, kind: 'window' });
    }

    // Door with frame.
    p.rect(20, 21, 8, 1, W.light);
    p.rect(20, 22, 1, 14, W.light);
    p.rect(27, 22, 1, 14, W.light);
    p.rect(21, 22, 6, 14, W.dark);
    p.rect(23, 22, 1, 14, W.mid);
    p.rect(25, 22, 1, 14, W.mid);
    p.set(25, 29, Palette.stone.pale);

    torch(p, lights, 17, 25);
    torch(p, lights, 30, 25);

    p.moss(2, 32, 44, 4, 0.25);
}

/**
 * 22 x 52: a watchtower. Flared stone base with buttresses, a timber upper
 * storey with cross-braces, a railed lookout with a fire brazier, a pointed
 * slate roof with a pennant, a hanging banner, and torches by the door.
 * (Its footprint is unchanged, so towers stand exactly where they did.)
 */
function paintWatchtower (p: PixelPainter, lights: StructureLight[]): void
{
    const W = Palette.wood;
    const slate = Palette.slate;

    // Pennant on a pole above the roof.
    p.rect(11, 0, 1, 4, W.dark);
    p.rect(12, 0, 4, 1, '#a3262c');
    p.rect(12, 1, 3, 1, '#7a1a1f');
    // Pointed slate roof with tile rows and a ridge.
    for (let row = 0; row < 9; row++)
    {
        const rowWidth = 2 + row * 2;
        const startX = 11 - rowWidth / 2;
        for (let i = 0; i < rowWidth; i++)
        {
            const tile = (row % 3 === 2);
            p.set(startX + i, 3 + row, row === 8 ? slate[0] : tile ? slate[0] : i < rowWidth / 2 ? slate[3] : slate[1]);
        }
    }
    for (let row = 4; row < 11; row++) p.set(11, row, slate[2]);

    // Lookout: railed platform with a glowing brazier.
    p.rect(1, 12, 20, 2, W.light);
    p.rect(1, 14, 20, 1, W.dark);
    for (let x = 1; x < 21; x += 3) p.rect(x, 10, 1, 4, W.mid);   // railing posts
    p.rect(1, 10, 20, 1, W.light);                                  // rail
    p.rect(15, 9, 3, 2, Palette.stone.dark);                        // brazier bowl
    p.set(16, 8, Palette.flame[0]);
    p.set(16, 7, Palette.flame[1]);
    lights.push({ x: 16, y: 7, color: Palette.accent.amber, scale: 0.6, kind: 'torch' });

    // Timber upper storey with cross-braces and a lit window.
    p.planks(5, 15, 12, 17);
    p.rect(5, 15, 12, 1, Palette.void);
    p.line(5, 16, 16, 30, W.dark);
    p.line(16, 16, 5, 30, W.dark);
    p.rect(5, 31, 12, 1, W.dark);
    p.rect(9, 19, 4, 5, Palette.void);
    p.rect(10, 20, 2, 3, Palette.windowLit);
    lights.push({ x: 10.5, y: 21, color: Palette.windowLit, scale: 0.4, kind: 'window' });
    // Banner hanging below the lookout.
    p.rect(4, 15, 1, 9, '#a3262c');
    p.rect(3, 23, 3, 1, Palette.commander.gold);

    // Stone base flaring out, with buttresses and an arrow slit.
    p.stoneWall(4, 32, 14, 20);
    p.stoneWall(2, 46, 18, 6);
    p.stoneWall(2, 40, 2, 12);
    p.stoneWall(18, 40, 2, 12);
    p.rect(10, 35, 1, 4, Palette.void);

    // Arched door with torches either side.
    p.rect(9, 44, 4, 8, Palette.void);
    p.rect(10, 43, 2, 1, Palette.void);
    p.rect(10, 46, 2, 6, W.dark);
    torch(p, lights, 6, 42);
    torch(p, lights, 15, 42);

    p.moss(2, 46, 18, 6, 0.3);
}

/**
 * 72 x 28: a broken defensive wall with a ruined tower stump and a glowing
 * rune. The collapsed breaches come from the structure's `solidSpans`, so the
 * gaps you see are exactly the gaps you can walk through.
 */
function paintFortification (p: PixelPainter, lights: StructureLight[]): void
{
    const rng = p.rng;
    const S = Palette.stone;
    const { width, height: bottom, solidSpans = [] } = STRUCTURE_SPECS.fortification;
    const isSolid = (x: number) => solidSpans.some((span) => x >= span.from && x < span.to);

    // Height of the wall in each column, with a jagged, crumbling top.
    const heights: number[] = [];
    let current = 16;
    for (let x = 0; x < width; x++)
    {
        if (x % 3 === 0) current = 14 + Math.floor(rng() * 4);
        heights.push(isSolid(x) ? current : 1 + Math.floor(rng() * 3)); // low rubble in the breaches
    }

    // Ruined tower stump on the left, with leftover battlements.
    for (let x = 2; x <= 13; x++)
    {
        heights[x] = 22 + (x % 4 < 2 ? 3 : 0) - (rng() < 0.3 ? 2 : 0);
    }

    for (let x = 0; x < width; x++)
    {
        const height = heights[x];
        const top = bottom - height;

        if (height <= 6)
        {
            // Rubble scattered across the breach.
            for (let y = top; y < bottom; y++)
            {
                if (rng() < 0.75) p.set(x, y, rng() < 0.5 ? S.mid : S.dark);
            }
            continue;
        }

        p.stoneTop(x, top, 1, 2);
        p.stoneWall(x, top + 2, 1, height - 2);
    }

    p.rect(7, 9, 1, 4, Palette.void);       // arrow slit in the tower stump

    rune(p, 42, 16, Palette.accent.purple);
    lights.push({ x: 43, y: 18, color: Palette.accent.purple, scale: 0.6, kind: 'rune' });

    p.moss(0, 18, width, 10, 0.2);
}

/** 80 x 64: walled stone keep with corner towers, a central tower and a gate. */
function paintKeep (p: PixelPainter, lights: StructureLight[]): void
{
    const S = Palette.stone;

    // Back wall.
    p.crenellations(8, 6, 64);
    p.stoneTop(8, 9, 64, 3);
    p.stoneWall(8, 12, 64, 14);

    // Side wall-walks, seen from above.
    p.stoneTop(6, 9, 6, 38);
    p.stoneTop(68, 9, 6, 38);
    for (let y = 10; y < 46; y += 4)
    {
        p.rect(6, y, 2, 2, S.pale);
        p.rect(72, y, 2, 2, S.pale);
    }
    p.rect(11, 12, 1, 35, S.dark);
    p.rect(68, 12, 1, 35, S.dark);

    // Courtyard.
    p.rect(12, 26, 56, 21, Palette.courtyard);
    p.speckle(12, 26, 56, 21, Palette.dirt[0], 0.15);

    // Central tower.
    p.crenellations(28, 0, 24);
    p.stoneTop(28, 3, 24, 5);
    p.stoneWall(28, 8, 24, 26);
    p.rect(28, 34, 24, 2, Palette.dirt[0]); // shadow on the courtyard
    for (const windowX of [32, 46])
    {
        p.rect(windowX, 12, 2, 4, Palette.void);
        p.rect(windowX, 13, 2, 2, Palette.windowLit);
        lights.push({ x: windowX + 0.5, y: 14, color: Palette.windowLit, scale: 0.35, kind: 'window' });
    }
    rune(p, 39, 20, Palette.accent.green);
    lights.push({ x: 40, y: 22, color: Palette.accent.green, scale: 0.6, kind: 'rune' });
    p.rect(37, 28, 6, 6, Palette.void);

    // Front corner towers.
    for (const towerX of [0, 64])
    {
        p.crenellations(towerX, 31, 16);
        p.stoneTop(towerX, 34, 16, 5);
        p.stoneWall(towerX, 39, 16, 25);
        p.rect(towerX + 7, 44, 1, 5, Palette.void);
    }

    // Front wall.
    p.crenellations(16, 41, 48);
    p.stoneTop(16, 44, 48, 3);
    p.stoneWall(16, 47, 48, 17);

    // Gate with portcullis.
    p.rect(34, 52, 12, 12, Palette.void);
    p.rect(35, 51, 10, 1, Palette.void);
    p.rect(36, 50, 8, 1, Palette.void);
    for (let x = 35; x < 46; x += 2) p.rect(x, 51, 1, 13, S.dark);
    p.rect(34, 55, 12, 1, S.dark);
    p.rect(34, 59, 12, 1, S.dark);

    torch(p, lights, 31, 53);
    torch(p, lights, 48, 53);

    p.moss(0, 58, 80, 6, 0.25);
}

/** Roof colours for village houses: red clay, golden thatch, blue slate (dark to light). */
const ROOFS: readonly (readonly string[])[] = [
    ['#4f1f18', '#7a3324', '#9c4630', '#bf6444'],
    ['#5e4720', '#86682f', '#a98a42', '#cdae62'],
    ['#232c45', '#33416a', '#46598c', '#5f76ad'],
];
const PLASTER = { light: '#e6d8b4', mid: '#d2c196', dark: '#b7a57a' };

/** 30 x 30: a timber-framed cottage with a pitched roof, chimney, lit windows and a door. */
function paintHouse (p: PixelPainter, lights: StructureLight[], variant: number): void
{
    const W = Palette.wood;
    const roof = ROOFS[variant % ROOFS.length];

    // Chimney behind the roof.
    p.stoneWall(21, 0, 4, 6);

    // Pitched roof seen from the front: rows of tiles, lighter toward the ridge.
    for (let y = 2; y < 15; y++)
    {
        const inset = Math.max(0, 3 - Math.floor((y - 2) / 2));
        for (let x = inset; x < 30 - inset; x++)
        {
            const tier = Math.floor((y - 2) / 3);
            const edge = (x + (tier % 2) * 2) % 4 === 0;
            let c = (y - 2) % 3 === 2 ? roof[0] : edge ? roof[1] : y < 6 ? roof[3] : roof[2];
            if (p.rng() < 0.04) c = roof[1];
            p.set(x, y, c);
        }
    }
    p.rect(3, 2, 24, 1, roof[3]);          // ridge highlight
    p.rect(0, 14, 30, 1, roof[0]);         // eaves

    // Plaster walls with dark timber framing.
    for (let y = 15; y < 28; y++)
    {
        for (let x = 2; x < 28; x++)
        {
            const r = p.rng();
            p.set(x, y, r < 0.1 ? PLASTER.dark : r < 0.3 ? PLASTER.mid : PLASTER.light);
        }
    }
    p.rect(2, 15, 26, 1, Palette.void);    // shadow under the eaves
    for (const bx of [2, 14, 27]) p.rect(bx, 16, 1, 12, W.dark);
    p.rect(2, 21, 26, 1, W.dark);
    p.line(3, 16, 13, 21, W.mid);          // diagonal brace
    p.stoneWall(1, 27, 28, 3);             // stone footing

    // Door and windows.
    p.rect(17, 20, 6, 10, W.dark);
    p.rect(18, 21, 4, 9, W.mid);
    p.set(21, 25, Palette.commander.gold);
    // A lit window left of the door, and a small one below it.
    p.rect(5, 17, 5, 4, Palette.void);
    p.rect(6, 18, 3, 2, Palette.windowLit);
    lights.push({ x: 7, y: 19, color: Palette.windowLit, scale: 0.28, kind: 'window' });
    p.rect(8, 23, 4, 3, Palette.void);
    p.rect(9, 24, 2, 1, Palette.windowLit);
    // Flower box under the window.
    p.rect(5, 21, 5, 1, W.light);
    p.set(6, 20, '#d8432f'); p.set(8, 20, '#e0c23a');
}

/**
 * 128 x 100: a great castle. Blue-roofed round towers at the front corners, a
 * crenellated curtain wall with a gatehouse and hanging banners, and a tall
 * keep rising behind. A landmark you can spot across the map.
 */
function paintCastle (p: PixelPainter, lights: StructureLight[]): void
{
    const S = Palette.stone;
    const roof = ['#1f2a44', '#2e3d63', '#405485', '#5b72aa'];
    const banner = { main: '#b8911f', dark: '#755c12', mark: '#8a2228' };

    // Back wall.
    p.crenellations(12, 24, 104);
    p.stoneTop(12, 27, 104, 3);
    p.stoneWall(12, 30, 104, 16);

    // Side wall-walks.
    p.stoneTop(8, 27, 8, 44);
    p.stoneTop(112, 27, 8, 44);
    p.rect(15, 30, 1, 41, S.dark);
    p.rect(112, 30, 1, 41, S.dark);

    // Courtyard.
    p.rect(16, 46, 96, 25, Palette.courtyard);
    p.speckle(16, 46, 96, 25, Palette.dirt[0], 0.15);

    // The keep, rising behind the courtyard.
    p.crenellations(44, 4, 40);
    p.stoneTop(44, 7, 40, 6);
    p.stoneWall(44, 13, 40, 44);
    p.rect(44, 57, 40, 2, Palette.dirt[0]);
    for (const wx of [50, 62, 74])
    {
        p.rect(wx, 20, 3, 6, Palette.void);
        p.rect(wx, 21, 3, 4, Palette.windowLit);
        lights.push({ x: wx + 1, y: 23, color: Palette.windowLit, scale: 0.35, kind: 'window' });
    }
    p.rect(60, 44, 8, 13, Palette.void);
    // Banner poles on the keep roof.
    for (const bx of [48, 79])
    {
        p.rect(bx, 0, 1, 8, Palette.wood.dark);
        p.rect(bx + 1, 0, 5, 3, banner.main);
        p.rect(bx + 1, 3, 3, 1, banner.dark);
    }

    // Front corner towers with conical blue roofs.
    for (const tx of [0, 104])
    {
        // Cone roof (rows 30..47).
        for (let row = 0; row < 18; row++)
        {
            const w = 2 + Math.round((row / 17) * 22);
            const sx = tx + 12 - Math.floor(w / 2);
            for (let i = 0; i < w; i++)
            {
                const c = row === 17 ? roof[0] : i < w / 3 ? roof[3] : i < (2 * w) / 3 ? roof[2] : roof[1];
                p.set(sx + i, 30 + row, c);
            }
        }
        p.rect(tx + 12, 26, 1, 4, Palette.wood.dark);        // spire
        p.rect(tx + 13, 26, 4, 2, banner.mark);
        p.stoneWall(tx, 48, 24, 52);
        p.rect(tx + 11, 58, 2, 6, Palette.void);             // arrow slits
        p.rect(tx + 11, 76, 2, 6, Palette.void);
    }

    // Front curtain wall.
    p.crenellations(24, 62, 80);
    p.stoneTop(24, 65, 80, 3);
    p.stoneWall(24, 68, 80, 32);

    // Hanging banners.
    for (const bx of [32, 90])
    {
        p.rect(bx, 70, 7, 14, banner.main);
        p.rect(bx + 6, 70, 1, 14, banner.dark);
        p.rect(bx + 2, 74, 3, 4, banner.mark);
        p.set(bx, 84, banner.main); p.set(bx + 6, 84, banner.dark); p.set(bx + 3, 85, banner.main);
    }

    // Gatehouse with portcullis.
    p.rect(52, 78, 24, 22, Palette.void);
    p.rect(54, 76, 20, 2, Palette.void);
    p.rect(57, 75, 14, 1, Palette.void);
    for (let x = 54; x < 76; x += 3) p.rect(x, 77, 1, 23, S.dark);
    for (const y of [82, 88, 94]) p.rect(52, y, 24, 1, S.dark);

    torch(p, lights, 48, 82);
    torch(p, lights, 79, 82);
    torch(p, lights, 6, 66);
    torch(p, lights, 121, 66);

    p.moss(0, 92, 128, 8, 0.22);
}

/** A wall-mounted torch: wooden handle and a 2-pixel flame. */
function torch (p: PixelPainter, lights: StructureLight[], x: number, y: number): void
{
    p.rect(x, y + 1, 1, 3, Palette.wood.dark);
    p.set(x, y, Palette.flame[0]);
    p.set(x, y - 1, Palette.flame[1]);
    lights.push({ x, y: y - 1, color: Palette.accent.amber, scale: 0.55, kind: 'torch' });
}

/** A small carved rune glyph (3 x 5). */
function rune (p: PixelPainter, x: number, y: number, color: string): void
{
    const glyph = ['.#.', '###', '.#.', '#.#', '.#.'];
    glyph.forEach((row, dy) => {
        for (let dx = 0; dx < row.length; dx++)
        {
            if (row[dx] === '#') p.set(x + dx, y + dy, color);
        }
    });
}
