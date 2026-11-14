import type { Scene, Sound } from 'phaser';
import startThemeMp3 from '../../assets/music/start-theme.mp3';
import startThemeOgg from '../../assets/music/start-theme.ogg';

/**
 * Background music: one looping track at a time, shared by every scene
 * (Phaser's sound manager is global). Tracks load on demand, so they never
 * hold up the game starting; browsers only allow sound after the first tap
 * or key press, so a track asked for before that starts the moment it's allowed.
 */

export interface MusicTrack {
    key: string;
    /** OGG first (smaller), MP3 for browsers without OGG (Safari). */
    urls: string[];
    volume: number;
    /** Where the track starts the first time (seconds); loops go back to the very start. */
    startAt?: number;
}

export const Music = {
    /** "4 DFM" from the Dark Fantasy Music Pack Vol.1: the start screen. */
    start: { key: 'music-start', urls: [startThemeOgg, startThemeMp3], volume: 0.45, startAt: 10 },
} satisfies Record<string, MusicTrack>;

const FADE_STEP_MS = 50;
const MUTE_KEY = 'raidkin.muted';

/** Is sound muted? (Remembered in this browser.) */
export function isMuted (): boolean
{
    try { return localStorage.getItem(MUTE_KEY) === '1'; }
    catch { return false; }
}

/** Mute or unmute all sound, and remember the choice. */
export function setMuted (scene: Scene, muted: boolean): void
{
    scene.sound.mute = muted;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); }
    catch { /* private mode: it just won't be remembered */ }
}

type Volumed = Sound.BaseSound & { volume: number; setVolume (v: number): unknown };

let current: Volumed | null = null;
let currentKey: string | null = null;
/** The fade running on each sound (a new fade on a sound cancels its old one). */
const fades = new Map<Sound.BaseSound, number>();

/** Play `track` on a loop, fading in (nothing happens if it's already playing). */
export function playMusic (scene: Scene, track: MusicTrack, fadeInMs = 1500): void
{
    if (currentKey === track.key && current) return;
    stopMusic(400);
    currentKey = track.key;
    const start = () => {
        if (currentKey !== track.key) return; // something else was asked for (or it was stopped) meanwhile
        const sound = scene.sound.add(track.key, { loop: true, volume: 0 }) as Volumed;
        current = sound;
        const begin = () => {
            if (current !== sound) return; // stopped before the browser allowed sound
            sound.play({ seek: track.startAt ?? 0 });
            ramp(sound, 0, track.volume, fadeInMs);
        };
        if (scene.sound.locked) scene.sound.once('unlocked', begin);
        else begin();
    };
    if (scene.cache.audio.exists(track.key)) { start(); return; }
    scene.load.audio(track.key, track.urls);
    scene.load.once(`filecomplete-audio-${track.key}`, start);
    scene.load.start();
}

/** Fade the current track out, then stop and remove it (also if it never got to play). */
export function stopMusic (fadeOutMs = 800): void
{
    const sound = current;
    current = null;
    currentKey = null;
    if (!sound) return;
    const end = () => { cancelFade(sound); sound.stop(); sound.destroy(); };
    if (!sound.isPlaying || fadeOutMs <= 0) { end(); return; }
    ramp(sound, sound.volume, 0, fadeOutMs, end);
}

/** Change a sound's volume smoothly (timers, not tweens: the scene may be closing). */
function ramp (sound: Volumed, from: number, to: number, ms: number, done?: () => void): void
{
    cancelFade(sound);
    const steps = Math.max(1, Math.round(ms / FADE_STEP_MS));
    let step = 0;
    const timer = window.setInterval(() => {
        step++;
        try { sound.setVolume(from + (to - from) * Math.min(1, step / steps)); }
        catch { step = steps; } // the sound is gone: just finish
        if (step < steps) return;
        cancelFade(sound);
        done?.();
    }, FADE_STEP_MS);
    fades.set(sound, timer);
}

function cancelFade (sound: Sound.BaseSound): void
{
    const timer = fades.get(sound);
    if (timer === undefined) return;
    window.clearInterval(timer);
    fades.delete(sound);
}
