import { BlendModes, type GameObjects, type Scene, Textures } from 'phaser';

/**
 * Flattens the whole ground into one big background picture: the ground
 * tiles, sandy banks and ash, lava rivers, water, dirt paths and cobbled
 * roads, bridges, and the decorations lying flat on the ground (pebbles,
 * flowers, bones, small rocks, the shadows under trees...).
 *
 * Before this, every frame drew ~6 world-sized layers on top of each other
 * plus a tile layer walked tile by tile. Now it's one image, and the big
 * source pictures are freed from memory once they're painted in.
 *
 * Only still things are flattened. Anything animated (glows, glints, lava
 * bubbles...) stays a live object, drawn just above the background.
 */

const KEY = 'ground-background';
/** Anything this deep is ground, not scenery (scenery depth is its y position, >= 0). */
const GROUND_MAX_DEPTH = -900_000;

/**
 * @param ground  objects created while building the battlefield (any order); the
 *                still ground layers among them are flattened and destroyed.
 * @param flat    flat decorations, painted in at `flatDepth` in the ground's layer order.
 */
export function bakeGround (scene: Scene, ground: readonly GameObjects.GameObject[], flat: readonly GameObjects.Image[], flatDepth: number, worldWidth: number, worldHeight: number, depth: number): void
{
    const layers = ground.filter((o) => isStillGround(scene, o)) as (GameObjects.GameObject & GameObjects.Components.Depth)[];
    layers.sort((a, b) => a.depth - b.depth);
    // Flat decorations, in the order they used to be drawn, so overlaps look the same.
    const pieces = [...flat].sort((a, b) => a.depth - b.depth);
    const below = layers.filter((o) => o.depth < flatDepth);
    const above = layers.filter((o) => o.depth >= flatDepth);
    const all: GameObjects.GameObject[] = [...below, ...pieces, ...above];
    if (all.length === 0) return;

    // One picture if the graphics card allows it (it almost always does), else a few tiles.
    const maxSize = (scene.renderer as { getMaxTextureSize?: () => number }).getMaxTextureSize?.() ?? 4096;
    const tile = Math.min(maxSize, Math.max(worldWidth, worldHeight));
    for (let y0 = 0; y0 < worldHeight; y0 += tile)
    {
        for (let x0 = 0; x0 < worldWidth; x0 += tile)
        {
            const w = Math.min(tile, worldWidth - x0);
            const h = Math.min(tile, worldHeight - y0);
            const key = x0 === 0 && y0 === 0 ? KEY : `${KEY}-${x0}-${y0}`;
            // A replay builds the battlefield again: start from a clean picture.
            if (scene.textures.exists(key)) scene.textures.remove(key);
            const texture = scene.textures.addDynamicTexture(key, w, h);
            if (!texture) continue;
            texture.setFilter(Textures.FilterMode.NEAREST);
            texture.draw(all, -x0, -y0).render();
            scene.add.image(x0, y0, key).setOrigin(0, 0).setDepth(depth);
        }
    }

    // The big world-sized source pictures (trails, water...) aren't needed any more.
    const freeable = new Set<string>();
    for (const o of layers)
    {
        const image = o as Partial<GameObjects.Image>;
        const frame = image.frame;
        if (frame && frame.source.width >= worldWidth / 2 && frame.source.height >= worldHeight / 2) freeable.add(frame.texture.key);
    }
    for (const o of all) o.destroy();
    for (const key of freeable) if (scene.textures.exists(key)) scene.textures.remove(key);
}

/** A ground layer that never moves, fades or changes: safe to paint in once. */
function isStillGround (scene: Scene, o: GameObjects.GameObject): boolean
{
    const g = o as GameObjects.GameObject & Partial<GameObjects.Components.Depth & GameObjects.Components.Visible & GameObjects.Components.AlphaSingle & GameObjects.Components.BlendMode>;
    if (o.type !== 'Image' && o.type !== 'TilemapLayer') return false;
    if (g.depth === undefined || g.depth > GROUND_MAX_DEPTH) return false;
    // Hidden or see-through-at-rest things are pooled effects waiting to be used.
    if (!g.visible || g.alpha === 0) return false;
    if (g.blendMode !== undefined && g.blendMode !== BlendModes.NORMAL) return false;
    return scene.tweens.getTweensOf(o).length === 0;
}
