import { GameObjects, Scene } from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { KeyboardControls } from '../input/KeyboardControls';
import { centroid, type Warrior } from '../logic/Army';
import type { Player } from '../logic/Player';
import type { GameWorld } from '../logic/GameWorld';
import { allWarriors, representative, totalSoldiers } from '../logic/PlayerArmy';
import type { Vec2 } from '../logic/Types';
import { World } from '../logic/World';
import { netClient } from '../net/NetClient';
import { NetWorld } from '../net/NetWorld';
import { addVignette, buildBattlefieldView, fitVignette } from '../render/BattlefieldView';
import { ZoomController } from '../render/CameraZoom';
import { CastleView } from '../render/CastleView';
import { CombatEffects } from '../render/CombatEffects';
import { leaderId, rankPlayers } from '../logic/Leaderboard';
import { FallenView } from '../render/FallenView';
import { botColorsFor, Palette } from '../render/Palette';
import { loadSettings, type PlayerSettings } from './PlayerSettings';
import { ensurePixelFont } from '../render/PixelFont';
import { createPlaceholderTextures, Tex } from '../render/PlaceholderArt';
import { SeeThroughGroup } from '../render/SeeThrough';
import { SoulShardView } from '../render/SoulShardView';
import { packTextures } from '../render/TextureAtlas';
import { buildStructureView } from '../render/StructureView';
import { ViewCuller } from '../render/ViewCuller';
import { ArmyLabels, ArmyMarkers, ArmyView, LeaderCrown, NeutralView, playJoinEffect, type WaterFx } from '../render/UnitViews';
import type { HudData } from './Hud';
import type { DefeatData } from './Defeat';

/**
 * The main playable scene. All game rules live in `World` (pure logic);
 * this scene just feeds it keyboard input and draws what happens:
 *   keyboard  ->  World.update()  ->  events  ->  visuals
 */
/** After your last soldier falls, how long the battlefield stays up before the start menu returns. */
const DEFEAT_PAUSE_MS = 2500;

export class Battlefield extends Scene
{
    private world: GameWorld;
    /** The online match (null in a practice match). */
    private net: NetWorld | null = null;
    /** Views, camera and HUD are set up (online: once the server's starting state arrived). */
    private sceneReady = false;

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
    private culler: ViewCuller;
    private shardView: SoulShardView;
    private castleView: CastleView;
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

        // 2. The match: online on the game server if it's reachable, otherwise a
        //    practice match in this browser (map, resources, neutrals, you and 3 bots).
        this.sceneReady = false;
        this.net = null;
        if (netClient.online)
        {
            this.net = new NetWorld(GameConfig, netClient, this.settings.name, this.settings.color);
            this.world = this.net;
            this.events.once('shutdown', () => this.net?.leave());
            // The rest is set up once the server has sent the starting state (see update).
            return;
        }
        this.world = new World(GameConfig, { humanName: this.settings.name, humanColor: this.settings.color }, botColorsFor(this.settings.color));
        this.setUpMatch();
    }

    /** Views, input, camera and HUD for the match in `this.world`. */
    private setUpMatch (): void
    {
        this.sceneReady = true;
        const { layout } = this.world;

        // 3. Visuals for that world.
        this.seeThrough = new SeeThroughGroup();
        const sceneryFrom = this.children.list.length;
        buildBattlefieldView(this, layout, this.seeThrough);
        buildStructureView(this, layout.structures, this.seeThrough);
        // Only the scenery near the camera is drawn (a huge saving on phones).
        this.culler = new ViewCuller(this, this.children.list.slice(sceneryFrom), layout.worldWidth, layout.worldHeight);
        // Castle circles, banners and panels (made after the culler: they're never culled).
        this.castleView = new CastleView(this, this.world.castles, GameConfig.castles);
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
        // All the art now exists: share it out of atlas pages so sprites batch together.
        packTextures(this.game);

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
        const hudData: HudData = {
            getResources: () => this.world.human.resources,
            getArmySize: () => (this.world.human.respawnAt === null ? totalSoldiers(this.world.human.army) : 0),
            getSplitState: () => this.world.splitState(this.time.now),
            getLeaderboard: () => rankPlayers(this.world.players),
            getMyId: () => this.world.human.id,
            layout: this.world.layout,
            // Only your own army: the minimap never shows other players.
            getMapView: () => {
                const human = this.world.human;
                const army = human.respawnAt !== null ? [] : human.army.clusters
                    .filter((c) => c.cluster.warriors.length > 0)
                    .map((c) => centroid(c.cluster.warriors));
                const v = this.cameras.main.worldView;
                return { army, view: { x: v.x, y: v.y, width: v.width, height: v.height } };
            },
            getNotice: () => {
                if (!this.net?.reconnecting) return null;
                return `CONNECTION LOST - RECONNECTING ${this.net.rejoinSecondsLeft()}`;
            },
            playerColor: this.settings.color,
            recruitCost: GameConfig.army.recruitCost,
            archerCost: GameConfig.army.archerCost,
        };
        this.scene.launch('Hud', hudData);
    }

    update (time: number, delta: number)
    {
        // Online: wait for the server's starting state; give up to the start screen if it goes away.
        if (this.net && (this.net.disconnected || this.net.refused))
        {
            const reason = this.net.refused === 'full' ? 'SERVER FULL' : this.net.refused === 'version' ? 'NEW VERSION - RELOAD THE PAGE' : 'CONNECTION LOST';
            this.scene.stop('Hud');
            this.scene.stop('Defeat');
            this.scene.start('Start', { ...this.settings, notice: reason });
            return;
        }
        if (!this.sceneReady)
        {
            if (this.net?.ready) this.setUpMatch();
            else return;
        }

        // Cap the frame time so a background tab doesn't cause a huge jump.
        const dt = Math.min(delta, 50) / 1000;
        const world = this.world;
        const human = world.human;

        // --- Gameplay (all in World) ---
        const armyAt = human.army.lead.center.position;
        const split = this.controls.consumeSplit(armyAt, human.army.lead.heading);
        const surrender = this.controls.consumeSurrender(armyAt, human.army.lead.heading);
        const events = world.update(time, dt, this.controls.getMoveDirection(armyAt), split, surrender);

        // --- Visuals for what happened ---
        for (const point of events.splits) playJoinEffect(this, point.x, point.y, Palette.accent.purple);
        for (const point of events.merges) playJoinEffect(this, point.x, point.y, Palette.accent.amber);
        // Online only: soldiers already there when you joined, soldiers of players who left,
        // and neutrals coming and going.
        for (const { warrior, owner } of events.appeared ?? []) this.addSoldier(warrior, owner, null);
        for (const warrior of events.vanished ?? []) this.armyView.release(warrior);
        for (const neutral of events.neutralsGone ?? []) this.neutralView.recruited(neutral);
        for (const neutral of events.neutralsAdded ?? []) this.neutralView.add(neutral);
        // A whole army let go at once (its player left): skip the burst per soldier.
        const quietRelease = events.surrendered.length > 8;
        for (const { warrior, neutral } of events.surrendered)
        {
            this.armyView.release(warrior);
            this.neutralView.add(neutral, !quietRelease);
        }
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
        for (const castle of events.castlesCaptured ?? []) this.castleView.captured(castle, (x, y, color) => playJoinEffect(this, x, y, color));
        for (const { player, warriors } of events.respawned)
        {
            for (const w of warriors) this.addSoldier(w, player, Palette.accent.amber);
        }

        const living = world.players.filter((p) => p.respawnAt === null);
        const worldView = this.cameras.main.worldView;
        this.shardView.update(time, world.shards.shards, worldView);
        this.neutralView.sync(world.neutrals.units, time, worldView);
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
        this.castleView.sync(world.castles, time, camera.worldView);
        this.culler.update(camera.worldView);
        // Structures/trees turn see-through only for YOUR soldiers (enemies behind cover stay hidden).
        this.seeThrough.update(human.respawnAt === null ? allWarriors(human.army).map((w) => w.position) : []);
        this.followHuman();

        // The player's last soldier fell: a moment to see it happen, then their
        // stats for the run (kills, largest army, shards, time, rank) over the
        // battlefield, with PLAY AGAIN / CHANGE ARMY.
        if (!this.defeatShown && world.humanDefeated)
        {
            this.defeatShown = true;
            const stats = world.defeatStats(time);
            this.time.delayedCall(DEFEAT_PAUSE_MS, () => {
                const data: DefeatData = { settings: this.settings, ...stats };
                this.scene.launch('Defeat', data);
            });
        }
    }

    /** Show a soldier in its army's colour: a Warrior, a Guardian, or an Archer (with its bow-draw frame). */
    private addSoldier (warrior: Warrior, owner: Player, effectColor: string | null): void
    {
        if (warrior.role === 'archer') this.armyView.add(warrior, Tex.archer(owner.colorId), effectColor, Tex.archerDraw(owner.colorId));
        else if (warrior.role === 'guardian') this.armyView.add(warrior, Tex.guardian(owner.colorId), effectColor);
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
