import { GameObjects, Scene } from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { createRng } from '../logic/Random';
import { NatureTex } from '../render/NatureArt';
import { ARMY_COLORS, hexToInt, Palette, type ArmyColor } from '../render/Palette';
import { ensurePixelFont, PIXEL_FONT } from '../render/PixelFont';
import { createPlaceholderTextures, Tex } from '../render/PlaceholderArt';
import { BUTTON_PRIMARY, PixelButton } from '../render/UiKit';
import { netClient } from '../net/NetClient';
import { isNameChar, loadSettings, NAME_MAX_LENGTH, sanitizeName, saveSettings, type PlayerSettings } from './PlayerSettings';

/**
 * The start screen: name your army, pick its colour, and march out.
 * Everything is drawn in the same pixel-art style as the game.
 */

const W = 1280;
const H = 720;
/** One centred card holds everything (title, name, colours, play, preview). */
const CARD = { x: 250, y: 22, w: 780, h: 676, radius: 18 };
const LEFT = CARD.x + 44;
const INPUT = { x: LEFT, y: 232, w: 440, h: 52 };
/** Colour swatches: a 4 x 3 grid. */
const SWATCH = { x: LEFT, y: 342, w: 98, h: 46, gapX: 16, gapY: 16, cols: 4 };
const PREVIEW = { x: CARD.x + CARD.w - 150, y: 470 };

const TEXT = {
    label: 0x9fb8a6,
    value: 0x1a2118,
    title: hexToInt('#ffd36a'),
    tagline: 0xe8efe4,
    dim: 0x9aa79f,
    status: hexToInt('#ffd36a'),
};
const CARD_FILL = 0x1d3a26;
const CARD_EDGE = hexToInt('#e0b04a');
const INPUT_FILL = 0xf3fbef;

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
        ensurePixelFont(this);

        // Previous choices (from Play Again / Change Army, or saved in the browser).
        this.settings = data?.name && data.color ? { name: data.name, color: data.color } : loadSettings();
        this.typedName = this.settings.name;

        this.drawBackdrop();

        // --- The card ---
        const g = this.add.graphics();
        g.fillStyle(0x000000, 0.35).fillRoundedRect(CARD.x + 6, CARD.y + 8, CARD.w, CARD.h, CARD.radius); // drop shadow
        g.fillStyle(CARD_FILL, 0.97).fillRoundedRect(CARD.x, CARD.y, CARD.w, CARD.h, CARD.radius);
        g.lineStyle(4, CARD_EDGE, 1).strokeRoundedRect(CARD.x, CARD.y, CARD.w, CARD.h, CARD.radius);
        this.drawTitle();

        // --- Army name ---
        this.label(LEFT, 208, 'ARMY NAME');
        g.fillStyle(INPUT_FILL, 1).fillRoundedRect(INPUT.x, INPUT.y, INPUT.w, INPUT.h, 8);
        g.lineStyle(2, 0x9fb8a6, 1).strokeRoundedRect(INPUT.x, INPUT.y, INPUT.w, INPUT.h, 8);
        this.nameText = this.add.bitmapText(INPUT.x + 16, INPUT.y + 15, PIXEL_FONT, '').setScale(3).setTint(TEXT.value);
        this.counterText = this.add.bitmapText(INPUT.x + INPUT.w, INPUT.y + INPUT.h + 8, PIXEL_FONT, '').setOrigin(1, 0).setScale(2).setTint(TEXT.dim);

        // --- Army colour: flat swatches in a 4 x 3 grid, a check on the chosen one ---
        this.label(LEFT, 318, 'ARMY COLOUR');
        ARMY_COLORS.forEach((color, i) => {
            const { x, y } = swatchAt(i);
            const colors = Palette.armies[color];
            g.fillStyle(hexToInt(colors.dark), 1).fillRoundedRect(x, y, SWATCH.w, SWATCH.h, 7);
            g.fillStyle(hexToInt(colors.main), 1).fillRoundedRect(x, y, SWATCH.w, SWATCH.h - 4, 7);
            this.add.zone(x, y, SWATCH.w, SWATCH.h).setOrigin(0, 0)
                .setInteractive({ useHandCursor: true })
                .on('pointerdown', () => this.selectColor(color));
        });
        this.swatchFrames = this.add.graphics();
        const lastSwatch = swatchAt(ARMY_COLORS.length - 1);
        this.colorNameText = this.add.bitmapText(LEFT, lastSwatch.y + SWATCH.h + 16, PIXEL_FONT, '').setScale(2);

        // --- Play ---
        const startButton = new PixelButton(this, LEFT, 566, INPUT.w, 66, 'PLAY', 4, BUTTON_PRIMARY, () => this.startGame());

        // Online or practice? (Updated while this screen is open.) A notice from a
        // dropped match shows first, in red-orange.
        const notice = (data as { notice?: string } | undefined)?.notice ?? null;
        const status = this.add.bitmapText(W / 2, 170, PIXEL_FONT, '').setOrigin(0.5, 0).setScale(2);
        const noticeUntil = this.time.now + 10_000;
        const showStatus = () => {
            if (notice && this.time.now < noticeUntil) { status.setText(notice).setTint(hexToInt(Palette.flame[0])); return; }
            const lobby = netClient.lobby;
            if (netClient.online && lobby)
            {
                const here = `${lobby.online} ${lobby.online === 1 ? 'PERSON' : 'PEOPLE'} HERE - ${lobby.playing} PLAYING`;
                status.setText(lobby.full ? 'SERVER FULL - PRACTICE VS BOTS' : here).setTint(TEXT.status);
            }
            else if (netClient.configured) status.setText('CONNECTING - OR PRACTICE VS BOTS').setTint(TEXT.dim);
            else status.setText('PRACTICE VS BOTS').setTint(TEXT.status);
        };
        showStatus();
        this.time.addEvent({ delay: 500, loop: true, callback: showStatus });

        // --- Preview ---
        this.add.image(PREVIEW.x, PREVIEW.y + 6, Tex.Shadow).setScale(5, 3).setAlpha(0.8);
        this.previewBanner = this.add.image(PREVIEW.x - 52, PREVIEW.y + 10, Tex.banner(this.settings.color)).setOrigin(0.15, 1).setScale(5);
        this.previewWarrior = this.add.image(PREVIEW.x + 8, PREVIEW.y + 10, Tex.warrior(this.settings.color)).setOrigin(0.5, 1).setScale(8);
        this.previewName = this.add.bitmapText(PREVIEW.x - 10, PREVIEW.y + 42, PIXEL_FONT, '').setOrigin(0.5, 0).setScale(2);
        this.label(PREVIEW.x - 10, 208, 'PREVIEW', 0.5);

        // --- Hint ---
        this.add.bitmapText(W / 2, CARD.y + CARD.h - 40, PIXEL_FONT, 'TYPE A NAME - ARROWS FOR COLOUR - ENTER TO PLAY')
            .setOrigin(0.5, 0).setScale(2).setTint(TEXT.dim);

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
        this.previewName.setText(this.typedName.trim() || 'NAME YOUR ARMY').setTint(this.typedName.trim() ? hexToInt(colors.main) : TEXT.dim);

        // Highlight the selected swatch: a white frame and a check mark.
        const g = this.swatchFrames.clear();
        const { x, y } = swatchAt(ARMY_COLORS.indexOf(color));
        g.lineStyle(4, 0xffffff, 1).strokeRoundedRect(x - 4, y - 4, SWATCH.w + 8, SWATCH.h + 8, 9);
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

    /** Sunny grass with a scattering of trees, bushes and rocks, gently darkened. */
    private drawBackdrop (): void
    {
        this.add.rectangle(0, 0, W, H, hexToInt(Palette.grass[1])).setOrigin(0, 0);
        const rng = createRng(31);
        const g = this.add.graphics();
        for (let i = 0; i < 900; i++)
        {
            g.fillStyle(hexToInt(Palette.grass[rng() < 0.5 ? 0 : 2]), 1).fillRect(Math.floor(rng() * W / 4) * 4, Math.floor(rng() * H / 4) * 4, 4, 4);
        }
        const props = [NatureTex.TallGrass, Tex.Bush, NatureTex.Fern, Tex.Rock, NatureTex.Stump];
        for (let i = 0; i < 70; i++)
        {
            const key = props[Math.floor(rng() * props.length)];
            this.add.image(rng() * W, rng() * H, key).setScale(3).setAlpha(0.9);
        }
        // Tall trees framing the left and right edges.
        for (let i = 0; i < 12; i++)
        {
            const left = i % 2 === 0;
            const key = rng() < 0.5 ? NatureTex.pine(i % 2) : NatureTex.largeTree(i % 2);
            this.add.image(left ? rng() * 170 : W - rng() * 170, 120 + rng() * (H - 80), key).setOrigin(0.5, 1).setScale(4);
        }
        this.add.rectangle(0, 0, W, H, 0x0a0d08, 0.42).setOrigin(0, 0);
    }

    private drawTitle (): void
    {
        this.add.bitmapText(W / 2, CARD.y + 22, PIXEL_FONT, 'RAIDKIN.IO').setOrigin(0.5, 0).setScale(7).setTint(TEXT.title);
        this.add.bitmapText(W / 2, CARD.y + 100, PIXEL_FONT, 'START ALONE. BUILD AN ARMY. CONQUER.')
            .setOrigin(0.5, 0).setScale(2).setTint(TEXT.tagline);
        this.add.bitmapText(W / 2, CARD.y + 122, PIXEL_FONT, `COLLECT SOUL SHARDS - EVERY ${GameConfig.army.recruitCost} RECRUIT A WARRIOR.`)
            .setOrigin(0.5, 0).setScale(2).setTint(TEXT.tagline);
    }
}
