import { findFreeSpotNear, hasClearPath, WARRIOR_BODY } from './Army';
import type { BattlefieldLayout } from './BattlefieldLayout';
import type { ObstacleMap } from './Obstacles';
import { createRng, randInt, randRange, type Rng } from './Random';
import type { Rect, Vec2 } from './Types';

/**
 * Neutral Warriors: peaceful recruits found around the map.
 *  - Wanderers stroll around a small home area on open ground.
 *  - Garrisons stand guard outside barracks.
 * Walking near them recruits them. Each one belongs to a fixed "site" that
 * refills after a cooldown, so locations can't be farmed instantly.
 * Pure logic, no Phaser.
 */

/** 'sylvan': hooded forest folk of the enchanted forest (in its village and roaming the woods). */
export type NeutralKind = 'wanderer' | 'garrison' | 'villager' | 'sylvan' | 'ashen' | 'bogfolk';

export interface NeutralWarrior {
    /** Unit id. A fresh id is given each time the site refills. */
    id: number;
    /** Stable id of the spot this neutral belongs to. */
    siteId: number;
    kind: NeutralKind;
    /** The barracks a garrison guards (undefined for wanderers). */
    structureId?: number;
    home: Vec2;
    position: Vec2;
    velocity: Vec2;
    facing: 1 | -1;
    isMoving: boolean;
    /** False while recruited and waiting to respawn. */
    available: boolean;
    respawnAt: number;
    wanderTarget: Vec2 | null;
    nextWanderAt: number;
    /** How far it strays from home (world px). */
    roam: number;
}

export interface NeutralSettings {
    wanderers: number;
    wanderRadius: number;
    wanderSpeed: number;
    garrisonPerBarracks: { min: number; max: number };
    recruitRange: number;
    respawnDelayMs: { min: number; max: number };
    respawnPlayerClearance: number;
}

/** Wanderer homes keep this far from the starting point and from each other. */
const WANDERER_SPAWN_CLEARANCE = 220;
const WANDERER_SPACING = 140;
/** Where garrison guards stand, relative to the barracks' front-centre. */
const GARRISON_POSTS: Vec2[] = [{ x: -15, y: 16 }, { x: 15, y: 16 }, { x: 0, y: 27 }];
/** Villagers mill about their village square. */
const VILLAGE_ROAM = 10;

export class NeutralForces
{
    readonly units: NeutralWarrior[] = [];
    private readonly rng: Rng;
    private readonly bounds: Rect;

    constructor (
        layout: BattlefieldLayout,
        obstacles: ObstacleMap,
        private readonly settings: NeutralSettings,
        seed: number,
        private readonly nextId: () => number,
    )
    {
        this.rng = createRng(seed);
        this.bounds = layout.playArea;
        let siteId = 0;

        // Guards outside each barracks, on open ground.
        for (const structure of layout.structures)
        {
            if (structure.type !== 'barracks') continue;
            const count = randInt(this.rng, settings.garrisonPerBarracks.min, settings.garrisonPerBarracks.max);
            for (let i = 0; i < count && i < GARRISON_POSTS.length; i++)
            {
                const post = { x: structure.x + GARRISON_POSTS[i].x, y: structure.y + GARRISON_POSTS[i].y };
                const spot = findFreeSpotNear(obstacles, this.bounds, post, WARRIOR_BODY, 20);
                if (spot) this.units.push(this.createUnit(siteId++, 'garrison', spot, structure.id));
            }
        }

        // Villagers: several per village, milling about the village square.
        for (const village of layout.villages ?? [])
        {
            for (const home of village.villagerHomes)
            {
                const spot = findFreeSpotNear(obstacles, this.bounds, home, WARRIOR_BODY, 14);
                if (spot) this.units.push(this.createUnit(siteId++, village.folk ?? 'villager', spot, undefined, VILLAGE_ROAM));
            }
        }

        // Forest folk roaming their biome (homes chosen by the biome generator).
        for (const home of layout.folkHomes ?? [])
        {
            const spot = findFreeSpotNear(obstacles, this.bounds, home, WARRIOR_BODY, 20);
            if (spot) this.units.push(this.createUnit(siteId++, 'sylvan', spot, undefined, settings.wanderRadius));
        }

        // Wanderers on open ground (the same safe tiles shards use).
        const homes: Vec2[] = [];
        const { itemSpawnTiles, tileSize, widthInTiles, spawn } = layout;
        for (let attempt = 0; attempt < settings.wanderers * 40 && homes.length < settings.wanderers; attempt++)
        {
            const tile = itemSpawnTiles[Math.floor(this.rng() * itemSpawnTiles.length)];
            const home = {
                x: (tile % widthInTiles) * tileSize + tileSize / 2,
                y: Math.floor(tile / widthInTiles) * tileSize + tileSize / 2,
            };
            if (distance(home, spawn) < WANDERER_SPAWN_CLEARANCE) continue;
            if (homes.some((h) => distance(h, home) < WANDERER_SPACING)) continue;
            if (!findFreeSpotNear(obstacles, this.bounds, home, WARRIOR_BODY, 0)) continue;
            homes.push(home);
            this.units.push(this.createUnit(siteId++, 'wanderer', home));
        }
    }

    /**
     * Recruit available neutrals within range of `position`, closest first,
     * up to `maxCount`. Those that don't fit stay where they are.
     */
    recruitNear (position: Vec2, maxCount: number, now: number): NeutralWarrior[]
    {
        if (maxCount <= 0) return [];

        const inRange = this.units
            .filter((u) => u.available && distance(u.position, position) <= this.settings.recruitRange)
            .sort((a, b) => distance(a.position, position) - distance(b.position, position))
            .slice(0, maxCount);

        const { min, max } = this.settings.respawnDelayMs;
        for (const unit of inRange)
        {
            unit.available = false;
            unit.respawnAt = now + randRange(this.rng, min, max);
            unit.isMoving = false;
        }
        return inRange;
    }

    /**
     * Wander around and refill empty sites. A site only refills once its
     * cooldown is over AND no player is nearby.
     * Returns the neutrals that reappeared this frame.
     */
    update (now: number, dt: number, obstacles: ObstacleMap, players: readonly Vec2[]): NeutralWarrior[]
    {
        const respawned: NeutralWarrior[] = [];

        for (const unit of this.units)
        {
            if (!unit.available)
            {
                if (now < unit.respawnAt) continue;
                if (players.some((p) => distance(p, unit.home) < this.settings.respawnPlayerClearance))
                {
                    unit.respawnAt = now + 2000; // try again shortly
                    continue;
                }
                this.reset(unit, now);
                unit.id = this.nextId();
                respawned.push(unit);
                continue;
            }

            this.wander(unit, now, dt, obstacles);
        }

        return respawned;
    }

    private wander (unit: NeutralWarrior, now: number, dt: number, obstacles: ObstacleMap): void
    {
        // Guards and villagers stay put-ish; wanderers roam further.
        const isGuard = unit.roam < this.settings.wanderRadius;

        if (!unit.wanderTarget && now >= unit.nextWanderAt)
        {
            const radius = unit.roam;
            const angle = this.rng() * Math.PI * 2;
            const r = this.rng() * radius;
            const target = { x: unit.home.x + Math.cos(angle) * r, y: unit.home.y + Math.sin(angle) * r };
            const reachable = findFreeSpotNear(obstacles, this.bounds, target, WARRIOR_BODY, 0) && hasClearPath(obstacles, unit.position, target);
            if (reachable) unit.wanderTarget = target;
            else unit.nextWanderAt = now + 500;
        }

        if (!unit.wanderTarget)
        {
            unit.velocity.x = 0;
            unit.velocity.y = 0;
            unit.isMoving = false;
            return;
        }

        const dx = unit.wanderTarget.x - unit.position.x;
        const dy = unit.wanderTarget.y - unit.position.y;
        const d = Math.hypot(dx, dy);
        if (d < 1.5)
        {
            unit.wanderTarget = null;
            unit.nextWanderAt = now + (isGuard ? randRange(this.rng, 4000, 9000) : randRange(this.rng, 1500, 4500));
            unit.isMoving = false;
            return;
        }

        const speed = this.settings.wanderSpeed * (isGuard ? 0.6 : 1) * obstacles.speedFactorAt(unit.position.x, unit.position.y);
        unit.velocity.x = (dx / d) * speed;
        unit.velocity.y = (dy / d) * speed;
        const moved = obstacles.move(unit.position, WARRIOR_BODY, unit.velocity.x * dt, unit.velocity.y * dt);
        unit.position.x = moved.x;
        unit.position.y = moved.y;
        if (moved.blockedX && moved.blockedY) unit.wanderTarget = null; // give up on that spot

        if (Math.abs(unit.velocity.x) > 2) unit.facing = unit.velocity.x > 0 ? 1 : -1;
        unit.isMoving = true;
    }

    private createUnit (siteId: number, kind: NeutralKind, home: Vec2, structureId?: number, roam?: number): NeutralWarrior
    {
        const unit: NeutralWarrior = {
            roam: roam ?? (kind === 'garrison' ? 5 : kind === 'villager' ? VILLAGE_ROAM : this.settings.wanderRadius),
            id: this.nextId(),
            siteId, kind, structureId,
            home: { x: home.x, y: home.y },
            position: { x: home.x, y: home.y },
            velocity: { x: 0, y: 0 },
            facing: this.rng() < 0.5 ? 1 : -1,
            isMoving: false,
            available: true,
            respawnAt: 0,
            wanderTarget: null,
            nextWanderAt: 0,
        };
        unit.nextWanderAt = randRange(this.rng, 0, 3000);
        return unit;
    }

    private reset (unit: NeutralWarrior, now: number): void
    {
        unit.available = true;
        unit.position = { x: unit.home.x, y: unit.home.y };
        unit.velocity = { x: 0, y: 0 };
        unit.wanderTarget = null;
        unit.isMoving = false;
        unit.nextWanderAt = now + randRange(this.rng, 1000, 3000);
    }
}

function distance (a: Vec2, b: Vec2): number
{
    return Math.hypot(a.x - b.x, a.y - b.y);
}
