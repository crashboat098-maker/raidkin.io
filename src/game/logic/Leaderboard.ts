import type { Player } from './Player';
import { totalSoldiers } from './PlayerArmy';

/**
 * Live ranking of every competitor. Pure logic so it can be tested.
 * Ranked by current army size, with kills as the tiebreaker.
 */

export interface LeaderboardRow {
    rank: number;
    playerId: string;
    name: string;
    colorId: string;
    soldiers: number;
    kills: number;
    isHuman: boolean;
    /** False while the army is wiped out (waiting to respawn, or defeated). */
    alive: boolean;
}

export function rankPlayers (players: readonly Player[]): LeaderboardRow[]
{
    const rows = players.map((p) => {
        const alive = p.respawnAt === null;
        return {
            rank: 0,
            playerId: p.id,
            name: p.name,
            colorId: p.colorId,
            soldiers: alive ? totalSoldiers(p.army) : 0,
            kills: p.kills,
            isHuman: p.kind === 'human',
            alive,
        };
    });

    // Bigger army first; then more kills; then a stable order by id.
    rows.sort((a, b) => b.soldiers - a.soldiers || b.kills - a.kills || a.playerId.localeCompare(b.playerId));
    rows.forEach((row, i) => { row.rank = i + 1; });
    return rows;
}

/**
 * Who wears the crown: the #1 army on the leaderboard (most living soldiers,
 * kills breaking ties). Nobody while every army is wiped out.
 */
export function leaderId (rows: readonly LeaderboardRow[]): string | null
{
    const top = rows[0];
    return top && top.alive && top.soldiers > 0 ? top.playerId : null;
}

/**
 * Where a defeated player finishes: their best army this run compared with
 * every other competitor's best army this run (kills break ties). Using the
 * peak, not the current size, means the rank reflects how well you did,
 * rather than always being last at the moment of defeat.
 */
export function finalRank (player: Player, players: readonly Player[]): number
{
    const score = (p: Player) => [p.stats.peakArmy, p.kills] as const;
    const [mine, myKills] = score(player);
    let rank = 1;
    for (const other of players)
    {
        if (other === player) continue;
        const [theirs, theirKills] = score(other);
        if (theirs > mine || (theirs === mine && theirKills > myKills)) rank++;
    }
    return rank;
}
