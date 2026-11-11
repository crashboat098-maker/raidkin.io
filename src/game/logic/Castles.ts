import type { Player } from './Player';
import { allWarriors } from './PlayerArmy';
import { STRUCTURE_SPECS, type Structure } from './Structures';
import type { Vec2 } from './Types';

/**
 * Capturable castles: exactly one in each of three corner biomes (the fae
 * castle in the enchanted forest, the gothic fortress in the volcanic wastes,
 * the swamp castle). All three follow the same rules:
 *
 *   NEUTRAL   an army standing alone in the circle builds up capture progress;
 *             30 uninterrupted seconds takes the castle. Another army inside
 *             pauses it (contested). Progress drains slowly while the capturer
 *             is away, and only then can someone else start their own.
 *   OWNED     3 Guardians at once, then 1 every 10 s while the owner keeps
 *             soldiers in the circle and nobody else is in it, up to 40.
 *             Left unguarded (no owner soldiers in the circle), another army
 *             standing alone in it takes it over by the same 30 s capture,
 *             starting a fresh cycle for the new owner. The owner coming
 *             back (or a third army) pauses the takeover; it drains away
 *             once the challenger leaves.
 *   COOLDOWN  after the 40th Guardian: 60 s, then neutral again (anyone,
 *             the old owner too, can take it).
 *
 * If the owner is eliminated or leaves the match, the castle turns neutral.
 * Pure logic, no Phaser: the game server runs exactly this.
 */

export type CastleBiome = 'enchanted' | 'volcanic' | 'swamp';

/** Where a castle and its capture circle are (part of the map). */
export interface CastleSite {
    /** 0, 1, 2: stable across server and browsers (same map seed). */
    index: number;
    structureId: number;
    name: string;
    biome: CastleBiome;
    /** Centre and radius of the capture circle (world px). */
    x: number;
    y: number;
    radius: number;
    /** The castle's front (bottom-centre), for its banners. */
    front: Vec2;
}

export type CastleState = 'neutral' | 'owned' | 'cooldown';

/** What everyone sees of a castle (the same shape online, see NetWorld). */
export interface CastleStatus {
    site: CastleSite;
    state: CastleState;
    owner: Player | null;
    /** Who is building up capture progress (a neutral castle, or an owned one left unguarded). */
    capturer: Player | null;
    /** Capture progress, 0..1. */
    progress: number;
    /** Another army is inside: capture or production is paused. */
    contested: boolean;
    /** Guardians awarded this cycle (owned castles). */
    awarded: number;
    /** Time until the next Guardian (ms), or null while production is paused. */
    nextGuardianMs: number | null;
    /** Time until the castle turns neutral again (cooldown only, ms). */
    cooldownMs: number;
}

export interface CastleSettings {
    captureMs: number;
    /** How fast capture progress drains while the capturer is away (1 = as fast as it builds). */
    decayRate: number;
    initialGuardians: number;
    guardianEveryMs: number;
    maxGuardians: number;
    cooldownMs: number;
    /** Presence in the circles is checked this often (ms), not every frame. */
    checkIntervalMs: number;
}

const NAMES: Record<CastleBiome, string> = {
    enchanted: 'SYLVAN CASTLE',
    volcanic: 'DREAD FORTRESS',
    swamp: 'MIRE CASTLE',
};

/** The capture circle around a castle: centred a little in front of its gate. */
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

/** What happened at the castles this update. */
export interface CastleEvents {
    /** Guardians to add to these armies. */
    awards: { player: Player; count: number }[];
    /** Castles that were just taken. */
    captured: CastleStatus[];
}

export class CastleField
{
    readonly statuses: CastleStatus[];
    private sinceCheck = Infinity;
    /** Armies with soldiers in each circle, as of the last check. */
    private readonly inside: Player[][];

    constructor (sites: readonly CastleSite[], private readonly settings: CastleSettings)
    {
        this.statuses = sites.map((site) => ({
            site, state: 'neutral', owner: null, capturer: null, progress: 0, contested: false, awarded: 0, nextGuardianMs: null, cooldownMs: 0,
        }));
        this.inside = sites.map(() => []);
    }

    /**
     * Advance every castle by `dt` seconds. `players` are the armies still in
     * play (eliminated ones are not). Presence is only re-checked every
     * `checkIntervalMs`; timers run every call.
     */
    update (dt: number, players: readonly Player[]): CastleEvents
    {
        const s = this.settings;
        const events: CastleEvents = { awards: [], captured: [] };
        const ms = dt * 1000;

        this.sinceCheck += ms;
        if (this.sinceCheck >= s.checkIntervalMs)
        {
            this.sinceCheck = 0;
            this.statuses.forEach((c, i) => { this.inside[i] = armiesInCircle(c.site, players); });
        }

        this.statuses.forEach((c, i) => {
            const inside = this.inside[i];
            // The owner (or the one capturing) is gone: the castle stands empty again.
            if (c.owner && !players.includes(c.owner)) this.reset(c);
            if (c.capturer && !players.includes(c.capturer)) { c.capturer = null; c.progress = 0; }
            const present = inside.filter((p) => players.includes(p));

            if (c.state === 'cooldown')
            {
                c.contested = false;
                c.cooldownMs = Math.max(0, c.cooldownMs - ms);
                if (c.cooldownMs === 0) this.reset(c);
                return;
            }

            if (c.state === 'owned' && c.owner)
            {
                const ownerIn = present.includes(c.owner);
                const others = present.filter((p) => p !== c.owner);
                c.contested = others.length > 0 && (ownerIn || others.length > 1);
                if (!ownerIn || others.length > 0)
                {
                    c.nextGuardianMs = null;
                    // Unguarded: another army alone in the circle takes it over, like a neutral castle.
                    if (!ownerIn && others.length === 1) this.buildCapture(c, others[0], ms, events);
                    else if (!c.contested) this.drainCapture(c, ms);
                    return;
                }
                // The owner is back and alone: any takeover attempt fades.
                this.drainCapture(c, ms);
                // Production: the countdown carries over pauses (it resumes where it stopped).
                const left = (c.nextGuardianMs ?? this.pausedLeft.get(c) ?? s.guardianEveryMs) - ms;
                if (left > 0) { c.nextGuardianMs = left; this.pausedLeft.set(c, left); return; }
                this.award(c, c.owner, 1, events);
                if (c.awarded >= s.maxGuardians) this.startCooldown(c);
                else { c.nextGuardianMs = s.guardianEveryMs + left; this.pausedLeft.set(c, c.nextGuardianMs); }
                return;
            }

            // Neutral: capture.
            c.contested = present.length > 1;
            c.nextGuardianMs = null;
            if (present.length === 1) this.buildCapture(c, present[0], ms, events);
            // Contested: paused. Otherwise (empty): the capturer's progress drains away.
            else if (present.length === 0) this.drainCapture(c, ms);
        });

        return events;
    }

    /**
     * `p` stands alone in the circle: its capture progress builds, and at 100%
     * the castle is theirs. A newcomer while someone else's progress is still
     * there has to wait for it to drain away first.
     */
    private buildCapture (c: CastleStatus, p: Player, ms: number, events: CastleEvents): void
    {
        if (c.capturer && c.capturer !== p) { this.drainCapture(c, ms); return; }
        c.capturer = p;
        c.progress = Math.min(1, c.progress + ms / this.settings.captureMs);
        if (c.progress >= 1) this.capture(c, p, events);
    }

    /** Nobody is taking the castle right now: the capturer's progress drains away. */
    private drainCapture (c: CastleStatus, ms: number): void
    {
        if (!c.capturer) return;
        c.progress = Math.max(0, c.progress - (ms / this.settings.captureMs) * this.settings.decayRate);
        if (c.progress === 0) c.capturer = null;
    }

    /** The Guardian countdown, kept while production is paused. */
    private readonly pausedLeft = new Map<CastleStatus, number>();

    private capture (c: CastleStatus, p: Player, events: CastleEvents): void
    {
        c.state = 'owned';
        c.owner = p;
        c.capturer = null;
        c.progress = 0; // while owned, progress is a takeover attempt
        c.cooldownMs = 0;
        c.awarded = 0;
        c.contested = false;
        this.pausedLeft.set(c, this.settings.guardianEveryMs);
        c.nextGuardianMs = this.settings.guardianEveryMs;
        events.captured.push(c);
        this.award(c, p, Math.min(this.settings.initialGuardians, this.settings.maxGuardians), events);
        if (c.awarded >= this.settings.maxGuardians) this.startCooldown(c);
    }

    private award (c: CastleStatus, p: Player, count: number, events: CastleEvents): void
    {
        c.awarded += count;
        const existing = events.awards.find((a) => a.player === p);
        if (existing) existing.count += count;
        else events.awards.push({ player: p, count });
    }

    private startCooldown (c: CastleStatus): void
    {
        c.state = 'cooldown';
        c.cooldownMs = this.settings.cooldownMs;
        c.nextGuardianMs = null;
        c.contested = false;
        this.pausedLeft.delete(c);
    }

    private reset (c: CastleStatus): void
    {
        c.state = 'neutral';
        c.owner = null;
        c.capturer = null;
        c.progress = 0;
        c.awarded = 0;
        c.contested = false;
        c.nextGuardianMs = null;
        c.cooldownMs = 0;
        this.pausedLeft.delete(c);
    }
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
