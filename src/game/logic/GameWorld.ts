import type { BattlefieldLayout } from './BattlefieldLayout';
import type { CastleStatus } from './Castles';
import type { SteerInput } from './Navigation';
import type { NeutralWarrior } from './Neutrals';
import type { ObstacleMap } from './Obstacles';
import type { Player } from './Player';
import type { SoulShard } from './SoulShards';
import type { Vec2 } from './Types';
import type { WorldEvents } from './World';

/**
 * What the Battlefield scene needs from a match. Two things provide it:
 *  - World: the full game running in this browser (practice against bots),
 *  - NetWorld: a mirror of the game running on the server (online play).
 */
export interface GameWorld {
    readonly layout: BattlefieldLayout;
    readonly obstacles: ObstacleMap;
    readonly players: readonly Player[];
    /** The player at this screen. */
    readonly human: Player;
    readonly neutrals: { readonly units: readonly NeutralWarrior[] };
    readonly shards: { readonly shards: readonly SoulShard[] };
    /** The capturable castles (owner, capture progress, Guardians...). */
    readonly castles: readonly CastleStatus[];
    readonly matchStartedAt: number | null;
    readonly humanDefeated: boolean;

    /** Advance one frame with this player's input; returns what happened (for effects). */
    update (now: number, dt: number, input: SteerInput, split: boolean | Vec2 | null, surrender: Vec2 | null): WorldEvents;
    /** The HUD's split segment: null while the army is together. */
    splitState (now: number): { clusters: number; regroupSeconds: number | null } | null;
    /** Numbers for the defeat screen. */
    defeatStats (now: number): DefeatStats;
}

export interface DefeatStats {
    kills: number;
    largestArmy: number;
    shards: number;
    survivalMs: number;
    rank: number;
    competitors: number;
}
