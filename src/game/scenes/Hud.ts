import { GameObjects, Scene } from 'phaser';
import type { BattlefieldLayout } from '../logic/BattlefieldLayout';
import { leaderId, type LeaderboardRow } from '../logic/Leaderboard';
import type { PlayerResources } from '../logic/PlayerResources';
import type { Rect, Vec2 } from '../logic/Types';
import { createMinimapTexture } from '../render/MinimapArt';
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
    /** The map, painted once for the minimap. */
    layout: BattlefieldLayout;
    /** For the minimap: where your army is (one point per group) and what the screen shows (world px). */
    getMapView: () => { army: Vec2[]; view: Rect };
    /** A message across the middle of the screen (e.g. reconnecting), or null for none. */
    getNotice?: () => string | null;
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
    /** See-through, so the battlefield shows behind it. */
    backgroundAlpha: 0.42,
};
/** Remembers whether the player hid the leaderboard / minimap (this browser only). */
const BOARD_HIDDEN_KEY = 'raidkin.leaderboardHidden';
const MINIMAP_HIDDEN_KEY = 'raidkin.minimapHidden';

/** Minimap, top left under the bar. */
const MINIMAP = {
    /** Longest side on screen (px). */
    size: 160,
    left: PADDING_X,
    top: BAR_HEIGHT + 12,
    alpha: 0.85,
    refreshMs: 100,
    textureKey: 'minimap',
};

/** Hide/show buttons: a small square beside an open panel, or a tab in its place when hidden. */
const TOGGLE_SIZE = 26;
const TOGGLE_GAP = 6;

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

interface ToggleOptions {
    /** Where the choice is remembered. */
    storageKey: string;
    /** Keyboard shortcut (Phaser key name, e.g. 'L'). */
    keyName: string;
    /** The tab's text while hidden (e.g. '+ MAP'). */
    hiddenLabel: string;
    /** Open: the "-" square's left edge, and the top of both. */
    openX: number;
    y: number;
    /** Hidden: the tab lines up with this x, by its right edge or its left edge. */
    hiddenEdgeX: number;
    hiddenAlignRight: boolean;
    onChange: (hidden: boolean) => void;
}

/**
 * A hide/show button for a HUD panel: a small "-" square beside the open
 * panel, a "+ NAME" tab in its place while hidden, plus a key. The choice is
 * remembered in this browser.
 */
class PanelToggle
{
    hidden = false;
    private readonly box: GameObjects.Graphics;
    private readonly label: GameObjects.BitmapText;
    private readonly zone: GameObjects.Zone;

    constructor (scene: Scene, private readonly options: ToggleOptions)
    {
        this.box = scene.add.graphics();
        this.label = scene.add.bitmapText(0, 0, PIXEL_FONT, '').setScale(TEXT_SCALE).setOrigin(0.5, 0.5);
        this.zone = scene.add.zone(0, 0, 1, 1).setOrigin(0, 0).setInteractive({ useHandCursor: true });
        this.zone.on('pointerdown', () => this.set(!this.hidden));
        scene.input.keyboard?.on(`keydown-${options.keyName}`, () => this.set(!this.hidden));
        let hidden = false;
        try { hidden = localStorage.getItem(options.storageKey) === '1'; }
        catch { /* storage blocked: start shown */ }
        this.set(hidden);
    }

    set (hidden: boolean): void
    {
        this.hidden = hidden;
        try { localStorage.setItem(this.options.storageKey, hidden ? '1' : '0'); }
        catch { /* storage blocked: fine, it just won't be remembered */ }

        const o = this.options;
        const text = hidden ? o.hiddenLabel : '-';
        const width = hidden ? textWidth(text) + 20 : TOGGLE_SIZE;
        const x = !hidden ? o.openX : o.hiddenAlignRight ? o.hiddenEdgeX - width : o.hiddenEdgeX;
        this.box.clear()
            .fillStyle(COLORS.background, BOARD.backgroundAlpha + 0.2).fillRect(x, o.y, width, TOGGLE_SIZE)
            .lineStyle(2, COLORS.borderDark, 0.8).strokeRect(x, o.y, width, TOGGLE_SIZE);
        this.label.setText(text).setPosition(x + width / 2, o.y + TOGGLE_SIZE / 2 + 1).setTint(hidden ? COLORS.value : COLORS.label);
        this.zone.setPosition(x - 4, o.y - 4).setSize(width + 8, TOGGLE_SIZE + 8);
        this.zone.input?.hitArea.setTo(0, 0, width + 8, TOGGLE_SIZE + 8);
        o.onChange(hidden);
    }
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
    /** Everything in the panel, so it can be hidden in one go. */
    private boardContainer: GameObjects.Container;
    private boardToggle: PanelToggle;

    private minimapContainer: GameObjects.Container;
    private minimapMarkers: GameObjects.Graphics;
    private minimapToggle: PanelToggle;
    /** Where the map sits on screen, and screen px per world px. */
    private minimapBox = { x: 0, y: 0, width: 0, height: 0, scale: 0 };
    private nextMinimapAt = 0;

    private notice: GameObjects.BitmapText;
    private noticeBack: GameObjects.Graphics;
    private noticeShown: string | null = null;

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
        this.nextMinimapAt = 0;
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
        this.createMinimap();
        this.noticeShown = null;
        this.noticeBack = this.add.graphics().setVisible(false);
        this.notice = this.add.bitmapText(width / 2, Math.round(this.scale.height * 0.28), PIXEL_FONT, '')
            .setOrigin(0.5, 0.5).setScale(TEXT_SCALE * 1.5).setTint(COLORS.timer).setVisible(false);
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
        if (!this.boardToggle.hidden && time >= this.nextBoardAt)
        {
            this.nextBoardAt = time + BOARD.refreshMs;
            this.refreshLeaderboard();
        }
        const notice = this.source.getNotice?.() ?? null;
        if (notice !== this.noticeShown) this.showNotice(notice);
        if (!this.minimapToggle.hidden && time >= this.nextMinimapAt)
        {
            this.nextMinimapAt = time + MINIMAP.refreshMs;
            this.drawMinimapMarkers();
        }
    }

    private showNotice (text: string | null): void
    {
        this.noticeShown = text;
        this.notice.setVisible(text !== null);
        this.noticeBack.setVisible(text !== null);
        if (text === null) return;
        this.notice.setText(text);
        const b = this.notice.getBounds();
        this.noticeBack.clear()
            .fillStyle(COLORS.background, 0.75).fillRect(b.x - 18, b.y - 12, b.width + 36, b.height + 24)
            .lineStyle(2, COLORS.borderDark, 0.9).strokeRect(b.x - 18, b.y - 12, b.width + 36, b.height + 24);
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

        this.boardContainer = this.add.container(0, 0);
        this.boardBackground = this.add.graphics();
        this.boardGraphics = this.add.graphics();
        this.boardCrown = this.add.image(0, 0, Tex.Crown).setScale(TEXT_SCALE).setOrigin(0, 0.5).setVisible(false);
        this.boardContainer.add([this.boardBackground, this.boardGraphics, this.boardCrown]);

        const header = (col: number, text: string, alignRight = false) =>
            this.boardContainer.add(this.add.bitmapText(x + col, y + 8, PIXEL_FONT, text).setScale(TEXT_SCALE).setTint(COLORS.label).setOrigin(alignRight ? 1 : 0, 0));
        header(BOARD.col.rank, '#');
        header(BOARD.col.name, 'NAME');
        header(BOARD.col.army, 'ARMY', true);
        header(BOARD.col.kills, 'KILLS', true);
        this.sizeLeaderboard(this.source.getLeaderboard().length);

        // Hide / show: a small "-" square left of the panel, or the L key;
        // hidden, a "+ LEADERBOARD" tab sits where the panel was.
        this.boardToggle = new PanelToggle(this, {
            storageKey: BOARD_HIDDEN_KEY, keyName: 'L', hiddenLabel: '+ LEADERBOARD',
            openX: x - TOGGLE_GAP - TOGGLE_SIZE, y, hiddenEdgeX: x + BOARD.width, hiddenAlignRight: true,
            onChange: (hidden) => {
                this.boardContainer.setVisible(!hidden);
                if (!hidden)
                {
                    this.boardKey = '';
                    this.refreshLeaderboard();
                }
            },
        });
    }

    // -----------------------------------------------------------------------
    // Minimap (where you are; it never shows other players)
    // -----------------------------------------------------------------------

    private createMinimap (): void
    {
        const art = createMinimapTexture(this, this.source.layout, MINIMAP.textureKey);
        const scale = MINIMAP.size / Math.max(art.width, art.height);
        const width = Math.round(art.width * scale);
        const height = Math.round(art.height * scale);
        const x = MINIMAP.left;
        const y = MINIMAP.top;
        this.minimapBox = { x, y, width, height, scale: width / this.source.layout.worldWidth };

        const frame = this.add.graphics()
            .fillStyle(COLORS.background, BOARD.backgroundAlpha).fillRect(x - 2, y - 2, width + 4, height + 4)
            .lineStyle(2, COLORS.borderDark, 0.7).strokeRect(x - 2, y - 2, width + 4, height + 4);
        const image = this.add.image(x, y, MINIMAP.textureKey).setOrigin(0, 0).setDisplaySize(width, height).setAlpha(MINIMAP.alpha);
        this.minimapMarkers = this.add.graphics();
        this.minimapContainer = this.add.container(0, 0, [frame, image, this.minimapMarkers]);

        // Hide / show like the leaderboard: "-" right of the map, or the M key.
        this.minimapToggle = new PanelToggle(this, {
            storageKey: MINIMAP_HIDDEN_KEY, keyName: 'M', hiddenLabel: '+ MAP',
            openX: x + width + 2 + TOGGLE_GAP, y: y - 2, hiddenEdgeX: x - 2, hiddenAlignRight: false,
            onChange: (hidden) => {
                this.minimapContainer.setVisible(!hidden);
                if (!hidden) this.drawMinimapMarkers();
            },
        });
        this.drawMinimapMarkers();
    }

    /** Your army (one dot per group) and the part of the map your screen shows. */
    private drawMinimapMarkers (): void
    {
        const box = this.minimapBox;
        const g = this.minimapMarkers.clear();
        const { army, view } = this.source.getMapView();
        const sx = (wx: number) => box.x + Math.max(0, Math.min(box.width, wx * box.scale));
        const sy = (wy: number) => box.y + Math.max(0, Math.min(box.height, wy * box.scale));

        // What's on screen right now.
        const left = sx(view.x);
        const top = sy(view.y);
        g.lineStyle(1, COLORS.value, 0.55).strokeRect(left, top, sx(view.x + view.width) - left, sy(view.y + view.height) - top);

        // You.
        for (const p of army)
        {
            g.fillStyle(0x000000, 0.8).fillCircle(sx(p.x), sy(p.y), 4.5);
            g.fillStyle(COLORS.you, 1).fillCircle(sx(p.x), sy(p.y), 3);
        }
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
            {
                const t = this.add.bitmapText(x + col, rowY, PIXEL_FONT, '').setScale(TEXT_SCALE).setOrigin(alignRight ? 1 : 0, 0);
                this.boardContainer.add(t);
                return t;
            };
            this.boardRows.push({ rank: make(BOARD.col.rank), name: make(BOARD.col.name), army: make(BOARD.col.army, true), kills: make(BOARD.col.kills, true) });
        }
        this.boardRows.forEach((r, i) => {
            for (const t of [r.rank, r.name, r.army, r.kills]) t.setVisible(i < count);
        });
        if (count === this.boardShownRows) return;
        this.boardShownRows = count;
        const height = BOARD.headerHeight + count * BOARD.rowHeight + 6;
        this.boardBackground.clear()
            .fillStyle(COLORS.background, BOARD.backgroundAlpha).fillRect(x, y, BOARD.width, height)
            .lineStyle(2, COLORS.borderDark, 0.6).strokeRect(x - 1, y - 1, BOARD.width + 2, height + 2)
            .fillStyle(COLORS.borderLight, 0.6).fillRect(x, y + BOARD.headerHeight - 6, BOARD.width, 1);
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
