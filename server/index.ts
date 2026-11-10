/**
 * RAIDKIN.IO game server.
 *
 * One shared battlefield (the same World the browser runs in practice
 * mode), with bots, that any number of people can join. It also serves the
 * built game page (dist/), so a single web service hosts both the page and
 * the multiplayer connection.
 *
 *   npm run build            build the game page into dist/
 *   npm run build:server     bundle this file into server/dist/server.mjs
 *   npm start                run it (PORT, default 8787)
 *
 * Optional environment variables:
 *   PORT             port to listen on (Render sets this)
 *   ALLOWED_ORIGINS  comma-separated page origins allowed to connect
 *                    (empty = any page may connect)
 *   MAX_PLAYERS      most people playing at once (default 40)
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameConfig } from '../src/game/config/GameConfig';
import type { Warrior } from '../src/game/logic/Army';
import { finalRank } from '../src/game/logic/Leaderboard';
import type { Player } from '../src/game/logic/Player';
import { allWarriors, armySpeedMultiplier, secondsUntilRegroup } from '../src/game/logic/PlayerArmy';
import type { Vec2 } from '../src/game/logic/Types';
import { World, type PlayerCommand, type WorldEvents } from '../src/game/logic/World';
import {
    cleanDirection, emptyEvents, encodeBody, encodeNeutral, encodePlayer, JOIN_RECRUITED, JOIN_SUMMONED, PROTOCOL_VERSION, round1,
    type ClientMessage, type EventRows, type ServerMessage, type SnapshotMessage,
} from '../src/game/net/Protocol';
import { ARMY_COLORS, type ArmyColor } from '../src/game/render/Palette';
import { sanitizeName } from '../src/game/scenes/PlayerSettings';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS ?? 40);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const TICK_MS = 1000 / 30;
/** Send a snapshot every this many ticks (2 -> 15 a second). */
const SNAPSHOT_EVERY = 2;
/** Messages a connection may send per second before it's dropped. */
const MAX_MESSAGES_PER_SECOND = 120;
const BOT_COLORS: ArmyColor[] = ['azure', 'gold', 'violet', 'ember'];

const here = fileURLToPath(new URL('.', import.meta.url));
const STATIC_DIR = resolve(here, '..', '..', 'dist');

// ---------------------------------------------------------------------------
// The shared battlefield
// ---------------------------------------------------------------------------

const world = new World(GameConfig, { localHuman: false }, BOT_COLORS);
const started = performance.now();
const clock = () => performance.now() - started;

interface Client {
    socket: WebSocket;
    player: Player | null;
    command: PlayerCommand;
    messagesThisSecond: number;
}
const clients = new Set<Client>();
let pending: EventRows = emptyEvents();
let tick = 0;
let lastTickAt = clock();

function send (client: Client, message: ServerMessage): void
{
    if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(message));
}

function playingCount (): number
{
    let n = 0;
    for (const c of clients) if (c.player) n++;
    return n;
}

function broadcastLobby (): void
{
    const playing = playingCount();
    for (const c of clients) send(c, { t: 'lobby', online: clients.size, playing, full: playing >= MAX_PLAYERS });
}

/** Turn a frame's events into the compact rows sent with the next snapshot. */
function collectEvents (events: WorldEvents, now: number): void
{
    const e = pending;
    for (const h of events.hits) e.hits.push(h.attacker.id, h.target.id, h.ranged ? 1 : 0);
    for (const d of events.deaths) e.deaths.push(d.warrior.id);
    for (const w of events.lavaBurns) e.burns.push(w.id);
    for (const p of events.splits) e.splits.push(round1(p.x), round1(p.y));
    for (const p of events.merges) e.merges.push(round1(p.x), round1(p.y));
    for (const s of events.surrendered) e.surrendered.push(s.warrior.id, s.neutral.siteId);
    for (const s of events.summoned) e.joined.push(s.warrior.id, JOIN_SUMMONED);
    for (const r of events.neutralsRecruited) e.joined.push(r.warrior.id, JOIN_RECRUITED);
    for (const r of events.bodiesRevived) e.joined.push(r.warrior.id, JOIN_SUMMONED);
    for (const r of events.respawned) for (const w of r.warriors) e.joined.push(w.id, JOIN_RECRUITED);
    for (const s of events.shardsCollected) e.shardsCollected.push(s.id);
    for (const s of events.shardsRespawned) e.shardsRespawned.push(s.id, s.x, s.y);
    for (const b of events.bodiesFallen) e.bodiesFallen.push(encodeBody(b, now));
    for (const b of events.bodiesAwakened) e.bodiesAwakened.push(b.id);
    for (const b of events.bodiesExpired) e.bodiesRemoved.push(b.id);
    for (const r of events.bodiesRevived) e.bodiesRemoved.push(r.body.id);
}

function step (): void
{
    const now = clock();
    const dt = Math.min(0.05, (now - lastTickAt) / 1000);
    lastTickAt = now;

    const commands = new Map<Player, PlayerCommand>();
    for (const c of clients) if (c.player) commands.set(c.player, c.command);
    const events = world.update(now, dt, { x: 0, y: 0 }, null, null, commands);
    // Split and surrender are one-shot: used this frame, then cleared. Steering persists.
    for (const c of clients) c.command = { move: c.command.move, split: null, surrender: null };
    collectEvents(events, now);

    for (const p of events.eliminated)
    {
        const client = [...clients].find((c) => c.player === p);
        if (!client) continue;
        send(client, {
            t: 'defeat',
            kills: p.kills,
            largestArmy: p.stats.peakArmy,
            shards: p.resources.soulShards,
            survivalMs: (p.stats.defeatedAt ?? now) - p.stats.startedAt,
            rank: finalRank(p, world.players),
            competitors: world.players.length,
        });
    }

    if (++tick % SNAPSHOT_EVERY === 0) broadcastSnapshot(now);
}

function broadcastSnapshot (now: number): void
{
    const players = world.players.map((p) => encodePlayer(p, p.respawnAt === null ? allWarriors(p.army) : ([] as Warrior[]), now));
    const neutrals: number[] = [];
    for (const u of world.neutrals.units) encodeNeutral(u, now, neutrals);
    const events = pending;
    pending = emptyEvents();

    // Everything but the HUD numbers is the same for everyone, so encode it once.
    const shared = JSON.stringify({ players, neutrals, events }).slice(1, -1);
    for (const c of clients)
    {
        if (!c.player || c.socket.readyState !== c.socket.OPEN) continue;
        const p = c.player;
        const you: SnapshotMessage['you'] = {
            soulShards: p.resources.soulShards,
            recruitProgress: p.resources.recruitProgress,
            archerProgress: p.resources.archerProgress,
            clusters: p.army.clusters.length,
            regroup: secondsUntilRegroup(p.army, now, GameConfig.army),
            speed: round1(GameConfig.movement.maxSpeed * armySpeedMultiplier(p.army, GameConfig.army)),
        };
        c.socket.send(`{"t":"snap","time":${Math.round(now)},"you":${JSON.stringify(you)},${shared}}`);
    }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function joinGame (client: Client, name: unknown, color: unknown): void
{
    leave(client);
    if (playingCount() >= MAX_PLAYERS) { send(client, { t: 'error', reason: 'full' }); return; }
    const cleanName = sanitizeName(typeof name === 'string' ? name.toUpperCase() : '') || 'RAIDER';
    const cleanColor = ARMY_COLORS.includes(color as ArmyColor) ? (color as ArmyColor) : 'crimson';
    const now = clock();
    client.player = world.addHuman(cleanName, cleanColor, now);
    client.command = { move: { x: 0, y: 0 }, split: null, surrender: null };

    send(client, { t: 'joined', id: client.player.id });
    const shards: number[] = [];
    for (const s of world.shards.shards) shards.push(s.id, s.x, s.y, s.active ? 1 : 0);
    send(client, { t: 'state', time: Math.round(now), shards, bodies: [...world.fallen.all].map((b) => encodeBody(b, now)) });
    broadcastLobby();
}

function leave (client: Client): void
{
    if (!client.player) return;
    world.removePlayer(client.player);
    client.player = null;
    broadcastLobby();
}

function aim (message: { x: unknown; y: unknown }): Vec2 | null
{
    return cleanDirection(message.x, message.y, false);
}

function handle (client: Client, raw: string): void
{
    let message: ClientMessage;
    try { message = JSON.parse(raw) as ClientMessage; }
    catch { return; }
    if (!message || typeof message !== 'object') return;

    switch (message.t)
    {
        case 'join':
            if (message.v !== PROTOCOL_VERSION) { send(client, { t: 'error', reason: 'version' }); return; }
            joinGame(client, message.name, message.color);
            return;
        case 'leave':
            leave(client);
            return;
        case 'in': {
            const move = cleanDirection(message.x, message.y, true);
            if (move) client.command = { ...client.command, move };
            return;
        }
        case 'split': {
            const direction = aim(message);
            if (direction) client.command = { ...client.command, split: direction };
            return;
        }
        case 'surrender': {
            const direction = aim(message);
            if (direction) client.command = { ...client.command, surrender: direction };
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// HTTP: the game page (dist/) and a health check
// ---------------------------------------------------------------------------

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

function serveStatic (req: IncomingMessage, res: ServerResponse): void
{
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/healthz')
    {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
        return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }

    // Resolve inside dist/ only (no ../ escapes).
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = join(STATIC_DIR, relative || 'index.html');
    if (!file.startsWith(STATIC_DIR)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file))
    {
        res.writeHead(404, { 'content-type': 'text/plain' }).end(existsSync(STATIC_DIR) ? 'Not found' : 'Game page not built: run npm run build');
        return;
    }
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    // Built assets have content hashes in their names, so they can be cached for long.
    const cache = file.includes(`${join('dist', 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
}

const http = createServer(serveStatic);
const wss = new WebSocketServer({
    server: http,
    maxPayload: 4 * 1024,
    verifyClient: ({ origin }: { origin?: string }) => ALLOWED_ORIGINS.length === 0 || (origin !== undefined && ALLOWED_ORIGINS.includes(origin)),
});

wss.on('connection', (socket) => {
    const client: Client = { socket, player: null, command: { move: { x: 0, y: 0 }, split: null, surrender: null }, messagesThisSecond: 0 };
    clients.add(client);
    broadcastLobby();

    socket.on('message', (data, isBinary) => {
        if (isBinary) return;
        if (++client.messagesThisSecond > MAX_MESSAGES_PER_SECOND) { socket.close(1008, 'too many messages'); return; }
        handle(client, data.toString());
    });
    socket.on('close', () => {
        leave(client);
        clients.delete(client);
        broadcastLobby();
    });
    socket.on('error', () => socket.close());
});

setInterval(() => { for (const c of clients) c.messagesThisSecond = 0; }, 1000);
setInterval(step, TICK_MS);

http.listen(PORT, () => {
    console.log(`RAIDKIN.IO server on port ${PORT}${existsSync(STATIC_DIR) ? ' (serving dist/)' : ' (no dist/ yet: run npm run build)'}`);
});
