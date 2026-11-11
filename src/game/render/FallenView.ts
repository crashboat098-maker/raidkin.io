import { BlendModes, GameObjects, Scene } from 'phaser';
import type { FallenBody } from '../logic/Fallen';
import { GROUND_GLOW_DEPTH } from './Glow';
import { hexToInt, Palette } from './Palette';
import { Tex } from './PlaceholderArt';

/**
 * Bodies of fallen soldiers. A body fades in where the soldier fell, lies
 * still while dormant, and once it can be revived a faint soul glow pulses
 * over it with a tiny wisp bobbing above. It fades out before it expires.
 *
 * Built for big battles: no tweens or timers per body; one loop animates
 * every body, and bodies off screen are hidden and skipped.
 */

interface BodySprites {
    data: FallenBody;
    body: GameObjects.Image;
    glow: GameObjects.Image | null;
    wisp: GameObjects.Image | null;
}

const FADE_IN_MS = 400;
/** Bodies fade out over their last few seconds. */
const FADE_OUT_MS = 6000;
const SOUL = Palette.accentPale.purple;

export class FallenView
{
    private readonly sprites = new Map<number, BodySprites>();

    constructor (private readonly scene: Scene) {}

    get count (): number
    {
        return this.sprites.size;
    }

    /** A soldier fell: its body appears where it stood. */
    add (data: FallenBody): void
    {
        const body = this.scene.add.image(Math.round(data.position.x), Math.round(data.position.y), Tex.fallen(data.colorId))
            .setOrigin(0.5, 1)
            .setFlipX(data.facing < 0)
            .setAlpha(0)
            // Lying on the ground: below anyone standing at the same spot.
            .setDepth(Math.round(data.position.y) - 6);
        // A faint shimmer from the start, so bodies are easy to spot; it brightens once revivable.
        const { x, y } = data.position;
        const glow = this.scene.add.image(Math.round(x), Math.round(y) - 3, Tex.Glow)
            .setTint(hexToInt(SOUL))
            .setBlendMode(BlendModes.ADD)
            .setScale(0.42, 0.28)
            .setAlpha(0)
            .setDepth(GROUND_GLOW_DEPTH); // on the ground, with the other ground glows (see Glow.ts)
        this.sprites.set(data.id, { data, body, glow, wisp: null });
    }

    /** The dormant time is over: show that it can be revived. */
    awaken (data: FallenBody): void
    {
        const s = this.sprites.get(data.id);
        if (!s || s.wisp) return;
        const { x, y } = data.position;
        s.wisp = this.scene.add.image(Math.round(x), Math.round(y) - 9, Tex.wisp('purple'))
            .setAlpha(0)
            .setDepth(Math.round(y) - 4);
    }

    /** Revived (it rises as a soldier of its new army) or faded away. */
    remove (data: FallenBody): void
    {
        const s = this.sprites.get(data.id);
        if (!s) return;
        this.sprites.delete(data.id);
        s.body.destroy();
        s.glow?.destroy();
        s.wisp?.destroy();
    }

    /** Animate every body. Call once per frame. */
    sync (time: number, view: { x: number; y: number; width: number; height: number }): void
    {
        const margin = 24;
        for (const s of this.sprites.values())
        {
            const { x, y } = s.data.position;
            const onScreen = x > view.x - margin && x < view.x + view.width + margin && y > view.y - margin && y < view.y + view.height + margin;
            if (s.body.visible !== onScreen)
            {
                s.body.setVisible(onScreen);
                s.glow?.setVisible(onScreen);
                s.wisp?.setVisible(onScreen);
            }
            if (!onScreen) continue;

            const fadeIn = Math.min(1, (time - s.data.fallenAt) / FADE_IN_MS);
            const fadeOut = Math.min(1, Math.max(0, (s.data.expiresAt - time) / FADE_OUT_MS));
            const alpha = fadeIn * fadeOut;
            s.body.setAlpha(0.92 * alpha);

            // A slow, soft pulse, offset per body so a battlefield of them doesn't blink in unison:
            // a faint shimmer while dormant, a stronger soul glow (and a wisp) once revivable.
            const pulse = 0.5 + 0.5 * Math.sin(time * 0.004 + s.data.id * 1.7);
            if (s.glow) s.glow.setAlpha((s.wisp ? 0.22 + 0.25 * pulse : 0.07 + 0.09 * pulse) * alpha);
            if (s.wisp)
            {
                s.wisp.setAlpha((0.5 + 0.4 * pulse) * alpha);
                s.wisp.setY(Math.round(y) - 9 - Math.round(pulse * 2));
            }
        }
    }
}
