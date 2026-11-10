import { Input, Scene } from 'phaser';
import type { Vec2 } from '../logic/Types';

type Key = Input.Keyboard.Key;

/** Mouse steering: inside this many screen pixels of the army the army stops... */
const MOUSE_DEAD_ZONE = 14;
/** ...and from this far out it moves at full speed (slower in between, so it eases to a stop). */
const MOUSE_FULL_SPEED = 90;

/**
 * Turns the mouse (or WASD / arrow keys) into a simple movement direction.
 * The army walks toward the mouse pointer; holding a movement key takes
 * over from the mouse. Gameplay code only ever sees the direction, not the
 * keys or pointer, so other sources (touch, gamepad, network) can be swapped in later.
 */
export class KeyboardControls
{
    private keys: { up: Key; down: Key; left: Key; right: Key; upArrow: Key; downArrow: Key; leftArrow: Key; rightArrow: Key; split: Key; surrender: Key };
    /** The mouse only steers once it has moved over the game (not straight after the start screen). */
    private mouseActive = false;
    /** A right-click since the last frame (surrender a soldier toward the mouse). */
    private rightClicked = false;

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

        scene.input.on(Input.Events.POINTER_MOVE, () => { this.mouseActive = true; });
        // Right-click surrenders a soldier, so keep the browser's menu out of the way.
        scene.input.mouse?.disableContextMenu();
        scene.input.on(Input.Events.POINTER_DOWN, (pointer: Input.Pointer) => {
            if (pointer.rightButtonDown()) { this.rightClicked = true; this.mouseActive = true; }
        });
    }

    /**
     * Once per press of Q or right-click: the direction to send a surrendered
     * soldier (from the army toward the mouse pointer). Null on other frames.
     * Without a usable mouse position it uses `fallback` (the way the army faces).
     */
    consumeSurrender (armyPosition: Vec2, fallback: Vec2): Vec2 | null
    {
        const pressed = Input.Keyboard.JustDown(this.keys.surrender) || this.rightClicked;
        this.rightClicked = false;
        if (!pressed) return null;

        if (this.mouseActive)
        {
            const camera = this.scene.cameras.main;
            const pointer = this.scene.input.activePointer;
            const target = camera.getWorldPoint(pointer.x, pointer.y);
            const dx = target.x - armyPosition.x;
            const dy = target.y - armyPosition.y;
            if (Math.hypot(dx, dy) > 1) return { x: dx, y: dy };
        }
        return Math.hypot(fallback.x, fallback.y) > 0 ? { ...fallback } : { x: 1, y: 0 };
    }

    /** True once per press of SPACE (the "split army" command). */
    consumeSplitPress (): boolean
    {
        return Input.Keyboard.JustDown(this.keys.split);
    }

    /**
     * Movement direction, each axis -1..1. Keys win if any are held;
     * otherwise the army heads for the mouse pointer.
     *
     * @param armyPosition Where the army is (world pixels), to aim from.
     */
    getMoveDirection (armyPosition: Vec2): Vec2
    {
        const k = this.keys;
        const left = k.left.isDown || k.leftArrow.isDown;
        const right = k.right.isDown || k.rightArrow.isDown;
        const up = k.up.isDown || k.upArrow.isDown;
        const down = k.down.isDown || k.downArrow.isDown;

        if (left || right || up || down)
        {
            return {
                x: (right ? 1 : 0) - (left ? 1 : 0),
                y: (down ? 1 : 0) - (up ? 1 : 0),
            };
        }

        return this.mouseDirection(armyPosition);
    }

    private mouseDirection (armyPosition: Vec2): Vec2
    {
        const input = this.scene.input;
        if (!this.mouseActive || !input.manager.isOver) return { x: 0, y: 0 };

        const camera = this.scene.cameras.main;
        const pointer = input.activePointer;
        const target = camera.getWorldPoint(pointer.x, pointer.y);
        const dx = target.x - armyPosition.x;
        const dy = target.y - armyPosition.y;
        // Measure in screen pixels so it feels the same at every zoom level.
        const screenDistance = Math.hypot(dx, dy) * camera.zoom;
        if (screenDistance <= MOUSE_DEAD_ZONE) return { x: 0, y: 0 };

        const strength = Math.min(1, (screenDistance - MOUSE_DEAD_ZONE) / (MOUSE_FULL_SPEED - MOUSE_DEAD_ZONE));
        const length = Math.hypot(dx, dy);
        return { x: (dx / length) * strength, y: (dy / length) * strength };
    }
}
