import type { SoldierRole } from './Army';
import type { Player } from './Player';
import { allWarriors } from './PlayerArmy';
import type { Rng } from './Random';
import { STRUCTURE_SPECS, type Structure } from './Structures';
import type { Vec2 } from './Types';

/**
 * Lucky Spin castles: one in each of three corner biomes (the fae castle in
 * the enchanted forest, the gothic fortress in the volcanic wastes, the swamp
 * castle). All three follow the same rules:
 *
 *   READY     an army that steps into the circle alone starts charging the
 *             wheel; `chargeMs` (45 s) in the circle spins it. Another army
 *             inside pauses the countdown (contested); leaving the circle
 *             resets it. The reward is decided at the spin (by whoever runs
 *             the World: the game server online), the wheel turns for
 *             `spinMs`, and the reward lands: soldiers join or (rarely) leave.
 *   COOLDOWN  `cooldownMs` from the moment of the spin, then READY again.
 *
 * Only an army that stepped in since the last spin can charge: everyone in
 * the circle when a wheel spins has to leave and come back for another try.
 * Pure logic, no Phaser: the game server runs exactly this.
 */

export type CastleBiome = 'enchanted' | 'volcanic' | 'swamp';

/** Where a castle and its circle are (part of the map). */
export interface CastleSite {
    /** 0, 1, 2: stable across server and browsers (same map seed). */
    index: number;
    structureId: number;
    name: string;
    biome: CastleBiome;
    /** Centre and radius of the circle (world px). */
    x: number;
    y: number;
    radius: number;
    /** The castle's front (bottom-centre), for its banners. */
    front: Vec2;
}

export type CastleState = 'ready' | 'cooldown';

export interface SpinReward {
    /** Shown on the wheel and in the result. */
    label: string;
    /** Soldiers gained (negative: lost). */
    count: number;
    /** Which soldiers join ('random' = one class picked at the spin; null = a loss). */
    role: SoldierRole | 'random' | null;
    /** Relative chance (they add up to 100, so these read as percentages). */
    weight: number;
}

/**
 * The wheel. Its order is the order of the slices around the wheel (clockwise
 * from the top); indices are what the server sends, so don't reorder casually.
 */
export const SPIN_REWARDS: readonly SpinReward[] = [
    { label: '+10 WARRIORS', count: 10, role: 'warrior', weight: 18 },
    { label: '+15 ARCHERS', count: 15, role: 'archer', weight: 11 },
    { label: '+10 GUARDIANS', count: 10, role: 'guardian', weight: 18 },
    { label: '+25 SOLDIERS', count: 25, role: 'random', weight: 10 },
    { label: '+10 ARCHERS', count: 10, role: 'archer', weight: 18 },
    { label: '+15 GUARDIANS', count: 15, role: 'guardian', weight: 11 },
    { label: 'LOSE 10', count: -10, role: null, weight: 3 },
    { label: '+15 WARRIORS', count: 15, role: 'warrior', weight: 11 },
];

const ROLES: readonly SoldierRole[] = ['warrior', 'archer', 'guardian'];

/** One spin of a castle's wheel. */
export interface CastleSpin {
    /** Counts up per castle, so browsers can tell a new spin from the last one. */
    id: number;
    player: Player | null;
    /** Index into SPIN_REWARDS. */
    rewardId: number;
    /** The class that joins (for a loss: unused, 'warrior'). */
    role: SoldierRole;
    /** Time since the spin started (ms). */
    elapsedMs: number;
    /** The reward has been handed out (the wheel has landed). */
    landed: boolean;
}

/** What everyone sees of a castle (the same shape online, see NetWorld). */
export interface CastleStatus {
    site: CastleSite;
    state: CastleState;
    /** Time until the wheel is ready again (cooldown only, ms). */
    cooldownMs: number;
    /** The army holding the circle to spin the wheel (ready only). */
    charger: Player | null;
    /** How long the charger has held the circle so far (ms, of `chargeMs`). */
    chargedMs: number;
    /** Another army is in the circle: the countdown is paused. */
    contested: boolean;
    /** The latest spin (kept after it lands, so the result can be shown). */
    spin: CastleSpin | null;
}

export interface CastleSettings {
    /** How long an army must hold the circle (uncontested time) to spin the wheel. */
    chargeMs: number;
    cooldownMs: number;
    /** How long the wheel spins before the reward lands (ms). */
    spinMs: number;
    /** How long the result stays up after it lands (ms). */
    resultMs: number;
    /** Presence in the circles is checked this often (ms), not every frame. */
    checkIntervalMs: number;
}

const NAMES: Record<CastleBiome, string> = {
    enchanted: 'SYLVAN CASTLE',
    volcanic: 'DREAD FORTRESS',
    swamp: 'MIRE CASTLE',
};

/** The circle around a castle: centred a little in front of its gate. */
export function castleSite (index: number, structure: Structure, biome: CastleBiome): CastleSite
{
    const spec = STRUCTURE_SPECS[structure.type];
    return {
        index,
        structureId: structure.id,
        name: NAMES[biome],
        biome,
        x: structure.x,
        y: structure.y + 56,
        radius: Math.max(140, Math.round(spec.width / 2 + 36)),
        front: { x: structure.x, y: structure.y },
    };
}

export function newCastleStatus (site: CastleSite): CastleStatus
{
    return { site, state: 'ready', cooldownMs: 0, spin: null, charger: null, chargedMs: 0, contested: false };
}

/** A reward landed: `count` soldiers of `role` join `player` (negative: leave). */
export interface CastleAward {
    castle: CastleStatus;
    player: Player;
    count: number;
    role: SoldierRole;
}

/** What happened at the castles this update. */
export interface CastleEvents {
    /** Wheels that just started spinning. */
    spins: CastleStatus[];
    /** Rewards that just landed. */
    awards: CastleAward[];
}

/** Pick a reward by weight. */
export function rollReward (rng: Rng): number
{
    const total = SPIN_REWARDS.reduce((sum, r) => sum + r.weight, 0);
    let roll = rng() * total;
    for (let i = 0; i < SPIN_REWARDS.length; i++)
    {
        roll -= SPIN_REWARDS[i].weight;
        if (roll < 0) return i;
    }
    return 0;
}

export class CastleField
{
    readonly statuses: CastleStatus[];
    private sinceCheck = Infinity;
    /** Armies with soldiers in each circle, as of the last check. */
    private inside: Set<Player>[];

    constructor (sites: readonly CastleSite[], private readonly settings: CastleSettings, private readonly rng: Rng)
    {
        this.statuses = sites.map(newCastleStatus);
        this.inside = sites.map(() => new Set());
        this.eligible = sites.map(() => new Set());
    }

    /**
     * Advance every castle by `dt` seconds. `players` are the armies still in
     * play (eliminated ones are not). Presence is only re-checked every
     * `checkIntervalMs`; timers run every call.
     */
    update (dt: number, players: readonly Player[]): CastleEvents
    {
        const s = this.settings;
        const events: CastleEvents = { spins: [], awards: [] };
        const ms = dt * 1000;

        // Timers: cooldowns run down, spinning wheels land.
        for (const c of this.statuses)
        {
            if (c.state === 'cooldown')
            {
                c.cooldownMs = Math.max(0, c.cooldownMs - ms);
                if (c.cooldownMs === 0) c.state = 'ready';
            }
            const spin = c.spin;
            if (!spin) continue;
            spin.elapsedMs += ms;
            if (!spin.landed && spin.elapsedMs >= s.spinMs)
            {
                spin.landed = true;
                // The spinner left the match meanwhile: nobody to reward.
                if (spin.player && players.includes(spin.player))
                {
                    const reward = SPIN_REWARDS[spin.rewardId];
                    events.awards.push({ castle: c, player: spin.player, count: reward.count, role: spin.role });
                }
            }
            if (spin.landed && spin.elapsedMs >= s.spinMs + s.resultMs) c.spin = null;
        }

        // Who is in each circle (re-checked every `checkIntervalMs`). Stepping in
        // makes an army eligible to charge; stepping out ends that.
        this.sinceCheck += ms;
        if (this.sinceCheck >= s.checkIntervalMs)
        {
            this.sinceCheck = 0;
            this.statuses.forEach((c, i) => {
                const before = this.inside[i];
                const now = new Set(armiesInCircle(c.site, players));
                this.inside[i] = now;
                const eligible = this.eligible[i];
                for (const p of now) if (!before.has(p)) eligible.add(p);
                for (const p of eligible) if (!now.has(p)) eligible.delete(p);
            });
        }

        // Charging: one army alone in a ready circle counts down to the spin.
        this.statuses.forEach((c, i) => {
            const inside = this.inside[i];
            if (c.state !== 'ready')
            {
                c.charger = null;
                c.chargedMs = 0;
                c.contested = false;
                return;
            }
            // The charger left the circle (or the match): its progress is lost.
            if (c.charger && !inside.has(c.charger)) { c.charger = null; c.chargedMs = 0; }
            if (!c.charger)
            {
                // Alone in the circle, and stepped in since the last spin: start charging.
                const [only] = inside;
                if (inside.size === 1 && this.eligible[i].has(only)) c.charger = only;
            }
            c.contested = inside.size > 1;
            if (!c.charger || c.contested) return; // contested: paused
            c.chargedMs = Math.min(s.chargeMs, c.chargedMs + ms);
            if (c.chargedMs >= s.chargeMs) this.spin(c, i, c.charger, events);
        });

        return events;
    }

    /** The wheel spins for `player`: the reward is decided now, the castle cools down. */
    private spin (c: CastleStatus, i: number, player: Player, events: CastleEvents): void
    {
        const s = this.settings;
        const rewardId = rollReward(this.rng);
        const reward = SPIN_REWARDS[rewardId];
        const role = reward.role === 'random' ? ROLES[Math.floor(this.rng() * ROLES.length)] : reward.role ?? 'warrior';
        this.spinCount[i] = (this.spinCount[i] ?? 0) + 1;
        c.spin = { id: this.spinCount[i], player, rewardId, role, elapsedMs: 0, landed: false };
        c.state = 'cooldown';
        c.cooldownMs = s.cooldownMs;
        c.charger = null;
        c.chargedMs = 0;
        c.contested = false;
        // Everyone in the circle now has to leave and come back for another try.
        this.eligible[i].clear();
        events.spins.push(c);
    }

    /** Per castle: armies that stepped in since the last spin (only they can charge). */
    private readonly eligible: Set<Player>[];

    /** Spins so far per castle (ids keep counting after a spin is cleared). */
    private readonly spinCount: number[] = [];
}

/** Armies with at least one soldier inside the circle (a quick box test skips armies far away). */
export function armiesInCircle (site: CastleSite, players: readonly Player[]): Player[]
{
    const r2 = site.radius * site.radius;
    const found: Player[] = [];
    for (const p of players)
    {
        if (p.respawnAt !== null) continue;
        // The army's steering point is usually far from every castle: skip those armies cheaply.
        const lead = p.army.lead.center.position;
        const reach = site.radius + 600;
        if (Math.abs(lead.x - site.x) > reach || Math.abs(lead.y - site.y) > reach) continue;
        for (const w of allWarriors(p.army))
        {
            const dx = w.position.x - site.x;
            const dy = w.position.y - site.y;
            if (dx * dx + dy * dy <= r2) { found.push(p); break; }
        }
    }
    return found;
}
