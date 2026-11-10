import type { ClientMessage, LobbyMessage, ServerMessage } from './Protocol';

/**
 * The connection to the game server, opened as soon as the page loads and
 * reopened every few seconds if it drops. Without a server (or while it's
 * unreachable) the game simply offers practice mode against bots.
 *
 * Which server: `?server=wss://...` in the page address wins (for testing);
 * otherwise an "online" build connects back to the address that served the
 * page (the game server hosts the page itself); other builds stay offline.
 */

const RECONNECT_MS = 3000;

export type NetStatus = 'off' | 'connecting' | 'online';

function serverUrl (): string | null
{
    const fromQuery = new URLSearchParams(location.search).get('server');
    if (fromQuery) return fromQuery;
    if (import.meta.env.MODE === 'online') return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    return null;
}

export class NetClient
{
    status: NetStatus = 'off';
    lobby: LobbyMessage | null = null;
    private socket: WebSocket | null = null;
    private listener: ((message: ServerMessage) => void) | null = null;
    private closeListener: (() => void) | null = null;
    private readonly url = serverUrl();

    start (): void
    {
        if (!this.url || this.socket) return;
        this.status = 'connecting';
        let socket: WebSocket;
        try { socket = new WebSocket(this.url); }
        catch { this.retry(); return; }
        this.socket = socket;
        socket.onopen = () => { this.status = 'online'; };
        socket.onmessage = (e) => {
            if (typeof e.data !== 'string') return;
            let message: ServerMessage;
            try { message = JSON.parse(e.data) as ServerMessage; }
            catch { return; }
            if (message.t === 'lobby') this.lobby = message;
            this.listener?.(message);
        };
        socket.onclose = () => {
            this.socket = null;
            this.status = 'connecting';
            this.lobby = null;
            this.closeListener?.();
            this.retry();
        };
        socket.onerror = () => { /* onclose follows */ };
    }

    get online (): boolean
    {
        return this.status === 'online';
    }

    /** A server is configured for this page (whether or not it's reachable right now). */
    get configured (): boolean
    {
        return this.url !== null;
    }

    send (message: ClientMessage): void
    {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    }

    /** Who receives server messages and hears about a lost connection (one match at a time). */
    listen (onMessage: ((message: ServerMessage) => void) | null, onClose: (() => void) | null = null): void
    {
        this.listener = onMessage;
        this.closeListener = onClose;
    }

    private retry (): void
    {
        setTimeout(() => this.start(), RECONNECT_MS);
    }
}

export const netClient = new NetClient();
