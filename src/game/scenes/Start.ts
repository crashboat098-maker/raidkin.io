import { BlendModes, GameObjects, Scene } from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { createRng } from '../logic/Random';
import { NatureTex } from '../render/NatureArt';
import { ARMY_COLORS, hexToInt, Palette, type ArmyColor } from '../render/Palette';
import { ensurePixelFont, PIXEL_FONT } from '../render/PixelFont';
import { createPlaceholderTextures, Tex } from '../render/PlaceholderArt';
import { CRYSTAL_GLOWS, createTitleTextures, TitleTex, VOLCANO } from '../render/TitleArt';
import { BUTTON_PRIMARY, PixelButton } from '../render/UiKit';
import { netClient } from '../net/NetClient';
import { isNameChar, loadSettings, NAME_MAX_LENGTH, sanitizeName, saveSettings, type PlayerSettings } from './PlayerSettings';

/**
 * The start screen: name your army, pick its colour, and march out.
 *
 * Behind it, the world of RAIDKIN.IO under the aurora: the enchanted forest
 * and its fae castle (left), green woods (middle), the volcano and the
 * gothic fortress (right), glowing crystal fields (bottom left) and the
 * swamp castle among murky pools (bottom right). Everything is the game's
 * own pixel art at 2x; the backdrop is painted once (TitleArt). Gentle
 * looping tweens bring it to life: aurora, stars, crystal glow, torch
 * flicker, lava glow and embers, fireflies, wisps and drifting mist.
 */

const W = 1280;
const H = 720;
/** The ornate panel that holds the menu. */
const PANEL = { x: 330, y: 214, w: 620, h: 430 };
const LEFT = PANEL.x + 36;
const INPUT = { x: LEFT, y: PANEL.y + 56, w: 390, h: 50 };
/** Colour swatches: a 4 x 3 grid. */
const SWATCH = { x: LEFT, y: PANEL.y + 152, w: 88, h: 40, gapX: 12, gapY: 12, cols: 4 };
const PLAY = { x: LEFT, y: PANEL.y + 346, w: 390, h: 60 };
const PREVIEW = { x: PANEL.x + PANEL.w - 98, y: PANEL.y + 262 };

const TEXT = {
    label: 0xb8a6e8,
    value: 0xf2ecff,
    title: hexToInt('#ffd36a'),
    tagline: 0xdcd2f0,
    dim: 0x8c86a8,
    status: hexToInt('#ffd36a'),
};
const GOLD = 0xd8aa4a;
const GOLD_LIGHT = 0xffe19a;
const VIOLET = 0x7a5cc8;
const PANEL_FILL = 0x0b0a18;
const INPUT_FILL = 0x15122a;

/** Top-left corner of colour swatch `i`. */
function swatchAt (i: number): { x: number; y: number }
{
    const col = i % SWATCH.cols;
    const row = Math.floor(i / SWATCH.cols);
    return { x: SWATCH.x + col * (SWATCH.w + SWATCH.gapX), y: SWATCH.y + row * (SWATCH.h + SWATCH.gapY) };
}

/** Light colours get a dark check mark, dark ones a white one. */
function isLight (hex: string): boolean
{
    const n = hexToInt(hex);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

export class Start extends Scene
{
    private settings: PlayerSettings;
    private nameText: GameObjects.BitmapText;
    private counterText: GameObjects.BitmapText;
    private colorNameText: GameObjects.BitmapText;
    private previewName: GameObjects.BitmapText;
    private previewWarrior: GameObjects.Image;
    private previewBanner: GameObjects.Image;
    private previewGlow: GameObjects.Image;
    private swatchFrames: GameObjects.Graphics;
    private cursorVisible = true;
    private typedName = '';

    constructor ()
    {
        super('Start');
    }

    create (data?: Partial<PlayerSettings>)
    {
        createPlaceholderTextures(this, GameConfig.world.tileSize);
        createTitleTextures(this);
        ensurePixelFont(this);

        // Previous choices (from Play Again / Change Army, or saved in the browser).
        this.settings = data?.name && data.color ? { name: data.name, color: data.color } : loadSettings();
        this.typedName = this.settings.name;

        this.drawWorld();
        this.drawLogo();

        // --- The panel ---
        const g = this.add.graphics();
        drawOrnatePanel(g, PANEL.x, PANEL.y, PANEL.w, PANEL.h);

        // --- Army name ---
        this.label(LEFT, PANEL.y + 32, 'ARMY NAME');
        g.fillStyle(0x000000, 0.5).fillRect(INPUT.x + 3, INPUT.y + 4, INPUT.w, INPUT.h);
        g.fillStyle(INPUT_FILL, 1).fillRect(INPUT.x, INPUT.y, INPUT.w, INPUT.h);
        g.lineStyle(2, VIOLET, 1).strokeRect(INPUT.x, INPUT.y, INPUT.w, INPUT.h);
        g.lineStyle(1, GOLD, 0.6).strokeRect(INPUT.x + 4, INPUT.y + 4, INPUT.w - 8, INPUT.h - 8);
        this.nameText = this.add.bitmapText(INPUT.x + 16, INPUT.y + 15, PIXEL_FONT, '').setScale(3).setTint(TEXT.value);
        this.counterText = this.add.bitmapText(INPUT.x + INPUT.w, INPUT.y + INPUT.h + 8, PIXEL_FONT, '').setOrigin(1, 0).setScale(2).setTint(TEXT.dim);

        // --- Army colour: swatches in a 4 x 3 grid, a check on the chosen one ---
        this.label(LEFT, SWATCH.y - 24, 'ARMY COLOUR');
        ARMY_COLORS.forEach((color, i) => {
            const { x, y } = swatchAt(i);
            const colors = Palette.armies[color];
            g.fillStyle(0x000000, 0.6).fillRect(x - 2, y - 2, SWATCH.w + 4, SWATCH.h + 4);
            g.fillStyle(hexToInt(colors.dark), 1).fillRect(x, y, SWATCH.w, SWATCH.h);
            g.fillStyle(hexToInt(colors.main), 1).fillRect(x, y, SWATCH.w, SWATCH.h - 5);
            g.fillStyle(0xffffff, 0.18).fillRect(x, y, SWATCH.w, 3);
            this.add.zone(x, y, SWATCH.w, SWATCH.h).setOrigin(0, 0)
                .setInteractive({ useHandCursor: true })
                .on('pointerdown', () => this.selectColor(color));
        });
        this.swatchFrames = this.add.graphics();
        const lastSwatch = swatchAt(ARMY_COLORS.length - 1);
        this.colorNameText = this.add.bitmapText(LEFT, lastSwatch.y + SWATCH.h + 12, PIXEL_FONT, '').setScale(2);

        // --- Play ---
        g.fillStyle(0x000000, 0.5).fillRect(PLAY.x + 4, PLAY.y + 6, PLAY.w, PLAY.h);
        const startButton = new PixelButton(this, PLAY.x, PLAY.y, PLAY.w, PLAY.h, 'PLAY', 4, BUTTON_PRIMARY, () => this.startGame());

        // Online or practice? (Updated while this screen is open.) A notice from a
        // dropped match shows first, in red-orange.
        const notice = (data as { notice?: string } | undefined)?.notice ?? null;
        const statusBack = this.add.graphics();
        const status = this.add.bitmapText(W / 2, PANEL.y - 24, PIXEL_FONT, '').setOrigin(0.5, 0).setScale(2);
        const noticeUntil = this.time.now + 10_000;
        const showStatus = () => {
            if (notice && this.time.now < noticeUntil) status.setText(notice).setTint(hexToInt(Palette.flame[0]));
            else
            {
                const lobby = netClient.lobby;
                if (netClient.online && lobby)
                {
                    const here = `${lobby.online} ${lobby.online === 1 ? 'PERSON' : 'PEOPLE'} HERE - ${lobby.playing} PLAYING`;
                    status.setText(lobby.full ? 'SERVER FULL - PRACTICE VS BOTS' : here).setTint(TEXT.status);
                }
                else if (netClient.configured) status.setText('CONNECTING - OR PRACTICE VS BOTS').setTint(TEXT.dim);
                else status.setText('PRACTICE VS BOTS').setTint(TEXT.status);
            }
            const w = status.width + 36;
            statusBack.clear().fillStyle(PANEL_FILL, 0.72).fillRect(W / 2 - w / 2, PANEL.y - 30, w, 26);
            diamond(statusBack, W / 2 - w / 2 + 10, PANEL.y - 17, 4, 0x8dffb5);
            diamond(statusBack, W / 2 + w / 2 - 10, PANEL.y - 17, 4, 0x8dffb5);
        };
        showStatus();
        this.time.addEvent({ delay: 500, loop: true, callback: showStatus });

        // --- Preview: your warrior and banner on a crystal-lit pedestal ---
        this.label(PREVIEW.x, PANEL.y + 32, 'PREVIEW', 0.5);
        const pg = this.add.graphics();
        pg.fillStyle(0x000000, 0.5).fillEllipse(PREVIEW.x + 3, PREVIEW.y + 14, 150, 34);
        pg.fillStyle(0x2a2a48, 1).fillEllipse(PREVIEW.x, PREVIEW.y + 10, 144, 30);
        pg.fillStyle(0x3c3c64, 1).fillEllipse(PREVIEW.x, PREVIEW.y + 6, 144, 26);
        pg.lineStyle(2, GOLD, 0.8).strokeEllipse(PREVIEW.x, PREVIEW.y + 6, 144, 26);
        this.previewGlow = this.add.image(PREVIEW.x, PREVIEW.y - 40, Tex.Glow).setBlendMode(BlendModes.ADD).setScale(2.4).setAlpha(0.35);
        this.tweens.add({ targets: this.previewGlow, alpha: { from: 0.25, to: 0.45 }, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.add.image(PREVIEW.x, PREVIEW.y + 6, Tex.Shadow).setScale(5, 3).setAlpha(0.8);
        this.previewBanner = this.add.image(PREVIEW.x - 52, PREVIEW.y + 8, Tex.banner(this.settings.color)).setOrigin(0.15, 1).setScale(5);
        this.previewWarrior = this.add.image(PREVIEW.x + 8, PREVIEW.y + 8, Tex.warrior(this.settings.color)).setOrigin(0.5, 1).setScale(8);
        this.previewName = this.add.bitmapText(PREVIEW.x, PREVIEW.y + 34, PIXEL_FONT, '').setOrigin(0.5, 0).setScale(2);

        // --- Hint ---
        const hint = this.add.bitmapText(W / 2, H - 38, PIXEL_FONT, 'TYPE A NAME - ARROWS FOR COLOUR - ENTER TO PLAY').setOrigin(0.5, 0).setScale(2).setTint(TEXT.dim);
        this.add.graphics().fillStyle(PANEL_FILL, 0.6).fillRect(W / 2 - hint.width / 2 - 14, H - 44, hint.width + 28, 26);
        hint.setDepth(1);

        // Keyboard: type the name, arrows for colour, Enter to start.
        this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Enter') { startButton.press(); return; }
            if (event.key === 'ArrowLeft') { this.cycleColor(-1); return; }
            if (event.key === 'ArrowRight') { this.cycleColor(1); return; }
            if (event.key === 'Backspace') { this.typedName = this.typedName.slice(0, -1); this.refresh(); return; }
            if (event.key.length === 1 && isNameChar(event.key) && this.typedName.length < NAME_MAX_LENGTH)
            {
                // No leading or double spaces.
                if (event.key === ' ' && (this.typedName.length === 0 || this.typedName.endsWith(' '))) return;
                this.typedName += event.key.toUpperCase();
                this.refresh();
            }
        });

        // Blinking text cursor.
        this.time.addEvent({ delay: 450, loop: true, callback: () => { this.cursorVisible = !this.cursorVisible; this.refresh(); } });

        this.refresh();
    }

    private selectColor (color: ArmyColor): void
    {
        this.settings.color = color;
        this.refresh();
        this.tweens.add({ targets: this.previewWarrior, scale: 8.6, duration: 90, yoyo: true });
    }

    private cycleColor (step: number): void
    {
        const i = ARMY_COLORS.indexOf(this.settings.color);
        this.selectColor(ARMY_COLORS[(i + step + ARMY_COLORS.length) % ARMY_COLORS.length]);
    }

    private startGame (): void
    {
        this.settings.name = sanitizeName(this.typedName);
        saveSettings(this.settings);
        this.scene.start('Battlefield', { ...this.settings });
    }

    private refresh (): void
    {
        const { color } = this.settings;
        const colors = Palette.armies[color];
        this.nameText.setText(this.typedName + (this.cursorVisible && this.typedName.length < NAME_MAX_LENGTH ? '_' : ''));
        this.counterText.setText(`${this.typedName.length}/${NAME_MAX_LENGTH}`);
        this.colorNameText.setText(colors.name).setTint(hexToInt(colors.main));
        this.previewWarrior.setTexture(Tex.warrior(color));
        this.previewBanner.setTexture(Tex.banner(color));
        this.previewGlow.setTint(hexToInt(colors.main));
        this.previewName.setText(this.typedName.trim() || 'NAME YOUR ARMY').setTint(this.typedName.trim() ? hexToInt(colors.main) : TEXT.dim);

        // Highlight the selected swatch: a white frame and a check mark.
        const g = this.swatchFrames.clear();
        const { x, y } = swatchAt(ARMY_COLORS.indexOf(color));
        g.lineStyle(2, 0x000000, 1).strokeRect(x - 5, y - 5, SWATCH.w + 10, SWATCH.h + 10);
        g.lineStyle(3, 0xffffff, 1).strokeRect(x - 3, y - 3, SWATCH.w + 6, SWATCH.h + 6);
        const cx = x + SWATCH.w / 2;
        const cy = y + SWATCH.h / 2 - 2;
        g.lineStyle(5, isLight(colors.main) ? 0x1a2118 : 0xffffff, 1);
        g.beginPath();
        g.moveTo(cx - 11, cy);
        g.lineTo(cx - 3, cy + 8);
        g.lineTo(cx + 12, cy - 8);
        g.strokePath();
    }

    private label (x: number, y: number, text: string, originX = 0): void
    {
        this.add.bitmapText(x, y, PIXEL_FONT, text).setOrigin(originX, 0).setScale(2).setTint(TEXT.label);
    }

    // -----------------------------------------------------------------------
    // The world behind the menu
    // -----------------------------------------------------------------------

    private drawWorld (): void
    {
        const rng = createRng(0x5ea7);
        const r = (min: number, max: number) => min + rng() * (max - min);
        const pulse = (target: GameObjects.Image, min: number, max: number, duration: number) =>
            this.tweens.add({ targets: target, alpha: { from: min, to: max }, duration: duration * r(0.8, 1.3), delay: r(0, duration), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const glow = (x: number, y: number, color: number, scale: number, min = 0.2, max = 0.5, duration = 1600) => {
            const img = this.add.image(x, y, Tex.Glow).setTint(color).setBlendMode(BlendModes.ADD).setScale(scale).setAlpha(min);
            pulse(img, min, max, duration);
            return img;
        };
        const sprite = (key: string, x: number, y: number, scale: number, tint?: number, flip = false) => {
            const img = this.add.image(Math.round(x), Math.round(y), key).setOrigin(0.5, 1).setScale(scale).setFlipX(flip);
            if (tint !== undefined) img.setTint(tint);
            return img;
        };

        // Sky, mountains, volcano and the five lands (painted once), and the drifting aurora.
        this.add.image(0, 0, TitleTex.Backdrop).setOrigin(0, 0).setScale(2);
        const aurora = this.add.image(0, 0, TitleTex.Aurora).setOrigin(0, 0).setScale(2).setBlendMode(BlendModes.ADD).setAlpha(0.6);
        this.tweens.add({ targets: aurora, alpha: { from: 0.45, to: 0.85 }, duration: 5200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: aurora, x: { from: -18, to: 18 }, duration: 14000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        // Twinkling stars and the moon's halo.
        for (let i = 0; i < 26; i++)
        {
            const star = this.add.image(Math.round(r(0, W)), Math.round(r(0, 300)), Tex.Firefly).setScale(2).setTint(0xdce4ff).setAlpha(0);
            this.tweens.add({ targets: star, alpha: { from: 0, to: 0.9 }, duration: r(900, 2000), delay: r(0, 4000), yoyo: true, repeat: -1, repeatDelay: r(800, 3000) });
        }
        glow(192, 80, 0x9a7aff, 3.4, 0.18, 0.3, 4000);

        // The volcano's crater glow and its lava streams.
        const crater = { x: VOLCANO.x * 2, y: VOLCANO.top * 2 + 8 };
        glow(crater.x, crater.y, 0xff6a2a, 2.6, 0.35, 0.7, 900);
        for (let k = 0; k < 4; k++) glow(crater.x + r(-40, 40), crater.y + 60 + k * 50, 0xff7a2a, 1.1, 0.12, 0.35, 1200);

        // --- Left: the enchanted forest and the fae castle ---
        glow(225, 420, 0x8f72c9, 5, 0.12, 0.22, 3000);
        sprite('structure-faeCastle', 225, 552, 1.45, 0xd8d0ff);
        sprite(NatureTex.moonTree(0), 72, 604, 2.2);
        sprite(NatureTex.spiralTree(1), 378, 586, 1.8);
        sprite(NatureTex.moonTree(1), 20, 520, 1.6, 0x9c94c8);
        for (const [x, y, v] of [[120, 600, 0], [300, 596, 1], [168, 612, 2], [352, 610, 0]] as const)
        {
            sprite(NatureTex.glowFlower(v), x, y, 2);
            glow(x, y - 6, 0xc08bff, 0.45, 0.25, 0.55, 1400);
        }
        for (const [x, y] of [[96, 560], [345, 556]] as const)
        {
            sprite(NatureTex.Lantern, x, y, 2);
            glow(x, y - 26, hexToInt(Palette.accent.amber), 0.7, 0.35, 0.6, 300);
        }

        // --- Middle: the green woods ---
        for (const [x, y, s, v] of [[420, 640, 2.2, 0], [470, 676, 2.4, 1], [845, 664, 2.3, 0], [905, 640, 2.0, 1], [560, 704, 2.4, 1], [740, 712, 2.6, 0]] as const)
        {
            sprite(v ? NatureTex.pine(v) : NatureTex.largeTree(v), x, y, s, 0xb8c8c0, x > 640);
        }

        // --- Right: the volcanic wastes and the gothic fortress ---
        sprite('structure-darkSpire', 930, 548, 1.3, 0xc8b8c8);
        sprite('structure-gothicFortress', 1092, 548, 1.3, 0xe0d0d8);
        sprite('structure-darkSpire', 1254, 566, 1.15, 0xb8a8b8);
        sprite(NatureTex.charredTree(0), 968, 600, 2);
        sprite(NatureTex.charredTree(1), 1230, 608, 2, undefined, true);
        for (const [x, y] of [[1012, 586], [1176, 590]] as const) glow(x, y, 0xff7a2a, 0.8, 0.2, 0.45, 700);

        // --- Bottom right: the swamp ---
        glow(1060, 680, 0x7dffa8, 4, 0.08, 0.16, 3500);
        sprite('structure-swampCastle', 1160, 718, 1.05, 0xc8d8c0);
        sprite(NatureTex.swampTree(0), 990, 722, 2.2);
        sprite(NatureTex.swampTree(1), 1276, 700, 2.1, undefined, true);
        for (const [x, y, v] of [[920, 704, 0], [1050, 712, 1], [1240, 716, 0]] as const)
        {
            sprite(NatureTex.glowPlant(v), x, y, 2);
            glow(x, y - 8, 0xa8ff7a, 0.5, 0.25, 0.55, 1500);
        }
        sprite(NatureTex.swampShroom(0), 950, 716, 2);

        // --- Bottom left: the crystal fields ---
        glow(170, 690, 0x7fd4ff, 4.5, 0.12, 0.22, 2600);
        for (const [x, y, s, v] of [[150, 660, 1.4, 4], [262, 704, 1.8, 1], [40, 724, 2.6, 0], [120, 704, 2.0, 5], [196, 722, 2.4, 2], [325, 716, 1.5, 3]] as const)
        {
            sprite(TitleTex.crystal(v), x, y, s);
            glow(x, y - 44 * s * 0.5, hexToInt(CRYSTAL_GLOWS[v % 3]), 1.1 * s, 0.22, 0.55, 1800);
        }

        // --- Torches flanking the menu ---
        for (const x of [PANEL.x - 34, PANEL.x + PANEL.w + 34])
        {
            const base = 642;
            sprite(Tex.Pillar, x, base, 3);
            const top = base - 23 * 3;
            const light = glow(x, top - 12, 0xff9a3a, 1.5, 0.5, 0.75, 180);
            const flame = this.add.image(x, top + 4, Tex.flame(0)).setOrigin(0.5, 1).setScale(3);
            let frame = 0;
            this.time.addEvent({
                delay: 110, loop: true, callback: () => {
                    frame = (frame + 1 + Math.floor(rng() * 2)) % 3;
                    flame.setTexture(Tex.flame(frame));
                    light.setScale(1.4 + rng() * 0.25);
                },
            });
        }

        // --- Drifting life ---
        // Mist: violet over the enchanted forest, blue over the crystals, green over the swamp.
        for (const [x, y, sx, color, alpha] of [[220, 560, 3, 0xb07aff, 0.22], [180, 700, 2.6, 0x7fd4ff, 0.2], [1080, 700, 3.2, 0x8dffb5, 0.2], [640, 540, 4, 0x9ad8c8, 0.12]] as const)
        {
            const mist = this.add.image(x, y, TitleTex.Mist).setScale(sx, 2).setTint(color).setAlpha(alpha);
            this.tweens.add({ targets: mist, x: x + r(30, 60), duration: r(9000, 14000), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
        // Embers rising from the volcano and the fortress.
        const emberColors = [0xff8a2a, 0xffd27a, 0xff5a2a];
        for (let i = 0; i < 44; i++)
        {
            const x = r(940, 1260);
            const y = r(200, 600);
            const ember = this.add.image(x, y, Tex.Firefly).setTint(emberColors[i % 3]).setBlendMode(BlendModes.ADD).setScale(r(1.5, 2.5)).setAlpha(0);
            this.tweens.add({ targets: ember, y: y - r(120, 240), x: x + r(-40, 40), alpha: { from: 1, to: 0 }, duration: r(2500, 5000), delay: r(0, 5000), repeat: -1 });
        }
        // Fireflies and magic motes in the enchanted forest.
        const fae = [0xe9ff9a, 0xc08bff, 0x7dffa8, 0xffd36a];
        for (let i = 0; i < 34; i++) this.mote(r(20, 420), r(340, 640), fae[i % 4], r);
        // Sparkles around the crystals, and wisps over the swamp.
        for (let i = 0; i < 20; i++) this.mote(r(20, 360), r(560, 710), hexToInt(CRYSTAL_GLOWS[i % 3]), r);
        for (let i = 0; i < 8; i++)
        {
            const x = r(900, 1260);
            const y = r(600, 700);
            const wisp = this.add.image(x, y, Tex.wisp('green')).setScale(2).setAlpha(0.7);
            this.tweens.add({ targets: wisp, x: x + r(-50, 50), y: y + r(-30, 10), alpha: { from: 0.2, to: 0.85 }, duration: r(2600, 4200), yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: r(0, 2000) });
        }

        // Dark trees framing the edges, and a vignette pulling the eye to the middle.
        sprite(NatureTex.pine(0), -18, 744, 5, 0x05060c);
        sprite(NatureTex.pine(1), 1300, 744, 5, 0x05060c, true);
        this.add.image(W / 2, H / 2, Tex.Vignette).setDisplaySize(W, H).setAlpha(0.85);
    }

    /** A drifting, blinking speck of light. */
    private mote (x: number, y: number, color: number, r: (min: number, max: number) => number): void
    {
        const glow = this.add.image(x, y, Tex.Glow).setTint(color).setBlendMode(BlendModes.ADD).setScale(0.22).setAlpha(0);
        const dot = this.add.image(Math.round(x), Math.round(y), Tex.Firefly).setTint(color).setBlendMode(BlendModes.ADD).setScale(2).setAlpha(0);
        const delay = r(0, 4000);
        this.tweens.add({ targets: [glow, dot], x: x + r(-40, 40), y: y + r(-40, 20), duration: r(2600, 5200), delay, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: [glow, dot], alpha: { from: 0, to: 0.9 }, duration: r(700, 1300), delay, yoyo: true, repeat: -1, repeatDelay: r(400, 1600) });
    }

    /**
     * The title: RAIDKIN in gold over crossed swords, .IO in crystal blue-violet,
     * a filigree rule set with the three crystal gems, and the tagline.
     */
    private drawLogo (): void
    {
        const cx = W / 2;
        const top = 34;
        const rng = createRng(0x1060);

        // A violet halo behind it all, breathing slowly; a green and a blue one at the sides.
        const halo = this.add.image(cx, 84, Tex.Glow).setTint(0x8f5fff).setBlendMode(BlendModes.ADD).setScale(10, 2.8).setAlpha(0.3);
        this.tweens.add({ targets: halo, alpha: { from: 0.22, to: 0.4 }, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.add.image(cx - 330, 92, Tex.Glow).setTint(0x5affa8).setBlendMode(BlendModes.ADD).setScale(2.4).setAlpha(0.18);
        this.add.image(cx + 330, 92, Tex.Glow).setTint(0x5ac8ff).setBlendMode(BlendModes.ADD).setScale(2.4).setAlpha(0.18);

        const g = this.add.graphics();

        // The name: a dark outline, a drop shadow, then gold (light at the top, ember at the bottom).
        const main = 'RAIDKIN';
        const io = '.IO';
        const mainScale = 10;
        const ioScale = 7;
        const probeMain = this.add.bitmapText(0, 0, PIXEL_FONT, main).setScale(mainScale).setVisible(false);
        const probeIo = this.add.bitmapText(0, 0, PIXEL_FONT, io).setScale(ioScale).setVisible(false);
        const total = probeMain.width + 8 + probeIo.width;
        const x0 = Math.round(cx - total / 2);
        const ioX = x0 + probeMain.width + 8;
        const ioY = top + (probeMain.height - probeIo.height) - 4;
        probeMain.destroy();
        probeIo.destroy();
        // Crossed swords on either side of the name, each over a gem-lit glow.
        for (const ex of [x0 - 78, x0 + total + 78])
        {
            this.add.image(ex, top + 40, Tex.Glow).setTint(ex < cx ? 0x5affa8 : 0x5ac8ff).setBlendMode(BlendModes.ADD).setScale(1.3).setAlpha(0.35);
            sword(g, ex - 44, top + 100, ex + 40, top - 14);
            sword(g, ex + 44, top + 100, ex - 40, top - 14);
        }
        const layer = (text: string, x: number, y: number, scale: number) => this.add.bitmapText(x, y, PIXEL_FONT, text).setScale(scale);
        layer(main, x0 + 8, top + 10, mainScale).setTint(0x000000).setAlpha(0.55);
        layer(io, ioX + 6, ioY + 8, ioScale).setTint(0x000000).setAlpha(0.55);
        for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-4, -4], [4, -4], [-4, 4], [4, 4]])
        {
            layer(main, x0 + dx, top + dy, mainScale).setTint(0x1a0a24);
            layer(io, ioX + dx, ioY + dy, ioScale).setTint(0x0a1028);
        }
        layer(main, x0, top, mainScale).setTint(0xfff2b8, 0xfff2b8, 0xe0782a, 0xe0782a);
        layer(io, ioX, ioY, ioScale).setTint(0xbff0ff, 0xbff0ff, 0x9a68ff, 0x9a68ff);
        // A glint sweeping across the gold now and then.
        const shine = this.add.image(x0 - 40, top + 36, Tex.Glow).setTint(0xfff8e0).setBlendMode(BlendModes.ADD).setScale(0.9, 2.6).setAlpha(0.55);
        this.tweens.add({ targets: shine, x: x0 + total + 40, duration: 1800, repeat: -1, repeatDelay: 4200, ease: 'Sine.easeInOut' });

        // The filigree rule with three gems (green, blue, violet).
        const ruleY = top + 96;
        const half = total / 2 + 10;
        g.fillStyle(0x000000, 0.6).fillRect(cx - half, ruleY + 2, half * 2, 3);
        g.fillStyle(GOLD, 1).fillRect(cx - half, ruleY, half * 2, 2);
        g.fillStyle(GOLD_LIGHT, 1).fillRect(cx - half + 20, ruleY, half * 2 - 40, 1);
        for (const side of [-1, 1])
        {
            diamond(g, cx + side * half, ruleY + 1, 6, GOLD);
            for (let k = 1; k <= 3; k++) g.fillStyle(GOLD, 1).fillRect(cx + side * (half - 14 - k * 10), ruleY - 3, 2, 8);
        }
        const gems = [0x5affa8, 0x5ac8ff, 0xb07aff];
        gems.forEach((c, i) => {
            const gx = cx + (i - 1) * 26;
            diamond(g, gx, ruleY + 1, 9, 0x1a1020);
            diamond(g, gx, ruleY + 1, 7, c);
            g.fillStyle(0xffffff, 0.8).fillRect(gx - 2, ruleY - 3, 2, 2);
            const spark = this.add.image(gx, ruleY + 1, Tex.Glow).setTint(c).setBlendMode(BlendModes.ADD).setScale(0.5).setAlpha(0.4);
            this.tweens.add({ targets: spark, alpha: { from: 0.2, to: 0.7 }, duration: 1200 + rng() * 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        });

        // The tagline.
        this.add.bitmapText(cx + 2, ruleY + 18, PIXEL_FONT, 'START ALONE. BUILD AN ARMY. CONQUER.').setOrigin(0.5, 0).setScale(2).setTint(0x000000).setAlpha(0.6);
        this.add.bitmapText(cx, ruleY + 16, PIXEL_FONT, 'START ALONE. BUILD AN ARMY. CONQUER.').setOrigin(0.5, 0).setScale(2).setTint(TEXT.tagline);
        this.add.bitmapText(cx, ruleY + 36, PIXEL_FONT, `COLLECT SOUL SHARDS - EVERY ${GameConfig.army.recruitCost} RECRUIT A WARRIOR.`)
            .setOrigin(0.5, 0).setScale(2).setTint(TEXT.dim);
    }
}

/** A small filled diamond (rhombus). */
function diamond (g: GameObjects.Graphics, x: number, y: number, r: number, color: number): void
{
    g.fillStyle(color, 1);
    g.fillTriangle(x - r, y, x, y - r, x + r, y);
    g.fillTriangle(x - r, y, x, y + r, x + r, y);
}

/** A pixel sword from its pommel (x0, y0) to its tip (x1, y1): steel blade, gold guard and grip. */
function sword (g: GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number): void
{
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    const px = -uy;
    const py = ux;
    const block = (t: number, side: number, size: number, color: number) => {
        g.fillStyle(color, 1).fillRect(Math.round(x0 + ux * t + px * side - size / 2), Math.round(y0 + uy * t + py * side - size / 2), size, size);
    };
    for (let t = 0; t < len; t += 3)
    {
        const blade = t > 30;
        const taper = blade ? Math.max(1, 5 * (1 - (t - 30) / (len - 30)) + 1) : 3;
        block(t, 0, 8, 0x0c0a14);
        if (blade)
        {
            block(t, -taper / 2, 4, 0xe8ecf8);
            block(t, taper / 2, 4, 0x8a90a8);
        }
        else block(t, 0, 5, t < 10 ? 0xffd36a : 0x6a3a1a);
    }
    // The cross-guard.
    for (let s = -22; s <= 22; s += 3)
    {
        block(28, s * 0.6, 8, 0x0c0a14);
        block(28, s * 0.6, 5, Math.abs(s) > 18 ? 0xffe19a : GOLD);
    }
    block(4, 0, 9, 0xb07aff);
}

/** The menu panel: deep violet-black glass framed in gold and violet, gems at the corners. */
function drawOrnatePanel (g: GameObjects.Graphics, x: number, y: number, w: number, h: number): void
{
    g.fillStyle(0x000000, 0.45).fillRect(x + 8, y + 10, w, h);
    g.fillStyle(PANEL_FILL, 0.86).fillRect(x, y, w, h);
    // A faint inner glow along the top.
    g.fillStyle(VIOLET, 0.12).fillRect(x + 6, y + 6, w - 12, 18);
    g.lineStyle(4, 0x000000, 1).strokeRect(x - 2, y - 2, w + 4, h + 4);
    g.lineStyle(3, GOLD, 1).strokeRect(x, y, w, h);
    g.lineStyle(1, GOLD_LIGHT, 0.6).strokeRect(x + 2, y + 2, w - 4, h - 4);
    g.lineStyle(1, VIOLET, 0.9).strokeRect(x + 8, y + 8, w - 16, h - 16);
    // Corner pieces: a gold bracket and a gem (green, blue, violet, gold).
    const gems = [0x5affa8, 0x5ac8ff, 0xb07aff, 0xffd36a];
    [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(([cx, cy], i) => {
        const sx = cx === x ? 1 : -1;
        const sy = cy === y ? 1 : -1;
        g.fillStyle(GOLD, 1).fillRect(cx + (sx > 0 ? 0 : -26), cy + (sy > 0 ? -1 : -4), 26, 5);
        g.fillStyle(GOLD, 1).fillRect(cx + (sx > 0 ? -1 : -4), cy + (sy > 0 ? 0 : -26), 5, 26);
        diamond(g, cx, cy, 10, 0x0c0a14);
        diamond(g, cx, cy, 8, GOLD);
        diamond(g, cx, cy, 5, gems[i]);
    });
    // A gem in the middle of the top and bottom edges.
    for (const ey of [y, y + h])
    {
        diamond(g, x + w / 2, ey, 9, 0x0c0a14);
        diamond(g, x + w / 2, ey, 7, GOLD);
        diamond(g, x + w / 2, ey, 4, 0xb07aff);
    }
    // A divider between the form and the preview.
    const dx = x + w - 196;
    g.fillStyle(VIOLET, 0.5).fillRect(dx, y + 30, 1, h - 60);
    diamond(g, dx, y + h / 2, 4, GOLD);
}
