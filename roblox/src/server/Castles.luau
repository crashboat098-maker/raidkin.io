--!strict
--[[
	Lucky Spin castles, ported from the web's Castles.ts: one in each of three
	corner biomes (the Sylvan Castle in the enchanted forest, the Dread Fortress
	in the volcano, the Mire Castle in the swamp). All three follow the same rules:

	  READY     an army that steps into the circle alone starts charging the
	            wheel; 45 s in the circle spins it. Another army inside pauses
	            the countdown (contested); leaving the circle resets it. The
	            reward is decided at the spin, the wheel turns for a moment, and
	            the reward lands: soldiers join or (rarely) leave.
	  COOLDOWN  60 s from the moment of the spin, then READY again.

	Only an army that stepped in since the last spin can charge: everyone in the
	circle when a wheel spins has to leave and come back for another try.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local PlayerArmy = require(ReplicatedStorage.Shared.PlayerArmy)
local Combat = require(script.Parent.Combat)
local Map = require(ReplicatedStorage.Shared.Map)

local Castles = {}

local settings = Config.castles
local rng = Random.new()

export type Role = "warrior" | "archer" | "guardian"

--[[
	The wheel, slice by slice clockwise from the top. Indexes are what players
	are sent, so don't reorder casually. Weights add up to 100 (percent chances).
]]
Castles.REWARDS = {
	{ label = "+10 WARRIORS", count = 10, role = "warrior", weight = 18 },
	{ label = "+15 ARCHERS", count = 15, role = "archer", weight = 11 },
	{ label = "+10 GUARDIANS", count = 10, role = "guardian", weight = 18 },
	{ label = "+25 SOLDIERS", count = 25, role = "random", weight = 10 },
	{ label = "+10 ARCHERS", count = 10, role = "archer", weight = 18 },
	{ label = "+15 GUARDIANS", count = 15, role = "guardian", weight = 11 },
	{ label = "LOSE 10", count = -10, role = "none", weight = 3 },
	{ label = "+15 WARRIORS", count = 15, role = "warrior", weight = 11 },
}
local ROLES: { Role } = { "warrior", "archer", "guardian" }

export type Spin = {
	-- Counts up per castle, so players' games can tell a new spin from the last one.
	id: number,
	fighter: Combat.Fighter?,
	-- Index into REWARDS, and the class that joins.
	rewardId: number,
	role: Role,
	-- Seconds since the spin started, and whether the reward has landed.
	elapsed: number,
	landed: boolean,
}

export type Castle = {
	index: number,
	name: string,
	biome: string,
	-- Centre and radius of the circle (px).
	x: number,
	z: number,
	radius: number,
	state: "ready" | "cooldown",
	-- Seconds until the wheel is ready again (cooldown only).
	cooldown: number,
	-- The army holding the circle to spin the wheel, and how long it has held it.
	charger: Combat.Fighter?,
	charged: number,
	-- Another army is in the circle: the countdown is paused.
	contested: boolean,
	-- The latest spin (kept after it lands, so the result can be shown).
	spin: Spin?,
	-- Armies with soldiers inside (as of the last check), and those that stepped in since the last spin.
	inside: { [Combat.Fighter]: boolean },
	eligible: { [Combat.Fighter]: boolean },
	spins: number,
}

-- A reward landed: `count` soldiers of `role` join the army (negative: leave).
export type Award = { castle: Castle, fighter: Combat.Fighter, count: number, role: Role }

Castles.list = {} :: { Castle }

for i, site in Map.data.castles do
	table.insert(Castles.list, {
		index = i,
		name = site.name,
		biome = site.biome,
		x = site.x,
		z = site.y,
		radius = site.radius,
		state = "ready",
		cooldown = 0,
		charger = nil,
		charged = 0,
		contested = false,
		spin = nil,
		inside = {},
		eligible = {},
		spins = 0,
	})
end

-- Pick a reward by weight.
local function rollReward(): number
	local total = 0
	for _, r in Castles.REWARDS do
		total += r.weight
	end
	local roll = rng:NextNumber() * total
	for i, r in Castles.REWARDS do
		roll -= r.weight
		if roll < 0 then
			return i
		end
	end
	return 1
end

-- Armies with at least one soldier inside the circle.
local function armiesInCircle(castle: Castle, fighters: { Combat.Fighter }): { [Combat.Fighter]: boolean }
	local found: { [Combat.Fighter]: boolean } = {}
	local r2 = castle.radius ^ 2
	local reach = castle.radius + 600
	for _, f in fighters do
		-- The army's steering point is usually far from every castle: skip those armies cheaply.
		local lead = f.army.lead
		if f.alive and math.abs(lead.x - castle.x) <= reach and math.abs(lead.z - castle.z) <= reach then
			for _, s in PlayerArmy.allSoldiers(f.army) do
				if (s.x - castle.x) ^ 2 + (s.z - castle.z) ^ 2 <= r2 then
					found[f] = true
					break
				end
			end
		end
	end
	return found
end

-- The wheel spins for `fighter`: the reward is decided now, and the castle cools down.
local function spinFor(castle: Castle, fighter: Combat.Fighter)
	local rewardId = rollReward()
	local reward = Castles.REWARDS[rewardId]
	local role: Role = if reward.role == "random" then ROLES[rng:NextInteger(1, #ROLES)]
		elseif reward.role == "none" then "warrior"
		else reward.role :: Role
	castle.spins += 1
	castle.spin = { id = castle.spins, fighter = fighter, rewardId = rewardId, role = role, elapsed = 0, landed = false }
	castle.state = "cooldown"
	castle.cooldown = settings.cooldown
	castle.charger = nil
	castle.charged = 0
	castle.contested = false
	-- Everyone in the circle now has to leave and come back for another try.
	table.clear(castle.eligible)
end

local sinceCheck = math.huge

--[[
	Advance every castle by `dt` seconds. `fighters` are all the armies (beaten
	ones are skipped). Presence is re-checked every checkInterval; timers run
	every update. Returns the rewards that landed this update, and whether any
	wheel started spinning.
]]
function Castles.update(dt: number, fighters: { Combat.Fighter }): ({ Award }, boolean)
	local awards: { Award } = {}
	local spun = false

	-- Timers: cooldowns run down, spinning wheels land.
	for _, c in Castles.list do
		if c.state == "cooldown" then
			c.cooldown = math.max(0, c.cooldown - dt)
			if c.cooldown == 0 then
				c.state = "ready"
			end
		end
		local spin = c.spin
		if spin then
			spin.elapsed += dt
			if not spin.landed and spin.elapsed >= settings.spinTime then
				spin.landed = true
				-- The spinner was beaten or left meanwhile: nobody to reward.
				local fighter = spin.fighter
				if fighter and fighter.alive and table.find(fighters, fighter) then
					table.insert(awards, { castle = c, fighter = fighter, count = Castles.REWARDS[spin.rewardId].count, role = spin.role })
				end
			end
			if spin.landed and spin.elapsed >= settings.spinTime + settings.resultTime then
				c.spin = nil
			end
		end
	end

	-- Who is in each circle. Stepping in makes an army eligible to charge; stepping out ends that.
	sinceCheck += dt
	if sinceCheck >= settings.checkInterval then
		sinceCheck = 0
		for _, c in Castles.list do
			local now = armiesInCircle(c, fighters)
			for f in now do
				if not c.inside[f] then
					c.eligible[f] = true
				end
			end
			for f in c.eligible do
				if not now[f] then
					c.eligible[f] = nil
				end
			end
			c.inside = now
		end
	end

	-- Charging: one army alone in a ready circle counts down to the spin.
	for _, c in Castles.list do
		if c.state ~= "ready" then
			c.charger, c.charged, c.contested = nil, 0, false
			continue
		end
		local count, only = 0, nil
		for f in c.inside do
			count += 1
			only = f
		end
		-- The charger left the circle (or was beaten): its progress is lost.
		local charger = c.charger
		if charger and not c.inside[charger] then
			c.charger, c.charged = nil, 0
		end
		-- Alone in the circle, and stepped in since the last spin: start charging.
		if not c.charger and count == 1 and only and c.eligible[only] then
			c.charger = only
		end
		c.contested = count > 1
		charger = c.charger
		if charger and not c.contested then
			c.charged = math.min(settings.chargeTime, c.charged + dt)
			if c.charged >= settings.chargeTime then
				spinFor(c, charger)
				spun = true
			end
		end
	end
	return awards, spun
end

return Castles
