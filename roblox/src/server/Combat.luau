--!strict
--[[
	Combat rules, ported from the web's Combat.ts:
	 - Soldiers automatically fight enemy soldiers that come close.
	 - Each soldier strikes the nearest enemy in reach when its blow is ready
	   (Warriors every ~0.5 s up close, Archers every ~0.9 s from range).
	 - A soldier at 0 health dies and is removed (leaving a body: see Fallen).
	 - Any damage dealt or taken marks both armies as in combat; after a quiet
	   minute, injured soldiers slowly heal.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Army = require(ReplicatedStorage.Shared.Army)
local PlayerArmy = require(ReplicatedStorage.Shared.PlayerArmy)

local Combat = {}

local settings = Config.combat
local rng = Random.new()

-- Anything that fights: a player's or a bot's army, plus a little bookkeeping.
export type Fighter = {
	army: PlayerArmy.PlayerArmy,
	-- Last time this army dealt or took damage (seconds, server clock).
	lastCombatAt: number,
	-- True while it shouldn't chase anyone (a fleeing bot); it still defends itself.
	holdBack: boolean,
	-- Fighters out of play (beaten, waiting to come back) are skipped.
	alive: boolean,
	-- Enemy soldiers this army has killed.
	kills: number,
}

export type Death = { soldier: Army.Soldier, owner: Fighter, killer: Fighter? }

-- A cluster centre moving faster than this counts as "on the move".
local MOVING_SPEED = 20
local CELL = 32

-- ---------------------------------------------------------------------------
-- Finding who's near whom cheaply
-- ---------------------------------------------------------------------------

type Extent = { fighter: Fighter, x: number, z: number, radius: number, soldiers: { Army.Soldier } }

local function extentOf(f: Fighter): Extent?
	local soldiers = PlayerArmy.allSoldiers(f.army)
	if #soldiers == 0 then
		return nil
	end
	local cx, cz = Army.centroid(soldiers)
	local radius = 0
	for _, s in soldiers do
		radius = math.max(radius, math.sqrt((s.x - cx) ^ 2 + (s.z - cz) ^ 2))
	end
	return { fighter = f, x = cx, z = cz, radius = radius, soldiers = soldiers }
end

-- Pairs of armies close enough that their soldiers might fight.
local function nearbyPairs(fighters: { Fighter }, margin: number): { { Extent } }
	local extents = {}
	for _, f in fighters do
		if f.alive then
			local e = extentOf(f)
			if e then
				table.insert(extents, e)
			end
		end
	end
	local pairs = {}
	for i = 1, #extents do
		for j = i + 1, #extents do
			local a, b = extents[i], extents[j]
			if math.sqrt((a.x - b.x) ^ 2 + (a.z - b.z) ^ 2) <= a.radius + b.radius + margin then
				table.insert(pairs, { a, b })
			end
		end
	end
	return pairs
end

-- A coarse grid of soldiers, so "who's near here?" only looks at a few cells.
type Grid = { [number]: { Army.Soldier } }

local function cellKey(cx: number, cz: number): number
	return cz * 4096 + cx
end

local function buildGrid(soldiers: { Army.Soldier }): Grid
	local grid: Grid = {}
	for _, s in soldiers do
		local key = cellKey(math.floor(s.x / CELL), math.floor(s.z / CELL))
		local cell = grid[key]
		if cell then
			table.insert(cell, s)
		else
			grid[key] = { s }
		end
	end
	return grid
end

local function forEachNear(grid: Grid, x: number, z: number, r: number, fn: (Army.Soldier) -> ())
	for cz = math.floor((z - r) / CELL), math.floor((z + r) / CELL) do
		for cx = math.floor((x - r) / CELL), math.floor((x + r) / CELL) do
			local cell = grid[cellKey(cx, cz)]
			if cell then
				for _, s in cell do
					fn(s)
				end
			end
		end
	end
end

-- A split-off group of `size` soldiers hits for this share of normal damage.
local function clusterDamageShare(size: number): number
	local t = settings.clusterDamage
	for i = 1, #t do
		local high, highShare = t[i][1], t[i][2]
		if size <= high then
			if i == 1 then
				return highShare
			end
			local low, lowShare = t[i - 1][1], t[i - 1][2]
			return lowShare + (highShare - lowShare) * (size - low) / (high - low)
		end
	end
	return t[#t][2]
end

-- ---------------------------------------------------------------------------
-- Each update
-- ---------------------------------------------------------------------------

--[[
	Decide which enemy each soldier steps toward. Soldiers only chase enemies
	close to them AND close to their own spot in the formation, so an army that
	moves away disengages naturally. While an army is on the move, nobody turns
	back to chase an enemy behind them: running away really runs away.
]]
function Combat.assignEngagements(fighters: { Fighter })
	for _, f in fighters do
		for _, s in PlayerArmy.allSoldiers(f.army) do
			s.engageX, s.engageZ = nil, nil
		end
	end
	local pairs = nearbyPairs(fighters, settings.engageRadius)
	if #pairs == 0 then
		return
	end

	local grids: { [Fighter]: Grid } = {}
	local best: { [Army.Soldier]: number } = {}
	for _, pair in pairs do
		for k = 1, 2 do
			local mine, theirs = pair[k], pair[3 - k]
			if not mine.fighter.holdBack then
				local enemies = grids[theirs.fighter] or buildGrid(theirs.soldiers)
				grids[theirs.fighter] = enemies
				local lead = mine.fighter.army.lead
				local moving = math.sqrt(lead.vx ^ 2 + lead.vz ^ 2) > MOVING_SPEED
				for _, ac in mine.fighter.army.clusters do
					local cluster = ac.cluster
					local slots = Army.formationSlots(Config.army.formationSpacing, math.max(30, #cluster.soldiers))
					for _, s in cluster.soldiers do
						if s.role ~= "archer" then -- Archers hold their place and shoot
							local slot = slots[s.slot] or Vector2.zero
							local homeX, homeZ = cluster.center.x + slot.X, cluster.center.z + slot.Y
							local bestDistance = best[s] or settings.engageRadius
							forEachNear(enemies, s.x, s.z, settings.engageRadius, function(e)
								local d = math.sqrt((e.x - s.x) ^ 2 + (e.z - s.z) ^ 2)
								if d >= bestDistance then
									return
								end
								if math.sqrt((e.x - homeX) ^ 2 + (e.z - homeZ) ^ 2) > settings.engageLeash then
									return
								end
								if moving and (e.x - s.x) * lead.vx + (e.z - s.z) * lead.vz < 0 then
									return
								end
								bestDistance = d
								s.engageX, s.engageZ = e.x, e.z
								best[s] = d
							end)
						end
					end
				end
			end
		end
	end
end

export type Hit = { attacker: Army.Soldier, target: Army.Soldier, attackerOwner: Fighter, targetOwner: Fighter, ranged: boolean }

-- Every soldier whose blow is ready strikes the nearest enemy in reach.
function Combat.resolveAttacks(fighters: { Fighter }, now: number): { Hit }
	local hits: { Hit } = {}
	local maxRange = math.max(settings.attackRange, settings.archer.range)
	local pairs = nearbyPairs(fighters, maxRange)
	if #pairs == 0 then
		return hits
	end

	-- For each army: the enemy armies close enough to matter, and a grid of each one's soldiers.
	local rivals: { [Fighter]: { Extent } } = {}
	local grids: { [Fighter]: Grid } = {}
	for _, pair in pairs do
		for k = 1, 2 do
			local mine, theirs = pair[k], pair[3 - k]
			local list = rivals[mine.fighter] or {}
			table.insert(list, theirs)
			rivals[mine.fighter] = list
			grids[theirs.fighter] = grids[theirs.fighter] or buildGrid(theirs.soldiers)
		end
	end

	for attackerOwner, enemies in rivals do
		for _, ac in attackerOwner.army.clusters do
			-- The main group (no parent) hits at full damage; split-off groups by their size.
			local share = if ac.parentId == 0 then 1 else clusterDamageShare(#ac.cluster.soldiers)
			for _, attacker in ac.cluster.soldiers do
				if attacker.hp > 0 and now >= attacker.nextAttackAt then
					local ranged = attacker.role == "archer"
					local range = if ranged then settings.archer.range else settings.attackRange
					local target: Army.Soldier? = nil
					local targetOwner: Fighter? = nil
					local bestDistance = range
					for _, enemy in enemies do
						forEachNear(grids[enemy.fighter], attacker.x, attacker.z, range, function(e)
							if e.hp <= 0 then
								return
							end
							local d = math.sqrt((e.x - attacker.x) ^ 2 + (e.z - attacker.z) ^ 2)
							if d <= bestDistance then
								bestDistance = d
								target = e
								targetOwner = enemy.fighter
							end
						end)
					end
					if target and targetOwner then
						-- One blow: damage the target, reset the attacker's swing, mark both armies as fighting.
						local base = (if ranged then settings.archer.damage else settings.damage) * share
						local damage = math.round(base * (1 + (rng:NextNumber() * 2 - 1) * settings.damageVariance))
						target.hp = math.max(0, target.hp - damage)
						local interval = if ranged then settings.archer.attackInterval else settings.attackInterval
						attacker.nextAttackAt = now + interval * (0.9 + rng:NextNumber() * 0.2)
						attackerOwner.lastCombatAt = now
						targetOwner.lastCombatAt = now
						table.insert(hits, { attacker = attacker, target = target, attackerOwner = attackerOwner, targetOwner = targetOwner, ranged = ranged })
					end
				end
			end
		end
	end
	return hits
end

-- Remove soldiers with no health left. Returns who died, and who killed them.
function Combat.removeDead(fighters: { Fighter }, hits: { Hit }): { Death }
	local killerOf: { [Army.Soldier]: Fighter } = {}
	for _, h in hits do
		if h.target.hp <= 0 then
			killerOf[h.target] = h.attackerOwner
		end
	end
	local deaths: { Death } = {}
	for _, owner in fighters do
		for _, ac in owner.army.clusters do
			local soldiers = ac.cluster.soldiers
			for i = #soldiers, 1, -1 do
				local s = soldiers[i]
				if s.hp <= 0 then
					local killer = killerOf[s]
					table.insert(deaths, { soldier = s, owner = owner, killer = killer })
					if killer then
						killer.kills += 1
					end
					table.remove(soldiers, i)
				end
			end
		end
	end
	return deaths
end

-- Heal injured soldiers of armies that have been out of combat long enough.
function Combat.regenerate(fighters: { Fighter }, now: number, dt: number)
	for _, f in fighters do
		if f.alive and now - f.lastCombatAt >= settings.regenDelay then
			for _, s in PlayerArmy.allSoldiers(f.army) do
				if s.hp > 0 and s.hp < s.maxHp then
					s.hp = math.min(s.maxHp, s.hp + s.maxHp * settings.regenPerSecond * dt)
				end
			end
		end
	end
end

-- Army strength for decisions: total remaining health.
function Combat.strength(f: Fighter): number
	local total = 0
	for _, s in PlayerArmy.allSoldiers(f.army) do
		total += s.hp
	end
	return total
end

-- Average health share of an army's soldiers (1 = all healthy).
function Combat.averageHealth(f: Fighter): number
	local soldiers = PlayerArmy.allSoldiers(f.army)
	if #soldiers == 0 then
		return 0
	end
	local total = 0
	for _, s in soldiers do
		total += s.hp / s.maxHp
	end
	return total / #soldiers
end

return Combat
