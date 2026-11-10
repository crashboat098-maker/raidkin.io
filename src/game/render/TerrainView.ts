import { BlendModes, Scene } from 'phaser';
import type { BattlefieldLayout } from '../logic/BattlefieldLayout';
import { swampAt, type BiomeMap } from '../logic/Biomes';
import { volcanoInfluence, type VolcanoLayout } from '../logic/Volcano';
import type { WaterLayout } from '../logic/Water';
import { addGlow } from './Glow';
import { hexToInt } from './Palette';
import { hash2 } from './PixelPainter';
import { Tex } from './PlaceholderArt';

/**
 * Ground detail painted once into a single image, between the ground tiles
 * and the water:
 *  - sandy, pebbly banks along rivers and ponds (wider in some places),
 *  - the volcano biome's soft scorched edge, drifting ash, glowing fissures
 *    and lava pools.
 * Plus a few cheap animated touches: lava glows, smoke and rising embers.
 */

const TEXTURE_KEY = 'terrain-overlay';

const SAND = { wet: '#a9966c', mid: '#cdb98a', light: '#dfcd9e', pebble: '#8f8466', pebbleLight: '#b7ae94' };
/** Grey gravel for rocky stretches of shore. */
const GRAVEL = { wet: '#6b6a62', light: '#b3afa2', mid: '#918d82', dark: '#6f6c64', stone: '#55524c' };
const MUD = { wet: '#2e281c', mid: '#4a3f2c', light: '#56492f', moss: '#4f6a32' };
const ASH = { light: '#8c8580', speck: '#6e6763', soot: '#2c2523', scorch: '#3d3527' };
const LAVA = { rim: '#2a1d1a', crust: '#6e240c', deep: '#c2410c', hot: '#ef6a1d', bright: '#ffa63d', white: '#ffe08a' };

export function addTerrain (scene: Scene, layout: BattlefieldLayout, depth: number): void
{
    const { worldWidth: width, worldHeight: height } = layout;

    if (!scene.textures.exists(TEXTURE_KEY))
    {
        const texture = scene.textures.createCanvas(TEXTURE_KEY, width, height);
        if (!texture) return;
        const ctx = texture.getContext();
        const image = ctx.createImageData(width, height);
        paintBanks(image.data, width, height, layout.water, layout.volcano, layout.biomes);
        if (layout.volcano) paintVolcanoGround(image.data, width, height, layout.volcano);
        ctx.putImageData(image, 0, 0);
        texture.refresh();
    }
    scene.add.image(0, 0, TEXTURE_KEY).setOrigin(0, 0).setDepth(depth);

    if (layout.volcano) addVolcanoLife(scene, layout);
}

// ---------------------------------------------------------------------------
// Sandy banks
// ---------------------------------------------------------------------------

/** Max bank width (world px). */
const BANK_MAX = 22;

function paintBanks (data: Uint8ClampedArray, width: number, height: number, water: WaterLayout, volcano: VolcanoLayout | null, biomes: BiomeMap | null): void
{
    const { cols, rows, cell, mask } = water;
    // Distance (in cells) from each land cell to the nearest water, up to BANK_MAX.
    const maxCells = Math.ceil(BANK_MAX / cell);
    const distance = new Uint8Array(cols * rows);
    let frontier: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) frontier.push(i);
    for (let step = 1; step <= maxCells && frontier.length; step++)
    {
        const next: number[] = [];
        for (const i of frontier)
        {
            const c = i % cols;
            for (const n of [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, i - cols, i + cols])
            {
                if (n < 0 || n >= mask.length || mask[n] || distance[n]) continue;
                distance[n] = step;
                next.push(n);
            }
        }
        frontier = next;
    }

    for (let i = 0; i < distance.length; i++)
    {
        const d = distance[i];
        if (!d) continue;
        const c = i % cols;
        const r = (i - c) / cols;
        for (let dy = 0; dy < cell; dy++)
        {
            for (let dx = 0; dx < cell; dx++)
            {
                const x = c * cell + dx;
                const y = r * cell + dy;
                if (x >= width || y >= height) continue;
                if (volcanoInfluence(volcano, x, y) > 0.3) continue;
                // Bank width varies along the shore: grassy edges in places, wide beaches in others.
                const wave = (Math.sin(x * 0.021 + 1.7) + Math.sin(y * 0.017 + 0.3) + Math.sin((x - y) * 0.013 + 2.1)) / 3;
                const ripple = Math.sin(x * 0.09 + y * 0.05) * 0.5 + Math.sin(y * 0.11 - x * 0.03) * 0.5;
                const reach = 2 + Math.max(0, wave + 0.3) * 13 + ripple * 2.5;
                const px = d * cell - cell / 2;
                if (px > reach + 3) continue;
                const roll = hash2(x * 3 + 17, y * 5 + 11) % 100;
                // Gravel and rocky stretches instead of sand along some reaches.
                const rocky = Math.sin(x * 0.013 - 0.7) + Math.sin(y * 0.016 + 1.9) > 1.1;
                // A soft, dithered edge into the grass, thinning outwards.
                if (px > reach - 3)
                {
                    const fade = (px - (reach - 3)) / 6; // 0 .. 1
                    if (roll < 40 + fade * 55) continue;
                }
                let color: string;
                // Swamp shores are dark mud with moss, never sand.
                if (biomes && swampAt(biomes, x, y) > 0.4)
                {
                    color = px <= 2 ? MUD.wet : roll < 12 ? MUD.moss : px <= reach * 0.5 ? MUD.mid : roll < 50 ? MUD.light : MUD.mid;
                    write(data, width, x, y, color);
                    continue;
                }
                if (px <= 2) color = rocky ? GRAVEL.wet : SAND.wet;         // wet line at the water
                else if (rocky)
                {
                    const stone = hash2(Math.floor(x / 2) + 7, Math.floor(y / 2) + 3) % 100;
                    color = stone < 18 ? GRAVEL.light : stone < 55 ? GRAVEL.mid : stone < 85 ? GRAVEL.dark : GRAVEL.stone;
                }
                else color = px <= reach * 0.4 ? SAND.mid : roll < 45 ? SAND.light : SAND.mid;
                if (!rocky && roll > 95) color = SAND.pebble;
                else if (!rocky && roll > 92) color = SAND.pebbleLight;
                else if (px > reach - 1 && roll % 7 === 0) color = '#5a7840';   // grass blades creeping in
                write(data, width, x, y, color);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Volcano ground
// ---------------------------------------------------------------------------

function paintVolcanoGround (data: Uint8ClampedArray, width: number, height: number, v: VolcanoLayout): void
{
    const r = v.radius + 90;
    const x0 = Math.max(0, Math.floor(v.center.x - r));
    const x1 = Math.min(width - 1, Math.ceil(v.center.x + r));
    const y0 = Math.max(0, Math.floor(v.center.y - r));
    const y1 = Math.min(height - 1, Math.ceil(v.center.y + r));

    // Ash drift and a dithered scorch edge (softens the ground tiles' steps).
    for (let y = y0; y <= y1; y++)
    {
        for (let x = x0; x <= x1; x++)
        {
            const heat = volcanoInfluence(v, x, y);
            if (heat <= 0) continue;
            const roll = hash2(x * 7 + 3, y * 11 + 5) % 1000;
            if (heat < 0.5)
            {
                if (roll < heat * 260) write(data, width, x, y, roll % 3 === 0 ? ASH.soot : ASH.scorch);
            }
            else if (roll < 14) write(data, width, x, y, ASH.light);
            else if (roll < 24) write(data, width, x, y, ASH.speck);
        }
    }

    // Glowing fissures: a dark rim, an orange edge, a bright core.
    for (const crack of v.fissures)
    {
        for (let i = 0; i < crack.length - 1; i++)
        {
            const a = crack[i];
            const b = crack[i + 1];
            const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
            const thick = i < crack.length / 2 ? 1 : 0; // cracks taper toward their ends
            for (let s = 0; s <= steps; s++)
            {
                const x = Math.round(a.x + ((b.x - a.x) * s) / steps);
                const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
                for (let oy = -thick - 1; oy <= thick + 1; oy++)
                {
                    for (let ox = -thick - 1; ox <= thick + 1; ox++)
                    {
                        const edge = Math.max(Math.abs(ox), Math.abs(oy));
                        const color = edge > thick ? LAVA.rim : edge === thick && thick > 0 ? LAVA.deep : LAVA.bright;
                        if (edge > thick && readAlpha(data, width, x + ox, y + oy) && !isRim(data, width, x + ox, y + oy)) continue;
                        write(data, width, x + ox, y + oy, color);
                    }
                }
            }
        }
    }

    // Lava pools: a dark crusted rim around glowing, swirling lava.
    for (const pool of v.pools)
    {
        for (let y = Math.floor(pool.y - pool.ry - 3); y <= pool.y + pool.ry + 3; y++)
        {
            for (let x = Math.floor(pool.x - pool.rx - 3); x <= pool.x + pool.rx + 3; x++)
            {
                const wobble = 1 + 0.08 * Math.sin(Math.atan2(y - pool.y, x - pool.x) * 5 + pool.x);
                const n = Math.hypot((x - pool.x) / (pool.rx * wobble), (y - pool.y) / (pool.ry * wobble));
                if (n > 1.25) continue;
                const roll = hash2(x * 13 + 7, y * 17 + 3) % 100;
                let color: string;
                if (n > 1.0) color = roll < 40 ? ASH.soot : LAVA.rim;
                else if (n > 0.85) color = LAVA.crust;
                else
                {
                    const swirl = Math.sin(x * 0.45 + y * 0.8) + Math.sin(x * 0.2 - y * 0.6);
                    color = n < 0.35 && roll < 30 ? LAVA.white : swirl > 1.1 ? LAVA.bright : swirl < -1.2 ? LAVA.crust : n > 0.65 ? LAVA.deep : LAVA.hot;
                }
                write(data, width, x, y, color);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Animated touches (cheap: a few dozen sprites with looping tweens)
// ---------------------------------------------------------------------------

function addVolcanoLife (scene: Scene, layout: BattlefieldLayout): void
{
    const v = layout.volcano!;
    const cone = v.cone;
    const craterX = cone.x;
    const craterY = cone.y - 101;
    const high = 950_000; // smoke and embers float above everything in the world

    for (const pool of v.pools)
    {
        addGlow(scene, pool.x, pool.y, LAVA.hot, { scale: (pool.rx / 16) * 1.3, depth: pool.y + 1, duration: 1100, minAlpha: 0.3, maxAlpha: 0.6 });
    }
    for (const crack of v.fissures)
    {
        const mid = crack[Math.floor(crack.length / 3)];
        addGlow(scene, mid.x, mid.y, LAVA.deep, { scale: 0.7, depth: -999_998, duration: 2200, minAlpha: 0.15, maxAlpha: 0.4 });
    }

    // Smoke rising from the crater and drifting off.
    for (let i = 0; i < 7; i++) smokePuff(scene, craterX + (Math.random() - 0.5) * 20, craterY, high, 1.1, i * 700);
    // Steam from the vents.
    for (const d of layout.decorations)
    {
        if (d.kind !== 'vent') continue;
        smokePuff(scene, d.x, d.y - 3, high, 0.45, Math.random() * 3000);
        addGlow(scene, d.x, d.y - 2, LAVA.hot, { scale: 0.35, depth: d.y + 1, duration: 700 });
    }

    // Embers floating up from the crater and pools.
    const sources = [{ x: craterX, y: craterY, spread: 18 }, ...v.pools.map((p) => ({ x: p.x, y: p.y, spread: p.rx }))];
    for (let i = 0; i < 28; i++)
    {
        const s = sources[i % sources.length];
        ember(scene, s.x + (Math.random() - 0.5) * s.spread * 2, s.y, high);
    }

    // The wastes: braziers burning in the ash villages, embers drifting off the cracks.
    for (const d of layout.decorations)
    {
        if (d.kind !== 'brazier') continue;
        addGlow(scene, d.x, d.y - 8, LAVA.hot, { scale: 0.9, depth: d.y + 1, duration: 150, minAlpha: 0.35, maxAlpha: 0.7 });
        for (let k = 0; k < 3; k++) ember(scene, d.x + (Math.random() - 0.5) * 6, d.y - 10, high);
    }
    for (const crack of v.fissures.slice(9))
    {
        const at = crack[Math.floor(Math.random() * crack.length)];
        ember(scene, at.x, at.y, high);
    }
}

function smokePuff (scene: Scene, x: number, y: number, depth: number, size: number, delay: number): void
{
    const puff = scene.add.image(x, y, Tex.Glow).setTint(hexToInt('#5c5653')).setAlpha(0).setScale(size * 0.4).setDepth(depth);
    scene.tweens.add({
        targets: puff,
        y: y - 50 * size - Math.random() * 20,
        x: x + 14 + Math.random() * 16, // drifts with the wind
        scale: size * 1.6,
        alpha: { from: 0.55, to: 0 },
        duration: 4200 + Math.random() * 1800,
        delay,
        repeat: -1,
        ease: 'Sine.easeOut',
    });
}

function ember (scene: Scene, x: number, y: number, depth: number): void
{
    const spark = scene.add.image(Math.round(x), Math.round(y), Tex.FxSpark)
        .setTint(hexToInt(Math.random() < 0.5 ? LAVA.bright : LAVA.white))
        .setBlendMode(BlendModes.ADD)
        .setAlpha(0)
        .setDepth(depth);
    scene.tweens.add({
        targets: spark,
        y: y - 30 - Math.random() * 40,
        x: x + (Math.random() - 0.3) * 24,
        alpha: { from: 1, to: 0 },
        duration: 1600 + Math.random() * 1600,
        delay: Math.random() * 3000,
        repeat: -1,
        repeatDelay: Math.random() * 1500,
    });
}

// ---------------------------------------------------------------------------

const rgbCache = new Map<string, [number, number, number]>();

function write (data: Uint8ClampedArray, width: number, x: number, y: number, hex: string): void
{
    if (x < 0 || y < 0 || x >= width || (y * width + x) * 4 >= data.length) return;
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
    data[i + 3] = 255;
}

function readAlpha (data: Uint8ClampedArray, width: number, x: number, y: number): boolean
{
    const i = (y * width + x) * 4 + 3;
    return i >= 0 && i < data.length && data[i] > 0;
}

/** Is this pixel already a fissure's dark rim (so rims may overwrite each other but not lava)? */
function isRim (data: Uint8ClampedArray, width: number, x: number, y: number): boolean
{
    const i = (y * width + x) * 4;
    const [r, g, b] = rgbCache.get(LAVA.rim) ?? [0x2a, 0x1d, 0x1a];
    return data[i] === r && data[i + 1] === g && data[i + 2] === b;
}
