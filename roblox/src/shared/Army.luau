--!strict
-- An army: soldiers gathered in a round "sunflower" formation around an
-- invisible steering point that the player moves. Ported from the web's
-- Army.ts (one group, open ground; see PlayerArmy for splitting, and the
-- server's Combat for fighting).

local Movement = require(script.Parent.Movement)
local Obstacles = require(script.Parent.Obstacles)

local Army = {}

-- Melee Warriors, and Archers who keep to the back of the formation.
export type Role = "warrior" | "archer"

export type Soldier = {
	id: number,
	role: Role,
	-- Index of this soldier's spot in the formation.
	slot: number,
	x: number,
	z: number,
	vx: number,
	vz: number,
	-- Which way it faces (radians; Roblox yaw, so models can be turned with CFrame.Angles(0, yaw, 0)).
	yaw: number,
	moving: boolean,

	-- Combat (see the server's Combat).
	hp: number,
	maxHp: number,
	-- Earliest time this soldier can strike again (seconds, server clock).
	nextAttackAt: number,
	-- An enemy to step toward and fight this update (nil = keep formation).
	engageX: number?,
	engageZ: number?,
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
-- Fighting soldiers stop this close to their enemy (inside striking range).
local ENGAGE_STANDOFF = 8

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

-- How far behind the army's middle Archers stand.
local ARCHER_REAR = 10

-- An Archer's spot: its formation slot, moved back along the heading so it's at
-- least ARCHER_REAR behind the middle, with the Warriors between it and the enemy.
local function rearSlot(slot: Vector2, hx: number, hz: number): Vector2
	local ahead = slot.X * hx + slot.Y * hz
	if ahead <= -ARCHER_REAR then
		return slot
	end
	local back = ahead + ARCHER_REAR
	return Vector2.new(slot.X - hx * back, slot.Y - hz * back)
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
function Army.addSoldier(army: Army, id: number, x: number, z: number, role: Role?, maxHp: number?): Soldier
	local used: { [number]: boolean } = {}
	for _, s in army.soldiers do
		used[s.slot] = true
	end
	local slot = 1
	while used[slot] do
		slot += 1
	end
	local hp = maxHp or 100
	local soldier: Soldier = {
		id = id,
		role = role or "warrior",
		slot = slot,
		x = x,
		z = z,
		vx = 0,
		vz = 0,
		yaw = 0,
		moving = false,
		hp = hp,
		maxHp = hp,
		nextAttackAt = 0,
		engageX = nil,
		engageZ = nil,
	}
	table.insert(army.soldiers, soldier)
	return soldier
end

-- Roughly how far a group of `count` soldiers reaches from its centre.
function Army.clusterRadius(count: number, spacing: number): number
	return if count <= 1 then 4 else spacing * 0.56 * math.sqrt(count) + 4
end

-- The average position of some soldiers.
function Army.centroid(soldiers: { Soldier }): (number, number)
	local x, z = 0, 0
	for _, s in soldiers do
		x += s.x
		z += s.z
	end
	local n = math.max(1, #soldiers)
	return x / n, z / n
end

--[[
	Give every soldier a fresh formation spot (after splitting or merging):
	inner spots first, each going to the closest soldier, so nobody has to
	cross the whole group.
]]
function Army.reassignSlots(army: Army, spacing: number)
	local count = #army.soldiers
	local slots = Army.formationSlots(spacing, math.max(30, count))
	local unassigned = table.clone(army.soldiers)
	for i = 1, count do
		local tx = army.center.x + slots[i].X
		local tz = army.center.z + slots[i].Y
		local bestIndex, best = 1, math.huge
		for k, s in unassigned do
			local d = (s.x - tx) ^ 2 + (s.z - tz) ^ 2
			if d < best then
				best = d
				bestIndex = k
			end
		end
		local soldier = table.remove(unassigned, bestIndex)
		if soldier then
			soldier.slot = i
		end
	end
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
function Army.updateSoldiers(army: Army, dt: number, settings: Settings, obstacles: Obstacles.Obstacles?)
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
		if soldier.role == "archer" then
			slot = rearSlot(slot, army.headingX, army.headingZ)
		end
		local tx = center.x + slot.X
		local tz = center.z + slot.Y
		-- A spot inside a wall or a tree trunk: gather at the centre instead.
		if obstacles and obstacles.blockedAt(tx, tz, 3, 3) then
			tx, tz = center.x, center.z
		end
		local slotDistance = math.sqrt((tx - soldier.x) ^ 2 + (tz - soldier.z) ^ 2)

		-- In a fight, step toward the enemy instead (Combat keeps this close to the spot).
		local ex, ez = soldier.engageX, soldier.engageZ
		local engaged = ex ~= nil and ez ~= nil
		local gx, gz = tx, tz
		if ex and ez then
			gx, gz = ex, ez
		end
		local toX, toZ = gx - soldier.x, gz - soldier.z
		local distance = math.sqrt(toX * toX + toZ * toZ)

		-- 2. How fast? Close the gap firmly, slowing to a stop on the spot (or at
		-- striking distance from the enemy).
		-- Wading through water slows soldiers down too.
		local terrain = if obstacles then obstacles.speedFactorAt(soldier.x, soldier.z) else 1
		local topSpeed = settings.warriorSpeed * (if slotDistance > FAR_BEHIND then settings.catchUpMultiplier else 1) * terrain
		local speed
		if engaged then
			speed = if distance < ENGAGE_STANDOFF then 0 else math.min(topSpeed, (distance - ENGAGE_STANDOFF) * 6 + 12)
		else
			speed = if distance < 2.5 then 0 else math.min(topSpeed, distance * SETTLE_RATE)
		end
		local desiredX = if distance > 0.01 then toX / distance * speed else 0
		local desiredZ = if distance > 0.01 then toZ / distance * speed else 0

		if not engaged then
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
		end

		-- 3. Personal space (much weaker in a fight, so soldiers can press in).
		local pushX, pushZ = separation(soldier, army.soldiers, settings.separationDistance)
		local push = if engaged then 0.25 else 1
		desiredX += pushX * topSpeed * push
		desiredZ += pushZ * topSpeed * push

		-- 4. Turn to the desired direction at once; only the speed eases.
		soldier.vx, soldier.vz = Movement.steerVelocity(soldier.vx, soldier.vz, desiredX, desiredZ, settings.warriorAcceleration * dt)
		if obstacles then
			local x, z, blockedX, blockedZ = obstacles.move(soldier.x, soldier.z, 3, 3, soldier.vx * dt, soldier.vz * dt)
			soldier.x, soldier.z = x, z
			if blockedX then
				soldier.vx = 0
			end
			if blockedZ then
				soldier.vz = 0
			end
		else
			soldier.x += soldier.vx * dt
			soldier.z += soldier.vz * dt
		end

		-- 5. Fighters face their foe; marching soldiers all face the way the army is
		-- steered, the instant it turns; otherwise they face the way they walk.
		local ownSpeed = math.sqrt(soldier.vx * soldier.vx + soldier.vz * soldier.vz)
		if engaged and distance > 0.01 then
			soldier.yaw = yawToward(toX, toZ)
		elseif centerSpeed > 3 then
			soldier.yaw = yawToward(center.vx, center.vz)
		elseif ownSpeed > 3 then
			soldier.yaw = yawToward(soldier.vx, soldier.vz)
		end
		soldier.moving = ownSpeed > 8
	end
end

return Army
