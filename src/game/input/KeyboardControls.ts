import { Input, Scene } from 'phaser';
import type { SteerInput } from '../logic/Navigation';
import type { Vec2 } from '../logic/Types';
import { TouchControls } from './TouchControls';

type Key = Input.Keyboard.Key;

/** Mouse steering: inside this many screen pixels of the army the army stops... */
const MOUSE_DEAD_ZONE = 14;
/** ...and from this far out it moves at full speed (slower in between, so it eases to a stop). */
const MOUSE_FULL_SPEED = 90;

/**
 * Turns the player's input into simple commands: a movement direction, and
 * aimed SPLIT / SURRENDER presses.
 *  - Mouse: the army walks toward the pointer. SPACE splits and Q or
 *    right-click surrenders, both aimed at the pointer.
 *  - Keyboard: WASD / arrow keys take over from the mouse while held.
 *  - Touch screens: an on-screen joystick steers (and aims), with SPLIT
 *    and SURRENDER buttons.
 * Gameplay code only ever sees directions, not keys or pointers.
 */
export class KeyboardControls
{
    private keys: { up: Key; down: Key; left: Key; right: Key; upArrow: Key; downArrow: Key; leftArrow: Key; rightArrow: Key; split: Key; surrender: Key };
    /** The mouse only steers once it has moved over the game (not straight after the start screen). */
    private mouseActive = false;
    /** A right-click since the last frame (surrender a soldier toward the mouse). */
    private rightClicked = false;
    private readonly touch: TouchControls | null;

    constructor (private readonly scene: Scene)
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
            surrender: codes.Q,
        }) as KeyboardControls['keys'];

        // Only a real mouse steers by pointing: a finger on the map shouldn't drag the army around.
        scene.input.on(Input.Events.POINTER_MOVE, (pointer: Input.Pointer) => { this.mouseActive = !pointer.wasTouch; });
        // Right-click surrenders a soldier, so keep the browser's menu out of the way.
        scene.input.mouse?.disableContextMenu();
        scene.input.on(Input.Events.POINTER_DOWN, (pointer: Input.Pointer) => {
            if (!pointer.wasTouch && pointer.rightButtonDown()) { this.rightClicked = true; this.mouseActive = true; }
        });

        const parent = scene.game.canvas.parentElement;
        this.touch = parent ? new TouchControls(parent) : null;
        scene.events.once('shutdown', () => this.touch?.destroy());
    }

    /**
     * Once per press of Q, right-click or the SURRENDER button: the direction
     * to send a surrendered soldier. Null on other frames.
     *
     * @param armyPosition Where the army is (world pixels), to aim from.
     * @param fallback Direction to use with nothing to aim with (the way the army faces).
     */
    consumeSurrender (armyPosition: Vec2, fallback: Vec2): Vec2 | null
    {
        const touched = this.touch?.consumeSurrender() ?? false;
        const pressed = Input.Keyboard.JustDown(this.keys.surrender) || this.rightClicked || touched;
        this.rightClicked = false;
        return pressed ? this.aim(armyPosition, fallback) : null;
    }

    /** Once per press of SPACE or the SPLIT button: the direction to split toward. Null on other frames. */
    consumeSplit (armyPosition: Vec2, fallback: Vec2): Vec2 | null
    {
        const touched = this.touch?.consumeSplit() ?? false;
        const pressed = Input.Keyboard.JustDown(this.keys.split) || touched;
        return pressed ? this.aim(armyPosition, fallback) : null;
    }

    /**
     * Movement direction, each axis -1..1. Held keys win, then the joystick;
     * otherwise the army heads for the mouse pointer.
     */
    getMoveDirection (armyPosition: Vec2): SteerInput
    {
        const keys = this.keyDirection();
        if (keys) return keys;
        if (this.touch?.active) return { ...this.touch.direction };
        return this.mouseDirection(armyPosition);
    }

    /** Where the player is aiming: keys, then joystick, then mouse, then `fallback`. */
    private aim (armyPosition: Vec2, fallback: Vec2): Vec2
    {
        const keys = this.keyDirection();
        if (keys) return keys;
        if (this.touch?.active && Math.hypot(this.touch.direction.x, this.touch.direction.y) > 0.1) return { ...this.touch.direction };
        if (this.mouseActive)
        {
            const target = this.pointerWorld();
            const dx = target.x - armyPosition.x;
            const dy = target.y - armyPosition.y;
            if (Math.hypot(dx, dy) > 1) return { x: dx, y: dy };
        }
        return Math.hypot(fallback.x, fallback.y) > 0 ? { ...fallback } : { x: 1, y: 0 };
    }

    private keyDirection (): Vec2 | null
    {
        const k = this.keys;
        const left = k.left.isDown || k.leftArrow.isDown;
        const right = k.right.isDown || k.rightArrow.isDown;
        const up = k.up.isDown || k.upArrow.isDown;
        const down = k.down.isDown || k.downArrow.isDown;
        if (!left && !right && !up && !down) return null;
        return { x: (right ? 1 : 0) - (left ? 1 : 0), y: (down ? 1 : 0) - (up ? 1 : 0) };
    }

    private pointerWorld (): Vec2
    {
        const pointer = this.scene.input.activePointer;
        return this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    }

    private mouseDirection (armyPosition: Vec2): SteerInput
    {
        if (!this.mouseActive || !this.scene.input.manager.isOver) return { x: 0, y: 0 };

        const target = this.pointerWorld();
        const dx = target.x - armyPosition.x;
        const dy = target.y - armyPosition.y;
        // Measure in screen pixels so it feels the same at every zoom level.
        const screenDistance = Math.hypot(dx, dy) * this.scene.cameras.main.zoom;
        if (screenDistance <= MOUSE_DEAD_ZONE) return { x: 0, y: 0 };

        const strength = Math.min(1, (screenDistance - MOUSE_DEAD_ZONE) / (MOUSE_FULL_SPEED - MOUSE_DEAD_ZONE));
        const length = Math.hypot(dx, dy);
        // `reach`: the army plans a route to the pointer itself (around walls, over bridges).
        return { x: (dx / length) * strength, y: (dy / length) * strength, reach: length };
    }
}
