import type { Vec2 } from '../logic/Types';

/**
 * Dynamic camera zoom (pure maths, no Phaser, so it can be tested).
 *
 * Measures how far the army actually spreads from the camera's centre (every
 * soldier, every cluster, so splits count) and picks a zoom that keeps it all
 * comfortably on screen: close in for a handful of soldiers, further out as
 * the army grows or spreads. Two layers of smoothing stop jitter:
 *  1. the measured spread is filtered (it grows quickly, shrinks slowly),
 *  2. the zoom eases toward its target, with a tiny dead zone.
 */

export interface ZoomSettings {
    minZoom: number;
    maxZoom: number;
    /** Keep this many times the army's spread visible around its centre... */
    spreadMargin: number;
    /** ...plus this much extra room (world px). */
    paddingWorld: number;
    /** Per-second easing rates. Zooming out reacts faster than zooming in. */
    zoomOutRate: number;
    zoomInRate: number;
}

/** Ignore target changes smaller than this fraction (stops micro-wobble). */
const DEAD_ZONE = 0.004;

export class ZoomController
{
    zoom: number;
    /** Smoothed army spread (world px). */
    private spread = 0;

    /**
     * @param viewHeight The game view's height in screen px (720). The shorter
     *   side limits how much fits, so it's the one we size against.
     */
    constructor (private readonly settings: ZoomSettings, private readonly viewHeight: number, startZoom = settings.maxZoom)
    {
        this.zoom = clamp(startZoom, settings.minZoom, settings.maxZoom);
    }

    /** The zoom that would fit an army spreading `spread` world px from its centre. */
    targetFor (spread: number): number
    {
        const { minZoom, maxZoom, spreadMargin, paddingWorld } = this.settings;
        const neededHalfHeight = spread * spreadMargin + paddingWorld;
        return clamp((this.viewHeight / 2) / neededHalfHeight, minZoom, maxZoom);
    }

    /**
     * Advance one frame and return the new zoom.
     * @param points Every soldier's position (all clusters).
     * @param centre What the camera is centred on.
     */
    update (points: readonly Vec2[], centre: Vec2, dt: number): number
    {
        if (points.length === 0) return this.zoom; // nothing to frame (e.g. defeated): hold still

        // Far edge of the army, measured from the camera's centre. Using a high
        // percentile rather than the absolute max ignores a lone straggler.
        let measured = 0;
        if (points.length <= 12)
        {
            for (const p of points) measured = Math.max(measured, Math.hypot(p.x - centre.x, p.y - centre.y));
        }
        else
        {
            const d = points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y)).sort((a, b) => a - b);
            measured = d[Math.floor(d.length * 0.95)];
        }

        // 1. Filter the spread: grow quickly (don't let the army run off screen), shrink slowly.
        const spreadRate = measured > this.spread ? 3 : 0.6;
        this.spread += (measured - this.spread) * Math.min(1, dt * spreadRate);

        // 2. Ease the zoom toward its target.
        const target = this.targetFor(this.spread);
        if (Math.abs(target - this.zoom) / this.zoom < DEAD_ZONE) return this.zoom;
        const rate = target < this.zoom ? this.settings.zoomOutRate : this.settings.zoomInRate;
        this.zoom += (target - this.zoom) * Math.min(1, dt * rate);
        this.zoom = clamp(this.zoom, this.settings.minZoom, this.settings.maxZoom);
        return this.zoom;
    }
}

function clamp (v: number, min: number, max: number): number
{
    return Math.max(min, Math.min(max, v));
}
