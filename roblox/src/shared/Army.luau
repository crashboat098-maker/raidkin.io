--!strict
-- An army: soldiers gathered in a round "sunflower" formation around an
-- invisible steering point that the player moves. Ported from the web's
-- Army.ts (one cluster, open ground; splitting, obstacles and combat come later).

local Movement = require(script.Parent.Movement)

local Army = {}

export type Soldier = {
	id: number,
	-- Index of this soldier's spot in the formation.
	slot: number,
	x: number,
	z: number,
	vx: number,
	vz: number,
	-- Which way it faces (radians; Roblox yaw, so models can be turned with CFrame.Angles(0, yaw, 0)).
	yaw: number,
	moving: boolean,
}

export type Army = {
	id: number,
	colorIndex: number,
	center: Movement.Mover,
	soldiers: { Soldier },
	-- Direction of travel (unit vector).
	headingX: number,
	headingZ: number,
}

export type Settings = {
	formationSpacing: number,
	warriorSpeed: number,
	catchUpMultiplier: number,
	warriorAcceleration: number,
	separationDistance: number,
	speedCurve: { { number } },
	minSpeedMultiplier: number,
}

-- How hard a soldier closes in on its formation spot (per second, times the distance).
local SETTLE_RATE = 10
-- A soldier this far from its spot counts as fallen behind and may run faster.
local FAR_BEHIND = 48

-- ---------------------------------------------------------------------------
-- Formation
-- ---------------------------------------------------------------------------

local slotCache: { [number]: { Vector2 } } = {}

--[[
	Formation spots relative to the centre, in a "sunflower" spiral: the first
	soldier stands in the middle and each new one takes the next spot outward,
	so the army packs into an even, round, organic-looking blob as it grows.
]]
function Army.formationSlots(spacing: number, count: number): { Vector2 }
	local key = spacing * 1000 + count
	local cached = slotCache[key]
	if cached then
		return cached
	end

	local rng = Random.new(1234)
	local golden = math.pi * (3 - math.sqrt(5)) -- ~137.5 degrees
	local scale = spacing * 0.56
	local slots = { Vector2.zero }
	for i = 1, count - 1 do
		local radius = scale * math.sqrt(i + 1)
		local angle = i * golden
		-- A pixel or two of jitter keeps it from looking machine-made.
		table.insert(slots, Vector2.new(
			math.cos(angle) * radius + (rng:NextNumber() - 0.5) * 2,
			math.sin(angle) * radius * 0.9 + (rng:NextNumber() - 0.5) * 2
		))
	end
	slotCache[key] = slots
	return slots
end

-- The army's top speed share for its size, blended between the points of `curve`.
function Army.speedMultiplier(size: number, curve: { { number } }, minimum: number): number
	if #curve == 0 then
		return 1
	end
	if size <= curve[1][1] then
		return math.max(minimum, curve[1][2])
	end
	for i = 1, #curve - 1 do
		local a, b = curve[i], curve[i + 1]
		if size <= b[1] then
			local t = (size - a[1]) / (b[1] - a[1])
			return math.max(minimum, a[2] + (b[2] - a[2]) * t)
		end
	end
	return math.max(minimum, curve[#curve][2])
end

-- ---------------------------------------------------------------------------
-- Creating
-- ---------------------------------------------------------------------------

function Army.new(id: number, colorIndex: number, x: number, z: number): Army
	return {
		id = id,
		colorIndex = colorIndex,
		center = Movement.create(x, z),
		soldiers = {},
		headingX = 0,
		headingZ = 1,
	}
end

-- Add a soldier at (x, z); it takes the first free formation spot (the outer edge).
function Army.addSoldier(army: Army, id: number, x: number, z: number): Soldier
	local used: { [number]: boolean } = {}
	for _, s in army.soldiers do
		used[s.slot] = true
	end
	local slot = 1
	while used[slot] do
		slot += 1
	end
	local soldier: Soldier = { id = id, slot = slot, x = x, z = z, vx = 0, vz = 0, yaw = 0, moving = false }
	table.insert(army.soldiers, soldier)
	return soldier
end

-- ---------------------------------------------------------------------------
-- Update
-- ---------------------------------------------------------------------------

-- Push away from very close neighbours (fine for small armies; a grid comes later).
local function separation(soldier: Soldier, others: { Soldier }, minDistance: number): (number, number)
	local px, pz = 0, 0
	local minSquared = minDistance * minDistance
	for _, other in others do
		if other ~= soldier then
			local dx = soldier.x - other.x
			local dz = soldier.z - other.z
			local d2 = dx * dx + dz * dz
			if d2 < minSquared then
				local d = math.sqrt(d2)
				if d < 0.01 then
					-- Exactly on top of each other: split using the id so they go different ways.
					px += ((soldier.id % 2) * 2 - 1) * 0.8
				else
					local amount = (minDistance - d) / minDistance * 0.8
					px += dx / d * amount
					pz += dz / d * amount
				end
			end
		end
	end
	return px, pz
end

-- Roblox yaw that turns a model (facing -Z) toward the direction (dx, dz).
local function yawToward(dx: number, dz: number): number
	return math.atan2(-dx, -dz)
end

--[[
	Move every soldier toward its spot around the army's steering point. (The
	steering point itself is moved separately, by the player's input.)
]]
function Army.updateSoldiers(army: Army, dt: number, settings: Settings)
	local center = army.center

	-- The formation turns the instant the army does.
	local centerSpeed = math.sqrt(center.vx * center.vx + center.vz * center.vz)
	if centerSpeed >= 10 then
		army.headingX = center.vx / centerSpeed
		army.headingZ = center.vz / centerSpeed
	end

	local slots = Army.formationSlots(settings.formationSpacing, math.max(30, #army.soldiers))
	for _, soldier in army.soldiers do
		-- 1. Where should I be?
		local slot = slots[soldier.slot] or Vector2.zero
		local tx = center.x + slot.X
		local tz = center.z + slot.Y
		local toX, toZ = tx - soldier.x, tz - soldier.z
		local distance = math.sqrt(toX * toX + toZ * toZ)

		-- 2. How fast? Close the gap firmly, slowing to a stop on the spot.
		local topSpeed = settings.warriorSpeed * (if distance > FAR_BEHIND then settings.catchUpMultiplier else 1)
		local speed = if distance < 2.5 then 0 else math.min(topSpeed, distance * SETTLE_RATE)
		local desiredX = if distance > 0.01 then toX / distance * speed else 0
		local desiredZ = if distance > 0.01 then toZ / distance * speed else 0

		-- Move WITH the steering point, plus the correction toward the spot (otherwise
		-- soldiers only chase their spot and trail behind it).
		desiredX += center.vx
		desiredZ += center.vz
		local cap = topSpeed * settings.catchUpMultiplier
		local desiredSpeed = math.sqrt(desiredX * desiredX + desiredZ * desiredZ)
		if desiredSpeed > cap then
			desiredX *= cap / desiredSpeed
			desiredZ *= cap / desiredSpeed
		end

		-- 3. Personal space.
		local pushX, pushZ = separation(soldier, army.soldiers, settings.separationDistance)
		desiredX += pushX * topSpeed
		desiredZ += pushZ * topSpeed

		-- 4. Turn to the desired direction at once; only the speed eases.
		soldier.vx, soldier.vz = Movement.steerVelocity(soldier.vx, soldier.vz, desiredX, desiredZ, settings.warriorAcceleration * dt)
		soldier.x += soldier.vx * dt
		soldier.z += soldier.vz * dt

		-- 5. Marching soldiers all face the way the army is steered, the instant it
		-- turns; otherwise they face the way they walk.
		local ownSpeed = math.sqrt(soldier.vx * soldier.vx + soldier.vz * soldier.vz)
		if centerSpeed > 3 then
			soldier.yaw = yawToward(center.vx, center.vz)
		elseif ownSpeed > 3 then
			soldier.yaw = yawToward(soldier.vx, soldier.vz)
		end
		soldier.moving = ownSpeed > 8
	end
end

return Army
