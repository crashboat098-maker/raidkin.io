import { Scene } from 'phaser';
import type { BattlefieldLayout } from '../logic/BattlefieldLayout';
import { swampAt } from '../logic/Biomes';
import { firefly } from './ForestView';
import { addGlow } from './Glow';
import { hexToInt } from './Palette';
import { SWAMP_GLOW_COLORS } from './NatureArt';
import { Tex } from './PlaceholderArt';

/**
 * The swamp's atmosphere: low banks of mist drifting over the water and
 * clearings, greenish fireflies, and soft glows on the glowing plants,
 * pale mushrooms and village totems. Cheap: a fixed number of sprites,
 * each with a looping tween.
 */

const MIST_PUFFS = 46;
const FIREFLIES = 90;
const MAX_PLANT_GLOWS = 50;
/** Above the scenery and the armies, but faint enough never to hide them. */
const MIST_DEPTH = 905_000;

export function addSwampLife (scene: Scene, layout: BattlefieldLayout): void
{
    const { biomes, playArea } = layout;
    if (!biomes) return;
    const inSwamp = (x: number, y: number, min: number) => swampAt(biomes, x, y) >= min;
    const randomSpot = () => ({ x: playArea.x + Math.random() * playArea.width, y: playArea.y + Math.random() * playArea.height });

    // Mist: wide, faint puffs that slowly drift and breathe, thicker over the pools.
    const pools = layout.water.bodies.filter((b) => b.kind === 'pond' && inSwamp(b.points[0].x, b.points[0].y, 0.6));
    let puffs = 0;
    for (let attempt = 0; attempt < MIST_PUFFS * 30 && puffs < MIST_PUFFS; attempt++)
    {
        const overPool = pools.length > 0 && puffs % 3 === 0;
        const p = overPool ? (() => { const b = pools[puffs % pools.length].points[0]; return { x: b.x + (Math.random() - 0.5) * 80, y: b.y + (Math.random() - 0.5) * 50 }; })() : randomSpot();
        if (!inSwamp(p.x, p.y, 0.45)) continue;
        puffs++;
        const sx = 4 + Math.random() * 4;
        const puff = scene.add.image(p.x, p.y, Tex.Glow)
            .setTint(hexToInt(Math.random() < 0.5 ? '#c9d6bf' : '#b4c6aa'))
            .setScale(sx, sx * 0.45)
            .setAlpha(0)
            .setDepth(MIST_DEPTH);
        const peak = 0.1 + Math.random() * 0.1;
        scene.tweens.add({
            targets: puff, x: p.x + (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 60), y: p.y + (Math.random() - 0.5) * 20,
            duration: 9000 + Math.random() * 8000, delay: Math.random() * 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        scene.tweens.add({
            targets: puff, alpha: { from: peak * 0.35, to: peak },
            duration: 4000 + Math.random() * 4000, delay: Math.random() * 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
    }

    // Fireflies: lime and pale green, over the reeds and between the trees.
    let flies = 0;
    for (let attempt = 0; attempt < FIREFLIES * 20 && flies < FIREFLIES; attempt++)
    {
        const p = randomSpot();
        if (!inSwamp(p.x, p.y, 0.45)) continue;
        flies++;
        firefly(scene, p.x, p.y, ['#d4ff7a', '#b6ff5c', '#e9ffb0']);
    }

    // Glows: the glowing plants (some), lime-glowing mushrooms, and the totems' eyes.
    let glows = 0;
    for (const d of layout.decorations)
    {
        if (d.kind === 'glowPlant' && glows < MAX_PLANT_GLOWS)
        {
            glows++;
            addGlow(scene, d.x, d.y - 6, SWAMP_GLOW_COLORS[d.variant] ?? SWAMP_GLOW_COLORS[0], { scale: 0.4, depth: d.y + 1, duration: 1700 + (d.x % 7) * 150, minAlpha: 0.2, maxAlpha: 0.5 });
        }
        else if (d.kind === 'swampShroom' && d.variant === 0 && (d.x + d.y) % 2 === 0) addGlow(scene, d.x, d.y - 5, SWAMP_GLOW_COLORS[0], { scale: 0.3, depth: d.y + 1, duration: 2200, minAlpha: 0.15, maxAlpha: 0.4 });
        else if (d.kind === 'swampTotem') addGlow(scene, d.x, d.y - 18, SWAMP_GLOW_COLORS[0], { scale: 0.45, depth: d.y + 1, duration: 1300, minAlpha: 0.25, maxAlpha: 0.55 });
    }
}
