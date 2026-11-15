--!strict
-- The bar across the top of the screen: shards, progress to the next Warrior
-- and Archer, and army size (like the web version's HUD).

local Players = game:GetService("Players")

local Hud = {}

local gui = Instance.new("ScreenGui")
gui.Name = "RaidkinHud"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true

local bar = Instance.new("Frame")
bar.Name = "Bar"
bar.AnchorPoint = Vector2.new(0.5, 0)
bar.Position = UDim2.new(0.5, 0, 0, 10)
-- As wide as its text (plus padding).
bar.AutomaticSize = Enum.AutomaticSize.X
bar.Size = UDim2.new(0, 0, 0, 36)
bar.BackgroundColor3 = Color3.fromRGB(18, 22, 18)
bar.BackgroundTransparency = 0.25
bar.Parent = gui
local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 8)
corner.Parent = bar
local padding = Instance.new("UIPadding")
padding.PaddingLeft = UDim.new(0, 16)
padding.PaddingRight = UDim.new(0, 16)
padding.Parent = bar

local label = Instance.new("TextLabel")
label.Name = "Text"
label.BackgroundTransparency = 1
label.AutomaticSize = Enum.AutomaticSize.X
label.Size = UDim2.new(0, 0, 1, 0)
label.Font = Enum.Font.GothamBold
label.TextSize = 16
label.TextColor3 = Color3.fromRGB(235, 230, 210)
label.RichText = true
label.Text = "Loading..."
label.Parent = bar

-- A little progress bar made of blocks, e.g. 3 of 5: "■■■□□".
local function blocks(filled: number, total: number): string
	return string.rep("■", filled) .. string.rep("□", math.max(0, total - filled))
end

export type Stats = {
	shards: number,
	recruitProgress: number,
	recruitCost: number,
	green: number,
	archerProgress: number,
	archerCost: number,
	army: number,
}

function Hud.show(stats: Stats)
	label.Text = string.format(
		'<font color="#50c8ff">◆</font> SHARDS %d   ·   NEXT WARRIOR %s %d/%d   ·   <font color="#5aeb78">◆</font> ARCHER %s %d/%d   ·   ARMY %d',
		stats.shards,
		blocks(stats.recruitProgress, stats.recruitCost), stats.recruitProgress, stats.recruitCost,
		blocks(stats.archerProgress, stats.archerCost), stats.archerProgress, stats.archerCost,
		stats.army
	)
end

gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

return Hud
