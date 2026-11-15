--!strict
--[[
	The battlefield, as exported from the web version by
	scripts/export-roblox-map.ts (MapData.json, the same map as the web game).
	This unpacks it once at start-up and answers questions about it: where the
	solid things are, where it's wet or burning, and where things may appear.
	(Battlefield draws it; see that file for what each piece looks like.)
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Obstacles = require(ReplicatedStorage.Shared.Obstacles)
local data = require(script.Parent.MapData) :: any

local Map = {}

Map.data = data
Map.size = data.size :: number
Map.tile = data.tile :: number
Map.cols = data.cols :: number
Map.rows = data.rows :: number
-- Where armies may walk (inside the forest border).
Map.playArea = { x = data.playArea.x, z = data.playArea.y, w = data.playArea.width, h = data.playArea.height }
Map.spawn = Vector2.new(data.spawn.x, data.spawn.y)

-- "1,2,3" -> { 1, 2, 3 }
function Map.numbers(text: string): { number }
	local out = {}
	if text == "" then
		return out
	end
	for _, part in string.split(text, ",") do
		table.insert(out, tonumber(part) :: number)
	end
	return out
end

-- A yes/no grid stored as run lengths (alternating no/yes, starting with no), as a buffer of 0/1.
local function unpackRuns(text: string, count: number): buffer
	local grid = buffer.create(count)
	local index = 0
	local value = 0
	for _, run in Map.numbers(text) do
		if value == 1 then
			buffer.fill(grid, index, 1, run)
		end
		index += run
		value = 1 - value
	end
	return grid
end

-- Fine gameplay grids (8 px cells): wading water and lava.
local fine = data.fine :: number
local fineCols = data.fineCols :: number
local water = unpackRuns(data.water, fineCols * fineCols)
local lava = unpackRuns(data.lava, fineCols * fineCols)

local function fineAt(grid: buffer, x: number, z: number): boolean
	local c, r = math.floor(x / fine), math.floor(z / fine)
	if c < 0 or r < 0 or c >= fineCols or r >= fineCols then
		return false
	end
	return buffer.readu8(grid, r * fineCols + c) == 1
end

-- Is (x, z) in wadeable water (not on a bridge)? Is it in lava?
function Map.inWater(x: number, z: number): boolean
	return fineAt(water, x, z)
end
function Map.inLava(x: number, z: number): boolean
	return fineAt(lava, x, z)
end

-- The solid rectangles, and how wading slows everyone down.
local rects: { Obstacles.Rect } = {}
local flat = Map.numbers(data.obstacles)
for i = 1, #flat, 4 do
	table.insert(rects, { x = flat[i], z = flat[i + 1], w = flat[i + 2], h = flat[i + 3] })
end
Map.obstacles = Obstacles.new(rects, function(x, z)
	return if fineAt(water, x, z) then Config.water.slowdown else 1
end)

-- Tiles where things (shards, wanderers, new armies) may appear: open ground,
-- away from the edge, buildings and decorations.
local itemGrid = unpackRuns(data.itemTiles, Map.cols * Map.rows)
local itemTiles: { number } = {}
for i = 0, Map.cols * Map.rows - 1 do
	if buffer.readu8(itemGrid, i) == 1 then
		table.insert(itemTiles, i)
	end
end

-- A random open spot (somewhere inside a random item tile).
function Map.randomOpenSpot(rng: Random): (number, number)
	local tile = itemTiles[rng:NextInteger(1, #itemTiles)]
	local col, row = tile % Map.cols, tile // Map.cols
	return col * Map.tile + rng:NextNumber(3, Map.tile - 3), row * Map.tile + rng:NextNumber(4, Map.tile - 2)
end

-- Where village folk and forest folk live (they're recruitable neutrals).
Map.villagerHomes = {} :: { Vector2 }
for _, village in data.villages do
	local homes = Map.numbers(village.homes)
	for i = 1, #homes, 2 do
		table.insert(Map.villagerHomes, Vector2.new(homes[i], homes[i + 1]))
	end
end
local folk = Map.numbers(data.folkHomes)
for i = 1, #folk, 2 do
	table.insert(Map.villagerHomes, Vector2.new(folk[i], folk[i + 1]))
end

return Map
