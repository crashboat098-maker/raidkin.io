import { GameObjects, Scene } from 'phaser';
import { STRUCTURE_SPECS, type Structure } from '../logic/Structures';
import { addGlow, type GlowOptions } from './Glow';
import { Tex } from './PlaceholderArt';
import type { SeeThroughGroup } from './SeeThrough';
import { getStructureArt, type StructureLight } from './StructureArt';

/** How each kind of light behaves: torches flicker fast, windows and runes breathe slowly. */
const LIGHT_STYLE: Record<StructureLight['kind'], Partial<GlowOptions>> = {
    torch: { duration: 140, minAlpha: 0.35, maxAlpha: 0.7 },
    window: { duration: 1800, minAlpha: 0.2, maxAlpha: 0.4 },
    rune: { duration: 1600, minAlpha: 0.3, maxAlpha: 0.7 },
    lava: { duration: 900, minAlpha: 0.35, maxAlpha: 0.65 },
};

/** How often torch flames change shape (ms). */
const FLAME_TICK_MS = 85;

/**
 * Draws structures from their gameplay data. Reads structures, never changes them.
 * Torches get a living flame: one shared timer flicks each flame between a few
 * shapes at random, so every torch flickers on its own at almost no cost.
 */
export function buildStructureView (scene: Scene, structures: readonly Structure[], seeThrough: SeeThroughGroup): void
{
    const flames: GameObjects.Image[] = [];

    for (const structure of structures)
    {
        const spec = STRUCTURE_SPECS[structure.type];
        const art = getStructureArt(structure.type, structure.variant ?? 0);
        const { x, y } = structure;

        // Soft shadow where it meets the ground.
        scene.add.image(x, y - 1, Tex.Shadow)
            .setDisplaySize(spec.width + 12, 8)
            .setAlpha(0.8)
            .setDepth(y - 0.5);

        const sprite = scene.add.image(x, y, art.key).setOrigin(0.5, 1).setDepth(y);
        seeThrough.add(sprite, x, y, spec.width, spec.height);

        for (const light of art.lights)
        {
            addGlow(scene, x + light.x, y + light.y, light.color, {
                scale: light.scale,
                depth: y + 0.5,
                ...LIGHT_STYLE[light.kind],
            });
            if (light.kind === 'torch')
            {
                flames.push(scene.add.image(Math.round(x + light.x), Math.round(y + light.y) + 2, Tex.flame(0)).setOrigin(0.5, 1).setDepth(y + 0.6));
            }
        }
    }

    if (flames.length > 0)
    {
        scene.time.addEvent({
            delay: FLAME_TICK_MS,
            loop: true,
            callback: () => {
                for (const flame of flames)
                {
                    if (flame.visible && Math.random() < 0.55) flame.setTexture(Tex.flame(Math.floor(Math.random() * 3)));
                }
            },
        });
    }
}
