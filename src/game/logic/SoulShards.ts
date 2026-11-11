import type { BattlefieldLayout } from './BattlefieldLayout';
import { createRng, randRange, type Rng } from './Random';
import type { Vec2 } from './Types';

/** An axis-aligned area, e.g. around an army. */
export interface Box { minX: number; minY: number; maxX: number; maxY: number }

/** The smallest box around some points (null for none). */
export function boxAround (points: readonly { position: Vec2 }[]): Box | null
{
    if (points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { position: p } of points)
    {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY };
}

/**
 * Soul Shards: the collectible resource.
 *
 * A fixed pool of shards is created once. Collecting one deactivates it and
 * schedules it to reappear elsewhere. Nothing is created or destroyed during
 * play, which keeps things cheap and makes syncing over a network simple later
 * (each shard has a stable id).
 */

export interface SoulShard {
    id: number;
    /** Common blue crystals recruit Warriors; rare green ones recruit Archers. */
    kind: 'blue' | 'green';
    /** Ground position in world pixels. */
    x: number;
    y: number;
    active: boolean;
    /** When an inactive shard comes back (milliseconds, game clock). */
    respawnAt: number;
}

export interface SoulShardSettings {
    perMillionSquarePixels: number;
    pickupRadius: number;
    minSpacing: number;
    respawnDelayMs: { min: number; max: number };
    respawnAwayFromPlayers: number;
    /** Share of shards that are green (0..1). */
    greenShare?: number;
}

export class SoulShardField
{
    readonly shards: SoulShard[] = [];
    private readonly rng: Rng;

    constructor (
        private readonly layout: BattlefieldLayout,
        private readonly settings: SoulShardSettings,
        seed: number,
    )
    {
        this.rng = createRng(seed);

        const area = layout.playArea.width * layout.playArea.height;
        const count = Math.round((area / 1_000_000) * settings.perMillionSquarePixels);

        // Every Nth shard is green, evenly through the pool, so they're spread across the map.
        const greenEvery = settings.greenShare ? Math.max(2, Math.round(1 / settings.greenShare)) : 0;
        for (let id = 0; id < count; id++)
        {
            const spot = this.findSpawnPoint([]);
            const kind = greenEvery && id % greenEvery === greenEvery - 1 ? 'green' : 'blue';
            this.shards.push({ id, kind, x: spot.x, y: spot.y, active: true, respawnAt: 0 });
        }
    }

    get activeCount (): number
    {
        return this.shards.reduce((total, shard) => total + (shard.active ? 1 : 0), 0);
    }

    /**
     * Collect every active shard touching `position`.
     * Returns the shards collected this call (usually none, sometimes one).
     */
    collectAt (position: Vec2, now: number, candidates: readonly SoulShard[] = this.shards): SoulShard[]
    {
        const collected: SoulShard[] = [];
        const radiusSquared = this.settings.pickupRadius ** 2;
        const { min, max } = this.settings.respawnDelayMs;

        for (const shard of candidates)
        {
            if (!shard.active) continue;

            const dx = shard.x - position.x;
            const dy = shard.y - position.y;
            if (dx * dx + dy * dy <= radiusSquared)
            {
                shard.active = false;
                shard.respawnAt = now + randRange(this.rng, min, max);
                collected.push(shard);
            }
        }

        return collected;
    }

    /**
     * The active shards close enough to `box` that something inside it could
     * pick them up (in id order, like `shards`). Lets a big army check only the
     * few shards around it instead of every shard on the map.
     */
    activeNear (box: Box): SoulShard[]
    {
        const r = this.settings.pickupRadius;
        return this.shards.filter((s) => s.active && s.x >= box.minX - r && s.x <= box.maxX + r && s.y >= box.minY - r && s.y <= box.maxY + r);
    }

    /**
     * Bring back shards whose respawn time has passed, at a new location
     * away from `players`. Returns the shards that reappeared this call.
     */
    update (now: number, players: readonly Vec2[]): SoulShard[]
    {
        const respawned: SoulShard[] = [];

        for (const shard of this.shards)
        {
            if (shard.active || now < shard.respawnAt) continue;

            const spot = this.findSpawnPoint(players);
            shard.x = spot.x;
            shard.y = spot.y;
            shard.active = true;
            respawned.push(shard);
        }

        return respawned;
    }

    /**
     * Pick a random open ground tile (precomputed by world generation, so it's
     * never inside structures, under decorations, or near the map edge), then
     * nudge randomly within that tile so shards don't line up in a grid.
     */
    private findSpawnPoint (avoid: readonly Vec2[]): Vec2
    {
        const { itemSpawnTiles, tileSize, widthInTiles } = this.layout;
        const minSpacingSquared = this.settings.minSpacing ** 2;
        const avoidSquared = this.settings.respawnAwayFromPlayers ** 2;
        let candidate: Vec2 = { x: 0, y: 0 };

        for (let attempt = 0; attempt < 25; attempt++)
        {
            const tile = itemSpawnTiles[Math.floor(this.rng() * itemSpawnTiles.length)];
            const col = tile % widthInTiles;
            const row = Math.floor(tile / widthInTiles);
            candidate = {
                x: Math.round(col * tileSize + randRange(this.rng, 3, tileSize - 3)),
                y: Math.round(row * tileSize + randRange(this.rng, 4, tileSize - 2)),
            };

            const crowded = this.shards.some((s) => s.active && distanceSquared(s, candidate) < minSpacingSquared);
            const nearPlayer = avoid.some((p) => distanceSquared(p, candidate) < avoidSquared);
            if (!crowded && !nearPlayer) return candidate;
        }

        // Very crowded map: accept the last candidate rather than looping forever.
        return candidate;
    }
}

function distanceSquared (a: Vec2, b: Vec2): number
{
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}
