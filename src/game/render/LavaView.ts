import { BlendModes, GameObjects, Scene } from 'phaser';
import type { BattlefieldLayout } from '../logic/BattlefieldLayout';
import type { Bridge } from '../logic/Bridges';
import type { LavaLayout } from '../logic/LavaRivers';
import { addGlow } from './Glow';
import { hexToInt } from './Palette';
import { hash2, textureFromPixelMap } from './PixelPainter';
import { Tex } from './PlaceholderArt';

/**
 * The volcano biome's molten life, all visual only:
 *  - lava rivers, painted once (a crusted dark bank, glowing orange flow, bright streaks),
 *  - soft glows pulsing along them, and bubbles popping in rivers and pools,
 *  - flames licking the crater rim, and now and then a fire burst from the crater,
 *  - small ground fires with flickering flames, sparks and a wisp of smoke.
 *
 * Built to stay cheap: a fixed pool of bubble/spark sprites, one shared flame
 * flicker timer, bubbles only spawned near the camera, nothing created per frame.
 */

const RIVER_KEY = 'lava-rivers';
const BUBBLE_KEY = 'lava-bubble';
const LAVA = ['#2a140e', '#5e200c', '#a8380f', '#e2571a', '#ff8a2a', '#ffb347', '#ffe08a'];
const HIGH = 950_000;

export function addLavaRivers (scene: Scene, layout: BattlefieldLayout, depth: number): void
{
    const lava = layout.lava;
    if (lava && lava.rivers.length > 0) paintRivers(scene, lava, depth, layout.lavaBridges);
    if (layout.volcano) new VolcanoLife(scene, layout);
}

// ---------------------------------------------------------------------------
// The rivers (painted once, into an image just big enough to hold them)
// ---------------------------------------------------------------------------

/** Is a point under one of the stone bridges (no glows or bubbles drawn on top of them)? */
function underBridge (bridges: readonly Bridge[], x: number, y: number): boolean
{
    return bridges.some((b) => b.rect && x > b.rect.x - 6 && x < b.rect.x + b.rect.width + 6 && y > b.rect.y - 10 && y < b.rect.y + b.rect.height + 6);
}

function paintRivers (scene: Scene, lava: LavaLayout, depth: number, bridges: readonly Bridge[]): void
{
    const { cols, rows, cell, mask } = lava;
    let c0 = cols, c1 = 0, r0 = rows, r1 = 0;
    for (let i = 0; i < mask.length; i++)
    {
        if (!mask[i]) continue;
        const c = i % cols;
        const r = (i - c) / cols;
        if (c < c0) c0 = c; if (c > c1) c1 = c;
        if (r < r0) r0 = r; if (r > r1) r1 = r;
    }
    if (c1 < c0) return;
    const ox = c0 * cell;
    const oy = r0 * cell;
    const width = (c1 - c0 + 1) * cell;
    const height = (r1 - r0 + 1) * cell;

    if (!scene.textures.exists(RIVER_KEY))
    {
        // Distance from the bank, in cells (crust at the edge, hottest in the middle).
        const dist = new Uint8Array(mask.length);
        let frontier: number[] = [];
        for (let i = 0; i < mask.length; i++)
        {
            if (!mask[i]) continue;
            const c = i % cols;
            if (!mask[i - 1] || !mask[i + 1] || !mask[i - cols] || !mask[i + cols] || c === 0 || c === cols - 1) { dist[i] = 1; frontier.push(i); }
        }
        for (let step = 2; step <= 6 && frontier.length; step++)
        {
            const next: number[] = [];
            for (const i of frontier) for (const n of [i - 1, i + 1, i - cols, i + cols]) if (n >= 0 && n < mask.length && mask[n] && !dist[n]) { dist[n] = step; next.push(n); }
            frontier = next;
        }

        const texture = scene.textures.createCanvas(RIVER_KEY, width, height);
        if (!texture) return;
        const ctx = texture.getContext();
        const image = ctx.createImageData(width, height);
        const rgb = LAVA.map(hexRgb);
        for (let r = r0; r <= r1; r++)
        {
            for (let c = c0; c <= c1; c++)
            {
                const i = r * cols + c;
                if (!mask[i]) continue;
                const d = dist[i] || 6;
                for (let dy = 0; dy < cell; dy++)
                {
                    for (let dx = 0; dx < cell; dx++)
                    {
                        const x = c * cell + dx;
                        const y = r * cell + dy;
                        const roll = hash2(x * 5 + 3, y * 7 + 1) % 100;
                        let shade = d <= 1 ? 0 : d === 2 ? 1 : d === 3 ? 2 : d === 4 ? 3 : 4;
                        // Bright flow streaks and the odd cooling crust plate in the middle.
                        if (d >= 4 && (x + Math.floor(y / 3) * 4) % 17 < 2) shade = 6;
                        else if (d >= 4 && roll < 6) shade = 5;
                        else if (d >= 4 && hash2(Math.floor(x / 6), Math.floor(y / 6)) % 23 === 0) shade = 1;
                        else if (d <= 1 && roll < 30) shade = 1;
                        const o = ((y - oy) * width + (x - ox)) * 4;
                        const [R, G, B] = rgb[shade];
                        image.data[o] = R; image.data[o + 1] = G; image.data[o + 2] = B; image.data[o + 3] = 255;
                    }
                }
            }
        }
        ctx.putImageData(image, 0, 0);
        texture.refresh();
    }
    scene.add.image(ox, oy, RIVER_KEY).setOrigin(0, 0).setDepth(depth);

    // Heat glow pulsing along each river.
    for (const river of lava.rivers)
    {
        for (let i = 1; i < river.points.length; i += 3)
        {
            const p = river.points[i];
            if (underBridge(bridges, p.x, p.y)) continue;
            addGlow(scene, p.x, p.y, '#ef6a1d', { scale: 0.85, depth: -999_998, duration: 1600, minAlpha: 0.18, maxAlpha: 0.38 });
        }
    }
}

// ---------------------------------------------------------------------------
// Animated life: bubbles, crater flames and bursts, small fires
// ---------------------------------------------------------------------------

class VolcanoLife
{
    private readonly flames: GameObjects.Image[] = [];
    private readonly bubbles: GameObjects.Image[] = [];
    private readonly sparks: GameObjects.Image[] = [];
    private nextBubble = 0;
    private nextSpark = 0;
    /** Points inside molten lava (rivers and pools) where bubbles can pop. */
    private readonly bubbleSpots: { x: number; y: number }[] = [];

    constructor (private readonly scene: Scene, layout: BattlefieldLayout)
    {
        const v = layout.volcano!;
        if (!scene.textures.exists(BUBBLE_KEY)) textureFromPixelMap(scene, BUBBLE_KEY, ['.yy.', 'y..y', 'oyyo'], { y: '#ffd27a', o: '#ef6a1d' });

        for (const river of layout.lava?.rivers ?? []) for (const p of river.points) if (!underBridge(layout.lavaBridges, p.x, p.y)) this.bubbleSpots.push(p);
        for (const pool of v.pools) for (let k = 0; k < 4; k++) this.bubbleSpots.push({ x: pool.x + (k - 1.5) * pool.rx * 0.4, y: pool.y });

        for (let i = 0; i < 20; i++) this.bubbles.push(scene.add.image(0, 0, BUBBLE_KEY).setAlpha(0).setDepth(-999_997));
        for (let i = 0; i < 22; i++) this.sparks.push(scene.add.image(0, 0, Tex.FxSpark).setBlendMode(BlendModes.ADD).setAlpha(0).setDepth(HIGH));

        // Flames licking the crater rim.
        const crater = { x: v.cone.x, y: v.cone.y - 101 };
        for (const dx of [-14, -7, 0, 6, 13])
        {
            this.flames.push(scene.add.image(crater.x + dx, crater.y + 1 + Math.abs(dx) * 0.15, Tex.flame(0)).setOrigin(0.5, 1).setScale(1.6).setDepth(v.cone.y + 0.7));
        }

        // Small ground fires: flickering flames, a warm glow, rising sparks and a wisp of smoke.
        for (const d of layout.decorations)
        {
            if (d.kind !== 'smallFire') continue;
            for (const dx of [-2, 2]) this.flames.push(scene.add.image(d.x + dx, d.y - 3, Tex.flame(0)).setOrigin(0.5, 1).setScale(1.4).setDepth(d.y + 0.6));
            addGlow(scene, d.x, d.y - 4, '#ff8a2a', { scale: 0.7, depth: d.y + 1, duration: 150, minAlpha: 0.3, maxAlpha: 0.6 });
            this.smoke(d.x, d.y - 8, 0.4, Math.random() * 3000);
        }

        // One timer flickers every flame, pops bubbles and lifts sparks from the fires.
        const fires = layout.decorations.filter((d) => d.kind === 'smallFire');
        scene.time.addEvent({
            delay: 90,
            loop: true,
            callback: () => {
                for (const f of this.flames) if (f.visible && Math.random() < 0.6) f.setTexture(Tex.flame(Math.floor(Math.random() * 3)));
                if (Math.random() < 0.7) this.bubble();
                if (fires.length > 0 && Math.random() < 0.25)
                {
                    const f = fires[Math.floor(Math.random() * fires.length)];
                    this.spark(f.x, f.y - 6, (Math.random() - 0.5) * 10, 18 + Math.random() * 16, 900);
                }
            },
        });

        // Now and then, a burst of fire from the crater (visual only).
        const burst = () => {
            this.craterBurst(crater.x, crater.y, v.cone.y);
            scene.time.delayedCall(4000 + Math.random() * 6000, burst);
        };
        scene.time.delayedCall(2500 + Math.random() * 3000, burst);
    }

    /** A bubble popping somewhere in the lava, only near what the camera can see. */
    private bubble (): void
    {
        if (this.bubbleSpots.length === 0) return;
        const view = this.scene.cameras.main.worldView;
        const p = this.bubbleSpots[Math.floor(Math.random() * this.bubbleSpots.length)];
        if (p.x < view.x - 60 || p.x > view.right + 60 || p.y < view.y - 60 || p.y > view.bottom + 60) return;
        const b = this.bubbles[this.nextBubble];
        this.nextBubble = (this.nextBubble + 1) % this.bubbles.length;
        this.scene.tweens.killTweensOf(b);
        b.setPosition(Math.round(p.x + (Math.random() - 0.5) * 8), Math.round(p.y + (Math.random() - 0.5) * 6)).setScale(0.4).setAlpha(1);
        this.scene.tweens.add({ targets: b, scale: 1.3, alpha: 0, duration: 420 + Math.random() * 200, ease: 'Quad.easeOut' });
    }

    /** A spark rising and fading (pooled). */
    private spark (x: number, y: number, dx: number, rise: number, duration: number): void
    {
        const s = this.sparks[this.nextSpark];
        this.nextSpark = (this.nextSpark + 1) % this.sparks.length;
        this.scene.tweens.killTweensOf(s);
        s.setPosition(Math.round(x), Math.round(y)).setAlpha(1).setTint(hexToInt(Math.random() < 0.5 ? '#ffb347' : '#ffe08a'));
        this.scene.tweens.add({ targets: s, x: x + dx, y: y - rise, alpha: 0, duration, ease: 'Quad.easeOut' });
    }

    /** A burst of fire: a flash, a short jet of flame and a spray of sparks from the crater. */
    private craterBurst (x: number, y: number, baseDepth: number): void
    {
        const view = this.scene.cameras.main.worldView;
        if (x < view.x - 200 || x > view.right + 200 || y < view.y - 200 || y > view.bottom + 200) return; // nobody's watching
        const flash = this.scene.add.image(x, y, Tex.Glow).setTint(hexToInt('#ff8a2a')).setBlendMode(BlendModes.ADD).setScale(0.6).setAlpha(0.9).setDepth(baseDepth + 0.8);
        this.scene.tweens.add({ targets: flash, scale: 2.4, alpha: 0, duration: 700, ease: 'Quad.easeOut', onComplete: () => flash.destroy() });
        const jet = this.scene.add.image(x, y + 2, Tex.flame(0)).setOrigin(0.5, 1).setScale(2, 0.5).setDepth(baseDepth + 0.75);
        this.scene.tweens.add({ targets: jet, scaleY: 6, scaleX: 3, duration: 260, yoyo: true, ease: 'Quad.easeOut', onComplete: () => jet.destroy() });
        for (let i = 0; i < 12; i++) this.spark(x + (Math.random() - 0.5) * 10, y - 4, (Math.random() - 0.5) * 70, 30 + Math.random() * 50, 700 + Math.random() * 500);
    }

    private smoke (x: number, y: number, size: number, delay: number): void
    {
        const puff = this.scene.add.image(x, y, Tex.Glow).setTint(hexToInt('#5c5653')).setAlpha(0).setScale(size * 0.4).setDepth(HIGH);
        this.scene.tweens.add({
            targets: puff, y: y - 40 * size - 20, x: x + 10 + Math.random() * 10, scale: size * 1.4,
            alpha: { from: 0.45, to: 0 }, duration: 3800 + Math.random() * 1500, delay, repeat: -1, ease: 'Sine.easeOut',
        });
    }
}

function hexRgb (hex: string): [number, number, number]
{
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
