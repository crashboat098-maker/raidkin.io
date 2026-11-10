/**
 * RAIDKIN.IO dark-fantasy colour palette.
 * Muted, earthy greens and greys, with a few small glowing accents.
 * The commander uses brighter steel and crimson so they stand out.
 */
export const Palette = {
    outline: '#0a0c09',

    // Milestone 4: daytime palette. Still muted and earthy, but brighter and
    // more natural so armies and health bars read clearly.
    grass: ['#3a5229', '#415b2f', '#4a6636', '#56733e'],
    // Kept close to `grass` so patch edges read as soft shading, not blocky squares.
    darkGrass: ['#324826', '#364e29', '#3e582f'],
    dirt: ['#5b4b36', '#66553e', '#746147'],
    canopy: ['#1a3020', '#213b26', '#2a482e', '#355637'],
    /** Worn dirt trails, a bit lighter than dirt patches so they read as paths. */
    trail: ['#7a6849', '#867352', '#94805d'],

    foliage: { darkest: '#1d3922', dark: '#27482a', mid: '#335a33', light: '#467243' },
    /** Large old trees: deep, slightly cool green. */
    treeFoliage: ['#1b3826', '#25492f', '#305b3a', '#3d6e47'],
    grassBlade: { light: '#7a9655', mid: '#5a7840', dark: '#40592e' },
    bone: { light: '#c9c2ad', shade: '#8f8a7a' },
    stone: { darkest: '#1c1e21', dark: '#2b2e32', mid: '#42464b', light: '#5f646a', pale: '#7a8087', moss: '#2f4127' },
    wood: { dark: '#221913', mid: '#3a2c21', light: '#58442f' },
    /** Dark slate roof tiles, dark to light. */
    slate: ['#1a1a22', '#272733', '#363645', '#4a4a5c'],
    /** Openings: doorways, gates, arrow slits. */
    void: '#0b0a09',
    /** Warm light from windows and torches. */
    windowLit: '#c9822e',
    flame: ['#ff8a2a', '#ffd27a'],
    courtyard: '#2a251d',
    mushroomStem: '#8d968c',

    /** Soul Shards: cyan-blue magical crystals, dark to light. */
    shard: { deep: '#0e5f8a', dark: '#1ea7d6', mid: '#4fe3ff', pale: '#d6fbff', outline: '#071a24' },

    /** Decorative magic glows. Cyan is reserved for Soul Shards so collectibles stand out. */
    accent: { green: '#7dffa8', purple: '#b07aff', amber: '#ffb347' },
    accentPale: { green: '#e0ffe9', purple: '#eadcff', amber: '#fff0cf' },

    commander: {
        helmLight: '#c0c9d1',
        helm: '#7f8992',
        visor: '#14161a',
        eye: '#ffb347',
        armorLight: '#9ea8b1',
        armor: '#5d666e',
        cloak: '#8a2228',
        cloakDark: '#541419',
        gold: '#d9a441',
        blade: '#e4edf4',
        leather: '#3b2a1d',
    },

    /** Neutral Warriors: dull, unaligned colours (no crimson). */
    neutral: {
        helmLight: '#8e8f86',
        helm: '#5f615b',
        armorLight: '#7a7c74',
        armor: '#4d4f4a',
        tabard: '#5c5242',
        tabardDark: '#3d362b',
        trim: '#7a6a48',
        blade: '#a7aca8',
    },

    /**
     * Army colours (tabards). Distinct hues, kept slightly muted so they fit
     * the world. 'crimson' is the human player; bots get the others.
     */
    armies: {
        crimson: { main: '#8a2228', dark: '#541419', name: 'CRIMSON' },
        azure: { main: '#2f5fa6', dark: '#1d3b6a', name: 'AZURE' },
        // Brighter, bluish green so it doesn't vanish against the grass.
        emerald: { main: '#2fa463', dark: '#1a643b', name: 'EMERALD' },
        violet: { main: '#6c3c9c', dark: '#43245f', name: 'VIOLET' },
        gold: { main: '#b8911f', dark: '#755c12', name: 'GOLD' },
        ember: { main: '#c0612a', dark: '#7a3a17', name: 'EMBER' },
    },

    health: { high: '#5cc24a', mid: '#e0c23a', low: '#d8432f', back: '#1a1512' },
    hit: '#fff4d6',

    shadow: 'rgba(0, 0, 0, 0.45)',
} as const;

export type ArmyColor = keyof typeof Palette.armies;
/** The six colours a player can choose, in menu order. */
export const ARMY_COLORS: readonly ArmyColor[] = ['crimson', 'azure', 'emerald', 'violet', 'gold', 'ember'];

/** Colours for the bots: every colour except the human's, in a fixed order. */
export function botColorsFor (humanColor: ArmyColor): ArmyColor[]
{
    const preferred: ArmyColor[] = ['azure', 'gold', 'violet', 'ember', 'emerald', 'crimson'];
    return preferred.filter((c) => c !== humanColor);
}

/** '#ff8800' -> 0xff8800 (the number format Phaser uses for tints). */
export function hexToInt (hex: string): number
{
    return parseInt(hex.slice(1), 16);
}
