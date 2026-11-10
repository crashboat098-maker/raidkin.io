import type { GameConfig as GameConfigType } from '../config/GameConfig';
import { addWarrior, findFreeSpotNear, WARRIOR_BODY, type SoldierRole, type Warrior } from './Army';
import { generateBattlefield, type BattlefieldLayout } from './BattlefieldLayout';
import { botInput, createBotState, isRetreating } from './BotBrain';
import { assignEngagements, regenerate, removeDead, resolveAttacks, type Death, type Hit } from './Combat';
import { FallenField, type FallenBody } from './Fallen';
import { isLava } from './LavaRivers';
import { NeutralForces, type NeutralWarrior } from './Neutrals';
import { ObstacleMap } from './Obstacles';
import { createIdSource, createPlayer, createStartingArmy, type Player } from './Player';
import { allWarriors, nearestCluster, splitArmy, totalSoldiers, updatePlayerArmy } from './PlayerArmy';
import { applyGreenShards, applySoulShards, createPlayerResources } from './PlayerResources';
import { createRng, type Rng } from './Random';
import { SoulShardField, type SoulShard } from './SoulShards';
import type { Vec2 } from './Types';

/**
 * The whole game state and rules for one match, independent of Phaser:
 * the map, Soul Shards, neutral Warriors, and every army (the human player
 * and the bots). The scene feeds in keyboard input and draws the events
 * that come out. This is also the shape a multiplayer server would run.
 */

type Config = typeof GameConfigType;

export interface WorldEvents {
    shardsCollected: SoulShard[];
    shardsRespawned: SoulShard[];
    neutralsRecruited: { neutral: NeutralWarrior; warrior: Warrior; owner: Player }[];
    neutralsRespawned: NeutralWarrior[];
    /** Warriors summoned by Soul Shards. */
    summoned: { warrior: Warrior; owner: Player }[];
    splits: Vec2[];
    merges: Vec2[];
    hits: Hit[];
    deaths: Death[];
    eliminated: Player[];
    /** Players that came back, with their new soldiers. */
    respawned: { player: Player; warriors: Warrior[] }[];
    /** Bodies left by soldiers who fell this frame. */
    bodiesFallen: FallenBody[];
    /** Bodies whose dormant time ended (now recruitable). */
    bodiesAwakened: FallenBody[];
    /** Bodies revived into an army (each body appears here at most once, ever). */
    bodiesRevived: { body: FallenBody; warrior: Warrior; owner: Player }[];
    /** Unclaimed bodies that faded away. */
    bodiesExpired: FallenBody[];
    /** Soldiers that took a lava burn this frame (each only for its own burn). */
    lavaBurns: Warrior[];
}

const BOT_NAMES_START = ['Grim', 'Mor', 'Vel', 'Kar', 'Dra', 'Thal', 'Rav', 'Ash', 'Bryn', 'Sor', 'Ulf', 'Eld', 'Hal', 'Vor'];
const BOT_NAMES_END = ['gar', 'wen', 'dric', 'mont', 'vash', 'thorn', 'ric', 'lyn', 'mar', 'dun', 'helm', 'wyn', 'grim', 'stead'];

export interface WorldOptions {
    /** The human's chosen army name and colour (from the start screen). */
    humanName?: string;
    humanColor?: string;
    /** Override the number of bots (tests). */
    bots?: number;
    /** Soldiers the human starts with (tests). */
    humanSize?: number;
    seed?: number;
}

export class World
{
    readonly layout: BattlefieldLayout;
    readonly obstacles: ObstacleMap;
    readonly shards: SoulShardField;
    readonly neutrals: NeutralForces;
    /** Bodies of fallen soldiers, waiting to be revived. */
    readonly fallen: FallenField;
    readonly players: Player[] = [];
    readonly human: Player;
    readonly nextUnitId: () => number;
    private readonly rng: Rng;

    constructor (private readonly config: Config, options: WorldOptions = {}, botColors: readonly string[] = [])
    {
        this.layout = generateBattlefield(config.world);
        this.obstacles = new ObstacleMap(this.layout.obstacles, this.layout.water, config.water.slowdown);
        this.nextUnitId = createIdSource();
        this.rng = createRng((options.seed ?? config.world.seed) + 7);
        this.shards = new SoulShardField(this.layout, config.soulShards, config.world.seed + 1);
        this.neutrals = new NeutralForces(this.layout, this.obstacles, config.neutrals, config.world.seed + 2, this.nextUnitId);
        this.fallen = new FallenField(config.fallen);

        this.human = createPlayer('you', this.layout.spawn, this.nextUnitId, {
            name: options.humanName ?? 'YOU', kind: 'human', colorId: options.humanColor ?? 'crimson', size: options.humanSize ?? 1,
            maxHp: config.combat.maxHp, obstacles: this.obstacles, bounds: this.layout.playArea,
        });
        this.players.push(this.human);

        const names = new Set<string>();
        const botCount = options.bots ?? config.bots.count;
        for (let i = 0; i < botCount; i++)
        {
            let name = '';
            do name = (BOT_NAMES_START[Math.floor(this.rng() * BOT_NAMES_START.length)] + BOT_NAMES_END[Math.floor(this.rng() * BOT_NAMES_END.length)]).toUpperCase();
            while (names.has(name) || name === this.human.name);
            names.add(name);

            const spawn = this.findSpawnPoint();
            const bot = createPlayer(`bot${i + 1}`, spawn, this.nextUnitId, {
                name, kind: 'bot', colorId: botColors[i % Math.max(1, botColors.length)] ?? `bot${i}`,
                size: config.bots.startingSize, maxHp: config.combat.maxHp, obstacles: this.obstacles, bounds: this.layout.playArea,
            });
            bot.bot = createBotState();
            this.players.push(bot);
        }
    }

    get bots (): Player[]
    {
        return this.players.filter((p) => p.kind === 'bot');
    }

    isAlive (p: Player): boolean
    {
        return p.respawnAt === null;
    }

    /** True once the human's last soldier has died (the human does not respawn). */
    get humanDefeated (): boolean
    {
        return this.human.stats.defeatedAt !== null;
    }

    /** When the match began (the first update). */
    matchStartedAt: number | null = null;

    /**
     * Advance the world by one frame.
     * @param humanInput WASD direction for the human player.
     * @param humanSplit True on the frame SPACE was pressed.
     */
    update (now: number, dt: number, humanInput: Vec2, humanSplit: boolean): WorldEvents
    {
        const c = this.config;
        const events: WorldEvents = {
            shardsCollected: [], shardsRespawned: [], neutralsRecruited: [], neutralsRespawned: [], summoned: [],
            splits: [], merges: [], hits: [], deaths: [], eliminated: [], respawned: [],
            bodiesFallen: [], bodiesAwakened: [], bodiesRevived: [], bodiesExpired: [], lavaBurns: [],
        };

        if (this.matchStartedAt === null)
        {
            this.matchStartedAt = now;
            for (const p of this.players) p.stats.startedAt = now;
        }

        // 1. Bring back eliminated bots whose time has come. (The human never respawns.)
        for (const p of this.players)
        {
            if (p.respawnAt === null || now < p.respawnAt) continue;
            this.respawn(p);
            events.respawned.push({ player: p, warriors: [...allWarriors(p.army)] });
        }
        const living = this.players.filter((p) => this.isAlive(p));

        // 2. Who fights whom this frame (soldiers step toward nearby enemies).
        assignEngagements(living, c.combat, (p) => isRetreating(p, now));

        // 3. Movement: the human from the keyboard, bots from their brains.
        const botView = {
            players: living, shards: this.shards.shards, neutrals: this.neutrals.units, bodies: this.fallen.recruitable(),
            obstacles: this.obstacles, bounds: this.layout.playArea, rng: this.rng,
        };
        for (const p of living)
        {
            let input = humanInput;
            if (p.kind === 'bot') input = botInput(p, botView, now, c.bots);
            else if (humanSplit) events.splits.push(...(splitArmy(p.army, now, this.obstacles, this.layout.playArea, c.army) ?? []));

            const { merges } = updatePlayerArmy(p.army, input, dt, now, this.obstacles, this.layout.playArea, c.army, c.movement);
            events.merges.push(...(p === this.human ? merges : []));
        }

        // 4. Fighting: strikes, deaths, eliminations.
        events.hits = resolveAttacks(living, now, c.combat, this.rng);
        // Lava rivers burn whoever stands in them (each soldier on its own; bridges are safe).
        events.lavaBurns = this.burnInLava(living, now);
        events.deaths = removeDead(living, events.hits);
        // The fallen stay on the battlefield as bodies.
        for (const d of events.deaths)
        {
            events.bodiesFallen.push(this.fallen.add(d.warrior.position, d.owner.colorId, d.warrior.facing < 0 ? -1 : 1, now, d.warrior.role));
        }
        for (const p of living)
        {
            if (totalSoldiers(p.army) > 0) continue;
            // Bots come back after a delay; the human is defeated for good (defeat screen).
            p.respawnAt = p.kind === 'bot' ? now + c.bots.respawnDelayMs : Infinity;
            p.stats.defeatedAt = now;
            events.eliminated.push(p);
        }
        const stillAlive = living.filter((p) => this.isAlive(p));

        // 5. Healing after a long enough break from combat.
        regenerate(stillAlive, now, dt, c.combat);

        // 6. Soul Shards: any soldier collects; every 5 recruit a Warrior (no army size limit).
        //    Rare green crystals have their own progress, and recruit Archers.
        for (const p of stillAlive)
        {
            let blue = 0;
            let green = 0;
            for (const w of allWarriors(p.army))
            {
                const got = this.shards.collectAt(w.position, now);
                for (const s of got) { if (s.kind === 'green') green++; else blue++; }
                events.shardsCollected.push(...got);
            }
            if (blue > 0)
            {
                const recruits = applySoulShards(p.resources, blue, c.army.recruitCost);
                for (let i = 0; i < recruits; i++) events.summoned.push({ warrior: this.summon(p, 'warrior'), owner: p });
            }
            if (green > 0)
            {
                const archers = applyGreenShards(p.resources, green, c.army.archerCost);
                for (let i = 0; i < archers; i++) events.summoned.push({ warrior: this.summon(p, 'archer'), owner: p });
            }
        }

        // 7. Neutral Warriors join whoever reaches them first. A neutral is taken
        //    out of play the moment it is recruited, so it can only ever join once.
        for (const p of stillAlive)
        {
            for (const soldier of [...allWarriors(p.army)])
            {
                const joined = this.neutrals.recruitNear(soldier.position, Infinity, now);
                for (const neutral of joined)
                {
                    const warrior = addWarrior(nearestCluster(p.army, neutral.position), this.nextUnitId(), neutral.position, c.combat.maxHp);
                    events.neutralsRecruited.push({ neutral, warrior, owner: p });
                }
            }
        }

        // 7b. Fallen soldiers: wake bodies whose dormant time is over, then any
        //     soldier standing by a recruitable body revives it into its own army
        //     (full health, the army's colour). A body is removed the moment it
        //     is claimed, so it can only ever be revived once.
        const { awakened, expired } = this.fallen.update(now);
        events.bodiesAwakened = awakened;
        events.bodiesExpired = expired;
        if (this.fallen.recruitableCount > 0)
        {
            for (const p of stillAlive)
            {
                for (const soldier of [...allWarriors(p.army)])
                {
                    for (const body of this.fallen.reviveNear(soldier.position, now))
                    {
                        // A fallen Archer rises as an Archer, a Warrior as a Warrior.
                        const warrior = addWarrior(nearestCluster(p.army, body.position), this.nextUnitId(), body.position, this.maxHpOf(body.role), body.role);
                        events.bodiesRevived.push({ body, warrior, owner: p });
                    }
                    if (this.fallen.recruitableCount === 0) break;
                }
            }
        }

        // Track each army's largest size this run.
        for (const p of stillAlive) p.stats.peakArmy = Math.max(p.stats.peakArmy, totalSoldiers(p.army));

        // 8. Respawns of shards and neutrals, away from every army.
        const everySoldier = stillAlive.flatMap((p) => allWarriors(p.army).map((w) => w.position));
        events.shardsRespawned = this.shards.update(now, everySoldier);
        events.neutralsRespawned = this.neutrals.update(now, dt, this.obstacles, stillAlive.map((p) => p.army.lead.center.position));

        return events;
    }

    /**
     * Every soldier physically standing in a lava river (not on a bridge) loses a
     * little health every `burnIntervalMs`, starting the moment it steps in. Only
     * that soldier is hurt, never the rest of its army, and it doesn't heal while
     * it stands there. (Lava pools are solid, so nobody can stand in those.)
     * A soldier burnt to nothing dies like any other (no killer).
     */
    private burnInLava (players: readonly Player[], now: number): Warrior[]
    {
        const lava = this.layout.lava;
        if (!lava) return [];
        const { burnDamage, burnIntervalMs } = this.config.lava;
        const burnt: Warrior[] = [];
        for (const p of players)
        {
            for (const w of allWarriors(p.army))
            {
                if (!isLava(lava, w.position.x, w.position.y))
                {
                    if (w.nextBurnAt !== 0) w.nextBurnAt = 0;
                    continue;
                }
                w.burningUntil = now + burnIntervalMs;
                if (now < w.nextBurnAt) continue;
                w.hp -= burnDamage;
                w.nextBurnAt = now + burnIntervalMs;
                burnt.push(w);
            }
        }
        return burnt;
    }

    /** A Warrior summoned by Soul Shards appears in the cluster nearest the army's centre. */
    private summon (p: Player, role: SoldierRole): Warrior
    {
        const cluster = nearestCluster(p.army, p.army.lead.center.position);
        const centre = cluster.center.position;
        const spot = findFreeSpotNear(this.obstacles, this.layout.playArea, centre, WARRIOR_BODY, 40) ?? centre;
        return addWarrior(cluster, this.nextUnitId(), spot, this.maxHpOf(role), role);
    }

    private maxHpOf (role: SoldierRole): number
    {
        return role === 'archer' ? this.config.combat.archer.maxHp : this.config.combat.maxHp;
    }

    private respawn (p: Player): void
    {
        const spawn = this.findSpawnPoint(p);
        const size = p.kind === 'bot' ? this.config.bots.respawnSize : 1;
        p.army = createStartingArmy(spawn, this.nextUnitId, {
            size, maxHp: this.config.combat.maxHp, obstacles: this.obstacles, bounds: this.layout.playArea,
        });
        p.respawnAt = null;
        p.lastCombatAt = -Infinity;
        // A fresh run for a respawned bot: new score, no kills or stats carried over.
        p.resources = createPlayerResources();
        p.kills = 0;
        p.stats = { peakArmy: size, startedAt: this.matchStartedAt ?? 0, defeatedAt: null };
        if (p.bot) p.bot = createBotState();
    }

    /** Open ground far from every living army (falls back to any open spot). */
    private findSpawnPoint (except?: Player): Vec2
    {
        const { itemSpawnTiles, tileSize, widthInTiles } = this.layout;
        const others = this.players.filter((p) => p !== except && this.isAlive(p)).flatMap((p) => allWarriors(p.army).map((w) => w.position));
        let fallback: Vec2 = this.layout.spawn;
        for (let attempt = 0; attempt < 60; attempt++)
        {
            const tile = itemSpawnTiles[Math.floor(this.rng() * itemSpawnTiles.length)];
            const p = { x: (tile % widthInTiles) * tileSize + tileSize / 2, y: Math.floor(tile / widthInTiles) * tileSize + tileSize / 2 };
            fallback = p;
            if (others.every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= this.config.bots.spawnClearance)) return p;
        }
        return fallback;
    }
}
