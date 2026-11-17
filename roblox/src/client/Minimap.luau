--!strict
--[[
	The minimap, like the web version's: the whole battlefield in a small square
	at the top left (the web game's own ground picture, shrunk), a box showing
	what's on your screen, and a dot for each of your army's groups. It never
	shows other players. M hides and shows it.
]]

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Art = require(script.Parent:WaitForChild("Art"))

local Minimap = {}

-- Size on screen (px), and where (below Roblox's own buttons at the top left).
local SIZE = 160
local LEFT, TOP = 12, 62
local WORLD = Config.world.size
local SCALE = SIZE / WORLD
local YOU = Color3.fromRGB(255, 214, 102)
-- How often the markers move (s).
local REFRESH = 0.1

local frame: Frame? = nil
local viewBox: Frame? = nil
local dots: { Frame } = {}
local nextAt = 0

local function build(): Frame
	local gui = Instance.new("ScreenGui")
	gui.Name = "Minimap"
	gui.ResetOnSpawn = false
	gui.DisplayOrder = 2
	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

	local f = Instance.new("Frame")
	f.Position = UDim2.fromOffset(LEFT, TOP)
	f.Size = UDim2.fromOffset(SIZE, SIZE)
	f.BackgroundColor3 = Color3.fromRGB(23, 45, 34)
	f.BackgroundTransparency = 0.15
	f.ClipsDescendants = true
	f.Parent = gui
	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.fromRGB(12, 24, 18)
	stroke.Thickness = 2
	stroke.Transparency = 0.3
	stroke.Parent = f

	-- The map: the 9 ground pictures, shrunk to fit.
	for row, ids in Art.groundIds do
		for col, id in ids do
			local x0, z0 = (col - 1) * 1024, (row - 1) * 1024
			local w, h = math.min(1024, WORLD - x0), math.min(1024, WORLD - z0)
			local image = Instance.new("ImageLabel")
			image.BackgroundTransparency = 1
			image.Image = id
			image.ImageTransparency = 0.15
			image.Position = UDim2.fromOffset(x0 * SCALE, z0 * SCALE)
			image.Size = UDim2.fromOffset(math.ceil(w * SCALE) + 1, math.ceil(h * SCALE) + 1)
			image.Parent = f
		end
	end

	-- What's on screen right now.
	local box = Instance.new("Frame")
	box.BackgroundTransparency = 1
	box.ZIndex = 2
	box.Parent = f
	local boxStroke = Instance.new("UIStroke")
	boxStroke.Color = Color3.fromRGB(255, 240, 200)
	boxStroke.Transparency = 0.45
	boxStroke.Thickness = 1
	boxStroke.Parent = box
	viewBox = box
	frame = f
	return f
end

local function dot(parent: Frame): Frame
	local d = Instance.new("Frame")
	d.AnchorPoint = Vector2.new(0.5, 0.5)
	d.Size = UDim2.fromOffset(6, 6)
	d.BackgroundColor3 = YOU
	d.ZIndex = 3
	d.Parent = parent
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.5, 0)
	corner.Parent = d
	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.new(0, 0, 0)
	stroke.Transparency = 0.2
	stroke.Thickness = 1.5
	stroke.Parent = d
	table.insert(dots, d)
	return d
end

--[[
	Update the markers: `groups` are where your army's groups are (world px, empty
	when you're not playing); the view is the world px rectangle on screen.
]]
function Minimap.update(now: number, groups: { Vector2 }, viewX: number, viewZ: number, viewW: number, viewH: number)
	if not Art.enabled or now < nextAt then
		return
	end
	nextAt = now + REFRESH
	local f = frame or build()
	local box = viewBox :: Frame
	box.Position = UDim2.fromOffset(math.max(0, viewX * SCALE), math.max(0, viewZ * SCALE))
	box.Size = UDim2.fromOffset(math.min(SIZE, viewW * SCALE), math.min(SIZE, viewH * SCALE))
	for i, g in groups do
		local d = dots[i] or dot(f)
		d.Visible = true
		d.Position = UDim2.fromOffset(math.clamp(g.X * SCALE, 0, SIZE), math.clamp(g.Y * SCALE, 0, SIZE))
	end
	for i = #groups + 1, #dots do
		dots[i].Visible = false
	end
end

-- M hides and shows the minimap.
UserInputService.InputBegan:Connect(function(input, typing)
	local f = frame
	if not typing and f and input.KeyCode == Enum.KeyCode.M then
		f.Visible = not f.Visible
	end
end)

return Minimap
