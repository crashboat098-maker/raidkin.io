--!strict
--[[
	The battlefield drawn with the web game's real pixel art (see Art), the way
	the web game draws it:

	  - The ground is the web game's own ground picture (biomes, rivers, lava,
	    roads, bridges, the arena floor, pebbles and flowers all painted in), laid
	    on the floor as 9 tiles, so the castle circles and name tags still sit on
	    and above it in 3D.
	  - Everything standing (trees, rocks, buildings, soldiers, shards, bodies) is
	    a flat sprite in one 2D layer locked to the camera, sorted like the web
	    game: whatever stands lower on the screen is drawn in front.

	The camera looks straight down (see the client's Main), so the 2D layer and
	the 3D ground line up exactly. Only the layer moves each frame (and soldiers
	within it); scenery is created only near the camera.
]]

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Art = require(script.Parent:WaitForChild("Art"))

local S = Config.STUDS_PER_PX
local WORLD = Config.world.size
local TILE = 1024
-- Scenery is created a cell at a time, for cells within the view plus this margin (px).
local CELL = 256
local MARGIN = 256
local HIT_TINT = Color3.fromRGB(255, 120, 110)
-- If the ground pictures come out turned the wrong way, turn them here (degrees).
local GROUND_TURN = 0

local SpriteLayer = {}

local gui: ScreenGui? = nil
local world: Frame? = nil
local scaler: UIScale? = nil

-- Draw order: four steps per pixel row, so shadows go under bodies on the same row.
local function zOf(y: number, step: number): number
	return math.floor(y) * 4 + step
end

-- ---------------------------------------------------------------------------
-- Setting up
-- ---------------------------------------------------------------------------

local function buildGround()
	local folder = Instance.new("Folder")
	folder.Name = "GroundArt"
	for row, ids in Art.groundIds do
		for col, id in ids do
			local x0, z0 = (col - 1) * TILE, (row - 1) * TILE
			local w, h = math.min(TILE, WORLD - x0), math.min(TILE, WORLD - z0)
			local p = Instance.new("Part")
			p.Name = string.format("Ground%d%d", row - 1, col - 1)
			p.Size = Vector3.new(w * S, 0.2, h * S)
			p.CFrame = CFrame.new((x0 + w / 2) * S, -0.1, (z0 + h / 2) * S) * CFrame.Angles(0, math.rad(GROUND_TURN), 0)
			p.Anchored = true
			p.CanCollide = false
			p.CanQuery = false
			p.CanTouch = false
			p.CastShadow = false
			p.Material = Enum.Material.SmoothPlastic
			p.Color = Color3.fromRGB(70, 100, 50)
			p.Parent = folder
			local surface = Instance.new("SurfaceGui")
			surface.Face = Enum.NormalId.Top
			surface.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
			surface.PixelsPerStud = 4 / S -- 4 screen px per picture px
			surface.LightInfluence = 0
			surface.Parent = p
			local image = Instance.new("ImageLabel")
			image.Size = UDim2.fromScale(1, 1)
			image.BackgroundTransparency = 1
			image.Image = id
			image.ResampleMode = Enum.ResamplerMode.Pixelated
			image.Parent = surface
		end
	end
	folder.Parent = Workspace
end

-- Make the 2D layer (once, the first time the game draws with art).
local function layer(): Frame
	local existing = world
	if existing then
		return existing
	end
	local screen = Instance.new("ScreenGui")
	screen.Name = "Battlefield2D"
	screen.IgnoreGuiInset = true
	screen.ResetOnSpawn = false
	screen.DisplayOrder = -10 -- under the HUD
	screen.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	screen.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	local frame = Instance.new("Frame")
	frame.Name = "World"
	frame.BackgroundTransparency = 1
	frame.Size = UDim2.fromOffset(WORLD, WORLD)
	frame.Parent = screen
	local scale = Instance.new("UIScale")
	scale.Parent = frame
	gui, world, scaler = screen, frame, scale
	buildGround()
	return frame
end

-- A sprite at world pixel (x, y) by its feet (bottom middle).
local function standing(label: ImageLabel, key: string, flipped: boolean, x: number, y: number, z: number)
	local w, h = Art.show(label, key, flipped)
	label.Size = UDim2.fromOffset(w, h)
	label.Position = UDim2.fromOffset(math.floor(x - w / 2 + 0.5), math.floor(y + 0.5) - h)
	label.ZIndex = z
end

-- A soft shadow, w x h px, centred on (x, y).
local function shadow(label: ImageLabel, w: number, h: number, x: number, y: number, alpha: number, z: number)
	Art.show(label, "shadow", false)
	label.Size = UDim2.fromOffset(w, h)
	label.Position = UDim2.fromOffset(math.floor(x - w / 2 + 0.5), math.floor(y - h / 2 + 0.5))
	label.ImageTransparency = 1 - alpha
	label.ZIndex = z
end

-- ---------------------------------------------------------------------------
-- Scenery: trees, rocks, buildings... (from Scenery.json), near the camera only
-- ---------------------------------------------------------------------------

local scenery = require(Shared:WaitForChild("Scenery")) :: any
local sceneryKeys: { string } = scenery.keys
local items: { number } = {}
for value in string.gmatch(scenery.items, "[^,]+") do
	table.insert(items, tonumber(value) :: number)
end
local CELLS_ACROSS = math.ceil(WORLD / CELL)
-- Which items are in each cell (by the index of their first number).
local cellItems: { [number]: { number } } = {}
for i = 1, #items, 5 do
	local key = math.floor(items[i + 1] / CELL) + math.floor(items[i + 2] / CELL) * CELLS_ACROSS
	local list = cellItems[key]
	if not list then
		list = {}
		cellItems[key] = list
	end
	table.insert(list, i)
end
local liveCells: { [number]: Folder } = {}

local function buildCell(key: number, parent: Frame): Folder
	local holder = Instance.new("Folder")
	holder.Name = "Cell" .. key
	for _, i in cellItems[key] or {} do
		local name = sceneryKeys[items[i] + 1]
		local x, y, flipped, shadowWidth = items[i + 1], items[i + 2], items[i + 3] == 1, items[i + 4]
		if shadowWidth > 0 then
			-- Buildings (the wide ones) get a slightly bigger, darker shadow.
			local building = shadowWidth >= 32
			shadow(Art.newLabel(holder), shadowWidth, if building then 8 else 6, x, y - 1, if building then 0.8 else 0.7, zOf(y, 1))
		end
		standing(Art.newLabel(holder), name, flipped, x, y, zOf(y, 2))
	end
	holder.Parent = parent
	return holder
end

-- Create scenery coming into view and drop what's well out of it.
local function updateScenery(parent: Frame, fx: number, fz: number, halfW: number, halfH: number)
	local c0 = math.max(0, math.floor((fx - halfW - MARGIN) / CELL))
	local c1 = math.min(CELLS_ACROSS - 1, math.floor((fx + halfW + MARGIN) / CELL))
	local r0 = math.max(0, math.floor((fz - halfH - MARGIN) / CELL))
	local r1 = math.min(CELLS_ACROSS - 1, math.floor((fz + halfH + MARGIN) / CELL))
	local wanted: { [number]: boolean } = {}
	for r = r0, r1 do
		for c = c0, c1 do
			local key = c + r * CELLS_ACROSS
			wanted[key] = true
			if not liveCells[key] then
				liveCells[key] = buildCell(key, parent)
			end
		end
	end
	for key, holder in liveCells do
		if not wanted[key] then
			holder:Destroy()
			liveCells[key] = nil
		end
	end
end

-- ---------------------------------------------------------------------------
-- Following the camera
-- ---------------------------------------------------------------------------

--[[
	Line the layer up with the camera: (fx, fz) is the world pixel at the middle
	of the screen, and `zoom` how many screen pixels one world pixel covers.
]]
local current = { fx = 0, fz = 0, zoom = 1 }

-- Returns the camera focus actually used (snapped so the layer sits on whole screen pixels).
function SpriteLayer.update(fx: number, fz: number, zoom: number): (number, number)
	local frame = layer()
	local camera = Workspace.CurrentCamera
	local view = camera.ViewportSize
	local left = math.floor(view.X / 2 - fx * zoom + 0.5)
	local top = math.floor(view.Y / 2 - fz * zoom + 0.5)
	frame.Position = UDim2.fromOffset(left, top)
	fx, fz = (view.X / 2 - left) / zoom, (view.Y / 2 - top) / zoom
	current.fx, current.fz, current.zoom = fx, fz, zoom
	local scale = scaler :: UIScale
	scale.Scale = zoom
	updateScenery(frame, fx, fz, view.X / 2 / zoom, view.Y / 2 / zoom)
	return fx, fz
end

-- The world pixel under a screen point (e.g. the mouse), and the current zoom.
function SpriteLayer.toWorld(sx: number, sy: number): (number, number, number)
	local view = Workspace.CurrentCamera.ViewportSize
	return current.fx + (sx - view.X / 2) / current.zoom, current.fz + (sy - view.Y / 2) / current.zoom, current.zoom
end

-- ---------------------------------------------------------------------------
-- Soldiers
-- ---------------------------------------------------------------------------

type Unit = {
	body: ImageLabel,
	foot: ImageLabel,
	bar: Frame,
	key: string,
	flipped: boolean,
	health: number,
	flashUntil: number,
	flashing: boolean,
	seen: boolean,
}
local units: { [number]: Unit } = {}

local function barColor(health: number): Color3
	if health > 60 then
		return Color3.fromRGB(90, 220, 90)
	elseif health > 30 then
		return Color3.fromRGB(240, 200, 60)
	end
	return Color3.fromRGB(230, 60, 50)
end

local function unitFor(id: number, parent: Frame): Unit
	local u = units[id]
	if u then
		return u
	end
	local bar = Instance.new("Frame")
	bar.BorderSizePixel = 0
	bar.Visible = false
	bar.Parent = parent
	u = {
		body = Art.newLabel(parent),
		foot = Art.newLabel(parent),
		bar = bar,
		key = "",
		flipped = false,
		health = 100,
		flashUntil = 0,
		flashing = false,
		seen = true,
	}
	units[id] = u
	return u
end

--[[
	Draw every army (soldiers and neutrals), already blended for this frame by
	the client's Main. `t` is the time in seconds, for the marching bob and hit flashes.
]]
function SpriteLayer.drawArmies(armies: { any }, t: number)
	local frame = layer()
	for _, u in units do
		u.seen = false
	end
	for _, army in armies do
		for id, s in army.soldiers do
			local u = unitFor(id, frame)
			u.seen = true
			-- Face the way it's walking (left or right; straight up or down keeps the last way).
			local side = math.sin(s.yaw)
			local flipped = if side > 0.05 then true elseif side < -0.05 then false else u.flipped
			local key = Art.soldierKey(s.role, army.color)
			local x, y = math.floor(s.x + 0.5), math.floor(s.z + 0.5)
			-- A 1-pixel march bob, out of step from soldier to soldier.
			local bob = if s.moving then math.floor(math.abs(math.sin(t * 20 + id)) + 0.5) else 0
			if key ~= u.key or flipped ~= u.flipped then
				u.key, u.flipped = key, flipped
				local w, h = Art.show(u.body, key, flipped)
				u.body.Size = UDim2.fromOffset(w, h)
				local f = Art.frame("shadow")
				if f then
					shadow(u.foot, f[3] * 0.75, f[4] * 0.8, x, y, 0.9, zOf(y, 0))
				end
			end
			local w, h = u.body.Size.X.Offset, u.body.Size.Y.Offset
			u.body.Position = UDim2.fromOffset(x - math.floor(w / 2), y + 1 - bob - h)
			u.body.ZIndex = zOf(y, 2)
			local fs = u.foot.Size
			u.foot.Position = UDim2.fromOffset(math.floor(x - fs.X.Offset / 2 + 0.5), math.floor(y - fs.Y.Offset / 2 + 0.5))
			u.foot.ZIndex = zOf(y, 0)

			-- Hit: flash red. Injured: a small health bar over the head.
			if s.health < u.health then
				u.flashUntil = t + 0.12
			end
			if s.health ~= u.health then
				u.health = s.health
				u.bar.Visible = s.health < 100
				u.bar.BackgroundColor3 = barColor(s.health)
				u.bar.Size = UDim2.fromOffset(math.max(1, math.floor(10 * s.health / 100 + 0.5)), 1)
			end
			if u.bar.Visible then
				u.bar.Position = UDim2.fromOffset(x - 5, y - h - 2)
				u.bar.ZIndex = zOf(y, 3)
			end
			local flashing = t < u.flashUntil
			if flashing ~= u.flashing then
				u.flashing = flashing
				u.body.ImageColor3 = if flashing then HIT_TINT else Color3.new(1, 1, 1)
			end
		end
	end
	for id, u in units do
		if not u.seen then
			u.body:Destroy()
			u.foot:Destroy()
			u.bar:Destroy()
			units[id] = nil
		end
	end
end

-- ---------------------------------------------------------------------------
-- Soul shards and fallen bodies (the server sends these only when they change)
-- ---------------------------------------------------------------------------

local shards: { [number]: { crystal: ImageLabel, foot: ImageLabel } } = {}

-- Apply a list from the server: { id, x, z, green (0/1), active (0/1), id, ... }.
function SpriteLayer.applyShards(flat: { number })
	local frame = layer()
	for i = 1, #flat, 5 do
		local id, x, y = flat[i], flat[i + 1], flat[i + 2]
		local green, active = flat[i + 3] == 1, flat[i + 4] == 1
		local shard = shards[id]
		if not shard then
			shard = { crystal = Art.newLabel(frame), foot = Art.newLabel(frame) }
			shards[id] = shard
		end
		local f = Art.frame("shadow")
		if f then
			shadow(shard.foot, f[3] * 0.5, f[4] * 0.6, x, y, 0.8, zOf(y, 0))
		end
		standing(shard.crystal, if green then "soul-shard-green" else "soul-shard", false, x, y - 1, zOf(y, 2))
		shard.crystal.Visible = active
		shard.foot.Visible = active
	end
end

local bodies: { [number]: ImageLabel } = {}

--[[
	Apply changes from the server: { added = { id, x, z, yaw, color, awake, ... },
	awoken = { id, ... }, removed = { id, ... } }. A body is faint until it can be revived.
]]
function SpriteLayer.applyBodies(message: { added: { number }, awoken: { number }, removed: { number } })
	local frame = layer()
	local flat = message.added
	for i = 1, #flat, 6 do
		local id, x, y, yaw, color, awake = flat[i], flat[i + 1], flat[i + 2], flat[i + 3], flat[i + 4], flat[i + 5] == 1
		if not bodies[id] then
			local label = Art.newLabel(frame)
			-- Lying on the ground: under anyone standing at the same spot.
			standing(label, "fallen-" .. (Art.colorName(color) or "steel"), math.sin(yaw) > 0, x, y, zOf(y - 6, 2))
			label.ImageTransparency = if awake then 0 else 0.5
			bodies[id] = label
		end
	end
	for _, id in message.awoken do
		local label = bodies[id]
		if label then
			label.ImageTransparency = 0
		end
	end
	for _, id in message.removed do
		local label = bodies[id]
		if label then
			label:Destroy()
			bodies[id] = nil
		end
	end
end

return SpriteLayer
