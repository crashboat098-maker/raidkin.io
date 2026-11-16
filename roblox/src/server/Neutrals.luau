--!strict
-- Neutral Warriors on the map: walk any of your soldiers up to one and it joins
-- your army. Ported from the web's Neutrals.ts: village and forest folk who stay
-- near their homes, lone wanderers who roam further, and soldiers an army
-- surrendered (they walk out to where they were sent, keep their role, can be
-- recruited by anyone once a short wait is over, and are gone once taken).

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Map = require(ReplicatedStorage.Shared.Map)
local Army = require(ReplicatedStorage.Shared.Army)

local Neutrals = {}

export type Neutral = {
	-- Ids start at 1,000,000 so they never clash with soldier ids when drawn.
	id: number,
	homeX: number,
	homeZ: number,
	-- How far it strays from home (folk stay close; wanderers roam).
	roam: number,
	x: number,
	z: number,
	yaw: number,
	moving: boolean,
	-- False while recruited and waiting to come back.
	active: boolean,
	respawnAt: number,
	targetX: number?,
	targetZ: number?,
	nextWanderAt: number,
	-- What it joins as (a surrendered Archer stays an Archer; everyone else is a Warrior).
	role: Army.Role,
	-- Nobody can recruit it before this time (surrendered soldiers; 0 for everyone else).
	recruitableAt: number,
	-- Let go by an army: no home to come back to once recruited.
	surrendered: boolean,
}

local settings = Config.neutrals
local rng = Random.new(1108)
-- Village folk barely leave their doorstep.
local VILLAGE_ROAM = 10
-- How much faster than a stroll a surrendered soldier walks out to where it was sent.
local SURRENDER_WALK_SPEEDUP = 3
local nextId = 1_000_000

Neutrals.list = {} :: { Neutral }

local function add(x: number, z: number, roam: number): Neutral
	nextId += 1
	local unit: Neutral = {
			id = nextId,
			homeX = x,
			homeZ = z,
			roam = roam,
			x = x,
			z = z,
			yaw = rng:NextNumber(-math.pi, math.pi),
			moving = false,
			active = true,
			respawnAt = 0,
			targetX = nil,
			targetZ = nil,
			nextWanderAt = rng:NextNumber(0, 3),
			role = "warrior",
			recruitableAt = 0,
			surrendered = false,
		}
	table.insert(Neutrals.list, unit)
	return unit
end

--[[
	A soldier an army let go: it becomes a neutral at (fromX, fromZ), walks out
	to (toX, toZ) and wanders there. Anyone can recruit it from recruitableAt.
]]
function Neutrals.addSurrendered(fromX: number, fromZ: number, toX: number, toZ: number, role: Army.Role, recruitableAt: number, yaw: number)
	local unit = add(fromX, fromZ, settings.wanderRadius)
	unit.homeX, unit.homeZ = toX, toZ
	unit.targetX, unit.targetZ = toX, toZ
	unit.role = role
	unit.recruitableAt = recruitableAt
	unit.nextWanderAt = recruitableAt
	unit.surrendered = true
	unit.yaw = yaw
end

function Neutrals.create()
	-- Folk at every village and forest home.
	for _, home in Map.villagerHomes do
		add(home.X, home.Y, VILLAGE_ROAM)
	end
	-- Lone wanderers spread over open ground, not right where armies start.
	local middle = Map.spawn
	for _ = 1, settings.wanderers do
		local x, z
		repeat
			x, z = Map.randomOpenSpot(rng)
		until (x - middle.X) ^ 2 + (z - middle.Y) ^ 2 > 300 ^ 2
		add(x, z, settings.wanderRadius)
	end
end

--[[
	Recruit every active neutral within range of (x, z). Returns the ones that
	joined (they're taken out of play at once, so each can only join one army).
]]
function Neutrals.recruitNear(x: number, z: number, now: number): { Neutral }
	local joined = {}
	local r2 = settings.recruitRange ^ 2
	local anySurrendered = false
	for _, unit in Neutrals.list do
		if unit.active and now >= unit.recruitableAt and (unit.x - x) ^ 2 + (unit.z - z) ^ 2 <= r2 then
			unit.active = false
			unit.moving = false
			unit.respawnAt = now + rng:NextNumber(settings.respawnDelay.min, settings.respawnDelay.max)
			table.insert(joined, unit)
			anySurrendered = anySurrendered or unit.surrendered
		end
	end
	-- Surrendered soldiers have no home to refill: they're gone once taken.
	if anySurrendered then
		for i = #Neutrals.list, 1, -1 do
			local unit = Neutrals.list[i]
			if unit.surrendered and not unit.active then
				table.remove(Neutrals.list, i)
			end
		end
	end
	return joined
end

-- Is any recruitable neutral near this box? (Lets an army skip checking each soldier.)
function Neutrals.anyNear(minX: number, minZ: number, maxX: number, maxZ: number): boolean
	local r = settings.recruitRange
	for _, unit in Neutrals.list do
		if unit.active and unit.x >= minX - r and unit.x <= maxX + r and unit.z >= minZ - r and unit.z <= maxZ + r then
			return true
		end
	end
	return false
end

-- Wander about; bring back recruited ones at their home spot when no player is near.
function Neutrals.update(now: number, dt: number, players: { Vector2 })
	local clear2 = settings.respawnPlayerClearance ^ 2
	for _, unit in Neutrals.list do
		if not unit.active then
			if now >= unit.respawnAt then
				local blocked = false
				for _, p in players do
					if (p.X - unit.homeX) ^ 2 + (p.Y - unit.homeZ) ^ 2 < clear2 then
						blocked = true
						break
					end
				end
				if blocked then
					unit.respawnAt = now + 2 -- try again shortly
				else
					unit.active = true
					unit.x, unit.z = unit.homeX, unit.homeZ
					unit.targetX, unit.targetZ = nil, nil
				end
			end
			continue
		end

		if unit.targetX == nil and now >= unit.nextWanderAt then
			local angle = rng:NextNumber(0, math.pi * 2)
			local r = rng:NextNumber(0, unit.roam)
			local tx, tz = unit.homeX + math.cos(angle) * r, unit.homeZ + math.sin(angle) * r
			if Map.obstacles.blockedAt(tx, tz, 3, 3) then
				unit.nextWanderAt = now + 0.5 -- somewhere solid: pick again shortly
			else
				unit.targetX, unit.targetZ = tx, tz
			end
		end
		local tx, tz = unit.targetX, unit.targetZ
		if tx == nil or tz == nil then
			unit.moving = false
			continue
		end
		local dx, dz = tx - unit.x, tz - unit.z
		local d = math.sqrt(dx * dx + dz * dz)
		if d < 1.5 then
			unit.targetX, unit.targetZ = nil, nil
			unit.nextWanderAt = now + rng:NextNumber(1.5, 4.5)
			unit.moving = false
			continue
		end
		-- Village folk amble; wanderers walk; a freshly surrendered soldier walks
		-- briskly away from the army it left. Water slows them like everyone else.
		local pace = if now < unit.recruitableAt then SURRENDER_WALK_SPEEDUP elseif unit.roam < settings.wanderRadius then 0.6 else 1
		local step = math.min(d, settings.wanderSpeed * pace * Map.obstacles.speedFactorAt(unit.x, unit.z) * dt)
		local x, z, blockedX, blockedZ = Map.obstacles.move(unit.x, unit.z, 3, 3, dx / d * step, dz / d * step)
		unit.x, unit.z = x, z
		if blockedX and blockedZ then
			unit.targetX, unit.targetZ = nil, nil -- walked into a corner: give up on that spot
		end
		unit.yaw = math.atan2(-dx, -dz)
		unit.moving = true
	end
end

return Neutrals
