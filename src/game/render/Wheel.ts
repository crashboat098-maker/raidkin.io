import { GameObjects, Scene } from 'phaser';
import { PIXEL_FONT } from './PixelFont';

/**
 * A Lucky Wheel (castle spins, arena duels): coloured slices with upright
 * numbers, a gold rim and a fixed pointer at the top. The result is always
 * decided by the World (the server online); the wheel only turns to it.
 */

/** Wheel radius (world px). */
export const WHEEL_RADIUS = 30;
/** Wheels float above everything on the battlefield, army names and crown included. */
export const WHEEL_DEPTH = 850_100;
/** Full turns a wheel makes before it settles on the result. */
const SPIN_TURNS = 5;

const RIM = 0x3a2a18;
const GOLD = 0xf0c860;

export interface WheelSlice {
    text: string;
    color: number;
    textColor: number;
}

/** The wheel (slice k centred on the top at rotation 0, then clockwise) and its pointer, in one holder. */
export function buildWheelHolder (scene: Scene, x: number, y: number, slices: readonly WheelSlice[]): { wheel: GameObjects.Container; holder: GameObjects.Container }
{
    const n = slices.length;
    const slice = (Math.PI * 2) / n;
    const g = scene.add.graphics();
    // Rim and shadow.
    g.fillStyle(0x000000, 0.45);
    g.fillCircle(1, 2, WHEEL_RADIUS + 3);
    g.fillStyle(RIM, 1);
    g.fillCircle(0, 0, WHEEL_RADIUS + 3);
    const labels: GameObjects.BitmapText[] = [];
    slices.forEach((s, k) => {
        const mid = -Math.PI / 2 + k * slice;
        g.fillStyle(s.color, 1);
        g.slice(0, 0, WHEEL_RADIUS, mid - slice / 2, mid + slice / 2, false);
        g.fillPath();
        // A darker edge between slices.
        g.lineStyle(1, 0x1a120a, 0.9);
        g.lineBetween(0, 0, Math.cos(mid - slice / 2) * WHEEL_RADIUS, Math.sin(mid - slice / 2) * WHEEL_RADIUS);
        const at = WHEEL_RADIUS * 0.64;
        labels.push(scene.add.bitmapText(Math.cos(mid) * at, Math.sin(mid) * at, PIXEL_FONT, s.text).setOrigin(0.5, 0.5).setTint(s.textColor));
    });
    // Gold rim studs and the hub.
    for (let k = 0; k < n; k++)
    {
        const a = -Math.PI / 2 + (k + 0.5) * slice;
        g.fillStyle(GOLD, 1);
        g.fillRect(Math.round(Math.cos(a) * (WHEEL_RADIUS + 1.5)) - 1, Math.round(Math.sin(a) * (WHEEL_RADIUS + 1.5)) - 1, 2, 2);
    }
    g.fillStyle(RIM, 1);
    g.fillCircle(0, 0, 5);
    g.fillStyle(GOLD, 1);
    g.fillCircle(0, 0, 3);
    const wheel = scene.add.container(0, 0, [g, ...labels]);

    const top = -WHEEL_RADIUS - 6;
    const pointer = scene.add.graphics();
    pointer.fillStyle(0x1a120a, 1);
    pointer.fillTriangle(-6, top - 1, 6, top - 1, 0, top + 10);
    pointer.fillStyle(0xf8f0d8, 1);
    pointer.fillTriangle(-4, top, 4, top, 0, top + 7);
    const holder = scene.add.container(x, y, [wheel, pointer]).setDepth(WHEEL_DEPTH).setVisible(false);
    return { wheel, holder };
}

/** The slice numbers stay upright while the wheel turns (pixel text reads badly rotated). */
export function keepLabelsUpright (wheel: GameObjects.Container): void
{
    const list = wheel.list;
    for (let i = 1; i < list.length; i++) (list[i] as GameObjects.BitmapText).rotation = -wheel.rotation;
}

/**
 * Where a spin starting at rotation `from` ends so slice `index` (of `n`) is
 * under the pointer: a few full turns on, nudged a little off the slice's
 * centre (fixed per spin `id`, so every screen shows the same landing).
 */
export function spinTarget (from: number, index: number, n: number, id: number): number
{
    const slice = (Math.PI * 2) / n;
    const nudge = (((id * 7919) % 100) / 100 - 0.5) * slice * 0.6;
    let to = -index * slice + nudge;
    while (to < from + SPIN_TURNS * Math.PI * 2) to += Math.PI * 2;
    return to;
}

/** The wheel's rotation `t` (0..1) of the way through a spin: fast, then easing to a stop. */
export function spinRotation (from: number, to: number, t: number): number
{
    const eased = 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);
    return from + (to - from) * eased;
}

/** The slice under the pointer at a rotation. */
export function sliceUnderPointer (rotation: number, n: number): number
{
    const slice = (Math.PI * 2) / n;
    return ((Math.round(-rotation / slice) % n) + n) % n;
}
