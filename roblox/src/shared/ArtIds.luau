--!strict
--[[
	The Roblox image ids of the web game's artwork (the files in roblox/art/,
	uploaded to Roblox: Studio > View > Asset Manager > Bulk Import). Paste each
	one's id here, as "rbxassetid://123456789".

	While any of these is empty, the game keeps its 3D look (Terrain and blocky
	models); once they're all filled in, it draws the real pixel art instead.
]]

local ids = {
	-- sprites.png, and sprites-flipped.png (the same sheet mirrored, for things facing left).
	sprites = "rbxassetid://83512282280557",
	spritesFlipped = "rbxassetid://125901754123734",
	-- ground-<row>-<column>.png: row 0 is the top (north) of the map, column 0 the left (west).
	ground = {
		{ "rbxassetid://102650027192341", "rbxassetid://138112191159756", "rbxassetid://91795030892406" }, -- ground-0-0, ground-0-1, ground-0-2
		{ "rbxassetid://121394212456379", "rbxassetid://81139220143036", "rbxassetid://106983948814190" }, -- ground-1-0, ground-1-1, ground-1-2
		{ "rbxassetid://138772843166274", "rbxassetid://115661711316791", "rbxassetid://74979694662053" }, -- ground-2-0, ground-2-1, ground-2-2
	},
}

-- True once every id above is filled in (then the game draws the pixel art).
local function filled(id: string): boolean
	return id ~= ""
end
local ready = filled(ids.sprites) and filled(ids.spritesFlipped)
for _, row in ids.ground do
	for _, id in row do
		ready = ready and filled(id)
	end
end

return {
	sprites = ids.sprites,
	spritesFlipped = ids.spritesFlipped,
	ground = ids.ground,
	ready = ready,
}
