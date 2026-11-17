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
local Map = require(Shared:WaitForChild("Map"))

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

--[[
	Tall scenery (big trees, buildings) turns see-through while any of your own
	soldiers stands behind it, like the web game: it fades to SEE_THROUGH and back.
]]
type Occluder = { label: ImageLabel, x: number, baseY: number, halfWidth: number, top: number, alpha: number }
local SEE_THROUGH = 0.4
-- Sprites at least this tall (px) count as tall scenery.
local TALL = 24
local occluders: { [number]: { Occluder } } = {}


--[[
	The living world, from the web game (Ambient.json): glowing lights that pulse
	(torches flicker), torch flames, floating wisps and fireflies. Built with the
	scenery near the camera, and animated every frame.
]]
local ambient = require(Shared:WaitForChild("Ambient")) :: any
local function numbers(text: string): { number }
	local list = {}
	for value in string.gmatch(text, "[^,]+") do
		table.insert(list, tonumber(value) :: number)
	end
	return list
end
local glowData = numbers(ambient.glows)
local flameData = numbers(ambient.flames)
local wispData = numbers(ambient.wisps)
local fireflyData = numbers(ambient.fireflies)
local WISP_SPRITES = { "wisp-green", "wisp-purple", "wisp-amber" }
local WISP_COLORS = { Color3.fromRGB(150, 255, 170), Color3.fromRGB(205, 160, 255), Color3.fromRGB(255, 200, 110) }
-- The web game adds its glows as light (they only brighten what's under them);
-- Roblox can only lay them over the ground, where a strong one looks like a pale
-- puddle. So they're kept this much fainter, a gentle tint instead.
local GLOW_STRENGTH = 0.4
-- Lights and flying things draw above everything standing on the map.
local LIGHT_Z = zOf(Config.world.size + 100, 0) - 3

type AmbientKind = "glow" | "flame" | "wisp" | "firefly"
type Ambient = {
	kind: AmbientKind,
	label: ImageLabel,
	-- Extra light around a wisp.
	halo: ImageLabel?,
	x: number,
	y: number,
	-- Glows: size, dimmest and brightest, and how long one pulse takes (s).
	scale: number,
	low: number,
	high: number,
	period: number,
	-- A per-light offset, so they don't all pulse in step.
	phase: number,
	nextFlickerAt: number,
}
-- What's in each cell: { kind, index into its data list }.
local cellAmbient: { [number]: { { any } } } = {}
local function addToCell(kind: AmbientKind, index: number, x: number, y: number)
	local key = math.floor(x / CELL) + math.floor(y / CELL) * CELLS_ACROSS
	local list = cellAmbient[key]
	if not list then
		list = {}
		cellAmbient[key] = list
	end
	table.insert(list, { kind, index })
end
for i = 1, #glowData, 8 do
	addToCell("glow", i, glowData[i], glowData[i + 1])
end
for i = 1, #flameData, 2 do
	addToCell("flame", i, flameData[i], flameData[i + 1])
end
for i = 1, #wispData, 3 do
	addToCell("wisp", i, wispData[i], wispData[i + 1])
end
for i = 1, #fireflyData, 2 do
	addToCell("firefly", i, fireflyData[i], fireflyData[i + 1])
end
local liveAmbient: { [number]: { Ambient } } = {}

local function glowLabel(holder: Instance, color: Color3, size: number, x: number, y: number, z: number): ImageLabel
	local label = Art.newLabel(holder)
	Art.show(label, "glow", false)
	label.ImageColor3 = color
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Size = UDim2.fromOffset(size, size)
	label.Position = UDim2.fromOffset(x, y)
	label.ZIndex = z
	return label
end

local function buildAmbient(key: number, holder: Instance)
	local list: { Ambient } = {}
	for _, entry in cellAmbient[key] or {} do
		local kind: AmbientKind, i: number = entry[1], entry[2]
		local seed = (i * 7919) % 1000 / 1000
		if kind == "glow" then
			local x, y, color = glowData[i], glowData[i + 1], glowData[i + 2]
			local c = Color3.fromRGB(bit32.rshift(color, 16) % 256, bit32.rshift(color, 8) % 256, color % 256)
			local standing = glowData[i + 7] == 1
			local label = glowLabel(holder, c, 32 * glowData[i + 3], x, y, if standing then LIGHT_Z else 1)
			table.insert(list, { kind = kind, label = label, x = x, y = y, scale = glowData[i + 3], low = glowData[i + 4], high = glowData[i + 5], period = math.max(0.1, glowData[i + 6] / 1000), phase = seed * 10, nextFlickerAt = 0 })
		elseif kind == "flame" then
			local x, y = flameData[i], flameData[i + 1]
			local label = Art.newLabel(holder)
			standing(label, "torch-flame-0", false, x, y, LIGHT_Z + 1)
			table.insert(list, { kind = kind, label = label, x = x, y = y, scale = 1, low = 0, high = 0, period = 0, phase = seed, nextFlickerAt = 0 })
		elseif kind == "wisp" then
			local x, y, colour = wispData[i], wispData[i + 1], wispData[i + 2] + 1
			local label = Art.newLabel(holder)
			Art.show(label, WISP_SPRITES[colour] or WISP_SPRITES[1], false)
			label.AnchorPoint = Vector2.new(0.5, 0.5)
			label.Size = UDim2.fromOffset(3, 3)
			label.ZIndex = LIGHT_Z + 3
			local halo = glowLabel(holder, WISP_COLORS[colour] or WISP_COLORS[1], 32 * 0.6, x, y, LIGHT_Z + 2)
			table.insert(list, { kind = kind, label = label, halo = halo, x = x, y = y, scale = 0.6, low = 0.3, high = 0.9, period = 2 + seed * 2, phase = seed * 10, nextFlickerAt = 0 })
		else
			local x, y = fireflyData[i], fireflyData[i + 1]
			local label = Art.newLabel(holder)
			Art.show(label, "firefly", false)
			label.AnchorPoint = Vector2.new(0.5, 0.5)
			label.Size = UDim2.fromOffset(3, 3)
			label.ImageColor3 = Color3.fromRGB(255, 240, 150)
			label.ZIndex = LIGHT_Z + 3
			table.insert(list, { kind = "firefly", label = label, x = x, y = y, scale = 1, low = 0, high = 1, period = 2.5 + seed * 2, phase = seed * 10, nextFlickerAt = 0 })
		end
	end
	liveAmbient[key] = list
end

-- Animate the lights and flying things near the camera.
local function updateAmbient(t: number)
	for _, list in liveAmbient do
		for _, a in list do
			if a.kind == "glow" then
				-- Pulse between dim and bright (and grow a little), like the web game's glows.
				local p = 0.5 - 0.5 * math.cos((t + a.phase) * math.pi / a.period)
				a.label.ImageTransparency = 1 - (a.low + (a.high - a.low) * p) * GLOW_STRENGTH
				local size = 32 * a.scale * (0.9 + 0.15 * p)
				a.label.Size = UDim2.fromOffset(size, size)
			elseif a.kind == "flame" then
				-- Torch flames flick between their shapes.
				if t >= a.nextFlickerAt then
					a.nextFlickerAt = t + 0.085
					if math.random() < 0.55 then
						Art.show(a.label, "torch-flame-" .. math.random(0, 2), false)
					end
				end
			elseif a.kind == "wisp" then
				-- Drift in a slow loop, and twinkle.
				local s = (t + a.phase) / a.period
				local x, y = a.x + math.sin(s * 2.1) * 4, a.y + math.cos(s * 1.7) * 3 - 6
				local glow = 0.5 - 0.5 * math.cos(s * math.pi * 2)
				a.label.Position = UDim2.fromOffset(x, y)
				a.label.ImageTransparency = 1 - (a.low + (a.high - a.low) * glow)
				local halo = a.halo
				if halo then
					halo.Position = UDim2.fromOffset(x, y)
					halo.ImageTransparency = 1 - 0.5 * (a.low + (a.high - a.low) * glow) * GLOW_STRENGTH
				end
			else
				-- Fireflies wander and blink.
				local s = (t + a.phase) / a.period
				a.label.Position = UDim2.fromOffset(a.x + math.sin(s * 2.3) * 8 + math.sin(s * 5.1) * 2, a.y + math.cos(s * 1.9) * 6 - 4)
				local blink = math.max(0, math.sin(s * math.pi * 2))
				a.label.ImageTransparency = 1 - blink
			end
		end
	end
end

local function buildCell(key: number, parent: Frame): Folder
	local holder = Instance.new("Folder")
	holder.Name = "Cell" .. key
	local tall: { Occluder } = {}
	for _, i in cellItems[key] or {} do
		local name = sceneryKeys[items[i] + 1]
		local x, y, flipped, shadowWidth = items[i + 1], items[i + 2], items[i + 3] == 1, items[i + 4]
		if shadowWidth > 0 then
			-- Buildings (the wide ones) get a slightly bigger, darker shadow.
			local building = shadowWidth >= 32
			shadow(Art.newLabel(holder), shadowWidth, if building then 8 else 6, x, y - 1, if building then 0.8 else 0.7, zOf(y, 1))
		end
		local label = Art.newLabel(holder)
		standing(label, name, flipped, x, y, zOf(y, 2))
		local f = Art.frame(name)
		if f and f[4] >= TALL then
			table.insert(tall, { label = label, x = x, baseY = y, halfWidth = f[3] / 2 + 4, top = y - f[4] - 4, alpha = 1 })
		end
	end
	occluders[key] = tall
	buildAmbient(key, holder)
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
			occluders[key] = nil
			liveAmbient[key] = nil
		end
	end
end

-- Fade whatever tall scenery stands in front of any of `points` (your soldiers' feet).
local function updateSeeThrough(points: { Vector2 })
	-- The box around all the points: scenery outside it can't have anyone behind it.
	local minX, maxX, minY, maxY = math.huge, -math.huge, math.huge, -math.huge
	for _, p in points do
		minX, maxX = math.min(minX, p.X), math.max(maxX, p.X)
		minY, maxY = math.min(minY, p.Y), math.max(maxY, p.Y)
	end
	for _, list in occluders do
		for _, o in list do
			local behind = false
			if maxY > o.top and minY < o.baseY and maxX > o.x - o.halfWidth and minX < o.x + o.halfWidth then
				for _, p in points do
					if p.Y < o.baseY and p.Y > o.top and math.abs(p.X - o.x) < o.halfWidth then
						behind = true
						break
					end
				end
			end
			local target = if behind then SEE_THROUGH else 1
			if o.alpha ~= target then
				local nextAlpha = o.alpha + (target - o.alpha) * 0.25
				o.alpha = if math.abs(nextAlpha - target) < 0.02 then target else nextAlpha
				o.label.ImageTransparency = 1 - o.alpha
			end
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

-- The world px rectangle on screen right now (left, top, width, height).
function SpriteLayer.viewRect(): (number, number, number, number)
	local view = Workspace.CurrentCamera.ViewportSize
	local w, h = view.X / current.zoom, view.Y / current.zoom
	return current.fx - w / 2, current.fz - h / 2, w, h
end

-- The world pixel under a screen point (e.g. the mouse), and the current zoom.
function SpriteLayer.toWorld(sx: number, sy: number): (number, number, number)
	local view = Workspace.CurrentCamera.ViewportSize
	return current.fx + (sx - view.X / 2) / current.zoom, current.fz + (sy - view.Y / 2) / current.zoom, current.zoom
end

-- ---------------------------------------------------------------------------
-- Effects: sword swings, impacts, arrows, water splashes, soldiers joining
-- (ported from the web game's CombatEffects; purely visual)
-- ---------------------------------------------------------------------------

type FxKind = "blade" | "slash" | "wind" | "spark" | "flash" | "splash" | "ripple" | "arrow" | "join" | "bubble"
type Fx = {
	kind: FxKind,
	label: ImageLabel,
	start: number,
	duration: number,
	x: number,
	y: number,
	-- Direction toward the enemy (radians), which way the blade sweeps (+1 / -1), and travel (px).
	angle: number,
	sweep: number,
	vx: number,
	vy: number,
	-- The sprite's pivot (0-1 across, 0-1 down), and its size (px).
	ox: number,
	oy: number,
	w: number,
	h: number,
}

local FX_SPRITE: { [FxKind]: string } = {
	blade = "fx-blade", slash = "fx-slash", wind = "fx-wind", spark = "fx-spark", flash = "glow",
	splash = "fx-splash", ripple = "fx-ripple", arrow = "fx-arrow", join = "glow", bubble = "lava-bubble",
}
local PIVOT: { [FxKind]: { number } } = {
	blade = { 0.12, 0.5 }, slash = { 0, 0.5 }, wind = { 0, 0.5 }, spark = { 0.5, 0.5 }, flash = { 0.5, 0.5 },
	splash = { 0.5, 1 }, ripple = { 0.5, 0.5 }, arrow = { 0.8, 0.5 }, join = { 0.5, 0.5 }, bubble = { 0.5, 1 },
}
-- Durations (s), from the web game. Short and snappy.
local TIMING = { blade = 0.14, slash = 0.15, slashDelay = 0.035, wind = 0.23, windDelay = 0.05, spark = 0.17, flash = 0.12 }
local SWEEP = math.rad(80)
-- Where the sword hand is, relative to a soldier's feet (px).
local HAND_Y = -6
-- Arrows fly this fast (px/s), in a shallow arc.
local ARROW_SPEED = 350
local ARROW_ARC = 6
-- Effects are drawn above everything standing on the map.
local FX_Z = zOf(Config.world.size + 100, 0)
-- Above this many effects playing at once, the optional extras are skipped.
local MAX_FX = 600
local HIT_GLOW = Color3.fromRGB(255, 214, 140)

local activeFx: { Fx } = {}
local fxPool: { ImageLabel } = {}

-- Blades, slashes and wind sweeping "the other way" are their sprite flipped upside
-- down: the mirrored sheet turned half a turn.
local function isFlipped(kind: FxKind, sweep: number): boolean
	return sweep < 0 and (kind == "blade" or kind == "slash" or kind == "wind")
end

local function spawnFx(kind: FxKind, x: number, y: number, angle: number, sweep: number, vx: number, vy: number, start: number, duration: number): Fx?
	local frame = world
	local f = Art.frame(FX_SPRITE[kind])
	if not frame or not f then
		return nil
	end
	local label = table.remove(fxPool) or Art.newLabel(frame)
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Visible = false
	label.ZIndex = if kind == "ripple" or kind == "splash" or kind == "bubble" then zOf(y, 1) else FX_Z
	Art.show(label, FX_SPRITE[kind], isFlipped(kind, sweep))
	label.ImageColor3 = Color3.new(1, 1, 1)
	local pivot = PIVOT[kind]
	local fx: Fx = { kind = kind, label = label, start = start, duration = duration, x = x, y = y, angle = angle, sweep = sweep, vx = vx, vy = vy, ox = pivot[1], oy = pivot[2], w = f[3], h = f[4] }
	table.insert(activeFx, fx)
	return fx
end

-- Put an effect's sprite at (x, y) by its pivot, scaled, turned `rotation` radians, `alpha` opaque.
local function placeFx(fx: Fx, x: number, y: number, scale: number, rotation: number, alpha: number)
	local w, h = fx.w * scale, fx.h * scale
	local cx, cy = (0.5 - fx.ox) * w, (0.5 - fx.oy) * h
	local c, s = math.cos(rotation), math.sin(rotation)
	local label = fx.label
	label.Size = UDim2.fromOffset(w, h)
	label.Position = UDim2.fromOffset(x + cx * c - cy * s, y + cx * s + cy * c)
	label.Rotation = math.deg(rotation) + (if isFlipped(fx.kind, fx.sweep) then 180 else 0)
	label.ImageTransparency = 1 - math.clamp(alpha, 0, 1)
	label.Visible = true
end

local swingSide = 1
-- A sword swing from (ax, ay) toward (tx, ty): blade sweep, slash trail, wind gust.
local function swing(ax: number, ay: number, tx: number, ty: number, start: number)
	local angle = math.atan2(ty - ay, tx - ax)
	swingSide = -swingSide -- alternate forehand and backhand, so a melee looks lively
	local hx, hy = ax + math.cos(angle) * 2, ay + HAND_Y + math.sin(angle) * 2
	spawnFx("blade", hx, hy, angle, swingSide, 0, 0, start, TIMING.blade)
	if #activeFx > MAX_FX then
		return
	end
	spawnFx("slash", hx, hy, angle, swingSide, 0, 0, start + TIMING.slashDelay, TIMING.slash)
	if #activeFx > MAX_FX * 0.75 then
		return
	end
	spawnFx("wind", hx, hy, angle, swingSide, math.cos(angle) * 9, math.sin(angle) * 9, start + TIMING.windDelay, TIMING.wind)
end

-- A blow landing at (tx, ty), coming from (fromX, fromY): a flash and a few sparks flying away from the attacker.
local function impact(tx: number, ty: number, fromX: number, fromY: number, start: number)
	local away = math.atan2(ty - fromY, tx - fromX)
	local x, y = tx, ty + HAND_Y - 1
	local flash = spawnFx("flash", x, y, 0, 1, 0, 0, start, TIMING.flash)
	if flash then
		flash.label.ImageColor3 = HIT_GLOW
	end
	for _ = 1, if #activeFx > MAX_FX * 0.75 then 1 else 3 do
		local a = away + (math.random() - 0.5) * 1.8
		local d = 6 + math.random() * 5
		spawnFx("spark", x, y, a, 1, math.cos(a) * d, math.sin(a) * d - 2, start, TIMING.spark * (0.8 + math.random() * 0.4))
	end
end

-- An Archer's arrow from (ax, ay) to (tx, ty) in a shallow arc. Returns when it lands.
local function arrow(ax: number, ay: number, tx: number, ty: number, start: number): number
	local sx, sy = ax + (if tx > ax then 4 else -4), ay + HAND_Y
	local ex, ey = tx, ty + HAND_Y
	local duration = math.max(0.08, math.sqrt((ex - sx) ^ 2 + (ey - sy) ^ 2) / ARROW_SPEED)
	spawnFx("arrow", sx, sy, math.atan2(ey - sy, ex - sx), 1, ex - sx, ey - sy, start, duration)
	return start + duration
end

-- A soldier joins an army: a soft burst of light in its colour, and a few sparks.
local function joinBurst(x: number, y: number, color: Color3, start: number)
	local glow = spawnFx("join", x, y - 6, 0, 1, 0, 0, start, 0.45)
	if glow then
		glow.label.ImageColor3 = color
	end
	for i = 1, 6 do
		local a = i / 6 * math.pi * 2
		local spark = spawnFx("spark", x, y - 6, a, 1, math.cos(a) * 10, math.sin(a) * 10 - 4, start, 0.4)
		if spark then
			spark.label.ImageColor3 = color
		end
	end
end

-- Animate every playing effect; recycle finished ones. Once per frame.
local function updateFx(t: number)
	for i = #activeFx, 1, -1 do
		local fx = activeFx[i]
		local p = (t - fx.start) / fx.duration
		if p >= 1 then
			fx.label.Visible = false
			table.insert(fxPool, fx.label)
			activeFx[i] = activeFx[#activeFx]
			activeFx[#activeFx] = nil
		elseif p < 0 then
			fx.label.Visible = false -- a delayed start
		else
			local e = 1 - (1 - p) * (1 - p)
			local kind = fx.kind
			if kind == "blade" then
				placeFx(fx, fx.x, fx.y, 1, fx.angle + fx.sweep * SWEEP * (2 * e - 1), if p < 0.7 then 1 else (1 - p) / 0.3)
			elseif kind == "slash" then
				placeFx(fx, fx.x, fx.y, 0.75 + 0.4 * p, fx.angle, 0.95 * (1 - p))
			elseif kind == "wind" then
				placeFx(fx, fx.x + fx.vx * e, fx.y + fx.vy * e, 0.8 + 0.45 * p, fx.angle, 0.6 * (1 - p))
			elseif kind == "spark" then
				placeFx(fx, fx.x + fx.vx * e, fx.y + fx.vy * e + 4 * p * p, 1, 0, 1 - p)
			elseif kind == "flash" then
				placeFx(fx, fx.x, fx.y, 0.16 + 0.22 * p, 0, 0.85 * (1 - p))
			elseif kind == "join" then
				placeFx(fx, fx.x, fx.y, 0.2 + 1.1 * e, 0, 0.9 * (1 - p))
			elseif kind == "splash" then
				placeFx(fx, fx.x, fx.y + fx.vy * math.sin(math.pi * p), 0.8 + 0.5 * p, 0, 1 - p)
			elseif kind == "bubble" then
				-- Lava bubbles swell up, then pop.
				placeFx(fx, fx.x, fx.y, 0.5 + 0.7 * e, 0, if p < 0.8 then 1 else (1 - p) / 0.2)
			elseif kind == "ripple" then
				placeFx(fx, fx.x, fx.y, 0.6 + 1.1 * p, 0, 0.8 * (1 - p))
			elseif kind == "arrow" then
				-- Along the line to the target, lifted into a shallow arc, nose following the arc.
				local lift = math.sin(math.pi * p) * ARROW_ARC
				local length = math.max(1, math.sqrt(fx.vx * fx.vx + fx.vy * fx.vy))
				local slope = -math.cos(math.pi * p) * ARROW_ARC * math.pi / length
				placeFx(fx, fx.x + fx.vx * p, fx.y + fx.vy * p - lift, 1, fx.angle - slope * (if fx.vx < 0 then -1 else 1), 1)
			end
		end
	end
end

-- Lava bubbles: now and then one swells and pops somewhere on the lava in view.
local nextBubbleAt = 0
local function bubbleLava(t: number)
	if t < nextBubbleAt then
		return
	end
	nextBubbleAt = t + 0.06
	local view = Workspace.CurrentCamera.ViewportSize
	local x = current.fx + (math.random() - 0.5) * view.X / current.zoom
	local y = current.fz + (math.random() - 0.5) * view.Y / current.zoom
	if Map.inLava(x, y) then
		spawnFx("bubble", x, y, 0, 1, 0, 0, t, 0.6 + math.random() * 0.3)
	end
end

-- Archers show their full-draw frame for a moment after loosing an arrow (by soldier id).
local drawUntil: { [number]: number } = {}

--[[
	Blows from the server: { attacker x, z, target x, z, ranged (0/1), attacker id, ... }.
	Shown a moment later, in step with the soldiers (who are drawn a little in the
	past, see the client's Main). Off-screen blows are skipped.
]]
function SpriteLayer.hits(flat: { number }, now: number)
	local view = Workspace.CurrentCamera.ViewportSize
	local halfW, halfH = view.X / 2 / current.zoom + 40, view.Y / 2 / current.zoom + 40
	local start = now + Config.INTERPOLATION_S
	for i = 1, #flat, 6 do
		local ax, ay, tx, ty = flat[i], flat[i + 1], flat[i + 2], flat[i + 3]
		if math.abs(tx - current.fx) < halfW and math.abs(ty - current.fz) < halfH then
			if flat[i + 4] == 1 then
				drawUntil[flat[i + 5]] = start + 0.22
				impact(tx, ty, ax, ay, arrow(ax, ay, tx, ty, start))
			else
				swing(ax, ay, tx, ty, start)
				impact(tx, ty, ax, ay, start)
			end
		end
	end
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
	-- Standing in water: its shadow becomes a ring of disturbed water, and it leaves ripples.
	wet: boolean,
	nextRippleAt: number,
}
local units: { [number]: Unit } = {}
-- Soldiers seen in the first moments are already there, not joining (no burst for them).
local firstDrawAt: number? = nil

local function barColor(health: number): Color3
	if health > 60 then
		return Color3.fromRGB(90, 220, 90)
	elseif health > 30 then
		return Color3.fromRGB(240, 200, 60)
	end
	return Color3.fromRGB(230, 60, 50)
end

local function unitFor(id: number, parent: Frame): (Unit, boolean)
	local u = units[id]
	if u then
		return u, false
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
		wet = false,
		nextRippleAt = 0,
	}
	units[id] = u
	return u, true
end

-- The shadow under a soldier's feet: a soft shadow, or a ring of water while wading.
local function footFor(u: Unit)
	local name = if u.wet then "fx-wading" else "shadow"
	local f = Art.frame(name)
	if f then
		Art.show(u.foot, name, false)
		local sx, sy = if u.wet then 1 else 0.75, if u.wet then 1 else 0.8
		u.foot.Size = UDim2.fromOffset(f[3] * sx, f[4] * sy)
		u.foot.ImageTransparency = 0.1
	end
end

-- The leader's crown, and the markers for your own army.
local crown: ImageLabel? = nil
local crownWearer = 0
local crownPoppedAt = 0
local marker: ImageLabel? = nil

local function overlay(name: string, parent: Frame): ImageLabel
	local label = Art.newLabel(parent)
	Art.show(label, name, false)
	local f = Art.frame(name)
	if f then
		label.Size = UDim2.fromOffset(f[3], f[4])
	end
	label.ZIndex = FX_Z - 1
	return label
end

--[[
	Draw every army (soldiers and neutrals), already blended for this frame by the
	client's Main. `t` is the time in seconds, for the marching bob, hit flashes and
	effects; `myId` is our own army; `leaderId` the army ranked #1 (it wears the crown).
]]
function SpriteLayer.drawArmies(armies: { any }, t: number, myId: number?, leaderId: number?)
	local frame = layer()
	firstDrawAt = firstDrawAt or t
	local joining = t - (firstDrawAt :: number) > 1.5
	local mine: { Vector2 } = {}
	local leaderTop, leaderX = math.huge, 0
	for _, u in units do
		u.seen = false
	end
	for _, army in armies do
		local isLeader = army.id ~= 0 and army.id == leaderId
		local color = Config.colors[army.color]
		for id, s in army.soldiers do
			local u, new = unitFor(id, frame)
			u.seen = true
			-- Face the way it's walking (left or right; straight up or down keeps the last way).
			local side = math.sin(s.yaw)
			local flipped = if side > 0.05 then true elseif side < -0.05 then false else u.flipped
			local key = Art.soldierKey(s.role, army.color)
			-- An Archer that just loosed an arrow shows its full-draw frame for a moment.
			if s.role == 1 and t < (drawUntil[id] or 0) and Art.colorName(army.color) then
				key = "archer-draw-" .. (Art.colorName(army.color) :: string)
			end
			local x, y = math.floor(s.x + 0.5), math.floor(s.z + 0.5)
			if army.id == myId then
				table.insert(mine, Vector2.new(x, y))
			end
			if isLeader and y < leaderTop then
				leaderTop, leaderX = y, army.cx
			end
			-- A soldier joining an army (recruited, revived, summoned): a burst of its colour.
			if new and joining and color then
				joinBurst(x, y, color, t)
			end
			-- A 1-pixel march bob, out of step from soldier to soldier.
			local bob = if s.moving then math.floor(math.abs(math.sin(t * 20 + id)) + 0.5) else 0
			if key ~= u.key or flipped ~= u.flipped then
				u.key, u.flipped = key, flipped
				local w, h = Art.show(u.body, key, flipped)
				u.body.Size = UDim2.fromOffset(w, h)
				footFor(u)
			end
			-- Wading: a splash stepping in, and ripples while walking through.
			local wet = Map.inWater(s.x, s.z)
			if wet ~= u.wet then
				u.wet = wet
				footFor(u)
				if wet and not new then
					spawnFx("splash", x, y, 0, 1, 0, -3, t, 0.26)
				end
			end
			if wet and s.moving and t >= u.nextRippleAt then
				spawnFx("ripple", x, y, 0, 1, 0, 0, t, 0.52)
				u.nextRippleAt = t + 0.34 + (id % 7) * 0.025
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

		-- Your own army: an amber chevron over the soldier nearest its middle.
		if army.id == myId then
			local best, bestD = nil, math.huge
			for _, s in army.soldiers do
				local d = (s.x - army.cx) ^ 2 + (s.z - army.cz) ^ 2
				if d < bestD then
					best, bestD = s, d
				end
			end
			local m = marker or overlay("commander-marker", frame)
			marker = m
			m.Visible = best ~= nil
			if best then
				local hover = math.floor(math.sin(t * 5) + 0.5)
				m.Position = UDim2.fromOffset(math.floor(best.x + 0.5) - 3, math.floor(best.z + 0.5) - 16 + hover - 5)
			end
		end
	end

	-- The leader's crown: above its topmost soldier, bobbing gently, popping when it changes hands.
	if leaderId and leaderTop < math.huge then
		local c = crown or overlay("crown", frame)
		crown = c
		if leaderId ~= crownWearer then
			crownWearer = leaderId
			crownPoppedAt = t
		end
		local p = math.min(1, (t - crownPoppedAt) / 0.26)
		local scale = 0.3 + 0.7 * p + 0.3 * math.sin(p * math.pi)
		local bob = math.floor(math.sin(t * 3) + 0.5)
		c.Visible = true
		c.Size = UDim2.fromOffset(11 * scale, 7 * scale)
		c.Position = UDim2.fromOffset(math.floor(leaderX + 0.5) - 5.5 * scale, leaderTop - 27 + bob - 7 * scale)
	elseif crown then
		crown.Visible = false
		crownWearer = 0
	end

	updateSeeThrough(mine)
	updateAmbient(t)
	bubbleLava(t)
	updateFx(t)
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
