--!strict
-- A point that moves with smooth acceleration: the army's invisible steering
-- point, which its soldiers gather around. Ported from the web's Movement.ts
-- (obstacles not yet; armies only stop at the battlefield's edge).
-- The map is the X/Z plane: x runs east, z runs south (the web's y).

local Movement = {}

export type Mover = {
	x: number,
	z: number,
	vx: number,
	vz: number,
	moving: boolean,
}

export type Bounds = { minX: number, minZ: number, maxX: number, maxZ: number }

function Movement.create(x: number, z: number): Mover
	return { x = x, z = z, vx = 0, vz = 0, moving = false }
end

--[[
	Change a velocity toward a target velocity. The direction snaps to the
	target's at once (turns are instant); only the speed eases up or down, by at
	most `maxSpeedChange`. With no target (stopping) it slows down along the way
	it was already going. Returns the new velocity.
]]
function Movement.steerVelocity(vx: number, vz: number, tx: number, tz: number, maxSpeedChange: number): (number, number)
	local targetSpeed = math.sqrt(tx * tx + tz * tz)
	local speed = math.sqrt(vx * vx + vz * vz)
	if targetSpeed < 0.001 then
		local nextSpeed = math.max(0, speed - maxSpeedChange)
		local scale = if speed > 0 then nextSpeed / speed else 0
		return vx * scale, vz * scale
	end
	local nextSpeed
	if speed < targetSpeed then
		nextSpeed = math.min(targetSpeed, speed + maxSpeedChange)
	else
		nextSpeed = math.max(targetSpeed, speed - maxSpeedChange)
	end
	return tx / targetSpeed * nextSpeed, tz / targetSpeed * nextSpeed
end

export type Tuning = { maxSpeed: number, acceleration: number, deceleration: number }

--[[
	Advance a mover by one update. `ix, iz` is the wanted direction (each -1..1,
	from the player's keys or mouse); `dt` is seconds since the last update.
]]
function Movement.update(mover: Mover, ix: number, iz: number, dt: number, tuning: Tuning, bounds: Bounds)
	-- 1. Diagonal movement isn't faster.
	local length = math.sqrt(ix * ix + iz * iz)
	if length > 1 then
		ix /= length
		iz /= length
	end

	-- 2. Ease the speed (turns are instant).
	local rate = if length > 0 then tuning.acceleration else tuning.deceleration
	mover.vx, mover.vz = Movement.steerVelocity(mover.vx, mover.vz, ix * tuning.maxSpeed, iz * tuning.maxSpeed, rate * dt)

	-- 3. Move.
	mover.x += mover.vx * dt
	mover.z += mover.vz * dt

	-- 4. Stay inside the battlefield; hitting an edge cancels speed into it.
	if mover.x < bounds.minX then
		mover.x = bounds.minX
		mover.vx = math.max(0, mover.vx)
	elseif mover.x > bounds.maxX then
		mover.x = bounds.maxX
		mover.vx = math.min(0, mover.vx)
	end
	if mover.z < bounds.minZ then
		mover.z = bounds.minZ
		mover.vz = math.max(0, mover.vz)
	elseif mover.z > bounds.maxZ then
		mover.z = bounds.maxZ
		mover.vz = math.min(0, mover.vz)
	end

	mover.moving = math.sqrt(mover.vx * mover.vx + mover.vz * mover.vz) > 5
end

return Movement
