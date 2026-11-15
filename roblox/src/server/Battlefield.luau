--!strict
--[[
	Builds the battlefield when the server starts, from the web version's map
	(see Map and scripts/export-roblox-map.ts):
	 - the ground as Roblox Terrain, one 4-stud cell per 16 px map tile: grass,
	   the four corner biomes, a raised forest border, rivers, lava, paths;
	 - buildings, bridges, the volcano and decorations as simple block shapes.
	Everything here is only for looks: what blocks movement is Map.obstacles.
	Built on the server, so Roblox streams it to each player around their army.
]]

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local Map = require(script.Parent.Map)

local Battlefield = {}

local S = Config.STUDS_PER_PX
local M = Enum.Material

-- ---------------------------------------------------------------------------
-- Ground (Terrain)
-- ---------------------------------------------------------------------------

-- Terrain material for each web ground tile ('a' + GroundTile value), and
-- whether it's raised (the impassable forest border and volcano cliffs).
local GROUND: { [string]: { material: Enum.Material, raised: boolean? } } = {
	a = { material = M.Grass }, b = { material = M.Grass }, c = { material = M.Grass },
	d = { material = M.LeafyGrass }, e = { material = M.LeafyGrass },
	f = { material = M.Ground },
	g = { material = M.LeafyGrass, raised = true }, h = { material = M.LeafyGrass, raised = true },
	-- Volcano: ash, scorched ground, cliffs.
	i = { material = M.Slate }, j = { material = M.Slate }, k = { material = M.Basalt },
	l = { material = M.Rock, raised = true },
	-- Enchanted forest: fae moss.
	m = { material = M.Limestone }, n = { material = M.Limestone }, o = { material = M.Limestone },
	p = { material = M.LeafyGrass, raised = true },
	-- Swamp: mud and moss.
	q = { material = M.Mud }, r = { material = M.Asphalt }, s = { material = M.Asphalt },
	t = { material = M.LeafyGrass, raised = true },
	-- Crystal biome: glowing moss.
	u = { material = M.Salt }, v = { material = M.Salt }, w = { material = M.Glacier },
	x = { material = M.Glacier, raised = true },
}

-- Terrain material colours (one colour per material, map-wide).
local function colourTerrain(terrain: Terrain)
	terrain:SetMaterialColor(M.Grass, Color3.fromRGB(92, 146, 74))
	terrain:SetMaterialColor(M.LeafyGrass, Color3.fromRGB(56, 104, 52))
	terrain:SetMaterialColor(M.Ground, Color3.fromRGB(130, 98, 66))
	terrain:SetMaterialColor(M.Cobblestone, Color3.fromRGB(128, 126, 120))
	terrain:SetMaterialColor(M.Slate, Color3.fromRGB(88, 84, 80))
	terrain:SetMaterialColor(M.Basalt, Color3.fromRGB(52, 44, 40))
	terrain:SetMaterialColor(M.Rock, Color3.fromRGB(96, 80, 70))
	terrain:SetMaterialColor(M.Limestone, Color3.fromRGB(86, 150, 120))
	terrain:SetMaterialColor(M.Mud, Color3.fromRGB(70, 60, 40))
	terrain:SetMaterialColor(M.Asphalt, Color3.fromRGB(72, 84, 52))
	terrain:SetMaterialColor(M.Salt, Color3.fromRGB(122, 110, 168))
	terrain:SetMaterialColor(M.Glacier, Color3.fromRGB(150, 170, 230))
	terrain:SetMaterialColor(M.CrackedLava, Color3.fromRGB(230, 90, 30))
	terrain.WaterColor = Color3.fromRGB(46, 120, 150)
	terrain.WaterTransparency = 0.4
	terrain.WaterWaveSize = 0.08
	terrain.WaterWaveSpeed = 6
end

--[[
	Four layers of 4-stud cells: y -8..-4 and -4..0 make the ground (its top at
	y = 0, where everyone stands); 0..4 and 4..8 raise the forest border and cliffs.
	Water and lava fill the top ground layer, over mud underneath.
]]
local function buildTerrain()
	local terrain = Workspace.Terrain
	terrain:Clear()
	colourTerrain(terrain)

	local cols, rows = Map.cols, Map.rows
	local ground: string = Map.data.ground
	local overlay: string = Map.data.overlay
	local materials, occupancy = {}, {}
	for cx = 1, cols do
		local mx, ox = {}, {}
		for layer = 1, 4 do
			local my, oy = table.create(rows, M.Air), table.create(rows, 0)
			mx[layer], ox[layer] = my, oy
		end
		materials[cx], occupancy[cx] = mx, ox
	end
	for row = 0, rows - 1 do
		for col = 0, cols - 1 do
			local i = row * cols + col + 1
			local tile = GROUND[string.sub(ground, i, i)] or GROUND.a
			local top = string.sub(overlay, i, i)
			local mx, ox = materials[col + 1], occupancy[col + 1]
			local z = row + 1
			mx[1][z], ox[1][z] = tile.material, 1
			if top == "w" then
				mx[1][z] = M.Mud
				mx[2][z], ox[2][z] = M.Water, 1
			elseif top == "l" then
				mx[2][z], ox[2][z] = M.CrackedLava, 1
			elseif top == "d" then
				mx[2][z], ox[2][z] = M.Ground, 1
			elseif top == "s" then
				mx[2][z], ox[2][z] = M.Cobblestone, 1
			else
				mx[2][z], ox[2][z] = tile.material, 1
				if tile.raised then
					mx[3][z], ox[3][z] = tile.material, 1
					mx[4][z], ox[4][z] = tile.material, 0.5
				end
			end
		end
	end
	local size = Vector3.new(cols * 4, 16, rows * 4)
	local region = Region3.new(Vector3.new(0, -8, 0), Vector3.new(0, -8, 0) + size)
	terrain:WriteVoxels(region, 4, materials, occupancy)
end

-- ---------------------------------------------------------------------------
-- Building blocks
-- ---------------------------------------------------------------------------

local folder: Folder

local function part(props: { [string]: any }): BasePart
	local className = props.ClassName or "Part"
	local p = Instance.new(className) :: BasePart
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = M.SmoothPlastic
	for key, value in props do
		if key ~= "ClassName" then
			(p :: any)[key] = value
		end
	end
	p.Parent = folder
	return p
end

local function block(size: Vector3, cframe: CFrame, color: Color3, material: Enum.Material?): BasePart
	return part({ Size = size, CFrame = cframe, Color = color, Material = material or M.SmoothPlastic })
end

local function ball(diameter: number, at: Vector3, color: Color3, material: Enum.Material?): BasePart
	return part({ Shape = Enum.PartType.Ball, Size = Vector3.one * diameter, CFrame = CFrame.new(at), Color = color, Material = material or M.Grass })
end

local function cylinder(diameter: number, height: number, at: Vector3, color: Color3, material: Enum.Material?): BasePart
	-- Roblox cylinders lie along X: turn them upright.
	return part({
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(height, diameter, diameter),
		CFrame = CFrame.new(at) * CFrame.Angles(0, 0, math.rad(90)),
		Color = color,
		Material = material or M.SmoothPlastic,
	})
end

-- A pitched roof over a w x d footprint, its eaves at `y`, ridge running east-west.
local function roof(cx: number, cz: number, y: number, w: number, d: number, rise: number, color: Color3)
	local half = d / 2
	part({ ClassName = "WedgePart", Size = Vector3.new(w, rise, half), CFrame = CFrame.new(cx, y + rise / 2, cz + half / 2) * CFrame.Angles(0, math.pi, 0), Color = color, Material = M.Slate })
	part({ ClassName = "WedgePart", Size = Vector3.new(w, rise, half), CFrame = CFrame.new(cx, y + rise / 2, cz - half / 2), Color = color, Material = M.Slate })
end

local function rgb(r: number, g: number, b: number): Color3
	return Color3.fromRGB(r, g, b)
end

-- ---------------------------------------------------------------------------
-- Structures
-- ---------------------------------------------------------------------------

type Style = { wall: Color3, roof: Color3?, material: Enum.Material, towers: boolean?, spire: boolean? }

local STYLES: { [string]: Style } = {
	house = { wall = rgb(214, 186, 140), roof = rgb(150, 70, 50), material = M.WoodPlanks },
	barracks = { wall = rgb(140, 136, 128), roof = rgb(120, 50, 40), material = M.Brick },
	watchtower = { wall = rgb(120, 86, 56), roof = rgb(90, 60, 40), material = M.WoodPlanks },
	fortification = { wall = rgb(130, 128, 120), material = M.Cobblestone },
	keep = { wall = rgb(150, 146, 138), material = M.Cobblestone, towers = true },
	castle = { wall = rgb(158, 154, 146), roof = rgb(70, 80, 130), material = M.Cobblestone, towers = true },
	faeHouse = { wall = rgb(226, 214, 236), roof = rgb(130, 90, 170), material = M.SmoothPlastic },
	faeCastle = { wall = rgb(232, 224, 244), roof = rgb(120, 90, 180), material = M.Marble, towers = true, spire = true },
	shrine = { wall = rgb(210, 220, 230), roof = rgb(90, 160, 140), material = M.Marble },
	ashHouse = { wall = rgb(70, 64, 62), roof = rgb(40, 36, 36), material = M.Slate },
	gothicFortress = { wall = rgb(60, 56, 64), roof = rgb(30, 28, 36), material = M.Slate, towers = true, spire = true },
	cathedral = { wall = rgb(80, 74, 84), roof = rgb(40, 36, 46), material = M.Slate, spire = true },
	darkSpire = { wall = rgb(40, 36, 44), material = M.Slate, spire = true },
	stiltHut = { wall = rgb(110, 90, 60), roof = rgb(80, 100, 60), material = M.WoodPlanks },
	swampCastle = { wall = rgb(90, 100, 80), roof = rgb(50, 70, 50), material = M.Cobblestone, towers = true },
}

-- A structure stands on its footprint: `width` x `depth` px, bottom-centre at (x, y).
local function buildStructure(s: any)
	local w, d = s.width * S, s.depth * S
	local h = math.max(3, s.height * S * 0.6)
	local cx, cz = s.x * S, (s.y - s.depth / 2) * S

	if s.type == "volcano" then
		-- A stepped cone of dark rock with a glowing crater.
		local base = math.max(w, d)
		for step = 0, 4 do
			local shrink = 1 - step * 0.18
			cylinder(base * shrink, 4, Vector3.new(cx, 2 + step * 4, cz), rgb(62 - step * 4, 50 - step * 3, 46 - step * 3), M.Basalt)
		end
		cylinder(base * 0.22, 0.6, Vector3.new(cx, 20.2, cz), rgb(255, 120, 40), M.Neon)
		return
	end
	if s.type == "moonGate" then
		local pale = rgb(220, 226, 240)
		block(Vector3.new(d, h, d), CFrame.new(cx - w / 2 + d / 2, h / 2, cz), pale, M.Marble)
		block(Vector3.new(d, h, d), CFrame.new(cx + w / 2 - d / 2, h / 2, cz), pale, M.Marble)
		block(Vector3.new(w, d, d), CFrame.new(cx, h + d / 2, cz), pale, M.Marble)
		return
	end

	local style = STYLES[s.type] or STYLES.house
	if s.type == "stiltHut" then
		-- On stilts over the swamp.
		for _, corner in { { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } } do
			block(Vector3.new(0.5, 2, 0.5), CFrame.new(cx + corner[1] * (w / 2 - 0.4), 1, cz + corner[2] * (d / 2 - 0.4)), rgb(80, 60, 40), M.Wood)
		end
		block(Vector3.new(w, h - 2, d), CFrame.new(cx, 2 + (h - 2) / 2, cz), style.wall, style.material)
	elseif s.type == "darkSpire" then
		block(Vector3.new(w, h, d), CFrame.new(cx, h / 2, cz), style.wall, style.material)
	else
		block(Vector3.new(w, h, d), CFrame.new(cx, h / 2, cz), style.wall, style.material)
	end

	-- Corner towers on castles and keeps.
	if style.towers then
		local tw = math.min(w, d) * 0.35
		for _, corner in { { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } } do
			local tx, tz = cx + corner[1] * (w / 2 - tw / 2), cz + corner[2] * (d / 2 - tw / 2)
			block(Vector3.new(tw, h * 1.35, tw), CFrame.new(tx, h * 1.35 / 2, tz), style.wall, style.material)
			if style.roof then
				part({ ClassName = "WedgePart", Size = Vector3.new(tw, tw, tw / 2), CFrame = CFrame.new(tx, h * 1.35 + tw / 2, tz + tw / 4) * CFrame.Angles(0, math.pi, 0), Color = style.roof, Material = M.Slate })
				part({ ClassName = "WedgePart", Size = Vector3.new(tw, tw, tw / 2), CFrame = CFrame.new(tx, h * 1.35 + tw / 2, tz - tw / 4), Color = style.roof, Material = M.Slate })
			end
		end
	end
	-- A tall spire in the middle.
	if style.spire then
		local sw = math.min(w, d) * (if s.type == "darkSpire" then 0.7 else 0.3)
		block(Vector3.new(sw, h * 0.9, sw), CFrame.new(cx, h + h * 0.45, cz), style.wall, style.material)
		part({ ClassName = "WedgePart", Size = Vector3.new(sw, sw * 1.5, sw / 2), CFrame = CFrame.new(cx, h * 1.9 + sw * 0.75, cz + sw / 4) * CFrame.Angles(0, math.pi, 0), Color = style.roof or style.wall, Material = M.Slate })
		part({ ClassName = "WedgePart", Size = Vector3.new(sw, sw * 1.5, sw / 2), CFrame = CFrame.new(cx, h * 1.9 + sw * 0.75, cz - sw / 4), Color = style.roof or style.wall, Material = M.Slate })
	end
	-- A pitched roof on houses and halls.
	if style.roof and not style.towers and s.type ~= "darkSpire" then
		roof(cx, cz, h, w + 0.6, d + 0.6, math.min(w, d) * 0.55, style.roof)
	end
	-- Battlements on walls and keeps.
	if s.type == "fortification" or s.type == "keep" then
		local merlons = math.floor(w / 2.5)
		for i = 0, merlons - 1 do
			if i % 2 == 0 then
				block(Vector3.new(1.2, 1, d), CFrame.new(cx - w / 2 + (i + 0.5) * w / merlons, h + 0.5, cz), style.wall, style.material)
			end
		end
	end
end

-- ---------------------------------------------------------------------------
-- Bridges
-- ---------------------------------------------------------------------------

local function buildBridge(b: any)
	local pts = Map.numbers(b.points)
	local color = if b.kind == "wood" then rgb(140, 104, 66) elseif b.kind == "stone" then rgb(150, 146, 140) else rgb(56, 50, 48)
	local material = if b.kind == "wood" then M.WoodPlanks elseif b.kind == "stone" then M.Cobblestone else M.Basalt
	for i = 1, #pts - 3, 2 do
		local a = Vector3.new(pts[i] * S, 0.35, pts[i + 1] * S)
		local c = Vector3.new(pts[i + 2] * S, 0.35, pts[i + 3] * S)
		local length = (c - a).Magnitude
		if length > 0.05 then
			-- A deck segment from a to c, a little longer so segments overlap at bends.
			block(Vector3.new(b.width * S, 0.7, length + b.width * S * 0.3), CFrame.lookAt((a + c) / 2, c), color, material)
		end
	end
end

-- ---------------------------------------------------------------------------
-- Decorations
-- ---------------------------------------------------------------------------

local TRUNK = rgb(105, 74, 48)

-- A tree: a trunk and a round crown (or a stack for conifers).
local function tree(x: number, z: number, height: number, crown: number, leaves: Color3, trunk: Color3?, conifer: boolean?)
	cylinder(math.max(0.6, crown * 0.16), height, Vector3.new(x, height / 2, z), trunk or TRUNK, M.Wood)
	if conifer then
		ball(crown, Vector3.new(x, height * 0.75, z), leaves)
		ball(crown * 0.75, Vector3.new(x, height * 0.75 + crown * 0.5, z), leaves)
		ball(crown * 0.45, Vector3.new(x, height * 0.75 + crown * 0.9, z), leaves)
	else
		ball(crown, Vector3.new(x, height + crown * 0.3, z), leaves)
	end
end

local function rock(x: number, z: number, size: number, color: Color3, material: Enum.Material?, seed: number)
	local turn = CFrame.Angles(0, seed * 1.3, math.rad((seed * 7) % 20 - 10))
	block(Vector3.new(size, size * 0.7, size * 0.85), CFrame.new(x, size * 0.3, z) * turn, color, material or M.Rock)
end

-- How to draw each kind of decoration (x, z: its foot, in studs; v: its look variant).
local DECORATIONS: { [string]: (x: number, z: number, v: number) -> () } = {
	pine = function(x, z) tree(x, z, 4, 5, rgb(40, 90, 56), nil, true) end,
	largeTree = function(x, z) tree(x, z, 5, 8, rgb(64, 128, 58)) end,
	elderTree = function(x, z) tree(x, z, 6.5, 10, rgb(50, 110, 50)) end,
	cypress = function(x, z) tree(x, z, 5, 3.5, rgb(46, 96, 60), nil, true) end,
	birch = function(x, z) tree(x, z, 5, 5, rgb(140, 190, 90), rgb(230, 226, 214)) end,
	goldenOak = function(x, z) tree(x, z, 5, 8, rgb(222, 170, 60)) end,
	twistedYew = function(x, z) tree(x, z, 4.5, 7, rgb(40, 76, 50)) end,
	willow = function(x, z) tree(x, z, 4.5, 9, rgb(120, 170, 90)) end,
	moonTree = function(x, z) tree(x, z, 5.5, 8, rgb(150, 170, 230), rgb(200, 200, 220)) end,
	spiralTree = function(x, z) tree(x, z, 5, 7, rgb(160, 110, 200), rgb(120, 90, 140)) end,
	swampTree = function(x, z) tree(x, z, 5, 8, rgb(70, 92, 56), rgb(70, 56, 40)) end,
	deadTree = function(x, z) cylinder(0.7, 5, Vector3.new(x, 2.5, z), rgb(110, 92, 70), M.Wood) end,
	charredTree = function(x, z) cylinder(0.7, 4.5, Vector3.new(x, 2.25, z), rgb(36, 30, 28), M.Wood) end,
	scorchedTree = function(x, z) tree(x, z, 4, 4, rgb(150, 70, 30), rgb(40, 32, 28)) end,
	bush = function(x, z) ball(2.6, Vector3.new(x, 0.9, z), rgb(64, 120, 56)) end,
	shrub = function(x, z) ball(2, Vector3.new(x, 0.7, z), rgb(80, 130, 60)) end,
	ashShrub = function(x, z) ball(2, Vector3.new(x, 0.7, z), rgb(100, 96, 90), M.Slate) end,
	swampBush = function(x, z) ball(2.4, Vector3.new(x, 0.8, z), rgb(90, 100, 56)) end,
	boulder = function(x, z, v) rock(x, z, 4.5, rgb(120, 118, 112), nil, x + v) end,
	rock = function(x, z, v) rock(x, z, 2.4, rgb(130, 128, 122), nil, x + v) end,
	shoreRock = function(x, z, v) rock(x, z, 2.4, rgb(140, 136, 126), nil, x + v) end,
	basalt = function(x, z) cylinder(2.2, 4, Vector3.new(x, 2, z), rgb(44, 40, 40), M.Basalt) end,
	obsidian = function(x, z, v) rock(x, z, 2.6, rgb(28, 22, 36), M.Glass, x + v) end,
	pillar = function(x, z) cylinder(1.6, 5, Vector3.new(x, 2.5, z), rgb(170, 166, 156), M.Marble) end,
	elvenPillar = function(x, z) cylinder(1.4, 5.5, Vector3.new(x, 2.75, z), rgb(226, 230, 240), M.Marble) end,
	ruinWall = function(x, z) block(Vector3.new(6, 3, 1.2), CFrame.new(x, 1.5, z - 0.6), rgb(140, 136, 128), M.Cobblestone) end,
	gothicRuin = function(x, z) block(Vector3.new(8, 6, 2), CFrame.new(x, 3, z - 1), rgb(60, 56, 64), M.Slate) end,
	runestone = function(x, z)
		block(Vector3.new(1.6, 3, 0.8), CFrame.new(x, 1.5, z - 0.4), rgb(110, 110, 104), M.Slate)
		block(Vector3.new(0.4, 1.6, 0.85), CFrame.new(x, 1.7, z - 0.4), rgb(120, 230, 140), M.Neon)
	end,
	gravestone = function(x, z) block(Vector3.new(1.4, 1.8, 0.5), CFrame.new(x, 0.9, z - 0.25), rgb(150, 150, 146), M.Slate) end,
	gargoyle = function(x, z) block(Vector3.new(1.6, 2.4, 1.6), CFrame.new(x, 1.2, z - 0.8), rgb(70, 66, 74), M.Slate) end,
	faeStatue = function(x, z) block(Vector3.new(1.4, 3.2, 1.4), CFrame.new(x, 1.6, z - 0.7), rgb(230, 230, 240), M.Marble) end,
	swampTotem = function(x, z) cylinder(1, 4, Vector3.new(x, 2, z), rgb(90, 70, 50), M.Wood) end,
	giantShroom = function(x, z)
		cylinder(1, 3, Vector3.new(x, 1.5, z), rgb(230, 220, 200))
		cylinder(4, 1, Vector3.new(x, 3.3, z), rgb(200, 60, 60))
	end,
	swampShroom = function(x, z)
		cylinder(0.8, 2, Vector3.new(x, 1, z), rgb(200, 210, 190))
		cylinder(3, 0.8, Vector3.new(x, 2.3, z), rgb(70, 170, 160), M.Neon)
	end,
	giantCrystal = function(x, z, v)
		part({ Size = Vector3.new(1.8, 6, 1.8), CFrame = CFrame.new(x, 2.6, z) * CFrame.Angles(0, v, math.rad(8)), Color = rgb(170, 120, 255), Material = M.Neon, Transparency = 0.2 })
	end,
	crystalCluster = function(x, z, v)
		for k = 0, 2 do
			part({ Size = Vector3.new(0.9, 2.5 - k * 0.5, 0.9), CFrame = CFrame.new(x + (k - 1) * 0.8, 1, z) * CFrame.Angles(0, v + k, math.rad((k - 1) * 15)), Color = rgb(170, 140, 255), Material = M.Neon, Transparency = 0.2 })
		end
	end,
	crystalShard = function(x, z, v)
		part({ Size = Vector3.new(0.6, 1.4, 0.6), CFrame = CFrame.new(x, 0.6, z) * CFrame.Angles(0, v, math.rad(10)), Color = rgb(190, 160, 255), Material = M.Neon, Transparency = 0.2 })
	end,
	vent = function(x, z)
		cylinder(2, 0.8, Vector3.new(x, 0.4, z), rgb(50, 44, 42), M.Basalt)
		cylinder(0.8, 0.2, Vector3.new(x, 0.85, z), rgb(255, 120, 40), M.Neon)
	end,
	log = function(x, z) part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(4, 1, 1), CFrame = CFrame.new(x, 0.5, z), Color = TRUNK, Material = M.Wood }) end,
	stump = function(x, z) cylinder(1.4, 0.8, Vector3.new(x, 0.4, z), TRUNK, M.Wood) end,
	well = function(x, z)
		cylinder(3, 1.4, Vector3.new(x, 0.7, z - 1), rgb(140, 136, 128), M.Cobblestone)
		roof(x, z - 1, 3, 3.4, 3.4, 1.4, rgb(150, 70, 50))
	end,
	crates = function(x, z) block(Vector3.new(1.8, 1.8, 1.8), CFrame.new(x, 0.9, z - 0.9), rgb(150, 110, 70), M.WoodPlanks) end,
	hay = function(x, z) block(Vector3.new(2.4, 1.4, 1.6), CFrame.new(x, 0.7, z - 0.8), rgb(220, 190, 90), M.Fabric) end,
	fence = function(x, z) block(Vector3.new(6, 1, 0.3), CFrame.new(x, 0.5, z), rgb(130, 96, 60), M.Wood) end,
	faeFountain = function(x, z)
		cylinder(5, 1, Vector3.new(x, 0.5, z - 2), rgb(226, 230, 240), M.Marble)
		cylinder(4, 0.2, Vector3.new(x, 1.05, z - 2), rgb(120, 200, 230), M.Glass)
	end,
	lantern = function(x, z)
		cylinder(0.3, 3, Vector3.new(x, 1.5, z), rgb(60, 50, 40))
		block(Vector3.new(0.6, 0.6, 0.6), CFrame.new(x, 3.2, z), rgb(255, 220, 120), M.Neon)
	end,
	brazier = function(x, z)
		cylinder(1.4, 1.2, Vector3.new(x, 0.6, z), rgb(70, 60, 56))
		ball(0.9, Vector3.new(x, 1.4, z), rgb(255, 140, 40), M.Neon)
	end,
	smallFire = function(x, z) ball(0.9, Vector3.new(x, 0.4, z), rgb(255, 140, 40), M.Neon) end,
}

-- ---------------------------------------------------------------------------

function Battlefield.build(): Folder
	-- The new place's default Baseplate and SpawnLocation sit in the middle of the
	-- battlefield; take them away for this play session (the saved place keeps them).
	for _, name in { "Baseplate", "SpawnLocation" } do
		local existing = Workspace:FindFirstChild(name)
		if existing then
			existing:Destroy()
		end
	end

	folder = Instance.new("Folder")
	folder.Name = "Battlefield"

	buildTerrain()
	for _, s in Map.data.structures do
		buildStructure(s)
	end
	for _, b in Map.data.bridges do
		buildBridge(b)
	end
	-- Lava pools around the volcano.
	local volcano = Map.data.volcano
	if volcano then
		for _, pool in volcano.pools do
			part({ Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.4, pool.ry * 2 * S, pool.rx * 2 * S), CFrame = CFrame.new(pool.x * S, 0.1, pool.y * S) * CFrame.Angles(0, 0, math.rad(90)), Color = rgb(255, 110, 30), Material = M.Neon })
		end
	end
	local kinds: { string } = Map.data.decorationKinds
	local decorations = Map.numbers(Map.data.decorations)
	for i = 1, #decorations, 5 do
		local draw = DECORATIONS[kinds[decorations[i] + 1]]
		if draw then
			draw(decorations[i + 1] * S, decorations[i + 2] * S, decorations[i + 3])
		end
	end

	folder.Parent = Workspace
	return folder
end

return Battlefield
