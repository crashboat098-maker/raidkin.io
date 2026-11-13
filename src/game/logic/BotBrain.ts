import { centroid, distance, findDetour } from './Army';
import type { CastleStatus } from './Castles';
import { averageHealth, strength } from './Combat';
import type { FallenBody } from './Fallen';
import type { NeutralWarrior } from './Neutrals';
import type { ObstacleMap } from './Obstacles';
import type { Player } from './Player';
import { allWarriors } from './PlayerArmy';
import { randRange, type Rng } from './Random';
import type { SoulShard } from './SoulShards';
import type { Rect, Vec2 } from './Types';

/**
 * Goal-driven decision-making for AI armies. A bot plays by exactly the same
 * rules as the human: all it produces is a movement direction (what a
 * keyboard gives), and collecting, recruiting and fighting happen through the
 * normal game rules. It re-thinks a few times a second, not every frame.
 *
 * Each decision it sizes up every army it knows about (strength = total
 * remaining health) and picks the most pressing goal:
 *
 *   FLEE     a much stronger army is close (or we're hurt and it's not weaker)
 *   HUNT     a clearly weaker army is in reach (big bots also search further)
 *   FIGHT    a similar-sized army is close and we're healthy
 *   SPIN     walk into a nearby castle whose Lucky Spin wheel is ready
 *   RECRUIT  a neutral Warrior is near (small armies weigh this highest)
 *   GATHER   a Soul Shard is near (staying away from threats)
 *   RECOVER  hurt: keep away from everyone and gather until healed
 *   EXPLORE  nothing better to do
 *
 * Chases that don't close the gap are abandoned, and that army is ignored
 * for a while, so a bot never chases an unreachable opponent forever.
 */

export type BotMode = 'explore' | 'gather' | 'recruit' | 'spin' | 'hunt' | 'fight' | 'flee' | 'recover';

interface Pursuit {
    playerId: string;
    bestDistance: number;
    lastImprovedAt: number;
}

export interface BotState {
    mode: BotMode;
    target: Vec2 | null;
    /** The army we're hunting / fighting / fleeing from, if any. */
    targetPlayerId: string | null;
    nextDecisionAt: number;
    fleeUntil: number;
    /** Waypoints around an obstacle, if we got stuck. */
    detour: Vec2[] | null;
    detourIndex: number;
    lastProgressAt: number;
    lastProgressPosition: Vec2;
    /** When the steering point first reached the current target (soldiers may still be on their way). */
    leadArrivedAt: number | null;
    pursuit: Pursuit | null;
    /** Armies we gave up chasing, and until when we ignore them. */
    ignoreUntil: Map<string, number>;
    /** Times this bot abandoned a chase (for testing/tuning). */
    pursuitsAbandoned: number;
    /** The army stops growing at this many soldiers (no more shards or recruits). */
    maxSoldiers: number;
}

export interface BotSettings {
    sightRadius: number;
    decisionMs: number;
    huntRatio: number;
    engageRatio: number;
    fleeRatio: number;
    injuredHealthRatio: number;
    fleeDurationMs: number;
    huntMinSize: number;
    huntSearchRadius: number;
    pursuitGiveUpMs: number;
    pursuitIgnoreMs: number;
    /** Armies this big go for castles... */
    castleMinSize?: number;
    /** ...within this distance (world px). */
    castleSearchRadius?: number;
}

/** What a bot can see of the world. */
export interface BotView {
    players: readonly Player[];
    shards: readonly SoulShard[];
    neutrals: readonly NeutralWarrior[];
    /** Fallen soldiers that can be revived right now. */
    bodies?: readonly FallenBody[];
    /** The Lucky Spin castles. */
    castles?: readonly CastleStatus[];
    obstacles: ObstacleMap;
    bounds: Rect;
    rng: Rng;
}

export function createBotState (maxSoldiers = Infinity): BotState
{
    return {
        maxSoldiers,
        mode: 'explore',
        target: null,
        targetPlayerId: null,
        nextDecisionAt: 0,
        fleeUntil: 0,
        detour: null,
        detourIndex: 0,
        lastProgressAt: 0,
        lastProgressPosition: { x: 0, y: 0 },
        leadArrivedAt: null,
        pursuit: null,
        ignoreUntil: new Map(),
        pursuitsAbandoned: 0,
    };
}

/** Is this bot pulling back right now (its soldiers shouldn't chase)? */
export function isRetreating (player: Player, now: number): boolean
{
    return !!player.bot && player.bot.mode === 'flee' && now < player.bot.fleeUntil;
}

/** A target counts as reached when a soldier is this close (shard pickup radius is 12). */
const REACHED_DISTANCE = 9;
/** How long the steering point waits on a target for soldiers to catch up. */
const ARRIVAL_PATIENCE_MS = 1500;

/** Decide (if it's time) and return this frame's movement input for a bot. */
export function botInput (bot: Player, view: BotView, now: number, settings: BotSettings): Vec2
{
    const state = bot.bot!;
    const lead = bot.army.lead.center.position;

    if (now >= state.nextDecisionAt)
    {
        decide(bot, view, now, settings);
        state.nextDecisionAt = now + settings.decisionMs * (0.8 + view.rng() * 0.4);
    }

    if (!state.target) return { x: 0, y: 0 };

    // Follow a detour if we have one, else head straight for the target.
    let goal = state.target;
    if (state.detour)
    {
        const point = state.detour[state.detourIndex];
        if (!point) state.detour = null;
        else
        {
            goal = point;
            if (distance(lead, point) < 8) state.detourIndex++;
        }
    }

    // Reached = a soldier stands on the spot (that's what picks up shards and
    // recruits). The steering point arriving isn't enough: soldiers trail a
    // little behind it, so it nudges past the spot to walk them over it,
    // and gives up after a moment if they can't get there.
    const target = state.target;
    let closest: Vec2 | null = null;
    for (const w of allWarriors(bot.army)) if (!closest || distance(w.position, target) < distance(closest, target)) closest = w.position;
    const leadThere = distance(lead, target) < 10;
    if (leadThere && state.leadArrivedAt === null) state.leadArrivedAt = now;
    if (!closest || distance(closest, target) < REACHED_DISTANCE || (leadThere && now - state.leadArrivedAt! > ARRIVAL_PATIENCE_MS))
    {
        state.target = null;
        state.detour = null;
        state.leadArrivedAt = null;
        state.nextDecisionAt = now; // pick something new right away
        return { x: 0, y: 0 };
    }
    if (distance(lead, target) < 14)
    {
        const dx = target.x - closest.x;
        const dy = target.y - closest.y;
        const d = Math.hypot(dx, dy) || 1;
        goal = { x: target.x + (dx / d) * 14, y: target.y + (dy / d) * 14 };
    }

    // Stuck behind something? Search for a way round, or give up on that target.
    if (distance(lead, state.lastProgressPosition) > 6)
    {
        state.lastProgressPosition = { ...lead };
        state.lastProgressAt = now;
    }
    else if (now - state.lastProgressAt > 1200)
    {
        state.lastProgressAt = now;
        const detour = findDetour(view.obstacles, view.bounds, lead, state.target);
        if (detour && detour.length > 0) { state.detour = detour; state.detourIndex = 0; }
        else { state.target = null; state.detour = null; state.nextDecisionAt = now; }
    }

    const gx = goal.x - lead.x;
    const gy = goal.y - lead.y;
    const gd = Math.hypot(gx, gy) || 1;
    return { x: gx / gd, y: gy / gd };
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

interface Rival {
    player: Player;
    centre: Vec2;
    strength: number;
    distance: number;
}

function decide (bot: Player, view: BotView, now: number, s: BotSettings): void
{
    const state = bot.bot!;
    const mine = allWarriors(bot.army);
    if (mine.length === 0) return;
    const me = centroid(mine);
    const myStrength = strength(bot);
    const health = averageHealth(bot);
    const injured = health < s.injuredHealthRatio;

    for (const [id, until] of state.ignoreUntil) if (now >= until) state.ignoreUntil.delete(id);

    // Size up every other living army.
    const rivals: Rival[] = [];
    for (const other of view.players)
    {
        if (other === bot || other.respawnAt !== null) continue;
        const ws = allWarriors(other.army);
        if (ws.length === 0) continue;
        const centre = centroid(ws);
        rivals.push({ player: other, centre, strength: strength(other), distance: distance(centre, me) });
    }
    const visible = rivals.filter((r) => r.distance <= s.sightRadius);

    // FLEE: a much stronger army close by, or any non-weaker one while we're hurt.
    // (Keep fleeing until the flight time is up, so we actually get away.)
    const threats = visible.filter((r) => r.strength >= myStrength * s.fleeRatio || (injured && r.strength >= myStrength * 0.8));
    if (state.mode === 'flee' && now < state.fleeUntil && state.target) return;
    if (threats.length > 0)
    {
        const away = { x: 0, y: 0 };
        for (const t of threats)
        {
            const dx = me.x - t.centre.x;
            const dy = me.y - t.centre.y;
            const d = Math.hypot(dx, dy) || 1;
            away.x += dx / d / d * 100; // nearer threats push harder
            away.y += dy / d / d * 100;
        }
        const len = Math.hypot(away.x, away.y) || 1;
        state.mode = 'flee';
        state.fleeUntil = now + s.fleeDurationMs;
        state.targetPlayerId = threats[0].player.id;
        state.pursuit = null;
        setTarget(state, clampToBounds({ x: me.x + (away.x / len) * 220, y: me.y + (away.y / len) * 220 }, view.bounds), now, me);
        return;
    }

    // HUNT: a clearly weaker army. Big bots also look beyond their sight.
    const searchRadius = mine.length >= s.huntMinSize ? s.huntSearchRadius : s.sightRadius;
    const prey = rivals
        .filter((r) => r.distance <= searchRadius && !state.ignoreUntil.has(r.player.id))
        .filter((r) => myStrength >= r.strength * s.huntRatio && !injured)
        // Prefer close, juicy targets: advantage per distance.
        .sort((a, b) => b.strength / (b.distance + 60) - a.strength / (a.distance + 60))[0];
    if (prey && trackPursuit(state, prey, now, s))
    {
        state.mode = 'hunt';
        state.targetPlayerId = prey.player.id;
        setTarget(state, prey.centre, now, me);
        return;
    }

    // FIGHT: a similar-sized army close by, while we're healthy.
    const peer = visible
        .filter((r) => !state.ignoreUntil.has(r.player.id))
        .filter((r) => myStrength >= r.strength * s.engageRatio && health >= 0.6 && mine.length >= 3)
        .sort((a, b) => a.distance - b.distance)[0];
    if (peer && trackPursuit(state, peer, now, s))
    {
        state.mode = 'fight';
        state.targetPlayerId = peer.player.id;
        setTarget(state, peer.centre, now, me);
        return;
    }
    state.pursuit = null;
    state.targetPlayerId = null;

    // Everything else: grow the army, keeping clear of armies we shouldn't fight.
    const danger = visible.filter((r) => r.strength >= myStrength * s.engageRatio);
    const safe = (p: Vec2) => danger.every((d) => distance(p, d.centre) > 140);

    // SPIN: walk into a castle whose Lucky Spin wheel is ready (stepping in spins it).
    const castle = !injured ? castleGoal(view.castles ?? [], me, mine.length, s) : null;
    if (castle)
    {
        state.mode = 'spin';
        setTarget(state, { x: castle.site.x, y: castle.site.y }, now, me);
        return;
    }

    // RECRUIT / GATHER. Small armies value recruits most; big armies value both.
    // Recruits: neutral Warriors and the bodies of the fallen (both join for free).
    // A full army leaves them for everyone else and just roams.
    const full = mine.length >= state.maxSoldiers;
    const recruits = full ? [] : view.neutrals.filter((n) => n.available).map((n) => n.position);
    if (!full) for (const body of view.bodies ?? []) recruits.push(body.position);
    const neutral = nearest(recruits.filter(safe), me, s.sightRadius * 1.2);
    const shard = full ? null : nearest(view.shards.filter((sh) => sh.active).filter(safe), me, s.sightRadius * 1.3);
    const neutralScore = neutral ? (mine.length < 10 ? 2.2 : 1.4) / (distance(neutral, me) + 40) : 0;
    const shardScore = shard ? 1 / (distance(shard, me) + 40) : 0;
    if (neutral && neutralScore >= shardScore)
    {
        state.mode = injured ? 'recover' : 'recruit';
        setTarget(state, neutral, now, me);
        return;
    }
    if (shard)
    {
        state.mode = injured ? 'recover' : 'gather';
        setTarget(state, shard, now, me);
        return;
    }

    // EXPLORE: keep the current exploration target, or pick a new one away from danger.
    if (state.mode === 'explore' && state.target) return;
    let wander: Vec2 = me;
    for (let attempt = 0; attempt < 8; attempt++)
    {
        wander = {
            x: randRange(view.rng, view.bounds.x + 60, view.bounds.x + view.bounds.width - 60),
            y: randRange(view.rng, view.bounds.y + 60, view.bounds.y + view.bounds.height - 60),
        };
        if (safe(wander)) break;
    }
    setTarget(state, wander, now, me);
    state.mode = 'explore';
}

/**
 * The nearest castle in reach whose wheel is ready, if the army is big enough.
 * One we're already standing in is skipped: a spin needs stepping in, so
 * the bot wanders off and can come back later.
 */
function castleGoal (castles: readonly CastleStatus[], me: Vec2, size: number, s: BotSettings): CastleStatus | null
{
    if (size < (s.castleMinSize ?? Infinity)) return null;
    const reach = s.castleSearchRadius ?? 0;
    let best: CastleStatus | null = null;
    for (const c of castles)
    {
        const d = distance(me, c.site);
        if (c.state !== 'ready' || d > reach || d <= c.site.radius) continue;
        if (!best || d < distance(me, best.site)) best = c;
    }
    return best;
}

/**
 * Keep track of how a chase is going. Returns false (and ignores that army
 * for a while) if we haven't closed the gap for too long.
 */
function trackPursuit (state: BotState, rival: Rival, now: number, s: BotSettings): boolean
{
    const p = state.pursuit;
    if (!p || p.playerId !== rival.player.id)
    {
        state.pursuit = { playerId: rival.player.id, bestDistance: rival.distance, lastImprovedAt: now };
        return true;
    }
    if (rival.distance < p.bestDistance - 15 || rival.distance < 40)
    {
        p.bestDistance = Math.min(p.bestDistance, rival.distance);
        p.lastImprovedAt = now;
        return true;
    }
    if (now - p.lastImprovedAt > s.pursuitGiveUpMs)
    {
        state.ignoreUntil.set(rival.player.id, now + s.pursuitIgnoreMs);
        state.pursuit = null;
        state.pursuitsAbandoned += 1;
        return false;
    }
    return true;
}

function setTarget (state: BotState, target: Vec2, now: number, from: Vec2): void
{
    const changed = !state.target || distance(state.target, target) > 24;
    state.target = { x: target.x, y: target.y };
    if (changed)
    {
        state.detour = null;
        state.leadArrivedAt = null;
        state.lastProgressAt = now;
        state.lastProgressPosition = { ...from };
    }
}

function nearest (points: readonly Vec2[], from: Vec2, maxDistance: number): Vec2 | null
{
    let best: Vec2 | null = null;
    let bestDistance = maxDistance;
    for (const p of points)
    {
        const d = distance(p, from);
        if (d < bestDistance) { bestDistance = d; best = p; }
    }
    return best;
}

function clampToBounds (p: Vec2, bounds: Rect): Vec2
{
    return {
        x: Math.max(bounds.x + 20, Math.min(bounds.x + bounds.width - 20, p.x)),
        y: Math.max(bounds.y + 20, Math.min(bounds.y + bounds.height - 20, p.y)),
    };
}
