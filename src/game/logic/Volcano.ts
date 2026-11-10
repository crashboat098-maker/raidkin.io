import { randRange, type Rng } from './Random';
import type { Structure } from './Structures';
import type { Rect, Vec2 } from './Types';

/**
 * The volcano biome: one corner of the map with a smoking volcano, ash
 * ground, scorched earth, glowing fissures and small lava pools.
 * Pure data; drawn by the render layer.
 *
 * Gameplay: the volcano cone and lava pools are solid (nobody walks into
 * lava); the ash and fissures are ordinary walkable ground. No damage.
 */

export interface LavaPool {
    x: number;
    y: number;
    /** Radii of the pool's ellipse (world px). */
    rx: number;
    ry: number;
}

export interface VolcanoLayout {
    /** The cone itself (also listed in the map's structures, for collision and drawing). */
    cone: Structure;
    /** Centre of the biome (roughly the middle of the cone). */
    center: Vec2;
    /** Biome radius: ash inside, scorched ground in a band just outside. */
    radius: number;
    pools: LavaPool[];
    /** Glowing cracks in the ground (polylines). */
    fissures: Vec2[][];
}

/** How far the scorched band reaches beyond the ash (world px). */
export const SCORCH_BAND = 70;
const BIOME_RADIUS = 300;

/**
 * Pick a corner and lay out the volcano. `nextId` is the cone's structure id.
 */
export function planVolcano (rng: Rng, playArea: Rect, nextId: number): VolcanoLayout
{
    const corner = Math.floor(rng() * 4);
    const left = corner % 2 === 0;
    const top = corner < 2;
    // The cone stands a little in from the corner, so there's room to walk around it.
    const cx = left ? playArea.x + 230 : playArea.x + playArea.width - 230;
    const cy = top ? playArea.y + 250 : playArea.y + playArea.height - 200;
    const cone: Structure = { id: nextId, type: 'volcano', x: Math.round(cx), y: Math.round(cy) };
    const center = { x: cx, y: cy - 40 };

    // Lava pools around the foot of the volcano (kept off the cone itself).
    const pools: LavaPool[] = [];
    for (let attempt = 0; attempt < 80 && pools.length < 4; attempt++)
    {
        const angle = rng() * Math.PI * 2;
        const distance = randRange(rng, 125, 230);
        const pool = {
            x: Math.round(center.x + Math.cos(angle) * distance),
            y: Math.round(center.y + Math.sin(angle) * distance * 0.8 + 40),
            rx: Math.round(randRange(rng, 12, 22)),
            ry: Math.round(randRange(rng, 7, 11)),
        };
        if (!insideArea(playArea, pool, 30)) continue;
        if (Math.abs(pool.x - cone.x) < 100 && pool.y > cone.y - 70 && pool.y < cone.y + 30) continue;
        if (pools.some((o) => Math.hypot(o.x - pool.x, o.y - pool.y) < 90)) continue;
        pools.push(pool);
    }

    // Fissures: jagged cracks radiating out from the volcano's base.
    const fissures: Vec2[][] = [];
    for (let i = 0; i < 9; i++)
    {
        const angle = (i / 9) * Math.PI * 2 + randRange(rng, -0.25, 0.25);
        let p = { x: center.x + Math.cos(angle) * 95, y: center.y + Math.sin(angle) * 75 + 40 };
        const crack: Vec2[] = [p];
        const length = randRange(rng, 60, 150);
        let heading = angle;
        for (let travelled = 0; travelled < length; travelled += 9)
        {
            heading += randRange(rng, -0.5, 0.5);
            p = { x: p.x + Math.cos(heading) * 9, y: p.y + Math.sin(heading) * 9 };
            if (!insideArea(playArea, p, 10)) break;
            crack.push(p);
        }
        if (crack.length > 3) fissures.push(crack);
    }

    return { cone, center, radius: BIOME_RADIUS, pools, fissures };
}

/**
 * How "volcanic" a spot is: 1 deep in the ash, 0 out in the green, a smooth
 * slope across the scorched band. The edge wobbles so it doesn't look round.
 */
export function volcanoInfluence (v: VolcanoLayout | null | undefined, x: number, y: number): number
{
    if (!v) return 0;
    const dx = x - v.center.x;
    const dy = (y - v.center.y) * 1.1;
    const d = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const edge = v.radius * (1 + 0.1 * Math.sin(3 * angle + 1.3) + 0.06 * Math.sin(7 * angle + 0.4));
    if (d <= edge) return 1;
    if (d >= edge + SCORCH_BAND) return 0;
    return 1 - (d - edge) / SCORCH_BAND;
}

/** The area the volcano biome covers (for keeping rivers and villages out). */
export function volcanoZone (v: VolcanoLayout): Rect
{
    const r = v.radius + SCORCH_BAND * 0.5;
    return { x: v.center.x - r, y: v.center.y - r, width: r * 2, height: r * 2 };
}

/** A lava pool's solid core (a rectangle inside the ellipse). */
export function lavaPoolCollider (pool: LavaPool): Rect
{
    return { x: pool.x - pool.rx * 0.8, y: pool.y - pool.ry * 0.75, width: pool.rx * 1.6, height: pool.ry * 1.5 };
}

function insideArea (area: Rect, p: Vec2, margin: number): boolean
{
    return p.x > area.x + margin && p.x < area.x + area.width - margin && p.y > area.y + margin && p.y < area.y + area.height - margin;
}
