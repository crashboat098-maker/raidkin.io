import { Core, type Game, type Scene } from 'phaser';
import { perfCounters, resetPerfCounters } from '../logic/PerfCounters';

/**
 * Performance overlay: F3 (or `?perf` in the page address, for phones)
 * shows FPS, frame times, soldier and drawn-object counts, collision checks
 * and, online, the connection. Off by default; drawing it is a few text
 * updates a second, and nothing is measured beyond cheap counters while hidden.
 */

export interface PerfSource {
    soldiers: () => number;
    /** Online only: the connection's numbers since the last call. */
    net: (() => { pingMs: number | null; snapshotsPerSecond: number; longestGapMs: number; waitingPercent: number; delayMs: number }) | null;
}

const REFRESH_MS = 500;
const STORAGE_KEY = 'raidkin.perf';

export class PerfOverlay
{
    private readonly box: HTMLDivElement;
    private shown = false;
    private frames = 0;
    private frameMsTotal = 0;
    private worstFrameMs = 0;
    private workMsTotal = 0;
    private worstWorkMs = 0;
    private checksTotal = 0;
    private pathMsTotal = 0;
    private fpsHistory: number[] = [];
    private lastRefresh = performance.now();
    private stepStartedAt = 0;
    private lastFrameAt = 0;
    private readonly onKey = (e: KeyboardEvent) => { if (e.key === 'F3') { e.preventDefault(); this.toggle(); } };
    private readonly onPreStep = () => { this.stepStartedAt = performance.now(); };
    private readonly onPostRender = () => this.measure();

    constructor (private readonly game: Game, private readonly scene: Scene, private readonly source: PerfSource)
    {
        this.box = document.createElement('div');
        Object.assign(this.box.style, {
            position: 'fixed', left: '8px', top: '8px', zIndex: '1000', pointerEvents: 'none',
            font: '12px/1.35 monospace', color: '#e8e0c8', background: 'rgba(8,10,8,0.78)',
            padding: '6px 8px', borderRadius: '4px', whiteSpace: 'pre', display: 'none',
        });
        document.body.appendChild(this.box);
        window.addEventListener('keydown', this.onKey);
        game.events.on(Core.Events.PRE_STEP, this.onPreStep);
        game.events.on(Core.Events.POST_RENDER, this.onPostRender);
        let wanted = new URLSearchParams(location.search).has('perf');
        try { wanted ||= localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage blocked: off */ }
        if (wanted) this.toggle();
    }

    destroy (): void
    {
        window.removeEventListener('keydown', this.onKey);
        this.game.events.off(Core.Events.PRE_STEP, this.onPreStep);
        this.game.events.off(Core.Events.POST_RENDER, this.onPostRender);
        this.box.remove();
    }

    private toggle (): void
    {
        this.shown = !this.shown;
        this.box.style.display = this.shown ? 'block' : 'none';
        try { localStorage.setItem(STORAGE_KEY, this.shown ? '1' : '0'); } catch { /* fine */ }
        this.resetWindow(performance.now());
    }

    /** After each frame is drawn: how long the frame took and what it did. */
    private measure (): void
    {
        const now = performance.now();
        // The game's counters are per frame either way; only add them up while shown.
        const checks = perfCounters.collisionChecks;
        const pathMs = perfCounters.pathMs;
        resetPerfCounters();
        if (!this.shown) return;

        const frameMs = this.lastFrameAt ? now - this.lastFrameAt : 0;
        this.lastFrameAt = now;
        const workMs = now - this.stepStartedAt;
        this.frames++;
        this.frameMsTotal += frameMs;
        this.worstFrameMs = Math.max(this.worstFrameMs, frameMs);
        this.workMsTotal += workMs;
        this.worstWorkMs = Math.max(this.worstWorkMs, workMs);
        this.checksTotal += checks;
        this.pathMsTotal += pathMs;
        if (now - this.lastRefresh >= REFRESH_MS) this.refresh(now);
    }

    private refresh (now: number): void
    {
        const seconds = (now - this.lastRefresh) / 1000;
        const fps = this.frames / seconds;
        this.fpsHistory.push(fps);
        if (this.fpsHistory.length > 20) this.fpsHistory.shift(); // last ~10 s
        const avgFps = this.fpsHistory.reduce((s, x) => s + x, 0) / this.fpsHistory.length;
        const n = Math.max(1, this.frames);

        const lines = [
            `FPS        ${fps.toFixed(0).padStart(4)}   avg ${avgFps.toFixed(0)}`,
            `frame      ${(this.frameMsTotal / n).toFixed(1).padStart(4)} ms  worst ${this.worstFrameMs.toFixed(0)} ms`,
            `work       ${(this.workMsTotal / n).toFixed(1).padStart(4)} ms  worst ${this.worstWorkMs.toFixed(0)} ms  (update + draw)`,
            `soldiers   ${String(this.source.soldiers()).padStart(4)}`,
            `drawn      ${String(this.drawnObjects()).padStart(4)} objects`,
        ];
        if (this.source.net)
        {
            const net = this.source.net();
            lines.push(
                `ping       ${net.pingMs === null ? '   -' : net.pingMs.toFixed(0).padStart(4)} ms`,
                `snapshots  ${net.snapshotsPerSecond.toFixed(1).padStart(4)}/s  longest gap ${net.longestGapMs.toFixed(0)} ms`,
                `waiting    ${net.waitingPercent.toFixed(1).padStart(4)}% of frames  (buffer ${net.delayMs} ms)`,
                `collisions  on the server`,
            );
        }
        else
        {
            lines.push(
                `collisions ${String(Math.round(this.checksTotal / n)).padStart(4)} checks/frame`,
                `routing    ${(this.pathMsTotal / n).toFixed(2).padStart(4)} ms/frame`,
            );
        }
        this.box.textContent = lines.join('\n');
        this.resetWindow(now);
    }

    private resetWindow (now: number): void
    {
        this.frames = 0;
        this.frameMsTotal = 0;
        this.worstFrameMs = 0;
        this.workMsTotal = 0;
        this.worstWorkMs = 0;
        this.checksTotal = 0;
        this.pathMsTotal = 0;
        this.lastRefresh = now;
        this.lastFrameAt = 0;
    }

    /** Objects the battlefield camera actually draws (visible and on its draw list). */
    private drawnObjects (): number
    {
        let count = 0;
        const camera = this.scene.cameras.main;
        for (const o of this.scene.children.list)
        {
            if ((o as unknown as { willRender?: (c: unknown) => boolean }).willRender?.(camera)) count++;
        }
        return count;
    }
}
