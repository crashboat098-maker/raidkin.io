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

/** A soft coloured light that gently pulses (or flickers, with a short duration). */
export function addGlow (scene: Scene, x: number, y: number, color: string, options: GlowOptions): GameObjects.Image
{
    const { scale, depth, minAlpha = 0.25, maxAlpha = 0.6, duration = 1400 } = options;

    const glow = scene.add.image(x, y, Tex.Glow)
        .setTint(hexToInt(color))
        .setBlendMode(BlendModes.ADD)
        .setScale(scale)
        .setAlpha((minAlpha + maxAlpha) / 2)
        .setDepth(depth);

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
