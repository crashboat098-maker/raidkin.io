--!strict
--[[
	The web game's real pixel art (exported from it into roblox/art/ and uploaded
	to Roblox; see ArtIds). Every sprite lives on one sheet; Sprites.json says
	where each one is. A second, mirrored sheet gives the left-facing versions
	(Roblox images can't be flipped on the fly).

	Art.enabled is false until every image id in ArtIds is filled in: until
	then the game keeps its 3D look.
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local ArtIds = require(Shared:WaitForChild("ArtIds"))
local frames: { [string]: { number } } = require(Shared:WaitForChild("Sprites")) :: any

local Art = {}

-- Width of the sprite sheet (px): mirrored sprites sit at (SHEET_WIDTH - x - w).
local SHEET_WIDTH = 1024

Art.enabled = ArtIds.ready
Art.groundIds = ArtIds.ground

-- The web game's colour names for Roblox's army colours (Config.colors, in order).
local COLOR_NAMES = { "crimson", "azure", "gold", "emerald", "violet", "ember", "frost", "rose" }

function Art.colorName(colorIndex: number): string?
	return COLOR_NAMES[colorIndex]
end

-- The sprite for a soldier of this class (0 Warrior, 1 Archer, 2 Guardian) and army colour (0 = neutral).
function Art.soldierKey(role: number, colorIndex: number): string
	local color = COLOR_NAMES[colorIndex]
	if not color then
		return "warrior-neutral"
	end
	if role == 1 then
		return "archer-" .. color
	elseif role == 2 then
		return "guardian-" .. color
	end
	return "warrior-" .. color
end

-- Where a sprite is on the sheet (x, y, w, h), or nil if there's no such sprite.
function Art.frame(key: string): { number }?
	return frames[key]
end

-- Point an image at a sprite, facing right or (flipped) left. Returns its size in px.
function Art.show(label: ImageLabel, key: string, flipped: boolean): (number, number)
	local f = frames[key]
	if not f then
		label.Visible = false
		return 0, 0
	end
	label.Visible = true
	label.Image = if flipped then ArtIds.spritesFlipped else ArtIds.sprites
	label.ImageRectOffset = Vector2.new(if flipped then SHEET_WIDTH - f[1] - f[3] else f[1], f[2])
	label.ImageRectSize = Vector2.new(f[3], f[4])
	return f[3], f[4]
end

-- A blank sprite image (crisp pixels, no background), ready for Art.show.
function Art.newLabel(parent: Instance?): ImageLabel
	local label = Instance.new("ImageLabel")
	label.BackgroundTransparency = 1
	label.BorderSizePixel = 0
	label.ResampleMode = Enum.ResamplerMode.Pixelated
	label.ScaleType = Enum.ScaleType.Stretch
	label.Parent = parent
	return label
end

return Art
