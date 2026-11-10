import { Input, Scene } from 'phaser';
import type { Vec2 } from '../logic/Types';

type Key = Input.Keyboard.Key;

/**
 * Turns keyboard keys into a simple movement direction.
 * Gameplay code only ever sees the direction, not the keys, so other
 * sources (touch, gamepad, network) can be swapped in later.
 */
export class KeyboardControls
{
    private keys: { up: Key; down: Key; left: Key; right: Key; upArrow: Key; downArrow: Key; leftArrow: Key; rightArrow: Key; split: Key };

    constructor (scene: Scene)
    {
        const keyboard = scene.input.keyboard;
        if (!keyboard)
        {
            throw new Error('Keyboard input is not available.');
        }

        const codes = Input.Keyboard.KeyCodes;
        this.keys = keyboard.addKeys({
            up: codes.W,
            down: codes.S,
            left: codes.A,
            right: codes.D,
            upArrow: codes.UP,
            downArrow: codes.DOWN,
            leftArrow: codes.LEFT,
            rightArrow: codes.RIGHT,
            split: codes.SPACE,
        }) as KeyboardControls['keys'];
    }

    /** True once per press of SPACE (the "split army" command). */
    consumeSplitPress (): boolean
    {
        return Input.Keyboard.JustDown(this.keys.split);
    }

    /** Each axis is -1, 0 or 1. */
    getMoveDirection (): Vec2
    {
        const k = this.keys;
        const left = k.left.isDown || k.leftArrow.isDown;
        const right = k.right.isDown || k.rightArrow.isDown;
        const up = k.up.isDown || k.upArrow.isDown;
        const down = k.down.isDown || k.downArrow.isDown;

        return {
            x: (right ? 1 : 0) - (left ? 1 : 0),
            y: (down ? 1 : 0) - (up ? 1 : 0),
        };
    }
}
