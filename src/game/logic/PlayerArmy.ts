import {
    centroid, clusterRadius, createCluster, distance, findDetour, findFreeSpotNear, hasClearPath, reassignSlots,
    speedMultiplier, updateCluster,
    type Cluster, type ClusterSettings, type Warrior,
} from './Army';
import { CENTER_BODY, updateMover, type MovementTuning } from './Movement';
import { bodyRect, type ObstacleMap } from './Obstacles';
import { createRng } from './Random';
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
    /** Until this time the cluster rushes out to its place in the fan (0 = not launching). */
    launchUntil: number;
    route: FollowRoute;
    nextPlanAt: number;
    lastCheckPosition: Vec2;
    nextStuckCheckAt: number;
}

export interface PlayerArmy {
    /** The invisible point the player steers (plus its breadcrumb trail). Never has soldiers. */
    lead: Cluster;
    clusters: ArmyCluster[];
    nextClusterId: number;
    /** Every cluster id ever made -> its parent id, so returning clusters can skip parents that are gone. */
    parentOf: Map<number, number | null>;
    lastSplitAt: number;
    /** The soldier wearing the amber marker (cosmetic only). */
    representativeId: number | null;
}

export interface PlayerArmySettings extends ClusterSettings {
    speedCurve: readonly (readonly [number, number])[];
    minSpeedMultiplier: number;
    split: {
        minSoldiers: number;
        maxClusters: number;
        cooldownMs: number;
        regroup: { minMs: number; perSoldierMs: number; maxMs: number; maxWaitForReturnMs: number };
        /** Freshly split clusters rush out to their place this many times faster, for at most launchMs. */
        launchBoost: number;
        launchMs: number;
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

function wrapCluster (cluster: Cluster, parentId: number | null, splitAt: number): ArmyCluster
{
    return {
        cluster,
        parentId,
        splitAt,
        launchUntil: 0,
        route: { mode: 'direct' },
        nextPlanAt: 0,
        lastCheckPosition: { ...cluster.center.position },
        nextStuckCheckAt: 0,
    };
}

export function createPlayerArmy (spawn: Vec2): PlayerArmy
{
    return {
        lead: createCluster(0, spawn),
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

        // The new half is the original's child: it returns to it later.
        // It rushes out to its place (so does a split-off cluster that split again;
        // the main cluster doesn't get the burst).
        original.splitAt = now;
        if (original.parentId !== null) original.launchUntil = launchUntil;
        army.parentOf.set(newCluster.id, cluster.id);
        const child = wrapCluster(newCluster, cluster.id, now);
        child.launchUntil = launchUntil;
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
    input: Vec2,
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
    const targets = clusterTargets(army, plan, obstacles, bounds, settings);

    // The lead: player-controlled, speed set by the largest cluster, slowed if the army lags.
    const armySpeed = movement.maxSpeed * armySpeedMultiplier(army, settings);
    const leadTuning = { ...movement, maxSpeed: armySpeed * leashFactor(army, targets, settings) };
    updateMover(army.lead.center, input, dt, bounds, leadTuning, obstacles);
    updateCluster(army.lead, dt, now, obstacles, bounds, settings); // heading + breadcrumbs only (no soldiers)

    // Every cluster follows its place, then its soldiers follow the cluster.
    for (const ac of army.clusters)
    {
        const target = targets.get(ac) ?? army.lead.center.position;
        steerCluster(ac, target, army, plan, armySpeed, dt, now, obstacles, bounds, settings, movement);
        updateCluster(ac.cluster, dt, now, obstacles, bounds, settings);
    }

    const merges = mergeReturning(army, plan, settings);
    updateRepresentative(army);
    return { merges };
}

// ---------------------------------------------------------------------------
// Where each cluster should be
// ---------------------------------------------------------------------------

/**
 * Holding clusters get spots arranged around the lead (a small sunflower
 * pattern spaced so they don't touch). Returning clusters head for their
 * parent so they merge into it.
 */
function clusterTargets (army: PlayerArmy, plan: RegroupPlan, obstacles: ObstacleMap, bounds: Rect, settings: PlayerArmySettings): Map<ArmyCluster, Vec2>
{
    const targets = new Map<ArmyCluster, Vec2>();
    const lead = army.lead.center.position;
    const holding = [...plan.holding].sort((a, b) => a.cluster.id - b.cluster.id);

    if (holding.length > 0)
    {
        const biggest = Math.max(...holding.map((c) => clusterRadius(c.cluster.warriors.length, settings.formationSpacing)));
        const offsets = clusterOffsets(holding.length, biggest * 2 + settings.split.clusterGap);
        holding.forEach((ac, i) => targets.set(ac, freeTowardLead(lead, offsets[i], obstacles, bounds)));
    }

    for (const [ac, parent] of plan.returning) targets.set(ac, parent.cluster.center.position);

    return targets;
}

const offsetCache = new Map<string, Vec2[]>();

/** Spots for `count` clusters around the lead, `spacing` apart, centred on the lead. */
function clusterOffsets (count: number, spacing: number): Vec2[]
{
    const key = `${count}:${Math.round(spacing)}`;
    const cached = offsetCache.get(key);
    if (cached) return cached;

    // A small sunflower pattern (two clusters simply stand side by side).
    const rng = createRng(77);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const raw: Vec2[] = [];
    for (let i = 0; i < count; i++)
    {
        if (count === 2) { raw.push({ x: i === 0 ? -0.5 : 0.5, y: 0 }); continue; }
        const r = Math.sqrt(i + 0.5);
        raw.push({ x: Math.cos(i * golden) * r + (rng() - 0.5) * 0.05, y: Math.sin(i * golden) * r * 0.9 });
    }

    // Scale it so the closest two clusters are exactly `spacing` apart (never closer).
    let closest = Infinity;
    for (let i = 0; i < count; i++)
    {
        for (let j = i + 1; j < count; j++) closest = Math.min(closest, distance(raw[i], raw[j]));
    }
    const scale = Number.isFinite(closest) && closest > 0 ? spacing / closest : 0;

    // Centre the pattern on the lead so the camera stays on the middle of the army.
    const mid = { x: raw.reduce((s, p) => s + p.x, 0) / count, y: raw.reduce((s, p) => s + p.y, 0) / count };
    const offsets = raw.map((p) => ({ x: (p.x - mid.x) * scale, y: (p.y - mid.y) * scale }));
    offsetCache.set(key, offsets);
    return offsets;
}

/** The lead + offset, pulled in toward the lead if that spot is inside an obstacle. */
function freeTowardLead (lead: Vec2, offset: Vec2, obstacles: ObstacleMap, bounds: Rect): Vec2
{
    for (let t = 1; t > 0.05; t -= 0.15)
    {
        const p = { x: lead.x + offset.x * t, y: lead.y + offset.y * t };
        const inside = p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height;
        if (inside && !obstacles.overlaps(bodyRect(p.x, p.y, CENTER_BODY))) return p;
    }
    return lead;
}

/**
 * Slow the lead when the bulk of the army has fallen well behind.
 *
 * Uses the soldier-weighted median lag, not the worst cluster: with several
 * split clusters one is almost always snagged on something, and waiting for
 * it would stall the whole army. Stragglers catch up on their own (they move
 * faster than the army and follow its breadcrumbs).
 */
function leashFactor (army: PlayerArmy, targets: Map<ArmyCluster, Vec2>, settings: PlayerArmySettings): number
{
    const lags: { lag: number; weight: number }[] = [];
    let totalWeight = 0;
    for (const ac of army.clusters)
    {
        let lag = 0;
        const target = targets.get(ac);
        if (target) lag = distance(ac.cluster.center.position, target);
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
    ac: ArmyCluster, target: Vec2, army: PlayerArmy, plan: RegroupPlan, armySpeed: number, dt: number, now: number,
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

    // Keep a visible gap from neighbouring split clusters (not while returning).
    if (!plan.returning.has(ac))
    {
        const push = clusterSeparation(ac, army, plan, settings);
        dx = dx * throttle + push.x;
        dy = dy * throttle + push.y;
        throttle = 1;
    }

    // Freshly split: rush out to its place, then settle to normal speed.
    if (ac.launchUntil > 0 && (now >= ac.launchUntil || (arriving && d < 10))) ac.launchUntil = 0;
    const launching = ac.launchUntil > 0;
    const speed = armySpeed * settings.split.followSpeedMultiplier * (launching ? settings.split.launchBoost : 1);
    if (launching) throttle = 1;
    const input = { x: dx * throttle, y: dy * throttle };
    // Holding its place in the army: move WITH the lead, plus the correction
    // above, so the cluster turns the moment the player does instead of
    // sliding on toward where its spot used to be.
    if (arriving && !plan.returning.has(ac) && speed > 0)
    {
        input.x += lead.center.velocity.x / speed;
        input.y += lead.center.velocity.y / speed;
    }
    updateMover(centre, input, dt, bounds, { ...movement, maxSpeed: speed }, obstacles);

    // Stuck? Search a small area for a way around.
    if (now >= ac.nextStuckCheckAt)
    {
        if (distance(centre.position, ac.lastCheckPosition) < STUCK_DISTANCE && distance(centre.position, target) > 24)
        {
            const detour = findDetour(obstacles, bounds, centre.position, target);
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
    if (hasClearPath(obstacles, from, target)) return { mode: 'direct' };

    // Keep following a detour that's still in progress.
    if (current.mode === 'detour' && current.index < current.points.length) return current;

    // The newest breadcrumb we can walk straight to.
    const trail = lead.trail;
    for (let i = trail.length - 1; i >= 0; i--)
    {
        if (distance(trail[i], from) > CRUMB_SEARCH_RADIUS) continue;
        if (hasClearPath(obstacles, from, trail[i])) return { mode: 'trail', index: i, shiftsAtPlan: lead.trailShifts };
    }

    if (current.mode === 'trail') return current;
    return { mode: 'direct' };
}

/** Gentle push away from other split clusters that are too close. */
function clusterSeparation (ac: ArmyCluster, army: PlayerArmy, plan: RegroupPlan, settings: PlayerArmySettings): Vec2
{
    const me = ac.cluster;
    const myRadius = clusterRadius(me.warriors.length, settings.formationSpacing);
    let px = 0;
    let py = 0;
    for (const other of army.clusters)
    {
        if (other === ac || plan.returning.has(other)) continue;
        const wanted = myRadius + clusterRadius(other.cluster.warriors.length, settings.formationSpacing) + settings.split.clusterGap;
        const dx = me.center.position.x - other.cluster.center.position.x;
        const dy = me.center.position.y - other.cluster.center.position.y;
        const d = Math.hypot(dx, dy);
        if (d >= wanted) continue;
        const strength = (wanted - d) / wanted;
        if (d < 0.01) { px += me.id % 2 ? strength : -strength; continue; }
        px += (dx / d) * strength;
        py += (dy / d) * strength;
    }
    return { x: px, y: py };
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
        parent.cluster.warriors.push(...child.cluster.warriors);
        child.cluster.warriors = [];
        army.clusters = army.clusters.filter((c) => c !== child);
        reassignSlots(parent.cluster, settings.formationSpacing);
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
