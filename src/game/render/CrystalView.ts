import { Scene } from 'phaser';
import type { BattlefieldLayout } from '../logic/BattlefieldLayout';
import { crystalAt } from '../logic/Biomes';
import { CRYSTAL_GLOW } from '../logic/CrystalBiome';
import { createRng } from '../logic/Random';
import { Depth } from './BattlefieldView';
import { firefly } from './ForestView';
import { addGlow } from './Glow';
import { NatureTex } from './NatureArt';

/**
 * The crystal biome's static look: soft glows on the giant crystals, motes of
 * light drifting between them, and the arena's floor and walls (drawn once;
 * part of the culled scenery). The arena's moving parts are in ArenaView.
 */

export const ArenaTex = {
    Floor: 'arena-floor',
    Wall: 'arena-wall',
    Gate: 'arena-gate',
    GateOpen: 'arena-gate-open',
};

/** Only some crystals glow, so the biome shimmers rather than blazes. */
const MAX_CRYSTAL_GLOWS = 40;
const MOTES = 70;

export function addCrystalLife (scene: Scene, layout: BattlefieldLayout): void
{
    const biomes = layout.biomes;
    if (!biomes) return;
    let glows = 0;
    for (const d of layout.decorations)
    {
        if (d.kind !== 'giantCrystal' || glows >= MAX_CRYSTAL_GLOWS) continue;
        glows++;
        addGlow(scene, d.x, d.y - 20, CRYSTAL_GLOW[d.variant % 3], { scale: 0.9, depth: d.y + 1, duration: 1800, minAlpha: 0.2, maxAlpha: 0.45 });
    }
    const { playArea } = layout;
    let placed = 0;
    for (let attempt = 0; attempt < MOTES * 30 && placed < MOTES; attempt++)
    {
        const x = playArea.x + Math.random() * playArea.width;
        const y = playArea.y + Math.random() * playArea.height;
        if (crystalAt(biomes, x, y) < 0.5) continue;
        placed++;
        firefly(scene, x, y, CRYSTAL_GLOW);
    }
}

/** The arena's floor and wall, plus the crystal pillars around it. */
export function buildArenaScenery (scene: Scene, layout: BattlefieldLayout): void
{
    const site = layout.arena;
    if (!site) return;
    createArenaTextures(scene, site.radius);
    const { center, radius, wall } = site;
    scene.add.image(center.x, center.y, ArenaTex.Floor).setDepth(Depth.FlatDecorations + 0.3);

    // The wall: stone blocks around the ring, sorted with the soldiers (so you can
    // stand in front of the south side and behind the north side). Gates leave gaps
    // in the drawing (the gate sprites fill them, see ArenaView).
    const r = radius + wall / 2;
    const count = Math.ceil((Math.PI * 2 * r) / 11);
    const gateAngles = site.zones.map((z) => Math.atan2(z.dir.y, z.dir.x));
    const nearGate = (a: number, within: number) => gateAngles.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < within);
    for (let k = 0; k < count; k++)
    {
        const a = (k / count) * Math.PI * 2;
        if (nearGate(a, 0.09)) continue;
        const x = Math.round(center.x + Math.cos(a) * r);
        const y = Math.round(center.y + Math.sin(a) * r);
        scene.add.image(x, y + 6, ArenaTex.Wall).setOrigin(0.5, 1).setDepth(y + 6);
    }
    // Crystal pillars on the wall, in the three crystal colours.
    const rng = createRng(0xa7e);
    for (let k = 0; k < 16; k++)
    {
        const a = ((k + 0.5) / 16) * Math.PI * 2;
        if (nearGate(a, 0.3)) continue;
        const x = Math.round(center.x + Math.cos(a) * r);
        const y = Math.round(center.y + Math.sin(a) * r);
        const variant = k % 3 + (rng() < 0.5 ? 3 : 0);
        scene.add.image(x, y + 7, NatureTex.giantCrystal(variant)).setOrigin(0.5, 1).setScale(0.75).setDepth(y + 7.5);
        addGlow(scene, x, y - 10, CRYSTAL_GLOW[variant % 3], { scale: 0.7, depth: y + 8, duration: 2000, minAlpha: 0.2, maxAlpha: 0.45 });
    }
}

/** Floor, wall block and gate textures (painted once). */
function createArenaTextures (scene: Scene, radius: number): void
{
    if (!scene.textures.exists(ArenaTex.Floor))
    {
        const size = radius * 2 + 4;
        const tex = scene.textures.createCanvas(ArenaTex.Floor, size, size);
        if (tex)
        {
            const ctx = tex.getContext();
            const c = size / 2;
            const rng = createRng(0xf100);
            // Flagstones in rings, slightly varied; a crystal inlay ring; a star in the middle.
            const cell = 4;
            for (let y = 0; y < size; y += cell)
            {
                for (let x = 0; x < size; x += cell)
                {
                    const d = Math.hypot(x + cell / 2 - c, y + cell / 2 - c);
                    if (d > radius + 1) continue;
                    const ring = Math.floor(d / 22);
                    const a = Math.atan2(y - c, x - c);
                    const stone = Math.floor((a + Math.PI) / (Math.PI * 2) * (8 + ring * 6));
                    const shade = ((ring + stone) % 3) * 6 + Math.floor(rng() * 5);
                    ctx.fillStyle = `rgb(${92 + shade}, ${96 + shade}, ${118 + shade})`;
                    // Mortar lines between rings and between stones.
                    if (d % 22 < 1.6 || ((a + Math.PI) / (Math.PI * 2) * (8 + ring * 6)) % 1 < 0.06) ctx.fillStyle = '#4a4e66';
                    if (Math.abs(d - radius * 0.72) < 3) ctx.fillStyle = ['#7fd4ff', '#c79bff', '#8dffb5'][Math.floor((a + Math.PI) / (Math.PI / 6)) % 3];
                    ctx.fillRect(x, y, cell, cell);
                }
            }
            // The worn sand-dusted centre and a star emblem.
            ctx.fillStyle = 'rgba(200, 190, 160, 0.18)';
            ctx.beginPath(); ctx.arc(c, c, radius * 0.45, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#c79bff';
            for (let k = 0; k < 4; k++)
            {
                const a = (k / 4) * Math.PI * 2;
                for (let t = 0; t < 26; t += 2) ctx.fillRect(Math.round(c + Math.cos(a) * t) - 1, Math.round(c + Math.sin(a) * t) - 1, 3, 3);
            }
            ctx.fillStyle = '#e8f6ff';
            ctx.fillRect(c - 3, c - 3, 6, 6);
            tex.refresh();
        }
    }
    const block = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
        if (scene.textures.exists(key)) return;
        const tex = scene.textures.createCanvas(key, w, h);
        if (!tex) return;
        draw(tex.getContext());
        tex.refresh();
    };
    // 14 x 18: a wall block (lit top, dark face, mortar lines).
    block(ArenaTex.Wall, 14, 18, (ctx) => {
        ctx.fillStyle = '#20223a'; ctx.fillRect(0, 0, 14, 18);
        ctx.fillStyle = '#6a7090'; ctx.fillRect(1, 1, 12, 5);
        ctx.fillStyle = '#8a90b0'; ctx.fillRect(1, 1, 12, 1);
        ctx.fillStyle = '#464b68'; ctx.fillRect(1, 6, 12, 11);
        ctx.fillStyle = '#353954'; ctx.fillRect(1, 11, 12, 1); ctx.fillRect(7, 6, 1, 5); ctx.fillRect(3, 12, 1, 5); ctx.fillRect(10, 12, 1, 5);
    });
    // 30 x 30: a gate (stone arch, closed portcullis / open dark passage).
    const gate = (open: boolean) => (ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = '#20223a'; ctx.fillRect(0, 0, 30, 30);
        ctx.fillStyle = '#6a7090'; ctx.fillRect(1, 1, 28, 6);
        ctx.fillStyle = '#8a90b0'; ctx.fillRect(1, 1, 28, 1);
        ctx.fillStyle = '#464b68'; ctx.fillRect(1, 7, 6, 22); ctx.fillRect(23, 7, 6, 22);
        ctx.fillStyle = open ? '#0c0d18' : '#2a2c44'; ctx.fillRect(7, 9, 16, 20);
        if (!open)
        {
            ctx.fillStyle = '#9aa0c0';
            for (let x = 9; x < 23; x += 3) ctx.fillRect(x, 9, 1, 20);
            for (let y = 12; y < 29; y += 5) ctx.fillRect(7, y, 16, 1);
        }
        ctx.fillStyle = '#c79bff'; ctx.fillRect(14, 3, 2, 2);
    };
    block(ArenaTex.Gate, 30, 30, gate(false));
    block(ArenaTex.GateOpen, 30, 30, gate(true));
}
