--!strict
-- Draws fallen soldiers: a body lying on the ground in its army's colour. It's
-- faded while it can't be revived yet, and solid once any army can walk up to
-- it and revive it. The server sends every body once, then only changes.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Ground = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Ground"))

local S = Config.STUDS_PER_PX
local SKIN = Color3.fromRGB(234, 184, 146)
-- How see-through a body is while it can't be revived yet.
local DORMANT_TRANSPARENCY = 0.6

local BodyView = {}

local folder = Instance.new("Folder")
folder.Name = "Fallen"
folder.Parent = Workspace

local bodies: { [number]: Model } = {}

local function part(name: string, size: Vector3, color: Color3, cframe: CFrame, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.Color = color
	p.CFrame = cframe
	p.Material = Enum.Material.SmoothPlastic
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Parent = parent
	return p
end

local function setAwake(model: Model, awake: boolean)
	for _, p in model:GetChildren() do
		if p:IsA("BasePart") then
			p.Transparency = if awake then 0 else DORMANT_TRANSPARENCY
		end
	end
end

--[[
	Apply changes from the server: { added = { id, x, z, yaw, color, awake, ... },
	awoken = { id, ... }, removed = { id, ... } }.
]]
function BodyView.apply(message: { added: { number }, awoken: { number }, removed: { number } })
	local flat = message.added
	for i = 1, #flat, 6 do
		local id, x, z, yaw, color, awake = flat[i], flat[i + 1], flat[i + 2], flat[i + 3], flat[i + 4], flat[i + 5] == 1
		if not bodies[id] then
			local model = Instance.new("Model")
			model.Name = "Body" .. id
			-- Lying on its back: the body flat on the ground, the head at one end.
			local base = CFrame.new(x * S, Ground.height(), z * S) * CFrame.Angles(0, yaw, 0)
			part("Body", Vector3.new(1.5, 0.9, 1.8), Config.colors[color] or Config.neutralColor, base * CFrame.new(0, 0.45, 0), model)
			part("Head", Vector3.new(1, 1, 1), SKIN, base * CFrame.new(0, 0.5, -1.4), model)
			setAwake(model, awake)
			model.Parent = folder
			bodies[id] = model
		end
	end
	for _, id in message.awoken do
		local model = bodies[id]
		if model then
			setAwake(model, true)
		end
	end
	for _, id in message.removed do
		local model = bodies[id]
		if model then
			model:Destroy()
			bodies[id] = nil
		end
	end
end

return BodyView
