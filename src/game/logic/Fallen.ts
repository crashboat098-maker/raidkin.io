import type { SoldierRole } from './Army';
import type { Vec2 } from './Types';

/**
 * Fallen soldiers. When a Warrior dies it leaves a body behind:
 *  - for the first few seconds it is dormant (nobody can take it),
 *  - after that any army can revive it by walking a soldier up to it; it
 *    joins that army at full health, in that army's colour,
 *  - a body is claimed at most once, and unclaimed bodies fade away after a while.
 * Bodies never block movement or combat. Pure logic, no Phaser.
 *
 * Built for big battles: bodies live in a coarse grid, so "is there a body
 * near this soldier?" only looks at a few nearby cells, and nothing at all
 * is checked while no body is recruitable.
 */

export interface FallenBody {
    id: number;
    position: Vec2;
    /** Army colour the soldier died in (for the body's look). */
    colorId: string;
    facing: 1 | -1;
    fallenAt: number;
    /** Recruitable from this time... */
    readyAt: number;
    /** ...until this time, when it fades away. */
    expiresAt: number;
    /** True once the dormant time is over (set by `update`). */
    awake: boolean;
    /** What the soldier was: revived bodies rise as the same kind. */
    role: SoldierRole;
}

export interface FallenSettings {
    dormantMs: number;
    lifetimeMs: number;
    reviveRange: number;
}

const CELL = 64;

export class FallenField
{
    private readonly bodies = new Map<number, FallenBody>();
    private readonly cells = new Map<number, FallenBody[]>();
    private nextId = 1;
    /** Bodies not yet recruitable, in the order they fell (= the order they become ready). */
    private dormant: FallenBody[] = [];
    private readyCount = 0;

    constructor (private readonly settings: FallenSettings) {}

    /** Every body on the battlefield (dormant or recruitable). */
    get all (): IterableIterator<FallenBody>
    {
        return this.bodies.values();
    }

    get count (): number
    {
        return this.bodies.size;
    }

    /** How many bodies can be revived right now. */
    get recruitableCount (): number
    {
        return this.readyCount;
    }

    isRecruitable (body: FallenBody): boolean
    {
        return body.awake && this.bodies.has(body.id);
    }

    /** A soldier fell here. */
    add (position: Vec2, colorId: string, facing: 1 | -1, now: number, role: SoldierRole = 'warrior'): FallenBody
    {
        const body: FallenBody = {
            id: this.nextId++,
            position: { x: position.x, y: position.y },
            colorId, facing,
            fallenAt: now,
            readyAt: now + this.settings.dormantMs,
            expiresAt: now + this.settings.lifetimeMs,
            awake: false,
            role,
        };
        this.bodies.set(body.id, body);
        const key = cellKey(body.position.x, body.position.y);
        const cell = this.cells.get(key);
        if (cell) cell.push(body);
        else this.cells.set(key, [body]);
        this.dormant.push(body);
        return body;
    }

    /**
     * Claim every recruitable body within reach of `position` (closest first).
     * Claimed bodies are removed at once, so each can only ever be taken once.
     */
    reviveNear (position: Vec2, now: number, maxCount = Infinity): FallenBody[]
    {
        if (maxCount <= 0) return [];
        if (this.readyCount === 0) return [];
        const range = this.settings.reviveRange;
        const found: FallenBody[] = [];
        const c0 = Math.floor((position.x - range) / CELL);
        const c1 = Math.floor((position.x + range) / CELL);
        const r0 = Math.floor((position.y - range) / CELL);
        const r1 = Math.floor((position.y + range) / CELL);
        for (let r = r0; r <= r1; r++)
        {
            for (let c = c0; c <= c1; c++)
            {
                const cell = this.cells.get(r * 100_000 + c);
                if (!cell) continue;
                for (const body of cell)
                {
                    if (!body.awake || now >= body.expiresAt) continue;
                    const dx = body.position.x - position.x;
                    const dy = body.position.y - position.y;
                    if (dx * dx + dy * dy <= range * range) found.push(body);
                }
            }
        }
        if (found.length > 1) found.sort((a, b) => dist2(a.position, position) - dist2(b.position, position));
        // Closest first, and no more than the army has room for (the rest stay for others).
        if (found.length > maxCount) found.length = maxCount;
        for (const body of found) this.remove(body);
        return found;
    }

    /** Recruitable bodies (for the bots to look for). */
    recruitable (): FallenBody[]
    {
        if (this.readyCount === 0) return [];
        const out: FallenBody[] = [];
        for (const body of this.bodies.values()) if (body.awake) out.push(body);
        return out;
    }

    /**
     * Wake bodies whose dormant time is over and remove those that have lain
     * unclaimed too long. Returns the bodies that faded away.
     */
    update (now: number): { awakened: FallenBody[]; expired: FallenBody[] }
    {
        const awakened: FallenBody[] = [];
        let i = 0;
        while (i < this.dormant.length && this.dormant[i].readyAt <= now)
        {
            const body = this.dormant[i++];
            if (!this.bodies.has(body.id)) continue; // already gone
            body.awake = true;
            this.readyCount++;
            awakened.push(body);
        }
        if (i > 0) this.dormant = this.dormant.slice(i);

        // Bodies expire in the order they fell, so only the oldest few need checking...
        // but claimed bodies leave gaps, so a full pass is simplest; it only runs once a second.
        const expired: FallenBody[] = [];
        if (this.bodies.size > 0 && now >= this.nextExpiryCheck)
        {
            this.nextExpiryCheck = now + 1000;
            for (const body of this.bodies.values())
            {
                if (now >= body.expiresAt) expired.push(body);
            }
            for (const body of expired) this.remove(body);
        }
        return { awakened, expired };
    }

    private nextExpiryCheck = 0;

    private remove (body: FallenBody): void
    {
        if (!this.bodies.delete(body.id)) return;
        if (body.awake) this.readyCount--;
        const key = cellKey(body.position.x, body.position.y);
        const cell = this.cells.get(key);
        if (!cell) return;
        const index = cell.indexOf(body);
        if (index >= 0)
        {
            cell[index] = cell[cell.length - 1];
            cell.pop();
        }
        if (cell.length === 0) this.cells.delete(key);
    }
}

function cellKey (x: number, y: number): number
{
    return Math.floor(y / CELL) * 100_000 + Math.floor(x / CELL);
}

function dist2 (a: Vec2, b: Vec2): number
{
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
