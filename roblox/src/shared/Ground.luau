--!strict
--[[
	How high the ground's surface really is (in studs). The battlefield is built
	as Terrain cells that end at y = 0, but Roblox draws smooth terrain's surface
	a little higher than that, which buried soldiers up to their heads. The server
	measures the real surface once the terrain is built (see Battlefield) and
	shares it; everything that stands on the ground is drawn this much higher.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Ground = {}

local ATTRIBUTE = "GroundHeight"
local cached: number? = nil

-- The ground's surface height (0 until the server has measured it).
function Ground.height(): number
	if cached then
		return cached
	end
	local value = ReplicatedStorage:GetAttribute(ATTRIBUTE)
	if typeof(value) == "number" then
		cached = value
		return value
	end
	return 0
end

-- The server shares the measured height (players' games read it with Ground.height).
function Ground.set(height: number)
	cached = height
	ReplicatedStorage:SetAttribute(ATTRIBUTE, height)
end

return Ground
