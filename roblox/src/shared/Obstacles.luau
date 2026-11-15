--!strict
--[[
	Solid things that block movement (walls, buildings, tree trunks, boulders...),
	ported from the web's Obstacles.ts. Each obstacle is a rectangle on the
	ground ({ x, z, w, h }, in px). They're sorted into a coarse grid of buckets,
	so a moving body only checks the few obstacles near it.

	A moving body is a box around its feet: `halfWidth` either side, and `depth`
	toward the north (-z), like the web version.

	Water and lava aren't obstacles: they're walkable. `speedFactorAt` says how
	much slower things move somewhere (water slows everyone down).
]]

local Obstacles = {}

export type Rect = { x: number, z: number, w: number, h: number }

export type Obstacles = {
	-- Move a body at (x, z) by (dx, dz), stopping at obstacles. X and Z are handled
	-- separately, so bumping a wall at an angle slides along it. Returns the new
	-- position and whether each axis was blocked.
	move: (x: number, z: number, halfWidth: number, depth: number, dx: number, dz: number) -> (number, number, boolean, boolean),
	-- Would a body standing at (x, z) overlap an obstacle?
	blockedAt: (x: number, z: number, halfWidth: number, depth: number) -> boolean,
	-- Speed multiplier for something standing at (x, z) (slower in water).
	speedFactorAt: (x: number, z: number) -> number,
	-- How costly walking over (x, z) is when planning a route: 1 on dry ground or
	-- a bridge, more in water (slow) and much more in lava (it burns).
	travelCost: (x: number, z: number) -> number,
}

local CELL = 64
-- Tiny gap left between a body and a wall after being pushed out.
local EPSILON = 0.01

local function intersects(ax: number, az: number, aw: number, ah: number, b: Rect): boolean
	return ax < b.x + b.w and ax + aw > b.x and az < b.z + b.h and az + ah > b.z
end

-- An obstacle map with no obstacles and no slow ground (open field).
function Obstacles.none(): Obstacles
	return {
		move = function(x, z, _, _, dx, dz)
			return x + dx, z + dz, false, false
		end,
		blockedAt = function()
			return false
		end,
		speedFactorAt = function()
			return 1
		end,
		travelCost = function()
			return 1
		end,
	}
end

function Obstacles.new(rects: { Rect }, speedFactorAt: ((number, number) -> number)?, travelCost: ((number, number) -> number)?): Obstacles
	local cells: { [number]: { Rect } } = {}

	local function forEachCell(x: number, z: number, w: number, h: number, fn: (key: number) -> ())
		for r = math.floor(z / CELL), math.floor((z + h) / CELL) do
			for c = math.floor(x / CELL), math.floor((x + w) / CELL) do
				fn(r * 10000 + c)
			end
		end
	end

	for _, rect in rects do
		forEachCell(rect.x, rect.z, rect.w, rect.h, function(key)
			local bucket = cells[key]
			if bucket then
				table.insert(bucket, rect)
			else
				cells[key] = { rect }
			end
		end)
	end

	local function nearby(x: number, z: number, w: number, h: number): { Rect }
		local found = {}
		forEachCell(x, z, w, h, function(key)
			local bucket = cells[key]
			if bucket then
				for _, o in bucket do
					if not table.find(found, o) then
						table.insert(found, o)
					end
				end
			end
		end)
		return found
	end

	local map: Obstacles = {
		move = function(px, pz, halfWidth, depth, dx, dz)
			local x, z = px + dx, pz
			local blockedX, blockedZ = false, false
			if dx ~= 0 then
				for _, o in nearby(x - halfWidth, z - depth, halfWidth * 2, depth) do
					if intersects(x - halfWidth, z - depth, halfWidth * 2, depth, o) then
						x = if dx > 0 then o.x - halfWidth - EPSILON else o.x + o.w + halfWidth + EPSILON
						blockedX = true
					end
				end
			end
			z += dz
			if dz ~= 0 then
				for _, o in nearby(x - halfWidth, z - depth, halfWidth * 2, depth) do
					if intersects(x - halfWidth, z - depth, halfWidth * 2, depth, o) then
						z = if dz > 0 then o.z - EPSILON else o.z + o.h + depth + EPSILON
						blockedZ = true
					end
				end
			end
			return x, z, blockedX, blockedZ
		end,
		blockedAt = function(x, z, halfWidth, depth)
			for _, o in nearby(x - halfWidth, z - depth, halfWidth * 2, depth) do
				if intersects(x - halfWidth, z - depth, halfWidth * 2, depth, o) then
					return true
				end
			end
			return false
		end,
		speedFactorAt = speedFactorAt or function()
			return 1
		end,
		travelCost = travelCost or function()
			return 1
		end,
	}
	return map
end

return Obstacles
