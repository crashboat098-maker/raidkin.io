--!strict
--[[
	The Lucky Spin castles as players see them: a glowing circle on the ground in
	front of each castle (gold when ready, the charging army's colour while
	someone holds it, grey while it rests), and a sign above it with the castle's
	name, what's happening, a charge bar, and the wheel when it spins: the
	rewards flick past, slowing down, and land on the result.
]]

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Ground = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Ground"))

local S = Config.STUDS_PER_PX
local GOLD = Color3.fromRGB(240, 200, 90)
local GREY = Color3.fromRGB(140, 140, 140)

local CastleView = {}

local folder = Instance.new("Folder")
folder.Name = "Castles"
folder.Parent = Workspace

type Spin = { id: number, reward: number, elapsed: number, landed: boolean, by: number }
export type CastleState = {
	name: string,
	x: number,
	z: number,
	radius: number,
	ready: number,
	cooldown: number,
	charger: number,
	charged: number,
	contested: number,
	spin: Spin?,
}
export type Message = { chargeTime: number, spinTime: number, rewards: { { label: string } }, castles: { CastleState } }

type View = {
	ring: Part,
	title: TextLabel,
	status: TextLabel,
	barBack: Frame,
	bar: Frame,
	-- The spin being shown: which one, and when it started (local clock).
	spinId: number,
	spinStart: number,
}
local views: { View } = {}
local latest: Message? = nil
-- Every army's name and colour, by id (from the scoreboard).
local names: { [number]: string } = {}
local colors: { [number]: number } = {}

local function viewFor(i: number, c: CastleState): View
	local view = views[i]
	if view then
		return view
	end
	local ring = Instance.new("Part")
	ring.Name = c.name
	ring.Shape = Enum.PartType.Cylinder
	ring.Size = Vector3.new(0.2, c.radius * 2 * S, c.radius * 2 * S)
	ring.CFrame = CFrame.new(c.x * S, Ground.height() + 0.15, c.z * S) * CFrame.Angles(0, 0, math.rad(90))
	ring.Material = Enum.Material.ForceField
	ring.Color = GOLD
	ring.Anchored = true
	ring.CanCollide = false
	ring.CanQuery = false
	ring.CanTouch = false
	ring.CastShadow = false
	ring.Parent = folder

	local sign = Instance.new("BillboardGui")
	sign.Size = UDim2.new(0, 260, 0, 74)
	sign.StudsOffsetWorldSpace = Vector3.new(0, 14, 0)
	sign.AlwaysOnTop = true
	sign.MaxDistance = 400
	sign.Adornee = ring
	sign.Parent = ring

	local function label(y: number, height: number, size: number): TextLabel
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Position = UDim2.new(0, 0, 0, y)
		l.Size = UDim2.new(1, 0, 0, height)
		l.Font = Enum.Font.GothamBlack
		l.TextSize = size
		l.TextColor3 = Color3.new(1, 1, 1)
		l.TextStrokeTransparency = 0.3
		l.Parent = sign
		return l
	end
	local title = label(0, 24, 20)
	title.TextColor3 = GOLD
	title.Text = c.name
	local status = label(24, 22, 15)

	local barBack = Instance.new("Frame")
	barBack.Position = UDim2.new(0.1, 0, 0, 52)
	barBack.Size = UDim2.new(0.8, 0, 0, 10)
	barBack.BackgroundColor3 = Color3.fromRGB(20, 20, 20)
	barBack.BorderSizePixel = 0
	barBack.Parent = sign
	local bar = Instance.new("Frame")
	bar.Size = UDim2.new(0, 0, 1, 0)
	bar.BackgroundColor3 = GOLD
	bar.BorderSizePixel = 0
	bar.Parent = barBack

	view = { ring = ring, title = title, status = status, barBack = barBack, bar = bar, spinId = 0, spinStart = 0 }
	views[i] = view
	return view
end

-- A new state from the server.
function CastleView.apply(message: Message)
	latest = message
end

-- Every army's name and colour (from the scoreboard), for "who's charging".
function CastleView.setArmies(rows: { { id: number, name: string, color: number } })
	for _, row in rows do
		names[row.id] = row.name
		colors[row.id] = row.color
	end
end

-- Update the signs and circles (every frame, so the wheel can spin smoothly).
function CastleView.draw(now: number)
	local message = latest
	if not message then
		return
	end
	for i, c in message.castles do
		local view = viewFor(i, c)
		local spin = c.spin
		if spin and spin.id ~= view.spinId then
			view.spinId = spin.id
			view.spinStart = now - spin.elapsed
		end

		local ringColor, text, fill = GOLD, "", 0
		if spin and now - view.spinStart < message.spinTime + 2.6 then
			-- The wheel: rewards flick past, slowing down, then land on the result.
			local t = math.min(1, (now - view.spinStart) / message.spinTime)
			local rewards = message.rewards
			local who = names[spin.by] or "?"
			if t < 1 then
				local ticks = math.floor((1 - (1 - t) ^ 3) * 40)
				local shown = (spin.reward + ticks - 40 - 1) % #rewards + 1
				text = string.format("SPINNING FOR %s... %s", who, rewards[shown].label)
			else
				text = string.format("%s WINS %s!", who, rewards[spin.reward].label)
			end
			ringColor = Config.colors[colors[spin.by] or 0] or GOLD
			fill = 1
		elseif c.ready == 1 then
			if c.charger ~= 0 then
				ringColor = Config.colors[colors[c.charger] or 0] or GOLD
				fill = c.charged / message.chargeTime
				if c.contested == 1 then
					text = string.format("%s - CONTESTED, PAUSED", names[c.charger] or "?")
				else
					text = string.format("%s CHARGING - %ds", names[c.charger] or "?", math.ceil(message.chargeTime - c.charged))
				end
			else
				text = "READY - HOLD THE CIRCLE TO SPIN"
			end
		else
			ringColor = GREY
			text = string.format("RESTING - READY IN %ds", c.cooldown)
		end
		view.ring.Color = ringColor
		view.status.Text = text
		view.bar.BackgroundColor3 = ringColor
		view.bar.Size = UDim2.new(math.clamp(fill, 0, 1), 0, 1, 0)
		view.barBack.Visible = fill > 0
	end
end

return CastleView
