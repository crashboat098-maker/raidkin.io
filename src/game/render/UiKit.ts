import { GameObjects, Scene } from 'phaser';
import { hexToInt, Palette } from './Palette';
import { PIXEL_FONT } from './PixelFont';

/**
 * Tiny pixel-art UI helpers shared by the start and defeat screens:
 * a stone-framed panel and a chunky button. Plain rectangles, so the look
 * stays consistent with the HUD and is easy to restyle later.
 */

const FRAME = {
    outer: hexToInt(Palette.outline),
    stone: hexToInt(Palette.stone.mid),
    light: hexToInt(Palette.stone.light),
    rivet: hexToInt(Palette.stone.pale),
    fill: 0x12160f,
};

/** Stone-bordered dark panel with corner rivets. */
export function drawStonePanel (g: GameObjects.Graphics, x: number, y: number, w: number, h: number, fillAlpha = 0.94): void
{
    g.fillStyle(FRAME.outer, 1).fillRect(x - 3, y - 3, w + 6, h + 6);
    g.fillStyle(FRAME.stone, 1).fillRect(x, y, w, h);
    g.fillStyle(FRAME.light, 1).fillRect(x, y, w, 3);
    g.fillStyle(FRAME.outer, 1).fillRect(x + 6, y + 6, w - 12, h - 12);
    g.fillStyle(FRAME.fill, fillAlpha).fillRect(x + 8, y + 8, w - 16, h - 16);
    for (const [rx, ry] of [[x + 2, y + 2], [x + w - 5, y + 2], [x + 2, y + h - 5], [x + w - 5, y + h - 5]])
    {
        g.fillStyle(FRAME.rivet, 1).fillRect(rx, ry, 3, 3);
    }
}

export interface ButtonStyle {
    fill: number;
    fillHover: number;
    edge: number;
    text: number;
}

export const BUTTON_PRIMARY: ButtonStyle = {
    fill: hexToInt(Palette.accent.amber),
    fillHover: hexToInt(Palette.accentPale.amber),
    edge: hexToInt(Palette.flame[0]),
    text: hexToInt(Palette.outline),
};

export const BUTTON_QUIET: ButtonStyle = {
    fill: hexToInt(Palette.stone.dark),
    fillHover: hexToInt(Palette.stone.mid),
    edge: hexToInt(Palette.stone.light),
    text: 0xe8e2d4,
};

/** A chunky pixel button. Click it, or call `press()` (e.g. from the Enter key). */
export class PixelButton
{
    private readonly g: GameObjects.Graphics;
    private readonly label: GameObjects.BitmapText;
    private hovered = false;

    constructor (
        scene: Scene,
        private readonly x: number,
        private readonly y: number,
        private readonly w: number,
        private readonly h: number,
        text: string,
        textScale: number,
        private readonly style: ButtonStyle,
        private readonly onPress: () => void,
    )
    {
        this.g = scene.add.graphics();
        this.label = scene.add.bitmapText(x + w / 2, y + h / 2 + 2, PIXEL_FONT, text)
            .setOrigin(0.5).setScale(textScale).setTint(style.text);

        const zone = scene.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        zone.on('pointerover', () => { this.hovered = true; this.draw(); });
        zone.on('pointerout', () => { this.hovered = false; this.draw(); });
        zone.on('pointerdown', () => this.press());
        this.draw();
    }

    press (): void
    {
        this.onPress();
    }

    private draw (): void
    {
        const { x, y, w, h, style } = this;
        this.g.clear();
        this.g.fillStyle(hexToInt(Palette.outline), 1).fillRect(x - 3, y - 3, w + 6, h + 6);
        this.g.fillStyle(style.edge, 1).fillRect(x, y + h - 5, w, 5);           // bottom edge (3D lip)
        this.g.fillStyle(this.hovered ? style.fillHover : style.fill, 1).fillRect(x, y, w, h - 5);
        this.g.fillStyle(0xffffff, 0.25).fillRect(x, y, w, 3);                  // top highlight
        this.label.setY(y + h / 2 + (this.hovered ? 1 : 2));
    }
}
