import { BlendModes, GameObjects, Scene } from 'phaser';
import { hexToInt } from './Palette';
import { Tex } from './PlaceholderArt';

export interface GlowOptions {
    /** Base size (1 = 32 world pixels across). */
    scale: number;
    depth: number;
    /** Brightness range it pulses between. */
    minAlpha?: number;
    maxAlpha?: number;
    /** Roughly how long one pulse takes, in ms. Short values look like flickering fire. */
    duration?: number;
}

/**
 * Glowing lights (lanterns, crystals, torches, soul shards...) all draw in one
 * layer above the standing scenery and soldiers, rather than each one tucked
 * in at its own height among them. They use additive blending, and every
 * switch between that and normal sprites forces a separate draw call: mixed
 * in, a big battle cost ~500 extra draw calls a frame. Each glow still sits
 * over its own light source, as before.
 */
export const LIGHTS_DEPTH = 798_400;
/** Glows lying on the ground (fallen soldiers' shimmer): one layer just above the ground, below anything standing. */
export const GROUND_GLOW_DEPTH = -999_000;

/** Depths given to scenery standing on the map are its y position (well inside this range). */
function isStandingDepth (depth: number): boolean
{
    return depth > GROUND_GLOW_DEPTH && depth < LIGHTS_DEPTH;
}

/** A soft coloured light that gently pulses (or flickers, with a short duration). */
export function addGlow (scene: Scene, x: number, y: number, color: string, options: GlowOptions): GameObjects.Image
{
    const { scale, depth, minAlpha = 0.25, maxAlpha = 0.6, duration = 1400 } = options;

    const glow = scene.add.image(x, y, Tex.Glow)
        .setTint(hexToInt(color))
        .setBlendMode(BlendModes.ADD)
        .setScale(scale)
        .setAlpha((minAlpha + maxAlpha) / 2)
        .setDepth(isStandingDepth(depth) ? LIGHTS_DEPTH : depth);

    scene.tweens.add({
        targets: glow,
        alpha: { from: minAlpha, to: maxAlpha },
        scale: { from: scale * 0.9, to: scale * 1.05 },
        duration: duration * (1 + Math.random()),
        delay: Math.random() * duration,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
    });

    return glow;
}
