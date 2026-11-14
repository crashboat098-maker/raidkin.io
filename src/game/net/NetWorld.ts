import type { GameConfig as GameConfigType } from '../config/GameConfig';
import { createWarrior, type SoldierRole, type Warrior } from '../logic/Army';
import { newArenaStatus, type ArenaStatus } from '../logic/Arena';
import { newCastleStatus, type CastleStatus } from '../logic/Castles';
import { generateBattlefield, type BattlefieldLayout } from '../logic/BattlefieldLayout';
import type { Death, Hit } from '../logic/Combat';
import type { FallenBody } from '../logic/Fallen';
import type { DefeatStats, GameWorld } from '../logic/GameWorld';
import { NeutralForces, type NeutralWarrior } from '../logic/Neutrals';
import { ObstacleMap } from '../logic/Obstacles';
import { createMover, updateMover, type MoverState } from '../logic/Movement';
import { createNavigator, steerAround, type SteerInput } from '../logic/Navigation';
import { createIdSource, type Player } from '../logic/Player';
import { createPlayerArmy } from '../logic/PlayerArmy';
import { createPlayerResources } from '../logic/PlayerResources';
import { SoulShardField, type SoulShard } from '../logic/SoulShards';
import type { Rect, Vec2 } from '../logic/Types';
import { movementBounds, type WorldEvents } from '../logic/World';
import type { NetClient } from './NetClient';
import {
    ARENA_PHASES, CASTLE_ROLES, CASTLE_STATES, JOIN_RECRUITED, NEUTRAL_AVAILABLE, roleFromCode, WARRIOR_GUARDIAN, NEUTRAL_FACING_LEFT, NEUTRAL_KINDS, NEUTRAL_MOVING, NEUTRAL_READY, PROTOCOL_VERSION, REJOIN_GRACE_MS,
    WARRIOR_ARCHER, WARRIOR_BURNING, WARRIOR_FACING_LEFT, WARRIOR_MOVING,
    type BodyRow, type DefeatMessage, type RosterRow, type ServerMessage, type SnapPlayer, type SnapshotMessage, type StateMessage, type YouRow,
} from './Protocol';

type Config = typeof GameConfigType;

/**
 * Online play: a mirror of the match running on the game server.
 *
 * The map is generated from the same seed as on the server, so only what
 * moves or changes comes over the network. Snapshots arrive ~15 times a
 * second; everything is drawn a little in the past (INTERPOLATION_MS) so it
 * can glide smoothly between two snapshots. Each snapshot's events (hits,
 * deaths, pickups...) are handed to the scene as the usual WorldEvents, at
 * the moment that snapshot is reached, so effects line up with movement.
 */

/**
 * About 1.6 snapshots' worth (they come every ~67 ms). It was 200 while the
 * live server sometimes paused for 100-200 ms; since the server fixes and the
 * bigger instance, its logs show no late ticks and gaps of at most ~45 ms, so
 * other armies can be shown much closer to "now". Raise it again if the F3
 * overlay's "waiting" climbs above 0%. Your own army is predicted, so this
 * delay only applies to what others do.
 */
const INTERPOLATION_MS = 110;
/** Round-trip check for the performance overlay (a tiny message). */
const PING_EVERY_MS = 2000;
/** Send steering at most this often (and at least this often while it changes). */
const INPUT_INTERVAL_MS = 50;
const INPUT_KEEPALIVE_MS = 400;
/** Resend steering when the distance to the mouse changes by this much (world px). */
const REACH_RESEND = 24;
/** Own-army prediction: how far ahead of the server's last word we aim (seconds of travel)... */
const PREDICTION_LEAD_S = 0.12;
/** ...how much drift is tolerated while moving, and beyond what distance we just jump (world px). */
const MOVING_TOLERANCE = 24;
/** ...the tolerance also grows with speed (seconds of travel), since the server is always a round trip behind... */
const MOVING_TOLERANCE_S = 0.25;
/** ...after a turn, start or stop, the server's word is stale for about a round trip: don't correct meanwhile. */
const TURN_GRACE_MS = 350;
const SNAP_DISTANCE = 220;

interface Decoded {
    time: number;
    you: YouRow | null;
    message: SnapshotMessage;
    /** Each army in the snapshot with its roster row (name, colour...). */
    armies: { info: RosterRow; row: SnapPlayer }[];
    warriors: Map<number, { x: number; y: number }>;
    leads: Map<string, { x: number; y: number }>;
    neutrals: Map<number, { x: number; y: number }>;
}

interface Tracked {
    warrior: Warrior;
    owner: Player;
    /** Position at the last applied snapshot. */
    from: Vec2;
}

export class NetWorld implements GameWorld
{
    readonly layout: BattlefieldLayout;
    readonly obstacles: ObstacleMap;
    readonly players: Player[] = [];
    human: Player;
    readonly neutrals: { units: NeutralWarrior[] };
    readonly shards: { shards: SoulShard[] };
    /** The castles, as the server last reported them. */
    readonly castles: CastleStatus[];
    /** The arena, as the server last reported it. */
    readonly arena: ArenaStatus | null;
    matchStartedAt: number | null = null;
    humanDefeated = false;
    /** The connection dropped mid-match and the army couldn't be taken back. */
    disconnected = false;
    /** The connection dropped; trying to get back to our army (kept by the server for a while). */
    reconnecting = false;
    private droppedAt = 0;
    private rejoinSent = false;
    /** Joined and given the starting state: ready to draw. */
    ready = false;
    /** The server turned us away. */
    refused: 'version' | 'full' | null = null;

    private myId: string | null = null;
    /** Names, colours and kills by snapshot number (the server resends it when it changes). */
    private readonly roster = new Map<number, RosterRow>();
    private readonly playersById = new Map<string, Player>();
    private readonly leadFrom = new Map<string, Vec2>();
    private readonly warriors = new Map<number, Tracked>();
    private readonly neutralsBySite = new Map<number, NeutralWarrior>();
    private readonly neutralFrom = new Map<number, Vec2>();
    private readonly bodies = new Map<number, FallenBody>();
    private readonly pending: Decoded[] = [];
    private applied: Decoded | null = null;
    private clockOffset: number | null = null;
    private you: YouRow | null = null;
    private defeat: DefeatMessage | null = null;
    private firstApply = true;
    private lastInput: SteerInput = { x: 0, y: 0 };
    /** Our own route around obstacles, worked out here too so prediction follows the server's path. */
    private readonly nav = createNavigator();
    private lastInputSentAt = 0;
    /** Events gathered from messages that arrived between frames (state on joining). */
    private queued: WorldEvents = emptyWorldEvents();
    /** Our army's steering point as the server has it (interpolated like everyone else's). */
    private readonly ownServerLead: Vec2 = { x: 0, y: 0 };
    /** Our steering point moved locally, ahead of the server (null until we have an army). */
    private predicted: MoverState | null = null;
    /** Direction we last steered in (unit vector, or 0,0 standing still) and until when corrections wait. */
    private steerDir: Vec2 = { x: 0, y: 0 };
    private graceUntil = 0;
    private readonly moveBounds: Rect;
    /** Performance overlay (F3): round trip to the server, snapshot arrivals, frames spent waiting for one. */
    private pingMs: number | null = null;
    private nextPingAt = 0;
    private readonly snapshotArrivals: number[] = [];
    private waitingFrames = 0;
    private frames = 0;

    constructor (private readonly config: Config, private readonly net: NetClient, name: string, color: string)
    {
        this.layout = generateBattlefield(config.world);
        this.obstacles = new ObstacleMap(this.layout.obstacles, this.layout.water, config.water.slowdown, this.layout.lava);
        this.moveBounds = movementBounds(this.layout);
        // Same seeds as the server, so shard ids and neutral sites line up with it.
        this.shards = new SoulShardField(this.layout, config.soulShards, config.world.seed + 1);
        const forces = new NeutralForces(this.layout, this.obstacles, config.neutrals, config.world.seed + 2, createIdSource());
        this.neutrals = { units: forces.units };
        for (const u of forces.units) this.neutralsBySite.set(u.siteId, u);
        this.castles = this.layout.castles.map(newCastleStatus);
        this.arena = this.layout.arena ? newArenaStatus(this.layout.arena) : null;
        this.human = this.makePlayer('you', name, color, 'human', this.layout.spawn);

        net.listen((m) => this.receive(m), () => this.dropped());
        // An army left waiting after this browser lost its connection (refresh, closed tab) is taken back.
        const resume = loadRejoinToken();
        net.send(resume ? { t: 'join', v: PROTOCOL_VERSION, name, color, resume } : { t: 'join', v: PROTOCOL_VERSION, name, color });
    }

    /** Stop listening (the scene is closing). Leaving on purpose gives up the army. */
    leave (): void
    {
        this.net.listen(null);
        this.net.send({ t: 'leave' });
        saveRejoinToken(null);
    }

    /**
     * The connection dropped. Mid-match, the server keeps our army for
     * REJOIN_GRACE_MS: wait for the connection to come back and take it back.
     */
    private dropped (): void
    {
        if (!this.ready || this.humanDefeated)
        {
            this.disconnected = true;
            return;
        }
        if (!this.reconnecting) this.droppedAt = performance.now();
        this.reconnecting = true;
        this.rejoinSent = false;
    }

    /** While reconnecting: whole seconds left before the server gives our army up. */
    rejoinSecondsLeft (): number
    {
        return Math.max(0, Math.ceil((REJOIN_GRACE_MS - (performance.now() - this.droppedAt)) / 1000));
    }

    /** While reconnecting: rejoin once the connection is back; give up when the army is gone. */
    private tryRejoin (): void
    {
        if (performance.now() - this.droppedAt > REJOIN_GRACE_MS)
        {
            this.disconnected = true;
            return;
        }
        const token = loadRejoinToken();
        if (!token)
        {
            this.disconnected = true;
            return;
        }
        if (this.rejoinSent || !this.net.online) return;
        this.net.send({ t: 'join', v: PROTOCOL_VERSION, name: this.human.name, color: this.human.colorId, resume: token, resumeOnly: true });
        this.rejoinSent = true;
    }

    // -----------------------------------------------------------------------
    // GameWorld
    // -----------------------------------------------------------------------

    update (now: number, dt: number, input: SteerInput, split: boolean | Vec2 | null, surrender: Vec2 | null): WorldEvents
    {
        if (this.reconnecting)
        {
            this.tryRejoin();
            // Nothing reaches the server meanwhile: hold still rather than drift away from it.
            input = { x: 0, y: 0 };
            split = null;
            surrender = null;
        }
        this.sendInput(input, split, surrender);
        const events = this.takeQueued();
        if (this.clockOffset === null) return events;

        const renderTime = performance.now() + this.clockOffset - INTERPOLATION_MS;
        while (this.pending.length > 0 && this.pending[0].time <= renderTime)
        {
            this.apply(this.pending.shift()!, now, events);
        }
        this.interpolate(renderTime);
        this.predictOwnArmy(input, now, dt);
        this.frames++;
        if (this.applied && this.pending.length === 0) this.waitingFrames++;
        const wall = performance.now();
        if (wall >= this.nextPingAt)
        {
            this.nextPingAt = wall + PING_EVERY_MS;
            this.net.send({ t: 'ping', c: wall });
        }
        // The arena's timers run on between snapshots (never past what only the server decides).
        if (this.arena)
        {
            const a = this.arena;
            a.phaseMs += dt * 1000;
            if (a.phase === 'open')
            {
                for (const z of a.zones) if (z.holder && !z.contested && !z.qualified) z.heldMs = Math.min(this.config.arena.qualifyMs - 1, z.heldMs + dt * 1000);
            }
        }
        // Castle countdowns and wheels run on between snapshots.
        const { spinMs, resultMs, chargeMs } = this.config.castles;
        for (const c of this.castles)
        {
            c.cooldownMs = Math.max(0, c.cooldownMs - dt * 1000);
            // (Never past the end: only the server decides when the wheel spins.)
            if (c.charger && !c.contested) c.chargedMs = Math.min(chargeMs - 1, c.chargedMs + dt * 1000);
            if (!c.spin) continue;
            c.spin.elapsedMs += dt * 1000;
            c.spin.landed = c.spin.elapsedMs >= spinMs;
            if (c.spin.elapsedMs >= spinMs + resultMs) c.spin = null;
        }
        return events;
    }

    /**
     * Your own army doesn't wait for the server: its steering point moves here
     * at once, by the same rules (speed, walls, water) the server uses, and is
     * gently pulled toward where the server says it is. Your soldiers are drawn
     * shifted along with it, so the whole army answers your input instantly.
     */
    private predictOwnArmy (rawInput: SteerInput, now: number, dt: number): void
    {
        const latest = this.latestOwnLead();
        const human = this.human;
        const lead = human.army.lead.center.position;
        if (!latest || human.respawnAt !== null || !this.you)
        {
            this.predicted = null;
            lead.x = this.ownServerLead.x;
            lead.y = this.ownServerLead.y;
            return;
        }
        if (!this.predicted) this.predicted = createMover(latest);

        // Walk the same route around obstacles the server plans.
        const input = steerAround(this.nav, this.predicted.position, rawInput, now, this.obstacles, this.moveBounds);
        const m = this.config.movement;
        updateMover(this.predicted, input, dt, this.moveBounds, { maxSpeed: this.you.speed, acceleration: m.acceleration, deceleration: m.deceleration }, this.obstacles);

        // Where the server will have us by the time it hears this input: its latest
        // position, plus a little travel in the direction we're steering.
        const p = this.predicted.position;
        const length = Math.hypot(input.x, input.y);
        const ahead = length > 0.01 ? (this.you.speed * PREDICTION_LEAD_S) / Math.max(1, length) : 0;
        const targetX = latest.x + input.x * ahead;
        const targetY = latest.y + input.y * ahead;
        const errorX = targetX - p.x;
        const errorY = targetY - p.y;
        const error = Math.hypot(errorX, errorY);

        // A turn, start or stop: the server hasn't heard it yet, so its position
        // still points the old way. Trust our own movement for a round trip
        // instead of pulling back toward it (that pull is what feels like lag).
        const dirX = length > 0.01 ? input.x / length : 0;
        const dirY = length > 0.01 ? input.y / length : 0;
        const turned = (dirX === 0 && dirY === 0) !== (this.steerDir.x === 0 && this.steerDir.y === 0)
            || dirX * this.steerDir.x + dirY * this.steerDir.y < 0.9;
        if (turned)
        {
            this.steerDir = { x: dirX, y: dirY };
            // Not back to back though (circling the mouse), or drift would never be corrected.
            if (now >= this.graceUntil + TURN_GRACE_MS) this.graceUntil = now + TURN_GRACE_MS;
        }
        const settling = now < this.graceUntil;

        if (error > SNAP_DISTANCE)
        {
            // Far off (teleported, or a long stall): jump there.
            p.x = targetX;
            p.y = targetY;
        }
        else if (settling)
        {
            // Just changed direction: no correction yet.
        }
        else if (length > 0.01)
        {
            // While moving, small differences are just network wobble: leave them be.
            const tolerance = Math.max(MOVING_TOLERANCE, this.you.speed * MOVING_TOLERANCE_S);
            if (error > tolerance)
            {
                const fix = ((error - tolerance) * Math.min(1, dt * 2)) / error;
                p.x += errorX * fix;
                p.y += errorY * fix;
            }
        }
        else
        {
            const pull = Math.min(1, dt * 4);
            p.x += errorX * pull;
            p.y += errorY * pull;
        }

        lead.x = p.x;
        lead.y = p.y;
        // Move our soldiers along with the predicted steering point.
        const shiftX = p.x - this.ownServerLead.x;
        const shiftY = p.y - this.ownServerLead.y;
        if (Math.hypot(shiftX, shiftY) > SNAP_DISTANCE) return;
        for (const w of human.army.clusters[0].cluster.warriors)
        {
            w.position.x += shiftX;
            w.position.y += shiftY;
        }
    }

    /** Our steering point in the newest snapshot received (not yet drawn). */
    private latestOwnLead (): Vec2 | null
    {
        if (!this.myId) return null;
        const newest = this.pending[this.pending.length - 1] ?? this.applied;
        return newest?.leads.get(this.myId) ?? null;
    }

    splitState (): { clusters: number; regroupSeconds: number | null } | null
    {
        if (!this.you || this.human.respawnAt !== null || this.you.clusters <= 1) return null;
        return { clusters: this.you.clusters, regroupSeconds: this.you.regroup };
    }

    defeatStats (): DefeatStats
    {
        const d = this.defeat;
        return {
            kills: d?.kills ?? this.human.kills,
            largestArmy: d?.largestArmy ?? this.human.stats.peakArmy,
            shards: d?.shards ?? this.human.resources.soulShards,
            survivalMs: d?.survivalMs ?? 0,
            rank: d?.rank ?? 1,
            competitors: d?.competitors ?? this.players.length,
        };
    }

    // -----------------------------------------------------------------------
    // Messages
    // -----------------------------------------------------------------------

    private receive (m: ServerMessage): void
    {
        switch (m.t)
        {
            case 'joined':
                this.myId = m.id;
                if (m.token) saveRejoinToken(m.token);
                this.reconnecting = false;
                return;
            case 'state': this.applyState(m); return;
            case 'snap': this.queueSnapshot(m); return;
            case 'defeat':
                this.defeat = m;
                this.humanDefeated = true;
                this.human.stats.defeatedAt = performance.now();
                saveRejoinToken(null);
                return;
            case 'error':
                // Our army is gone (too late to rejoin): same as a lost connection.
                if (m.reason === 'expired') { this.disconnected = true; saveRejoinToken(null); }
                else this.refused = m.reason;
                return;
            case 'lobby': return;
            case 'pong': {
                const rtt = performance.now() - m.c;
                if (rtt >= 0 && rtt < 10_000) this.pingMs = this.pingMs === null ? rtt : this.pingMs + (rtt - this.pingMs) * 0.3;
                return;
            }
            case 'roster':
                this.roster.clear();
                for (const row of m.players) this.roster.set(row[0], row);
                return;
        }
    }

    private applyState (m: StateMessage): void
    {
        const now = performance.now();
        const queued = this.queued;
        for (let i = 0; i < m.shards.length; i += 4)
        {
            const shard = this.shards.shards[m.shards[i]];
            if (!shard) continue;
            shard.x = m.shards[i + 1];
            shard.y = m.shards[i + 2];
            shard.active = m.shards[i + 3] === 1;
        }
        // Rejoining after a drop: bodies that vanished while we were away go too.
        const listed = new Set(m.bodies.map((row) => row[0]));
        for (const [id, body] of this.bodies)
        {
            if (listed.has(id)) continue;
            this.bodies.delete(id);
            queued.bodiesExpired.push(body);
        }
        for (const row of m.bodies)
        {
            const known = this.bodies.get(row[0]);
            if (known)
            {
                if (!known.awake && row[8] === 1) { known.awake = true; queued.bodiesAwakened.push(known); }
                continue;
            }
            const body = this.addBody(row, now);
            queued.bodiesFallen.push(body);
            if (body.awake) queued.bodiesAwakened.push(body);
        }
        if (!this.ready) this.matchStartedAt = now;
        this.ready = true;
    }

    /** Connection numbers for the performance overlay, counted since the last call. */
    takeNetStats (): { pingMs: number | null; snapshotsPerSecond: number; longestGapMs: number; waitingPercent: number; delayMs: number }
    {
        const now = performance.now();
        const recent = this.snapshotArrivals.filter((t) => now - t <= 2000);
        let longestGapMs = 0;
        for (let i = 1; i < recent.length; i++) longestGapMs = Math.max(longestGapMs, recent[i] - recent[i - 1]);
        this.snapshotArrivals.length = 0;
        this.snapshotArrivals.push(...recent);
        const waitingPercent = this.frames > 0 ? (100 * this.waitingFrames) / this.frames : 0;
        this.frames = 0;
        this.waitingFrames = 0;
        return { pingMs: this.pingMs, snapshotsPerSecond: recent.length / 2, longestGapMs, waitingPercent, delayMs: INTERPOLATION_MS };
    }

    private queueSnapshot (m: SnapshotMessage): void
    {
        this.snapshotArrivals.push(performance.now());
        if (this.snapshotArrivals.length > 64) this.snapshotArrivals.shift();
        const sample = m.time - performance.now();
        // Follow the server clock smoothly; jump if it's far off (first snapshot, or a stall).
        this.clockOffset = this.clockOffset === null || Math.abs(sample - this.clockOffset) > 1000
            ? sample
            : this.clockOffset + (sample - this.clockOffset) * 0.05;

        const warriors = new Map<number, { x: number; y: number }>();
        const leads = new Map<string, { x: number; y: number }>();
        // Match each army to its roster row now (the roster may change before this snapshot is shown).
        const armies: Decoded['armies'] = [];
        for (const row of m.players)
        {
            const info = this.roster.get(row.net);
            if (!info) continue;
            armies.push({ info, row });
            leads.set(info[1], { x: row.leadX, y: row.leadY });
            const list = row.warriors;
            for (let i = 0; i < list.length; i += 5) warriors.set(list[i], { x: list[i + 1], y: list[i + 2] });
        }
        const neutrals = new Map<number, { x: number; y: number }>();
        for (let i = 0; i < m.neutrals.length; i += 5) neutrals.set(m.neutrals[i], { x: m.neutrals[i + 2], y: m.neutrals[i + 3] });
        this.pending.push({ time: m.time, you: m.you, message: m, armies, warriors, leads, neutrals });
        // Never fall far behind: drop old snapshots if many pile up (e.g. a background tab).
        while (this.pending.length > 30) this.apply(this.pending.shift()!, performance.now(), this.queued);
    }

    private sendInput (input: SteerInput, split: boolean | Vec2 | null, surrender: Vec2 | null): void
    {
        const now = performance.now();
        const changed = Math.abs(input.x - this.lastInput.x) > 0.02 || Math.abs(input.y - this.lastInput.y) > 0.02
            || Math.abs((input.reach ?? -1) - (this.lastInput.reach ?? -1)) > REACH_RESEND;
        if ((changed && now - this.lastInputSentAt >= INPUT_INTERVAL_MS) || now - this.lastInputSentAt >= INPUT_KEEPALIVE_MS)
        {
            this.net.send(input.reach === undefined
                ? { t: 'in', x: round3(input.x), y: round3(input.y) }
                : { t: 'in', x: round3(input.x), y: round3(input.y), r: Math.round(input.reach) });
            this.lastInput = { ...input };
            this.lastInputSentAt = now;
        }
        if (split)
        {
            const aim = typeof split === 'object' ? split : this.human.army.lead.heading;
            this.net.send({ t: 'split', x: round3(aim.x), y: round3(aim.y) });
        }
        if (surrender) this.net.send({ t: 'surrender', x: round3(surrender.x), y: round3(surrender.y) });
    }

    // -----------------------------------------------------------------------
    // Applying a snapshot
    // -----------------------------------------------------------------------

    private apply (snap: Decoded, now: number, events: WorldEvents): void
    {
        const m = snap.message;
        if (snap.you) this.you = snap.you;
        const firstApply = this.firstApply;
        this.firstApply = false;

        // Players: create newcomers, update everyone, drop those who left.
        const present = new Set<string>();
        for (const { info, row } of snap.armies)
        {
            const [, id, name, color, kind, kills, peak] = info;
            const { alive, leadX, leadY, headingX, headingY, rep, size } = row;
            present.add(id);
            let p = this.playersById.get(id);
            if (!p)
            {
                p = id === this.myId ? this.adoptHuman(id) : this.makePlayer(id, name, color, kind === 1 ? 'bot' : 'human', { x: leadX, y: leadY });
                this.playersById.set(id, p);
                this.players.push(p);
            }
            p.name = name;
            p.colorId = color;
            p.respawnAt = alive ? null : Infinity;
            p.kills = kills;
            p.stats.peakArmy = peak;
            p.army.representativeId = rep >= 0 ? rep : null;
            // Only soldiers near our view arrive, so the real size comes separately.
            p.army.reportedSize = alive ? size : 0;
            p.army.lead.heading.x = headingX;
            p.army.lead.heading.y = headingY;
            this.leadFrom.set(id, { x: leadX, y: leadY });
        }
        for (let i = this.players.length - 1; i >= 0; i--)
        {
            const p = this.players[i];
            if (present.has(p.id)) continue;
            this.players.splice(i, 1);
            this.playersById.delete(p.id);
            this.leadFrom.delete(p.id);
        }
        if (this.you)
        {
            const r = this.human.resources;
            r.soulShards = this.you.soulShards;
            r.recruitProgress = this.you.recruitProgress;
            r.archerProgress = this.you.archerProgress;
        }

        // Soldiers: who joined how, who died, who surrendered (and as which neutral).
        const e = m.events;
        const joinedHow = new Map<number, number>();
        for (let i = 0; i < e.joined.length; i += 2) joinedHow.set(e.joined[i], e.joined[i + 1]);
        const died = new Set(e.deaths);
        const surrenderedAs = new Map<number, number>();
        for (let i = 0; i < e.surrendered.length; i += 2) surrenderedAs.set(e.surrendered[i], e.surrendered[i + 1]);

        const seen = new Set<number>();
        for (const { info, row } of snap.armies)
        {
            const owner = this.playersById.get(info[1])!;
            const soldiers: Warrior[] = [];
            const list = row.warriors;
            for (let i = 0; i < list.length; i += 5)
            {
                const id = list[i];
                const flags = list[i + 4];
                seen.add(id);
                let t = this.warriors.get(id);
                if (!t)
                {
                    const role: SoldierRole = flags & WARRIOR_ARCHER ? 'archer' : flags & WARRIOR_GUARDIAN ? 'guardian' : 'warrior';
                    const combat = this.config.combat;
                    const maxHp = role === 'archer' ? combat.archer.maxHp : role === 'guardian' ? combat.guardian.maxHp : combat.maxHp;
                    const warrior = createWarrior(id, { x: list[i + 1], y: list[i + 2] }, maxHp, role);
                    t = { warrior, owner, from: { x: list[i + 1], y: list[i + 2] } };
                    this.warriors.set(id, t);
                    const how = joinedHow.get(id);
                    if (firstApply || how === undefined) (events.appeared ??= []).push({ warrior, owner });
                    else if (how === JOIN_RECRUITED) events.respawned.push({ player: owner, warriors: [warrior] });
                    else events.summoned.push({ warrior, owner });
                }
                const w = t.warrior;
                t.owner = owner;
                t.from = { x: list[i + 1], y: list[i + 2] };
                w.hp = list[i + 3];
                w.facing = flags & WARRIOR_FACING_LEFT ? -1 : 1;
                w.isMoving = (flags & WARRIOR_MOVING) !== 0;
                w.burningUntil = flags & WARRIOR_BURNING ? now + 300 : 0;
                soldiers.push(w);
            }
            owner.army.clusters[0].cluster.warriors = soldiers;
        }

        // Neutrals: positions, comings and goings.
        const neutralSeen = new Set<number>();
        const newNeutrals = new Map<number, NeutralWarrior>();
        for (let i = 0; i < m.neutrals.length; i += 5)
        {
            const siteId = m.neutrals[i];
            const kind = NEUTRAL_KINDS[m.neutrals[i + 1]] ?? 'wanderer';
            const x = m.neutrals[i + 2];
            const y = m.neutrals[i + 3];
            const flags = m.neutrals[i + 4];
            neutralSeen.add(siteId);
            let u = this.neutralsBySite.get(siteId);
            const available = (flags & NEUTRAL_AVAILABLE) !== 0;
            if (!u)
            {
                u = makeNeutral(siteId, kind, x, y);
                this.neutralsBySite.set(siteId, u);
                this.neutrals.units.push(u);
                newNeutrals.set(siteId, u);
            }
            else if (u.available && !available) (events.neutralsGone ??= []).push(u);
            else if (!u.available && available) events.neutralsRespawned.push(u);
            u.available = available;
            u.facing = flags & NEUTRAL_FACING_LEFT ? -1 : 1;
            u.isMoving = (flags & NEUTRAL_MOVING) !== 0;
            if (kind === 'surrendered') u.recruitableAt = flags & NEUTRAL_READY ? 1 : Infinity;
            if (!available || newNeutrals.has(siteId)) u.position = { x, y };
            this.neutralFrom.set(siteId, { x, y });
        }
        for (let i = this.neutrals.units.length - 1; i >= 0; i--)
        {
            const u = this.neutrals.units[i];
            if (neutralSeen.has(u.siteId)) continue;
            // Gone for good (a surrendered soldier someone recruited).
            this.neutrals.units.splice(i, 1);
            this.neutralsBySite.delete(u.siteId);
            this.neutralFrom.delete(u.siteId);
            if (u.available) (events.neutralsGone ??= []).push(u);
        }

        // Soldiers who are no longer in any army.
        for (const [id, t] of this.warriors)
        {
            if (seen.has(id)) continue;
            this.warriors.delete(id);
            const site = surrenderedAs.get(id);
            const neutral = site !== undefined ? newNeutrals.get(site) : undefined;
            if (died.has(id)) events.deaths.push({ warrior: t.warrior, owner: t.owner, killer: null } as Death);
            else if (neutral)
            {
                events.surrendered.push({ warrior: t.warrior, neutral });
                newNeutrals.delete(site!);
            }
            else (events.vanished ??= []).push(t.warrior);
        }
        // Neutrals that appeared without a release we saw (e.g. right after joining).
        for (const u of newNeutrals.values()) (events.neutralsAdded ??= []).push(u);

        // Fights and effects.
        for (let i = 0; i < e.hits.length; i += 3)
        {
            const attacker = this.warriors.get(e.hits[i]);
            const target = this.warriors.get(e.hits[i + 1]);
            if (!attacker || !target) continue;
            events.hits.push({
                attacker: attacker.warrior, target: target.warrior, attackerOwner: attacker.owner, targetOwner: target.owner,
                damage: 0, ranged: e.hits[i + 2] === 1,
            } as Hit);
        }
        for (const id of e.burns)
        {
            const t = this.warriors.get(id);
            if (t) events.lavaBurns.push(t.warrior);
        }
        for (let i = 0; i < e.splits.length; i += 2) events.splits.push({ x: e.splits[i], y: e.splits[i + 1] });
        for (let i = 0; i < e.merges.length; i += 2) events.merges.push({ x: e.merges[i], y: e.merges[i + 1] });

        // Shards.
        for (const id of e.shardsCollected)
        {
            const shard = this.shards.shards[id];
            if (!shard || !shard.active) continue;
            shard.active = false;
            events.shardsCollected.push(shard);
        }
        for (let i = 0; i < e.shardsRespawned.length; i += 3)
        {
            const shard = this.shards.shards[e.shardsRespawned[i]];
            if (!shard) continue;
            shard.x = e.shardsRespawned[i + 1];
            shard.y = e.shardsRespawned[i + 2];
            shard.active = true;
            events.shardsRespawned.push(shard);
        }

        // The arena (decided by the server).
        if (this.arena && m.arena)
        {
            const a = this.arena;
            const r = m.arena;
            const playerOf = (net: number) => {
                const info = net >= 0 ? this.roster.get(net) : undefined;
                return info ? this.playersById.get(info[1]) ?? null : null;
            };
            const before = a.phase;
            a.phase = ARENA_PHASES[r[0]] ?? 'open';
            a.phaseMs = r[1];
            a.matchId = r[2];
            a.winner = playerOf(r[3]);
            a.zones.forEach((z, i) => {
                const o = 4 + i * 4;
                z.holder = playerOf(r[o]);
                z.heldMs = r[o + 1];
                z.qualified = (r[o + 2] & 1) !== 0;
                z.contested = (r[o + 2] & 2) !== 0;
                z.outcome = r[o + 3] < 0 ? null : r[o + 3];
            });
            if (a.phase === 'victory' && before !== 'victory' && !firstApply)
            {
                const loser = a.zones.map((z) => z.holder).find((p) => p !== a.winner) ?? null;
                events.arenaFinished = { winner: a.winner, loser };
            }
        }

        // Castles (decided by the server: the wheel here only animates to its result).
        for (const row of m.castles)
        {
            const c = this.castles[row[0]];
            if (!c) continue;
            const [, state, cooldownMs, spinId, spinnerNet, rewardId, roleIndex, elapsedMs, chargerNet, chargedMs, contested] = row;
            const playerOf = (net: number) => {
                const info = net >= 0 ? this.roster.get(net) : undefined;
                return info ? this.playersById.get(info[1]) ?? null : null;
            };
            c.state = CASTLE_STATES[state] ?? 'ready';
            c.cooldownMs = cooldownMs;
            c.charger = playerOf(chargerNet);
            c.chargedMs = chargedMs;
            c.contested = contested === 1;
            if (spinId < 0) { c.spin = null; continue; }
            if (c.spin?.id === spinId) continue; // the same spin: our own clock keeps it running smoothly
            c.spin = {
                id: spinId, player: playerOf(spinnerNet), rewardId,
                role: CASTLE_ROLES[roleIndex] ?? 'warrior', elapsedMs, landed: elapsedMs >= this.config.castles.spinMs,
            };
            if (!c.spin.landed) (events.castleSpins ??= []).push(c);
        }

        // Fallen bodies.
        for (const row of e.bodiesFallen) events.bodiesFallen.push(this.addBody(row, now));
        for (const id of e.bodiesAwakened)
        {
            const body = this.bodies.get(id);
            if (!body || body.awake) continue;
            body.awake = true;
            events.bodiesAwakened.push(body);
        }
        for (const id of e.bodiesRemoved)
        {
            const body = this.bodies.get(id);
            if (!body) continue;
            this.bodies.delete(id);
            events.bodiesExpired.push(body);
        }

        this.applied = snap;
    }

    /** Glide everything between the last applied snapshot and the next one. */
    private interpolate (renderTime: number): void
    {
        const from = this.applied;
        if (!from) return;
        const to = this.pending[0];
        const span = to ? to.time - from.time : 0;
        const blend = span > 0 ? Math.max(0, Math.min(1, (renderTime - from.time) / span)) : 1;
        const lerp = (a: Vec2, b: { x: number; y: number } | undefined, out: Vec2) => {
            if (!b || !to) { out.x = a.x; out.y = a.y; return; }
            out.x = a.x + (b.x - a.x) * blend;
            out.y = a.y + (b.y - a.y) * blend;
        };

        for (const [id, t] of this.warriors) lerp(t.from, to?.warriors.get(id), t.warrior.position);
        for (const [id, a] of this.leadFrom)
        {
            const p = this.playersById.get(id);
            // Our own steering point is predicted (see predictOwnArmy); keep the server's here.
            if (p) lerp(a, to?.leads.get(id), p === this.human ? this.ownServerLead : p.army.lead.center.position);
        }
        for (const [site, a] of this.neutralFrom)
        {
            const u = this.neutralsBySite.get(site);
            if (u?.available) lerp(a, to?.neutrals.get(site), u.position);
        }
    }

    // -----------------------------------------------------------------------

    private addBody (row: BodyRow, now: number): FallenBody
    {
        const [id, x, y, colorId, facing, role, readyIn, expiresIn, awake] = row;
        const body: FallenBody = {
            id, position: { x, y }, colorId, facing: facing < 0 ? -1 : 1,
            fallenAt: now, readyAt: now + readyIn, expiresAt: now + expiresIn, awake: awake === 1, role: roleFromCode(role),
        };
        this.bodies.set(id, body);
        return body;
    }

    private takeQueued (): WorldEvents
    {
        const q = this.queued;
        this.queued = emptyWorldEvents();
        return q;
    }

    /** Our own army appeared in a snapshot: from now on `human` is that player. */
    private adoptHuman (id: string): Player
    {
        this.human.id = id;
        return this.human;
    }

    private makePlayer (id: string, name: string, colorId: string, kind: 'human' | 'bot', at: Vec2): Player
    {
        return {
            id, name, kind, colorId,
            resources: createPlayerResources(),
            army: createPlayerArmy(at),
            lastCombatAt: -Infinity,
            respawnAt: null,
            kills: 0,
            stats: { peakArmy: 1, startedAt: 0, defeatedAt: null },
        };
    }
}

function makeNeutral (siteId: number, kind: NeutralWarrior['kind'], x: number, y: number): NeutralWarrior
{
    return {
        id: -siteId - 1, siteId, kind,
        home: { x, y }, position: { x, y }, velocity: { x: 0, y: 0 },
        facing: 1, isMoving: false, available: true, respawnAt: 0,
        wanderTarget: null, nextWanderAt: 0, roam: 0,
        recruitableAt: kind === 'surrendered' ? Infinity : 0, role: 'warrior',
    };
}

function emptyWorldEvents (): WorldEvents
{
    return {
        shardsCollected: [], shardsRespawned: [], neutralsRecruited: [], neutralsRespawned: [], summoned: [],
        splits: [], merges: [], surrendered: [], hits: [], deaths: [], eliminated: [], respawned: [],
        bodiesFallen: [], bodiesAwakened: [], bodiesRevived: [], bodiesExpired: [], lavaBurns: [],
    };
}

/** Where this browser keeps the token that takes back its army after a dropped connection. */
const REJOIN_KEY = 'raidkin.rejoin';

function loadRejoinToken (): string | null
{
    try { return localStorage.getItem(REJOIN_KEY); }
    catch { return null; }
}

function saveRejoinToken (token: string | null): void
{
    try
    {
        if (token) localStorage.setItem(REJOIN_KEY, token);
        else localStorage.removeItem(REJOIN_KEY);
    }
    catch { /* storage blocked: rejoining only works without a page reload */ }
}

function round3 (n: number): number
{
    return Math.round(n * 1000) / 1000;
}
