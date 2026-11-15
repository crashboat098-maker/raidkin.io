--!strict
-- Draws armies from the server's snapshots: one small blocky soldier per
-- soldier, in its army's colour (neutrals in grey-brown), gliding between
-- snapshots. Warriors carry a shield, Archers a bow.
-- Everything is moved in one BulkMoveTo call per frame, which keeps hundreds
-- of soldiers cheap.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local S = Config.STUDS_PER_PX

local ArmyView = {}

export type SoldierState = { x: number, z: number, yaw: number, moving: boolean, archer: boolean }
-- color: an index into Config.colors, or 0 for neutrals.
export type ArmyState = { id: number, color: number, cx: number, cz: number, soldiers: { [number]: SoldierState } }

type Model3 = { model: Model, body: Part, head: Part, gear: Part, gearOffset: CFrame, seen: boolean }

local folder = Instance.new("Folder")
folder.Name = "Armies"
folder.Parent = Workspace

local models: { [number]: Model3 } = {}

local function newPart(name: string, size: Vector3, color: Color3, parent: Instance): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.Color = color
	p.Material = Enum.Material.SmoothPlastic
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Parent = parent
	return p
end

local SKIN = Color3.fromRGB(234, 184, 146)
local STEEL = Color3.fromRGB(163, 162, 165)
local WOOD = Color3.fromRGB(124, 82, 46)

-- Shield on the left arm; bow held out on the right.
local SHIELD_OFFSET = CFrame.new(-0.85, 1, -0.1)
local BOW_OFFSET = CFrame.new(0.85, 1.1, -0.2)

local function modelFor(id: number, color: Color3, archer: boolean): Model3
	local m = models[id]
	if m then
		return m
	end
	local model = Instance.new("Model")
	model.Name = "Soldier" .. id
	local body = newPart("Body", Vector3.new(1.5, 1.8, 0.9), color, model)
	local head = newPart("Head", Vector3.new(1, 1, 1), SKIN, model)
	local gear, offset
	if archer then
		gear = newPart("Bow", Vector3.new(0.2, 2, 0.3), WOOD, model)
		offset = BOW_OFFSET
	else
		gear = newPart("Shield", Vector3.new(0.2, 1.2, 1), STEEL, model)
		offset = SHIELD_OFFSET
	end
	model.Parent = folder
	m = { model = model, body = body, head = head, gear = gear, gearOffset = offset, seen = true }
	models[id] = m
	return m
end

local moveParts: { BasePart } = {}
local moveFrames: { CFrame } = {}

--[[
	Draw every army. `armies` are already blended for this frame (see the
	client's Main); `t` is the time, for the little walking bob.
]]
function ArmyView.draw(armies: { ArmyState }, t: number)
	for _, m in models do
		m.seen = false
	end
	table.clear(moveParts)
	table.clear(moveFrames)

	for _, army in armies do
		local color = if army.color == 0 then Config.neutralColor else (Config.colors[army.color] or Config.colors[1])
		for id, s in army.soldiers do
			local m = modelFor(id, color, s.archer)
			m.seen = true
			local bob = if s.moving then math.abs(math.sin(t * 12 + id)) * 0.25 else 0
			local base = CFrame.new(s.x * S, bob, s.z * S) * CFrame.Angles(0, s.yaw, 0)
			table.insert(moveParts, m.body)
			table.insert(moveFrames, base * CFrame.new(0, 0.9, 0))
			table.insert(moveParts, m.head)
			table.insert(moveFrames, base * CFrame.new(0, 2.3, 0))
			table.insert(moveParts, m.gear)
			table.insert(moveFrames, base * m.gearOffset)
		end
	end

	Workspace:BulkMoveTo(moveParts, moveFrames, Enum.BulkMoveMode.FireCFrameChanged)

	-- Soldiers no longer drawn (recruited neutrals, players who left) disappear.
	for id, m in models do
		if not m.seen then
			m.model:Destroy()
			models[id] = nil
		end
	end
end

return ArmyView
