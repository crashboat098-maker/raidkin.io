import { GameObjects, Scene } from 'phaser';
import { ARENA_OUTCOMES, type ArenaSettings, type ArenaStatus, type ArenaZone } from '../logic/Arena';
import type { Player } from '../logic/Player';
import { Depth } from './BattlefieldView';
import { ArenaTex } from './CrystalView';
import { hexToInt, Palette, type ArmyColor } from './Palette';
import { PIXEL_FONT } from './PixelFont';
import { buildWheelHolder, keepLabelsUpright, spinRotation, spinTarget, WHEEL_DEPTH, type WheelSlice } from './Wheel';

/**
 * The arena's moving parts: each entry zone's ring (filling as its army holds
 * it) with a seconds dial and a status panel, the two gates (open during the
 * duel), each contestant's Lucky Wheel (fixed beside its zone), the 3-2-1
 * countdown over each zone, and a banner over the arena (who's fighting, who
 * won). Everything is cached and only redrawn when what it shows changes.
 */

const DOT_SPACING = 6;
const DOT_SIZE = 2;
const RING_DEPTH = Depth.FlatDecorations + 0.5;
const PANEL_DEPTH = 849_000;
const FLASH_MS = 260;
const DIAL_RADIUS = 12;

const ZONE_COLOR = 0x9fe0ff;
const ZONE_ACCENT = 0xc79bff;
const MUTED_COLOR = 0x6a6a80;
const NAME_COLOR = 0xc79bff;
const TEXT_COLOR = 0xe8e0c8;
const CONTESTED_COLOR = 0xd8432f;
const GAIN_COLOR = 0x5ad88c;
const LOSS_COLOR = 0xd8432f;

/** The arena wheel: gains in green, losses in red, alternating. */
const ARENA_SLICES: readonly WheelSlice[] = ARENA_OUTCOMES.map((n) => ({
    text: n > 0 ? `+${n}` : `${n}`,
    color: n > 0 ? 0x3f9a62 : 0x5a1c1c,
    textColor: n > 0 ? 0x0c1a10 : 0xff9a8a,
}));

interface ZoneSprites {
    ring: GameObjects.Graphics;
    ringKey: string;
    dial: GameObjects.Graphics;
    dialText: GameObjects.BitmapText;
    dialKey: string;
    panel: GameObjects.Graphics;
    lines: GameObjects.BitmapText[];
    panelKey: string;
    gate: GameObjects.Image;
    wheel: GameObjects.Container;
    holder: GameObjects.Container;
    spinFrom: number;
    spinTo: number;
    spinMatch: number;
}

export class ArenaView
{
    private readonly zones: ZoneSprites[];
    private readonly banner: GameObjects.BitmapText;
    private readonly bannerBack: GameObjects.Graphics;
    private bannerKey = '';

    constructor (scene: Scene, arena: ArenaStatus, private readonly settings: ArenaSettings)
    {
        this.zones = arena.site.zones.map((z) => ({
            ring: scene.add.graphics().setDepth(RING_DEPTH),
            ringKey: '',
            dial: scene.add.graphics().setDepth(WHEEL_DEPTH).setVisible(false),
            dialText: scene.add.bitmapText(z.x, z.y, PIXEL_FONT, '').setOrigin(0.5, 0.5).setDepth(WHEEL_DEPTH + 1).setVisible(false),
            dialKey: '',
            panel: scene.add.graphics().setDepth(PANEL_DEPTH),
            lines: [0, 1, 2].map(() => scene.add.bitmapText(0, 0, PIXEL_FONT, '').setOrigin(0.5, 0).setDepth(PANEL_DEPTH + 1)),
            panelKey: '',
            gate: scene.add.image(z.gate.x, z.gate.y + 15, ArenaTex.Gate).setOrigin(0.5, 1).setDepth(z.gate.y + 15),
            ...buildWheelHolder(scene, z.wheel.x, z.wheel.y, ARENA_SLICES),
            spinFrom: 0,
            spinTo: 0,
            spinMatch: -1,
        }));
        const c = arena.site.center;
        this.bannerBack = scene.add.graphics().setDepth(PANEL_DEPTH);
        this.banner = scene.add.bitmapText(c.x, c.y - arena.site.radius * 0.35, PIXEL_FONT, '').setOrigin(0.5, 0.5).setScale(2).setDepth(PANEL_DEPTH + 1);
    }

    /** Call once per frame. */
    sync (a: ArenaStatus, time: number, view: { x: number; y: number; right: number; bottom: number }): void
    {
        const { site } = a;
        const reach = site.radius + 260;
        const onScreen = site.center.x + reach > view.x && site.center.x - reach < view.right && site.center.y + reach > view.y && site.center.y - reach < view.bottom;
        this.banner.setVisible(onScreen);
        this.bannerBack.setVisible(onScreen);
        this.zones.forEach((s, i) => {
            for (const o of [s.ring, s.panel, s.gate, ...s.lines]) o.setVisible(onScreen);
            if (!onScreen) { s.holder.setVisible(false); s.dial.setVisible(false); s.dialText.setVisible(false); return; }
            const zone = a.zones[i];
            this.drawRing(a, i, zone, s, time);
            this.drawDial(a, i, zone, s, time);
            this.drawPanel(a, i, zone, s);
            this.turnWheel(a, zone, s);
            const open = a.phase === 'fight' || a.phase === 'victory';
            s.gate.setTexture(open ? ArenaTex.GateOpen : ArenaTex.Gate);
        });
        if (onScreen) this.drawBanner(a);
    }

    private drawRing (a: ArenaStatus, i: number, z: ArenaZone, s: ZoneSprites, time: number): void
    {
        const site = a.site.zones[i];
        const dots = Math.max(24, Math.round((Math.PI * 2 * site.radius) / DOT_SPACING));
        const open = a.phase === 'open';
        const flash = open && z.contested && Math.floor(time / FLASH_MS) % 2 === 0;
        let base = open ? ZONE_COLOR : MUTED_COLOR;
        let fill = base;
        let filled = 0;
        if (z.holder)
        {
            fill = hexToInt(colorsOf(z.holder).main);
            filled = z.qualified || !open ? dots : Math.floor((z.heldMs / this.settings.qualifyMs) * dots);
        }
        if (flash) base = CONTESTED_COLOR;
        const key = `${base}|${fill}|${filled}|${a.phase}`;
        if (key === s.ringKey) return;
        s.ringKey = key;
        const g = s.ring;
        g.clear();
        if (z.holder) { g.fillStyle(fill, 0.06); g.fillCircle(site.x, site.y, site.radius); }
        for (let k = 0; k < dots; k++)
        {
            const ang = -Math.PI / 2 + (k / dots) * Math.PI * 2;
            const px = Math.round(site.x + Math.cos(ang) * site.radius - DOT_SIZE / 2);
            const py = Math.round(site.y + Math.sin(ang) * site.radius - DOT_SIZE / 2);
            const isFilled = k < filled;
            let color = isFilled ? fill : base;
            let alpha = isFilled ? 0.95 : 0.55;
            if (!isFilled && open && !z.holder && !flash && k % 4 === 0) { color = ZONE_ACCENT; alpha = 0.75; }
            g.fillStyle(0x000000, alpha * 0.5);
            g.fillRect(px + 1, py + 1, DOT_SIZE, DOT_SIZE);
            g.fillStyle(color, alpha);
            g.fillRect(px, py, DOT_SIZE, DOT_SIZE);
        }
    }

    /** Seconds left to qualify (a filling dial), or the big 3-2-1 of the countdown. */
    private drawDial (a: ArenaStatus, i: number, z: ArenaZone, s: ZoneSprites, time: number): void
    {
        const site = a.site.zones[i];
        const holding = a.phase === 'open' && z.holder !== null && !z.qualified;
        const counting = a.phase === 'countdown';
        const show = holding || counting;
        s.dial.setVisible(show);
        s.dialText.setVisible(show);
        if (!show) { s.dialKey = ''; return; }
        const x = site.x;
        const y = site.y - site.radius - 18;
        if (counting)
        {
            const n = Math.max(1, Math.ceil((this.settings.countdownMs - a.phaseMs) / 1000));
            const key = `c${n}`;
            if (key === s.dialKey) return;
            s.dialKey = key;
            s.dial.clear();
            s.dial.fillStyle(0x0d0f0c, 0.85);
            s.dial.fillCircle(x, y, DIAL_RADIUS + 6);
            s.dial.lineStyle(2, NAME_COLOR, 1);
            s.dial.strokeCircle(x, y, DIAL_RADIUS + 5);
            s.dialText.setText(`${n}`).setScale(2).setTint(0xffffff).setPosition(x, y);
            return;
        }
        const left = Math.max(0, Math.ceil((this.settings.qualifyMs - z.heldMs) / 1000));
        const steps = 40;
        const filled = Math.floor((z.heldMs / this.settings.qualifyMs) * steps);
        const flashOn = z.contested && Math.floor(time / FLASH_MS) % 2 === 0;
        const color = z.contested ? CONTESTED_COLOR : hexToInt(colorsOf(z.holder!).main);
        const key = `${filled}|${left}|${color}|${flashOn}`;
        if (key === s.dialKey) return;
        s.dialKey = key;
        const g = s.dial;
        g.clear();
        g.fillStyle(0x0d0f0c, 0.85);
        g.fillCircle(x, y, DIAL_RADIUS + 2);
        g.lineStyle(3, 0x3a3428, 1);
        g.beginPath(); g.arc(x, y, DIAL_RADIUS - 1, 0, Math.PI * 2); g.strokePath();
        if (filled > 0)
        {
            g.lineStyle(3, color, flashOn ? 0.5 : 1);
            g.beginPath(); g.arc(x, y, DIAL_RADIUS - 1, -Math.PI / 2, -Math.PI / 2 + (filled / steps) * Math.PI * 2); g.strokePath();
        }
        s.dialText.setText(`${left}`).setScale(1).setTint(z.contested ? CONTESTED_COLOR : TEXT_COLOR).setPosition(x, y);
    }

    private drawPanel (a: ArenaStatus, i: number, z: ArenaZone, s: ZoneSprites): void
    {
        const site = a.site.zones[i];
        const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));
        let line2 = '';
        let color2 = TEXT_COLOR;
        let line3 = '';
        let color3 = TEXT_COLOR;
        const name = z.holder?.name ?? '';
        const holderColor = z.holder ? hexToInt(colorsOf(z.holder).main) : TEXT_COLOR;
        switch (a.phase)
        {
            case 'open':
                if (!z.holder) { line2 = z.contested ? 'CONTESTED' : 'ENTRY ZONE OPEN'; color2 = z.contested ? CONTESTED_COLOR : ZONE_COLOR; line3 = `HOLD ${secs(this.settings.qualifyMs)}S TO ENTER`; }
                else if (z.qualified) { line2 = `${name} READY`; color2 = holderColor; line3 = 'WAITING FOR A CHALLENGER'; }
                else { line2 = name; color2 = holderColor; line3 = z.contested ? 'CONTESTED - PAUSED' : `QUALIFY IN ${secs(this.settings.qualifyMs - z.heldMs)}S`; color3 = z.contested ? CONTESTED_COLOR : TEXT_COLOR; }
                break;
            case 'countdown': line2 = name; color2 = holderColor; line3 = 'GET READY...'; break;
            case 'spinning':
            {
                line2 = name; color2 = holderColor;
                const landed = a.phaseMs >= this.settings.spinMs;
                const n = z.outcome !== null ? ARENA_OUTCOMES[z.outcome] : 0;
                line3 = landed ? (n > 0 ? `+${n} SOLDIERS` : `${n} SOLDIERS`) : 'SPINNING...';
                color3 = landed ? (n > 0 ? GAIN_COLOR : LOSS_COLOR) : TEXT_COLOR;
                break;
            }
            case 'fight': line2 = name; color2 = holderColor; line3 = 'FIGHTING!'; color3 = CONTESTED_COLOR; break;
            case 'victory': line2 = name; color2 = holderColor; line3 = z.holder && z.holder === a.winner ? 'WINNER!' : 'DEFEATED'; color3 = z.holder === a.winner ? GAIN_COLOR : LOSS_COLOR; break;
            case 'cooldown': line2 = 'ARENA RESTING'; color2 = MUTED_COLOR + 0x303030; line3 = `OPENS IN ${secs(this.settings.cooldownMs - a.phaseMs)}S`; break;
        }
        const key = `${line2}|${color2}|${line3}|${color3}`;
        if (key === s.panelKey) return;
        s.panelKey = key;
        const [l1, l2, l3] = s.lines;
        const top = site.y + site.radius + 8;
        l1.setText('CRYSTAL ARENA').setTint(NAME_COLOR).setPosition(site.x, top + 3);
        l2.setText(line2).setTint(color2).setPosition(site.x, top + 13);
        l3.setText(line3).setTint(color3).setPosition(site.x, top + 23);
        const width = Math.max(l1.width, l2.width, l3.width) + 10;
        const g = s.panel;
        g.clear();
        g.fillStyle(0x0d0f0c, 0.72);
        g.fillRect(Math.round(site.x - width / 2), top, Math.round(width), 34);
        g.lineStyle(1, z.holder ? holderColor : 0x5a5f88, 0.9);
        g.strokeRect(Math.round(site.x - width / 2) + 0.5, top + 0.5, Math.round(width) - 1, 33);
    }

    /** Each contestant's wheel, fixed beside its zone: shown from the countdown until the gates open. */
    private turnWheel (a: ArenaStatus, z: ArenaZone, s: ZoneSprites): void
    {
        const showing = a.phase === 'countdown' || a.phase === 'spinning';
        s.holder.setVisible(showing);
        if (!showing) return;
        if (a.phase === 'countdown' || z.outcome === null)
        {
            s.wheel.rotation = (a.phaseMs / 1000) * 0.6;
            keepLabelsUpright(s.wheel);
            return;
        }
        if (s.spinMatch !== a.matchId)
        {
            s.spinMatch = a.matchId;
            s.spinFrom = s.wheel.rotation;
            s.spinTo = spinTarget(s.spinFrom, z.outcome, ARENA_OUTCOMES.length, a.matchId * 2 + (z === a.zones[0] ? 0 : 1));
        }
        s.wheel.rotation = spinRotation(s.spinFrom, s.spinTo, a.phaseMs / this.settings.spinMs);
        keepLabelsUpright(s.wheel);
    }

    /** Over the arena: its name, who's fighting, who won. */
    private drawBanner (a: ArenaStatus): void
    {
        const [x, y] = a.zones.map((z) => z.holder?.name ?? '?');
        let text = 'CRYSTAL ARENA';
        let color = NAME_COLOR;
        if (a.phase === 'countdown' || a.phase === 'spinning' || a.phase === 'fight') { text = `${x} VS ${y}`; color = TEXT_COLOR; }
        else if (a.phase === 'victory') { text = a.winner ? `${a.winner.name} WINS!` : 'NO WINNER'; color = a.winner ? hexToInt(colorsOf(a.winner).main) : TEXT_COLOR; }
        const key = `${text}|${color}`;
        if (key === this.bannerKey) return;
        this.bannerKey = key;
        this.banner.setText(text).setTint(color);
        const w = this.banner.width + 12;
        const h = this.banner.height + 6;
        const g = this.bannerBack;
        g.clear();
        g.fillStyle(0x0d0f0c, 0.6);
        g.fillRect(Math.round(this.banner.x - w / 2), Math.round(this.banner.y - h / 2), Math.round(w), Math.round(h));
    }
}

function colorsOf (p: Player): { main: string; dark: string }
{
    return Palette.armies[p.colorId as ArmyColor] ?? Palette.armies.crimson;
}
