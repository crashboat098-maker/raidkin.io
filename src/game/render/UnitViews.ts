import { BlendModes, GameObjects, Scene } from 'phaser';
import type { Warrior } from '../logic/Army';
import { healthLevel, needsHealthBar } from '../logic/Combat';
import type { NeutralWarrior } from '../logic/Neutrals';
import type { Player } from '../logic/Player';
import { allWarriors } from '../logic/PlayerArmy';
import { Depth } from './BattlefieldView';
import { hexToInt, Palette, type ArmyColor } from './Palette';
import { PIXEL_FONT } from './PixelFont';
import { Tex } from './PlaceholderArt';
import { onView, type ViewRect } from './SoulShardView';

/**
 * Draws Warriors (every army's) and neutral Warriors.
 * Views only read unit data; gameplay never depends on them.
 */

interface UnitSprites {
    body: GameObjects.Image;
    shadow: GameObjects.Image;
    // Combat animation state (plain numbers: no objects created per hit).
    /** Lunge toward the enemy (attacker) or recoil away from it (victim). */
    nudgeStart: number;
    nudgeDuration: number;
    nudgeX: number;
    nudgeY: number;
    /** While fighting, face the enemy instead of the walking direction. */
    faceUntil: number;
    faceDir: number;
    /** Hit flash. */
    flashUntil: number;
    tinted: boolean;
    /** Colour of the current flash (hit red, or lava burn red-orange). */
    flashTint: number;
    /** Wading: in water, with the next ripple due at this time. */
    inWater: boolean;
    nextRippleAt: number;
    /** Archers: the resting and full-draw textures, and when the draw frame ends. */
    restTexture: string | null;
    drawTexture: string | null;
    drawUntil: number;
}

/** What ArmyView needs to show soldiers wading through water. */
export interface WaterFx {
    inWater: (x: number, y: number) => boolean;
    splash: (x: number, y: number, time: number) => void;
    ripple: (x: number, y: number, time: number) => void;
}

/** Combat motion, in world px / ms. */
const LUNGE = { distance: 3.5, duration: 150 };
const RECOIL = { distance: 2, duration: 110 };
const FLASH_MS = 90;
const FACE_MS = 450;

function createUnitSprites (scene: Scene, texture: string, x: number, y: number): UnitSprites
{
    return {
        shadow: scene.add.image(x, y, Tex.Shadow).setScale(0.75, 0.8).setAlpha(0.9),
        body: scene.add.image(x, y, texture).setOrigin(0.5, 1),
        nudgeStart: -Infinity, nudgeDuration: 1, nudgeX: 0, nudgeY: 0,
        faceUntil: -Infinity, faceDir: 1,
        flashUntil: -Infinity, tinted: false, flashTint: HIT_TINT,
        inWater: false, nextRippleAt: 0,
        restTexture: null, drawTexture: null, drawUntil: -Infinity,
    };
}

/** How long an Archer holds the full-draw frame after loosing an arrow (ms). */
const DRAW_MS = 220;

/**
 * Wading: in water a soldier's shadow becomes a ring of disturbed water, it
 * splashes when it steps in, and leaves ripples while it moves.
 */
function syncWading (sprites: UnitSprites, x: number, y: number, isMoving: boolean, time: number, phase: number, water: WaterFx): void
{
    const wet = water.inWater(x, y);
    if (wet !== sprites.inWater)
    {
        sprites.inWater = wet;
        sprites.shadow.setTexture(wet ? Tex.FxWading : Tex.Shadow).setScale(wet ? 1 : 0.75, wet ? 1 : 0.8);
        if (wet) water.splash(x, y, time);
    }
    if (wet && isMoving && time >= sprites.nextRippleAt)
    {
        water.ripple(x, y, time);
        sprites.nextRippleAt = time + 340 + (phase % 7) * 25;
    }
}

function syncUnit (sprites: UnitSprites, x: number, y: number, facing: number, isMoving: boolean, time: number, phase: number): void
{
    // Lunge / recoil: out and back along a half sine.
    let ox = 0;
    let oy = 0;
    const t = (time - sprites.nudgeStart) / sprites.nudgeDuration;
    if (t >= 0 && t < 1)
    {
        const s = Math.sin(Math.PI * t);
        ox = sprites.nudgeX * s;
        oy = sprites.nudgeY * s;
    }

    const px = Math.round(x);
    const py = Math.round(y);
    // 1-pixel march bob, offset per unit so they don't all step in sync.
    const bob = isMoving ? Math.round(Math.abs(Math.sin(time * 0.02 + phase))) : 0;
    const face = time < sprites.faceUntil ? sprites.faceDir : facing;
    sprites.shadow.setPosition(px, py).setDepth(py - 0.1);
    sprites.body.setPosition(Math.round(x + ox), Math.round(y + oy) + 1 - bob).setDepth(py).setFlipX(face < 0);

    // Hit flash.
    const flashing = time < sprites.flashUntil;
    if (flashing !== sprites.tinted)
    {
        sprites.tinted = flashing;
        if (flashing) sprites.body.setTint(sprites.flashTint);
        else sprites.body.clearTint();
    }
}

/** A soft magical burst with sparks flying outward, for units joining an army. */
export function playJoinEffect (scene: Scene, x: number, y: number, color: string): void
{
    const tint = hexToInt(color);
    const flash = scene.add.image(x, y - 6, Tex.Glow)
        .setTint(tint)
        .setBlendMode(BlendModes.ADD)
        .setScale(0.2)
        .setAlpha(0.9)
        .setDepth(Depth.Wisps);
    scene.tweens.add({
        targets: flash, scale: 1.3, alpha: 0, duration: 450, ease: 'Quad.easeOut',
        onComplete: () => flash.destroy(),
    });

    for (let i = 0; i < 6; i++)
    {
        const angle = (i / 6) * Math.PI * 2;
        const spark = scene.add.image(x, y - 6, Tex.wisp('purple')).setDepth(Depth.Wisps);
        scene.tweens.add({
            targets: spark,
            x: x + Math.cos(angle) * 14,
            y: y - 6 + Math.sin(angle) * 10 - 6,
            alpha: 0,
            duration: 500,
            ease: 'Quad.easeOut',
            onComplete: () => spark.destroy(),
        });
    }
}

/** Health bar size in world pixels (it doubles on screen with the camera zoom). */
const BAR = { width: 10, height: 2, aboveFeet: 17 };
const HIT_TINT = hexToInt(Palette.health.low);
/** Lava burns flash a hotter red-orange, a little longer than a sword hit. */
const BURN_TINT = hexToInt('#ff4a1a');
const BURN_FLASH_MS = 160;
const HEALTH_COLORS = {
    high: hexToInt(Palette.health.high),
    mid: hexToInt(Palette.health.mid),
    low: hexToInt(Palette.health.low),
    back: hexToInt(Palette.health.back),
};

/**
 * Every army's Warriors (the player's and the bots'). Also draws health bars,
 * but only above injured soldiers, plus small hit and death effects.
 */
export class ArmyView
{
    private readonly sprites = new Map<number, UnitSprites>();
    private readonly bars: GameObjects.Graphics;

    constructor (private readonly scene: Scene)
    {
        // Above the soldiers, below the floating marker/labels.
        this.bars = scene.add.graphics().setDepth(799_000);
    }

    /** Show a Warrior in its army's colour, optionally with a small magic burst. */
    add (warrior: Warrior, texture: string, effectColor: string | null, drawTexture: string | null = null): void
    {
        const { x, y } = warrior.position;
        const sprites = createUnitSprites(this.scene, texture, x, y);
        if (drawTexture) { sprites.restTexture = texture; sprites.drawTexture = drawTexture; }
        this.sprites.set(warrior.id, sprites);
        if (effectColor)
        {
            sprites.body.setAlpha(0);
            this.scene.tweens.add({ targets: sprites.body, alpha: 1, duration: 300 });
            playJoinEffect(this.scene, x, y, effectColor);
        }
    }

    /** A soldier strikes: it turns to face the enemy and lunges toward it. */
    attack (attacker: Warrior, target: Warrior, time: number): void
    {
        const sprites = this.sprites.get(attacker.id);
        if (!sprites) return;
        const dx = target.position.x - attacker.position.x;
        const dy = target.position.y - attacker.position.y;
        const d = Math.hypot(dx, dy) || 1;
        sprites.nudgeStart = time;
        if (sprites.drawTexture)
        {
            // An Archer: draw the bow (full-draw frame) and rock back a touch as the arrow flies.
            sprites.nudgeDuration = RECOIL.duration;
            sprites.nudgeX = -(dx / d) * 1.5;
            sprites.nudgeY = -(dy / d) * 1.5;
            sprites.drawUntil = time + DRAW_MS;
            sprites.body.setTexture(sprites.drawTexture);
        }
        else
        {
            sprites.nudgeDuration = LUNGE.duration;
            sprites.nudgeX = (dx / d) * LUNGE.distance;
            sprites.nudgeY = (dy / d) * LUNGE.distance;
        }
        if (Math.abs(dx) > 0.5) sprites.faceDir = dx > 0 ? 1 : -1;
        sprites.faceUntil = time + FACE_MS;
    }

    /** A strike landed on this soldier: a quick flash and a small knock back. */
    hit (target: Warrior, attacker: Warrior, time: number): void
    {
        const sprites = this.sprites.get(target.id);
        if (!sprites) return;
        sprites.flashUntil = time + FLASH_MS;
        sprites.flashTint = HIT_TINT;
        // Don't cut short the victim's own lunge if it's mid-swing.
        if (time - sprites.nudgeStart < sprites.nudgeDuration && sprites.nudgeDuration === LUNGE.duration) return;
        const dx = target.position.x - attacker.position.x;
        const dy = target.position.y - attacker.position.y;
        const d = Math.hypot(dx, dy) || 1;
        sprites.nudgeStart = time;
        sprites.nudgeDuration = RECOIL.duration;
        sprites.nudgeX = (dx / d) * RECOIL.distance;
        sprites.nudgeY = (dy / d) * RECOIL.distance;
    }

    /** A soldier is burnt by lava: a brief red-orange flash (just that soldier). */
    burn (warrior: Warrior, time: number): void
    {
        const sprites = this.sprites.get(warrior.id);
        if (!sprites) return;
        sprites.flashUntil = time + BURN_FLASH_MS;
        sprites.flashTint = BURN_TINT;
        sprites.tinted = false; // re-apply the tint even if a hit flash was showing
    }

    /** A soldier died: it sinks and fades away. */
    /** A soldier left the army alive (surrendered): its neutral sprite takes over on the spot. */
    release (warrior: Warrior): void
    {
        const sprites = this.sprites.get(warrior.id);
        if (!sprites) return;
        this.sprites.delete(warrior.id);
        sprites.body.destroy();
        sprites.shadow.destroy();
    }

    remove (warrior: Warrior): void
    {
        const sprites = this.sprites.get(warrior.id);
        if (!sprites) return;
        this.sprites.delete(warrior.id);
        sprites.body.setTint(0x777777);
        this.scene.tweens.add({
            targets: [sprites.body, sprites.shadow],
            alpha: 0,
            y: '+=2',
            duration: 400,
            onComplete: () => { sprites.body.destroy(); sprites.shadow.destroy(); },
        });
    }

    /**
     * Update every soldier's sprite. Soldiers outside `view` (the camera's
     * visible area) are hidden and skipped, so huge armies elsewhere on the
     * map cost almost nothing to draw.
     */
    sync (warriors: readonly Warrior[], time: number, view?: { x: number; y: number; width: number; height: number }, water?: WaterFx): void
    {
        const g = this.bars.clear();
        const margin = 24;
        for (const w of warriors)
        {
            const sprites = this.sprites.get(w.id);
            if (!sprites) continue;

            const onScreen = !view || (
                w.position.x > view.x - margin && w.position.x < view.x + view.width + margin &&
                w.position.y > view.y - margin && w.position.y < view.y + view.height + margin * 2
            );
            if (sprites.body.visible !== onScreen)
            {
                sprites.body.setVisible(onScreen);
                sprites.shadow.setVisible(onScreen);
            }
            if (!onScreen) continue;

            syncUnit(sprites, w.position.x, w.position.y, w.facing, w.isMoving, time, w.id);
            if (sprites.restTexture && sprites.drawUntil !== -Infinity && time >= sprites.drawUntil)
            {
                sprites.body.setTexture(sprites.restTexture);
                sprites.drawUntil = -Infinity;
            }
            if (water) syncWading(sprites, w.position.x, w.position.y, w.isMoving, time, w.id, water);

            // Health bar only while injured (hidden at full health and on death).
            if (!needsHealthBar(w)) continue;
            const x = Math.round(w.position.x) - BAR.width / 2;
            const y = Math.round(w.position.y) - BAR.aboveFeet;
            const filled = Math.max(1, Math.round((w.hp / w.maxHp) * BAR.width));
            g.fillStyle(HEALTH_COLORS.back, 0.85).fillRect(x - 1, y - 1, BAR.width + 2, BAR.height + 2);
            g.fillStyle(HEALTH_COLORS[healthLevel(w)], 1).fillRect(x, y, filled, BAR.height);
        }
    }
}

/** Name tags floating above every army (yours included), in the army's colour. */
export class ArmyLabels
{
    private readonly labels = new Map<string, GameObjects.BitmapText>();

    constructor (private readonly scene: Scene) {}

    sync (players: readonly Player[]): void
    {
        for (const p of players)
        {
            let label = this.labels.get(p.id);
            if (!label)
            {
                const colors = Palette.armies[p.colorId as ArmyColor] ?? Palette.armies.crimson;
                label = this.scene.add.bitmapText(0, 0, PIXEL_FONT, p.name)
                    .setOrigin(0.5, 1)
                    .setTint(hexToInt(colors.main))
                    .setDepth(850_000);
                this.labels.set(p.id, label);
            }
            const warriors = allWarriors(p.army);
            const alive = p.respawnAt === null && warriors.length > 0;
            label.setVisible(alive);
            if (!alive) continue;

            // Just above the army's topmost soldier.
            const lead = p.army.lead.center.position;
            const top = Math.min(...warriors.map((w) => w.position.y));
            label.setPosition(Math.round(lead.x), Math.round(top) - 18);
        }
    }
}

/**
 * A small golden crown floating above the army ranked #1 on the leaderboard,
 * just over its name tag. When another army takes the lead the crown pops
 * over to it.
 */
export class LeaderCrown
{
    private readonly crown: GameObjects.Image;
    private leader: string | null = null;
    private poppedAt = -Infinity;

    constructor (scene: Scene)
    {
        this.crown = scene.add.image(0, 0, Tex.Crown).setOrigin(0.5, 1).setDepth(850_001).setVisible(false);
    }

    /** Which player wears the crown right now (null = nobody). */
    get wearer (): string | null
    {
        return this.leader;
    }

    sync (players: readonly Player[], leaderId: string | null, time: number): void
    {
        const leader = leaderId ? players.find((p) => p.id === leaderId) : undefined;
        const warriors = leader && leader.respawnAt === null ? allWarriors(leader.army) : [];
        if (!leader || warriors.length === 0)
        {
            this.leader = null;
            this.crown.setVisible(false);
            return;
        }
        if (leader.id !== this.leader)
        {
            this.leader = leader.id;
            this.poppedAt = time;
        }

        // Above the name tag (which sits 18 px over the topmost soldier), bobbing gently.
        const lead = leader.army.lead.center.position;
        let top = Infinity;
        for (const w of warriors) if (w.position.y < top) top = w.position.y;
        const bob = Math.round(Math.sin(time * 0.003));
        this.crown.setPosition(Math.round(lead.x), Math.round(top) - 27 + bob).setVisible(true);

        // A quick pop when the crown changes hands.
        const t = Math.min(1, (time - this.poppedAt) / 260);
        this.crown.setScale(0.3 + 0.7 * t + 0.3 * Math.sin(t * Math.PI));
    }
}

/** A detached group that is holding its ground (gets a banner). */
export interface HoldingGroupMarker {
    id: number;
    x: number;
    y: number;
}

/**
 * Small markers for the player's army: an amber chevron over the
 * representative soldier (cosmetic, so you can spot your army), and a crimson
 * banner planted where each detached group holds its ground.
 */
export class ArmyMarkers
{
    private readonly marker: GameObjects.Image;
    private readonly banners = new Map<number, GameObjects.Image>();

    constructor (private readonly scene: Scene)
    {
        // Drawn above units and decorations (but below floating wisps).
        this.marker = scene.add.image(0, 0, Tex.CommanderMarker).setOrigin(0.5, 1).setDepth(800_000).setVisible(false);
    }

    sync (representative: Warrior | null, holding: readonly HoldingGroupMarker[], time: number): void
    {
        if (representative)
        {
            const hover = Math.round(Math.sin(time * 0.005));
            this.marker.setVisible(true).setPosition(Math.round(representative.position.x), Math.round(representative.position.y) - 16 + hover);
        }
        else
        {
            this.marker.setVisible(false);
        }

        // One banner per holding group; pulled up when the group marches back.
        const live = new Set<number>();
        for (const group of holding)
        {
            live.add(group.id);
            let banner = this.banners.get(group.id);
            if (!banner)
            {
                // Planted instantly when the group splits off.
                banner = this.scene.add.image(0, 0, Tex.TeamBanner).setOrigin(0.15, 1);
                this.banners.set(group.id, banner);
            }
            const x = Math.round(group.x);
            const y = Math.round(group.y);
            banner.setPosition(x, y).setDepth(y);
        }
        for (const [id, banner] of this.banners)
        {
            if (live.has(id)) continue;
            this.banners.delete(id);
            this.scene.tweens.add({ targets: banner, alpha: 0, duration: 250, onComplete: () => banner.destroy() });
        }
    }
}

/** How see-through a surrendered soldier looks while nobody can recruit it yet. */
const SURRENDER_WAIT_ALPHA = 0.45;

/** Neutral Warriors waiting to be recruited. Keyed by site, since sites refill. */
export class NeutralView
{
    private readonly sprites = new Map<number, UnitSprites>();

    constructor (private readonly scene: Scene, units: readonly NeutralWarrior[])
    {
        for (const unit of units)
        {
            const texture = unit.kind === 'sylvan' ? Tex.Sylvan : unit.kind === 'ashen' ? Tex.Ashen : unit.kind === 'bogfolk' ? Tex.Bogfolk : Tex.NeutralWarrior;
            const sprites = createUnitSprites(scene, texture, unit.position.x, unit.position.y);
            this.sprites.set(unit.siteId, sprites);
            this.setVisible(sprites, unit.available);
        }
    }

    /** A soldier that just surrendered: it appears as a plain neutral, faded until it can be recruited. */
    add (unit: NeutralWarrior, effect = true): void
    {
        const sprites = createUnitSprites(this.scene, Tex.NeutralWarrior, unit.position.x, unit.position.y);
        this.sprites.set(unit.siteId, sprites);
        sprites.body.setAlpha(SURRENDER_WAIT_ALPHA);
        if (effect) playJoinEffect(this.scene, unit.position.x, unit.position.y, Palette.stone.light);
    }

    /** Hide a neutral that just joined an army (a surrendered one is gone for good). */
    recruited (unit: NeutralWarrior): void
    {
        const sprites = this.sprites.get(unit.siteId);
        if (!sprites) return;
        if (unit.kind !== 'surrendered') { this.setVisible(sprites, false); return; }
        this.sprites.delete(unit.siteId);
        sprites.body.destroy();
        sprites.shadow.destroy();
    }

    /** Fade a neutral back in when its site refills. */
    respawned (unit: NeutralWarrior): void
    {
        const sprites = this.sprites.get(unit.siteId);
        if (!sprites) return;
        this.setVisible(sprites, true);
        sprites.body.setAlpha(0);
        this.scene.tweens.add({ targets: sprites.body, alpha: 1, duration: 800 });
    }

    sync (units: readonly NeutralWarrior[], time: number, view?: ViewRect): void
    {
        for (const unit of units)
        {
            if (!unit.available) continue;
            const sprites = this.sprites.get(unit.siteId);
            if (!sprites) continue;
            // Off-screen neutrals aren't drawn.
            const onScreen = !view || onView(view, unit.position.x, unit.position.y);
            if (sprites.body.visible !== onScreen) this.setVisible(sprites, onScreen);
            if (!onScreen) continue;
            syncUnit(sprites, unit.position.x, unit.position.y, unit.facing, unit.isMoving, time, unit.siteId);
            // A surrendered soldier fades in fully the moment it can be recruited.
            if (unit.recruitableAt > 0) sprites.body.setAlpha(time < unit.recruitableAt ? SURRENDER_WAIT_ALPHA : 1);
        }
    }

    private setVisible (sprites: UnitSprites, visible: boolean): void
    {
        sprites.body.setVisible(visible);
        sprites.shadow.setVisible(visible);
    }
}
