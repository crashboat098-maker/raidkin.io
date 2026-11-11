import { Textures, type Game } from 'phaser';

/**
 * Packs the game's small, code-drawn textures (soldiers, trees, rocks,
 * effects... about 200 of them) into shared atlas pages.
 *
 * The GPU draws sprites in batches, and a batch can only use a handful of
 * textures (often 16). With ~100 different textures on screen, a big battle
 * kept breaking batches: hundreds of extra draw calls a frame. On one atlas
 * page, neighbouring sprites batch together no matter what they show.
 *
 * Nothing else changes: every texture keeps its key, and each of its frames
 * just points at its spot on the atlas page, so `add.image(x, y, key)`,
 * `setTexture(key)`, tints and flips all work exactly as before. Safe to call
 * again later: only textures created since the last call are packed (onto a
 * new page).
 */

/** Textures larger than this (either side, px) stay on their own. */
const MAX_SIDE = 256;
/** Empty pixels around each texture, so scaled or rotated sprites never pick up a neighbour. */
const PAD = 2;
const PAGE_WIDTH = 1024;

const packed = new Set<string>();
let pageCount = 0;

export function packTextures (game: Game): void
{
    const textures = game.textures;
    const candidates: Textures.CanvasTexture[] = [];
    for (const key of textures.getTextureKeys())
    {
        if (packed.has(key)) continue;
        const texture = textures.get(key);
        if (!(texture instanceof Textures.CanvasTexture) || texture.source.length !== 1) continue;
        const { width, height } = texture.source[0];
        if (width === 0 || height === 0 || width > MAX_SIDE || height > MAX_SIDE) continue;
        candidates.push(texture);
    }
    if (candidates.length < 2) return;

    // Shelf packing: tallest first, left to right, a new row when one fills up.
    candidates.sort((a, b) => b.source[0].height - a.source[0].height);
    const spots: { texture: Textures.CanvasTexture; x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    for (const texture of candidates)
    {
        const { width, height } = texture.source[0];
        if (x + width + PAD * 2 > PAGE_WIDTH) { x = 0; y += rowHeight; rowHeight = 0; }
        spots.push({ texture, x: x + PAD, y: y + PAD });
        x += width + PAD * 2;
        rowHeight = Math.max(rowHeight, height + PAD * 2);
    }
    const pageHeight = y + rowHeight;

    const page = textures.createCanvas(`__raidkin-atlas-${pageCount++}`, PAGE_WIDTH, pageHeight);
    if (!page) return;
    const ctx = page.getContext();
    for (const spot of spots) ctx.drawImage(spot.texture.getSourceImage() as HTMLCanvasElement, spot.x, spot.y);
    page.refresh();
    const shared = page.source[0];

    for (const { texture, x: ox, y: oy } of spots)
    {
        const own = texture.source[0];
        for (const name of texture.getFrameNames(true))
        {
            const frame = texture.get(name);
            frame.source = shared;
            frame.sourceIndex = 0;
            frame.setSize(frame.cutWidth, frame.cutHeight, frame.cutX + ox, frame.cutY + oy);
        }
        texture.source[0] = shared;
        (texture as unknown as { _source: Textures.TextureSource })._source = shared;
        // Free its own copy on the GPU (its canvas is kept as it was).
        if (own.glTexture && own.renderer && 'deleteTexture' in own.renderer)
        {
            own.renderer.deleteTexture(own.glTexture);
            own.glTexture = null;
        }
        packed.add(texture.key);
    }
}
