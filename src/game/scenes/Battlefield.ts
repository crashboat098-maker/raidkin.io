import { GameObjects, Scene } from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { KeyboardControls } from '../input/KeyboardControls';
import type { Warrior } from '../logic/Army';
import type { Player } from '../logic/Player';
import { allWarriors, representative, secondsUntilRegroup, totalSoldiers } from '../logic/PlayerArmy';
import type { Vec2 } from '../logic/Types';
import { World } from '../logic/World';
import { addVignette, buildBattlefieldView, fitVignette } from '../render/BattlefieldView';
import { ZoomController } from '../render/CameraZoom';
import { CombatEffects } from '../render/CombatEffects';
import { finalRank, leaderId, rankPlayers } from '../logic/Leaderboard';
import { FallenView } from '../render/FallenView';
import { botColorsFor, Palette } from '../render/Palette';
import type { DefeatData } from './Defeat';
import { loadSettings, type PlayerSettings } from './PlayerSettings';
import { ensurePixelFont } from '../render/PixelFont';
import { createPlaceholderTextures, Tex } from '../render/PlaceholderArt';
import { SeeThroughGroup } from '../render/SeeThrough';
import { SoulShardView } from '../render/SoulShardView';
import { buildStructureView } from '../render/StructureView';
import { ArmyLabels, ArmyMarkers, ArmyView, LeaderCrown, NeutralView, playJoinEffect, type WaterFx } from '../render/UnitViews';
import type { HudData } from './Hud';

/**
 * The main playable scene. All game rules live in `World` (pure logic);
 * this scene just feeds it keyboard input and draws what happens:
 *   keyboard  ->  World.update()  ->  events  ->  visuals
 */
export class Battlefield extends Scene
{
    private world: World;

    private armyView: ArmyView;
    private armyMarkers: ArmyMarkers;
    private combatEffects: CombatEffects;
    private zoom: ZoomController;
    private vignette: GameObjects.Image;
    private waterFx: WaterFx;
    private armyLabels: ArmyLabels;
    private crown: LeaderCrown;
    private fallenView: FallenView;
    private neutralView: NeutralView;
    private seeThrough: SeeThroughGroup;
    private shardView: SoulShardView;
    private controls: KeyboardControls;
    /** What the camera is following (the human army's steering point). */
    private cameraTarget: Vec2 | null = null;
    private settings: PlayerSettings;
    private defeatShown = false;

    constructor ()
    {
        super('Battlefield');
    }

    create (data?: Partial<PlayerSettings>)
    {
        // 1. Visual assets (placeholders drawn in code).
        createPlaceholderTextures(this, GameConfig.world.tileSize);
        ensurePixelFont(this);

        // The player's chosen name and colour (from the start screen, or kept from last match).
        this.settings = data?.name && data.color ? { name: data.name, color: data.color } : loadSettings();
        this.defeatShown = false;
        this.cameraTarget = null;

        // 2. A fresh game world: map, resources, neutrals, the player and 3 bots.
        this.world = new World(GameConfig, { humanName: this.settings.name, humanColor: this.settings.color }, botColorsFor(this.settings.color));
        const { layout } = this.world;

        // 3. Visuals for that world.
        this.seeThrough = new SeeThroughGroup();
        buildBattlefieldView(this, layout, this.seeThrough);
        buildStructureView(this, layout.structures, this.seeThrough);
        this.shardView = new SoulShardView(this, this.world.shards.shards);
        this.fallenView = new FallenView(this);
        this.neutralView = new NeutralView(this, this.world.neutrals.units);
        this.armyView = new ArmyView(this);
        for (const p of this.world.players)
        {
            for (const w of allWarriors(p.army)) this.addSoldier(w, p, null);
        }
        this.armyMarkers = new ArmyMarkers(this);
        this.combatEffects = new CombatEffects(this);
        this.armyLabels = new ArmyLabels(this);
        this.crown = new LeaderCrown(this);

        // 4. Input.
        this.controls = new KeyboardControls(this);

        // 5. Camera: follows the player's army, never shows past the map edge,
        //    and zooms in or out to fit the army's actual size and spread.
        const camera = this.cameras.main;
        this.zoom = new ZoomController(GameConfig.camera, camera.height, GameConfig.camera.zoom);
        camera.setBounds(0, 0, layout.worldWidth, layout.worldHeight);
        camera.setZoom(this.zoom.zoom);
        camera.setRoundPixels(true);
        this.followHuman();
        camera.centerOn(layout.spawn.x, layout.spawn.y);

        this.vignette = addVignette(this);
        this.waterFx = {
            inWater: (x, y) => this.world.obstacles.inWater(x, y),
            splash: (x, y, t) => this.combatEffects.splash(x, y, t),
            ripple: (x, y, t) => this.combatEffects.ripple(x, y, t),
        };

        // 6. HUD runs as a separate scene on top.
        const human = this.world.human;
        const hudData: HudData = {
            getResources: () => human.resources,
            getArmySize: () => (human.respawnAt === null ? totalSoldiers(human.army) : 0),
            getSplitState: () => {
                if (human.respawnAt !== null || human.army.clusters.length <= 1) return null;
                return { clusters: human.army.clusters.length, regroupSeconds: secondsUntilRegroup(human.army, this.time.now) };
            },
            getLeaderboard: () => rankPlayers(this.world.players),
            playerColor: this.settings.color,
            recruitCost: GameConfig.army.recruitCost,
            archerCost: GameConfig.army.archerCost,
        };
        this.scene.launch('Hud', hudData);
    }

    update (time: number, delta: number)
    {
        // Cap the frame time so a background tab doesn't cause a huge jump.
        const dt = Math.min(delta, 50) / 1000;
        const world = this.world;
        const human = world.human;

        // --- Gameplay (all in World) ---
        const split = this.controls.consumeSplitPress();
        const events = world.update(time, dt, this.controls.getMoveDirection(), split);

        // --- Visuals for what happened ---
        for (const point of events.splits) playJoinEffect(this, point.x, point.y, Palette.accent.purple);
        for (const point of events.merges) playJoinEffect(this, point.x, point.y, Palette.accent.amber);
        for (const shard of events.shardsCollected) this.shardView.collected(shard);
        for (const shard of events.shardsRespawned) this.shardView.respawned(shard);
        for (const neutral of events.neutralsRespawned) this.neutralView.respawned(neutral);
        for (const { neutral, warrior, owner } of events.neutralsRecruited)
        {
            this.neutralView.recruited(neutral);
            this.addSoldier(warrior, owner, Palette.accent.amber);
        }
        for (const { warrior, owner } of events.summoned) this.addSoldier(warrior, owner, Palette.accent.purple);
        // Every real strike gets a swing (attacker) and an impact (victim). Off-screen strikes skip the effects.
        const view = this.cameras.main.worldView;
        for (const hit of events.hits)
        {
            const a = hit.attacker.position;
            const t = hit.target.position;
            this.armyView.attack(hit.attacker, hit.target, time);
            this.armyView.hit(hit.target, hit.attacker, time);
            if (a.x < view.x - 24 || a.x > view.right + 24 || a.y < view.y - 24 || a.y > view.bottom + 40) continue;
            if (hit.ranged)
            {
                // An arrow flies to the target; its impact plays when it lands.
                const lands = this.combatEffects.arrow(a.x, a.y, t.x, t.y, time);
                this.combatEffects.impact(t.x, t.y, a.x, a.y, lands);
                continue;
            }
            this.combatEffects.swing(a.x, a.y, t.x, t.y, time);
            this.combatEffects.impact(t.x, t.y, a.x, a.y, time);
        }
        this.combatEffects.update(time);
        // Lava burns: a brief red flash on each soldier that was burnt.
        for (const w of events.lavaBurns) this.armyView.burn(w, time);
        for (const death of events.deaths) this.armyView.remove(death.warrior);
        // Fallen soldiers: bodies appear, become revivable, rise into a new army, or fade away.
        for (const body of events.bodiesFallen) this.fallenView.add(body);
        for (const body of events.bodiesAwakened) this.fallenView.awaken(body);
        for (const body of events.bodiesExpired) this.fallenView.remove(body);
        for (const { body, warrior, owner } of events.bodiesRevived)
        {
            this.fallenView.remove(body);
            this.addSoldier(warrior, owner, Palette.accent.purple);
        }
        for (const { player, warriors } of events.respawned)
        {
            for (const w of warriors) this.addSoldier(w, player, Palette.accent.amber);
        }

        const living = world.players.filter((p) => p.respawnAt === null);
        this.shardView.update(time, world.shards.shards);
        this.neutralView.sync(world.neutrals.units, time);
        // Dynamic zoom: fit the player's whole army (every cluster) on screen.
        const camera = this.cameras.main;
        if (human.respawnAt === null)
        {
            const zoom = this.zoom.update(allWarriors(human.army).map((w) => w.position), human.army.lead.center.position, dt);
            if (zoom !== camera.zoom)
            {
                camera.setZoom(zoom);
                fitVignette(this.vignette, camera.width, camera.height, zoom);
            }
        }

        this.armyView.sync(living.flatMap((p) => allWarriors(p.army)), time, camera.worldView, this.waterFx);
        this.armyMarkers.sync(human.respawnAt === null ? representative(human.army) : null, [], time);
        this.armyLabels.sync(world.players);
        this.crown.sync(world.players, leaderId(rankPlayers(world.players)), time);
        this.fallenView.sync(time, camera.worldView);
        // Structures/trees turn see-through only for YOUR soldiers (enemies behind cover stay hidden).
        this.seeThrough.update(human.respawnAt === null ? allWarriors(human.army).map((w) => w.position) : []);
        this.followHuman();

        // The player's last soldier fell: show the defeat screen (the battle carries on behind it).
        if (!this.defeatShown && world.humanDefeated)
        {
            this.defeatShown = true;
            const defeat: DefeatData = {
                settings: { ...this.settings },
                kills: human.kills,
                largestArmy: human.stats.peakArmy,
                shards: human.resources.soulShards,
                survivalMs: (human.stats.defeatedAt ?? time) - (world.matchStartedAt ?? time),
                rank: finalRank(human, world.players),
                competitors: world.players.length,
            };
            this.scene.launch('Defeat', defeat);
        }
    }

    /** Show a soldier in its army's colour: a Warrior, or an Archer (with its bow-draw frame). */
    private addSoldier (warrior: Warrior, owner: Player, effectColor: string | null): void
    {
        if (warrior.role === 'archer') this.armyView.add(warrior, Tex.archer(owner.colorId), effectColor, Tex.archerDraw(owner.colorId));
        else this.armyView.add(warrior, Tex.warrior(owner.colorId), effectColor);
    }

    /** Keep the camera on the player's army (its steering point changes after a respawn). */
    private followHuman (): void
    {
        const target = this.world.human.army.lead.center.position;
        if (target === this.cameraTarget) return;
        this.cameraTarget = target;
        const { followLerp } = GameConfig.camera;
        this.cameras.main.startFollow(target, true, followLerp, followLerp);
    }
}
