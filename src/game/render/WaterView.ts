import { Scene } from 'phaser';
import type { WaterLayout } from '../logic/Water';
import { hexToInt } from './Palette';
import { Tex } from './PlaceholderArt';

/**
 * Draws rivers, streams and ponds from the same water grid the game rules
 * use, so what you see is exactly where you slow down. Painted once into a
 * single image (cheap to draw every frame), with a light foamy shore, a
 * shallow band, deeper water in the middle, and a few twinkling glints.
 */

const TEXTURE_KEY = 'water-overlay';

/** Shore to middle. Daytime blues, slightly muted to fit the world. */
const SHADES = ['#d3ece6', '#8fcad0', '#6ab4c6', '#4f9fbd', '#3f8db0'];
const HIGHLIGHT = '#a9dbe4';
/** Swamp water: murky green-brown, shore to middle, with a dull scum highlight. */
const MURK = ['#5e6a44', '#4a5636', '#3c482e', '#334028', '#2b3722'];
const MURK_HIGHLIGHT = '#6e7c4e';

/** `murkAt` (0..1): how swampy the water is at a spot; murky water blends toward swamp colours. */
export function addWater (scene: Scene, water: WaterLayout, worldWidth: number, worldHeight: number, depth: number, murkAt?: (x: number, y: number) => number): void
{
    if (!scene.textures.exists(TEXTURE_KEY))
    {
        const texture = scene.textures.createCanvas(TEXTURE_KEY, worldWidth, worldHeight);
        if (!texture) return;
        const ctx = texture.getContext();
        const image = ctx.createImageData(worldWidth, worldHeight);
        paint(image.data, water, worldWidth, worldHeight, murkAt);
        ctx.putImageData(image, 0, 0);
        texture.refresh();
    }
    scene.add.image(0, 0, TEXTURE_KEY).setOrigin(0, 0).setDepth(depth);
    addGlints(scene, water, depth + 0.1, murkAt);
}

function paint (data: Uint8ClampedArray, water: WaterLayout, width: number, height: number, murkAt?: (x: number, y: number) => number): void
{
    const { cols, rows, cell, mask } = water;

    // How far each water cell is from the shore (in cells, capped).
    const distance = new Uint8Array(cols * rows);
    const queue: number[] = [];
    for (let i = 0; i < mask.length; i++)
    {
        if (!mask[i]) continue;
        const c = i % cols;
        const r = (i - c) / cols;
        const shore = c === 0 || r === 0 || c === cols - 1 || r === rows - 1 ||
            !mask[i - 1] || !mask[i + 1] || !mask[i - cols] || !mask[i + cols];
        if (shore) { distance[i] = 1; queue.push(i); }
    }
    for (let head = 0; head < queue.length; head++)
    {
        const i = queue[head];
        if (distance[i] >= SHADES.length) continue;
        for (const n of [i - 1, i + 1, i - cols, i + cols])
        {
            if (n < 0 || n >= mask.length || !mask[n] || distance[n]) continue;
            distance[n] = distance[i] + 1;
            queue.push(n);
        }
    }

    const rgb = SHADES.map(toRgb);
    const highlight = toRgb(HIGHLIGHT);
    const murk = MURK.map(toRgb);
    const murkHighlight = toRgb(MURK_HIGHLIGHT);
    const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
        [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let i = 0; i < mask.length; i++)
    {
        if (!mask[i]) continue;
        const c = i % cols;
        const r = (i - c) / cols;
        const d = Math.min(distance[i] || SHADES.length, SHADES.length);
        const m = murkAt ? Math.min(1, murkAt(c * cell, r * cell) * 1.6) : 0;
        if (m > 0)
        {
            // Murky swamp water: no bright waves, just dull streaks of scum.
            const base = mix(rgb[d - 1], murk[d - 1], m);
            const scum = mix(highlight, murkHighlight, m);
            for (let dy = 0; dy < cell; dy++)
            {
                for (let dx = 0; dx < cell; dx++)
                {
                    const x = c * cell + dx;
                    const y = r * cell + dy;
                    if (x >= width || y >= height) continue;
                    const streak = d >= 3 && ((x * 3 + y * 7) % 41 < 2) && y % 4 === 0;
                    const color = streak ? scum : base;
                    const o = (y * width + x) * 4;
                    data[o] = color[0]; data[o + 1] = color[1]; data[o + 2] = color[2]; data[o + 3] = 255;
                }
            }
            continue;
        }
        for (let dy = 0; dy < cell; dy++)
        {
            for (let dx = 0; dx < cell; dx++)
            {
                const x = c * cell + dx;
                const y = r * cell + dy;
                if (x >= width || y >= height) continue;
                // Little horizontal wave lines on open water.
                const wave = d >= 3 && ((x + Math.floor(y / 6) * 5) % 23 < 3) && y % 6 === 0;
                const color = wave ? highlight : rgb[d - 1];
                const o = (y * width + x) * 4;
                data[o] = color[0]; data[o + 1] = color[1]; data[o + 2] = color[2]; data[o + 3] = 255;
            }
        }
    }
}

/** A few small glints that twinkle on open water. */
function addGlints (scene: Scene, water: WaterLayout, depth: number, murkAt?: (x: number, y: number) => number): void
{
    const { cols, mask, cell } = water;
    const candidates: number[] = [];
    // (Murky swamp water doesn't sparkle.)
    for (let i = 0; i < mask.length; i += 7) if (mask[i] && !(murkAt && murkAt((i % cols) * cell, Math.floor(i / cols) * cell) > 0.3)) candidates.push(i);
    const count = Math.min(90, Math.floor(candidates.length / 120));
    for (let k = 0; k < count; k++)
    {
        const i = candidates[Math.floor(Math.random() * candidates.length)];
        const x = (i % cols) * cell;
        const y = Math.floor(i / cols) * cell;
        const glint = scene.add.image(x, y, Tex.FxGlint).setDepth(depth).setAlpha(0).setTint(hexToInt('#ffffff'));
        scene.tweens.add({
            targets: glint, alpha: { from: 0, to: 0.85 }, duration: 600 + Math.random() * 900,
            delay: Math.random() * 3000, yoyo: true, repeat: -1, repeatDelay: 800 + Math.random() * 2500,
        });
    }
}

function toRgb (hex: string): [number, number, number]
{
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
