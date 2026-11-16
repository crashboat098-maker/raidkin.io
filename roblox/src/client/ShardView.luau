--!strict
-- Draws soul shards as small glowing crystals: blue ones recruit Warriors,
-- green ones Archers. The server sends every shard once, then only changes.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Ground = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Ground"))

local S = Config.STUDS_PER_PX
local BLUE = Color3.fromRGB(80, 200, 255)
local GREEN = Color3.fromRGB(90, 235, 120)

local ShardView = {}

local folder = Instance.new("Folder")
folder.Name = "Shards"
folder.Parent = Workspace

local parts: { [number]: Part } = {}

local function crystal(id: number, green: boolean): Part
	local p = parts[id]
	if p then
		return p
	end
	p = Instance.new("Part")
	p.Name = "Shard" .. id
	p.Size = Vector3.new(0.7, 1.3, 0.7)
	p.Color = if green then GREEN else BLUE
	p.Material = Enum.Material.Neon
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.CastShadow = false
	p.Parent = folder
	parts[id] = p
	return p
end

-- Apply a list from the server: { id, x, z, green (0/1), active (0/1), id, ... }.
function ShardView.apply(flat: { number })
	for i = 1, #flat, 5 do
		local id, x, z = flat[i], flat[i + 1], flat[i + 2]
		local green, active = flat[i + 3] == 1, flat[i + 4] == 1
		local p = crystal(id, green)
		-- Tilted a little, each its own way, so they look scattered rather than planted.
		p.CFrame = CFrame.new(x * S, Ground.height() + 1.3, z * S) * CFrame.Angles(0, id * 1.7, math.rad(12))
		p.Transparency = if active then 0 else 1
	end
end

return ShardView
