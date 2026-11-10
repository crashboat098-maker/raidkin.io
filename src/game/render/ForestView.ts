import { BlendModes, Scene } from 'phaser';
import type { BattlefieldLayout } from '../logic/BattlefieldLayout';
import { forestAt } from '../logic/Biomes';
import { addGlow } from './Glow';
import { GLOW_FLOWER_COLORS } from './NatureArt';
import { hexToInt, Palette } from './Palette';
import { Tex } from './PlaceholderArt';

/**
 * The enchanted forest's living light: fireflies drifting between the trees,
 * and soft glows on lanterns, the fae fountain and some of the flowers.
 * Cheap: a fixed number of sprites, each with one looping tween.
 */

const FIREFLIES = 120;
/** Extra fireflies gathered around the scenic groves. */
const SWARM_FIREFLIES = 70;
/** Only some flowers glow, so the forest twinkles rather than blazes. */
const MAX_FLOWER_GLOWS = 45;
const HIGH = 940_000;

export function addForestLife (scene: Scene, layout: BattlefieldLayout): void
{
    if (!layout.biomes) return;
    const { biomes, playArea } = layout;

    // Fireflies, wandering in the forest's glades...
    let placed = 0;
    for (let attempt = 0; attempt < FIREFLIES * 20 && placed < FIREFLIES; attempt++)
    {
        const x = playArea.x + Math.random() * playArea.width;
        const y = playArea.y + Math.random() * playArea.height;
        if (forestAt(biomes, x, y) < 0.4) continue;
        placed++;
        firefly(scene, x, y);
    }
    // ...and swarming around the scenic groves' trees and the castle grounds.
    const trees = layout.decorations.filter((d) => (d.kind === 'moonTree' || d.kind === 'spiralTree' || d.kind === 'giantShroom') && forestAt(biomes, d.x, d.y) > 0.8);
    for (let i = 0; i < SWARM_FIREFLIES && trees.length > 0; i++)
    {
        const t = trees[Math.floor(Math.random() * trees.length)];
        firefly(scene, t.x + (Math.random() - 0.5) * 50, t.y - 10 - Math.random() * 30);
    }
    for (const s of layout.structures)
    {
        if (s.type !== 'faeCastle') continue;
        for (let i = 0; i < 24; i++) firefly(scene, s.x + (Math.random() - 0.5) * 300, s.y + 20 + Math.random() * 120);
    }

    // Glows on the village lanterns, the fountain and a share of the flowers.
    let flowerGlows = 0;
    for (const d of layout.decorations)
    {
        if (d.kind === 'crystalCluster') addGlow(scene, d.x, d.y - 8, d.variant === 0 ? '#c9a2ff' : '#ff9fcd', { scale: 0.6, depth: d.y + 1, duration: 2000, minAlpha: 0.25, maxAlpha: 0.5 });
        else if (d.kind === 'lantern') addGlow(scene, d.x, d.y - 13, Palette.accent.amber, { scale: 0.55, depth: d.y + 1, duration: 160, minAlpha: 0.35, maxAlpha: 0.65 });
        else if (d.kind === 'faeFountain') addGlow(scene, d.x, d.y - 6, '#c9a2ff', { scale: 1.1, depth: d.y + 1, duration: 1800, minAlpha: 0.3, maxAlpha: 0.55 });
        else if (d.kind === 'glowFlower' && flowerGlows < MAX_FLOWER_GLOWS && (d.x + d.y) % 3 === 0)
        {
            flowerGlows++;
            addGlow(scene, d.x, d.y - 4, GLOW_FLOWER_COLORS[d.variant] ?? GLOW_FLOWER_COLORS[0], { scale: 0.32, depth: d.y + 1, duration: 1600 });
        }
    }
}

export function firefly (scene: Scene, x: number, y: number, colors: readonly string[] = ['#e9ff9a', '#e9ff9a', '#e9ff9a', '#ffd36a']): void
{
    const color = colors[Math.floor(Math.random() * colors.length)];
    const glow = scene.add.image(x, y, Tex.Glow).setTint(hexToInt(color)).setBlendMode(BlendModes.ADD).setScale(0.22).setAlpha(0).setDepth(HIGH);
    const dot = scene.add.image(Math.round(x), Math.round(y), Tex.Firefly).setBlendMode(BlendModes.ADD).setAlpha(0).setDepth(HIGH);
    const dx = (Math.random() - 0.5) * 60;
    const dy = (Math.random() - 0.5) * 40;
    const duration = 2600 + Math.random() * 3000;
    const delay = Math.random() * 4000;
    // Drift back and forth, blinking on and off.
    scene.tweens.add({ targets: [glow, dot], x: x + dx, y: y + dy, duration, delay, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    scene.tweens.add({ targets: dot, alpha: { from: 0, to: 1 }, duration: 700 + Math.random() * 600, delay, yoyo: true, repeat: -1, repeatDelay: Math.random() * 1800 });
    scene.tweens.add({ targets: glow, alpha: { from: 0, to: 0.55 }, duration: 700 + Math.random() * 600, delay, yoyo: true, repeat: -1, repeatDelay: Math.random() * 1800 });
}
