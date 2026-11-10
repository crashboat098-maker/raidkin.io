import { Battlefield } from './scenes/Battlefield';
import { Defeat } from './scenes/Defeat';
import { Hud } from './scenes/Hud';
import { Start } from './scenes/Start';
import { GameConfig } from './config/GameConfig';
import { netClient } from './net/NetClient';
import { AUTO, Game, Scale, Types } from 'phaser';

// Find out more information about the Game Config at:
// https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Types.Core.GameConfig = {
    type: AUTO,
    width: GameConfig.screen.width,
    height: GameConfig.screen.height,
    parent: 'game-container',
    backgroundColor: '#070906',
    // Keep pixel art crisp (no blurring when scaled up).
    pixelArt: true,
    roundPixels: true,
    scale: {
        mode: Scale.FIT,
        autoCenter: Scale.CENTER_BOTH
    },
    // Only the first scene starts automatically:
    // Start (name + colour) -> Battlefield (+ Hud on top) -> Defeat -> Play Again.
    scene: [
        Start,
        Battlefield,
        Hud,
        Defeat
    ]
};

const StartGame = (parent: string) => {
    // Connect to the multiplayer server in the background (if this page has one).
    netClient.start();
    const game = new Game({ ...config, parent });
    // Development only (not in production builds): lets automated tests
    // inspect and drive the running game from the browser console.
    if (import.meta.env.DEV) (window as unknown as { raidkin?: Game }).raidkin = game;
    return game;
}

export default StartGame;
