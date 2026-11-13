import { Scene } from 'phaser';
import { createRng } from '../logic/Random';
import { Palette } from './Palette';
import { PixelPainter } from './PixelPainter';

/**
 * Art for the title screen, painted once in code:
 *  - the backdrop (640 x 360, shown at 2x so its pixels match the game's
 *    sprites): a night sky with a moon and aurora, far mountains with the
 *    volcano glowing on the right, and the five lands across the ground:
 *    enchanted moss (left), green forest (middle), ash and lava (right),
 *    crystal fields (bottom left), murky swamp pools (bottom right);
 *  - the aurora as its own layer (it drifts), soft mist, and giant crystals.
 */

export const TitleTex = {
    Backdrop: 'title-backdrop',
    Aurora: 'title-aurora',
    Mist: 'title-mist',
    crystal: (variant: number) => `title-crystal-${variant}`,
};

export const TITLE_W = 640;
export const TITLE_H = 360;

type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** The horizon lines (canvas px): far mountains, the volcano, near hills, where the ground starts. */
export function farRidge (x: number): number
{
    return 178 + 20 * Math.sin(x * 0.013 + 1) + 11 * Math.sin(x * 0.037) + 5 * Math.sin(x * 0.09 + 3);
}
export const VOLCANO = { x: 548, top: 92 };
function volcanoRidge (x: number): number
{
    const d = Math.abs(x - VOLCANO.x);
    if (d < 9) return VOLCANO.top + 3 + (d < 6 ? 2 : 0); // a notched crater
    return VOLCANO.top + d * 0.82 + 3 * Math.sin(x * 0.3);
}
export function nearRidge (x: number): number
{
    return 226 + 12 * Math.sin(x * 0.021 + 2) + 7 * Math.sin(x * 0.055 + 1);
}
export function groundLine (x: number): number
{
    return 268 + 5 * Math.sin(x * 0.03) + 3 * Math.sin(x * 0.11 + 2);
}

export function createTitleTextures (scene: Scene): void
{
    if (!scene.textures.exists(TitleTex.Backdrop)) paintBackdrop(scene);
    if (!scene.textures.exists(TitleTex.Aurora)) paintAurora(scene);
    if (!scene.textures.exists(TitleTex.Mist)) paintMist(scene);
    for (let v = 0; v < 6; v++)
    {
        if (scene.textures.exists(TitleTex.crystal(v))) continue;
        const p = new PixelPainter(26, 44, createRng(5100 + v));
        paintCrystal(p, v);
        p.outline(Palette.outline);
        p.toTexture(scene, TitleTex.crystal(v));
    }
}

function paintBackdrop (scene: Scene): void
{
    const tex = scene.textures.createCanvas(TitleTex.Backdrop, TITLE_W, TITLE_H);
    if (!tex) return;
    const ctx = tex.getContext();
    const img = ctx.createImageData(TITLE_W, TITLE_H);
    const d = img.data;
    const rng = createRng(0x7171e);
    const put = (x: number, y: number, c: RGB, a = 1) => {
        x = Math.round(x); y = Math.round(y);
        if (x < 0 || y < 0 || x >= TITLE_W || y >= TITLE_H) return;
        const i = (y * TITLE_W + x) * 4;
        d[i] = d[i] + (c[0] - d[i]) * a; d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * a; d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * a; d[i + 3] = 255;
    };
    /** A colour dithered to a coarse step, for the retro banding. */
    const dither = (c: RGB, x: number, y: number, step = 6): RGB => {
        const b = (BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * step;
        return [Math.round((c[0] + b) / step) * step, Math.round((c[1] + b) / step) * step, Math.round((c[2] + b) / step) * step];
    };

    // 1. Sky: deep violet at the top, through indigo to a teal glow at the horizon.
    const sky: [number, RGB][] = [[0, hex('#08061a')], [0.45, hex('#1c1240')], [0.75, hex('#1a2a58')], [1, hex('#16494e')]];
    for (let y = 0; y < TITLE_H; y++)
    {
        const t = Math.min(1, y / 215);
        let c = sky[0][1];
        for (let k = 1; k < sky.length; k++) if (t <= sky[k][0]) { c = mix(sky[k - 1][1], sky[k][1], (t - sky[k - 1][0]) / (sky[k][0] - sky[k - 1][0])); break; }
        for (let x = 0; x < TITLE_W; x++) put(x, y, dither(c, x, y));
    }
    // Stars, a few bright ones with a cross.
    for (let i = 0; i < 220; i++)
    {
        const x = rng() * TITLE_W;
        const y = rng() * 170;
        const b = rng();
        const c: RGB = b > 0.9 ? [255, 255, 255] : b > 0.6 ? [200, 210, 255] : [130, 130, 190];
        put(x, y, c, 0.5 + b * 0.5);
        if (b > 0.96) { put(x - 1, y, c, 0.5); put(x + 1, y, c, 0.5); put(x, y - 1, c, 0.5); put(x, y + 1, c, 0.5); }
    }
    // The moon, with a violet halo and soft craters.
    const moon = { x: 96, y: 40, r: 21 };
    for (let y = moon.y - 46; y <= moon.y + 46; y++)
    {
        for (let x = moon.x - 46; x <= moon.x + 46; x++)
        {
            const dist = Math.hypot(x - moon.x, y - moon.y);
            if (dist <= moon.r)
            {
                const shade = (x - moon.x + (y - moon.y)) / (moon.r * 2);
                put(x, y, dither(mix(hex('#efeaff'), hex('#a99ed8'), Math.max(0, shade + 0.3)), x, y, 8));
            }
            else if (dist < 46) put(x, y, hex('#8f6fe0'), 0.22 * (1 - (dist - moon.r) / (46 - moon.r)) ** 2);
        }
    }
    for (const [cx, cy, r] of [[-7, -5, 4], [5, 4, 5], [8, -9, 2.5], [-4, 9, 2.5]])
    {
        for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (Math.hypot(x, y) <= r) put(moon.x + cx + x, moon.y + cy + y, hex('#9a90c8'), 0.45);
    }

    // 2. Far mountains, lit at their rims by the moon; the volcano rising on the right.
    for (let x = 0; x < TITLE_W; x++)
    {
        const vol = Math.abs(x - VOLCANO.x) < 150 ? volcanoRidge(x) : Infinity;
        const top = Math.min(farRidge(x), vol);
        const isVolcano = vol <= farRidge(x);
        for (let y = Math.floor(top); y < TITLE_H; y++)
        {
            const depth = (y - top) / 60;
            const base = isVolcano ? mix(hex('#3a1f2a'), hex('#1c1020'), Math.min(1, depth)) : mix(hex('#2a2456'), hex('#151230'), Math.min(1, depth));
            put(x, y, dither(base, x, y, 5));
        }
        put(x, top, isVolcano ? hex('#a0403a') : hex('#5a4ea0'));
    }
    // Lava glow at the crater, and lava running down the volcano's flanks.
    for (let y = VOLCANO.top - 40; y < VOLCANO.top + 60; y++)
    {
        for (let x = VOLCANO.x - 70; x < VOLCANO.x + 70; x++)
        {
            const dist = Math.hypot(x - VOLCANO.x, (y - VOLCANO.top) * 1.4);
            if (dist < 70) put(x, y, hex('#ff6a2a'), 0.28 * (1 - dist / 70) ** 2);
        }
    }
    for (const [spread, phase] of [[-0.55, 0], [0.4, 1.7], [0.05, 3.1]])
    {
        let x = VOLCANO.x + spread * 4;
        for (let y = VOLCANO.top + 4; y < 236; y++)
        {
            x += spread * 0.7 + Math.sin(y * 0.15 + phase) * 0.5;
            if (y > volcanoRidge(x) - 1 || y > VOLCANO.top + 6)
            {
                put(x, y, hex('#ff8a2a'));
                put(x + 1, y, hex('#ffd27a'), 0.8);
                put(x - 1, y, hex('#c2401f'), 0.7);
            }
        }
    }
    put(VOLCANO.x - 2, VOLCANO.top + 3, hex('#ffe9a0')); put(VOLCANO.x + 2, VOLCANO.top + 3, hex('#ffe9a0'));

    // 3. Near hills: teal-dark on the enchanted left, forest green in the middle, ash on the right,
    //    with rows of little pines along the ridge (gnarled dead trees over the ash).
    const hillColor = (x: number): RGB => {
        const left = hex('#123236');
        const mid = hex('#132a1c');
        const right = hex('#261a22');
        return x < 320 ? mix(left, mid, smooth(140, 300, x)) : mix(mid, right, smooth(360, 470, x));
    };
    for (let x = 0; x < TITLE_W; x++)
    {
        const top = nearRidge(x);
        for (let y = Math.floor(top); y < TITLE_H; y++) put(x, y, dither(mix(hillColor(x), [8, 8, 16], Math.min(0.7, (y - top) / 80)), x, y, 4));
    }
    for (let x = 4; x < TITLE_W; x += 5 + Math.floor(rng() * 5))
    {
        const base = nearRidge(x) + 2;
        const h = 6 + Math.floor(rng() * 9);
        const c = mix(hillColor(x), [4, 6, 10], 0.45);
        if (x > 450)
        {
            // Dead trees: a trunk and two bare branches.
            for (let y = 0; y < h; y++) put(x, base - y, c);
            put(x - 1, base - h + 2, c); put(x - 2, base - h + 1, c); put(x + 1, base - h + 3, c); put(x + 2, base - h + 2, c);
            continue;
        }
        for (let y = 0; y < h; y++)
        {
            const w = Math.floor((y / h) * 3.2);
            for (let dx = -w; dx <= w; dx++) put(x + dx, base - h + y, c);
        }
    }

    // 4. The ground: five lands blended into one another.
    const lands: { at: [number, number]; color: RGB; speck: RGB[] }[] = [
        { at: [70, 268], color: hex('#1a3a3a'), speck: [hex('#2f6a55'), hex('#8f72c9')] },          // enchanted moss
        { at: [320, 300], color: hex('#1a3420'), speck: [hex('#2a5030'), hex('#3c6a3c')] },         // forest grass
        { at: [610, 268], color: hex('#2c2026'), speck: [hex('#3e2e30'), hex('#5a2a20')] },         // ash
        { at: [70, 360], color: hex('#1c2048'), speck: [hex('#7fd4ff'), hex('#c79bff'), hex('#8dffb5')] }, // crystal fields
        { at: [600, 360], color: hex('#16261a'), speck: [hex('#2a4a2c'), hex('#5c6a3a')] },         // swamp
    ];
    for (let x = 0; x < TITLE_W; x++)
    {
        const top = groundLine(x);
        for (let y = Math.floor(top); y < TITLE_H; y++)
        {
            let total = 0;
            let c: RGB = [0, 0, 0];
            const weights = lands.map((l) => { const w = 1 / (Math.hypot(x - l.at[0], (y - l.at[1]) * 1.6) + 20) ** 3; total += w; return w; });
            lands.forEach((l, k) => { c = [c[0] + l.color[0] * weights[k], c[1] + l.color[1] * weights[k], c[2] + l.color[2] * weights[k]]; });
            c = [c[0] / total, c[1] / total, c[2] / total];
            put(x, y, dither(c, x, y, 4));
            // Specks: the strongest land's details.
            let best = 0;
            for (let k = 1; k < lands.length; k++) if (weights[k] > weights[best]) best = k;
            const r = rng();
            if (r < (best === 3 ? 0.05 : 0.1)) put(x, y, lands[best].speck[Math.floor(rng() * lands[best].speck.length)], best === 3 ? 0.9 : 0.6);
        }
        put(x, top, mix(hillColor(x), [120, 140, 200], 0.15));
    }
    // Lava cracks across the ash.
    for (let k = 0; k < 4; k++)
    {
        let x = 490 + rng() * 140;
        let y = 274 + rng() * 20;
        for (let s = 0; s < 40; s++)
        {
            put(x, y, hex('#ff7a2a'), 0.9);
            put(x, y + 1, hex('#c2401f'), 0.6);
            x += (rng() - 0.3) * 2.2;
            y += rng() * 0.9;
        }
    }
    // Swamp pools with moonlit glints and lily pads.
    for (const [px, py, rx, ry] of [[480, 332, 34, 7], [548, 350, 30, 6], [436, 352, 18, 4]])
    {
        for (let y = -ry; y <= ry; y++)
        {
            for (let x = -rx; x <= rx; x++)
            {
                if ((x / rx) ** 2 + (y / ry) ** 2 > 1) continue;
                put(px + x, py + y, dither(mix(hex('#1f4a44'), hex('#12302c'), (y + ry) / (ry * 2)), px + x, py + y, 4));
            }
        }
        for (let g = 0; g < rx / 3; g++) put(px - rx * 0.6 + rng() * rx * 1.2, py - ry * 0.4 + rng() * ry * 0.6, hex('#9ad8c8'), 0.7);
        for (let g = 0; g < 3; g++) { const lx = px - rx * 0.7 + rng() * rx * 1.4; const ly = py + (rng() - 0.5) * ry; put(lx, ly, hex('#4a7a35')); put(lx + 1, ly, hex('#5f9a45')); }
    }

    ctx.putImageData(img, 0, 0);
    tex.refresh();
}

/** Three ribbons of northern lights (green, blue, violet), drawn soft and translucent. */
function paintAurora (scene: Scene): void
{
    const w = TITLE_W;
    const h = 140;
    const tex = scene.textures.createCanvas(TitleTex.Aurora, w, h);
    if (!tex) return;
    const ctx = tex.getContext();
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const ribbons: [RGB, number, number, number][] = [[hex('#5affa8'), 40, 0.011, 0], [hex('#5ac8ff'), 62, 0.008, 2], [hex('#b07aff'), 30, 0.014, 4]];
    for (const [c, base, freq, phase] of ribbons)
    {
        for (let x = 0; x < w; x++)
        {
            const mid = base + 18 * Math.sin(x * freq + phase) + 7 * Math.sin(x * freq * 3.1 + phase);
            const strength = 0.5 + 0.5 * Math.sin(x * 0.02 + phase * 1.3);
            for (let y = 0; y < h; y++)
            {
                const t = (y - mid) / 22;
                // Tall streaks fading upward, a brighter lower edge.
                const a = t < 0 ? Math.exp(-t * t * 1.2) * 0.35 : Math.exp(-t * t * 9) * 0.6;
                const alpha = a * strength * ((x + y) % 2 === 0 ? 1 : 0.75);
                if (alpha < 0.03) continue;
                const i = (y * w + x) * 4;
                d[i] = Math.max(d[i], c[0]); d[i + 1] = Math.max(d[i + 1], c[1]); d[i + 2] = Math.max(d[i + 2], c[2]);
                d[i + 3] = Math.min(255, d[i + 3] + alpha * 255);
            }
        }
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
}

/** A soft, wide band of mist (tinted per use). */
function paintMist (scene: Scene): void
{
    const w = 256;
    const h = 40;
    const tex = scene.textures.createCanvas(TitleTex.Mist, w, h);
    if (!tex) return;
    const ctx = tex.getContext();
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++)
    {
        for (let x = 0; x < w; x++)
        {
            const nx = (x - w / 2) / (w / 2);
            const ny = (y - h / 2) / (h / 2);
            const a = Math.max(0, 1 - nx * nx) * Math.max(0, 1 - ny * ny) * (0.75 + 0.25 * Math.sin(x * 0.09 + y * 0.3));
            const i = (y * w + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = 255;
            d[i + 3] = Math.round(a * a * 120);
        }
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
}

/** Crystal hues, light to dark: blue, violet, green. */
const CRYSTAL_SHADES = [
    ['#e8f8ff', '#9fe0ff', '#4fa8e0', '#2a5f9a', '#1a3460'],
    ['#f4ebff', '#d6b4ff', '#9a68e0', '#6a3fae', '#3a2266'],
    ['#eafff2', '#a8ffc8', '#4fd88c', '#2a8a5a', '#174a32'],
] as const;

/** Crystal glow colours (blue, violet, green). */
export const CRYSTAL_GLOWS = ['#7fd4ff', '#c79bff', '#8dffb5'] as const;

/** 26 x 44: a towering crystal (variant % 3: blue, violet, green; 3-5 twin spires). */
function paintCrystal (p: PixelPainter, variant: number): void
{
    const c = CRYSTAL_SHADES[variant % 3];
    const spire = (cx: number, top: number, half: number, bottom: number) => {
        for (let y = top; y <= bottom; y++)
        {
            const w = Math.min(half, Math.floor((y - top) * 0.55) + 1);
            for (let dx = -w; dx <= w; dx++) p.set(cx + dx, y, dx < -w / 2 ? c[0] : dx < 0 ? c[1] : dx === 0 ? c[2] : dx < w / 2 ? c[3] : c[4]);
        }
        p.set(cx - 1, top + 3, '#ffffff');
        p.set(cx - 1, top + 4, c[0]);
    };
    if (variant < 3) { spire(13, 0, 6, 41); spire(6, 16, 4, 41); spire(20, 22, 3, 41); }
    else { spire(9, 2, 5, 41); spire(17, 8, 5, 41); spire(4, 26, 2, 41); }
    p.rect(2, 40, 22, 3, '#262a40');
    p.speckle(2, 40, 22, 3, '#3a3f5c', 0.4);
}
