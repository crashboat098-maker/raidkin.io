import type { Warrior } from '../logic/Army';
import type { FallenBody } from '../logic/Fallen';
import type { NeutralKind, NeutralWarrior } from '../logic/Neutrals';
import type { Player } from '../logic/Player';
import type { Vec2 } from '../logic/Types';

/**
 * The messages between the game server and the browser. Shared by both
 * sides so they always agree. Everything is plain JSON; long lists are flat
 * number arrays to keep each update small.
 *
 *   browser -> server: join, steering input, split, surrender
 *   server -> browser: lobby counts, joined, full state on joining,
 *                      ~15 snapshots a second, defeat
 */

/** Bump when the messages change, so old pages are told to reload. */
export const PROTOCOL_VERSION = 2;

// ---------------------------------------------------------------------------
// Browser -> server
// ---------------------------------------------------------------------------

export type ClientMessage =
    | { t: 'join'; v: number; name: string; color: string }
    | { t: 'leave' }
    /** Steering direction, each axis -1..1. */
    | { t: 'in'; x: number; y: number }
    | { t: 'split'; x: number; y: number }
    | { t: 'surrender'; x: number; y: number };

// ---------------------------------------------------------------------------
// Server -> browser
// ---------------------------------------------------------------------------

export interface LobbyMessage { t: 'lobby'; online: number; playing: number; full: boolean }
export interface JoinedMessage { t: 'joined'; id: string }
export interface ErrorMessage { t: 'error'; reason: 'version' | 'full' }

/** Sent right after joining: what can't be rebuilt from the map seed. */
export interface StateMessage {
    t: 'state';
    time: number;
    /** [id, x, y, active(0/1)] per shard. */
    shards: number[];
    /** Every body on the battlefield. */
    bodies: BodyRow[];
}

export interface SnapshotMessage {
    t: 'snap';
    /** Server game clock (ms). */
    time: number;
    /** Your own numbers for the HUD (null while not playing). */
    you: YouRow | null;
    players: PlayerRow[];
    /** [siteId, kind, x, y, flags] per neutral; flags: NEUTRAL_* bits. */
    neutrals: number[];
    events: EventRows;
}

export interface DefeatMessage {
    t: 'defeat';
    kills: number;
    largestArmy: number;
    shards: number;
    survivalMs: number;
    rank: number;
    competitors: number;
}

export type ServerMessage = LobbyMessage | JoinedMessage | ErrorMessage | StateMessage | SnapshotMessage | DefeatMessage;

export interface YouRow {
    soulShards: number;
    recruitProgress: number;
    archerProgress: number;
    clusters: number;
    /** Seconds until the next cluster heads back (null if none waiting). */
    regroup: number | null;
    /** Your army's top speed right now (world px/s), so the browser can move it without waiting. */
    speed: number;
}

/**
 * [id, name, colorId, kind(0 human / 1 bot), alive(0/1), kills, peakArmy,
 *  leadX, leadY, headingX, headingY, representativeId(-1 none), warriors]
 * where warriors is [id, x, y, hp, flags] per soldier (flags: WARRIOR_* bits).
 */
export type PlayerRow = [string, string, string, number, number, number, number, number, number, number, number, number, number[]];

/** [id, x, y, colorId, facing(1/-1), archer(0/1), readyInMs, expiresInMs, awake(0/1)] */
export type BodyRow = [number, number, number, string, number, number, number, number, number];

export interface EventRows {
    /** [attackerId, targetId, ranged(0/1)] */
    hits: number[];
    /** Soldiers who died. */
    deaths: number[];
    /** Soldiers burnt by lava. */
    burns: number[];
    /** [x, y] where clusters split / merged. */
    splits: number[];
    merges: number[];
    /** [warriorId, siteId] of soldiers who surrendered (the neutral arrives in `neutrals`). */
    surrendered: number[];
    /** [warriorId, how] of soldiers who just joined an army (how: JOIN_*). */
    joined: number[];
    shardsCollected: number[];
    /** [id, x, y] */
    shardsRespawned: number[];
    bodiesFallen: BodyRow[];
    bodiesAwakened: number[];
    /** Bodies revived or faded away. */
    bodiesRemoved: number[];
}

export const WARRIOR_FACING_LEFT = 1;
export const WARRIOR_MOVING = 2;
export const WARRIOR_ARCHER = 4;
export const WARRIOR_BURNING = 8;

export const NEUTRAL_FACING_LEFT = 1;
export const NEUTRAL_MOVING = 2;
export const NEUTRAL_AVAILABLE = 4;
/** A surrendered soldier that can be recruited now (others always can). */
export const NEUTRAL_READY = 8;

/** Summoned by shards (purple effect) or recruited/revived (amber effect). */
export const JOIN_SUMMONED = 0;
export const JOIN_RECRUITED = 1;

export const NEUTRAL_KINDS: readonly NeutralKind[] = ['wanderer', 'garrison', 'villager', 'sylvan', 'ashen', 'bogfolk', 'surrendered'];

export function emptyEvents (): EventRows
{
    return {
        hits: [], deaths: [], burns: [], splits: [], merges: [], surrendered: [], joined: [],
        shardsCollected: [], shardsRespawned: [], bodiesFallen: [], bodiesAwakened: [], bodiesRemoved: [],
    };
}

// ---------------------------------------------------------------------------
// Encoding helpers (server side)
// ---------------------------------------------------------------------------

/** One decimal place is plenty for positions. */
export function round1 (n: number): number
{
    return Math.round(n * 10) / 10;
}

export function encodeWarriors (warriors: readonly Warrior[], now: number): number[]
{
    const out: number[] = [];
    for (const w of warriors)
    {
        const flags = (w.facing < 0 ? WARRIOR_FACING_LEFT : 0) | (w.isMoving ? WARRIOR_MOVING : 0)
            | (w.role === 'archer' ? WARRIOR_ARCHER : 0) | (w.burningUntil > now ? WARRIOR_BURNING : 0);
        out.push(w.id, round1(w.position.x), round1(w.position.y), Math.round(w.hp), flags);
    }
    return out;
}

export function encodePlayer (p: Player, warriors: readonly Warrior[], now: number): PlayerRow
{
    const lead = p.army.lead;
    return [
        p.id, p.name, p.colorId, p.kind === 'bot' ? 1 : 0, p.respawnAt === null ? 1 : 0, p.kills, p.stats.peakArmy,
        round1(lead.center.position.x), round1(lead.center.position.y), round1(lead.heading.x * 100) / 100, round1(lead.heading.y * 100) / 100,
        p.army.representativeId ?? -1, encodeWarriors(warriors, now),
    ];
}

export function encodeNeutral (u: NeutralWarrior, now: number, out: number[]): void
{
    const flags = (u.facing < 0 ? NEUTRAL_FACING_LEFT : 0) | (u.isMoving ? NEUTRAL_MOVING : 0)
        | (u.available ? NEUTRAL_AVAILABLE : 0) | (now >= u.recruitableAt ? NEUTRAL_READY : 0);
    out.push(u.siteId, NEUTRAL_KINDS.indexOf(u.kind), round1(u.position.x), round1(u.position.y), flags);
}

export function encodeBody (b: FallenBody, now: number): BodyRow
{
    return [
        b.id, round1(b.position.x), round1(b.position.y), b.colorId, b.facing, b.role === 'archer' ? 1 : 0,
        Math.max(0, Math.round(b.readyAt - now)), Math.max(0, Math.round(b.expiresAt - now)), b.awake ? 1 : 0,
    ];
}

/** A direction from the network: finite numbers, at most length 1 for movement. */
export function cleanDirection (x: unknown, y: unknown, clampToUnit: boolean): Vec2 | null
{
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const length = Math.hypot(x, y);
    if (clampToUnit && length > 1) return { x: x / length, y: y / length };
    return { x, y };
}
