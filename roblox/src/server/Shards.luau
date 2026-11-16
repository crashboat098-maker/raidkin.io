--!strict
-- Soul shards: the collectible resource. Ported from the web's SoulShards.ts.
--
-- A fixed pool is made once; collecting a shard switches it off and schedules
-- it to come back somewhere else. Nothing is created or destroyed during play,
-- so every shard keeps its id, and players only need to hear what changed.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Map = require(ReplicatedStorage.Shared.Map)

local Shards = {}

export type Shard = {
	id: number,
	-- Common blue crystals recruit Warriors; rare green ones recruit Archers.
	green: boolean,
	x: number,
	z: number,
	active: boolean,
	-- When an inactive shard comes back (seconds, server clock).
	respawnAt: number,
}

local settings = Config.shards
local rng = Random.new(20261108)
local margin = Config.world.margin + 10
local size = Config.world.size

Shards.list = {} :: { Shard }

local function distanceSquared(ax: number, az: number, bx: number, bz: number): number
	return (ax - bx) ^ 2 + (az - bz) ^ 2
end

-- A random spot on open ground (see Map), not crowded by other shards and away from `avoid` (army positions).
local function findSpot(avoid: { Vector2 }): (number, number)
	local spacing2 = settings.minSpacing ^ 2
	local away2 = settings.respawnAwayFromPlayers ^ 2
	local x, z = 0, 0
	for _ = 1, 25 do
		x, z = Map.randomOpenSpot(rng)
		local ok = true
		for _, s in Shards.list do
			if s.active and distanceSquared(s.x, s.z, x, z) < spacing2 then
				ok = false
				break
			end
		end
		if ok then
			for _, p in avoid do
				if distanceSquared(p.X, p.Y, x, z) < away2 then
					ok = false
					break
				end
			end
		end
		if ok then
			return x, z
		end
	end
	-- Very crowded: take the last try rather than looping forever.
	return x, z
end

function Shards.create()
	local playable = (size - margin * 2) ^ 2
	local count = math.round(playable / 1_000_000 * settings.perMillionSquarePixels)
	-- Every Nth shard is green, evenly through the pool, so they're spread across the map.
	local greenEvery = math.max(2, math.round(1 / settings.greenShare))
	for id = 1, count do
		local x, z = findSpot({})
		table.insert(Shards.list, { id = id, green = id % greenEvery == 0, x = x, z = z, active = true, respawnAt = 0 })
	end
end

--[[
	Collect every active shard touching (x, z) from `candidates`. Returns how
	many blue and green ones were picked up, and adds them to `changed`.
]]
function Shards.collectAt(x: number, z: number, now: number, candidates: { Shard }, changed: { Shard }): (number, number)
	local r2 = settings.pickupRadius ^ 2
	local blue, green = 0, 0
	for _, shard in candidates do
		if shard.active and distanceSquared(shard.x, shard.z, x, z) <= r2 then
			shard.active = false
			shard.respawnAt = now + rng:NextNumber(settings.respawnDelay.min, settings.respawnDelay.max)
			table.insert(changed, shard)
			if shard.green then
				green += 1
			else
				blue += 1
			end
		end
	end
	return blue, green
end

-- The active shards near a box (so a big army checks only the few around it).
function Shards.activeNear(minX: number, minZ: number, maxX: number, maxZ: number): { Shard }
	local r = settings.pickupRadius
	local near = {}
	for _, s in Shards.list do
		if s.active and s.x >= minX - r and s.x <= maxX + r and s.z >= minZ - r and s.z <= maxZ + r then
			table.insert(near, s)
		end
	end
	return near
end

-- Bring back shards whose time has come, away from `players`; adds them to `changed`.
function Shards.update(now: number, players: { Vector2 }, changed: { Shard })
	for _, shard in Shards.list do
		if not shard.active and now >= shard.respawnAt then
			shard.x, shard.z = findSpot(players)
			shard.active = true
			table.insert(changed, shard)
		end
	end
end

return Shards
