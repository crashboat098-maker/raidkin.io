import { addWarrior, findFreeSpotNear, formationSlots, WARRIOR_BODY } from './Army';
import type { BotState } from './BotBrain';
import type { ObstacleMap } from './Obstacles';
import { createPlayerArmy, type PlayerArmy } from './PlayerArmy';
import { createPlayerResources, type PlayerResources } from './PlayerResources';
import type { Rect, Vec2 } from './Types';

/**
 * Everything that belongs to one army owner: the human player or a bot.
 * Bots are just players whose input comes from BotBrain instead of the keyboard.
 */
export interface Player {
    id: string;
    name: string;
    kind: 'human' | 'bot';
    /** Army colour id (the renderer maps it to actual colours). */
    colorId: string;
    resources: PlayerResources;
    /** The soldiers, in one or more clusters that move together. */
    army: PlayerArmy;
    /**
     * Last time any soldier of this army dealt or took damage. Shared by all
     * of the army's clusters; splitting/merging never touches it.
     */
    lastCombatAt: number;
    /** When an eliminated player comes back (null while alive). */
    respawnAt: number | null;
    /** Enemy soldiers this army has killed (this run). */
    kills: number;
    /** Run statistics (reset when a bot respawns). */
    stats: PlayerStats;
    /** Decision-making state (bots only). */
    bot?: BotState;
}

export interface PlayerStats {
    /** Largest army this run. */
    peakArmy: number;
    /** When this run started (match start, or the bot's respawn). */
    startedAt: number;
    /** When the army was wiped out (null while alive). */
    defeatedAt: number | null;
}

export interface PlayerOptions {
    name?: string;
    kind?: 'human' | 'bot';
    colorId?: string;
    /** Soldiers to start with (default 1). */
    size?: number;
    maxHp?: number;
    /** Needed to place extra starting soldiers on free ground. */
    obstacles?: ObstacleMap;
    bounds?: Rect;
}

/** A new player starts as a single soldier (or `size` soldiers for testing/bots). */
export function createPlayer (id: string, spawn: Vec2, nextUnitId: () => number, options: PlayerOptions = {}): Player
{
    return {
        id,
        name: options.name ?? id,
        kind: options.kind ?? 'human',
        colorId: options.colorId ?? 'crimson',
        resources: createPlayerResources(),
        army: createStartingArmy(spawn, nextUnitId, options),
        lastCombatAt: -Infinity,
        respawnAt: null,
        kills: 0,
        stats: { peakArmy: Math.max(1, options.size ?? 1), startedAt: 0, defeatedAt: null },
    };
}

/** A fresh army of `size` soldiers in formation around `spawn`. */
export function createStartingArmy (spawn: Vec2, nextUnitId: () => number, options: PlayerOptions = {}): PlayerArmy
{
    const army = createPlayerArmy(spawn);
    const cluster = army.clusters[0].cluster;
    const size = Math.max(1, options.size ?? 1);
    const slots = formationSlots(13, Math.max(30, size));
    for (let i = 0; i < size; i++)
    {
        const want = { x: spawn.x + slots[i].x, y: spawn.y + slots[i].y };
        const spot = options.obstacles && options.bounds
            ? findFreeSpotNear(options.obstacles, options.bounds, want, WARRIOR_BODY, 30) ?? spawn
            : (i === 0 ? spawn : want);
        addWarrior(cluster, nextUnitId(), spot, options.maxHp ?? 100);
    }
    return army;
}

/** Hands out unique unit ids (Warriors, neutrals). One per game/world. */
export function createIdSource (): () => number
{
    let next = 1;
    return () => next++;
}
