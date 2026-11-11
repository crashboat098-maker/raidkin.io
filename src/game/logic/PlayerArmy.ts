import {
    centroid, clusterRadius, createCluster, distance, findDetour, findFreeSpotNear, hasClearPath, hasDryPath, reassignSlots,
    speedMultiplier, updateCluster, wadesBetween,
    type Cluster, type ClusterSettings, type Warrior,
} from './Army';
import { CENTER_BODY, updateMover, type MovementTuning } from './Movement';
import { createNavigator, findPath, navigationGoal, steerAround, type Navigator, type SteerInput } from './Navigation';
import { bodyRect, type ObstacleMap } from './Obstacles';
import type { Rect, Vec2 } from './Types';

/**
 * A player's army: one or more CLUSTERS of soldiers that all move together.
 *
 * The player steers an invisible "lead" point. Every cluster follows the
 * lead, keeping its own compact formation and a visible gap from the other
 * clusters. Pressing SPACE splits each cluster (with 2+ soldiers) in half.
 * Army speed comes from the LARGEST cluster, so splitting makes the whole
 * army faster. Every cluster remembers the cluster it split from (its
 * parent). After a while, small clusters sooner and big ones later, it
 * marches back and merges into its parent, which grows; parents wait for
 * children on their way back, so merges cascade up into one army again.
 * The first cluster (the root) never leaves. Splitting only moves soldiers
 * between clusters; it never creates or removes any.
 *
 * All soldiers are equal. There's no commander: the player is alive as long
 * as at least one soldier is. One soldier is marked as the "representative"
 * purely so you can spot your army; it has no special role.
 * Pure logic, no Phaser.
 */

/** How a cluster's centre finds its way to its place in the army. */
type FollowRoute =
    | { mode: 'direct' }
    /** Following the lead's breadcrumbs (`index` counted from when the plan was made). */
    | { mode: 'trail'; index: number; shiftsAtPlan: number }
    | { mode: 'detour'; points: Vec2[]; index: number };

export interface ArmyCluster {
    cluster: Cluster;
    /** Id of the cluster this one split from (null for the root, which never regroups). */
    parentId: number | null;
    /** When this cluster was last split (its regroup timer counts from here). */
    splitAt: number;
    /** Until this time the cluster is shooting out after a split (0 = not launching). */
    launchUntil: number;
    /** Where a freshly split cluster shoots out to (ahead of where it split, toward the mouse). */
    launchTarget: Vec2 | null;
    /** The direction it was split toward (unit vector; zero for the root). */
    splitDir: Vec2;
    route: FollowRoute;
    nextPlanAt: number;
    /** This cluster's own aim along the army's route (re-picked a few times a second). */
    aim: Vec2 | null;
    nextAimAt: number;
    lastCheckPosition: Vec2;
    nextStuckCheckAt: number;
}

export interface PlayerArmy {
    /** The invisible point the player steers (plus its breadcrumb trail). Never has soldiers. */
    lead: Cluster;
    /** The lead's route around obstacles toward where the player points. */
    nav: Navigator;
    clusters: ArmyCluster[];
    nextClusterId: number;
    /** Every cluster id ever made -> its parent id, so returning clusters can skip parents that are gone. */
    parentOf: Map<number, number | null>;
    lastSplitAt: number;
    /** The soldier wearing the amber marker (cosmetic only). */
    representativeId: number | null;
    /**
     * Online only: the army's real size, as the server reports it. The browser
     * only gets the soldiers near its own view, so counting them would be wrong.
     */
    reportedSize?: number;
}

export interface PlayerArmySettings extends ClusterSettings {
    speedCurve: readonly (readonly [number, number])[];
    minSpeedMultiplier: number;
    split: {
        minSoldiers: number;
        maxClusters: number;
        cooldownMs: number;
        regroup: { minMs: number; perSoldierMs: number; maxMs: number; maxWaitForReturnMs: number };
        /** Freshly split clusters shoot out this many times faster, for at most launchMs. */
        launchBoost: number;
        launchMs: number;
        /** How far past its parent's edge a freshly split cluster shoots (world px). */
        launchDistance: number;
        /** Share (0-1) of the extra speed a smaller cluster's size would give it on its own. */
        smallClusterBonus: number;
        clusterGap: number;
        followSpeedMultiplier: number;
        replanMs: number;
    };
    /** Slow the lead if clusters/soldiers fall behind it (e.g. squeezing through a gap). */
    leash: { startDistance: number; fullStopDistance: number };
}

const STUCK_CHECK_MS = 900;
const STUCK_DISTANCE = 4;
/** Only breadcrumbs this close are considered when re-planning (keeps checks short and cheap). */
const CRUMB_SEARCH_RADIUS = 220;
/** Clusters heading back to merge move this much faster than holding ones. */
const RETURN_BOOST = 1.4;
/** How often each cluster re-picks its aim along the army's route (ms, staggered). */
const AIM_REPICK_MS = 250;

function wrapCluster (cluster: Cluster, parentId: number | null, splitAt: number, splitDir: Vec2 = { x: 0, y: 0 }): ArmyCluster
{
    return {
        cluster,
        parentId,
        splitAt,
        launchUntil: 0,
        launchTarget: null,
        splitDir,
        route: { mode: 'direct' },
        nextPlanAt: 0,
        aim: null,
        nextAimAt: 0,
        lastCheckPosition: { ...cluster.center.position },
        nextStuckCheckAt: 0,
    };
}

export function createPlayerArmy (spawn: Vec2): PlayerArmy
{
    return {
        lead: createCluster(0, spawn),
        nav: createNavigator(),
        clusters: [wrapCluster(createCluster(1, spawn), null, -Infinity)],
        nextClusterId: 2,
        parentOf: new Map([[1, null]]),
        lastSplitAt: -Infinity,
        representativeId: null,
    };
}

export function allClusters (army: PlayerArmy): Cluster[]
{
    return army.clusters.map((c) => c.cluster);
}

export function allWarriors (army: PlayerArmy): Warrior[]
{
    return army.clusters.length === 1 ? army.clusters[0].cluster.warriors : army.clusters.flatMap((c) => c.cluster.warriors);
}

export function totalSoldiers (army: PlayerArmy): number
{
    if (army.reportedSize !== undefined) return army.reportedSize;
    return army.clusters.reduce((sum, c) => sum + c.cluster.warriors.length, 0);
}

/** A player with no soldiers left is eliminated (used once combat exists). */
export function isEliminated (army: PlayerArmy): boolean
{
    return totalSoldiers(army) === 0;
}

export function largestClusterSize (army: PlayerArmy): number
{
    return Math.max(0, ...army.clusters.map((c) => c.cluster.warriors.length));
}

/** Army speed multiplier: set by the LARGEST cluster, so splitting makes the army faster. */
export function armySpeedMultiplier (army: PlayerArmy, settings: PlayerArmySettings): number
{
    return speedMultiplier(largestClusterSize(army), settings.speedCurve, settings.minSpeedMultiplier);
}

/** Seconds until the next split cluster starts heading back (null if the army is whole or already regrouping). */
export function secondsUntilRegroup (army: PlayerArmy, now: number, settings: PlayerArmySettings): number | null
{
    if (army.clusters.length <= 1) return null;
    const waiting = army.clusters.map((c) => regroupTime(c, settings)).filter((t) => t > now && Number.isFinite(t));
    if (waiting.length === 0) return null;
    return (Math.min(...waiting) - now) / 1000;
}

/** How long a cluster of `soldiers` stays split before heading back: small ones sooner, big ones later. */
export function regroupDelayMs (soldiers: number, settings: PlayerArmySettings): number
{
    const r = settings.split.regroup;
    return Math.min(r.maxMs, r.minMs + soldiers * r.perSoldierMs);
}

/** When this cluster heads back to its parent (never for the root). */
function regroupTime (ac: ArmyCluster, settings: PlayerArmySettings): number
{
    if (ac.parentId === null) return Infinity;
    return ac.splitAt + regroupDelayMs(ac.cluster.warriors.length, settings);
}

/** The cluster this one returns to: its parent, or the nearest ancestor still around. */
function findParent (army: PlayerArmy, ac: ArmyCluster): ArmyCluster | null
{
    let id = ac.parentId;
    const seen = new Set<number>();
    while (id !== null && !seen.has(id))
    {
        seen.add(id);
        const found = army.clusters.find((c) => c.cluster.id === id);
        if (found && found !== ac) return found;
        id = army.parentOf.get(id) ?? null;
    }
    return null;
}

/** Keep exactly one root, and give clusters whose whole ancestry is gone (wiped out in combat) the root as parent. */
function repairFamily (army: PlayerArmy): void
{
    let root = army.clusters.find((c) => c.parentId === null);
    if (!root)
    {
        root = army.clusters.reduce((a, b) => (b.cluster.warriors.length > a.cluster.warriors.length ? b : a));
        root.parentId = null;
        army.parentOf.set(root.cluster.id, null);
    }
    for (const ac of army.clusters)
    {
        if (ac === root) continue;
        if (ac.parentId === null || !findParent(army, ac))
        {
            ac.parentId = root.cluster.id;
            army.parentOf.set(ac.cluster.id, root.cluster.id);
        }
    }
}

interface RegroupPlan {
    /** Clusters keeping a spot around the lead (the root, clusters still split, and parents waiting for children). */
    holding: ArmyCluster[];
    /** Clusters heading back, each to its parent. */
    returning: Map<ArmyCluster, ArmyCluster>;
}

/**
 * Who heads back this frame. A cluster heads back once its time is up,
 * unless children of its own are already due back: then it waits for
 * them (up to maxWaitForReturnMs), so the smallest clusters merge first.
 */
function planRegroup (army: PlayerArmy, now: number, settings: PlayerArmySettings): RegroupPlan
{
    const parents = new Map<ArmyCluster, ArmyCluster | null>();
    for (const ac of army.clusters) parents.set(ac, findParent(army, ac));
    const due = (ac: ArmyCluster) => parents.get(ac) !== null && regroupTime(ac, settings) <= now;

    const holding: ArmyCluster[] = [];
    const returning = new Map<ArmyCluster, ArmyCluster>();
    for (const ac of army.clusters)
    {
        const parent = parents.get(ac) ?? null;
        const waitingForChildren = now < regroupTime(ac, settings) + settings.split.regroup.maxWaitForReturnMs
            && army.clusters.some((c) => c !== ac && parents.get(c) === ac && due(c));
        if (parent && due(ac) && !waitingForChildren) returning.set(ac, parent);
        else holding.push(ac);
    }
    return { holding, returning };
}

/** Total emergency recoveries across clusters (for testing/tuning). */
export function totalRecoveries (army: PlayerArmy): number
{
    return army.clusters.reduce((sum, c) => sum + c.cluster.recoveries, 0);
}

/** The cluster closest to a point (where new recruits join). */
export function nearestCluster (army: PlayerArmy, point: Vec2): Cluster
{
    let best = army.clusters[0].cluster;
    for (const { cluster } of army.clusters)
    {
        if (distance(cluster.center.position, point) < distance(best.center.position, point)) best = cluster;
    }
    return best;
}

export function canSplit (army: PlayerArmy, now: number, settings: PlayerArmySettings): boolean
{
    return now - army.lastSplitAt >= settings.split.cooldownMs
        && army.clusters.length < settings.split.maxClusters
        && army.clusters.some((c) => c.cluster.warriors.length >= settings.split.minSoldiers);
}

/**
 * SPACE: split every cluster that has enough soldiers into two halves.
 * The front half (toward `aim`, where the player points) breaks off and
 * rushes out to its place around the lead; the back half stays. Largest
 * clusters split first if the cluster cap would be reached. Returns the
 * new clusters' centres (for effects).
 *
 * @param aim Direction to split toward; null = the way the army is heading.
 */
export function splitArmy (
    army: PlayerArmy, now: number, obstacles: ObstacleMap, bounds: Rect, settings: PlayerArmySettings, aim: Vec2 | null = null,
): Vec2[] | null
{
    if (!canSplit(army, now, settings)) return null;

    const aimLength = aim ? Math.hypot(aim.x, aim.y) : 0;
    const forward = aim && aimLength > 0.001 ? { x: aim.x / aimLength, y: aim.y / aimLength } : { ...army.lead.heading };
    const launchUntil = now + settings.split.launchMs;
    const candidates = army.clusters
        .filter((c) => c.cluster.warriors.length >= settings.split.minSoldiers)
        .sort((a, b) => b.cluster.warriors.length - a.cluster.warriors.length);

    const created: Vec2[] = [];
    for (const original of candidates)
    {
        if (army.clusters.length >= settings.split.maxClusters) break;

        const cluster = original.cluster;
        const centre = cluster.center.position;
        // Back half stays (the odd soldier out stays too); front half breaks off toward the aim.
        const ahead = (w: Warrior) => (w.position.x - centre.x) * forward.x + (w.position.y - centre.y) * forward.y;
        const sorted = [...cluster.warriors].sort((a, b) => ahead(a) - ahead(b));
        const half = Math.ceil(sorted.length / 2);
        const left = sorted.slice(0, half);
        const right = sorted.slice(half);

        const rightCentre = findFreeSpotNear(obstacles, bounds, centroid(right), CENTER_BODY, 40) ?? centroid(right);
        const newCluster = createCluster(army.nextClusterId++, rightCentre);
        newCluster.warriors = right;
        newCluster.heading = { ...cluster.heading };
        newCluster.center.velocity = { ...cluster.center.velocity };

        const leftCentre = findFreeSpotNear(obstacles, bounds, centroid(left), CENTER_BODY, 40) ?? centroid(left);
        cluster.warriors = left;
        cluster.center.position.x = leftCentre.x;
        cluster.center.position.y = leftCentre.y;

        reassignSlots(cluster, settings.formationSpacing);
        reassignSlots(newCluster, settings.formationSpacing);

        // The new half is the original's child: it returns to it later. It shoots
        // out ahead toward the mouse (as far as the ground is clear), then
        // falls back into the blob. The half that stays doesn't move.
        original.splitAt = now;
        army.parentOf.set(newCluster.id, cluster.id);
        const child = wrapCluster(newCluster, cluster.id, now, { ...forward });
        child.launchUntil = launchUntil;
        const shot = clusterRadius(left.length, settings.formationSpacing) + clusterRadius(right.length, settings.formationSpacing)
            + settings.split.launchDistance;
        child.launchTarget = clearAhead(leftCentre, forward, shot, obstacles, bounds);
        army.clusters.push(child);
        created.push({ ...leftCentre }, { ...rightCentre });
    }

    army.lastSplitAt = now;
    updateRepresentative(army);
    return created;
}

export interface ArmyUpdateResult {
    /** Where clusters merged this frame. */
    merges: Vec2[];
}

/**
 * One frame for the whole army: move the lead with `input`, have every
 * cluster follow its place around the lead, and merge clusters whose
 * regroup time has come once they touch.
 */
export function updatePlayerArmy (
    army: PlayerArmy,
    input: SteerInput,
    dt: number,
    now: number,
    obstacles: ObstacleMap,
    bounds: Rect,
    settings: PlayerArmySettings,
    movement: MovementTuning,
): ArmyUpdateResult
{
    // Drop clusters that have lost all their soldiers (future combat), but keep at least one.
    if (army.clusters.length > 1) army.clusters = army.clusters.filter((c) => c.cluster.warriors.length > 0);
    repairFamily(army);

    const plan = planRegroup(army, now, settings);
    const armySpeed = movement.maxSpeed * armySpeedMultiplier(army, settings);
    const targets = clusterTargets(army, plan, now, obstacles);

    // The lead: player-controlled, speed set by the largest cluster, slowed if the army lags.
    // It walks a route around obstacles toward where the player points.
    const leadTuning = { ...movement, maxSpeed: armySpeed * leashFactor(army, plan, targets, settings) };
    const steer = steerAround(army.nav, army.lead.center.position, input, now, obstacles, bounds);
    updateMover(army.lead.center, steer, dt, bounds, leadTuning, obstacles);
    updateCluster(army.lead, dt, now, obstacles, bounds, settings); // heading + breadcrumbs only (no soldiers)

    // Every cluster heads for its target, the clusters push each other into a
    // blob, then each cluster's soldiers follow it.
    const blob = blobRadius(army.clusters, settings);
    for (const ac of army.clusters)
    {
        const target = targets.get(ac) ?? army.lead.center.position;
        const catchingUp = isBehind(ac, army, blob);
        steerCluster(ac, target, army, plan, armySpeed, catchingUp, dt, now, obstacles, bounds, settings, movement);
    }
    packClusters(army, plan, obstacles, bounds, settings);
    for (const ac of army.clusters) updateCluster(ac.cluster, dt, now, obstacles, bounds, settings);

    const merges = mergeReturning(army, plan, settings);
    updateRepresentative(army);
    return { merges };
}

// ---------------------------------------------------------------------------
// Where each cluster should be
// ---------------------------------------------------------------------------

/**
 * Like agar.io cells: every holding cluster heads for where the player is
 * steering (the pointer, or the next waypoint of the army's route around
 * obstacles), each at its own speed, and `packClusters` pushes them apart
 * so they never overlap. Nothing tethers a cluster to the steering point:
 * a quick small cluster that lunged ahead stays ahead and keeps going. When
 * the army stands still they all gather around the steering point. A freshly
 * split cluster first shoots out to its launch point. Returning clusters
 * head for their parent so they merge into it.
 */
function clusterTargets (army: PlayerArmy, plan: RegroupPlan, now: number, obstacles: ObstacleMap): Map<ArmyCluster, Vec2>
{
    const targets = new Map<ArmyCluster, Vec2>();
    const lead = army.lead.center.position;
    const goal = army.nav.goal ? navigationGoal(army.nav) ?? lead : lead;

    for (const ac of plan.holding)
    {
        if (ac.launchUntil > 0 && ac.launchTarget) targets.set(ac, ac.launchTarget);
        else targets.set(ac, aimFor(ac, army, now, obstacles));
    }

    // Regrouping: the smaller group runs back to the bigger one, which holds its place in the blob.
    for (const [ac, parent] of plan.returning)
    {
        if (ac.cluster.warriors.length <= parent.cluster.warriors.length) targets.set(ac, parent.cluster.center.position);
        else
        {
            targets.set(ac, goal);
            targets.set(parent, ac.cluster.center.position);
        }
    }

    return targets;
}

/**
 * A cluster's own cruising speed. Smaller clusters are a little quicker than
 * the army (fewer soldiers to move): part of the way from the army's speed
 * (set by the largest cluster) to the speed their own size would give.
 */
function clusterBaseSpeed (ac: ArmyCluster, armySpeed: number, settings: PlayerArmySettings, movement: MovementTuning): number
{
    const own = movement.maxSpeed * speedMultiplier(ac.cluster.warriors.length, settings.speedCurve, settings.minSpeedMultiplier);
    return armySpeed + Math.max(0, own - armySpeed) * settings.split.smallClusterBonus;
}

/**
 * Where a holding cluster heads: straight for the player's goal if it can
 * walk there, else the furthest point of the army's route it can walk
 * straight to (so a cluster that lunged ahead never turns back for a
 * waypoint it has already passed). The steering point when the army stands
 * still, waits at the end of a blocked route, or nothing on the route is in
 * a straight line (the cluster then follows the army's footsteps).
 */
function aimFor (ac: ArmyCluster, army: PlayerArmy, now: number, obstacles: ObstacleMap): Vec2
{
    const lead = army.lead.center.position;
    const nav = army.nav;
    if (!nav.goal) { ac.aim = null; return lead; }
    if (ac.aim && now < ac.nextAimAt) return ac.aim;

    const from = ac.cluster.center.position;
    const path = nav.path;
    let aim: Vec2 = lead;
    if (path.length === 0) aim = nav.goal; // the army's own way there is straight
    else if (!nav.partial && hasDryPath(obstacles, from, nav.goal)) aim = nav.goal;
    else
    {
        for (let k = path.length - 1; k >= nav.index; k--)
        {
            if (hasClearPath(obstacles, from, path[k])) { aim = path[k]; break; }
        }
    }
    ac.aim = aim;
    ac.nextAimAt = now + AIM_REPICK_MS * (0.8 + (ac.cluster.id % 5) / 10);
    return aim;
}

/**
 * Has this cluster fallen behind the army? It's beyond the blob's edge and
 * on the far side of the steering point from where the army is heading (or
 * simply beyond the edge, when the army stands still). Clusters ahead of
 * the steering point are never "behind": nothing pulls them back.
 */
function isBehind (ac: ArmyCluster, army: PlayerArmy, blob: number): boolean
{
    const p = ac.cluster.center.position;
    const lead = army.lead.center.position;
    const dx = p.x - lead.x;
    const dy = p.y - lead.y;
    if (Math.hypot(dx, dy) <= blob) return false;
    const goal = army.nav.goal;
    if (!goal) return true;
    return dx * (goal.x - lead.x) + dy * (goal.y - lead.y) < 0;
}

/** Radius of the blob the holding clusters pack into (their areas added up, with a little slack). */
function blobRadius (clusters: readonly ArmyCluster[], settings: PlayerArmySettings): number
{
    let area = 0;
    for (const ac of clusters)
    {
        const r = clusterRadius(ac.cluster.warriors.length, settings.formationSpacing) + settings.split.clusterGap;
        area += r * r;
    }
    return Math.sqrt(area) * 1.2;
}

/**
 * Push overlapping clusters apart (a few relaxation passes), so split
 * clusters touch but never overlap, like agar.io cells. Bigger clusters
 * give way less. A cluster heading back to merge, and the one it merges
 * into, pass through the others. Never pushes a centre into a wall.
 */
function packClusters (army: PlayerArmy, plan: RegroupPlan, obstacles: ObstacleMap, bounds: Rect, settings: PlayerArmySettings): void
{
    const solid = army.clusters.filter((ac) => !plan.returning.has(ac) && ac.cluster.warriors.length > 0);
    if (solid.length < 2) return;
    const radius = solid.map((ac) => clusterRadius(ac.cluster.warriors.length, settings.formationSpacing));
    const weight = solid.map((ac) => ac.cluster.warriors.length);
    const gap = settings.split.clusterGap;

    for (let pass = 0; pass < 3; pass++)
    {
        for (let i = 0; i < solid.length; i++)
        {
            for (let j = i + 1; j < solid.length; j++)
            {
                const a = solid[i].cluster.center.position;
                const b = solid[j].cluster.center.position;
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                const wanted = radius[i] + radius[j] + gap;
                if (Math.abs(dx) >= wanted || Math.abs(dy) >= wanted) continue;
                let d = Math.hypot(dx, dy);
                if (d >= wanted) continue;
                if (d < 0.01)
                {
                    // Exactly on top of each other: split them sideways, a stable way.
                    dx = (solid[i].cluster.id % 2 ? 1 : -1); dy = 0.3; d = Math.hypot(dx, dy);
                }
                const overlap = (wanted - d) * 0.5; // half per pass keeps it smooth
                const ux = dx / d, uy = dy / d;
                const share = weight[i] / (weight[i] + weight[j]); // the heavier one moves less
                nudge(a, -ux * overlap * (1 - share), -uy * overlap * (1 - share), obstacles, bounds);
                nudge(b, ux * overlap * share, uy * overlap * share, obstacles, bounds);
            }
        }
    }
}

/** Move a cluster centre by (dx, dy), or as much of it as stays clear of walls. */
function nudge (p: Vec2, dx: number, dy: number, obstacles: ObstacleMap, bounds: Rect): void
{
    const full = { x: p.x + dx, y: p.y + dy };
    if (standable(full, obstacles, bounds)) { p.x = full.x; p.y = full.y; return; }
    // Slide along the wall: try each axis on its own.
    if (standable({ x: p.x + dx, y: p.y }, obstacles, bounds)) p.x += dx;
    else if (standable({ x: p.x, y: p.y + dy }, obstacles, bounds)) p.y += dy;
}

/** Is a cluster centre allowed to stand here (inside the map, not in a wall)? */
function standable (p: Vec2, obstacles: ObstacleMap, bounds: Rect): boolean
{
    const inside = p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height;
    return inside && !obstacles.overlaps(bodyRect(p.x, p.y, CENTER_BODY));
}

/** The furthest point up to `length` px from `from` along `dir` that can be reached in a straight line. */
function clearAhead (from: Vec2, dir: Vec2, length: number, obstacles: ObstacleMap, bounds: Rect): Vec2
{
    let best = { ...from };
    for (let s = 12; s <= length; s += 12)
    {
        const p = { x: from.x + dir.x * s, y: from.y + dir.y * s };
        if (!standable(p, obstacles, bounds)) break;
        best = p;
    }
    return best;
}

/**
 * Slow the lead when the bulk of the army has fallen well behind.
 *
 * Uses the soldier-weighted median lag, not the worst cluster: with several
 * split clusters one is almost always snagged on something, and waiting for
 * it would stall the whole army. Stragglers catch up on their own (they move
 * faster than the army and follow its breadcrumbs).
 */
function leashFactor (army: PlayerArmy, plan: RegroupPlan, targets: Map<ArmyCluster, Vec2>, settings: PlayerArmySettings): number
{
    const lags: { lag: number; weight: number }[] = [];
    let totalWeight = 0;
    const lead = army.lead.center.position;
    // Clusters packed around the lead aren't lagging until they're beyond the blob's edge.
    const blob = blobRadius(army.clusters, settings);
    for (const ac of army.clusters)
    {
        let lag = 0;
        const target = targets.get(ac);
        if (ac.launchUntil > 0) lag = 0;
        // A cluster ahead of the army never holds it back (no tether); only one left behind does.
        else if (!plan.returning.has(ac)) lag = isBehind(ac, army, blob) ? distance(ac.cluster.center.position, lead) - blob : 0;
        else if (target) lag = distance(ac.cluster.center.position, target);
        if (ac.cluster.warriors.length > 0) lag = Math.max(lag, distance(ac.cluster.center.position, centroid(ac.cluster.warriors)));
        const weight = Math.max(1, ac.cluster.warriors.length);
        lags.push({ lag, weight });
        totalWeight += weight;
    }
    lags.sort((a, b) => a.lag - b.lag);
    let lag = 0;
    let seen = 0;
    for (const entry of lags)
    {
        seen += entry.weight;
        lag = entry.lag;
        if (seen >= totalWeight / 2) break;
    }
    const { startDistance, fullStopDistance } = settings.leash;
    if (lag <= startDistance) return 1;
    return Math.max(0.15, 1 - (lag - startDistance) / (fullStopDistance - startDistance));
}

// ---------------------------------------------------------------------------
// Steering a cluster's centre (around obstacles)
// ---------------------------------------------------------------------------

/**
 * Move a cluster's centre toward its target. Cheapest route first: straight
 * there if the way is clear; otherwise along the lead's breadcrumbs (a path
 * the army just walked, so known to be clear); a small detour search only if
 * stuck. Routes are re-planned a few times a second, not every frame.
 */
function steerCluster (
    ac: ArmyCluster, target: Vec2, army: PlayerArmy, plan: RegroupPlan, armySpeed: number, catchingUp: boolean, dt: number, now: number,
    obstacles: ObstacleMap, bounds: Rect, settings: PlayerArmySettings, movement: MovementTuning,
): void
{
    const centre = ac.cluster.center;
    const lead = army.lead;

    if (now >= ac.nextPlanAt)
    {
        ac.route = planFollow(centre.position, target, lead, obstacles, ac.route);
        ac.nextPlanAt = now + settings.split.replanMs * (0.8 + (ac.cluster.id % 5) / 10);
    }

    let goal = target;
    let arriving = true;
    const route = ac.route;
    if (route.mode === 'trail')
    {
        const index = route.index - (lead.trailShifts - route.shiftsAtPlan);
        const crumb = lead.trail[Math.max(0, index)];
        if (!crumb || index >= lead.trail.length) ac.route = { mode: 'direct' };
        else
        {
            goal = crumb;
            arriving = false;
            if (distance(centre.position, crumb) < 8) ac.route = { ...route, index: route.index + 1 };
        }
    }
    else if (route.mode === 'detour')
    {
        const point = route.points[route.index];
        if (!point) ac.route = { mode: 'direct' };
        else
        {
            goal = point;
            arriving = false;
            if (distance(centre.position, point) < 6) ac.route = { ...route, index: route.index + 1 };
        }
    }

    // Head for the goal, easing off near the target so clusters settle smoothly.
    let dx = goal.x - centre.position.x;
    let dy = goal.y - centre.position.y;
    const d = Math.hypot(dx, dy);
    let throttle = arriving ? Math.min(1, d / 16) : 1;
    if (d > 0.5) { dx /= d; dy /= d; } else { dx = 0; dy = 0; throttle = 0; }

    // Freshly split: shoot out to the launch point, then fall back into the blob.
    if (ac.launchUntil > 0 && (now >= ac.launchUntil || (arriving && d < 10)))
    {
        ac.launchUntil = 0;
        ac.launchTarget = null;
    }
    const launching = ac.launchUntil > 0;
    // Heading back to merge: hurry (as fast as the soldiers can keep up), since
    // the cluster it merges into keeps marching with the army.
    const boost = launching ? settings.split.launchBoost : plan.returning.has(ac) ? RETURN_BOOST : 1;
    // Its own cruising speed; the extra follow speed only to catch up when it has fallen behind.
    const follow = catchingUp || launching || plan.returning.has(ac) ? settings.split.followSpeedMultiplier : 1;
    let speed = clusterBaseSpeed(ac, armySpeed, settings, movement) * follow * boost;
    // Never outrun its own soldiers (except the short burst right after a split).
    if (!launching) speed = Math.min(speed, settings.warriorSpeed * settings.catchUpMultiplier);
    if (launching) throttle = 1;
    const input = { x: dx * throttle, y: dy * throttle };
    updateMover(centre, input, dt, bounds, { ...movement, maxSpeed: speed }, obstacles);

    // Stuck? Find a way round: a short local search first, then a wider path
    // search (e.g. along a river to its bridge).
    if (now >= ac.nextStuckCheckAt)
    {
        if (distance(centre.position, ac.lastCheckPosition) < STUCK_DISTANCE && distance(centre.position, target) > 24)
        {
            const detour = findDetour(obstacles, bounds, centre.position, target) ?? findPath(obstacles, bounds, centre.position, target)?.points;
            if (detour && detour.length > 0)
            {
                ac.route = { mode: 'detour', points: detour, index: 0 };
                ac.nextPlanAt = now + 1500;
            }
        }
        ac.lastCheckPosition = { ...centre.position };
        ac.nextStuckCheckAt = now + STUCK_CHECK_MS;
    }
}

function planFollow (from: Vec2, target: Vec2, lead: Cluster, obstacles: ObstacleMap, current: FollowRoute): FollowRoute
{
    if (hasDryPath(obstacles, from, target)) return { mode: 'direct' };

    // Keep following a detour that's still in progress.
    if (current.mode === 'detour' && current.index < current.points.length) return current;

    // The newest breadcrumb we can walk straight to, dry ones first (the
    // lead's footsteps go round walls and over bridges).
    const trail = lead.trail;
    let wetCrumb = -1;
    // Never step back: footsteps further from the target than we already are
    // (e.g. behind a cluster that lunged ahead) are no use.
    const toGo = distance(from, target);
    for (let i = trail.length - 1; i >= 0; i--)
    {
        if (distance(trail[i], from) > CRUMB_SEARCH_RADIUS) continue;
        if (distance(trail[i], target) >= toGo) continue;
        if (!hasClearPath(obstacles, from, trail[i])) continue;
        if (!wadesBetween(obstacles, from, trail[i])) return { mode: 'trail', index: i, shiftsAtPlan: lead.trailShifts };
        if (wetCrumb < 0) wetCrumb = i;
    }
    if (hasClearPath(obstacles, from, target)) return { mode: 'direct' };
    if (wetCrumb >= 0) return { mode: 'trail', index: wetCrumb, shiftsAtPlan: lead.trailShifts };

    if (current.mode === 'trail') return current;
    return { mode: 'direct' };
}

// ---------------------------------------------------------------------------
// Regrouping
// ---------------------------------------------------------------------------

/**
 * A returning cluster merges into its parent once they overlap. The parent
 * keeps its identity (and its own children), grows, and so stays split a
 * little longer before it heads back itself.
 */
function mergeReturning (army: PlayerArmy, plan: RegroupPlan, settings: PlayerArmySettings): Vec2[]
{
    const merges: Vec2[] = [];
    // Smallest first, so a parent that absorbs a child this frame still counts as present.
    const returning = [...plan.returning].sort((a, b) => a[0].cluster.warriors.length - b[0].cluster.warriors.length);
    for (const [child, parent] of returning)
    {
        if (!army.clusters.includes(child) || !army.clusters.includes(parent)) continue;
        const rc = clusterRadius(child.cluster.warriors.length, settings.formationSpacing);
        const rp = clusterRadius(parent.cluster.warriors.length, settings.formationSpacing);
        if (distance(child.cluster.center.position, parent.cluster.center.position) > Math.max(rc, rp)) continue;

        merges.push({
            x: (parent.cluster.center.position.x + child.cluster.center.position.x) / 2,
            y: (parent.cluster.center.position.y + child.cluster.center.position.y) / 2,
        });
        // The merged army forms up where the bigger group stands.
        if (child.cluster.warriors.length > parent.cluster.warriors.length)
        {
            const from = child.cluster.center;
            const to = parent.cluster.center;
            to.position.x = from.position.x;
            to.position.y = from.position.y;
            to.velocity.x = from.velocity.x;
            to.velocity.y = from.velocity.y;
        }
        parent.cluster.warriors.push(...child.cluster.warriors);
        child.cluster.warriors = [];
        army.clusters = army.clusters.filter((c) => c !== child);
        reassignSlots(parent.cluster, settings.formationSpacing);
    }
    // Back together as one: the steering point moves to the army (not the army to it).
    if (merges.length > 0 && army.clusters.length === 1)
    {
        const lead = army.lead.center.position;
        const at = army.clusters[0].cluster.center.position;
        lead.x = at.x;
        lead.y = at.y;
        army.nav.nextPlanAt = 0; // its route was planned from where it stood

    }
    return merges;
}

// ---------------------------------------------------------------------------

/** Keep the marker on a soldier (the one nearest the lead if it must move). */
function updateRepresentative (army: PlayerArmy): void
{
    const warriors = allWarriors(army);
    if (warriors.some((w) => w.id === army.representativeId)) return;

    const lead = army.lead.center.position;
    let best: Warrior | null = null;
    for (const w of warriors)
    {
        if (!best || distance(w.position, lead) < distance(best.position, lead)) best = w;
    }
    army.representativeId = best?.id ?? null;
}

export function representative (army: PlayerArmy): Warrior | null
{
    return allWarriors(army).find((w) => w.id === army.representativeId) ?? null;
}
