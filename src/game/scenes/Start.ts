import { GameObjects, Scene } from 'phaser';
import { GameConfig } from '../config/GameConfig';
import { createRng } from '../logic/Random';
import { NatureTex } from '../render/NatureArt';
import { ARMY_COLORS, hexToInt, Palette, type ArmyColor } from '../render/Palette';
import { ensurePixelFont, PIXEL_FONT } from '../render/PixelFont';
import { createPlaceholderTextures, Tex } from '../render/PlaceholderArt';
import { BUTTON_PRIMARY, drawStonePanel, PixelButton } from '../render/UiKit';
import { netClient } from '../net/NetClient';
import { isNameChar, loadSettings, NAME_MAX_LENGTH, sanitizeName, saveSettings, type PlayerSettings } from './PlayerSettings';

/**
 * The start screen: name your army, pick its colour, and march out.
 * Everything is drawn in the same pixel-art style as the game.
 */

const W = 1280;
const H = 720;
const PANEL = { x: 230, y: 196, w: 820, h: 452 };
const LEFT = PANEL.x + 44;
const INPUT = { x: LEFT, y: 262, w: 440, h: 48 };
const SWATCH = { x: LEFT, y: 370, size: 60, gap: 16 };
const PREVIEW = { x: PANEL.x + PANEL.w - 170, y: 470 };

const TEXT = {
    label: 0x8fa39a,
    value: 0xe8e2d4,
    title: 0xefe6d2,
    dim: 0x9aa79f,
    selected: hexToInt(Palette.accent.amber),
};

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
        this.drawTitle();

        const g = this.add.graphics();
        drawStonePanel(g, PANEL.x, PANEL.y, PANEL.w, PANEL.h);

        // --- Army name ---
        this.label(LEFT, 232, 'ARMY NAME');
        g.fillStyle(hexToInt(Palette.outline), 1).fillRect(INPUT.x - 2, INPUT.y - 2, INPUT.w + 4, INPUT.h + 4);
        g.fillStyle(0x0b0e0a, 1).fillRect(INPUT.x, INPUT.y, INPUT.w, INPUT.h);
        g.fillStyle(hexToInt(Palette.stone.dark), 1).fillRect(INPUT.x, INPUT.y + INPUT.h - 3, INPUT.w, 3);
        this.nameText = this.add.bitmapText(INPUT.x + 14, INPUT.y + 13, PIXEL_FONT, '').setScale(3).setTint(TEXT.value);
        this.counterText = this.add.bitmapText(INPUT.x + INPUT.w, INPUT.y + INPUT.h + 10, PIXEL_FONT, '').setOrigin(1, 0).setScale(2).setTint(TEXT.dim);

        // --- Army colour ---
        this.label(LEFT, 340, 'ARMY COLOUR');
        this.swatchFrames = this.add.graphics();
        ARMY_COLORS.forEach((color, i) => {
            const x = SWATCH.x + i * (SWATCH.size + SWATCH.gap);
            const box = this.add.graphics();
            box.fillStyle(hexToInt(Palette.outline), 1).fillRect(x, SWATCH.y, SWATCH.size, SWATCH.size);
            box.fillStyle(hexToInt(Palette.armies[color].dark), 1).fillRect(x + 3, SWATCH.y + 3, SWATCH.size - 6, SWATCH.size - 6);
            box.fillStyle(hexToInt(Palette.armies[color].main), 1).fillRect(x + 3, SWATCH.y + 3, SWATCH.size - 6, (SWATCH.size - 6) / 2);
            this.add.image(x + SWATCH.size / 2, SWATCH.y + SWATCH.size - 6, Tex.warrior(color)).setOrigin(0.5, 1).setScale(3);
            this.add.zone(x, SWATCH.y, SWATCH.size, SWATCH.size).setOrigin(0, 0)
                .setInteractive({ useHandCursor: true })
                .on('pointerdown', () => this.selectColor(color));
        });
        this.colorNameText = this.add.bitmapText(LEFT, SWATCH.y + SWATCH.size + 16, PIXEL_FONT, '').setScale(2);

        // --- Start ---
        const startButton = new PixelButton(this, LEFT, 522, 440, 70, 'START GAME', 4, BUTTON_PRIMARY, () => this.startGame());

        // Online or practice? (Updated while this screen is open.) A notice from a
        // dropped match shows first, in amber.
        const notice = (data as { notice?: string } | undefined)?.notice ?? null;
        const status = this.add.bitmapText(LEFT + 220, 604, PIXEL_FONT, '').setOrigin(0.5, 0).setScale(2);
        const noticeUntil = this.time.now + 10_000;
        const showStatus = () => {
            if (notice && this.time.now < noticeUntil) { status.setText(notice).setTint(hexToInt(Palette.accent.amber)); return; }
            const lobby = netClient.lobby;
            if (netClient.online && lobby) status.setText(lobby.full ? 'SERVER FULL - PRACTICE VS BOTS' : `ONLINE - ${lobby.playing} PLAYING`).setTint(TEXT.value);
            else if (netClient.configured) status.setText('CONNECTING - OR PRACTICE VS BOTS').setTint(TEXT.dim);
            else status.setText('PRACTICE VS BOTS').setTint(TEXT.dim);
        };
        showStatus();
        this.time.addEvent({ delay: 500, loop: true, callback: showStatus });

        // --- Preview ---
        this.add.image(PREVIEW.x, PREVIEW.y + 6, Tex.Shadow).setScale(5, 3).setAlpha(0.8);
        this.previewBanner = this.add.image(PREVIEW.x - 52, PREVIEW.y + 10, Tex.banner(this.settings.color)).setOrigin(0.15, 1).setScale(5);
        this.previewWarrior = this.add.image(PREVIEW.x + 8, PREVIEW.y + 10, Tex.warrior(this.settings.color)).setOrigin(0.5, 1).setScale(8);
        this.previewName = this.add.bitmapText(PREVIEW.x - 10, PREVIEW.y + 42, PIXEL_FONT, '').setOrigin(0.5, 0).setScale(2);
        this.label(PREVIEW.x - 10, 232, 'PREVIEW', 0.5);

        // --- Hint ---
        this.add.bitmapText(W / 2, H - 40, PIXEL_FONT, "TYPE A NAME  -  < > OR CLICK FOR COLOUR  -  ENTER TO START")
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

        // Highlight the selected swatch.
        const g = this.swatchFrames.clear();
        const i = ARMY_COLORS.indexOf(color);
        const x = SWATCH.x + i * (SWATCH.size + SWATCH.gap);
        g.lineStyle(4, TEXT.selected, 1).strokeRect(x - 5, SWATCH.y - 5, SWATCH.size + 10, SWATCH.size + 10);
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
        const scale = 9;
        const charWidth = 7 * scale;
        const left = W / 2 - (10 * charWidth) / 2;
        this.add.bitmapText(left, 44, PIXEL_FONT, 'RAIDKIN').setScale(scale).setTint(TEXT.title);
        this.add.bitmapText(left + 7 * charWidth, 44, PIXEL_FONT, '.IO').setScale(scale).setTint(hexToInt(Palette.accent.amber));
        this.add.bitmapText(W / 2, 140, PIXEL_FONT, 'RAISE AN ARMY. CRUSH YOUR RIVALS. RULE THE BATTLEFIELD.')
            .setOrigin(0.5, 0).setScale(2).setTint(TEXT.dim);
    }
}
