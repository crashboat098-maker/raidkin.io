import { GameObjects, Scene } from 'phaser';
import type { SoldierRole } from '../logic/Army';
import { SPIN_REWARDS, type CastleSettings, type CastleStatus } from '../logic/Castles';
import type { Player } from '../logic/Player';
import { Depth } from './BattlefieldView';
import { hexToInt, Palette, type ArmyColor } from './Palette';
import { PIXEL_FONT } from './PixelFont';
import { Tex } from './PlaceholderArt';
import { buildWheelHolder, keepLabelsUpright, sliceUnderPointer, spinRotation, spinTarget, WHEEL_DEPTH, type WheelSlice } from './Wheel';

/**
 * Draws the three Lucky Spin castles: the circle, banners, an info panel,
 * and the reward wheel (fixed at its castle, never following the camera).
 *
 * The circle is a ring of small square "pixels" on the ground (under the
 * soldiers), so it reads as part of the pixel-art world:
 *   ready     gold rhythm (step in and hold the circle to spin)
 *   charging  the holder's colour fills clockwise (a countdown dial shows the
 *             seconds left); flashes red, paused, while another army is inside
 *   spinning  the spinner's colour
 *   cooldown  muted grey, lighting back up as the cooldown runs out
 *
 * The wheel turns slowly while the castle is ready, spins to the result the
 * World (online: the server) already picked, then shows it for a moment. It
 * is hidden while the castle is recharging. Nothing is redrawn unless what it
 * shows changed, so a castle costs next to nothing per frame.
 */

/** Spacing of the ring's dots along the circle (world px). */
const DOT_SPACING = 6;
const DOT_SIZE = 2;
/** On the ground: above trails and baked scenery, below every standing thing. */
const RING_DEPTH = Depth.FlatDecorations + 0.5;
/** Panels and wheels sit with the army name tags, above the fighting. */
const PANEL_DEPTH = 849_000;

const READY_COLOR = 0xe8d8a0;
const READY_ACCENT = 0xf0c860;
const MUTED_COLOR = 0x6a6a60;
const NAME_COLOR = 0xf0c860;
const TEXT_COLOR = 0xe8e0c8;
const LOSS_COLOR = 0xd8432f;
const CONTESTED_COLOR = 0xd8432f;
const FLASH_MS = 260;
/** The charge countdown dial (world px). */
const DIAL_RADIUS = 12;

/** How far above the castle's front (its gate) the small wheel sits. */
const WHEEL_LIFT = 16;
/** The small wheel (someone else's spin, or a ready castle) is this size of the full one. */
const SMALL_WHEEL_SCALE = 0.45;
/** Your own spin: the full wheel sits this far above the circle's centre (world px). */
const FULL_WHEEL_RISE = 30;
/** Idle turning speed while ready (radians per second). */
const IDLE_SPEED = 0.35;

const ROLE_COLORS: Record<SoldierRole, number> = { warrior: 0xc8503c, archer: 0x5aa848, guardian: 0x5a7ec8 };
const ROLE_NAME: Record<SoldierRole, string> = { warrior: 'WARRIORS', archer: 'ARCHERS', guardian: 'GUARDIANS' };
const RARE_COLOR = 0xf0c860;
const LOSS_SLICE = 0x2a1618;

/** The castle wheel: one slice per reward (coloured by class), each with its amount. */
const CASTLE_SLICES: readonly WheelSlice[] = SPIN_REWARDS.map((r) => ({
    text: `${r.count}`,
    color: r.count < 0 ? LOSS_SLICE : r.role === 'random' ? RARE_COLOR : ROLE_COLORS[r.role ?? 'warrior'],
    textColor: r.count < 0 ? LOSS_COLOR : 0x1a120a,
}));

interface CastleSprites {
    ring: GameObjects.Graphics;
    ringKey: string;
    banners: GameObjects.Image[];
    bannerKey: string;
    panel: GameObjects.Graphics;
    lines: GameObjects.BitmapText[];
    panelKey: string;
    wheel: GameObjects.Container;
    /** Holds the wheel and its fixed pointer, at one of two fixed spots at the castle. */
    holder: GameObjects.Container;
    /** Small wheel (others' spins, ready) at the gate; full wheel (your spin) in the circle. */
    small: { x: number; y: number };
    full: { x: number; y: number };
    /** The spin the wheel is showing, where it started turning from and where it ends. */
    spinId: number;
    spinFrom: number;
    spinTo: number;
    /** The charge countdown (seconds left inside a filling circle). */
    dial: GameObjects.Graphics;
    dialText: GameObjects.BitmapText;
    dialKey: string;
    /** The slice under the pointer right now (SPIN_REWARDS index). */
    underPointer: number;
    /** The last spin whose landing was celebrated. */
    landedId: number;
    lastTime: number;
}

export class CastleView
{
    private readonly sprites: CastleSprites[];

    constructor (scene: Scene, castles: readonly CastleStatus[], private readonly settings: CastleSettings)
    {
        this.sprites = castles.map((c) => {
            const { front } = c.site;
            const banners = [-1, 1].map((side) =>
                scene.add.image(front.x + side * 34, front.y + 8, Tex.CastleBannerNeutral).setOrigin(0.5, 1).setDepth(front.y + 8).setFlipX(side < 0));
            const small = { x: front.x, y: front.y - WHEEL_LIFT };
            return {
                small,
                full: { x: c.site.x, y: c.site.y - FULL_WHEEL_RISE },
                ring: scene.add.graphics().setDepth(RING_DEPTH),
                ringKey: '',
                banners,
                bannerKey: '',
                panel: scene.add.graphics().setDepth(PANEL_DEPTH),
                lines: [0, 1, 2].map(() => scene.add.bitmapText(0, 0, PIXEL_FONT, '').setOrigin(0.5, 0).setDepth(PANEL_DEPTH + 1)),
                panelKey: '',
                ...buildWheelHolder(scene, small.x, small.y, CASTLE_SLICES),
                spinId: -1,
                spinFrom: 0,
                spinTo: 0,
                dial: scene.add.graphics().setDepth(WHEEL_DEPTH).setVisible(false),
                dialText: scene.add.bitmapText(0, 0, PIXEL_FONT, '').setOrigin(0.5, 0.5).setDepth(WHEEL_DEPTH + 1).setVisible(false),
                dialKey: '',
                underPointer: 0,
                landedId: -1,
                lastTime: 0,
            };
        });
    }

    /**
     * Bring every castle's look up to date. Call once per frame.
     * `me` is this screen's player (their own spins get the full wheel).
     * `landed` is called once when a wheel stops (for the scene's effects).
     */
    sync (
        castles: readonly CastleStatus[], time: number, view: { x: number; y: number; right: number; bottom: number },
        me: Player | null, landed?: (c: CastleStatus, color: number) => void,
    ): void
    {
        castles.forEach((c, i) => {
            const s = this.sprites[i];
            if (!s) return;
            const dt = s.lastTime ? Math.min(0.1, (time - s.lastTime) / 1000) : 0;
            s.lastTime = time;
            const { site } = c;
            const reach = site.radius + 40;
            const onScreen = site.x + reach > view.x && site.x - reach < view.right && site.y + reach > view.y && site.y - reach - 220 < view.bottom;
            s.ring.setVisible(onScreen);
            s.panel.setVisible(onScreen);
            for (const line of s.lines) line.setVisible(onScreen);
            if (!onScreen) { s.dial.setVisible(false); s.dialText.setVisible(false); }
            this.turnWheel(c, s, dt, onScreen, landed);
            if (!onScreen) return;
            this.placeWheel(c, s, me);
            this.drawRing(c, s, time);
            this.drawDial(c, s, time);
            this.drawBanners(c, s);
            this.drawPanel(c, s);
        });
    }

    /**
     * The wheel never follows the camera: it has two fixed spots at its castle.
     * Your own spin shows the full wheel in the circle, a little above its
     * centre (where you're standing, so you can watch it). Anyone else's spin,
     * and a ready wheel, is a small wheel at the castle's gate.
     */
    private placeWheel (c: CastleStatus, s: CastleSprites, me: Player | null): void
    {
        if (!s.holder.visible) return;
        const mine = me !== null && c.spin?.player === me;
        const spot = mine ? s.full : s.small;
        const scale = mine ? 1 : SMALL_WHEEL_SCALE;
        if (spot.x !== s.holder.x || spot.y !== s.holder.y) s.holder.setPosition(spot.x, spot.y);
        if (s.holder.scale !== scale) s.holder.setScale(scale);
    }

    private turnWheel (c: CastleStatus, s: CastleSprites, dt: number, onScreen: boolean, landed?: (c: CastleStatus, color: number) => void): void
    {
        const spin = c.spin;
        const showing = onScreen && (spin !== null || c.state === 'ready');
        s.holder.setVisible(showing);

        if (!spin)
        {
            if (c.state === 'ready' && showing)
            {
                s.wheel.rotation = (s.wheel.rotation + IDLE_SPEED * dt) % (Math.PI * 2);
                keepLabelsUpright(s.wheel);
            }
            return;
        }

        // A new spin: turn from where the wheel is to the slice the result is on
        // (slice k sits under the top pointer at rotation -k * slice), plus a
        // few full turns and a small, fixed nudge off the slice's centre.
        if (s.spinId !== spin.id)
        {
            s.spinId = spin.id;
            s.spinFrom = s.wheel.rotation;
            s.spinTo = spinTarget(s.spinFrom, spin.rewardId, SPIN_REWARDS.length, spin.id);
        }
        const t = Math.min(1, spin.elapsedMs / this.settings.spinMs);
        s.wheel.rotation = spinRotation(s.spinFrom, s.spinTo, t);
        keepLabelsUpright(s.wheel);
        // The slice passing under the pointer (the panel names it while the wheel spins).
        s.underPointer = t >= 1 ? spin.rewardId : sliceUnderPointer(s.wheel.rotation, SPIN_REWARDS.length);

        if (t >= 1 && s.landedId !== spin.id)
        {
            s.landedId = spin.id;
            s.wheel.rotation = s.spinTo % (Math.PI * 2);
            s.spinFrom = s.spinTo = s.wheel.rotation;
            // (Not for a spin that had long landed before we saw it, e.g. just after joining.)
            if (onScreen && spin.elapsedMs < this.settings.spinMs + 500) landed?.(c, sliceColor(spin.rewardId));
        }
    }

    /**
     * The countdown while an army holds the circle: a small dial at a fixed
     * spot in the circle (where the full wheel appears), filling clockwise in
     * the holder's colour around the seconds left. Red while contested.
     */
    private drawDial (c: CastleStatus, s: CastleSprites, time: number): void
    {
        const charging = c.state === 'ready' && c.charger !== null && !c.spin;
        s.dial.setVisible(charging);
        s.dialText.setVisible(charging);
        if (!charging || !c.charger) return;
        const left = Math.max(0, Math.ceil((this.settings.chargeMs - c.chargedMs) / 1000));
        const steps = 48;
        const filled = Math.floor((c.chargedMs / this.settings.chargeMs) * steps);
        const flashOn = c.contested && Math.floor(time / FLASH_MS) % 2 === 0;
        const color = c.contested ? CONTESTED_COLOR : hexToInt(colorsOf(c.charger).main);
        const key = `${filled}|${left}|${color}|${flashOn}`;
        if (key === s.dialKey) return;
        s.dialKey = key;

        const { x, y } = s.full;
        const g = s.dial;
        g.clear();
        g.fillStyle(0x000000, 0.45);
        g.fillCircle(x + 1, y + 2, DIAL_RADIUS + 2);
        g.fillStyle(0x0d0f0c, 0.85);
        g.fillCircle(x, y, DIAL_RADIUS + 2);
        // Track, then the filled part (clockwise from the top).
        g.lineStyle(3, 0x3a3428, 1);
        g.beginPath();
        g.arc(x, y, DIAL_RADIUS - 1, 0, Math.PI * 2);
        g.strokePath();
        if (filled > 0)
        {
            g.lineStyle(3, color, flashOn ? 0.5 : 1);
            g.beginPath();
            g.arc(x, y, DIAL_RADIUS - 1, -Math.PI / 2, -Math.PI / 2 + (filled / steps) * Math.PI * 2);
            g.strokePath();
        }
        s.dialText.setText(`${left}`).setTint(c.contested ? CONTESTED_COLOR : TEXT_COLOR).setPosition(x, y);
    }

    private drawRing (c: CastleStatus, s: CastleSprites, time: number): void
    {
        const { x, y, radius } = c.site;
        const dots = Math.max(24, Math.round((Math.PI * 2 * radius) / DOT_SPACING));

        // What the ring shows: a base colour for every dot, and the first `filled` dots in `fill`.
        let base = READY_COLOR;
        let baseAlpha = 0.5;
        let fill = READY_COLOR;
        let filled = 0;
        let area = 0;
        const spinner = c.spin?.player ?? null;
        const flashOn = c.state === 'ready' && c.contested && Math.floor(time / FLASH_MS) % 2 === 0;
        if (c.state === 'ready' && c.charger)
        {
            // Charging: the charger's colour fills clockwise from the top.
            base = READY_COLOR;
            baseAlpha = 0.3;
            fill = hexToInt(colorsOf(c.charger).main);
            filled = Math.floor((c.chargedMs / this.settings.chargeMs) * dots);
            area = fill;
        }
        else if (spinner && c.spin && !c.spin.landed)
        {
            base = fill = hexToInt(colorsOf(spinner).main);
            baseAlpha = 0.8;
            filled = dots;
            area = fill;
        }
        else if (c.state === 'cooldown')
        {
            base = MUTED_COLOR;
            baseAlpha = 0.45;
            fill = READY_COLOR;
            filled = Math.floor((1 - c.cooldownMs / this.settings.cooldownMs) * dots);
        }

        if (flashOn) { base = CONTESTED_COLOR; baseAlpha = 0.85; }

        const key = `${c.state}|${base}|${baseAlpha}|${fill}|${filled}|${flashOn}`;
        if (key === s.ringKey) return;
        s.ringKey = key;

        const g = s.ring;
        g.clear();
        // A faint wash inside the circle while a wheel spins for someone.
        if (area)
        {
            g.fillStyle(area, 0.05);
            g.fillCircle(x, y, radius);
        }
        for (let k = 0; k < dots; k++)
        {
            // Clockwise from the top.
            const a = -Math.PI / 2 + (k / dots) * Math.PI * 2;
            const px = Math.round(x + Math.cos(a) * radius - DOT_SIZE / 2);
            const py = Math.round(y + Math.sin(a) * radius - DOT_SIZE / 2);
            const isFilled = k < filled;
            let color = isFilled ? fill : base;
            let alpha = isFilled ? 0.95 : baseAlpha;
            // Ready rings get a little gold rhythm so they read as "special ground".
            if (!isFilled && c.state === 'ready' && !c.charger && !flashOn && k % 4 === 0) { color = READY_ACCENT; alpha = 0.7; }
            if (isFilled && c.state === 'cooldown' && !area) alpha = 0.55;
            g.fillStyle(0x000000, alpha * 0.5);
            g.fillRect(px + 1, py + 1, DOT_SIZE, DOT_SIZE);
            g.fillStyle(color, alpha);
            g.fillRect(px, py, DOT_SIZE, DOT_SIZE);
        }
    }

    private drawBanners (c: CastleStatus, s: CastleSprites): void
    {
        const key = c.state;
        if (key === s.bannerKey) return;
        s.bannerKey = key;
        for (const banner of s.banners) banner.setAlpha(c.state === 'cooldown' ? 0.6 : 1);
    }

    private drawPanel (c: CastleStatus, s: CastleSprites): void
    {
        const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
        let status = '';
        let statusColor = TEXT_COLOR;
        let detail = '';
        let detailColor = TEXT_COLOR;
        let border = 0x7a6a48;
        const spin = c.spin;

        if (spin && !spin.landed)
        {
            // Like a slot machine: whatever slice is passing the pointer.
            const r = SPIN_REWARDS[s.underPointer];
            status = r.role === 'random' ? `+${r.count} RANDOM` : r.label;
            statusColor = sliceColor(s.underPointer);
            const who = spin.player;
            detail = `${who?.name ?? 'SOMEONE'} SPINS...`;
            detailColor = who ? hexToInt(colorsOf(who).main) : TEXT_COLOR;
            border = detailColor;
        }
        else if (spin)
        {
            status = rewardText(spin.rewardId, spin.role);
            statusColor = sliceColor(spin.rewardId);
            detail = spin.player ? `FOR ${spin.player.name}` : '';
            border = statusColor;
        }
        else if (c.state === 'ready' && c.charger)
        {
            status = `${c.charger.name} HOLDING`;
            statusColor = hexToInt(colorsOf(c.charger).main);
            detail = c.contested ? 'CONTESTED - PAUSED' : `SPIN IN ${secs(this.settings.chargeMs - c.chargedMs)}S`;
            detailColor = c.contested ? CONTESTED_COLOR : TEXT_COLOR;
            border = statusColor;
        }
        else if (c.state === 'ready')
        {
            status = c.contested ? 'CONTESTED' : 'LUCKY SPIN READY';
            statusColor = c.contested ? CONTESTED_COLOR : NAME_COLOR;
            detail = `HOLD ${secs(this.settings.chargeMs)}S TO SPIN`;
        }
        else
        {
            status = 'RECHARGING';
            detail = `READY IN ${secs(c.cooldownMs)}S`;
            detailColor = MUTED_COLOR + 0x303030;
        }

        const key = `${status}|${statusColor}|${detail}|${detailColor}`;
        if (key === s.panelKey) return;
        s.panelKey = key;

        const [name, line2, line3] = s.lines;
        const top = c.site.y + c.site.radius + 8;
        name.setText(c.site.name).setTint(NAME_COLOR).setPosition(c.site.x, top + 3);
        line2.setText(status).setTint(statusColor).setPosition(c.site.x, top + 13);
        line3.setText(detail).setTint(detailColor).setPosition(c.site.x, top + 23);

        const width = Math.max(name.width, line2.width, line3.width) + 10;
        const g = s.panel;
        g.clear();
        g.fillStyle(0x0d0f0c, 0.72);
        g.fillRect(Math.round(c.site.x - width / 2), top, Math.round(width), 34);
        g.lineStyle(1, border, 0.9);
        g.strokeRect(Math.round(c.site.x - width / 2) + 0.5, top + 0.5, Math.round(width) - 1, 33);
    }
}

/** What a result says: "+15 ARCHERS", "+25 GUARDIANS", "LOSE 10 SOLDIERS". */
function rewardText (rewardId: number, role: SoldierRole): string
{
    const r = SPIN_REWARDS[rewardId];
    if (!r) return '';
    return r.count < 0 ? `LOSE ${-r.count} SOLDIERS` : `+${r.count} ${ROLE_NAME[role]}`;
}


/** A slice's colour: its class, gold for the rare one, red for the loss (as text). */
function sliceColor (rewardId: number): number
{
    const r = SPIN_REWARDS[rewardId];
    if (!r) return TEXT_COLOR;
    if (r.count < 0) return LOSS_COLOR;
    return r.role === 'random' ? RARE_COLOR : ROLE_COLORS[r.role ?? 'warrior'];
}

function colorsOf (p: Player): { main: string; dark: string }
{
    return Palette.armies[p.colorId as ArmyColor] ?? Palette.armies.crimson;
}
