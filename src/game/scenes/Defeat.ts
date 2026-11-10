import { Scene } from 'phaser';
import { hexToInt, Palette } from '../render/Palette';
import { ensurePixelFont, PIXEL_FONT } from '../render/PixelFont';
import { BUTTON_PRIMARY, BUTTON_QUIET, drawStonePanel, PixelButton } from '../render/UiKit';
import type { PlayerSettings } from './PlayerSettings';

/** What the Battlefield passes in when the player's last soldier falls. */
export interface DefeatData {
    settings: PlayerSettings;
    kills: number;
    largestArmy: number;
    shards: number;
    survivalMs: number;
    rank: number;
    competitors: number;
}

const W = 1280;
const H = 720;
const PANEL = { x: 390, y: 120, w: 500, h: 470 };

/**
 * Shown over the (still running) battlefield when the player's army is
 * wiped out. PLAY AGAIN starts a fresh match with the same name and colour.
 */
export class Defeat extends Scene
{
    constructor ()
    {
        super('Defeat');
    }

    create (data: DefeatData)
    {
        ensurePixelFont(this);
        const colors = Palette.armies[data.settings.color];

        // Darken the battlefield behind, fading in.
        const shade = this.add.rectangle(0, 0, W, H, 0x050605, 0.62).setOrigin(0, 0).setAlpha(0);
        this.tweens.add({ targets: shade, alpha: 1, duration: 400 });

        const g = this.add.graphics();
        drawStonePanel(g, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
        const cx = W / 2;

        this.add.bitmapText(cx, PANEL.y + 34, PIXEL_FONT, 'DEFEATED').setOrigin(0.5, 0).setScale(7).setTint(hexToInt(Palette.health.low));
        this.add.bitmapText(cx, PANEL.y + 112, PIXEL_FONT, `${data.settings.name} HAS FALLEN`).setOrigin(0.5, 0).setScale(2).setTint(hexToInt(colors.main));

        // Divider
        g.fillStyle(hexToInt(Palette.stone.dark), 1).fillRect(PANEL.x + 40, PANEL.y + 146, PANEL.w - 80, 2);

        const rows: [string, string][] = [
            ['KILLS', String(data.kills)],
            ['LARGEST ARMY', String(data.largestArmy)],
            ['SHARDS COLLECTED', String(data.shards)],
            ['SURVIVED', formatTime(data.survivalMs)],
            ['FINAL RANK', `#${data.rank} OF ${data.competitors}`],
        ];
        rows.forEach(([label, value], i) => {
            const y = PANEL.y + 168 + i * 34;
            this.add.bitmapText(PANEL.x + 52, y, PIXEL_FONT, label).setScale(2).setTint(0x8fa39a);
            this.add.bitmapText(PANEL.x + PANEL.w - 52, y, PIXEL_FONT, value).setOrigin(1, 0).setScale(2)
                .setTint(i === rows.length - 1 ? hexToInt(Palette.accent.amber) : 0xe8e2d4);
        });

        const playAgain = new PixelButton(this, cx - 170, PANEL.y + 352, 340, 60, 'PLAY AGAIN', 3, BUTTON_PRIMARY, () => this.playAgain(data.settings));
        new PixelButton(this, cx - 110, PANEL.y + 424, 220, 32, 'CHANGE ARMY', 2, BUTTON_QUIET, () => this.changeArmy(data.settings));

        this.add.bitmapText(cx, PANEL.y + PANEL.h + 22, PIXEL_FONT, 'PRESS ENTER TO PLAY AGAIN').setOrigin(0.5, 0).setScale(2).setTint(0x9aa79f);
        this.input.keyboard?.on('keydown-ENTER', () => playAgain.press());
    }

    /** A completely fresh match with the same name and colour. */
    private playAgain (settings: PlayerSettings): void
    {
        this.scene.stop('Hud');
        this.scene.start('Battlefield', { ...settings });
    }

    /** Back to the start screen (choices pre-filled). */
    private changeArmy (settings: PlayerSettings): void
    {
        this.scene.stop('Hud');
        this.scene.stop('Battlefield');
        this.scene.start('Start', { ...settings });
    }
}

function formatTime (ms: number): string
{
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
