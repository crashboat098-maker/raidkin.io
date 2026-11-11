import { BlendModes, GameObjects, Scene } from 'phaser';
import { hexToInt, Palette } from './Palette';
import { Tex } from './PlaceholderArt';

/**
 * Sword-swing and impact effects. Purely visual: they are triggered by real
 * strikes reported by the game rules (one swing per strike that dealt
 * damage) and never affect gameplay. The wind gust is decoration, not a
 * ranged attack.
 *
 * Built for big battles:
 *  - every image comes from a reusable pool (no per-hit allocations or tweens),
 *  - one loop animates all effects each frame,
 *  - a budget trims the optional extras (wind, extra sparks) when very many
 *    effects are already playing.
 */

type FxKind = 'blade' | 'slash' | 'wind' | 'spark' | 'flash' | 'splash' | 'ripple' | 'arrow';

interface Fx {
    kind: FxKind;
    image: GameObjects.Image;
    start: number;
    duration: number;
    x: number;
    y: number;
    /** Direction toward the enemy (radians). */
    angle: number;
    /** +1 / -1: which way the blade sweeps. */
    sweep: number;
    /** Travel for sparks / wind (world px over the effect's life). */
    vx: number;
    vy: number;
}

const TEXTURE: Record<FxKind, string> = {
    blade: Tex.FxBlade,
    slash: Tex.FxSlash,
    wind: Tex.FxWind,
    spark: Tex.FxSpark,
    flash: Tex.Glow,
    splash: Tex.FxSplash,
    ripple: Tex.FxRipple,
    arrow: Tex.FxArrow,
};
/** Arrows fly this fast (world px per ms), in a shallow arc. */
const ARROW_SPEED = 0.35;
const ARROW_ARC = 6;
/** Water effects sit just above the water, under the soldiers' feet. */
const WATER_DEPTH_OFFSET = -0.3;

/** Durations (ms). Short and snappy. */
const TIMING = { blade: 140, slash: 150, slashDelay: 35, wind: 230, windDelay: 50, spark: 170, flash: 120 };
/** Where the sword hand is, relative to a soldier's feet. */
const HAND_Y = -6;
/** The blade sweeps through this arc (radians) across the enemy direction. */
const SWEEP = (80 * Math.PI) / 180;
/** Effects sit above soldiers, below health bars. */
const DEPTH = 798_500;

export class CombatEffects
{
    private readonly pools = new Map<FxKind, GameObjects.Image[]>();
    private readonly active: Fx[] = [];
    private readonly spare: Fx[] = [];
    private flip = 1;

    /**
     * @param maxActive Soft limit on effects playing at once. Above ~75% of it,
     *   optional extras are skipped; above it, only the blade swing plays.
     */
    constructor (private readonly scene: Scene, private readonly maxActive = 900) {}

    /** Effects currently playing (for testing/tuning). */
    get activeCount (): number
    {
        return this.active.length;
    }

    /** Pooled images that exist in total (for testing/tuning). */
    get pooledCount (): number
    {
        let n = this.active.length;
        for (const pool of this.pools.values()) n += pool.length;
        return n;
    }

    /** A sword swing from (ax, ay) toward (tx, ty): blade sweep, slash trail, wind gust. */
    swing (ax: number, ay: number, tx: number, ty: number, time: number): void
    {
        const angle = Math.atan2(ty - ay, tx - ax);
        this.flip = -this.flip; // alternate forehand / backhand so a melee looks lively
        const busy = this.active.length;
        const hx = ax + Math.cos(angle) * 2;
        const hy = ay + HAND_Y + Math.sin(angle) * 2;

        this.spawn('blade', hx, hy, angle, this.flip, 0, 0, time, TIMING.blade);
        if (busy > this.maxActive) return;
        this.spawn('slash', hx, hy, angle, this.flip, 0, 0, time + TIMING.slashDelay, TIMING.slash);
        if (busy > this.maxActive * 0.75) return;
        // The gust drifts a little toward the enemy, then fades (visual only).
        this.spawn('wind', hx, hy, angle, this.flip, Math.cos(angle) * 9, Math.sin(angle) * 9, time + TIMING.windDelay, TIMING.wind);
    }

    /** A blow landing at (tx, ty), coming from (fx, fy): a flash and a few sparks flying away from the attacker. */
    impact (tx: number, ty: number, fx: number, fy: number, time: number): void
    {
        const away = Math.atan2(ty - fy, tx - fx);
        const x = tx;
        const y = ty + HAND_Y - 1;
        this.spawn('flash', x, y, 0, 1, 0, 0, time, TIMING.flash);

        const sparks = this.active.length > this.maxActive * 0.75 ? 1 : 3;
        for (let i = 0; i < sparks; i++)
        {
            const a = away + (Math.random() - 0.5) * 1.8;
            const d = 6 + Math.random() * 5;
            this.spawn('spark', x, y, a, 1, Math.cos(a) * d, Math.sin(a) * d - 2, time, TIMING.spark * (0.8 + Math.random() * 0.4));
        }
    }

    /**
     * An Archer's arrow flying from (ax, ay) to (tx, ty) in a shallow arc.
     * Returns when it arrives, so the impact can play then.
     */
    arrow (ax: number, ay: number, tx: number, ty: number, time: number): number
    {
        const sx = ax + (tx > ax ? 4 : -4);
        const sy = ay + HAND_Y;
        const ex = tx;
        const ey = ty + HAND_Y;
        const duration = Math.max(80, Math.hypot(ex - sx, ey - sy) / ARROW_SPEED);
        this.spawn('arrow', sx, sy, Math.atan2(ey - sy, ex - sx), 1, ex - sx, ey - sy, time, duration);
        return time + duration;
    }

    /** A soldier steps into water: a little burst of droplets. */
    splash (x: number, y: number, time: number): void
    {
        if (this.active.length > this.maxActive) return;
        this.spawn('splash', x, y, 0, 1, 0, -3, time, 260);
    }

    /** A soldier wading through water: an expanding ring. */
    ripple (x: number, y: number, time: number): void
    {
        if (this.active.length > this.maxActive * 0.75) return;
        this.spawn('ripple', x, y, 0, 1, 0, 0, time, 520);
    }

    /** Animate every playing effect; recycle finished ones. Call once per frame. */
    update (time: number): void
    {
        for (let i = this.active.length - 1; i >= 0; i--)
        {
            const fx = this.active[i];
            const t = (time - fx.start) / fx.duration;
            const img = fx.image;

            if (t >= 1)
            {
                this.recycle(i);
                continue;
            }
            if (t < 0) { img.setVisible(false); continue; } // delayed start
            img.setVisible(true);

            switch (fx.kind)
            {
                case 'blade': {
                    // Fast sweep across the enemy direction, easing out at the end.
                    const e = 1 - (1 - t) * (1 - t);
                    img.setRotation(fx.angle + fx.sweep * SWEEP * (2 * e - 1));
                    img.setAlpha(t < 0.7 ? 1 : (1 - t) / 0.3);
                    break;
                }
                case 'slash': {
                    img.setScale(0.75 + 0.4 * t);
                    img.setAlpha(0.95 * (1 - t));
                    break;
                }
                case 'wind': {
                    const e = 1 - (1 - t) * (1 - t);
                    img.setPosition(Math.round(fx.x + fx.vx * e), Math.round(fx.y + fx.vy * e));
                    img.setScale(0.8 + 0.45 * t);
                    img.setAlpha(0.6 * (1 - t));
                    break;
                }
                case 'spark': {
                    const e = 1 - (1 - t) * (1 - t);
                    img.setPosition(Math.round(fx.x + fx.vx * e), Math.round(fx.y + fx.vy * e + 4 * t * t));
                    img.setAlpha(1 - t);
                    break;
                }
                case 'flash': {
                    img.setScale(0.16 + 0.22 * t);
                    img.setAlpha(0.85 * (1 - t));
                    break;
                }
                case 'splash': {
                    img.setPosition(Math.round(fx.x), Math.round(fx.y + fx.vy * Math.sin(Math.PI * t)));
                    img.setScale(0.8 + 0.5 * t);
                    img.setAlpha(1 - t);
                    break;
                }
                case 'ripple': {
                    img.setScale(0.6 + 1.1 * t);
                    img.setAlpha(0.8 * (1 - t));
                    break;
                }
                case 'arrow': {
                    // Along the line to the target, lifted into a shallow arc, nose following the arc.
                    const lift = Math.sin(Math.PI * t) * ARROW_ARC;
                    img.setPosition(Math.round(fx.x + fx.vx * t), Math.round(fx.y + fx.vy * t - lift));
                    const slope = -Math.cos(Math.PI * t) * ARROW_ARC * Math.PI / Math.max(1, Math.hypot(fx.vx, fx.vy));
                    img.setRotation(fx.angle - slope * Math.sign(fx.vx || 1));
                    img.setAlpha(1);
                    break;
                }
            }
        }
    }

    private spawn (kind: FxKind, x: number, y: number, angle: number, sweep: number, vx: number, vy: number, start: number, duration: number): void
    {
        const image = this.takeImage(kind);
        image.setPosition(Math.round(x), Math.round(y)).setAlpha(0).setVisible(false);

        switch (kind)
        {
            case 'blade': image.setOrigin(0.12, 0.5).setScale(1).setRotation(angle - sweep * SWEEP).setFlipY(sweep < 0); break;
            case 'slash': image.setOrigin(0, 0.5).setScale(0.75).setRotation(angle).setFlipY(sweep < 0); break;
            case 'wind': image.setOrigin(0, 0.5).setScale(0.8).setRotation(angle).setFlipY(sweep < 0); break;
            case 'spark': image.setOrigin(0.5).setScale(1).setRotation(0); break;
            case 'flash': image.setOrigin(0.5).setScale(0.16).setRotation(0); break;
            case 'splash': image.setOrigin(0.5, 1).setScale(0.8).setRotation(0).setDepth(Math.round(y) + 0.2); break;
            case 'ripple': image.setOrigin(0.5).setScale(0.6).setRotation(0).setDepth(Math.round(y) + WATER_DEPTH_OFFSET); break;
            case 'arrow': image.setOrigin(0.8, 0.5).setScale(1).setRotation(angle).setDepth(DEPTH); break;
        }

        const fx = this.spare.pop() ?? ({} as Fx);
        fx.kind = kind; fx.image = image; fx.start = start; fx.duration = duration;
        fx.x = x; fx.y = y; fx.angle = angle; fx.sweep = sweep; fx.vx = vx; fx.vy = vy;
        this.active.push(fx);
    }

    private takeImage (kind: FxKind): GameObjects.Image
    {
        const pool = this.pools.get(kind);
        const reused = pool?.pop();
        if (reused) return reused;

        const image = this.scene.add.image(0, 0, TEXTURE[kind]).setDepth(DEPTH);
        // Hit flashes (additive) all draw just above the other effects instead of mixed in
        // among them: every switch between blend modes costs a separate draw call.
        if (kind === 'flash') image.setTint(hexToInt(Palette.hit)).setBlendMode(BlendModes.ADD).setDepth(DEPTH + 0.5);
        return image;
    }

    private recycle (index: number): void
    {
        const fx = this.active[index];
        fx.image.setVisible(false);
        let pool = this.pools.get(fx.kind);
        if (!pool) { pool = []; this.pools.set(fx.kind, pool); }
        pool.push(fx.image);
        // Swap-remove (order doesn't matter).
        const last = this.active.pop()!;
        if (last !== fx) this.active[index] = last;
        this.spare.push(fx);
    }
}
