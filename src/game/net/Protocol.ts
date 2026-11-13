import type { SoldierRole, Warrior } from '../logic/Army';
import type { CastleStatus } from '../logic/Castles';
import type { FallenBody } from '../logic/Fallen';
import type { NeutralKind, NeutralWarrior } from '../logic/Neutrals';
import type { Player } from '../logic/Player';
import type { Vec2 } from '../logic/Types';

/**
 * The messages between the game server and the browser. Shared by both
 * sides so they always agree.
 *
 *   browser -> server: join, steering input, split, surrender (JSON)
 *   server -> browser: lobby counts, joined, full state on joining, defeat,
 *                      the roster (names, colours, kills: only when it changes)
 *                      (all JSON), and ~15 snapshots a second (binary, see
 *                      encodeSnapshot: positions packed as small numbers, and
 *                      other armies only near the player's view).
 */

/** Bump when the messages change, so old pages are told to reload. */
export const PROTOCOL_VERSION = 6;

// ---------------------------------------------------------------------------
// Browser -> server
// ---------------------------------------------------------------------------

export type ClientMessage =
    /**
     * `resume`: the token from an earlier 'joined', to take back an army whose
     * connection dropped (kept for a while on the server). `resumeOnly`: if it
     * can't be taken back, don't start a new army (answer 'expired' instead).
     */
    | { t: 'join'; v: number; name: string; color: string; resume?: string; resumeOnly?: boolean }
    | { t: 'leave' }
    /** Steering direction, each axis -1..1, and (mouse) how far away the target is. */
    | { t: 'in'; x: number; y: number; r?: number }
    | { t: 'split'; x: number; y: number }
    | { t: 'surrender'; x: number; y: number }
    /** Round-trip time check for the performance overlay: the server answers 'pong' with the same `c`. */
    | { t: 'ping'; c: number };

// ---------------------------------------------------------------------------
// Server -> browser
// ---------------------------------------------------------------------------

export interface LobbyMessage { t: 'lobby'; online: number; playing: number; full: boolean }
/** `token` takes this army back after a dropped connection; `resumed` = it's an army you had before. */
export interface JoinedMessage { t: 'joined'; id: string; token?: string; resumed?: boolean }
export interface ErrorMessage { t: 'error'; reason: 'version' | 'full' | 'expired' }

/** How long the server keeps an army whose player's connection dropped, so they can rejoin. */
export const REJOIN_GRACE_MS = 40_000;

/** Sent right after joining: what can't be rebuilt from the map seed. */
export interface StateMessage {
    t: 'state';
    time: number;
    /** [id, x, y, active(0/1)] per shard. */
    shards: number[];
    /** Every body on the battlefield. */
    bodies: BodyRow[];
}

/**
 * Who is in the match: sent when someone joins, leaves, renames, gets a kill
 * or a new best army size, not with every snapshot.
 */
export interface RosterMessage {
    t: 'roster';
    players: RosterRow[];
}

/** [netId (the number snapshots use), id, name, colorId, kind(0 human / 1 bot), kills, peakArmy] */
export type RosterRow = [number, string, string, string, number, number, number];

/** A snapshot, as decoded from the binary message (see encodeSnapshot). */
export interface SnapshotMessage {
    t: 'snap';
    /** Server game clock (ms). */
    time: number;
    /** Your own numbers for the HUD (null while not playing). */
    you: YouRow | null;
    players: SnapPlayer[];
    /** [siteId, kind, x, y, flags] per neutral; flags: NEUTRAL_* bits. */
    neutrals: number[];
    events: EventRows;
    /** Every castle's state (always all three: it's tiny). */
    castles: CastleRow[];
}

/**
 * [index, state (0 ready / 1 cooldown), cooldown ms,
 *  spin id (-1 no spin showing), spinner net (-1 none), reward (SPIN_REWARDS index), role (CASTLE_ROLES index), ms since the spin started,
 *  charger net (-1 none), ms charged, contested (0/1)]
 * The server alone runs the timers and picks the reward; browsers only show them.
 */
export type CastleRow = [number, number, number, number, number, number, number, number, number, number, number];

export const CASTLE_STATES = ['ready', 'cooldown'] as const;
export const CASTLE_ROLES: readonly SoldierRole[] = ['warrior', 'archer', 'guardian'];

/** One castle as a snapshot row (`netOf` gives a player's snapshot number). */
export function castleRow (c: CastleStatus, netOf: (p: Player) => number): CastleRow
{
    const s = c.spin;
    return [
        c.site.index, CASTLE_STATES.indexOf(c.state), Math.round(c.cooldownMs),
        s ? s.id : -1, s?.player ? netOf(s.player) : -1, s ? s.rewardId : 0, s ? CASTLE_ROLES.indexOf(s.role) : 0, s ? Math.round(s.elapsedMs) : 0,
        c.charger ? netOf(c.charger) : -1, Math.round(c.chargedMs), c.contested ? 1 : 0,
    ];
}

export interface SnapPlayer {
    /** Matches a roster row. */
    net: number;
    alive: boolean;
    leadX: number;
    leadY: number;
    headingX: number;
    headingY: number;
    /** Representative soldier's id (-1 none). */
    rep: number;
    /** Soldiers in the whole army (the list below can be fewer: only those near your view). */
    size: number;
    /** [id, x, y, hp, flags] per soldier (flags: WARRIOR_* bits). */
    warriors: number[];
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

/** The answer to a 'ping' (same `c`). */
export interface PongMessage { t: 'pong'; c: number }

export type ServerMessage = LobbyMessage | JoinedMessage | ErrorMessage | StateMessage | SnapshotMessage | DefeatMessage | RosterMessage | PongMessage;

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

/** [id, x, y, colorId, facing(1/-1), role (0 warrior / 1 archer / 2 guardian), readyInMs, expiresInMs, awake(0/1)] */
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
export const WARRIOR_GUARDIAN = 16;

/** Soldier kinds by number (bodies), and back. */
const ROLES: readonly SoldierRole[] = ['warrior', 'archer', 'guardian'];
export function roleCode (role: SoldierRole): number
{
    return Math.max(0, ROLES.indexOf(role));
}
export function roleFromCode (code: number): SoldierRole
{
    return ROLES[code] ?? 'warrior';
}

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

export function rosterRow (net: number, p: Player): RosterRow
{
    return [net, p.id, p.name, p.colorId, p.kind === 'bot' ? 1 : 0, p.kills, p.stats.peakArmy];
}

// ---------------------------------------------------------------------------
// Binary snapshots
//
// Layout (little-endian):
//   u8 marker (SNAPSHOT_MARKER), u32 time, u32 tail length, tail (UTF-8 JSON {you, events, castles}),
//   u16 players, per player:
//     u16 net, u8 alive, u16 leadX, u16 leadY, i8 headingX, i8 headingY, i32 rep, u32 size,
//     u32 soldiers sent, per soldier: u32 id, u16 x, u16 y, u16 hp, u8 flags   (11 bytes)
//   u32 neutrals, per neutral: u32 siteId, u8 kind, u16 x, u16 y, u8 flags    (10 bytes)
// Positions are world px x POS_SCALE (1/8 px steps, up to 8191 px).
// ---------------------------------------------------------------------------

export const SNAPSHOT_MARKER = 1;
const POS_SCALE = 8;
const MAX_POS = 65535 / POS_SCALE;
const SOLDIER_BYTES = 11;
const PLAYER_BYTES = 21;
const NEUTRAL_BYTES = 10;

/** One army, as the server hands it to encodeSnapshot. */
export interface SnapshotArmy {
    net: number;
    player: Player;
    /** The soldiers to send (all, or only those near the receiver's view). */
    warriors: readonly Warrior[];
    /** Soldiers in the whole army. */
    size: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeSnapshot (
    time: number, you: YouRow | null, events: EventRows,
    armies: readonly SnapshotArmy[], neutrals: readonly NeutralWarrior[], now: number, castles: readonly CastleRow[] = [],
): Uint8Array
{
    const tail = encoder.encode(JSON.stringify({ you, events, castles }));
    let size = 1 + 4 + 4 + tail.length + 2 + 4 + neutrals.length * NEUTRAL_BYTES;
    for (const a of armies) size += PLAYER_BYTES + a.warriors.length * SOLDIER_BYTES;

    const bytes = new Uint8Array(size);
    const v = new DataView(bytes.buffer);
    let o = 0;
    v.setUint8(o, SNAPSHOT_MARKER); o += 1;
    v.setUint32(o, Math.max(0, Math.round(time)), true); o += 4;
    v.setUint32(o, tail.length, true); o += 4;
    bytes.set(tail, o); o += tail.length;

    v.setUint16(o, armies.length, true); o += 2;
    for (const a of armies)
    {
        const p = a.player;
        const lead = p.army.lead;
        v.setUint16(o, a.net, true); o += 2;
        v.setUint8(o, p.respawnAt === null ? 1 : 0); o += 1;
        v.setUint16(o, pos(lead.center.position.x), true); o += 2;
        v.setUint16(o, pos(lead.center.position.y), true); o += 2;
        v.setInt8(o, heading(lead.heading.x)); o += 1;
        v.setInt8(o, heading(lead.heading.y)); o += 1;
        v.setInt32(o, p.army.representativeId ?? -1, true); o += 4;
        v.setUint32(o, a.size, true); o += 4;
        v.setUint32(o, a.warriors.length, true); o += 4;
        for (const w of a.warriors)
        {
            const flags = (w.facing < 0 ? WARRIOR_FACING_LEFT : 0) | (w.isMoving ? WARRIOR_MOVING : 0)
                | (w.role === 'archer' ? WARRIOR_ARCHER : 0) | (w.role === 'guardian' ? WARRIOR_GUARDIAN : 0)
                | (w.burningUntil > now ? WARRIOR_BURNING : 0);
            v.setUint32(o, w.id, true); o += 4;
            v.setUint16(o, pos(w.position.x), true); o += 2;
            v.setUint16(o, pos(w.position.y), true); o += 2;
            v.setUint16(o, Math.max(0, Math.min(65535, Math.round(w.hp))), true); o += 2;
            v.setUint8(o, flags); o += 1;
        }
    }

    v.setUint32(o, neutrals.length, true); o += 4;
    for (const u of neutrals)
    {
        const flags = (u.facing < 0 ? NEUTRAL_FACING_LEFT : 0) | (u.isMoving ? NEUTRAL_MOVING : 0)
            | (u.available ? NEUTRAL_AVAILABLE : 0) | (now >= u.recruitableAt ? NEUTRAL_READY : 0);
        v.setUint32(o, u.siteId, true); o += 4;
        v.setUint8(o, Math.max(0, NEUTRAL_KINDS.indexOf(u.kind))); o += 1;
        v.setUint16(o, pos(u.position.x), true); o += 2;
        v.setUint16(o, pos(u.position.y), true); o += 2;
        v.setUint8(o, flags); o += 1;
    }
    return bytes;
}

/** Read a binary snapshot (null if it isn't one, or is damaged). */
export function decodeSnapshot (buffer: ArrayBuffer): SnapshotMessage | null
{
    try
    {
        const v = new DataView(buffer);
        let o = 0;
        if (v.getUint8(o) !== SNAPSHOT_MARKER) return null;
        o += 1;
        const time = v.getUint32(o, true); o += 4;
        const tailLength = v.getUint32(o, true); o += 4;
        const tail = JSON.parse(decoder.decode(new Uint8Array(buffer, o, tailLength))) as { you: YouRow | null; events: EventRows; castles?: CastleRow[] };
        o += tailLength;

        const players: SnapPlayer[] = [];
        for (let n = v.getUint16(o, true), i = (o += 2, 0); i < n; i++)
        {
            const net = v.getUint16(o, true); o += 2;
            const alive = v.getUint8(o) === 1; o += 1;
            const leadX = v.getUint16(o, true) / POS_SCALE; o += 2;
            const leadY = v.getUint16(o, true) / POS_SCALE; o += 2;
            const headingX = v.getInt8(o) / 100; o += 1;
            const headingY = v.getInt8(o) / 100; o += 1;
            const rep = v.getInt32(o, true); o += 4;
            const size = v.getUint32(o, true); o += 4;
            const count = v.getUint32(o, true); o += 4;
            const warriors = new Array<number>(count * 5);
            for (let k = 0; k < count; k++)
            {
                warriors[k * 5] = v.getUint32(o, true);
                warriors[k * 5 + 1] = v.getUint16(o + 4, true) / POS_SCALE;
                warriors[k * 5 + 2] = v.getUint16(o + 6, true) / POS_SCALE;
                warriors[k * 5 + 3] = v.getUint16(o + 8, true);
                warriors[k * 5 + 4] = v.getUint8(o + 10);
                o += SOLDIER_BYTES;
            }
            players.push({ net, alive, leadX, leadY, headingX, headingY, rep, size, warriors });
        }

        const count = v.getUint32(o, true); o += 4;
        const neutrals = new Array<number>(count * 5);
        for (let k = 0; k < count; k++)
        {
            neutrals[k * 5] = v.getUint32(o, true);
            neutrals[k * 5 + 1] = v.getUint8(o + 4);
            neutrals[k * 5 + 2] = v.getUint16(o + 5, true) / POS_SCALE;
            neutrals[k * 5 + 3] = v.getUint16(o + 7, true) / POS_SCALE;
            neutrals[k * 5 + 4] = v.getUint8(o + 9);
            o += NEUTRAL_BYTES;
        }
        return { t: 'snap', time, you: tail.you, players, neutrals, events: tail.events, castles: tail.castles ?? [] };
    }
    catch
    {
        return null;
    }
}

function pos (n: number): number
{
    return Math.round(Math.max(0, Math.min(MAX_POS, n)) * POS_SCALE);
}

function heading (n: number): number
{
    return Math.max(-127, Math.min(127, Math.round(n * 100)));
}

export function encodeBody (b: FallenBody, now: number): BodyRow
{
    return [
        b.id, round1(b.position.x), round1(b.position.y), b.colorId, b.facing, roleCode(b.role),
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
