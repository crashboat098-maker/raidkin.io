import { Scene } from 'phaser';
import type { BattlefieldLayout } from '../logic/BattlefieldLayout';
import type { Bridge } from '../logic/Bridges';
import { isLavaSurface, type LavaLayout } from '../logic/LavaRivers';
import { addGlow } from './Glow';
import { hash2 } from './PixelPainter';

/**
 * Gothic stone bridges over the lava rivers, each painted once as its own
 * structure (a texture just big enough for it), not a pattern laid on the ground.
 *
 * Along its span a bridge has:
 *  - low stepped ramps at both ends, darker and tapering, dusted with ash,
 *    fading into the bank with no hard edge;
 *  - the raised span over the lava: dressed stone lanes running along the
 *    deck, tall parapets with posts, heavy corner pillars (braziers, finials,
 *    horns or rune cubes, by bridge), a visible side face and a shadow cast
 *    on the lava beside it;
 *  - underneath: pointed arches glowing from the lava (east-west spans, seen
 *    from the south) or cutwater piers splitting the flow (north-south spans).
 * Stone colour, post rhythm and pillar tops vary by bridge. The deck drawn is
 * exactly the safe ground (the shadow falls outside it, on lava that still burns).
 */

const STONES = [
    ['#8a8290', '#6d6575', '#5a5362', '#48424f', '#35303c', '#211d26'],   // cool grey-violet
    ['#8c8079', '#73685f', '#5d534c', '#4a413b', '#362f2b', '#221d1a'],   // warm soot-brown
];
const OUTLINE = '#0c0a0e';
const ASH = ['#a39d97', '#8a847f'];
const LAVA = { white: '#ffe08a', bright: '#ffa63d', hot: '#ef6a1d', deep: '#a8380f', crust: '#4a1a0c', shade: '#6e240c' };
/** Margins around the deck: pillars rise above it, shadows and piers spill beside it. */
const M = 8;
/** An east-west bridge's south face height (inside the deck). */
const FACE = 9;
/** How far the raised span reaches past the lava onto each bank. */
const OVERHANG = 8;
const DEPTH = -999_997.5;

type Pixels = (string | null)[];

export function addLavaBridges (scene: Scene, layout: BattlefieldLayout): void
{
    layout.lavaBridges.forEach((bridge, i) => {
        if (!bridge.rect || !bridge.axis) return;
        const key = `lava-bridge-${i}`;
        const plan = spanOf(bridge, layout.lava!);
        const r = bridge.rect;
        if (!scene.textures.exists(key))
        {
            const canvas = new BridgeCanvas(r.width + M * 2, r.height + M * 2);
            const lavaAt = (cx: number, cy: number) => isLavaSurface(layout.lava, r.x + cx - M, r.y + cy - M);
            if (bridge.axis === 'ew') paintEastWest(canvas, plan, bridge.variant ?? i, lavaAt);
            else paintNorthSouth(canvas, plan, bridge.variant ?? i, lavaAt);
            canvas.toTexture(scene, key);
        }
        scene.add.image(r.x - M, r.y - M, key).setOrigin(0, 0).setDepth(DEPTH);
        addLights(scene, bridge, plan);
    });
}

/** Where along the span the lava runs (in deck coordinates), so the raised span sits over it. */
interface SpanPlan { lavaStart: number; lavaEnd: number; length: number; across: number; p0: number; p1: number }

function spanOf (bridge: Bridge, lava: LavaLayout): SpanPlan
{
    const r = bridge.rect!;
    const ew = bridge.axis === 'ew';
    const length = ew ? r.width : r.height;
    const across = ew ? r.height : r.width;
    let lavaStart = -1;
    let lavaEnd = -1;
    for (let s = 0; s < length; s++)
    {
        let molten = false;
        for (let a = 2; a < across - 1 && !molten; a += 3) molten = ew ? isLavaSurface(lava, r.x + s, r.y + a) : isLavaSurface(lava, r.x + a, r.y + s);
        if (molten) { if (lavaStart < 0) lavaStart = s; lavaEnd = s; }
    }
    if (lavaStart < 0) { lavaStart = Math.round(length * 0.4); lavaEnd = Math.round(length * 0.6); }
    const p0 = Math.max(6, lavaStart - OVERHANG);
    const p1 = Math.min(length - 7, lavaEnd + OVERHANG);
    return { lavaStart, lavaEnd, length, across, p0, p1 };
}

/** A tiny pixel canvas (transparent by default) that becomes a texture. */
class BridgeCanvas
{
    readonly px: Pixels;
    constructor (readonly width: number, readonly height: number) { this.px = new Array(width * height).fill(null); }
    set (x: number, y: number, c: string): void
    {
        x = Math.round(x); y = Math.round(y);
        if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.px[y * this.width + x] = c;
    }
    get (x: number, y: number): string | null
    {
        return x >= 0 && y >= 0 && x < this.width && y < this.height ? this.px[y * this.width + x] : null;
    }
    rect (x: number, y: number, w: number, h: number, c: string): void { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
    /** Outline only around the pixels `isRaised` marks (the raised structure, not the ramps). */
    outlineRaised (isRaised: (x: number, y: number) => boolean): void
    {
        const src = this.px.slice();
        for (let y = 0; y < this.height; y++)
        {
            for (let x = 0; x < this.width; x++)
            {
                if (src[y * this.width + x] !== null) continue;
                const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < this.width && Y < this.height && src[Y * this.width + X] !== null && isRaised(X, Y); });
                if (n) this.px[y * this.width + x] = OUTLINE;
            }
        }
    }
    toTexture (scene: Scene, key: string): void
    {
        const texture = scene.textures.createCanvas(key, this.width, this.height);
        if (!texture) return;
        const ctx = texture.getContext();
        for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) { const c = this.px[y * this.width + x]; if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); } }
        texture.refresh();
    }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * Dressed stone lanes running along the span (`s` along, `a` across): long
 * blocks of uneven length in lanes ~8 px wide, staggered joints, a lit
 * leading edge, the odd cracked or darker block. Ramp blocks are dustier.
 */
function deckStone (s: number, a: number, wx: number, wy: number, S: readonly string[], variant: number, ramp: boolean): string
{
    // Paving, not masonry: broad slabs in lanes along the span, soft joints, light tones.
    const laneW = 10 + (variant % 2);
    const lane = Math.floor(a / laneW);
    const inLane = a - lane * laneW;
    const offset = hash2(lane, 17 + variant) % 17;
    let start = -offset;
    let block = 0;
    let len = 14 + (hash2(lane * 31, 7) % 9);
    while (s >= start + len) { start += len; block++; len = 14 + (hash2(lane * 31 + block, 7) % 9); }
    const id = hash2(lane * 101 + block, variant + 9);
    if (inLane === 0 || s === start) return (hash2(wx, wy) % 3 === 0) ? S[2] : S[3];   // soft, broken joints
    let tone = 1 + (id % 2);
    if (id % 9 === 0) tone = 2;
    if (inLane === 1 || s === start + 1) tone = Math.max(0, tone - 1);         // lit leading edge
    let c = S[tone];
    if (id % 11 === 0 && (s - start) === inLane + 3) c = variant === 2 ? LAVA.deep : S[3]; // a fine crack
    const speck = hash2(wx * 3 + 1, wy * 5 + 2) % 100;
    if (speck < (ramp ? 6 : 2)) c = ASH[speck % 2];
    else if (speck < (ramp ? 9 : 4)) c = S[3];
    return c;
}

/** A heavy pillar seen from the front, rising `height` px above `baseY`, with a variant top. */
function pillar (c: BridgeCanvas, cx: number, baseY: number, height: number, S: readonly string[], variant: number): void
{
    const top = baseY - height;
    for (let y = top; y < baseY; y++)
    {
        for (let x = cx - 2; x <= cx + 2; x++) c.set(x, y, (y - top) % 4 === 3 ? S[4] : x === cx - 2 ? S[1] : x === cx + 2 ? S[4] : x > cx ? S[3] : S[2]);
    }
    c.rect(cx - 3, top, 7, 1, S[0]);
    c.rect(cx - 3, top + 1, 7, 1, S[3]);
    switch (variant % 4)
    {
        case 0: // a fire brazier
            c.rect(cx - 2, top - 2, 5, 2, S[4]);
            c.set(cx - 1, top - 3, LAVA.hot); c.set(cx, top - 3, LAVA.bright); c.set(cx + 1, top - 3, LAVA.hot);
            c.set(cx, top - 4, LAVA.white);
            break;
        case 1: // a pointed finial
            c.rect(cx - 1, top - 2, 3, 2, S[2]); c.set(cx, top - 3, S[1]); c.set(cx, top - 4, S[0]);
            break;
        case 2: // horns
            c.rect(cx - 2, top - 1, 5, 1, S[2]);
            c.set(cx - 3, top - 2, S[1]); c.set(cx - 3, top - 3, S[0]);
            c.set(cx + 3, top - 2, S[3]); c.set(cx + 3, top - 3, S[2]);
            break;
        default: // a squat cube with a glowing rune
            c.rect(cx - 2, top - 3, 5, 3, S[2]); c.rect(cx - 2, top - 3, 5, 1, S[1]); c.set(cx, top - 2, LAVA.hot);
    }
}

/** Darken a pixel that will be drawn over lava (a shadow on molten lava stays visibly molten). */
const LAVA_SHADOW = LAVA.shade;

// ---------------------------------------------------------------------------
// East-west spans: seen from the south, arches over the lava.
// ---------------------------------------------------------------------------

function paintEastWest (c: BridgeCanvas, plan: SpanPlan, variant: number, lavaAt: (x: number, y: number) => boolean): void
{
    const S = STONES[variant % 2];
    const { length: L, across: D, p0, p1 } = plan;
    const o = M;                                   // deck origin in the canvas
    const top = o;                                 // north edge of the deck
    const faceTop = o + D - FACE;                  // the south face starts here
    const bottom = o + D;                          // south edge of the deck footprint
    const post = variant % 2 === 0 ? 18 : 22;      // sparse posts: a parapet, not battlements
    const raised = new Set<number>();
    const mark = (x: number, y: number) => raised.add(Math.round(y) * c.width + Math.round(x));

    for (let s = -3; s < L + 3; s++)
    {
        const x = o + s;
        const onSpan = s >= p0 && s <= p1;
        if (!onSpan)
        {
            // Causeway ramp: the same paving at full width with low parapets along both
            // sides, two steps down near the bank, its last few px settling into the ground.
            const endZone = s < 0 || s >= L;
            const rampEnd = (s < p0 ? s : L - 1 - s);                 // px from the ramp's outer end
            for (let y = top + 1; y < bottom - 1; y++)
            {
                if (endZone && hash2(x * 7, y * 3) % 2 === 0) continue;
                let col = deckStone(s + 50, y - top, x, y, S, variant, true);
                if (rampEnd === 6 || rampEnd === 12) col = S[3];                       // step risers
                c.set(x, y, col);
            }
            if (!endZone && rampEnd > 2)
            {
                // Low parapets: a lit top and a shaded face on each side.
                c.set(x, top + 1, S[0]); c.set(x, top + 2, S[2]); c.set(x, top + 3, S[4]);
                c.set(x, bottom - 4, S[4]); c.set(x, bottom - 3, S[0]); c.set(x, bottom - 2, S[2]);
                for (const y of [top + 1, top + 2, top + 3, bottom - 4, bottom - 3, bottom - 2]) mark(x, y);
                if (rampEnd === 3) for (const y of [top, bottom - 5]) { c.rect(x - 1, y - 1, 3, 3, S[1]); c.rect(x - 1, y - 1, 3, 1, S[0]); }  // end posts
            }
            continue;
        }
        // The raised span: north parapet, deck lanes, south parapet, then the south face.
        c.set(x, top, S[0]); c.set(x, top + 1, S[1]); c.set(x, top + 2, S[4]); c.set(x, top + 3, S[5]);
        for (let y = top; y < top + 4; y++) mark(x, y);
        for (let y = top + 4; y < faceTop - 4; y++) { c.set(x, y, deckStone(s, y - top - 4, x, y, S, variant, false)); mark(x, y); }
        c.set(x, faceTop - 4, S[5]); c.set(x, faceTop - 3, S[0]); c.set(x, faceTop - 2, S[1]); c.set(x, faceTop - 1, S[2]);
        for (let y = faceTop - 4; y < faceTop; y++) mark(x, y);
        if ((s - p0) % post === 0 && s > p0 + 4 && s < p1 - 4)
        {
            for (const y of [top - 2, faceTop - 5]) { c.rect(x - 1, y, 3, 3, S[2]); c.rect(x - 1, y, 3, 1, S[0]); for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) mark(x - 1 + k, y + j); }
        }
        // South face: dressed courses.
        for (let y = faceTop; y < bottom; y++)
        {
            const row = Math.floor((y - faceTop) / 3);
            const joint = (y - faceTop) % 3 === 2 || (s + row * 4) % 8 === 0;
            const t = (y - faceTop) / FACE;
            c.set(x, y, joint ? S[5] : S[t < 0.3 ? 2 : t < 0.7 ? 3 : 4]);
            mark(x, y);
        }
        // Shadow falling on the lava just south of the face.
        for (let y = bottom; y < bottom + 3; y++) if (lavaAt(x, y)) c.set(x, y, LAVA_SHADOW);
    }

    // Tall pointed arches through the face across all the lava, glowing from below:
    // the river is plainly seen flowing under the bridge.
    const a0 = Math.max(p0 + 3, plan.lavaStart - 2);
    const a1 = Math.min(p1 - 3, plan.lavaEnd + 2);
    const span = Math.max(10, a1 - a0);
    const arches = Math.max(1, Math.min(4, Math.round(span / 18)));
    const pier = 3;
    const archW = (span - pier * (arches - 1)) / arches;
    for (let k = 0; k < arches; k++)
    {
        const left = a0 + k * (archW + pier);
        const mid = left + archW / 2;
        const half = archW / 2;
        for (let s = Math.floor(left); s <= Math.ceil(left + archW); s++)
        {
            const d = Math.abs(s - mid) / half;
            if (d > 1) continue;
            const crown = faceTop + 1 + Math.round((FACE - 3) * (d ** 2.2));
            for (let y = crown; y < bottom; y++)
            {
                const t = (y - crown) / Math.max(1, bottom - crown);
                c.set(o + s, y, t > 0.7 ? LAVA.bright : t > 0.45 ? LAVA.hot : t > 0.2 ? LAVA.deep : LAVA.crust);
            }
            c.set(o + s, crown - 1, crown > faceTop + FACE - 5 ? '#c26a3a' : S[1]);        // voussoirs
        }
        c.rect(o + Math.round(mid), faceTop + 1, 1, 2, S[0]);                             // keystone
    }

    // Corner pillars where the span meets the ramps.
    for (const s of [p0, p1])
    {
        pillar(c, o + s, top + 3, 10, S, variant);
        pillar(c, o + s, faceTop, 8, S, variant);
        for (let y = top - 10; y < faceTop; y++) for (let x = o + s - 4; x <= o + s + 4; x++) if (c.get(x, y)) mark(x, y);
    }
    c.outlineRaised((x, y) => raised.has(y * c.width + x));
}

// ---------------------------------------------------------------------------
// North-south spans: parapets down both sides, a shadowed east face,
// cutwater piers splitting the lava.
// ---------------------------------------------------------------------------

function paintNorthSouth (c: BridgeCanvas, plan: SpanPlan, variant: number, lavaAt: (x: number, y: number) => boolean): void
{
    const S = STONES[variant % 2];
    const { length: L, across: W, p0, p1 } = plan;
    const o = M;
    const left = o;
    const right = o + W - 1;
    const post = variant % 2 === 0 ? 12 : 15;
    const raised = new Set<number>();
    const mark = (x: number, y: number) => raised.add(Math.round(y) * c.width + Math.round(x));

    // Cutwater piers (drawn first; the deck rests on them), pointing up- and downstream.
    const centre = o + Math.round((plan.lavaStart + plan.lavaEnd) / 2);
    const piers = plan.lavaEnd - plan.lavaStart > 26 ? [centre - 9, centre + 9] : [centre];
    for (const py of piers)
    {
        for (const side of [-1, 1])
        {
            for (let k = 0; k < M - 1; k++)
            {
                const half = Math.max(0, 4 - Math.floor(k * 0.6));
                const x = side < 0 ? left - 1 - k : right + 4 + k;
                for (let dy = -half; dy <= half; dy++)
                {
                    const edge = Math.abs(dy) === half;
                    c.set(x, py + dy, edge ? (dy > 0 ? '#b8562a' : S[1]) : dy < 0 ? S[2] : S[3]);   // lit by the lava below
                    mark(x, py + dy);
                }
            }
        }
    }

    for (let s = -3; s < L + 3; s++)
    {
        const y = o + s;
        const onSpan = s >= p0 && s <= p1;
        if (!onSpan)
        {
            // Causeway ramp: full width, low parapets both sides, steps near the bank.
            const endZone = s < 0 || s >= L;
            const rampEnd = (s < p0 ? s : L - 1 - s);
            for (let x = left + 1; x <= right - 1; x++)
            {
                if (endZone && hash2(x * 7, y * 3) % 2 === 0) continue;
                let col = deckStone(s + 50, x - left, x, y, S, variant, true);
                if (rampEnd === 6 || rampEnd === 12) col = S[3];
                c.set(x, y, col);
            }
            if (!endZone && rampEnd > 2)
            {
                c.set(left + 1, y, S[1]); c.set(left + 2, y, S[0]); c.set(left + 3, y, S[4]);
                c.set(right - 3, y, S[4]); c.set(right - 2, y, S[0]); c.set(right - 1, y, S[2]);
                c.set(right, y, S[4]);                                                  // a little east face
                for (const x of [left + 1, left + 2, left + 3, right - 3, right - 2, right - 1, right]) mark(x, y);
                if (rampEnd === 3) for (const x of [left + 1, right - 3]) { c.rect(x, y - 1, 3, 3, S[1]); c.rect(x, y - 1, 3, 1, S[0]); }
            }
            continue;
        }
        // West parapet (lit), deck lanes, east parapet (in shade), east side face, shadow on the lava.
        c.set(left, y, S[1]); c.set(left + 1, y, S[0]); c.set(left + 2, y, S[1]); c.set(left + 3, y, S[5]);
        for (let x = left + 4; x <= right - 4; x++) c.set(x, y, deckStone(s, x - left - 4, x, y, S, variant, false));
        c.set(right - 3, y, S[5]); c.set(right - 2, y, S[1]); c.set(right - 1, y, S[0]); c.set(right, y, S[2]);
        for (let x = right + 1; x <= right + 3; x++) c.set(x, y, x === right + 1 ? S[4] : S[5]);              // the bridge's east face
        for (let x = right + 4; x <= right + 6; x++) if (lavaAt(x, y) && !c.get(x, y)) c.set(x, y, LAVA_SHADOW); // its shadow
        for (let x = left; x <= right + 3; x++) mark(x, y);
        if ((s - p0) % post === 0 && s > p0 + 4 && s < p1 - 4)
        {
            for (const x of [left, right - 2]) { c.rect(x, y - 1, 3, 3, S[1]); c.rect(x, y - 1, 3, 1, S[0]); c.rect(x, y + 1, 3, 1, S[3]); }
        }
    }
    // Where the span meets each ramp: a step down, and corner pillars.
    for (const s of [p0, p1])
    {
        const y = o + s;
        for (let x = left; x <= right + 3; x++) c.set(x, s === p1 ? y + 1 : y, S[s === p1 ? 4 : 0]);
        pillar(c, left + 2, y + (s === p0 ? 1 : 2), 9, S, variant);
        pillar(c, right - 2, y + (s === p0 ? 1 : 2), 9, S, variant);
        for (let yy = y - 13; yy <= y + 2; yy++) for (const xx of [left, left + 1, left + 2, left + 3, left + 4, right - 4, right - 3, right - 2, right - 1, right]) if (c.get(xx, yy)) mark(xx, yy);
    }
    c.outlineRaised((x, y) => raised.has(y * c.width + x));
}

// ---------------------------------------------------------------------------
// Light: braziers on the pillars, and the lava's glow where it passes under
// ---------------------------------------------------------------------------

function addLights (scene: Scene, bridge: Bridge, plan: SpanPlan): void
{
    const r = bridge.rect!;
    const ew = bridge.axis === 'ew';
    if ((bridge.variant ?? 0) % 4 === 0)
    {
        const pts = ew
            ? [[r.x + plan.p0, r.y - 10], [r.x + plan.p1, r.y - 10], [r.x + plan.p0, r.y + r.height - FACE - 12], [r.x + plan.p1, r.y + r.height - FACE - 12]]
            : [[r.x + 2, r.y + plan.p0 - 11], [r.x + r.width - 3, r.y + plan.p0 - 11], [r.x + 2, r.y + plan.p1 - 10], [r.x + r.width - 3, r.y + plan.p1 - 10]];
        for (const [x, y] of pts) addGlow(scene, x, y, '#ff8a2a', { scale: 0.45, depth: DEPTH + 0.1, duration: 160, minAlpha: 0.35, maxAlpha: 0.65 });
    }
    const mid = (plan.lavaStart + plan.lavaEnd) / 2;
    const glows = ew ? [[r.x + mid, r.y + r.height - 3]] : [[r.x - 4, r.y + mid], [r.x + r.width + 6, r.y + mid]];
    for (const [x, y] of glows) addGlow(scene, x, y, '#ef6a1d', { scale: 0.7, depth: DEPTH + 0.1, duration: 1700, minAlpha: 0.18, maxAlpha: 0.36 });
}
