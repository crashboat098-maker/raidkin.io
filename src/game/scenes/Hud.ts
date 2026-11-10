import { GameObjects, Scene } from 'phaser';
import { leaderId, type LeaderboardRow } from '../logic/Leaderboard';
import type { PlayerResources } from '../logic/PlayerResources';
import { hexToInt, Palette, type ArmyColor } from '../render/Palette';
import { ensurePixelFont, PIXEL_FONT } from '../render/PixelFont';
import { Tex } from '../render/PlaceholderArt';

/** The army while it is split into several clusters (all moving together). */
export interface SplitState {
    /** How many clusters the army is in. */
    clusters: number;
    /** Seconds until clusters start regrouping, or null if they are regrouping now. */
    regroupSeconds: number | null;
}

/** What the Battlefield passes to the HUD when it starts it. */
export interface HudData {
    /** Called every frame to read the latest numbers (the HUD never changes them). */
    getResources: () => PlayerResources;
    getArmySize: () => number;
    /** Return null while the army is together; the split segment only shows when split. */
    getSplitState: () => SplitState | null;
    /** Live ranking of every competitor. */
    getLeaderboard: () => LeaderboardRow[];
    /** Your player id (to highlight your row). */
    getMyId: () => string;
    playerColor: ArmyColor;
    recruitCost: number;
    /** Green crystals per Archer. */
    archerCost: number;
}

// ---------------------------------------------------------------------------
// Layout (screen pixels)
// ---------------------------------------------------------------------------

const BAR_HEIGHT = 34;
const TEXT_SCALE = 2;
/** The pixel font is fixed-width: each character cell is 7 art pixels wide. */
const CHAR_WIDTH = 7 * TEXT_SCALE;
const TEXT_Y = Math.round((BAR_HEIGHT - 9 * TEXT_SCALE) / 2) + 1;
const MID_Y = BAR_HEIGHT / 2;
const PADDING_X = 18;
/** Space between a label and its value, and around separators. */
const INNER_GAP = 8;
const GROUP_GAP = 16;
const MINI_BAR = { segmentWidth: 10, segmentHeight: 8, gap: 2 };

/** Leaderboard panel, top right under the bar. Columns are x offsets inside the panel. */
const BOARD = {
    width: 364,
    top: BAR_HEIGHT + 12,
    rowHeight: 24,
    headerHeight: 32,
    nameChars: 10,
    /** Most rows shown (online games can have many players). */
    maxRows: 10,
    col: { rank: 12, swatch: 34, name: 54, army: 266, kills: 350 },
    refreshMs: 250,
};

const COLORS = {
    background: 0x0a0c09,
    borderDark: hexToInt(Palette.stone.dark),
    borderLight: hexToInt(Palette.stone.mid),
    separator: hexToInt(Palette.stone.light),
    label: 0x8fa39a,
    value: 0xe8e2d4,
    shards: hexToInt(Palette.shard.pale),
    flash: 0xffffff,
    title: hexToInt(Palette.stone.light),
    timer: hexToInt(Palette.accentPale.amber),
    segmentEmpty: 0x050605,
    segmentBorder: hexToInt(Palette.stone.dark),
    fill: hexToInt(Palette.shard.mid),
    fillLight: hexToInt(Palette.shard.pale),
    you: hexToInt(Palette.accent.amber),
    green: 0x5dff8a,
    greenLight: 0xd8ffe2,
};

/** "@7" = hourglass, 7 s until the clusters regroup; "^" = regrouping now. */
function regroupLabel (split: SplitState): string
{
    return split.regroupSeconds === null ? '^' : `@${Math.ceil(split.regroupSeconds)}`;
}

/** Changes whenever anything the split segment shows changes (the countdown ticks once a second). */
function splitStateKey (split: SplitState | null): string
{
    return split ? `${split.clusters}/${regroupLabel(split)}` : '';
}

/** Width in screen pixels of a string in the HUD font. */
function textWidth (text: string): number
{
    return Math.max(0, text.length * CHAR_WIDTH - TEXT_SCALE);
}

interface BoardRowObjects {
    rank: GameObjects.BitmapText;
    name: GameObjects.BitmapText;
    army: GameObjects.BitmapText;
    kills: GameObjects.BitmapText;
}

/**
 * A thin heads-up bar across the top of the screen, plus a compact live
 * leaderboard under it on the right. Runs as its own scene so the
 * battlefield camera's zoom and movement don't affect it.
 *
 * SHARDS 39  ◆  NEXT WARRIOR ▮▮▮▮▯ 4/5  ◆  ARMY 47  [◆ CLUSTERS 4 ⌛7]
 */
export class Hud extends Scene
{
    private source: HudData;

    private shardIcon: GameObjects.Image;
    private shardsValue: GameObjects.BitmapText;
    private miniBar: GameObjects.Graphics;
    private archerBar: GameObjects.Graphics;
    private archerValue: GameObjects.BitmapText;
    private progressValue: GameObjects.BitmapText;
    private warriorIcon: GameObjects.Image;
    private armyValue: GameObjects.BitmapText;
    private splitObjects: GameObjects.BitmapText[] = [];
    private clustersValue: GameObjects.BitmapText;
    private regroupValue: GameObjects.BitmapText;
    private separators: GameObjects.Graphics;
    private splitSeparatorX = 0;
    private mainSeparatorXs: number[] = [];
    private shown = { total: -1, progress: -1, archer: -1, army: -1, split: '' };

    private boardBackground: GameObjects.Graphics;
    private boardShownRows = -1;
    private boardGraphics: GameObjects.Graphics;
    /** Small crown beside the #1 army's name. */
    private boardCrown: GameObjects.Image;
    private boardRows: BoardRowObjects[] = [];
    private boardX = 0;
    private boardKey = '';
    private nextBoardAt = 0;

    constructor ()
    {
        super('Hud');
    }

    create (data: HudData)
    {
        this.source = data;
        this.shown = { total: -1, progress: -1, archer: -1, army: -1, split: '' };
        this.splitObjects = [];
        this.boardRows = [];
        this.boardShownRows = -1;
        this.boardKey = '';
        this.nextBoardAt = 0;
        ensurePixelFont(this);

        const width = this.scale.width;
        this.drawBackground(width);
        this.separators = this.add.graphics();

        // Lay the bar out left to right. Values get room reserved for their
        // widest expected text, so the bar never shifts as numbers grow.
        let x = PADDING_X;
        const sepXs: number[] = [];
        const separator = () => {
            x += GROUP_GAP;
            sepXs.push(x);
            x += GROUP_GAP;
        };

        // SHARDS 39
        this.shardIcon = this.add.image(x + 7, MID_Y, Tex.SoulShard).setScale(TEXT_SCALE);
        x += 14 + INNER_GAP;
        x = this.label(x, 'SHARDS') + INNER_GAP;
        this.shardsValue = this.text(x, '0', COLORS.shards);
        x += textWidth('99999');

        // NEXT WARRIOR ▮▮▮▮▯ 4/5
        separator();
        x = this.label(x, 'NEXT WARRIOR') + INNER_GAP;
        this.miniBar = this.add.graphics({ x, y: Math.round(MID_Y - MINI_BAR.segmentHeight / 2) });
        x += data.recruitCost * (MINI_BAR.segmentWidth + MINI_BAR.gap) - MINI_BAR.gap + INNER_GAP;
        this.progressValue = this.text(x, '0/0', COLORS.value);
        x += textWidth(`${data.recruitCost}/${data.recruitCost}`);

        // ARCHER ◆▮▮▯ 2/3 (green crystals: their own progress)
        separator();
        this.add.image(x + 7, MID_Y, Tex.SoulShardGreen).setScale(TEXT_SCALE);
        x += 14 + INNER_GAP;
        x = this.label(x, 'ARCHER') + INNER_GAP;
        this.archerBar = this.add.graphics({ x, y: Math.round(MID_Y - MINI_BAR.segmentHeight / 2) });
        x += data.archerCost * (MINI_BAR.segmentWidth + MINI_BAR.gap) - MINI_BAR.gap + INNER_GAP;
        this.archerValue = this.text(x, '0/0', COLORS.green);
        x += textWidth(`${data.archerCost}/${data.archerCost}`);

        // ARMY 47 (no size limit)
        separator();
        this.warriorIcon = this.add.image(x + 12, MID_Y + 1, Tex.warrior(data.playerColor)).setScale(TEXT_SCALE * 0.75);
        x += 22 + INNER_GAP;
        x = this.label(x, 'ARMY') + INNER_GAP;
        this.armyValue = this.text(x, '0', COLORS.value);
        x += textWidth('9999'); // room for big armies without the bar shifting

        // CLUSTERS 4 ⌛7 (only while the army is split)
        separator();
        this.splitSeparatorX = sepXs[3];
        const clustersLabel = this.text(x, 'CLUSTERS', COLORS.label);
        x += textWidth('CLUSTERS') + INNER_GAP;
        this.clustersValue = this.text(x, '0', COLORS.value);
        x += textWidth('99') + INNER_GAP;
        // Hourglass countdown until the clusters regroup (or a return arrow while they are regrouping).
        this.regroupValue = this.text(x, '@10', COLORS.timer);
        this.splitObjects = [clustersLabel, this.clustersValue, this.regroupValue];
        this.mainSeparatorXs = sepXs.slice(0, 3);

        // Game title, quietly on the right.
        this.add.bitmapText(width - PADDING_X, TEXT_Y, PIXEL_FONT, 'RAIDKIN.IO')
            .setOrigin(1, 0).setScale(TEXT_SCALE).setTint(COLORS.title).setAlpha(0.6);

        // Controls reminder, quietly in the bottom-left corner.
        this.add.bitmapText(PADDING_X, this.scale.height - 12, PIXEL_FONT, 'SPACE SPLIT  -  Q / RIGHT-CLICK SURRENDER A SOLDIER')
            .setOrigin(0, 1).setScale(TEXT_SCALE).setTint(COLORS.label).setAlpha(0.7);

        this.createLeaderboard(width);
        this.refresh();
        this.refreshLeaderboard();
    }

    update (time: number)
    {
        const r = this.source.getResources();
        const army = this.source.getArmySize();
        const splitKey = splitStateKey(this.source.getSplitState());
        if (r.soulShards !== this.shown.total || r.recruitProgress !== this.shown.progress || r.archerProgress !== this.shown.archer || army !== this.shown.army || splitKey !== this.shown.split)
        {
            this.refresh();
        }
        if (time >= this.nextBoardAt)
        {
            this.nextBoardAt = time + BOARD.refreshMs;
            this.refreshLeaderboard();
        }
    }

    private refresh (): void
    {
        const resources = this.source.getResources();
        const armySize = this.source.getArmySize();
        const split = this.source.getSplitState();
        const { recruitCost } = this.source;

        const first = this.shown.total < 0;
        const gainedShard = !first && resources.soulShards > this.shown.total;
        const armyGrew = !first && armySize > this.shown.army;
        this.shown = { total: resources.soulShards, progress: resources.recruitProgress, archer: resources.archerProgress, army: armySize, split: splitStateKey(split) };

        this.shardsValue.setText(String(resources.soulShards));
        this.progressValue.setText(`${resources.recruitProgress}/${recruitCost}`);
        this.drawMiniBar(this.miniBar, resources.recruitProgress, recruitCost, COLORS.fill, COLORS.fillLight);
        this.archerValue.setText(`${resources.archerProgress}/${this.source.archerCost}`);
        this.drawMiniBar(this.archerBar, resources.archerProgress, this.source.archerCost, COLORS.green, COLORS.greenLight);
        this.armyValue.setText(String(armySize));

        // Split segment appears only while the army is split.
        for (const obj of this.splitObjects) obj.setVisible(split !== null);
        if (split)
        {
            this.clustersValue.setText(String(split.clusters));
            this.regroupValue.setText(regroupLabel(split));
        }
        this.drawSeparators(split !== null);

        // Small feedback when numbers go up.
        if (gainedShard)
        {
            this.flash(this.shardsValue, COLORS.shards);
            this.tweens.add({ targets: this.shardIcon, scale: TEXT_SCALE * 1.35, duration: 80, yoyo: true, ease: 'Quad.easeOut' });
        }
        if (armyGrew)
        {
            this.flash(this.armyValue, COLORS.value);
            this.tweens.add({ targets: this.warriorIcon, scale: TEXT_SCALE, duration: 110, yoyo: true, ease: 'Quad.easeOut' });
        }
    }

    // -----------------------------------------------------------------------
    // Leaderboard
    // -----------------------------------------------------------------------

    private createLeaderboard (width: number): void
    {
        const x = width - PADDING_X - BOARD.width;
        this.boardX = x;
        const y = BOARD.top;

        this.boardBackground = this.add.graphics();
        this.boardGraphics = this.add.graphics();
        this.boardCrown = this.add.image(0, 0, Tex.Crown).setScale(TEXT_SCALE).setOrigin(0, 0.5).setVisible(false);

        const header = (col: number, text: string, alignRight = false) =>
            this.add.bitmapText(x + col, y + 8, PIXEL_FONT, text).setScale(TEXT_SCALE).setTint(COLORS.label).setOrigin(alignRight ? 1 : 0, 0);
        header(BOARD.col.rank, '#');
        header(BOARD.col.name, 'NAME');
        header(BOARD.col.army, 'ARMY', true);
        header(BOARD.col.kills, 'KILLS', true);
        this.sizeLeaderboard(this.source.getLeaderboard().length);
    }

    /** Fit the panel to `count` rows (online, people come and go), making more rows as needed. */
    private sizeLeaderboard (count: number): void
    {
        count = Math.min(count, BOARD.maxRows);
        const x = this.boardX;
        const y = BOARD.top;
        while (this.boardRows.length < count)
        {
            const rowY = y + BOARD.headerHeight + this.boardRows.length * BOARD.rowHeight;
            const make = (col: number, alignRight = false) =>
                this.add.bitmapText(x + col, rowY, PIXEL_FONT, '').setScale(TEXT_SCALE).setOrigin(alignRight ? 1 : 0, 0);
            this.boardRows.push({ rank: make(BOARD.col.rank), name: make(BOARD.col.name), army: make(BOARD.col.army, true), kills: make(BOARD.col.kills, true) });
        }
        this.boardRows.forEach((r, i) => {
            for (const t of [r.rank, r.name, r.army, r.kills]) t.setVisible(i < count);
        });
        if (count === this.boardShownRows) return;
        this.boardShownRows = count;
        const height = BOARD.headerHeight + count * BOARD.rowHeight + 6;
        this.boardBackground.clear()
            .fillStyle(COLORS.borderDark, 1).fillRect(x - 2, y - 2, BOARD.width + 4, height + 4)
            .fillStyle(COLORS.background, 0.86).fillRect(x, y, BOARD.width, height)
            .fillStyle(COLORS.borderLight, 0.8).fillRect(x, y + BOARD.headerHeight - 6, BOARD.width, 1);
    }

    private refreshLeaderboard (): void
    {
        const all = this.source.getLeaderboard();
        const me = this.source.getMyId();
        // The top of the table, always including you (in the last row if you're further down).
        const rows = all.slice(0, BOARD.maxRows);
        const mine = all.find((r) => r.playerId === me);
        if (mine && !rows.includes(mine)) rows[rows.length - 1] = mine;
        const key = rows.map((r) => `${r.playerId}:${r.soldiers}:${r.kills}:${r.alive}`).join('|');
        if (key === this.boardKey) return;
        this.boardKey = key;
        this.sizeLeaderboard(rows.length);

        const g = this.boardGraphics.clear();
        const leader = leaderId(all);
        this.boardCrown.setVisible(false);
        rows.forEach((row, i) => {
            const objects = this.boardRows[i];
            if (!objects) return;
            const rowY = BOARD.top + BOARD.headerHeight + i * BOARD.rowHeight;
            const colors = Palette.armies[row.colorId as ArmyColor] ?? Palette.armies.crimson;
            const isMe = row.playerId === me;

            // Highlight your row.
            if (isMe)
            {
                g.fillStyle(COLORS.you, 0.16).fillRect(this.boardX + 4, rowY - 4, BOARD.width - 8, BOARD.rowHeight - 2);
                g.fillStyle(COLORS.you, 0.9).fillRect(this.boardX + 4, rowY - 4, 3, BOARD.rowHeight - 2);
            }
            // Army colour swatch.
            g.fillStyle(hexToInt(Palette.outline), 1).fillRect(this.boardX + BOARD.col.swatch - 1, rowY + 1, 14, 14);
            g.fillStyle(hexToInt(colors.main), row.alive ? 1 : 0.4).fillRect(this.boardX + BOARD.col.swatch, rowY + 2, 12, 12);

            const text = isMe ? COLORS.you : COLORS.value;
            const alpha = row.alive ? 1 : 0.45;
            const name = row.name.length > BOARD.nameChars ? `${row.name.slice(0, BOARD.nameChars - 1)}.` : row.name;
            objects.rank.setText(String(row.rank)).setTint(isMe ? COLORS.you : COLORS.label).setAlpha(alpha);
            objects.name.setText(name).setTint(text).setAlpha(alpha);
            if (row.playerId === leader)
            {
                // The crown sits just after the leader's name.
                this.boardCrown.setPosition(this.boardX + BOARD.col.name + textWidth(name) + 8, rowY + 7).setVisible(true);
            }
            objects.army.setText(row.alive ? String(row.soldiers) : '-').setTint(text).setAlpha(alpha);
            objects.kills.setText(String(row.kills)).setTint(text).setAlpha(alpha);
        });
    }

    // -----------------------------------------------------------------------

    private text (x: number, value: string, tint: number): GameObjects.BitmapText
    {
        return this.add.bitmapText(x, TEXT_Y, PIXEL_FONT, value).setScale(TEXT_SCALE).setTint(tint);
    }

    /** Add a dim label and return the x just after it. */
    private label (x: number, value: string): number
    {
        this.text(x, value, COLORS.label);
        return x + textWidth(value);
    }

    /** Brief white flash on a value that just changed. */
    private flash (target: GameObjects.BitmapText, normal: number): void
    {
        target.setTint(COLORS.flash);
        this.time.delayedCall(140, () => target.setTint(normal));
    }

    private drawBackground (width: number): void
    {
        const g = this.add.graphics();
        // Mostly opaque: enough to hint at the world beneath without distracting from the text.
        g.fillStyle(COLORS.background, 0.92).fillRect(0, 0, width, BAR_HEIGHT);
        g.fillStyle(COLORS.borderLight, 0.7).fillRect(0, BAR_HEIGHT, width, 1);
        g.fillStyle(COLORS.borderDark, 1).fillRect(0, BAR_HEIGHT + 1, width, 2);
        // Soft fade under the bar so it doesn't end in a hard edge.
        g.fillStyle(0x000000, 0.18).fillRect(0, BAR_HEIGHT + 3, width, 2);
    }

    /** Small pixel diamonds between groups. */
    private drawSeparators (split: boolean): void
    {
        const g = this.separators.clear();
        const xs = split ? [...this.mainSeparatorXs, this.splitSeparatorX] : this.mainSeparatorXs;
        g.fillStyle(COLORS.separator, 0.8);
        for (const x of xs)
        {
            g.fillRect(x - 1, MID_Y - 3, 2, 6);
            g.fillRect(x - 3, MID_Y - 1, 6, 2);
        }
    }

    private drawMiniBar (bar: GameObjects.Graphics, progress: number, needed: number, fill: number, fillLight: number): void
    {
        const g = bar.clear();
        const { segmentWidth: w, segmentHeight: h, gap } = MINI_BAR;

        for (let i = 0; i < needed; i++)
        {
            const sx = i * (w + gap);
            g.fillStyle(COLORS.segmentBorder).fillRect(sx - 1, -1, w + 2, h + 2);
            if (i < progress)
            {
                g.fillStyle(fill).fillRect(sx, 0, w, h);
                g.fillStyle(fillLight).fillRect(sx, 0, w, 2);
            }
            else
            {
                g.fillStyle(COLORS.segmentEmpty).fillRect(sx, 0, w, h);
            }
        }
    }
}
