--!strict
-- Draws armies from the server's snapshots: one small blocky soldier per
-- soldier, in its army's colour (neutrals in grey-brown), gliding between
-- snapshots. Warriors carry a shield, Archers a bow. Injured soldiers show a
-- health bar, and a soldier flashes red when hit.
-- Everything is moved in one BulkMoveTo call per frame, which keeps hundreds
-- of soldiers cheap.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Ground = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Ground"))

local S = Config.STUDS_PER_PX

local ArmyView = {}

-- health: 0-100.
export type SoldierState = { x: number, z: number, yaw: number, moving: boolean, role: number, health: number }
-- color: an index into Config.colors, or 0 for neutrals.
export type ArmyState = { id: number, color: number, cx: number, cz: number, speed: number?, soldiers: { [number]: SoldierState } }

type Model3 = {
	model: Model,
	body: Part,
	head: Part,
	gear: Part,
	gearOffset: CFrame,
	bar: Part,
	color: Color3,
	health: number,
	flashUntil: number,
	flashing: boolean,
	seen: boolean,
}

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
local HIT = Color3.fromRGB(255, 70, 60)
local FLASH_TIME = 0.15
local BAR_WIDTH = 1.6

-- Shield on the left arm; bow held out on the right; a Guardian's tall tower shield in front.
local SHIELD_OFFSET = CFrame.new(-0.85, 1, -0.1)
local BOW_OFFSET = CFrame.new(0.85, 1.1, -0.2)
local TOWER_OFFSET = CFrame.new(-0.4, 1.1, -0.65)
-- Health bars float above the head, facing the camera's way (north).
local BAR_HEIGHT = 3.3

-- Classes as the server sends them.
local ARCHER, GUARDIAN = 1, 2

local function modelFor(id: number, color: Color3, role: number): Model3
	local m = models[id]
	if m then
		return m
	end
	local model = Instance.new("Model")
	model.Name = "Soldier" .. id
	local body = newPart("Body", Vector3.new(1.5, 1.8, 0.9), color, model)
	-- Guardians wear a steel helmet.
	local head = newPart("Head", Vector3.new(1, 1, 1), if role == GUARDIAN then STEEL else SKIN, model)
	local gear, offset
	if role == ARCHER then
		gear = newPart("Bow", Vector3.new(0.2, 2, 0.3), WOOD, model)
		offset = BOW_OFFSET
	elseif role == GUARDIAN then
		gear = newPart("TowerShield", Vector3.new(1.4, 2.2, 0.25), STEEL, model)
		gear.Material = Enum.Material.DiamondPlate
		offset = TOWER_OFFSET
	else
		gear = newPart("Shield", Vector3.new(0.2, 1.2, 1), STEEL, model)
		offset = SHIELD_OFFSET
	end
	local bar = newPart("HealthBar", Vector3.new(BAR_WIDTH, 0.25, 0.1), Color3.new(0, 1, 0), model)
	bar.Material = Enum.Material.Neon
	bar.CastShadow = false
	bar.Transparency = 1
	model.Parent = folder
	m = {
		model = model,
		body = body,
		head = head,
		gear = gear,
		gearOffset = offset,
		bar = bar,
		color = color,
		health = 100,
		flashUntil = 0,
		flashing = false,
		seen = true,
	}
	models[id] = m
	return m
end

-- Green above 60%, yellow above 30%, red below (like the web version).
local function barColor(health: number): Color3
	if health > 60 then
		return Color3.fromRGB(90, 220, 90)
	elseif health > 30 then
		return Color3.fromRGB(240, 200, 60)
	end
	return Color3.fromRGB(230, 60, 50)
end

-- A soldier's health changed: flash if it went down, and resize its bar.
local function setHealth(m: Model3, health: number, t: number)
	if health < m.health then
		m.flashUntil = t + FLASH_TIME
	end
	m.health = health
	if health >= 100 then
		m.bar.Transparency = 1
	else
		m.bar.Transparency = 0
		m.bar.Size = Vector3.new(math.max(0.05, BAR_WIDTH * health / 100), 0.25, 0.1)
		m.bar.Color = barColor(health)
	end
end

local moveParts: { BasePart } = {}
local moveFrames: { CFrame } = {}

--[[
	Draw every army. `armies` are already blended for this frame (see the
	client's Main); `t` is the time (seconds), for flashes and the walking bob.
]]
function ArmyView.draw(armies: { ArmyState }, t: number)
	for _, m in models do
		m.seen = false
	end
	table.clear(moveParts)
	-- Everyone stands on the terrain's real surface (see Ground).
	local ground = Ground.height()
	table.clear(moveFrames)

	for _, army in armies do
		local color = if army.color == 0 then Config.neutralColor else (Config.colors[army.color] or Config.colors[1])
		for id, s in army.soldiers do
			local m = modelFor(id, color, s.role)
			m.seen = true
			if s.health ~= m.health then
				setHealth(m, s.health, t)
			end
			local flashing = t < m.flashUntil
			if flashing ~= m.flashing then
				m.flashing = flashing
				m.body.Color = if flashing then HIT else m.color
			end

			local bob = if s.moving then math.abs(math.sin(t * 12 + id)) * 0.25 else 0
			local base = CFrame.new(s.x * S, ground + bob, s.z * S) * CFrame.Angles(0, s.yaw, 0)
			table.insert(moveParts, m.body)
			table.insert(moveFrames, base * CFrame.new(0, 0.9, 0))
			table.insert(moveParts, m.head)
			table.insert(moveFrames, base * CFrame.new(0, 2.3, 0))
			table.insert(moveParts, m.gear)
			table.insert(moveFrames, base * m.gearOffset)
			if m.health < 100 then
				-- Left-aligned: the bar shrinks toward its left end as health drops.
				local width = m.bar.Size.X
				table.insert(moveParts, m.bar)
				table.insert(moveFrames, CFrame.new(s.x * S - BAR_WIDTH / 2 + width / 2, ground + BAR_HEIGHT, s.z * S))
			end
		end
	end

	Workspace:BulkMoveTo(moveParts, moveFrames, Enum.BulkMoveMode.FireCFrameChanged)

	-- Soldiers no longer drawn (fallen, recruited neutrals, players who left) disappear.
	for id, m in models do
		if not m.seen then
			m.model:Destroy()
			models[id] = nil
		end
	end
end

return ArmyView
