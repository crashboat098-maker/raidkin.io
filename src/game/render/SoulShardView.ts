import { BlendModes, GameObjects, Scene } from 'phaser';
import type { SoulShard } from '../logic/SoulShards';
import { LIGHTS_DEPTH } from './Glow';
import { hexToInt, Palette } from './Palette';
import { Tex } from './PlaceholderArt';
import { Depth } from './BattlefieldView';

interface ShardSprites {
    crystal: GameObjects.Image;
    glow: GameObjects.Image;
    shadow: GameObjects.Image;
    /** Random offset so shards don't all bob in sync. */
    phase: number;
    visible: boolean;
}

/**
 * Draws Soul Shards: a floating crystal, a soft cyan glow and a small shadow.
 * Animation is done here in one loop (no per-shard tweens) to stay cheap.
 */
/** Glow of the rare green crystals. */
const GREEN_GLOW = hexToInt('#5dff8a');

export interface ViewRect { x: number; y: number; width: number; height: number }

/** Is a point within (or just around) the camera's view? */
export function onView (view: ViewRect, x: number, y: number, margin = 32): boolean
{
    return x > view.x - margin && x < view.x + view.width + margin && y > view.y - margin && y < view.y + view.height + margin * 2;
}

export class SoulShardView
{
    private readonly sprites = new Map<number, ShardSprites>();
    private readonly glowColor = hexToInt(Palette.shard.mid);

    constructor (private readonly scene: Scene, shards: readonly SoulShard[])
    {
        for (const shard of shards)
        {
            const shadow = scene.add.image(0, 0, Tex.Shadow).setScale(0.5, 0.6).setAlpha(0.8);
            const green = shard.kind === 'green';
            const glow = scene.add.image(0, 0, Tex.Glow)
                .setTint(green ? GREEN_GLOW : this.glowColor)
                .setBlendMode(BlendModes.ADD)
                .setScale(green ? 0.65 : 0.55);
            const crystal = scene.add.image(0, 0, green ? Tex.SoulShardGreen : Tex.SoulShard).setOrigin(0.5, 1);

            const sprites: ShardSprites = { crystal, glow, shadow, phase: Math.random() * Math.PI * 2, visible: true };
            this.sprites.set(shard.id, sprites);
            this.placeAt(sprites, shard);
            this.setVisible(sprites, shard.active);
        }
    }

    /** Gentle floating and glow pulse. Call every frame. Shards outside `view` aren't drawn. */
    update (time: number, shards: readonly SoulShard[], view?: ViewRect): void
    {
        for (const shard of shards)
        {
            const sprites = this.sprites.get(shard.id);
            if (!sprites || !sprites.visible) continue;
            const onScreen = !view || onView(view, shard.x, shard.y);
            if (sprites.crystal.visible !== onScreen)
            {
                sprites.crystal.setVisible(onScreen);
                sprites.glow.setVisible(onScreen);
                sprites.shadow.setVisible(onScreen);
            }
            if (!onScreen) continue;

            const wave = Math.sin(time * 0.004 + sprites.phase);
            // Whole-pixel bob keeps the pixel art crisp.
            const lift = 2 + Math.round((wave + 1) * 1.5);
            sprites.crystal.y = shard.y - lift;
            sprites.glow.y = shard.y - lift - 5;
            sprites.glow.alpha = 0.4 + wave * 0.15;
        }
    }

    /** Pickup effect, then hide the shard. */
    collected (shard: SoulShard): void
    {
        const sprites = this.sprites.get(shard.id);
        if (!sprites) return;

        const { x, y } = sprites.crystal;

        const green = shard.kind === 'green';
        const flash = this.scene.add.image(x, y - 5, Tex.Glow)
            .setTint(green ? GREEN_GLOW : this.glowColor)
            .setBlendMode(BlendModes.ADD)
            .setScale(0.5)
            .setDepth(Depth.Wisps);
        this.scene.tweens.add({
            targets: flash,
            scale: 1.6,
            alpha: 0,
            duration: 320,
            ease: 'Quad.easeOut',
            onComplete: () => flash.destroy(),
        });

        const ghost = this.scene.add.image(x, y, green ? Tex.SoulShardGreen : Tex.SoulShard).setOrigin(0.5, 1).setDepth(Depth.Wisps);
        this.scene.tweens.add({
            targets: ghost,
            y: y - 14,
            alpha: 0,
            duration: 320,
            ease: 'Quad.easeOut',
            onComplete: () => ghost.destroy(),
        });

        this.setVisible(sprites, false);
    }

    /** Show a shard again at its new position, fading in. */
    respawned (shard: SoulShard): void
    {
        const sprites = this.sprites.get(shard.id);
        if (!sprites) return;

        this.placeAt(sprites, shard);
        this.setVisible(sprites, true);
        sprites.crystal.setAlpha(0);
        this.scene.tweens.add({ targets: sprites.crystal, alpha: 1, duration: 600 });
    }

    private placeAt (sprites: ShardSprites, shard: SoulShard): void
    {
        sprites.shadow.setPosition(shard.x, shard.y).setDepth(shard.y - 0.2);
        sprites.glow.setPosition(shard.x, shard.y - 7).setDepth(LIGHTS_DEPTH); // with the other lights (see Glow.ts)
        sprites.crystal.setPosition(shard.x, shard.y - 2).setDepth(shard.y);
    }

    private setVisible (sprites: ShardSprites, visible: boolean): void
    {
        sprites.visible = visible;
        sprites.crystal.setVisible(visible);
        sprites.glow.setVisible(visible);
        sprites.shadow.setVisible(visible);
    }
}
