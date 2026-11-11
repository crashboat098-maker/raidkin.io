import { type GameObjects, type Scene, Textures } from 'phaser';

/**
 * Paints decorations that lie flat on the ground (pebbles, flowers, bones,
 * small rocks, the shadows under trees...) into a handful of big pictures,
 * then throws the individual pieces away.
 *
 * Soldiers always walk over these, never behind them, so nothing is lost by
 * flattening them, and the game has thousands fewer objects to sort and draw
 * each frame.
 */

/** Size of each baked picture (world pixels). */
const CHUNK = 512;

export function bakeFlatDecorations (scene: Scene, pieces: readonly GameObjects.Image[], worldWidth: number, worldHeight: number, depth: number): void
{
    if (pieces.length === 0) return;
    // Paint in the same order they used to be drawn, so overlaps look the same.
    const sorted = [...pieces].sort((a, b) => a.depth - b.depth);
    const bounds = sorted.map((p) => p.getBounds());

    for (let y0 = 0; y0 < worldHeight; y0 += CHUNK)
    {
        for (let x0 = 0; x0 < worldWidth; x0 += CHUNK)
        {
            const w = Math.min(CHUNK, worldWidth - x0);
            const h = Math.min(CHUNK, worldHeight - y0);
            const inside = sorted.filter((_, i) =>
            {
                const b = bounds[i];
                return b.right > x0 && b.x < x0 + w && b.bottom > y0 && b.y < y0 + h;
            });
            if (inside.length === 0) continue;

            const key = `baked-ground-${x0}-${y0}`;
            // A replay builds the battlefield again: start from a clean picture.
            if (scene.textures.exists(key)) scene.textures.remove(key);
            const texture = scene.textures.addDynamicTexture(key, w, h);
            if (!texture) continue;
            texture.setFilter(Textures.FilterMode.NEAREST);
            texture.draw(inside, -x0, -y0).render();
            scene.add.image(x0, y0, key).setOrigin(0, 0).setDepth(depth);
        }
    }

    for (const p of pieces) p.destroy();
}
