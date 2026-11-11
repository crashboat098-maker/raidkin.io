import { GameObjects, Scene } from 'phaser';
import type { CastleSettings, CastleStatus } from '../logic/Castles';
import type { Player } from '../logic/Player';
import { Depth } from './BattlefieldView';
import { hexToInt, Palette, type ArmyColor } from './Palette';
import { PIXEL_FONT } from './PixelFont';
import { Tex } from './PlaceholderArt';

/**
 * Draws the three castles' capture circles, banners and info panels.
 *
 * The circle is a ring of small square "pixels" on the ground (under the
 * soldiers), so it reads as part of the pixel-art world:
 *   neutral   subtle white/gold
 *   capturing fills clockwise from the top in the capturing army's colour
 *   contested flashes red, progress paused
 *   owned     the owner's colour (banners too)
 *   cooldown  muted grey, lighting back up as the cooldown runs out
 *
 * Nothing is redrawn unless what it shows changed (a dot filled, a second
 * ticked, the colour changed), so a castle costs next to nothing per frame.
 */

/** Spacing of the ring's dots along the circle (world px). */
const DOT_SPACING = 6;
const DOT_SIZE = 2;
/** On the ground: above trails and baked scenery, below every standing thing. */
const RING_DEPTH = Depth.FlatDecorations + 0.5;
/** Panels sit with the army name tags, above the fighting. */
const PANEL_DEPTH = 849_000;
const FLASH_MS = 260;

const NEUTRAL_COLOR = 0xe8d8a0;
const NEUTRAL_ACCENT = 0xf0c860;
const CONTESTED_COLOR = 0xd8432f;
const MUTED_COLOR = 0x6a6a60;
const NAME_COLOR = 0xf0c860;
const TEXT_COLOR = 0xe8e0c8;

interface CastleSprites {
    ring: GameObjects.Graphics;
    ringKey: string;
    banners: GameObjects.Image[];
    bannerKey: string;
    panel: GameObjects.Graphics;
    lines: GameObjects.BitmapText[];
    panelKey: string;
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
            return {
                ring: scene.add.graphics().setDepth(RING_DEPTH),
                ringKey: '',
                banners,
                bannerKey: '',
                panel: scene.add.graphics().setDepth(PANEL_DEPTH),
                lines: [0, 1, 2].map(() => scene.add.bitmapText(0, 0, PIXEL_FONT, '').setOrigin(0.5, 0).setDepth(PANEL_DEPTH + 1)),
                panelKey: '',
            };
        });
    }

    /** Bring every castle's look up to date. Call once per frame. */
    sync (castles: readonly CastleStatus[], time: number, view: { x: number; y: number; right: number; bottom: number }): void
    {
        castles.forEach((c, i) => {
            const s = this.sprites[i];
            if (!s) return;
            const { site } = c;
            const reach = site.radius + 40;
            const onScreen = site.x + reach > view.x && site.x - reach < view.right && site.y + reach > view.y && site.y - reach - 220 < view.bottom;
            s.ring.setVisible(onScreen);
            s.panel.setVisible(onScreen);
            for (const line of s.lines) line.setVisible(onScreen);
            if (!onScreen) return;
            this.drawRing(c, s, time);
            this.drawBanners(c, s);
            this.drawPanel(c, s);
        });
    }

    /** A castle was just taken: a burst of the new owner's colour over the circle. */
    captured (c: CastleStatus, play: (x: number, y: number, color: string) => void): void
    {
        if (!c.owner) return;
        const color = colorsOf(c.owner).main;
        play(c.site.x, c.site.y, color);
        for (let k = 0; k < 8; k++)
        {
            const a = (k / 8) * Math.PI * 2;
            play(c.site.x + Math.cos(a) * c.site.radius, c.site.y + Math.sin(a) * c.site.radius, color);
        }
    }

    private drawRing (c: CastleStatus, s: CastleSprites, time: number): void
    {
        const { x, y, radius } = c.site;
        const dots = Math.max(24, Math.round((Math.PI * 2 * radius) / DOT_SPACING));
        const flashOn = c.contested && Math.floor(time / FLASH_MS) % 2 === 0;

        // What the ring shows: a base colour for every dot, and the first `filled` dots in `fill`.
        let base = NEUTRAL_COLOR;
        let baseAlpha = 0.5;
        let fill = NEUTRAL_COLOR;
        let filled = 0;
        let area = 0;
        if (c.state === 'neutral' && c.capturer)
        {
            base = NEUTRAL_COLOR;
            baseAlpha = 0.3;
            fill = hexToInt(colorsOf(c.capturer).main);
            filled = Math.floor(c.progress * dots);
            area = fill;
        }
        else if (c.state === 'owned' && c.owner && c.capturer)
        {
            // Being taken over: the challenger's colour eats into the owner's ring.
            base = hexToInt(colorsOf(c.owner).main);
            baseAlpha = 0.5;
            fill = hexToInt(colorsOf(c.capturer).main);
            filled = Math.floor(c.progress * dots);
            area = fill;
        }
        else if (c.state === 'owned' && c.owner)
        {
            base = fill = hexToInt(colorsOf(c.owner).main);
            baseAlpha = 0.8;
            filled = dots;
            area = fill;
        }
        else if (c.state === 'cooldown')
        {
            base = MUTED_COLOR;
            baseAlpha = 0.45;
            fill = NEUTRAL_COLOR;
            filled = Math.floor((1 - c.cooldownMs / this.settings.cooldownMs) * dots);
        }
        if (flashOn) { base = CONTESTED_COLOR; baseAlpha = 0.85; }

        const key = `${base}|${baseAlpha}|${fill}|${filled}|${flashOn}`;
        if (key === s.ringKey) return;
        s.ringKey = key;

        const g = s.ring;
        g.clear();
        // A faint wash inside the circle while someone is taking or holding it.
        if (area || flashOn)
        {
            g.fillStyle(flashOn ? CONTESTED_COLOR : area, flashOn ? 0.07 : 0.05);
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
            // Neutral rings get a little gold rhythm so they read as "special ground".
            if (!isFilled && c.state === 'neutral' && !c.capturer && !flashOn && k % 4 === 0) { color = NEUTRAL_ACCENT; alpha = 0.7; }
            if (isFilled && c.state === 'cooldown') alpha = 0.55;
            g.fillStyle(0x000000, alpha * 0.5);
            g.fillRect(px + 1, py + 1, DOT_SIZE, DOT_SIZE);
            g.fillStyle(color, alpha);
            g.fillRect(px, py, DOT_SIZE, DOT_SIZE);
        }
    }

    private drawBanners (c: CastleStatus, s: CastleSprites): void
    {
        const holder = c.state !== 'neutral' ? c.owner : null;
        const key = `${holder?.colorId ?? '-'}|${c.state}`;
        if (key === s.bannerKey) return;
        s.bannerKey = key;
        const texture = holder ? Tex.banner(holder.colorId) : Tex.CastleBannerNeutral;
        for (const banner of s.banners)
        {
            banner.setTexture(texture).setAlpha(c.state === 'cooldown' ? 0.6 : 1);
        }
    }

    private drawPanel (c: CastleStatus, s: CastleSprites): void
    {
        const set = this.settings;
        const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
        let status = '';
        let statusColor = TEXT_COLOR;
        let detail = '';
        let detailColor = TEXT_COLOR;

        if (c.state === 'neutral')
        {
            if (c.contested) { status = 'CONTESTED'; statusColor = CONTESTED_COLOR; }
            else if (c.capturer) { status = `${c.capturer.name} CAPTURING`; statusColor = hexToInt(colorsOf(c.capturer).main); }
            else status = 'NEUTRAL';
            detail = c.capturer
                ? `${secs((1 - c.progress) * set.captureMs)}S LEFT`
                : `HOLD ${secs(set.captureMs)}S TO CAPTURE`;
            detailColor = c.contested ? CONTESTED_COLOR : TEXT_COLOR;
        }
        else if (c.state === 'owned' && c.owner && c.capturer)
        {
            // An unguarded castle being taken over.
            status = c.contested ? 'CONTESTED' : `${c.capturer.name} TAKING OVER`;
            statusColor = c.contested ? CONTESTED_COLOR : hexToInt(colorsOf(c.capturer).main);
            detail = `${secs((1 - c.progress) * set.captureMs)}S LEFT  OWNER ${c.owner.name}`;
            detailColor = c.contested ? CONTESTED_COLOR : TEXT_COLOR;
        }
        else if (c.state === 'owned' && c.owner)
        {
            status = `OWNER ${c.owner.name}`;
            statusColor = hexToInt(colorsOf(c.owner).main);
            const next = c.contested ? 'CONTESTED' : c.nextGuardianMs === null ? 'PAUSED' : `NEXT ${secs(c.nextGuardianMs)}S`;
            detail = `GUARDIANS ${c.awarded}/${set.maxGuardians}  ${next}`;
            detailColor = c.contested ? CONTESTED_COLOR : TEXT_COLOR;
        }
        else
        {
            status = c.owner ? `HELD BY ${c.owner.name}` : 'RESTING';
            statusColor = c.owner ? hexToInt(colorsOf(c.owner).main) : TEXT_COLOR;
            detail = `COOLDOWN ${secs(c.cooldownMs)}S`;
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
        g.lineStyle(1, c.state === 'owned' && c.owner ? hexToInt(colorsOf(c.owner).main) : 0x7a6a48, 0.9);
        g.strokeRect(Math.round(c.site.x - width / 2) + 0.5, top + 0.5, Math.round(width) - 1, 33);
    }
}

function colorsOf (p: Player): { main: string; dark: string }
{
    return Palette.armies[p.colorId as ArmyColor] ?? Palette.armies.crimson;
}
