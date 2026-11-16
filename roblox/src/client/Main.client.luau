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
local ArenaView = require(script.Parent:WaitForChild("ArenaView"))
local Prediction = require(script.Parent:WaitForChild("Prediction"))
local Hud = require(script.Parent:WaitForChild("Hud"))
-- The web game's real pixel art, once its images are uploaded (see Art); else the 3D look.
local Art = require(script.Parent:WaitForChild("Art"))
local SpriteLayer = require(script.Parent:WaitForChild("SpriteLayer"))

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

-- The Crystal Arena: its phase, entry circles and wheels (see ArenaView).
local arenaRemote = remotes:WaitForChild("Arena") :: RemoteEvent
arenaRemote.OnClientEvent:Connect(function(message)
	ArenaView.apply(message, os.clock())
end)

-- Which army is ours (the server tells us with our stats), and every army's name.
local myId: number? = nil
local names: { [number]: string } = {}
local lastBoard: { Hud.BoardRow } = {}

-- Shards and bodies: everything once (asked for below, now that we're listening), then changes.
shardRemote.OnClientEvent:Connect(function(message)
	if Art.enabled then
		SpriteLayer.applyShards(message.shards)
	else
		ShardView.apply(message.shards)
	end
end)
bodiesRemote.OnClientEvent:Connect(function(message)
	if Art.enabled then
		SpriteLayer.applyBodies(message)
	else
		BodyView.apply(message)
	end
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
	ArenaView.setArmies(rows)
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
local MOUSE_DEADZONE = 10
-- With the pixel art, like the web game: the army walks to the map point under the
-- mouse, stopping within MOUSE_STOP screen px of it and easing off from MOUSE_FULL_SPEED.
local MOUSE_STOP = 4
local MOUSE_FULL_SPEED = 40

--[[
	From our army to the mouse pointer, in world px (pixel art: the map point under
	the mouse; 3D: from the middle of the screen), and how many screen px that is.
	Nil when there's no mouse.
]]
local function mouseOffset(): (number?, number?, number)
	if not UserInputService.MouseEnabled then
		return nil, nil, 0
	end
	local mouse = UserInputService:GetMouseLocation()
	if Art.enabled then
		local ax, az = Prediction.position()
		if ax and az then
			local wx, wz, zoom = SpriteLayer.toWorld(mouse.X, mouse.Y)
			local dx, dz = wx - ax, wz - az
			return dx, dz, math.sqrt(dx * dx + dz * dz) * zoom
		end
	end
	local middle = camera.ViewportSize / 2
	local dx, dz = mouse.X - middle.X, mouse.Y - middle.Y
	return dx, dz, math.sqrt(dx * dx + dz * dz)
end
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
	local dx, dz, screen = mouseOffset()
	if dx and dz and screen > 0 then
		local length = math.sqrt(dx * dx + dz * dz)
		if Art.enabled then
			-- Walk to the pointer and stop on it, slowing down over the last stretch.
			if screen <= MOUSE_STOP then
				return 0, 0
			end
			local strength = math.min(1, (screen - MOUSE_STOP) / (MOUSE_FULL_SPEED - MOUSE_STOP))
			return dx / length * strength, dz / length * strength
		end
		if screen > MOUSE_DEADZONE then
			return dx / length, dz / length
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
	local dx, dz = mouseOffset()
	if dx and dz and (Art.enabled or (x == 0 and z == 0)) then
		-- Toward the pointer (from the army itself).
		x, z = dx, dz
	end
	splitRemote:FireServer(x, z)
end)

-- Q or right-click surrenders a soldier: the one furthest toward the mouse
-- pointer (or where you're steering) leaves the army and turns neutral.
local surrenderRemote = remotes:WaitForChild("Surrender") :: RemoteEvent
UserInputService.InputBegan:Connect(function(input, typing)
	if typing or not (input.KeyCode == Enum.KeyCode.Q or input.UserInputType == Enum.UserInputType.MouseButton2) then
		return
	end
	-- Toward the pointer, from the army itself.
	local dx, dz = mouseOffset()
	local x, z = dx or 0, dz or 0
	if math.abs(x) < 1 and math.abs(z) < 1 then
		x, z = readSteering()
	end
	surrenderRemote:FireServer(x, z)
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
		if Art.enabled then
			-- The web game's framing (CameraZoom): keep (spread x 2.4 + 60) world px above
			-- and below the middle, showing between 277 and 720 px of the map's height.
			local halfHeight = math.clamp(reach * 2.4 + 60, 720 / 2.6 / 2, 720 / 2)
			wanted = halfHeight * S / math.tan(math.rad(FIELD_OF_VIEW / 2))
		end
		-- Zooming out reacts faster than zooming back in.
		local rate = if wanted > cameraDistance then (if Art.enabled then 1.6 else 3) else (if Art.enabled then 0.7 else 1.2)
		cameraDistance += (wanted - cameraDistance) * math.min(1, dt * rate)
		-- Locked on the army (no trailing), like the web version.
		focus = Vector3.new(army.cx * S, Ground.height(), army.cz * S)
	end
	if Art.enabled then
		-- Pixel art: straight down, like the web game, with screen-up north. Then the
		-- ground is flat on screen and the sprite layer lines up with it exactly.
		-- How many screen pixels one world pixel covers at this distance.
		local view = camera.ViewportSize
		local zoom = view.Y / (2 * cameraDistance * math.tan(math.rad(FIELD_OF_VIEW / 2))) * S
		-- Like the web game, the camera stops at the map's edge (no void beyond it).
		local function clampAxis(value: number, half: number): number
			local size = Config.world.size
			return if half * 2 >= size then size / 2 else math.clamp(value, half, size - half)
		end
		local fx = clampAxis(focus.X / S, view.X / 2 / zoom)
		local fz = clampAxis(focus.Z / S, view.Y / 2 / zoom)
		-- The sprite layer snaps to whole screen pixels; the 3D ground follows it exactly.
		fx, fz = SpriteLayer.update(fx, fz, zoom)
		local at = Vector3.new(fx * S, focus.Y, fz * S)
		camera.CFrame = CFrame.lookAt(at + Vector3.new(0, cameraDistance, 0), at, Vector3.new(0, 0, -1))
		return
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
	if Art.enabled then
		SpriteLayer.drawArmies(armies, now)
	else
		ArmyView.draw(armies, now)
	end
	NameView.draw(armies, names)
	CastleView.draw(now)
	ArenaView.draw(os.clock())
end)

print(`[{Version.name}] client ready, version {Version.version}`)
