import { centroid, distance, formationSlots, type Warrior } from './Army';
import type { Player } from './Player';
import { allWarriors } from './PlayerArmy';
import type { Rng } from './Random';
import { SpatialGrid } from './SpatialGrid';
import type { Vec2 } from './Types';

/**
 * Combat rules, pure logic (no Phaser):
 *  - Soldiers automatically fight enemy soldiers that come close.
 *  - Each soldier strikes the nearest enemy in reach every ~0.9 s.
 *  - A soldier at 0 health dies and is removed individually.
 *  - Any damage dealt or taken marks the whole army as "in combat".
 *  - After 60 s without combat, injured soldiers slowly heal.
 */

export interface CombatSettings {
    maxHp: number;
    damage: number;
    damageVariance: number;
    attackRange: number;
    attackIntervalMs: number;
    engageRadius: number;
    engageLeash: number;
    regenDelayMs: number;
    regenPerSecond: number;
    /** Archers: less health, shoot from range. */
    archer: { maxHp: number; damage: number; range: number; attackIntervalMs: number };
    /** Guardians: lots of health, light melee blows, a slow swing. */
    guardian: { maxHp: number; damage: number; attackIntervalMs: number };
    /**
     * Soldiers in a split-off cluster hit according to that cluster's size:
     * [cluster size, share of normal damage] rows, blended in between and held
     * past either end. The main cluster always hits at full damage.
     */
    clusterDamage: readonly (readonly [number, number])[];
}

/** A split-off cluster of `size` soldiers hits for this share of normal damage. */
export function clusterDamageShare (size: number, table: CombatSettings['clusterDamage']): number
{
    if (table.length === 0) return 1;
    for (let i = 0; i < table.length; i++)
    {
        const [high, highShare] = table[i];
        if (size > high) continue;
        if (i === 0) return highShare;
        const [low, lowShare] = table[i - 1];
        return lowShare + ((highShare - lowShare) * (size - low)) / (high - low);
    }
    return table[table.length - 1][1];
}

export interface Hit {
    attacker: Warrior;
    target: Warrior;
    attackerOwner: Player;
    targetOwner: Player;
    damage: number;
    /** An arrow from an Archer (rather than a sword blow). */
    ranged: boolean;
}

export interface Death {
    warrior: Warrior;
    owner: Player;
    killer: Player | null;
}

/** Quick per-army summary used to skip armies that are nowhere near each other. */
interface ArmyExtent {
    player: Player;
    centre: Vec2;
    radius: number;
}

function extentOf (player: Player): ArmyExtent | null
{
    const warriors = allWarriors(player.army);
    if (warriors.length === 0) return null;
    const centre = centroid(warriors);
    let radius = 0;
    for (const w of warriors) radius = Math.max(radius, distance(w.position, centre));
    return { player, centre, radius };
}

/** Pairs of armies close enough that their soldiers might fight. */
function nearbyPairs (players: readonly Player[], margin: number): [ArmyExtent, ArmyExtent][]
{
    const extents = players.map(extentOf).filter((e): e is ArmyExtent => e !== null);
    const pairs: [ArmyExtent, ArmyExtent][] = [];
    for (let i = 0; i < extents.length; i++)
    {
        for (let j = i + 1; j < extents.length; j++)
        {
            const a = extents[i];
            const b = extents[j];
            if (distance(a.centre, b.centre) <= a.radius + b.radius + margin) pairs.push([a, b]);
        }
    }
    return pairs;
}

/**
 * Decide which enemy each soldier should step toward this frame. Soldiers only
 * chase enemies that are close to them AND close to their own cluster, so an
 * army that moves away disengages naturally. Armies in `holdBack` (e.g. a
 * retreating bot) don't chase at all, but still defend themselves in reach.
 */
/** One reusable grid per army, rebuilt when needed (soldiers move every frame). */
const gridCache = new WeakMap<Player, SpatialGrid<Warrior>>();

function soldierGrid (player: Player): SpatialGrid<Warrior>
{
    let grid = gridCache.get(player);
    if (!grid) { grid = new SpatialGrid<Warrior>(GRID_CELL); gridCache.set(player, grid); }
    grid.clear();
    for (const { cluster } of player.army.clusters) for (const w of cluster.warriors) grid.insert(w);
    return grid;
}

const GRID_CELL = 32;
/** A cluster centre moving faster than this (px/s) counts as "on the move". */
const MOVING_SPEED = 20;
/** Same spacing the army formation uses (GameConfig.army.formationSpacing). */
const FORMATION_SPACING = 13;

export function assignEngagements (players: readonly Player[], settings: CombatSettings, holdBack: (p: Player) => boolean): void
{
    for (const p of players) for (const { cluster } of p.army.clusters) for (const w of cluster.warriors) w.engage = null;

    const pairs = nearbyPairs(players, settings.engageRadius);
    if (pairs.length === 0) return;
    const grids = new Map<Player, SpatialGrid<Warrior>>();
    const gridOf = (p: Player) => grids.get(p) ?? grids.set(p, soldierGrid(p)).get(p)!;

    const best = new Map<Warrior, number>();
    for (const [a, b] of pairs)
    {
        for (const [mine, theirs] of [[a, b], [b, a]] as const)
        {
            if (holdBack(mine.player)) continue;
            const enemies = gridOf(theirs.player);
            // While the army is on the move (its player-steered lead), nobody
            // turns back to chase an enemy behind them: running away really
            // runs away. Soldiers still close in on enemies ahead, and still
            // strike anyone already in reach.
            const vx = mine.player.army.lead.center.velocity.x;
            const vy = mine.player.army.lead.center.velocity.y;
            const moving = Math.hypot(vx, vy) > MOVING_SPEED;
            for (const { cluster } of mine.player.army.clusters)
            {
                const centre = cluster.center.position;
                const slots = formationSlots(FORMATION_SPACING, Math.max(30, cluster.warriors.length));
                for (const w of cluster.warriors)
                {
                    if (w.role === 'archer') continue; // Archers hold their place and shoot
                    // Each soldier only steps a short way out of its own spot in the
                    // formation to fight (not out to a shared circle around the army,
                    // which made fights form along an invisible line).
                    const slot = slots[w.slot] ?? { x: 0, y: 0 };
                    const homeX = centre.x + slot.x;
                    const homeY = centre.y + slot.y;
                    let bestDistance = best.get(w) ?? settings.engageRadius;
                    enemies.forEachNear(w.position, settings.engageRadius, (e) => {
                        const d = distance(w.position, e.position);
                        if (d >= bestDistance) return;
                        if (Math.hypot(e.position.x - homeX, e.position.y - homeY) > settings.engageLeash) return;
                        if (moving && (e.position.x - w.position.x) * vx + (e.position.y - w.position.y) * vy < 0) return;
                        bestDistance = d;
                        w.engage = e.position;
                        best.set(w, d);
                    });
                }
            }
        }
    }
}

/** Every soldier whose attack is ready strikes the nearest enemy in reach. */
export function resolveAttacks (players: readonly Player[], now: number, settings: CombatSettings, rng: Rng): Hit[]
{
    const hits: Hit[] = [];
    const maxRange = Math.max(settings.attackRange, settings.archer.range);
    const pairs = nearbyPairs(players, maxRange);
    if (pairs.length === 0) return hits;

    // For each army, which enemy armies are close enough to matter.
    const rivals = new Map<Player, Player[]>();
    for (const [a, b] of pairs)
    {
        rivals.set(a.player, [...(rivals.get(a.player) ?? []), b.player]);
        rivals.set(b.player, [...(rivals.get(b.player) ?? []), a.player]);
    }
    const grids = new Map<Player, SpatialGrid<Warrior>>();
    for (const p of rivals.keys()) grids.set(p, soldierGrid(p));

    for (const [attackerOwner, enemies] of rivals)
    {
        for (const { cluster, parentId } of attackerOwner.army.clusters)
        {
            // The main cluster (no parent) hits at full damage; split-off clusters by their size.
            const share = parentId === null ? 1 : clusterDamageShare(cluster.warriors.length, settings.clusterDamage);
            for (const attacker of cluster.warriors)
            {
                if (attacker.hp <= 0 || now < attacker.nextAttackAt) continue;

                let target: Warrior | null = null;
                let targetOwner: Player | null = null;
                const range = attacker.role === 'archer' ? settings.archer.range : settings.attackRange;
                let bestDistance = range;
                for (const enemy of enemies)
                {
                    grids.get(enemy)!.forEachNear(attacker.position, range, (e) => {
                        if (e.hp <= 0) return;
                        const d = distance(attacker.position, e.position);
                        if (d <= bestDistance) { bestDistance = d; target = e; targetOwner = enemy; }
                    });
                }
                if (!target || !targetOwner) continue;
                strike(attacker, target, attackerOwner, targetOwner, now, settings, rng, hits, share);
            }
        }
    }
    return hits;
}

/** One blow: damage the target, reset the attacker's swing, and mark both armies as in combat. */
function strike (
    attacker: Warrior, target: Warrior, attackerOwner: Player, targetOwner: Player,
    now: number, settings: CombatSettings, rng: Rng, hits: Hit[], damageShare = 1,
): void
{
    const ranged = attacker.role === 'archer';
    const guardian = attacker.role === 'guardian';
    const base = (ranged ? settings.archer.damage : guardian ? settings.guardian.damage : settings.damage) * damageShare;
    const damage = Math.round(base * (1 + (rng() * 2 - 1) * settings.damageVariance));
    target.hp = Math.max(0, target.hp - damage);
    const interval = ranged ? settings.archer.attackIntervalMs : guardian ? settings.guardian.attackIntervalMs : settings.attackIntervalMs;
    attacker.nextAttackAt = now + interval * (0.9 + rng() * 0.2);
    attackerOwner.lastCombatAt = now;
    targetOwner.lastCombatAt = now;
    hits.push({ attacker, target, attackerOwner, targetOwner, damage, ranged });
}

/** Remove soldiers with no health left. Returns who died (and who killed them). */
export function removeDead (players: readonly Player[], hits: readonly Hit[]): Death[]
{
    const killerOf = new Map<Warrior, Player>();
    for (const h of hits) if (h.target.hp <= 0) killerOf.set(h.target, h.attackerOwner);

    const deaths: Death[] = [];
    for (const owner of players)
    {
        for (const { cluster } of owner.army.clusters)
        {
            if (!cluster.warriors.some((w) => w.hp <= 0)) continue;
            for (const w of cluster.warriors)
            {
                if (w.hp > 0) continue;
                const killer = killerOf.get(w) ?? null;
                deaths.push({ warrior: w, owner, killer });
            }
            cluster.warriors = cluster.warriors.filter((w) => w.hp > 0);
        }
    }
    return deaths;
}

/** True once an army has gone `regenDelayMs` without dealing or taking damage. */
export function isRecovering (player: Player, now: number, settings: CombatSettings): boolean
{
    return now - player.lastCombatAt >= settings.regenDelayMs;
}

/** Heal injured soldiers of armies that have been out of combat long enough. */
export function regenerate (players: readonly Player[], now: number, dt: number, settings: CombatSettings): void
{
    for (const p of players)
    {
        if (!isRecovering(p, now, settings)) continue;
        for (const w of allWarriors(p.army))
        {
            if (w.hp <= 0 || w.hp >= w.maxHp) continue;
            if (w.burningUntil > now) continue; // no healing while standing in lava
            w.hp = Math.min(w.maxHp, w.hp + w.maxHp * settings.regenPerSecond * dt);
        }
    }
}

/** Army strength for decisions: total remaining health. */
export function strength (player: Player): number
{
    return allWarriors(player.army).reduce((sum, w) => sum + w.hp, 0);
}

/** Average health fraction of an army's soldiers (1 = all healthy). */
export function averageHealth (player: Player): number
{
    const ws = allWarriors(player.army);
    if (ws.length === 0) return 0;
    return ws.reduce((sum, w) => sum + w.hp / w.maxHp, 0) / ws.length;
}

// ---------------------------------------------------------------------------
// Health bar rules (pure, so they can be tested)
// ---------------------------------------------------------------------------

/** Health bars only appear on injured, living soldiers. */
export function needsHealthBar (w: Warrior): boolean
{
    return w.hp > 0 && w.hp < w.maxHp;
}

export type HealthLevel = 'high' | 'mid' | 'low';

/** Green above 60%, yellow above 30%, red below. */
export function healthLevel (w: Warrior): HealthLevel
{
    const ratio = w.hp / w.maxHp;
    return ratio > 0.6 ? 'high' : ratio > 0.3 ? 'mid' : 'low';
}
