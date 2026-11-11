import { Scene } from 'phaser';
import type { Rng } from '../logic/Random';
import { Palette } from './Palette';

/**
 * A tiny pixel canvas with art "brushes", used to paint placeholder art in
 * code (structures, trees, boulders). Coordinates are in art pixels.
 * A 1-pixel border is reserved around the edge for the outline.
 */
export class PixelPainter
{
    private readonly pixels: (string | null)[];
    private readonly bufferWidth: number;
    private readonly bufferHeight: number;

    constructor (readonly width: number, readonly height: number, readonly rng: Rng)
    {
        this.bufferWidth = width + 2;
        this.bufferHeight = height + 2;
        this.pixels = new Array(this.bufferWidth * this.bufferHeight).fill(null);
    }

    set (x: number, y: number, color: string): void
    {
        const bx = Math.round(x) + 1;
        const by = Math.round(y) + 1;
        if (bx < 0 || by < 0 || bx >= this.bufferWidth || by >= this.bufferHeight) return;
        this.pixels[by * this.bufferWidth + bx] = color;
    }

    /** Erase a pixel back to transparent (e.g. a broken-off piece of wall). */
    clear (x: number, y: number): void
    {
        const bx = Math.round(x) + 1;
        const by = Math.round(y) + 1;
        if (bx < 0 || by < 0 || bx >= this.bufferWidth || by >= this.bufferHeight) return;
        this.pixels[by * this.bufferWidth + bx] = null;
    }

    has (x: number, y: number): boolean
    {
        const bx = Math.round(x) + 1;
        const by = Math.round(y) + 1;
        if (bx < 0 || by < 0 || bx >= this.bufferWidth || by >= this.bufferHeight) return false;
        return this.pixels[by * this.bufferWidth + bx] !== null;
    }

    rect (x: number, y: number, w: number, h: number, color: string): void
    {
        for (let dy = 0; dy < h; dy++)
        {
            for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, color);
        }
    }

    /** A 1-pixel line (for branches and roots). */
    line (x0: number, y0: number, x1: number, y1: number, color: string): void
    {
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
        for (let i = 0; i <= steps; i++)
        {
            const t = i / steps;
            this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, color);
        }
    }

    /**
     * A shaded ellipse lit from the top-left: `colors` go from lightest to
     * darkest. Used for foliage clumps and boulders.
     */
    shadedBlob (cx: number, cy: number, rx: number, ry: number, colors: readonly string[], holes = 0): void
    {
        for (let dy = -ry; dy <= ry; dy++)
        {
            for (let dx = -rx; dx <= rx; dx++)
            {
                const nx = dx / rx;
                const ny = dy / ry;
                if (nx * nx + ny * ny > 1) continue;
                if (holes > 0 && this.rng() < holes) continue;
                // -1 = top-left (lit) ... +1 = bottom-right (shadow)
                const light = (nx + ny) / 2 + (this.rng() - 0.5) * 0.25;
                const index = Math.min(colors.length - 1, Math.max(0, Math.floor((light + 0.75) / 1.5 * colors.length)));
                this.set(cx + dx, cy + dy, colors[index]);
            }
        }
    }

    /** Sprinkle a colour over existing pixels in an area. */
    speckle (x: number, y: number, w: number, h: number, color: string, chance: number): void
    {
        for (let dy = 0; dy < h; dy++)
        {
            for (let dx = 0; dx < w; dx++)
            {
                if (this.has(x + dx, y + dy) && this.rng() < chance) this.set(x + dx, y + dy, color);
            }
        }
    }

    moss (x: number, y: number, w: number, h: number, chance: number): void
    {
        this.speckle(x, y, w, h, Palette.stone.moss, chance);
    }

    /**
     * Weathered stone bricks seen from the front. The brick pattern uses
     * absolute coordinates, so separate wall pieces line up with each other.
     */
    stoneWall (x: number, y: number, w: number, h: number): void
    {
        const S = Palette.stone;
        const worn = '#383b3f';
        const brickShades = [S.mid, S.mid, worn, S.mid];

        for (let dy = 0; dy < h; dy++)
        {
            for (let dx = 0; dx < w; dx++)
            {
                const ax = x + dx;
                const ay = y + dy;
                const course = Math.floor(ay / 3);
                const rowInCourse = ay % 3;
                const shift = course % 2 ? 3 : 0;
                const isMortar = rowInCourse === 2 || (ax + shift) % 6 === 5;

                let color: string;
                if (isMortar)
                {
                    color = S.dark;
                }
                else
                {
                    color = brickShades[hash2(course, Math.floor((ax + shift) / 6)) % brickShades.length];
                    if (rowInCourse === 0 && color === S.mid) color = S.light; // lit top edge of each brick
                }

                if (this.rng() < 0.03) color = S.darkest; // cracks
                if (dy >= h - 2 && this.rng() < 0.45) color = S.moss;
                else if (dy === h - 3 && this.rng() < 0.15) color = S.moss;

                this.set(ax, ay, color);
            }
        }
    }

    /** Flat stone surface seen from above (wall-walks, tower tops). */
    stoneTop (x: number, y: number, w: number, h: number): void
    {
        const S = Palette.stone;
        for (let dy = 0; dy < h; dy++)
        {
            for (let dx = 0; dx < w; dx++)
            {
                const r = this.rng();
                const color = dy === h - 1 ? S.mid : r < 0.15 ? S.pale : r < 0.25 ? S.mid : S.light;
                this.set(x + dx, y + dy, color);
            }
        }
    }

    /** Battlements: alternating raised blocks along the top of a wall. */
    crenellations (x: number, y: number, w: number): void
    {
        const S = Palette.stone;
        for (let dx = 0; dx < w; dx++)
        {
            if ((x + dx) % 4 >= 2) continue;
            this.set(x + dx, y, S.pale);
            this.set(x + dx, y + 1, S.light);
            this.set(x + dx, y + 2, S.mid);
        }
    }

    /** Vertical dark wooden planks. */
    planks (x: number, y: number, w: number, h: number): void
    {
        const W = Palette.wood;
        for (let dy = 0; dy < h; dy++)
        {
            for (let dx = 0; dx < w; dx++)
            {
                const phase = (x + dx) % 4;
                let color: string = phase === 0 ? W.dark : phase === 1 ? W.light : W.mid;
                if (dy === h - 1) color = W.dark;
                if (this.rng() < 0.02) color = W.dark;
                this.set(x + dx, y + dy, color);
            }
        }
    }

    /** Rows of overlapping slate tiles, seen from above at an angle. */
    slateRoof (x: number, y: number, w: number, h: number): void
    {
        const slate = Palette.slate;
        for (let dy = 0; dy < h; dy++)
        {
            const tier = Math.floor(dy / 3);
            const rowInTier = dy % 3;
            for (let dx = 0; dx < w; dx++)
            {
                const isTileEdge = (x + dx + (tier % 2) * 2) % 4 === 0;
                let color: string = rowInTier === 2 ? slate[0] : isTileEdge ? slate[1] : rowInTier === 0 ? slate[3] : slate[2];
                if (this.rng() < 0.03) color = Palette.stone.moss;
                this.set(x + dx, y + dy, color);
            }
        }
    }

    /** Draw a dark outline around every shape (into the reserved border too). */
    outline (color: string): void
    {
        const W = this.bufferWidth;
        const H = this.bufferHeight;
        const source = this.pixels.slice();
        const filled = (bx: number, by: number) =>
            bx >= 0 && by >= 0 && bx < W && by < H && source[by * W + bx] !== null;

        for (let by = 0; by < H; by++)
        {
            for (let bx = 0; bx < W; bx++)
            {
                if (source[by * W + bx] !== null) continue;
                if (filled(bx - 1, by) || filled(bx + 1, by) || filled(bx, by - 1) || filled(bx, by + 1))
                {
                    this.pixels[by * W + bx] = color;
                }
            }
        }
    }

    toTexture (scene: Scene, key: string): void
    {
        if (scene.textures.exists(key)) return;

        const texture = scene.textures.createCanvas(key, this.bufferWidth, this.bufferHeight);
        if (!texture) return;

        const ctx = texture.getContext();
        for (let by = 0; by < this.bufferHeight; by++)
        {
            for (let bx = 0; bx < this.bufferWidth; bx++)
            {
                const color = this.pixels[by * this.bufferWidth + bx];
                if (!color) continue;
                ctx.fillStyle = color;
                ctx.fillRect(bx, by, 1, 1);
            }
        }
        texture.refresh();
    }
}

/**
 * Make a texture from a text "pixel map": each character is one pixel,
 * looked up in `colors` ('.' or any unlisted character = transparent).
 */
export function textureFromPixelMap (scene: Scene, key: string, rows: readonly string[], colors: Record<string, string>): void
{
    if (scene.textures.exists(key)) return;

    const width = Math.max(...rows.map((row) => row.length));
    const texture = scene.textures.createCanvas(key, width, rows.length);
    if (!texture) return;

    const ctx = texture.getContext();
    rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++)
        {
            const color = colors[row[x]];
            if (!color) continue;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 1, 1);
        }
    });
    texture.refresh();
}

/** Small deterministic hash of two integers (for picking brick shades etc.). */
export function hash2 (a: number, b: number): number
{
    return ((Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0);
}
