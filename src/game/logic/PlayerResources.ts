/**
 * What a player has collected. Pure data plus simple rules.
 * Only one currency for now: Soul Shards.
 */
export interface PlayerResources {
    /** Total Soul Shards collected this run (the run score). Always goes up. */
    soulShards: number;
    /** Progress toward the next Warrior, 0..(recruitCost - 1). */
    recruitProgress: number;
    /** Green crystals collected this run, and progress toward the next Archer. */
    greenShards: number;
    archerProgress: number;
}

export function createPlayerResources (): PlayerResources
{
    return { soulShards: 0, recruitProgress: 0, greenShards: 0, archerProgress: 0 };
}

/** Credit green crystals; returns how many Archers they recruit. */
export function applyGreenShards (resources: PlayerResources, amount: number, archerCost: number): number
{
    let recruits = 0;
    for (let i = 0; i < amount; i++)
    {
        resources.greenShards += 1;
        resources.archerProgress += 1;
        if (resources.archerProgress >= archerCost)
        {
            resources.archerProgress -= archerCost;
            recruits += 1;
        }
    }
    return recruits;
}

/**
 * Credit collected shards, one at a time, and work out how many Warriors
 * they recruit.
 *
 * - Every shard always adds to the run total.
 * - Each shard adds recruit progress; reaching `recruitCost` recruits one
 *   Warrior and the progress starts over.
 * - Armies have no size limit, so `freeSlots` defaults to unlimited. (It is
 *   kept only so a future mode could pause recruiting without changing this
 *   rule: while paused, shards add score only and progress is kept.)
 *
 * @returns How many Warriors to recruit.
 */
export function applySoulShards (
    resources: PlayerResources,
    amount: number,
    recruitCost: number,
    freeSlots = Infinity,
): number
{
    let recruits = 0;

    for (let i = 0; i < amount; i++)
    {
        resources.soulShards += 1;

        if (recruits >= freeSlots) continue; // recruiting paused: score only, progress kept as-is

        resources.recruitProgress += 1;
        if (resources.recruitProgress >= recruitCost)
        {
            resources.recruitProgress -= recruitCost;
            recruits += 1;
        }
    }

    return recruits;
}
