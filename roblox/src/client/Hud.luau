--!strict
-- The screen overlay: the bar across the top (shards, progress to the next
-- Warrior and Archer, army size, splitting), the scoreboard in the corner, and
-- the "defeated" screen with PLAY AGAIN (like the web version's HUD).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local Hud = {}

local TEXT = Color3.fromRGB(235, 230, 210)
local PANEL = Color3.fromRGB(18, 22, 18)
local GOLD = Color3.fromRGB(240, 200, 90)

local gui = Instance.new("ScreenGui")
gui.Name = "RaidkinHud"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true

local function rounded(frame: GuiObject, radius: number)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius)
	corner.Parent = frame
end

local function textLabel(parent: Instance, size: number): TextLabel
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.GothamBold
	label.TextSize = size
	label.TextColor3 = TEXT
	label.RichText = true
	label.Parent = parent
	return label
end

-- ---------------------------------------------------------------------------
-- The bar across the top
-- ---------------------------------------------------------------------------

local bar = Instance.new("Frame")
bar.Name = "Bar"
bar.AnchorPoint = Vector2.new(0.5, 0)
bar.Position = UDim2.new(0.5, 0, 0, 10)
-- As wide as its text (plus padding).
bar.AutomaticSize = Enum.AutomaticSize.X
bar.Size = UDim2.new(0, 0, 0, 36)
bar.BackgroundColor3 = PANEL
bar.BackgroundTransparency = 0.25
bar.Parent = gui
rounded(bar, 8)
local padding = Instance.new("UIPadding")
padding.PaddingLeft = UDim.new(0, 16)
padding.PaddingRight = UDim.new(0, 16)
padding.Parent = bar

local label = textLabel(bar, 16)
label.Name = "Text"
label.AutomaticSize = Enum.AutomaticSize.X
label.Size = UDim2.new(0, 0, 1, 0)
label.Text = "Loading..."

-- A little progress bar made of blocks, e.g. 3 of 5: "■■■□□".
local function blocks(filled: number, total: number): string
	return string.rep("■", filled) .. string.rep("□", math.max(0, total - filled))
end

export type Stats = {
	myId: number,
	shards: number,
	recruitProgress: number,
	recruitCost: number,
	green: number,
	archerProgress: number,
	archerCost: number,
	army: number,
	-- How many groups the army is split into, and seconds until the next one heads back.
	groups: number,
	regroupIn: number?,
}

function Hud.show(stats: Stats)
	local split = ""
	if stats.groups > 1 then
		split = string.format("   ·   %d GROUPS", stats.groups)
		if stats.regroupIn then
			split ..= string.format(" (REGROUP IN %d)", math.ceil(stats.regroupIn))
		end
	elseif stats.army >= 2 then
		split = "   ·   SPACE SPLIT   ·   Q SURRENDER"
	end
	label.Text = string.format(
		'<font color="#50c8ff">◆</font> SHARDS %d   ·   NEXT WARRIOR %s %d/%d   ·   <font color="#5aeb78">◆</font> ARCHER %s %d/%d   ·   ARMY %d%s',
		stats.shards,
		blocks(stats.recruitProgress, stats.recruitCost), stats.recruitProgress, stats.recruitCost,
		blocks(stats.archerProgress, stats.archerCost), stats.archerProgress, stats.archerCost,
		stats.army,
		split
	)
end

-- ---------------------------------------------------------------------------
-- The scoreboard
-- ---------------------------------------------------------------------------

local board = Instance.new("Frame")
board.Name = "Scoreboard"
board.AnchorPoint = Vector2.new(1, 0)
board.Position = UDim2.new(1, -12, 0, 56)
board.Size = UDim2.new(0, 230, 0, 0)
board.AutomaticSize = Enum.AutomaticSize.Y
board.BackgroundColor3 = PANEL
board.BackgroundTransparency = 0.3
board.Parent = gui
rounded(board, 8)
local boardPadding = Instance.new("UIPadding")
boardPadding.PaddingTop = UDim.new(0, 6)
boardPadding.PaddingBottom = UDim.new(0, 6)
boardPadding.PaddingLeft = UDim.new(0, 10)
boardPadding.PaddingRight = UDim.new(0, 10)
boardPadding.Parent = board
local boardList = Instance.new("UIListLayout")
boardList.SortOrder = Enum.SortOrder.LayoutOrder
boardList.Parent = board

-- Rows use a fixed-width font so the columns line up.
local function boardRow(order: number): TextLabel
	local row = textLabel(board, 14)
	row.Font = Enum.Font.RobotoMono
	row.Size = UDim2.new(1, 0, 0, 20)
	row.TextXAlignment = Enum.TextXAlignment.Left
	row.LayoutOrder = order
	return row
end

local header = boardRow(0)
header.Text = string.format('<font color="#a0a090">#   %-12s %4s %5s</font>', "NAME", "ARMY", "KILLS")
local rows: { TextLabel } = {}

export type BoardRow = { id: number, name: string, color: number, army: number, kills: number, alive: boolean }

-- Every army, biggest first; `myId` is highlighted.
function Hud.showBoard(list: { BoardRow }, myId: number?)
	for i, entry in list do
		local row = rows[i]
		if not row then
			row = boardRow(i)
			rows[i] = row
		end
		local color = Config.colors[entry.color] or Config.neutralColor
		local name = string.format("%-10s", string.sub(entry.name, 1, 10))
		if entry.id == myId then
			name = '<font color="#f0c85a">' .. name .. "</font>"
		end
		row.Text = string.format(
			'%d <font color="#%s">■</font> %s %4s %5d',
			i,
			color:ToHex(),
			name,
			if entry.alive then tostring(entry.army) else "-",
			entry.kills
		)
		row.Visible = true
	end
	for i = #list + 1, #rows do
		rows[i].Visible = false
	end
end

-- ---------------------------------------------------------------------------
-- Defeat
-- ---------------------------------------------------------------------------

local defeat = Instance.new("Frame")
defeat.Name = "Defeat"
defeat.AnchorPoint = Vector2.new(0.5, 0.5)
defeat.Position = UDim2.fromScale(0.5, 0.5)
defeat.Size = UDim2.new(0, 340, 0, 210)
defeat.BackgroundColor3 = PANEL
defeat.BackgroundTransparency = 0.1
defeat.Visible = false
defeat.Parent = gui
rounded(defeat, 12)
local defeatStroke = Instance.new("UIStroke")
defeatStroke.Color = GOLD
defeatStroke.Thickness = 2
defeatStroke.Parent = defeat

local defeatTitle = textLabel(defeat, 32)
defeatTitle.Size = UDim2.new(1, 0, 0, 50)
defeatTitle.Position = UDim2.new(0, 0, 0, 14)
defeatTitle.TextColor3 = GOLD
defeatTitle.Text = "DEFEATED"

local defeatText = textLabel(defeat, 16)
defeatText.Size = UDim2.new(1, -30, 0, 60)
defeatText.Position = UDim2.new(0, 15, 0, 66)
defeatText.TextWrapped = true

local playAgain = Instance.new("TextButton")
playAgain.Name = "PlayAgain"
playAgain.AnchorPoint = Vector2.new(0.5, 1)
playAgain.Position = UDim2.new(0.5, 0, 1, -16)
playAgain.Size = UDim2.new(0, 220, 0, 44)
playAgain.BackgroundColor3 = Color3.fromRGB(230, 173, 68)
playAgain.Font = Enum.Font.GothamBlack
playAgain.TextSize = 20
playAgain.TextColor3 = Color3.fromRGB(40, 24, 0)
playAgain.Text = "PLAY AGAIN"
playAgain.Parent = defeat
rounded(playAgain, 8)

export type DefeatInfo = { kills: number, bestArmy: number, shards: number }

-- Show the "defeated" screen; `onPlayAgain` runs when the button is pressed.
function Hud.showDefeat(info: DefeatInfo, onPlayAgain: () -> ())
	defeatText.Text = string.format("Biggest army: %d   ·   Kills: %d   ·   Shards: %d", info.bestArmy, info.kills, info.shards)
	defeat.Visible = true
	local connection
	connection = playAgain.Activated:Connect(function()
		connection:Disconnect()
		defeat.Visible = false
		onPlayAgain()
	end)
end

gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

return Hud
