--!strict
--[[
	The start screen, like the web version's: the game's title, a box for your
	army's name, a row of colours to pick from (each shown as a soldier in that
	colour), and PLAY. Your army only appears once you press PLAY.
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local Art = require(script.Parent:WaitForChild("Art"))

local StartScreen = {}

local GOLD = Color3.fromRGB(240, 200, 90)
local PANEL = Color3.fromRGB(18, 22, 18)
local NAME_MAX = 16

local gui: ScreenGui? = nil

local function rounded(object: GuiObject, radius: number)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius)
	corner.Parent = object
end

local function text(parent: Instance, value: string, size: number, color: Color3, y: number, height: number): TextLabel
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Position = UDim2.new(0, 0, 0, y)
	label.Size = UDim2.new(1, 0, 0, height)
	label.Font = Enum.Font.GothamBlack
	label.TextSize = size
	label.TextColor3 = color
	label.Text = value
	label.Parent = parent
	return label
end

--[[
	Show the start screen. `name` and `color` are what to start with (your
	Roblox name, or what you picked last time); `onPlay` gets the choice.
]]
function StartScreen.show(name: string, color: number, onPlay: (string, number) -> ())
	if gui then
		return
	end
	local screen = Instance.new("ScreenGui")
	screen.Name = "StartScreen"
	screen.IgnoreGuiInset = true
	screen.ResetOnSpawn = false
	screen.DisplayOrder = 20
	screen.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	gui = screen

	local shade = Instance.new("Frame")
	shade.Size = UDim2.fromScale(1, 1)
	shade.BackgroundColor3 = Color3.new(0, 0, 0)
	shade.BackgroundTransparency = 0.45
	shade.Parent = screen

	local panel = Instance.new("Frame")
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromOffset(380, 300)
	panel.BackgroundColor3 = PANEL
	panel.BackgroundTransparency = 0.08
	panel.Parent = screen
	rounded(panel, 14)
	local stroke = Instance.new("UIStroke")
	stroke.Color = GOLD
	stroke.Thickness = 3
	stroke.Parent = panel
	-- Phones: shrink the panel to fit small screens.
	local scale = Instance.new("UIScale")
	scale.Parent = panel
	local function fit()
		local view = workspace.CurrentCamera.ViewportSize
		scale.Scale = math.min(1, (view.Y - 20) / 300, (view.X - 20) / 380)
	end
	fit()
	workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(fit)

	text(panel, "RAIDKIN", 44, GOLD, 14, 50)
	-- Your all-time record (saved between visits; see the server's Profiles).
	local leaderstats = Players.LocalPlayer:FindFirstChild("leaderstats")
	if leaderstats then
		local function value(name: string): number
			local v = leaderstats:FindFirstChild(name)
			return if v and v:IsA("IntValue") then v.Value else 0
		end
		if value("Kills") + value("Best") + value("Wins") > 0 then
			text(panel, string.format("KILLS %d  ·  BEST ARMY %d  ·  ARENA WINS %d", value("Kills"), value("Best"), value("Wins")), 12, GOLD, 56, 16)
		end
	end
	text(panel, "NAME YOUR ARMY", 13, Color3.fromRGB(200, 200, 190), 72, 18)

	local box = Instance.new("TextBox")
	box.AnchorPoint = Vector2.new(0.5, 0)
	box.Position = UDim2.new(0.5, 0, 0, 92)
	box.Size = UDim2.fromOffset(300, 38)
	box.BackgroundColor3 = Color3.fromRGB(249, 255, 245)
	box.TextColor3 = Color3.fromRGB(23, 50, 31)
	box.Font = Enum.Font.GothamBold
	box.TextSize = 18
	box.ClearTextOnFocus = false
	box.PlaceholderText = "YOUR NAME"
	box.Text = string.sub(string.upper(name), 1, NAME_MAX)
	box.Parent = panel
	rounded(box, 7)
	-- Capitals only, and not too long (like the web game).
	box:GetPropertyChangedSignal("Text"):Connect(function()
		local cleaned = string.sub(string.upper(box.Text), 1, NAME_MAX)
		if cleaned ~= box.Text then
			box.Text = cleaned
		end
	end)

	-- The colours: a soldier in each, the chosen one outlined in gold.
	-- The bots keep their own colours: those can't be picked.
	local function free(i: number): boolean
		return table.find(Config.bots.colors, i) == nil
	end
	local chosen = math.clamp(color, 1, #Config.colors)
	if not free(chosen) then
		for i = 1, #Config.colors do
			if free(i) then
				chosen = i
				break
			end
		end
	end
	local swatches: { TextButton } = {}
	local row = Instance.new("Frame")
	row.BackgroundTransparency = 1
	row.AnchorPoint = Vector2.new(0.5, 0)
	row.Position = UDim2.new(0.5, 0, 0, 146)
	row.Size = UDim2.fromOffset(#Config.colors * 42, 50)
	row.Parent = panel
	local function highlight()
		for i, swatch in swatches do
			local outline = swatch:FindFirstChildOfClass("UIStroke")
			if outline then
				outline.Transparency = if i == chosen then 0 else 1
			end
		end
	end
	for i, c in Config.colors do
		local swatch = Instance.new("TextButton")
		swatch.Text = ""
		swatch.Position = UDim2.fromOffset((i - 1) * 42, 0)
		swatch.Size = UDim2.fromOffset(38, 46)
		swatch.BackgroundColor3 = c
		swatch.BackgroundTransparency = 0.55
		swatch.Parent = row
		rounded(swatch, 7)
		local outline = Instance.new("UIStroke")
		outline.Color = GOLD
		outline.Thickness = 3
		outline.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
		outline.Parent = swatch
		if Art.enabled then
			local soldier = Art.newLabel(swatch)
			local w, h = Art.show(soldier, Art.soldierKey(0, i), false)
			soldier.AnchorPoint = Vector2.new(0.5, 0.5)
			soldier.Position = UDim2.fromScale(0.5, 0.5)
			soldier.Size = UDim2.fromOffset(w * 2.5, h * 2.5)
		end
		if free(i) then
			swatch.Activated:Connect(function()
				chosen = i
				highlight()
			end)
		else
			-- A bot's colour: shown faded, not pickable.
			swatch.AutoButtonColor = false
			swatch.BackgroundTransparency = 0.85
			for _, child in swatch:GetChildren() do
				if child:IsA("ImageLabel") then
					child.ImageTransparency = 0.6
				end
			end
		end
		table.insert(swatches, swatch)
	end
	highlight()

	local play = Instance.new("TextButton")
	play.AnchorPoint = Vector2.new(0.5, 0)
	play.Position = UDim2.new(0.5, 0, 0, 214)
	play.Size = UDim2.fromOffset(300, 54)
	play.BackgroundColor3 = Color3.fromRGB(230, 173, 68)
	play.Font = Enum.Font.GothamBlack
	play.TextSize = 24
	play.TextColor3 = Color3.fromRGB(40, 24, 0)
	play.Text = "PLAY"
	play.Parent = panel
	rounded(play, 8)
	local function go()
		local picked = if box.Text ~= "" then box.Text else string.upper(name)
		screen:Destroy()
		gui = nil
		onPlay(picked, chosen)
	end
	play.Activated:Connect(go)
	box.FocusLost:Connect(function(enter)
		if enter then
			go()
		end
	end)
end

return StartScreen
