/**
 * Cheap counters for the performance overlay (F3) and the server's stats
 * log. Game code only adds to them; whoever displays them reads and resets
 * them once per frame / tick. No effect on gameplay.
 */
export const perfCounters = {
    /** Soldier-to-soldier (and soldier-to-thing) proximity checks done through spatial grids. */
    collisionChecks: 0,
    /** Route searches (A*) run, and the time they took (ms). */
    pathSearches: 0,
    pathMs: 0,
};

export function resetPerfCounters (): void
{
    perfCounters.collisionChecks = 0;
    perfCounters.pathSearches = 0;
    perfCounters.pathMs = 0;
}
