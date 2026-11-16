--!strict
--[[
	The Crystal Arena as players see it: a ring of crystal wall, a glowing entry
	circle outside each gate (gold while open, the holder's colour while someone
	qualifies, grey while it rests), a sign over each circle with what's
	happening there and that side's Lucky Wheel when it spins, and a sign over
	the arena for the fight itself.
]]

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Ground = require(Shared:WaitForChild("Ground"))
local Map = require(Shared:WaitForChild("Map"))
-- With the web game's pixel art, its ground picture already shows the arena's walls and floor.
local Art = require(script.Parent:WaitForChild("Art"))

local S = Config.STUDS_PER_PX
local GOLD = Color3.fromRGB(240, 200, 90)
local GREY = Color3.fromRGB(140, 140, 140)
local CRYSTAL = Color3.fromRGB(170, 140, 255)
local WALL_HEIGHT = 7 -- studs
local WALL_SEGMENTS = 90

local ArenaView = {}

type ZoneState = { holder: number, held: number, qualified: number, contested: number, outcome: number }
export type Message = {
	phase: string,
	phaseTime: number,
	matchId: number,
	winner: number,
	zones: { ZoneState },
	qualifyTime: number,
	countdownTime: number,
	spinTime: number,
	cooldownTime: number,
	outcomes: { number },
}

type Sign = { root: Part, title: TextLabel, status: TextLabel, barBack: Frame, bar: Frame }

local data = Map.data.arena
local folder: Folder? = nil
local zoneRings: { Part } = {}
local zoneSigns: { Sign } = {}
local centreSign: Sign? = nil
local latest: Message? = nil
-- When the latest message arrived (local clock), so phase timers run smoothly between messages.
local latestAt = 0
local names: { [number]: string } = {}
local colors: { [number]: number } = {}

local function part(name: string, size: Vector3, cframe: CFrame, color: Color3, material: Enum.Material): Part
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.CFrame = cframe
	p.Color = color
	p.Material = material
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Parent = folder
	return p
end

local function sign(at: Part, height: number, width: number): Sign
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.new(0, width, 0, 74)
	gui.StudsOffsetWorldSpace = Vector3.new(0, height, 0)
	gui.AlwaysOnTop = true
	gui.MaxDistance = 400
	gui.Adornee = at
	gui.Parent = at
	local function label(y: number, h: number, size: number): TextLabel
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Position = UDim2.new(0, 0, 0, y)
		l.Size = UDim2.new(1, 0, 0, h)
		l.Font = Enum.Font.GothamBlack
		l.TextSize = size
		l.TextColor3 = Color3.new(1, 1, 1)
		l.TextStrokeTransparency = 0.3
		l.Parent = gui
		return l
	end
	local title = label(0, 24, 20)
	title.TextColor3 = CRYSTAL
	local status = label(24, 22, 15)
	local barBack = Instance.new("Frame")
	barBack.Position = UDim2.new(0.1, 0, 0, 52)
	barBack.Size = UDim2.new(0.8, 0, 0, 10)
	barBack.BackgroundColor3 = Color3.fromRGB(20, 20, 20)
	barBack.BorderSizePixel = 0
	barBack.Visible = false
	barBack.Parent = gui
	local bar = Instance.new("Frame")
	bar.Size = UDim2.new(0, 0, 1, 0)
	bar.BackgroundColor3 = GOLD
	bar.BorderSizePixel = 0
	bar.Parent = barBack
	return { root = at, title = title, status = status, barBack = barBack, bar = bar }
end

-- Build the arena once: the wall ring, the two entry circles and the signs.
local function build()
	if folder or not data or not data.zones then
		return
	end
	local f = Instance.new("Folder")
	f.Name = "Arena"
	f.Parent = Workspace
	folder = f
	local ground = Ground.height()
	local cx, cz = data.x * S, data.y * S

	-- The wall: crystal blocks round the floor (the solid ring is in the map's obstacles).
	local r = (data.radius + data.wall / 2) * S
	local segment = 2 * math.pi * r / WALL_SEGMENTS
	for k = 0, if Art.enabled then -1 else WALL_SEGMENTS - 1 do
		local a = k / WALL_SEGMENTS * math.pi * 2
		local x, z = cx + math.cos(a) * r, cz + math.sin(a) * r
		local tall = WALL_HEIGHT * (if k % 2 == 0 then 1 else 0.82)
		part("Wall", Vector3.new(data.wall * S, tall, segment * 1.15),
			CFrame.new(x, ground + tall / 2, z) * CFrame.Angles(0, -a, 0), CRYSTAL, Enum.Material.Glass)
	end
	-- A gate (closed: armies are moved in and out) where each entry circle faces the wall.
	for _, zone in if Art.enabled then {} else data.zones do
		local gx, gz = zone.gateX * S, zone.gateY * S
		local a = math.atan2(zone.dirY, zone.dirX)
		part("Gate", Vector3.new(data.wall * S * 1.3, WALL_HEIGHT * 1.4, 34 * S),
			CFrame.new(gx, ground + WALL_HEIGHT * 0.7, gz) * CFrame.Angles(0, -a, 0), Color3.fromRGB(90, 70, 150), Enum.Material.Neon)
	end
	-- The arena floor, faintly lit.
	local floor = part("Floor", Vector3.new(0.2, data.radius * 2 * S, data.radius * 2 * S),
		CFrame.new(cx, ground + 0.1, cz) * CFrame.Angles(0, 0, math.rad(90)), CRYSTAL, Enum.Material.ForceField)
	floor.Shape = Enum.PartType.Cylinder
	floor.Size = Vector3.new(0.2, data.radius * 2 * S, data.radius * 2 * S)
	floor.Transparency = if Art.enabled then 1 else 0.6
	local centre = sign(floor, 22, 300)
	centre.title.Text = "CRYSTAL ARENA"
	centreSign = centre

	for i, zone in data.zones do
		local ring = part("Entry" .. i, Vector3.new(0.2, zone.radius * 2 * S, zone.radius * 2 * S),
			CFrame.new(zone.x * S, ground + 0.15, zone.y * S) * CFrame.Angles(0, 0, math.rad(90)), GOLD, Enum.Material.ForceField)
		ring.Shape = Enum.PartType.Cylinder
		ring.Size = Vector3.new(0.2, zone.radius * 2 * S, zone.radius * 2 * S)
		zoneRings[i] = ring
		-- The sign (and the wheel on it) stands over the wheel's spot beside the circle.
		local post = part("Wheel" .. i, Vector3.new(1, 1, 1), CFrame.new(zone.wheelX * S, ground + 0.5, zone.wheelY * S), GOLD, Enum.Material.Neon)
		post.Transparency = 1
		local s = sign(post, 12, 260)
		s.title.Text = "ARENA ENTRY"
		zoneSigns[i] = s
	end
end

local function nameOf(id: number): string
	return names[id] or "?"
end

local function colorOf(id: number): Color3
	return Config.colors[colors[id] or 0] or GOLD
end

local function outcomeLabel(n: number): string
	return if n > 0 then string.format("+%d SOLDIERS", n) else string.format("LOSE %d", -n)
end

-- A new state from the server.
function ArenaView.apply(message: Message, now: number)
	latest = message
	latestAt = now
end

-- Every army's name and colour (from the scoreboard).
function ArenaView.setArmies(rows: { { id: number, name: string, color: number } })
	for _, row in rows do
		names[row.id] = row.name
		colors[row.id] = row.color
	end
end

-- Update the circles and signs (every frame, so the wheels can spin smoothly).
function ArenaView.draw(now: number)
	local m = latest
	if not m then
		return
	end
	build()
	local centre = centreSign
	if not centre then
		return
	end
	local t = m.phaseTime + (now - latestAt)
	local a, b = m.zones[1], m.zones[2]

	-- Over the arena: the match.
	centre.barBack.Visible = false
	if m.phase == "fight" then
		centre.status.Text = string.format("%s  VS  %s", nameOf(a.holder), nameOf(b.holder))
	elseif m.phase == "victory" then
		centre.status.Text = if m.winner ~= 0 then string.format("%s WINS!", nameOf(m.winner)) else "NOBODY LEFT STANDING"
	elseif m.phase == "countdown" or m.phase == "spinning" then
		centre.status.Text = string.format("NEXT: %s  VS  %s", nameOf(a.holder), nameOf(b.holder))
	elseif m.phase == "cooldown" then
		centre.status.Text = string.format("OPENS IN %ds", math.max(0, math.ceil(m.cooldownTime - t)))
	else
		centre.status.Text = "HOLD AN ENTRY CIRCLE TO CHALLENGE"
	end

	-- Each entry circle and its wheel.
	for i, z in m.zones do
		local ring, s = zoneRings[i], zoneSigns[i]
		if not ring or not s then
			continue
		end
		local color, text, fill = GOLD, "", 0
		if m.phase == "open" then
			if z.holder ~= 0 then
				color = colorOf(z.holder)
				fill = z.held / m.qualifyTime
				if z.qualified == 1 then
					text = string.format("%s READY - WAITING FOR A CHALLENGER", nameOf(z.holder))
				elseif z.contested == 1 then
					text = string.format("%s - CONTESTED, PAUSED", nameOf(z.holder))
				else
					text = string.format("%s QUALIFYING - %ds", nameOf(z.holder), math.ceil(m.qualifyTime - z.held))
				end
			else
				text = if z.contested == 1 then "CONTESTED" else "STAND HERE ALONE TO ENTER"
			end
		elseif m.phase == "countdown" then
			color = colorOf(z.holder)
			text = string.format("%s - SPIN IN %d", nameOf(z.holder), math.max(1, math.ceil(m.countdownTime - t)))
		elseif m.phase == "spinning" then
			color = colorOf(z.holder)
			fill = 1
			local outcomes = m.outcomes
			local result = if z.outcome > 0 then z.outcome else 1
			local p = math.min(1, t / m.spinTime)
			if p < 1 then
				-- The wheel: outcomes flick past, slowing down, then land on the result.
				local ticks = math.floor((1 - (1 - p) ^ 3) * 30)
				local shown = (result + ticks - 30 - 1) % #outcomes + 1
				text = string.format("%s SPINS... %s", nameOf(z.holder), outcomeLabel(outcomes[shown]))
			else
				text = string.format("%s: %s!", nameOf(z.holder), outcomeLabel(outcomes[result]))
			end
		elseif m.phase == "fight" or m.phase == "victory" then
			color = colorOf(z.holder)
			text = string.format("%s IS FIGHTING", nameOf(z.holder))
		else
			color = GREY
			text = string.format("RESTING - OPENS IN %ds", math.max(0, math.ceil(m.cooldownTime - t)))
		end
		ring.Color = color
		s.status.Text = text
		s.bar.BackgroundColor3 = color
		s.bar.Size = UDim2.new(math.clamp(fill, 0, 1), 0, 1, 0)
		s.barBack.Visible = fill > 0
	end
end

return ArenaView
