import { Textures, type Scene } from 'phaser';
import { GroundTile, type BattlefieldLayout } from '../logic/BattlefieldLayout';
import { isLavaSurface } from '../logic/LavaRivers';
import { isWaterSurface } from '../logic/Water';

/**
 * The minimap picture: the whole battlefield painted once, one pixel per
 * ground tile (ground, water, lava, roads and landmarks). Only the map
 * itself, never armies; the HUD draws your own marker on top each frame.
 */

/** Ground colours, a little brighter than the real tiles so the small map reads clearly. */
const GROUND_COLORS: Record<number, number> = {
    [GroundTile.Grass]: 0x4f6d38,
    [GroundTile.GrassAlt]: 0x52713a,
    [GroundTile.GrassTufts]: 0x56763d,
    [GroundTile.DarkGrass]: 0x435f31,
    [GroundTile.DarkGrassAlt]: 0x456233,
    [GroundTile.Dirt]: 0x6d5a40,
    [GroundTile.Canopy]: 0x1b3020,
    [GroundTile.CanopyAlt]: 0x1d3322,
    [GroundTile.Ash]: 0x4a4644,
    [GroundTile.AshAlt]: 0x524d4a,
    [GroundTile.Scorched]: 0x3a302c,
    [GroundTile.Cliff]: 0x231e1c,
    [GroundTile.FaeMoss]: 0x2f5b58,
    [GroundTile.FaeMossAlt]: 0x32605c,
    [GroundTile.FaeBloom]: 0x4d4f7e,
    [GroundTile.FaeCanopy]: 0x173230,
    [GroundTile.Mud]: 0x463e2c,
    [GroundTile.SwampMoss]: 0x3c4c31,
    [GroundTile.SwampMossAlt]: 0x3f5034,
    [GroundTile.SwampCanopy]: 0x1d2a1a,
    [GroundTile.CrystalMoss]: 0x34407a,
    [GroundTile.CrystalMossAlt]: 0x373c70,
    [GroundTile.CrystalGlow]: 0x4a5a9a,
    [GroundTile.CrystalCanopy]: 0x1c2140,
};
const WATER = 0x3f8fc4;
const LAVA = 0xe0602a;
const ROAD = '#9a8460';
const BRIDGE = '#b39a6c';
const LANDMARK = '#e4dcc6';

/** Paint the minimap into a texture called `key` (replacing any old one). Returns its size in pixels. */
export function createMinimapTexture (scene: Scene, layout: BattlefieldLayout, key: string): { width: number; height: number }
{
    const tile = layout.tileSize;
    const cols = Math.ceil(layout.worldWidth / tile);
    const rows = Math.ceil(layout.worldHeight / tile);
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const texture = scene.textures.createCanvas(key, cols, rows);
    if (!texture) return { width: cols, height: rows };
    const ctx = texture.getContext();

    // 1. Ground, water and lava, one pixel per tile (checked at the tile's middle and a quarter in).
    const image = ctx.createImageData(cols, rows);
    const data = image.data;
    for (let r = 0; r < rows; r++)
    {
        for (let c = 0; c < cols; c++)
        {
            const x = c * tile;
            const y = r * tile;
            const at = (fx: number, fy: number, test: (x: number, y: number) => boolean) => test(x + tile * fx, y + tile * fy);
            const wet = (wx: number, wy: number) => isWaterSurface(layout.water, wx, wy);
            const hot = (wx: number, wy: number) => isLavaSurface(layout.lava, wx, wy);
            let color = GROUND_COLORS[layout.ground[r]?.[c]] ?? GROUND_COLORS[GroundTile.Grass];
            if (at(0.5, 0.5, hot) || at(0.25, 0.25, hot) || at(0.75, 0.75, hot)) color = LAVA;
            else if (at(0.5, 0.5, wet) || at(0.25, 0.25, wet) || at(0.75, 0.75, wet)) color = WATER;
            const i = (r * cols + c) * 4;
            data[i] = (color >> 16) & 0xff;
            data[i + 1] = (color >> 8) & 0xff;
            data[i + 2] = color & 0xff;
            data[i + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);

    // 2. Roads and bridges as thin lines.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = (points: readonly { x: number; y: number }[], width: number, style: string) => {
        if (points.length < 2) return;
        ctx.strokeStyle = style;
        ctx.lineWidth = Math.max(1, width / tile);
        ctx.beginPath();
        ctx.moveTo(points[0].x / tile, points[0].y / tile);
        for (const p of points.slice(1)) ctx.lineTo(p.x / tile, p.y / tile);
        ctx.stroke();
    };
    ctx.globalAlpha = 0.75;
    for (const t of layout.trails) line(t.points, t.width * 0.8, ROAD);
    ctx.globalAlpha = 1;
    for (const b of [...layout.bridges, ...layout.lavaBridges]) line(b.points, b.width, BRIDGE);

    // 3. Landmarks (castles, towers, barracks...) as small light squares; houses as dots.
    ctx.fillStyle = LANDMARK;
    for (const s of layout.structures)
    {
        if (s.type === 'volcano') continue;
        const size = s.type === 'house' ? 1 : 2;
        ctx.fillRect(Math.round(s.x / tile - size / 2), Math.round(s.y / tile - size), size, size);
    }

    texture.refresh();
    texture.setFilter(Textures.FilterMode.NEAREST); // crisp pixels when scaled
    return { width: cols, height: rows };
}
