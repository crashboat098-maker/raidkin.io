import type { GameConfig as GameConfigType } from '../config/GameConfig';
import { addWarrior, findFreeSpotNear, WARRIOR_BODY, type Cluster, type SoldierRole, type Warrior } from './Army';
import { generateBattlefield, type BattlefieldLayout } from './BattlefieldLayout';
import { botInput, createBotState, isRetreating } from './BotBrain';
import { assignEngagements, regenerate, removeDead, resolveAttacks, type Death, type Hit } from './Combat';
import { FallenField, type FallenBody } from './Fallen';
import { isLava } from './LavaRivers';
import { NeutralForces, type NeutralWarrior } from './Neutrals';
import { ObstacleMap } from './Obstacles';
import { createIdSource, createPlayer, createStartingArmy, type Player } from './Player';
import type { DefeatStats, GameWorld } from './GameWorld';
import { finalRank } from './Leaderboard';
import { allWarriors, nearestCluster, secondsUntilRegroup, splitArmy, totalSoldiers, updatePlayerArmy } from './PlayerArmy';
import { applyGreenShards, applySoulShards, createPlayerResources } from './PlayerResources';
import { createRng, type Rng } from './Random';
import { SoulShardField, type SoulShard } from './SoulShards';
import type { Rect, Vec2 } from './Types';

/**
 * The whole game state and rules for one match, independent of Phaser:
 * the map, Soul Shards, neutral Warriors, and every army (the human player
 * and the bots). The scene feeds in keyboard input and draws the events
 * that come out. This is also the shape a multiplayer server would run.
 */

type Config = typeof GameConfigType;

/** The dark canopy at the map edge is always at least this many tiles deep (see buildGround). */
const MIN_CANOPY_TILES = 2;

/** Where armies can walk: right up to the dark forest canopy at the map edge. */
export function movementBounds (layout: BattlefieldLayout): Rect
{
    const edge = MIN_CANOPY_TILES * layout.tileSize;
    return { x: edge, y: edge, width: layout.worldWidth - edge * 2, height: layout.worldHeight - edge * 2 };
}

export interface WorldEvents {
    shardsCollected: SoulShard[];
    shardsRespawned: SoulShard[];
    neutralsRecruited: { neutral: NeutralWarrior; warrior: Warrior; owner: Player }[];
    neutralsRespawned: NeutralWarrior[];
    /** Warriors summoned by Soul Shards. */
    summoned: { warrior: Warrior; owner: Player }[];
    splits: Vec2[];
    merges: Vec2[];
    /** Soldiers that left their army and turned neutral this frame. */
    surrendered: { warrior: Warrior; neutral: NeutralWarrior }[];
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

    // Only from online play (NetWorld), where the server reports what happened:
    /** Soldiers already there when you joined (shown without an effect). */
    appeared?: { warrior: Warrior; owner: Player }[];
    /** Soldiers that left without dying (their player left the game). */
    vanished?: Warrior[];
    /** Neutrals that just joined an army (their new soldier arrives separately). */
    neutralsGone?: NeutralWarrior[];
    /** Neutrals that appeared (a surrendered soldier whose release wasn't seen). */
    neutralsAdded?: NeutralWarrior[];
}

const BOT_NAMES_START = ['Grim', 'Mor', 'Vel', 'Kar', 'Dra', 'Thal', 'Rav', 'Ash', 'Bryn', 'Sor', 'Ulf', 'Eld', 'Hal', 'Vor'];
const BOT_NAMES_END = ['gar', 'wen', 'dric', 'mont', 'vash', 'thorn', 'ric', 'lyn', 'mar', 'dun', 'helm', 'wyn', 'grim', 'stead'];

/** One frame of a human player's input. */
export interface PlayerCommand {
    /** Movement direction, each axis -1..1. */
    move: Vec2;
    /** Split this frame: the direction to split toward, or true for the army's heading. */
    split: boolean | Vec2 | null;
    /** Surrender a soldier this frame, sent in this direction. */
    surrender: Vec2 | null;
}

/** Soldiers left behind by a player who quit can be collected after this short pause (ms). */
const LEFT_ARMY_GRACE_MS = 1000;

const IDLE_COMMAND: PlayerCommand = { move: { x: 0, y: 0 }, split: null, surrender: null };

export interface WorldOptions {
    /** The human's chosen army name and colour (from the start screen). */
    humanName?: string;
    humanColor?: string;
    /**
     * False on a game server: no local human takes part (`human` exists but is
     * never in `players`); people join with `addHuman` instead. Default true.
     */
    localHuman?: boolean;
    /** Override the number of bots (tests). */
    bots?: number;
    /** Soldiers the human starts with (tests). */
    humanSize?: number;
    seed?: number;
}

export class World implements GameWorld
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
    /**
     * Where armies can walk: right up to the dark forest canopy at the map edge
     * (drawn 2-4 tiles deep), so they can touch the visible edge. Wider than
     * `layout.playArea`, which still decides where things spawn.
     */
    readonly moveBounds: Rect;
    private readonly rng: Rng;

    constructor (private readonly config: Config, options: WorldOptions = {}, botColors: readonly string[] = [])
    {
        this.layout = generateBattlefield(config.world);
        this.obstacles = new ObstacleMap(this.layout.obstacles, this.layout.water, config.water.slowdown);
        this.moveBounds = movementBounds(this.layout);
        this.nextUnitId = createIdSource();
        this.rng = createRng((options.seed ?? config.world.seed) + 7);
        this.shards = new SoulShardField(this.layout, config.soulShards, config.world.seed + 1);
        this.neutrals = new NeutralForces(this.layout, this.obstacles, config.neutrals, config.world.seed + 2, this.nextUnitId);
        this.fallen = new FallenField(config.fallen);

        this.human = createPlayer('you', this.layout.spawn, this.nextUnitId, {
            name: options.humanName ?? 'YOU', kind: 'human', colorId: options.humanColor ?? 'crimson', size: options.humanSize ?? 1,
            maxHp: config.combat.maxHp, obstacles: this.obstacles, bounds: this.layout.playArea,
        });
        if (options.localHuman !== false) this.players.push(this.human);

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
            // Each bot has its own size cap (by order: the 1st bot, the 2nd, ...).
            bot.bot = createBotState(config.bots.maxSoldiers[i] ?? Infinity);
            this.players.push(bot);
        }
    }

    private nextHumanId = 1;

    /** Someone joins (online) at time `now`: a new one-soldier army far from everyone else. */
    addHuman (name: string, colorId: string, now: number): Player
    {
        const p = createPlayer(`h${this.nextHumanId++}`, this.findSpawnPoint(), this.nextUnitId, {
            name, kind: 'human', colorId, size: 1,
            maxHp: this.config.combat.maxHp, obstacles: this.obstacles, bounds: this.layout.playArea,
        });
        p.stats.startedAt = now;
        this.players.push(p);
        return p;
    }

    /**
     * Someone left: their army leaves the battlefield, but its soldiers stay
     * behind as neutrals, right where they stood, for anyone to collect.
     * Returns the released soldiers (and the neutral each became).
     */
    removePlayer (p: Player, now = 0): { warrior: Warrior; neutral: NeutralWarrior }[]
    {
        const index = this.players.indexOf(p);
        if (index >= 0) this.players.splice(index, 1);
        if (!this.isAlive(p)) return [];

        const released: { warrior: Warrior; neutral: NeutralWarrior }[] = [];
        for (const warrior of allWarriors(p.army))
        {
            if (warrior.hp <= 0) continue;
            const neutral = this.neutrals.addSurrendered(warrior.position, warrior.position, warrior.role, now + LEFT_ARMY_GRACE_MS, this.obstacles);
            neutral.facing = warrior.facing;
            released.push({ warrior, neutral });
        }
        for (const { cluster } of p.army.clusters) cluster.warriors = [];
        return released;
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

    splitState (now: number): { clusters: number; regroupSeconds: number | null } | null
    {
        const army = this.human.army;
        if (this.human.respawnAt !== null || army.clusters.length <= 1) return null;
        return { clusters: army.clusters.length, regroupSeconds: secondsUntilRegroup(army, now, this.config.army) };
    }

    defeatStats (now: number): DefeatStats
    {
        const human = this.human;
        return {
            kills: human.kills,
            largestArmy: human.stats.peakArmy,
            shards: human.resources.soulShards,
            survivalMs: (human.stats.defeatedAt ?? now) - (this.matchStartedAt ?? now),
            rank: finalRank(human, this.players),
            competitors: this.players.length,
        };
    }

    /**
     * Advance the world by one frame.
     * @param humanInput WASD direction for the human player.
     * @param humanSplit On the frame SPACE was pressed: the direction to split
     *   toward (the mouse), or true for the way the army is heading.
     * @param humanSurrenderAim On the frame the human surrenders a soldier: the
     *   direction to send it (toward the mouse). Null otherwise.
     * @param commands What every other human player (online) does this frame.
     */
    update (
        now: number, dt: number, humanInput: Vec2, humanSplit: boolean | Vec2 | null, humanSurrenderAim: Vec2 | null = null,
        commands?: ReadonlyMap<Player, PlayerCommand>,
    ): WorldEvents
    {
        const c = this.config;
        const events: WorldEvents = {
            shardsCollected: [], shardsRespawned: [], neutralsRecruited: [], neutralsRespawned: [], summoned: [],
            splits: [], merges: [], surrendered: [], hits: [], deaths: [], eliminated: [], respawned: [],
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
        const surrenders: [Player, Vec2][] = [];
        for (const p of living)
        {
            // The local human plays from the arguments; other humans (online) from `commands`.
            const command: PlayerCommand = p === this.human
                ? { move: humanInput, split: humanSplit, surrender: humanSurrenderAim }
                : commands?.get(p) ?? IDLE_COMMAND;
            let input = command.move;
            if (p.kind === 'bot') input = botInput(p, botView, now, c.bots);
            else
            {
                if (command.split)
                {
                    const aim = typeof command.split === 'object' ? command.split : null;
                    events.splits.push(...(splitArmy(p.army, now, this.obstacles, this.moveBounds, c.army, aim) ?? []));
                }
                if (command.surrender) surrenders.push([p, command.surrender]);
            }

            const { merges } = updatePlayerArmy(p.army, input, dt, now, this.obstacles, this.moveBounds, c.army, c.movement);
            if (p.kind === 'human') events.merges.push(...merges);
        }
        for (const [p, aim] of surrenders)
        {
            const released = this.surrender(p, aim, now);
            if (released) events.surrendered.push(released);
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
        //    A bot at its size cap leaves shards and recruits for everyone else.
        for (const p of stillAlive)
        {
            if (this.roomToGrow(p) <= 0) continue;
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
                const recruits = Math.min(applySoulShards(p.resources, blue, c.army.recruitCost), this.roomToGrow(p));
                for (let i = 0; i < recruits; i++) events.summoned.push({ warrior: this.summon(p, 'warrior'), owner: p });
            }
            if (green > 0)
            {
                const archers = Math.min(applyGreenShards(p.resources, green, c.army.archerCost), this.roomToGrow(p));
                for (let i = 0; i < archers; i++) events.summoned.push({ warrior: this.summon(p, 'archer'), owner: p });
            }
        }

        // 7. Neutral Warriors join whoever reaches them first. A neutral is taken
        //    out of play the moment it is recruited, so it can only ever join once.
        for (const p of stillAlive)
        {
            for (const soldier of [...allWarriors(p.army)])
            {
                const room = this.roomToGrow(p);
                if (room <= 0) break;
                const joined = this.neutrals.recruitNear(soldier.position, room, now);
                for (const neutral of joined)
                {
                    const warrior = addWarrior(nearestCluster(p.army, neutral.position), this.nextUnitId(), neutral.position, this.maxHpOf(neutral.role), neutral.role);
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
                    const room = this.roomToGrow(p);
                    if (room <= 0) break;
                    for (const body of this.fallen.reviveNear(soldier.position, now, room))
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

    /**
     * One soldier leaves the army: the one furthest out on the side the
     * player is aiming at. It turns neutral and walks off in that direction.
     * An army never gives up its last soldier.
     */
    private surrender (p: Player, aim: Vec2, now: number): { warrior: Warrior; neutral: NeutralWarrior } | null
    {
        if (totalSoldiers(p.army) <= 1) return null;
        const length = Math.hypot(aim.x, aim.y);
        const dir = length > 0.001 ? { x: aim.x / length, y: aim.y / length } : { ...p.army.lead.heading };

        const from = p.army.lead.center.position;
        let pick: { cluster: Cluster; warrior: Warrior } | null = null;
        let best = -Infinity;
        for (const { cluster } of p.army.clusters)
        {
            for (const w of cluster.warriors)
            {
                const ahead = (w.position.x - from.x) * dir.x + (w.position.y - from.y) * dir.y;
                if (ahead > best) { best = ahead; pick = { cluster, warrior: w }; }
            }
        }
        if (!pick) return null;

        const { cluster, warrior } = pick;
        cluster.warriors = cluster.warriors.filter((w) => w !== warrior);
        const reach = this.config.neutrals.surrender.releaseDistance;
        const wanted = { x: warrior.position.x + dir.x * reach, y: warrior.position.y + dir.y * reach };
        const destination = findFreeSpotNear(this.obstacles, this.moveBounds, wanted, WARRIOR_BODY, 30) ?? { ...warrior.position };
        const neutral = this.neutrals.addSurrendered(warrior.position, destination, warrior.role, now + this.config.fallen.dormantMs, this.obstacles);
        neutral.facing = dir.x < 0 ? -1 : 1;
        return { warrior, neutral };
    }

    /** How many more soldiers this army may gain (bots stop at their cap; humans never do). */
    private roomToGrow (p: Player): number
    {
        return p.bot ? p.bot.maxSoldiers - totalSoldiers(p.army) : Infinity;
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
        if (p.bot) p.bot = createBotState(p.bot.maxSoldiers);
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
