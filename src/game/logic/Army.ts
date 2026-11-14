import { createMover, steerVelocity, type MoverState } from './Movement';
import { bodyRect, type Body, type ObstacleMap } from './Obstacles';
import { createRng } from './Random';
import { SpatialGrid } from './SpatialGrid';
import type { Rect, Vec2 } from './Types';

/**
 * An army CLUSTER: a group of equal Warriors gathered around an invisible
 * movement centre. The player steers the centre; the Warriors keep a loose,
 * round formation around it and find their way around obstacles.
 * Pure logic, no Phaser, so it can later run on a multiplayer server.
 *
 * Navigation in one paragraph: each Warrior heads straight for its formation
 * spot when the way is clear. If something is in the way, it heads for the
 * cluster's centre instead, and if even that is blocked, it walks back along
 * the centre's recent path ("breadcrumbs"), which is known to be walkable.
 * Only if nothing is in sight, or it gets stuck, does it run a small local
 * grid search for a detour. One shared trail per cluster is far cheaper than
 * 30 separate pathfinders.
 */

/** Melee Warriors, Archers who shoot from behind them, and heavily armoured Guardians up front. */
export type SoldierRole = 'warrior' | 'archer' | 'guardian';

export interface Warrior {
    /** Unique id (never reused). */
    id: number;
    role: SoldierRole;
    position: Vec2;
    velocity: Vec2;
    facing: 1 | -1;
    isMoving: boolean;
    /** Index of this Warrior's spot in its cluster's formation. */
    slot: number;
    /** Current navigation plan (see file comment). */
    route: Route;
    nextThinkAt: number;
    /** When this Warrior became badly separated (0 = not separated). */
    lostSince: number;
    /** Stuck detection: where it was at the last check, and when to check next. */
    lastCheckPosition: Vec2;
    nextStuckCheckAt: number;

    // --- Combat ---
    hp: number;
    maxHp: number;
    /** Earliest time this soldier can strike again. */
    nextAttackAt: number;
    /** Set each frame by the combat system: an enemy to step toward and fight (null = keep formation). */
    engage: Vec2 | null;
    /** Standing in a lava river: burns until this time (no healing meanwhile). */
    burningUntil: number;
    /** When this soldier next takes a lava burn (0 = not in lava). */
    nextBurnAt: number;
}

type Route =
    | { mode: 'slot' }
    | { mode: 'center' }
    | { mode: 'crumb'; index: number }
    /** Rare fallback: a short detour found by a small local grid search. */
    | { mode: 'detour'; points: Vec2[]; index: number };

export interface Cluster {
    id: number;
    /** The invisible point the soldiers gather around (steered by the player for the active cluster). */
    center: MoverState;
    warriors: Warrior[];
    /** Direction of travel (unit vector), smoothed. Used when splitting. */
    heading: Vec2;
    /** The centre's recent positions, oldest first. */
    trail: Vec2[];
    /** How many crumbs have dropped off the front of `trail` (lets others keep stable indices into it). */
    trailShifts: number;
    /** How many emergency recoveries have happened (for testing/tuning). */
    recoveries: number;
}

export interface ClusterSettings {
    formationSpacing: number;
    warriorSpeed: number;
    catchUpMultiplier: number;
    warriorAcceleration: number;
    separationDistance: number;
    thinkIntervalMs: number;
    trailSpacing: number;
    trailLength: number;
    recovery: { enabled: boolean; afterMs: number; minDistance: number };
    /**
     * Guardians walk at this share of `warriorSpeed`. Kept at or above the
     * army's own top speed, so Guardians never hold the army back.
     */
    guardianSpeedMultiplier?: number;
}

/** A Warrior's solid footprint. */
export const WARRIOR_BODY: Body = { halfWidth: 3, height: 3 };

/** How often to check whether a travelling Warrior is stuck (ms). */
const STUCK_CHECK_MS = 900;
/** Moving less than this between checks while travelling counts as stuck. */
const STUCK_DISTANCE = 4;
/**
 * Soldier detour searches allowed per update, across every army. A big
 * battle jams hundreds of soldiers at once; searching for all of them in one
 * tick stalled the server for hundreds of ms. The rest simply try again later.
 */
const DETOUR_SEARCHES_PER_UPDATE = 3;
/**
 * A soldier's detour search gives up after this many grid cells. Detours a
 * soldier needs are short; a search that can't find one (the centre is walled
 * off from here) would otherwise scan its whole window, the costliest case.
 */
const SOLDIER_DETOUR_VISITS = 2500;
let detourBudgetAt = -1;
let detourBudgetLeft = 0;
function takeDetourSearch (now: number): boolean
{
    if (now !== detourBudgetAt)
    {
        detourBudgetAt = now;
        detourBudgetLeft = DETOUR_SEARCHES_PER_UPDATE;
    }
    if (detourBudgetLeft <= 0) return false;
    detourBudgetLeft--;
    return true;
}
/** Warriors heading for the centre (not yet in formation) stop this close to it. */
const CENTER_STANDOFF = 10;
/** Fighting Warriors stop this close to their enemy (inside striking range). */
const ENGAGE_STANDOFF = 8;

export function createCluster (id: number, position: Vec2): Cluster
{
    return { id, center: createMover(position), warriors: [], heading: { x: 0, y: 1 }, trail: [], trailShifts: 0, recoveries: 0 };
}

export function createWarrior (id: number, position: Vec2, maxHp = 100, role: SoldierRole = 'warrior'): Warrior
{
    return {
        role,
        hp: maxHp,
        maxHp,
        nextAttackAt: 0,
        engage: null,
        // Set from the start (never added later), so every soldier object keeps the same shape.
        burningUntil: 0,
        nextBurnAt: 0,
        id,
        position: { x: position.x, y: position.y },
        velocity: { x: 0, y: 0 },
        facing: 1,
        isMoving: false,
        slot: 0,
        route: { mode: 'slot' },
        nextThinkAt: 0,
        lostSince: 0,
        lastCheckPosition: { x: position.x, y: position.y },
        nextStuckCheckAt: 0,
    };
}

/** Add a Warrior at `position`; it takes the first free formation spot (the outer edge). */
export function addWarrior (cluster: Cluster, id: number, position: Vec2, maxHp = 100, role: SoldierRole = 'warrior'): Warrior
{
    const used = new Set(cluster.warriors.map((w) => w.slot));
    const warrior = createWarrior(id, position, maxHp, role);
    while (used.has(warrior.slot)) warrior.slot++;
    cluster.warriors.push(warrior);
    return warrior;
}

/**
 * Commander speed multiplier for an army size, blended smoothly between the
 * points of `curve` ([size, multiplier] pairs, sizes ascending).
 */
export function speedMultiplier (armySize: number, curve: readonly (readonly [number, number])[], minimum: number): number
{
    if (curve.length === 0) return 1;
    if (armySize <= curve[0][0]) return Math.max(minimum, curve[0][1]);

    for (let i = 0; i < curve.length - 1; i++)
    {
        const [sizeA, multA] = curve[i];
        const [sizeB, multB] = curve[i + 1];
        if (armySize <= sizeB)
        {
            const t = (armySize - sizeA) / (sizeB - sizeA);
            return Math.max(minimum, multA + (multB - multA) * t);
        }
    }

    return Math.max(minimum, curve[curve.length - 1][1]);
}

// ---------------------------------------------------------------------------
// Formation
// ---------------------------------------------------------------------------

const slotCache = new Map<number, Vec2[]>();

/**
 * Formation spots relative to the cluster centre, arranged in a "sunflower"
 * spiral: the first soldier stands in the middle and each new one takes the
 * next spot outward. This packs evenly into a round, organic-looking cluster
 * that grows naturally, rather than rows or a line.
 */
export function formationSlots (spacing: number, count = 30): Vec2[]
{
    const cacheKey = spacing * 1000 + count;
    const cached = slotCache.get(cacheKey);
    if (cached) return cached;

    const rng = createRng(1234);
    const golden = Math.PI * (3 - Math.sqrt(5)); // ~137.5 degrees
    const scale = spacing * 0.56;
    const slots: Vec2[] = [];

    for (let i = 0; i < count; i++)
    {
        if (i === 0) { slots.push({ x: 0, y: 0 }); continue; }
        const radius = scale * Math.sqrt(i + 1);
        const angle = i * golden;
        // A pixel or two of jitter keeps it from looking machine-made.
        slots.push({
            x: Math.cos(angle) * radius + (rng() - 0.5) * 2,
            y: Math.sin(angle) * radius * 0.9 + (rng() - 0.5) * 2, // slightly flattened for the top-down view
        });
    }

    slotCache.set(cacheKey, slots);
    return slots;
}

/** How far behind the cluster's centre line Archers stand (world px). */
const ARCHER_REAR = 10;

/**
 * An Archer's spot: its formation slot, moved back along the cluster's
 * heading so it is at least ARCHER_REAR px behind the centre. Archers end up
 * in the rear half, with the melee Warriors between them and the enemy ahead.
 */
export function rearSlot (slot: Vec2, heading: Vec2): Vec2
{
    const ahead = slot.x * heading.x + slot.y * heading.y;
    if (ahead <= -ARCHER_REAR) return slot;
    const back = ahead + ARCHER_REAR;
    return { x: slot.x - heading.x * back, y: slot.y - heading.y * back };
}

/** How far ahead of the cluster's centre line Guardians stand (world px). */
const GUARDIAN_FRONT = 8;

/**
 * A Guardian's spot: its formation slot, moved forward along the cluster's
 * heading so it is at least GUARDIAN_FRONT px ahead of the centre. Guardians
 * end up in the front half, shields between the enemy and everyone else.
 */
export function frontSlot (slot: Vec2, heading: Vec2): Vec2
{
    const ahead = slot.x * heading.x + slot.y * heading.y;
    if (ahead >= GUARDIAN_FRONT) return slot;
    const forward = GUARDIAN_FRONT - ahead;
    return { x: slot.x + heading.x * forward, y: slot.y + heading.y * forward };
}

/** Where a soldier of this role stands: Archers at the back, Guardians up front. */
function roleSlot (role: SoldierRole, slot: Vec2, heading: Vec2): Vec2
{
    if (role === 'archer') return rearSlot(slot, heading);
    if (role === 'guardian') return frontSlot(slot, heading);
    return slot;
}

/** Roughly how far a cluster of `count` soldiers reaches from its centre. */
export function clusterRadius (count: number, spacing: number): number
{
    return count <= 1 ? 4 : spacing * 0.56 * Math.sqrt(count) + 4;
}

export function centroid (warriors: readonly Warrior[]): Vec2
{
    if (warriors.length === 0) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    for (const w of warriors) { x += w.position.x; y += w.position.y; }
    return { x: x / warriors.length, y: y / warriors.length };
}

/**
 * Give every Warrior a fresh formation spot (used after splitting/merging):
 * inner spots first, each going to the closest Warrior, so nobody has to
 * cross the whole cluster.
 */
export function reassignSlots (cluster: Cluster, spacing: number): void
{
    const slots = formationSlots(spacing, Math.max(30, cluster.warriors.length));
    const centre = cluster.center.position;
    const unassigned = [...cluster.warriors];

    for (let i = 0; i < cluster.warriors.length; i++)
    {
        const target = { x: centre.x + slots[i].x, y: centre.y + slots[i].y };
        let bestIndex = 0;
        let best = Infinity;
        unassigned.forEach((w, index) => {
            const d = distance(w.position, target);
            if (d < best) { best = d; bestIndex = index; }
        });
        const [warrior] = unassigned.splice(bestIndex, 1);
        warrior.slot = i;
        warrior.route = { mode: 'slot' };
        warrior.nextThinkAt = 0;
    }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Move every Warrior in a cluster toward its spot around the cluster's centre.
 * (The centre itself is moved separately: by player input for the active
 * cluster, or not at all for a detached one.)
 */
export function updateCluster (
    cluster: Cluster,
    dt: number,
    now: number,
    obstacles: ObstacleMap,
    bounds: Rect,
    settings: ClusterSettings,
): void
{
    updateHeading(cluster);
    updateTrail(cluster, settings);

    const slots = formationSlots(settings.formationSpacing, Math.max(30, cluster.warriors.length));
    const centre = cluster.center.position;

    // Big clusters: find close neighbours through a grid instead of checking every pair.
    const useGrid = cluster.warriors.length > GRID_THRESHOLD;
    if (useGrid)
    {
        separationGrid.clear();
        for (const w of cluster.warriors) separationGrid.insert(w);
    }

    for (const warrior of cluster.warriors)
    {
        // 1. Where should I be? (Archers keep to the rear, Guardians to the front.)
        const slot = slots[warrior.slot] ?? { x: 0, y: 0 };
        const target = formationTarget(centre, roleSlot(warrior.role, slot, cluster.heading), obstacles, bounds);

        // 2. How do I get there? (re-planned a few times a second, staggered)
        if (now >= warrior.nextThinkAt)
        {
            warrior.route = planRoute(warrior, target, centre, cluster.trail, obstacles, bounds, now);
            warrior.nextThinkAt = now + settings.thinkIntervalMs * (0.75 + ((warrior.id * 37) % 50) / 100);
        }

        let goal: Vec2;
        let arriving = false;
        switch (warrior.route.mode)
        {
            case 'slot': goal = target; arriving = true; break;
            case 'center': goal = centre; break;
            case 'crumb': goal = cluster.trail[warrior.route.index] ?? centre; break;
            case 'detour': goal = warrior.route.points[warrior.route.index] ?? centre; break;
        }

        // Reached a breadcrumb or detour point? Move on to the next one.
        if (warrior.route.mode === 'crumb' && distance(warrior.position, goal) < 6)
        {
            const next = warrior.route.index + 1;
            warrior.route = next < cluster.trail.length ? { mode: 'crumb', index: next } : { mode: 'center' };
            warrior.nextThinkAt = now; // look for a shortcut right away
        }
        else if (warrior.route.mode === 'detour' && distance(warrior.position, goal) < 5)
        {
            const next = warrior.route.index + 1;
            warrior.route = next < warrior.route.points.length ? { ...warrior.route, index: next } : { mode: 'center' };
            if (warrior.route.mode !== 'detour') warrior.nextThinkAt = now;
        }

        // In a fight, step toward the enemy instead (the combat system keeps this close to the cluster).
        const engaged = warrior.engage !== null;
        if (warrior.engage) { goal = warrior.engage; arriving = false; }

        // 3. Desired velocity: toward the goal, slowing down to settle into the slot.
        const toGoalX = goal.x - warrior.position.x;
        const toGoalY = goal.y - warrior.position.y;
        const goalDistance = Math.hypot(toGoalX, toGoalY);
        const farBehind = distance(warrior.position, target) > 48;
        // Shallow water slows soldiers down too.
        const terrain = obstacles.speedFactorAt(warrior.position.x, warrior.position.y);
        const roleSpeed = warrior.role === 'guardian' ? settings.guardianSpeedMultiplier ?? 1 : 1;
        const topSpeed = settings.warriorSpeed * roleSpeed * (farBehind ? settings.catchUpMultiplier : 1) * terrain;

        let speed = topSpeed;
        // Slow down near the slot and stop when close enough (prevents fidgeting).
        if (arriving) speed = goalDistance < 2.5 ? 0 : Math.min(topSpeed, goalDistance * 5);
        // Heading for the centre: stop a step short instead of crowding it.
        if (warrior.route.mode === 'center' && !engaged) speed = goalDistance < CENTER_STANDOFF ? 0 : Math.min(topSpeed, (goalDistance - CENTER_STANDOFF) * 5 + 10);
        // Fighting: close in to striking distance, then hold.
        if (engaged) speed = goalDistance < ENGAGE_STANDOFF ? 0 : Math.min(topSpeed, (goalDistance - ENGAGE_STANDOFF) * 6 + 12);
        let desiredX = goalDistance > 0.01 ? (toGoalX / goalDistance) * speed : 0;
        let desiredY = goalDistance > 0.01 ? (toGoalY / goalDistance) * speed : 0;

        // Holding formation: move WITH the centre, plus a correction toward the
        // spot. Without this, soldiers only chase where their spot is, trail
        // behind it, and keep sliding the old way when the army turns.
        if (arriving && !engaged)
        {
            desiredX += cluster.center.velocity.x;
            desiredY += cluster.center.velocity.y;
            const cap = topSpeed * settings.catchUpMultiplier;
            const desiredSpeed = Math.hypot(desiredX, desiredY);
            if (desiredSpeed > cap) { desiredX *= cap / desiredSpeed; desiredY *= cap / desiredSpeed; }
        }

        // 4. Personal space: push away from very close neighbours.
        //    Much weaker while travelling, so Warriors can pass gaps in single file.
        const push = separation(warrior, useGrid ? null : cluster.warriors, settings.separationDistance);
        const pushStrength = arriving ? 1 : 0.25;
        desiredX += push.x * topSpeed * pushStrength;
        desiredY += push.y * topSpeed * pushStrength;

        // 5. Turn to the desired direction at once; only the speed eases.
        accelerate(warrior.velocity, desiredX, desiredY, settings.warriorAcceleration * dt);

        // 6. Move, sliding along obstacles.
        const moved = obstacles.move(warrior.position, WARRIOR_BODY, warrior.velocity.x * dt, warrior.velocity.y * dt);
        warrior.position.x = clamp(moved.x, bounds.x, bounds.x + bounds.width);
        warrior.position.y = clamp(moved.y, bounds.y, bounds.y + bounds.height);
        if (moved.blockedX) warrior.velocity.x = 0;
        if (moved.blockedY) warrior.velocity.y = 0;

        // Marching: everyone faces the way the army is steered, the instant it turns
        // (not when each soldier's own feet have come round). Fighting soldiers face their foe.
        const steerX = cluster.center.velocity.x;
        if (!engaged && Math.abs(steerX) > 3) warrior.facing = steerX > 0 ? 1 : -1;
        else if (Math.abs(warrior.velocity.x) > 3) warrior.facing = warrior.velocity.x > 0 ? 1 : -1;
        warrior.isMoving = Math.hypot(warrior.velocity.x, warrior.velocity.y) > 8;

        // 7. Stuck while travelling (e.g. jammed in a gap, or a detour that
        //    didn't work out)? Search for a fresh detour from where we are.
        if (now >= warrior.nextStuckCheckAt)
        {
            const travelling = warrior.route.mode !== 'slot' && !engaged;
            const movedSinceCheck = distance(warrior.position, warrior.lastCheckPosition);
            // Only a wall in the way calls for a detour: when the straight line is
            // clear, it's other soldiers blocking (a crowd or a battle), and a
            // search around walls can't help.
            if (travelling && movedSinceCheck < STUCK_DISTANCE && distance(warrior.position, centre) > CENTER_STANDOFF + 26
                && !hasClearPath(obstacles, warrior.position, centre) && takeDetourSearch(now))
            {
                const detour = findDetour(obstacles, bounds, warrior.position, centre, SOLDIER_DETOUR_VISITS);
                if (detour && detour.length > 0)
                {
                    warrior.route = { mode: 'detour', points: detour, index: 0 };
                    warrior.nextThinkAt = now + 1500; // commit to it for a moment
                }
            }
            warrior.lastCheckPosition = { x: warrior.position.x, y: warrior.position.y };
            // Staggered per soldier, so a whole army doesn't check on the same tick.
            warrior.nextStuckCheckAt = now + STUCK_CHECK_MS * (0.75 + ((warrior.id * 53) % 50) / 100);
        }

        // 8. Rare emergency recovery if badly separated for a long time.
        recoverIfLost(cluster, warrior, now, obstacles, bounds, settings);
    }
}

function updateHeading (cluster: Cluster): void
{
    const { x: vx, y: vy } = cluster.center.velocity;
    const speed = Math.hypot(vx, vy);
    if (speed < 10) return; // keep the last heading when stopped

    // The formation (archers at the back, guardians in front) turns the instant the army does.
    cluster.heading.x = vx / speed;
    cluster.heading.y = vy / speed;
}

function updateTrail (cluster: Cluster, settings: ClusterSettings): void
{
    const position = cluster.center.position;
    const last = cluster.trail[cluster.trail.length - 1];
    if (last && distance(last, position) < settings.trailSpacing) return;

    cluster.trail.push({ x: position.x, y: position.y });
    if (cluster.trail.length > settings.trailLength)
    {
        cluster.trail.shift();
        cluster.trailShifts += 1;
        // Keep breadcrumb routes pointing at the same crumbs after the shift.
        for (const w of cluster.warriors)
        {
            if (w.route.mode === 'crumb') w.route = { mode: 'crumb', index: Math.max(0, w.route.index - 1) };
        }
    }
}

/**
 * Where a Warrior's formation spot is right now. If the spot is inside an
 * obstacle, pull it in toward the centre along the same line until it's
 * free. Each slot has its own line, so displaced Warriors don't all pile
 * onto one shared fallback point. (This is what makes the cluster squeeze
 * through narrow gaps.)
 */
function formationTarget (centre: Vec2, slot: Vec2, obstacles: ObstacleMap, bounds: Rect): Vec2
{
    const ideal = { x: centre.x + slot.x, y: centre.y + slot.y };
    if (isFree(obstacles, bounds, ideal)) return ideal;

    for (let t = 0.85; t > 0.1; t -= 0.15)
    {
        const p = { x: centre.x + slot.x * t, y: centre.y + slot.y * t };
        if (isFree(obstacles, bounds, p)) return p;
    }
    return findFreeSpotNear(obstacles, bounds, ideal, WARRIOR_BODY, 28) ?? centre;
}

/**
 * Choose the simplest route that works: straight to the slot, to the
 * centre, along breadcrumbs, or (rarely) a computed detour.
 */
function planRoute (
    warrior: Warrior, target: Vec2, centre: Vec2, trail: readonly Vec2[],
    obstacles: ObstacleMap, bounds: Rect, now: number,
): Route
{
    const from = warrior.position;
    if (hasDryPath(obstacles, from, target)) return { mode: 'slot' };
    if (hasDryPath(obstacles, from, centre)) return { mode: 'center' };

    // Already following a detour? Keep going rather than recomputing it.
    const current = warrior.route;
    if (current.mode === 'detour' && current.index < current.points.length) return current;

    // Newest breadcrumb we can walk straight to (newest = closest to the centre
    // along the path). A dry one first: the army's own footsteps lead over the
    // bridge, so soldiers stream across it instead of wading beside it.
    let wetCrumb = -1;
    for (let i = trail.length - 1; i >= Math.max(0, trail.length - 40); i--)
    {
        if (!hasClearPath(obstacles, from, trail[i])) continue;
        if (!wadesBetween(obstacles, from, trail[i])) return { mode: 'crumb', index: i };
        if (wetCrumb < 0) wetCrumb = i;
    }
    // No dry way: wading is fine.
    if (hasClearPath(obstacles, from, target)) return { mode: 'slot' };
    if (hasClearPath(obstacles, from, centre)) return { mode: 'center' };
    if (wetCrumb >= 0) return { mode: 'crumb', index: wetCrumb };

    // Nothing in sight at all: search a small grid around us for a way to the centre
    // (if this update still has searches left; otherwise head for the centre and re-plan soon).
    if (!takeDetourSearch(now)) return { mode: 'center' };
    const detour = findDetour(obstacles, bounds, warrior.position, centre, SOLDIER_DETOUR_VISITS);
    if (detour && detour.length > 0) return { mode: 'detour', points: detour, index: 0 };

    return { mode: 'center' };
}

/** Can a Warrior walk in a straight line from a to b without touching an obstacle? */
export function hasClearPath (obstacles: ObstacleMap, a: Vec2, b: Vec2): boolean
{
    const length = distance(a, b);
    const steps = Math.ceil(length / 4);
    for (let i = 1; i <= steps; i++)
    {
        const t = i / steps;
        if (obstacles.overlaps(bodyRect(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, WARRIOR_BODY))) return false;
    }
    return true;
}

/**
 * Would walking straight from dry `a` to dry `b` wade through water or lava
 * on the way (e.g. across a river when a bridge is near)? False when either
 * end is already wet: then there's no dry way to avoid it.
 */
export function wadesBetween (obstacles: ObstacleMap, a: Vec2, b: Vec2): boolean
{
    if (obstacles.travelCost(a.x, a.y) > 1 || obstacles.travelCost(b.x, b.y) > 1) return false;
    const steps = Math.ceil(distance(a, b) / 4);
    for (let i = 1; i < steps; i++)
    {
        const t = i / steps;
        if (obstacles.travelCost(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) > 1) return true;
    }
    return false;
}

/** A straight walk that's clear of obstacles and stays dry (see wadesBetween). */
export function hasDryPath (obstacles: ObstacleMap, a: Vec2, b: Vec2): boolean
{
    return !wadesBetween(obstacles, a, b) && hasClearPath(obstacles, a, b);
}

/** Size of the cells used by the rare detour search (world pixels). */
const DETOUR_CELL = 8;
/** Extra room around the start/end boxes that the detour search may use. */
const DETOUR_MARGIN = 120;
/** Give up on detours bigger than this many cells (keeps worst-case cost small). */
const DETOUR_MAX_CELLS = 20_000;

/**
 * Breadth-first search on a coarse grid between two points, limited to a
 * window around them. Returns a short list of waypoints, or null.
 */
export function findDetour (obstacles: ObstacleMap, bounds: Rect, from: Vec2, to: Vec2, maxVisits = Infinity): Vec2[] | null
{
    const minX = Math.max(bounds.x, Math.min(from.x, to.x) - DETOUR_MARGIN);
    const minY = Math.max(bounds.y, Math.min(from.y, to.y) - DETOUR_MARGIN);
    const maxX = Math.min(bounds.x + bounds.width, Math.max(from.x, to.x) + DETOUR_MARGIN);
    const maxY = Math.min(bounds.y + bounds.height, Math.max(from.y, to.y) + DETOUR_MARGIN);
    const cols = Math.floor((maxX - minX) / DETOUR_CELL) + 1;
    const rows = Math.floor((maxY - minY) / DETOUR_CELL) + 1;
    if (cols * rows > DETOUR_MAX_CELLS) return null;

    const cellCentre = (c: number, r: number): Vec2 => ({ x: minX + c * DETOUR_CELL, y: minY + r * DETOUR_CELL });
    const cellOf = (p: Vec2) => ({
        c: Math.max(0, Math.min(cols - 1, Math.round((p.x - minX) / DETOUR_CELL))),
        r: Math.max(0, Math.min(rows - 1, Math.round((p.y - minY) / DETOUR_CELL))),
    });

    // 0 = unknown, 1 = free, 2 = blocked (checked lazily, only where the search goes).
    const state = new Uint8Array(cols * rows);
    const free = (c: number, r: number) => {
        const i = r * cols + c;
        if (state[i] === 0)
        {
            const p = cellCentre(c, r);
            state[i] = obstacles.overlaps(bodyRect(p.x, p.y, WARRIOR_BODY)) ? 2 : 1;
        }
        return state[i] === 1;
    };

    const start = cellOf(from);
    const goal = cellOf(to);
    const came = new Int32Array(cols * rows).fill(-1);
    const startIndex = start.r * cols + start.c;
    came[startIndex] = startIndex;
    const queue = [startIndex];
    let found = -1;

    for (let head = 0; head < queue.length && head < maxVisits; head++)
    {
        const index = queue[head];
        const c = index % cols;
        const r = (index - c) / cols;
        if (Math.abs(c - goal.c) <= 1 && Math.abs(r - goal.r) <= 1) { found = index; break; }

        for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]])
        {
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            const n = nr * cols + nc;
            if (came[n] !== -1 || !free(nc, nr)) continue;
            // Both cells may be free while the step between them clips a small obstacle (e.g. a trunk).
            if (!hasClearPath(obstacles, cellCentre(c, r), cellCentre(nc, nr))) continue;
            came[n] = index;
            queue.push(n);
        }
    }
    if (found < 0) return null;

    // Walk back from the goal, then keep only the corners we actually need.
    const cells: Vec2[] = [];
    for (let i = found; i !== startIndex; i = came[i]) cells.push(cellCentre(i % cols, Math.floor(i / cols)));
    cells.reverse();

    const waypoints: Vec2[] = [];
    let anchor = from;
    for (let i = 0; i < cells.length; i++)
    {
        const next = cells[i + 1];
        if (!next || !hasClearPath(obstacles, anchor, next))
        {
            waypoints.push(cells[i]);
            anchor = cells[i];
        }
    }
    return waypoints;
}

/** Clusters bigger than this use the neighbour grid for spacing. */
const GRID_THRESHOLD = 24;
/** Reused every frame (clusters are updated one at a time). */
const separationGrid = new SpatialGrid<Warrior>(16);

/**
 * Push away from very close neighbours. `others` = check this list directly
 * (small clusters); null = ask the neighbour grid (big clusters).
 */
function separation (warrior: Warrior, others: readonly Warrior[] | null, minDistance: number): Vec2
{
    let px = 0;
    let py = 0;
    const minSquared = minDistance * minDistance;

    const pushFrom = (other: Warrior) => {
        if (other === warrior) return;
        const dx = warrior.position.x - other.position.x;
        const dy = warrior.position.y - other.position.y;
        // Most neighbours are out of range: skip the square root for them.
        if (dx * dx + dy * dy >= minSquared) return;
        const d = Math.hypot(dx, dy);
        if (d >= minDistance) return;
        if (d < 0.01)
        {
            // Exactly on top of each other: split using the id so they go different ways.
            px += ((warrior.id % 2) * 2 - 1) * 0.8;
            return;
        }
        const amount = ((minDistance - d) / minDistance) * 0.8;
        px += (dx / d) * amount;
        py += (dy / d) * amount;
    };

    if (others) for (const other of others) pushFrom(other);
    else separationGrid.forEachNear(warrior.position, minDistance, pushFrom);

    return { x: px, y: py };
}

function recoverIfLost (
    cluster: Cluster, warrior: Warrior, now: number,
    obstacles: ObstacleMap, bounds: Rect, settings: ClusterSettings,
): void
{
    const { enabled, afterMs, minDistance } = settings.recovery;
    if (!enabled) return;

    const centre = cluster.center.position;
    if (distance(warrior.position, centre) < minDistance)
    {
        warrior.lostSince = 0;
        return;
    }
    if (warrior.lostSince === 0)
    {
        warrior.lostSince = now;
        return;
    }
    if (now - warrior.lostSince < afterMs) return;

    // Safe spot near the centre, never inside an obstacle.
    const spot = findFreeSpotNear(obstacles, bounds, centre, WARRIOR_BODY, 48);
    if (!spot || !hasClearPath(obstacles, spot, centre)) return;

    warrior.position.x = spot.x;
    warrior.position.y = spot.y;
    warrior.velocity.x = 0;
    warrior.velocity.y = 0;
    warrior.route = { mode: 'slot' };
    warrior.lostSince = 0;
    cluster.recoveries += 1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFree (obstacles: ObstacleMap, bounds: Rect, p: Vec2): boolean
{
    return p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height
        && !obstacles.overlaps(bodyRect(p.x, p.y, WARRIOR_BODY));
}

/** Search outward in rings for the closest spot where `body` fits. */
export function findFreeSpotNear (obstacles: ObstacleMap, bounds: Rect, point: Vec2, body: Body, maxRadius: number): Vec2 | null
{
    const fits = (p: Vec2) =>
        p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height
        && !obstacles.overlaps(bodyRect(p.x, p.y, body));

    if (fits(point)) return { x: point.x, y: point.y };

    for (let radius = 4; radius <= maxRadius; radius += 4)
    {
        const steps = Math.max(8, Math.round(radius / 2));
        for (let i = 0; i < steps; i++)
        {
            const angle = (i / steps) * Math.PI * 2;
            const p = { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
            if (fits(p)) return p;
        }
    }
    return null;
}

function accelerate (velocity: Vec2, targetX: number, targetY: number, maxChange: number): void
{
    steerVelocity(velocity, targetX, targetY, maxChange);
}

export function distance (a: Vec2, b: Vec2): number
{
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp (value: number, min: number, max: number): number
{
    return Math.max(min, Math.min(max, value));
}
