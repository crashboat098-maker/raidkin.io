--!strict
-- Builds the battlefield when the server starts: a grass field, a low wall
-- around the edge, and scattered trees so you can see the army moving.
-- (A placeholder until the web version's map, biomes and rivers are ported.)

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)

local Battlefield = {}

local S = Config.STUDS_PER_PX

local function part(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for key, value in props do
		(p :: any)[key] = value
	end
	return p
end

local function addTree(folder: Folder, x: number, z: number, rng: Random)
	local height = rng:NextNumber(5, 8)
	local trunk = part({
		Name = "Trunk",
		Size = Vector3.new(1.2, height, 1.2),
		CFrame = CFrame.new(x, height / 2, z),
		Color = Color3.fromRGB(105, 64, 40),
		Material = Enum.Material.Wood,
	})
	local leaves = part({
		Name = "Leaves",
		Shape = Enum.PartType.Ball,
		Size = Vector3.one * rng:NextNumber(5, 7.5),
		CFrame = CFrame.new(x, height + 1.5, z),
		Color = Color3.fromRGB(52, 120 + rng:NextInteger(0, 30), 52),
		Material = Enum.Material.Grass,
	})
	local tree = Instance.new("Model")
	tree.Name = "Tree"
	trunk.Parent = tree
	leaves.Parent = tree
	tree.Parent = folder
end

function Battlefield.build(): Folder
	-- The new place's default Baseplate and SpawnLocation sit in the middle of the
	-- battlefield; take them away for this play session (the saved place keeps them).
	for _, name in { "Baseplate", "SpawnLocation" } do
		local existing = Workspace:FindFirstChild(name)
		if existing then
			existing:Destroy()
		end
	end

	local folder = Instance.new("Folder")
	folder.Name = "Battlefield"

	local size = Config.world.size * S
	part({
		Name = "Ground",
		Size = Vector3.new(size, 2, size),
		CFrame = CFrame.new(size / 2, -1, size / 2),
		Color = Color3.fromRGB(86, 140, 74),
		Material = Enum.Material.Grass,
	}).Parent = folder

	-- A low stone wall around the edge.
	local wallColor = Color3.fromRGB(110, 106, 98)
	for _, side in { { size / 2, -1, size + 2, 2 }, { size / 2, size + 1, size + 2, 2 }, { -1, size / 2, 2, size + 2 }, { size + 1, size / 2, 2, size + 2 } } do
		part({
			Name = "Wall",
			Size = Vector3.new(side[3], 3, side[4]),
			CFrame = CFrame.new(side[1], 1.5, side[2]),
			Color = wallColor,
			Material = Enum.Material.Slate,
		}).Parent = folder
	end

	-- Trees, the same every time (fixed seed), kept away from the middle where armies start.
	local rng = Random.new(20261108)
	local middle = size / 2
	local placed = 0
	while placed < 260 do
		local x = rng:NextNumber(8, size - 8)
		local z = rng:NextNumber(8, size - 8)
		if (Vector2.new(x, z) - Vector2.new(middle, middle)).Magnitude > 45 then
			addTree(folder, x, z, rng)
			placed += 1
		end
	end

	folder.Parent = Workspace
	return folder
end

return Battlefield
