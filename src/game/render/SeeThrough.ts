import { GameObjects } from 'phaser';
import type { Vec2 } from '../logic/Types';

/** When something is hidden behind a tall object, the object fades to this. */
const SEE_THROUGH_ALPHA = 0.4;

interface Occluder {
    sprite: GameObjects.Image;
    x: number;
    baseY: number;
    halfWidth: number;
    top: number;
}

/**
 * Tall objects (structures, big trees) that should turn see-through when any
 * of the local player's soldiers walks behind them.
 *
 * This only helps YOU see your own soldiers. Later, enemies standing behind
 * cover will stay hidden from you, which is what makes cover useful.
 */
export class SeeThroughGroup
{
    private readonly occluders: Occluder[] = [];

    /** Register a sprite whose bottom-centre is (x, baseY) and which covers width x height. */
    add (sprite: GameObjects.Image, x: number, baseY: number, width: number, height: number): void
    {
        this.occluders.push({ sprite, x, baseY, halfWidth: width / 2 + 4, top: baseY - height - 4 });
    }

    /** Fade whatever stands in front of any of `points` (your soldiers' feet). Call every frame. */
    update (points: readonly Vec2[]): void
    {
        for (const o of this.occluders)
        {
            // Off-screen (culled) scenery doesn't need checking.
            if (!o.sprite.visible) continue;
            const isBehind = points.some((p) => p.y < o.baseY && p.y > o.top && Math.abs(p.x - o.x) < o.halfWidth);
            const target = isBehind ? SEE_THROUGH_ALPHA : 1;
            const alpha = o.sprite.alpha;
            if (alpha === target) continue;

            const next = alpha + (target - alpha) * 0.25;
            o.sprite.setAlpha(Math.abs(next - target) < 0.02 ? target : next);
        }
    }
}
