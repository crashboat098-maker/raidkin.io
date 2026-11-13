import type { Player } from './Player';
import { allWarriors } from './PlayerArmy';
import type { Rng } from './Random';
import type { Rect, Vec2 } from './Types';

/**
 * The Crystal Arena: a walled 1v1 battle ring in the crystal biome.
 *
 *   OPEN       two entry zones outside the gates. An army alone in a zone for
 *              `qualifyMs` qualifies (another army in the zone pauses it,
 *              leaving resets it). One army can't hold both zones.
 *   COUNTDOWN  both zones qualified: 3, 2, 1...
 *   SPINNING   each contestant's Lucky Wheel (fixed at its zone) spins to one
 *              of six equally likely outcomes, +/-10, 20 or 30 soldiers (a loss
 *              never takes an army below one soldier).
 *   FIGHT      the gates open: both armies are moved inside and fight with the
 *              normal combat rules. Nobody else can get in or hit them.
 *   VICTORY    the last army standing wins; the loser is eliminated. After a
 *              moment the winner walks out through its gate...
 *   COOLDOWN   ...and the arena rests `cooldownMs` before it opens again.
 *
 * The walls are a closed ring of colliders, so the arena is sealed at all
 * times; armies only ever go in or out through the World moving them.
 * Pure logic, no Phaser: the game server runs exactly this.
 */

/** The wheel's six slices, in order around the wheel (equally likely). */
export const ARENA_OUTCOMES: readonly number[] = [10, -10, 20, -20, 30, -30];

export interface ArenaZoneSite {
    /** Centre and radius of the entry zone (world px). */
    x: number;
    y: number;
    radius: number;
    /** Unit vector from the arena's centre out through this zone's gate. */
    dir: Vec2;
    /** The gate in the wall. */
    gate: Vec2;
    /** Where this side's army starts inside the arena. */
    inside: Vec2;
    /** Where the winner is let out (just past the zone). */
    exit: Vec2;
    /** Where this side's wheel stands (fixed, beside the zone). */
    wheel: Vec2;
}

export interface ArenaSite {
    center: Vec2;
    /** Radius of the open floor inside the walls. */
    radius: number;
    /** Wall thickness (the wall runs from `radius` to `radius + wall`). */
    wall: number;
    zones: [ArenaZoneSite, ArenaZoneSite];
}

export type ArenaPhase = 'open' | 'countdown' | 'spinning' | 'fight' | 'victory' | 'cooldown';

export interface ArenaZone {
    /** The army holding this zone (open phase), then the contestant. */
    holder: Player | null;
    heldMs: number;
    qualified: boolean;
    contested: boolean;
    /** This contestant's wheel (index into ARENA_OUTCOMES), or null before the spin. */
    outcome: number | null;
}

export interface ArenaStatus {
    site: ArenaSite;
    phase: ArenaPhase;
    /** Time spent in the current phase (ms). */
    phaseMs: number;
    zones: [ArenaZone, ArenaZone];
    /** Counts up per match (browsers use it to tell matches apart). */
    matchId: number;
    winner: Player | null;
}

export interface ArenaSettings {
    qualifyMs: number;
    countdownMs: number;
    spinMs: number;
    /** Pause after the wheels land, before the gates open. */
    resultMs: number;
    /** A fight still going after this long ends: the bigger army wins. */
    maxFightMs: number;
    victoryMs: number;
    cooldownMs: number;
    checkIntervalMs: number;
}

/** What the World has to do this frame. */
export interface ArenaEvents {
    /** A contestant's wheel landed: soldiers join (+) or leave (-). */
    awards: { player: Player; count: number }[];
    /** Move these armies (gates open: in; victory: the winner out). */
    moves: { player: Player; to: Vec2; inside: boolean }[];
    /** Eliminate this army (it lost on time). */
    forfeits: Player[];
    /** A match was won (or ended with nobody left). */
    finished: { winner: Player | null; loser: Player | null } | null;
}

const ZONE_RADIUS = 52;
const WALL = 14;

/** The arena around `center` with its two gates facing `dirs` (unit vectors). */
export function arenaSite (center: Vec2, radius: number, dirs: [Vec2, Vec2]): ArenaSite
{
    const zone = (dir: Vec2): ArenaZoneSite => {
        const at = (r: number) => ({ x: Math.round(center.x + dir.x * r), y: Math.round(center.y + dir.y * r) });
        const zoneR = radius + WALL + ZONE_RADIUS + 10;
        const z = at(zoneR);
        // The wheel stands beside the zone, off the path in and out.
        const side = { x: -dir.y, y: dir.x };
        return {
            x: z.x, y: z.y, radius: ZONE_RADIUS, dir,
            gate: at(radius + WALL / 2),
            inside: at(radius * 0.55),
            exit: at(zoneR + ZONE_RADIUS + 40),
            wheel: { x: Math.round(z.x + side.x * (ZONE_RADIUS + 46)), y: Math.round(z.y + side.y * (ZONE_RADIUS + 46)) },
        };
    };
    return { center, radius, wall: WALL, zones: [zone(dirs[0]), zone(dirs[1])] };
}

/** The wall as a closed ring of small overlapping squares (solid for everyone). */
export function arenaColliders (site: ArenaSite): Rect[]
{
    const r = site.radius + site.wall / 2;
    const count = Math.ceil((Math.PI * 2 * r) / 7);
    const size = site.wall;
    const rects: Rect[] = [];
    for (let k = 0; k < count; k++)
    {
        const a = (k / count) * Math.PI * 2;
        rects.push({ x: Math.round(site.center.x + Math.cos(a) * r - size / 2), y: Math.round(site.center.y + Math.sin(a) * r - size / 2), width: size, height: size });
    }
    return rects;
}

/** Everything the arena occupies (walls, zones, wheels): kept clear of scenery, roads and spawns. */
export function arenaFootprint (site: ArenaSite): { center: Vec2; radius: number }[]
{
    return [
        { center: site.center, radius: site.radius + site.wall + 12 },
        ...site.zones.flatMap((z) => [{ center: { x: z.x, y: z.y }, radius: z.radius + 16 }, { center: z.wheel, radius: 34 }, { center: z.exit, radius: 40 }]),
    ];
}

export function inArenaFootprint (site: ArenaSite | null, p: Vec2, margin = 0): boolean
{
    if (!site) return false;
    return arenaFootprint(site).some((c) => Math.hypot(p.x - c.center.x, p.y - c.center.y) < c.radius + margin);
}

export function newArenaStatus (site: ArenaSite): ArenaStatus
{
    const zone = (): ArenaZone => ({ holder: null, heldMs: 0, qualified: false, contested: false, outcome: null });
    return { site, phase: 'open', phaseMs: 0, zones: [zone(), zone()], matchId: 0, winner: null };
}

export class ArenaField
{
    readonly status: ArenaStatus;
    private sinceCheck = Infinity;
    private inside: Set<Player>[] = [new Set(), new Set()];

    constructor (site: ArenaSite, private readonly settings: ArenaSettings, private readonly rng: Rng)
    {
        this.status = newArenaStatus(site);
    }

    /** The two armies in the current match (countdown onwards), or null. */
    contestants (): [Player, Player] | null
    {
        const a = this.status;
        if (a.phase === 'open' || a.phase === 'cooldown') return null;
        const [x, y] = a.zones.map((z) => z.holder);
        return x && y ? [x, y] : null;
    }

    /** False for a fighter and anyone else while a fight is on: no outside help or harm. */
    canFight (a: Player, b: Player): boolean
    {
        const s = this.status;
        if (s.phase !== 'fight' && s.phase !== 'victory') return true;
        const f = this.contestants();
        if (!f) return true;
        const inA = f.includes(a);
        const inB = f.includes(b);
        return inA === inB;
    }

    update (dt: number, players: readonly Player[]): ArenaEvents
    {
        const s = this.settings;
        const a = this.status;
        const ms = dt * 1000;
        const events: ArenaEvents = { awards: [], moves: [], forfeits: [], finished: null };
        a.phaseMs += ms;
        const alive = (p: Player | null) => !!p && p.respawnAt === null && players.includes(p);

        // A contestant gone (eliminated, or left the match) before the fight: call it off.
        if ((a.phase === 'countdown' || a.phase === 'spinning') && !a.zones.every((z) => alive(z.holder)))
        {
            this.reset('open');
            return events;
        }

        switch (a.phase)
        {
            case 'open': this.updateOpen(ms, players); break;
            case 'countdown':
                if (a.phaseMs >= s.countdownMs)
                {
                    for (const z of a.zones) z.outcome = Math.floor(this.rng() * ARENA_OUTCOMES.length);
                    this.enter('spinning');
                }
                break;
            case 'spinning':
                if (a.phaseMs - ms < s.spinMs && a.phaseMs >= s.spinMs)
                {
                    for (const z of a.zones) events.awards.push({ player: z.holder!, count: ARENA_OUTCOMES[z.outcome ?? 0] });
                }
                if (a.phaseMs >= s.spinMs + s.resultMs)
                {
                    a.zones.forEach((z, i) => events.moves.push({ player: z.holder!, to: a.site.zones[i].inside, inside: true }));
                    this.enter('fight');
                }
                break;
            case 'fight': {
                const [x, y] = a.zones.map((z) => z.holder);
                const xAlive = alive(x);
                const yAlive = alive(y);
                if (xAlive && yAlive && a.phaseMs >= s.maxFightMs)
                {
                    // Too long: the bigger army wins, the other is out.
                    const size = (p: Player) => allWarriors(p.army).length;
                    const loser = size(x!) === size(y!) ? (this.rng() < 0.5 ? x! : y!) : size(x!) < size(y!) ? x! : y!;
                    events.forfeits.push(loser);
                    break;
                }
                if (xAlive && yAlive) break;
                a.winner = xAlive ? x : yAlive ? y : null;
                events.finished = { winner: a.winner, loser: xAlive ? y : yAlive ? x : null };
                this.enter('victory');
                break;
            }
            case 'victory':
                if (a.phaseMs >= s.victoryMs)
                {
                    const i = a.zones.findIndex((z) => z.holder === a.winner);
                    if (a.winner && alive(a.winner) && i >= 0) events.moves.push({ player: a.winner, to: a.site.zones[i].exit, inside: false });
                    this.reset('cooldown');
                }
                break;
            case 'cooldown':
                if (a.phaseMs >= s.cooldownMs) this.reset('open');
                break;
        }
        return events;
    }

    /** Entry zones: qualify by holding a zone alone for `qualifyMs`. */
    private updateOpen (ms: number, players: readonly Player[]): void
    {
        const s = this.settings;
        const a = this.status;
        this.sinceCheck += ms;
        if (this.sinceCheck >= s.checkIntervalMs)
        {
            this.sinceCheck = 0;
            this.inside = a.site.zones.map((z) => new Set(armiesInZone(z, players)));
        }
        a.zones.forEach((z, i) => {
            const here = this.inside[i];
            const other = a.zones[1 - i].holder;
            if (z.holder && (!here.has(z.holder) || z.holder.respawnAt !== null)) { z.holder = null; z.heldMs = 0; z.qualified = false; }
            if (!z.holder && here.size === 1)
            {
                const [only] = here;
                if (only !== other) z.holder = only;
            }
            z.contested = here.size > 1;
            if (!z.holder || z.contested || z.qualified) return;
            z.heldMs = Math.min(s.qualifyMs, z.heldMs + ms);
            if (z.heldMs >= s.qualifyMs) z.qualified = true;
        });
        if (a.zones.every((z) => z.qualified && z.holder))
        {
            a.matchId++;
            this.enter('countdown');
        }
    }

    private enter (phase: ArenaPhase): void
    {
        this.status.phase = phase;
        this.status.phaseMs = 0;
        for (const z of this.status.zones) z.contested = false;
    }

    private reset (phase: 'open' | 'cooldown'): void
    {
        const a = this.status;
        if (phase === 'open') a.winner = null;
        for (const z of a.zones)
        {
            z.holder = null; z.heldMs = 0; z.qualified = false; z.contested = false; z.outcome = null;
        }
        this.inside = [new Set(), new Set()];
        this.sinceCheck = Infinity;
        this.enter(phase);
    }
}

/** Armies with a soldier in the zone (a quick box test skips armies far away). */
function armiesInZone (z: ArenaZoneSite, players: readonly Player[]): Player[]
{
    const r2 = z.radius * z.radius;
    const found: Player[] = [];
    for (const p of players)
    {
        if (p.respawnAt !== null) continue;
        const lead = p.army.lead.center.position;
        if (Math.abs(lead.x - z.x) > z.radius + 600 || Math.abs(lead.y - z.y) > z.radius + 600) continue;
        for (const w of allWarriors(p.army))
        {
            const dx = w.position.x - z.x;
            const dy = w.position.y - z.y;
            if (dx * dx + dy * dy <= r2) { found.push(p); break; }
        }
    }
    return found;
}
