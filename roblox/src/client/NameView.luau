--!strict
-- A name tag floating over each army (in its colour), so you can tell who's who.

local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Ground = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Ground"))
local Art = require(script.Parent:WaitForChild("Art"))

local S = Config.STUDS_PER_PX
local HEIGHT = 7

local NameView = {}

local folder = Instance.new("Folder")
folder.Name = "ArmyNames"
folder.Parent = Workspace

type Tag = { anchor: Part, label: TextLabel, seen: boolean }
local tags: { [number]: Tag } = {}

local function tagFor(id: number): Tag
	local tag = tags[id]
	if tag then
		return tag
	end
	local anchor = Instance.new("Part")
	anchor.Name = "Name" .. id
	anchor.Anchored = true
	anchor.CanCollide = false
	anchor.CanQuery = false
	anchor.CanTouch = false
	anchor.Transparency = 1
	anchor.Size = Vector3.one
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.new(0, 200, 0, 24)
	gui.AlwaysOnTop = true
	gui.Parent = anchor
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.GothamBlack
	label.TextSize = 16
	label.TextStrokeTransparency = 0.3
	label.Parent = gui
	anchor.Parent = folder
	tag = { anchor = anchor, label = label, seen = true }
	tags[id] = tag
	return tag
end

-- Place a tag over every army: `armies` gives where each one is, `names` and `colors` who it is.
function NameView.draw(armies: { any }, names: { [number]: string })
	for _, tag in tags do
		tag.seen = false
	end
	for _, army in armies do
		local name = names[army.id]
		if army.id ~= 0 and name then
			local tag = tagFor(army.id)
			tag.seen = true
			tag.label.Text = name
			tag.label.TextColor3 = Config.colors[army.color] or Config.neutralColor
			if Art.enabled then
				-- Looking straight down, height doesn't show: like the web game, the tag sits
				-- north of the army instead, 18 px over its topmost soldier.
				local top = army.cz
				for _, soldier in army.soldiers do
					top = math.min(top, soldier.z)
				end
				tag.anchor.CFrame = CFrame.new(army.cx * S, Ground.height() + 1, (top - 24) * S)
			else
				tag.anchor.CFrame = CFrame.new(army.cx * S, Ground.height() + HEIGHT, army.cz * S)
			end
		end
	end
	for id, tag in tags do
		if not tag.seen then
			tag.anchor:Destroy()
			tags[id] = nil
		end
	end
end

return NameView
