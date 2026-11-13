import type { Scene, Sound } from 'phaser';

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
    start: { key: 'music-start', urls: ['assets/music/start-theme.ogg', 'assets/music/start-theme.mp3'], volume: 0.45, startAt: 10 },
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

let current: Sound.BaseSound | null = null;
let currentKey: string | null = null;
let fadeTimer: number | null = null;

/** Play `track` on a loop, fading in (nothing happens if it's already playing). */
export function playMusic (scene: Scene, track: MusicTrack, fadeInMs = 1500): void
{
    if (currentKey === track.key && current) return;
    stopMusic(400);
    currentKey = track.key;
    const start = () => {
        if (currentKey !== track.key) return; // something else was asked for meanwhile
        const sound = scene.sound.add(track.key, { loop: true, volume: 0 });
        current = sound;
        const begin = () => { if (current === sound) { sound.play({ seek: track.startAt ?? 0 }); ramp(sound, 0, track.volume, fadeInMs); } };
        if (scene.sound.locked) scene.sound.once('unlocked', begin);
        else begin();
    };
    if (scene.cache.audio.exists(track.key)) { start(); return; }
    scene.load.audio(track.key, track.urls);
    scene.load.once(`filecomplete-audio-${track.key}`, start);
    scene.load.start();
}

/** Fade the current track out and stop it. */
export function stopMusic (fadeOutMs = 800): void
{
    const sound = current;
    current = null;
    currentKey = null;
    if (!sound) return;
    const from = (sound as Sound.BaseSound & { volume: number }).volume ?? 0;
    ramp(sound, from, 0, fadeOutMs, () => sound.destroy());
}

/** Change a sound's volume smoothly (timers, not tweens: the scene may be closing). */
function ramp (sound: Sound.BaseSound, from: number, to: number, ms: number, done?: () => void): void
{
    if (fadeTimer !== null && done === undefined) window.clearInterval(fadeTimer);
    const steps = Math.max(1, Math.round(ms / FADE_STEP_MS));
    let step = 0;
    const timer = window.setInterval(() => {
        step++;
        const v = from + (to - from) * Math.min(1, step / steps);
        (sound as Sound.BaseSound & { setVolume (v: number): unknown }).setVolume?.(v);
        if (step >= steps) { window.clearInterval(timer); if (fadeTimer === timer) fadeTimer = null; done?.(); }
    }, FADE_STEP_MS);
    if (done === undefined) fadeTimer = timer;
}
