--!strict
-- Each player's game: steering, the top-down camera, and drawing the armies.
--
-- Steer with the mouse (point where to go; near the middle of the screen
-- stops) or with WASD / the arrow keys. The server moves the armies; this
-- script draws them a little in the past (Config.INTERPOLATION_S) so they glide
-- smoothly between the server's snapshots.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(Shared:WaitForChild("Config"))
local Ground = require(Shared:WaitForChild("Ground"))
local Version = require(Shared:WaitForChild("Version"))
local ArmyView = require(script.Parent:WaitForChild("ArmyView"))
local ShardView = require(script.Parent:WaitForChild("ShardView"))
local BodyView = require(script.Parent:WaitForChild("BodyView"))
local NameView = require(script.Parent:WaitForChild("NameView"))
local CastleView = require(script.Parent:WaitForChild("CastleView"))
local Prediction = require(script.Parent:WaitForChild("Prediction"))
local Hud = require(script.Parent:WaitForChild("Hud"))

local camera = Workspace.CurrentCamera

-- Our scoreboard replaces Roblox's own player list (it sat right on top of it).
local StarterGui = game:GetService("StarterGui")
pcall(function()
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.PlayerList, false)
end)
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local steerRemote = remotes:WaitForChild("Steer") :: RemoteEvent
local snapshotRemote = remotes:WaitForChild("Snapshot") :: RemoteEvent
local shardRemote = remotes:WaitForChild("ShardSync") :: RemoteEvent
local bodiesRemote = remotes:WaitForChild("Bodies") :: RemoteEvent
local statsRemote = remotes:WaitForChild("Stats") :: RemoteEvent
local boardRemote = remotes:WaitForChild("Board") :: RemoteEvent
local defeatRemote = remotes:WaitForChild("Defeat") :: RemoteEvent
local respawnRemote = remotes:WaitForChild("Respawn") :: RemoteEvent
local castlesRemote = remotes:WaitForChild("Castles") :: RemoteEvent

-- The castles: where they are and what's happening at each (see CastleView).
castlesRemote.OnClientEvent:Connect(function(message)
	CastleView.apply(message)
end)

-- Which army is ours (the server tells us with our stats), and every army's name.
local myId: number? = nil
local names: { [number]: string } = {}
local lastBoard: { Hud.BoardRow } = {}

-- Shards and bodies: everything once (asked for below, now that we're listening), then changes.
shardRemote.OnClientEvent:Connect(function(message)
	ShardView.apply(message.shards)
end)
bodiesRemote.OnClientEvent:Connect(function(message)
	BodyView.apply(message)
end)
statsRemote.OnClientEvent:Connect(function(stats)
	if myId ~= stats.myId then
		myId = stats.myId
		Hud.showBoard(lastBoard, myId)
	end
	Hud.show(stats)
end)
boardRemote.OnClientEvent:Connect(function(rows)
	CastleView.setArmies(rows)
	lastBoard = rows
	for _, row in rows do
		names[row.id] = row.name
	end
	Hud.showBoard(rows, myId)
end)
defeatRemote.OnClientEvent:Connect(function(info)
	Hud.showDefeat(info, function()
		respawnRemote:FireServer()
	end)
end)
shardRemote:FireServer()

local S = Config.STUDS_PER_PX

-- ---------------------------------------------------------------------------
-- Snapshots from the server
-- ---------------------------------------------------------------------------

type Snapshot = { t: number, armies: { ArmyView.ArmyState } }
local snapshots: { Snapshot } = {}

-- Unpacks the server's flat soldier lists ({ id, x, z, yaw, moving, role, health, ... }).
snapshotRemote.OnClientEvent:Connect(function(message)
	local armies = {}
	for _, a in message.armies do
		local soldiers: { [number]: ArmyView.SoldierState } = {}
		local flat = a.soldiers
		for i = 1, #flat, 7 do
			soldiers[flat[i]] = {
				x = flat[i + 1],
				z = flat[i + 2],
				yaw = flat[i + 3],
				moving = flat[i + 4] == 1,
				role = flat[i + 5],
				health = flat[i + 6],
			}
		end
		table.insert(armies, { id = a.id, color = a.color, cx = a.cx, cz = a.cz, speed = a.speed, soldiers = soldiers })
	end
	table.insert(snapshots, { t = message.t, armies = armies })
	if #snapshots > 10 then
		table.remove(snapshots, 1)
	end
end)

-- The armies as they were at `renderTime`, blended between the two snapshots either side of it.
local function blendedArmies(renderTime: number): { ArmyView.ArmyState }
	local count = #snapshots
	if count == 0 then
		return {}
	end
	local older, newer = snapshots[1], snapshots[count]
	for i = count, 2, -1 do
		if snapshots[i - 1].t <= renderTime then
			older, newer = snapshots[i - 1], snapshots[i]
			break
		end
	end
	local span = newer.t - older.t
	local a = if span > 0 then math.clamp((renderTime - older.t) / span, 0, 1) else 1

	local before: { [number]: ArmyView.ArmyState } = {}
	for _, army in older.armies do
		before[army.id] = army
	end
	local result = {}
	for _, army in newer.armies do
		local prev = before[army.id]
		local soldiers: { [number]: ArmyView.SoldierState } = {}
		for id, s in army.soldiers do
			local p = prev and prev.soldiers[id]
			if p then
				soldiers[id] = { x = p.x + (s.x - p.x) * a, z = p.z + (s.z - p.z) * a, yaw = s.yaw, moving = s.moving, role = s.role, health = s.health }
			else
				-- A copy: our own army gets shifted each frame, which must never touch the snapshot.
				soldiers[id] = { x = s.x, z = s.z, yaw = s.yaw, moving = s.moving, role = s.role, health = s.health }
			end
		end
		local cx = if prev then prev.cx + (army.cx - prev.cx) * a else army.cx
		local cz = if prev then prev.cz + (army.cz - prev.cz) * a else army.cz
		table.insert(result, { id = army.id, color = army.color, cx = cx, cz = cz, soldiers = soldiers })
	end
	return result
end

-- ---------------------------------------------------------------------------
-- Steering
-- ---------------------------------------------------------------------------

-- Mouse steering ignores the pointer this close to the middle of the screen (pixels).
local MOUSE_DEADZONE = 25
-- Steering changes go to the server at once, but at most this often (a moving mouse changes it every frame).
local SEND_EVERY = 1 / 30

local function readSteering(): (number, number)
	local x = 0
	local z = 0
	if UserInputService:IsKeyDown(Enum.KeyCode.D) or UserInputService:IsKeyDown(Enum.KeyCode.Right) then x += 1 end
	if UserInputService:IsKeyDown(Enum.KeyCode.A) or UserInputService:IsKeyDown(Enum.KeyCode.Left) then x -= 1 end
	if UserInputService:IsKeyDown(Enum.KeyCode.S) or UserInputService:IsKeyDown(Enum.KeyCode.Down) then z += 1 end
	if UserInputService:IsKeyDown(Enum.KeyCode.W) or UserInputService:IsKeyDown(Enum.KeyCode.Up) then z -= 1 end
	if x ~= 0 or z ~= 0 then
		local length = math.sqrt(x * x + z * z)
		return x / length, z / length
	end

	-- The mouse: steer toward the pointer. The camera looks north (screen up = -z).
	if UserInputService.MouseEnabled then
		local mouse = UserInputService:GetMouseLocation()
		local middle = camera.ViewportSize / 2
		local dx, dy = mouse.X - middle.X, mouse.Y - middle.Y
		local length = math.sqrt(dx * dx + dy * dy)
		if length > MOUSE_DEADZONE then
			return dx / length, dy / length
		end
	end
	return 0, 0
end

local lastSentX, lastSentZ, lastSentAt = 0, 0, 0
local function sendSteering(now: number, x: number, z: number)
	local changed = x ~= lastSentX or z ~= lastSentZ
	-- Resend now and then even when unchanged, in case a message was lost.
	if not changed and now - lastSentAt < 0.5 then
		return
	end
	if changed and now - lastSentAt < SEND_EVERY then
		return
	end
	lastSentX, lastSentZ, lastSentAt = x, z, now
	steerRemote:FireServer(x, z)
end

-- SPACE splits the army toward where you're steering (or, standing still, toward
-- the mouse pointer even when it's close to the middle).
local splitRemote = remotes:WaitForChild("Split") :: RemoteEvent
UserInputService.InputBegan:Connect(function(input, typing)
	if typing or input.KeyCode ~= Enum.KeyCode.Space then
		return
	end
	local x, z = readSteering()
	if x == 0 and z == 0 and UserInputService.MouseEnabled then
		local mouse = UserInputService:GetMouseLocation()
		local middle = camera.ViewportSize / 2
		x, z = mouse.X - middle.X, mouse.Y - middle.Y
	end
	splitRemote:FireServer(x, z)
end)

-- ---------------------------------------------------------------------------
-- Camera
-- ---------------------------------------------------------------------------

--[[
	Like the web version's flat top-down view: looking almost straight down,
	from far away through a narrow lens, which takes out most of the perspective.
	ZOOM_OUT keeps the same amount of ground on screen as a normal lens would
	(the narrower the lens, the further back the camera must be).
]]
local CAMERA_PITCH = math.rad(80)
local FIELD_OF_VIEW = 30
local ZOOM_OUT = math.tan(math.rad(70 / 2)) / math.tan(math.rad(FIELD_OF_VIEW / 2))
local cameraDistance = 70 * ZOOM_OUT
local focus = Vector3.new(Config.world.size * S / 2, 0, Config.world.size * S / 2)

local function updateCamera(army: ArmyView.ArmyState?, dt: number)
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = FIELD_OF_VIEW
	if army then
		local count = 0
		local reach = 0
		for _, s in army.soldiers do
			count += 1
			reach = math.max(reach, math.sqrt((s.x - army.cx) ^ 2 + (s.z - army.cz) ^ 2))
		end
		-- Pull back as the army grows, and far enough to keep every split group on screen.
		local wanted = math.max(55 + math.sqrt(count) * 6, reach * S * 2.4 + 20) * ZOOM_OUT
		-- Zooming out reacts faster than zooming back in.
		local rate = if wanted > cameraDistance then 3 else 1.2
		cameraDistance += (wanted - cameraDistance) * math.min(1, dt * rate)
		-- Locked on the army (no trailing), like the web version.
		focus = Vector3.new(army.cx * S, Ground.height(), army.cz * S)
	end
	local offset = Vector3.new(0, math.sin(CAMERA_PITCH), math.cos(CAMERA_PITCH)) * cameraDistance
	camera.CFrame = CFrame.lookAt(focus + offset, focus)
end

-- ---------------------------------------------------------------------------
-- Every frame
-- ---------------------------------------------------------------------------

-- The server's latest word on our own army (not blended: the newest snapshot).
local function latestMine(): ArmyView.ArmyState?
	local latest = snapshots[#snapshots]
	if latest then
		for _, army in latest.armies do
			if army.id == myId then
				return army
			end
		end
	end
	return nil
end

RunService.RenderStepped:Connect(function(dt)
	local now = os.clock()
	local steerX, steerZ = readSteering()
	sendSteering(now, steerX, steerZ)

	local armies = blendedArmies(Workspace:GetServerTimeNow() - Config.INTERPOLATION_S)
	local mine: ArmyView.ArmyState? = nil
	for _, army in armies do
		if army.id == myId then
			mine = army
		end
	end

	-- Our own army moves the moment we steer (see Prediction): draw it where the
	-- prediction has it, every soldier shifted along with the steering point.
	local server = latestMine()
	if mine and server then
		local px, pz = Prediction.update(math.min(dt, 0.1), steerX, steerZ, server.cx, server.cz, server.speed or Config.movement.maxSpeed, now)
		local shiftX, shiftZ = px - mine.cx, pz - mine.cz
		if shiftX * shiftX + shiftZ * shiftZ < 250 * 250 then
			for _, s in mine.soldiers do
				s.x += shiftX
				s.z += shiftZ
			end
		end
		mine.cx, mine.cz = px, pz
	else
		Prediction.reset()
	end
	updateCamera(mine, dt)
	ArmyView.draw(armies, now)
	NameView.draw(armies, names)
	CastleView.draw(now)
end)

print(`[{Version.name}] client ready, version {Version.version}`)
