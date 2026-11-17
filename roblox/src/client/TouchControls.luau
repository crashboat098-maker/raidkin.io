--!strict
--[[
	On-screen controls for phones and tablets, like the web version's: a joystick
	(bottom left) to steer, and SPLIT / SURRENDER buttons (bottom right). Shown
	only on touch screens, so mouse-and-keyboard players never see them.
]]

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")

local TouchControls = {}

-- Size of the joystick and its knob, and how far (px) the knob travels at full tilt.
local PAD = 116
local KNOB = 40
local TRAVEL = 43

-- Joystick direction, each axis -1..1 (zero while not touched).
TouchControls.x = 0
TouchControls.z = 0
TouchControls.enabled = UserInputService.TouchEnabled

local onSplit: (() -> ())? = nil
local onSurrender: (() -> ())? = nil

-- What to do when SPLIT / SURRENDER is tapped.
function TouchControls.connect(split: () -> (), surrender: () -> ())
	onSplit, onSurrender = split, surrender
end

-- True while a finger is on the joystick.
local activeTouch: InputObject? = nil
function TouchControls.active(): boolean
	return activeTouch ~= nil
end

local function circle(parent: Instance, size: number, color: Color3, transparency: number): Frame
	local f = Instance.new("Frame")
	f.Size = UDim2.fromOffset(size, size)
	f.BackgroundColor3 = color
	f.BackgroundTransparency = transparency
	f.Parent = parent
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.5, 0)
	corner.Parent = f
	return f
end

local function button(parent: Instance, label: string, color: Color3, bottom: number, textSize: number, onPress: () -> ()): TextButton
	local b = Instance.new("TextButton")
	b.AnchorPoint = Vector2.new(1, 1)
	b.Position = UDim2.new(1, -22, 1, -bottom)
	b.Size = UDim2.fromOffset(84, 84)
	b.BackgroundColor3 = color
	b.BackgroundTransparency = 0.1
	b.Text = label
	b.Font = Enum.Font.GothamBlack
	b.TextSize = textSize
	b.TextColor3 = Color3.fromRGB(43, 28, 8)
	b.AutoButtonColor = true
	b.Parent = parent
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.5, 0)
	corner.Parent = b
	local stroke = Instance.new("UIStroke")
	stroke.Color = Color3.new(1, 1, 1)
	stroke.Transparency = 0.6
	stroke.Thickness = 3
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Parent = b
	-- React the moment it's touched (a second finger while the first steers).
	b.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.Touch then
			onPress()
		end
	end)
	return b
end

if TouchControls.enabled then
	local gui = Instance.new("ScreenGui")
	gui.Name = "TouchControls"
	gui.ResetOnSpawn = false
	gui.DisplayOrder = 5
	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

	local pad = circle(gui, PAD, Color3.fromRGB(24, 56, 36), 0.6)
	pad.AnchorPoint = Vector2.new(0, 1)
	pad.Position = UDim2.new(0, 24, 1, -24)
	local padStroke = Instance.new("UIStroke")
	padStroke.Color = Color3.fromRGB(232, 245, 215)
	padStroke.Transparency = 0.45
	padStroke.Thickness = 3
	padStroke.Parent = pad
	local knob = circle(pad, KNOB, Color3.fromRGB(242, 223, 155), 0.2)
	knob.AnchorPoint = Vector2.new(0.5, 0.5)
	knob.Position = UDim2.fromScale(0.5, 0.5)

	local function moveKnob(position: Vector3)
		local centre = pad.AbsolutePosition + pad.AbsoluteSize / 2
		local dx, dy = position.X - centre.X, position.Y - centre.Y
		local length = math.sqrt(dx * dx + dy * dy)
		local scale = if length > 0 then 1 / math.max(length, TRAVEL) else 0
		TouchControls.x, TouchControls.z = dx * scale, dy * scale
		knob.Position = UDim2.new(0.5, TouchControls.x * TRAVEL, 0.5, TouchControls.z * TRAVEL)
	end
	local function release()
		activeTouch = nil
		TouchControls.x, TouchControls.z = 0, 0
		knob.Position = UDim2.fromScale(0.5, 0.5)
	end

	pad.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.Touch and not activeTouch then
			activeTouch = input
			moveKnob(input.Position)
		end
	end)
	UserInputService.TouchMoved:Connect(function(input)
		if input == activeTouch then
			moveKnob(input.Position)
		end
	end)
	UserInputService.TouchEnded:Connect(function(input)
		if input == activeTouch then
			release()
		end
	end)

	button(gui, "SPLIT", Color3.fromRGB(230, 173, 68), 120, 13, function()
		local f = onSplit
		if f then
			f()
		end
	end)
	button(gui, "SURRENDER", Color3.fromRGB(201, 209, 198), 24, 11, function()
		local f = onSurrender
		if f then
			f()
		end
	end)
end

return TouchControls
