--!strict
--[[
	Your own army moves the instant you steer, like a normal Roblox character,
	instead of waiting for the server to hear about it and answer (ported from the
	web version's NetWorld prediction).

	Your game runs the same steering-point movement the server does (same route
	around walls, same speed, same map) and draws your army there right away. The
	server is still in charge: each frame the predicted point eases toward where
	the server says it is, nudged a little ahead in the direction you're steering,
	since the server's word is a moment old. While walking, small differences are
	normal network wobble and are left alone, so nothing jitters; a big one (the
	army was blocked, or teleported) is corrected at once.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Movement = require(Shared:WaitForChild("Movement"))
local Navigation = require(Shared:WaitForChild("Navigation"))
local Map = require(Shared:WaitForChild("Map"))

local Prediction = {}

-- How far ahead of the server's (slightly old) position to aim, in seconds of travel.
local LEAD_TIME = 0.12
-- Differences smaller than this are left alone while walking (network wobble).
local WOBBLE = 24
-- A difference bigger than this is fixed at once (blocked, teleported, respawned).
local SNAP = 260

local margin = Config.world.margin
local bounds: Movement.Bounds = { minX = margin, minZ = margin, maxX = Config.world.size - margin, maxZ = Config.world.size - margin }

local mover: Movement.Mover = Movement.create(0, 0)
local nav = Navigation.newNavigator()
local ready = false

-- Where our army's steering point is drawn right now (nil before the first update).
function Prediction.position(): (number?, number?)
	if not ready then
		return nil, nil
	end
	return mover.x, mover.z
end

-- Forget the prediction (beaten, or not playing): the next update starts from the server's position.
function Prediction.reset()
	ready = false
end

--[[
	Advance the prediction by `dt` seconds with the player's steering, then pull it
	toward the server's latest word on the steering point (`serverX, serverZ`) and
	its top speed. Returns where to draw the army's steering point now.
]]
function Prediction.update(dt: number, steerX: number, steerZ: number, serverX: number, serverZ: number, speed: number, now: number): (number, number)
	if not ready then
		mover = Movement.create(serverX, serverZ)
		nav = Navigation.newNavigator()
		ready = true
	end

	-- 1. Move now, exactly as the server will.
	local sx, sz = Navigation.steerAround(nav, Map.obstacles, bounds, mover.x, mover.z, steerX, steerZ, now)
	Movement.update(mover, sx, sz, dt, {
		maxSpeed = speed,
		acceleration = Config.movement.acceleration,
		deceleration = Config.movement.deceleration,
	}, bounds, Map.obstacles)

	-- 2. Stay true to the server: aim a little ahead of its position, the way we're going.
	local length = math.sqrt(sx * sx + sz * sz)
	local dx, dz = if length > 0 then sx / length else 0, if length > 0 then sz / length else 0
	local targetX = serverX + dx * speed * LEAD_TIME
	local targetZ = serverZ + dz * speed * LEAD_TIME
	local ex, ez = targetX - mover.x, targetZ - mover.z
	local err = math.sqrt(ex * ex + ez * ez)
	-- A big gap, or a wall between us and the server's word (moved into or out of
	-- the arena): jump there rather than glide through the wall.
	if err > SNAP or (err > 40 and not Navigation.hasClearPath(Map.obstacles, mover.x, mover.z, targetX, targetZ)) then
		mover.x, mover.z = targetX, targetZ
	elseif length > 0 then
		if err > WOBBLE then
			local fix = (err - WOBBLE) * math.min(1, dt * 2) / err
			mover.x += ex * fix
			mover.z += ez * fix
		end
	else
		-- Standing still: settle exactly where the server has us.
		local pull = math.min(1, dt * 4)
		mover.x += ex * pull
		mover.z += ez * pull
	end
	return mover.x, mover.z
end

return Prediction
