import type { Body, ObstacleMap } from './Obstacles';
import type { Rect, Vec2 } from './Types';

/**
 * A point that moves with smooth acceleration and collides with obstacles.
 * The player's army cluster is steered through one of these: an invisible
 * "movement centre" that the soldiers gather around. It has no body on
 * screen and no gameplay role of its own.
 * (Before Milestone 3.5 this was the commander.)
 */

/** Solid footprint of a movement centre: the same size as a Warrior's, so it fits wherever they do. */
export const CENTER_BODY: Body = { halfWidth: 3, height: 3 };

export interface MoverState {
    position: Vec2;
    /** World pixels per second. */
    velocity: Vec2;
    /** 1 = facing right, -1 = facing left. */
    facing: 1 | -1;
    isMoving: boolean;
}

export interface MovementTuning {
    maxSpeed: number;
    acceleration: number;
    deceleration: number;
}

export function createMover (spawn: Vec2): MoverState
{
    return {
        position: { x: spawn.x, y: spawn.y },
        velocity: { x: 0, y: 0 },
        facing: 1,
        isMoving: false,
    };
}

/**
 * Advance a mover by one frame.
 *
 * @param input  Desired direction, each axis -1..1 (from the keyboard today,
 *               from the network or AI later).
 * @param dt     Seconds since the last frame.
 * @param bounds Area the mover must stay inside.
 * @param obstacles Solid things to stop at (optional).
 */
export function updateMover (
    mover: MoverState,
    input: Vec2,
    dt: number,
    bounds: Rect,
    tuning: MovementTuning,
    obstacles?: ObstacleMap,
): void
{
    // 1. Normalise the input so diagonal movement isn't faster.
    let dirX = input.x;
    let dirY = input.y;
    const inputLength = Math.hypot(dirX, dirY);
    if (inputLength > 1)
    {
        dirX /= inputLength;
        dirY /= inputLength;
    }

    // 2. Ease the velocity toward the target velocity (smooth start/stop).
    //    Wading through shallow water slows everyone down.
    const terrain = obstacles?.speedFactorAt(mover.position.x, mover.position.y) ?? 1;
    const targetX = dirX * tuning.maxSpeed * terrain;
    const targetY = dirY * tuning.maxSpeed * terrain;
    const rate = inputLength > 0 ? tuning.acceleration : tuning.deceleration;
    const diffX = targetX - mover.velocity.x;
    const diffY = targetY - mover.velocity.y;
    const diffLength = Math.hypot(diffX, diffY);
    const maxChange = rate * dt;

    if (diffLength <= maxChange)
    {
        mover.velocity.x = targetX;
        mover.velocity.y = targetY;
    }
    else
    {
        mover.velocity.x += (diffX / diffLength) * maxChange;
        mover.velocity.y += (diffY / diffLength) * maxChange;
    }

    // 3. Move, stopping at (and sliding along) obstacles.
    const dx = mover.velocity.x * dt;
    const dy = mover.velocity.y * dt;
    if (obstacles)
    {
        const moved = obstacles.move(mover.position, CENTER_BODY, dx, dy);
        mover.position.x = moved.x;
        mover.position.y = moved.y;
        if (moved.blockedX) mover.velocity.x = 0;
        if (moved.blockedY) mover.velocity.y = 0;
    }
    else
    {
        mover.position.x += dx;
        mover.position.y += dy;
    }

    // 4. Keep inside the battlefield. Hitting an edge cancels speed into it.
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;

    if (mover.position.x < bounds.x)
    {
        mover.position.x = bounds.x;
        mover.velocity.x = Math.max(0, mover.velocity.x);
    }
    else if (mover.position.x > right)
    {
        mover.position.x = right;
        mover.velocity.x = Math.min(0, mover.velocity.x);
    }

    if (mover.position.y < bounds.y)
    {
        mover.position.y = bounds.y;
        mover.velocity.y = Math.max(0, mover.velocity.y);
    }
    else if (mover.position.y > bottom)
    {
        mover.position.y = bottom;
        mover.velocity.y = Math.min(0, mover.velocity.y);
    }

    // 5. Remember which way we face (only changes on left/right input).
    if (dirX !== 0)
    {
        mover.facing = dirX > 0 ? 1 : -1;
    }

    mover.isMoving = Math.hypot(mover.velocity.x, mover.velocity.y) > 5;
}
