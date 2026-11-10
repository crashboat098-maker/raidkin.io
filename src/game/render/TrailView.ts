import { Scene } from 'phaser';
import type { BattlefieldLayout } from '../logic/BattlefieldLayout';
import type { Bridge } from '../logic/Bridges';
import { isLavaSurface } from '../logic/LavaRivers';
import type { Trail } from '../logic/Trails';
import { Palette } from './Palette';
import { hash2 } from './PixelPainter';

/**
 * Paints all trails once into a single transparent image laid over the
 * ground: worn dirt paths with ragged edges, and old cobblestone roads with
 * missing stones and moss. One image = very cheap to draw every frame.
 */

const TEXTURE_KEY = 'trails';

export function addTrails (scene: Scene, layout: BattlefieldLayout, depth: number): void
{
    const { worldWidth: width, worldHeight: height } = layout;

    if (!scene.textures.exists(TEXTURE_KEY))
    {
        const texture = scene.textures.createCanvas(TEXTURE_KEY, width, height);
        if (!texture) return;

        const ctx = texture.getContext();
        const image = ctx.createImageData(width, height);
        // Roads are never painted over molten lava: they stop at the bank, where the
        // stone bridges (drawn as their own structures, see LavaBridgeView) take over.
        const overLava = (x: number, y: number) => isLavaSurface(layout.lava, x, y);
        for (const trail of layout.trails) paintTrail(image.data, width, height, trail, overLava);
        for (const bridge of layout.bridges) if (!bridge.edgeOnly) paintBridge(image.data, width, height, bridge);
        ctx.putImageData(image, 0, 0);
        texture.refresh();
    }

    scene.add.image(0, 0, TEXTURE_KEY).setOrigin(0, 0).setDepth(depth);
}

function paintTrail (data: Uint8ClampedArray, width: number, height: number, trail: Trail, skip: (x: number, y: number) => boolean): void
{
    const radius = trail.width / 2;
    const pixelColor = trail.kind === 'stone' ? cobblePixel : dirtPixel;

    for (let i = 0; i < trail.points.length - 1; i++)
    {
        const a = trail.points[i];
        const b = trail.points[i + 1];
        const minX = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - 2));
        const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + radius + 2));
        const minY = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - 2));
        const maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + radius + 2));

        for (let y = minY; y <= maxY; y++)
        {
            for (let x = minX; x <= maxX; x++)
            {
                // Ragged edge: the radius wobbles a little from pixel to pixel.
                const edgeNoise = ((hash2(x >> 1, y >> 1) % 100) / 100 - 0.5) * 2;
                const reach = radius + edgeNoise;
                const distance = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
                if (distance > reach || skip(x, y)) continue;

                const color = pixelColor(x, y, distance > reach - 1.5);
                if (color) writePixel(data, width, x, y, color);
            }
        }
    }
}

/** Packed earth: mostly mid-brown, darker and patchy at the edges. */
function dirtPixel (x: number, y: number, isEdge: boolean): string | null
{
    const roll = hash2(x * 7 + 3, y * 13 + 1) % 100;
    if (isEdge) return roll < 40 ? null : Palette.trail[0];
    if (roll < 2) return Palette.stone.mid;
    if (roll < 25) return Palette.trail[0];
    if (roll < 82) return Palette.trail[1];
    return Palette.trail[2];
}

/** Old cobbles in staggered rows, some missing, some mossy. */
function cobblePixel (x: number, y: number, isEdge: boolean): string | null
{
    const S = Palette.stone;
    const roll = hash2(x * 5 + 11, y * 3 + 7) % 100;
    if (isEdge && roll < 45) return null;

    const row = Math.floor(y / 4);
    const shift = (row % 2) * 3;
    const col = Math.floor((x + shift) / 6);
    const stone = hash2(col + 101, row + 37);

    if (stone % 9 === 0) return Palette.trail[0];                 // missing cobble
    if (y % 4 === 3 || (x + shift) % 6 === 5) return Palette.dirt[0]; // gaps between stones
    if (roll < 6) return S.moss;

    const shades = [S.mid, S.light, '#4d5156', S.mid];
    const shade = shades[stone % shades.length];
    return y % 4 === 0 && shade === S.mid ? S.light : shade;
}

/**
 * A bridge where a trail crosses water: wooden planks laid across the path
 * with rails and posts, or an old stone bridge with low parapets. Drawn
 * with a soft shadow on the water below.
 */
function paintBridge (data: Uint8ClampedArray, width: number, height: number, bridge: Bridge): void
{
    const half = bridge.width / 2;
    const pts = bridge.points;
    // Cumulative length at each point, so planks run evenly along curved bridges.
    const along: number[] = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));

    const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x)) - half - 4));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(...pts.map((p) => p.x)) + half + 4));
    const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y)) - half - 4));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(...pts.map((p) => p.y)) + half + 5));

    for (let y = minY; y <= maxY; y++)
    {
        for (let x = minX; x <= maxX; x++)
        {
            // Nearest point on the centre line: how far along, and how far across (signed).
            let best = Infinity;
            let s = 0;
            let across = 0;
            for (let i = 0; i < pts.length - 1; i++)
            {
                const a = pts[i];
                const b = pts[i + 1];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len2 = dx * dx + dy * dy || 1;
                const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
                const qx = a.x + dx * t;
                const qy = a.y + dy * t;
                const d = Math.hypot(x - qx, y - qy);
                if (d < best)
                {
                    best = d;
                    s = along[i] + t * Math.sqrt(len2);
                    across = ((x - a.x) * dy - (y - a.y) * dx) / Math.sqrt(len2);
                }
            }

            const total = along[along.length - 1];
            if (best <= half)
            {
                const color = bridge.kind === 'wood' ? woodDeck(s, across, half, total) : stoneDeck(x, y, s, across, half, total);
                writePixel(data, width, x, y, color);
            }
            else if (best <= half + 3 && s > 1 && s < total - 1)
            {
                // Shadow cast on the water just below the bridge.
                const i = (y * width + x) * 4;
                if (y > 0 && data[i + 3] === 0 && data[((y - 1) * width + x) * 4 + 3] === 255) writePixel(data, width, x, y, '#1e3b4a', 110);
            }
        }
    }
}

function woodDeck (s: number, across: number, half: number, total: number): string
{
    const W = Palette.wood;
    const edge = Math.abs(across) > half - 1.5;
    // Posts at the ends and every ~12 px along the rails.
    const post = edge && (s < 2 || s > total - 2 || Math.round(s) % 12 === 0);
    if (post) return W.dark;
    if (edge) return '#6b5238';                                   // rail
    const plank = Math.floor(s / 3);
    if (Math.round(s) % 3 === 0) return '#4a3726';                // gap between planks
    const shades = ['#8a6a46', '#7d5f3e', '#957450', '#836442'];
    return shades[hash2(plank, Math.round(across) > 0 ? 1 : 0) % shades.length];
}

function stoneDeck (x: number, y: number, s: number, across: number, half: number, total: number): string
{
    const S = Palette.stone;
    const edge = Math.abs(across) > half - 2;
    if (edge) return Math.round(s) % 5 === 0 ? S.mid : S.pale; // parapet blocks
    if (s < 1.5 || s > total - 1.5) return S.mid;
    return cobblePixel(x, y, false) ?? S.light;
}

function distanceToSegment (px: number, py: number, ax: number, ay: number, bx: number, by: number): number
{
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

const rgbCache = new Map<string, [number, number, number]>();

function writePixel (data: Uint8ClampedArray, width: number, x: number, y: number, hex: string, alpha = 255): void
{
    let rgb = rgbCache.get(hex);
    if (!rgb)
    {
        const value = parseInt(hex.slice(1), 16);
        rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
        rgbCache.set(hex, rgb);
    }
    const i = (y * width + x) * 4;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = alpha;
}
