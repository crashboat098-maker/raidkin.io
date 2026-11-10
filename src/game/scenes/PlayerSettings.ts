import { ARMY_COLORS, type ArmyColor } from '../render/Palette';

/**
 * The player's chosen army name and colour (from the start screen).
 * Kept for "Play Again", and saved in the browser so it survives a reload.
 */
export interface PlayerSettings {
    name: string;
    color: ArmyColor;
}

export const NAME_MAX_LENGTH = 16;
export const DEFAULT_SETTINGS: PlayerSettings = { name: 'WARLORD', color: 'crimson' };

/** Characters the pixel font can draw (it has no lowercase). */
const ALLOWED = /^[A-Z0-9 .!\-']$/;

/** Is this single character allowed in an army name (after upper-casing)? */
export function isNameChar (char: string): boolean
{
    return char.length === 1 && ALLOWED.test(char.toUpperCase());
}

/** Upper-case, drop characters the font can't draw, trim, limit to 16. Falls back to the default. */
export function sanitizeName (raw: string): string
{
    const cleaned = [...raw.toUpperCase()].filter(isNameChar).join('').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH).trim();
    return cleaned.length > 0 ? cleaned : DEFAULT_SETTINGS.name;
}

const STORAGE_KEY = 'raidkin.playerSettings';

export function loadSettings (): PlayerSettings
{
    try
    {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
        const color = ARMY_COLORS.includes(parsed.color as ArmyColor) ? parsed.color as ArmyColor : DEFAULT_SETTINGS.color;
        return { name: sanitizeName(parsed.name ?? ''), color };
    }
    catch
    {
        return { ...DEFAULT_SETTINGS }; // storage blocked (private mode etc.): just use defaults
    }
}

export function saveSettings (settings: PlayerSettings): void
{
    try
    {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    catch
    {
        // Storage unavailable: selections still carry over within this session.
    }
}
